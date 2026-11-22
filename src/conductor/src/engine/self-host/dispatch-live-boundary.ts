import type { BuiltInProviderId } from '../../execution/provider-catalog.js';
import type { ConductorEvent } from '../../types/events.js';
import {
  fingerprintLiveCheckoutSurface,
  fingerprintProviderStateSurface,
  verifyLiveBoundary,
  type LiveBoundarySnapshot,
} from './live-boundary.js';
import type { ContainmentVerdict } from './live-containment.js';
import type { OpenAdmittedWindow, LiveBoundaryWindow } from './live-boundary-coordinator.js';

type DispatchLiveBoundaryEvent = Extract<
  ConductorEvent,
  {
    type: 'self_host_boundary_fingerprint' | 'self_host_containment_verdict' | 'contained_live_checkout_drift';
  }
>;
type SurfaceResult = Awaited<ReturnType<typeof fingerprintLiveCheckoutSurface>>;
type ProviderSurfaceResult = Awaited<ReturnType<typeof fingerprintProviderStateSurface>>;
type CachedSurface<T> = {
  promise: Promise<T>;
  settled: boolean;
  emitted: boolean;
  emission: Promise<void> | undefined;
};

/** Acquisition finished after its dispatch closed; it never grants a usable lease. */
export class DispatchLiveBoundaryExpiredError extends Error {
  constructor() {
    super('Self-host dispatch live boundary ended while acquisition was pending');
    this.name = 'DispatchLiveBoundaryExpiredError';
  }
}

export interface DispatchLiveBoundaryOptions {
  openWindow?: OpenAdmittedWindow;
  emit(event: DispatchLiveBoundaryEvent): void | Promise<void>;
  onViolation?(reason: string): void;
  fingerprintLiveCheckout?: typeof fingerprintLiveCheckoutSurface;
  fingerprintProviderState?: typeof fingerprintProviderStateSurface;
  verify?: typeof verifyLiveBoundary;
}

export interface DispatchLiveBoundaryAcquire {
  liveCheckout: string;
  providerHome: string;
  provider: BuiltInProviderId;
  selectedAuthPaths?: readonly string[];
  /** Preparation lifecycle hook; revocation abandons this acquire immediately. */
  onRevoked?(callback: () => void): () => void;
  probe(snapshot: LiveBoundarySnapshot): Promise<ContainmentVerdict>;
}

export interface DispatchLiveBoundaryLease {
  containment: ContainmentVerdict;
  release(): Promise<void>;
}

/** One shared live-boundary snapshot for all candidates in an admitted dispatch. */
export class DispatchLiveBoundary {
  private readonly fingerprintLiveCheckout: typeof fingerprintLiveCheckoutSurface;
  private readonly fingerprintProviderState: typeof fingerprintProviderStateSurface;
  private readonly verify: typeof verifyLiveBoundary;
  private readonly liveSurfaces = new Map<string, CachedSurface<SurfaceResult>>();
  private readonly providerSurfaces = new Map<string, CachedSurface<ProviderSurfaceResult>>();
  private readonly containments = new Map<string, CachedSurface<ContainmentVerdict>>();
  private window: LiveBoundaryWindow | undefined;
  private leases = 0;
  private pendingAcquires = 0;
  private acquireWaiters: Array<() => void> = [];
  private ended = false;
  private verification: Promise<void> | undefined;

  constructor(private readonly options: DispatchLiveBoundaryOptions) {
    this.fingerprintLiveCheckout = options.fingerprintLiveCheckout ?? fingerprintLiveCheckoutSurface;
    this.fingerprintProviderState = options.fingerprintProviderState ?? fingerprintProviderStateSurface;
    this.verify = options.verify ?? verifyLiveBoundary;
  }

