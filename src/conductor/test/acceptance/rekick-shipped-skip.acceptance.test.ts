import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

import {
  rekickSweep,
  listHaltedWorktrees,
  readHaltReason,
  hasRebaseInProgress,
  abortRebase,
  clearMarker,
  HALT_MARKER,
  type RekickSweepDeps,
} from '../../src/engine/daemon-rekick.js';
import { gitTreeSource } from '../../src/engine/daemon-backlog.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "rekickSweep consults isProcessed before re-kicking"
// (#205, Story 5). These drive the REAL production primitives on both sides of
// the wiring the story describes as "one resolver, two call sites":
//   - the REAL `rekickSweep` against REAL halted-worktree fixtures on disk
//     (fs `.pipeline/HALT` markers, exactly `listHaltedWorktrees`/`clearMarker`
//     as wired in daemon-cli.ts — not a hand-rolled fake), and
//   - the REAL ledger-or-shipped-record resolver (`makeIsProcessed`) against a
//     REAL git repo's base-branch tree — not a resolver that's merely told the
//     answer.
//
// A resolver unit test that returns `true` on request would pass even if
// daemon-cli.ts never wires it into `RekickSweepDeps.isProcessed` at all; this
// spec proves the two are actually connected by giving `rekickSweep` the real
// resolver and asserting the OBSERVABLE side effect on the worktree fixture
// (HALT marker still present, zero abort/clear calls) — not the resolver's
// return value in isolation.
//
// `makeIsProcessed` (src/engine/shipped-record.ts) does not exist yet at RED
// time, so it is loaded dynamically rather than via a static top-level import.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const SHIPPED_RECORD_MOD = '../../src/engine/shipped-record.js';

type TreeSource = ReturnType<typeof gitTreeSource>;

async function makeIsProcessed(
  processedDir: string,
  treeSource: TreeSource,
): Promise<(slug: string) => Promise<boolean>> {
  const mod = (await import(SHIPPED_RECORD_MOD)) as Record<string, unknown>;
  const fn = mod.makeIsProcessed;
  if (typeof fn !== 'function') {
    throw new Error('expected export "makeIsProcessed" to be a function (not yet implemented)');
  }
  return (fn as (p: string, t: TreeSource) => (slug: string) => Promise<boolean>)(
    processedDir,
    treeSource,
  );
}

const SHA_1 = '1'.repeat(40);
const SHA_2 = '2'.repeat(40);

let repoDir: string; // the "main checkout" — source of the base-branch shipped records
let worktreeBase: string; // real halted-worktree fixtures
let baseBranch: string;

const git = async (args: string[]) => {
  const { stdout } = await execFile('git', args, { cwd: repoDir });
  return stdout.trim();
};

async function haltWorktree(slug: string): Promise<void> {
  const wt = join(worktreeBase, slug);
  await mkdir(join(wt, '.pipeline'), { recursive: true });
  await writeFile(join(wt, HALT_MARKER), `parked: ${slug}\n`);
}

async function haltIsPresent(slug: string): Promise<boolean> {
  return access(join(worktreeBase, slug, HALT_MARKER))
    .then(() => true)
    .catch(() => false);
}

function shippedRecordBody(slug: string): string {
  return (
    `---\n` +
    `slug: ${slug}\n` +
    `spec_hash: irrelevant-for-isProcessed\n` +
    `pr: https://github.com/acme/repo/pull/1\n` +
    `shipped: 2026-07-01\n` +
    `---\n`
  );
}

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'rekick-dedup-repo-'));
  worktreeBase = await mkdtemp(join(tmpdir(), 'rekick-dedup-worktrees-'));
  await execFile('git', ['init', '-b', 'main', '-q'], { cwd: repoDir });
  await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
  await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoDir });
  await writeFile(join(repoDir, 'README.md'), 'init\n');
  await execFile('git', ['add', 'README.md'], { cwd: repoDir });
  await execFile('git', ['commit', '-q', '-m', 'init'], { cwd: repoDir });
  baseBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
  await rm(worktreeBase, { recursive: true, force: true });
});

