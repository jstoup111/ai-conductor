/**
 * Task 4 (verify-only-prove-closed-task-evidence, #677) — integration proof
 * that a `**Verify-only:** yes` residue task resolves end-to-end through the
 * judged attribution lane, driven at the same `Conductor.run()` seam as the
 * plan's Task 3 acceptance spec
 * (test/acceptance/verify-only-prove-closed-task-evidence.acceptance.test.ts),
 * but adding the evidence-lifecycle assertions Task 4 owns: the durable
 * `noEvidenceAttempts` counter resets via progress detection, and no
 * auto-park fires even when the counter started at a non-zero value.
 *
 * Also proves the citation-validation fix this task made: a verify-only
 * task's citation legitimately points at an ANCESTOR commit that does not
 * touch that task's own declared `Files:` path (the whole point of
 * "prove closed" — the task has no dedicated delta of its own). The
 * engine's path-overlap check (attribution-validate.ts Check 5) is relaxed
 * for verify-only tasks ONLY; existence, ancestry, non-empty, and
 * not-bookkeeping stay fully enforced (adversarial paths are Task 5's scope,
 * not touched here).
 *
 * Drives a REAL git repo (`mkdtemp` + real `git`, unmocked) and a REAL
 * `Conductor` instance. Only the verifier session itself is stubbed
 * (`stepRunner.dispatchVerifier`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
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

/** Seed .pipeline/task-evidence.json with a pre-existing noEvidenceAttempts
 * count so the test can prove progress detection resets it to 0 rather than
 * merely never incrementing it. */
