import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'node:child_process';

import { isAheadOfBase, publishEarlyDraft, type GitRunner, type GhRunner } from '../../src/engine/pr-labels.js';

/**
 * Real-binary exec runner: executes the PRODUCTION argv verbatim against the
 * real `git` binary. No rewriting/joining — any translation here would let the
 * smoke pass while production ships a broken argv (the exact trap this test
 * exists to catch). Mirrors test/backlog-priority.smoke.test.ts's
 * realExecRunner() for `gh`.
 *
 * Deliberately bypasses `makeProductionGit()` (and thus the
 * AI_CONDUCTOR_NO_REAL_EXEC kill-switch in test/setup.ts) — this test's whole
 * point is to exercise the real binary against a local, network-free fixture,
 * not live GitHub, so the kill-switch's threat model doesn't apply here.
 */
function realGitRunner(): GitRunner {
  return async (args: string[], opts: { cwd: string }) => {
    const stdout = execFileSync('git', args, {
      cwd: opts.cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout };
  };
}

/** Fake `gh` runner — publishEarlyDraft's draft-PR step must stay off-network here. */
function fakeGhRunner(prUrl: string): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args: string[]) => {
    calls.push(args);
    return { stdout: `https://github.com/example/example/pull/1\nurl: ${prUrl}` };
  };
  return { gh, calls };
}

const BASE = 'main';

describe('smoke/pr-timing-argv (real git binary, local file-remote fixture)', () => {
  let remoteDir: string;
  let repoDir: string;

  async function git(cwd: string, ...args: string[]): Promise<string> {
    return execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();
  }

  beforeEach(async () => {
    remoteDir = await mkdtemp(join(tmpdir(), 'pr-timing-argv-remote-'));
    repoDir = await mkdtemp(join(tmpdir(), 'pr-timing-argv-repo-'));

    // Bare "remote" — a real file:// git remote, no network involved.
    await git(remoteDir, 'init', '--bare', '-q');

    // Working repo forked from BASE with one commit, wired to the bare remote.
    await git(repoDir, 'init', '-q', '-b', BASE);
    await git(repoDir, 'config', 'user.email', 'smoke@example.com');
    await git(repoDir, 'config', 'user.name', 'Smoke Test');
    await git(repoDir, 'commit', '--allow-empty', '-q', '-m', 'root');
    await git(repoDir, 'remote', 'add', 'origin', remoteDir);
    await git(repoDir, 'push', '-q', 'origin', BASE);
  });

  afterEach(async () => {
    await rm(remoteDir, { recursive: true, force: true });
    await rm(repoDir, { recursive: true, force: true });
  });

  it('isAheadOfBase(): real `rev-list --count base..HEAD` argv reports 0 when even with base', async () => {
    const count = await isAheadOfBase(realGitRunner(), repoDir, BASE);
    expect(count).toBe(0);
  });

  it('isAheadOfBase(): real `rev-list --count base..HEAD` argv reports N after N commits ahead', async () => {
    await git(repoDir, 'checkout', '-q', '-b', 'feat/argv-smoke');
    await git(repoDir, 'commit', '--allow-empty', '-q', '-m', 'one');
    await git(repoDir, 'commit', '--allow-empty', '-q', '-m', 'two');

    const count = await isAheadOfBase(realGitRunner(), repoDir, BASE);
    expect(count).toBe(2);
  });

  it('publishEarlyDraft(): not ahead of base — real `push -u origin <branch>` argv lands the branch on the remote, no draft PR', async () => {
    await git(repoDir, 'checkout', '-q', '-b', 'feat/argv-smoke-even');
    const { gh, calls: ghCalls } = fakeGhRunner('unused');

    const result = await publishEarlyDraft(
      realGitRunner(),
      gh,
      repoDir,
      { branch: 'feat/argv-smoke-even', base: BASE },
    );

    expect(result.pushed).toBe(true);
    expect(result.drafted).toBe(false);
    expect(ghCalls.length).toBe(0);

    // Verify against the real remote, independent of the seam under test.
    const refs = await git(remoteDir, 'show-ref', '--heads');
    expect(refs).toContain('refs/heads/feat/argv-smoke-even');
  });

  it('publishEarlyDraft(): ahead of base — real push + rev-list argv lands the branch and triggers exactly one draft-PR create', async () => {
    await git(repoDir, 'checkout', '-q', '-b', 'feat/argv-smoke-ahead');
    await git(repoDir, 'commit', '--allow-empty', '-q', '-m', 'checkpoint');
    const { gh, calls: ghCalls } = fakeGhRunner('https://github.com/example/example/pull/1');

    const result = await publishEarlyDraft(
      realGitRunner(),
      gh,
      repoDir,
      { branch: 'feat/argv-smoke-ahead', base: BASE },
    );

    expect(result.pushed).toBe(true);
    expect(result.drafted).toBe(true);
    expect(ghCalls.length).toBe(1);
    expect(ghCalls[0]).toEqual([
      'pr',
      'create',
      '--head',
      'feat/argv-smoke-ahead',
      '--base',
      BASE,
      '--title',
      '[DRAFT] feat/argv-smoke-ahead',
      '--body',
      'Auto-created draft PR for early checkpoint publish.',
      '--draft',
    ]);

    const refs = await git(remoteDir, 'show-ref', '--heads');
    expect(refs).toContain('refs/heads/feat/argv-smoke-ahead');
  });
});
