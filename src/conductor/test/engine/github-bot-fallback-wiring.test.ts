import { describe, expect, it, vi } from 'vitest';

const createDaemonHaltPrOperations = vi.hoisted(() => vi.fn());

vi.mock('../../src/engine/daemon-halt-pr-operations.js', () => ({
  createDaemonHaltPrOperations,
}));

import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';
import { Conductor } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('GitHub bot fallback composition', () => {
  it('gives the feature runner halt-presentation operations the daemon event emitter', () => {
    const events = new ConductorEventEmitter();
    createDaemonHaltPrOperations.mockReturnValue(() => undefined);

    makeFeatureRunnerDeps({
      projectRoot: '/fixture',
      worktreeBase: '/fixture/.worktrees',
      baseBranch: 'main',
      events,
      runConductorInWorktree: async () => undefined,
    });

    expect(createDaemonHaltPrOperations).toHaveBeenCalledWith(expect.objectContaining({ events }));
  });

  it('gives daemon remediation escalation the conductor event emitter', async () => {
    const events = new ConductorEventEmitter();
    const escalateBuildFailure = vi.fn(async () => ({}));
    const conductor = new Conductor({
      stateFilePath: '/fixture/conduct-state.json',
      projectRoot: '/fixture',
      mode: 'auto',
      daemon: true,
      events,
      stepRunner: { run: async () => ({ success: true, output: '' }) },
      escalateBuildFailure,
    });

    await (conductor as unknown as { surfaceRemediationPr: (reason: string) => Promise<void> })
      .surfaceRemediationPr('halted');

    expect(escalateBuildFailure).toHaveBeenCalledWith(expect.objectContaining({
      projectRoot: '/fixture', failureReason: 'halted', events,
    }));
  });
});
