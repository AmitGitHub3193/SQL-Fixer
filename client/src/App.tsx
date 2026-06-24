import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchOverview,
  uploadSqlFileWithProgress,
  clearSqlFile,
  fetchTablePreview,
  startJob,
  subscribeJob,
  endpoints,
} from './api';
import type {
  DbSide,
  DatabaseSummary,
  JobState,
  MissingDataGroup,
  SchemaDiffItem,
  SyncDirection,
  TableComparisonRow,
  TablePreview,
} from './types';
import { formatBytes } from './types';
import { SchemaComparePanel } from './SchemaComparePanel';
import { MissingTablesSplit } from './MissingTablesSplit';
import { ExportPdfButton } from './ExportPdfButton';
import type { SummaryPdfInput } from './exportSummaryPdf';
import { WorkflowCards } from './WorkflowCards';
import { MissingRowsPanel } from './MissingRowsPanel';
import { MissingTablesFixPanel } from './MissingTablesFixPanel';
import { SqlOutputPanel, type SqlFixOutput } from './SqlOutputPanel';
import { directionLabels } from './directionUtils';
import { ToastContainer, toast } from './toast';
import { combineProgress, estimateEta, formatBytes as formatFileBytes } from './progressUtils';
import { downloadTextFile } from './downloadFile';

type Tab = 'overview' | 'missing-tables' | 'missing-rows' | 'schema' | 'preview' | 'sql';

function FileImportCard({
  side,
  label,
  fileName,
  summary,
  busy,
  onImport,
  onClear,
  onInvalidFile,
}: {
  side: DbSide;
  label: string;
  fileName: string | null;
  summary: DatabaseSummary | null;
  busy: boolean;
  onImport: (file: File) => void;
  onClear: () => void;
  onInvalidFile: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className={`conn-block ${side}`}>
      <h3>
        <span className={`status-dot ${summary?.ok ? 'ok' : 'off'}`} />
        {label}
      </h3>
      <div
        className="import-zone"
        onClick={() => !busy && inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files[0];
          if (f?.name.toLowerCase().endsWith('.sql') && !busy) onImport(f);
          else if (f) onInvalidFile('Only .sql files are allowed');
        }}
      >
        {fileName ? (
          <>
            <strong>{fileName}</strong>
            <p style={{ marginTop: '0.35rem', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              {summary?.tableCount ?? 0} tables · {(summary?.totalRows ?? 0).toLocaleString()} rows
            </p>
          </>
        ) : (
          <>Drop .sql file or click to browse</>
        )}
      </div>
      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        accept=".sql"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onImport(f);
          e.target.value = '';
        }}
      />
      {fileName && (
        <div className="btn-row" style={{ marginTop: '0.5rem' }}>
          <button type="button" className="btn btn-sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            Replace file
          </button>
          <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={onClear}>
            Remove
          </button>
        </div>
      )}
    </div>
  );
}

