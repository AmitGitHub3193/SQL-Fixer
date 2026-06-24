import type { SyncDirection } from './types';

export function directionLabels(direction: SyncDirection) {
  const source = direction === 'local-to-live' ? 'Local file' : 'Live file';
  const target = direction === 'local-to-live' ? 'Live file' : 'Local file';
  return { source, target, short: `${source} → ${target}` };
}
