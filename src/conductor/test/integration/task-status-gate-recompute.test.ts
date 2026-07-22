import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { CUSTOM_COMPLETION_PREDICATES, type CompletionContext } from '../../src/engine/artifacts.js';

// ─────────────────────────────────────────────────────────────────────────────
// Integration specs for "The gate recomputes completion on every evaluation
// and never trusts file rows" (ADR H6/H7,
// .docs/stories/prd-audit-kickback-preserves-task-status.md).
//
// Task 10 (#773) update: the H6/H7 cross-check this file originally pinned —
// `CUSTOM_COMPLETION_PREDICATES.build` re-deriving completion from git
// evidence and rejecting forged/uncorroborated task-status.json rows — has
// been REMOVED from the build predicate. The predicate is now purely
// structural: it seeds task-status.json from the plan (creating/rebuilding
// the file when missing or corrupt) and trusts each row's `status` field
// directly (completed/skipped), with no cross-check against git or the
// evidence sidecar. Real completion authority for a forged/self-reported row
// now lives in build_review's completeness rubric (a fail-closed, default-on
// grader verdict), and git-evidence re-derivation happens separately, in
// conductor.ts's own auto-heal step (`deriveCompletion` +
// `applyDerivedCompletion`), which is NOT exercised by driving
// `CUSTOM_COMPLETION_PREDICATES.build` directly as these specs do.
//
// Two kinds of assertion remain in this file:
//
//  1. Specs that drive `CUSTOM_COMPLETION_PREDICATES.build` (artifacts.ts)
//     directly, against a real isolated git repo + real plan + real
//     `task-status.json` on disk — now pinning the NEW structural-only
//     behavior (seed-and-trust-rows, never crash on missing/corrupt file,
//     never cross-check evidence).
//
//  2. A spec that dynamically imports `deriveCompletion` from
//     `../../src/engine/autoheal.js` — unaffected by Task 10, since
//     deriveCompletion itself (the autoheal surface) still re-derives from
//     git evidence; it's just no longer called inline by the build gate.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const DERIVE_MOD = '../../src/engine/autoheal.js';

interface DeriveResult {
  completed: Record<string, { evidencedBy: string }>;
}

async function loadDeriveCompletion(): Promise<
  (projectRoot: string, planPath: string) => Promise<DeriveResult>
> {
  const mod = (await import(DERIVE_MOD)) as Record<string, unknown>;
  const fn = mod.deriveCompletion;
  if (typeof fn !== 'function') {
    throw new Error(
      'expected export "deriveCompletion" from autoheal.ts to be a function (not yet implemented)',
    );
  }
  return fn as (projectRoot: string, planPath: string) => Promise<DeriveResult>;
}

let dir: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile(
    'git',
    ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
    { cwd: dir },
  );
  return stdout.trim();
}

async function initRepo(): Promise<void> {
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  await mkdir(join(dir, '.docs/plans'), { recursive: true });
  await git('init', '-q', '-b', 'main');
  // A merge-base target: origin/main. autoheal.ts's listCommits resolves
  // `git merge-base origin/main HEAD`, so an initial commit stands in for the
  // "already-shipped base" and a remote ref points at it.
  await writeFile(join(dir, 'README.md'), 'init\n');
  await git('add', 'README.md');
  await git('commit', '-q', '-m', 'init');
  await git('remote', 'add', 'origin', dir);
  await git('update-ref', 'refs/remotes/origin/main', 'HEAD');
}

async function writePlan(): Promise<void> {
  await writeFile(
    join(dir, '.docs/plans/p.md'),
    '### Task 1\n**Files:** `src/a.ts`\n\n### Task 2\n**Files:** `src/b.ts`\n',
  );
}

async function commitTrailer(taskId: string, file: string): Promise<void> {
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, file), `${taskId}-${Date.now()}\n`);
  await git('add', file);
  await git(
    'commit',
    '-q',
    '-m',
    `feat: implement task ${taskId}\n\nTask: ${taskId}`,
  );
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gate-recompute-'));
  await initRepo();
  await writePlan();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function ctxFor(planPath: string): CompletionContext {
  // planPath/projectRoot are planned new CompletionContext fields (plan Task
  // 10: "context seam carries projectRoot/planPath"); cast past today's
  // interface (which doesn't declare them yet) the same way the
  // operator-park acceptance spec casts extra RekickSweepDeps fields.
  return { projectRoot: dir, planPath } as CompletionContext;
}

