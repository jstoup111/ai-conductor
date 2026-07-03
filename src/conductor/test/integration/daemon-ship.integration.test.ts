import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';
import { specHash } from '../../src/engine/shipped-record.js';

// ─────────────────────────────────────────────────────────────────────────────
// Task 11 (#204, #205): finish-side record write on the ship path. These
// integration specs exercise the REAL git-backed `writeShippedRecord` deps
// factory (`makeFeatureRunnerDeps`) against a real temp git repo standing in
// for the daemon's main checkout — not a fake in-memory double — so a passing
// suite here actually proves the `.docs/shipped/<slug>.md` record gets
// committed on the ship path, before the (already-happened) PR push, and that
// failures degrade gracefully rather than failing the ship.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const ITEM: BacklogItem = { slug: 'feat-x' };

const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
const PLAN = '# Plan\n\n### Task 1\n**Dependencies:** none\n';

let projectRoot: string;
let worktreePath: string;

const git = async (args: string[], cwd = projectRoot) => {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
};

/** Write the plan+stories into a fake worktree dir (as if cut from base branch). */
async function writeWorktreeSpec(slug: string): Promise<void> {
  await mkdir(join(worktreePath, '.docs/plans'), { recursive: true });
  await mkdir(join(worktreePath, '.docs/stories'), { recursive: true });
  await writeFile(join(worktreePath, `.docs/plans/${slug}.md`), PLAN);
  await writeFile(join(worktreePath, `.docs/stories/${slug}.md`), APPROVED_STORIES);
}

function baseDeps(
  outcome: WorktreeOutcome,
  writeShippedRecord: FeatureRunnerDeps['writeShippedRecord'],
): FeatureRunnerDeps {
  return {
    createWorktree: async (slug) => ({ path: join(worktreePath), branch: `feat/${slug}` }),
    runConductor: async () => {},
    readOutcome: async () => outcome,
    teardownWorktree: async () => {},
    markProcessed: async () => {},
    daemon: false,
    provider: {
      invoke: async () => ({ success: true, output: '' }),
      invokeInteractive: async () => {},
    },
    project: 'test-project',
    projectRoot,
    writeShippedRecord,
  };
}

