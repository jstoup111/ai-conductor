// Covers: task:2
import { describe, expect, it, vi } from 'vitest';
import { DispatchLiveBoundary } from '../../../src/engine/self-host/dispatch-live-boundary.js';
import { LiveBoundaryCoordinator } from '../../../src/engine/self-host/live-boundary-coordinator.js';

const live = { surface: { root: '/live', label: 'live checkout', exclude: [], manifest: [] }, measurement: { label: 'live checkout', elapsedMs: 1, fileCount: 0 } };
const provider = (root: string) => ({ surface: { root, label: 'provider state', exclude: [], manifest: [] }, measurement: { label: 'provider state', elapsedMs: 1, fileCount: 0 } });

function harness(overrides: Partial<ConstructorParameters<typeof DispatchLiveBoundary>[0]> = {}) {
  const fingerprintLiveCheckout = vi.fn(async () => live);
  const fingerprintProviderState = vi.fn(async ({ unrelatedProviderState }: { unrelatedProviderState: string }) => provider(unrelatedProviderState));
  const verify = vi.fn(async () => ({ ok: true }));
  const probe = vi.fn(async () => ({ contained: true as const, evidence: 'contained' }));
  const events: unknown[] = [];
  const boundary = new DispatchLiveBoundary({
    emit: async event => { events.push(event); },
    fingerprintLiveCheckout,
    fingerprintProviderState,
    verify,
    ...overrides,
  });
  return { boundary, events, fingerprintLiveCheckout, fingerprintProviderState, verify, probe };
}

describe('DispatchLiveBoundary', () => {
  // Covers: task:2
  it('shares one snapshot for four sequential leases of one provider', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let h!: ReturnType<typeof harness>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow });
      for (let index = 0; index < 4; index += 1) {
        const lease = await h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe });
        expect(lease.containment).toEqual({ contained: true, evidence: 'contained' });
        lease.release();
      }
      await h.boundary.end();
    });
    expect(h.fingerprintLiveCheckout).toHaveBeenCalledOnce();
    expect(h.fingerprintProviderState).toHaveBeenCalledOnce();
    expect(h.probe).toHaveBeenCalledOnce();
    expect(h.verify).toHaveBeenCalledOnce();
    expect(h.events).toEqual([{ type: 'self_host_boundary_fingerprint', surfaces: [live.measurement, provider('/claude').measurement] }]);
  });

  // Covers: task:2
  it('adds only a provider-state measurement for a second provider home', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let h!: ReturnType<typeof harness>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow });
      const first = await h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe });
      first.release();
      const second = await h.boundary.acquire({ liveCheckout: '/live', providerHome: '/codex', provider: 'codex', probe: h.probe });
      second.release();
      await h.boundary.end();
    });
    expect(h.fingerprintLiveCheckout).toHaveBeenCalledOnce();
    expect(h.fingerprintProviderState).toHaveBeenCalledTimes(2);
    expect(h.verify).toHaveBeenCalledOnce();
    expect(h.verify.mock.calls[0]?.[0].surfaces).toHaveLength(3);
    expect(h.events).toEqual([
      { type: 'self_host_boundary_fingerprint', surfaces: [live.measurement, provider('/claude').measurement] },
      { type: 'self_host_boundary_fingerprint', surfaces: [provider('/codex').measurement] },
    ]);
  });

  // Covers: task:2
  it('shares a pending live-checkout fingerprint among concurrent acquires', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let resolveLive!: () => void;
    const waitingLive = new Promise<typeof live>((resolve) => { resolveLive = () => resolve(live); });
    const fingerprintLiveCheckout = vi.fn(() => waitingLive);
    let h!: ReturnType<typeof harness>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow, fingerprintLiveCheckout });
      const leases = [0, 1, 2, 3].map(() => h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe }));
      await Promise.resolve();
      expect(fingerprintLiveCheckout).toHaveBeenCalledOnce();
      resolveLive();
      for (const lease of await Promise.all(leases)) lease.release();
      await h.boundary.end();
    });
    expect(fingerprintLiveCheckout).toHaveBeenCalledOnce();
  });

  // Covers: task:2
  it('retries a rejected first fingerprint without leaving a coordinator window', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const fingerprintLiveCheckout = vi.fn()
      .mockRejectedValueOnce(new Error('walk failed'))
      .mockResolvedValueOnce(live);
    let h!: ReturnType<typeof harness>;
    const mutation = vi.fn(async () => undefined);
    let queuedMutation!: Promise<void>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow, fingerprintLiveCheckout });
      await expect(h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe })).rejects.toThrow('walk failed');
      queuedMutation = coordinator.runMutation(mutation);
      const lease = await h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe });
      lease.release();
      await h.boundary.end();
    });
    await queuedMutation;
    expect(mutation).toHaveBeenCalledOnce();
    expect(fingerprintLiveCheckout).toHaveBeenCalledTimes(2);
    expect(h.events).toEqual([{ type: 'self_host_boundary_fingerprint', surfaces: [live.measurement, provider('/claude').measurement] }]);
  });

  // Covers: task:2
  it('does nothing when ended without an acquire', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let h!: ReturnType<typeof harness>;
    const mutation = vi.fn(async () => undefined);
    let queuedMutation!: Promise<void>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow });
      await h.boundary.end();
      queuedMutation = coordinator.runMutation(mutation);
    });
    await queuedMutation;
    expect(h.fingerprintLiveCheckout).not.toHaveBeenCalled();
    expect(h.fingerprintProviderState).not.toHaveBeenCalled();
    expect(h.probe).not.toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.events).toEqual([]);
    expect(mutation).toHaveBeenCalledOnce();
  });
});
