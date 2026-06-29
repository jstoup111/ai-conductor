import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, lstat, readlink, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1a — Durable Default Memory: the canonical,
// branch-independent shared store and the `.memory/` symlink (ADR-017,
// conditions C4 / C8).
//
// Stories (.docs/stories/pluggable-memory-1a-durable-default-memory.md):
//   FR-5  Memory in worktree A is visible in sibling B; survives A's removal;
//         branch-independent one-set-per-project; concurrent dual-worktree
//         writes both persist; worktree removal deletes no shared memory;
//         cross-project writes isolated.
//   FR-8  Fresh project → `local` active; recall/persist work with no service,
//         no network, no credentials.
//
// These drive the as-yet-unwritten seam `src/conductor/src/engine/memory-store.ts`
// (`projectKey`, `ensureMemoryStore`, `recordMemoryEntry`). The module does not
// exist yet → dynamically imported per-test so the suite is RED for the right
// reason ("not yet implemented"), never a syntax/typo failure.
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const STORE_MOD = '../../src/engine/memory-store.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

let workDir: string;
let fakeHome: string;
const savedHome = { value: process.env.HOME };
const savedProfile = { value: process.env.USERPROFILE };

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd });
  return stdout.trim();
}

/** A real git repo with one commit and an `origin` remote (stable project identity). */
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

/** Add a linked worktree on a new branch — same project, different branch/path. */
async function addWorktree(repoPath: string, branch: string): Promise<string> {
  const wtPath = join(workDir, `${branch}-wt`);
  await git(['worktree', 'add', '-q', '-b', branch, wtPath], repoPath);
  return wtPath;
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memory-store-'));
  fakeHome = join(workDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome.value = process.env.HOME;
  savedProfile.value = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome; // Windows parity; harmless on POSIX
});

