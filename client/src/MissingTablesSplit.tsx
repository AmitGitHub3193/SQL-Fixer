import type { TableComparisonRow } from './types';

export function MissingTablesSplit({ comparison }: { comparison: TableComparisonRow[] }) {
  const localOnly = comparison.filter((r) => r.status === 'local_only');
  const liveOnly = comparison.filter((r) => r.status === 'live_only');
  const onBoth = comparison.filter((r) => r.status === 'both');

  return (
    <div className="missing-split-section">
      <h3 className="section-title">Where tables exist</h3>
      <p className="section-desc">
        Side-by-side view — no clicking needed. <strong>Cyan</strong> = only in Local file.
        <strong style={{ color: 'var(--warn)', marginLeft: '0.5rem' }}>Amber</strong> = only in Live file.
        <strong style={{ color: 'var(--success)', marginLeft: '0.5rem' }}>Green</strong> = in both files ({onBoth.length}).
      </p>
      <div className="missing-split-grid">
        <div className="missing-split-col local-col">
          <div className="missing-split-header">
            <span className="status-dot ok" style={{ background: 'var(--cyan)', boxShadow: '0 0 8px var(--cyan)' }} />
            <strong>Only in Local SQL file</strong>
            <span className="missing-count-badge">{localOnly.length}</span>
          </div>
          <p className="missing-split-hint">These tables are <strong>missing from your Live file</strong>.</p>
          {localOnly.length === 0 ? (
            <p className="missing-empty">None — every Local table also exists in Live file.</p>
          ) : (
            <ul className="missing-table-list">
              {localOnly.map((r) => (
                <li key={r.name}>
                  <span className="mono">{r.name}</span>
                  {r.local && <span className="missing-row-meta">{r.local.rowCount.toLocaleString()} rows</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="missing-split-col live-col">
          <div className="missing-split-header">
            <span className="status-dot ok" style={{ background: 'var(--warn)', boxShadow: '0 0 8px var(--warn)' }} />
            <strong>Only in Live SQL file</strong>
            <span className="missing-count-badge">{liveOnly.length}</span>
          </div>
          <p className="missing-split-hint">These tables are <strong>missing from your Local file</strong>.</p>
          {liveOnly.length === 0 ? (
            <p className="missing-empty">None — every Live table also exists in Local file.</p>
          ) : (
            <ul className="missing-table-list">
              {liveOnly.map((r) => (
                <li key={r.name}>
                  <span className="mono">{r.name}</span>
                  {r.live && <span className="missing-row-meta">{r.live.rowCount.toLocaleString()} rows</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="comparison-table-wrap" style={{ marginTop: '1rem' }}>
        <table className="comparison-table">
          <thead>
            <tr>
              <th>Table</th>
              <th>In Local file?</th>
              <th>In Live file?</th>
              <th>Local rows</th>
              <th>Live rows</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {comparison.map((row) => (
              <tr key={row.name} className={row.status !== 'both' ? 'selected-row' : ''}>
                <td className="mono">{row.name}</td>
                <td>{row.local ? '✓ Yes' : '✗ No'}</td>
                <td>{row.live ? '✓ Yes' : '✗ No'}</td>
                <td>{row.local ? row.local.rowCount.toLocaleString() : '—'}</td>
                <td>{row.live ? row.live.rowCount.toLocaleString() : '—'}</td>
                <td>
                  {row.status === 'both' && <span className="status-pill status-both">In both files</span>}
                  {row.status === 'local_only' && <span className="status-pill status-local_only">Missing on Live</span>}
                  {row.status === 'live_only' && <span className="status-pill status-live_only">Missing on Local</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
