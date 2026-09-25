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

export interface CreateProviderAvailabilityOptions {
  /** Clock injected by the daemon or test; this module never reads ambient time. */
  now: () => number;
}

/** A clock regression must never stretch a refusal beyond this bounded window. */
export const MAX_PROVIDER_SUPPRESSION_MS = 6 * 60 * 60 * 1000;

/**
 * Creates a pure, process-local store of self-expiring provider suppressions.
 */
export function createProviderAvailability({
  now,
}: CreateProviderAvailabilityOptions): ProviderAvailability {
  const suppressedUntil = new Map<string, number>();

  return {
    suppress(provider: string, untilMs: number): void {
      const boundedUntil = Math.min(untilMs, now() + MAX_PROVIDER_SUPPRESSION_MS);
      const existingUntil = suppressedUntil.get(provider);
      if (existingUntil === undefined || boundedUntil > existingUntil) {
        suppressedUntil.set(provider, boundedUntil);
      }
    },

    isAvailable(provider: string): boolean {
      const untilMs = suppressedUntil.get(provider);
      if (untilMs === undefined) {
        return true;
      }

      if (now() < untilMs) {
        return false;
      }

      // Expiry is self-contained: once observed, the old window cannot affect
      // a later exhaustion cycle and no operator-triggered clearing is needed.
      suppressedUntil.delete(provider);
      return true;
    },
  };
}
