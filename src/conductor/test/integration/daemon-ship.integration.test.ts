import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import {
  detectShippedRecordCommand,
  dispatchShippedRecord,
} from '../../src/engine/shipped-record-cli.js';
import { makeRunFeature, type FeatureRunnerDeps, type WorktreeOutcome } from '../../src/engine/daemon-runner.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import { specHash } from '../../src/engine/shipped-record.js';

// ─────────────────────────────────────────────────────────────────────────────
// Story 2 (#204, #205) — the shipped record rides the IMPLEMENTATION branch.
// Per adr-2026-07-03-committed-shipped-record-dispatch-dedup Decision 1, the
// finish flow commits `.docs/shipped/<slug>.md` on the implementation PR
// branch (via `conduct shipped-record`) BEFORE the branch's final push, so the
// human merge lands code + shipped-fact atomically. These integration specs
// drive the REAL subcommand (`dispatchShippedRecord`) against a real git repo
// standing in for the feature worktree on its impl branch — a real-binary
// smoke, not an injected fake — and pin that the daemon-side ship path writes
// NO record at all (the as-built main-checkout write was an ADR violation:
// never pushed, and it wedges fastForwardRoot's --ff-only advance).
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const SLUG = 'feat-x';
const BRANCH = `feat/${SLUG}`;

const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
const PLAN = '# Plan\n\n### Task 1\n**Dependencies:** none\n';

let repo: string; // the feature worktree checkout, on its implementation branch

const git = async (args: string[], cwd = repo) => {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
};

async function writeSpec(slug: string): Promise<void> {
  await mkdir(join(repo, '.docs/plans'), { recursive: true });
  await mkdir(join(repo, '.docs/stories'), { recursive: true });
  await writeFile(join(repo, `.docs/plans/${slug}.md`), PLAN);
  await writeFile(join(repo, `.docs/stories/${slug}.md`), APPROVED_STORIES);
}

async function runShippedRecord(slug: string, pr: string): Promise<number> {
  const cmd = detectShippedRecordCommand(['node', 'conduct', 'shipped-record', '--slug', slug, '--pr', pr]);
  if (!cmd || cmd.kind !== 'write') throw new Error('detect failed for valid args');
  return dispatchShippedRecord(cmd, repo);
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'daemon-ship-wt-'));
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repo, 'README.md'), 'seed\n');
  await git(['add', 'README.md']);
  await git(['commit', '-q', '-m', 'seed']);
  // The implementation branch the finish flow runs on, with the spec committed
  // (worktrees are cut from base with the vetted plan+stories already merged).
  await git(['checkout', '-q', '-b', BRANCH]);
  await writeSpec(SLUG);
  await git(['add', '.docs']);
  await git(['commit', '-q', '-m', `merge spec: ${SLUG}`]);
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('conduct shipped-record — record committed on the implementation branch (Story 2)', () => {
  it('PR finish: commits the record on the impl branch (not base) with all four frontmatter fields', async () => {
    const code = await runShippedRecord(SLUG, 'https://github.com/acme/repo/pull/42');
    expect(code).toBe(0);

    const content = await readFile(join(repo, `.docs/shipped/${SLUG}.md`), 'utf-8');
    expect(content).toContain(`slug: ${SLUG}`);
    expect(content).toContain('pr: https://github.com/acme/repo/pull/42');
    expect(content).toMatch(/spec_hash: \S+/);
    expect(content).toMatch(/shipped: \d{4}-\d{2}-\d{2}/);

    // Committed (not merely written), on the impl branch…
    expect(await git(['log', '-1', '--format=%s'])).toBe(`shipped record: ${SLUG}`);
    expect(await git(['status', '--porcelain', '--', '.docs/shipped'])).toBe('');
    // …and NOT on the base branch: the record rides the PR, so an unmerged PR
    // leaves base without a record (the ADR's risk-table property).
    const onBase = await git(['ls-tree', '-r', '--name-only', 'main', '--', '.docs/shipped']);
    expect(onBase).toBe('');
  });

  it('hash parity: the record spec_hash matches what discovery computes for the same bytes', async () => {
    await runShippedRecord(SLUG, 'https://github.com/acme/repo/pull/42');
    const { digest } = specHash(Buffer.from(PLAN), Buffer.from(APPROVED_STORIES));
    const content = await readFile(join(repo, `.docs/shipped/${SLUG}.md`), 'utf-8');
    expect(content).toContain(`spec_hash: ${digest}`);
  });

  it('merge-local finish: the record (pr: local) is committed before the merge and lands in the merged commits', async () => {
    const code = await runShippedRecord(SLUG, 'local');
    expect(code).toBe(0);
    expect(await readFile(join(repo, `.docs/shipped/${SLUG}.md`), 'utf-8')).toContain('pr: local');

    // The finish flow then merges the branch — the record is part of the merge.
    await git(['checkout', '-q', 'main']);
    await git(['merge', '-q', '--no-edit', BRANCH]);
    const onBase = await git(['ls-tree', '-r', '--name-only', 'main', '--', '.docs/shipped']);
    expect(onBase).toBe(`.docs/shipped/${SLUG}.md`);
  });

  it('unreadable plan degrades: warns once with the canonical line, exits 0, commits nothing', async () => {
    const warns: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => {
      warns.push(String(m));
    });

    const code = await runShippedRecord('no-such-slug', 'https://github.com/acme/repo/pull/1');
    expect(code).toBe(0); // never blocks the ship

    const warnLines = warns.filter((l) => l.includes('shipped-record write failed'));
    expect(warnLines).toHaveLength(1);
    expect(warnLines[0]).toContain(
      'shipped-record write failed — dedup degraded to local cache for no-such-slug',
    );

    await expect(readFile(join(repo, '.docs/shipped/no-such-slug.md'), 'utf-8')).rejects.toThrow();
    expect(await git(['log', '--format=%s'])).not.toContain('shipped record: no-such-slug');
  });

  it('commit failure degrades: warns once, exits 0, no record commit lands', async () => {
    // A stale index.lock makes every `git add`/`git commit` fail
    // deterministically, exercising the same try/catch whichever git op
    // inside it fails first.
    await writeFile(join(repo, '.git', 'index.lock'), '');
    const warns: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((m: unknown) => {
      warns.push(String(m));
    });

    const code = await runShippedRecord(SLUG, 'https://github.com/acme/repo/pull/9');
    expect(code).toBe(0);

    const warnLines = warns.filter((l) => l.includes('shipped-record write failed'));
    expect(warnLines).toHaveLength(1);

    await rm(join(repo, '.git', 'index.lock'));
    expect(await git(['log', '--format=%s'])).not.toContain(`shipped record: ${SLUG}`);
  });

  it('idempotent re-run: identical content already committed produces no new commit and exits 0', async () => {
    await runShippedRecord(SLUG, 'https://github.com/acme/repo/pull/42');
    const firstHead = await git(['rev-parse', 'HEAD']);
    const firstCount = await git(['rev-list', '--count', 'HEAD']);

    // Same slug, same plan/stories, same PR, same day → byte-identical record.
    const code = await runShippedRecord(SLUG, 'https://github.com/acme/repo/pull/42');
    expect(code).toBe(0);

    expect(await git(['rev-parse', 'HEAD'])).toBe(firstHead);
    expect(await git(['rev-list', '--count', 'HEAD'])).toBe(firstCount);
  });

  it('malformed args never fall through to the pipeline launcher: guide + exit 1', async () => {
    const cmd = detectShippedRecordCommand(['node', 'conduct', 'shipped-record', '--slug', SLUG]);
    expect(cmd).toEqual({ kind: 'guide' }); // recognized subcommand, misused — never null
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await dispatchShippedRecord(cmd!, repo)).toBe(1);
  });
});

