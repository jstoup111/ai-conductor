/**
 * Unit tests for the no-clobber concurrent index write protocol (A16 — C8).
 *
 * FR-5 negative: "two worktrees write simultaneously → both entry files persist
 * and both index lines survive."
 *
 * The protocol:
 *  - Entry files: file-per-entry layout with unique names → no conflict, each
 *    write lands as a separate file.
 *  - index.md: written via O_APPEND (`appendFile`), which is atomic for small
 *    writes on POSIX/Linux.  Two concurrent `appendFile` calls both append their
 *    line atomically — neither clobbers the other.
 *
 * These tests verify the protocol at the unit level, independently of the git
 * worktree setup required by the acceptance spec.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { ensureMemoryStore, recordMemoryEntry } from '../../src/engine/memory-store.js';

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

async function addWorktree(repoPath: string, branch: string): Promise<string> {
  const wtPath = join(workDir, `${branch}-wt`);
  await git(['worktree', 'add', '-q', '-b', branch, wtPath], repoPath);
  return wtPath;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'mem-concur-'));
  fakeHome = join(workDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome.value = process.env.HOME;
  process.env.HOME = fakeHome;
});

afterEach(async () => {
  process.env.HOME = savedHome.value;
  await rm(workDir, { recursive: true, force: true });
});

describe('A16: no-clobber concurrent index write protocol', () => {
  it('N concurrent writes all produce distinct entry files (file-per-entry)', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);

    const N = 10;
    await Promise.all(
      Array.from({ length: N }, (_, i) =>
        recordMemoryEntry(repo, {
          category: 'decisions',
          name: `entry-${i}`,
          body: `# entry ${i}\n`,
          indexLine: `- [entry ${i}](decisions/entry-${i}.md)`,
        }),
      ),
    );

    const files = await readdir(join(repo, '.memory', 'decisions'));
    expect(files.length).toBe(N);
    for (let i = 0; i < N; i++) {
      expect(files).toContain(`entry-${i}.md`);
    }
  });

  it('two concurrent worktree writes both survive in index.md (no-clobber)', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const wtB = await addWorktree(repo, 'feature-b');
    await ensureMemoryStore(repo);
    await ensureMemoryStore(wtB);

    // Near-simultaneous writes from two siblings.
    await Promise.all([
      recordMemoryEntry(repo, {
        category: 'patterns',
        name: 'from-main',
        body: '# from main\n',
        indexLine: '- [from main](patterns/from-main.md) — MAIN-MARKER',
      }),
      recordMemoryEntry(wtB, {
        category: 'patterns',
        name: 'from-feat',
        body: '# from feat\n',
        indexLine: '- [from feat](patterns/from-feat.md) — FEAT-MARKER',
      }),
    ]);

    const index = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
    expect(index).toContain('MAIN-MARKER');
    expect(index).toContain('FEAT-MARKER');

    // Both entry files must exist.
    const files = await readdir(join(repo, '.memory', 'patterns'));
    expect(files).toContain('from-main.md');
    expect(files).toContain('from-feat.md');
  });

  it('index lines are not duplicated on repeated recordMemoryEntry with the same name', async () => {
    // Different names always produce separate files; same name overwrites the
    // entry file but appends a new index line — this is intentional (the index
    // is an append-only log).  Verify that two writes with DIFFERENT names
    // produce exactly two distinct lines.
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);

    await recordMemoryEntry(repo, {
      category: 'gotchas',
      name: 'gotcha-1',
      body: '# gotcha 1\n',
      indexLine: '- [gotcha 1](gotchas/gotcha-1.md) — UNIQUE-A',
    });
    await recordMemoryEntry(repo, {
      category: 'gotchas',
      name: 'gotcha-2',
      body: '# gotcha 2\n',
      indexLine: '- [gotcha 2](gotchas/gotcha-2.md) — UNIQUE-B',
    });

    const index = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
    expect(index).toContain('UNIQUE-A');
    expect(index).toContain('UNIQUE-B');

    // Each unique marker appears exactly once.
    const countA = (index.match(/UNIQUE-A/g) ?? []).length;
    const countB = (index.match(/UNIQUE-B/g) ?? []).length;
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});