function realDeps(opts: {
  isProcessed: (slug: string) => Promise<boolean>;
  log: (m: string) => void;
  lastRekickSha?: Map<string, string>;
}): RekickSweepDeps {
  return {
    listHaltedWorktrees: () => listHaltedWorktrees(worktreeBase),
    readHaltReason: (slug) => readHaltReason(worktreeBase, slug),
    hasRebaseInProgress: (slug) => hasRebaseInProgress(join(worktreeBase, slug)),
    abortRebase: (slug) => abortRebase(join(worktreeBase, slug)),
    clearMarker: (slug) => clearMarker(join(worktreeBase, slug)),
    lastRekickSha: opts.lastRekickSha ?? new Map(),
    log: opts.log,
    isProcessed: opts.isProcessed,
  } as RekickSweepDeps;
}

describe('rekick-shipped-skip acceptance (#205): rekickSweep never re-kicks an already-shipped slug (real fs + real git)', () => {
  it('a halted worktree whose slug has a base-branch shipped record is left parked; an unshipped one is cleared', async () => {
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, '.docs/shipped/shipped-feat.md'), shippedRecordBody('shipped-feat'));
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'shipped record: shipped-feat']);

    await haltWorktree('shipped-feat');
    await haltWorktree('wip-feat');

    const processedDir = join(repoDir, '.daemon/processed'); // empty — no local ledger entries
    const isProcessed = await makeIsProcessed(processedDir, gitTreeSource(repoDir, baseBranch));

    const log: string[] = [];
    const deps = realDeps({ isProcessed, log: (m) => log.push(m) });
    const result = await rekickSweep(deps, SHA_1);

    expect(result.skipped).toContain('shipped-feat');
    expect(result.cleared).toContain('wip-feat');

    // Observable side effect, not just the returned arrays: the HALT marker for
    // the shipped slug is untouched (no abort, no clear), while the unshipped
    // slug's HALT was actually cleared on disk.
    expect(await haltIsPresent('shipped-feat')).toBe(true);
    expect(await haltIsPresent('wip-feat')).toBe(false);

    expect(log.some((l) => /shipped-feat/.test(l) && /already shipped/i.test(l))).toBe(true);
  });

  it('an isProcessed failure fails OPEN — the slug is still re-kicked, and the error is logged (never wedges the sweep)', async () => {
    await haltWorktree('flaky-feat');
    await haltWorktree('wip-feat');

    const throwingIsProcessed = async (slug: string): Promise<boolean> => {
      if (slug === 'flaky-feat') throw new Error('corrupt marker read');
      return false;
    };

    const log: string[] = [];
    const deps = realDeps({ isProcessed: throwingIsProcessed, log: (m) => log.push(m) });
    const result = await rekickSweep(deps, SHA_1);

    // Fail-open: today's behavior (re-kick) is preserved when the dedup check
    // itself is broken — a dedup-check failure must never wedge the sweep.
    expect(result.cleared).toContain('flaky-feat');
    expect(result.cleared).toContain('wip-feat');
    expect(await haltIsPresent('flaky-feat')).toBe(false);
    expect(log.some((l) => /flaky-feat/.test(l) && /error|fail/i.test(l))).toBe(true);
  });

  it('the skip log for a processed slug is warn-once across base advances (not per-poll)', async () => {
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, '.docs/shipped/shipped-feat.md'), shippedRecordBody('shipped-feat'));
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'shipped record: shipped-feat']);

    await haltWorktree('shipped-feat');
    const processedDir = join(repoDir, '.daemon/processed');
    const isProcessed = await makeIsProcessed(processedDir, gitTreeSource(repoDir, baseBranch));

    const log: string[] = [];
    const lastRekickSha = new Map<string, string>();
    const deps = realDeps({ isProcessed, log: (m) => log.push(m), lastRekickSha });

    const first = await rekickSweep(deps, SHA_1);
    expect(first.skipped).toContain('shipped-feat');
    const firstSkipCount = log.filter((l) => /shipped-feat/.test(l) && /already shipped/i.test(l)).length;
    expect(firstSkipCount).toBe(1);

    // Base advances to a new SHA — the skip must repeat (never re-kicked), but
    // the log line must not repeat per-poll.
    const second = await rekickSweep(deps, SHA_2);
    expect(second.skipped).toContain('shipped-feat');
    expect(await haltIsPresent('shipped-feat')).toBe(true);
    const totalSkipCount = log.filter((l) => /shipped-feat/.test(l) && /already shipped/i.test(l)).length;
    expect(totalSkipCount).toBe(firstSkipCount);
  });
});
