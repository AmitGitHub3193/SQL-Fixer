import type { DbConfig, DbSide, TableInfo } from '../types.js';
import { testConnection, listTables } from '../db/mysql.js';

export interface DatabaseSummary {
  side: DbSide;
  ok: boolean;
  database: string;
  host: string;
  message: string;
  tableCount: number;
  totalRows: number;
  totalSize: number;
  tables: TableInfo[];
}

export interface TableComparisonRow {
  name: string;
  status: 'both' | 'local_only' | 'live_only';
  local?: TableInfo;
  live?: TableInfo;
}

export interface DatabasesOverview {
  local: DatabaseSummary;
  live: DatabaseSummary;
  comparison: TableComparisonRow[];
}

export async function getDatabaseSummary(side: DbSide, config: DbConfig): Promise<DatabaseSummary> {
  const conn = await testConnection(config);

  if (!conn.ok) {
    return {
      side,
      ok: false,
      database: config.database,
      host: config.host,
      message: conn.message,
      tableCount: 0,
      totalRows: 0,
      totalSize: 0,
      tables: [],
    };
  }

  if (!config.database) {
    return {
      side,
      ok: true,
      database: '',
      host: config.host,
      message: 'Connected — enter database name and load tables',
      tableCount: 0,
      totalRows: 0,
      totalSize: 0,
      tables: [],
    };
  }

  const tables = await listTables(config);
  return {
    side,
    ok: true,
    database: config.database,
    host: config.host,
    message: conn.message,
    tableCount: tables.length,
    totalRows: tables.reduce((s, t) => s + t.rowCount, 0),
    totalSize: tables.reduce((s, t) => s + t.dataLength + t.indexLength, 0),
    tables,
  };
}

export async function getDatabasesOverview(local: DbConfig, live: DbConfig): Promise<DatabasesOverview> {
  const [localSummary, liveSummary] = await Promise.all([
    getDatabaseSummary('local', local),
    getDatabaseSummary('live', live),
  ]);

  const allNames = new Set([
    ...localSummary.tables.map((t) => t.name),
    ...liveSummary.tables.map((t) => t.name),
  ]);
  const localMap = new Map(localSummary.tables.map((t) => [t.name, t]));
  const liveMap = new Map(liveSummary.tables.map((t) => [t.name, t]));

  const comparison: TableComparisonRow[] = [...allNames].sort().map((name) => {
    const l = localMap.get(name);
    const v = liveMap.get(name);
    let status: TableComparisonRow['status'] = 'both';
    if (l && !v) status = 'local_only';
    else if (!l && v) status = 'live_only';
    return { name, status, local: l, live: v };
  });

  return { local: localSummary, live: liveSummary, comparison };
}
