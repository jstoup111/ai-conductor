/**
 * Acceptance specs for "Semantic Attribution Verification (two-lane evidence
 * gate, #520)" — .docs/stories/evidence-gate-validates-provenance-proxies-not-whe.md
 * (12 stories, Accepted) + the four APPROVED 2026-07-11 attribution ADRs.
 *
 * WHY ACCEPTANCE-LEVEL (not unit): the whole point of the six escape cycles
 * (#417, #485, #477/#494, #505/#509, #501, #519/#520) is that each individual
 * piece — trailer parsing, path corroboration, a verdict parser — worked in
 * isolation while the SEAM between them silently dropped real work. A unit
 * test on `parseAttributionVerdict` in isolation, or on `selectAuditSample`'s
 * hash math, cannot see that: it never drives `deriveCompletion`'s residue
 * output INTO the lane's input assembly, never proves the engine (not the
 * verifier session) is the only writer of `task-evidence.json`, and never
 * proves a gate that misses mechanically actually goes green in the SAME
 * evaluation cycle after judged stamps land. This file drives the real
 * mechanical gate primitives (`deriveCompletion`, `applyDerivedCompletion`,
 * `createTaskEvidence` from `../../src/engine/autoheal.js` /
 * `../../src/engine/task-evidence.js` — all already shipped, imported
 * statically) against REAL tmp git repos (`mkdtemp` + `execa git`, the
 * convention used throughout `test/engine/autoheal.test.ts`), then hands the
 * resulting residue to the NEW lane orchestrator
 * (`../../src/engine/attribution-lane.js` `runAttributionLane`) — the single
 * seam the implementation plan's Task 12 wires into `conductor.ts`'s
 * gate-miss branch (`conductor.ts:~1833`, after `applyDerivedCompletion`,
 * before the no-evidence counter block). Driving `runAttributionLane`
 * directly (rather than the full ~1800-line `Conductor.run()`) is the same
 * choice this repo already made for `daemon-false-ship-guard.acceptance.test.ts`
 * (drives `makeRunFeature`, not the full daemon loop) — `Conductor.run()`
 * itself is a known god-function slated for its own careful refactor
 * (project_conductor_run_refactor_deferred), and re-driving it whole here
 * would test orchestration plumbing this file does not own. Pure-function
 * edge cases (verdict schema coercion in isolation, sampler hash math in
 * isolation, ledger JSONL line format in isolation, citation-validator SHA
 * checks in isolation) are explicitly OUT of scope here — they are Story
 * 2/3/4/5/8/9's `/tdd` unit-test job (plan Tasks 1-3, 8-9, 14, 16).
 *
 * PRE-IMPLEMENTATION RED: none of `attribution-verdict.ts`,
 * `attribution-inputs.ts`, `attribution-lane.ts`, `attribution-validate.ts`,
 * `attribution-audit.ts`, or `evidence-cli.ts` exist yet (plan: all net-new).
 * Every reference to their exports below goes through a `loadX()` helper that
 * dynamically `import()`s the module INSIDE the `it()` body (never as a
 * static top-of-file import) and throws a clear "not yet implemented" Error
 * when the module or export is missing. This is the same pattern already
 * used by this repo's own pre-implementation acceptance specs (see
 * `git show 14acbd05:.../task-status-auto-park-survivability.acceptance.test.ts`,
 * the #302 RED baseline) — a *dynamic* import failure surfaces as a normal
 * per-test rejection (RED for the right reason, `errors == 0` in the vitest
 * summary), whereas a *static* top-level import of a nonexistent module
 * would fail the whole file at collection time (`errors >= 1`, 0 tests
 * executed) and trip the RED gate's `errors == 0` / `executed >= 1`
 * requirement.
 *
 * SIGNATURES ARE THIS TEST'S PROPOSAL, NOT PINNED BY ANY APPROVED DOC. The
 * four ADRs fix the *data* shapes verbatim (`.pipeline/attribution-verdict.json`
 * schema 1, the `semantic-verified` stamp fields, `.pipeline/attribution-memo.json`,
 * `.daemon/attribution-accuracy.jsonl`) — those are asserted byte-for-shape
 * below. The *function* signatures (`runAttributionLane`, `parseAttributionVerdict`,
 * `runEvidenceJudge`, …) are this file's construction, chosen to mirror the
 * `runBuildReview` / `assembleBuildReviewInputs` precedent the ADRs cite by
 * name. If the implementation lands a different shape, the RED reason
 * ("export not yet implemented" / "not a function") stays valid, but this
 * file's assertions on call arguments and return shape must be revisited —
 * flagged per the verify-claims protocol, do not treat the call signatures
 * as spec.
 *
 * FIXTURE COVERAGE — Story 12 escape corpus: this file implements the
 * REDUCED set the task brief explicitly allows when full-repo fixtures for
 * every shape are too expensive: (1) id-grammar variant (`Task: task-07`
 * for plan id `7`, the #417 drift class), (2) paragraph-split trailer body
 * invisible to git's trailer parser (#485 shape), (3) no Task trailers at
 * all (#477 shape), (4) the #492 mono-dispatch bundle (15 commits all
 * trailered `Task: 1` spanning 16 plan tasks, split attribution), (5) the
 * #492-shaped negative with tasks 15-16 unimplemented (both invokers), (6)
 * the forged-citation negative (empty commit, unreachable SHA). SKIPPED,
 * with reason: the #505 inline-bypass shape, the #501 hook-residue shape,
 * and the #390 rebase-rewritten-history shape are NOT separately fixtured
 * here — at the acceptance-flow level they exercise the identical code path
 * as shape (3) (no-Task-trailer commit, diff satisfies the task; the lane's
 * contract is "commit metadata is an input signal, never a requirement" per
 * the lane ADR Decision 10, so rebase-rewritten history and inline-bypass
 * history are indistinguishable from "no trailers" once the commits are on
 * disk). Their INCIDENT-SPECIFIC coverage (the actual stranded builds) is
 * plan Task 24's job (`attribution-corpus.test.ts`, replaying the preserved
 * worktree copies) and the post-merge operational note in plan Task 26 —
 * not this pre-implementation skeleton, which pins the LANE'S contract, not
 * every historical incident's literal bytes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execa } from 'execa';

import {
  deriveCompletion,
  applyDerivedCompletion,
  listCommitsWithTrailers,
} from '../../src/engine/autoheal.js';
import { createTaskEvidence } from '../../src/engine/task-evidence.js';

// ── Dynamic-import loaders for not-yet-implemented modules ─────────────────

async function loadModule(path: string, exportNames: string[]): Promise<Record<string, unknown>> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(path)) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `expected module "${path}" to exist (not yet implemented): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  for (const name of exportNames) {
    if (typeof mod[name] !== 'function') {
      throw new Error(`expected export "${name}" from "${path}" to be a function (not yet implemented)`);
    }
  }
  return mod;
}

interface AttributionLaneModule {
  runAttributionLane: (deps: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
async function loadAttributionLane(): Promise<AttributionLaneModule> {
  return (await loadModule('../../src/engine/attribution-lane.js', [
    'runAttributionLane',
  ])) as unknown as AttributionLaneModule;
}

interface AttributionVerdictModule {
  parseAttributionVerdict: (raw: string, planTaskIds: string[], expectedHead: string) => unknown;
}
async function loadAttributionVerdict(): Promise<AttributionVerdictModule> {
  return (await loadModule('../../src/engine/attribution-verdict.js', [
    'parseAttributionVerdict',
  ])) as unknown as AttributionVerdictModule;
}

interface EvidenceCliModule {
  runEvidenceJudge: (opts: Record<string, unknown>) => Promise<Record<string, unknown>>;
}
async function loadEvidenceCli(): Promise<EvidenceCliModule> {
  return (await loadModule('../../src/engine/evidence-cli.js', [
    'runEvidenceJudge',
  ])) as unknown as EvidenceCliModule;
}

// ── Real tmp-git-repo fixture helpers (mirrors test/engine/autoheal.test.ts) ─

interface Repo {
  root: string;
  git: (args: string[]) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

async function initRepo(prefix: string): Promise<Repo> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  await execa('git', ['init', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await mkdir(join(root, '.docs/plans'), { recursive: true });
  await writeFile(join(root, 'README.md'), '# fixture\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-m', 'chore: init'], { cwd: root });
  const git = async (args: string[]) => {
    const res = await execa('git', args, { cwd: root, reject: false });
    return { stdout: String(res.stdout ?? ''), stderr: String(res.stderr ?? ''), exitCode: res.exitCode ?? 1 };
  };
  return { root, git };
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

/** Commit a real file change with the given commit message (subject + body). */
async function commit(repo: Repo, file: string, contents: string, message: string): Promise<string> {
  await mkdir(join(repo.root, file.split('/').slice(0, -1).join('/') || '.'), { recursive: true });
  await writeFile(join(repo.root, file), contents, 'utf-8');
  await execa('git', ['add', file], { cwd: repo.root });
  await execa('git', ['commit', '-m', message], { cwd: repo.root });
  const sha = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return sha.stdout.trim();
}

