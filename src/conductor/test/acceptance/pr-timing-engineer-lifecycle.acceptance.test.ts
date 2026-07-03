// RED acceptance specs for the engineer (DECIDE authoring) side of `pr_timing`
// (Stories TS-6..TS-8, adr-2026-07-03-engineer-checkpoint-commits-idempotent-land).
//
// `checkpointSpec` (or equivalent `engineer checkpoint` primitive) does NOT exist
// anywhere yet — `src/engine/engineer/checkpoint.ts` is not on disk. `land-spec.ts`'s
// commit step ALWAYS commits today (no commit-iff-staged behavior). `handoff.ts`'s
// `openSpecPr` ALWAYS does `gh pr create --head <branch> --fill` — it has no
// draft-PR-detection / mark-ready path. This file is the RED phase.
//
// Convention: the not-yet-existing checkpoint primitive is loaded via a per-test
// dynamic `import()` (mirrors test/acceptance/shipped-work-dedup.acceptance.test.ts)
// so a missing module fails cleanly inside the test body. Tests that drive REAL
// existing code (`landSpec`, `openSpecPr`) are genuine behavioral RED against real
// production code — no mocking of git/gh beyond the seams those functions already
// accept as injectable (`GhRunner`/`CommandRunner`).
//
// Fixture convention: a real git tmp repo stands in for the TARGET repo, with a
// real per-idea worktree created via `createEngineerWorktree` (mirrors
// test/engine/engineer/land-spec.test.ts), and a real `git init --bare` stands in
// for "origin" so push state is asserted for real. NO vi.mock() of git.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { openSpecPr } from '../../src/engine/engineer/handoff.js';
import type { HandoffDeps } from '../../src/engine/engineer/handoff.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';
import type { TargetRepo } from '../../src/engine/engineer/target.js';

const execFile = promisify(execFileCb);
const CHECKPOINT_MOD = '../../src/engine/engineer/checkpoint.js';

// ── Dynamic-import helper (RED convention) ────────────────────────────────────

async function requireCheckpointExport(name: string): Promise<(...args: unknown[]) => unknown> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(CHECKPOINT_MOD)) as Record<string, unknown>;
  } catch {
    throw new Error(
      `expected module "src/engine/engineer/checkpoint.ts" to exist (not yet implemented)`,
    );
  }
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: unknown[]) => unknown;
}

// ── Fixture helpers ────────────────────────────────────────────────────────────

const ACCEPTED_STORIES = [
  '# Stories: dep bump',
  '',
  '**Status:** Accepted',
  '',
  '## Story: bump',
  '### Acceptance Criteria',
  '- Given X, when Y, then Z.',
  '',
].join('\n');

const PLAN_WITH_DEPS = [
  '# Implementation Plan: dep bump',
  '',
  '**Stories:** .docs/stories/dep-bump.md',
  '',
  '## Task Dependency Graph',
  '```',
  '1 -> 2',
  '```',
  '',
].join('\n');

const DRAFT_ADR = ['# ADR: some decision', '', '**Status:** DRAFT', '', 'Body.', ''].join('\n');

let repoPath: string;
let origin: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

function target(): TargetRepo {
  return { name: 'alpha', canonicalPath: repoPath };
}

/** Create the per-idea worktree and seed valid Accepted DECIDE artifacts. */
async function seedValidWorktree(idea = 'dep bump'): Promise<string> {
  const wt = await createEngineerWorktree(repoPath, idea);
  const dir = wt.worktreePath;
  await mkdir(join(dir, '.docs', 'specs'), { recursive: true });
  await mkdir(join(dir, '.docs', 'stories'), { recursive: true });
  await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
  await writeFile(join(dir, '.docs', 'specs', 'dep-bump.md'), '# PRD: dep bump\n\nApproved.\n');
  await writeFile(join(dir, '.docs', 'stories', 'dep-bump.md'), ACCEPTED_STORIES);
  await writeFile(join(dir, '.docs', 'plans', 'dep-bump.md'), PLAN_WITH_DEPS);
  return dir;
}

