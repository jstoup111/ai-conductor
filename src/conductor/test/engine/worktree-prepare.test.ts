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
import {
  PRE_DISPATCH_HOOK,
  POST_DISPATCH_HOOK,
  MUTATION_GATE_HOOK,
  DOCS_GUARD_HOOK,
} from '../../src/engine/session-hook-assets.js';
import { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } from '../../src/engine/git-hook-assets.js';

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

  describe('setup output logging (daemon log noise)', () => {
    // A successful bin/setup emitting install/build chatter — including a
    // blank spacer line and publish-engine's machine-readable JSON, the two
    // shapes that dominated the daemon log.
    const CHATTY_SETUP =
      '#!/usr/bin/env bash\n' +
      'echo "added 402 packages"\n' +
      'echo ""\n' +
      'echo "{\\"versionId\\":\\"20260723T113046Z-abc\\",\\"dir\\":\\"/x/y\\"}"\n' +
      'echo "Setup complete."\n';

    it('summarizes bin/setup output instead of echoing it, by default', async () => {
      await writeSetup(CHATTY_SETUP);
      const lines: string[] = [];

      await prepareWorktree(dir, (m) => lines.push(m));

      const setupLines = lines.filter((l) => l.startsWith('setup: '));
      // No raw passthrough: neither the JSON blob nor the chatter is echoed.
      expect(setupLines.some((l) => l.includes('versionId'))).toBe(false);
      expect(setupLines.some((l) => l.includes('added 402 packages'))).toBe(false);
      // A single summary line reports how much was suppressed (blank dropped).
      expect(setupLines).toContainEqual(
        expect.stringContaining('3 line(s) of output suppressed'),
      );
      expect(setupLines).toContain('setup: ok');
    });

    it('echoes full output when verbose is set, still dropping blank lines', async () => {
      await writeSetup(CHATTY_SETUP);
      const lines: string[] = [];

      await prepareWorktree(dir, (m) => lines.push(m), { verbose: true });

      const setupLines = lines.filter((l) => l.startsWith('setup: '));
      expect(setupLines.some((l) => l.includes('versionId'))).toBe(true);
      expect(setupLines).toContain('setup: added 402 packages');
      // Blank spacer lines are never echoed, even verbose.
      expect(setupLines).not.toContain('setup: ');
      expect(setupLines.some((l) => l.includes('suppressed'))).toBe(false);
    });

    it('still carries setup output on failure, regardless of verbosity', async () => {
      await writeSetup('#!/usr/bin/env bash\necho "DIAGNOSTIC_LINE"\nexit 3\n');
      await expect(prepareWorktree(dir, () => {})).rejects.toMatchObject({
        outputTail: expect.stringContaining('DIAGNOSTIC_LINE'),
      });
    });
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

  it('forwards setup output to the log sink under verbose', async () => {
    // Was unconditional; success output is now summarized by default (see
    // "setup output logging") and echoed only when verbose is requested.
    await writeSetup('#!/usr/bin/env bash\necho "== Preparing database =="\n');
    const lines: string[] = [];
    await prepareWorktree(dir, (m) => lines.push(m), { verbose: true });
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

  // Task 13: prepareWorktree wires the session hooks into
  // .claude/settings.local.json with merge-preserve semantics.
  describe('settings.local.json hook wiring (Task 13)', () => {
    const settingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.local.json');

    function findEntry(arr: unknown[], substr: string): Record<string, unknown> | undefined {
      return (arr as Record<string, unknown>[]).find((e) => {
        const hooks = e.hooks as Array<{ command?: string }> | undefined;
        return hooks?.some((h) => typeof h.command === 'string' && h.command.includes(substr));
      });
    }

    it('writes PreToolUse and PostToolUse hook entries into a fresh worktree', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      const preEntry = findEntry(settings.hooks.PreToolUse, 'pre-dispatch.sh');
      expect(preEntry).toBeDefined();
      expect(preEntry?.matcher).toBe('Task|Agent');
      const preCmd = (preEntry?.hooks as Array<{ command: string }>)[0].command;
      expect(preCmd).toBe(join(dir, '.pipeline', 'session-hooks', 'pre-dispatch.sh'));

      const postEntry = findEntry(settings.hooks.PostToolUse, 'post-dispatch.sh');
      expect(postEntry).toBeDefined();
      expect(postEntry?.matcher).toBe('Task|Agent');
      const postCmd = (postEntry?.hooks as Array<{ command: string }>)[0].command;
      expect(postCmd).toBe(join(dir, '.pipeline', 'session-hooks', 'post-dispatch.sh'));
    });

    it('preserves unrelated pre-existing settings byte-for-byte while adding hook entries', async () => {
      const claudeDir = join(dir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const preExisting = { permissions: { allow: ['Bash(ls:*)'] } };
      await writeFile(settingsPath(dir), JSON.stringify(preExisting), 'utf-8');

      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] });
      expect(findEntry(settings.hooks.PreToolUse, 'pre-dispatch.sh')).toBeDefined();
      expect(findEntry(settings.hooks.PostToolUse, 'post-dispatch.sh')).toBeDefined();
    });

    it('is idempotent across repeated provisioning runs', async () => {
      await prepareWorktree(dir);
      const first = await readFile(settingsPath(dir), 'utf-8');

      await prepareWorktree(dir);
      const second = await readFile(settingsPath(dir), 'utf-8');

      expect(second).toBe(first);

      const settings = JSON.parse(second);
      expect(
        (settings.hooks.PreToolUse as unknown[]).filter((e) =>
          findEntry([e], 'pre-dispatch.sh'),
        ).length,
      ).toBe(1);
      expect(
        (settings.hooks.PostToolUse as unknown[]).filter((e) =>
          findEntry([e], 'post-dispatch.sh'),
        ).length,
      ).toBe(1);
    });
  });

  // Task 14: corrupt .claude/settings.local.json is backed up and replaced
  // rather than crashing provisioning; committed .claude/settings.json is
  // never touched.
  describe('settings wiring negatives (Task 14)', () => {
    const settingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.local.json');
    const committedSettingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.json');

    it('backs up corrupt settings.local.json, warns, and writes a fresh valid file', async () => {
      const claudeDir = join(dir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      await writeFile(settingsPath(dir), '{invalid', 'utf-8');

      const logs: string[] = [];
      await prepareWorktree(dir, (msg) => logs.push(msg));

      // Fresh file is valid JSON with the expected hook entries.
      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toBeDefined();

      // Original corrupt file was renamed aside with a .bak-<ts> suffix.
      const entries = await import('node:fs/promises').then((m) => m.readdir(claudeDir));
      const backups = entries.filter((e) => /^settings\.local\.json\.bak-/.test(e));
      expect(backups.length).toBe(1);
      const backupContent = await readFile(join(claudeDir, backups[0]), 'utf-8');
      expect(backupContent).toBe('{invalid');

      // A warning was logged.
      expect(logs.some((l) => /corrupt|invalid|malformed/i.test(l))).toBe(true);
    });

    it('never modifies the committed .claude/settings.json bytes, and settings.local.json is not tracked-modified', async () => {
      await execFileAsync('git', ['init'], { cwd: dir });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      const claudeDir = join(dir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const committedBytes = JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }, null, 2);
      await writeFile(committedSettingsPath(dir), committedBytes, 'utf-8');

      // .claude/settings.local.json is gitignored in real projects; mirror that.
      await writeFile(join(dir, '.gitignore'), '.claude/settings.local.json\n', 'utf-8');

      await execFileAsync('git', ['add', '-A'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });

      await prepareWorktree(dir);

      const afterBytes = await readFile(committedSettingsPath(dir), 'utf-8');
      expect(afterBytes).toBe(committedBytes);

      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
      const trackedModifiedLocalSettings = stdout
        .split('\n')
        .some((line) => / M .*settings\.local\.json/.test(line));
      expect(trackedModifiedLocalSettings).toBe(false);
    });
  });

  // Task 11: Re-provisioning replaces stale hook copies with hardened versions
  // and preserves settings merge invariant.
  describe('re-provisioning stale hooks (Task 11)', () => {
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
      repoRoot = await mkdtemp(join(tmpdir(), 'wt-reprov-repo-'));
      await git(repoRoot, 'init', '-b', 'main');
      await git(repoRoot, 'config', 'user.email', 'test@example.com');
      await git(repoRoot, 'config', 'user.name', 'Test');
      await writeFile(join(repoRoot, 'README.md'), '# scratch\n', 'utf-8');
      await git(repoRoot, 'add', '.');
      await git(repoRoot, 'commit', '-m', 'chore: initial commit');

      worktreeDir = join(tmpdir(), `wt-reprov-wt-${Math.random().toString(36).slice(2)}`);
      await git(repoRoot, 'worktree', 'add', worktreeDir, '-b', 'feature');
    });

    afterEach(async () => {
      await git(repoRoot, 'worktree', 'remove', '--force', worktreeDir).catch(() => undefined);
      await rm(worktreeDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    });

    it('overwrites stale pre-dispatch.sh with hardened version containing abstain prefix', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale pre-dispatch without abstain hardening
      const stalePreDispatch = '#!/bin/bash\necho "old version"\nexit 0\n';
      await writeFile(join(hooksDir, 'pre-dispatch.sh'), stalePreDispatch, 'utf-8');

      await prepareWorktree(worktreeDir);

      const content = await readFile(join(hooksDir, 'pre-dispatch.sh'), 'utf-8');
      expect(content).not.toBe(stalePreDispatch);
      expect(content).toBe(PRE_DISPATCH_HOOK);
      // Assert hardened marker is present: abstain diagnostic prefix
      expect(content).toContain('pre-dispatch-hook: abstain');
    });

    it('overwrites stale prepare-commit-msg without fallback scan, preserving stamp-first path', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'git-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale prepare-commit-msg with fallback in_progress scan
      const stalePrepareCommitMsg = [
        '#!/bin/bash',
        'set -e',
        '# Old version with fallback scan',
        'if [[ -f "$TASK_STATUS_FILE" ]]; then',
        '  node -e \'',
        '    const inProgressRows = data.tasks.filter(t => t.status === "in_progress");',
        '  \'',
        'fi',
        'exit 0'
      ].join('\n');
      await writeFile(join(hooksDir, 'prepare-commit-msg'), stalePrepareCommitMsg, 'utf-8');

      await prepareWorktree(worktreeDir);

      const content = await readFile(join(hooksDir, 'prepare-commit-msg'), 'utf-8');
      expect(content).not.toBe(stalePrepareCommitMsg);
      expect(content).toBe(PREPARE_COMMIT_MSG_HOOK);
      // Assert hardened version: NO in_progress fallback scan
      expect(content).not.toContain('in_progress');
    });

    it('overwrites stale commit-msg using real id extraction instead of Object.keys', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'git-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale commit-msg using Object.keys over tasks
      const staleCommitMsg = [
        '#!/bin/bash',
        'set -e',
        'ID_EXISTS=$(node -e \'',
        '  const data = JSON.parse(fs.readFileSync("$TASK_STATUS_FILE", "utf-8"));',
        '  const ids = Object.keys(data.tasks || {});',
        '  console.log(ids.includes("$TASK_TRAILER") ? "yes" : "no");',
        '\' 2>/dev/null || echo "no")',
        'exit 0'
      ].join('\n');
      await writeFile(join(hooksDir, 'commit-msg'), staleCommitMsg, 'utf-8');

      await prepareWorktree(worktreeDir);

      const content = await readFile(join(hooksDir, 'commit-msg'), 'utf-8');
      expect(content).not.toBe(staleCommitMsg);
      expect(content).toBe(COMMIT_MSG_HOOK);
      // Assert hardened version: real id extraction via .map() not Object.keys
      expect(content).toContain('.map(t => String(t && t.id))');
      expect(content).not.toContain('Object.keys');
    });

    it('preserves exactly one entry per hook in settings after re-provisioning (no duplicates)', async () => {
      const settingsPath = join(worktreeDir, '.claude', 'settings.local.json');

      // Provision once
      await prepareWorktree(worktreeDir);
      const first = await readFile(settingsPath, 'utf-8');
      const firstSettings = JSON.parse(first);

      // Count pre-dispatch entries
      const preDispatchCount1 = (firstSettings.hooks.PreToolUse as Record<string, unknown>[]).filter(
        (e) => {
          const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
          return hooks?.some((h) => typeof h.command === 'string' && h.command.includes('pre-dispatch.sh'));
        }
      ).length;

      // Provision again (re-provision stale hooks)
      await prepareWorktree(worktreeDir);
      const second = await readFile(settingsPath, 'utf-8');
      const secondSettings = JSON.parse(second);

      // Count should still be exactly 1, not duplicated
      const preDispatchCount2 = (secondSettings.hooks.PreToolUse as Record<string, unknown>[]).filter(
        (e) => {
          const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
          return hooks?.some((h) => typeof h.command === 'string' && h.command.includes('pre-dispatch.sh'));
        }
      ).length;

      expect(preDispatchCount1).toBe(1);
      expect(preDispatchCount2).toBe(1);
      // Settings should be unchanged (idempotent)
      expect(second).toBe(first);
    });

    it('preserves unrelated user entries in .claude/settings.local.json across re-provisioning', async () => {
      const claudeDir = join(worktreeDir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const settingsPath = join(claudeDir, 'settings.local.json');

      const userSettings = {
        permissions: { allow: ['Bash(ls:*)', 'Bash(grep:*)'] },
        customKey: 'should-survive',
        nested: { data: 'preserve-me' }
      };
      await writeFile(settingsPath, JSON.stringify(userSettings), 'utf-8');

      // Provision (adds hook entries)
      await prepareWorktree(worktreeDir);

      const content = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      // User-provided keys survive
      expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)', 'Bash(grep:*)'] });
      expect(settings.customKey).toBe('should-survive');
      expect(settings.nested).toEqual({ data: 'preserve-me' });

      // Re-provision: user keys still survive
      await prepareWorktree(worktreeDir);
      const content2 = await readFile(settingsPath, 'utf-8');
      const settings2 = JSON.parse(content2);

      expect(settings2.permissions).toEqual({ allow: ['Bash(ls:*)', 'Bash(grep:*)'] });
      expect(settings2.customKey).toBe('should-survive');
      expect(settings2.nested).toEqual({ data: 'preserve-me' });
    });

    it('stays fail-open when session hook asset write fails: logs skip, provisioning succeeds', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write old stale hooks that should be replaced
      await writeFile(join(hooksDir, 'pre-dispatch.sh'), 'stale', 'utf-8');

      // Make directory read-only to force write failure
      await chmod(hooksDir, 0o500);

      const lines: string[] = [];
      await expect(prepareWorktree(worktreeDir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(hooksDir, 0o700).catch(() => undefined);

      // Should have logged the skip, not thrown
      expect(lines.some((l) => /session hooks/i.test(l) && /skip/i.test(l))).toBe(true);
      // Provisioning should still succeed
      const env = await readFile(join(worktreeDir, '.env'), 'utf-8');
      expect(env).toContain(NAMESPACE_VAR);
    });

    it('overwrites both git hooks with hardened versions on re-provisioning', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'git-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale versions of both git hooks
      const stalePrepareCommitMsg = '#!/bin/bash\necho "stale prepare-commit-msg"\nexit 0\n';
      const staleCommitMsg = '#!/bin/bash\necho "stale commit-msg"\nexit 0\n';
      await writeFile(join(hooksDir, 'prepare-commit-msg'), stalePrepareCommitMsg, 'utf-8');
      await writeFile(join(hooksDir, 'commit-msg'), staleCommitMsg, 'utf-8');

      // Provision
      await prepareWorktree(worktreeDir);

      // Both hooks are overwritten
      const prepareContent = await readFile(join(hooksDir, 'prepare-commit-msg'), 'utf-8');
      const commitContent = await readFile(join(hooksDir, 'commit-msg'), 'utf-8');

      expect(prepareContent).not.toBe(stalePrepareCommitMsg);
      expect(commitContent).not.toBe(staleCommitMsg);
      expect(prepareContent).toBe(PREPARE_COMMIT_MSG_HOOK);
      expect(commitContent).toBe(COMMIT_MSG_HOOK);
    });
  });

  // Task 14 (#505 Surface B): the mutation-gate hook asset is wired at
  // worktree provisioning alongside the pre/post-dispatch hooks.
  describe('mutation-gate hook wiring (Task 14)', () => {
    const settingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.local.json');

    function findEntry(
      arr: unknown[] | undefined,
      matcher: string,
      substr: string,
    ): Record<string, unknown> | undefined {
      return (arr as Record<string, unknown>[] | undefined)?.find((e) => {
        const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
        return (
          (e as { matcher?: string }).matcher === matcher &&
          hooks?.some((h) => typeof h.command === 'string' && h.command.includes(substr))
        );
      });
    }

    it('writes mutation-gate.sh executable with the exported asset content', async () => {
      await prepareWorktree(dir);

      const mutationGatePath = join(dir, '.pipeline', 'session-hooks', 'mutation-gate.sh');
      const content = await readFile(mutationGatePath, 'utf-8');
      expect(content).toBe(MUTATION_GATE_HOOK);
      const s = await stat(mutationGatePath);
      expect(s.mode & 0o777).toBe(0o755);
    });

    it('overwrites a stale pre-existing mutation-gate.sh file', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await writeFile(join(hooksDir, 'mutation-gate.sh'), 'stale content', 'utf-8');

      await prepareWorktree(dir);

      const content = await readFile(join(hooksDir, 'mutation-gate.sh'), 'utf-8');
      expect(content).toBe(MUTATION_GATE_HOOK);
    });

    it('adds an Edit|Write|NotebookEdit PreToolUse matcher entry pointing at mutation-gate.sh', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      const entry = findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'mutation-gate.sh');
      expect(entry).toBeDefined();
      const cmd = (entry?.hooks as Array<{ command: string }>)[0].command;
      // Surface flag: write-matcher invocations fail closed without payload.
      expect(cmd).toBe(`${join(dir, '.pipeline', 'session-hooks', 'mutation-gate.sh')} write`);
    });

    it('adds a Bash PreToolUse matcher entry pointing at mutation-gate.sh', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      const entry = findEntry(settings.hooks.PreToolUse, 'Bash', 'mutation-gate.sh');
      expect(entry).toBeDefined();
      const cmd = (entry?.hooks as Array<{ command: string }>)[0].command;
      // Surface flag: bash-matcher invocations keep payload-dependent logic.
      expect(cmd).toBe(`${join(dir, '.pipeline', 'session-hooks', 'mutation-gate.sh')} bash`);
    });

    it('preserves the pre-existing Task|Agent dispatch matcher entries alongside the new mutation-gate entries', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      expect(findEntry(settings.hooks.PreToolUse, 'Task|Agent', 'pre-dispatch.sh')).toBeDefined();
      expect(findEntry(settings.hooks.PostToolUse, 'Task|Agent', 'post-dispatch.sh')).toBeDefined();
      expect(findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'mutation-gate.sh')).toBeDefined();
      expect(findEntry(settings.hooks.PreToolUse, 'Bash', 'mutation-gate.sh')).toBeDefined();
    });

    it('preserves unrelated pre-existing consumer hook entries when wiring the mutation gate', async () => {
      const claudeDir = join(dir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const consumerEntry = {
        matcher: 'SomeOtherTool',
        hooks: [{ type: 'command', command: '/consumer/own-hook.sh' }],
      };
      const preExisting = {
        permissions: { allow: ['Bash(ls:*)'] },
        hooks: { PreToolUse: [consumerEntry] },
      };
      await writeFile(settingsPath(dir), JSON.stringify(preExisting), 'utf-8');

      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)'] });
      expect(findEntry(settings.hooks.PreToolUse, 'SomeOtherTool', 'own-hook.sh')).toBeDefined();
      expect(findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'mutation-gate.sh')).toBeDefined();
      expect(findEntry(settings.hooks.PreToolUse, 'Bash', 'mutation-gate.sh')).toBeDefined();
    });

    it('is idempotent across repeated provisioning runs: no duplicate mutation-gate entries', async () => {
      await prepareWorktree(dir);
      const first = await readFile(settingsPath(dir), 'utf-8');

      await prepareWorktree(dir);
      const second = await readFile(settingsPath(dir), 'utf-8');

      expect(second).toBe(first);

      const settings = JSON.parse(second);
      const preToolUse = settings.hooks.PreToolUse as Record<string, unknown>[];
      const editMutationMatches = preToolUse.filter(
        (e) =>
          (e as { matcher?: string }).matcher === 'Edit|Write|NotebookEdit' &&
          (e as { hooks?: Array<{ command?: string }> }).hooks?.some((h) =>
            typeof h.command === 'string' && h.command.includes('mutation-gate.sh'),
          ),
      );
      const bashMatches = preToolUse.filter((e) => (e as { matcher?: string }).matcher === 'Bash');
      expect(editMutationMatches).toHaveLength(1);
      expect(bashMatches).toHaveLength(1);
    });

    it('is fail-open when the mutation-gate hook-file write fails: logs a skip, provisioning still succeeds', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await chmod(hooksDir, 0o500);

      const lines: string[] = [];
      await expect(prepareWorktree(dir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(hooksDir, 0o700).catch(() => undefined);

      expect(lines.some((l) => /session hooks/i.test(l) && /skip/i.test(l))).toBe(true);
    });
  });

  // Task 9 (#788): the docs-guard hook asset is wired at worktree provisioning
  // as its own, independent PreToolUse entry — not chained onto mutation-gate.
  describe('docs-guard hook wiring (Task 9)', () => {
    const settingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.local.json');

    function findEntry(
      arr: unknown[] | undefined,
      matcher: string,
      substr: string,
    ): Record<string, unknown> | undefined {
      return (arr as Record<string, unknown>[] | undefined)?.find((e) => {
        const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
        return (
          (e as { matcher?: string }).matcher === matcher &&
          hooks?.some((h) => typeof h.command === 'string' && h.command.includes(substr))
        );
      });
    }

    it('writes docs-guard.sh executable with the exported asset content', async () => {
      await prepareWorktree(dir);

      const docsGuardPath = join(dir, '.pipeline', 'session-hooks', 'docs-guard.sh');
      const content = await readFile(docsGuardPath, 'utf-8');
      expect(content).toBe(DOCS_GUARD_HOOK);
      const s = await stat(docsGuardPath);
      expect(s.mode & 0o777).toBe(0o755);
    });

    it('adds an Edit|Write|NotebookEdit PreToolUse entry pointing at docs-guard.sh, distinct from mutation-gate', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      const docsGuardEntry = findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'docs-guard.sh');
      expect(docsGuardEntry).toBeDefined();
      const cmd = (docsGuardEntry?.hooks as Array<{ command: string }>)[0].command;
      expect(cmd).toBe(join(dir, '.pipeline', 'session-hooks', 'docs-guard.sh'));

      // Own entry — separate from mutation-gate's entry under the same matcher.
      const mutationGateEntry = findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'mutation-gate.sh');
      expect(mutationGateEntry).toBeDefined();
      expect(mutationGateEntry).not.toBe(docsGuardEntry);
    });

    it('is idempotent across repeated provisioning runs: no duplicate docs-guard entries', async () => {
      await prepareWorktree(dir);
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);
      const preToolUse = settings.hooks.PreToolUse as Record<string, unknown>[];
      const docsGuardMatches = preToolUse.filter(
        (e) =>
          (e as { matcher?: string }).matcher === 'Edit|Write|NotebookEdit' &&
          (e as { hooks?: Array<{ command?: string }> }).hooks?.some((h) =>
            typeof h.command === 'string' && h.command.includes('docs-guard.sh'),
          ),
      );
      expect(docsGuardMatches).toHaveLength(1);
    });

    it('is fail-open when the docs-guard hook-file write fails: logs a skip, provisioning still succeeds', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await chmod(hooksDir, 0o500);

      const lines: string[] = [];
      await expect(prepareWorktree(dir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(hooksDir, 0o700).catch(() => undefined);

      expect(lines.some((l) => /session hooks/i.test(l) && /skip/i.test(l))).toBe(true);
    });

    it('wires the docs-guard entry independently of mutation-gate presence', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);
      // Manually strip the mutation-gate entry to simulate its absence, then
      // re-run provisioning: docs-guard wiring must not depend on it.
      settings.hooks.PreToolUse = (settings.hooks.PreToolUse as Record<string, unknown>[]).filter(
        (e) =>
          !(e as { hooks?: Array<{ command?: string }> }).hooks?.some((h) =>
            typeof h.command === 'string' && h.command.includes('mutation-gate.sh'),
          ),
      );
      await writeFile(settingsPath(dir), JSON.stringify(settings, null, 2), 'utf-8');

      await prepareWorktree(dir);

      const raw2 = await readFile(settingsPath(dir), 'utf-8');
      const settings2 = JSON.parse(raw2);
      expect(findEntry(settings2.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'docs-guard.sh')).toBeDefined();
    });
  });
});
