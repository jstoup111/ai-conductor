/**
 * Reusable test-double memory provider fixture for Slice 1b.
 *
 * Yields a `memory_provider`-kind instance whose availability, write-accept/reject,
 * and reconnect state are togglable, with an in-memory entry log.
 *
 * Designed to be reused by resilience batches (write-fallback/reconcile, B16–B20).
 */

export interface TestDoubleEntry {
  content: unknown;
  [key: string]: unknown;
}

export interface TestDoubleProviderOpts {
  /** Provider name (defaults to "double"). */
  name?: string;
  /** Initial availability (defaults to true). */
  available?: boolean;
  /** If true, writes are rejected immediately (defaults to false). */
  rejectWrites?: boolean;
}

export interface TestDoubleProvider {
  readonly kind: 'memory_provider';
  readonly name: string;

  // ── Availability probe (matches the activation-spec contract) ──────────────
  isAvailable(): boolean;
  readonly available: boolean;

  // ── Controllable toggles ───────────────────────────────────────────────────
  setAvailable(v: boolean): void;
  setRejectWrites(v: boolean): void;
  /** Mark the provider as reconnected (for resilience-batch tests). */
  setReconnected(v: boolean): void;

  // ── In-memory entry log (cleared between tests via clearLog) ──────────────
  write(entry: TestDoubleEntry): Promise<void>;
  readonly entryLog: readonly TestDoubleEntry[];
  clearLog(): void;

  // ── Reconnect signal ──────────────────────────────────────────────────────
  readonly reconnected: boolean;
}

/**
 * Factory. All state is local to the returned object — no module-level mutable state.
 */
export function makeTestDoubleProvider(opts: TestDoubleProviderOpts = {}): TestDoubleProvider {
  const name = opts.name ?? 'double';
  let _available = opts.available !== undefined ? opts.available : true;
  let _rejectWrites = opts.rejectWrites ?? false;
  let _reconnected = false;
  const _log: TestDoubleEntry[] = [];

  return {
    kind: 'memory_provider' as const,
    name,

    isAvailable(): boolean {
      return _available;
    },

    get available(): boolean {
      return _available;
    },

    setAvailable(v: boolean): void {
      _available = v;
    },

    setRejectWrites(v: boolean): void {
      _rejectWrites = v;
    },

    setReconnected(v: boolean): void {
      _reconnected = v;
    },

    async write(entry: TestDoubleEntry): Promise<void> {
      if (_rejectWrites) {
        throw new Error(`TestDoubleProvider "${name}": write rejected (rejectWrites=true)`);
      }
      _log.push(entry);
    },

    get entryLog(): readonly TestDoubleEntry[] {
      return _log;
    },

    clearLog(): void {
      _log.splice(0, _log.length);
    },

    get reconnected(): boolean {
      return _reconnected;
    },
  };
}
