/**
 * Unit-level coverage for Task 3 of the verify-only-prove-closed-task-evidence
 * plan: the gate-miss branch's class-scoped lane-arming predicate
 * (`conductor.ts` around the auto-heal/attribution-lane block).
 *
 * These are narrower, faster complements to the full end-to-end acceptance
 * spec in test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts
 * — they drive the same `Conductor.run()` seam but assert only the dispatch
 * condition and residueIds narrowing described in the plan's Technical
 * Approach:
 *
 *   (cutoverActive && residueIds.length > 0) || verifyOnlyResidue.length > 0
 *
 * When only the class-scoped predicate arms the lane (cutover dark), the
 * lane must be dispatched with residueIds narrowed to ONLY the verify-only
 * subset — never widened to unmarked residue.
 *
 * Task: 3
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { ConductorEventEmitter } from '../src/ui/events.js';
import { readState, writeState } from '../src/engine/state.js';
import { ALL_STEPS } from '../src/engine/steps.js';
import { Conductor } from '../src/engine/conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../src/engine/conductor.js';
import type { ConductState, StepName } from '../src/types/index.js';

interface Repo {
  root: string;
  bareOrigin: string;
}

async function initRepo(prefix: string): Promise<Repo> {
  const root = await mkdtemp(join(tmpdir(), `${prefix}-`));
  const bareOrigin = await mkdtemp(join(tmpdir(), `${prefix}-origin-`));
  await execa('git', ['init', '--bare'], { cwd: bareOrigin });
  await execa('git', ['init', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# fixture\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-m', 'chore: init'], { cwd: root });
  await execa('git', ['remote', 'add', 'origin', bareOrigin], { cwd: root });
  await execa('git', ['push', '-u', 'origin', 'main'], { cwd: root });
  return { root, bareOrigin };
}

async function commit(repo: Repo, file: string, contents: string, message: string): Promise<string> {
  const fileDir = join(repo.root, file.split('/').slice(0, -1).join('/') || '.');
  await mkdir(fileDir, { recursive: true });
  await writeFile(join(repo.root, file), contents, 'utf-8');
  await execa('git', ['add', file], { cwd: repo.root });
  await execa('git', ['commit', '-m', message], { cwd: repo.root });
  const sha = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return sha.stdout.trim();
}

async function writePlan(repo: Repo, slug: string, body: string): Promise<string> {
  const planPath = join(repo.root, '.docs/plans', `${slug}.md`);
  await writeFile(planPath, body, 'utf-8');
  return planPath;
}

async function writeTaskStatus(repo: Repo, taskIds: string[]): Promise<void> {
  const tasks = taskIds.map((id) => ({ id, status: 'pending' }));
  await writeFile(
    join(repo.root, '.pipeline/task-status.json'),
    JSON.stringify({ tasks }, null, 2) + '\n',
    'utf-8',
  );
}

async function seedToBuildGate(statePath: string, featureDesc: string): Promise<void> {
  const state: Record<string, unknown> = {};
  for (const s of ALL_STEPS) {
    if (s.name === 'build') break;
    state[s.name] = 'done';
  }
  state.complexity_tier = 'M';
  state.feature_desc = featureDesc;
  state.track = 'technical';
  await writeState(statePath, state as unknown as ConductState);
}

function makeVerdictWritingDispatcher(
  repo: Repo,
  verdictBuilder: (residueIds: string[]) => unknown,
): {
  dispatchVerifier: NonNullable<StepRunner['dispatchVerifier']>;
  calls: Array<{ residueIds: string[] }>;
} {
  const calls: Array<{ residueIds: string[] }> = [];
  const dispatchVerifier: NonNullable<StepRunner['dispatchVerifier']> = async (inputs) => {
    calls.push({ residueIds: [...inputs.residueIds] });
    const verdict = verdictBuilder(inputs.residueIds);
    await writeFile(
      join(repo.root, '.pipeline/attribution-verdict.json'),
      JSON.stringify(verdict, null, 2),
      'utf-8',
    );
    return { success: true, output: JSON.stringify(verdict) };
  };
  return { dispatchVerifier, calls };
}

function makeStepRunner(
  buildResult: StepRunResult,
  dispatchVerifier: NonNullable<StepRunner['dispatchVerifier']>,
  repo: Repo,
): { runner: StepRunner; buildCalls: Array<{ retryReason?: string }> } {
  const buildCalls: Array<{ retryReason?: string }> = [];
  const runner: StepRunner = {
    run: async (step: StepName, _state: ConductState, opts?: StepRunOptions): Promise<StepRunResult> => {
      if (step === 'build') {
        buildCalls.push({ retryReason: opts?.retryReason });
        return buildResult;
      }
      const pipelineDir = join(repo.root, '.pipeline');
      if (step === 'manual_test') {
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(
          join(pipelineDir, 'manual-test-results.md'),
          '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
          'utf-8',
        );
        return { success: true };
      }
      if (step === 'build_review') {
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(
          join(pipelineDir, 'build-review.md'),
          '# Build Review\n\n| Item | Status |\n|--|--|\n| Design | approved |\n',
          'utf-8',
        );
        return { success: true };
      }
      if (step === 'wiring_check') {
        await mkdir(pipelineDir, { recursive: true });
        const head = (await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root })).stdout.trim();
        await writeFile(
          join(pipelineDir, 'wiring-evidence.json'),
          JSON.stringify({
            schema: 1,
            base: head,
            head,
            layer2: { applicable: false },
            waivers: [],
            tasks: [{ id: '1', contract: 'none (no new production surface)', gaps: [] }],
          }),
          'utf-8',
        );
        return { success: true };
      }
      if (step === 'architecture_review_as_built') {
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(
          join(pipelineDir, 'architecture-review-as-built.md'),
          '# Architecture Review\n\nVerdict: APPROVED\n\n| Item | Status |\n|--|--|\n| Aligned | approved |\n',
          'utf-8',
        );
        return { success: true };
      }
      if (step === 'prd_audit') {
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(
          join(pipelineDir, 'prd-audit.md'),
          '# PRD Audit\n\nNo FRs to audit (technical track).\n',
          'utf-8',
        );
        return { success: true };
      }
      if (step === 'retro') {
        const retroDir = join(repo.root, '.docs/retros');
        await mkdir(retroDir, { recursive: true });
        await writeFile(
          join(retroDir, '2026-07-20-fixture.md'),
          '# Retro\n\nNothing notable.\n',
          'utf-8',
        );
        return { success: true };
      }
      if (step === 'finish') {
        await mkdir(pipelineDir, { recursive: true });
        await execa('git', ['push', 'origin', 'HEAD'], { cwd: repo.root }).catch(() => {});
        await writeFile(join(pipelineDir, 'finish-choice'), 'pr\n', 'utf-8');
        await writeFile(
          join(pipelineDir, 'conduct-state.json'),
          JSON.stringify({ pr_url: 'https://github.com/example/repo/pull/1' }, null, 2),
          'utf-8',
        );
        return { success: true };
      }
      return { success: true };
    },
    dispatchVerifier,
  };
  return { runner, buildCalls };
}

function makeRealGitRunner(repo: Repo): (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }> {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execa('git', args, { cwd: opts.cwd ?? repo.root });
    return { stdout: String(result.stdout ?? '') };
  };
}

describe('conductor build-gate: class-scoped verify-only lane-arming predicate', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await Promise.all(
      repos.flatMap((r) => [
        rm(r.root, { recursive: true, force: true }),
        rm(r.bareOrigin, { recursive: true, force: true }),
      ]),
    );
    repos = [];
  });

  it('cutover dark, residue ["4"] marked verify-only -> lane dispatched with residueIds ["4"]', async () => {
    const repo = await initRepo('bg-marked-only-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'bg-marked-only');

    await writePlan(
      repo,
      'bg-marked-only',
      '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['4']);

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: '1'.repeat(40), rationale: 'n/a' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const { runner } = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      git: makeRealGitRunner(repo),
      maxRetries: 1,
      fromStep: 'build',
      // No attribution_judge_cutover: dark.
    });

    await conductor.run();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].residueIds).toEqual(['4']);
  });

  it('cutover dark, residue with marked and unmarked ids -> lane dispatched with ONLY the marked subset', async () => {
    const repo = await initRepo('bg-mixed-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'bg-mixed');

    await writePlan(
      repo,
      'bg-mixed',
      '### Task 3\n**Files likely touched:** `a.ts`\n\nNot marked.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['3', '4']);

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: '1'.repeat(40), rationale: 'n/a' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const { runner } = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      git: makeRealGitRunner(repo),
      maxRetries: 1,
      fromStep: 'build',
    });

    await conductor.run();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].residueIds).toEqual(['4']);
  });

  it('cutover dark, no marked residue -> lane not dispatched (byte-identical to today)', async () => {
    const repo = await initRepo('bg-none-marked-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'bg-none-marked');

    await writePlan(
      repo,
      'bg-none-marked',
      '### Task 3\n**Files likely touched:** `a.ts`\n\nNot marked.\n' +
        '### Task 4\n**Files likely touched:** `b.ts`\n\nAlso not marked.\n',
    );
    await writeTaskStatus(repo, ['3', '4']);

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: '1'.repeat(40), rationale: 'should never be reached' }],
        testEvidence: { command: 'x', exit: 0 },
      })),
    }));

    const { runner } = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      git: makeRealGitRunner(repo),
      maxRetries: 1,
      fromStep: 'build',
    });

    await conductor.run();

    expect(calls).toHaveLength(0);
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
  });

  it('cutover active -> existing full-residue dispatch behavior unchanged (regression)', async () => {
    const repo = await initRepo('bg-cutover-active-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'bg-cutover-active');

    await writePlan(
      repo,
      'bg-cutover-active',
      '### Task 3\n**Files likely touched:** `a.ts`\n\nNot marked.\n' +
        '### Task 4\n**Files likely touched:** `b.ts`\n\nAlso not marked.\n',
    );
    await writeTaskStatus(repo, ['3', '4']);

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: '1'.repeat(40), rationale: 'n/a' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const { runner } = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      git: makeRealGitRunner(repo),
      maxRetries: 1,
      fromStep: 'build',
      config: { attribution_judge_cutover: '2000-01-01' } as any,
    });

    await conductor.run();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[0].residueIds.sort()).toEqual(['3', '4']);
  });
});
