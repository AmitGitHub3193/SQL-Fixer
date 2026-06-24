/** Upload phase uses first 20% of the bar; server parsing uses 20–100%. */
const UPLOAD_WEIGHT = 0.2;

export function combineProgress(uploadPct: number | null, serverPct: number, phase: 'upload' | 'processing'): number {
  if (phase === 'upload' && uploadPct != null) {
    return Math.min(20, Math.round(uploadPct * UPLOAD_WEIGHT));
  }
  return Math.min(100, Math.round(20 + serverPct * (1 - UPLOAD_WEIGHT)));
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 5) return 'Almost done…';
  if (seconds < 60) return `~${Math.ceil(seconds)}s remaining`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return s > 0 ? `~${m}m ${s}s remaining` : `~${m}m remaining`;
}

export function estimateEta(progressPct: number, startedAt: number): string {
  if (progressPct <= 0 || progressPct >= 100) return '';
  const elapsed = (Date.now() - startedAt) / 1000;
  if (elapsed < 0.5) return 'Calculating…';
  const remaining = (elapsed / progressPct) * (100 - progressPct);
  return formatEta(remaining);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
