/**
 * Acceptance spec for "no-diff-task-evidence-stamp" (#733) —
 * .docs/stories/no-diff-task-evidence-stamp.md Story 6 (6 stories total,
 * Accepted) + .docs/decisions/adr-2026-07-21-no-diff-task-evidence-stamp.md.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): Story 6 replays the exact #733 stall
 * shape, which crosses TWO independent engine seams that only interact at
 * `Conductor.run()`'s build-gate loop:
 *   (a) `deriveCompletionInternal`'s `Evidence: skipped` branch minting an
 *       `evidenceStamps` entry (Story 1/3, unit-covered in
 *       `autoheal.test.ts`) feeding into
 *   (b) the build completion predicate (`artifacts.ts`) counting that stamp
 *       resolved, AND
 *   (c) `parsePlanTaskVerifyOnly` recognizing `**Type:** verification`
 *       (Story 2/5, unit-covered in `autoheal.test.ts`) arming the
 *       judged-closure lane in `conductor.ts`'s gate-miss branch, whose
 *       `satisfied` verdict must write a `semantic-verified` stamp (guarded
 *       against whitewash per Story 4, unit-covered in
 *       `attribution-lane.test.ts`).
 * Each piece works in isolation once implemented; only a test that drives
 * `Conductor.run()` itself over a real git repo proves the WIRING that a
 * plan combining BOTH no-diff shapes in one batch — a skip-closed
 * Verify-only task and a Type: verification residue task — reaches
 * `build: done` instead of stalling `no_task_progress (N->N)`, mirroring
 * the #733 batch (5 of 6 builds auto-parked on 2026-07-21).
 *
 * Drives a REAL git repo (`mkdtemp` + real `git`, unmocked) and a REAL
 * `Conductor` instance, following the same fixture pattern as the #677
 * acceptance spec (`verify-only-prove-closed-task-evidence.acceptance.test.ts`).
 * Only the verifier session itself is stubbed (`stepRunner.dispatchVerifier`)
 * — the true external system boundary.
 *
 * PRE-FIX RED: as of this file's authoring, neither Edit A (the `Evidence:
 * skipped` branch minting a stamp) nor Edit B (`**Type:** verification`
 * arming `parsePlanTaskVerifyOnly`) exists in `autoheal.ts`. The happy-path
 * case below is expected to FAIL (build never reaches `done`; the skipped
 * task and the verification-typed task both stay unresolved). The negative
 * case (a self-reported `skipped` row with no commit) is expected to PASS
 * already — it pins the derive-from-git invariant the fix must not regress.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult, StepRunOptions } from '../../src/engine/conductor.js';
import type { ConductState, StepName } from '../../src/types/index.js';

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

async function emptyCommit(repo: Repo, message: string): Promise<string> {
  await execa('git', ['commit', '--allow-empty', '-m', message], { cwd: repo.root });
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
          join(retroDir, '2026-07-21-fixture.md'),
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

async function taskEvidenceRaw(repo: Repo): Promise<string | null> {
  return readFile(join(repo.root, '.pipeline/task-evidence.json'), 'utf-8').catch(() => null);
}

describe('acceptance: the #733 no-diff stall shape reaches gate-pass (Evidence: skipped + Type: verification)', () => {
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

  // ── Story 6 (happy path) ─────────────────────────────────────────────────

  it('a plan with a skip-closed Verify-only task and a Type: verification residue task both resolve and the build advances', async () => {
    const repo = await initRepo('nodiffstamp-happy-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'nodiffstamp-fixture');

    // Task 2 resolves mechanically via a trailered commit.
    // Task 3 is the #733 mid-plan shape: a **Verify-only: yes** task closed
    // by a real `Evidence: skipped <reason>` commit — no diff of its own.
    // Task 4 is the #733 tail shape: a no-diff **Type: verification**
    // "GREEN + full-suite check" — no diff, no skip trailer, only a
    // judged-closure verdict can resolve it.
    await writePlan(
      repo,
      'nodiffstamp-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 3\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\n' +
        'Already-satisfied contract; close or prove closed.\n' +
        '### Task 4\n**Type:** verification\n\n' +
        'GREEN + full-suite check.\n',
    );
    await writeTaskStatus(repo, ['2', '3', '4']);
    const shaA = await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');
    await emptyCommit(repo, 'chore: task 3 already satisfied\n\nTask: 3\nEvidence: skipped already covered by task 2\n');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: shaA, rationale: 'full-suite verified green against task 2' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: 'all passed' },
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
      maxRetries: 2,
      fromStep: 'build',
      // No attribution_judge_cutover key: global cutover is DARK. Only the
      // Type: verification residue task should arm the judged-closure lane;
      // task 3 must resolve through the skip stamp, never through the lane.
      // build_review is default-on (#773 Task 4); this test only exercises
      // the `build` gate and its fake stepRunner has no build_review
      // handling, so opt out explicitly to keep scope unchanged.
      config: { build_review: { enabled: false } } as never,
    });

    await conductor.run();

    // Only task 4 (Type: verification) should ever reach the verifier —
    // task 3 resolves deterministically through the Evidence: skipped stamp
    // before residue is computed (own-diff/skip-before-lane ordering).
    expect(calls.length).toBeGreaterThanOrEqual(1);
    expect(calls[calls.length - 1].residueIds).toEqual(['4']);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).toBe('done');
    }
    expect(await haltMarkerContent(repo)).toBeNull();
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw).toMatch(/evidence:skipped/);
    expect(evidenceRaw).toMatch(/semantic-verified/);
  });

  // ── Story 3 (negative: self-reported skip with no commit resolves nothing) ─

  it('a task-status row merely claiming skipped, with no Evidence: skipped commit on the branch, never reaches done (pins today\'s behavior)', async () => {
    const repo = await initRepo('nodiffstamp-forged-skip-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'forged-skip-fixture');

    await writePlan(
      repo,
      'forged-skip-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 3\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nClose or prove closed.\n',
    );
    // task-status.json CLAIMS task 3 is skipped, but no Evidence: skipped
    // commit exists on the branch for it — the derive-from-git invariant
    // must ignore the self-reported row entirely.
    await writeFile(
      join(repo.root, '.pipeline/task-status.json'),
      JSON.stringify(
        { tasks: [{ id: '2', status: 'pending' }, { id: '3', status: 'skipped' }] },
        null,
        2,
      ) + '\n',
      'utf-8',
    );
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'unsatisfied',
        reason: 'no commit substantiates task 3',
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

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/evidence:skipped/);
    void calls;
  });
});