describe('integration: build gate recomputes completion on every evaluation (H6/H7)', () => {
  it('happy: two consecutive gate evaluations in one run — attempt 2 sees attempt 2 commits (no once-per-run guard)', async () => {
    const deriveCompletion = await loadDeriveCompletion();
    const planPath = join(dir, '.docs/plans/p.md');

    // Attempt 1: zero evidencing commits — nothing completed.
    const first = await deriveCompletion(dir, planPath);
    expect(first['1']?.completed).toBeFalsy();
    expect(first['2']?.completed).toBeFalsy();

    // Attempt 2 (same run, same repo): commit evidence for both tasks.
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');

    // Calling deriveCompletion a SECOND time (simulating a second gate
    // evaluation within the same run) must see attempt 2's new commits —
    // proving there is no once-per-run memoization/guard baked into derive.
    const second = await deriveCompletion(dir, planPath);
    expect(second['1'].completed).toBe(true);
    expect(second['2'].completed).toBe(true);
    expect(typeof second['1'].evidencedBy).toBe('string');
  });

  it('positive (Task 10, #773): a self-reported all-completed row set passes the gate — the git-evidence cross-check is retired', async () => {
    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({
        tasks: [
          { id: '1', status: 'completed' },
          { id: '2', status: 'completed' },
        ],
      }),
    );

    const result = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctxFor(join(dir, '.docs/plans/p.md')));

    // The build predicate no longer re-derives from git or cross-checks the
    // evidence sidecar — it trusts task-status.json row status directly.
    // Whether the rows are actually corroborated by real work is now
    // build_review's job, not this gate's.
    expect(result.done).toBe(true);
  });

  it('negative: task-status.json deleted mid-run — gate re-seeds fresh pending rows rather than a terminal "missing"', async () => {
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');
    // No task-status.json on disk at all (simulates an agent wholesale wipe).

    const result = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctxFor(join(dir, '.docs/plans/p.md')));

    // Task 10 (#773): the predicate no longer derives completion from git at
    // all, so real trailer commits alone do not resolve the re-seeded rows —
    // that reconciliation is conductor.ts's separate auto-heal step
    // (deriveCompletion + applyDerivedCompletion), not exercised here. What
    // this spec pins is the non-terminal behavior: a missing file is
    // re-seeded (fresh pending rows), never a permanent "missing" failure.
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/pending|not completed/i);
  });

  it('negative: corrupt JSON in task-status.json — gate rebuilds from seed rather than treating it as terminal', async () => {
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');
    await writeFile(join(dir, '.pipeline/task-status.json'), '{ not valid json ][');

    const result = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctxFor(join(dir, '.docs/plans/p.md')));

    // Task 10 (#773): same reasoning as the deleted-file case above — corrupt
    // JSON is rebuilt into fresh pending rows (never a terminal failure), but
    // resolving them to done requires conductor.ts's separate auto-heal step,
    // not exercised by this direct predicate call.
    expect(result.done).toBe(false);
    expect(result.reason).toMatch(/pending|not completed/i);
  });

  it('regression pin: an attempt that committed evidenced work after a first miss must flip the SAME-run verdict from incomplete to done', async () => {
    const deriveCompletion = await loadDeriveCompletion();
    const planPath = join(dir, '.docs/plans/p.md');

    // First evaluation: no evidence at all.
    const before = await deriveCompletion(dir, planPath);
    expect(Object.values(before).filter((t) => t.completed)).toHaveLength(0);

    // The "attempt 2" commit lands on the SAME branch, in the SAME process —
    // there is no restart between these two derive calls.
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');

    const after = await deriveCompletion(dir, planPath);
    // Observable effect, not an internal flag: the second call's own return
    // value reflects the new commits. A once-per-run guard baked into derive
    // (mirroring the removed `autoHealAttempted` semantics) would make this
    // call reuse the FIRST call's cached empty result instead of re-scanning
    // git, so `after` would incorrectly still show zero completions.
    expect(Object.values(after).filter((t) => t.completed).length).toBe(2);
  });

  // ─── #463 forged-flip shape (plan Task 11) ───────────────────────────────
  //
  // 17-task plan: 5 tasks get REAL commit evidence (`Task: N` trailers on
  // commits touching each task's declared path); the OTHER 12 are split —
  // 9 are forged directly into `.pipeline/task-status.json` as `completed`
  // with zero corroborating commits and no evidence sidecar entry, 3 are
  // left untouched (genuinely pending). This mirrors the real #463 incident
  // shape (agent-authored status flips outrunning actual git work) and
  // proves two things against the REAL production gate entry point
  // (`CUSTOM_COMPLETION_PREDICATES.build`): (a) the very FIRST evaluation
  // fails and names the 9 forged ids — no grandfather/poisoned-range escape
  // hatch lets them ride through — and (b) repeating the identical
  // evaluation with no state changes produces a byte-identical failure
  // reason, proving there is no cross-call memoization that could let the
  // verdict oscillate between pass and fail across the halt/rekick loop.
  async function write17TaskPlan(): Promise<string> {
    const planPath = join(dir, '.docs/plans/p17.md');
    const blocks: string[] = [];
    for (let n = 1; n <= 17; n++) {
      // Colon+title form: both parsePlanTaskPaths (artifacts.ts's plan
      // validity/path check) AND parsePlanTasks (task-seed.ts's first-seed
      // grandfather eligibility check, which requires a colon) recognize
      // this id — needed so the grandfather escape path this test targets
      // can actually engage against pre-fix code.
      blocks.push(`### Task ${n}: Implement task ${n}\n**Files:** \`src/task-${n}.ts\`\n`);
    }
    await writeFile(planPath, blocks.join('\n'));
    return planPath;
  }

  it('17-task plan, 5 real + 9 completed rows with zero commits — the build predicate trusts task-status.json rows directly (anti-forgery cross-check retired, #773 Task 10); only genuinely untouched rows are unresolved, and a repeat evaluation is byte-identical', async () => {
    const planPath = await write17TaskPlan();

    // Historical #463 shape: ids 2,4-7,11-13,16 (9 ids) have `completed` rows
    // with zero corroborating commits. Per #773 Task 10, the build predicate
    // no longer cross-checks rows against an independently re-derived
    // evidence sidecar (the H6/H7/H8 anti-forgery check is retired) — real
    // completion authority now lives in build_review's completeness rubric,
    // not this structural predicate. So these rows are trusted like any
    // other 'completed' row.
    const forgedIds = ['2', '4', '5', '6', '7', '11', '12', '13', '16'];
    // 5 REAL completions, each with a real evidencing commit + trailer, drawn
    // from the ids NOT in forgedIds.
    const realIds = ['1', '3', '8', '9', '10'];
    for (const id of realIds) {
      await commitTrailer(id, `src/task-${id}.ts`);
    }
    // Remaining ids (14,15,17 — 3 of them) are left completely untouched: no
    // row at all, genuinely pending.

    await writeFile(
      join(dir, '.pipeline/task-status.json'),
      JSON.stringify({
        tasks: [
          ...realIds.map((id) => ({ id, status: 'completed' })),
          ...forgedIds.map((id) => ({ id, status: 'completed' })),
        ],
      }),
    );

    const ctx = ctxFor(planPath);

    const first = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctx);
    expect(first.done).toBe(false);
    expect(typeof first.reason).toBe('string');
    // Only the 3 genuinely untouched ids are unresolved — the 9 rows with a
    // 'completed' status, forged or not, are now trusted directly.
    expect(first.reason).toMatch(/^3\/17 tasks pending\/not completed:/);
    expect(first.reason).toContain('14, 15, 17');

    // Repeat the IDENTICAL evaluation (same repo, same files, no state
    // changes) — the failure reason must be byte-identical, proving there is
    // no memoization letting the verdict oscillate between pass and fail
    // across repeated evaluations of unchanged state.
    const second = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctx);
    expect(second.done).toBe(false);
    expect(second.reason).toBe(first.reason);
  });
});
