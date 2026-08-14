// engineer/intake/ledger.ts — Ledger types, interface, and file-backed factory.
// FR-33, FR-34, ADR-012, T5-T8.
// Ledger is the SOLE dedup authority for intake (replaces the in-memory dedup guard).
// Dedup key: source + NUL + sourceRef — so cross-repo same number is distinct,
// and a re-filed idea under a new reference is also distinct.

import { readFile, writeFile, mkdir, rename, readdir, mkdtemp, link, unlink, rmdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createConductStateLease,
  type ConductStateLease,
} from '../../conduct-state-lease.js';

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
  writebackPending?: boolean;
}

/** Raised when the persisted intake ledger cannot be read safely. */
export class CorruptLedgerError extends Error {
  constructor(
    public readonly ledgerPath: string,
    public readonly reason: string,
    /** Exact sibling path preserving the corrupt bytes, when quarantine succeeded. */
    public readonly quarantinePath?: string,
    /** Defined when corrupt bytes could not be quarantined. */
    public readonly quarantineDiagnostic?: string,
    /** SHA-256 identity of corrupt bytes, retained even when quarantine fails. */
    public readonly corruptBytesDigest?: string,
  ) {
    super(`Intake ledger at ${ledgerPath} is corrupt: ${reason}`);
    this.name = 'CorruptLedgerError';
  }
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
    meta?: { branch?: string; prUrl?: string; writebackPending?: boolean },
  ): Promise<void>;
  get(source: string, sourceRef: string): Promise<LedgerEntry | undefined>;
  forget(source: string, sourceRef: string): Promise<void>;
  /** Enumerate all entries in the ledger, regardless of status. */
  list(): Promise<LedgerEntry[]>;
  /**
   * Make a previously-`done` entry re-eligible: reset status to 'pending' and
   * increment `attempts` (the churn counter). Used by github-issues re-eligibility
   * (FR-39/40) when a spec PR closes without merging. No-op if the entry is absent.
   */
  reopen(source: string, sourceRef: string): Promise<void>;
  /**
   * Recover a stranded `claimed` entry back to `pending`: preserves `capturedAt`,
   * increments `attempts` (the churn counter), and refreshes `lastSeenAt`.
   * Distinct from `reopen` (`done` → `pending`) — used for crash/stale-claim recovery
   * (FR-1, FR-4, FR-11, ADR-2). No-op if the entry is absent or not currently `claimed`
   * (ADR-2, FR-6) — the return value signals whether the requeue actually happened, so
   * callers (e.g. the `unclaim` CLI verb) can distinguish "requeued" from "nothing to do".
   */
  requeueClaimed(source: string, sourceRef: string): Promise<{ acted: boolean }>;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

type LedgerStore = Record<string, LedgerEntry>;

interface CreateLedgerOptions {
  lease?: ConductStateLease;
}

export type LedgerLoadResult =
  | { kind: 'absent' }
  | { kind: 'ok'; store: LedgerStore }
  | { kind: 'corrupt'; reason: string; bytes?: Buffer };

const ledgerStatuses: ReadonlySet<LedgerStatus> = new Set([
  'unseen',
  'pending',
  'claimed',
  'routed',
  'deciding',
  'done',
  'needs-manual',
]);

const TRANSIENT_LEASE_OWNER_METADATA_FAILURE =
  'Unable to recover intake ledger lease: owner metadata is invalid or ambiguous';
const TRANSIENT_LEASE_OWNER_METADATA_RETRIES = 10;

function isTransientLeaseOwnerMetadataFailure(
  acquired: Awaited<ReturnType<ConductStateLease['acquire']>>,
): boolean {
  return !acquired.ok &&
    acquired.kind === 'recovery_refused' &&
    (acquired.message === TRANSIENT_LEASE_OWNER_METADATA_FAILURE ||
      acquired.message.includes('owner metadata is unavailable (ENOENT:'));
}

