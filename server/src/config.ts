import type { DbConfig, DbSide } from './types.js';

/** Optional server defaults from environment (UI overrides these). */
export function envDefaults(side: DbSide): Partial<DbConfig> {
  const prefix = side === 'local' ? 'LOCAL_DB' : 'LIVE_DB';
  return {
    host: process.env[`${prefix}_HOST`] ?? '127.0.0.1',
    port: Number(process.env[`${prefix}_PORT`] ?? 3306),
    user: process.env[`${prefix}_USER`] ?? 'root',
    password: process.env[`${prefix}_PASSWORD`] ?? '',
    database: process.env[`${prefix}_DATABASE`] ?? '',
  };
}

export function mergeConfig(side: DbSide, fromClient?: DbConfig): DbConfig {
  const defaults = envDefaults(side);
  return {
    host: fromClient?.host || defaults.host || '127.0.0.1',
    port: fromClient?.port || defaults.port || 3306,
    user: fromClient?.user || defaults.user || 'root',
    password: fromClient?.password ?? defaults.password ?? '',
    database: fromClient?.database || defaults.database || '',
  };
}
