import { useMemo, useState } from 'react';
import type { SchemaDiffItem, SyncDirection, TableComparisonRow } from './types';
import { generateSchemaFixSql } from './api';
import { MissingTablesSplit } from './MissingTablesSplit';

type SchemaFilter = 'all' | 'issues' | 'sync' | 'missing_table';

interface TableSchemaGroup {
  table: string;
  status: 'in_sync' | 'missing_table' | 'extra_table' | 'column_issues';
  diffs: SchemaDiffItem[];
  indices: number[];
}

function summarizeDiffs(diffs: SchemaDiffItem[], allTables: string[]): {
  groups: TableSchemaGroup[];
  stats: {
    total: number;
    inSync: number;
    withIssues: number;
    missingTables: number;
    extraTables: number;
    columnIssues: number;
    totalDiffs: number;
  };
} {
  const byTable = new Map<string, { diffs: SchemaDiffItem[]; indices: number[] }>();
  diffs.forEach((d, i) => {
    if (!byTable.has(d.table)) byTable.set(d.table, { diffs: [], indices: [] });
    const g = byTable.get(d.table)!;
    g.diffs.push(d);
    g.indices.push(i);
  });

  const tableSet = new Set([...allTables, ...diffs.map((d) => d.table)]);
  const groups: TableSchemaGroup[] = [];

  for (const table of [...tableSet].sort()) {
    const entry = byTable.get(table);
    if (!entry) {
      groups.push({ table, status: 'in_sync', diffs: [], indices: [] });
      continue;
    }
    const hasMissing = entry.diffs.some((d) => d.type === 'missing_table');
    const hasExtra = entry.diffs.some((d) => d.type === 'extra_table');
    let status: TableSchemaGroup['status'] = 'column_issues';
    if (hasMissing) status = 'missing_table';
    else if (hasExtra) status = 'extra_table';
    groups.push({ table, status, diffs: entry.diffs, indices: entry.indices });
  }

  const missingTables = groups.filter((g) => g.status === 'missing_table').length;
  const extraTables = groups.filter((g) => g.status === 'extra_table').length;
  const columnIssues = groups.filter((g) => g.status === 'column_issues').length;
  const inSync = groups.filter((g) => g.status === 'in_sync').length;

  return {
    groups,
    stats: {
      total: groups.length,
      inSync,
      withIssues: groups.length - inSync,
      missingTables,
      extraTables,
      columnIssues,
      totalDiffs: diffs.length,
    },
  };
}

function statusBadge(status: TableSchemaGroup['status'], direction: SyncDirection) {
  if (status === 'in_sync') return <span className="schema-badge schema-ok">In both files</span>;
  if (status === 'missing_table') {
    const label = direction === 'local-to-live' ? 'Missing on LIVE file' : 'Missing on LOCAL file';
    return <span className="schema-badge schema-missing">{label}</span>;
  }
  if (status === 'extra_table') {
    const label = direction === 'local-to-live' ? 'Missing on LOCAL file' : 'Missing on LIVE file';
    return <span className="schema-badge schema-extra">{label}</span>;
  }
  return <span className="schema-badge schema-warn">Column differences</span>;
}

function diffTypeLabel(type: string) {
  return type.replace(/_/g, ' ');
}

