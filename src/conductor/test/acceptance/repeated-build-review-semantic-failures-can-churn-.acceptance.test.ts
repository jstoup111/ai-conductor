/**
 * RED acceptance coverage for #1521.
 *
 * Multi-step story flows covered here:
 * - Stories 3-5: build_review FAIL -> build changes the tree -> review repeats,
 *   until the cumulative bound writes one needs-human halt and the event spine
 *   exposes the complete lap history.
 * - Story 7: a real Git diff -> build-review input assembly -> grader prompt,
 *   with the LLM boundary replaced by a faithful prompt-capturing fake.
 *
 * Stories 1, 2, and 6 are single-operation ledger/deriver contracts and are
 * unit-covered by plan Tasks 1-9 and 18-20. Story 4's config-shape and explicit
 * opt-out branches are unit-covered by Tasks 13-14; this file covers its
 * default-on production path without guessing an unspecified config-key name.
 *
 * Production call sites exercised for the correctness-critical derivations:
 * - src/engine/conductor.ts: build_review FAIL handling, kickback consumption,
 *   halt writing, and kickback/loop_halt event emission.
 * - src/engine/step-runners.ts: DefaultStepRunner.runBuildReview.
 * - src/engine/build-review-inputs.ts: assembleBuildReviewInputs.
 * - src/engine/build-review-prompt.ts: buildGraderPrompt.
 */

import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Conductor } from '../../src/engine/conductor.js';
import type { ConductorOptions, StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { readHaltClass } from '../../src/engine/halt-marker.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import type { ShipmentEvidenceInput } from '../../src/engine/shipment-evidence.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import type { LLMProvider } from '../../src/execution/llm-provider.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const dirs: string[] = [];

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: dir });
  return stdout.trim();
}

async function initRepo(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(dir);
  await git(dir, 'init', '-q', '-b', 'main');
  await git(dir, 'config', 'user.email', 'acceptance@example.com');
  await git(dir, 'config', 'user.name', 'Acceptance Test');
  return dir;
}

async function seedThroughBuildReview(statePath: string): Promise<void> {
  const state: Record<string, unknown> = {};
  for (const step of ALL_STEPS) {
    if (step.name === 'build_review') break;
    state[step.name] = 'done';
  }
  state.build_review = 'pending';
  state.complexity_tier = 'M';
  state.feature_desc = 'repeated-build-review-semantic-failures-can-churn-';
  state.track = 'technical';
  state.run_started_at = Date.now();
  await writeState(statePath, state as unknown as ConductState);
}

