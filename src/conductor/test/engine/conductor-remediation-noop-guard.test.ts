/**
 * Integration specs for #647 D1 — "kickback to build is a no-op when the
 * target task's evidence is still stamped", plan Task 2
 * (`.docs/plans/kickback-to-build-no-op-when-target-evidence-stamped.md`).
 *
 * `planRemediation` (conductor.ts:888-...) is a private Conductor method, so
 * these tests drive it directly via `(conductor as any).planRemediation(...)`
 * against a real on-disk fixture (git repo + plan file + task-status.json),
 * mirroring `test/integration/remediation-extends-plan.test.ts`'s pattern of
 * exercising the real production entry points rather than asserting a
 * helper's return value in isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductState } from '../../src/types/index.js';

const execFile = promisify(execFileCb);

let dir: string;
let planPath: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile(
    'git',
    ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
    { cwd: dir },
  );
  return stdout.trim();
}

async function writeRemediationJson(disposition: 'build' | 'acceptance_specs'): Promise<void> {
  await writeFile(
    join(dir, '.pipeline/remediation.json'),
    JSON.stringify({
      dispositions: [
        {
          id: 'test:gap-1',
          disposition,
          category: null,
          rationale: 'residual gap',
          tasks: [{ id: 'rem-1', title: 'fix the missing behavior' }],
        },
      ],
    }),
  );
}

function makeRunner(onRun?: (step: StepName) => Promise<void>): StepRunner {
  return {
    run: async (step, _state) => {
      if (onRun) await onRun(step);
      return { success: true };
    },
  };
}

function makeConductor(runner: StepRunner): Conductor {
  return new Conductor({
    stateFilePath: join(dir, 'conduct-state.json'),
    stepRunner: runner,
    events: new ConductorEventEmitter(),
    projectRoot: dir,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: true,
    maxRetries: 1,
  } as never);
}

const sessionStartedAt = Date.now() - 1000;
const baseState: ConductState = { session_started_at: sessionStartedAt } as unknown as ConductState;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'remediation-noop-guard-'));
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  planPath = join(dir, '.docs/plans/p.md');
  await git('init', '-q', '-b', 'main');
  await writeFile(join(dir, 'README.md'), 'init\n');
  await git('add', 'README.md');
  await git('commit', '-q', '-m', 'init');
  await git('remote', 'add', 'origin', dir);
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('planRemediation D1: route-into-no-op guard (plan Task 2)', () => {
  it('empty-tasks build disposition (nothing to append) with all-complete task-status → halt, not route', async () => {
    // No active plan / task-status: nothing appended, but the underlying
    // build predicate falls back to trusting task-status.json which shows
    // everything already complete — no dispatchable work either way.
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    await writeFile(
      join(dir, '.pipeline/remediation.json'),
      JSON.stringify({
        dispositions: [
          {
            id: 'test:gap-1',
            disposition: 'build',
            category: null,
            rationale: 'residual gap',
            tasks: [],
          },
        ],
      }),
    );

    const conductor = makeConductor(makeRunner());
    const result = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; detail?: string; target?: string }>;
    }).planRemediation(baseState, ALL_STEPS, 'test', { source: 'test', evidenceFile: 'x' });

    expect(result.kind).toBe('halt');
    expect(result.detail).toMatch(/no dispatchable build work|already evidence-complete/i);
  });

  it('idempotent-upsert build disposition whose rem-* id is already evidence-complete → halt, not route', async () => {
    // Simulate a prior append that already landed rem-1 as a real plan task
    // (conductor.ts's own `appendRemediationTasks`, id-scheme: the raw gap
    // task id as-is — see conductor.ts:4565) AND was completed with a real
    // trailer-stamped commit — the classic #647 shape: a re-derived append
    // (same id, same title → idempotent no-op) upserts onto an id that is
    // already evidence-complete.
    const remId = 'rem-1';
    await writeFile(planPath, `### Task ${remId}: fix the missing behavior\n`);

    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src/remediated.ts'), 'fix\n');
    await git('add', '.');
    await git('commit', '-q', '-m', `fix: remediate ${remId}\n\nTask: ${remId}`);

    await writeFile(
      join(dir, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
    );
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: remId, status: 'completed' }] }),
    );
    await writeRemediationJson('build');

    const conductor = makeConductor(makeRunner());
    const result = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; detail?: string; target?: string }>;
    }).planRemediation(
      { ...baseState, feature_desc: 'p' } as ConductState,
      ALL_STEPS,
      'test',
      { source: 'test', evidenceFile: 'x' },
    );

    expect(result.kind).toBe('halt');
    expect(result.detail).toMatch(/no dispatchable build work|already evidence-complete/i);
  });

  it('build disposition with a genuinely new pending rem-* task → routes to build (guard does not fire)', async () => {
    await writeFile(planPath, '### Task 1\n**Files:** `src/a.ts`\n');
    await writeFile(
      join(dir, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
    );
    // No completed rem-* row yet — the appended task will land as pending.
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    await writeRemediationJson('build');

    const conductor = makeConductor(makeRunner());
    const result = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; detail?: string; target?: string }>;
    }).planRemediation(
      { ...baseState, feature_desc: 'p' } as ConductState,
      ALL_STEPS,
      'test',
      { source: 'test', evidenceFile: 'x' },
    );

    expect(result.kind).toBe('route');
    expect(result.target).toBe('build');
  });

  it('non-build route (acceptance_specs) with build already complete → unaffected, routes normally', async () => {
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({ tasks: [{ id: 'task-1', status: 'completed' }] }),
    );
    await writeRemediationJson('acceptance_specs');

    const conductor = makeConductor(makeRunner());
    const result = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; detail?: string; target?: string }>;
    }).planRemediation(baseState, ALL_STEPS, 'test', { source: 'test', evidenceFile: 'x' });

    expect(result.kind).toBe('route');
    expect(result.target).toBe('acceptance_specs');
  });
});
