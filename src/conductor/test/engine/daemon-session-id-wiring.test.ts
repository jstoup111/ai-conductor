// Covers: task:3
import { describe, expect, it, vi } from 'vitest';
import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ProviderExecutionContext } from '../../src/engine/provider-execution.js';

describe('daemon dispatch session ID wiring', () => {
  it('forwards each newly minted feature scope session ID to its conductor worktree runner', async () => {
    const runConductor = vi.fn<FeatureRunnerDeps['runConductor']>(async () => undefined);
    const scopeSessionIds = ['scope-session-a', 'scope-session-b'];
    let nextScope = 0;
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
        sessionId: scopeSessionIds[nextScope++],
        stop: () => undefined,
      }),
    };

    const runFeature = makeRunFeature(deps);
    await runFeature({ slug: 'session-id-feature-a' } as BacklogItem);
    await runFeature({ slug: 'session-id-feature-b' } as BacklogItem);

    const dispatchedSessionIds = runConductor.mock.calls.map((call) => call[5]);
    expect(dispatchedSessionIds).toEqual(scopeSessionIds);
  });

});
