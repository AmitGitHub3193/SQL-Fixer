interface WorkflowCardsProps {
  bothLoaded: boolean;
  busy: boolean;
  missingTableCount: number;
  missingRowCount: number;
  schemaDiffCount: number;
  onFindMissingRows: () => void;
  onCompareSchema: () => void;
  onGoMissingTables: () => void;
  onGoMissingRows: () => void;
  onGoSchema: () => void;
  onDownloadFixedDump: () => void;
}

export function WorkflowCards({
  bothLoaded,
  busy,
  missingTableCount,
  missingRowCount,
  schemaDiffCount,
  onFindMissingRows,
  onCompareSchema,
  onGoMissingTables,
  onGoMissingRows,
  onGoSchema,
  onDownloadFixedDump,
}: WorkflowCardsProps) {
  if (!bothLoaded) return null;

  return (
    <div className="workflow-section">
      <p className="workflow-heading">What do you want to fix?</p>
      <div className="workflow-grid">
        <div className="workflow-card workflow-card-tables">
          <div className="workflow-card-top">
            <span className="workflow-step">1</span>
            <div>
              <h4>Missing tables</h4>
              <p>Whole tables that exist in one file but not the other.</p>
            </div>
          </div>
          <p className="workflow-stat">
            {missingTableCount === 0 ? (
              <span className="workflow-ok">None found</span>
            ) : (
              <strong>{missingTableCount}</strong>
            )}
            {missingTableCount !== 0 && ' table(s) to create'}
          </p>
          <div className="workflow-actions">
            <button type="button" className="btn btn-sm" disabled={busy || missingTableCount === 0} onClick={onGoMissingTables}>
              View &amp; fix
            </button>
          </div>
        </div>

        <div className="workflow-card workflow-card-rows">
          <div className="workflow-card-top">
            <span className="workflow-step">2</span>
            <div>
              <h4>Missing rows</h4>
              <p>Data rows in the source file that the target file does not have.</p>
            </div>
          </div>
          <p className="workflow-stat">
            {missingRowCount === 0 ? (
              <span className="workflow-muted">Scan to find rows</span>
            ) : (
              <>
                <strong>{missingRowCount.toLocaleString()}</strong> missing row(s)
              </>
            )}
          </p>
          <div className="workflow-actions">
            <button type="button" className="btn btn-sm btn-purple" disabled={busy} onClick={onFindMissingRows}>
              {missingRowCount === 0 ? 'Scan for missing rows' : 'Re-scan'}
            </button>
            <button type="button" className="btn btn-sm btn-warn" disabled={busy || missingRowCount === 0} onClick={onGoMissingRows}>
              Fix missing rows
            </button>
          </div>
        </div>

        <div className="workflow-card workflow-card-schema">
          <div className="workflow-card-top">
            <span className="workflow-step">3</span>
            <div>
              <h4>Schema differences</h4>
              <p>Column type changes, missing columns, etc.</p>
            </div>
          </div>
          <p className="workflow-stat">
            {schemaDiffCount === 0 ? (
              <span className="workflow-muted">Run compare first</span>
            ) : (
              <>
                <strong>{schemaDiffCount}</strong> schema item(s)
              </>
            )}
          </p>
          <div className="workflow-actions">
            <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={onCompareSchema}>
              {schemaDiffCount === 0 ? 'Compare schema' : 'Re-compare'}
            </button>
            <button type="button" className="btn btn-sm" disabled={busy || schemaDiffCount === 0} onClick={onGoSchema}>
              View &amp; fix
            </button>
          </div>
        </div>
      </div>

      <div className="workflow-download">
        <div>
          <h4>Download complete fixed database</h4>
          <p>
            One import-ready <code>.sql</code> file: target tables + missing tables + missing rows merged together.
          </p>
        </div>
        <button type="button" className="btn btn-primary btn-lg" disabled={busy} onClick={onDownloadFixedDump}>
          Download fixed .sql file
        </button>
      </div>
    </div>
  );
}
