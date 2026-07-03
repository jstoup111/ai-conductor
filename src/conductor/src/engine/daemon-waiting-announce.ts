// daemon-waiting-announce.ts — warn-once WAITING announcements (Task 18 /
// FR-6 negatives: no spam on a stable wait, re-announce on change).
//
// Every daemon scan re-derives the full `waiting` list from
// `discoverBacklog()`. Logging a line for every waiting spec on every scan
// would spam the log forever for a spec sitting on a slow-moving blocker.
// This module tracks, PER PROCESS, PER PROJECT ROOT, the last-announced verdict
// hash for each waiting slug and only logs when that hash changes:
//
//   - new spec enters WAITING            → announce (no prior hash)
//   - verdict unchanged across scans      → silent
//   - blocker set / verdict kind changes  → re-announce
//   - spec leaves WAITING                 → forgotten; a later re-entry with
//                                            the SAME verdict re-announces
//                                            (it's a fresh wait)
//
// Deliberately in-memory only (a `Map`, not a durable `.daemon/warned/`
// marker like the merged-spec skip warning in daemon-backlog.ts) — a durable
// marker would suppress the re-announcement this feature exists to provide
// across a daemon restart, which is exactly the wrong behavior for a live
// "still waiting" signal. State is organized per-projectRoot to support
// multiple roots in a single process.

import type { BlockerVerdict } from './blocker-resolver.js';
import type { WaitingItem } from './daemon-backlog.js';
import { refLabel, waitingDetail } from './daemon-dashboard.js';

/**
 * Module-level registry: Map<projectRoot, Map<slug, verdictHash>>.
 * Persists across calls within a single process, tracking announced verdicts
 * per project root. This allows multiple roots in the same process to maintain
 * independent warn-once state.
 */
const registry = new Map<string, Map<string, string>>();

/**
 * Deterministic fingerprint of a verdict's observable content — kind plus
 * blocker/cycle refs or indeterminate detail — NOT object identity. Two
 * separately-constructed verdicts with the same content hash identically, so
 * a spec re-resolved on the next scan with an unchanged blocker set is
 * correctly treated as "no change" even though it's a new object.
 */
export function hashVerdict(verdict: BlockerVerdict): string {
  switch (verdict.kind) {
    case 'unblocked':
      return 'unblocked';
    case 'blocked':
      return `blocked:${verdict.blockers.map(refLabel).join(',')}`;
    case 'cycle':
      return `cycle:${verdict.members.map(refLabel).join(',')}`;
    case 'indeterminate':
      return `indeterminate:${verdict.detail}`;
  }
}

/**
 * Build a warn-once announcer bound to a fresh, instance-scoped `Map<slug,
 * verdictHash>`. Call the returned function once per scan with the current
 * `waiting` list; it logs one line per slug whose verdict is new or changed,
 * then forgets any slug no longer present (so a later re-entry re-announces).
 */
export function createWaitingAnnouncer(
  log: (msg: string) => void,
): (waiting: WaitingItem[]) => void {
  const announced = new Map<string, string>();

  return (waiting: WaitingItem[]): void => {
    const current = new Set<string>();
    for (const w of waiting) {
      current.add(w.slug);
      const hash = hashVerdict(w.verdict);
      if (announced.get(w.slug) === hash) continue; // stable — no spam
      log(`[daemon] WAITING ${w.slug}: ${waitingDetail(w.verdict)}`);
      announced.set(w.slug, hash);
    }
    // Forget slugs no longer waiting so a later re-entry (even with an
    // identical verdict) is treated as a fresh wait and re-announced.
    for (const slug of announced.keys()) {
      if (!current.has(slug)) announced.delete(slug);
    }
  };
}

/**
 * Module-level per-projectRoot warn-once announcer. Maintains persistent
 * per-root state across calls within a single process. Call once per scan
 * with the current `waiting` list; it logs one line per slug whose verdict
 * is new or changed, then forgets any slug no longer present (so a later
 * re-entry re-announces).
 */
export function announceWaitingForRoot(
  projectRoot: string,
  log: (msg: string) => void,
  waiting: WaitingItem[],
): void {
  // Get or create the per-root announced map
  let announced = registry.get(projectRoot);
  if (!announced) {
    announced = new Map<string, string>();
    registry.set(projectRoot, announced);
  }

  const current = new Set<string>();
  for (const w of waiting) {
    current.add(w.slug);
    const hash = hashVerdict(w.verdict);
    if (announced.get(w.slug) === hash) continue; // stable — no spam
    log(`[daemon] WAITING ${w.slug}: ${waitingDetail(w.verdict)}`);
    announced.set(w.slug, hash);
  }
  // Forget slugs no longer waiting so a later re-entry (even with an
  // identical verdict) is treated as a fresh wait and re-announced.
  for (const slug of announced.keys()) {
    if (!current.has(slug)) announced.delete(slug);
  }
}
