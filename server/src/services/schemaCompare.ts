import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { DbConfig, SchemaDiffItem, JobEmitter, SyncDirection } from '../types.js';
import { createPool, escapeId } from '../db/mysql.js';

function sourceTarget(config: { local: DbConfig; live: DbConfig }, direction: SyncDirection) {
  return direction === 'local-to-live'
    ? { source: config.local, target: config.live, sourceLabel: 'Local', targetLabel: 'Live' }
    : { source: config.live, target: config.local, sourceLabel: 'Live', targetLabel: 'Local' };
}

export async function compareSchema(
  local: DbConfig,
  live: DbConfig,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter
): Promise<SchemaDiffItem[]> {
  const { source, target, sourceLabel, targetLabel } = sourceTarget({ local, live }, direction);
  const sourcePool = createPool(source);
  const targetPool = createPool(target);
  const diffs: SchemaDiffItem[] = [];

  try {
    emit.log('info', `Comparing schema: ${sourceLabel} → ${targetLabel}`);
    const tableList = tables.length ? tables : await getAllTables(sourcePool, source.database);

    for (let i = 0; i < tableList.length; i++) {
      const table = tableList[i];
      emit.progress(Math.round((i / tableList.length) * 90), `Checking table: ${table}`);

      const targetExists = await tableExists(targetPool, target.database, table);
      const sourceExists = await tableExists(sourcePool, source.database, table);

      if (sourceExists && !targetExists) {
        const ddl = await getCreateTable(sourcePool, table);
        diffs.push({
          table,
          type: 'missing_table',
          message: `Table "${table}" exists on ${sourceLabel} but missing on ${targetLabel}`,
          ddl: ddl ?? undefined,
        });
        continue;
      }
      if (!sourceExists && targetExists) {
        diffs.push({
          table,
          type: 'extra_table',
          message: `Table "${table}" exists on ${targetLabel} but not on ${sourceLabel}`,
        });
        continue;
      }
      if (!sourceExists) continue;

      const sourceCols = await getColumns(sourcePool, source.database, table);
      const targetCols = await getColumns(targetPool, target.database, table);
      const sourceColMap = new Map(sourceCols.map((c) => [c.name, c]));
      const targetColMap = new Map(targetCols.map((c) => [c.name, c]));

      for (const [name, col] of sourceColMap) {
        if (!targetColMap.has(name)) {
          diffs.push({
            table,
            type: 'missing_column',
            message: `Column "${name}" missing on ${targetLabel} in table "${table}"`,
            ddl: `ALTER TABLE ${escapeId(table)} ADD COLUMN ${col.definition}`,
          });
        } else if (col.definition !== targetColMap.get(name)!.definition) {
          diffs.push({
            table,
            type: 'column_mismatch',
            message: `Column "${name}" differs in "${table}": source=${col.definition}, target=${targetColMap.get(name)!.definition}`,
            ddl: `ALTER TABLE ${escapeId(table)} MODIFY COLUMN ${col.definition}`,
          });
        }
      }
      for (const name of targetColMap.keys()) {
        if (!sourceColMap.has(name)) {
          diffs.push({
            table,
            type: 'extra_column',
            message: `Extra column "${name}" on ${targetLabel} in table "${table}"`,
          });
        }
      }

      const sourceIndexes = await getIndexes(sourcePool, source.database, table);
      const targetIndexes = await getIndexes(targetPool, target.database, table);
      for (const [idxName, idxDef] of sourceIndexes) {
        if (!targetIndexes.has(idxName)) {
          diffs.push({
            table,
            type: 'missing_index',
            message: `Index "${idxName}" missing on ${targetLabel} in "${table}"`,
            ddl: idxDef,
          });
        }
      }
    }

    emit.progress(100, `Found ${diffs.length} schema difference(s)`);
    emit.log('success', `Schema compare complete: ${diffs.length} item(s)`);
    return diffs;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

async function getAllTables(pool: Pool, database: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`,
    [database]
  );
  return rows.map((r) => r.TABLE_NAME as string);
}

async function tableExists(pool: Pool, database: string, table: string): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, table]
  );
  return rows.length > 0;
}

async function getCreateTable(pool: Pool, table: string): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${escapeId(table)}`);
  if (!rows[0]) return null;
  return (rows[0] as Record<string, string>)['Create Table'] ?? null;
}

interface ColumnDef {
  name: string;
  definition: string;
}

async function getColumns(pool: Pool, database: string, table: string): Promise<ColumnDef[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA, COLUMN_KEY
     FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [database, table]
  );
  return rows.map((r) => {
    const name = r.COLUMN_NAME as string;
    let def = `${escapeId(name)} ${r.COLUMN_TYPE}`;
    if (r.IS_NULLABLE === 'NO') def += ' NOT NULL';
    if (r.COLUMN_DEFAULT !== null && r.COLUMN_DEFAULT !== undefined) {
      const d = r.COLUMN_DEFAULT as string;
      def += d === 'CURRENT_TIMESTAMP' ? ` DEFAULT ${d}` : ` DEFAULT '${d}'`;
    }
    if (r.EXTRA) def += ` ${r.EXTRA}`;
    return { name, definition: def };
  });
}

async function getIndexes(pool: Pool, database: string, table: string): Promise<Map<string, string>> {
  const [rows] = await pool.query<RowDataPacket[]>(`SHOW INDEX FROM ${escapeId(table)}`);
  const groups = new Map<string, { unique: boolean; cols: string[] }>();
  for (const r of rows) {
    const keyName = r.Key_name as string;
    if (keyName === 'PRIMARY') continue;
    if (!groups.has(keyName)) {
      groups.set(keyName, { unique: r.Non_unique === 0, cols: [] });
    }
    groups.get(keyName)!.cols.push(r.Column_name as string);
  }
  const result = new Map<string, string>();
  for (const [name, g] of groups) {
    const type = g.unique ? 'UNIQUE INDEX' : 'INDEX';
    result.set(name, `ALTER TABLE ${escapeId(table)} ADD ${type} ${escapeId(name)} (${g.cols.map(escapeId).join(', ')})`);
  }
  return result;
}

export async function applySchemaFixes(
  local: DbConfig,
  live: DbConfig,
  items: SchemaDiffItem[],
  direction: SyncDirection,
  emit: JobEmitter
): Promise<{ applied: number; errors: string[] }> {
  const { target, targetLabel } = sourceTarget({ local, live }, direction);
  const pool = createPool(target);
  const errors: string[] = [];
  let applied = 0;
  const fixable = items.filter((i) => i.ddl && ['missing_table', 'missing_column', 'column_mismatch', 'missing_index'].includes(i.type));

  try {
    emit.log('info', `Applying ${fixable.length} schema fix(es) to ${targetLabel}`);
    for (let i = 0; i < fixable.length; i++) {
      const item = fixable[i];
      emit.progress(Math.round((i / fixable.length) * 100), `Applying: ${item.table} - ${item.type}`);
      try {
        await pool.query(item.ddl!);
        applied++;
        emit.log('success', `Applied: ${item.message}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(`${item.table}: ${msg}`);
        emit.log('error', `Failed: ${item.message} — ${msg}`);
      }
    }
    emit.progress(100, `Applied ${applied}/${fixable.length}`);
    return { applied, errors };
  } finally {
    await pool.end();
  }
}
