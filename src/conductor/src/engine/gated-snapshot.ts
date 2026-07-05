// gated-snapshot.ts — the single serializer for the owner-gate's read model,
// `.daemon/gated.json`. Every discovery pass calls `writeGatedSnapshot` with
// the SAME `GatedItem[]` list the daemon dashboard renders (daemon-backlog.ts
// `discoverBacklog().gated`), so the on-disk snapshot and the in-process
// dashboard view can never drift.
//
// Atomicity: write to a private, per-call temp file inside `.daemon/` then
// `rename()` on top of `gated.json`. `rename` on the same filesystem is an
// atomic replace, so a reader can never observe a torn/partial write —
// mirrors the temp+rename pattern in engine-store.ts's dist-symlink swap.

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

export interface GatedSpecItem {
  kind: 'spec';
  slug: string;
  reason: 'other-owner' | 'unowned-post-cutover' | 'unowned-indeterminate';
  otherOwner?: string;
  remedy: string;
}

export interface GatedRepoItem {
  kind: 'repo';
  warning: 'identity-unresolved' | 'no-cutover';
  remedy: string;
}

export type GatedItem = GatedSpecItem | GatedRepoItem;

export interface GatedSnapshot {
  schemaVersion: 1;
  writtenAt: string;
  repoWarnings: GatedRepoItem[];
  gated: GatedSpecItem[];
}

/** Clock abstraction: a no-arg function returning the "now" `Date`. */
export type Clock = () => Date;

const SNAPSHOT_FILE = 'gated.json';

function snapshotPath(daemonDir: string): string {
  return join(daemonDir, SNAPSHOT_FILE);
}

/**
 * Atomically (re)write `.daemon/gated.json` from `state.gated` — the exact
 * mixed `GatedItem[]` list the dashboard receives from
 * `discoverBacklog().gated`. Splits it by `kind` into the snapshot's two
 * channels: `kind: 'spec'` entries become `snapshot.gated`, `kind: 'repo'`
 * entries become `snapshot.repoWarnings`.
 *
 * Always performs a whole-file rewrite (no incremental patching), so a spec
 * that resolved ownership since the last pass is simply absent from the new
 * snapshot — there is no separate "clear the stale entry" code path to keep
 * in sync.
 *
 * Advisory: a write failure (e.g. `.daemon/` itself does not exist and
 * cannot be created) is swallowed, not thrown — a snapshot write must never
 * abort or block the discovery pass that produced it.
 */
export async function writeGatedSnapshot(
  daemonDir: string,
  state: { gated: GatedItem[] },
  clock: Clock = () => new Date(),
): Promise<void> {
  const gated: GatedSpecItem[] = [];
  const repoWarnings: GatedRepoItem[] = [];
  for (const item of state.gated) {
    if (item.kind === 'spec') {
      gated.push(item);
    } else {
      repoWarnings.push(item);
    }
  }

  const snapshot: GatedSnapshot = {
    schemaVersion: 1,
    writtenAt: clock().toISOString(),
    repoWarnings,
    gated,
  };

  const tmpPath = join(daemonDir, `.gated-tmp-${randomBytes(6).toString('hex')}.json`);
  try {
    await mkdir(daemonDir, { recursive: true });
    await writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    await rename(tmpPath, snapshotPath(daemonDir));
  } catch {
    // Advisory: never throw — a snapshot write must not block the caller's
    // discovery pass. Best-effort cleanup of a dangling temp file.
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Read back `.daemon/gated.json`. Returns `null` when the snapshot does not
 * exist yet (no discovery pass has completed) or fails to parse.
 */
export async function readGatedSnapshot(daemonDir: string): Promise<GatedSnapshot | null> {
  try {
    const raw = await readFile(snapshotPath(daemonDir), 'utf-8');
    return JSON.parse(raw) as GatedSnapshot;
  } catch {
    return null;
  }
}