export function SchemaComparePanel({
  diffs,
  allTables,
  comparison,
  direction,
  selectedIndices,
  onSelectionChange,
  onGenerateSql,
}: {
  diffs: SchemaDiffItem[];
  allTables: string[];
  comparison: TableComparisonRow[];
  direction: SyncDirection;
  selectedIndices: Set<number>;
  onSelectionChange: (next: Set<number>) => void;
  onGenerateSql: (sql: string) => void;
}) {
  const [filter, setFilter] = useState<SchemaFilter>('issues');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const { groups, stats } = useMemo(() => summarizeDiffs(diffs, allTables), [diffs, allTables]);

  const filtered = useMemo(() => {
    let list = groups;
    if (filter === 'issues') list = list.filter((g) => g.status !== 'in_sync');
    else if (filter === 'sync') list = list.filter((g) => g.status === 'in_sync');
    else if (filter === 'missing_table') list = list.filter((g) => g.status === 'missing_table');
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.table.toLowerCase().includes(q));
    }
    return list;
  }, [groups, filter, search]);

  const dirHint = direction === 'local-to-live' ? 'Local → Live' : 'Live → Local';
  const sourceLabel = direction === 'local-to-live' ? 'Local file' : 'Live file';
  const targetLabel = direction === 'local-to-live' ? 'Live file' : 'Local file';

  const toggleTable = (g: TableSchemaGroup) => {
    const next = new Set(selectedIndices);
    const allSelected = g.indices.every((i) => next.has(i));
    if (allSelected) g.indices.forEach((i) => next.delete(i));
    else g.indices.forEach((i) => next.add(i));
    onSelectionChange(next);
  };

  const toggleExpand = (table: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(table)) n.delete(table);
      else n.add(table);
      return n;
    });
  };

  const selectAllVisible = () => {
    const next = new Set(selectedIndices);
    filtered.forEach((g) => {
      if (g.status !== 'in_sync') g.indices.forEach((i) => next.add(i));
    });
    onSelectionChange(next);
  };

  const handleGenerate = async () => {
    const items = diffs.filter((_, i) => selectedIndices.has(i));
    const sql = await generateSchemaFixSql(items);
    onGenerateSql(sql);
  };

  return (
    <div className="schema-panel">
      <MissingTablesSplit comparison={comparison} />

      <div className="schema-direction-banner">
        <strong>Fix direction:</strong> {dirHint} — fixes apply changes from <em>{sourceLabel}</em> onto <em>{targetLabel}</em>.
        Column diffs mean the table exists in both files but columns don&apos;t match.
      </div>

      <div className="schema-summary-grid">
        <div className="schema-stat-card">
          <span className="schema-stat-num">{stats.total}</span>
          <span className="schema-stat-label">Tables compared</span>
        </div>
        <div className="schema-stat-card schema-stat-ok">
          <span className="schema-stat-num">{stats.inSync}</span>
          <span className="schema-stat-label">In sync</span>
        </div>
        <div className="schema-stat-card schema-stat-warn">
          <span className="schema-stat-num">{stats.columnIssues}</span>
          <span className="schema-stat-label">Column diffs</span>
        </div>
        <div className="schema-stat-card schema-stat-missing">
          <span className="schema-stat-num">{stats.missingTables}</span>
          <span className="schema-stat-label">Missing on {targetLabel}</span>
        </div>
        <div className="schema-stat-card schema-stat-extra">
          <span className="schema-stat-num">{stats.extraTables}</span>
          <span className="schema-stat-label">Missing on {sourceLabel}</span>
        </div>
        <div className="schema-stat-card">
          <span className="schema-stat-num">{stats.totalDiffs}</span>
          <span className="schema-stat-label">Total line items</span>
        </div>
      </div>

      <p className="section-desc">
        Direction: <strong>{dirHint}</strong> — {stats.withIssues === 0
          ? 'All compared tables match.'
          : `${stats.withIssues} table(s) need attention (${stats.totalDiffs} fix item(s)).`}
      </p>

      <div className="schema-toolbar">
        <div className="schema-filters">
          {(['issues', 'all', 'sync', 'missing_table'] as SchemaFilter[]).map((f) => (
            <button
              key={f}
              type="button"
              className={`schema-filter-btn ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'issues' && `Issues (${stats.withIssues})`}
              {f === 'all' && `All (${stats.total})`}
              {f === 'sync' && `In sync (${stats.inSync})`}
              {f === 'missing_table' && `Missing (${stats.missingTables})`}
            </button>
          ))}
        </div>
        <input type="search" className="schema-search" placeholder="Filter tables..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="schema-actions">
        <button type="button" className="btn btn-sm" onClick={selectAllVisible}>Select all visible</button>
        <button type="button" className="btn btn-sm" onClick={() => onSelectionChange(new Set())}>Clear selection</button>
        <button type="button" className="btn btn-success btn-sm" disabled={selectedIndices.size === 0} onClick={handleGenerate}>
          Generate fix SQL ({selectedIndices.size})
        </button>
      </div>

      <div className="schema-table-list">
        <div className="schema-table-header">
          <span />
          <span>Table</span>
          <span>Status</span>
          <span>Issues</span>
          <span />
        </div>
        {filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: '1.5rem' }}>No tables match this filter</div>
        ) : (
          filtered.map((g) => {
            const isExpanded = expanded.has(g.table);
            const tableSelected = g.indices.length > 0 && g.indices.every((i) => selectedIndices.has(i));
            const hasIssues = g.status !== 'in_sync';
            return (
              <div key={g.table} className={`schema-table-group ${hasIssues ? 'has-issues' : 'in-sync'}`}>
                <div className="schema-table-row">
                  <input
                    type="checkbox"
                    disabled={!hasIssues}
                    checked={tableSelected}
                    onChange={() => toggleTable(g)}
                  />
                  <button type="button" className="schema-table-name" onClick={() => hasIssues && toggleExpand(g.table)}>
                    {g.table}
                  </button>
                  {statusBadge(g.status, direction)}
                  <span className="schema-issue-count">{hasIssues ? g.diffs.length : '—'}</span>
                  {hasIssues && (
                    <button type="button" className="btn btn-sm schema-expand-btn" onClick={() => toggleExpand(g.table)}>
                      {isExpanded ? 'Hide' : 'Show'}
                    </button>
                  )}
                </div>
                {isExpanded && hasIssues && (
                  <div className="schema-detail-list">
                    {g.diffs.map((d, di) => {
                      const globalIdx = g.indices[di];
                      return (
                        <div key={globalIdx} className="schema-detail-item">
                          <label className="schema-detail-check">
                            <input
                              type="checkbox"
                              checked={selectedIndices.has(globalIdx)}
                              onChange={() => {
                                const next = new Set(selectedIndices);
                                if (next.has(globalIdx)) next.delete(globalIdx);
                                else next.add(globalIdx);
                                onSelectionChange(next);
                              }}
                            />
                            <span className={`schema-diff-type type-${d.type}`}>{diffTypeLabel(d.type)}</span>
                          </label>
                          <p className="schema-detail-msg">{d.message}</p>
                          {d.ddl && <code className="schema-detail-ddl">{d.ddl}</code>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