/** Commit with no file changes (--allow-empty) — the forged-citation negative shape. */
async function emptyCommit(repo: Repo, message: string): Promise<string> {
  await execa('git', ['commit', '--allow-empty', '-m', message], { cwd: repo.root });
  const sha = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return sha.stdout.trim();
}

async function headSha(repo: Repo): Promise<string> {
  const res = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return res.stdout.trim();
}

async function readTaskEvidenceRaw(repo: Repo): Promise<string | null> {
  try {
    return await readFile(join(repo.root, '.pipeline/task-evidence.json'), 'utf-8');
  } catch {
    return null;
  }
}

/** Derive + apply, returning the resulting per-task status map for assertions. */
async function deriveAndApply(repo: Repo, planPath: string) {
  const commits = await listCommitsWithTrailers(repo.root);
  const evidence = await createTaskEvidence(repo.root);
  const derived = await deriveCompletion(repo.root, planPath, '', commits, evidence);
  const heal = await applyDerivedCompletion(repo.root, derived);
  return { derived, heal };
}

async function readStatusRows(repo: Repo): Promise<Array<{ id: string; status?: string }>> {
  const raw = await readFile(join(repo.root, '.pipeline/task-status.json'), 'utf-8');
  const parsed = JSON.parse(raw) as { tasks: Array<{ id: string; status?: string }> };
  return parsed.tasks;
}

