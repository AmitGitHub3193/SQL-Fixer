export type SqlFixKind = 'missing-rows' | 'missing-tables' | 'schema' | 'full';

export interface SqlFixOutput {
  kind: SqlFixKind;
  title: string;
  description: string;
  sql: string;
  table?: string;
  count?: number;
}

import { downloadTextFile } from './downloadFile';
import { toast } from './toast';

interface SqlOutputPanelProps {
  outputs: SqlFixOutput[];
  onClear: () => void;
}

const KIND_LABELS: Record<SqlFixKind, string> = {
  'missing-rows': 'Missing rows',
  'missing-tables': 'Missing tables',
  schema: 'Schema',
  full: 'Full fix',
};

export function SqlOutputPanel({ outputs, onClear }: SqlOutputPanelProps) {
  if (outputs.length === 0) {
    return (
      <div className="fix-panel">
        <div className="fix-banner">
          <h3>Generated SQL</h3>
          <p>SQL you generate will appear here, grouped by type. Use the fix tabs to create INSERT or CREATE TABLE scripts.</p>
        </div>
        <div className="fix-steps">
          <div className="fix-step">
            <span className="fix-step-num">1</span>
            <div>
              <strong>Missing tables</strong> tab → CREATE TABLE only
            </div>
          </div>
          <div className="fix-step">
            <span className="fix-step-num">2</span>
            <div>
              <strong>Missing rows</strong> tab → INSERT only
            </div>
          </div>
          <div className="fix-step">
            <span className="fix-step-num">3</span>
            <div>
              <strong>Schema</strong> tab → ALTER TABLE / column fixes
            </div>
          </div>
        </div>
      </div>
    );
  }

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('SQL copied to clipboard'),
      () => toast.error('Could not copy to clipboard'),
    );
  };

  const download = (out: SqlFixOutput) => {
    const safeName = out.title.replace(/[^\w.-]+/g, '_').slice(0, 80);
    const fileName = out.kind === 'full' ? safeName : `${out.kind}-${safeName}.sql`;
    downloadTextFile(fileName, out.sql);
    toast.success(`Downloaded ${fileName.endsWith('.sql') ? fileName : `${fileName}.sql`}`);
  };

  return (
    <div className="sql-output-panel">
      <div className="fix-action-bar">
        <p className="section-desc" style={{ margin: 0, flex: 1 }}>
          {outputs.length} script(s) ready — copy and run on your database.
        </p>
        <button type="button" className="btn btn-sm btn-danger" onClick={onClear}>
          Clear all
        </button>
      </div>

      {outputs.map((out, i) => (
        <div key={`${out.kind}-${out.table ?? i}`} className={`diff-card sql-card sql-card-${out.kind}`}>
          <div className="diff-card-header">
            <div>
              <span className={`sql-kind-badge kind-${out.kind}`}>{KIND_LABELS[out.kind]}</span>
              <h4>{out.title}</h4>
            </div>
            <div className="sql-card-actions">
              <button type="button" className="btn btn-sm" onClick={() => download(out)}>
                Download
              </button>
              <button type="button" className="btn btn-sm" onClick={() => copy(out.sql)}>
                Copy
              </button>
            </div>
          </div>
          <div className="diff-card-body">
            <p className="sql-card-desc">{out.description}</p>
            {out.count != null && (
              <p className="sql-card-meta">
                {out.count.toLocaleString()} {out.kind === 'missing-rows' ? 'INSERT statement(s)' : 'item(s)'}
              </p>
            )}
            <div className="sql-output">{out.sql}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
