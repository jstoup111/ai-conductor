import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile, stat, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  prepareWorktree,
  sanitizeNamespace,
  SETUP_SCRIPT,
  NAMESPACE_VAR,
  SetupFailureError,
} from '../../src/engine/worktree-prepare.js';
import { PRE_DISPATCH_HOOK, POST_DISPATCH_HOOK } from '../../src/engine/session-hook-assets.js';

const execFileAsync = promisify(execFile);

describe('engine/worktree-prepare', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-prepare-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSetup(body: string, mode = 0o755): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, SETUP_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, mode);
  }

  describe('sanitizeNamespace', () => {
    it('reduces a worktree dir name to a DB-safe token', () => {
      expect(sanitizeNamespace('2026-06-27-add-foo')).toBe('2026_06_27_add_foo');
      expect(sanitizeNamespace('plain_slug')).toBe('plain_slug');
    });
  });

  it('writes WORKTREE_NAMESPACE into the worktree .env (derived from the dir name)', async () => {
    await prepareWorktree(dir);
    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain(`${NAMESPACE_VAR}=${sanitizeNamespace(dir.split('/').pop()!)}`);
  });

  it('preserves existing .env entries and replaces (not duplicates) the namespace line', async () => {
    await writeFile(
      join(dir, '.env'),
      `SECRET=keep-me\n${NAMESPACE_VAR}=stale\nOTHER=x\n`,
      'utf-8',
    );
    await prepareWorktree(dir);

    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain('SECRET=keep-me');
    expect(env).toContain('OTHER=x');
    // exactly one namespace line, and not the stale value
    const nsLines = env.split('\n').filter((l) => l.startsWith(`${NAMESPACE_VAR}=`));
    expect(nsLines).toHaveLength(1);
    expect(nsLines[0]).not.toContain('stale');
  });

  it('no-ops the setup step when the project ships no bin/setup (still writes the namespace)', async () => {
    // No bin/setup → must resolve without throwing, and .env is still written.
    await expect(prepareWorktree(dir)).resolves.toBeUndefined();
    await readFile(join(dir, '.env'), 'utf-8'); // exists
  });

  it('runs bin/setup in the worktree with CI=true and WORKTREE_NAMESPACE exported', async () => {
    // The script records the env it saw + proves cwd is the worktree.
    await writeSetup(
      `#!/usr/bin/env bash\necho "CI=$CI ${NAMESPACE_VAR}=$${NAMESPACE_VAR}" > setup-saw.txt\ntouch ran.marker\n`,
    );

    await prepareWorktree(dir);

    const saw = await readFile(join(dir, 'setup-saw.txt'), 'utf-8');
    expect(saw).toContain('CI=true');
    expect(saw).toContain(`${NAMESPACE_VAR}=${sanitizeNamespace(dir.split('/').pop()!)}`);
    await readFile(join(dir, 'ran.marker'), 'utf-8'); // ran in the worktree cwd
  });

  it('rejects with SetupFailureError carrying outputTail when bin/setup exits non-zero', async () => {
    await writeSetup('#!/usr/bin/env bash\necho "line 1"\necho "FAILURE_MARKER" >&2\nexit 3\n');
    try {
      await prepareWorktree(dir);
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(SetupFailureError);
      expect((err as SetupFailureError).outputTail).toContain('FAILURE_MARKER');
    }
  });

  it('rejects with SetupFailureError when spawn fails (non-executable or missing interpreter)', async () => {
    await writeSetup('#!/usr/bin/env bash\nexit 0\n', 0o644); // not executable
    try {
      await prepareWorktree(dir);
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(SetupFailureError);
      expect((err as SetupFailureError).outputTail).toBeTruthy();
    }
  });

  it('forwards setup output to the log sink', async () => {
    await writeSetup('#!/usr/bin/env bash\necho "== Preparing database =="\n');
    const lines: string[] = [];
    await prepareWorktree(dir, (m) => lines.push(m));
    expect(lines.some((l) => l.includes('Preparing database'))).toBe(true);
    expect(lines.some((l) => l.includes('ok'))).toBe(true);
  });

  it('rejects with plain Error (not SetupFailureError) when .env write fails (unwritable worktree)', async () => {
    // Make the directory read-only so writeFile will fail.
    await chmod(dir, 0o555);
    try {
      await prepareWorktree(dir);
      throw new Error('should have rejected');
    } catch (err) {
      // Namespace write failures must NOT be classified as SetupFailureError.
      expect(err).not.toBeInstanceOf(SetupFailureError);
      expect(err).toBeInstanceOf(Error);
    } finally {
      // Restore permissions for cleanup.
      await chmod(dir, 0o755);
    }
  });

  it('no-ops and does not produce triage-observable effects when bin/setup is absent', async () => {
    // No bin/setup must resolve cleanly without any special markers.
    const log: string[] = [];
    await expect(prepareWorktree(dir, (m) => log.push(m))).resolves.toBeUndefined();
    // Should have written the namespace but not mentioned running setup.
    expect(log.some((l) => l.includes('skipping project setup'))).toBe(true);
    // .env should exist with the namespace.
    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain(NAMESPACE_VAR);
  });

  // Story 6 (#433): prepareWorktree wires the attribution git hooks
  // per-worktree, isolated from the primary checkout, fail-open. Unlike the
  // suite above, these tests need a REAL git repo (worktree-scoped
  // `core.hooksPath` is meaningless outside one). None of `git-hook-assets.ts`
  // exists yet, so these fail on the missing hook files/config until Tasks 1,
  // 9, 10, 11 land — acceptable pre-implementation RED.
  describe('git hook wiring (Story 6)', () => {
    let repoRoot: string;
    let worktreeDir: string;

    async function git(cwd: string, ...args: string[]): Promise<{ stdout: string; code: number }> {
      try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, ...args]);
        return { stdout: stdout.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        return { stdout: (e.stdout ?? '').trim(), code: e.code ?? 1 };
      }
    }

    beforeEach(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), 'wt-prepare-repo-'));
      await git(repoRoot, 'init', '-b', 'main');
      await git(repoRoot, 'config', 'user.email', 'test@example.com');
      await git(repoRoot, 'config', 'user.name', 'Test');
      await writeFile(join(repoRoot, 'README.md'), '# scratch\n', 'utf-8');
      await git(repoRoot, 'add', '.');
      await git(repoRoot, 'commit', '-m', 'chore: initial commit');

      worktreeDir = join(tmpdir(), `wt-prepare-wt-${Math.random().toString(36).slice(2)}`);
      await git(repoRoot, 'worktree', 'add', worktreeDir, '-b', 'feature');
    });

    afterEach(async () => {
      await git(repoRoot, 'worktree', 'remove', '--force', worktreeDir).catch(() => undefined);
      await rm(worktreeDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    });

    it('writes the two attribution hooks executable under .pipeline/git-hooks/', async () => {
      await prepareWorktree(worktreeDir);

      const prepareCommitMsg = join(worktreeDir, '.pipeline', 'git-hooks', 'prepare-commit-msg');
      const commitMsg = join(worktreeDir, '.pipeline', 'git-hooks', 'commit-msg');

      const s1 = await stat(prepareCommitMsg);
      expect(s1.mode & 0o111).not.toBe(0);
      const s2 = await stat(commitMsg);
      expect(s2.mode & 0o111).not.toBe(0);
    });

    it('sets worktree-scoped extensions.worktreeConfig and core.hooksPath to an absolute path', async () => {
      await prepareWorktree(worktreeDir);

      const worktreeConfig = await git(worktreeDir, 'config', 'extensions.worktreeConfig');
      expect(worktreeConfig.stdout).toBe('true');

      const hooksPath = await git(worktreeDir, 'config', 'core.hooksPath');
      expect(hooksPath.code).toBe(0);
      expect(hooksPath.stdout).toBe(join(worktreeDir, '.pipeline', 'git-hooks'));
    });

    it('leaves core.hooksPath unset in the primary checkout', async () => {
      await prepareWorktree(worktreeDir);

      const primaryHooksPath = await git(repoRoot, 'config', 'core.hooksPath');
      expect(primaryHooksPath.code).not.toBe(0);
    });

    it('is fail-open when git config --worktree fails: logs a skip, provisioning still succeeds', async () => {
      // Simulate an unsupported/old git by pointing HOME at a location where
      // git's config write cannot succeed: make .git read-only so any
      // `git config --worktree` write fails, without touching the hook-file
      // write path itself.
      const dotGit = join(worktreeDir, '.git');
      await chmod(dotGit, 0o500).catch(() => undefined);

      const lines: string[] = [];
      await expect(prepareWorktree(worktreeDir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(dotGit, 0o700).catch(() => undefined);

      expect(lines.some((l) => /hook/i.test(l) && /skip/i.test(l))).toBe(true);
    });

    it('is fail-open when the hook asset copy fails: logs a skip, provisioning still succeeds', async () => {
      // Make the destination directory uncreatable/unwritable to force the
      // hook-file write to fail.
      const pipelineDir = join(worktreeDir, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await chmod(pipelineDir, 0o500);

      const lines: string[] = [];
      await expect(prepareWorktree(worktreeDir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(pipelineDir, 0o700).catch(() => undefined);

      expect(lines.some((l) => /hook/i.test(l) && /skip/i.test(l))).toBe(true);
    });

    it('leaves the existing bin/setup + namespace contract unchanged when hooks are wired', async () => {
      await mkdir(join(worktreeDir, 'bin'), { recursive: true });
      const script = join(worktreeDir, SETUP_SCRIPT);
      await writeFile(script, '#!/usr/bin/env bash\ntouch ran.marker\n', 'utf-8');
      await chmod(script, 0o755);

      await prepareWorktree(worktreeDir);

      await access(join(worktreeDir, 'ran.marker'));
      const env = await readFile(join(worktreeDir, '.env'), 'utf-8');
      expect(env).toContain(NAMESPACE_VAR);
    });
  });

  // Task 12: prepareWorktree installs session-hook scripts to
  // .pipeline/session-hooks/, executable, overwriting any stale file.
  describe('session hook provisioning (Task 12)', () => {
    it('writes pre-dispatch.sh and post-dispatch.sh executable with the exported asset content', async () => {
      await prepareWorktree(dir);

      const preDispatchPath = join(dir, '.pipeline', 'session-hooks', 'pre-dispatch.sh');
      const postDispatchPath = join(dir, '.pipeline', 'session-hooks', 'post-dispatch.sh');

      const preContent = await readFile(preDispatchPath, 'utf-8');
      expect(preContent).toBe(PRE_DISPATCH_HOOK);
      const preStat = await stat(preDispatchPath);
      expect(preStat.mode & 0o777).toBe(0o755);

      const postContent = await readFile(postDispatchPath, 'utf-8');
      expect(postContent).toBe(POST_DISPATCH_HOOK);
      const postStat = await stat(postDispatchPath);
      expect(postStat.mode & 0o777).toBe(0o755);
    });

    it('overwrites stale pre-existing session-hook files', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await writeFile(join(hooksDir, 'pre-dispatch.sh'), 'stale pre content', 'utf-8');
      await writeFile(join(hooksDir, 'post-dispatch.sh'), 'stale post content', 'utf-8');

      await prepareWorktree(dir);

      const preContent = await readFile(join(hooksDir, 'pre-dispatch.sh'), 'utf-8');
      expect(preContent).toBe(PRE_DISPATCH_HOOK);
      const postContent = await readFile(join(hooksDir, 'post-dispatch.sh'), 'utf-8');
      expect(postContent).toBe(POST_DISPATCH_HOOK);
    });
  });
});