afterEach(async () => {
  process.env.HOME = savedHome.value;
  process.env.USERPROFILE = savedProfile.value;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-8: a fresh project gets a working `local` store with zero setup.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-8: fresh project → durable local store with no service/network/creds', () => {
  it('ensureMemoryStore creates the canonical store under ~/.ai-conductor and links .memory to it', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');

    await ensureMemoryStore(repo);

    // `.memory/` is a symlink (not a real in-tree dir) pointing under the canonical store.
    const memPath = join(repo, '.memory');
    const stat = await lstat(memPath);
    expect(stat.isSymbolicLink()).toBe(true);

    const target = await realpath(memPath);
    const canonicalRoot = await realpath(join(fakeHome, '.ai-conductor', 'memory'));
    expect(target.startsWith(canonicalRoot)).toBe(true);
    expect(target).toContain('harness');

    // index.md exists and is readable through the symlink — recall works with no service.
    const index = await readFile(join(memPath, 'index.md'), 'utf8');
    expect(typeof index).toBe('string');
  });

  it('is idempotent — a second ensure does not clobber existing entries', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
    const recordMemoryEntry = requireFn(await load(STORE_MOD), 'recordMemoryEntry');

    await ensureMemoryStore(repo);
    await recordMemoryEntry(repo, {
      category: 'decisions',
      name: 'keep-me',
      body: '# keep me\n',
      indexLine: '- [keep me](decisions/keep-me.md) — survives re-ensure',
    });

    await ensureMemoryStore(repo); // second call must be a no-op for content

    const body = await readFile(join(repo, '.memory', 'decisions', 'keep-me.md'), 'utf8');
    expect(body).toContain('keep me');
    const index = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
    expect(index).toContain('survives re-ensure');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-5: branch-independent project key (C4) — one set of memory per project.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-5 / C4: project key is branch- and worktree-independent', () => {
  it('two worktrees of the same project derive the SAME key', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const wt = await addWorktree(repo, 'feature-x');
    const projectKey = requireFn(await load(STORE_MOD), 'projectKey');

    const keyMain = await projectKey(repo);
    const keyWorktree = await projectKey(wt);

    expect(keyWorktree).toBe(keyMain);
  });

  it('two DIFFERENT projects derive DIFFERENT keys (cross-project isolation)', async () => {
    const alpha = await makeRepo('alpha', 'https://example.com/alpha.git');
    const beta = await makeRepo('beta', 'https://example.com/beta.git');
    const projectKey = requireFn(await load(STORE_MOD), 'projectKey');

    const keyAlpha = await projectKey(alpha);
    const keyBeta = await projectKey(beta);

    expect(keyAlpha).not.toBe(keyBeta);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-5: memory written in one worktree is visible in a sibling; cross-project
// writes stay isolated.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-5: shared store across worktrees, isolated across projects', () => {
  it('an entry written in worktree A is visible from sibling worktree B', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const wtB = await addWorktree(repo, 'feature-b');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
    const recordMemoryEntry = requireFn(await load(STORE_MOD), 'recordMemoryEntry');

    await ensureMemoryStore(repo);
    await ensureMemoryStore(wtB);

    await recordMemoryEntry(repo, {
      category: 'decisions',
      name: 'shared-fact',
      body: '# shared fact\n',
      indexLine: '- [shared fact](decisions/shared-fact.md) — from A',
    });

    // Sibling B reads the same entry through its own `.memory/` symlink.
    const bBody = await readFile(join(wtB, '.memory', 'decisions', 'shared-fact.md'), 'utf8');
    expect(bBody).toContain('shared fact');
    const bIndex = await readFile(join(wtB, '.memory', 'index.md'), 'utf8');
    expect(bIndex).toContain('from A');
  });

  it("a different project's memory does NOT appear in this project's store", async () => {
    const alpha = await makeRepo('alpha', 'https://example.com/alpha.git');
    const beta = await makeRepo('beta', 'https://example.com/beta.git');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
    const recordMemoryEntry = requireFn(await load(STORE_MOD), 'recordMemoryEntry');

    await ensureMemoryStore(alpha);
    await ensureMemoryStore(beta);

    await recordMemoryEntry(alpha, {
      category: 'decisions',
      name: 'alpha-only',
      body: '# alpha only\n',
      indexLine: '- [alpha only](decisions/alpha-only.md)',
    });

    // beta never sees alpha-only.
    const betaDecisions = await readdir(join(beta, '.memory', 'decisions')).catch(() => []);
    expect(betaDecisions).not.toContain('alpha-only.md');
    const betaIndex = await readFile(join(beta, '.memory', 'index.md'), 'utf8');
    expect(betaIndex).not.toContain('alpha only');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-5 negative: removing a worktree preserves the shared store; concurrent
// dual-worktree writes both persist (no-clobber index, C8).
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-5 / C8: durability under removal and concurrency', () => {
  it('removing worktree A (unlinking its .memory symlink) leaves the canonical store intact for B', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const wtB = await addWorktree(repo, 'feature-b');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
    const recordMemoryEntry = requireFn(await load(STORE_MOD), 'recordMemoryEntry');

    await ensureMemoryStore(repo);
    await ensureMemoryStore(wtB);
    await recordMemoryEntry(repo, {
      category: 'decisions',
      name: 'persist-me',
      body: '# persist me\n',
      indexLine: '- [persist me](decisions/persist-me.md)',
    });

    // Simulate worktree A removal: only its symlink is unlinked, never the target.
    await rm(join(repo, '.memory'), { force: true }); // unlink symlink, not -r on target
    await git(['worktree', 'remove', '--force', wtB], repo).catch(() => undefined);

    // Sibling B's store target still holds the entry.
    const bBody = await readFile(join(wtB, '.memory', 'decisions', 'persist-me.md'), 'utf8').catch(
      async () => {
        // If B's path is gone, the canonical store must still have it.
        const projectKey = requireFn(await load(STORE_MOD), 'projectKey');
        const key = await projectKey(repo);
        return readFile(
          join(fakeHome, '.ai-conductor', 'memory', key, 'harness', 'decisions', 'persist-me.md'),
          'utf8',
        );
      },
    );
    expect(bBody).toContain('persist me');
  });

  it('two near-simultaneous writes from siblings BOTH persist and BOTH index lines survive', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    const wtB = await addWorktree(repo, 'feature-b');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
    const recordMemoryEntry = requireFn(await load(STORE_MOD), 'recordMemoryEntry');

    await ensureMemoryStore(repo);
    await ensureMemoryStore(wtB);

    await Promise.all([
      recordMemoryEntry(repo, {
        category: 'decisions',
        name: 'from-a',
        body: '# from a\n',
        indexLine: '- [from a](decisions/from-a.md) — writer A',
      }),
      recordMemoryEntry(wtB, {
        category: 'decisions',
        name: 'from-b',
        body: '# from b\n',
        indexLine: '- [from b](decisions/from-b.md) — writer B',
      }),
    ]);

    // Both entry files exist (file-per-entry).
    const decisions = await readdir(join(repo, '.memory', 'decisions'));
    expect(decisions).toContain('from-a.md');
    expect(decisions).toContain('from-b.md');

    // Both index lines survive — neither write clobbered the other (no-clobber protocol).
    const index = await readFile(join(repo, '.memory', 'index.md'), 'utf8');
    expect(index).toContain('writer A');
    expect(index).toContain('writer B');
  });
});
