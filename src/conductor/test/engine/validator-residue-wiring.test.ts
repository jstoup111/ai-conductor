// Covers: task:3
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

const residueMock = vi.hoisted(() => ({
  implementation: undefined as undefined | ((input: unknown) => Promise<unknown>),
}));

vi.mock('../../src/engine/validator-residue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/validator-residue.js')>();
  return {
    ...actual,
    quarantineValidatorResidue: async (input: unknown) =>
      residueMock.implementation === undefined
        ? actual.quarantineValidatorResidue(input as Parameters<typeof actual.quarantineValidatorResidue>[0])
        : residueMock.implementation(input),
  };
});

import { Conductor } from '../test-conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { createProtectedArtifactSeal } from '../../src/engine/protected-artifact-seal.js';
import { switchToChild, noOpChildLifecycleEvents } from '../../src/engine/child-lifecycle.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { parseChildId } from '../../src/engine/child-context.js';
import type { ConductState, ConductorEvent } from '../../src/types/index.js';

const fixtures: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  residueMock.implementation = undefined;
  await Promise.all(fixtures.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fixture(): Promise<{ dir: string; statePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'validator-residue-wiring-'));
  fixtures.push(dir);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  await execa('git', ['config', 'status.showUntrackedFiles', 'all'], { cwd: dir });
  await writeFile(join(dir, '.gitignore'), '.pipeline/\n.daemon/\nconduct-state.json\n');
  await writeFile(join(dir, 'README.md'), '# fixture\n');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src/app.ts'), 'export const app = 1;\n');
  await execa('git', ['add', '.'], { cwd: dir });
  await execa('git', ['commit', '-qm', 'initial'], { cwd: dir });
  await execa('git', ['branch', '-m', 'feat/validator-residue-wiring'], { cwd: dir });
  await execa('git', ['branch', 'validator-child'], { cwd: dir });
  await createProtectedArtifactSeal({
    projectRoot: dir,
    baselineCommit: (await execa('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout,
  });

  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) state[step.name] = 'done';
  state.manual_test = 'pending';
  state.prd_audit = 'done';
  state.architecture_review_as_built = 'done';
  state.complexity_tier = 'M';
  state.feature_desc = 'validator-residue-wiring';
  const statePath = join(dir, 'conduct-state.json');
  await writeState(statePath, state as ConductState);
  return { dir, statePath };
}

function conductor(
  dir: string,
  statePath: string,
  runner: StepRunner,
  events = new ConductorEventEmitter(),
  log?: (line: string) => void,
  fromStep: 'manual_test' | 'build' = 'manual_test',
  verifyArtifacts = false,
  maxRetries = 1,
): Conductor {
  return new Conductor({
    projectRoot: dir,
    stateFilePath: statePath,
    featureSlug: 'validator-residue-wiring',
    stepRunner: runner,
    events,
    fromStep,
    mode: 'auto',
    daemon: true,
    verifyArtifacts,
    config: { defaults: { max_retries: maxRetries } },
    log,
  });
}

function manualRunner(dir: string, beforeReport?: () => Promise<void>): StepRunner {
  return {
    run: vi.fn(async (step) => {
      if (step === 'manual_test') {
        await beforeReport?.();
        await mkdir(join(dir, 'docs/reports/manual-test-step17'), { recursive: true });
        await writeFile(join(dir, 'docs/reports/manual-test-step17/report.html'), '<html>report</html>\n');
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(
          join(dir, '.pipeline/manual-test-results.md'),
          '| Story | Result |\n| --- | --- |\n| 1 | FAIL |\n',
        );
      }
      return { success: true };
    }),
  };
}

