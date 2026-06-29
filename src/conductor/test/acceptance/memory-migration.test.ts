import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, lstat } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for Slice 1a — safe, reversible migration of an existing
// in-tree `.memory/` into the canonical shared store (ADR-020, condition C5).
//
// Stories (.docs/stories/pluggable-memory-1a-durable-default-memory.md):
//   FR-11 Migration preserves all entries; reversible (one-time); verify-failure
//         makes NO destructive change; interrupted re-run loses nothing;
//         already-migrated is a no-op; unions into an existing shared store.
//   FR-12 New/empty project → no migration and no destructive memory action.
//
// Drives `src/conductor/src/engine/memory-migrate.ts` (`migrateMemory`) and reuses
// `memory-store.ts` (`projectKey`) to locate the canonical store. Neither module
// exists yet → dynamically imported so RED is "not yet implemented".
// ─────────────────────────────────────────────────────────────────────────────

const execFile = promisify(execFileCb);
const MIGRATE_MOD = '../../src/engine/memory-migrate.js';
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

/** Seed a real (non-symlink) in-tree `.memory/` with the given decision entries. */
async function seedRealMemory(repo: string, names: string[]): Promise<void> {
  const mem = join(repo, '.memory');
  await mkdir(join(mem, 'decisions'), { recursive: true });
  const indexLines: string[] = ['# Memory Index', ''];
  for (const n of names) {
    await writeFile(join(mem, 'decisions', `${n}.md`), `# ${n}\nbody of ${n}\n`);
    indexLines.push(`- [${n}](decisions/${n}.md) — seeded`);
  }
  await writeFile(join(mem, 'index.md'), indexLines.join('\n') + '\n');
}

async function canonicalHarnessDir(repo: string): Promise<string> {
  const projectKey = requireFn(await load(STORE_MOD), 'projectKey');
  const key = await projectKey(repo);
  return join(fakeHome, '.ai-conductor', 'memory', key, 'harness');
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'memory-migrate-'));
  fakeHome = join(workDir, 'home');
  await mkdir(fakeHome, { recursive: true });
  savedHome.value = process.env.HOME;
  savedProfile.value = process.env.USERPROFILE;
  process.env.HOME = fakeHome;
  process.env.USERPROFILE = fakeHome;
});

