/**
 * memory-fallback.ts
 *
 * Write-fallback + pending-reconcile resilience (FR-13 / FR-13a / FR-13b).
 *
 * persistMemory    — best-effort platform write; falls back to local store +
 *                    pending ledger on provider unavailability or write error.
 *                    NEVER throws. The ENTIRE fallback block is wrapped so
 *                    inner failures (invalid category, fs error) are also
 *                    swallowed and returned as {sink:'local',pendingReconcile:false}.
 *                    Emits at most ONE warning per ctx object (bounded dedup via
 *                    WeakSet).
 *                    NOTE: `ctx` MUST be a fresh object per run. The module-level
 *                    `warnedCtx` WeakSet dedups per-ctx for the process lifetime;
 *                    reusing a ctx across runs suppresses the second warning.
 *                    Call `resetFallbackWarnings(ctx)` before reusing.
 * listPendingReconcile — reads pending ledger; returns [] when nothing pending,
 *                    ledger is absent, JSON is not an array, or entries are
 *                    missing required fields.
 * reconcilePending — drains pending entries into the provider INCREMENTALLY:
 *                    each success is spliced from the in-memory list and the
 *                    ledger is written immediately before moving to the next
 *                    entry.  On failure, the remaining (un-drained) ledger is
 *                    persisted and the function returns {reconciled:N} without
 *                    rethrowing — a retry never re-sends already-drained entries.
 * resetFallbackWarnings — removes `ctx` from the per-process dedup WeakSet.
 *
 * TODO(phase-2-wiring): framework primitives — `persistMemory`, `listPendingReconcile`, and
 * `reconcilePending` are NOT yet invoked by the live memory step; they are exercised only by
 * tests. The live step-runner records via 1a's `recordMemoryEntry` directly. Wire `persistMemory`
 * into the memory-recording path (and schedule `reconcilePending` on provider reconnect) when a
 * concrete non-default provider ships. In Phase 1 the registry is empty, so the active provider is
 * always `local` and the fallback/reconcile paths cannot trigger differently from a direct local
 * write at runtime.
 */

