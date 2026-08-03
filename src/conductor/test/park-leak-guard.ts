import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export interface ParkedMarkersSnapshot {
  exists: boolean;
  markers: Record<string, string>;
}

export interface ParkedMarkersDiff {
  added: string[];
  removed: string[];
  modified: string[];
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
