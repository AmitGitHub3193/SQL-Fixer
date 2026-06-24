import type { RowDataPacket } from 'mysql2/promise';
import type { DbConfig, DataDiffRow, MissingDataGroup, JobEmitter, SyncDirection } from '../types.js';
import { createPool, escapeId, getPrimaryKeys, getTableColumns, rowKey } from '../db/mysql.js';

function sourceTarget(config: { local: DbConfig; live: DbConfig }, direction: SyncDirection) {
  return direction === 'local-to-live'
    ? { source: config.local, target: config.live, sourceLabel: 'Local', targetLabel: 'Live' }
    : { source: config.live, target: config.local, sourceLabel: 'Live', targetLabel: 'Local' };
}

const BATCH = 500;

export async function compareData(
  local: DbConfig,
  live: DbConfig,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter
): Promise<DataDiffRow[]> {
  const missing = await findMissingData(local, live, tables, direction, emit);
  const diffs: DataDiffRow[] = missing.flatMap((g) =>
    g.rows.map((row) => ({
      table: g.table,
      primaryKey: pickKeys(row, g.primaryKeys),
      diffType: 'missing_on_target' as const,
      sourceRow: row,
    }))
  );
  return diffs;
}

export async function findMissingData(
  local: DbConfig,
  live: DbConfig,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter,
  previewLimit = 100
): Promise<MissingDataGroup[]> {
  const { source, target, sourceLabel, targetLabel } = sourceTarget({ local, live }, direction);
  const sourcePool = createPool(source);
  const targetPool = createPool(target);
  const groups: MissingDataGroup[] = [];

  try {
    emit.log('info', `Matching data: ${sourceLabel} → ${targetLabel} (${tables.length} table(s))`);

    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      emit.progress(Math.round((ti / tables.length) * 95), `Matching table: ${table}`);

      const pkCols = await getPrimaryKeys(sourcePool, source.database, table);
      if (!pkCols.length) {
        emit.log('warn', `No primary key for "${table}", using first column`);
      }
      const columns = await getTableColumns(sourcePool, source.database, table);
      const colList = columns.map(escapeId).join(', ');

      const [sourceCount] = await sourcePool.query<RowDataPacket[]>(
        `SELECT COUNT(*) as c FROM ${escapeId(table)}`
      );
      const total = Number(sourceCount[0]?.c) || 0;
      emit.log('info', `Table "${table}": ${total} row(s) on ${sourceLabel}`);

      const missingRows: Record<string, unknown>[] = [];
      let offset = 0;

      while (offset < total) {
        const [batch] = await sourcePool.query<RowDataPacket[]>(
          `SELECT ${colList} FROM ${escapeId(table)} LIMIT ? OFFSET ?`,
          [BATCH, offset]
        );

        for (const row of batch) {
          const pk = pickKeys(row as Record<string, unknown>, pkCols);
          const exists = await rowExistsOnTarget(targetPool, table, pkCols, pk);
          if (!exists) {
            missingRows.push(row as Record<string, unknown>);
          }
        }
        offset += BATCH;
        if (total > BATCH) {
          emit.progress(
            Math.round((ti / tables.length) * 95 + (offset / total) * (95 / tables.length)),
            `${table}: scanned ${Math.min(offset, total)}/${total}`
          );
        }
      }

      if (missingRows.length > 0) {
        groups.push({
          table,
          count: missingRows.length,
          rows: missingRows.slice(0, previewLimit),
          primaryKeys: pkCols,
        });
        emit.log('warn', `"${table}": ${missingRows.length} row(s) missing on ${targetLabel}`);
      } else {
        emit.log('success', `"${table}": all rows present on ${targetLabel}`);
      }
    }

    emit.progress(100, `Found missing data in ${groups.length} table(s)`);
    return groups;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

function pickKeys(row: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const pk: Record<string, unknown> = {};
  for (const k of keys) pk[k] = row[k];
  return pk;
}

async function rowExistsOnTarget(
  pool: Awaited<ReturnType<typeof createPool>>,
  table: string,
  pkCols: string[],
  pk: Record<string, unknown>
): Promise<boolean> {
  if (!pkCols.length) return false;
  const where = pkCols.map((c) => `${escapeId(c)} = ?`).join(' AND ');
  const vals = pkCols.map((c) => pk[c]);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1 FROM ${escapeId(table)} WHERE ${where} LIMIT 1`,
    vals
  );
  return rows.length > 0;
}

export function buildInsert(table: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row);
  const values = cols.map((c) => {
    const v = row[c];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`;
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  });
  return `INSERT INTO ${escapeId(table)} (${cols.map(escapeId).join(', ')}) VALUES (${values.join(', ')});`;
}