function DbStatCard({ db, label }: { db: DatabaseSummary; label: string }) {
  return (
    <div className={`db-stat-card ${db.side}`}>
      <div className="db-stat-header">
        <span className={`status-dot ${db.ok ? 'ok' : 'off'}`} />
        <strong>{label}</strong>
      </div>
      <p className="db-stat-host">{db.host}</p>
      {!db.ok && <p className="db-stat-error">{db.message}</p>}
      {db.ok && (
        <div className="db-stat-grid">
          <div><span>{db.tableCount}</span> tables</div>
          <div><span>{db.totalRows.toLocaleString()}</span> rows</div>
          <div><span>{formatBytes(db.totalSize)}</span> parsed</div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [overview, setOverview] = useState<{ local: DatabaseSummary; live: DatabaseSummary; comparison: TableComparisonRow[] } | null>(null);
  const [localFile, setLocalFile] = useState<string | null>(null);
  const [liveFile, setLiveFile] = useState<string | null>(null);
  const [browseSide, setBrowseSide] = useState<DbSide>('local');
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState<SyncDirection>('local-to-live');
  const [tab, setTab] = useState<Tab>('overview');
  const [job, setJob] = useState<JobState | null>(null);
  const [schemaDiffs, setSchemaDiffs] = useState<SchemaDiffItem[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<Set<number>>(new Set());
  const [missingGroups, setMissingGroups] = useState<MissingDataGroup[]>([]);
  const [sqlOutputs, setSqlOutputs] = useState<SqlFixOutput[]>([]);
  const [previewTable, setPreviewTable] = useState<MissingDataGroup | null>(null);
  const [tablePreview, setTablePreview] = useState<TablePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [etaLabel, setEtaLabel] = useState('');
  const logEndRef = useRef<HTMLDivElement>(null);
  const progressStartRef = useRef(0);

  const loadOverview = useCallback(async () => {
    const data = await fetchOverview();
    if (data.ok) {
      setOverview({ local: data.local, live: data.live, comparison: data.comparison });
      if (data.local.ok) setLocalFile(data.local.host);
      if (data.live.ok) setLiveFile(data.live.host);
    }
  }, []);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [job?.logs.length]);

  useEffect(() => {
    if (!busy || !job || job.status !== 'running') {
      setEtaLabel('');
      return;
    }
    const tick = () => {
      setEtaLabel(estimateEta(job.progress ?? 0, progressStartRef.current));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [busy, job?.status, job?.progress]);

  const activeDb = overview ? overview[browseSide] : null;
  const browseTables = activeDb?.tables ?? [];
  const filteredTables = useMemo(() => {
    const q = search.toLowerCase();
    return browseTables.filter((t) => t.name.toLowerCase().includes(q));
  }, [browseTables, search]);
  const bothLoaded = overview?.local.ok && overview?.live.ok;

  const pdfInput = useMemo((): SummaryPdfInput | null => {
    if (!overview || !bothLoaded) return null;
    return {
      localFile,
      liveFile,
      local: overview.local,
      live: overview.live,
      comparison: overview.comparison,
      direction,
      schemaDiffs,
      missingGroups,
    };
  }, [overview, bothLoaded, localFile, liveFile, direction, schemaDiffs, missingGroups]);

  const missingTableCount = useMemo(() => {
    if (!overview) return 0;
    return overview.comparison.filter((r) =>
      direction === 'local-to-live' ? r.status === 'local_only' : r.status === 'live_only',
    ).length;
  }, [overview, direction]);

  const missingRowCount = useMemo(
    () => missingGroups.reduce((a, g) => a + g.count, 0),
    [missingGroups],
  );

  const addSqlOutputs = useCallback((outputs: SqlFixOutput[], replaceKind?: SqlFixOutput['kind']) => {
    setSqlOutputs((prev) => {
      const base = replaceKind ? prev.filter((o) => o.kind !== replaceKind) : prev;
      return [...base, ...outputs];
    });
    setTab('sql');
  }, []);

  const runJobForTables = useCallback(
    (
      endpoint: string,
      tables: string[],
      extra?: Record<string, unknown>,
      onDone?: (result: unknown) => void,
    ) => {
      if (!bothLoaded) {
        toast.error('Import both Local and Live .sql files first.');
        return;
      }
      progressStartRef.current = Date.now();
      setBusy(true);
      setJob({ id: '', type: endpoint, status: 'running', progress: 0, message: 'Starting…', logs: [] });
      try {
        const jobId = startJob(endpoint, { tables, direction, ...extra });
        jobId.then((id) => {
          subscribeJob(id, (j) => {
            setJob({
              ...j,
              progress: combineProgress(null, j.progress ?? 0, 'processing'),
            });
            if (j.status === 'completed') {
              setBusy(false);
              onDone?.(j.result);
            }
            if (j.status === 'failed') {
              setBusy(false);
              toast.error(j.error ?? 'Job failed');
            }
          });
        }).catch((e) => {
          setBusy(false);
          toast.error(e instanceof Error ? e.message : String(e));
        });
      } catch (e) {
        setBusy(false);
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [direction, bothLoaded],
  );

  const scanMissingRows = useCallback(() => {
    runJobForTables(endpoints.matchMissing, [], undefined, (r) => {
      const groups = r as MissingDataGroup[];
      setMissingGroups(groups);
      setTab('missing-rows');
      const total = groups.reduce((a, g) => a + g.count, 0);
      toast.info(total ? `Found ${total.toLocaleString()} missing row(s) across ${groups.length} table(s)` : 'No missing rows found');
    });
  }, [runJobForTables]);

  const compareSchema = useCallback(() => {
    runJobForTables(endpoints.compareSchema, [], undefined, (r) => {
      const diffs = r as SchemaDiffItem[];
      setSchemaDiffs(diffs);
      setSelectedSchema(new Set(diffs.map((_, i) => i)));
      setTab('schema');
    });
  }, [runJobForTables]);

  const generateMissingRowSql = useCallback(
    (tables: string[]) => {
      const { target } = directionLabels(direction);
      runJobForTables(endpoints.generateInserts, tables, undefined, (r) => {
        const groups = r as { table: string; sql: string; count: number }[];
        const outputs: SqlFixOutput[] = groups
          .filter((g) => g.sql)
          .map((g) => ({
            kind: 'missing-rows' as const,
            title: g.table,
            description: `INSERT statements to add missing rows to ${target}.`,
            sql: g.sql,
            table: g.table,
            count: g.count,
          }));
        if (outputs.length === 0) {
          toast.warn('No missing rows for the selected tables.');
          return;
        }
        addSqlOutputs(outputs, 'missing-rows');
        toast.success(`Generated INSERT SQL for ${outputs.length} table(s)`);
      });
    },
    [runJobForTables, direction, addSqlOutputs],
  );

  const generateMissingTablesSql = useCallback(
    (tables: string[]) => {
      const { target, source } = directionLabels(direction);
      runJobForTables(endpoints.generateMissingTables, tables, undefined, (r) => {
        const result = r as { sql: string; tables: string[]; skipped: string[] };
        if (!result.sql?.trim()) {
          const skipped = result.skipped?.length
            ? ` Skipped: ${result.skipped.join(', ')}`
            : '';
          toast.error(`No CREATE TABLE SQL could be generated.${skipped}`);
          return;
        }
        if (result.skipped?.length) {
          toast.warn(`Generated ${result.tables.length} table(s). Skipped: ${result.skipped.join(', ')}`);
        } else {
          toast.success(`Generated CREATE TABLE for ${result.tables.length} table(s)`);
        }
        addSqlOutputs(
          [
            {
              kind: 'missing-tables',
              title: `Create ${result.tables.length} missing table(s) on ${target}`,
              description: `CREATE TABLE statements from ${source}. Run on ${target} before inserting rows.`,
              sql: result.sql,
              count: result.tables.length,
            },
          ],
          'missing-tables',
        );
      });
    },
    [direction, runJobForTables, addSqlOutputs],
  );

  const downloadFixedDump = useCallback(() => {
    if (!bothLoaded) {
      toast.error('Import both Local and Live .sql files first.');
      return;
    }
    const { source, target } = directionLabels(direction);
    const ok = window.confirm(
      `Download a complete fixed database?\n\nThis merges fixes from ${source} onto ${target} into one import-ready .sql file (CREATE TABLE + data + indexes).`,
    );
    if (!ok) return;

    runJobForTables(endpoints.generateFixedDump, [], undefined, (r) => {
      const result = r as {
        sql: string;
        fileName: string;
        tableCount: number;
        rowCount: number;
        missingTablesAdded: number;
        missingRowsAdded: number;
      };
      if (!result.sql?.trim()) {
        toast.error('Could not build fixed database file.');
        return;
      }
      downloadTextFile(result.fileName, result.sql);
      toast.success(
        `Downloaded ${result.fileName} — ${result.tableCount} tables, ${result.rowCount.toLocaleString()} rows (+${result.missingTablesAdded} tables, +${result.missingRowsAdded} rows from source)`,
      );
      addSqlOutputs(
        [
          {
            kind: 'full',
            title: result.fileName,
            description: `Complete fixed database (${result.tableCount} tables, ${result.rowCount.toLocaleString()} rows). Merged ${source} fixes onto ${target}.`,
            sql: result.sql,
            count: result.rowCount,
          },
        ],
        'full',
      );
    });
  }, [bothLoaded, direction, runJobForTables, addSqlOutputs]);

  const handleUpload = async (side: DbSide, file: File) => {
    if (!file.name.toLowerCase().endsWith('.sql')) {
      toast.error('Only .sql files are allowed');
      return;
    }
    progressStartRef.current = Date.now();
    setBusy(true);
    setJob({
      id: '',
      type: 'import',
      status: 'running',
      progress: 0,
      message: `Uploading ${file.name}…`,
      logs: [],
    });
    try {
      const jobId = await uploadSqlFileWithProgress(side, file, (pct, loaded, total) => {
        setJob((j) =>
          j
            ? {
                ...j,
                status: 'running',
                progress: combineProgress(pct, 0, 'upload'),
                message: `Uploading ${file.name}… ${formatFileBytes(loaded)} / ${formatFileBytes(total)} (${pct}%)`,
              }
            : null,
        );
      });
      subscribeJob(jobId, (j) => {
        setJob({
          ...j,
          progress: combineProgress(100, j.progress ?? 0, 'processing'),
        });
        if (j.status === 'completed') {
          setBusy(false);
          if (side === 'local') setLocalFile(file.name);
          else setLiveFile(file.name);
          loadOverview();
          setTab('overview');
          toast.success(`${side === 'local' ? 'Local' : 'Live'} file imported: ${file.name}`);
        }
        if (j.status === 'failed') {
          setBusy(false);
          toast.error(j.error ?? `Failed to import ${file.name}`);
        }
      });
    } catch (e) {
      setBusy(false);
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const handleClear = async (side: DbSide) => {
    try {
      await clearSqlFile(side);
      if (side === 'local') setLocalFile(null);
      else setLiveFile(null);
      loadOverview();
      toast.info(`${side === 'local' ? 'Local' : 'Live'} file removed`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const openTablePreview = async (side: DbSide, name: string) => {
    setActiveTable(name);
    setTab('preview');
    setPreviewLoading(true);
    setTablePreview(null);
    try {
      const r = await fetchTablePreview(side, name);
      if (r.ok && r.preview) setTablePreview(r.preview);
      else toast.error(r.message ?? 'Could not load table preview');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <div className="app">
      <ToastContainer />
      <header className="header">
        <h1><span className="logo">⚡</span> SQL Fixer <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>Offline</span></h1>
        <div className="header-meta">
          <span><span className={`status-dot ${overview?.local.ok ? 'ok' : 'off'}`} /> Local file</span>
          <span><span className={`status-dot ${overview?.live.ok ? 'ok' : 'off'}`} /> Live file</span>
          <ExportPdfButton input={pdfInput} disabled={busy} className="btn btn-sm btn-pdf" label="PDF" title="Download full comparison report as PDF" />
          <button type="button" className="btn btn-sm btn-primary" onClick={loadOverview}>Refresh</button>
        </div>
      </header>

      <div className="main">
        <aside className="panel">
          <div className="panel-header">SQL files</div>
          <div className="panel-body">
            <FileImportCard
              side="local"
              label="Local SQL file"
              fileName={localFile}
              summary={overview?.local ?? null}
              busy={busy}
              onImport={(f) => handleUpload('local', f)}
              onClear={() => handleClear('local')}
              onInvalidFile={(msg) => toast.error(msg)}
            />
            <FileImportCard
              side="live"
              label="Live SQL file"
              fileName={liveFile}
              summary={overview?.live ?? null}
              busy={busy}
              onImport={(f) => handleUpload('live', f)}
              onClear={() => handleClear('live')}
              onInvalidFile={(msg) => toast.error(msg)}
            />

            <div className="panel-header" style={{ margin: '0 -1rem', marginTop: '0.75rem' }}>Tables</div>
            <div className="db-side-tabs">
              <button type="button" className={browseSide === 'local' ? 'active' : ''} onClick={() => setBrowseSide('local')}>Local</button>
              <button type="button" className={browseSide === 'live' ? 'active' : ''} onClick={() => setBrowseSide('live')}>Live</button>
            </div>
            <div className="table-list-toolbar">
              <input type="search" placeholder="Search tables..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="table-list">
              <div className="table-list-header cols-3"><span>Table</span><span>Rows</span><span>Size</span></div>
              {!activeDb?.ok ? (
                <div className="empty-state" style={{ padding: '1.5rem' }}>Import {browseSide} .sql file</div>
              ) : filteredTables.length === 0 ? (
                <div className="empty-state" style={{ padding: '1.5rem' }}>No tables in file</div>
              ) : (
                filteredTables.map((t) => (
                  <div key={t.name} className={`table-row cols-3 ${activeTable === t.name ? 'active-row' : ''}`}>
                    <button type="button" className="table-name-btn" onClick={() => openTablePreview(browseSide, t.name)}>{t.name}</button>
                    <span className="table-meta">{t.rowCount.toLocaleString()}</span>
                    <span className="table-meta">{formatBytes(t.dataLength)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        <section className="panel center-panel">
          <div className="toolbar">
            <div className="toolbar-row">
              <span className="toolbar-label">Sync direction (source → target):</span>
              <div className="direction-toggle">
                <button type="button" className={direction === 'local-to-live' ? 'active' : ''} onClick={() => setDirection('local-to-live')}>Local → Live</button>
                <button type="button" className={direction === 'live-to-local' ? 'active' : ''} onClick={() => setDirection('live-to-local')}>Live → Local</button>
              </div>
              <span className="toolbar-hint">Fixes copy from source file onto target file</span>
              <ExportPdfButton input={pdfInput} disabled={busy} className="btn btn-sm btn-pdf" label="Export PDF" />
            </div>
            <WorkflowCards
              bothLoaded={!!bothLoaded}
              busy={busy}
              missingTableCount={missingTableCount}
              missingRowCount={missingRowCount}
              schemaDiffCount={schemaDiffs.length}
              onFindMissingRows={scanMissingRows}
              onCompareSchema={compareSchema}
              onGoMissingTables={() => setTab('missing-tables')}
              onGoMissingRows={() => setTab('missing-rows')}
              onGoSchema={() => setTab('schema')}
              onDownloadFixedDump={downloadFixedDump}
            />
          </div>

          <div className="progress-section">
            <div className="progress-label">
              <span>{job?.message ?? (bothLoaded ? 'Import both files, then pick what to fix below' : 'Import both .sql files to begin')}</span>
              <span className="progress-meta">
                {etaLabel && job?.status === 'running' && <span className="progress-eta">{etaLabel}</span>}
                <span>{job ? `${Math.round(job.progress)}%` : '0%'}</span>
              </span>
            </div>
            <div className="progress-bar-wrap">
              <div
                className={`progress-bar-fill ${job?.status === 'running' ? 'running' : ''}`}
                style={{ width: `${job?.progress ?? 0}%` }}
              />
            </div>
          </div>

          <div className="tabs">
            {(['overview', 'missing-tables', 'missing-rows', 'schema', 'preview', 'sql'] as Tab[]).map((t) => (
              <button key={t} type="button" className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t === 'overview' && 'Overview'}
                {t === 'missing-tables' && `Missing tables (${missingTableCount})`}
                {t === 'missing-rows' && `Missing rows (${missingRowCount})`}
                {t === 'schema' && `Schema (${schemaDiffs.length})`}
                {t === 'preview' && 'Table preview'}
                {t === 'sql' && `SQL (${sqlOutputs.length})`}
              </button>
            ))}
          </div>

          <div className="tab-content">
            {tab === 'overview' && (
              overview ? (
                <>
                  <div className="db-stat-row">
                    <DbStatCard db={overview.local} label="Local SQL file" />
                    <DbStatCard db={overview.live} label="Live SQL file" />
                  </div>
                  {!bothLoaded && <p className="section-desc">Import both .sql files to enable comparison.</p>}
                  {bothLoaded && overview.comparison.length > 0 && (
                    <MissingTablesSplit comparison={overview.comparison} />
                  )}
                </>
              ) : <div className="empty-state">Loading...</div>
            )}

            {tab === 'missing-tables' && overview && bothLoaded && (
              <MissingTablesFixPanel
                comparison={overview.comparison}
                direction={direction}
                busy={busy}
                onGenerateCreateTables={generateMissingTablesSql}
              />
            )}

            {tab === 'missing-rows' && (
              <MissingRowsPanel
                groups={missingGroups}
                direction={direction}
                busy={busy}
                pdfInput={pdfInput}
                onScan={scanMissingRows}
                onGenerateInserts={generateMissingRowSql}
                onPreview={setPreviewTable}
              />
            )}

            {tab === 'schema' && (
              schemaDiffs.length === 0 ? (
                <div className="fix-panel">
                  <div className="fix-banner fix-banner-schema">
                    <h3>Schema differences — columns &amp; structure</h3>
                    <p>Compare column definitions between files. Use this only when tables exist in both files but columns differ.</p>
                  </div>
                  <button type="button" className="btn btn-primary btn-lg" disabled={busy || !bothLoaded} onClick={compareSchema}>
                    Compare schema
                  </button>
                </div>
              ) : (
                <>
                  <div className="export-toolbar">
                    <p className="export-toolbar-text">Schema fixes change columns — separate from missing rows or missing tables.</p>
                    <ExportPdfButton input={pdfInput} disabled={busy} label="Export PDF" />
                  </div>
                <SchemaComparePanel
                  diffs={schemaDiffs}
                  allTables={overview?.comparison.map((c) => c.name) ?? []}
                  comparison={overview?.comparison ?? []}
                  direction={direction}
                  selectedIndices={selectedSchema}
                  onSelectionChange={setSelectedSchema}
                  onGenerateSql={(sql) => {
                    addSqlOutputs(
                      [
                        {
                          kind: 'schema',
                          title: 'Schema fix script',
                          description: 'ALTER TABLE statements for selected schema differences.',
                          sql,
                          count: schemaDiffs.filter((_, i) => selectedSchema.has(i)).length,
                        },
                      ],
                      'schema',
                    );
                  }}
                />
                </>
              )
            )}

            {tab === 'sql' && (
              <SqlOutputPanel outputs={sqlOutputs} onClear={() => setSqlOutputs([])} />
            )}

            {tab === 'preview' && (
              previewLoading ? <div className="empty-state">Loading preview...</div> :
              !tablePreview ? <div className="empty-state">Click a table name in the sidebar or Overview to preview its structure and sample rows.</div> :
              <div className="table-preview-panel">
                <div className="preview-header"><h3>{tablePreview.name}</h3><span className="badge badge-schema">{tablePreview.side === 'local' ? 'Local SQL file' : 'Live SQL file'}</span></div>
                <div className="preview-stats"><span>{tablePreview.rowCount.toLocaleString()} rows</span><span>{tablePreview.columns.length} columns</span></div>
                <h4 className="preview-subtitle">Columns</h4>
                <div className="comparison-table-wrap">
                  <table className="comparison-table">
                    <thead><tr><th>Name</th><th>Type</th><th>Key</th></tr></thead>
                    <tbody>{tablePreview.columns.map((c) => <tr key={c.name}><td className="mono">{c.name}</td><td>{c.type}</td><td>{c.key || '—'}</td></tr>)}</tbody>
                  </table>
                </div>
                <h4 className="preview-subtitle">Sample rows</h4>
                <div className="row-preview wide"><pre>{JSON.stringify(tablePreview.sampleRows, null, 2)}</pre></div>
                {tablePreview.createTable && <><h4 className="preview-subtitle">CREATE TABLE</h4><div className="sql-output">{tablePreview.createTable}</div></>}
              </div>
            )}

          </div>
        </section>

        <aside className="panel log-panel">
          <div className="panel-header">Live logs<button type="button" className="btn btn-sm" onClick={() => setJob((j) => (j ? { ...j, logs: [] } : null))}>Clear</button></div>
          <div className="log-list">
            {!job?.logs.length ? <div className="empty-state" style={{ padding: '2rem 0' }}>Parse & compare logs appear here</div> :
            job.logs.map((l, i) => <div key={i} className={`log-entry log-${l.level}`}><span className="log-time">{new Date(l.time).toLocaleTimeString()}</span>{l.message}</div>)}
            <div ref={logEndRef} />
          </div>
        </aside>
      </div>

      {previewTable && (
        <div className="modal-overlay" onClick={() => setPreviewTable(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header"><h3>Missing rows: {previewTable.table}</h3><button type="button" className="btn btn-sm" onClick={() => setPreviewTable(null)}>Close</button></div>
            <div className="modal-body"><div className="row-preview"><pre>{JSON.stringify(previewTable.rows, null, 2)}</pre></div></div>
          </div>
        </div>
      )}
    </div>
  );
}
