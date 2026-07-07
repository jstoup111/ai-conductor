import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCb, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Third writers are eliminated — hook removed,
// finish write dropped, retry hint rewritten" (ADR H4/H6,
// .docs/stories/prd-audit-kickback-preserves-task-status.md, plan Tasks
// 15/16/28). This is a REPLACEMENT story (old hook → new engine-invoking
// fast-feedback hook in the SAME PostToolUse slot), so per writing-system-
// tests §3b this drives the REAL production entry point: the hook SCRIPT
// itself, spawned as a real child process against a real git repo — the same
// convention `daemon-auto-restart-stale-engine-real-binary.acceptance.test.ts`
// uses for the real-binary requester sequence — not a unit test of the new
// hook's internals in isolation.
//
// The new hook (`hooks/claude/post-commit-derive-feedback.sh`) does not exist
// yet at RED time; spawning it is expected to ENOENT. Each test that targets
// it asserts on THAT specific failure mode (spawn error / non-zero from a
// shell "not found", never a generic crash) so a RED can't be confused with
// an unrelated bug in the test itself.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..', '..'); // src/conductor/test/acceptance -> repo root
const NEW_HOOK_PATH = join(REPO_ROOT, 'hooks', 'claude', 'post-commit-derive-feedback.sh');
const OLD_HOOK_PATH = join(REPO_ROOT, 'hooks', 'claude', 'post-commit-pipeline-sync.sh');
const BIN_INSTALL_PATH = join(REPO_ROOT, 'bin', 'install');

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError: NodeJS.ErrnoException | null;
}

/** Spawn a hook script the way Claude Code's PostToolUse invokes it: JSON on stdin. */
function runHook(hookPath: string, cwd: string, command: string): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(hookPath, [], { cwd });
    let stdout = '';
    let stderr = '';
    let spawnError: NodeJS.ErrnoException | null = null;
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      spawnError = err as NodeJS.ErrnoException;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr, spawnError }));
    child.stdin?.write(JSON.stringify({ tool_input: { command } }));
    child.stdin?.end();
  });
}

let dir: string;