  async acquire(args: DispatchLiveBoundaryAcquire): Promise<DispatchLiveBoundaryLease> {
    if (this.ended) throw new Error('Self-host dispatch live boundary has ended');
    this.pendingAcquires += 1;
    let active = true;
    let unregisterRevocation: (() => void) | undefined;
    let live: CachedSurface<SurfaceResult> | undefined;
    let provider: CachedSurface<ProviderSurfaceResult> | undefined;
    let containment: CachedSurface<ContainmentVerdict> | undefined;
    let leaseGranted = false;
    let releaseLease: (() => Promise<void>) | undefined;
    const finishAcquire = async () => {
      if (!active) return;
      active = false;
      this.pendingAcquires -= 1;
      if (this.pendingAcquires === 0) {
        this.closeIfUnused();
        await this.finalizeIfReady();
        const waiters = this.acquireWaiters;
        this.acquireWaiters = [];
        for (const wake of waiters) wake();
      }
    };
    const abandon = () => {
      if (leaseGranted) {
        void releaseLease?.();
        return;
      }
      if (!active) return;
      this.evictPending(this.liveSurfaces, args.liveCheckout, live);
      this.evictPending(this.providerSurfaces, `${args.provider}\0${args.providerHome}`, provider);
      this.evictPending(this.containments, args.liveCheckout, containment);
      void finishAcquire().finally(() => unregisterRevocation?.());
    };
    unregisterRevocation = args.onRevoked?.(abandon);
    // The lifecycle supervisor may already have timed out before it accepts
    // this callback.  Its registration contract invokes us synchronously in
    // that case, so never open a window or create cache entries with no
    // preparation attempt left to own them.
    if (!active) throw new DispatchLiveBoundaryExpiredError();
    try {
      this.openWindow();
      live = this.memoize(this.liveSurfaces, args.liveCheckout, () =>
        this.fingerprintLiveCheckout(args.liveCheckout),
      );
      const providerKey = `${args.provider}\0${args.providerHome}`;
      provider = this.memoize(this.providerSurfaces, providerKey, () =>
        this.fingerprintProviderState({
          unrelatedProviderState: args.providerHome,
          provider: args.provider,
          selectedAuthPaths: args.selectedAuthPaths,
        }),
      );
      const [liveSurface, providerSurface] = await Promise.all([live.promise, provider.promise]);
      if (!active) throw new DispatchLiveBoundaryExpiredError();
      containment = this.memoize(this.containments, args.liveCheckout, () =>
        args.probe({
          surfaces: [liveSurface.surface, providerSurface.surface],
          measurements: [liveSurface.measurement, providerSurface.measurement],
        }),
      );
      const containmentResult = await containment.promise;
      if (!active) throw new DispatchLiveBoundaryExpiredError();
      await this.emitMeasurementsOnce([
        { cache: live, measurement: liveSurface.measurement },
        { cache: provider, measurement: providerSurface.measurement },
      ]);
      if (!active || this.ended) throw new DispatchLiveBoundaryExpiredError();
      this.leases += 1;
      let released = false;
      const lease = {
        containment: containmentResult,
        release: async () => {
          if (released) return;
          released = true;
          unregisterRevocation?.();
          this.leases -= 1;
          await this.finalizeIfReady();
        },
      };
      leaseGranted = true;
      releaseLease = lease.release;
      return lease;
    } finally {
      await finishAcquire();
      if (!leaseGranted) unregisterRevocation?.();
    }
  }

  async end({ waitForPending = true }: { waitForPending?: boolean } = {}): Promise<void> {
    this.ended = true;
    if (waitForPending && this.pendingAcquires > 0)
      await new Promise<void>((resolve) => this.acquireWaiters.push(resolve));
    await this.finalizeIfReady();
  }

  private openWindow(): void {
    if (!this.window && this.options.openWindow) {
      this.window = this.options.openWindow({ contained: false, reason: 'candidate preparing' });
    }
  }

  private memoize<T>(
    map: Map<string, CachedSurface<T>>,
    key: string,
    create: () => Promise<T>,
    evictOnReject = true,
  ): CachedSurface<T> {
    const existing = map.get(key);
    if (existing) return existing;
    const promise = create();
    const entry: CachedSurface<T> = { promise, settled: false, emitted: false, emission: undefined };
    map.set(key, entry);
    void promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    if (evictOnReject) {
      // Only the rejected entry itself may be evicted. A different acquire can
      // share a successful (or still pending) sibling surface safely.
      void promise.catch(() => {
        if (map.get(key)?.promise === promise) map.delete(key);
      });
    }
    return entry;
  }

