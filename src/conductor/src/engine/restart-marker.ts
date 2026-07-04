// restart-marker.ts — the single source of truth for `.daemon/RESTART-PENDING`.
//
// Per adr-2026-07-04-pending-restart-queue: a `restart` requested against a busy
// daemon cannot interrupt in-flight work, so it queues durably instead — this
// marker is that queue. It carries a single logical intent (informational JSON:
// requestedAt/requestedBy/blockingSlug). Consume-once semantics: the marker is
// removed and its intent returned exactly once, at the next daemon boot — a
// fresh boot IS the restart, whether that boot fires the respawn itself or (in
// the bare-run case) is the replacement process. A crash before firing leaves
// the marker on disk to be consumed (and thus fulfilled) by the next boot; it
// can never fire twice or dangle.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The pending-restart marker path, relative to a project root. */
export const RESTART_MARKER = '.daemon/RESTART-PENDING';

/** The informational payload carried by a queued restart intent. */
export interface RestartIntent {
  /** ISO timestamp of the (most recent) write — refreshed on every re-request. */
  requestedAt: string;
  /** Who asked for the restart, when known. */
  requestedBy?: string;
  /** The in-flight feature slug the restart is waiting behind, when known. */
  blockingSlug?: string;
}

/**
 * Queue a restart intent under `projectRoot` by writing `.daemon/RESTART-PENDING`,
 * creating `.daemon/` if needed.
 *
 * Idempotent: a second call while the marker still exists simply refreshes the
 * informational payload (new `requestedAt`, latest `blockingSlug`/`requestedBy`)
 * — it never produces more than one marker file and never queues more than the
 * one logical intent (adr-2026-07-04-pending-restart-queue: "one fire").
 */
export async function writeRestartPending(
  projectRoot: string,
  opts: { blockingSlug?: string; requestedBy?: string } = {},
): Promise<void> {
  await mkdir(join(projectRoot, '.daemon'), { recursive: true });
  const intent: RestartIntent = {
    requestedAt: new Date().toISOString(),
    ...(opts.requestedBy !== undefined ? { requestedBy: opts.requestedBy } : {}),
    ...(opts.blockingSlug !== undefined ? { blockingSlug: opts.blockingSlug } : {}),
  };
  await writeFile(join(projectRoot, RESTART_MARKER), JSON.stringify(intent, null, 2), 'utf-8');
}

/**
 * Peek at the pending-restart marker under `projectRoot` WITHOUT consuming it
 * — read-only, for observability (`conduct daemon status`, FR-9). Unlike
 * `consumeOnBoot`, this never deletes the marker; it may be called any number
 * of times while the intent is queued.
 *
 * Returns `null` when no marker is present. A present but corrupted
 * (unparsable) marker still reports presence (with only `requestedAt` known)
 * rather than throwing or being mistaken for "no restart queued".
 */
export async function readRestartPending(projectRoot: string): Promise<RestartIntent | null> {
  let raw: string;
  try {
    raw = await readFile(join(projectRoot, RESTART_MARKER), 'utf-8');
  } catch {
    return null;
  }

  try {
    return JSON.parse(raw) as RestartIntent;
  } catch {
    return { requestedAt: new Date().toISOString() };
  }
}

/**
 * Consume the pending-restart marker under `projectRoot`: remove it and return
 * the intent it carried. A fresh boot IS the restart, so this is called once at
 * daemon startup regardless of whether that boot is the respawned replacement
 * or (bare-run) the next manual start.
 *
 * Returns `null`, and leaves the filesystem untouched, when no marker is
 * present — consuming an absent marker is a no-op, not an error. A present but
 * corrupted (unparsable) marker is still removed and reported as consumed
 * (with only `requestedAt` known) — a marker that cannot be read must not
 * dangle or block the boot it was meant to fulfill.
 */
export async function consumeOnBoot(projectRoot: string): Promise<RestartIntent | null> {
  const markerPath = join(projectRoot, RESTART_MARKER);
  let raw: string;
  try {
    raw = await readFile(markerPath, 'utf-8');
  } catch {
    return null;
  }

  await rm(markerPath, { force: true }).catch(() => {});

  try {
    return JSON.parse(raw) as RestartIntent;
  } catch {
    return { requestedAt: new Date().toISOString() };
  }
}
