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

type DispatchLiveBoundaryEvent = Extract<ConductorEvent, {
  type: 'self_host_boundary_fingerprint' | 'self_host_containment_verdict' | 'contained_live_checkout_drift';
}>;
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
  private window: LiveBoundaryWindow | undefined;
  private containment: Promise<ContainmentVerdict> | undefined;
  private leases = 0;
  private pendingAcquires = 0;
  private acquireWaiters: Array<() => void> = [];
  private ended = false;
  private verified = false;

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
    const live = this.memoize(this.liveSurfaces, args.liveCheckout, () => this.fingerprintLiveCheckout(args.liveCheckout));
    const providerKey = `${args.provider}\0${args.providerHome}`;
    const provider = this.memoize(this.providerSurfaces, providerKey, () => this.fingerprintProviderState({
      unrelatedProviderState: args.providerHome,
      provider: args.provider,
      selectedAuthPaths: args.selectedAuthPaths,
    }));
    let liveSurface: SurfaceResult;
    let providerSurface: ProviderSurfaceResult;
    try {
      [liveSurface, providerSurface] = await Promise.all([live.promise, provider.promise]);
    } catch (error) {
      if (live.created) this.liveSurfaces.delete(args.liveCheckout);
      if (provider.created) this.providerSurfaces.delete(providerKey);
      throw error;
    }

    const snapshot = await this.snapshot();
    if (!this.containment) this.containment = args.probe(snapshot);
    const containment = await this.containment;
    const measurements = [
      ...(live.created ? [liveSurface.measurement] : []),
      ...(provider.created ? [providerSurface.measurement] : []),
    ];
    if (measurements.length > 0) {
      await this.options.emit({ type: 'self_host_boundary_fingerprint', surfaces: measurements });
    }
    this.leases += 1;
    let released = false;
    return {
      containment,
      release: async () => {
        if (released) return;
        released = true;
        this.leases -= 1;
        await this.verifyIfReady();
      },
    };
    } finally {
      this.pendingAcquires -= 1;
      if (this.pendingAcquires === 0) {
        const waiters = this.acquireWaiters;
        this.acquireWaiters = [];
        for (const wake of waiters) wake();
      }
      this.closeIfUnused();
      void this.verifyIfReady();
    }
  }

  async end(): Promise<void> {
    this.ended = true;
    if (this.pendingAcquires > 0) await new Promise<void>((resolve) => this.acquireWaiters.push(resolve));
    await this.verifyIfReady();
  }

  private openWindow(): void {
    if (!this.window && this.options.openWindow) {
      this.window = this.options.openWindow({ contained: false, reason: 'candidate preparing' });
    }
  }

  private memoize<T>(map: Map<string, Promise<T>>, key: string, create: () => Promise<T>): { promise: Promise<T>; created: boolean } {
    const existing = map.get(key);
    if (existing) return { promise: existing, created: false };
    const promise = create();
    map.set(key, promise);
    return { promise, created: true };
  }

  private async snapshot(): Promise<LiveBoundarySnapshot> {
    const surfaces = await Promise.all([...this.liveSurfaces.values(), ...this.providerSurfaces.values()]);
    return {
      surfaces: surfaces.map(({ surface }) => surface),
      measurements: surfaces.map(({ measurement }) => measurement),
    };
  }

  private async verifyIfReady(): Promise<void> {
    if (!this.ended || this.leases !== 0 || this.verified || this.liveSurfaces.size + this.providerSurfaces.size === 0) return;
    this.verified = true;
    try {
      const containment = await this.containment!;
      const result = await this.verify(await this.snapshot(), containment);
      if (containment.contained) {
        await this.options.emit({ type: 'self_host_containment_verdict', contained: true, evidence: containment.evidence });
      } else {
        await this.options.emit({ type: 'self_host_containment_verdict', contained: false, reason: containment.reason });
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
