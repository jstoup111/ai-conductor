/**
 * Tests for the daemon poll-time remote-ref refresh fix.
 *
 * Root cause: the poll loop never fetched from origin before scanning the
 * backlog, so specs merged onto origin/main were invisible until the operator
 * manually pulled. The fix: `resolveDiscoveryRef` does a best-effort
 * `git fetch origin <default>` on every tick and returns `origin/<default>` so
 * `gitTreeSource` reads the remote-tracking ref (which `git fetch` updates).
 *
 * Tests cover:
 *   - resolveDiscoveryRef returns `origin/<default>` after a successful fetch
 *   - the discovered branch name is NOT hardcoded (e.g. trunk ≠ main)
 *   - no origin remote → returns localBase, no fetch attempted
 *   - origin/HEAD unset AND remote show fallback fails → returns localBase
 *   - fetch failure (offline) → returns localBase, does NOT throw
 *   - fetch is called before returning the remote ref
 *   - git integration: spec visible on `origin/<default>` (remote-tracking ref)
 *     after a fetch but absent from local base IS discovered
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { resolveDiscoveryRef, discoverBacklog } from '../../src/engine/daemon-backlog.js';
import type { GitRunner, GitResult } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

// ── Fake git runner (mirrors rebase.test.ts pattern) ─────────────────────────

function fakeGit(
  script: Array<{ match: string[]; result: Partial<GitResult> }>,
): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push(args);
    for (const entry of script) {
      if (entry.match.every((tok, i) => args[i] === tok)) {
        return {
          exitCode: entry.result.exitCode ?? 0,
          stdout: entry.result.stdout ?? '',
          stderr: entry.result.stderr ?? '',
        };
      }
    }
    return { exitCode: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

// ── resolveDiscoveryRef unit tests ────────────────────────────────────────────

describe('daemon-backlog — resolveDiscoveryRef (per-poll remote refresh)', () => {
  it('returns origin/<default> when origin exists and fetch succeeds', async () => {
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['fetch', 'origin', 'main'], result: { exitCode: 0 } },
    ]);
    const ref = await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: true }, git);
    expect(ref).toBe('origin/main');
  });

  it('uses the discovered remote default branch name, NOT a hardcoded "main"', async () => {
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/trunk\n' },
      },
      { match: ['fetch', 'origin', 'trunk'], result: { exitCode: 0 } },
    ]);
    const ref = await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: true }, git);
    expect(ref).toBe('origin/trunk');
  });

  it('returns localBase when there is no origin remote (local-only repo)', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: '' } },
    ]);
    const ref = await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: true }, git);
    expect(ref).toBe('main');
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
  });

  it('returns localBase when origin/HEAD is unset and remote show fallback also fails', async () => {
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { exitCode: 128, stdout: '' },
      },
      { match: ['remote', 'show', 'origin'], result: { exitCode: 1, stdout: '' } },
    ]);
    const ref = await resolveDiscoveryRef('/fake/repo', 'develop', () => {}, { refresh: true }, git);
    expect(ref).toBe('develop');
  });

  it('returns localBase when fetch fails (offline), does NOT throw', async () => {
    const logs: string[] = [];
    const { git } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['fetch', 'origin', 'main'], result: { exitCode: 1, stderr: 'network unreachable' } },
    ]);
    let threw = false;
    let ref: string;
    try {
      ref = await resolveDiscoveryRef('/fake/repo', 'main', (msg) => logs.push(msg), { refresh: true }, git);
    } catch {
      threw = true;
      ref = '';
    }
    expect(threw).toBe(false);
    expect(ref).toBe('main');
    expect(logs.length).toBeGreaterThan(0);
  });

  it('invokes git fetch before returning the remote ref', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      { match: ['fetch', 'origin', 'main'], result: { exitCode: 0 } },
    ]);
    await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: true }, git);
    expect(calls).toContainEqual(['fetch', 'origin', 'main']);
  });

  it('invokes fetch with the DISCOVERED branch name, not the hardcoded localBase', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/trunk\n' },
      },
      { match: ['fetch', 'origin', 'trunk'], result: { exitCode: 0 } },
    ]);
    await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: true }, git);
    // fetch uses 'trunk' (discovered), not 'main' (local base)
    expect(calls).toContainEqual(['fetch', 'origin', 'trunk']);
    expect(calls.some((c) => c[0] === 'fetch' && c[2] === 'main')).toBe(false);
  });
});

// ── refresh:false — between-work, builds running: NEVER fetch ──────────────────

describe('daemon-backlog — resolveDiscoveryRef (refresh:false, work in flight)', () => {
  it('does NOT fetch and returns origin/<default> when the remote-tracking ref exists', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      {
        match: ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'],
        result: { exitCode: 0, stdout: 'deadbeef\n' },
      },
    ]);
    const ref = await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: false }, git);
    expect(ref).toBe('origin/main');
    // Crucially: no `git fetch` while builds run.
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
  });

  it('returns localBase (no fetch) when origin/<default> has not been fetched yet', async () => {
    const { git, calls } = fakeGit([
      { match: ['remote'], result: { stdout: 'origin\n' } },
      {
        match: ['symbolic-ref', 'refs/remotes/origin/HEAD'],
        result: { stdout: 'refs/remotes/origin/main\n' },
      },
      {
        match: ['rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main'],
        result: { exitCode: 1, stdout: '' },
      },
    ]);
    const ref = await resolveDiscoveryRef('/fake/repo', 'main', () => {}, { refresh: false }, git);
    expect(ref).toBe('main');
    expect(calls.some((c) => c[0] === 'fetch')).toBe(false);
  });
});

// ── Git integration: spec visible on origin/<default> IS discovered ───────────
//
// This exercises the full git path: `gitTreeSource` with `origin/<branch>` as
// the ref reads the remote-tracking tree (updated by fetch). A spec committed on
// origin's main but NOT yet pulled locally is discovered once the ref is `origin/main`.

describe('daemon-backlog — remote-tracking ref discovery (git integration)', () => {
  let repoDir: string;
  let originDir: string;
  let defaultBranch: string;

  const APPROVED_STORIES = '# Stories\n**Status:** Accepted\n';
  const planWithDeps = (storiesRef: string) =>
    `# Plan\n**Stories:** ${storiesRef}\n\n### Task 1\n**Dependencies:** none\n`;

  async function git(args: string[], cwd: string): Promise<string> {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  }

  beforeEach(async () => {
    // Bare "origin" repo
    originDir = await mkdtemp(join(tmpdir(), 'origin-poll-'));
    await execFile('git', ['init', '--bare', '-q'], { cwd: originDir });

    // Clone → local repo
    repoDir = await mkdtemp(join(tmpdir(), 'repo-poll-'));
    await execFile('git', ['clone', '-q', originDir, repoDir]);
    await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

    // Initial commit + push so origin has a default branch
    await writeFile(join(repoDir, 'README.md'), 'init\n');
    await git(['add', 'README.md'], repoDir);
    await git(['commit', '-q', '-m', 'init'], repoDir);
    await git(['push', '-q', 'origin', 'HEAD'], repoDir);
    defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD'], repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(originDir, { recursive: true, force: true });
  });

  it('spec merged on origin but absent from local branch IS discovered via origin/<default>', async () => {
    // Push the spec to origin's default branch (simulates a GitHub PR merge)
    // without updating local — the daemon's poll must detect it via fetch + origin/<default>.
    await git(['checkout', '-q', '-b', 'spec/remote-only'], repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(repoDir, '.docs/plans/remote-only.md'),
      planWithDeps('.docs/stories/remote-only.md'),
    );
    await writeFile(join(repoDir, '.docs/stories/remote-only.md'), APPROVED_STORIES);
    await git(['add', '.docs'], repoDir);
    await git(['commit', '-q', '-m', 'merge spec: remote-only'], repoDir);
    // Push this branch's tip to origin's main — simulates a merged PR
    await git(['push', '-q', 'origin', `spec/remote-only:${defaultBranch}`], repoDir);

    // Return to local default branch — it does NOT have the spec yet
    await git(['checkout', '-q', defaultBranch], repoDir);

    // Confirm local base has NO spec (the bug scenario)
    const localBacklog = await discoverBacklog(repoDir, undefined, undefined, {
      baseBranch: defaultBranch,
    });
    expect(localBacklog).toHaveLength(0); // spec not in local main

    // After fetch, origin/<default> has the spec — discovered when using remote ref
    await git(['fetch', 'origin', defaultBranch], repoDir);
    const remoteBacklog = await discoverBacklog(repoDir, undefined, undefined, {
      baseBranch: `origin/${defaultBranch}`,
    });
    expect(remoteBacklog.map((b) => b.slug)).toEqual(['remote-only']);
  });

  it('local spec present only on local main (not origin) is NOT discovered via origin/<default>', async () => {
    // Commit a spec locally but do NOT push it — it must be invisible on origin/<default>
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/stories'), { recursive: true });
    await writeFile(
      join(repoDir, '.docs/plans/local-only.md'),
      planWithDeps('.docs/stories/local-only.md'),
    );
    await writeFile(join(repoDir, '.docs/stories/local-only.md'), APPROVED_STORIES);
    await git(['add', '.docs'], repoDir);
    await git(['commit', '-q', '-m', 'spec: local-only (NOT pushed)'], repoDir);

    // Fetch so origin/<default> is fresh — it should NOT have local-only
    await git(['fetch', 'origin', defaultBranch], repoDir);
    const remoteBacklog = await discoverBacklog(repoDir, undefined, undefined, {
      baseBranch: `origin/${defaultBranch}`,
    });
    expect(remoteBacklog).toHaveLength(0); // local-only spec not on origin
  });
});
