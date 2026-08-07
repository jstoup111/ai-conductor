import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ConductState } from '../../src/types/index.js';
import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

vi.mock('../../src/engine/project-prelude.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/engine/project-prelude.js')>()),
  currentCommitSha: vi.fn(async () => 'head-before-build'),
  currentTreeHash: vi.fn(async () => 'tree-before-build'),
}));

import * as projectPrelude from '../../src/engine/project-prelude.js';

describe('conductor build-outcome baseline capture', () => {
  let dir: string;
  let statePath: string;
  let fixtureHead: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-build-outcome-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Fixture\n');
    await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
    await execa('git', ['add', 'README.md', '.gitignore'], { cwd: dir });
    await execa('git', ['commit', '-m', 'test: seed fixture'], { cwd: dir });
    fixtureHead = (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
    await writeFile(statePath, JSON.stringify({
      worktree: 'done',
      memory: 'done',
      explore: 'done',
      complexity: 'done',
      stories: 'done',
      conflict_check: 'done',
      plan: 'done',
      coherence_check: 'done',
      architecture_diagram: 'done',
      architecture_review: 'done',
      acceptance_specs: 'done',
      complexity_tier: 'M',
      track: 'technical',
      feature_desc: 'build-outcome-stamp-test',
      prd: 'skipped',
    } satisfies ConductState));
    await writeFile(
      join(dir, '.pipeline', 'task-status.json'),
      JSON.stringify({ tasks: [{ id: '8', status: 'completed' }] }),
    );
    vi.mocked(projectPrelude.currentCommitSha).mockClear();
    vi.mocked(projectPrelude.currentTreeHash).mockClear();
    vi.mocked(projectPrelude.currentCommitSha)
      .mockResolvedValueOnce(fixtureHead)
      .mockResolvedValue('head-after-build');
    vi.mocked(projectPrelude.currentTreeHash)
      .mockResolvedValue('tree-witness');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('captures the tree baseline beside the build-entry HEAD probe through the git boundary', async () => {
    const runner: StepRunner = {
      run: vi.fn(async () => ({ success: false, output: 'stop after build entry' })),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    expect(projectPrelude.currentCommitSha).toHaveBeenCalledWith(dir);
    expect(projectPrelude.currentTreeHash).toHaveBeenCalledWith(dir);
  });

  it('keeps one build-step-entry baseline probe block', async () => {
    const source = await readFile(
      new URL('../../src/engine/conductor.ts', import.meta.url),
      'utf8',
    );

    expect(source.match(/const \[headShaBeforeBuild, treeHashBeforeBuild\]/g)).toHaveLength(1);
  });

  it('stamps a successful build settle with both witnesses and the emitted tail', async () => {
    const output = 'first provider line\nlast provider line';
    const completed: unknown[] = [];
    const blocked: unknown[] = [];
    const started: unknown[] = [];
    const failed: unknown[] = [];
    const dispatched: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_completed', (event) => {
      if (event.type === 'step_completed' && event.step === 'build') completed.push(event);
    });
    events.on('gate_blocked', (event) => { blocked.push(event); });
    events.on('step_started', (event) => { started.push(event); });
    events.on('step_failed', (event) => { failed.push(event); });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        dispatched.push(step);
        return dispatched.length === 1
          ? { success: true, output }
          : { success: false, output: 'sentinel stop after successful build settle' };
      }),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    expect(blocked).toEqual([]);
    expect(started).toContainEqual(expect.objectContaining({ step: 'build' }));
    expect(failed).toContainEqual(expect.objectContaining({ step: 'build' }));
    expect(dispatched[0]).toBe('build');
    expect(completed).toHaveLength(1);
    const payload = JSON.parse(await readFile(join(dir, '.pipeline', 'build-outcome.json'), 'utf8')) as {
      records: Array<Record<string, unknown>>;
    };
    const latest = payload.records.find((record) => record.terminalOutcome === 'done');
    const event = completed.at(-1) as { tail?: string[] } | undefined;
    expect(latest).toMatchObject({
      terminalOutcome: 'done',
      treeBefore: 'tree-witness',
      treeAfter: 'tree-witness',
      headBefore: fixtureHead,
      headAfter: 'head-after-build',
      note: event?.tail,
    });
  });

  it('stamps a terminal failed build settle with both witnesses', async () => {
    vi.mocked(projectPrelude.currentCommitSha).mockResolvedValue(fixtureHead);
    const runner: StepRunner = {
      run: vi.fn(async () => ({ success: false, output: 'failed build output' })),
    };
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    const payload = JSON.parse(await readFile(join(dir, '.pipeline', 'build-outcome.json'), 'utf8')) as {
      records: Array<Record<string, unknown>>;
    };
    expect(payload.records.at(-1)).toMatchObject({
      terminalOutcome: 'failed',
      treeBefore: 'tree-witness',
      treeAfter: 'tree-witness',
      headBefore: fixtureHead,
      headAfter: fixtureHead,
      note: ['failed build output'],
    });
  });
});