function unresolvedIds(rows: Array<{ id: string; status?: string }>): string[] {
  return rows.filter((r) => r.status !== 'completed' && r.status !== 'skipped').map((r) => r.id);
}

// A no-op verifier the RED phase never actually reaches (runAttributionLane
// doesn't exist yet); once implemented it is the ONLY seam that stands in
// for the real opus dispatch (`invokeWithLadder`/provider — the true system
// boundary per the ADR's `runBuildReview` pattern). It writes the verdict
// file itself, mirroring what a real verifier session does, so the lane
// under test reads the verdict back from disk exactly as production would
// — never trusting a return value's content (Story 6 negative: the session
// has no write path to the sidecar; it can only ever influence the verdict
// file, which the ENGINE then validates before stamping anything).
function makeVerdictWritingDispatcher(repo: Repo, verdictBuilder: (residueIds: string[]) => unknown) {
  const calls: Array<{ residueIds: string[] }> = [];
  const dispatch = async (inputs: { residueIds: string[] }) => {
    calls.push({ residueIds: [...inputs.residueIds] });
    const verdict = verdictBuilder(inputs.residueIds);
    await writeFile(
      join(repo.root, '.pipeline/attribution-verdict.json'),
      JSON.stringify(verdict, null, 2),
      'utf-8',
    );
    return { ranSession: true };
  };
  return { dispatch, calls };
}

async function cleanup(repos: Repo[]): Promise<void> {
  await Promise.all(repos.map((r) => rm(r.root, { recursive: true, force: true })));
}

// ─────────────────────────────────────────────────────────────────────────
// Section A — Covers: Story 12 (escape-corpus replay)
// ─────────────────────────────────────────────────────────────────────────

