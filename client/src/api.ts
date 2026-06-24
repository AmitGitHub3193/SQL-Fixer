import type { DbSide, JobState, SchemaDiffItem, SyncDirection, TablePreview, DatabaseSummary, TableComparisonRow } from './types';

const API = '/api';

export interface DatabasesOverview {
  local: DatabaseSummary;
  live: DatabaseSummary;
  comparison: TableComparisonRow[];
}

export interface FileStatus {
  fileName: string;
  tables: number;
  rows: number;
  size: number;
}

export async function fetchOverview(): Promise<DatabasesOverview & { ok: boolean }> {
  const res = await fetch(`${API}/overview`);
  return res.json();
}

export async function fetchFileStatus(): Promise<{ local: FileStatus | null; live: FileStatus | null }> {
  const res = await fetch(`${API}/files/status`);
  return res.json();
}

export async function uploadSqlFile(side: DbSide, file: File): Promise<string> {
  return uploadSqlFileWithProgress(side, file);
}

export function uploadSqlFileWithProgress(
  side: DbSide,
  file: File,
  onProgress?: (pct: number, loaded: number, total: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100), e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText) as { jobId?: string; error?: string };
        if (xhr.status >= 200 && xhr.status < 300 && data.jobId) {
          resolve(data.jobId);
          return;
        }
        reject(new Error(data.error || `Upload failed (${xhr.status})`));
      } catch {
        reject(new Error(`Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.onabort = () => reject(new Error('Upload cancelled'));
    xhr.open('POST', `${API}/files/${side}`);
    xhr.send(fd);
  });
}

export async function clearSqlFile(side: DbSide) {
  await fetch(`${API}/files/${side}`, { method: 'DELETE' });
}

export async function fetchTablePreview(side: DbSide, name: string) {
  const res = await fetch(`${API}/table/${side}/${encodeURIComponent(name)}/preview`);
  return res.json() as Promise<{ ok: boolean; preview?: TablePreview; message?: string }>;
}

export async function startJob(endpoint: string, body: unknown): Promise<string> {
  const res = await fetch(`${API}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.jobId && !data.ok) throw new Error(data.error || data.message || 'Request failed');
  return data.jobId;
}

export function subscribeJob(jobId: string, onUpdate: (job: JobState) => void): () => void {
  const es = new EventSource(`${API}/jobs/${jobId}/stream`);
  es.onmessage = (e) => {
    try {
      onUpdate(JSON.parse(e.data));
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => es.close();
  return () => es.close();
}

export async function generateSchemaFixSql(items: SchemaDiffItem[]): Promise<string> {
  const res = await fetch(`${API}/generate/schema-fix`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  });
  const data = await res.json();
  return data.sql ?? '';
}

export const endpoints = {
  compareSchema: '/compare/schema',
  matchMissing: '/match/missing',
  generateInserts: '/generate/inserts',
  generateMissingTables: '/generate/missing-tables',
  generateFullFix: '/generate/full-fix',
  generateFixedDump: '/generate/fixed-dump',
} as const;

export type { SyncDirection };
