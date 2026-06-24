import { useEffect, useMemo, useState } from 'react';
import type { MissingDataGroup, SyncDirection } from './types';
import { directionLabels } from './directionUtils';
import { ExportPdfButton } from './ExportPdfButton';
import type { SummaryPdfInput } from './exportSummaryPdf';

interface MissingRowsPanelProps {
  groups: MissingDataGroup[];
  direction: SyncDirection;
  busy: boolean;
  pdfInput: SummaryPdfInput | null;
  onScan: () => void;
  onGenerateInserts: (tables: string[]) => void;
  onPreview: (group: MissingDataGroup) => void;
}

export function MissingRowsPanel({
  groups,
  direction,
  busy,
  pdfInput,
  onScan,
  onGenerateInserts,
  onPreview,
}: MissingRowsPanelProps) {
  const { source, target } = directionLabels(direction);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(groups.map((g) => g.table)));

  useEffect(() => {
    setSelected(new Set(groups.map((g) => g.table)));
  }, [groups]);

  const selectedGroups = useMemo(
    () => groups.filter((g) => selected.has(g.table)),
    [groups, selected],
  );
  const selectedRowCount = selectedGroups.reduce((a, g) => a + g.count, 0);

  const toggle = (table: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(table)) next.delete(table);
      else next.add(table);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === groups.length) setSelected(new Set());
    else setSelected(new Set(groups.map((g) => g.table)));
  };

  if (groups.length === 0) {
    return (
      <div className="fix-panel">
        <div className="fix-banner fix-banner-rows">
          <h3>Fix missing rows only</h3>
          <p>
            Finds rows in <strong>{source}</strong> that are not in <strong>{target}</strong>, then generates{' '}
            <code>INSERT</code> statements — no schema changes, no extra tables.
          </p>
        </div>
        <div className="fix-steps">
          <div className="fix-step">
            <span className="fix-step-num">1</span>
            <div>
              <strong>Scan</strong> — compare row data between files
            </div>
          </div>
          <div className="fix-step">
            <span className="fix-step-num">2</span>
            <div>
              <strong>Review</strong> — see which tables have missing rows
            </div>
          </div>
          <div className="fix-step">
            <span className="fix-step-num">3</span>
            <div>
              <strong>Generate INSERT SQL</strong> — copy and run on your live database
            </div>
          </div>
        </div>
        <button type="button" className="btn btn-purple btn-lg" disabled={busy} onClick={onScan}>
          Scan for missing rows
        </button>
      </div>
    );
  }

  return (
    <div className="fix-panel">
      <div className="fix-banner fix-banner-rows fix-banner-with-actions">
        <h3>Missing rows — fix data only</h3>
        <p>
          <strong>{groups.reduce((a, g) => a + g.count, 0).toLocaleString()}</strong> row(s) in{' '}
          <strong>{source}</strong> are missing from <strong>{target}</strong>. This generates INSERT statements
          only — it does not change table structure.
        </p>
        <ExportPdfButton input={pdfInput} disabled={busy} className="btn btn-sm btn-pdf" label="Export PDF" />
      </div>

      <div className="fix-action-bar">
        <button type="button" className="btn btn-sm" disabled={busy} onClick={onScan}>
          Re-scan
        </button>
        <button type="button" className="btn btn-sm" onClick={toggleAll}>
          {selected.size === groups.length ? 'Deselect all' : 'Select all'}
        </button>
        <button
          type="button"
          className="btn btn-warn btn-lg"
          disabled={busy || selected.size === 0}
          onClick={() => onGenerateInserts([...selected])}
        >
          Generate INSERT SQL for {selectedRowCount.toLocaleString()} missing row(s)
        </button>
      </div>

      <div className="missing-rows-list">
        <div className="missing-rows-header">
          <span />
          <span>Table</span>
          <span>Missing rows</span>
          <span>Action</span>
        </div>
        {groups.map((g) => (
          <div key={g.table} className={`missing-rows-row ${selected.has(g.table) ? 'selected' : ''}`}>
            <input type="checkbox" checked={selected.has(g.table)} onChange={() => toggle(g.table)} />
            <span className="mono">{g.table}</span>
            <span className="missing-rows-count">{g.count.toLocaleString()}</span>
            <div className="btn-row">
              <button type="button" className="btn btn-sm" onClick={() => onPreview(g)}>
                Preview
              </button>
              <button
                type="button"
                className="btn btn-sm btn-warn"
                disabled={busy}
                onClick={() => onGenerateInserts([g.table])}
              >
                Fix this table
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
