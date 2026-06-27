// engineer/intake/ledger.ts — Ledger types, interface, and file-backed factory.
// FR-33, FR-34, ADR-012, T5-T8.
// Ledger is the SOLE dedup authority for intake (replaces the in-memory dedup guard).
// Dedup key: source + NUL + sourceRef — so cross-repo same number is distinct,
// and a re-filed idea under a new reference is also distinct.

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

// ─── LedgerStatus ─────────────────────────────────────────────────────────────

/** All valid lifecycle states for a ledger entry. */
export type LedgerStatus =
  | 'unseen'
  | 'pending'
  | 'claimed'
  | 'routed'
  | 'deciding'
  | 'done'
  | 'needs-manual';

// ─── LedgerEntry ──────────────────────────────────────────────────────────────

/**
 * A single record in the intake ledger.
 * Keyed on (source, sourceRef); tracks lifecycle and optional routing metadata.
 */
export interface LedgerEntry {
  source: string;
  sourceRef: string;
  status: LedgerStatus;
  attempts: number;
  branch?: string;
  prUrl?: string;
  capturedAt?: string;
  lastSeenAt?: string;
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

/**
 * Durable intake ledger.
 *
 * - known:      true if (source, sourceRef) has been seen before.
 * - record:     create a new entry with status 'pending' (attempts:0) if absent.
 * - transition: advance entry to a new status, optionally attaching metadata.
 * - get:        retrieve an entry by (source, sourceRef), or undefined.
 * - forget:     remove an entry (e.g. for testing / manual override).
 *
 * FR-33/FR-34, ADR-012.
 */
export interface Ledger {
  known(source: string, sourceRef: string): Promise<boolean>;
  record(input: { source: string; sourceRef: string }): Promise<void>;
  transition(
    source: string,
    sourceRef: string,
    status: LedgerStatus,
    meta?: { branch?: string; prUrl?: string },
  ): Promise<void>;
  get(source: string, sourceRef: string): Promise<LedgerEntry | undefined>;
  forget(source: string, sourceRef: string): Promise<void>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type LedgerStore = Record<string, LedgerEntry>;

/** Composite dedup key: NUL-joined so source prefix cannot bleed into sourceRef. */
function makeKey(source: string, sourceRef: string): string {
  return `${source}\0${sourceRef}`;
}

/** Load ledger from disk; returns empty store if file is absent or unreadable. */
async function loadStore(path: string): Promise<LedgerStore> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as LedgerStore;
  } catch {
    return {};
  }
}

/** Atomically write ledger to disk (tmp file + rename). Auto-creates parent dir. */
async function saveStore(path: string, store: LedgerStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await rename(tmp, path);
}

// ─── createLedger ─────────────────────────────────────────────────────────────

/**
 * Create a file-backed Ledger persisted at `path` (a JSON file).
 *
 * - Load tolerates a missing file (returns empty store).
 * - Parent directory is created automatically on first write.
 * - Writes are atomic: tmp-write + rename.
 * - Dedup key is source\0sourceRef; cross-repo same-number issues are distinct.
 */
export function createLedger(path: string): Ledger {
  return {
    async known(source: string, sourceRef: string): Promise<boolean> {
      const store = await loadStore(path);
      return makeKey(source, sourceRef) in store;
    },

    async record({ source, sourceRef }: { source: string; sourceRef: string }): Promise<void> {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      if (!(key in store)) {
        const now = new Date().toISOString();
        store[key] = {
          source,
          sourceRef,
          status: 'pending',
          attempts: 0,
          capturedAt: now,
          lastSeenAt: now,
        };
        await saveStore(path, store);
      }
    },

    async transition(
      source: string,
      sourceRef: string,
      status: LedgerStatus,
      meta?: { branch?: string; prUrl?: string },
    ): Promise<void> {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      const entry = store[key];
      if (!entry) {
        throw new Error(
          `Ledger: no entry for (source="${source}", sourceRef="${sourceRef}") — call record() first`,
        );
      }
      store[key] = {
        ...entry,
        status,
        lastSeenAt: new Date().toISOString(),
        ...(meta?.branch !== undefined ? { branch: meta.branch } : {}),
        ...(meta?.prUrl !== undefined ? { prUrl: meta.prUrl } : {}),
      };
      await saveStore(path, store);
    },

    async get(source: string, sourceRef: string): Promise<LedgerEntry | undefined> {
      const store = await loadStore(path);
      return store[makeKey(source, sourceRef)];
    },

    async forget(source: string, sourceRef: string): Promise<void> {
      const store = await loadStore(path);
      const key = makeKey(source, sourceRef);
      if (key in store) {
        delete store[key];
        await saveStore(path, store);
      }
    },
  };
}