import { join } from 'path';
import { readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { projectKey, recordMemoryEntry } from './memory-store.js';
import type { MemoryEntry } from './memory-store.js';

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Reads HOME from the environment so tests can redirect it to a temp dir. */
function resolveHome(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? homedir();
}

/** Returns the path to the pending-reconcile ledger JSON for the given repo. */
async function getLedgerPath(repoPath: string): Promise<string> {
  const home = resolveHome();
  const key = await projectKey(repoPath);
  return join(home, '.ai-conductor', 'memory', key, 'harness', 'pending-reconcile.json');
}

/**
 * Reads the ledger; returns [] when absent, unparseable, or not a valid array.
 * Entries missing required MemoryEntry fields (category, name, body, indexLine)
 * are filtered out silently to guard against on-disk corruption.
 */
async function readLedger(ledgerPath: string): Promise<MemoryEntry[]> {
  try {
    const raw = await readFile(ledgerPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is MemoryEntry =>
        e !== null &&
        typeof e === 'object' &&
        typeof e.category === 'string' &&
        typeof e.name === 'string' &&
        typeof e.body === 'string' &&
        typeof e.indexLine === 'string',
    );
  } catch {
    return [];
  }
}

/** Atomically overwrites the ledger with `entries`. */
async function writeLedger(ledgerPath: string, entries: MemoryEntry[]): Promise<void> {
  await writeFile(ledgerPath, JSON.stringify(entries, null, 2), 'utf8');
}

/**
 * Tracks which ctx objects have already received a fallback warning this run.
 * Keyed on the ctx reference so each distinct ctx gets at most one warning,
 * and old ctx objects are garbage-collected without memory leaks.
 *
 * NOTE: `ctx` MUST be a fresh object per run. To reset a reused ctx, call
 * `resetFallbackWarnings(ctx)`.
 */
const warnedCtx = new WeakSet<object>();

// ─────────────────────────────────────────────────────────────────────────────
// Provider shape (structural — no import from plugin.ts)
// ─────────────────────────────────────────────────────────────────────────────

interface MemoryProvider {
  isAvailable?: () => boolean;
  write: (entry: MemoryEntry) => void;
}

interface RunCtx {
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Removes `ctx` from the per-process warning-dedup WeakSet so a reused ctx
 * object will receive the next fallback or reconcile warning.
 *
 * Only needed when deliberately reusing a ctx object across multiple runs —
 * the normal pattern is to pass a fresh ctx per run.
 */
export function resetFallbackWarnings(ctx: object): void {
  warnedCtx.delete(ctx);
}

/**
 * Attempt to write `entry` to `provider`.
 *
 * If the provider is unavailable (`isAvailable?.() === false`) or `write`
 * throws, falls back:
 *   1. Persists the entry to the LOCAL harness store via `recordMemoryEntry`,
 *      with an explicit `<!-- pending-reconcile -->` marker prepended to the
 *      body so the pending state is intrinsic to the stored file (FR-13a /
 *      plan-B17).  The original body text is preserved after the marker.
 *   2. Appends a CLEAN copy of the entry (original body, no marker) to the
 *      pending-reconcile ledger so `reconcilePending` replays a pristine
 *      entry to the platform without leaking the marker.
 *   3. Pushes at most ONE warning onto `ctx.warnings` across the lifetime of
 *      this ctx object (FR-13b bounded-warning dedup).
 *   4. Returns `{ sink: 'local', pendingReconcile: true }`.
 *
 * If the fallback path itself fails (e.g. invalid category passed to
 * `recordMemoryEntry`, fs write error), the outer surface still does NOT
 * throw: it pushes a degraded-fallback warning (respecting the same bounded
 * dedup) and returns `{ sink: 'local', pendingReconcile: false }`.
 *
 * NEVER throws — callers rely on this for run completion (FR-13).
 *
 * IMPORTANT: `ctx` MUST be a fresh object per run. The module-level
 * `warnedCtx` WeakSet dedups per-ctx for the process lifetime; reusing a ctx
 * suppresses subsequent warnings. Call `resetFallbackWarnings(ctx)` to reset.
 */
export async function persistMemory({
  repoPath,
  provider,
  entry,
  ctx,
}: {
  repoPath: string;
  provider: MemoryProvider;
  entry: MemoryEntry;
  ctx: RunCtx;
}): Promise<{ sink: 'local' | 'platform'; pendingReconcile: boolean }> {
  // Detect unavailability before attempting a write that would throw.
  const unavailable = provider.isAvailable != null && !provider.isAvailable();

  if (!unavailable) {
    try {
      provider.write(entry);
      // Success — entry lives only on the platform.
      return { sink: 'platform', pendingReconcile: false };
    } catch {
      // Fall through to local fallback below.
    }
  }

  // ── Fallback path ──────────────────────────────────────────────────────────
  // The ENTIRE block is wrapped so any inner failure (invalid category, fs
  // error in recordMemoryEntry or writeLedger, etc.) is caught and the outer
  // surface remains total (FR-13).
  try {
    // 1. Persist to local store with an explicit pending-reconcile marker so
    //    the pending state is intrinsic to the stored file and survives ledger
    //    loss (FR-13a / plan-B17).  The ORIGINAL body text is preserved
    //    after the marker so existing `treeContains` assertions stay valid.
    const markedEntry: MemoryEntry = {
      ...entry,
      body: `<!-- pending-reconcile -->\n${entry.body}`,
    };
    await recordMemoryEntry(repoPath, markedEntry);

    // 2. Record a CLEAN copy (original body, no marker) in the pending ledger
    //    so reconcile replays a pristine entry to the platform.
    //    Set pendingReconcile:true on the ledger entry for explicit tagging.
    const ledgerPath = await getLedgerPath(repoPath);
    const pending = await readLedger(ledgerPath);
    pending.push({ ...entry, pendingReconcile: true });
    await writeLedger(ledgerPath, pending);

    // 3. Bounded warning: at most one per ctx.
    if (!warnedCtx.has(ctx)) {
      ctx.warnings.push(
        'memory fallback: platform write failed; entry saved locally and queued for reconcile',
      );
      warnedCtx.add(ctx);
    }

    return { sink: 'local', pendingReconcile: true };
  } catch {
    // Inner fallback failure: push a degraded warning (bounded dedup) and
    // return without throwing so persistMemory stays total (FR-13).
    if (!warnedCtx.has(ctx)) {
      ctx.warnings.push(
        'memory fallback degraded: both platform and local writes failed; entry may be lost',
      );
      warnedCtx.add(ctx);
    }
    return { sink: 'local', pendingReconcile: false };
  }
}

/**
 * Returns the entries currently held in the pending-reconcile ledger.
 * Returns [] when the ledger is absent, empty, contains malformed JSON, or
 * has a non-array root value.  Entries missing required fields are filtered
 * out silently.
 */
export async function listPendingReconcile(repoPath: string): Promise<MemoryEntry[]> {
  const ledgerPath = await getLedgerPath(repoPath);
  return readLedger(ledgerPath);
}

/**
 * Drains each pending entry into `provider.write()` INCREMENTALLY so that a
 * partial failure never creates duplicates on retry:
 *
 *  - For each entry in the ledger, call `provider.write(entry)`.
 *  - On SUCCESS: splice the entry from the in-memory list and immediately
 *    persist the shrunk ledger before moving to the next entry.  A crash at
 *    this exact point may re-send the entry once on restart (acceptable
 *    at-least-once over never-sent), but will never re-send already-drained
 *    entries.
 *  - On FIRST FAILURE: persist the remaining (un-drained) ledger — including
 *    the failed entry — push a bounded warning to ctx, and return
 *    `{ reconciled: <count> }` WITHOUT rethrowing.  A subsequent call will
 *    only re-send entries that were not yet drained.
 *
 * Idempotency: a second call finds the ledger empty (all entries drained or
 * nothing pending) and returns `{ reconciled: 0 }`.
 *
 * One-directional: never reads from the platform or pulls platform-only
 * entries into the local store.  Only pushes what the ledger holds.
 */
export async function reconcilePending({
  repoPath,
  provider,
  ctx,
}: {
  repoPath: string;
  provider: MemoryProvider;
  ctx: RunCtx;
}): Promise<{ reconciled: number }> {
  const ledgerPath = await getLedgerPath(repoPath);
  const pending = await readLedger(ledgerPath);

  if (pending.length === 0) {
    return { reconciled: 0 };
  }

  // Work on a mutable copy so we can splice in place as entries drain.
  const remaining = [...pending];
  let reconciled = 0;

  while (remaining.length > 0) {
    const e = remaining[0];
    try {
      provider.write(e);
      // Success: remove this entry from the front and immediately persist
      // the shrunk ledger so a crash here never re-drains this entry.
      remaining.splice(0, 1);
      await writeLedger(ledgerPath, remaining);
      reconciled++;
    } catch {
      // This entry failed.  Persist the remaining ledger (including the
      // failed entry at index 0) so a retry picks up exactly from here.
      await writeLedger(ledgerPath, remaining);
      if (!warnedCtx.has(ctx)) {
        ctx.warnings.push(
          'memory reconcile: partial failure; remaining entries still pending for retry',
        );
        warnedCtx.add(ctx);
      }
      return { reconciled };
    }
  }

  return { reconciled };
}
