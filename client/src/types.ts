export type SyncDirection = 'local-to-live' | 'live-to-local';
export type DbSide = 'local' | 'live';

export interface TableInfo {
  name: string;
  rowCount: number;
  dataLength: number;
  indexLength: number;
}

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

export interface SchemaDiffItem {
  table: string;
  type: string;
  message: string;
  ddl?: string;
}

export interface MissingDataGroup {
  table: string;
  count: number;
  rows: Record<string, unknown>[];
  primaryKeys: string[];
}

export interface JobLog {
  time: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export interface JobState {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  message: string;
  logs: JobLog[];
  result?: unknown;
  error?: string;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function statusLabel(status: TableComparisonRow['status']): string {
  if (status === 'both') return 'In both files';
  if (status === 'local_only') return 'Missing on Live';
  return 'Missing on Local';
}
