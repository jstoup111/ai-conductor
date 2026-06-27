// engineer/intake/ledger.ts — Ledger types, interface, and factory stub.
// FR-33, ADR-012, T4.
// Ledger is the SOLE dedup authority for intake (replaces in-memory idempotency guard).
// Implementation provided by T5–T8.

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
 * - record:     create a new entry with status 'unseen'.
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

// ─── createLedger ─────────────────────────────────────────────────────────────

/**
 * Create a file-backed Ledger persisted at `path` (a JSON file).
 *
 * Stub — implementation provided by T5–T8.
 * All methods throw until the impl tasks fill them in.
 */
export function createLedger(path: string): Ledger {
  return {
    async known(_source: string, _sourceRef: string): Promise<boolean> {
      throw new Error(`not implemented: T5/T6 (createLedger path=${path})`);
    },
    async record(_input: { source: string; sourceRef: string }): Promise<void> {
      throw new Error(`not implemented: T5/T6 (createLedger path=${path})`);
    },
    async transition(
      _source: string,
      _sourceRef: string,
      _status: LedgerStatus,
      _meta?: { branch?: string; prUrl?: string },
    ): Promise<void> {
      throw new Error(`not implemented: T5/T6 (createLedger path=${path})`);
    },
    async get(_source: string, _sourceRef: string): Promise<LedgerEntry | undefined> {
      throw new Error(`not implemented: T5/T6 (createLedger path=${path})`);
    },
    async forget(_source: string, _sourceRef: string): Promise<void> {
      throw new Error(`not implemented: T5/T6 (createLedger path=${path})`);
    },
  };
}
