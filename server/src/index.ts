import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { createJob, getJob, subscribeJob, jobEmitter, completeJob, failJob, updateJob } from './jobs.js';
import { parseSqlDumpFile } from './services/offlineDump.js';
import {
  buildOverview,
  compareSchemaOffline,
  findMissingDataOffline,
  generateInsertsOffline,
  generateSchemaFixSql,
  generateCreateTablesOffline,
  buildFixedDumpSql,
  generateFullFixSql,
  getTablePreviewOffline,
} from './services/offlineCompare.js';
import { getDump, getDumps, setDump, clearDump } from './store.js';
import type { DbSide, SyncDirection } from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 200 * 1024 * 1024 } });

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

function runAsync(jobId: string, fn: () => Promise<unknown>) {
  updateJob(jobId, { status: 'running' });
  fn()
    .then((result) => completeJob(jobId, result))
    .catch((e) => failJob(jobId, e instanceof Error ? e.message : String(e)));
}

app.get('/api/overview', (_req, res) => {
  const { local, live } = getDumps();
  res.json({ ok: true, ...buildOverview(local, live) });
});

app.get('/api/files/status', (_req, res) => {
  const { local, live } = getDumps();
  res.json({
    local: local ? { fileName: local.fileName, tables: local.tableCount, rows: local.totalRows, size: local.fileSize } : null,
    live: live ? { fileName: live.fileName, tables: live.tableCount, rows: live.totalRows, size: live.fileSize } : null,
  });
});

app.delete('/api/files/:side', (req, res) => {
  const side = req.params.side as DbSide;
  if (side !== 'local' && side !== 'live') return res.status(400).json({ error: 'Invalid side' });
  clearDump(side);
  res.json({ ok: true });
});

app.post('/api/files/:side', upload.single('file'), (req, res) => {
  const side = req.params.side as DbSide;
  if (side !== 'local' && side !== 'live') {
    res.status(400).json({ error: 'Invalid side' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  if (!req.file.originalname.toLowerCase().endsWith('.sql')) {
    res.status(400).json({ error: 'Only .sql files are allowed' });
    return;
  }

  const job = createJob(`import-${side}`);
  res.json({ jobId: job.id, side });

  const emit = jobEmitter(job.id);
  updateJob(job.id, {
    status: 'running',
    progress: 2,
    message: `Received ${req.file.originalname}, parsing…`,
  });
  emit.log('info', `Importing ${side} file: ${req.file.originalname} (${(req.file.size / 1024).toFixed(1)} KB)`);

  runAsync(job.id, async () => {
    const sql = req.file!.buffer.toString('utf8');
    const dump = await parseSqlDumpFile(sql, req.file!.originalname, side, emit);
    setDump(side, dump);
    emit.log('success', `${side} file ready: ${dump.tableCount} tables, ${dump.totalRows.toLocaleString()} rows`);
    return { ok: true, side, dump: { fileName: dump.fileName, databaseName: dump.databaseName, tableCount: dump.tableCount, totalRows: dump.totalRows } };
  });
});

app.get('/api/table/:side/:name/preview', (req, res) => {
  try {
    const side = req.params.side as DbSide;
    const dump = getDump(side);
    const preview = getTablePreviewOffline(dump, req.params.name, side);
    res.json({ ok: true, preview });
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

app.get('/api/jobs/:id/stream', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (j: typeof job) => res.write(`data: ${JSON.stringify(j)}\n\n`);
  send(job);
  const unsub = subscribeJob(req.params.id, send);
  req.on('close', unsub);
});

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json(job);
});

app.post('/api/compare/schema', (req, res) => {
  const { tables, direction } = req.body as { tables: string[]; direction: SyncDirection };
  const { local, live } = getDumps();
  const job = createJob('compare-schema');
  res.json({ jobId: job.id });
  runAsync(job.id, async () => compareSchemaOffline(local, live, tables, direction, jobEmitter(job.id)));
});

app.post('/api/match/missing', (req, res) => {
  const { tables, direction } = req.body;
  const { local, live } = getDumps();
  const job = createJob('match-missing');
  res.json({ jobId: job.id });
  runAsync(job.id, async () => findMissingDataOffline(local, live, tables, direction, jobEmitter(job.id)));
});

app.post('/api/generate/inserts', (req, res) => {
  const { tables, direction } = req.body;
  const { local, live } = getDumps();
  const job = createJob('generate-inserts');
  res.json({ jobId: job.id });
  runAsync(job.id, async () => generateInsertsOffline(local, live, tables, direction, jobEmitter(job.id)));
});

app.post('/api/generate/missing-tables', (req, res) => {
  const { tables, direction } = req.body;
  const { local, live } = getDumps();
  const job = createJob('generate-missing-tables');
  res.json({ jobId: job.id });
  runAsync(job.id, async () => generateCreateTablesOffline(local, live, tables ?? [], direction, jobEmitter(job.id)));
});

app.post('/api/generate/schema-fix', (req, res) => {
  const { items } = req.body;
  res.json({ ok: true, sql: generateSchemaFixSql(items) });
});

app.post('/api/generate/full-fix', (req, res) => {
  const { tables, direction, items } = req.body;
  const { local, live } = getDumps();
  const job = createJob('generate-full-fix');
  res.json({ jobId: job.id });
  runAsync(job.id, async () => {
    const sql = generateFullFixSql(local, live, tables, direction, items ?? [], jobEmitter(job.id));
    return { sql };
  });
});

app.post('/api/generate/fixed-dump', (req, res) => {
  const { direction } = req.body as { direction: SyncDirection };
  const { local, live } = getDumps();
  const job = createJob('generate-fixed-dump');
  res.json({ jobId: job.id });
  runAsync(job.id, async () => buildFixedDumpSql(local, live, direction, jobEmitter(job.id)));
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Client not built. Run npm run dev from root.');
  });
});

const PORT = process.env.PORT || 3847;
app.listen(PORT, () => {
  console.log(`SQL Fixer (offline mode) running on http://localhost:${PORT}`);
});
