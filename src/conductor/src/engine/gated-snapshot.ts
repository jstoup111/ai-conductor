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
 * cannot be created) is logged (once per call, via `log`) and swallowed, not
 * thrown — a snapshot write must never abort or block the discovery pass
 * that produced it. Dispatch/dashboard rendering for that pass proceeds
 * exactly as if the snapshot sink did not exist; only the on-disk
 * `gated.json` is left stale until a later pass succeeds.
 */
export async function writeGatedSnapshot(
  daemonDir: string,
  state: { gated: GatedItem[] },
  clock: Clock = () => new Date(),
  log: (message: string) => void = (m) => console.error(m),
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
  } catch (err) {
    // Advisory: never throw — a snapshot write must not block the caller's
    // discovery pass. Log once so the failure is observable, then best-effort
    // clean up a dangling temp file.
    const reason = err instanceof Error ? err.message : String(err);
    log(`writeGatedSnapshot: failed to write ${snapshotPath(daemonDir)}: ${reason}`);
    await unlink(tmpPath).catch(() => {});
  }
}

/** Successful read: the snapshot exists, parsed, and is a recognized schema. */
export interface GatedSnapshotOk {
  kind: 'ok';
  gated: GatedSpecItem[];
  repoWarnings: GatedRepoItem[];
  writtenAt: string;
}

/**
 * Explicit unknown state: the caller (daemon status, dashboard) must render
 * this as "gated state unknown", never silently as "nothing gated" — an
 * absent/corrupt/future-shaped snapshot is NOT the same thing as an empty
 * one, and must never be misread as an implied all-clear.
 */
export interface GatedSnapshotUnknown {
  kind: 'unknown';
  why: 'missing' | 'unreadable' | 'version';
}

export type ReadGatedSnapshotResult = GatedSnapshotOk | GatedSnapshotUnknown;

/**
 * Read `<repoPath>/.daemon/gated.json` and classify the result into an
 * explicit discriminated union — never `null`, never a thrown exception.
 *
 * - Missing file (no discovery pass has completed yet) → `{ why: 'missing' }`.
 * - Unparseable/truncated JSON → `{ why: 'unreadable' }`.
 * - Parses but carries an unrecognized `schemaVersion` (forward-compat guard
 *   against a future writer shape this reader doesn't understand yet) →
 *   `{ why: 'version' }`.
 * - Otherwise → `{ kind: 'ok', gated, repoWarnings, writtenAt }`.
 */
export async function readGatedSnapshot(repoPath: string): Promise<ReadGatedSnapshotResult> {
  let raw: string;
  try {
    raw = await readFile(snapshotPath(join(repoPath, '.daemon')), 'utf-8');
  } catch {
    return { kind: 'unknown', why: 'missing' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: 'unknown', why: 'unreadable' };
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    return { kind: 'unknown', why: 'version' };
  }

  const snapshot = parsed as GatedSnapshot;
  return {
    kind: 'ok',
    gated: snapshot.gated ?? [],
    repoWarnings: snapshot.repoWarnings ?? [],
    writtenAt: snapshot.writtenAt,
  };
}
