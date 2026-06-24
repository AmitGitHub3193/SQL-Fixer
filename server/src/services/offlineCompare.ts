import type { ParsedDump, ParsedTable } from './offlineDump.js';
import type { SchemaDiffItem, MissingDataGroup, SyncDirection, JobEmitter } from '../types.js';
import { buildInsert, rowKey } from './sqlDumpParser.js';

function sourceTarget(local: ParsedDump | null, live: ParsedDump | null, direction: SyncDirection) {
  return direction === 'local-to-live'
    ? { source: local, target: live, sourceLabel: 'Local file', targetLabel: 'Live file' }
    : { source: live, target: local, sourceLabel: 'Live file', targetLabel: 'Local file' };
}

export function compareSchemaOffline(
  local: ParsedDump | null,
  live: ParsedDump | null,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter
): SchemaDiffItem[] {
  const { source, target, sourceLabel, targetLabel } = sourceTarget(local, live, direction);
  if (!source || !target) throw new Error('Import both Local and Live SQL files first');

  const diffs: SchemaDiffItem[] = [];
  const tableList = tables.length ? tables : [...new Set([...source.tables.map((t) => t.name), ...target.tables.map((t) => t.name)])];

  for (let i = 0; i < tableList.length; i++) {
    const table = tableList[i];
    emit.progress(Math.round((i / tableList.length) * 100), `Schema: ${table}`);

    const src = source.tables.find((t) => t.name === table);
    const tgt = target.tables.find((t) => t.name === table);

    if (src && !tgt) {
      diffs.push({
        table,
        type: 'missing_table',
        message: `Table "${table}" in ${sourceLabel} but missing in ${targetLabel}`,
        ddl: src.createSql ?? undefined,
      });
      continue;
    }
    if (!src && tgt) {
      diffs.push({ table, type: 'extra_table', message: `Table "${table}" in ${targetLabel} but not in ${sourceLabel}` });
      continue;
    }
    if (!src || !tgt) continue;

    const srcCols = new Map(src.columns.map((c) => [c.name, c]));
    const tgtCols = new Map(tgt.columns.map((c) => [c.name, c]));

    for (const [name, col] of srcCols) {
      if (!tgtCols.has(name)) {
        diffs.push({
          table,
          type: 'missing_column',
          message: `Column "${name}" missing in ${targetLabel}`,
          ddl: `ALTER TABLE \`${table}\` ADD COLUMN ${col.definition}`,
        });
      } else if (col.definition !== tgtCols.get(name)!.definition) {
        diffs.push({
          table,
          type: 'column_mismatch',
          message: `Column "${name}" differs between files`,
          ddl: `ALTER TABLE \`${table}\` MODIFY COLUMN ${col.definition}`,
        });
      }
    }
  }

  emit.log('success', `Schema compare: ${diffs.length} difference(s)`);
  return diffs;
}

export function findMissingDataOffline(
  local: ParsedDump | null,
  live: ParsedDump | null,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter,
  previewLimit = 100
): MissingDataGroup[] {
  const { source, target, sourceLabel, targetLabel } = sourceTarget(local, live, direction);
  if (!source || !target) throw new Error('Import both Local and Live SQL files first');

  const groups: MissingDataGroup[] = [];
  const tableList = tables.length ? tables : source.tables.map((t) => t.name);

  for (let i = 0; i < tableList.length; i++) {
    const tableName = tableList[i];
    emit.progress(Math.round((i / tableList.length) * 100), `Data: ${tableName}`);

    const src = source.tables.find((t) => t.name === tableName);
    const tgt = target.tables.find((t) => t.name === tableName);
    if (!src?.rows.length) continue;

    const pkCols = src.primaryKeys.length ? src.primaryKeys : src.columns.length ? [src.columns[0].name] : ['id'];
    const tgtKeys = new Set(
      (tgt?.rows ?? []).map((r) => rowKey(r, pkCols))
    );

    const missing = src.rows.filter((r) => !tgtKeys.has(rowKey(r, pkCols)));
    if (missing.length) {
      groups.push({
        table: tableName,
        count: missing.length,
        rows: missing.slice(0, previewLimit),
        primaryKeys: pkCols,
      });
      emit.log('warn', `"${tableName}": ${missing.length} row(s) in ${sourceLabel} missing from ${targetLabel}`);
    } else {
      emit.log('success', `"${tableName}": rows match`);
    }
  }

  return groups;
}