function isLedgerEntry(value: unknown): value is LedgerEntry {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;

  const entry = value as Record<string, unknown>;
  return (
    typeof entry.source === 'string' &&
    typeof entry.sourceRef === 'string' &&
    typeof entry.status === 'string' &&
    ledgerStatuses.has(entry.status as LedgerStatus) &&
    typeof entry.attempts === 'number' &&
    Number.isInteger(entry.attempts) &&
    entry.attempts >= 0 &&
    (entry.branch === undefined || typeof entry.branch === 'string') &&
    (entry.prUrl === undefined || typeof entry.prUrl === 'string') &&
    (entry.capturedAt === undefined || typeof entry.capturedAt === 'string') &&
    (entry.lastSeenAt === undefined || typeof entry.lastSeenAt === 'string') &&
    (entry.writebackPending === undefined || typeof entry.writebackPending === 'boolean')
  );
}

function isLedgerStore(value: unknown): value is LedgerStore {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(isLedgerEntry)
  );
}

/** Composite dedup key: NUL-joined so source prefix cannot bleed into sourceRef. */
function makeKey(source: string, sourceRef: string): string {
  return `${source}\0${sourceRef}`;
}

/** Load ledger from disk, distinguishing a missing file from a failed read. */
export async function loadStore(path: string): Promise<LedgerLoadResult> {
  let raw: Buffer;
  try {
    raw = await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { kind: 'absent' };
    }
    return {
      kind: 'corrupt',
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw.toString('utf8'));
    if (!isLedgerStore(parsed)) {
      return { kind: 'corrupt', reason: 'ledger content is not a valid ledger store', bytes: raw };
    }
    return { kind: 'ok', store: parsed };
  } catch (error) {
    return {
      kind: 'corrupt',
      reason: error instanceof Error ? error.message : String(error),
      bytes: raw,
    };
  }
}

async function quarantineCorruptBytes(path: string, bytes: Buffer): Promise<string> {
  const directory = dirname(path);
  const prefix = `${basename(path)}.corrupt-`;
  const existing = await readdir(directory);
  for (const name of existing) {
    if (!name.startsWith(prefix)) continue;
    const quarantinePath = join(directory, name);
    try {
      if ((await readFile(quarantinePath)).equals(bytes)) return quarantinePath;
    } catch {
      // A stale or unreadable sibling cannot safely be reused.
    }
  }

  let timestamp = Date.now();
  while (true) {
    const quarantinePath = `${path}.corrupt-${timestamp}`;
    try {
      // link() publishes the prepared bytes with O_EXCL semantics without using
      // the daemon-lock boundary's guarded `wx` create flag. The source lives in
      // the same directory, so this is an atomic, collision-safe publication.
      const temporaryDirectory = await mkdtemp(join(directory, `.${prefix}`));
      const temporaryPath = join(temporaryDirectory, 'bytes');
      try {
        await writeFile(temporaryPath, bytes);
        await link(temporaryPath, quarantinePath);
        return quarantinePath;
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
        await rmdir(temporaryDirectory).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if ((await readFile(quarantinePath)).equals(bytes)) return quarantinePath;
      } catch {
        // A colliding, unreadable file is preserved; choose another timestamp.
      }
      timestamp += 1;
    }
  }
}

function corruptBytesDigest(bytes: Buffer | undefined): string | undefined {
  return bytes === undefined ? undefined : createHash('sha256').update(bytes).digest('hex');
}