  private evictPending<T>(map: Map<string, CachedSurface<T>>, key: string, entry: CachedSurface<T> | undefined): void {
    if (entry && !entry.settled && map.get(key) === entry) map.delete(key);
  }

  /**
   * Serializes reporting for cached surfaces.  A concurrent acquire waits for
   * an in-flight report instead of treating it as successful prematurely: if
   * the emitter rejects, its own acquisition rejects and the next successful
   * acquisition still reports the cached measurements.
   */
  private async emitMeasurementsOnce(
    entries: Array<{ cache: CachedSurface<unknown>; measurement: SurfaceResult['measurement'] }>,
  ): Promise<void> {
    const inFlight = [
      ...new Set(
        entries
          .map(({ cache }) => cache.emission)
          .filter((emission): emission is Promise<void> => emission !== undefined),
      ),
    ];
    if (inFlight.length > 0) {
      await Promise.all(inFlight);
      return this.emitMeasurementsOnce(entries);
    }
    const unreported = entries.filter(({ cache }) => !cache.emitted);
    if (unreported.length === 0) return;
    const emission = Promise.resolve(
      this.options.emit({
        type: 'self_host_boundary_fingerprint',
        surfaces: unreported.map(({ measurement }) => measurement),
      }),
    );
    for (const { cache } of unreported) cache.emission = emission;
    try {
      await emission;
      for (const { cache } of unreported) cache.emitted = true;
    } finally {
      for (const { cache } of unreported) {
        if (cache.emission === emission) cache.emission = undefined;
      }
    }
  }

  private async snapshot(): Promise<LiveBoundarySnapshot> {
    const liveEntries = [...this.liveSurfaces.entries()];
    const providerEntries = [...this.providerSurfaces.entries()];
    const surfaces = await Promise.all([
      ...liveEntries.map(([, surface]) => surface.promise),
      ...providerEntries.map(([, surface]) => surface.promise),
    ]);
    const containmentByLiveCheckout = new Map<string, ContainmentVerdict>();
    for (const [root, containment] of this.containments) containmentByLiveCheckout.set(root, await containment.promise);
    return {
      surfaces: surfaces.map(({ surface }) => surface),
      measurements: surfaces.map(({ measurement }) => measurement),
      containmentByLiveCheckout,
    };
  }

  private finalizeIfReady(): Promise<void> | undefined {
    if (this.verification) return this.verification;
    if (
      !this.ended ||
      this.leases !== 0 ||
      this.pendingAcquires !== 0 ||
      this.liveSurfaces.size + this.providerSurfaces.size === 0
    )
      return undefined;
    this.verification = this.finalize();
    return this.verification;
  }

  private async finalize(): Promise<void> {
    try {
      const containments = await Promise.all([...this.containments.values()].map((containment) => containment.promise));
      const result = await this.verify(await this.snapshot(), {
        contained: false,
        reason: 'containment not evaluated',
      });
      for (const containment of containments) {
        if (containment.contained) {
          await this.options.emit({
            type: 'self_host_containment_verdict',
            contained: true,
            evidence: containment.evidence,
          });
        } else {
          await this.options.emit({
            type: 'self_host_containment_verdict',
            contained: false,
            reason: containment.reason,
          });
        }
      }
      for (const drift of result.containedDrifts ?? [])
        await this.options.emit({
          type: 'contained_live_checkout_drift',
          evidence: drift.evidence,
          attribution: 'concurrent-operator',
          summary: drift.summary,
        });
      if (!result.ok) this.options.onViolation?.(result.reason ?? 'Live boundary could not be verified.');
    } catch {
      this.options.onViolation?.('Live boundary could not be verified.');
    } finally {
      this.window?.close();
      this.window = undefined;
    }
  }

  private closeIfUnused(): void {
    if (this.pendingAcquires === 0 && this.leases === 0 && this.liveSurfaces.size + this.providerSurfaces.size === 0) {
      this.window?.close();
      this.window = undefined;
    }
  }
}
