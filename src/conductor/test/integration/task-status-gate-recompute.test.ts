import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import { CUSTOM_COMPLETION_PREDICATES, type CompletionContext } from '../../src/engine/artifacts.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED integration specs for "The gate recomputes completion on every
// evaluation and never trusts file rows" (ADR H6/H7,
// .docs/stories/prd-audit-kickback-preserves-task-status.md).
//
// Two kinds of assertion in this file:
//
//  1. Specs that drive the EXISTING `CUSTOM_COMPLETION_PREDICATES.build`
//     (artifacts.ts) directly, against a real isolated git repo + real plan +
//     real `task-status.json` on disk. Today's implementation trusts the raw
//     JSON rows (no git derivation at all), so these fail for the right
//     reason: a forged/corrupt/deleted file currently produces the WRONG
//     verdict because nothing re-derives from git.
//
//  2. A spec that dynamically imports `deriveCompletion` from
//     `../../src/engine/autoheal.js` — the planned rework of
//     `findMatchingCommit`/`attemptAutoHeal` (plan Task 7/10) — which does not
//     exist yet at RED time. Per the `rekick-shipped-skip.acceptance.test.ts`
//     convention, this is a dynamic import so a missing export fails only the
//     specific test, not the whole file at collection time.
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
  await git('init', '-q');
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
    expect(first.completed['1']).toBeUndefined();
    expect(first.completed['2']).toBeUndefined();

    // Attempt 2 (same run, same repo): commit evidence for both tasks.
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');

    // Calling deriveCompletion a SECOND time (simulating a second gate
    // evaluation within the same run) must see attempt 2's new commits —
    // proving there is no once-per-run memoization/guard baked into derive.
    const second = await deriveCompletion(dir, planPath);
    expect(second.completed['1']).toBeDefined();
    expect(second.completed['2']).toBeDefined();
    expect(typeof second.completed['1'].evidencedBy).toBe('string');
  });

  it('negative: forged all-completed rows with zero commits must NOT pass the gate', async () => {
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

    // Today's implementation trusts the raw JSON rows and returns done:true
    // here — this assertion is the RED signal that recomputation from git
    // evidence has not been wired in yet.
    expect(result.done).toBe(false);
  });

  it('negative: task-status.json deleted mid-run — gate re-derives from evidence, never terminal "missing"', async () => {
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');
    // No task-status.json on disk at all (simulates an agent wholesale wipe).

    const result = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctxFor(join(dir, '.docs/plans/p.md')));

    // Both plan tasks are evidenced by real trailer commits — the gate should
    // re-seed + re-derive and report done:true. Today it just reports the
    // static "missing .pipeline/task-status.json" reason regardless of git
    // evidence, so this fails for the correct (not-yet-implemented) reason.
    expect(result.done).toBe(true);
  });

  it('negative: corrupt JSON in task-status.json — gate rebuilds from seed+derive rather than treating it as terminal', async () => {
    await commitTrailer('1', 'src/a.ts');
    await commitTrailer('2', 'src/b.ts');
    await writeFile(join(dir, '.pipeline/task-status.json'), '{ not valid json ][');

    const result = await CUSTOM_COMPLETION_PREDICATES.build!(dir, ctxFor(join(dir, '.docs/plans/p.md')));

    // Same reasoning as the deleted-file case: today's predicate returns the
    // static 'invalid JSON' reason unconditionally instead of rebuilding from
    // git evidence.
    expect(result.done).toBe(true);
  });

  it('regression pin: an attempt that committed evidenced work after a first miss must flip the SAME-run verdict from incomplete to done', async () => {
    const deriveCompletion = await loadDeriveCompletion();
    const planPath = join(dir, '.docs/plans/p.md');

    // First evaluation: no evidence at all.
    const before = await deriveCompletion(dir, planPath);
    expect(Object.keys(before.completed)).toHaveLength(0);

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
    expect(Object.keys(after.completed).length).toBe(2);
  });
});
