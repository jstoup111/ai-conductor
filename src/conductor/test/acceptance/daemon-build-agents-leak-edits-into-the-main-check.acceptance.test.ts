/**
 * Acceptance specs for #380 — Main-Checkout Leak Triage, Auto-Heal, and
 * Write-Fence (TR-2, TR-3).
 *
 * These drive the REAL production entry point (`fastForwardRoot`) against real
 * temp git repos — not `leak-triage.ts`'s classification functions in
 * isolation. Per /writing-system-tests §3b, a unit test that calls the new
 * triage/heal primitives directly would pass even if `fastForwardRoot` never
 * wired them in; these specs fail unless the dirty-branch path in
 * `daemon-backlog.ts` actually calls triage/heal AND still falls through to
 * fetch + `merge --ff-only` in the SAME poll.
 *
 * Story: .docs/stories/daemon-build-agents-leak-edits-into-the-main-check.md
 * Plan:  .docs/plans/daemon-build-agents-leak-edits-into-the-main-check.md
 *
 * TR-1 (triage classification in isolation) is unit-covered by Tasks 1–6
 * (leak-triage.test.ts against real temp repos) — no acceptance spec here.
 * TR-4 (fence provisioning) is a single-operation call covered by Task 16
 * (sandbox-build-env.test.ts) — no acceptance spec here.
 * TR-5 (fence runtime allow/block) is covered by the separate real-binary
 * acceptance spec: write-fence-real-binary.acceptance.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { fastForwardRoot } from '../../src/engine/daemon-backlog.js';
import { makeGitRunner, type GitRunner } from '../../src/engine/rebase.js';

const execFile = promisify(execFileCb);

describe('acceptance: main-checkout leak auto-heal + escalation (#380, TR-2/TR-3)', () => {
  let repoDir: string;
  let originDir: string;
  let defaultBranch: string;

  async function git(args: string[], cwd: string = repoDir): Promise<string> {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  }

  async function gitAllowFail(args: string[], cwd: string = repoDir) {
    try {
      const { stdout } = await execFile('git', args, { cwd });
      return { exitCode: 0, stdout: stdout.trim() };
    } catch (e: any) {
      return { exitCode: typeof e.code === 'number' ? e.code : 1, stdout: '' };
    }
  }

  beforeEach(async () => {
    originDir = await mkdtemp(join(tmpdir(), 'origin-leak-'));
    await execFile('git', ['init', '--bare', '-q'], { cwd: originDir });

    repoDir = await mkdtemp(join(tmpdir(), 'repo-leak-'));
    await execFile('git', ['clone', '-q', originDir, repoDir]);
    await execFile('git', ['config', 'user.email', 'test@test.com'], { cwd: repoDir });
    await execFile('git', ['config', 'user.name', 'Test'], { cwd: repoDir });

    await mkdir(join(repoDir, 'src'), { recursive: true });
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const original = true;\n');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'init']);
    await git(['push', '-q', 'origin', 'HEAD']);
    defaultBranch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
    await git(['remote', 'set-head', 'origin', defaultBranch]);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
    await rm(originDir, { recursive: true, force: true });
  });

  /** Creates a local `feat/daemon-x`-style candidate branch with the given
   * content for `src/a.ts`, then leaves the checkout back on defaultBranch. */
  async function makeCandidateBranch(branchName: string, content: string): Promise<void> {
    await git(['checkout', '-q', '-b', branchName]);
    await writeFile(join(repoDir, 'src', 'a.ts'), content);
    await git(['add', '.']);
    await git(['commit', '-q', '-m', `build: ${branchName}`]);
    await git(['checkout', '-q', defaultBranch]);
  }

  /** Advances origin's default branch by one commit, simulating a merged PR,
   * so a successful heal's same-poll FF has something to catch up to. */
  async function advanceOrigin(): Promise<string> {
    await git(['checkout', '-q', '-b', 'spec/other-merge']);
    await mkdir(join(repoDir, '.docs'), { recursive: true });
    await writeFile(join(repoDir, '.docs', 'merged.md'), 'merged spec\n');
    await git(['add', '.docs']);
    await git(['commit', '-q', '-m', 'merge spec: other']);
    await git(['push', '-q', 'origin', `spec/other-merge:${defaultBranch}`]);
    await git(['checkout', '-q', defaultBranch]);
    await git(['branch', '-D', 'spec/other-merge']);
    return git(['rev-parse', `origin/${defaultBranch}`]);
  }

  it('fully-explained leak: heals (restore), WARNs naming the culprit, and fast-forwards in the SAME poll', async () => {
    await makeCandidateBranch('feat/daemon-x', 'export const leaked = true;\n');
    const remoteTip = await advanceOrigin();

    // Leaked edit: working tree now byte-identical to feat/daemon-x's head blob.
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const leaked = true;\n');
    const dirtyBefore = await git(['status', '--porcelain']);
    expect(dirtyBefore).not.toBe('');

    const logs: string[] = [];
    await fastForwardRoot(repoDir, (m) => logs.push(m));

    // Restored: the leaked edit is gone, tree is clean.
    const dirtyAfter = await git(['status', '--porcelain']);
    expect(dirtyAfter).toBe('');
    expect(await readFile(join(repoDir, 'src', 'a.ts'), 'utf-8')).toBe(
      'export const original = true;\n',
    );

    // ONE WARN naming the culprit branch and the healed path.
    const warns = logs.filter((l) => /feat\/daemon-x/.test(l) && /src\/a\.ts/.test(l));
    expect(warns.length).toBe(1);

    // Same-poll fast-forward: HEAD now matches origin's advanced tip.
    const headAfter = await git(['rev-parse', 'HEAD']);
    expect(headAfter).toBe(remoteTip);
    await expect(access(join(repoDir, '.docs', 'merged.md'))).resolves.toBeUndefined();
  });

  it('untracked stray content-matched to the culprit tree is deleted alongside the modified-file heal', async () => {
    await makeCandidateBranch('feat/daemon-x', 'export const leaked = true;\n');
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const leaked = true;\n');
    // Stray whose content matches a blob (src/a.ts's leaked content) that
    // exists in feat/daemon-x's tree, at a different, untracked path.
    await writeFile(join(repoDir, 'src', 'a.ts.new'), 'export const leaked = true;\n');

    const logs: string[] = [];
    await fastForwardRoot(repoDir, (m) => logs.push(m));

    await expect(access(join(repoDir, 'src', 'a.ts.new'))).rejects.toThrow();
    expect(await git(['status', '--porcelain'])).toBe('');
  });

  it('partial explanation: one unexplained file among several explained → NOTHING is touched, FF still skipped', async () => {
    await makeCandidateBranch('feat/daemon-x', 'export const leaked = true;\n');
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const leaked = true;\n');
    // An unrelated dirty file with content that matches no candidate branch.
    await writeFile(join(repoDir, 'src', 'b.ts'), 'export const operatorWork = 42;\n');
    await git(['add', 'src/b.ts']); // tracked-but-uncommitted is not required; keep untracked
    await git(['reset', '-q']); // undo the add so b.ts stays untracked & unexplained

    const logs: string[] = [];
    await fastForwardRoot(repoDir, (m) => logs.push(m));

    // Neither file was touched — the explained file was NOT restored either.
    expect(await readFile(join(repoDir, 'src', 'a.ts'), 'utf-8')).toBe(
      'export const leaked = true;\n',
    );
    await expect(access(join(repoDir, 'src', 'b.ts'))).resolves.toBeUndefined();
    expect(await git(['status', '--porcelain'])).not.toBe('');
    expect(logs.join('\n')).toMatch(/leak-suspect|unexplained/i);
  });

  it('restore failure mid-heal is logged and contained — fastForwardRoot resolves, does not throw, next poll re-triages cleanly', async () => {
    await makeCandidateBranch('feat/daemon-x', 'export const leaked = true;\n');
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const leaked = true;\n');

    const real = makeGitRunner(repoDir);
    let restoreCalls = 0;
    const failingRestoreOnce: GitRunner = async (args) => {
      if (args[0] === 'restore') {
        restoreCalls += 1;
        return { exitCode: 1, stdout: '', stderr: 'simulated disk failure' };
      }
      return real(args);
    };

    const logs: string[] = [];
    let threw = false;
    try {
      await fastForwardRoot(repoDir, (m) => logs.push(m), failingRestoreOnce);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(restoreCalls).toBeGreaterThan(0);
    expect(logs.join('\n')).toMatch(/src\/a\.ts/);

    // A subsequent, un-injected poll re-triages from scratch without crashing.
    let secondThrew = false;
    try {
      await fastForwardRoot(repoDir, () => {});
    } catch {
      secondThrew = true;
    }
    expect(secondThrew).toBe(false);
  });

  it('unexplained dirty tree escalates to a full leak-suspect WARN on first sight, then throttles to a short line while unchanged', async () => {
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const mystery = true;\n');

    const logsFirst: string[] = [];
    await fastForwardRoot(repoDir, (m) => logsFirst.push(m));
    const firstJoined = logsFirst.join('\n');
    expect(firstJoined).toMatch(/src\/a\.ts/);
    expect(firstJoined.length).toBeGreaterThan(80); // a per-file table, not a one-liner

    const logsSecond: string[] = [];
    await fastForwardRoot(repoDir, (m) => logsSecond.push(m));
    const secondJoined = logsSecond.join('\n');
    // Same dirty fingerprint → short line, not the full table again.
    expect(secondJoined.length).toBeLessThan(firstJoined.length);
  });

  it('dirty state gains a new file between polls → the fingerprint changes and the full WARN re-emits', async () => {
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const mystery = true;\n');
    await fastForwardRoot(repoDir, () => {});

    await writeFile(join(repoDir, 'src', 'c.ts'), 'export const alsoMystery = true;\n');
    const logsThird: string[] = [];
    await fastForwardRoot(repoDir, (m) => logsThird.push(m));
    const joined = logsThird.join('\n');
    expect(joined).toMatch(/src\/c\.ts/);
    expect(joined.length).toBeGreaterThan(80);
  });

  it('a triage failure never throws out of fastForwardRoot — falls back to the short skip line, FF safety preserved', async () => {
    await writeFile(join(repoDir, 'src', 'a.ts'), 'export const mystery = true;\n');

    let triageAttempted = 0;
    const explodingGit: GitRunner = async (args) => {
      // Let the branch-discovery preamble (remote/HEAD/status) succeed via the
      // real runner so we reach the dirty branch, then explode on any triage
      // classification command triage would issue beyond plain status. This
      // asserts triage is actually ATTEMPTED (and its failure contained) —
      // not merely that fastForwardRoot doesn't throw, which would hold
      // trivially before triage exists at all.
      if (args[0] === 'branch' || args[0] === 'for-each-ref' || args[0] === 'worktree') {
        triageAttempted += 1;
        throw new Error('simulated git failure');
      }
      return makeGitRunner(repoDir)(args);
    };

    const logs: string[] = [];
    let threw = false;
    try {
      await fastForwardRoot(repoDir, (m) => logs.push(m), explodingGit);
    } catch {
      threw = true;
    }
    expect(triageAttempted).toBeGreaterThan(0); // triage was actually invoked
    expect(threw).toBe(false);
    expect(await git(['status', '--porcelain'])).not.toBe(''); // still dirty, untouched
    expect(logs.join('\n')).toMatch(/not clean|skip|triage/i);
  });
});