describe('daemon ship path — shipped-record write (Task 11)', () => {
  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'daemon-ship-main-'));
    worktreePath = await mkdtemp(join(tmpdir(), 'daemon-ship-wt-'));
    await git(['init', '-q']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test']);
    await writeFile(join(projectRoot, 'README.md'), 'seed\n');
    await git(['add', 'README.md']);
    await git(['commit', '-q', '-m', 'seed']);
    await writeWorktreeSpec(ITEM.slug);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
    await rm(worktreePath, { recursive: true, force: true });
  });

  it('PR finish: writes and commits the shipped record with the PR URL in frontmatter', async () => {
    const realDeps = makeFeatureRunnerDeps({
      projectRoot,
      worktreeBase: tmpdir(),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
    });

    const run = makeRunFeature(
      baseDeps(
        { done: true, halted: false, prUrl: 'https://github.com/acme/repo/pull/42' },
        realDeps.writeShippedRecord,
      ),
    );

    const out = await run(ITEM);
    expect(out.status).toBe('done');

    const recordPath = join(projectRoot, `.docs/shipped/${ITEM.slug}.md`);
    const content = await readFile(recordPath, 'utf-8');
    expect(content).toContain('pr: https://github.com/acme/repo/pull/42');
    expect(content).toContain(`slug: ${ITEM.slug}`);

    const log = await git(['log', '-1', '--format=%s']);
    expect(log).toBe(`shipped record: ${ITEM.slug}`);

    // The shipped record itself must be committed (not merely written) —
    // unrelated daemon side effects (e.g. the mergeable-watch registry) may
    // also touch untracked `.daemon/` files on this path, so scope the
    // clean-tree assertion to the shipped-record path rather than the whole
    // working tree.
    const shippedStatus = await git(['status', '--porcelain', '--', '.docs/shipped']);
    expect(shippedStatus).toBe('');
  });

  it('merge-local finish: writes the shipped record with pr: local', async () => {
    const realDeps = makeFeatureRunnerDeps({
      projectRoot,
      worktreeBase: tmpdir(),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
    });

    const run = makeRunFeature(
      baseDeps({ done: true, halted: false, prUrl: undefined }, realDeps.writeShippedRecord),
    );

    const out = await run(ITEM);
    expect(out.status).toBe('done');

    const recordPath = join(projectRoot, `.docs/shipped/${ITEM.slug}.md`);
    const content = await readFile(recordPath, 'utf-8');
    expect(content).toContain('pr: local');

    const log = await git(['log', '-1', '--format=%s']);
    expect(log).toBe(`shipped record: ${ITEM.slug}`);
  });

  it('write failure degrades gracefully: ship completes, no throw, no record written', async () => {
    const failing: FeatureRunnerDeps['writeShippedRecord'] = async () => {
      throw new Error('disk full');
    };

    const run = makeRunFeature(
      baseDeps({ done: true, halted: false, prUrl: 'https://github.com/acme/repo/pull/1' }, failing),
    );

    const out = await run(ITEM);
    // Ship still succeeds despite the write handler throwing.
    expect(out.status).toBe('done');

    const recordPath = join(projectRoot, `.docs/shipped/${ITEM.slug}.md`);
    await expect(readFile(recordPath, 'utf-8')).rejects.toThrow();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Task 12 (#204, #205): finish-side degrade + no-ship paths.
  // ───────────────────────────────────────────────────────────────────────────

  it('write failure degrades: warns exactly once, ship verdict unaffected', async () => {
    const logs: string[] = [];
    const failing: FeatureRunnerDeps['writeShippedRecord'] = async () => {
      throw new Error('ENOSPC: disk full');
    };

    const run = makeRunFeature({
      ...baseDeps(
        { done: true, halted: false, prUrl: 'https://github.com/acme/repo/pull/7' },
        failing,
      ),
      log: (msg) => logs.push(msg),
    });

    const out = await run(ITEM);

    // Finish verdict unchanged — ship completes exactly as though the write
    // never happened.
    expect(out.status).toBe('done');
    expect(out.prUrl).toBe('https://github.com/acme/repo/pull/7');

    const recordPath = join(projectRoot, `.docs/shipped/${ITEM.slug}.md`);
    await expect(readFile(recordPath, 'utf-8')).rejects.toThrow();

    // Exactly one warn, matching the required phrasing, no retries.
    const warnLines = logs.filter((l) => l.includes('shipped-record write failed'));
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]).toContain(
      `shipped-record write failed — dedup degraded to local cache for ${ITEM.slug}`,
    );
  });

  it('commit failure degrades: warns exactly once, ship still completes, no record persists', async () => {
    // Use the REAL git-backed deps factory, but force git writes (add/commit)
    // to fail deterministically (independent of ambient global git config) by
    // pre-seeding a stale `.git/index.lock` — every subsequent `git add`/`git
    // commit` fails with "Unable to create ... File exists", exercising the
    // same try/catch that guards the commit step regardless of exactly which
    // git op inside it fails first.
    await writeFile(join(projectRoot, '.git', 'index.lock'), '');

    const logs: string[] = [];
    const realDeps = makeFeatureRunnerDeps({
      projectRoot,
      worktreeBase: tmpdir(),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
      log: (msg) => logs.push(msg),
    });

    const run = makeRunFeature({
      ...baseDeps(
        { done: true, halted: false, prUrl: 'https://github.com/acme/repo/pull/9' },
        realDeps.writeShippedRecord,
      ),
      log: (msg) => logs.push(msg),
    });

    const out = await run(ITEM);

    // Ship still succeeds — the commit failure is caught and swallowed.
    expect(out.status).toBe('done');

    // No commit landed for the shipped record (git commit failed).
    const log = await git(['log', '--format=%s']);
    expect(log).not.toContain(`shipped record: ${ITEM.slug}`);

    // Exactly one warn (from the daemon-deps handler), no throw surfaced.
    const warnLines = logs.filter((l) => l.includes('shipped-record write failed'));
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]).toContain(
      `shipped-record write failed — dedup degraded to local cache for ${ITEM.slug}`,
    );
  });

  it('discard outcome: no record written, no .docs/shipped/<slug>.md anywhere', async () => {
    const realDeps = makeFeatureRunnerDeps({
      projectRoot,
      worktreeBase: tmpdir(),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
    });

    const run = makeRunFeature(
      baseDeps(
        { done: true, halted: false, prUrl: undefined, finishChoice: 'discard' },
        realDeps.writeShippedRecord,
      ),
    );

    const out = await run(ITEM);

    // Finish flow unchanged — the loop still converges to 'done'.
    expect(out.status).toBe('done');

    const recordPath = join(projectRoot, `.docs/shipped/${ITEM.slug}.md`);
    await expect(readFile(recordPath, 'utf-8')).rejects.toThrow();

    const shippedStatus = await git(['status', '--porcelain', '--', '.docs/shipped']);
    expect(shippedStatus).toBe('');
    const log = await git(['log', '--format=%s']);
    expect(log).not.toContain(`shipped record: ${ITEM.slug}`);
  });

  it('keep outcome: no record written, no .docs/shipped/<slug>.md anywhere', async () => {
    const realDeps = makeFeatureRunnerDeps({
      projectRoot,
      worktreeBase: tmpdir(),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
    });

    const run = makeRunFeature(
      baseDeps(
        { done: true, halted: false, prUrl: undefined, finishChoice: 'keep' },
        realDeps.writeShippedRecord,
      ),
    );

    const out = await run(ITEM);

    expect(out.status).toBe('done');

    const recordPath = join(projectRoot, `.docs/shipped/${ITEM.slug}.md`);
    await expect(readFile(recordPath, 'utf-8')).rejects.toThrow();

    const shippedStatus = await git(['status', '--porcelain', '--', '.docs/shipped']);
    expect(shippedStatus).toBe('');
    const log = await git(['log', '--format=%s']);
    expect(log).not.toContain(`shipped record: ${ITEM.slug}`);
  });

  it('idempotent re-run: identical content already committed produces no new commit', async () => {
    const realDeps = makeFeatureRunnerDeps({
      projectRoot,
      worktreeBase: tmpdir(),
      baseBranch: 'main',
      runConductorInWorktree: async () => {},
      provider: { invoke: async () => ({ success: true, output: '' }), invokeInteractive: async () => {} },
    });

    const outcome: WorktreeOutcome = {
      done: true,
      halted: false,
      prUrl: 'https://github.com/acme/repo/pull/42',
    };

    const run = makeRunFeature(baseDeps(outcome, realDeps.writeShippedRecord));

    await run(ITEM);
    const firstLogHash = await git(['rev-parse', 'HEAD']);
    const firstCount = await git(['rev-list', '--count', 'HEAD']);

    // Second run: same slug, same plan/stories (same specHash), same PR →
    // identical rendered content except for the `shipped:` date field, which
    // is stable within the same day, so content is byte-identical.
    await writeWorktreeSpec(ITEM.slug); // re-write same content into the worktree
    await run(ITEM);

    const secondLogHash = await git(['rev-parse', 'HEAD']);
    const secondCount = await git(['rev-list', '--count', 'HEAD']);

    expect(secondLogHash).toBe(firstLogHash); // no new commit created
    expect(secondCount).toBe(firstCount);

    // Sanity: confirm the hash used is the one specHash would compute (guards
    // against the test accidentally passing due to an unrelated no-op).
    const { digest } = specHash(Buffer.from(PLAN), Buffer.from(APPROVED_STORIES));
    const content = await readFile(join(projectRoot, `.docs/shipped/${ITEM.slug}.md`), 'utf-8');
    expect(content).toContain(`spec_hash: ${digest}`);
  });
});
