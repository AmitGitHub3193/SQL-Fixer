import { useMemo } from 'react';
import type { SyncDirection, TableComparisonRow } from './types';
import { directionLabels } from './directionUtils';

interface MissingTablesFixPanelProps {
  comparison: TableComparisonRow[];
  direction: SyncDirection;
  busy: boolean;
  onGenerateCreateTables: (tables: string[]) => void;
}

export function MissingTablesFixPanel({
  comparison,
  direction,
  busy,
  onGenerateCreateTables,
}: MissingTablesFixPanelProps) {
  const { source, target } = directionLabels(direction);

  const missingOnTarget = useMemo(() => {
    return comparison.filter((r) =>
      direction === 'local-to-live' ? r.status === 'local_only' : r.status === 'live_only',
    );
  }, [comparison, direction]);

  const extraOnTarget = useMemo(() => {
    return comparison.filter((r) =>
      direction === 'local-to-live' ? r.status === 'live_only' : r.status === 'local_only',
    );
  }, [comparison, direction]);

  return (
    <div className="fix-panel">
      <div className="fix-banner fix-banner-tables">
        <h3>Missing tables — create tables only</h3>
        <p>
          These tables exist in <strong>{source}</strong> but not in <strong>{target}</strong>. Generate{' '}
          <code>CREATE TABLE</code> SQL to add them — no row data, no column changes on existing tables.
        </p>
      </div>

      {missingOnTarget.length === 0 ? (
        <div className="fix-empty">
          <p className="workflow-ok">No missing tables in this direction.</p>
          <p className="section-desc">
            Every table in {source} also exists in {target}.
          </p>
        </div>
      ) : (
        <>
          <div className="fix-action-bar">
            <button
              type="button"
              className="btn btn-success btn-lg"
              disabled={busy}
              onClick={() => onGenerateCreateTables(missingOnTarget.map((r) => r.name))}
            >
              Generate CREATE TABLE for {missingOnTarget.length} table(s)
            </button>
          </div>

          <div className="missing-rows-list">
            <div className="missing-rows-header cols-3">
              <span>Table</span>
              <span>Rows in {source}</span>
              <span>Status</span>
            </div>
            {missingOnTarget.map((r) => (
              <div key={r.name} className="missing-rows-row cols-3">
                <span className="mono">{r.name}</span>
                <span>{(r.local?.rowCount ?? r.live?.rowCount ?? 0).toLocaleString()}</span>
                <span className="status-pill status-local_only">Missing on {target}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {extraOnTarget.length > 0 && (
        <div className="fix-note">
          <strong>Note:</strong> {extraOnTarget.length} table(s) exist only in {target} ({extraOnTarget.map((r) => r.name).slice(0, 3).join(', ')}
          {extraOnTarget.length > 3 ? '…' : ''}). These are not created automatically — switch direction if you want to copy them the other way.
        </div>
      )}
    </div>
  );
}