async function seedNoEvidenceAttempts(repo: Repo, count: number): Promise<void> {
  await writeFile(
    join(repo.root, '.pipeline/task-evidence.json'),
    JSON.stringify(
      { schema: 1, evidenceStamps: [], noEvidenceAttempts: count, noEvidenceReasons: [], lastResolvedCount: 0 },
      null,
      2,
    ) + '\n',
    'utf-8',
  );
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

async function haltMarkerContent(repo: Repo): Promise<string | null> {
  return readFile(join(repo.root, '.pipeline/HALT'), 'utf-8').catch(() => null);
}

async function taskEvidenceRaw(repo: Repo): Promise<Record<string, unknown> | null> {
  const raw = await readFile(join(repo.root, '.pipeline/task-evidence.json'), 'utf-8').catch(() => null);
  return raw ? JSON.parse(raw) : null;
}

describe('integration: verify-only judged stamp resolves a task end-to-end (#677 Task 4)', () => {
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

  it('a verify-only task judged satisfied by an ancestor commit that does not touch its own declared path is stamped, flips the build gate, resets noEvidenceAttempts, and never auto-parks', async () => {
    const repo = await initRepo('lane-e2e-happy-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'lane-e2e-fixture');

    // Task 2 is a real, mechanically-resolved task (trailered commit).
    // Task 4 is verify-only: its declared path (`b.ts`) is never touched by
    // any commit — the whole point of "prove closed" is that task 2's
    // commit already covers it. The verifier cites task 2's commit as
    // evidence for task 4.
    await writePlan(
      repo,
      'lane-e2e-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\n' +
        'Close or prove closed the root-mismatch — already covered by task 2.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    // A pre-existing non-zero noEvidenceAttempts proves this run's progress
    // resets the counter, not merely that it started at 0.
    await seedNoEvidenceAttempts(repo, 2);
    const shaA = await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: shaA, rationale: 'already covered by task 2 (a.ts)' }],
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
      maxRetries: 3,
      fromStep: 'build',
      // No attribution_judge_cutover key: global cutover is DARK. Only the
      // verify-only-marked residue task should arm the lane.
    });

    await conductor.run();

    // The lane dispatched for task 4's residue at least once (a bonus
    // progress-bypass attempt from task 2's auto-heal may add another
    // dispatch for the still-open residue before it resolves — that is
    // existing, correct build_progress_halt behavior, not part of this
    // task's scope). Every dispatch must be scoped to task 4 only.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const call of calls) {
      expect(call.residueIds).toEqual(['4']);
    }

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).toBe('done');
    }
    expect(await haltMarkerContent(repo)).toBeNull();

    const evidence = await taskEvidenceRaw(repo);
    expect(JSON.stringify(evidence)).toMatch(/semantic-verified/);
    expect(evidence?.noEvidenceAttempts).toBe(0);
  });

  // ── Task 5: adversarial paths ───────────────────────────────────────────

  it('a verify-only residue task whose citation names a NONEXISTENT sha is refused — no stamp, task stays unresolved', async () => {
    const repo = await initRepo('lane-nonexistent-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'lane-nonexistent-fixture');

    await writePlan(
      repo,
      'lane-nonexistent-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    const nonexistentSha = 'abc123def456abc123def456abc123def456abc';
    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: nonexistentSha, rationale: 'sha does not exist' }],
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
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidence = await taskEvidenceRaw(repo);
    expect(JSON.stringify(evidence ?? {})).not.toMatch(/semantic-verified/);
  });

  it('a verify-only residue task whose citation names a sha that is NOT an ancestor of HEAD is refused — no stamp, task stays unresolved', async () => {
    const repo = await initRepo('lane-non-ancestor-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'lane-non-ancestor-fixture');

    await writePlan(
      repo,
      'lane-non-ancestor-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    // A commit that exists in the repo's object database but lives on a
    // side branch never merged into HEAD — reachable, but not an ancestor.
    await execa('git', ['checkout', '-b', 'side-branch'], { cwd: repo.root });
    const sideSha = await commit(repo, 'off-branch.ts', 'export const z = 1;\n', 'chore: off-branch commit');
    await execa('git', ['checkout', 'main'], { cwd: repo.root });

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: sideSha, rationale: 'off-branch, not an ancestor' }],
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
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidence = await taskEvidenceRaw(repo);
    expect(JSON.stringify(evidence ?? {})).not.toMatch(/semantic-verified/);
  });

  it('a verdict entry naming a task ID outside the dispatched residue set is not stamped — the residue task stays unresolved', async () => {
    const repo = await initRepo('lane-non-residue-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'lane-non-residue-fixture');

    // Task 2 already resolved mechanically (trailered commit) — it is NOT
    // part of the residue dispatched to the verifier. Task 4 is the only
    // verify-only residue task.
    await writePlan(
      repo,
      'lane-non-residue-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    const shaA = await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    // The verifier is only ever asked to judge residue (task 4), but a
    // buggy/adversarial verdict response smuggles a "satisfied" entry for
    // task 2 (already resolved, not residue) and omits task 4 entirely.
    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: [
        {
          taskId: '2',
          verdict: 'satisfied',
          citations: [{ sha: shaA, rationale: 'not part of the dispatched residue' }],
          testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
        },
      ],
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
    // The verifier was only ever asked about task 4.
    for (const call of calls) {
      expect(call.residueIds).toEqual(['4']);
    }
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidence = await taskEvidenceRaw(repo);
    expect(JSON.stringify(evidence ?? {})).not.toMatch(/semantic-verified/);
  });

  it('a verifier abstain (unsatisfied verdict) on a verify-only residue task surfaces a loud reason naming the task in the next BUILD retry hint — no stamp, budget increments', async () => {
    const repo = await initRepo('lane-abstain-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'lane-abstain-fixture');

    await writePlan(
      repo,
      'lane-abstain-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'unsatisfied',
        reason: 'no commit substantiates task 4',
      })),
    }));

    const { runner, buildCalls } = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      git: makeRealGitRunner(repo),
      // Two attempts so the second attempt's retryReason (queued by the
      // first attempt's gate-miss lane dispatch) is observable.
      maxRetries: 2,
      fromStep: 'build',
    });

    await conductor.run();

    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(buildCalls.length).toBeGreaterThanOrEqual(2);
    const secondAttemptHint = buildCalls[1]?.retryReason ?? '';
    expect(secondAttemptHint).toMatch(/task 4/);
    expect(secondAttemptHint).toMatch(/no commit substantiates task 4/);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidence = await taskEvidenceRaw(repo);
    expect(JSON.stringify(evidence ?? {})).not.toMatch(/semantic-verified/);
  });
});
