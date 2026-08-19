/**
 * Acceptance RED for FR-8 / Story 10.
 *
 * This is the one story-level flow the approved plan deliberately assigns to
 * writing-system-tests: a real build_review entry reaches its mechanical-fault
 * terminal state, the operator uses the real command entry point to record
 * reduced coverage, the documented halt clear is applied, and a fresh
 * Conductor dispatch advances beyond build_review without any hand edit to a
 * durable state file.
 *
 * Third-party boundary: rubric providers are replaced by a deterministic fake.
 * Internal boundaries remain real: Git worktree identity, DefaultStepRunner,
 * Conductor routing, the disposition store/lease, halt markers, CLI dispatch,
 * and effective-verdict resolution.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderFullHelp } from '../../src/cli.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { ConductorOptions, StepRunResult, StepRunner } from '../../src/engine/conductor.js';
import { clearMarker } from '../../src/engine/daemon-rekick.js';
import { readHaltClass } from '../../src/engine/halt-marker.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { readState, writeState } from '../../src/engine/state.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const FEATURE = 'review-infrastructure-failures-are-operator-unreco';
const dirs: string[] = [];

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

async function fixtureRepo(): Promise<{
  root: string;
  worktree: string;
  planPath: string;
  statePath: string;
  head: string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'mechanical-review-recovery-'));
  dirs.push(root);
  await git(root, 'init', '-q', '-b', 'main');
  await git(root, 'config', 'user.email', 'acceptance@example.com');
  await git(root, 'config', 'user.name', 'Acceptance Test');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(
    join(root, '.docs', 'plans', `${FEATURE}.md`),
    '# Plan\n\n### Task 1: exercise mechanical review recovery\n',
  );
  await writeFile(join(root, '.gitignore'), '.pipeline/\n.worktrees/\n');
  await writeFile(join(root, 'src', 'feature.ts'), 'export const reviewed = false;\n');
  await git(root, 'add', '.');
  await git(root, 'commit', '-qm', 'base');

  const worktree = join(root, '.worktrees', FEATURE);
  await git(root, 'worktree', 'add', '-qb', `feature/${FEATURE}`, worktree, 'main');
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(join(worktree, 'src', 'feature.ts'), 'export const reviewed = true;\n');
  await git(worktree, 'add', 'src/feature.ts');
  await git(worktree, 'commit', '-qm', 'implement fixture behavior');

  const statePath = join(worktree, '.pipeline', 'conduct-state.json');
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'build_review') break;
    state[step.name] = 'done';
  }
  state.build_review = 'pending';
  state.complexity_tier = 'M';
  state.feature_desc = FEATURE;
  state.track = 'product';
  state.run_started_at = Date.now();
  await writeState(statePath, state as unknown as ConductState);

  return {
    root,
    worktree,
    planPath: join(worktree, '.docs', 'plans', `${FEATURE}.md`),
    statePath,
    head: await git(worktree, 'rev-parse', 'HEAD'),
  };
}

function projectionFromPrompt(prompt: string): {
  rubric: string;
  lapId: string;
  snapshotDigest: string;
} {
  return JSON.parse(prompt.split('\n\n').at(-1)!) as {
    rubric: string;
    lapId: string;
    snapshotDigest: string;
  };
}

function makeRubricProvider(): LLMProvider {
  return {
    invoke: vi.fn(async (options) => {
      const projection = projectionFromPrompt(options.prompt);
      if (projection.rubric === 'scope') {
        return {
          success: false,
          output: 'fixture preflight could not read the merge-base plan',
          exitCode: 1,
        };
      }
      return {
        success: true,
        output: JSON.stringify({
          kind: 'judged',
          rubric: projection.rubric,
          lapId: projection.lapId,
          snapshotDigest: projection.snapshotDigest,
          contractVersion: 'v3',
          findings: [],
          verdict: 'PASS',
        }),
        exitCode: 0,
      };
    }),
    invokeInteractive: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRunner(input: {
  worktree: string;
  planPath: string;
  head: string;
  downstream: StepName[];
}): StepRunner {
  const provider = makeRubricProvider();
  const config = {
    build_review: {
      enabled: true,
      perTaskFloor: false,
      rubrics: { tautology: { enabled: false } },
    },
    wiring: { entry_points: ['src/feature.ts'] },
  } as HarnessConfig;
  const buildReview = new DefaultStepRunner(provider, 'mechanical-review-session', input.worktree, {
    config,
    planPath: input.planPath,
    pipelineDir: join(input.worktree, '.pipeline'),
    buildReviewInputOptions: {
      inspectTestSuite: async () => ({
        status: 'CURRENT',
        evidence: { provenanceHeadSha: input.head, outcome: 'PASS' },
      } as never),
    },
  });
  return {
    run: async (step, state, context): Promise<StepRunResult> => {
      if (step === 'build_review') return buildReview.run(step, state, context);
      input.downstream.push(step);
      return { success: false, output: `sentinel: advanced beyond build_review to ${step}` };
    },
    resetSession: async () => {},
  };
}

function conductorOptions(input: {
  worktree: string;
  statePath: string;
  runner: StepRunner;
}): ConductorOptions {
  return {
    stateFilePath: input.statePath,
    stepRunner: input.runner,
    events: new ConductorEventEmitter(),
    projectRoot: input.worktree,
    mode: 'auto',
    daemon: true,
    fromStep: 'build_review',
    verifyArtifacts: true,
    maxRetries: 1,
    config: {
      build_review: { enabled: true },
      kickback_escalation: { enabled: false },
    },
    fullSuiteVerifier: {
      ensure: async () => ({ status: 'REUSED', evidence: {} as never }),
      inspect: async () => ({ status: 'CURRENT', evidence: {} as never }),
    },
  };
}

async function runOperatorDecision(
  root: string,
  lapId: string,
): Promise<{ exitCode: number; output: string }> {
  const env = { ...process.env };
  delete env.CONDUCT_DAEMON_SESSION;
  const args = [
    'build-review',
    'record-reduced-coverage',
    '--feature',
    FEATURE,
    '--lap',
    lapId,
    '--rubric',
    'scope',
    '--rationale',
    'operator-approved-mechanical-coverage-gap',
  ];
  const quoted = [REAL_CONDUCT_TS, ...args]
    .map((part) => `'${part.replaceAll("'", "'\\\"'\\\"'")}'`)
    .join(' ');
  try {
    const { stdout, stderr } = await execFile(
      'script',
      ['--quiet', '--return', '--command', quoted, '/dev/null'],
      { cwd: root, env },
    );
    return { exitCode: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: typeof failure.code === 'number' ? failure.code : 1,
      output: `${failure.stdout ?? ''}${failure.stderr ?? ''}${failure.message}`,
    };
  }
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: operator recovery from an exhausted mechanical build-review fault (FR-8)', () => {
  it('records reduced coverage, clears the halt, and advances a fresh dispatch without hand-editing durable state', async () => {
    expect(renderFullHelp()).toContain('build-review record-reduced-coverage');

    const fixture = await fixtureRepo();
    const firstDownstream: StepName[] = [];
    await new Conductor(conductorOptions({
      worktree: fixture.worktree,
      statePath: fixture.statePath,
      runner: makeRunner({ ...fixture, downstream: firstDownstream }),
    })).run();

    expect(firstDownstream).not.toContain('build');
    await expect(readHaltClass(fixture.worktree)).resolves.toBe('needs-human');
    const haltedAggregate = JSON.parse(
      await readFile(join(fixture.worktree, '.pipeline', 'build-review.json'), 'utf8'),
    ) as { lapId: string };

    const decision = await runOperatorDecision(fixture.root, haltedAggregate.lapId);
    expect(decision.exitCode, decision.output).toBe(0);
    expect(decision.output).toMatch(/recorded|reduced coverage/i);

    await clearMarker(fixture.worktree);
    const secondDownstream: StepName[] = [];
    await new Conductor(conductorOptions({
      worktree: fixture.worktree,
      statePath: fixture.statePath,
      runner: makeRunner({ ...fixture, downstream: secondDownstream }),
    })).run();

    const resumed = await readState(fixture.statePath);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error(resumed.error.message);
    expect(resumed.value.build_review).toBe('done');
    expect(secondDownstream.some((step) => step !== 'build_review')).toBe(true);
    expect(secondDownstream).not.toContain('build');
  }, 60_000);
});
