import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type {
  DatabaseSummary,
  MissingDataGroup,
  SchemaDiffItem,
  SyncDirection,
  TableComparisonRow,
} from './types';
import { formatBytes, statusLabel } from './types';

export interface SummaryPdfInput {
  localFile: string | null;
  liveFile: string | null;
  local: DatabaseSummary;
  live: DatabaseSummary;
  comparison: TableComparisonRow[];
  direction: SyncDirection;
  schemaDiffs?: SchemaDiffItem[];
  missingGroups?: MissingDataGroup[];
}

const COLORS = {
  primary: [37, 99, 235] as [number, number, number],
  cyan: [6, 182, 212] as [number, number, number],
  warn: [245, 158, 11] as [number, number, number],
  success: [34, 197, 94] as [number, number, number],
  error: [239, 68, 68] as [number, number, number],
  muted: [100, 116, 139] as [number, number, number],
  text: [30, 41, 59] as [number, number, number],
  light: [248, 250, 252] as [number, number, number],
  border: [226, 232, 240] as [number, number, number],
};

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function formatDateTime(): string {
  return new Date().toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function dirLabel(direction: SyncDirection): string {
  return direction === 'local-to-live' ? 'Local file → Live file' : 'Live file → Local file';
}

function addFooter(doc: jsPDF) {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(
      `SQL Fixer Offline · Page ${i} of ${pages}`,
      doc.internal.pageSize.getWidth() / 2,
      doc.internal.pageSize.getHeight() - 10,
      { align: 'center' },
    );
  }
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  const bottom = doc.internal.pageSize.getHeight() - 18;
  if (y + needed > bottom) {
    doc.addPage();
    return 20;
  }
  return y;
}

function sectionTitle(doc: jsPDF, y: number, title: string): number {
  y = ensureSpace(doc, y, 14);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...COLORS.text);
  doc.text(title, 14, y);
  doc.setDrawColor(...COLORS.primary);
  doc.setLineWidth(0.6);
  doc.line(14, y + 2, 196, y + 2);
  return y + 10;
}

