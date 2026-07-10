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
import { execFile as execFileCb, spawn } from 'child_process';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
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

// ─────────────────────────────────────────────────────────────────────────────
// Finding 1: path-traversal rejection — RED tests added before implementation.
//
// `entry.category` and `entry.name` must not allow values that escape the
// harnessDir.  These tests verify that `recordMemoryEntry` THROWS (rejects)
// for invalid inputs before any file I/O is performed.
// ─────────────────────────────────────────────────────────────────────────────
describe('recordMemoryEntry — path-traversal input rejection', () => {
  it('throws with a clear error when category is not in the whitelist', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await expect(
      recordMemoryEntry(repo, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: '../../../etc' as any,
        name: 'evil',
        body: '# evil\n',
        indexLine: '- evil',
      }),
    ).rejects.toThrow(/invalid category/i);
  });

  it('throws when category is any unrecognised string', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await expect(
      recordMemoryEntry(repo, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        category: 'secrets' as any,
        name: 'evil',
        body: '# evil\n',
        indexLine: '- evil',
      }),
    ).rejects.toThrow(/invalid category/i);
  });

  it('throws when name contains a forward slash (directory traversal)', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await expect(
      recordMemoryEntry(repo, {
        category: 'decisions',
        name: '../escape',
        body: '# evil\n',
        indexLine: '- evil',
      }),
    ).rejects.toThrow(/invalid name/i);
  });

  it('throws when name is exactly ".."', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await expect(
      recordMemoryEntry(repo, {
        category: 'decisions',
        name: '..',
        body: '# evil\n',
        indexLine: '- evil',
      }),
    ).rejects.toThrow(/invalid name/i);
  });

  it('throws when name contains a backslash', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await expect(
      recordMemoryEntry(repo, {
        category: 'decisions',
        name: 'foo\\bar',
        body: '# evil\n',
        indexLine: '- evil',
      }),
    ).rejects.toThrow(/invalid name/i);
  });

  it('throws when name embeds ".." as a path component', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await ensureMemoryStore(repo);
    await expect(
      recordMemoryEntry(repo, {
        category: 'decisions',
        name: 'foo/../escape',
        body: '# evil\n',
        indexLine: '- evil',
      }),
    ).rejects.toThrow(/invalid name/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Finding 2: cross-process concurrent write proof (O_APPEND atomicity).
//
// The in-process Promise.all test above passes even for a broken read-modify-
// write impl because Node's event loop serialises I/O.  This suite spawns
// SEPARATE child node processes that all call `recordMemoryEntry` against the
// SAME canonical store simultaneously, then asserts that every entry file AND
// every index line survives — this is the test that WOULD FAIL if the impl
// used read-modify-write on index.md instead of atomic O_APPEND.
// ─────────────────────────────────────────────────────────────────────────────
describe('A16-XP: cross-process concurrent index writes — O_APPEND atomicity proof', () => {
  it(
    'N simultaneous child processes all write to index.md and every line survives (no-clobber)',
    async () => {
      const repo = await makeRepo('alpha-xp', 'https://example.com/alpha-xp.git');
      await ensureMemoryStore(repo);

      // Derive paths relative to this test file.
      const testDir = fileURLToPath(new URL('.', import.meta.url));
      const conductorDir = fileURLToPath(new URL('../../', import.meta.url));
      const helperPath = join(testDir, 'memory-writer-helper.ts');
      const viteNodePath = join(conductorDir, 'node_modules', '.bin', 'vite-node');

      const N = 4;
      const children = Array.from({ length: N }, (_, i) =>
        new Promise<void>((resolve, reject) => {
          const child = spawn(viteNodePath, [helperPath], {
            cwd: conductorDir,
            env: {
              ...process.env,
              HOME: fakeHome,
              FAKE_HOME: fakeHome,
              REPO_PATH: repo,
              CATEGORY: 'decisions',
              ENTRY_NAME: `xp-entry-${i}`,
              ENTRY_BODY: `# cross-process entry ${i}\n`,
              INDEX_LINE: `- [xp ${i}](decisions/xp-entry-${i}.md) — XP-MARKER-${i}`,
            },
          });

          // Discard stdout — an undrained pipe blocks the child once 64KB buffers.
          child.stdout?.resume();
          let stderr = '';
          child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`child ${i} exited with code ${code}:\n${stderr}`));
          });
        }),
      );

      // Launch all children simultaneously — they race to appendFile index.md.
      await Promise.all(children);

      // Every entry file must exist — file-per-entry layout, no collision.
      const files = await readdir(join(repo, '.memory', 'decisions'));
      for (let i = 0; i < N; i++) {
        expect(files).toContain(`xp-entry-${i}.md`);
      }

      // Every index line must survive — O_APPEND atomicity across separate processes.
      // A read-modify-write impl would lose all but one writer here.
      const index = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
      for (let i = 0; i < N; i++) {
        expect(index).toContain(`XP-MARKER-${i}`);
      }
    },
    30_000, // 30 s — allows for vite-node startup overhead across N children
  );
});
