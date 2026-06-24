export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type DbSide = 'local' | 'live';
export type SyncDirection = 'local-to-live' | 'live-to-local';

export interface TableInfo {
  name: string;
  rowCount: number;
  dataLength: number;
  indexLength: number;
}

export interface SchemaDiffItem {
  table: string;
  type: 'missing_table' | 'extra_table' | 'missing_column' | 'extra_column' | 'column_mismatch' | 'missing_index' | 'extra_index';
  message: string;
  ddl?: string;
}

export interface DataDiffRow {
  table: string;
  primaryKey: Record<string, unknown>;
  diffType: 'missing_on_target' | 'extra_on_target' | 'changed';
  sourceRow?: Record<string, unknown>;
  targetRow?: Record<string, unknown>;
  changedColumns?: string[];
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

export interface CompareSchemaRequest {
  local: DbConfig;
  live: DbConfig;
  tables: string[];
  direction: SyncDirection;
}

export interface CompareDataRequest {
  local: DbConfig;
  live: DbConfig;
  tables: string[];
  direction: SyncDirection;
}

export interface CopyMissingRequest {
  local: DbConfig;
  live: DbConfig;
  tables: string[];
  direction: SyncDirection;
  duplicateMode: 'skip' | 'update' | 'error';
}

export interface GenerateInsertsRequest {
  local: DbConfig;
  live: DbConfig;
  tables: string[];
  direction: SyncDirection;
}

export interface ApplySchemaFixRequest {
  local: DbConfig;
  live: DbConfig;
  items: SchemaDiffItem[];
  direction: SyncDirection;
}

export interface ImportSqlRequest {
  target: DbSide;
  config: DbConfig;
}

export type JobEmitter = {
  log: (level: JobLog['level'], message: string) => void;
  progress: (percent: number, message?: string) => void;
};
