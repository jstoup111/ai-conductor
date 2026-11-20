// Covers: task:2
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DispatchLiveBoundary,
  DispatchLiveBoundaryExpiredError,
} from '../../../src/engine/self-host/dispatch-live-boundary.js';
import { LiveBoundaryCoordinator } from '../../../src/engine/self-host/live-boundary-coordinator.js';
import { verifyLiveBoundary } from '../../../src/engine/self-host/live-boundary.js';

const live = {
  surface: { root: '/live', label: 'live checkout', exclude: [], manifest: [] },
  measurement: { label: 'live checkout', elapsedMs: 1, fileCount: 0 },
};
const provider = (root: string) => ({
  surface: { root, label: 'provider state', exclude: [], manifest: [] },
  measurement: { label: 'provider state', elapsedMs: 1, fileCount: 0 },
});

function harness(overrides: Partial<ConstructorParameters<typeof DispatchLiveBoundary>[0]> = {}) {
  const fingerprintLiveCheckout = vi.fn(async () => live);
  const fingerprintProviderState = vi.fn(async ({ unrelatedProviderState }: { unrelatedProviderState: string }) =>
    provider(unrelatedProviderState),
  );
  const verify = vi.fn(async (_snapshot: Parameters<typeof verifyLiveBoundary>[0]) => ({ ok: true }));
  const probe = vi.fn(async () => ({ contained: true as const, evidence: 'contained' }));
  const events: unknown[] = [];
  const boundary = new DispatchLiveBoundary({
    emit: async (event) => {
      events.push(event);
    },
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
        const lease = await h.boundary.acquire({
          liveCheckout: '/live',
          providerHome: '/claude',
          provider: 'claude',
          probe: h.probe,
        });
        expect(lease.containment).toEqual({ contained: true, evidence: 'contained' });
        await lease.release();
      }
      await h.boundary.end();
    });
    expect(h.fingerprintLiveCheckout).toHaveBeenCalledOnce();
    expect(h.fingerprintProviderState).toHaveBeenCalledOnce();
    expect(h.probe).toHaveBeenCalledOnce();
    expect(h.verify).toHaveBeenCalledOnce();
    expect(h.events.filter((event: any) => event.type === 'self_host_boundary_fingerprint')).toEqual([
      { type: 'self_host_boundary_fingerprint', surfaces: [live.measurement, provider('/claude').measurement] },
    ]);
  });

  // Covers: task:2
  it('adds only a provider-state measurement for a second provider home', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let h!: ReturnType<typeof harness>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow });
      const first = await h.boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/claude',
        provider: 'claude',
        probe: h.probe,
      });
      await first.release();
      const second = await h.boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/codex',
        provider: 'codex',
        probe: h.probe,
      });
      await second.release();
      await h.boundary.end();
    });
    expect(h.fingerprintLiveCheckout).toHaveBeenCalledOnce();
    expect(h.fingerprintProviderState).toHaveBeenCalledTimes(2);
    expect(h.verify).toHaveBeenCalledOnce();
    expect(h.verify.mock.calls[0]?.[0].surfaces).toHaveLength(3);
    expect(h.events.filter((event: any) => event.type === 'self_host_boundary_fingerprint')).toEqual([
      { type: 'self_host_boundary_fingerprint', surfaces: [live.measurement, provider('/claude').measurement] },
      { type: 'self_host_boundary_fingerprint', surfaces: [provider('/codex').measurement] },
    ]);
  });

  // Covers: task:2
  it('shares a pending live-checkout fingerprint among concurrent acquires', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let resolveLive!: () => void;
    const waitingLive = new Promise<typeof live>((resolve) => {
      resolveLive = () => resolve(live);
    });
    const fingerprintLiveCheckout = vi.fn(() => waitingLive);
    let h!: ReturnType<typeof harness>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow, fingerprintLiveCheckout });
      const leases = [0, 1, 2, 3].map(() =>
        h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe }),
      );
      await Promise.resolve();
      expect(fingerprintLiveCheckout).toHaveBeenCalledOnce();
      resolveLive();
      for (const lease of await Promise.all(leases)) await lease.release();
      await h.boundary.end();
    });
    expect(fingerprintLiveCheckout).toHaveBeenCalledOnce();
  });

  // Covers: task:2
  it('retries a rejected first fingerprint without leaving a coordinator window', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const fingerprintLiveCheckout = vi.fn().mockRejectedValueOnce(new Error('walk failed')).mockResolvedValueOnce(live);
    let h!: ReturnType<typeof harness>;
    const mutation = vi.fn(async () => undefined);
    let queuedMutation!: Promise<void>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow, fingerprintLiveCheckout });
      await expect(
        h.boundary.acquire({ liveCheckout: '/live', providerHome: '/claude', provider: 'claude', probe: h.probe }),
      ).rejects.toThrow('walk failed');
      queuedMutation = coordinator.runMutation(mutation);
      const lease = await h.boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/claude',
        provider: 'claude',
        probe: h.probe,
      });
      await lease.release();
      await h.boundary.end();
    });
    await queuedMutation;
    expect(mutation).toHaveBeenCalledOnce();
    expect(fingerprintLiveCheckout).toHaveBeenCalledTimes(2);
    expect(h.events.filter((event: any) => event.type === 'self_host_boundary_fingerprint')).toEqual([
      { type: 'self_host_boundary_fingerprint', surfaces: [live.measurement, provider('/claude').measurement] },
    ]);
  });

  // Covers: task:2
  it('starts a fresh fingerprint when revocation abandons a stalled acquire', async () => {
    let revoke!: () => void;
    const never = new Promise<typeof live>(() => {});
    const fingerprintLiveCheckout = vi.fn().mockReturnValueOnce(never).mockResolvedValueOnce(live);
    const h = harness({ fingerprintLiveCheckout });
    const stale = h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/claude',
      provider: 'claude',
      onRevoked: (callback) => {
        revoke = callback;
        return () => {};
      },
      probe: h.probe,
    });
    await Promise.resolve();
    revoke();
    const replacement = await h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/claude',
      provider: 'claude',
      probe: h.probe,
    });
    await replacement.release();
    await h.boundary.end();
    expect(fingerprintLiveCheckout).toHaveBeenCalledTimes(2);
    void stale.catch(() => {});
  });

  // Covers: task:2, task:3
  it('retains a shared live surface when a sibling provider fingerprint rejects', async () => {
    let resolveLive!: () => void;
    const waitingLive = new Promise<typeof live>((resolve) => {
      resolveLive = () => resolve(live);
    });
    const fingerprintLiveCheckout = vi.fn(() => waitingLive);
    const fingerprintProviderState = vi.fn(async ({ unrelatedProviderState }: { unrelatedProviderState: string }) => {
      if (unrelatedProviderState === '/failed') throw new Error('provider walk failed');
      return provider(unrelatedProviderState);
    });
    const verify = vi.fn(async (snapshot: Parameters<typeof verifyLiveBoundary>[0]) => {
      expect(snapshot.surfaces.map((surface) => surface.root)).toContain('/live');
      return { ok: false, reason: 'live checkout drift reported' };
    });
    const violations: string[] = [];
    const h = harness({
      fingerprintLiveCheckout,
      fingerprintProviderState,
      verify,
      onViolation: (reason) => violations.push(reason),
    });
    const failed = h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/failed',
      provider: 'claude',
      probe: h.probe,
    });
    const succeeding = h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/good',
      provider: 'claude',
      probe: h.probe,
    });
    await Promise.resolve();
    resolveLive();
    await expect(failed).rejects.toThrow('provider walk failed');
    const lease = await succeeding;
    await lease.release();
    await h.boundary.end();
    expect(fingerprintLiveCheckout).toHaveBeenCalledOnce();
    expect(verify).toHaveBeenCalledOnce();
    expect(violations).toEqual(['live checkout drift reported']);
  });

  // Covers: task:2
  it('does not await a sibling candidate with a different live checkout or pending provider state', async () => {
    let resolvePending!: () => void;
    const pendingProvider = new Promise<ReturnType<typeof provider>>((resolve) => {
      resolvePending = () => resolve(provider('/pending-home'));
    });
    const fingerprintProviderState = vi.fn(({ unrelatedProviderState }: { unrelatedProviderState: string }) =>
      unrelatedProviderState === '/pending-home' ? pendingProvider : Promise.resolve(provider(unrelatedProviderState)),
    );
    const h = harness({ fingerprintProviderState });
    const sibling = h.boundary.acquire({
      liveCheckout: '/sibling-live',
      providerHome: '/pending-home',
      provider: 'claude',
      probe: h.probe,
    });
    const lease = await h.boundary.acquire({
      liveCheckout: '/ready-live',
      providerHome: '/ready-home',
      provider: 'claude',
      probe: h.probe,
    });
    expect(lease.containment).toEqual({ contained: true, evidence: 'contained' });
    await lease.release();
    resolvePending();
    await (await sibling).release();
    await h.boundary.end();
  });

  // Covers: task:3
  it('waits for a pending acquire to settle before end reports its single verification', async () => {
    let rejectProvider!: (error: Error) => void;
    const pendingProvider = new Promise<ReturnType<typeof provider>>((_, reject) => {
      rejectProvider = reject;
    });
    const fingerprintProviderState = vi
      .fn()
      .mockResolvedValueOnce(provider('/baseline'))
      .mockReturnValueOnce(pendingProvider);
    const violations: string[] = [];
    const h = harness({
      fingerprintProviderState,
      verify: async () => ({ ok: false, reason: 'verification completed' }),
      onViolation: (reason) => violations.push(reason),
    });
    const baseline = await h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/baseline',
      provider: 'claude',
      probe: h.probe,
    });
    await baseline.release();
    const pending = h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/pending',
      provider: 'claude',
      probe: h.probe,
    });
    const ending = h.boundary.end();
    await Promise.resolve();
    expect(violations).toEqual([]);
    rejectProvider(new Error('pending fingerprint failed'));
    await expect(pending).rejects.toThrow('pending fingerprint failed');
    await ending;
    expect(violations).toEqual(['verification completed']);
    expect(h.events.filter((event: any) => event.type === 'self_host_containment_verdict')).toHaveLength(1);
  });

  // Covers: task:3
  it('releases a revoked lease so end reports its one violation after a replacement', async () => {
    let revoke!: () => void;
    const violations: string[] = [];
    const verify = vi.fn(async () => ({ ok: false as const, reason: 'drift found' }));
    const h = harness({
      verify,
      onViolation: (reason) => violations.push(reason),
    });
    const stale = await h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/claude',
      provider: 'claude',
      onRevoked: (callback) => {
        revoke = callback;
        return () => {};
      },
      probe: h.probe,
    });
    revoke();
    await Promise.resolve();
    const replacement = await h.boundary.acquire({
      liveCheckout: '/live',
      providerHome: '/claude',
      provider: 'claude',
      probe: h.probe,
    });
    await replacement.release();
    await h.boundary.end();
    await stale.release();
    expect(verify).toHaveBeenCalledOnce();
    expect(violations).toEqual(['drift found']);
  });

  // Covers: task:3, task:4
  it('lets a timed-out supervisor end without waiting for a pending fingerprint', async () => {
    let resolveProvider!: () => void;
    const pendingProvider = new Promise<ReturnType<typeof provider>>((resolve) => {
      resolveProvider = () => resolve(provider('/provider'));
    });
    const coordinator = new LiveBoundaryCoordinator();
    let h!: ReturnType<typeof harness>;
    let pending!: ReturnType<DispatchLiveBoundary['acquire']>;
    await coordinator.runDispatch(async (openWindow) => {
      h = harness({ openWindow, fingerprintProviderState: vi.fn(() => pendingProvider) });
      pending = h.boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/provider',
        provider: 'claude',
        probe: h.probe,
      });
      await h.boundary.end({ waitForPending: false });
    });
    expect(h.verify).not.toHaveBeenCalled();
    const mutation = vi.fn(async () => undefined);
    const queuedMutation = coordinator.runMutation(mutation);
    await Promise.resolve();
    expect(mutation).not.toHaveBeenCalled();
    resolveProvider();
    await expect(pending).rejects.toBeInstanceOf(DispatchLiveBoundaryExpiredError);
    expect(h.verify).toHaveBeenCalledOnce();
    await queuedMutation;
    expect(mutation).toHaveBeenCalledOnce();
  });

  // Covers: task:2, task:3
  it("uses each live checkout root's own containment verdict at final verification", async () => {
    const root = await mkdtemp(join(tmpdir(), 'dispatch-live-boundary-per-root-'));
    const first = join(root, 'first');
    const second = join(root, 'second');
    const providerHome = join(root, 'provider');
    const violations: string[] = [];
    try {
      await Promise.all([mkdir(first), mkdir(second), mkdir(providerHome)]);
      const boundary = new DispatchLiveBoundary({
        emit: async () => undefined,
        onViolation: (reason) => violations.push(reason),
      });
      const firstLease = await boundary.acquire({
        liveCheckout: first,
        providerHome,
        provider: 'claude',
        probe: async () => ({ contained: true, evidence: 'first contained' }),
      });
      const secondLease = await boundary.acquire({
        liveCheckout: second,
        providerHome,
        provider: 'claude',
        probe: async () => ({ contained: false, reason: 'second unproven' }),
      });
      await writeFile(join(second, 'escaped.txt'), 'drift');
      await boundary.end();
      await firstLease.release();
      await secondLease.release();
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('second unproven');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  // Covers: task:3
  it('defers verification until an ended dispatch releases its final lease and reports real drift', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dispatch-live-boundary-held-'));
    const liveRoot = join(root, 'live');
    const providerHome = join(root, 'provider');
    await Promise.all([mkdir(liveRoot), mkdir(providerHome)]);
    const coordinator = new LiveBoundaryCoordinator();
    const verify = vi.fn(verifyLiveBoundary);
    const violations: string[] = [];
    let boundary!: DispatchLiveBoundary;
    let lease!: Awaited<ReturnType<DispatchLiveBoundary['acquire']>>;
    try {
      await coordinator.runDispatch(async (openWindow) => {
        boundary = new DispatchLiveBoundary({
          openWindow,
          emit: async () => undefined,
          verify,
          onViolation: (reason) => violations.push(reason),
        });
        lease = await boundary.acquire({
          liveCheckout: liveRoot,
          providerHome,
          provider: 'claude',
          probe: async () => ({ contained: false, reason: 'unproven' }),
        });
      });
      await boundary.end();
      expect(verify).not.toHaveBeenCalled();
      await writeFile(join(liveRoot, 'escaped.txt'), 'drift');
      await lease.release();
      expect(violations).toHaveLength(1);
      expect(violations[0]).toContain('added escaped.txt');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:3
  it('holds the coordinator window until pending verification resolves', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    let resolveVerify!: () => void;
    const pendingVerify = new Promise<{ ok: true }>((resolve) => {
      resolveVerify = () => resolve({ ok: true });
    });
    let boundary!: DispatchLiveBoundary;
    let lease!: Awaited<ReturnType<DispatchLiveBoundary['acquire']>>;
    await coordinator.runDispatch(async (openWindow) => {
      boundary = new DispatchLiveBoundary({
        openWindow,
        emit: async () => undefined,
        verify: vi.fn(() => pendingVerify),
      });
      lease = await boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/provider',
        provider: 'claude',
        probe: async () => ({ contained: true, evidence: 'contained' }),
      });
    });
    const mutated = vi.fn(async () => undefined);
    const queuedMutation = coordinator.runMutation(mutated);
    await boundary.end();
    const released = lease.release();
    await Promise.resolve();
    expect(mutated).not.toHaveBeenCalled();
    resolveVerify();
    await released;
    await queuedMutation;
    expect(mutated).toHaveBeenCalledOnce();
  });

  // Covers: task:3
  it('verifies once and releases the window when a candidate lease is released without invocation', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const verify = vi.fn(async () => ({ ok: true }));
    let boundary!: DispatchLiveBoundary;
    let lease!: Awaited<ReturnType<DispatchLiveBoundary['acquire']>>;
    await coordinator.runDispatch(async (openWindow) => {
      boundary = new DispatchLiveBoundary({ openWindow, emit: async () => undefined, verify });
      lease = await boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/provider',
        provider: 'claude',
        probe: async () => ({ contained: false, reason: 'unproven' }),
      });
    });
    const mutated = vi.fn(async () => undefined);
    const queuedMutation = coordinator.runMutation(mutated);
    await boundary.end();
    await lease.release();
    await queuedMutation;
    expect(verify).toHaveBeenCalledOnce();
    expect(mutated).toHaveBeenCalledOnce();
  });

  // Covers: task:3
  it('does not report a live-checkout change restored before verification', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dispatch-live-boundary-restored-'));
    const liveRoot = join(root, 'live');
    const providerHome = join(root, 'provider');
    await mkdir(liveRoot);
    await Promise.all([mkdir(providerHome), writeFile(join(liveRoot, 'source.txt'), 'original')]);
    const violations: string[] = [];
    const coordinator = new LiveBoundaryCoordinator();
    let boundary!: DispatchLiveBoundary;
    let lease!: Awaited<ReturnType<DispatchLiveBoundary['acquire']>>;
    try {
      await coordinator.runDispatch(async (openWindow) => {
        boundary = new DispatchLiveBoundary({
          openWindow,
          emit: async () => undefined,
          onViolation: (reason) => violations.push(reason),
        });
        lease = await boundary.acquire({
          liveCheckout: liveRoot,
          providerHome,
          provider: 'claude',
          probe: async () => ({ contained: false, reason: 'unproven' }),
        });
      });
      await writeFile(join(liveRoot, 'source.txt'), 'changed');
      await writeFile(join(liveRoot, 'source.txt'), 'original');
      await boundary.end();
      await lease.release();
      expect(violations).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:3
  it('reports contained live-checkout drift without a violation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dispatch-live-boundary-contained-'));
    const liveRoot = join(root, 'live');
    const providerHome = join(root, 'provider');
    await Promise.all([mkdir(liveRoot), mkdir(providerHome)]);
    const events: unknown[] = [];
    const violations: string[] = [];
    const coordinator = new LiveBoundaryCoordinator();
    let boundary!: DispatchLiveBoundary;
    let lease!: Awaited<ReturnType<DispatchLiveBoundary['acquire']>>;
    try {
      await coordinator.runDispatch(async (openWindow) => {
        boundary = new DispatchLiveBoundary({
          openWindow,
          emit: async (event) => {
            events.push(event);
          },
          onViolation: (reason) => violations.push(reason),
        });
        lease = await boundary.acquire({
          liveCheckout: liveRoot,
          providerHome,
          provider: 'claude',
          probe: async () => ({ contained: true, evidence: 'bwrap' }),
        });
      });
      await writeFile(join(liveRoot, 'operator.txt'), 'drift');
      await boundary.end();
      await lease.release();
      expect(events.filter((event: any) => event.type === 'self_host_containment_verdict')).toEqual([
        { type: 'self_host_containment_verdict', contained: true, evidence: 'bwrap' },
      ]);
      expect(events.filter((event: any) => event.type === 'contained_live_checkout_drift')).toHaveLength(1);
      expect(violations).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:3
  it('reports each drifted contained live-checkout root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dispatch-live-boundary-two-contained-'));
    const first = join(root, 'first');
    const second = join(root, 'second');
    const providerHome = join(root, 'provider');
    const events: any[] = [];
    try {
      await Promise.all([mkdir(first), mkdir(second), mkdir(providerHome)]);
      const boundary = new DispatchLiveBoundary({
        emit: async (event) => {
          events.push(event);
        },
      });
      const firstLease = await boundary.acquire({
        liveCheckout: first,
        providerHome,
        provider: 'claude',
        probe: async () => ({ contained: true, evidence: 'first containment' }),
      });
      const secondLease = await boundary.acquire({
        liveCheckout: second,
        providerHome,
        provider: 'claude',
        probe: async () => ({ contained: true, evidence: 'second containment' }),
      });
      await Promise.all([writeFile(join(first, 'first.txt'), 'drift'), writeFile(join(second, 'second.txt'), 'drift')]);
      await boundary.end();
      await firstLease.release();
      await secondLease.release();
      expect(events.filter((event) => event.type === 'contained_live_checkout_drift')).toEqual([
        expect.objectContaining({ evidence: 'first containment', summary: expect.stringContaining('added first.txt') }),
        expect.objectContaining({
          evidence: 'second containment',
          summary: expect.stringContaining('added second.txt'),
        }),
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  // Covers: task:3
  it('reports verification failure and closes the coordinator window', async () => {
    const coordinator = new LiveBoundaryCoordinator();
    const violations: string[] = [];
    let boundary!: DispatchLiveBoundary;
    let lease!: Awaited<ReturnType<DispatchLiveBoundary['acquire']>>;
    await coordinator.runDispatch(async (openWindow) => {
      boundary = new DispatchLiveBoundary({
        openWindow,
        emit: async () => undefined,
        verify: async () => {
          throw new Error('verify failed');
        },
        onViolation: (reason) => violations.push(reason),
      });
      lease = await boundary.acquire({
        liveCheckout: '/live',
        providerHome: '/provider',
        provider: 'claude',
        probe: async () => ({ contained: false, reason: 'unproven' }),
      });
    });
    await boundary.end();
    await lease.release();
    expect(violations).toEqual(['Live boundary could not be verified.']);
    await expect(coordinator.runMutation(async () => 'released')).resolves.toBe('released');
  });
});