async function readStore(path: string): Promise<LedgerStore> {
  const result = await loadStore(path);
  if (result.kind === 'absent') return {};
  if (result.kind === 'corrupt') {
    let quarantinePath: string | undefined;
    let quarantineDiagnostic: string | undefined;
    if (result.bytes !== undefined) {
      try {
        quarantinePath = await quarantineCorruptBytes(path, result.bytes);
      } catch (error) {
        quarantineDiagnostic = `failed to quarantine corrupt ledger: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    const reason = quarantineDiagnostic === undefined
      ? result.reason
      : `${result.reason}; ${quarantineDiagnostic}`;
    throw new CorruptLedgerError(
      path,
      reason,
      quarantinePath,
      quarantineDiagnostic,
      corruptBytesDigest(result.bytes),
    );
  }
  return result.store;
}

/** Atomically write ledger to disk (tmp file + rename). Auto-creates parent dir. */
async function saveStore(path: string, store: LedgerStore): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${randomBytes(4).toString('hex')}`;
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf8');
  await rename(tmp, path);
}

async function withLedgerLease<T>(lease: ConductStateLease, body: () => Promise<T>): Promise<T> {
  let acquired = await lease.acquire();
  // A competing process creates the lease directory immediately before writing
  // owner.json. Retry that narrow creation window; a persistent ambiguity still
  // fails closed below.
  for (
    let retry = 0;
    isTransientLeaseOwnerMetadataFailure(acquired) && retry < TRANSIENT_LEASE_OWNER_METADATA_RETRIES;
    retry += 1
  ) {
    await delay(10);
    acquired = await lease.acquire();
  }
  if (!acquired.ok) throw new Error(`Unable to acquire intake ledger lease: ${acquired.message}`);
  let bodySucceeded = false;
  try {
    const result = await body();
    bodySucceeded = true;
    return result;
  } finally {
    const released = await acquired.handle.release();
    if (!released.ok && bodySucceeded) throw new Error(released.message);
  }
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
export function createLedger(path: string, options: CreateLedgerOptions = {}): Ledger {
  const lease = options.lease ?? createConductStateLease(path, { label: 'intake ledger' });

  return {
    async known(source: string, sourceRef: string): Promise<boolean> {
      return withLedgerLease(lease, async () => {
        const store = await readStore(path);
        return makeKey(source, sourceRef) in store;
      });
    },

    async record({ source, sourceRef }: { source: string; sourceRef: string }): Promise<void> {
      await withLedgerLease(lease, async () => {
        const store = await readStore(path);
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
      });
    },

    async transition(
      source: string,
      sourceRef: string,
      status: LedgerStatus,
      meta?: { branch?: string; prUrl?: string; writebackPending?: boolean },
    ): Promise<void> {
      await withLedgerLease(lease, async () => {
        const store = await readStore(path);
        const key = makeKey(source, sourceRef);
        const entry = store[key];
        if (!entry) {
          throw new Error(
            `Ledger: no entry for (source="${source}", sourceRef="${sourceRef}") — call record() first`,
          );
        }
        const updated: LedgerEntry = {
          ...entry,
          status,
          lastSeenAt: new Date().toISOString(),
          ...(meta?.branch !== undefined ? { branch: meta.branch } : {}),
          ...(meta?.prUrl !== undefined ? { prUrl: meta.prUrl } : {}),
        };
        if (meta?.writebackPending === true) {
          updated.writebackPending = true;
        } else if (meta?.writebackPending === false) {
          delete updated.writebackPending;
        }
        store[key] = updated;
        await saveStore(path, store);
      });
    },

    async get(source: string, sourceRef: string): Promise<LedgerEntry | undefined> {
      return withLedgerLease(lease, async () => {
        const store = await readStore(path);
        return store[makeKey(source, sourceRef)];
      });
    },

    async forget(source: string, sourceRef: string): Promise<void> {
      await withLedgerLease(lease, async () => {
        const store = await readStore(path);
        const key = makeKey(source, sourceRef);
        if (key in store) {
          delete store[key];
          await saveStore(path, store);
        }
      });
    },

    async list(): Promise<LedgerEntry[]> {
      return withLedgerLease(lease, async () => {
        const store = await readStore(path);
        return Object.values(store);
      });
    },

    async reopen(source: string, sourceRef: string): Promise<void> {
      await withLedgerLease(lease, async () => {
        const store = await readStore(path);
        const key = makeKey(source, sourceRef);
        const entry = store[key];
        if (!entry) return; // nothing to reopen — no-op.
        store[key] = {
          ...entry,
          status: 'pending',
          attempts: (entry.attempts ?? 0) + 1,
          lastSeenAt: new Date().toISOString(),
        };
        await saveStore(path, store);
      });
    },

    async requeueClaimed(source: string, sourceRef: string): Promise<{ acted: boolean }> {
      return withLedgerLease(lease, async () => {
        const store = await readStore(path);
        const key = makeKey(source, sourceRef);
        const entry = store[key];
        if (!entry || entry.status !== 'claimed') return { acted: false }; // no-op — refuse on absent/non-claimed (ADR-2).
        store[key] = {
          ...entry,
          status: 'pending',
          attempts: (entry.attempts ?? 0) + 1,
          lastSeenAt: new Date().toISOString(),
        };
        await saveStore(path, store);
        return { acted: true };
      });
    },
  };
}
