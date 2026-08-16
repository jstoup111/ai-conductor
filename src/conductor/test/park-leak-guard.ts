import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { execa } from 'execa';

export interface ParkedMarkersSnapshot {
  exists: boolean;
  markers: Record<string, string>;
}

export interface ParkedMarkersDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

/**
 * True only when `cwd` is the primary checkout that owns the shared Git
 * common directory. A linked worktree shares its main checkout's parked
 * ledger with the live daemon, so it cannot make an exclusive leak claim
 * about that ledger during a test run.
 */
export async function isPrimaryCheckout(cwd: string): Promise<boolean> {
  try {
    const [{ stdout: checkoutRoot }, { stdout: commonDir }] = await Promise.all([
      execa('git', ['-C', cwd, 'rev-parse', '--show-toplevel']),
      execa('git', ['-C', cwd, 'rev-parse', '--git-common-dir']),
    ]);
    const resolvedCheckoutRoot = resolve(cwd, checkoutRoot);
    const resolvedCommonDir = resolve(cwd, commonDir);
    return resolvedCheckoutRoot === dirname(resolvedCommonDir);
  } catch {
    return false;
  }
}

/** Resolve the main repository's parked-marker directory for any Git checkout. */
export async function resolveRealParkedDir(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execa('git', ['-C', cwd, 'rev-parse', '--git-common-dir']);
    return join(dirname(resolve(cwd, stdout)), '.daemon', 'parked');
  } catch {
    return null;
  }
}

/** Snapshot the top-level regular marker files in a parked-marker directory. */
export async function snapshotParkedMarkers(dir: string): Promise<ParkedMarkersSnapshot> {
  const markers: Record<string, string> = {};

  try {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      if (entry.isFile()) {
        markers[entry.name] = await readFile(join(dir, entry.name), 'utf8');
      }
    }));
    return { exists: true, markers };
  } catch {
    return { exists: false, markers: {} };
  }
}

/** Compare parked-marker snapshots by slug and marker content. */
export function diffParkedMarkers(
  before: ParkedMarkersSnapshot,
  after: ParkedMarkersSnapshot,
): ParkedMarkersDiff {
  if (!before.exists || !after.exists) {
    return { added: [], removed: [], modified: [] };
  }

  const added = Object.keys(after.markers).filter((slug) => !(slug in before.markers));
  const removed = Object.keys(before.markers).filter((slug) => !(slug in after.markers));
  const modified = Object.keys(after.markers).filter(
    (slug) => slug in before.markers && after.markers[slug] !== before.markers[slug],
  );

  return { added, removed, modified };
}
