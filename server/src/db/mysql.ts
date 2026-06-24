import mysql, { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import type { DbConfig, TableInfo, DbSide } from '../types.js';

export { executeSqlFile, splitSqlStatements } from './sqlParser.js';
export type { SqlImportResult } from './sqlParser.js';

export function createPool(config: DbConfig): Pool {
  const opts: PoolOptions = {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    waitForConnections: true,
    connectionLimit: 5,
    multipleStatements: true,
  };
  if (config.database) opts.database = config.database;
  return mysql.createPool(opts);
}

export async function testConnection(config: DbConfig): Promise<{ ok: boolean; message: string }> {
  let pool: Pool | null = null;
  try {
    pool = createPool(config);
    await pool.query('SELECT 1');
    return { ok: true, message: `Connected to ${config.database}@${config.host}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  } finally {
    await pool?.end();
  }
}

export async function listTables(config: DbConfig): Promise<TableInfo[]> {
  const pool = createPool(config);
  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_NAME as name, TABLE_ROWS as rowCount,
              DATA_LENGTH as dataLength, INDEX_LENGTH as indexLength
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'
       ORDER BY TABLE_NAME`,
      [config.database]
    );
    return rows.map((r) => ({
      name: r.name as string,
      rowCount: Number(r.rowCount) || 0,
      dataLength: Number(r.dataLength) || 0,
      indexLength: Number(r.indexLength) || 0,
    }));
  } finally {
    await pool.end();
  }
}

export async function getPrimaryKeys(pool: Pool, database: string, table: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`,
    [database, table]
  );
  if (rows.length) return rows.map((r) => r.COLUMN_NAME as string);

  // Fallback: first column
  const [cols] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION LIMIT 1`,
    [database, table]
  );
  return cols.length ? [cols[0].COLUMN_NAME as string] : [];
}

export async function getTableColumns(pool: Pool, database: string, table: string): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
    [database, table]
  );
  return rows.map((r) => r.COLUMN_NAME as string);
}

export function escapeId(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

export function rowKey(row: Record<string, unknown>, keys: string[]): string {
  return keys.map((k) => JSON.stringify(row[k])).join('|');
}

export interface ColumnDetail {
  name: string;
  type: string;
  nullable: boolean;
  key: string;
  default: string | null;
  extra: string;
}

export interface TablePreview {
  name: string;
  side: DbSide;
  columns: ColumnDetail[];
  rowCount: number;
  dataSize: number;
  indexSize: number;
  sampleRows: Record<string, unknown>[];
  createTable: string | null;
}

export async function getTablePreview(
  config: DbConfig,
  side: DbSide,
  table: string,
  sampleLimit = 50
): Promise<TablePreview> {
  const pool = createPool(config);
  try {
    const [createRows] = await pool.query<RowDataPacket[]>(`SHOW CREATE TABLE ${escapeId(table)}`);
    const createTable = createRows[0]
      ? ((createRows[0] as Record<string, string>)['Create Table'] ?? null)
      : null;

    const [colRows] = await pool.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [config.database, table]
    );

    const [stats] = await pool.query<RowDataPacket[]>(
      `SELECT TABLE_ROWS, DATA_LENGTH, INDEX_LENGTH FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
      [config.database, table]
    );

    const [countRows] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) as c FROM ${escapeId(table)}`
    );

    const [sample] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM ${escapeId(table)} LIMIT ?`,
      [sampleLimit]
    );

    return {
      name: table,
      side,
      columns: colRows.map((r) => ({
        name: r.COLUMN_NAME as string,
        type: r.COLUMN_TYPE as string,
        nullable: r.IS_NULLABLE === 'YES',
        key: (r.COLUMN_KEY as string) || '',
        default: r.COLUMN_DEFAULT as string | null,
        extra: (r.EXTRA as string) || '',
      })),
      rowCount: Number(countRows[0]?.c) || 0,
      dataSize: Number(stats[0]?.DATA_LENGTH) || 0,
      indexSize: Number(stats[0]?.INDEX_LENGTH) || 0,
      sampleRows: sample as Record<string, unknown>[],
      createTable,
    };
  } finally {
    await pool.end();
  }
}