const resolvedGh: GhRunner = async () => ({ stdout: 'operator@example.com' });
const unresolvedGh: GhRunner = async () => {
  throw new Error('gh: not logged in');
};

beforeEach(async () => {
  origin = await mkdtemp(join(tmpdir(), 'pr-timing-eng-origin-'));
  await execFile('git', ['init', '-q', '--bare', '-b', 'main'], { cwd: origin });

  repoPath = await mkdtemp(join(tmpdir(), 'pr-timing-eng-repo-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@test.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'init']);
  await git(['remote', 'add', 'origin', origin]);
  await git(['push', '-q', '-u', 'origin', 'main']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
  await rm(origin, { recursive: true, force: true });
});

describe('pr_timing engineer lifecycle — checkpoint commits (RED, unimplemented)', () => {
  // ── Happy paths ──────────────────────────────────────────────────────────────

  it('checkpoint after DECIDE artifacts written: commits ONLY .docs paths, plain-pushes spec/<slug>', async () => {
    const checkpointSpec = await requireCheckpointExport('checkpointSpec');
    const worktree = await seedValidWorktree();

    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
    });

    const { stdout: log } = await execFile('git', ['log', '-1', '--name-only', '--pretty=format:%s'], {
      cwd: worktree,
    });
    const lines = log.trim().split('\n');
    const files = lines.slice(1);
    expect(files.length).toBeGreaterThan(0);
    expect(files.every((f) => f.startsWith('.docs/'))).toBe(true);

    const remoteSha = await execFile('git', ['rev-parse', 'refs/heads/spec/dep-bump'], { cwd: origin }).then(
      (r) => r.stdout.trim(),
      () => null,
    );
    const localSha = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then((r) => r.stdout.trim());
    expect(remoteSha).toBe(localSha);
  });

  it('first checkpoint push ahead of base: lazy draft spec PR created exactly once', async () => {
    const checkpointSpec = await requireCheckpointExport('checkpointSpec');
    const worktree = await seedValidWorktree();

    const calls: string[][] = [];
    const gh: GhRunner = async (args: string[]) => {
      calls.push(args);
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: 'https://github.com/acme/alpha/pull/7\n' };
      return { stdout: '' };
    };

    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
      gh,
    });
    // Second checkpoint boundary — must reuse, not recreate.
    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
      gh,
    });

    const createCalls = calls.filter((a) => a[0] === 'pr' && a[1] === 'create');
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toContain('--draft');
  });

  it('land succeeds with no new commit when all .docs already checkpoint-committed, same {slug, branch, repoPath} JSON', async () => {
    // This drives the REAL landSpec entry point TWICE in a row (simulating a
    // checkpoint-commit flow that already committed every artifact, then
    // `engineer land` running afterward with nothing left to add). Today
    // land-spec.ts's commit step ALWAYS does `git add .docs && git commit`
    // unconditionally, with no check for whether anything is staged. The
    // first call succeeds normally (baseline). Because nothing changes
    // between calls (same idea, same artifacts, same owner/sourceRef so the
    // rewritten intake marker is byte-identical), the SECOND call stages
    // nothing — yet today's code still runs a bare `git commit`, which fails
    // with a non-zero exit ("nothing to commit") and landSpec propagates that
    // as a thrown error. Task 18's commit-iff-staged behavior must make this
    // second call succeed instead, returning the same result with no new
    // commit — the genuine behavioral gap this test pins.
    const worktree = await seedValidWorktree();

    const first = await landSpec(target(), 'dep bump', worktree, undefined, {
      ownerConfig: {},
      gh: resolvedGh,
    });
    const afterFirst = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then((r) => r.stdout.trim());

    const second = await landSpec(target(), 'dep bump', worktree, undefined, {
      ownerConfig: {},
      gh: resolvedGh,
    });
    const afterSecond = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then((r) => r.stdout.trim());

    expect(second).toEqual(first);
    // No NEW commit should have been created on the second (no-op) land.
    expect(afterSecond).toBe(afterFirst);
  });

  it('handoff with an open draft spec PR: pushes + mark-ready, no second gh pr create, write-back unchanged', async () => {
    // Drives the REAL openSpecPr entry point. Today it ALWAYS calls
    // `gh pr create --head <branch> --fill` with no detection of an existing
    // open draft PR — this asserts the desired mark-ready path (Task 20) and
    // will fail today because the fake runner records a `pr create` call
    // instead of `pr ready`.
    const worktree = await seedValidWorktree();
    await execFile('git', ['add', '.docs'], { cwd: worktree });
    await execFile('git', ['commit', '-q', '-m', 'checkpoint: dep-bump'], { cwd: worktree });

    const calls: string[][] = [];
    const runner: HandoffDeps['runner'] = async (args) => {
      calls.push([...args]);
      if (args[0] === 'pr' && args[1] === 'view') {
        return { stdout: JSON.stringify({ url: 'https://github.com/acme/alpha/pull/5', state: 'OPEN' }), stderr: '' };
      }
      if (args[0] === 'pr' && args[1] === 'ready') {
        return { stdout: '', stderr: '' };
      }
      return { stdout: 'https://github.com/acme/alpha/pull/999\n', stderr: '' };
    };

    await openSpecPr(target(), 'spec/dep-bump', { runner, worktreePath: worktree });

    const createCalls = calls.filter((a) => a[0] === 'pr' && a[1] === 'create');
    const readyCalls = calls.filter((a) => a[0] === 'pr' && a[1] === 'ready');

    expect(readyCalls).toHaveLength(1);
    expect(createCalls).toHaveLength(0);
  });

  // ── Negative paths ───────────────────────────────────────────────────────────

  it('checkpoint push fails (no remote): loud log, authoring continues, no throw', async () => {
    const checkpointSpec = await requireCheckpointExport('checkpointSpec');
    const wt = await createEngineerWorktree(repoPath, 'dep bump 2');
    const worktree = wt.worktreePath;
    // Remove the remote so the push has nowhere to go.
    await execFile('git', ['remote', 'remove', 'origin'], { cwd: repoPath }).catch(() => undefined);
    await mkdir(join(worktree, '.docs', 'stories'), { recursive: true });
    await writeFile(join(worktree, '.docs', 'stories', 'dep-bump-2.md'), ACCEPTED_STORIES);

    const logs: string[] = [];
    await expect(
      checkpointSpec({
        worktreePath: worktree,
        slug: 'dep-bump-2',
        prTiming: 'early-draft',
        identity: { resolved: true, id: 'operator@example.com' },
        log: (m: string) => logs.push(m),
      }),
    ).resolves.not.toThrow();

    expect(logs.length).toBeGreaterThan(0);
  });

  it('non-.docs dirty files at a checkpoint: excluded from the resulting commit\'s file list', async () => {
    const checkpointSpec = await requireCheckpointExport('checkpointSpec');
    const worktree = await seedValidWorktree();
    await writeFile(join(worktree, 'unrelated.txt'), 'do not commit me\n');

    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: true, id: 'operator@example.com' },
    });

    const { stdout: log } = await execFile('git', ['log', '-1', '--name-only', '--pretty=format:%s'], {
      cwd: worktree,
    });
    const files = log.trim().split('\n').slice(1);
    expect(files).not.toContain('unrelated.txt');

    // The unrelated file should still be present but untracked/dirty.
    const { stdout: status } = await execFile('git', ['status', '--porcelain'], { cwd: worktree });
    expect(status).toContain('unrelated.txt');
  });

  it('operator identity UNRESOLVED in early-draft: zero checkpoint commits/pushes', async () => {
    const checkpointSpec = await requireCheckpointExport('checkpointSpec');
    const worktree = await seedValidWorktree();
    const before = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then((r) => r.stdout.trim());

    await checkpointSpec({
      worktreePath: worktree,
      slug: 'dep-bump',
      prTiming: 'early-draft',
      identity: { resolved: false },
    });

    const after = await execFile('git', ['rev-parse', 'HEAD'], { cwd: worktree }).then((r) => r.stdout.trim());
    expect(after).toBe(before);

    const remoteSha = await execFile('git', ['rev-parse', 'refs/heads/spec/dep-bump'], { cwd: origin }).then(
      () => 'exists',
      () => null,
    );
    expect(remoteSha).toBeNull();
  });

  it('DRAFT ADR present + everything checkpoint-committed: land still FAILS with the DRAFT-ADR error (pass-pin: existing guard)', async () => {
    // This pins forward a guard that already exists TODAY: landSpec rejects a
    // DRAFT ADR regardless of commit history. Since checkpointSpec doesn't
    // exist yet to interfere, this currently passes purely on today's code —
    // noted explicitly as a pass-pin per the task's instructions.
    const worktree = await seedValidWorktree();
    await mkdir(join(worktree, '.docs', 'decisions'), { recursive: true });
    await writeFile(join(worktree, '.docs', 'decisions', 'adr-draft.md'), DRAFT_ADR);
    await execFile('git', ['add', '.docs'], { cwd: worktree });
    await execFile('git', ['commit', '-q', '-m', 'checkpoint: dep-bump (with draft adr)'], { cwd: worktree });

    await expect(
      landSpec(target(), 'dep bump', worktree, undefined, { ownerConfig: {}, gh: resolvedGh }),
    ).rejects.toThrow(/DRAFT/);
  });

  it('pr_timing: finish (key absent): zero checkpoint commits/pushes anywhere; land/handoff byte-identical to today (pass-pin)', async () => {
    // With the key absent, checkpointSpec must never be invoked by the SKILL.md
    // wiring (Task 21) — that wiring doesn't exist yet, so nothing calls it,
    // and land/handoff behave exactly as they do today. This test exercises
    // the REAL landSpec path with no checkpoint interference and asserts a
    // single commit results (today's unconditional commit-everything path),
    // pinning the finish-mode baseline forward.
    const worktree = await seedValidWorktree();
    const beforeLog = await execFile('git', ['rev-list', '--count', 'HEAD'], { cwd: worktree }).then((r) =>
      Number(r.stdout.trim()),
    );

    const result = await landSpec(target(), 'dep bump', worktree, undefined, {
      ownerConfig: {},
      gh: resolvedGh,
    });

    const afterLog = await execFile('git', ['rev-list', '--count', 'HEAD'], { cwd: worktree }).then((r) =>
      Number(r.stdout.trim()),
    );

    expect(result.slug).toBe('dep-bump');
    expect(afterLog).toBe(beforeLog + 1); // exactly one new commit, today's byte-identical behavior
  });

  it('early-draft but no draft PR exists at handoff time: falls back to today\'s gh pr create --head <branch> --fill path (pass-pin)', async () => {
    // No draft-PR-detection exists in openSpecPr yet, so it always takes the
    // create path — this pins that fallback forward as the "no draft found"
    // case Task 20 must preserve.
    const worktree = await seedValidWorktree();
    await execFile('git', ['add', '.docs'], { cwd: worktree });
    await execFile('git', ['commit', '-q', '-m', 'checkpoint: dep-bump'], { cwd: worktree });

    const calls: string[][] = [];
    const runner: HandoffDeps['runner'] = async (args) => {
      calls.push([...args]);
      return { stdout: 'https://github.com/acme/alpha/pull/12\n', stderr: '' };
    };

    const result = await openSpecPr(target(), 'spec/dep-bump', { runner, worktreePath: worktree });

    expect(result.kind).toBe('pr-opened');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(['pr', 'create', '--head', 'spec/dep-bump', '--fill']);
  });
});
