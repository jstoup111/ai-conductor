/**
 * Acceptance specs for "judged-attribution-verdict-persistence" (#581) —
 * .docs/stories/judged-attribution-verdict-persistence.md (5 stories,
 * Accepted) + .docs/decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): the bug this feature fixes is a wiring gap
 * INSIDE `Conductor.run()`'s build gate-miss branch (`conductor.ts:~1863-2069`):
 * `completion` is snapshotted BEFORE `runAttributionLane` runs, and the halt
 * decision `if (!completion.done)` reads that stale snapshot even after the
 * lane stamps every residue task `satisfied`. `runAttributionLane` and
 * `checkStepCompletion` each work correctly in isolation (see
 * `test/acceptance/evidence-gate-validates-provenance-proxies-not-whe.acceptance.test.ts`,
 * Section C, which drives them by hand in sequence and gets a green result) —
 * that composition passing proves nothing about whether the PRODUCTION call
 * path (`Conductor.run()`) performs the same re-check. It does not; only a
 * test that drives `Conductor.run()` itself can observe the omission. This
 * mirrors the project's own precedent for exercising the gate-miss branch
 * (`test/engine/conductor.test.ts`'s `seedToBuildGate` + `fromStep: 'build'`
 * pattern) rather than the full SDLC loop from `worktree`.
 *
 * Drives a REAL git repo (`mkdtemp` + real `git`, unmocked — `currentCommitSha`
 * shells out directly and would return null against a mocked/fake repo,
 * silently skipping the lane) and a REAL `Conductor` instance. Only the
 * verifier session itself is stubbed (`stepRunner.dispatchVerifier`) — the
 * true external system boundary, mirroring the `makeVerdictWritingDispatcher`
 * convention used throughout this repo's other attribution acceptance specs.
 *
 * PRE-FIX RED: as of this file's authoring, `conductor.ts` does not re-run
 * `checkStepCompletion` after the lane stamps (see the comment at
 * conductor.ts:2059-2065, "This run does not re-derive to check stamps
 * immediately"). Story 1's tests are expected to FAIL against that code:
 * the build halts/fails on the SAME attempt a fully-covered judged verdict
 * lands, instead of advancing. Story 2/4's tests assert behavior that
 * already holds today (no-whitewash, cutover-absent byte-identical) and
 * MUST stay green both before and after the fix — they pin the invariant
 * the fix must not regress.
 *
 * Scope: Story 3 (semantic-verified stamp precedence over a failed trailer)
 * and Story 5 (stale-anchor coercion) are single-function-level derivations
 * — `deriveCompletionInternal` (autoheal.ts) and the verdict parser
 * (attribution-lane.ts's stale-anchor guard, already covered by
 * evidence-gate-validates-provenance-proxies-not-whe.acceptance.test.ts
 * Section F's first case) — not multi-step flows crossing this file's seam.
 * Per the implementation plan (.docs/plans/judged-attribution-verdict-persistence.md
 * Tasks 5 and 7), they are unit-covered in `test/engine/autoheal.test.ts` and
 * `test/engine/attribution-lane.test.ts` respectively.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import type { ConductState, StepName } from '../../src/types/index.js';

interface Repo {
  root: string;
  bareOrigin: string;
}

/**
 * deriveCompletion's evidence-range resolution (autoheal.ts's
 * `resolveOriginRef`) fails closed (zero commits) unless an `origin` remote
 * with a resolvable default branch exists — a bare origin + `push -u` is the
 * minimal fixture, mirroring test/engine/autoheal.test.ts's own convention.
 */
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

/**
 * Seed conduct-state.json so every step before 'build' reads as already
 * done — mirrors test/engine/conductor.test.ts's seedToBuildGate helper.
 */
async function seedToBuildGate(
  statePath: string,
  featureDesc: string,
): Promise<void> {
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

/** A verdict-writing dispatchVerifier — the only stubbed system boundary. */
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
): StepRunner {
  const calls: StepName[] = [];
  return {
    run: async (step: StepName): Promise<StepRunResult> => {
      calls.push(step);
      if (step === 'build') return buildResult;
      if (step === 'manual_test') {
        const pipelineDir = join(repo.root, '.pipeline');
        await mkdir(pipelineDir, { recursive: true });
        await writeFile(
          join(pipelineDir, 'manual-test-results.md'),
          '# Results\n\n| Story | Result |\n|--|--|\n| s | PASS |\n',
          'utf-8',
        );
        return { success: true };
      }
      return { success: true };
    },
    dispatchVerifier,
    // expose for assertions
    // @ts-expect-error test-only introspection field
    __calls: calls,
  };
}

async function headSha(repo: Repo): Promise<string> {
  const res = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return res.stdout.trim();
}

async function haltMarkerContent(repo: Repo): Promise<string | null> {
  return readFile(join(repo.root, '.pipeline/HALT'), 'utf-8').catch(() => null);
}

async function taskEvidenceRaw(repo: Repo): Promise<string | null> {
  return readFile(join(repo.root, '.pipeline/task-evidence.json'), 'utf-8').catch(() => null);
}

