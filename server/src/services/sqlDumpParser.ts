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

export function detectDatabaseName(sql: string): string {
  const patterns = [
    /\bUSE\s+[`'"]?([\w-]+)[`'"]?\s*;/i,
    /Database:\s*[`'"]?([\w-]+)[`'"]?/i,
    /CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?([\w-]+)[`'"]?/i,
  ];
  for (const p of patterns) {
    const m = sql.match(p);
    if (m?.[1]) return m[1];
  }
  return 'imported_db';
}

function stripLeadingComments(stmt: string): string {
  return stmt.replace(/^(\s*(--[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*)+/, '').trim();
}

export function parseCreateTable(stmt: string): {
  name: string;
  createSql: string;
  columns: { name: string; definition: string }[];
  primaryKeys: string[];
} | null {
  const s = stripLeadingComments(stmt);
  const m = s.match(/^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?([\w-]+)[`'"]?\s*\(/i);
  if (!m) return null;

  const name = m[1];
  const openIdx = s.indexOf('(', m.index!);
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  if (closeIdx < 0) return null;

  const body = s.slice(openIdx + 1, closeIdx);
  const columns: { name: string; definition: string }[] = [];
  const primaryKeys: string[] = [];

  const parts = splitCreateBody(body);
  for (const part of parts) {
    const trimmed = part.trim();
    const pkMatch = trimmed.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
    if (pkMatch) {
      pkMatch[1].split(',').forEach((c) => primaryKeys.push(c.trim().replace(/[`'"]/g, '')));
      continue;
    }
    if (/^(PRIMARY\s+KEY|UNIQUE\s+KEY|KEY|INDEX|CONSTRAINT|FULLTEXT|SPATIAL)/i.test(trimmed)) continue;

    const colMatch = trimmed.match(/^[`'"]?([\w-]+)[`'"]?\s+(.+)$/i);
    if (colMatch) {
      columns.push({ name: colMatch[1], definition: `\`${colMatch[1]}\` ${colMatch[2].trim()}` });
    }
  }

  if (!primaryKeys.length && columns.length) primaryKeys.push(columns[0].name);

  return { name, createSql: s, columns, primaryKeys };
}

function splitCreateBody(body: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inStr = false;
  let strChar = '';

  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if ((c === "'" || c === '"') && !inStr) {
      inStr = true;
      strChar = c;
      current += c;
      continue;
    }
    if (inStr) {
      current += c;
      if (c === strChar && body[i - 1] !== '\\') inStr = false;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  if (current.trim()) parts.push(current);
  return parts;
}

/** phpMyAdmin puts PRIMARY KEY / indexes / AUTO_INCREMENT in ALTER TABLE blocks at end of dump. */
export function parseAlterTable(stmt: string): {
  table: string;
  sql: string;
  kind: 'indexes' | 'auto_increment' | 'other';
} | null {
  const s = stripLeadingComments(stmt);
  if (!/^ALTER\s+TABLE/i.test(s)) return null;
  const m = s.match(/^ALTER\s+TABLE\s+[`'"]?([\w-]+)[`'"]?\s*/i);
  if (!m) return null;
  const sql = s.endsWith(';') ? s : `${s};`;
  const upper = sql.toUpperCase();
  if (/MODIFY\s+/.test(upper) && /AUTO_INCREMENT/.test(upper)) {
    return { table: m[1], sql, kind: 'auto_increment' };
  }
  if (/ADD PRIMARY KEY|ADD UNIQUE KEY|ADD KEY|ADD INDEX|ADD FULLTEXT|ADD SPATIAL/.test(upper)) {
    return { table: m[1], sql, kind: 'indexes' };
  }
  if (/ADD COLUMN|ADD CONSTRAINT|ADD FOREIGN KEY/.test(upper)) {
    return { table: m[1], sql, kind: 'other' };
  }
  return null;
}

export function parseInsert(stmt: string): {
  table: string;
  columns: string[] | null;
  rows: unknown[][];
  raw: string;
} | null {
  const s = stripLeadingComments(stmt);
  const m = s.match(/^INSERT\s+(?:IGNORE\s+INTO|INTO)\s+[`'"]?([\w-]+)[`'"]?\s*(?:\(([^)]+)\))?\s*VALUES\s*/i);
  if (!m) return null;

  const table = m[1];
  const columns = m[2]
    ? m[2].split(',').map((c) => c.trim().replace(/[`'"]/g, ''))
    : null;
  const valuesStart = s.toUpperCase().indexOf('VALUES') + 6;
  const tuples = parseValueTuples(s.slice(valuesStart));
  return { table, columns, rows: tuples, raw: s };
}

function parseValueTuples(sql: string): unknown[][] {
  const rows: unknown[][] = [];
  let i = 0;
  while (i < sql.length) {
    while (i < sql.length && (sql[i] === ' ' || sql[i] === ',' || sql[i] === '\n' || sql[i] === '\r')) i++;
    if (i >= sql.length || sql[i] !== '(') break;
    i++;
    const values = parseTupleValues(sql, i);
    rows.push(values.values);
    i = values.end;
    if (sql[i] === ')') i++;
  }
  return rows;
}

function parseTupleValues(sql: string, start: number): { values: unknown[]; end: number } {
  const values: unknown[] = [];
  let i = start;
  while (i < sql.length) {
    while (i < sql.length && (sql[i] === ' ' || sql[i] === ',')) i++;
    if (i >= sql.length || sql[i] === ')') break;

    const val = parseSingleValue(sql, i);
    values.push(val.value);
    i = val.end;
  }
  return { values, end: i };
}

function parseSingleValue(sql: string, start: number): { value: unknown; end: number } {
  let i = start;
  if (sql.slice(i, i + 4).toUpperCase() === 'NULL') return { value: null, end: i + 4 };
  if (sql[i] === "'") {
    i++;
    let s = '';
    while (i < sql.length) {
      if (sql[i] === '\\' && i + 1 < sql.length) {
        s += sql[i + 1];
        i += 2;
        continue;
      }
      if (sql[i] === "'") {
        if (sql[i + 1] === "'") {
          s += "'";
          i += 2;
          continue;
        }
        return { value: s, end: i + 1 };
      }
      s += sql[i++];
    }
  }
  if (sql[i] === '"') {
    i++;
    let s = '';
    while (i < sql.length && sql[i] !== '"') s += sql[i++];
    return { value: s, end: i + 1 };
  }
  let num = '';
  while (i < sql.length && sql[i] !== ',' && sql[i] !== ')' && sql[i] !== ' ') num += sql[i++];
  if (num === '') return { value: null, end: i };
  const n = Number(num);
  return { value: Number.isNaN(n) ? num : n, end: i };
}

export function rowToObject(columns: string[], values: unknown[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  columns.forEach((c, idx) => {
    row[c] = values[idx];
  });
  return row;
}

export function rowKey(row: Record<string, unknown>, keys: string[]): string {
  return keys.map((k) => JSON.stringify(row[k])).join('|');
}

export function escapeId(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`';
}

export function buildInsert(table: string, row: Record<string, unknown>): string {
  const cols = Object.keys(row);
  const values = cols.map((c) => {
    const v = row[c];
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    if (typeof v === 'boolean') return v ? '1' : '0';
    return `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  });
  return `INSERT INTO ${escapeId(table)} (${cols.map(escapeId).join(', ')}) VALUES (${values.join(', ')});`;
}
