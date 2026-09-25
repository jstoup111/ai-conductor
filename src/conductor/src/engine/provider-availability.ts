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

/**
 * Creates a pure, process-local store of self-expiring provider suppressions.
 */
export function createProviderAvailability({
  now,
}: CreateProviderAvailabilityOptions): ProviderAvailability {
  const suppressedUntil = new Map<string, number>();

  return {
    suppress(provider: string, untilMs: number): void {
      const existingUntil = suppressedUntil.get(provider);
      if (existingUntil === undefined || untilMs > existingUntil) {
        suppressedUntil.set(provider, untilMs);
      }
    },

    isAvailable(provider: string): boolean {
      const untilMs = suppressedUntil.get(provider);
      return untilMs === undefined || now() >= untilMs;
    },
  };
}