export function generateInsertsOffline(
  local: ParsedDump | null,
  live: ParsedDump | null,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter
): { table: string; sql: string; count: number }[] {
  const groups = findMissingDataOffline(local, live, tables, direction, emit, 100000);
  const { source } = sourceTarget(local, live, direction);
  if (!source) return [];

  return groups.map((g) => {
    const table = source.tables.find((t) => t.name === g.table);
    const pkCols = g.primaryKeys;
    const tgt = direction === 'local-to-live' ? live : local;
    const tgtTable = tgt?.tables.find((t) => t.name === g.table);
    const tgtKeys = new Set((tgtTable?.rows ?? []).map((r) => rowKey(r, pkCols)));
    const missing = (table?.rows ?? []).filter((r) => !tgtKeys.has(rowKey(r, pkCols)));
    const sql = missing.map((r) => buildInsert(g.table, r)).join('\n');
    return { table: g.table, sql, count: missing.length };
  });
}

export function generateSchemaFixSql(items: SchemaDiffItem[]): string {
  return items.filter((i) => i.ddl).map((i) => i.ddl!).join('\n\n');
}

function buildCreateTableFromColumns(table: ParsedTable): string | null {
  if (!table.columns.length) return null;
  const cols = table.columns.map((c) => c.definition).join(',\n  ');
  const pkCols = table.primaryKeys.length
    ? table.primaryKeys
    : table.columns.some((c) => c.name === 'id')
      ? ['id']
      : [table.columns[0].name];
  const pk = `,\n  PRIMARY KEY (\`${pkCols.join('`, `')}\`)`;
  return `CREATE TABLE \`${table.name}\` (\n  ${cols}${pk}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
}

function resolveCreateSql(table: ParsedTable, emit?: JobEmitter): string | null {
  let ddl = table.createSql?.trim() ?? null;
  if (!ddl) {
    ddl = buildCreateTableFromColumns(table);
    if (ddl) emit?.log('warn', `"${table.name}": CREATE built from column data`);
  }
  if (!ddl) return null;
  return ddl.endsWith(';') ? ddl : `${ddl};`;
}

function resolveIndexAlter(table: ParsedTable): string | null {
  if (table.indexAlterSql) return table.indexAlterSql;
  const pkCols = table.primaryKeys.length
    ? table.primaryKeys
    : table.columns.some((c) => c.name === 'id')
      ? ['id']
      : table.columns.length
        ? [table.columns[0].name]
        : [];
  if (!pkCols.length) return null;
  return `ALTER TABLE \`${table.name}\`\n  ADD PRIMARY KEY (\`${pkCols.join('`, `')}\`);`;
}

function buildMissingColumnsAlter(tableName: string, base: ParsedTable, extra: ParsedTable): string | null {
  const baseNames = new Set(base.columns.map((c) => c.name));
  const missing = extra.columns.filter((c) => !baseNames.has(c.name));
  if (!missing.length) return null;
  return `ALTER TABLE \`${tableName}\`\n  ${missing.map((c) => `ADD COLUMN ${c.definition}`).join(',\n  ')};`;
}

function maxPkValue(rows: Record<string, unknown>[], pkCols: string[]): number {
  let max = 0;
  for (const row of rows) {
    for (const k of pkCols) {
      const v = Number(row[k]);
      if (!Number.isNaN(v) && v > max) max = v;
    }
  }
  return max;
}

function adjustAutoIncrementAlter(alter: string, maxId: number): string {
  if (maxId <= 0) return alter;
  const next = maxId + 1;
  if (/AUTO_INCREMENT=\d+/i.test(alter)) {
    return alter.replace(/AUTO_INCREMENT=\d+/i, `AUTO_INCREMENT=${next}`);
  }
  if (/;\s*$/.test(alter)) {
    return alter.replace(/;\s*$/, `, AUTO_INCREMENT=${next};`);
  }
  return `${alter}, AUTO_INCREMENT=${next};`;
}

