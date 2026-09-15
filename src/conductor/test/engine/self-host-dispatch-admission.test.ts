import { afterEach, describe, expect, it, vi } from 'vitest';
import { Conductor, type StepRunResult, type StepRunner } from '../../src/engine/conductor.js';
import { LiveBoundaryCoordinator } from '../../src/engine/self-host/live-boundary-coordinator.js';
import { createProviderLifecycleSupervisor, systemProviderLifecycleTimer } from '../../src/engine/provider-lifecycle.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';
import type { SelfHostGuardrails } from '../../src/engine/self-host/wiring.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';

vi.mock('../../src/engine/self-host/live-boundary.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/self-host/live-boundary.js')>(),
  fingerprintLiveBoundary: vi.fn(async () => ({})),
  verifyLiveBoundary: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../src/engine/self-host/build-auth-preflight.js', () => ({
  preflightBuildAuthCheck: vi.fn(async () => undefined),
}));

afterEach(() => vi.useRealTimers());

describe('self-host dispatch admission', () => {
  it.each([false, true])('queues outside preparation and respects a subsequent park: %s', async (parkWhileQueued) => {
    let parked = false;
    vi.useFakeTimers();
    const coordinator = new LiveBoundaryCoordinator();
    const active = await coordinator.openWindow({ contained: false, reason: 'earlier build' });
    const order: string[] = [];
    const mutation = coordinator.runMutation(async () => { order.push('root refreshed'); });
    const providerExecution = {} as ProviderExecutionContext;
    const teardown = vi.fn(async () => undefined);
    const events = new ConductorEventEmitter();
    const admissions: string[] = [];
    events.on('self_host_dispatch_admission', (event) => { if (event.type === 'self_host_dispatch_admission') admissions.push(event.state); });
    const runner: StepRunner = {
      run: vi.fn(async () => {
        order.push('preparing');
        const supervisor = createProviderLifecycleSupervisor({
          attempt: { logicalStep: 'build', id: 'first-attempt' }, recoveryCount: 0,
          preparationTimeoutMinutes: 5, timer: systemProviderLifecycleTimer,
        });
        const result = await supervisor.supervise(async (lease) => {
          const prepared = await providerExecution.prepareCandidateSelfHost!(
            { step: 'build', providerKey: 'claude', model: 'opus', effort: 'high' },
            { provider: {} } as never,
            { runId: 'admission-test', attempt: 1 },
          );
          try {
            expect(lease.spawnPermit()).toEqual({ permitted: true });
            order.push('spawned');
            return { success: true };
          } finally { await prepared!.teardown(); }
        });
        if ('kind' in result) throw new Error('unexpected preparation halt');
        return result;
      }),
    };
    const guardrails = {
      resolveInstalledHarnessRoot: vi.fn(async () => ({ status: 'ok', root: '/test/live-root' })),
      provisionSandbox: vi.fn(async () => ({ childEnv: () => ({}), teardown })),
    } as unknown as SelfHostGuardrails;
    const conductor = new Conductor({
      stateFilePath: '/test/worktree/conduct-state.json', projectRoot: '/test/worktree',
      events, stepRunner: runner, daemon: true, selfHost: true,
      featureSlug: 'admission-test', providerExecution, selfHostGuardrails: guardrails,
      liveBoundaryCoordinator: coordinator, operatorParkBoundary: async () => parked,
      config: { llm_provider: 'claude', harness_self_host: { live_containment: false, build_auth: { mode: 'api-key' } } },
    });
    // Exercise the dispatch entry directly; no unrelated SDLC steps or external providers run.
    const dispatch = (conductor as unknown as {
      runSelfBuildDispatch(step: 'build', state: ConductState, hint?: string): Promise<StepRunResult>;
    }).runSelfBuildDispatch('build', { feature_desc: 'admission-test' } as ConductState);
    void dispatch.catch(() => undefined); // Observe failure even while the queue is held.
    try {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
      expect(runner.run).not.toHaveBeenCalled();
      expect(admissions).toEqual(['queued']);
      expect(guardrails.provisionSandbox).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      parked = parkWhileQueued;
      active.close();
      await mutation;
      if (parkWhileQueued) {
        await expect(dispatch).resolves.toEqual({ success: false, operatorParkedBeforeDispatch: true });
        expect(admissions).toEqual(['queued', 'cancelled']);
        expect(runner.run).not.toHaveBeenCalled();
        await expect(coordinator.runMutation(async () => 'released')).resolves.toBe('released');
        return;
      }
      await expect(dispatch).resolves.toEqual({ success: true });
      expect(admissions).toEqual(['queued', 'admitted']);
      expect(order).toEqual(['root refreshed', 'preparing', 'spawned']);
      expect(runner.run).toHaveBeenCalledOnce();
      expect(teardown).toHaveBeenCalledOnce();
      await expect(coordinator.runMutation(async () => 'released')).resolves.toBe('released');
    } finally {
      active.close();
      await Promise.allSettled([mutation, dispatch]);
    }
  });
});