async function git(...args: string[]): Promise<string> {
  const { stdout } = await execFile(
    'git',
    ['-c', 'user.email=t@test', '-c', 'user.name=t', ...args],
    { cwd: dir },
  );
  return stdout.trim();
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'third-writers-'));
  await git('init', '-q');
  await writeFile(join(dir, 'README.md'), 'init\n');
  await git('add', 'README.md');
  await git('commit', '-q', '-m', 'init');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('acceptance: third writers of task-status.json are eliminated (H4/H6)', () => {
  it('happy: a real commit with NO Task: trailer and no path-fallback match → the fast-feedback hook warns, naming the sha and expected form', async () => {
    await writeFile(join(dir, 'a.txt'), 'change\n');
    await git('add', 'a.txt');
    await git('commit', '-q', '-m', 'chore: unrelated change with no trailer');
    const sha = await git('rev-parse', 'HEAD');

    const result = await runHook(NEW_HOOK_PATH, dir, 'git commit -q -m "chore: unrelated change"');

    // The REAL assertion is on hook BEHAVIOR: it must warn, naming the commit
    // sha and the expected `Task: <id>` form. Today the hook script does not
    // exist at all, so the spawn errors (ENOENT), stdout is empty, and this
    // assertion fails for that reason — not because of a bug in the test's
    // own logic. `result.spawnError` is asserted alongside so a future
    // regression that silently swallows a REAL spawn failure (rather than
    // fixing it) can't accidentally satisfy this spec with empty stdout.
    expect(result.spawnError).toBeNull();
    expect(result.stdout).toContain(sha.slice(0, 7));
    expect(result.stdout).toMatch(/Task: <id>/);
  });

  it('happy: a real commit that DOES evidence a task (real Task: <id> trailer) → the hook is silent', async () => {
    await writeFile(join(dir, 'b.txt'), 'change\n');
    await git('add', 'b.txt');
    await git('commit', '-q', '-m', 'feat: implement task 1\n\nTask: 1');

    const result = await runHook(NEW_HOOK_PATH, dir, 'git commit -q -m "feat: implement task 1"');

    // Same reasoning as the prior spec: the hook not existing means
    // `spawnError` is non-null today, which fails this assertion — the real
    // target behavior is "no spawn error, and no output".
    expect(result.spawnError).toBeNull();
    expect(result.stdout.trim()).toBe('');
  });

  it('negative: engine binary missing / derive throws → the commit and process are unaffected (exit 0, non-fatal, anomaly logged)', async () => {
    await writeFile(join(dir, 'c.txt'), 'change\n');
    await git('add', 'c.txt');
    await git('commit', '-q', '-m', 'chore: trigger hook error path');

    // Simulate "engine binary missing" by pointing AI_CONDUCTOR_ENGINE_BIN (or
    // equivalent) at a nonexistent path — the hook must still exit 0 and never
    // block the commit that already landed.
    const result = await new Promise<SpawnResult>((resolve) => {
      const child = spawn(NEW_HOOK_PATH, [], {
        cwd: dir,
        env: { ...process.env, AI_CONDUCTOR_ENGINE_BIN: '/nonexistent/engine-binary' },
      });
      let stdout = '';
      let stderr = '';
      let spawnError: NodeJS.ErrnoException | null = null;
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        spawnError = err as NodeJS.ErrnoException;
      });
      child.on('close', (code) => resolve({ code, stdout, stderr, spawnError }));
      child.stdin?.write(JSON.stringify({ tool_input: { command: 'git commit -q -m "x"' } }));
      child.stdin?.end();
    });

    // Target behavior: exit 0, non-fatal, regardless of the engine binary
    // being broken. Today the hook script doesn't exist at all, so
    // `spawnError` is non-null (ENOENT) and `code` is null — this fails the
    // exit-0 assertion for that reason.
    expect(result.spawnError).toBeNull();
    expect(result.code).toBe(0);
  });

  it('negative (repo-wide writer audit): only engine code + sanctioned agent scheduling writes remain — today\'s post-commit-pipeline-sync.sh is a real, current violation', async () => {
    const { stdout } = await execFile('grep', [
      '-rl',
      '--include=*.sh',
      '--include=*.ts',
      '--include=*.md',
      'task-status.json',
      join(REPO_ROOT, 'src', 'conductor', 'src'),
      join(REPO_ROOT, 'hooks'),
      join(REPO_ROOT, 'bin'),
    ]).catch((err: { stdout?: string; code?: number }) => {
      // grep exits 1 when no matches — treat that as an empty result, not a failure.
      if (err.code === 1) return { stdout: '' };
      throw err;
    });

    const hits = stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const isSanctioned = (p: string): boolean =>
      p.includes(`${join('src', 'conductor', 'src', 'engine')}${'/'}`) ||
      p.replace(/\\/g, '/').includes('/src/conductor/src/engine/');

    const violators = hits.filter((p) => !isSanctioned(p));

    // Today, hooks/claude/post-commit-pipeline-sync.sh is a REAL, current
    // writer outside src/conductor/src/engine — this assertion is expected to
    // fail right now (violators is non-empty) until Task 15/16 remove it.
    // That is the correct RED: the repo's actual state violates the
    // single-authority claim.
    expect(violators).toEqual([]);
  });

  it('negative: the old hook is gone from hooks/claude/ and from bin/install\'s wiring', async () => {
    // Both assertions are expected to FAIL today (correct RED) — the old hook
    // still exists and bin/install still wires it into PostToolUse.
    expect(existsSync(OLD_HOOK_PATH)).toBe(false);

    const installSrc = await readFile(BIN_INSTALL_PATH, 'utf-8');
    expect(installSrc).not.toContain('post-commit-pipeline-sync.sh');
  });

  it('negative: the new hook is wired into bin/install in the vacated PostToolUse/Bash slot', async () => {
    const installSrc = await readFile(BIN_INSTALL_PATH, 'utf-8');
    // Expected to fail today — the new hook has not been added to bin/install yet.
    expect(installSrc).toContain('post-commit-derive-feedback.sh');
  });
});
