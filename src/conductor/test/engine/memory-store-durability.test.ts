/**
 * Unit tests for durability: worktree removal does NOT destroy the canonical
 * store (A15 — C8 / FR-5 negative path: "worktree removal deletes no shared
 * memory").
 *
 * The canonical store lives at `~/.ai-conductor/memory/<key>/harness/`.
 * A `.memory` symlink removal (or a full `rm -rf` of the worktree directory)
 * only removes the in-tree path — the canonical store is untouched.
 *
 * These focused unit tests verify that `ensureMemoryStore` and
 * `recordMemoryEntry` never operate on the symlink's existence and always
 * target the canonical store path directly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, lstat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import {
  projectKey,
  ensureMemoryStore,
  recordMemoryEntry,
} from '../../src/engine/memory-store.js';

const execFile = promisify(execFileCb);

let workDir: string;
let fakeHome: string;
const savedHome = { value: process.env.HOME };

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

async function makeRepo(name: string, originUrl: string): Promise<string> {
  const repoPath = join(workDir, name);
  await mkdir(repoPath, { recursive: true });
  await git(['init', '-q', '-b', 'main'], repoPath);
  await git(['config', 'user.email', 'test@test.com'], repoPath);
  await git(['config', 'user.name', 'Test'], repoPath);
  await git(['remote', 'add', 'origin', originUrl], repoPath);
  await writeFile(join(repoPath, 'README.md'), `# ${name}\n`);
  await git(['add', 'README.md'], repoPath);
  await git(['commit', '-q', '-m', 'init'], repoPath);
  return repoPath;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mem-durability-'));
  fakeHome = join(workDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome.value = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(async () => {
  process.env.HOME = savedHome.value;
  await rm(workDir, { recursive: true, force: true });
});

describe('A15: worktree removal preserves canonical store', () => {
  it('unlinking the .memory symlink leaves the canonical store files intact', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await recordMemoryEntry(repo, {
      category: 'decisions',
      name: 'durability-proof',
      body: '# durability proof\n',
      indexLine: '- [durability proof](decisions/durability-proof.md)',
    });

    // Simulate worktree removal: only remove the symlink (not -r on its target).
    await rm(join(repo, '.memory'), { force: true });

    // The canonical store must still exist and contain the entry.
    const key = await projectKey(repo);
    const canonicalEntry = join(
      fakeHome, '.ai-conductor', 'memory', key, 'harness',
      'decisions', 'durability-proof.md',
    );
    const stat = await lstat(canonicalEntry);
    expect(stat.isFile()).toBe(true);

    const body = await readFile(canonicalEntry, 'utf8');
    expect(body).toContain('durability proof');
  });

  it('recordMemoryEntry writes through the canonical store, not via the symlink', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);

    // Remove the symlink BEFORE recording — if recordMemoryEntry goes via the
    // symlink this will throw; if it targets the store directly it must succeed.
    await rm(join(repo, '.memory'), { force: true });

    await expect(
      recordMemoryEntry(repo, {
        category: 'decisions',
        name: 'store-direct',
        body: '# direct write\n',
        indexLine: '- [direct write](decisions/store-direct.md)',
      }),
    ).resolves.toBeUndefined();

    // Verify in the canonical store.
    const key = await projectKey(repo);
    const body = await readFile(
      join(fakeHome, '.ai-conductor', 'memory', key, 'harness', 'decisions', 'store-direct.md'),
      'utf8',
    );
    expect(body).toContain('direct write');
  });
});