function pickPkCols(src: ParsedTable | undefined, tgt: ParsedTable | undefined): string[] {
  if (tgt?.primaryKeys.length) return tgt.primaryKeys;
  if (src?.primaryKeys.length) return src.primaryKeys;
  if (tgt?.columns.some((c) => c.name === 'id') || src?.columns.some((c) => c.name === 'id')) return ['id'];
  if (tgt?.columns.length) return [tgt.columns[0].name];
  if (src?.columns.length) return [src.columns[0].name];
  return ['id'];
}

function resolveCreateSqlForExport(
  name: string,
  src: ParsedTable | undefined,
  tgt: ParsedTable | undefined,
  onlyOnSource: boolean,
  emit: JobEmitter,
): string | null {
  const structure = onlyOnSource ? src : tgt ?? src;
  if (!structure) return null;
  return resolveCreateSql(structure, emit);
}

export function generateCreateTablesOffline(
  local: ParsedDump | null,
  live: ParsedDump | null,
  tables: string[],
  direction: SyncDirection,
  emit: JobEmitter,
): { sql: string; tables: string[]; skipped: string[] } {
  const { source, target, sourceLabel, targetLabel } = sourceTarget(local, live, direction);
  if (!source || !target) throw new Error('Import both Local and Live SQL files first');

  const targetNames = new Set(target.tables.map((t) => t.name));
  const parts: string[] = [];
  const generated: string[] = [];
  const skipped: string[] = [];

  for (let i = 0; i < tables.length; i++) {
    const tableName = tables[i];
    emit.progress(Math.round(((i + 1) / tables.length) * 100), `CREATE TABLE: ${tableName}`);

    if (targetNames.has(tableName)) {
      emit.log('info', `"${tableName}": already exists in ${targetLabel}, skipped`);
      continue;
    }

    const src = source.tables.find((t) => t.name === tableName);
    if (!src) {
      skipped.push(tableName);
      emit.log('error', `"${tableName}": not found in ${sourceLabel}`);
      continue;
    }

    const ddl = resolveCreateSql(src, emit);
    if (!ddl) {
      skipped.push(tableName);
      emit.log('error', `"${tableName}": could not build CREATE TABLE`);
      continue;
    }

    parts.push(ddl);
    const indexAlter = resolveIndexAlter(src);
    if (indexAlter) parts.push('', indexAlter);
    if (src.autoIncrementAlterSql) parts.push('', src.autoIncrementAlterSql);
    for (const extra of src.extraAlterSql) parts.push('', extra);

    generated.push(tableName);
    emit.log('success', `"${tableName}": CREATE TABLE ready`);
  }

  emit.log('success', `Generated CREATE TABLE for ${generated.length} table(s)`);
  return { sql: parts.join('\n\n'), tables: generated, skipped };
}

