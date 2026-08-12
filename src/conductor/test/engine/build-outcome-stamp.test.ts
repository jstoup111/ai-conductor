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

vi.mock('../../src/engine/build-outcome.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/build-outcome.js')>();
  return { ...actual, writeBuildOutcome: vi.fn(actual.writeBuildOutcome) };
});

import * as projectPrelude from '../../src/engine/project-prelude.js';
import { writeBuildOutcome } from '../../src/engine/build-outcome.js';

describe('conductor build-outcome baseline capture', () => {
  let dir: string;
  let statePath: string;
  let fixtureHead: string;
  let fixtureSeed = 0;

  beforeEach(async () => {
    fixtureSeed += 1;
    dir = await mkdtemp(join(tmpdir(), 'conductor-build-outcome-'));
    statePath = join(dir, '.pipeline', 'conduct-state.json');
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await execa('git', ['init', '-b', 'main'], { cwd: dir });
    await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
    await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
    await writeFile(join(dir, 'README.md'), '# Fixture\n');
    await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
    await execa('git', ['add', 'README.md', '.gitignore'], { cwd: dir });
    // A per-test commit message keeps each fixture HEAD distinct. Identical
    // fixtures committed inside one wall-clock second produce the same SHA,
    // which would let a leaked mock value from a neighbouring test pass
    // unnoticed on a fast machine and fail only on a slow CI runner.
    await execa('git', ['commit', '-m', `test: seed fixture ${fixtureSeed}`], { cwd: dir });
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
    // mockReset, not mockClear: clearing only drops recorded calls and would
    // leave any queued one-shot value armed for the next test. Every probe
    // answers with this fixture's HEAD; a test that needs the build to move
    // HEAD re-arms the mock from its own step runner, so no assertion depends
    // on how many times the conductor probes before the build settles.
    vi.mocked(projectPrelude.currentCommitSha).mockReset();
    vi.mocked(projectPrelude.currentTreeHash).mockReset();
    vi.mocked(projectPrelude.currentCommitSha).mockResolvedValue(fixtureHead);
    vi.mocked(projectPrelude.currentTreeHash).mockResolvedValue('tree-witness');
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
    events.on('step_started', (event) => {
      started.push(event);
      if (event.type === 'step_started') dispatched.push(event.step);
    });
    events.on('step_failed', (event) => { failed.push(event); });
    const runner: StepRunner = {
      run: vi.fn(async () => {
        // The build moved HEAD: every probe from the settle onward observes
        // the new commit, whatever the conductor probed before dispatch.
        vi.mocked(projectPrelude.currentCommitSha).mockResolvedValue('head-after-build');
        return { success: true, output };
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
      fullSuiteVerifier: {
        inspect: async () => ({ status: 'STALE', reason: 'source_changed' }),
        ensure: async () => {
          dispatched.push('test_suite');
          return {
            status: 'FAILED',
            reason: 'nonzero_exit',
            message: 'sentinel stop after successful build settle',
          } as const;
        },
      },
    });

    await conductor.run();

    expect(blocked).toEqual([]);
    expect(started).toContainEqual(expect.objectContaining({ step: 'build' }));
    expect(dispatched.slice(0, 2)).toEqual(['build', 'test_suite']);
    expect(failed).toContainEqual(expect.objectContaining({ step: 'test_suite' }));
    expect(failed).not.toContainEqual(expect.objectContaining({ step: 'build' }));
    expect(completed).toContainEqual(expect.objectContaining({ step: 'build', status: 'done' }));
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

  it('stamps an auth failure as a no-verdict build outcome', async () => {
    vi.mocked(projectPrelude.currentCommitSha).mockResolvedValue(fixtureHead);
    const runner: StepRunner = {
      run: vi.fn(async () => ({ success: false, authFailure: true, output: 'authentication failed' })),
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
    (conductor as unknown as {
      parkOnAuthFailure: () => Promise<{ disposition: 'halt'; haltReason: string }>;
    }).parkOnAuthFailure = async () => ({ disposition: 'halt', haltReason: 'auth halted' });

    await conductor.run();

    const payload = JSON.parse(await readFile(join(dir, '.pipeline', 'build-outcome.json'), 'utf8')) as {
      records: Array<Record<string, unknown>>;
    };
    expect(payload.records.at(-1)).toMatchObject({
      terminalOutcome: 'no-verdict',
      reason: 'authFailure',
      treeBefore: 'tree-witness',
      treeAfter: 'tree-witness',
      headBefore: fixtureHead,
      headAfter: fixtureHead,
    });
  });

  it('keeps a successful build outcome when the sidecar write fails', async () => {
    vi.mocked(projectPrelude.currentCommitSha).mockResolvedValue(fixtureHead);
    vi.mocked(writeBuildOutcome).mockRejectedValueOnce(new Error('pipeline is unwritable'));
    const completed: unknown[] = [];
    const events = new ConductorEventEmitter();
    events.on('step_completed', (event) => {
      if (event.type === 'step_completed' && event.step === 'build') completed.push(event);
    });
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: { run: vi.fn(async () => ({ success: true, output: 'completed despite stamp failure' })) },
      events,
      projectRoot: dir,
      fromStep: 'build',
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
    });

    await conductor.run();

    expect(completed).toContainEqual(expect.objectContaining({ step: 'build', status: 'done' }));
  });
});
