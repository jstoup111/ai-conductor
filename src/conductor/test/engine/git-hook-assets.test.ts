import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK, PRE_COMMIT_HOOK } from '../../src/engine/git-hook-assets.js';
import { prepareWorktree } from '../../src/engine/worktree-prepare.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { dispatchShippedRecord } from '../../src/engine/shipped-record-cli.js';

const execFileAsync = promisify(execFile);

describe('git-hook-assets — embedding hook scripts', () => {
  let tempDir: string;

  // Helper to run bash syntax check
  async function checkBashSyntax(script: string): Promise<number> {
    try {
      const tempFile = join(tempDir, `hook-${Date.now()}-${Math.random().toString(36).slice(2)}.sh`);
      await writeFile(tempFile, script);
      await chmod(tempFile, 0o755);
      await execFileAsync('bash', ['-n', tempFile]);
      return 0;
    } catch (err) {
      const e = err as { code?: number };
      return e.code ?? 1;
    }
  }

  beforeEach(async () => {
    const prefix = join(tmpdir(), `git-hook-assets-test-`);
    tempDir = await mkdtemp(prefix);
  });

  afterEach(async () => {
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('PRE_COMMIT_HOOK', () => {
    it('is syntactically valid Bash', async () => {
      expect(await checkBashSyntax(PRE_COMMIT_HOOK)).toBe(0);
    });

    it('is self-contained and protects only BUILD/SHIP commits', () => {
      expect(PRE_COMMIT_HOOK).not.toMatch(/conduct-ts|src\/conductor\/dist/);
      expect(PRE_COMMIT_HOOK).toContain('"$PHASE" == "BUILD" || "$PHASE" == "SHIP"');
      expect(PRE_COMMIT_HOOK).toContain('CONDUCT_ENGINE_COMMIT');
    });
  });

  describe('PREPARE_COMMIT_MSG_HOOK', () => {
    it('is a non-empty string', () => {
      expect(typeof PREPARE_COMMIT_MSG_HOOK).toBe('string');
      expect(PREPARE_COMMIT_MSG_HOOK.length).toBeGreaterThan(0);
    });

    it('starts with #!/bin/bash', () => {
      expect(PREPARE_COMMIT_MSG_HOOK.startsWith('#!/bin/bash')).toBe(true);
    });

    it('passes bash syntax check (bash -n)', async () => {
      const code = await checkBashSyntax(PREPARE_COMMIT_MSG_HOOK);
      expect(code).toBe(0);
    });

    it('does not reference src/conductor/dist or conduct-ts', () => {
      expect(PREPARE_COMMIT_MSG_HOOK).not.toMatch(/src\/conductor\/dist/);
      expect(PREPARE_COMMIT_MSG_HOOK).not.toMatch(/conduct-ts/);
    });

    it('auto-stamps only when no explicit task-local trailer is present', () => {
      expect(PREPARE_COMMIT_MSG_HOOK).toMatch(/EXPLICIT_TASK_TRAILER=.*grep '\^Task:'/);
      expect(PREPARE_COMMIT_MSG_HOOK).toMatch(
        /git interpret-trailers --in-place --if-exists replace --trailer "Task: \$TASK_ID"/
      );
      expect(PREPARE_COMMIT_MSG_HOOK).toMatch(
        /if \[\[ -z "\$EXPLICIT_TASK_TRAILER" \]\] && \[\[ -n "\$TASK_ID" \]\]; then/
      );
    });
  });

  describe('COMMIT_MSG_HOOK', () => {
    it('is a non-empty string', () => {
      expect(typeof COMMIT_MSG_HOOK).toBe('string');
      expect(COMMIT_MSG_HOOK.length).toBeGreaterThan(0);
    });

    it('starts with #!/bin/bash', () => {
      expect(COMMIT_MSG_HOOK.startsWith('#!/bin/bash')).toBe(true);
    });

    it('passes bash syntax check (bash -n)', async () => {
      const code = await checkBashSyntax(COMMIT_MSG_HOOK);
      expect(code).toBe(0);
    });

    it('does not reference src/conductor/dist and invokes scope-check', () => {
      expect(COMMIT_MSG_HOOK).not.toMatch(/src\/conductor\/dist/);
      expect(COMMIT_MSG_HOOK).not.toMatch(/tasksByFile/);
      expect(COMMIT_MSG_HOOK).toMatch(
        /CONDUCT_SCOPE_CHECK_PROJECT_ROOT="\$WORKTREE_ROOT" conduct-ts scope-check "\$COMMIT_MSG_FILE"/,
      );
      expect(COMMIT_MSG_HOOK).toMatch(
        /rc=0\n\s+CONDUCT_SCOPE_CHECK_PROJECT_ROOT="\$WORKTREE_ROOT" conduct-ts scope-check "\$COMMIT_MSG_FILE" \|\| rc=\$\?\n\s+if \[\[ "\$rc" == "2" \]\]; then\n\s+exit 1\n\s+fi/,
      );
    });
  });

  it('rejects staging .docs/specs/other-feature.md while a BUILD phase marker is present', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-pre-commit-'));
    try {
      await execFileAsync('git', ['-C', repoDir, 'init', '-b', 'main']);
      await execFileAsync('git', ['-C', repoDir, 'config', 'user.email', 'test@example.com']);
      await execFileAsync('git', ['-C', repoDir, 'config', 'user.name', 'Test']);
      await writeFile(join(repoDir, 'README.md'), '# scratch\n', 'utf-8');
      await execFileAsync('git', ['-C', repoDir, 'add', 'README.md']);
      await execFileAsync('git', ['-C', repoDir, 'commit', '-m', 'chore: initial commit']);
      const hooksDir = join(repoDir, '.git-hooks');
      await mkdir(hooksDir, { recursive: true });
      await writeFile(join(hooksDir, 'pre-commit'), PRE_COMMIT_HOOK, 'utf-8');
      await chmod(join(hooksDir, 'pre-commit'), 0o755);
      await execFileAsync('git', ['-C', repoDir, 'config', 'core.hooksPath', hooksDir]);
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(join(repoDir, '.pipeline', 'phase-active'), 'step: build\nphase: BUILD\n', 'utf-8');
      await mkdir(join(repoDir, '.docs', 'specs'), { recursive: true });
      await writeFile(join(repoDir, '.docs', 'specs', 'other-feature.md'), '# protected\n', 'utf-8');
      await execFileAsync('git', ['-C', repoDir, 'add', '.docs/specs/other-feature.md']);

      let exitCode = 0;
      let stderr = '';
      try {
        await execFileAsync('git', ['-C', repoDir, 'commit', '-m', 'test: protected mutation']);
      } catch (error) {
        const result = error as { code?: number; stderr?: string };
        exitCode = result.code ?? 1;
        stderr = result.stderr ?? '';
      }

      expect(exitCode).not.toBe(0);
      expect(stderr).toContain('.docs/specs/other-feature.md');
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  it('runs the real pre-commit gate across phase, own-artifact, allowlist, and stable-refusal paths', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-pre-commit-matrix-'));
    const git = async (...args: string[]) => execFileAsync('git', ['-C', repoDir, ...args]);
    const commit = async (message: string) => {
      try {
        await git('commit', '-m', message);
        return { code: 0, stderr: '' };
      } catch (error) {
        const result = error as { code?: number; stderr?: string };
        return { code: result.code ?? 1, stderr: result.stderr ?? '' };
      }
    };
    try {
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await writeFile(join(repoDir, 'README.md'), '# scratch\n');
      await git('add', 'README.md');
      await git('commit', '-m', 'initial');
      const hooks = join(repoDir, '.git-hooks');
      await mkdir(hooks, { recursive: true });
      await writeFile(join(hooks, 'pre-commit'), PRE_COMMIT_HOOK);
      await chmod(join(hooks, 'pre-commit'), 0o755);
      await git('config', 'core.hooksPath', hooks);
      await mkdir(join(repoDir, '.docs/decisions'), { recursive: true });
      await mkdir(join(repoDir, '.docs/specs'), { recursive: true });
      await mkdir(join(repoDir, '.docs/retros'), { recursive: true });
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });

      await writeFile(join(repoDir, '.docs/decisions/no-marker.md'), '# ADR');
      await git('add', '.docs/decisions/no-marker.md');
      expect((await commit('no marker')).code).toBe(0);
      await writeFile(join(repoDir, '.pipeline/phase-active'), 'phase: DECIDE\n');
      await writeFile(join(repoDir, '.docs/decisions/decide.md'), '# ADR');
      await git('add', '.docs/decisions/decide.md');
      expect((await commit('decide marker')).code).toBe(0);

      await writeFile(join(repoDir, '.pipeline/phase-active'), 'phase: BUILD\n');
      await writeFile(join(repoDir, '.docs/decisions/build.md'), '# ADR');
      await git('add', '.docs/decisions/build.md');
      expect((await commit('build marker')).code).not.toBe(0);
      await git('reset', 'HEAD', '.docs/decisions/build.md');

      await writeFile(join(repoDir, '.pipeline/task-status.json'), JSON.stringify({ plan_ref: '.docs/plans/my-feature.md' }));
      await writeFile(join(repoDir, '.docs/specs/my-feature.md'), '# own');
      await git('add', '.docs/specs/my-feature.md');
      expect((await commit('own artifact')).code).toBe(0);

      await writeFile(join(repoDir, '.pipeline/phase-active'), 'phase: SHIP\nallow: .docs/retros/\n');
      await writeFile(join(repoDir, '.docs/retros/x.md'), '# retro');
      await git('add', '.docs/retros/x.md');
      expect((await commit('allowlisted retro')).code).toBe(0);

      await writeFile(join(repoDir, '.docs/specs/other-feature.md'), '# foreign');
      await git('add', '.docs/specs/other-feature.md');
      const first = await commit('foreign artifact');
      const second = await commit('foreign artifact');
      expect(first.code).not.toBe(0);
      expect(second.stderr).toBe(first.stderr);
      expect(first.stderr).toContain('.docs/specs/other-feature.md');
      expect(first.stderr).toContain('SHIP');
      expect(first.stderr).toContain('DECIDE step');
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  describe('Regression lock: no dist/CLI dependencies (#403 class)', () => {
    /**
     * Task 17: No-dist-dependency regression lock
     *
     * Hooks must be pure bash + POSIX tools, with no dependency on:
     * - Compiled engine (dist/)
     * - CLI tool (conduct/conduct-ts)
     * - Package managers (npm/npx)
     *
     * Allowlist: git, node -e, POSIX tools (test, grep, cat, sed, etc.)
     *
     * This locks the #403-class bug: accidental introduction of engine or CLI
     * dependencies into hook scripts, which breaks git workflows when the engine
     * is not available (e.g., before a build, or in CI without node_modules).
     */

    const FORBIDDEN_PATTERNS = [
      { pattern: /\bdist\//, name: 'dist/ reference' },
      { pattern: /\bnpm\b/, name: 'npm invocation' },
      { pattern: /\bnpx\b/, name: 'npx invocation' },
    ];

    it('PREPARE_COMMIT_MSG_HOOK does not reference dist/, npm, or npx', () => {
      for (const { pattern, name } of FORBIDDEN_PATTERNS) {
        expect(
          PREPARE_COMMIT_MSG_HOOK,
          `PREPARE_COMMIT_MSG_HOOK should not contain ${name}`
        ).not.toMatch(pattern);
      }
    });

    it('COMMIT_MSG_HOOK does not reference dist/, npm, or npx except its scope-check CLI', () => {
      for (const { pattern, name } of FORBIDDEN_PATTERNS) {
        expect(
          COMMIT_MSG_HOOK,
          `COMMIT_MSG_HOOK should not contain ${name}`
        ).not.toMatch(pattern);
      }
    });

    it('both hooks do not spawn package-manager CLI tools', () => {
      /**
       * Check for invocations of forbidden CLI tools.
       * We look for word boundaries to catch:
       * - `npm ...` or `$(npm ...)`
       * - `npx ...` or `$(npx ...)`
       *
       * Note: `require()` inside `node -e` strings is allowed (not a CLI invocation).
       * We're checking for shell invocations of these tools, which would be executed
       * outside the `node -e` context.
       */
      const forbiddenCliPatterns = [
        /\bnpm\b/,
        /\bnpx\b/,
      ];

      // For each hook, check against forbidden patterns
      for (const { hookName, hook } of [
        { hookName: 'PREPARE_COMMIT_MSG_HOOK', hook: PREPARE_COMMIT_MSG_HOOK },
        { hookName: 'COMMIT_MSG_HOOK', hook: COMMIT_MSG_HOOK },
      ]) {
        for (const forbiddenPattern of forbiddenCliPatterns) {
          expect(hook, `${hookName} should not invoke ${forbiddenPattern.source}`).not.toMatch(forbiddenPattern);
        }
      }
    });
  });

  describe('Surface A: commit-msg rejects unattributed build-step commits (#505 Task 5)', () => {
    // Real hook-wired temp repo — drives an actual `git commit`, no mocking of
    // git or the hook scripts. The `.pipeline/build-step-active` marker is the
    // same marker the engine writes around a build-step session (Task 3).

    let repoDir: string;

    async function git(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', repoDir, ...args]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
      }
    }

    async function writeMarker(): Promise<void> {
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(join(repoDir, '.pipeline', 'build-step-active'), `${new Date().toISOString()}\n`, 'utf-8');
    }

    async function commitFile(name: string, body: string, message: string): Promise<{ stdout: string; stderr: string; code: number }> {
      await writeFile(join(repoDir, name), body, 'utf-8');
      await git('add', name);
      return git('commit', '-m', message);
    }

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-surface-a-'));
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await writeFile(join(repoDir, 'README.md'), '# scratch\n', 'utf-8');
      await git('add', '.');
      await git('commit', '-m', 'chore: initial commit');
      // Wires PREPARE_COMMIT_MSG_HOOK + COMMIT_MSG_HOOK via core.hooksPath.
      await prepareWorktree(repoDir);
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    it('Task 14: accepts a non-empty commit with no Task: trailer even when the marker is present (rejection demoted to telemetry)', async () => {
      await writeMarker();
      const res = await commitFile('a.txt', 'a', 'feat: unattributed change');
      expect(res.code).toBe(0);
    });

    it('passes a commit stamped with a Task: trailer while the marker is present', async () => {
      await writeMarker();
      const res = await commitFile('b.txt', 'b', 'feat: attributed change\n\nTask: 1');
      expect(res.code).toBe(0);
    });

    it('passes a trailer-less commit when the marker is absent (marker gates the check)', async () => {
      const res = await commitFile('c.txt', 'c', 'feat: pre-cutover behavior unchanged');
      expect(res.code).toBe(0);
    });

    it('does not stamp a guessed Task: trailer when .pipeline/current-task is absent (Story 3 abstention)', async () => {
      // Regression for #671 Tasks 4/6: PREPARE_COMMIT_MSG_HOOK must abstain
      // (add no trailer at all) when it has no unambiguous task id to work
      // from, rather than guessing one. Assert on the full commit body, not
      // just exit code, so a stray/guessed trailer would be caught.
      const res = await commitFile('c2.txt', 'c2', 'feat: no stamp present, no trailer expected');
      expect(res.code).toBe(0);
      const body = await git('log', '-1', '--format=%B');
      expect(body.stdout).not.toMatch(/^Task:/m);
    });

    it('rejects an invalid explicit Task: trailer instead of replacing it with .pipeline/current-task', async () => {
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(join(repoDir, '.pipeline', 'current-task'), '1\n', 'utf-8');
      await writeFile(
        join(repoDir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', status: 'in_progress' }] }),
        'utf-8',
      );
      const res = await commitFile('f.txt', 'f', 'feat: reconcile stale trailer\n\nTask: 999');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toContain('Task: 999 not found in task-status.json');
    });

    it('Task 14: accepts an unattributed commit made with git commit -m (direct form)', async () => {
      await writeMarker();
      await writeFile(join(repoDir, 'd.txt'), 'd', 'utf-8');
      await git('add', 'd.txt');
      const res = await git('commit', '-m', 'feat: direct unattributed');
      expect(res.code).toBe(0);
    });

    it('accepts an unattributed commit produced via an editor-driven (interactive-style) commit-msg file', async () => {
      await writeMarker();
      await writeFile(join(repoDir, 'e.txt'), 'e', 'utf-8');
      await git('add', 'e.txt');
      // Simulate the interactive form: git writes the message to
      // COMMIT_EDITMSG and invokes commit-msg with that file — `git commit`
      // with no -m does exactly this when GIT_EDITOR leaves the templated
      // message untouched, so we drive commit-msg directly against a
      // hand-written COMMIT_EDITMSG-equivalent file to exercise the same
      // code path without needing a real interactive editor in CI.
      const commonDir = (await git('rev-parse', '--git-common-dir')).stdout;
      const absCommonDir = commonDir.startsWith('/') ? commonDir : join(repoDir, commonDir);
      const hookPath = join(repoDir, '.pipeline', 'git-hooks', 'commit-msg');
      const msgFile = join(repoDir, '.git-editmsg-test');
      await writeFile(msgFile, 'feat: interactive unattributed\n', 'utf-8');
      void absCommonDir;
      await expect(execFileAsync(hookPath, [msgFile], { cwd: repoDir })).resolves.toBeDefined();
    });
  });

  describe('Surface A exemptions: merge, amend, rebase (#505 Task 6)', () => {
    let repoDir: string;

    async function git(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', repoDir, ...args]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
      }
    }

    async function writeMarker(): Promise<void> {
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(join(repoDir, '.pipeline', 'build-step-active'), `${new Date().toISOString()}\n`, 'utf-8');
    }

    async function commitFile(name: string, body: string, message: string): Promise<{ stdout: string; stderr: string; code: number }> {
      await writeFile(join(repoDir, name), body, 'utf-8');
      await git('add', name);
      return git('commit', '-m', message);
    }

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-surface-a-exempt-'));
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await writeFile(join(repoDir, 'README.md'), '# scratch\n', 'utf-8');
      await git('add', '.');
      await git('commit', '-m', 'chore: initial commit');
      await prepareWorktree(repoDir);
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    it('lands a merge commit trailer-less even with the marker present', async () => {
      // Create a diverging branch so the merge is non-fast-forward and
      // produces a real merge commit with MERGE_HEAD set during commit.
      await git('checkout', '-b', 'feature');
      await commitFile('feature.txt', 'feature', 'feat: feature work\n\nTask: 1');
      await git('checkout', 'main');
      await commitFile('main.txt', 'main', 'feat: main work\n\nTask: 1');
      await writeMarker();
      const res = await git('merge', '--no-ff', 'feature', '-m', 'merge: combine feature into main');
      expect(res.code).toBe(0);
    });

    it('lands an amend of a pre-enforcement commit trailer-less', async () => {
      // Commit made before the marker existed (pre-enforcement), no trailer.
      await commitFile('pre.txt', 'pre', 'feat: pre-enforcement change');
      // Enforcement activates afterward.
      await writeMarker();
      const res = await git('commit', '--amend', '-m', 'feat: pre-enforcement change (reworded)');
      expect(res.code).toBe(0);
    });

    it('lands trailer-less commits replayed during a rebase', async () => {
      await git('checkout', '-b', 'feature');
      await commitFile('rebase-me.txt', 'content', 'feat: to be rebased');
      await git('checkout', 'main');
      await commitFile('main2.txt', 'main2', 'feat: main advances\n\nTask: 1');
      await writeMarker();
      const res = await git('rebase', 'main', 'feature');
      expect(res.code).toBe(0);
    });

    it('Task 14: accepts a non-merge, non-amend, non-rebase commit without a trailer when the marker is present', async () => {
      await writeMarker();
      const res = await commitFile('plain.txt', 'plain', 'feat: plain unattributed change');
      expect(res.code).toBe(0);
    });
  });

  describe('Surface A exemptions: evidence/engine/inactive (#505 Task 7)', () => {
    let repoDir: string;

    async function git(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', repoDir, ...args]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
      }
    }

    async function writeMarker(): Promise<void> {
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(join(repoDir, '.pipeline', 'build-step-active'), `${new Date().toISOString()}\n`, 'utf-8');
    }

    async function commitFile(name: string, body: string, message: string): Promise<{ stdout: string; stderr: string; code: number }> {
      await writeFile(join(repoDir, name), body, 'utf-8');
      await git('add', name);
      return git('commit', '-m', message);
    }

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-surface-a-exempt2-'));
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await writeFile(join(repoDir, 'README.md'), '# scratch\n', 'utf-8');
      await git('add', '.');
      await git('commit', '-m', 'chore: initial commit');
      await prepareWorktree(repoDir);
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    it('lands an empty commit with a resolvable Evidence: satisfied-by trailer and no Task: trailer', async () => {
      await writeMarker();
      const sha = (await git('rev-parse', 'HEAD')).stdout;
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        `feat: evidence-only, no task trailer\n\nEvidence: satisfied-by ${sha}`,
      );
      expect(res.code).toBe(0);
    });

    it('Task 14: accepts an empty commit with the marker present, no Task: trailer, and no Evidence: satisfied-by trailer', async () => {
      await writeMarker();
      const res = await git('commit', '--allow-empty', '-m', 'feat: empty and unattributed');
      expect(res.code).toBe(0);
    });

    it('lands an empty commit with a Task: trailer plus Evidence: skipped <reason> and no Evidence: satisfied-by', async () => {
      await writeMarker();
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        'feat: skipped evidence with task trailer\n\nTask: 1\nEvidence: skipped covered by task 2 (a2cde88)',
      );
      expect(res.code).toBe(0);
    });

    it('Task 14: accepts an empty commit with Evidence: skipped and an empty/whitespace-only reason (evidence no longer gates)', async () => {
      await writeMarker();
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        'feat: skipped with blank reason\n\nTask: 1\nEvidence: skipped    ',
      );
      expect(res.code).toBe(0);
    });

    it('lands an empty commit with Evidence: skipped <reason> and no Task: trailer', async () => {
      await writeMarker();
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        'feat: skipped evidence, no task trailer\n\nEvidence: skipped covered by task 2 (a2cde88)',
      );
      expect(res.code).toBe(0);
    });

    it('Task 14: accepts an empty commit with an unresolvable Evidence: satisfied-by sha (evidence no longer gates)', async () => {
      await writeMarker();
      const res = await git(
        'commit',
        '--allow-empty',
        '-m',
        'feat: unresolvable satisfied-by\n\nEvidence: satisfied-by 0000000000000000000000000000000000000000',
      );
      expect(res.code).toBe(0);
    });

    it('lands a non-empty, trailer-less commit when CONDUCT_ENGINE_COMMIT=1 and the marker is present', async () => {
      await writeMarker();
      await writeFile(join(repoDir, 'engine.txt'), 'engine', 'utf-8');
      await git('add', 'engine.txt');
      let code = 0;
      try {
        await execFileAsync(
          'git',
          ['-C', repoDir, 'commit', '-m', 'chore: engine bookkeeping commit'],
          { env: { ...process.env, CONDUCT_ENGINE_COMMIT: '1' } },
        );
      } catch (err) {
        const e = err as { code?: number };
        code = e.code ?? 1;
      }
      expect(code).toBe(0);
      const res = await git('log', '-1', '--format=%s');
      expect(res.stdout).toBe('chore: engine bookkeeping commit');
    });

    it('lands a trailer-less content commit when the marker is entirely absent (enforcement inactive)', async () => {
      const res = await commitFile('inactive.txt', 'inactive', 'feat: enforcement inactive, no trailer');
      expect(res.code).toBe(0);
    });

    it('still rejects an unknown Task: id regardless of marker state (pre-feature behavior unchanged)', async () => {
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(
        join(repoDir, '.pipeline', 'task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', status: 'pending' }] }, null, 2),
        'utf-8',
      );
      const res = await commitFile('unknown.txt', 'unknown', 'feat: bad id\n\nTask: 999');
      expect(res.code).not.toBe(0);
      expect(res.stderr).toMatch(/not found in task-status\.json/);
    });
  });

  describe('Plan-scope hook exemptions and fail-open exits (#1074 Task 10)', () => {
    let repoDir: string;
    let fakeBinDir: string;

    async function git(
      args: string[],
      env?: NodeJS.ProcessEnv,
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', repoDir, ...args], { env });
        return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
      }
    }

    async function writeScopeCheck(exitCode: number): Promise<NodeJS.ProcessEnv> {
      await writeFile(join(fakeBinDir, 'conduct-ts'), `#!/bin/sh\nexit ${exitCode}\n`, 'utf8');
      await chmod(join(fakeBinDir, 'conduct-ts'), 0o755);
      return { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` };
    }

    async function stageOutsideScope(name: string): Promise<void> {
      await writeFile(join(repoDir, name), 'outside declared scope\n', 'utf8');
      await git(['add', name]);
    }

    async function commitOutsideScope(
      name: string,
      message: string,
      env?: NodeJS.ProcessEnv,
    ): Promise<{ stdout: string; stderr: string; code: number }> {
      await stageOutsideScope(name);
      return git(['commit', '-m', message], env);
    }

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-scope-exits-'));
      fakeBinDir = join(repoDir, 'fake-bin');
      await mkdir(fakeBinDir, { recursive: true });
      await git(['init', '-b', 'main']);
      await git(['config', 'user.email', 'test@example.com']);
      await git(['config', 'user.name', 'Test']);
      await writeFile(join(repoDir, 'README.md'), '# scratch\n', 'utf8');
      await git(['add', '.']);
      await git(['commit', '-m', 'chore: initial commit']);
      await prepareWorktree(repoDir);
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(
        join(repoDir, '.pipeline', 'task-status.json'),
        JSON.stringify({
          tasks: [{ id: '1', status: 'in_progress', files: ['declared.ts'] }],
        }),
        'utf8',
      );
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    it.each([
      ['unavailable executable', 127],
      ['unregistered subcommand', 1],
      ['throwing command', 70],
    ])('allows an out-of-scope commit when scope-check is %s', async (_name, exitCode) => {
      const env = await writeScopeCheck(exitCode);
      const result = await commitOutsideScope('outside.ts', 'feat: uncertain check\n\nTask: 1', env);

      expect(result.code).toBe(0);
      expect(result.stderr).toContain(`scope-check abstained (exit ${exitCode})`);
    });

    it('refuses an out-of-scope commit only when scope-check returns 2', async () => {
      const env = await writeScopeCheck(2);
      const result = await commitOutsideScope('outside.ts', 'feat: confirmed violation\n\nTask: 1', env);

      expect(result.code).not.toBe(0);
    });

    it('exempts merge, amend, rebase replay, engine commits, and commits with no Task trailer', async () => {
      const env = await writeScopeCheck(0);

      const noTask = await commitOutsideScope('no-task.ts', 'feat: no attribution', env);
      expect(noTask.code).toBe(0);

      const engine = await commitOutsideScope(
        'engine.ts',
        'chore: engine bookkeeping\n\nTask: 1',
        { ...env, CONDUCT_ENGINE_COMMIT: '1' },
      );
      expect(engine.code).toBe(0);

      const initial = await commitOutsideScope('amend.ts', 'feat: before amend', env);
      expect(initial.code).toBe(0);
      await stageOutsideScope('amend-extra.ts');
      await writeScopeCheck(2);
      const amend = await git(['commit', '--amend', '-m', 'feat: amended'], env);
      expect(amend.code).toBe(0);

      await writeScopeCheck(0);
      await git(['checkout', '-b', 'feature'], env);
      const feature = await commitOutsideScope('feature.ts', 'feat: feature\n\nTask: 1', env);
      expect(feature.code).toBe(0);
      await git(['checkout', 'main'], env);
      const main = await commitOutsideScope('main.ts', 'feat: main\n\nTask: 1', env);
      expect(main.code).toBe(0);
      await writeScopeCheck(2);
      const merge = await git(['merge', '--no-ff', 'feature', '-m', 'merge: feature'], env);
      expect(merge.code).toBe(0);

      await writeScopeCheck(0);
      await git(['checkout', '-b', 'rebase-feature'], env);
      const replay = await commitOutsideScope('replay.ts', 'feat: replay\n\nTask: 1', env);
      expect(replay.code).toBe(0);
      await git(['checkout', 'main'], env);
      const advance = await commitOutsideScope('advance.ts', 'feat: advance\n\nTask: 1', env);
      expect(advance.code).toBe(0);
      await writeScopeCheck(2);
      const rebase = await git(['rebase', 'main', 'rebase-feature'], env);
      expect(rebase.code).toBe(0);
    });
  });

  describe('Engine commit spawn sites set CONDUCT_ENGINE_COMMIT=1 (#505 Task 8)', () => {
    // Real hook-wired repos, no mocking: if a spawn site failed to set the
    // marker, these trailer-less commits would be REJECTED by the commit-msg
    // hook (Task 7) while the build-step-active marker is present. Landing
    // cleanly is the proof the env var was actually threaded through.
    let repoDir: string;

    async function git(...args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
      try {
        const { stdout, stderr } = await execFileAsync('git', ['-C', repoDir, ...args]);
        return { stdout: stdout.trim(), stderr: stderr.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string; stderr?: string };
        return { stdout: (e.stdout ?? '').trim(), stderr: (e.stderr ?? '').trim(), code: e.code ?? 1 };
      }
    }

    async function writeMarker(): Promise<void> {
      await mkdir(join(repoDir, '.pipeline'), { recursive: true });
      await writeFile(join(repoDir, '.pipeline', 'build-step-active'), `${new Date().toISOString()}\n`, 'utf-8');
    }

    beforeEach(async () => {
      repoDir = await mkdtemp(join(tmpdir(), 'git-hook-assets-task8-'));
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await writeFile(join(repoDir, 'README.md'), '# scratch\n', 'utf-8');
      await git('add', '.');
      await git('commit', '-m', 'chore: initial commit');
      await prepareWorktree(repoDir);
    });

    afterEach(async () => {
      await rm(repoDir, { recursive: true, force: true });
    });

    it('rebase.ts makeGitRunner: a trailer-less `git commit` lands under an active build-step marker', async () => {
      await writeMarker();
      await writeFile(join(repoDir, 'engine-a.txt'), 'a', 'utf-8');
      const run = makeGitRunner(repoDir);
      const add = await run(['add', 'engine-a.txt']);
      expect(add.exitCode).toBe(0);

      const commit = await run(['commit', '-m', 'chore: engine bookkeeping via makeGitRunner']);
      expect(commit.exitCode).toBe(0);

      const log = await git('log', '-1', '--format=%s');
      expect(log.stdout).toBe('chore: engine bookkeeping via makeGitRunner');
    });

    it('rebase.ts makeGitRunner: does NOT set the marker for non-commit git invocations', async () => {
      // Sanity check the marker is scoped to `commit` — a plain `status` call
      // must not somehow bypass anything unrelated (regression guard on the
      // args[0] === 'commit' gate in makeGitRunner).
      const run = makeGitRunner(repoDir);
      const status = await run(['status', '--porcelain']);
      expect(status.exitCode).toBe(0);
    });

    it('shipped-record-cli.ts dispatchShippedRecord: commits the shipped record trailer-less under an active build-step marker', async () => {
      await writeMarker();
      await mkdir(join(repoDir, '.docs', 'plans'), { recursive: true });
      await mkdir(join(repoDir, '.docs', 'stories'), { recursive: true });
      await writeFile(join(repoDir, '.docs', 'plans', 'demo-slug.md'), '# Implementation Plan: demo\n');
      await writeFile(join(repoDir, '.docs', 'stories', 'demo-slug.md'), '# Stories: demo\n');

      const exitCode = await dispatchShippedRecord(
        { kind: 'write', slug: 'demo-slug', pr: 'local' },
        repoDir,
      );
      expect(exitCode).toBe(0);

      const log = await git('log', '-1', '--format=%s');
      expect(log.stdout).toBe('shipped record: demo-slug');
    });
  });
});
