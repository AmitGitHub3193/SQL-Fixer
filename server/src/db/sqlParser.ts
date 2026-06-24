import mysql from 'mysql2/promise';
import type { DbConfig } from '../types.js';

export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inString = false;
  let stringChar = '';
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += c;
      if (c === '\n') inLineComment = false;
      continue;
    }

    if (inBlockComment) {
      current += c;
      if (c === '*' && next === '/') {
        current += next;
        i++;
        inBlockComment = false;
      }
      continue;
    }

    if (!inString && c === '-' && next === '-') {
      inLineComment = true;
      current += c;
      continue;
    }

    if (!inString && c === '#') {
      inLineComment = true;
      current += c;
      continue;
    }

    if (!inString && c === '/' && next === '*') {
      inBlockComment = true;
      current += c;
      continue;
    }

    if ((c === "'" || c === '"') && !inString) {
      inString = true;
      stringChar = c;
      current += c;
      continue;
    }

    if (inString) {
      current += c;
      if (c === stringChar && sql[i - 1] !== '\\') inString = false;
      continue;
    }

    if (c === ';') {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }

    current += c;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

function isCommentOnly(stmt: string): boolean {
  const lines = stmt
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 && lines.every((l) => l.startsWith('--') || l.startsWith('#') || l.startsWith('/*'));
}

function isSkippableStatement(stmt: string): boolean {
  const upper = stmt.trim().toUpperCase();
  return upper.startsWith('DELIMITER ');
}

function escapeDbName(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

export function detectDatabaseFromSql(sql: string): string | null {
  const patterns = [
    /\bUSE\s+[`'"]?([\w-]+)[`'"]?\s*;/gi,
    /Database:\s*[`'"]?([\w-]+)[`'"]?/gi,
    /CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?([\w-]+)[`'"]?/gi,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(sql);
    if (match?.[1]) return match[1];
  }
  return null;
}

function detectDatabaseFromStatement(stmt: string): string | null {
  const m = stmt.match(/Database:\s*[`'"]?([\w-]+)[`'"]?/i);
  return m?.[1] ?? null;
}

function parseUseDatabase(stmt: string): string | null {
  const stripped = stmt.replace(/^(\s*(--[^\n]*\n|\#[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*)+/g, '').trim();
  const m = stripped.match(/^USE\s+[`'"]?([\w-]+)[`'"]?\s*;?\s*$/i);
  return m?.[1] ?? null;
}

function parseCreateDatabase(stmt: string): string | null {
  const stripped = stmt.replace(/^(\s*(--[^\n]*\n|\#[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*)+/g, '').trim();
  const m = stripped.match(/^CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?([\w-]+)[`'"]?/i);
  return m?.[1] ?? null;
}

async function ensureDatabase(
  connection: mysql.Connection,
  dbName: string,
  onProgress?: (msg: string) => void
): Promise<void> {
  const id = escapeDbName(dbName);
  await connection.query(`CREATE DATABASE IF NOT EXISTS ${id}`);
  await connection.query(`USE ${id}`);
  onProgress?.(`Using database: ${dbName}`);
}

export interface SqlImportResult {
  executed: number;
  skipped: number;
  failed: number;
  errors: string[];
  database: string;
}

export async function executeSqlFile(
  config: DbConfig,
  sql: string,
  onProgress?: (pct: number, msg: string) => void
): Promise<SqlImportResult> {
  const cleaned = sql.replace(/^\uFEFF/, '');
  const statements = splitSqlStatements(cleaned);
  const detectedDb = detectDatabaseFromSql(cleaned);
  const targetDb = config.database || detectedDb || '';

  const result: SqlImportResult = {
    executed: 0,
    skipped: 0,
    failed: 0,
    errors: [],
    database: targetDb,
  };
  const total = statements.length || 1;

  const connection = await mysql.createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    multipleStatements: false,
  });

  try {
    if (targetDb) {
      await ensureDatabase(connection, targetDb, (msg) => onProgress?.(0, msg));
      result.database = targetDb;
    }

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (!stmt || isCommentOnly(stmt) || isSkippableStatement(stmt)) {
        result.skipped++;
        continue;
      }

      const stmtDb = detectDatabaseFromStatement(stmt);
      if (stmtDb && stmtDb !== result.database) {
        await ensureDatabase(connection, stmtDb, (msg) =>
          onProgress?.(Math.round((i / total) * 100), msg)
        );
        result.database = stmtDb;
      }

      const useDb = parseUseDatabase(stmt);
      const createDb = parseCreateDatabase(stmt);

      if (useDb) {
        await ensureDatabase(connection, useDb, (msg) =>
          onProgress?.(Math.round((i / total) * 100), msg)
        );
        result.database = useDb;
        result.executed++;
        continue;
      }

      try {
        await connection.query(stmt);
        result.executed++;

        if (createDb) {
          await connection.query(`USE ${escapeDbName(createDb)}`);
          result.database = createDb;
          onProgress?.(
            Math.round(((i + 1) / total) * 100),
            `Created and selected database: ${createDb}`
          );
        } else {
          onProgress?.(
            Math.round(((i + 1) / total) * 100),
            `Executed ${result.executed} statement(s) (${i + 1}/${total})`
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg.includes('already exists') ||
          msg.includes('Duplicate') ||
          msg.includes('database exists')
        ) {
          result.skipped++;
          if (createDb) {
            await connection.query(`USE ${escapeDbName(createDb)}`);
            result.database = createDb;
          }
          onProgress?.(Math.round(((i + 1) / total) * 100), `Skipped (exists): ${stmt.slice(0, 80)}...`);
        } else {
          result.failed++;
          result.errors.push(msg);
          onProgress?.(Math.round(((i + 1) / total) * 100), `Error: ${msg}`);
          throw new Error(`Import failed at statement ${i + 1}: ${msg}\n\nSQL: ${stmt.slice(0, 300)}...`);
        }
      }
    }

    if (!result.database) {
      throw new Error(
        'No database selected. Set LOCAL_DB_DATABASE=dr_now in server/.env, or use a dump with USE `dbname` or Database: `dbname` in comments.'
      );
    }

    return result;
  } finally {
    await connection.end();
  }
}