export function buildFixedDumpSql(
  local: ParsedDump | null,
  live: ParsedDump | null,
  direction: SyncDirection,
  emit: JobEmitter,
): {
  sql: string;
  fileName: string;
  tableCount: number;
  rowCount: number;
  missingTablesAdded: number;
  missingRowsAdded: number;
} {
  const { source, target, sourceLabel, targetLabel } = sourceTarget(local, live, direction);
  if (!source || !target) throw new Error('Import both Local and Live SQL files first');

  const dbName = target.databaseName || source.databaseName || 'fixed_database';
  const stamp = new Date().toISOString();
  const lines = [
    `-- SQL Fixer Offline — complete fixed database export`,
    `-- Direction: ${sourceLabel} → ${targetLabel}`,
    `-- Generated: ${stamp}`,
    `-- Includes: CREATE TABLE, data, PRIMARY KEY, indexes, AUTO_INCREMENT (phpMyAdmin-compatible)`,
    `-- Import in phpMyAdmin (Import tab) or: mysql -u user -p ${dbName} < this-file.sql`,
    ``,
    `SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";`,
    `SET time_zone = "+00:00";`,
    `SET FOREIGN_KEY_CHECKS=0;`,
    `SET NAMES utf8mb4;`,
    ``,
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `USE \`${dbName}\`;`,
    ``,
  ];

  const allNames = [...new Set([...target.tables.map((t) => t.name), ...source.tables.map((t) => t.name)])].sort();
  const targetMap = new Map(target.tables.map((t) => [t.name, t]));
  const sourceMap = new Map(source.tables.map((t) => [t.name, t]));
  const indexAlters: string[] = [];
  const columnAlters: string[] = [];
  const autoIncAlters: string[] = [];
  let missingTablesAdded = 0;
  let missingRowsAdded = 0;
  let totalRows = 0;

  emit.log('info', `Building fixed dump: ${allNames.length} table(s)`);

  for (let i = 0; i < allNames.length; i++) {
    const name = allNames[i];
    emit.progress(Math.round(((i + 1) / allNames.length) * 100), `Export: ${name}`);

    const tgt = targetMap.get(name);
    const src = sourceMap.get(name);
    const onlyOnSource = !!src && !tgt;
    const onBoth = !!src && !!tgt;

    const create = resolveCreateSqlForExport(name, src, tgt, onlyOnSource, emit);
    if (!create) {
      emit.log('error', `"${name}": skipped — no CREATE TABLE available`);
      continue;
    }

    lines.push(`-- --------------------------------------------------------`);
    lines.push(`-- Table: ${name}`);
    lines.push(`-- --------------------------------------------------------`);
    lines.push(`DROP TABLE IF EXISTS \`${name}\`;`);
    lines.push(create);
    lines.push('');

    const rows: Record<string, unknown>[] = [];
    if (onlyOnSource && src) {
      rows.push(...src.rows);
      missingTablesAdded++;
      emit.log('success', `"${name}": new table + ${src.rows.length} row(s)`);
    } else if (onBoth && src && tgt) {
      const pkCols = pickPkCols(src, tgt);
      const tgtKeys = new Set(tgt.rows.map((r) => rowKey(r, pkCols)));
      rows.push(...tgt.rows);
      const added = src.rows.filter((r) => !tgtKeys.has(rowKey(r, pkCols)));
      rows.push(...added);
      missingRowsAdded += added.length;
      emit.log('success', `"${name}": ${tgt.rows.length} existing + ${added.length} new row(s)`);
    } else if (tgt) {
      rows.push(...tgt.rows);
      emit.log('info', `"${name}": ${tgt.rows.length} row(s) (target only)`);
    }

    for (const row of rows) {
      lines.push(buildInsert(name, row));
    }
    totalRows += rows.length;
    if (rows.length) lines.push('');

    const structureForAlters = onlyOnSource ? src : tgt ?? src;
    if (structureForAlters) {
      const indexAlter = resolveIndexAlter(structureForAlters);
      if (indexAlter) indexAlters.push(`-- Indexes for table \`${name}\``, indexAlter, '');

      if (onBoth && src && tgt) {
        const colAlter = buildMissingColumnsAlter(name, tgt, src);
        if (colAlter) {
          columnAlters.push(`-- Extra columns from ${sourceLabel} for \`${name}\``, colAlter, '');
          emit.log('info', `"${name}": adding missing column(s) from ${sourceLabel}`);
        }
      }

      for (const extra of structureForAlters.extraAlterSql) {
        columnAlters.push(extra, '');
      }

      const pkCols = structureForAlters.primaryKeys.length
        ? structureForAlters.primaryKeys
        : pickPkCols(src, tgt);
      const maxId = maxPkValue(rows, pkCols);
      let autoAlter = structureForAlters.autoIncrementAlterSql;
      if (autoAlter) {
        autoIncAlters.push(`-- AUTO_INCREMENT for table \`${name}\``, adjustAutoIncrementAlter(autoAlter, maxId), '');
      } else if (maxId > 0 && pkCols.length === 1 && pkCols[0] === 'id') {
        const idCol = structureForAlters.columns.find((c) => c.name === 'id');
        const typeMatch = idCol?.definition.match(/`\w+`\s+(\w+(?:\([^)]+\))?(?:\s+UNSIGNED)?)/i);
        const colType = typeMatch?.[1] ?? 'bigint UNSIGNED';
        autoIncAlters.push(
          `-- AUTO_INCREMENT for table \`${name}\``,
          `ALTER TABLE \`${name}\` MODIFY \`id\` ${colType} NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=${maxId + 1};`,
          '',
        );
      }
    }
  }

  if (indexAlters.length) {
    lines.push('-- --------------------------------------------------------', '-- Indexes for dumped tables', '-- --------------------------------------------------------', '');
    lines.push(...indexAlters);
  }
  if (columnAlters.length) {
    lines.push('-- --------------------------------------------------------', '-- Additional columns / constraints', '-- --------------------------------------------------------', '');
    lines.push(...columnAlters);
  }
  if (autoIncAlters.length) {
    lines.push('-- --------------------------------------------------------', '-- AUTO_INCREMENT for dumped tables', '-- --------------------------------------------------------', '');
    lines.push(...autoIncAlters);
  }

  lines.push('SET FOREIGN_KEY_CHECKS=1;');
  lines.push('COMMIT;');
  lines.push('-- End of fixed dump');

  const safeDb = dbName.replace(/[^\w-]/g, '_');
  const fileName = `sql-fixer-fixed_${safeDb}_${stamp.slice(0, 10)}.sql`;

  emit.log(
    'success',
    `Fixed dump ready: ${allNames.length} tables, ${totalRows.toLocaleString()} rows, ${indexAlters.length} index block(s)`,
  );

  return {
    sql: lines.join('\n'),
    fileName,
    tableCount: allNames.length,
    rowCount: totalRows,
    missingTablesAdded,
    missingRowsAdded,
  };
}

