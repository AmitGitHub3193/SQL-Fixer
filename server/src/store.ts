import type { ParsedDump } from './services/offlineDump.js';

let localDump: ParsedDump | null = null;
let liveDump: ParsedDump | null = null;

export function setDump(side: 'local' | 'live', dump: ParsedDump) {
  if (side === 'local') localDump = dump;
  else liveDump = dump;
}

export function getDump(side: 'local' | 'live'): ParsedDump | null {
  return side === 'local' ? localDump : liveDump;
}

export function getDumps() {
  return { local: localDump, live: liveDump };
}

export function clearDump(side: 'local' | 'live') {
  if (side === 'local') localDump = null;
  else liveDump = null;
}