describe('acceptance: judged attribution verdict persists into the SAME build attempt (#581)', () => {
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

  // ── Story 1 (happy path) ──────────────────────────────────────────────

  it('a fully-covered residue build advances (done, no HALT) on the SAME attempt when the judge lane stamps every residue task satisfied', async () => {
    const repo = await initRepo('judged-rescue-happy-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'rescue-fixture');

    await writePlan(
      repo,
      'rescue-fixture',
      '### Task 1\n**Files:** `a.ts`\n\nA.\n### Task 2\n**Files:** `b.ts`\n\nB.\n',
    );
    await writeTaskStatus(repo, ['1', '2']);
    // Task 1 resolves mechanically (trailered commit). Task 2 is residue —
    // implemented but untrailered, exactly the shape the judge lane exists
    // to rescue.
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 1\n');
    const shaB = await commit(repo, 'b.ts', 'export const b = 1;\n', 'feat: b (untrailered)');

    // The lane reads anchor.head against the real current HEAD.
    const realHead = await headSha(repo);
    const { dispatchVerifier: realDispatch, calls: realCalls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: realHead, residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: shaB, rationale: 'implements task 2 (b.ts)' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const runner = makeStepRunner({ success: true }, realDispatch, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      // Final retry attempt (retries exhausted) — Story 1's second bullet:
      // the rescue must not depend on a "next cycle" that will never run.
      maxRetries: 1,
      fromStep: 'build',
      config: { attribution_judge_cutover: '2020-01-01T00:00:00Z' } as never,
    });

    await conductor.run();

    expect(realCalls).toHaveLength(1);
    expect(realCalls[0].residueIds).toEqual(['2']);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).toBe('done');
    }
    expect(await haltMarkerContent(repo)).toBeNull();
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw).toMatch(/semantic-verified/);
  });

  // ── Story 2 (no-whitewash negative) ──────────────────────────────────

  it('a no-verdict residue task stamps nothing and the build still refuses', async () => {
    const repo = await initRepo('judged-rescue-noverdict-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'noverdict-fixture');

    await writePlan(repo, 'noverdict-fixture', '### Task 1\n**Files:** `a.ts`\n\nA.\n');
    await writeTaskStatus(repo, ['1']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a (untrailered)');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({ taskId: id, verdict: 'no-verdict', reason: 'no citable sha' })),
    }));

    const runner = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
      config: { attribution_judge_cutover: '2020-01-01T00:00:00Z' } as never,
    });

    await conductor.run();

    expect(calls).toHaveLength(1);
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/semantic-verified/);
  });

  it('a satisfied verdict whose citation fails validateCitations (unreachable sha) is refused — the build still refuses', async () => {
    const repo = await initRepo('judged-rescue-forged-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'forged-fixture');

    await writePlan(repo, 'forged-fixture', '### Task 1\n**Files:** `a.ts`\n\nA.\n');
    await writeTaskStatus(repo, ['1']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a (untrailered)');

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

    const runner = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
      config: { attribution_judge_cutover: '2020-01-01T00:00:00Z' } as never,
    });

    await conductor.run();

    expect(calls).toHaveLength(1);
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/semantic-verified/);
  });

  it('a mix of satisfied and unsatisfied residue tasks only stamps the satisfied one — the build still refuses (partial coverage never advances)', async () => {
    const repo = await initRepo('judged-rescue-partial-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'partial-fixture');

    await writePlan(
      repo,
      'partial-fixture',
      '### Task 7\n**Files:** `x.ts`\n\nX.\n### Task 9\n**Files:** `y.ts`\n\nY.\n',
    );
    await writeTaskStatus(repo, ['7', '9']);
    const shaX = await commit(repo, 'x.ts', 'export const x = 1;\n', 'feat: x (untrailered)');
    await commit(repo, 'y.ts', 'export const y = 1;\n', 'feat: y (untrailered)');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) =>
        id === '7'
          ? {
              taskId: id,
              verdict: 'satisfied',
              citations: [{ sha: shaX, rationale: 'implements task 7' }],
              testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
            }
          : { taskId: id, verdict: 'unsatisfied', reason: 'no candidate diff touches y.ts' },
      ),
    }));

    const runner = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
      config: { attribution_judge_cutover: '2020-01-01T00:00:00Z' } as never,
    });

    await conductor.run();

    expect(calls).toHaveLength(1);
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Task 9 remains incomplete — the gate must not advance on partial coverage.
      expect(result.value.build).not.toBe('done');
    }
  });

  // ── Story 4 (guard: re-check fires only on real stamps) ─────────────

  it('cutover absent (default): the lane is skipped entirely, no re-check is added, flow is unaffected by this feature', async () => {
    const repo = await initRepo('judged-rescue-cutoverabsent-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'absent-fixture');

    await writePlan(repo, 'absent-fixture', '### Task 1\n**Files:** `a.ts`\n\nA.\n');
    await writeTaskStatus(repo, ['1']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a (untrailered)');

    const { dispatchVerifier, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: '1'.repeat(40), rationale: 'should never be reached — cutover absent' }],
        testEvidence: { command: 'x', exit: 0 },
      })),
    }));

    const runner = makeStepRunner({ success: true }, dispatchVerifier, repo);
    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot: repo.root,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: true,
      maxRetries: 1,
      fromStep: 'build',
      // No attribution_judge_cutover key — inert-by-default.
    });

    await conductor.run();

    expect(calls).toHaveLength(0);
    const noVerdictFile = await readFile(
      join(repo.root, '.pipeline/attribution-verdict.json'),
      'utf-8',
    ).catch(() => null);
    expect(noVerdictFile).toBeNull();
    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }
  });
});
