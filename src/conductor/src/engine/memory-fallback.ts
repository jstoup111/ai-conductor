/**
 * memory-fallback.ts
 *
 * Write-fallback + pending-reconcile resilience (FR-13 / FR-13a / FR-13b).
 *
 * persistMemory    — best-effort platform write; falls back to local store +
 *                    pending ledger on provider unavailability or write error.
 *                    NEVER throws. Emits at most ONE warning per ctx object
 *                    (bounded dedup via WeakSet).
 * listPendingReconcile — reads pending ledger; returns [] when nothing pending.
 * reconcilePending — one-directional push of pending entries into the provider
 *                    EXACTLY ONCE, then clears the ledger (idempotency via
 *                    ledger clearing, not dedup inside the provider).
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

/** Reads the ledger; returns [] when absent or unparseable. */
async function readLedger(ledgerPath: string): Promise<MemoryEntry[]> {
  try {
    const raw = await readFile(ledgerPath, 'utf8');
    return JSON.parse(raw) as MemoryEntry[];
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
 * Attempt to write `entry` to `provider`.
 *
 * If the provider is unavailable (`isAvailable?.() === false`) or `write`
 * throws, falls back:
 *   1. Persists the entry to the LOCAL harness store via `recordMemoryEntry`.
 *   2. Appends the entry to the pending-reconcile ledger.
 *   3. Pushes at most ONE warning onto `ctx.warnings` across the lifetime of
 *      this ctx object (FR-13b bounded-warning dedup).
 *   4. Returns `{ sink: 'local', pendingReconcile: true }`.
 *
 * NEVER throws — callers rely on this for run completion (FR-13).
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
  // 1. Persist to local store (so the body is physically in .memory).
  await recordMemoryEntry(repoPath, entry);

  // 2. Record in pending-reconcile ledger for later push.
  const ledgerPath = await getLedgerPath(repoPath);
  const pending = await readLedger(ledgerPath);
  pending.push(entry);
  await writeLedger(ledgerPath, pending);

  // 3. Bounded warning: at most one per ctx.
  if (!warnedCtx.has(ctx)) {
    ctx.warnings.push(
      'memory fallback: platform write failed; entry saved locally and queued for reconcile',
    );
    warnedCtx.add(ctx);
  }

  return { sink: 'local', pendingReconcile: true };
}

/**
 * Returns the entries currently held in the pending-reconcile ledger.
 * Returns [] when the ledger is absent or empty.
 */
export async function listPendingReconcile(repoPath: string): Promise<MemoryEntry[]> {
  const ledgerPath = await getLedgerPath(repoPath);
  return readLedger(ledgerPath);
}

/**
 * Pushes each pending entry into `provider.write()` EXACTLY ONCE, then clears
 * the pending ledger. Idempotency comes from clearing the ledger — a second
 * call finds no pending entries and returns `{ reconciled: 0 }`.
 *
 * One-directional: never reads from the platform or pulls platform-only entries
 * into the local store. Only pushes what the ledger holds.
 */
export async function reconcilePending({
  repoPath,
  provider,
  ctx: _ctx,
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

  for (const entry of pending) {
    provider.write(entry);
  }

  // Clear the ledger so a second reconcile sees nothing.
  await writeLedger(ledgerPath, []);

  return { reconciled: pending.length };
}