export function generateFullFixSql(
  local: ParsedDump | null,
  live: ParsedDump | null,
  tables: string[],
  direction: SyncDirection,
  schemaItems: SchemaDiffItem[],
  emit: JobEmitter
): string {
  const parts: string[] = [];
  const schemaSql = generateSchemaFixSql(schemaItems);
  if (schemaSql) parts.push('-- Schema fixes\n' + schemaSql);

  const inserts = generateInsertsOffline(local, live, tables, direction, emit);
  for (const ins of inserts) {
    if (ins.sql) parts.push(`-- Missing data: ${ins.table} (${ins.count} rows)\n${ins.sql}`);
  }
  return parts.join('\n\n');
}

export function buildOverview(local: ParsedDump | null, live: ParsedDump | null) {
  const allNames = new Set([
    ...(local?.tables.map((t) => t.name) ?? []),
    ...(live?.tables.map((t) => t.name) ?? []),
  ]);

  const localMap = new Map(local?.tables.map((t) => [t.name, t]) ?? []);
  const liveMap = new Map(live?.tables.map((t) => [t.name, t]) ?? []);

  const comparison = [...allNames].sort().map((name) => {
    const l = localMap.get(name);
    const v = liveMap.get(name);
    let status: 'both' | 'local_only' | 'live_only' = 'both';
    if (l && !v) status = 'local_only';
    else if (!l && v) status = 'live_only';
    return {
      name,
      status,
      local: l ? { name, rowCount: l.rowCount, dataLength: l.estimatedSize, indexLength: 0 } : undefined,
      live: v ? { name, rowCount: v.rowCount, dataLength: v.estimatedSize, indexLength: 0 } : undefined,
    };
  });

  const summary = (dump: ParsedDump | null, side: 'local' | 'live') => ({
    side,
    ok: !!dump,
    database: dump?.databaseName ?? '',
    host: dump?.fileName ?? 'No file imported',
    message: dump ? `Loaded ${dump.fileName}` : 'Import a .sql file',
    tableCount: dump?.tableCount ?? 0,
    totalRows: dump?.totalRows ?? 0,
    totalSize: dump?.totalSize ?? 0,
    tables: dump?.tables.map((t) => ({
      name: t.name,
      rowCount: t.rowCount,
      dataLength: t.estimatedSize,
      indexLength: 0,
    })) ?? [],
  });

  return { local: summary(local, 'local'), live: summary(live, 'live'), comparison };
}

export function getTablePreviewOffline(dump: ParsedDump | null, tableName: string, side: 'local' | 'live') {
  const table = dump?.tables.find((t) => t.name === tableName);
  if (!table) throw new Error(`Table "${tableName}" not found in ${side} file`);

  return {
    name: table.name,
    side,
    columns: table.columns.map((c) => ({
      name: c.name,
      type: c.definition.replace(/^`[^`]+`\s*/, ''),
      nullable: true,
      key: table.primaryKeys.includes(c.name) ? 'PRI' : '',
      default: null,
      extra: '',
    })),
    rowCount: table.rowCount,
    dataSize: table.estimatedSize,
    indexSize: 0,
    sampleRows: table.rows.slice(0, 50),
    createTable: table.createSql,
  };
}
