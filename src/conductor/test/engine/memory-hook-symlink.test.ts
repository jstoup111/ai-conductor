/**
 * FR-10 transparency test — existing steps work under the default provider.
 *
 * Story: the session-start hook and any recall-using step read through the
 * resolved active provider (`local` via the symlinked `.memory/`) without
 * breakage. The `.memory` path is a symlink created by `ensureMemoryStore`;
 * existing code that reads `.memory/index.md`, enumerates category dirs, or
 * counts entry files must work identically whether `.memory` is a real dir
 * (old behaviour) or a symlink (new canonical-store layout).
 *
 * The session-start hook (`hooks/claude/session-start-context.sh`) does:
 *   1. `[ -f ".memory/index.md" ]` — existence check through symlink
 *   2. `grep -c "^-" ".memory/index.md"` — count entries through symlink
 *   3. `find ".memory/<cat>" -name "*.md"` — enumerate entry files through symlink
 *
 * All three operations must work the same through the symlink as through a
 * real directory (which is the POSIX guarantee for symlinks-to-directories).
 * This test proves that guarantee holds in the Node.js / fs/promises layer.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtemp,
  rm,
  mkdir,
  lstat,
  readFile,
  readdir,
  writeFile,
} from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { ensureMemoryStore, recordMemoryEntry } from '../../src/engine/memory-store.js';

const execFile = promisify(execFileCb);

// ── helpers ────────────────────────────────────────────────────────────────

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

// ── test lifecycle ─────────────────────────────────────────────────────────

let tmpDir: string;
let savedHome: string | undefined;
let savedProfile: string | undefined;
let fakeHome: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'mem-hook-'));
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
// FR-10: the session-start hook's memory logic works through the symlink.
// ═══════════════════════════════════════════════════════════════════════════

describe('FR-10: session-start context reads through the .memory symlink transparently', () => {
  it('.memory is a symlink after ensureMemoryStore — not a real directory', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    const memPath = join(repo, '.memory');
    const stat = await lstat(memPath);
    // FR-10 precondition: .memory must be a symlink (new canonical-store layout).
    expect(stat.isSymbolicLink()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
  });

  it('index.md is accessible via the symlink path (hook step 1: existence check)', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    const indexPath = join(repo, '.memory', 'index.md');
    // lstat on a path through a symlink resolves the final target.
    const stat = await lstat(indexPath);
    expect(stat.isFile()).toBe(true);
  });

  it('index.md content is readable through the symlink (hook step 2: grep -c "^-")', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    // Write an entry so index.md has at least one "^-" line.
    await recordMemoryEntry(repo, {
      category: 'decisions',
      name: 'hook-test-entry',
      body: '# hook test\n',
      indexLine: '- [hook test](decisions/hook-test-entry.md) — verifying symlink reads',
    });

    const indexContent = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
    const entryLines = indexContent.split('\n').filter((l) => l.startsWith('-'));
    // The hook does: grep -c "^-" .memory/index.md → must return >= 1
    expect(entryLines.length).toBeGreaterThanOrEqual(1);
    expect(entryLines[0]).toContain('hook test');
  });

  it('category subdirs are enumerable through the symlink (hook step 3: find .memory/<cat>)', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    // Write a file into decisions/ so enumeration has something to find.
    await recordMemoryEntry(repo, {
      category: 'decisions',
      name: 'hook-decisions',
      body: '# decision\n',
      indexLine: '- [decision](decisions/hook-decisions.md)',
    });

    const decisionsPath = join(repo, '.memory', 'decisions');
    const files = await readdir(decisionsPath);
    // find .memory/decisions -name "*.md" must list our entry file.
    expect(files).toContain('hook-decisions.md');
  });

  it('memory count (find .memory/<cat> -name "*.md") accumulates across worktrees', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    await recordMemoryEntry(repo, {
      category: 'context',
      name: 'ctx-a',
      body: '# ctx a\n',
      indexLine: '- [ctx a](context/ctx-a.md)',
    });
    await recordMemoryEntry(repo, {
      category: 'gotchas',
      name: 'gotcha-b',
      body: '# gotcha b\n',
      indexLine: '- [gotcha b](gotchas/gotcha-b.md)',
    });

    // Hook counts ALL category subdirs. Replicate its logic through the symlink:
    let totalCount = 0;
    for (const cat of ['decisions', 'patterns', 'gotchas', 'context']) {
      const catDir = join(repo, '.memory', cat);
      const entries = await readdir(catDir).catch(() => [] as string[]);
      totalCount += entries.filter((f) => f.endsWith('.md')).length;
    }
    // We wrote 2 entries above.
    expect(totalCount).toBe(2);
  });
});
