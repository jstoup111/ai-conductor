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
  private readonly liveSurfaces = new Map<string, Promise<SurfaceResult>>();
  private readonly providerSurfaces = new Map<string, Promise<ProviderSurfaceResult>>();
  private readonly containments = new Map<string, Promise<ContainmentVerdict>>();
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
    try {
      this.openWindow();
      const live = this.memoize(this.liveSurfaces, args.liveCheckout, () =>
        this.fingerprintLiveCheckout(args.liveCheckout),
      );
      const providerKey = `${args.provider}\0${args.providerHome}`;
      const provider = this.memoize(this.providerSurfaces, providerKey, () =>
        this.fingerprintProviderState({
          unrelatedProviderState: args.providerHome,
          provider: args.provider,
          selectedAuthPaths: args.selectedAuthPaths,
        }),
      );
      const [liveSurface, providerSurface] = await Promise.all([live.promise, provider.promise]);

      const snapshot = await this.snapshot();
      const containment = await this.memoize(this.containments, args.liveCheckout, () => args.probe(snapshot), false).promise;
      const measurements = [
        ...(live.created ? [liveSurface.measurement] : []),
        ...(provider.created ? [providerSurface.measurement] : []),
      ];
      if (measurements.length > 0) {
        await this.options.emit({ type: 'self_host_boundary_fingerprint', surfaces: measurements });
      }
      this.leases += 1;
      let released = false;
      const lease = {
        containment,
        release: async () => {
          if (released) return;
          released = true;
          this.leases -= 1;
          await this.finalizeIfReady();
        },
      };
      // A preparation timeout can finish the dispatch while its fingerprint is
      // still in flight. Once it settles, count the lease out before returning
      // it: no abandoned preparation may keep the admitted window open.
      if (this.ended) await lease.release();
      return lease;
    } finally {
      this.pendingAcquires -= 1;
      if (this.pendingAcquires === 0) {
        this.closeIfUnused();
        // Establish and await the shared finalization before releasing end()
        // callers. This makes its verdict, events and violation visible when
        // end() resolves, rather than a detached follow-on task.
        await this.finalizeIfReady();
        const waiters = this.acquireWaiters;
        this.acquireWaiters = [];
        for (const wake of waiters) wake();
      }
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
    map: Map<string, Promise<T>>,
    key: string,
    create: () => Promise<T>,
    evictOnReject = true,
  ): { promise: Promise<T>; created: boolean } {
    const existing = map.get(key);
    if (existing) return { promise: existing, created: false };
    const promise = create();
    map.set(key, promise);
    if (evictOnReject) {
      // Only the rejected entry itself may be evicted. A different acquire can
      // share a successful (or still pending) sibling surface safely.
      void promise.catch(() => {
        if (map.get(key) === promise) map.delete(key);
      });
    }
    return { promise, created: true };
  }

  private async snapshot(): Promise<LiveBoundarySnapshot> {
    const liveEntries = [...this.liveSurfaces.entries()];
    const providerEntries = [...this.providerSurfaces.entries()];
    const surfaces = await Promise.all([...liveEntries.map(([, surface]) => surface), ...providerEntries.map(([, surface]) => surface)]);
    const containmentByLiveCheckout = new Map<string, ContainmentVerdict>();
    for (const [root, containment] of this.containments) containmentByLiveCheckout.set(root, await containment);
    return {
      surfaces: surfaces.map(({ surface }) => surface),
      measurements: surfaces.map(({ measurement }) => measurement),
      containmentByLiveCheckout,
    };
  }

  private finalizeIfReady(): Promise<void> | undefined {
    if (this.verification) return this.verification;
    if (!this.ended || this.leases !== 0 || this.pendingAcquires !== 0 || this.liveSurfaces.size + this.providerSurfaces.size === 0)
      return undefined;
    this.verification = this.finalize();
    return this.verification;
  }

  private async finalize(): Promise<void> {
    try {
      const containments = await Promise.all(this.containments.values());
      const result = await this.verify(await this.snapshot(), { contained: false, reason: 'containment not evaluated' });
      for (const containment of containments) {
        if (containment.contained) {
          await this.options.emit({ type: 'self_host_containment_verdict', contained: true, evidence: containment.evidence });
        } else {
          await this.options.emit({ type: 'self_host_containment_verdict', contained: false, reason: containment.reason });
        }
      }
      if (result.containedDrift) {
        await this.options.emit({
          type: 'contained_live_checkout_drift',
          evidence: result.containedDrift.evidence,
          attribution: 'concurrent-operator',
          summary: result.containedDrift.summary,
        });
      }
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
