/**
 * Acceptance coverage for #1729, Story 6: an operator rewind crosses the
 * public command boundary, repairs the persisted feature position, and lets
 * the next daemon-style resume dispatch the named gate without another
 * operator action.
 *
 * The command shape is pinned by the approved architecture and ADR:
 * `conduct-ts rewind --to <step>` runs against one feature worktree. The
 * Conductor run below is the real internal resume path; only Git/GitHub and
 * the autonomous step runner are deterministic fakes.
 *
 * RED strategy: before implementation the real binary does not recognize the
 * `rewind` command, so the first assertion fails after the spec executes. No
 * missing production symbol is statically imported and collection succeeds.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Conductor, type StepRunner } from '../../src/engine/conductor.js';
import { writeVerdict } from '../../src/engine/gate-verdicts.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { ConductState, StepName, StepStatus } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const OPERATOR_ENV = { ...process.env };
delete OPERATOR_ENV.CONDUCT_DAEMON_SESSION;
OPERATOR_ENV.CONDUCT_DAEMON_SESSION_UNSAFE_ALLOW = '1';

let projectRoot: string;
let stateFilePath: string;

function haltedBuildReviewState(): ConductState {
  const statuses = Object.fromEntries(
    ALL_STEPS.map((step) => [step.name, step.name === 'prd' ? 'skipped' : 'done']),
  ) as Partial<Record<StepName, StepStatus>>;
  return {
    ...statuses,
    track: 'technical',
    complexity_tier: 'M',
    feature_desc: 'rebase-invalidated suite proof',
    worktree_branch: 'feat/rewind-acceptance',
    last_step: 'build_review',
  } as ConductState;
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), 'rewind-recovery-acceptance-'));
  await mkdir(join(projectRoot, '.pipeline', 'gates'), { recursive: true });
  stateFilePath = join(projectRoot, '.pipeline', 'conduct-state.json');
  await writeState(stateFilePath, haltedBuildReviewState());
  await writeVerdict(projectRoot, 'test_suite', {
    satisfied: false,
    checkedAt: 1,
    reason: 'aggregate proof became stale after rebase',
    kickback: { from: 'rebase', evidence: 'aggregate proof became stale after rebase' },
  });
  await writeVerdict(projectRoot, 'build_review', {
    satisfied: false,
    checkedAt: 2,
    reason: 'CURRENT test_suite proof required',
  });
  await writeFile(join(projectRoot, '.pipeline', 'HALT'), 'test_suite must re-run\n');
  await writeFile(join(projectRoot, '.pipeline', 'HALT.class'), 'needs-human\n');
});

afterEach(async () => {
  await rm(projectRoot, { recursive: true, force: true });
});

describe('conduct-ts rewind recovery', () => {
  it('rewinds a halted feature to test_suite and the next daemon resume advances to build_review', async () => {
    const rewind = await execa(REAL_CONDUCT_TS, ['rewind', '--to', 'test_suite'], {
      cwd: projectRoot,
      // The acceptance harness itself runs under a managed session, while
      // rewind is intentionally an operator-only command boundary.
      env: OPERATOR_ENV,
      reject: false,
      timeout: 20_000,
    });

    if (rewind.exitCode !== 0) throw new Error(rewind.stderr || rewind.stdout);

    const rewoundResult = await readState(stateFilePath);
    if (!rewoundResult.ok) throw new Error(rewoundResult.error.message);
    const rewound = rewoundResult.value;
    expect(rewound.test_suite).toBe('stale');
    expect(rewound.build_review).toBe('stale');
    expect(rewound.prd).toBe('skipped');
    await expect(readFile(join(projectRoot, '.pipeline', 'gates', 'test_suite.json'))).rejects.toThrow();
    await expect(readFile(join(projectRoot, '.pipeline', 'gates', 'build_review.json'))).rejects.toThrow();
    expect(await exists(join(projectRoot, '.pipeline', 'HALT'))).toBe(false);
    expect(await exists(join(projectRoot, '.pipeline', 'HALT.class'))).toBe(false);

    const events = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({
      operator: expect.any(String),
      target: 'test_suite',
      demoted: expect.arrayContaining(['test_suite', 'build_review']),
    }));

    const dispatched: StepName[] = [];
    const inspect = vi.fn(async () => ({ status: 'STALE' as const, reason: 'rewind requires a fresh suite run' }));
    const runner: StepRunner = {
      run: async (step) => {
        dispatched.push(step);
        if (step === 'test_suite') return { success: true, output: 'aggregate suite passed' };
        if (step === 'build_review') {
          return { success: false, output: 'sentinel: stop after observing build_review dispatch' };
        }
        throw new Error(`unexpected dispatch after rewind: ${step}`);
      },
    };
    const conductorEvents = new ConductorEventEmitter();
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      stepRunner: runner,
      events: conductorEvents,
      resume: true,
      daemon: true,
      mode: 'default',
      maxRetries: 1,
      verifyArtifacts: false,
      baseBranch: 'main',
      worktreeBranch: 'feat/rewind-acceptance',
      gh: async () => ({ stdout: '' }),
      runGh: async () => ({ stdout: '' }),
      git: async () => ({ stdout: '' }),
      sleepFn: async () => {},
      escalateBuildFailure: async () => ({}),
      fullSuiteVerifier: {
        inspect,
        ensure: async () => {
          dispatched.push('test_suite');
          return { status: 'EXECUTED', evidence: {} as never } as never;
        },
      },
    });

    await conductor.run();

    expect(dispatched.slice(0, 2)).toEqual(['test_suite', 'build_review']);
    expect(inspect).toHaveBeenCalled();
  });
});
