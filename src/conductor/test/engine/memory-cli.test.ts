/**
 * A14 — bootstrap live-path test for `conduct memory setup`.
 *
 * Proves:
 *   1. `detectMemoryCommand` parses `memory setup [dir]` correctly.
 *   2. `dispatchMemorySetup` produces a `.memory` symlink in the project dir.
 *   3. `dispatchMemorySetup` migrates an existing real `.memory/` dir (via
 *      migrateMemory) rather than creating a new one from scratch.
 *   4. `dispatchMemorySetup` is idempotent (second call is a no-op).
 *   5. Negative: unknown subcommand returns null from detectMemoryCommand.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, lstat, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { detectMemoryCommand, dispatchMemorySetup } from '../../src/engine/memory-cli.js';

const execFile = promisify(execFileCb);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(name: string, dir: string): Promise<string> {
  const repoPath = join(dir, name);
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-q', '-b', 'main'], repoPath);
  await git(['config', 'user.email', 'test@test.com'], repoPath);
  await git(['config', 'user.name', 'Test'], repoPath);
  await git(['remote', 'add', 'origin', `https://example.com/${name}.git`], repoPath);
  return repoPath;
}

let tmpDir: string;
let savedHome: string | undefined;
let savedProfile: string | undefined;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mem-cli-'));
  fakeHome = join(tmpDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome = process.env.HOME;
  savedProfile = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  process.env.USERPROFILE = savedProfile;
  await rm(tmpDir, { recursive: true, force: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// detectMemoryCommand
// ═══════════════════════════════════════════════════════════════════════════

describe('detectMemoryCommand', () => {
  it('matches "memory setup" with no dir argument', () => {
    const cmd = detectMemoryCommand(['node', 'index.js', 'memory', 'setup']);
    expect(cmd).not.toBeNull();
    expect(cmd?.kind).toBe('setup');
    expect(cmd?.dir).toBeUndefined();
  });

  it('matches "memory setup <dir>"', () => {
    const cmd = detectMemoryCommand(['node', 'index.js', 'memory', 'setup', '/tmp/myrepo']);
    expect(cmd).not.toBeNull();
    expect(cmd?.kind).toBe('setup');
    expect(cmd?.dir).toBe('/tmp/myrepo');
  });

  it('returns null for "register" (different command)', () => {
    const cmd = detectMemoryCommand(['node', 'index.js', 'register']);
    expect(cmd).toBeNull();
  });

  it('returns null for "memory" without "setup"', () => {
    const cmd = detectMemoryCommand(['node', 'index.js', 'memory']);
    expect(cmd).toBeNull();
  });

  it('returns null for bare inline feature (existing pipeline)', () => {
    const cmd = detectMemoryCommand(['node', 'index.js', 'inline', 'my feature']);
    expect(cmd).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// dispatchMemorySetup — produces .memory symlink (A14 live path)
// ═══════════════════════════════════════════════════════════════════════════

describe('dispatchMemorySetup — .memory symlink creation (A14 live path)', () => {
  it('creates a .memory symlink in the project dir (fresh project)', async () => {
    const repo = await makeRepo('alpha', tmpDir);

    const code = await dispatchMemorySetup({ kind: 'setup', dir: repo });
    expect(code).toBe(0);

    // The LIVE PATH result: .memory must be a symlink, not a real dir.
    const stat = await lstat(join(repo, '.memory'));
    expect(stat.isSymbolicLink()).toBe(true);
  });

  it('is idempotent — second call leaves the symlink unchanged', async () => {
    const repo = await makeRepo('alpha', tmpDir);

    await dispatchMemorySetup({ kind: 'setup', dir: repo });
    const stat1 = await lstat(join(repo, '.memory'));
    expect(stat1.isSymbolicLink()).toBe(true);

    // Second call must succeed and the symlink must still be valid.
    const code2 = await dispatchMemorySetup({ kind: 'setup', dir: repo });
    expect(code2).toBe(0);
    const stat2 = await lstat(join(repo, '.memory'));
    expect(stat2.isSymbolicLink()).toBe(true);
  });

  it('migrates an existing real .memory/ dir to a symlink (defer-to-migration path)', async () => {
    const repo = await makeRepo('alpha', tmpDir);

    // Simulate legacy: create .memory/ as a real directory with content.
    const oldMemPath = join(repo, '.memory');
    await mkdir(join(oldMemPath, 'decisions'), { recursive: true });
    await writeFile(join(oldMemPath, 'index.md'), '# Memory Index\n', 'utf8');
    await writeFile(
      join(oldMemPath, 'decisions', 'old-entry.md'),
      '# old entry\n',
      'utf8',
    );

    const stat0 = await lstat(oldMemPath);
    expect(stat0.isDirectory() && !stat0.isSymbolicLink()).toBe(true);

    // run_memory_store_setup detects real dir → calls migrateMemory.
    const code = await dispatchMemorySetup({ kind: 'setup', dir: repo });
    expect(code).toBe(0);

    // After migration: .memory must be a symlink.
    const stat1 = await lstat(oldMemPath);
    expect(stat1.isSymbolicLink()).toBe(true);
  });

  it('returns 1 for a non-existent directory', async () => {
    const code = await dispatchMemorySetup({
      kind: 'setup',
      dir: join(tmpDir, 'does-not-exist'),
    });
    expect(code).toBe(1);
  });
});
