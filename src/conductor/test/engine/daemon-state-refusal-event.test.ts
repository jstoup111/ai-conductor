import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeState } from '../../src/engine/state.js';

const fixture = vi.hoisted(() => ({
  worktreePath: '',
}));

vi.mock('../../src/engine/ci-fix.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/ci-fix.js')>();
  return {
    ...actual,
    defaultCiFixProbe: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
  };
});

vi.mock('../../src/engine/step-runners.js', () => ({
  DefaultStepRunner: class {},
}));

vi.mock('../../src/engine/conductor.js', () => ({
  Conductor: class {
    constructor(private readonly options: { stateStore: { apply: (mutation: unknown) => Promise<unknown> } }) {}

    async run(): Promise<void> {
      await this.options.stateStore.apply({
        field: 'manual_test',
        expected: 'skipped',
        intent: 'restage ship tail after build kickback',
        next: 'stale',
      });
    }
  },
  createFinishPresentationRepair: vi.fn(),
}));

vi.mock('../../src/engine/daemon-runner.js', () => ({
  makeRunFeature: (deps: {
    beginFeatureRun: (worktree: { path: string; branch: string }, item: { slug: string }) => Promise<{
      events: unknown;
      providerExecution: unknown;
      sessionId?: string;
      log?: (message: string) => void;
      stop: () => Promise<void>;
    }>;
    runConductor: (
      worktree: { path: string; branch: string },
      item: { slug: string },
      providerExecution: unknown,
      events: unknown,
      log: ((message: string) => void) | undefined,
      sessionId: string | undefined,
    ) => Promise<void>;
  }) => async (item: { slug: string }) => {
    const worktree = { path: fixture.worktreePath, branch: `feat/${item.slug}` };
    const scope = await deps.beginFeatureRun(worktree, item);
    try {
      await deps.runConductor(
        worktree,
        item,
        scope.providerExecution,
        scope.events,
        scope.log,
        scope.sessionId,
      );
    } finally {
      await scope.stop();
    }
    return { slug: item.slug, status: 'halted' as const };
  },
}));

import { runDaemonMode } from '../../src/daemon-cli.js';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('daemon skipped-to-stale refusal event wiring', () => {
  it('persists a refusal emitted by the store constructed through runDaemonMode', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'daemon-state-refusal-event-'));
    directories.push(projectRoot);
    fixture.worktreePath = join(projectRoot, '.worktrees', 'feature-a');
    await mkdir(join(fixture.worktreePath, '.pipeline'), { recursive: true });
    await writeState(
      join(fixture.worktreePath, '.pipeline', 'conduct-state.json'),
      { manual_test: 'skipped' },
    );

    await runDaemonMode({
      projectRoot,
      concurrency: 1,
      maxItems: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      watch: false,
      workSource: { discover: async () => [{ slug: 'feature-a' }] },
    });

    const records = (await readFile(join(fixture.worktreePath, '.pipeline', 'events.jsonl'), 'utf-8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(records.filter((record) => record.type === 'step_status_write_refused')).toEqual([
      expect.objectContaining({
        field: 'manual_test',
        expected: 'skipped',
        requested: 'stale',
        intent: 'restage ship tail after build kickback',
      }),
    ]);
  });
});
