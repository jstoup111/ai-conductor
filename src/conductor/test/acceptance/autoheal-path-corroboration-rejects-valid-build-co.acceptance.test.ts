/**
 * Acceptance specs for "Autoheal path-corroboration bounded dirname pass" (#707) —
 * .docs/stories/autoheal-path-corroboration-rejects-valid-build-co.md (7 stories,
 * Accepted) + .docs/decisions/architecture-review-2026-07-20-autoheal-path-corroboration.md
 * (ADR adr-2026-07-20-bounded-dirname-path-corroboration).
 *
 * WHY ACCEPTANCE-LEVEL (not unit only): the plan's own tasks
 * (.docs/plans/autoheal-path-corroboration-rejects-valid-build-co.md) drive
 * `deriveCompletion`/`fileDirMatchesPlanPath` directly as unit tests in
 * `test/engine/autoheal-dirname-corroboration.test.ts` — that proves the
 * matcher function is correct in isolation. It does NOT prove the REAL
 * production call path (`Conductor.run()`'s build gate, which reads
 * `checkStepCompletion('build', ...)` → `deriveCompletion`) actually credits
 * a legitimate commit and lets the build advance instead of stalling at
 * `no_task_progress` — the bug this feature exists to fix. This file drives
 * `Conductor.run()` itself, mirroring this repo's own precedent for exercising
 * the build gate-miss/credit branch end-to-end
 * (test/acceptance/judged-attribution-verdict-persistence.acceptance.test.ts).
 *
 * Drives a REAL git repo (`mkdtemp` + real `git`, unmocked — `deriveCompletion`'s
 * evidence-range resolution shells out to git directly and would fail closed
 * against a mocked repo) and a REAL `Conductor` instance. No verifier/judge
 * dispatch is exercised (`attribution_judge_cutover` is absent — Story
 * "Deterministic credit works with the judge cutover OFF"): the dirname pass
 * must be independent of the judge lane, so `dispatchVerifier` is stubbed to
 * fail the test if ever invoked.
 *
 * PRE-FIX RED: as of this file's authoring, `autoheal.ts`'s
 * `deriveCompletionInternal` has no dirname branch — only exact/suffix
 * (`fileMatchesPlanPath`) and `semantic-verified` credit a task past a
 * trailer match. The happy-path test below is expected to FAIL against that
 * code: the build stays NOT done and logs `Path corroboration failed`
 * instead of crediting task 1. The bound/regression test is expected to
 * ALREADY PASS both before and after the fix — it pins the #445 invariant
 * (no ancestor/repo-root credit) that the new branch must never violate.
 *
 * Scope: the remaining stories (exact/suffix regression, semantic-verified
 * interaction, ambiguous/no-trailer precondition, wrong-directory full-miss)
 * are single-function-level derivations over `fileDirMatchesPlanPath` /
 * `deriveCompletion` — not additional flows crossing this file's seam — and
 * per the implementation plan are unit-covered in
 * `test/engine/autoheal-dirname-corroboration.test.ts`.
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

/** Seed conduct-state.json so every step before 'build' reads as already done. */
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

function makeStepRunner(repo: Repo, judgeDispatchCalls: number[]): StepRunner {
  const dispatchVerifier: NonNullable<StepRunner['dispatchVerifier']> = async () => {
    judgeDispatchCalls.push(1);
    throw new Error(
      'dispatchVerifier must never be invoked: attribution_judge_cutover is absent, ' +
        'so the dirname pass must credit deterministically without the judge lane',
    );
  };
  return {
    run: async (step: StepName): Promise<StepRunResult> => {
      if (step === 'build') return { success: true };
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

async function taskEvidenceRaw(repo: Repo): Promise<string | null> {
  return readFile(join(repo.root, '.pipeline/task-evidence.json'), 'utf-8').catch(() => null);
}

describe('acceptance: bounded dirname path-corroboration credits a valid build commit (#707)', () => {
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

  // ── Story: Credit a subsystem-local commit via the bounded dirname pass ──

  it('a Task:-trailered commit landing in the plan path\'s immediate parent dir advances the build (dirname credit), with stamp form trailer-dirname — no judge dispatch', async () => {
    const repo = await initRepo('dirname-happy-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'dirname-fixture');

    await writePlan(
      repo,
      'dirname-fixture',
      '### Task 1\n**Files:** `src/conductor/src/engine/conductor.ts`\n\nA.\n',
    );
    await writeTaskStatus(repo, ['1']);
    // Same immediate parent dir (src/conductor/src/engine) as the plan path,
    // but NOT an exact/suffix match — only the bounded dirname pass credits this.
    await commit(
      repo,
      'src/conductor/src/engine/build-stall.ts',
      'export const x = 1;\n',
      'fix: build-stall helper\n\nTask: 1\n',
    );

    const judgeDispatchCalls: number[] = [];
    const runner = makeStepRunner(repo, judgeDispatchCalls);
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
      // No attribution_judge_cutover key: the dirname pass must credit
      // deterministically without the judge lane ever dispatching.
    });

    await conductor.run();

    expect(judgeDispatchCalls).toHaveLength(0);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).toBe('done');
    }

    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw).toMatch(/trailer-dirname/);
  });

  // ── Story: Bound the dirname match to the immediate parent dir (#445 non-regression) ──

  it('a Task:-trailered commit sharing only an ANCESTOR dir (not the immediate parent) does NOT credit — the build stays not-done (#445 guard)', async () => {
    const repo = await initRepo('dirname-bound-');
    repos.push(repo);
    const statePath = join(repo.root, 'conduct-state.json');
    await seedToBuildGate(statePath, 'bound-fixture');

    await writePlan(
      repo,
      'bound-fixture',
      '### Task 1\n**Files:** `src/conductor/src/engine/conductor.ts`\n\nA.\n',
    );
    await writeTaskStatus(repo, ['1']);
    // Shares the ancestor `src/conductor/src` but NOT the immediate parent
    // `.../engine` — must be rejected, or #445's inheritance false-positive
    // reopens.
    await commit(
      repo,
      'src/conductor/src/cli.ts',
      'export const y = 1;\n',
      'fix: cli tweak\n\nTask: 1\n',
    );

    const judgeDispatchCalls: number[] = [];
    const runner = makeStepRunner(repo, judgeDispatchCalls);
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

    expect(judgeDispatchCalls).toHaveLength(0);

    const result = await readState(statePath);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.build).not.toBe('done');
    }

    const evidenceRaw = await taskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/trailer-dirname/);
  });
});
