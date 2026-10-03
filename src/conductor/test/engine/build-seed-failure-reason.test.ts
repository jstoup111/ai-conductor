import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const seedMock = vi.fn();
vi.mock('../../src/engine/task-seed.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/task-seed.js')>();
  return { ...actual, seedTaskStatus: (...args: unknown[]) => seedMock(...args) };
});

const { CUSTOM_COMPLETION_PREDICATES } = await import('../../src/engine/artifacts.js');
const { TaskReopenError } = await import('../../src/engine/task-seed.js');

describe('build completion: seedTaskStatus failure reason', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-seed-reason-'));
    seedMock.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  const run = () =>
    CUSTOM_COMPLETION_PREDICATES.build!(dir, { projectRoot: dir, planPath: join(dir, 'plan.md') } as never);

  it('labels a failure unrelated to any reopen with the neutral seed reason', async () => {
    seedMock.mockRejectedValue(new Error('Unable to seed task status from repair state (corrupt): bad json'));
    const result = await run();
    expect(result.done).toBe(false);
    expect(result.reason).toBe(
      'failed to seed task-status from plan: Unable to seed task status from repair state (corrupt): bad json',
    );
  });

  it('keeps the task reopen label for a genuine reopen failure', async () => {
    seedMock.mockRejectedValue(new TaskReopenError('Unable to admit plan amendment repair for task 3: denied'));
    const result = await run();
    expect(result.reason).toBe('task reopen failed: Unable to admit plan amendment repair for task 3: denied');
  });
});
