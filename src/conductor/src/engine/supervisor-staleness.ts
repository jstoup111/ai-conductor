/** Tracks one supervisor's stale interval independently of subsequent builds. */
export interface SupervisorStaleness {
  observe(bootIdentity: string | null, currentIdentity: string | null, nowMs?: number): void;
  ageHours(nowMs?: number): number;
  capExceeded(maxHours: number, nowMs?: number): boolean;
  markProtocolMismatch(): void;
  readonly firstStaleAtMs: number | undefined;
  readonly restartReason: 'protocol-mismatch' | 'age-cap' | undefined;
}

export function createSupervisorStaleness(now = () => Date.now()): SupervisorStaleness {
  let firstStaleAtMs: number | undefined;
  let mismatch = false;
  return {
    observe(bootIdentity, currentIdentity, at = now()) {
      if (bootIdentity !== null && currentIdentity !== null && bootIdentity !== currentIdentity) {
        firstStaleAtMs ??= at;
      } else {
        firstStaleAtMs = undefined;
        mismatch = false;
      }
    },
    ageHours(at = now()) { return firstStaleAtMs === undefined ? 0 : Math.max(0, at - firstStaleAtMs) / 3_600_000; },
    capExceeded(maxHours, at = now()) { return firstStaleAtMs !== undefined && at - firstStaleAtMs > maxHours * 3_600_000; },
    markProtocolMismatch() { mismatch = true; },
    get firstStaleAtMs() { return firstStaleAtMs; },
    get restartReason() { return mismatch ? 'protocol-mismatch' : undefined; },
  };
}