export function buildUpsert(
  table: string,
  row: Record<string, unknown>,
  pkCols: string[]
): string {
  const cols = Object.keys(row);
  const values = cols.map((c) => {
    const v = row[c];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  });
  const updates = cols.filter((c) => !pkCols.includes(c)).map((c) => `${escapeId(c)}=VALUES(${escapeId(c)})`).join(', ');
  let sql = `INSERT INTO ${escapeId(table)} (${cols.map(escapeId).join(', ')}) VALUES (${values.join(', ')})`;
  if (updates) sql += ` ON DUPLICATE KEY UPDATE ${updates}`;
  return sql + ';';
}

export async function generateInserts(
  local: DbConfig,
  live: DbConfig,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter
): Promise<{ table: string; sql: string; count: number }[]> {
  const groups = await findMissingData(local, live, tables, direction, emit, 10000);
  const result: { table: string; sql: string; count: number }[] = [];

  for (const g of groups) {
    const { source } = sourceTarget({ local, live }, direction);
    const pool = createPool(source);
    try {
      const columns = await getTableColumns(pool, source.database, g.table);
      const colList = columns.map(escapeId).join(', ');
      const [allRows] = await pool.query<RowDataPacket[]>(`SELECT ${colList} FROM ${escapeId(g.table)}`);
      const targetPool = createPool(direction === 'local-to-live' ? live : local);
      try {
        const pkCols = g.primaryKeys;
        const missing: Record<string, unknown>[] = [];
        for (const row of allRows) {
          const pk = pickKeys(row as Record<string, unknown>, pkCols);
          const exists = await rowExistsOnTarget(targetPool, g.table, pkCols, pk);
          if (!exists) missing.push(row as Record<string, unknown>);
        }
        const sql = missing.map((r) => buildInsert(g.table, r)).join('\n');
        result.push({ table: g.table, sql, count: missing.length });
        emit.log('info', `Generated ${missing.length} INSERT(s) for "${g.table}"`);
      } finally {
        await targetPool.end();
      }
    } finally {
      await pool.end();
    }
  }
  emit.progress(100, 'SQL generation complete');
  return result;
}

export async function copyMissingData(
  local: DbConfig,
  live: DbConfig,
  tables: string[],
  direction: SyncDirection,
  duplicateMode: 'skip' | 'update' | 'error',
  emit: JobEmitter
): Promise<{ table: string; copied: number; skipped: number; errors: string[] }[]> {
  const { source, target, sourceLabel, targetLabel } = sourceTarget({ local, live }, direction);
  const sourcePool = createPool(source);
  const targetPool = createPool(target);
  const results: { table: string; copied: number; skipped: number; errors: string[] }[] = [];

  try {
    emit.log('info', `Copying missing data ${sourceLabel} → ${targetLabel} (mode: ${duplicateMode})`);

    for (let ti = 0; ti < tables.length; ti++) {
      const table = tables[ti];
      emit.progress(Math.round((ti / tables.length) * 95), `Copying: ${table}`);
      const pkCols = await getPrimaryKeys(sourcePool, source.database, table);
      const columns = await getTableColumns(sourcePool, source.database, table);
      const colList = columns.map(escapeId).join(', ');
      const [allRows] = await sourcePool.query<RowDataPacket[]>(`SELECT ${colList} FROM ${escapeId(table)}`);

      let copied = 0;
      let skipped = 0;
      const errors: string[] = [];

      for (const row of allRows) {
        const r = row as Record<string, unknown>;
        const pk = pickKeys(r, pkCols);
        const exists = await rowExistsOnTarget(targetPool, table, pkCols, pk);
        if (exists && duplicateMode === 'skip') {
          skipped++;
          continue;
        }
        try {
          const sql =
            exists && duplicateMode === 'update'
              ? buildUpsert(table, r, pkCols)
              : buildInsert(table, r);
          await targetPool.query(sql.replace(/;$/, ''));
          copied++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (duplicateMode === 'error') errors.push(msg);
          else skipped++;
        }
      }

      results.push({ table, copied, skipped, errors });
      emit.log('success', `"${table}": copied ${copied}, skipped ${skipped}`);
    }

    emit.progress(100, 'Copy complete');
    return results;
  } finally {
    await sourcePool.end();
    await targetPool.end();
  }
}

export async function copyMissingForTable(
  local: DbConfig,
  live: DbConfig,
  table: string,
  direction: SyncDirection,
  duplicateMode: 'skip' | 'update' | 'error',
  emit: JobEmitter
): Promise<{ copied: number; skipped: number }> {
  const res = await copyMissingData(local, live, [table], direction, duplicateMode, emit);
  return { copied: res[0]?.copied ?? 0, skipped: res[0]?.skipped ?? 0 };
}