function statBox(doc: jsPDF, x: number, y: number, w: number, label: string, value: string, accent?: [number, number, number]) {
  doc.setFillColor(...COLORS.light);
  doc.setDrawColor(...COLORS.border);
  doc.roundedRect(x, y, w, 22, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(...(accent ?? COLORS.text));
  doc.text(value, x + w / 2, y + 10, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...COLORS.muted);
  doc.text(label.toUpperCase(), x + w / 2, y + 17, { align: 'center' });
}

function schemaTypeLabel(type: string): string {
  return type.replace(/_/g, ' ');
}

export function downloadSummaryPdf(input: SummaryPdfInput): void {
  const {
    localFile,
    liveFile,
    local,
    live,
    comparison,
    direction,
    schemaDiffs = [],
    missingGroups = [],
  } = input;

  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  const localOnly = comparison.filter((r) => r.status === 'local_only');
  const liveOnly = comparison.filter((r) => r.status === 'live_only');
  const onBoth = comparison.filter((r) => r.status === 'both');
  const totalMissingRows = missingGroups.reduce((a, g) => a + g.count, 0);

  // ── Cover header ──
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pageW, 42, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(255, 255, 255);
  doc.text('SQL Fixer Offline', 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.text('SQL Dump Comparison Report', 14, 26);
  doc.setFontSize(9);
  doc.text(`Generated ${formatDateTime()}`, 14, 34);

  let y = 52;

  doc.setFontSize(9);
  doc.setTextColor(...COLORS.muted);
  doc.text('Fix direction', 14, y);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COLORS.text);
  doc.text(dirLabel(direction), 14, y + 5);
  y += 14;

  // File info cards
  const cardW = (pageW - 28 - 6) / 2;
  doc.setFillColor(240, 253, 255);
  doc.setDrawColor(...COLORS.cyan);
  doc.roundedRect(14, y, cardW, 28, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.cyan);
  doc.text('Local SQL file', 18, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.text);
  doc.text(localFile ?? local.host ?? '—', 18, y + 13, { maxWidth: cardW - 8 });
  doc.setTextColor(...COLORS.muted);
  doc.text(`${local.tableCount} tables · ${local.totalRows.toLocaleString()} rows · ${formatBytes(local.totalSize)}`, 18, y + 22);

  doc.setFillColor(255, 251, 235);
  doc.setDrawColor(...COLORS.warn);
  doc.roundedRect(14 + cardW + 6, y, cardW, 28, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...COLORS.warn);
  doc.text('Live SQL file', 18 + cardW + 6, y + 7);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COLORS.text);
  doc.text(liveFile ?? live.host ?? '—', 18 + cardW + 6, y + 13, { maxWidth: cardW - 8 });
  doc.setTextColor(...COLORS.muted);
  doc.text(`${live.tableCount} tables · ${live.totalRows.toLocaleString()} rows · ${formatBytes(live.totalSize)}`, 18 + cardW + 6, y + 22);

  y += 36;

  // Summary stat boxes
  y = sectionTitle(doc, y, 'Executive summary');
  const boxW = (pageW - 28 - 15) / 4;
  const stats: [string, string, [number, number, number] | undefined][] = [
    [String(comparison.length), 'Tables compared', undefined],
    [String(onBoth.length), 'In both files', COLORS.success],
    [String(localOnly.length), 'Missing on Live', COLORS.error],
    [String(liveOnly.length), 'Missing on Local', COLORS.warn],
  ];
  stats.forEach(([val, label, accent], i) => {
    statBox(doc, 14 + i * (boxW + 5), y, boxW, label, val, accent);
  });
  y += 28;

  const row2: [string, string, [number, number, number] | undefined][] = [
    [String(schemaDiffs.length), 'Schema line items', COLORS.primary],
    [String(missingGroups.length), 'Tables w/ missing rows', COLORS.primary],
    [String(totalMissingRows), 'Missing row count', COLORS.error],
    [String(comparison.length - onBoth.length), 'Tables not in both', COLORS.warn],
  ];
  row2.forEach(([val, label, accent], i) => {
    statBox(doc, 14 + i * (boxW + 5), y, boxW, label, val, accent);
  });
  y += 30;

  // Missing tables side-by-side
  y = sectionTitle(doc, y, 'Tables missing from each file');

  autoTable(doc, {
    startY: y,
    head: [['Only in Local file (missing on Live)', 'Rows', 'Only in Live file (missing on Local)', 'Rows']],
    body: (() => {
      const max = Math.max(localOnly.length, liveOnly.length, 1);
      const rows: string[][] = [];
      for (let i = 0; i < max; i++) {
        const l = localOnly[i];
        const r = liveOnly[i];
        rows.push([
          l?.name ?? '—',
          l?.local ? l.local.rowCount.toLocaleString() : '—',
          r?.name ?? '—',
          r?.live ? r.live.rowCount.toLocaleString() : '—',
        ]);
      }
      if (localOnly.length === 0 && liveOnly.length === 0) {
        rows[0] = ['None', '—', 'None', '—'];
      }
      return rows;
    })(),
    theme: 'grid',
    headStyles: { fillColor: COLORS.primary, fontSize: 8 },
    bodyStyles: { fontSize: 8, textColor: COLORS.text },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 22, halign: 'right' },
      2: { cellWidth: 70 },
      3: { cellWidth: 22, halign: 'right' },
    },
    margin: { left: 14, right: 14 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Full comparison table
  y = sectionTitle(doc, y, 'Full table comparison');
  autoTable(doc, {
    startY: y,
    head: [['Table', 'In Local', 'In Live', 'Local rows', 'Live rows', 'Summary']],
    body: comparison.map((row) => [
      row.name,
      row.local ? 'Yes' : 'No',
      row.live ? 'Yes' : 'No',
      row.local ? row.local.rowCount.toLocaleString() : '—',
      row.live ? row.live.rowCount.toLocaleString() : '—',
      statusLabel(row.status),
    ]),
    theme: 'striped',
    headStyles: { fillColor: COLORS.primary, fontSize: 8 },
    bodyStyles: { fontSize: 7.5, textColor: COLORS.text },
    alternateRowStyles: { fillColor: COLORS.light },
    margin: { left: 14, right: 14 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;

  // Schema differences
  if (schemaDiffs.length > 0) {
    y = ensureSpace(doc, y, 20);
    y = sectionTitle(doc, y, `Schema differences (${schemaDiffs.length} items)`);
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(`Direction: ${dirLabel(direction)} — details below list what would change on the target file.`, 14, y);
    y += 6;

    const byTable = new Map<string, SchemaDiffItem[]>();
    schemaDiffs.forEach((d) => {
      if (!byTable.has(d.table)) byTable.set(d.table, []);
      byTable.get(d.table)!.push(d);
    });

    for (const [table, items] of [...byTable.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      y = ensureSpace(doc, y, 20);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...COLORS.text);
      doc.text(`${table} (${items.length} issue${items.length === 1 ? '' : 's'})`, 14, y);
      y += 4;

      autoTable(doc, {
        startY: y,
        head: [['Type', 'Description', 'DDL / fix hint']],
        body: items.map((d) => [
          schemaTypeLabel(d.type),
          d.message,
          d.ddl ? d.ddl.slice(0, 120) + (d.ddl.length > 120 ? '…' : '') : '—',
        ]),
        theme: 'grid',
        headStyles: { fillColor: [71, 85, 105], fontSize: 7 },
        bodyStyles: { fontSize: 7, textColor: COLORS.text },
        columnStyles: {
          0: { cellWidth: 28 },
          1: { cellWidth: 72 },
          2: { cellWidth: 86, font: 'courier' },
        },
        margin: { left: 14, right: 14 },
      });
      y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
    }
  }

  // Missing data rows
  if (missingGroups.length > 0) {
    y = ensureSpace(doc, y, 20);
    y = sectionTitle(doc, y, `Missing data rows (${totalMissingRows.toLocaleString()} total)`);
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    const src = direction === 'local-to-live' ? 'Local file' : 'Live file';
    const tgt = direction === 'local-to-live' ? 'Live file' : 'Local file';
    doc.text(`Rows present in ${src} but missing from ${tgt}.`, 14, y);
    y += 6;

    autoTable(doc, {
      startY: y,
      head: [['Table', 'Missing rows', 'Primary keys']],
      body: missingGroups.map((g) => [
        g.table,
        g.count.toLocaleString(),
        g.primaryKeys.length ? g.primaryKeys.join(', ') : '—',
      ]),
      theme: 'striped',
      headStyles: { fillColor: COLORS.error, fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      margin: { left: 14, right: 14 },
    });
  }

  addFooter(doc);

  const fileName = `sql-fixer-report_${stamp()}.pdf`;
  doc.save(fileName);
}