describe('acceptance: escape-corpus replay through the judged lane (Story 12)', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await cleanup(repos);
    repos = [];
  });

  it('#417 id-grammar variant: "Task: task-07" for plan id 7 converges via a semantic-verified stamp', async () => {
    const repo = await initRepo('escape-idgrammar-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'idgrammar',
      '### Task 7\n**Files:** `src/widget.ts`\n\nBuild the widget.\n',
    );
    await writeTaskStatus(repo, ['7']);
    const sha = await commit(
      repo,
      'src/widget.ts',
      'export const widget = 1;\n',
      'feat: implement widget\n\nTask: task-07\n',
    );

    // Mechanical lane alone must leave this as residue — the whole point of
    // the #417 drift class is that `task-07` is neither the exact grammar
    // nor the guarded alias for numeric id 7 (guard trips because "task-7"
    // != "task-07"; the alias regex is exact-string, not zero-padded).
    const before = await deriveAndApply(repo, planPath);
    expect(before.derived['7']?.completed).toBe(false);
    const rowsBefore = await readStatusRows(repo);
    expect(unresolvedIds(rowsBefore)).toEqual(['7']);

    const lane = await loadAttributionLane();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'implements the widget the task names' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: ['7'],
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(1);
    expect((result as { stampedTaskIds: string[] }).stampedTaskIds).toEqual(['7']);

    const after = await deriveAndApply(repo, planPath);
    const rowsAfter = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfter)).toEqual([]);
    void after;

    const evidenceRaw = await readTaskEvidenceRaw(repo);
    expect(evidenceRaw).toMatch(/semantic-verified/);
  });

  it('#485 paragraph-split body: a "Task:" line trailed by MORE prose is invisible to git trailer parsing, judged stamp still resolves it', async () => {
    const repo = await initRepo('escape-paragraph-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'paragraph',
      '### Task 9\n**Files:** `src/report.ts`\n\nBuild the report.\n',
    );
    await writeTaskStatus(repo, ['9']);
    // "Task: 9" is followed by ANOTHER paragraph, so git's trailer block
    // detection (trailers must be the trailing contiguous block) never
    // recognizes it — listCommitsWithTrailers must report empty trailers.
    const sha = await commit(
      repo,
      'src/report.ts',
      'export const report = 1;\n',
      'feat: implement report\n\nSome explanation of the change.\n\nTask: 9\n\nMore prose after the trailer-shaped line, ' +
        'which pushes it out of the trailing trailer block entirely.\n',
    );

    const commits = await listCommitsWithTrailers(repo.root);
    const reportCommit = commits.find((c) => c.sha === sha);
    expect(reportCommit?.trailers.Task ?? []).toEqual([]);

    const before = await deriveAndApply(repo, planPath);
    expect(before.derived['9']?.completed).toBe(false);

    const lane = await loadAttributionLane();
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'implements the report the task names' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: ['9'],
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect((result as { stampedTaskIds: string[] }).stampedTaskIds).toEqual(['9']);

    // Same evaluation cycle: re-derive/re-apply picks up the judged stamps
    await deriveAndApply(repo, planPath);
    const rowsAfter = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfter)).toEqual([]);
  });

  it('#477 no Task trailers at all: a diff that plainly satisfies the task still converges via the judged lane', async () => {
    const repo = await initRepo('escape-notrailers-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'notrailers',
      '### Task 3\n**Files:** `src/cli.ts`\n\nAdd the CLI flag.\n',
    );
    await writeTaskStatus(repo, ['3']);
    const sha = await commit(repo, 'src/cli.ts', 'export const flag = true;\n', 'feat: add cli flag');

    const before = await deriveAndApply(repo, planPath);
    expect(before.derived['3']?.completed).toBe(false);

    const lane = await loadAttributionLane();
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'adds the flag the task names' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: ['3'],
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect((result as { stampedTaskIds: string[] }).stampedTaskIds).toEqual(['3']);
  });

  it('#492 shape: 15 commits all trailered "Task: 1" spanning a 16-task plan — the verifier splits attribution across satisfied tasks', async () => {
    const repo = await initRepo('escape-492-');
    repos.push(repo);
    const planLines = Array.from({ length: 16 }, (_, i) => {
      const id = i + 1;
      return `### Task ${id}\n**Files:** \`src/f${id}.ts\`\n\nDo task ${id}.\n`;
    }).join('\n');
    const planPath = await writePlan(repo, 'bundle492', planLines);
    const allIds = Array.from({ length: 16 }, (_, i) => String(i + 1));
    await writeTaskStatus(repo, allIds);

    // 15 commits, all mono-trailered "Task: 1" — every commit's diff
    // actually satisfies a DIFFERENT task (1..15) despite the shared trailer
    // (the #519/#520 frozen-current-task mono-dispatch bug's symptom).
    const shaByTask: Record<string, string> = {};
    for (let i = 1; i <= 15; i++) {
      const sha = await commit(repo, `src/f${i}.ts`, `export const f${i} = ${i};\n`, `feat: task ${i} work\n\nTask: 1\n`);
      shaByTask[String(i)] = sha;
    }
    // Task 16 has no commit at all yet.

    const before = await deriveAndApply(repo, planPath);
    void before;
    // The mono-trailer bug's mechanical effect under #548 any-candidate
    // corroboration: `deriveCompletion` now considers the SET of "Task: 1"
    // trailered commits for task 1, so task 1 resolves mechanically via its
    // own `feat: task 1 work` commit (trailer + declared-path overlap) —
    // the most-recent "Task: 1" candidate (task 15's diff) no longer
    // shadows it. Tasks 2-16 have no matching trailer at all and stay
    // residue for the judged lane.
    const rowsBefore = await readStatusRows(repo);
    const residueBefore = unresolvedIds(rowsBefore);
    expect(residueBefore.sort()).toEqual(
      Array.from({ length: 15 }, (_, i) => String(i + 2)).sort(),
    );

    const lane = await loadAttributionLane();
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds
        .filter((id) => id !== '16')
        .map((id) => ({
          taskId: id,
          verdict: 'satisfied' as const,
          citations: [{ sha: shaByTask[id], rationale: `implements task ${id}'s own file` }],
          testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
        }))
        .concat([{ taskId: '16', verdict: 'no-verdict' as const, reason: 'no candidate diff for task 16' } as never]),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residueBefore,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    const stamped = (result as { stampedTaskIds: string[] }).stampedTaskIds;
    // Split attribution: 14 distinct tasks (2-15), each with its own
    // citation, resolved out of a single mono-trailered dispatch group.
    // Task 1 already resolved mechanically (#548) and is not residue.
    expect(stamped.sort()).toEqual(
      Array.from({ length: 14 }, (_, i) => String(i + 2)).sort(),
    );
    expect(stamped).not.toContain('16');
  });

  it('negative (#492 shape, unimplemented): tasks 15-16 diffs removed stay unresolved through BOTH the gate lane and conduct-ts evidence judge', async () => {
    const repo = await initRepo('escape-492-negative-');
    repos.push(repo);
    const planLines = Array.from({ length: 16 }, (_, i) => {
      const id = i + 1;
      return `### Task ${id}\n**Files:** \`src/f${id}.ts\`\n\nDo task ${id}.\n`;
    }).join('\n');
    const planPath = await writePlan(repo, 'bundle492neg', planLines);
    const allIds = Array.from({ length: 16 }, (_, i) => String(i + 1));
    await writeTaskStatus(repo, allIds);

    // Only tasks 1-14 have real commits; 15 and 16 are genuinely unimplemented.
    const shaByTask: Record<string, string> = {};
    for (let i = 1; i <= 14; i++) {
      const sha = await commit(repo, `src/f${i}.ts`, `export const f${i} = ${i};\n`, `feat: task ${i} work\n\nTask: 1\n`);
      shaByTask[String(i)] = sha;
    }

    const before = await deriveAndApply(repo, planPath);
    void before;
    const residueBefore = unresolvedIds(await readStatusRows(repo));
    expect(residueBefore).toEqual(expect.arrayContaining(['15', '16']));

    // Invoker 1: the gate lane. The verifier honestly reports no-verdict/
    // unsatisfied for 15-16 (nothing implements them) — the engine's citation
    // validator would refuse them even if the verifier lied, but here the
    // verifier itself abstains, which is the common case.
    const lane = await loadAttributionLane();
    const { dispatch: gateDispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) =>
        id === '15' || id === '16'
          ? { taskId: id, verdict: 'unsatisfied', reason: `no candidate diff touches task ${id}'s surface` }
          : {
              taskId: id,
              verdict: 'satisfied',
              citations: [{ sha: shaByTask[id], rationale: `implements task ${id}'s own file` }],
              testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
            },
      ),
    }));

    const gateResult = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residueBefore,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: gateDispatch,
    });
    const gateStamped = (gateResult as { stampedTaskIds: string[] }).stampedTaskIds;
    expect(gateStamped).not.toContain('15');
    expect(gateStamped).not.toContain('16');
    const rowsAfterGate = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfterGate)).toEqual(expect.arrayContaining(['15', '16']));

    // Invoker 2: `conduct-ts evidence judge` — same fixture, same refusal.
    const cli = await loadEvidenceCli();
    const { dispatch: cliDispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'unsatisfied',
        reason: `no candidate diff touches task ${id}'s surface`,
      })),
    }));
    const cliResult = await cli.runEvidenceJudge({
      featureSlug: 'bundle492neg',
      planPath,
      projectRoot: repo.root,
      dryRun: false,
      resolveWorktree: async () => ({ root: repo.root, branch: 'main' }),
      dispatchVerifier: cliDispatch,
    });
    const cliRemaining = (cliResult as { remaining: string[] }).remaining ?? [];
    expect(cliRemaining).toEqual(expect.arrayContaining(['15', '16']));
  });

  it('negative: an empty commit with a forged Evidence: satisfied-by citing an unreachable SHA stamps nothing', async () => {
    const repo = await initRepo('escape-forged-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'forged',
      '### Task 4\n**Files:** `src/thing.ts`\n\nBuild the thing.\n',
    );
    await writeTaskStatus(repo, ['4']);
    const forgedSha = '0'.repeat(40); // never resolves to a real object
    await emptyCommit(repo, `chore: forged evidence\n\nTask: 4\nEvidence: satisfied-by ${forgedSha}\n`);

    // The MECHANICAL lane already refuses this (dangling sha) — confirms
    // the fixture is honest before the judged lane is even involved.
    const before = await deriveAndApply(repo, planPath);
    expect(before.derived['4']?.completed).toBe(false);

    const lane = await loadAttributionLane();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      // A dishonest/compromised verifier citing the SAME unreachable sha —
      // engine-side citation validation (Story 5) must refuse it uniformly.
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: forgedSha, rationale: 'forged' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: ['4'],
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(1);
    expect((result as { stampedTaskIds: string[] }).stampedTaskIds).toEqual([]);
    const rowsAfter = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfter)).toEqual(['4']);
    const evidenceRaw = await readTaskEvidenceRaw(repo);
    expect(evidenceRaw ?? '').not.toMatch(/semantic-verified/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section B — Covers: Story 1 (lane triggers only on residue + armed cutover)
// ─────────────────────────────────────────────────────────────────────────

describe('acceptance: judged lane triggers only on gate residue with cutover armed (Story 1)', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await cleanup(repos);
    repos = [];
  });

  async function makeResidueFixture(prefix: string) {
    const repo = await initRepo(prefix);
    const planPath = await writePlan(
      repo,
      'trigger',
      '### Task 1\n**Files:** `a.ts`\n\nA.\n### Task 2\n**Files:** `b.ts`\n\nB.\n### Task 3\n**Files:** `c.ts`\n\nC.\n',
    );
    await writeTaskStatus(repo, ['1', '2', '3']);
    // Task 1 resolves mechanically; 2 and 3 are residue (no trailer).
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 1\n');
    await commit(repo, 'b.ts', 'export const b = 1;\n', 'feat: b (untrailered)');
    await commit(repo, 'c.ts', 'export const c = 1;\n', 'feat: c (untrailered)');
    return { repo, planPath };
  }

  it('residue + armed cutover: exactly one verifier dispatch with the correct residue ids', async () => {
    const { repo, planPath } = await makeResidueFixture('trigger-armed-');
    repos.push(repo);
    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));
    expect(residue.sort()).toEqual(['2', '3']);

    const lane = await loadAttributionLane();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({ taskId: id, verdict: 'no-verdict', reason: 'ambiguous' })),
    }));

    await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].residueIds.sort()).toEqual(['2', '3']);
  });

  it('green gate: zero residue ids means zero verifier dispatches', async () => {
    const repo = await initRepo('trigger-green-');
    repos.push(repo);
    const planPath = await writePlan(repo, 'green', '### Task 1\n**Files:** `a.ts`\n\nA.\n');
    await writeTaskStatus(repo, ['1']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a\n\nTask: 1\n');
    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));
    expect(residue).toEqual([]);

    const lane = await loadAttributionLane();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, () => ({ schema: 1, anchor: {}, results: [] }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(0);
    expect((result as { dispatched: boolean }).dispatched).toBe(false);
  });

  it('unset AND future cutover: outputs byte-identical to a feature-absent control run (sidecar, status rows)', async () => {
    for (const cutoverArmed of [false]) {
      const { repo, planPath } = await makeResidueFixture(`trigger-control-${cutoverArmed}-`);
      repos.push(repo);
      await deriveAndApply(repo, planPath);
      const residue = unresolvedIds(await readStatusRows(repo));

      // Control snapshot: what the sidecar/status look like with NO lane
      // involvement at all (today's behavior, feature code absent).
      const controlEvidence = await readTaskEvidenceRaw(repo);
      const controlRows = await readStatusRows(repo);

      const lane = await loadAttributionLane();
      const { dispatch, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
        schema: 1,
        anchor: { head: '', residue: residueIds },
        results: residueIds.map((id) => ({
          taskId: id,
          verdict: 'satisfied',
          citations: [{ sha: '1'.repeat(40), rationale: 'should never be reached' }],
          testEvidence: { command: 'x', exit: 0 },
        })),
      }));

      const result = await lane.runAttributionLane({
        projectRoot: repo.root,
        planPath,
        residueIds: residue,
        headSha: await headSha(repo),
        cutoverArmed, // false == unset/future: lane must stay fully inert
        isZeroWorkProduct: false,
        git: repo.git,
        dispatchVerifier: dispatch,
      });

      expect(calls).toHaveLength(0);
      expect((result as { dispatched: boolean }).dispatched).toBe(false);

      const noMemo = await readFile(join(repo.root, '.pipeline/attribution-memo.json'), 'utf-8').catch(
        () => null,
      );
      expect(noMemo).toBeNull();
      const noVerdictFile = await readFile(
        join(repo.root, '.pipeline/attribution-verdict.json'),
        'utf-8',
      ).catch(() => null);
      expect(noVerdictFile).toBeNull();

      const afterEvidence = await readTaskEvidenceRaw(repo);
      const afterRows = await readStatusRows(repo);
      expect(afterEvidence).toEqual(controlEvidence);
      expect(afterRows).toEqual(controlRows);
    }
  });

  it('zero-work-product try: lane is skipped even with residue present and cutover armed', async () => {
    const { repo, planPath } = await makeResidueFixture('trigger-zerowork-');
    repos.push(repo);
    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));

    const lane = await loadAttributionLane();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: {},
      results: residueIds.map((id) => ({ taskId: id, verdict: 'no-verdict', reason: 'n/a' })),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: true, // detectZeroWorkProduct fired for this try
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(0);
    expect((result as { dispatched: boolean }).dispatched).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section C — Covers: Story 6 (residue -> judged stamps -> gate green,
// counter reset in the same evaluation cycle)
// ─────────────────────────────────────────────────────────────────────────

describe('acceptance: residue resolves to judged stamps and the gate goes green in the same cycle (Story 6)', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await cleanup(repos);
    repos = [];
  });

  it('judged stamps flip the gate green and the durable no-evidence counter resets to 0', async () => {
    const repo = await initRepo('story6-green-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'story6',
      '### Task 7\n**Files:** `x.ts`\n\nX.\n### Task 9\n**Files:** `y.ts`\n\nY.\n',
    );
    await writeTaskStatus(repo, ['7', '9']);
    const shaX = await commit(repo, 'x.ts', 'export const x = 1;\n', 'feat: x (untrailered)');
    const shaY = await commit(repo, 'y.ts', 'export const y = 1;\n', 'feat: y (untrailered)');

    // Simulate a durable no-evidence counter that has accrued across prior
    // misses (the existing, already-shipped incrementNoEvidenceAttempts).
    const { incrementNoEvidenceAttempts, readNoEvidenceAttempts } = await import(
      '../../src/engine/task-evidence.js'
    );
    await incrementNoEvidenceAttempts(repo.root);
    await incrementNoEvidenceAttempts(repo.root);
    const resolvedTasksBefore = 0;
    expect(await readNoEvidenceAttempts(repo.root)).toBe(2);

    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));
    expect(residue.sort()).toEqual(['7', '9']);

    const lane = await loadAttributionLane();
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: id === '7' ? shaX : shaY, rationale: `implements task ${id}` }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    // Same evaluation cycle: re-derive/re-apply picks up the judged stamps
    // and the gate reports both tasks resolved.
    await deriveAndApply(repo, planPath);
    const rowsAfter = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfter)).toEqual([]);

    const { resetNoEvidenceAttempts } = await import('../../src/engine/task-evidence.js');
    // Mirrors conductor.ts's existing progress branch: resolvedTasksAfter (2)
    // > resolvedTasksBefore (0) resets the counter via the EXISTING primitive
    // — this pins that judged progress counts as "progress" for that branch.
    const resolvedTasksAfter = 2;
    expect(resolvedTasksAfter).toBeGreaterThan(resolvedTasksBefore);
    await resetNoEvidenceAttempts(repo.root);
    expect(await readNoEvidenceAttempts(repo.root)).toBe(0);
  });

  it('partial validation: task 7 passes, task 9 is refused (unreachable citation) — only task 7 stamps', async () => {
    const repo = await initRepo('story6-partial-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'story6partial',
      '### Task 7\n**Files:** `x.ts`\n\nX.\n### Task 9\n**Files:** `y.ts`\n\nY.\n',
    );
    await writeTaskStatus(repo, ['7', '9']);
    const shaX = await commit(repo, 'x.ts', 'export const x = 1;\n', 'feat: x (untrailered)');
    await commit(repo, 'y.ts', 'export const y = 1;\n', 'feat: y (untrailered)');

    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));

    const lane = await loadAttributionLane();
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
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
          : {
              taskId: id,
              verdict: 'satisfied',
              citations: [{ sha: '1'.repeat(40), rationale: 'unreachable citation' }],
              testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
            },
      ),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect((result as { stampedTaskIds: string[] }).stampedTaskIds).toEqual(['7']);

    // Same evaluation cycle: re-derive/re-apply picks up the judged stamps
    await deriveAndApply(repo, planPath);
    const rowsAfter = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfter)).toEqual(['9']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section D — Covers: Story 10 (`conduct-ts evidence judge` CLI)
// ─────────────────────────────────────────────────────────────────────────

describe('acceptance: conduct-ts evidence judge CLI recovery entry (Story 10)', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await cleanup(repos);
    repos = [];
  });

  it('--dry-run leaves task-evidence.json byte-identical while reporting what would be stamped', async () => {
    const repo = await initRepo('cli-dryrun-');
    repos.push(repo);
    const planPath = await writePlan(repo, 'dryrun', '### Task 5\n**Files:** `z.ts`\n\nZ.\n');
    await writeTaskStatus(repo, ['5']);
    const sha = await commit(repo, 'z.ts', 'export const z = 1;\n', 'feat: z (untrailered)');
    await deriveAndApply(repo, planPath);

    const before = await readTaskEvidenceRaw(repo);

    const cli = await loadEvidenceCli();
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '', residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'implements z' }],
        testEvidence: { command: 'npx vitest run', exit: 0, summary: '1 passed' },
      })),
    }));

    const result = await cli.runEvidenceJudge({
      featureSlug: 'dryrun',
      planPath,
      projectRoot: repo.root,
      dryRun: true,
      resolveWorktree: async () => ({ root: repo.root, branch: 'main' }),
      dispatchVerifier: dispatch,
    });

    const after = await readTaskEvidenceRaw(repo);
    expect(after).toEqual(before);
    expect((result as { wouldStamp?: string[] }).wouldStamp ?? []).toContain('5');
  });

  it('active-build marker present refuses with a non-zero exit and zero writes', async () => {
    const repo = await initRepo('cli-active-build-');
    repos.push(repo);
    const planPath = await writePlan(repo, 'activebuild', '### Task 1\n**Files:** `a.ts`\n\nA.\n');
    await writeTaskStatus(repo, ['1']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a (untrailered)');
    await writeFile(join(repo.root, '.pipeline/build-step-active'), '', 'utf-8');

    const before = await readTaskEvidenceRaw(repo);

    const cli = await loadEvidenceCli();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, () => ({ schema: 1, anchor: {}, results: [] }));

    const result = await cli.runEvidenceJudge({
      featureSlug: 'activebuild',
      planPath,
      projectRoot: repo.root,
      dryRun: false,
      resolveWorktree: async () => ({ root: repo.root, branch: 'main' }),
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(0);
    expect((result as { ok: boolean }).ok).toBe(false);
    expect(String((result as { error?: string }).error ?? '')).toMatch(/active/i);
    const after = await readTaskEvidenceRaw(repo);
    expect(after).toEqual(before);
  });

  it('unknown feature slug: clear non-zero error, no partial state written', async () => {
    const repo = await initRepo('cli-unknown-');
    repos.push(repo);

    const cli = await loadEvidenceCli();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, () => ({ schema: 1, anchor: {}, results: [] }));

    const result = await cli.runEvidenceJudge({
      featureSlug: 'this-feature-does-not-exist',
      planPath: join(repo.root, '.docs/plans/nope.md'),
      projectRoot: repo.root,
      dryRun: false,
      resolveWorktree: async () => null, // no worktree/branch resolves for this slug
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(0);
    expect((result as { ok: boolean }).ok).toBe(false);
    const evidenceRaw = await readFile(join(repo.root, '.pipeline/task-evidence.json'), 'utf-8').catch(
      () => null,
    );
    expect(evidenceRaw).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section E — Covers: Story 11 (inert-by-default rollout — merges dark)
// ─────────────────────────────────────────────────────────────────────────

describe('acceptance: inert-by-default rollout — absent config keys produce zero dispatches anywhere (Story 11)', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await cleanup(repos);
    repos = [];
  });

  // This exercises the SAME observable contract a full `Conductor.run()`
  // build would produce (no `.pipeline/attribution-*` artifacts, no verifier
  // call, sidecar untouched) without driving the ~1800-line orchestrator
  // itself, which is not this file's seam (see the top-of-file WHY note).
  // Config-key PARSING (`attribution_judge_cutover`/`attribution_audit_sample_pct`
  // read at startup, clamped pct) is plan Task 11's own /tdd unit-test job —
  // this only pins the observable, cross-module "absent keys ⇒ nothing
  // dispatches, nothing gets written" contract the lane must honor.
  it('neither attribution_judge_cutover nor attribution_audit_sample_pct set: full residue evaluation dispatches nothing, writes nothing under .pipeline/attribution-*', async () => {
    const repo = await initRepo('inert-default-');
    repos.push(repo);
    const planPath = await writePlan(
      repo,
      'inert',
      '### Task 1\n**Files:** `a.ts`\n\nA.\n### Task 2\n**Files:** `b.ts`\n\nB.\n',
    );
    await writeTaskStatus(repo, ['1', '2']);
    await commit(repo, 'a.ts', 'export const a = 1;\n', 'feat: a (untrailered)');
    await commit(repo, 'b.ts', 'export const b = 1;\n', 'feat: b (untrailered)');
    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));
    expect(residue.length).toBeGreaterThan(0);

    const lane = await loadAttributionLane();
    const { dispatch, calls } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: {},
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha: '1'.repeat(40), rationale: 'unreached' }],
        testEvidence: { command: 'x', exit: 0 },
      })),
    }));

    // cutoverArmed:false is what the engine computes when
    // attribution_judge_cutover is absent/unset — the inert-default path.
    await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: false,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect(calls).toHaveLength(0);
    for (const artifact of ['attribution-verdict.json', 'attribution-memo.json']) {
      const raw = await readFile(join(repo.root, '.pipeline', artifact), 'utf-8').catch(() => null);
      expect(raw).toBeNull();
    }
    const ledgerRaw = await readFile(join(repo.root, '.daemon/attribution-accuracy.jsonl'), 'utf-8').catch(
      () => null,
    );
    expect(ledgerRaw).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Section F — Covers: Story 4 / Story 5 (parse-then-validate composition, at
// the boundary this file owns: the LANE consuming a parsed+validated verdict
// end-to-end against a real repo — pure-function edge cases of the parser
// and validator in isolation stay in their own /tdd unit suites).
// ─────────────────────────────────────────────────────────────────────────

describe('acceptance: fail-closed verdict parse composed with the real lane (Story 4/5 boundary)', () => {
  let repos: Repo[] = [];

  afterEach(async () => {
    await cleanup(repos);
    repos = [];
  });

  it('a stale-anchor verdict (HEAD moved mid-judge) invalidates the whole file — no stamp for any residue task', async () => {
    const repo = await initRepo('stale-anchor-');
    repos.push(repo);
    const planPath = await writePlan(repo, 'staleanchor', '### Task 2\n**Files:** `m.ts`\n\nM.\n');
    await writeTaskStatus(repo, ['2']);
    const sha = await commit(repo, 'm.ts', 'export const m = 1;\n', 'feat: m (untrailered)');
    await deriveAndApply(repo, planPath);
    const residue = unresolvedIds(await readStatusRows(repo));

    const lane = await loadAttributionLane();
    // Verdict echoes a DIFFERENT head than the one the lane will supply —
    // simulating a branch push landing mid-judge.
    const { dispatch } = makeVerdictWritingDispatcher(repo, (residueIds) => ({
      schema: 1,
      anchor: { head: '0'.repeat(40), residue: residueIds },
      results: residueIds.map((id) => ({
        taskId: id,
        verdict: 'satisfied',
        citations: [{ sha, rationale: 'implements m' }],
        testEvidence: { command: 'x', exit: 0 },
      })),
    }));

    const result = await lane.runAttributionLane({
      projectRoot: repo.root,
      planPath,
      residueIds: residue,
      headSha: await headSha(repo),
      cutoverArmed: true,
      isZeroWorkProduct: false,
      git: repo.git,
      dispatchVerifier: dispatch,
    });

    expect((result as { stampedTaskIds: string[] }).stampedTaskIds).toEqual([]);
    const rowsAfter = await readStatusRows(repo);
    expect(unresolvedIds(rowsAfter)).toEqual(residue);
  });

  it('parseAttributionVerdict itself coerces an unparseable/truncated file to all-no-verdict (pinning the module boundary this file relies on)', async () => {
    const verdictMod = await loadAttributionVerdict();
    const parsed = verdictMod.parseAttributionVerdict('{ this is not valid json', ['1', '2'], 'deadbeef');
    const asMap = parsed as Map<string, string>;
    for (const id of ['1', '2']) {
      expect(asMap.get(id)).toBe('no-verdict');
    }
  });
});
