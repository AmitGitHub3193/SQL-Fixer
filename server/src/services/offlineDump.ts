import type { JobEmitter } from '../types.js';
import {
  splitSqlStatements,
  detectDatabaseName,
  parseCreateTable,
  parseInsert,
  parseAlterTable,
  rowToObject,
} from './sqlDumpParser.js';

export interface ParsedTable {
  name: string;
  createSql: string | null;
  columns: { name: string; definition: string }[];
  primaryKeys: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
  estimatedSize: number;
  indexAlterSql: string | null;
  autoIncrementAlterSql: string | null;
  extraAlterSql: string[];
}

export interface ParsedDump {
  side: 'local' | 'live';
  fileName: string;
  databaseName: string;
  fileSize: number;
  tables: ParsedTable[];
  tableCount: number;
  totalRows: number;
  totalSize: number;
}

export interface TableInfo {
  name: string;
  rowCount: number;
  dataLength: number;
  indexLength: number;
}

function isSkippable(stmt: string): boolean {
  const u = strip(stmt).toUpperCase();
  return (
    u.startsWith('SET ') ||
    u.startsWith('USE ') ||
    u.startsWith('DELIMITER ') ||
    u.startsWith('START TRANSACTION') ||
    u.startsWith('COMMIT') ||
    u.startsWith('BEGIN') ||
    u.startsWith('LOCK TABLES') ||
    u.startsWith('UNLOCK TABLES') ||
    u.startsWith('CREATE DATABASE') ||
    u.startsWith('DROP DATABASE')
  );
}

function strip(stmt: string): string {
  return stmt.replace(/^(\s*(--[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*)+/, '').trim();
}

function isCommentOnly(stmt: string): boolean {
  const lines = stmt.split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l.startsWith('--') || l.startsWith('#') || l.startsWith('/*'));
}

function emptyTable(name: string): ParsedTable {
  return {
    name,
    createSql: null,
    columns: [],
    primaryKeys: [],
    rows: [],
    rowCount: 0,
    estimatedSize: 0,
    indexAlterSql: null,
    autoIncrementAlterSql: null,
    extraAlterSql: [],
  };
}

export async function parseSqlDumpFile(
  sql: string,
  fileName: string,
  side: 'local' | 'live',
  emit?: JobEmitter
): Promise<ParsedDump> {
  const cleaned = sql.replace(/^\uFEFF/, '');
  const statements = splitSqlStatements(cleaned);
  const databaseName = detectDatabaseName(cleaned);
  const tableMap = new Map<string, ParsedTable>();

  emit?.progress(1, `Parsing ${fileName}…`);
  emit?.log('info', `Parsing ${fileName}: ${statements.length} statement(s)`);

  let processed = 0;
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i].trim();
    if (!stmt || isCommentOnly(stmt) || isSkippable(stmt)) continue;

    processed++;
    if (processed === 1 || processed % 25 === 0 || i === statements.length - 1) {
      emit?.progress(
        Math.max(1, Math.round(((i + 1) / statements.length) * 100)),
        `Parsing ${fileName}… ${i + 1}/${statements.length} statements`,
      );
    }

    const create = parseCreateTable(stmt);
    if (create) {
      const existing = tableMap.get(create.name);
      tableMap.set(create.name, {
        name: create.name,
        createSql: create.createSql,
        columns: create.columns,
        primaryKeys: create.primaryKeys,
        rows: existing?.rows ?? [],
        rowCount: existing?.rowCount ?? 0,
        estimatedSize: stmt.length + (existing?.estimatedSize ?? 0),
        indexAlterSql: existing?.indexAlterSql ?? null,
        autoIncrementAlterSql: existing?.autoIncrementAlterSql ?? null,
        extraAlterSql: existing?.extraAlterSql ?? [],
      });
      continue;
    }

    const alter = parseAlterTable(stmt);
    if (alter) {
      let table = tableMap.get(alter.table);
      if (!table) {
        table = emptyTable(alter.table);
        tableMap.set(alter.table, table);
      }
      if (alter.kind === 'indexes') table.indexAlterSql = alter.sql;
      else if (alter.kind === 'auto_increment') table.autoIncrementAlterSql = alter.sql;
      else table.extraAlterSql.push(alter.sql);
      table.estimatedSize += stmt.length;
      continue;
    }

    const insert = parseInsert(stmt);
    if (insert) {
      let table = tableMap.get(insert.table);
      if (!table) {
        table = emptyTable(insert.table);
        tableMap.set(insert.table, table);
      }

      const cols =
        insert.columns ??
        (table.columns.length ? table.columns.map((c) => c.name) : insert.rows[0]?.map((_, idx) => `col_${idx}`) ?? []);

      if (!table.columns.length && insert.columns) {
        table.columns = insert.columns.map((name) => ({ name, definition: `\`${name}\` TEXT` }));
      }
      if (!table.primaryKeys.length && cols.length) table.primaryKeys = [cols[0]];

      for (const tuple of insert.rows) {
        table.rows.push(rowToObject(cols, tuple));
      }
      table.rowCount = table.rows.length;
      table.estimatedSize += stmt.length;
    }
  }

  const tables = [...tableMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const totalRows = tables.reduce((s, t) => s + t.rowCount, 0);
  const totalSize = tables.reduce((s, t) => s + t.estimatedSize, 0);

  emit?.progress(100, `Parsed ${fileName}`);
  emit?.log('success', `Parsed ${tables.length} table(s), ${totalRows.toLocaleString()} row(s) from ${fileName}`);

  return {
    side,
    fileName,
    databaseName,
    fileSize: cleaned.length,
    tables,
    tableCount: tables.length,
    totalRows,
    totalSize,
  };
}

export function dumpToTableInfo(dump: ParsedDump | null): TableInfo[] {
  if (!dump) return [];
  return dump.tables.map((t) => ({
    name: t.name,
    rowCount: t.rowCount,
    dataLength: t.estimatedSize,
    indexLength: 0,
  }));
}

export function getTableFromDump(dump: ParsedDump | null, name: string): ParsedTable | null {
  return dump?.tables.find((t) => t.name === name) ?? null;
}
