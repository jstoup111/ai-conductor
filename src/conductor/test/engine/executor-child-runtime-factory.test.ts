import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConductorEventEmitter } from '../../src/engine/conductor-event-emitter.js';
import { createExecutorChildRuntime } from '../../src/engine/executor-child-runtime.js';
import type { ExecutorChildRunInput } from '../../src/engine/executor-child.js';
import type { WorkOrder } from '../../src/engine/work-order.js';

const installDaemonProcessServices = vi.hoisted(() => vi.fn());

vi.mock('../../src/engine/daemon-process-bootstrap.js', () => ({ installDaemonProcessServices }));

const order: WorkOrder = {
  schemaVersion: 1,
  repository: 'repo',
  slug: 'feature',
  baseSha: 'a'.repeat(40),
  engineVersionId: '20261107T000000Z-0123456789ab' as WorkOrder['engineVersionId'],
  manifest: [],
};

function stoppedInput(): ExecutorChildRunInput {
  return {
    order,
    engineVersionId: 'dev',
    events: new ConductorEventEmitter(),
    signal: AbortSignal.abort('test stop'),
  } as ExecutorChildRunInput;
}

describe('createExecutorChildRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['install', 1],
    ['inherited', 0],
  ] as const)('installs process services %s exactly %i time(s)', async (processServices, installs) => {
    const runtime = createExecutorChildRuntime({ projectRoot: '/project', processServices });

    expect(runtime).toMatchObject({
      admitDispatch: expect.any(Function),
      createWorktree: expect.any(Function),
      run: expect.any(Function),
    });

    await expect(runtime.run(stoppedInput())).resolves.toEqual({
      slug: order.slug,
      status: 'parked',
      reason: 'test stop',
    });
    expect(installDaemonProcessServices).toHaveBeenCalledTimes(installs);
  });

  it('requires an explicit process-services mode', () => {
    // @ts-expect-error processServices makes the process-global ownership explicit.
    createExecutorChildRuntime({ projectRoot: '/project' });
  });
});