const failVerdict = (reason: string): string => JSON.stringify({
  verdict: 'FAIL',
  reasons: [`tautology: ${reason}`],
  findings: { tautology: [reason] },
  rubric: {
    tautology: true,
    scope: false,
    rootCause: false,
    completeness: false,
    wiring: false,
  },
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acceptance: cumulative build_review convergence bound (#1521 Stories 3-5)', () => {
  it('halts once on the sixth moving-tree FAIL and persists cumulative kickback history', async () => {
    const dir = await initRepo('build-review-cumulative-');
    const pipelineDir = join(dir, '.pipeline');
    const statePath = join(pipelineDir, 'conduct-state.json');
    await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
    await mkdir(pipelineDir, { recursive: true });
    await writeFile(
      join(dir, '.docs', 'plans', 'repeated-build-review-semantic-failures-can-churn-.md'),
      '# Plan\n\n### Task 1: converge build review\n',
    );
    await writeFile(join(dir, '.gitignore'), '.pipeline/\n');
    await writeFile(join(dir, 'work.txt'), 'base\n');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-qm', 'base');
    await git(dir, 'checkout', '-qb', 'feature/cumulative-review');
    await writeFile(join(dir, 'feature.txt'), 'feature\n');
    await git(dir, 'add', 'feature.txt');
    await git(dir, 'commit', '-qm', 'feature');
    await seedThroughBuildReview(statePath);

    let reviewRuns = 0;
    let buildRuns = 0;
    const lastReason = 'fixture-only maintenance does not prove changed behavior';
    const runner: StepRunner = {
      run: async (step): Promise<StepRunResult> => {
        if (step === 'build_review') {
          reviewRuns += 1;
          if (reviewRuns > 6) {
            return { success: false, output: 'sentinel: cumulative halt did not stop the seventh review' };
          }
          await writeFile(join(pipelineDir, 'build-review.json'), failVerdict(lastReason));
          return { success: true, output: 'faithful failing grader result' };
        }
        if (step === 'build') {
          buildRuns += 1;
          await writeFile(join(dir, 'work.txt'), `remediation ${buildRuns}\n`);
          await writeFile(
            join(pipelineDir, 'task-status.json'),
            JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
          );
          await git(dir, 'add', 'work.txt');
          await git(dir, 'commit', '-qm', `remediation ${buildRuns}`);
          return { success: true };
        }
        return { success: false, output: `unexpected dispatch: ${step}` };
      },
      resetSession: async () => {},
    };

    const kickbacks: Array<{ count: number; cumulativeCount?: number }> = [];
    const haltReasons: string[] = [];
    const events = new ConductorEventEmitter();
    events.on('kickback', (event) => {
      const observed = event as unknown as { count: number; cumulativeCount?: number };
      kickbacks.push({ count: observed.count, cumulativeCount: observed.cumulativeCount });
    });
    events.on('loop_halt', (event) => {
      const observed = event as unknown as { reason: string };
      haltReasons.push(observed.reason);
    });

    const options: ConductorOptions = {
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
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
      git: async (args) => {
        if (args[0] === 'rev-parse' && args.includes('@{u}')) {
          return { stdout: 'refs/remotes/origin/main' };
        }
        return { stdout: '' };
      },
      shipmentEvidence: async (input: ShipmentEvidenceInput) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
    };

    await new Conductor(options).run();

    expect(reviewRuns).toBe(6);
    expect(buildRuns).toBe(5);
    expect(await readHaltClass(dir)).toBe('needs-human');
    expect(haltReasons).toHaveLength(1);
    expect(haltReasons[0]).toContain('build_review');
    expect(haltReasons[0]).toContain('6');
    expect(haltReasons[0]).toContain('5');
    expect(haltReasons[0]).toContain(lastReason);
    // The sixth failed review consumes and persists the counter, but does not
    // emit a kickback: the cap halts before it can rewind to build.
    expect(kickbacks).toEqual([
      { count: 1, cumulativeCount: 1 },
      { count: 1, cumulativeCount: 2 },
      { count: 1, cumulativeCount: 3 },
      { count: 1, cumulativeCount: 4 },
      { count: 1, cumulativeCount: 5 },
    ]);
    await expect(readKickbackLedger(dir)).resolves.toMatchObject({
      gates: { build_review: { cumulative: 6, count: 1 } },
    });
  }, 60_000);
});

describe('acceptance: removal evidence reaches the real build_review prompt (#1521 Story 7)', () => {
  it('renders specific diff-derived removals and the per-test Tautology guard', async () => {
    const repository = await initRepo('build-review-removals-');
    const planPath = join(repository, '.docs', 'plans', 'removal-fixture.md');
    await mkdir(join(repository, '.docs', 'plans'), { recursive: true });
    await mkdir(join(repository, 'src'), { recursive: true });
    await mkdir(join(repository, 'test'), { recursive: true });
    await writeFile(planPath, '# Plan\n\n### Task 1: remove obsolete compatibility shape\n');
    await writeFile(join(repository, '.gitignore'), '.pipeline/\n');
    await writeFile(join(repository, 'src', 'obsolete.ts'), 'export const obsoleteAdapter = true;\n');
    await writeFile(
      join(repository, 'src', 'contract.ts'),
      'export interface ReviewContract {\n  retained: string;\n  removedFixtureField: string;\n}\n',
    );
    await writeFile(
      join(repository, 'test', 'contract.fixture.ts'),
      "export const fixture = { retained: 'yes', removedFixtureField: 'legacy' };\n",
    );
    await git(repository, 'add', '.');
    await git(repository, 'commit', '-qm', 'base');
    await mkdir(join(repository, '.worktrees'), { recursive: true });
    const dir = join(repository, '.worktrees', 'removal-fixture');
    await git(repository, 'worktree', 'add', '-qb', 'feature/removal-evidence', dir);
    const pipelineDir = join(dir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
    await rm(join(dir, 'src', 'obsolete.ts'));
    await writeFile(
      join(dir, 'src', 'contract.ts'),
      'export interface ReviewContract {\n  retained: string;\n}\n',
    );
    await writeFile(join(dir, 'test', 'contract.fixture.ts'), "export const fixture = { retained: 'yes' };\n");
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-qm', 'remove obsolete compatibility shape');

    const prompts: string[] = [];
    const headSha = await git(dir, 'rev-parse', 'HEAD');
    const provider: LLMProvider = {
      invoke: vi.fn(async (options) => {
        prompts.push(options.prompt);
        const projection = JSON.parse(options.prompt.split('\n\n').at(-1)!) as {
          rubric: string; lapId: string; snapshotDigest: string;
        };
        return {
          success: true,
          output: JSON.stringify({
            kind: 'judged', rubric: projection.rubric, lapId: projection.lapId,
            snapshotDigest: projection.snapshotDigest, contractVersion: 'v1', findings: [],
          }),
          exitCode: 0,
        };
      }),
      invokeInteractive: vi.fn().mockResolvedValue(undefined),
    };
    const runner = new DefaultStepRunner(provider, 'removal-evidence-session', dir, {
      planPath,
      pipelineDir,
      config: {
        build_review: { enabled: true, perTaskFloor: false },
        test_suite: { scoped_command: 'true {selectors}' },
        wiring: { entry_points: ['src/contract.ts'] },
      },
      buildReviewInputOptions: {
        inspectTestSuite: async () => ({
          status: 'CURRENT', evidence: { provenanceHeadSha: headSha, outcome: 'PASS' },
        } as never),
      },
    });

    const result = await runner.run('build_review', {
      complexity_tier: 'M',
      feature_desc: 'removal-fixture',
      track: 'technical',
    });

    expect(result.success, result.output).toBe(true);
    expect(provider.invoke).toHaveBeenCalledTimes(5);
    const wiringPrompt = prompts.find((prompt) => prompt.includes('Build Review Wiring rubric'))!;
    expect(wiringPrompt).toContain('src/obsolete.ts');
    expect(wiringPrompt).toContain('removedFixtureField');
  });
});