describe('daemon ship path — writes NO shipped record (ADR Decision 1 compliance)', () => {
  it('a done ship marks the ledger but never writes/commits .docs/shipped/ on the daemon checkout', async () => {
    // The daemon's main checkout: distinct from the worktree, sitting on base.
    const mainCheckout = await mkdtemp(join(tmpdir(), 'daemon-ship-main-'));
    await execFile('git', ['init', '-q', '-b', 'main'], { cwd: mainCheckout });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: mainCheckout });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: mainCheckout });
    await writeFile(join(mainCheckout, 'README.md'), 'seed\n');
    await execFile('git', ['add', 'README.md'], { cwd: mainCheckout });
    await execFile('git', ['commit', '-q', '-m', 'seed'], { cwd: mainCheckout });

    const processed: string[] = [];
    const outcome: WorktreeOutcome = {
      done: true,
      halted: false,
      finishChoice: 'pr',
      prUrl: 'https://github.com/acme/repo/pull/42',
    };
    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: repo, branch: BRANCH }),
      runConductor: async () => {},
      readOutcome: async () => outcome,
      teardownWorktree: async () => {},
      markProcessed: async (slug) => {
        processed.push(slug);
      },
      daemon: false,
      provider: {
        invoke: async () => ({ success: true, output: '' }),
        invokeInteractive: async () => {},
      },
      project: 'test-project',
      projectRoot: mainCheckout,
    };

    const item: BacklogItem = { slug: SLUG };
    const out = await makeRunFeature(deps)(item);
    expect(out.status).toBe('done');
    expect(processed).toEqual([SLUG]);

    // No record, no commit — local main stays even with its origin so
    // fastForwardRoot's --ff-only advance keeps working after every ship.
    await expect(
      readFile(join(mainCheckout, `.docs/shipped/${SLUG}.md`), 'utf-8'),
    ).rejects.toThrow();
    const { stdout: logOut } = await execFile('git', ['log', '--format=%s'], {
      cwd: mainCheckout,
    });
    expect(logOut).not.toContain('shipped record');
    const { stdout: count } = await execFile('git', ['rev-list', '--count', 'HEAD'], {
      cwd: mainCheckout,
    });
    expect(count.trim()).toBe('1'); // still just the seed commit

    await rm(mainCheckout, { recursive: true, force: true });
  });
});
