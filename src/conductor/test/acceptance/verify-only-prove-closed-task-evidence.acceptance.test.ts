/**
 * Acceptance specs for "verify-only-prove-closed-task-evidence" (#677) —
 * .docs/stories/verify-only-prove-closed-task-evidence.md Story 3 (5 stories
 * total, Accepted) + .docs/decisions/adr-2026-07-17-verify-only-judged-closure.md.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): Story 3 is a multi-step flow crossing the
 * SAME `Conductor.run()` gate-miss seam as #581
 * (`test/acceptance/judged-attribution-verdict-persistence.acceptance.test.ts`):
 * gate-miss residue computation -> class-scoped lane-arming predicate ->
 * `runAttributionLane` dispatch -> citation validation -> `semantic-verified`
 * stamp write -> in-loop completion re-check -> task-row flip. Each of those
 * steps works correctly in isolation once implemented (unit-covered per the
 * plan's Tasks 1-3 in `autoheal.test.ts` / `conductor.build-gate.test.ts`);
 * only a test that drives `Conductor.run()` itself proves the WIRING between
 * "residue contains only a verify-only-marked id" and "the lane dispatches
 * despite a dark global `attribution_judge_cutover`" — the exact gap #677
 * reports (task 4 stayed pending, `noEvidenceAttempts` burned to 3, an
 * evaluator-APPROVED build auto-parked).
 *
 * Stories 1, 2, 5, 6 are single-function-level derivations (plan-marker
 * authoring/parsing, the commit-msg hook, skill docs) already unit-covered
 * per the plan's Tasks 1, 2, 6, 8. Story 4 (auto-park reason enrichment) is
 * a single call into `daemon-auto-park.ts`, unit-covered per Task 7. Only
 * Story 3 crosses 2+ engine call sites, so only Story 3 gets an acceptance
 * spec.
 *
 * Drives a REAL git repo (`mkdtemp` + real `git`, unmocked) and a REAL
 * `Conductor` instance, mirroring the #581 acceptance spec's fixtures
 * exactly. Only the verifier session itself is stubbed
 * (`stepRunner.dispatchVerifier`) — the true external system boundary.
 *
 * PRE-FIX RED: as of this file's authoring, `parsePlanTaskPaths` does not
 * recognize `**Verify-only:** yes` and the gate-miss branch
 * (`conductor.ts:~3208-3230`) only dispatches the lane when
 * `isAttributionJudgeCutoverActive(...)` is true — there is no class-scoped
 * verify-only-residue predicate. All four cases below currently observe
 * TODAY's (pre-fix) behavior: the lane never dispatches with the cutover
 * dark, so the happy-path case is expected to FAIL (build never reaches
 * `done`) and the "not marked" negative case is expected to PASS already
 * (it pins the byte-identical invariant the fix must not regress).
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
          join(retroDir, '2026-07-17-fixture.md'),
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

describe('acceptance: verify-only residue dispatches the judged lane despite a dark cutover (#677)', () => {
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

  // ── Story 3 (happy path) ────────────────────────────────────────────────

  it('a residue task marked Verify-only is judged and stamped even with the global cutover dark, and the build advances on the same attempt', async () => {
    const repo = await initRepo('verifyonly-happy-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'verifyonly-fixture');

    // Task 2 resolves mechanically via a trailered commit. Task 4 is
    // "close or prove closed" — marked Verify-only, produces no commit of
    // its own (the exact #677 shape: no derived evidence, would otherwise
    // strand the build forever with the cutover dark).
    await writePlan(
      repo,
      'verifyonly-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\n' +
        'Close or prove closed the root-mismatch.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
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
      maxRetries: 1,
      fromStep: 'build',
      // No attribution_judge_cutover key: global cutover is DARK. Only the
      // verify-only-marked residue task should arm the lane.
      // build_review is default-on (#773 Task 4); this test only exercises
      // the `build` gate and its fake stepRunner has no build_review
      // handling, so opt out explicitly to keep scope unchanged.
      config: { build_review: { enabled: false } } as never,
    });

    await conductor.run();

    expect(calls).toHaveLength(1);
    expect(calls[0].residueIds).toEqual(['4']);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).toBe('done');
    }
    expect(await haltMarkerContent(repo)).toBeNull();
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw).toMatch(/semantic-verified/);
  });

  // ── Story 3 (negative: not marked, cutover dark => byte-identical) ─────

  it('the same residue WITHOUT the Verify-only marker is not dispatched while the cutover is dark (byte-identical to today)', async () => {
    const repo = await initRepo('verifyonly-unmarked-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'unmarked-fixture');

    await writePlan(
      repo,
      'unmarked-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Files likely touched:** `b.ts`\n\nNot marked verify-only.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

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

  // ── Story 3 (negative: forged citation is rejected) ─────────────────────

  it('a verify-only residue task whose verdict cites an unreachable sha is refused — no stamp, build still refuses', async () => {
    const repo = await initRepo('verifyonly-forged-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'forged-fixture');

    await writePlan(
      repo,
      'forged-fixture',
      '### Task 2\n**Files likely touched:** `a.ts`\n\nA.\n' +
        '### Task 4\n**Verify-only:** yes\n**Files likely touched:** `b.ts`\n\nProve closed.\n',
    );
    await writeTaskStatus(repo, ['2', '4']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 2\n');

    const forgedSha = '0'.repeat(40);
    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: forgedSha, rationale: 'forged' }],
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

    // No maxRetries cap is set here, so the completion-gate retry loop may
    // dispatch the verifier again on a subsequent attempt (the forged
    // citation is refused every time — the call-count is a retry-budget
    // artifact, not the invariant under test). What matters is asserted
    // below: the forged citation is never validated into a stamp, on any
    // attempt.
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/semantic-verified/);
  });

  // ── Story 3 (negative: verifier abstains => loud reason in retry hint) ──

  it('a verify-only residue task the verifier abstains on surfaces a loud reason naming the task in the next BUILD retry hint', async () => {
    const repo = await initRepo('verifyonly-abstain-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'abstain-fixture');

    await writePlan(
      repo,
      'abstain-fixture',
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
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/semantic-verified/);
  });
});
