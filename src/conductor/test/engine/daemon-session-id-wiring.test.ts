// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';

describe('daemon dispatch session ID wiring', () => {
  it('forwards the feature scope session ID to the conductor worktree runner', async () => {
    const sessionId = 'dispatch-session-id';
    const runConductor = vi.fn<FeatureRunnerDeps['runConductor']>(async () => undefined);
    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: '/worktree', branch: 'feat/session-id' }),
      runConductor,
      readOutcome: async () => ({ done: false, halted: true }),
      teardownWorktree: async () => undefined,
      markProcessed: async () => undefined,
      daemon: false,
      project: 'test-project',
      beginFeatureRun: () => ({
        events: new ConductorEventEmitter(),
        providerExecution: {} as ProviderExecutionContext,
        sessionId,
        stop: () => undefined,
      }),
    };

    await makeRunFeature(deps)({ slug: 'session-id-feature' } as BacklogItem);

    expect(runConductor.mock.calls[0]?.[5]).toBe(sessionId);
  });

});
