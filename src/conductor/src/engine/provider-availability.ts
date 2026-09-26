/**
 * In-memory admission state for usage-exhausted providers.
 *
 * This store deliberately owns only per-provider suppression windows. Callers
 * retain candidate ordering and decide how to record a refused admission.
 */
export interface ProviderAvailability {
  /** Records a suppression window, preserving any later window already known. */
  suppress(provider: string, untilMs: number): void;

  /** Returns whether a provider may be invoked at the injected current time. */
  isAvailable(provider: string): boolean;
}

interface SuppressionWindow {
  untilMs: number;
  openedAtMs: number;
}

export interface CreateProviderAvailabilityOptions {
  /** Clock injected by the daemon or test; this module never reads ambient time. */
  now: () => number;
}

/** A clock regression must never stretch a refusal beyond this bounded window. */
export const MAX_PROVIDER_SUPPRESSION_MS = 6 * 60 * 60 * 1000;

/** Rehydrate only still-valid daemon-origin records from the durable ledger. */
export function restoreProviderAvailabilityFromDaemonLedger({
  availability,
  ledger,
  now,
}: {
  availability: ProviderAvailability;
  ledger: string;
  now: number;
}): void {
  for (const line of ledger.split('\n')) {
    try {
      const record = JSON.parse(line) as { type?: unknown; provider?: unknown; deadline?: unknown };
      if (record.type !== 'provider_suppressed' || typeof record.provider !== 'string' ||
        typeof record.deadline !== 'number' || record.deadline <= now ||
        record.deadline > now + MAX_PROVIDER_SUPPRESSION_MS) continue;
      availability.suppress(record.provider, record.deadline);
    } catch { /* Ignore malformed historical ledger lines. */ }
  }
}

/**
 * Creates a pure, process-local store of self-expiring provider suppressions.
 */
export function createProviderAvailability({
  now,
}: CreateProviderAvailabilityOptions): ProviderAvailability {
  const suppressedUntil = new Map<string, SuppressionWindow>();

  return {
    suppress(provider: string, untilMs: number): void {
      const openedAtMs = now();
      const boundedUntil = Math.min(untilMs, openedAtMs + MAX_PROVIDER_SUPPRESSION_MS);
      const existingUntil = suppressedUntil.get(provider);
      if (boundedUntil <= openedAtMs) return;
      if (existingUntil === undefined || boundedUntil > existingUntil.untilMs) {
        suppressedUntil.set(provider, { untilMs: boundedUntil, openedAtMs });
      }
    },

    isAvailable(provider: string): boolean {
      const window = suppressedUntil.get(provider);
      if (window === undefined) {
        return true;
      }

      const currentMs = now();
      // Wall-clock rollback must not turn a six-hour maximum into an
      // arbitrarily long refusal. Treat a pre-open observation as elapsed.
      if (currentMs < window.openedAtMs) {
        suppressedUntil.delete(provider);
        return true;
      }
      if (currentMs < Math.min(window.untilMs, window.openedAtMs + MAX_PROVIDER_SUPPRESSION_MS)) {
        return false;
      }

      // Expiry is self-contained: once observed, the old window cannot affect
      // a later exhaustion cycle and no operator-triggered clearing is needed.
      suppressedUntil.delete(provider);
      return true;
    },
  };
}
