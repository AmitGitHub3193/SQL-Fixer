import type { SummaryPdfInput } from './exportSummaryPdf';

interface ExportPdfButtonProps {
  input: SummaryPdfInput | null;
  disabled?: boolean;
  className?: string;
  label?: string;
  title?: string;
}

export function ExportPdfButton({
  input,
  disabled,
  className = 'btn btn-pdf',
  label = 'Export PDF report',
  title = 'Download a PDF summary of table comparison, schema diffs, and missing data',
}: ExportPdfButtonProps) {
  const handleClick = async () => {
    if (!input) return;
    try {
      const { downloadSummaryPdf } = await import('./exportSummaryPdf');
      downloadSummaryPdf(input);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to generate PDF');
    }
  };

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || !input}
      title={title}
      onClick={handleClick}
    >
      <span className="btn-pdf-icon" aria-hidden>📄</span>
      {label}
    </button>
  );
}
