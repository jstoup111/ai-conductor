import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { prepareWorktree } from '../../src/engine/worktree-prepare.js';

// Integration spec (Task 15): exercises the FULL prepareWorktree chain —
// asset -> fixtures -> PRE/POST hooks -> script writing -> settings wiring —
// end to end on a real tmp git repo, and asserts the worktree it produces is
// self-contained: every wired command path is executable, and none of it
// leaks CLAUDE_CONFIG_DIR, a home-directory path, or any path outside the
// worktree. That independence matters because the worktree must stay
// portable if moved or shared — nothing in it may assume a fixed machine
// location.

const execFileAsync = promisify(execFile);

describe('integration/session-hooks-provisioning (Task 15)', () => {
  let repoRoot: string;

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
    repoRoot = await mkdtemp(join(tmpdir(), 'session-hooks-prov-'));
    await git(repoRoot, 'init', '-b', 'main');
    await git(repoRoot, 'config', 'user.email', 'test@example.com');
    await git(repoRoot, 'config', 'user.name', 'Test');
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('provisions an end-to-end, config-dir-independent worktree', async () => {
    await prepareWorktree(repoRoot);

    // 1. Session-hook scripts exist and are executable.
    const preDispatchPath = join(repoRoot, '.pipeline', 'session-hooks', 'pre-dispatch.sh');
    const preStat = await stat(preDispatchPath);
    expect(preStat.mode & 0o111).not.toBe(0);

    // 2. Wiring resolves: every command path referenced in
    // .claude/settings.local.json points at an executable file.
    const settingsPath = join(repoRoot, '.claude', 'settings.local.json');
    const raw = await readFile(settingsPath, 'utf-8');
    const settings = JSON.parse(raw) as {
      hooks?: { PreToolUse?: unknown[]; PostToolUse?: unknown[] };
    };

    const commandPaths: string[] = [];
    for (const key of ['PreToolUse', 'PostToolUse'] as const) {
      const entries = (settings.hooks?.[key] ?? []) as Array<{
        hooks?: Array<{ command?: string }>;
      }>;
      for (const entry of entries) {
        for (const h of entry.hooks ?? []) {
          if (typeof h.command === 'string') commandPaths.push(h.command);
        }
      }
    }

    expect(commandPaths.length).toBeGreaterThan(0);
    for (const cmdPath of commandPaths) {
      // A command may carry argv after the script path (e.g. the mutation
      // gate's surface flag: "…/mutation-gate.sh write") — stat the script.
      const scriptPath = cmdPath.split(' ')[0];
      const s = await stat(scriptPath);
      expect(s.mode & 0o111).not.toBe(0);
    }

    // 3. Config-dir independence: no CLAUDE_CONFIG_DIR, home-dir reference,
    // or absolute path outside the worktree anywhere in the wiring.
    expect(raw).not.toContain('CLAUDE_CONFIG_DIR');
    expect(raw).not.toContain('$HOME');
    expect(raw).not.toMatch(/(?<![A-Za-z0-9_./-])~(?=[/"\s]|$)/);
    // Absolute paths must all live inside the worktree. A bare `/home/` match
    // is the wrong test for that: it is neither necessary nor sufficient. The
    // repo under test is created inside TMPDIR, so on a machine whose TMPDIR
    // is home-rooted every legitimate in-worktree path contains `/home/` and
    // this failed spuriously; conversely a leaked `/etc` or `/opt` path is a
    // real portability break that `/home/` never catches. Assert the actual
    // invariant instead — the same one `commandPaths` is checked against.
    for (const absolutePath of raw.match(/\/[A-Za-z0-9_.\-/]+/g) ?? []) {
      if (absolutePath.startsWith(repoRoot)) continue;
      expect(absolutePath).not.toMatch(/^\/(home|root|etc|opt|usr\/local)\//);
    }

    for (const cmdPath of commandPaths) {
      expect(cmdPath.startsWith(repoRoot)).toBe(true);
    }
  });
});