describe('serial validation residue wiring', () => {
  // Covers: task:3
  it('persists serial quarantine before manual-test failure routing and leaves the next child entry clean', async () => {
    const { dir, statePath } = await fixture();
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    const persister = new EventPersister(join(dir, '.pipeline/events.jsonl'), emitter);
    persister.start();
    emitter.on('validator_residue_quarantined', (event) => {
      events.push(event);
    });
    const runner = manualRunner(dir);
    const instance = conductor(dir, statePath, runner, emitter, undefined, 'manual_test', true);

    try {
      await instance.run();

      expect(runner.run).toHaveBeenCalledWith('manual_test', expect.anything(), expect.anything());
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: 'validator_residue_quarantined',
        source: 'manual_test',
        paths: ['docs/reports/manual-test-step17/report.html'],
      });
      const event = events[0] as Extract<ConductorEvent, { type: 'validator_residue_quarantined' }>;
      await expect(readFile(join(dir, event.directory, event.paths[0]!), 'utf8')).resolves.toBe(
        '<html>report</html>\n',
      );
      await expect(execa('git', ['status', '--porcelain'], { cwd: dir })).resolves.toMatchObject({ stdout: '' });
      const persisted = (await readFile(join(dir, '.pipeline/events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as ConductorEvent);
      const quarantines = persisted.filter((item) => item.type === 'validator_residue_quarantined');
      expect(quarantines).toEqual([
        expect.objectContaining({
          source: 'manual_test',
          paths: ['docs/reports/manual-test-step17/report.html'],
          directory: event.directory,
        }),
      ]);
      expect(persisted.findIndex((item) => item.type === 'validator_residue_quarantined')).toBeLessThan(
        persisted.findIndex((item) => item.type === 'step_failed' && item.step === 'manual_test'),
      );
      await expect(
        switchToChild(
          dir,
          { child: parseChildId(1)!, position: parseChildId(1)!, branch: 'validator-child' },
          noOpChildLifecycleEvents,
          undefined,
          {
            git: makeGitRunner(dir),
          },
        ),
      ).resolves.toEqual({ kind: 'completed' });
    } finally {
      persister.stop();
    }
  });

  it('quarantines serial manual-test residue when its dispatch throws', async () => {
    const { dir, statePath } = await fixture();
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('validator_residue_quarantined', (event) => events.push(event));
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'manual_test') {
          await mkdir(join(dir, 'docs/reports'), { recursive: true });
          await writeFile(join(dir, 'docs/reports/thrown.html'), 'thrown report\n');
          throw new Error('manual test dispatch failed');
        }
        return { success: true };
      }),
    };

    await conductor(dir, statePath, runner, emitter).run();

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<ConductorEvent, { type: 'validator_residue_quarantined' }>;
    expect(event).toMatchObject({ source: 'manual_test', paths: ['docs/reports/thrown.html'] });
    await expect(readFile(join(dir, event.directory, 'docs/reports/thrown.html'), 'utf8')).resolves.toBe('thrown report\n');
  });

  async function assertMockedRefusal(reason: string): Promise<void> {
    const { dir, statePath } = await fixture();
    const logs: string[] = [];
    residueMock.implementation = async () => ({ kind: 'refused', reason });
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('validator_residue_quarantined', (event) => {
      events.push(event);
    });
    const instance = conductor(dir, statePath, manualRunner(dir), emitter, (line) => {
      logs.push(line);
    });

    await instance.run();

    expect(logs).toContain(`WARNING: validator residue quarantine refused — ${reason}`);
    expect(events).toEqual([]);
    await expect(readFile(join(dir, 'docs/reports/manual-test-step17/report.html'), 'utf8')).resolves.toBe(
      '<html>report</html>\n',
    );
  }

  // Covers: task:3
  it('logs a mocked destination collision refusal without emitting a quarantine event', async () => {
    await assertMockedRefusal('refusing to overwrite quarantined path: docs/reports/manual-test-step17/report.html');
  });

  // Covers: task:3
  it('logs a mocked vanished path refusal without emitting a quarantine event', async () => {
    await assertMockedRefusal('refusing to quarantine missing path: ghost.txt');
  });

  it('logs the real regular-root refusal and leaves the report in the product tree', async () => {
    const { dir, statePath } = await fixture();
    const logs: string[] = [];
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(join(dir, '.pipeline/validator-residue'), 'not a directory\n');

    await conductor(dir, statePath, manualRunner(dir), new ConductorEventEmitter(), (line) => logs.push(line)).run();

    expect(logs).toContainEqual(expect.stringMatching(/^WARNING: validator residue quarantine refused — /));
    await expect(readFile(join(dir, 'docs/reports/manual-test-step17/report.html'), 'utf8')).resolves.toBe(
      '<html>report</html>\n',
    );
  });

  // Covers: task:3
  it('does not quarantine non-validation build output and retains its uncommitted completion refusal', async () => {
    const { dir, statePath } = await fixture();
    const state = await readFile(statePath, 'utf8').then((raw) => JSON.parse(raw) as ConductState);
    state.build = 'pending';
    await writeState(statePath, state);
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'build') {
          await mkdir(join(dir, 'src'), { recursive: true });
          await writeFile(join(dir, 'src/new.ts'), 'export const value = 1;\n');
        }
        return { success: true };
      }),
    };

    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('validator_residue_quarantined', (event) => {
      events.push(event);
    });
    await conductor(dir, statePath, runner, emitter, undefined, 'build').run();

    await expect(readFile(join(dir, 'src/new.ts'), 'utf8')).resolves.toContain('value');
    expect(events).toEqual([]);
    await expect(access(join(dir, '.pipeline/validator-residue'))).rejects.toMatchObject({ code: 'ENOENT' });
    await mkdir(join(dir, '.pipeline'), { recursive: true });
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: '3', status: 'completed' }] }),
    );
    await expect(
      checkStepCompletion(dir, 'build', {
        worktreeStatus: async () => (await execa('git', ['status', '--porcelain'], { cwd: dir })).stdout,
      }),
    ).resolves.toMatchObject({
      done: false,
      missing: 'uncommitted',
      reason: expect.stringContaining('src/new.ts'),
    });
  });

  it('does nothing when manual test writes only ignored pipeline evidence', async () => {
    const { dir, statePath } = await fixture();
    const runner: StepRunner = {
      run: vi.fn(async () => {
        await mkdir(join(dir, '.pipeline'), { recursive: true });
        await writeFile(join(dir, '.pipeline/manual-test-results.md'), 'attempt evidence\n');
        return { success: true };
      }),
    };

    await conductor(dir, statePath, runner).run();

    await expect(access(join(dir, '.pipeline/validator-residue'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('grouped validation residue wiring', () => {
  async function groupFixture(): Promise<{ dir: string; statePath: string }> {
    const result = await fixture();
    const state = await readFile(result.statePath, 'utf8').then((raw) => JSON.parse(raw) as ConductState);
    state.manual_test = 'pending';
    state.prd_audit = 'pending';
    state.architecture_review_as_built = 'pending';
    await writeState(result.statePath, state);
    return result;
  }

  // Covers: task:4
  it('quarantines grouped validator output before the join while preserving preexisting and tracked dirt', async () => {
    const { dir, statePath } = await groupFixture();
    await writeFile(join(dir, 'scratch.txt'), 'preexisting\n');
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('validator_residue_quarantined', (event) => {
      events.push(event);
    });
    emitter.on('gate_verdict', (event) => {
      events.push(event);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'architecture_review_as_built') {
          await mkdir(join(dir, 'docs/reports/as-built'), { recursive: true });
          await writeFile(join(dir, 'docs/reports/as-built/report.html'), '<html>as built</html>\n');
          await writeFile(join(dir, 'src/app.ts'), 'export const app = 2;\n');
        }
        if (step === 'manual_test') {
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/manual-test-results.md'),
            '| Story | Result |\n| --- | --- |\n| 1 | PASS |\n',
          );
        }
        return { success: true };
      }),
    };

    await conductor(dir, statePath, runner, emitter).run();

    expect(events.filter((event) => event.type === 'validator_residue_quarantined')).toHaveLength(1);
    const residue = events.find((event) => event.type === 'validator_residue_quarantined') as Extract<
      ConductorEvent,
      { type: 'validator_residue_quarantined' }
    >;
    expect(residue).toMatchObject({ source: 'validation', paths: ['docs/reports/as-built/report.html'] });
    await expect(readFile(join(dir, residue.directory, 'docs/reports/as-built/report.html'), 'utf8')).resolves.toBe(
      '<html>as built</html>\n',
    );
    expect(events.findIndex((event) => event.type === 'validator_residue_quarantined')).toBeLessThan(
      events.findIndex((event) => event.type === 'gate_verdict'),
    );
    expect(residue.paths).not.toContain('scratch.txt');
    expect(residue.paths).not.toContain('src/app.ts');
    await expect(execa('git', ['status', '--porcelain'], { cwd: dir })).resolves.toMatchObject({
      stdout: ' M src/app.ts\n?? scratch.txt',
    });
  });

  // Covers: task:4
  it('quarantines output created by a retried grouped manual-test member', async () => {
    const { dir, statePath } = await groupFixture();
    let manualAttempts = 0;
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('validator_residue_quarantined', (event) => {
      events.push(event);
    });
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'manual_test') {
          manualAttempts += 1;
          if (manualAttempts === 1) throw new Error('fixture retry');
          await mkdir(join(dir, 'docs/reports/retry'), { recursive: true });
          await writeFile(join(dir, 'docs/reports/retry/report.html'), '<html>retry</html>\n');
          await mkdir(join(dir, '.pipeline'), { recursive: true });
          await writeFile(
            join(dir, '.pipeline/manual-test-results.md'),
            '| Story | Result |\n| --- | --- |\n| 1 | PASS |\n',
          );
        }
        return { success: true };
      }),
    };

    await conductor(dir, statePath, runner, emitter, undefined, 'manual_test', false, 2).run();

    expect(manualAttempts).toBe(2);
    const residue = events.find((event) => event.type === 'validator_residue_quarantined') as Extract<
      ConductorEvent,
      { type: 'validator_residue_quarantined' }
    >;
    expect(residue).toMatchObject({ source: 'validation', paths: ['docs/reports/retry/report.html'] });
    await expect(readFile(join(dir, residue.directory, 'docs/reports/retry/report.html'), 'utf8')).resolves.toBe(
      '<html>retry</html>\n',
    );
  });

  it('quarantines grouped residue when a member dispatch throws after writing it', async () => {
    const { dir, statePath } = await groupFixture();
    const events: ConductorEvent[] = [];
    const emitter = new ConductorEventEmitter();
    emitter.on('validator_residue_quarantined', (event) => events.push(event));
    const runner: StepRunner = {
      run: vi.fn(async (step) => {
        if (step === 'architecture_review_as_built') {
          await mkdir(join(dir, 'docs/reports'), { recursive: true });
          await writeFile(join(dir, 'docs/reports/thrown-group.html'), 'group report\n');
          throw new Error('group member dispatch failed');
        }
        return { success: true };
      }),
    };

    await conductor(dir, statePath, runner, emitter).run();

    expect(events).toHaveLength(1);
    const event = events[0] as Extract<ConductorEvent, { type: 'validator_residue_quarantined' }>;
    expect(event).toMatchObject({ source: 'validation', paths: ['docs/reports/thrown-group.html'] });
    await expect(readFile(join(dir, event.directory, 'docs/reports/thrown-group.html'), 'utf8')).resolves.toBe('group report\n');
  });
});