afterEach(async () => {
  process.env.HOME = savedHome.value;
  process.env.USERPROFILE = savedProfile.value;
  await rm(workDir, { recursive: true, force: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-12 / A17: fresh, empty, and already-migrated states never take a
// destructive action.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-12: migration is a no-op for fresh / empty / already-migrated projects', () => {
  it('a project with NO .memory/ is left untouched (no fabricated dir, no error)', async () => {
    const repo = await makeRepo('fresh', 'https://example.com/fresh.git');
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    await migrateMemory(repo); // must not throw

    // No in-tree real .memory dir was fabricated as a side effect of "migration".
    const memStat = await lstat(join(repo, '.memory')).catch(() => null);
    if (memStat) {
      // If present at all it must be a symlink (store ensured), never a stray real dir of entries.
      expect(memStat.isSymbolicLink()).toBe(true);
    }
  });

  it('an already-migrated project (.memory is a symlink) is a no-op', async () => {
    const repo = await makeRepo('done', 'https://example.com/done.git');
    const ensureMemoryStore = requireFn(await load(STORE_MOD), 'ensureMemoryStore');
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    await ensureMemoryStore(repo); // .memory is now a symlink to the canonical store
    await migrateMemory(repo); // second-pass migration must detect + skip

    const stat = await lstat(join(repo, '.memory'));
    expect(stat.isSymbolicLink()).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 / A18: copy-verify-swap preserves every entry and is reversible.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-11: copy-verify-swap preserves all entries', () => {
  it('migrates a real .memory/ of N entries into the canonical store and links .memory to it', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await seedRealMemory(repo, ['one', 'two', 'three']);
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    await migrateMemory(repo);

    // .memory is now a symlink; all three entries are present and recallable through it.
    const stat = await lstat(join(repo, '.memory'));
    expect(stat.isSymbolicLink()).toBe(true);

    const harness = await canonicalHarnessDir(repo);
    const decisions = await readdir(join(harness, 'decisions'));
    expect(decisions.sort()).toEqual(['one.md', 'three.md', 'two.md']);
    const body = await readFile(join(repo, '.memory', 'decisions', 'two.md'), 'utf8');
    expect(body).toContain('body of two');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 negative / A19 (C5): a verify failure makes NO destructive change.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-11 / C5: verify failure aborts non-destructively', () => {
  it('forced verify failure leaves the original .memory/ intact with every entry', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await seedRealMemory(repo, ['keep-a', 'keep-b']);
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    // Inject a verifier that fails — migration must abort and restore.
    await expect(migrateMemory(repo, { verify: async () => false })).rejects.toThrow(/verif/i);

    // Original .memory/ is still a REAL directory with both entries — nothing lost, no swap.
    const stat = await lstat(join(repo, '.memory'));
    expect(stat.isSymbolicLink()).toBe(false);
    const decisions = await readdir(join(repo, '.memory', 'decisions'));
    expect(decisions.sort()).toEqual(['keep-a.md', 'keep-b.md']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 negative / A20: an interrupted migration re-runs without losing anything.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-11: interrupted migration re-runs cleanly', () => {
  it('a fault before the swap is recoverable — re-run completes and loses no entry', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await seedRealMemory(repo, ['e1', 'e2']);
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    // First attempt is interrupted after backup/copy, before the swap.
    await expect(
      migrateMemory(repo, { failBeforeSwap: async () => { throw new Error('interrupted'); } }),
    ).rejects.toThrow(/interrupt/i);

    // Re-run with no fault resumes and completes.
    await migrateMemory(repo);

    const harness = await canonicalHarnessDir(repo);
    const decisions = await readdir(join(harness, 'decisions'));
    expect(decisions.sort()).toEqual(['e1.md', 'e2.md']);
    const stat = await lstat(join(repo, '.memory'));
    expect(stat.isSymbolicLink()).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 / A21: migrating into an ALREADY-populated canonical store unions, never
// overwrites, and never duplicates index lines.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-11: migration unions into an existing shared store', () => {
  it('a sibling-populated canonical store is unioned, not clobbered; no duplicate index lines', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');

    // A sibling already migrated: pre-populate the canonical store for this project key.
    const harness = await canonicalHarnessDir(repo);
    await mkdir(join(harness, 'decisions'), { recursive: true });
    await writeFile(join(harness, 'decisions', 'sibling.md'), '# sibling\n');
    await writeFile(
      join(harness, 'index.md'),
      '# Memory Index\n\n- [sibling](decisions/sibling.md) — from sibling\n',
    );

    // This worktree still has a real .memory/ with its own + an overlapping entry.
    await seedRealMemory(repo, ['mine', 'sibling']); // 'sibling' overlaps by name
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    await migrateMemory(repo);

    // Union: sibling's entry preserved, mine added, no loss.
    const decisions = await readdir(join(harness, 'decisions'));
    expect(decisions.sort()).toEqual(['mine.md', 'sibling.md']);

    // Index has the sibling line exactly once (no duplicate from the overlapping migrate).
    const index = await readFile(join(harness, 'index.md'), 'utf8');
    const siblingCount = index.split('\n').filter((l) => l.includes('decisions/sibling.md')).length;
    expect(siblingCount).toBe(1);
    expect(index).toContain('decisions/mine.md');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11 negative / A20: crash in the post-rm swap window (after .memory is
// removed but before the temp link is renamed into place). A plain re-run
// must complete the swap idempotently — no entries lost.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-11: post-rm swap-window crash is recoverable on re-run', () => {
  it('a crash after .memory is removed but before rename completes — re-run recovers', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await seedRealMemory(repo, ['w1', 'w2']);
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    // First attempt: crash mid-swap (after rm(.memory) but before rename of temp link).
    await expect(
      migrateMemory(repo, {
        failDuringSwap: async () => {
          throw new Error('crash in swap window');
        },
      }),
    ).rejects.toThrow(/crash in swap window/);

    // After the crash, .memory is absent — rm succeeded but rename did not.
    const midStat = await lstat(join(repo, '.memory')).catch(() => null);
    expect(midStat).toBeNull();

    // Plain re-run completes the swap idempotently — the backup holds the data.
    await migrateMemory(repo);

    // .memory is now a symlink pointing to the canonical harness dir.
    const finalStat = await lstat(join(repo, '.memory'));
    expect(finalStat.isSymbolicLink()).toBe(true);

    const harness = await canonicalHarnessDir(repo);
    const decisions = await readdir(join(harness, 'decisions'));
    expect(decisions.sort()).toEqual(['w1.md', 'w2.md']);

    // Entries are accessible through the symlink.
    const body = await readFile(join(repo, '.memory', 'decisions', 'w1.md'), 'utf8');
    expect(body).toContain('body of w1');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// FR-11: one-time reverse restores the pre-migration state.
// ═════════════════════════════════════════════════════════════════════════════
describe('FR-11: one-time reverse restores prior state', () => {
  it('reverse restores a real in-tree .memory/ matching the pre-migration entries', async () => {
    const repo = await makeRepo('alpha', 'https://example.com/alpha.git');
    await seedRealMemory(repo, ['r1', 'r2']);
    const migrateMemory = requireFn(await load(MIGRATE_MOD), 'migrateMemory');

    await migrateMemory(repo); // forward
    expect((await lstat(join(repo, '.memory'))).isSymbolicLink()).toBe(true);

    await migrateMemory(repo, { reverse: true }); // one-time reverse

    // .memory is a real dir again with the original entries.
    const stat = await lstat(join(repo, '.memory'));
    expect(stat.isSymbolicLink()).toBe(false);
    const decisions = await readdir(join(repo, '.memory', 'decisions'));
    expect(decisions.sort()).toEqual(['r1.md', 'r2.md']);
  });
});
