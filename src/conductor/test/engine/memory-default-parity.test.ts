/**
 * FR-9 parity test — default `local` provider preserves today's memory experience.
 *
 * Story: under the `local` provider, the categories and the read-and-judge recall
 * pattern remain identical to the experience before pluggable memory was introduced.
 * Recall is performed by the agent reading the files and judging relevance; the
 * harness performs NO search, ranking, or retrieval logic (FR-3 invariant).
 *
 * This test suite is named explicitly for FR-9 so the criterion is traceable.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, lstat, readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import { CATEGORIES, ensureMemoryStore } from '../../src/engine/memory-store.js';
import { LocalMemoryProvider } from '../../src/engine/local-memory-provider.js';

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
  tmpDir = await mkdtemp(join(tmpdir(), 'mem-parity-'));
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
// FR-9: the default `local` provider creates exactly today's category layout.
// ═══════════════════════════════════════════════════════════════════════════

describe('FR-9: default local provider — category layout matches today\'s experience', () => {
  it('ensureMemoryStore creates exactly the four categories used today', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    const memPath = join(repo, '.memory');
    const entries = await readdir(memPath, { withFileTypes: true });

    // Must have exactly the four category directories from the pre-pluggable era.
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    // FR-9 golden: categories are exactly decisions / patterns / gotchas / context.
    expect(dirs).toEqual([...CATEGORIES].sort());
    // Cross-check the canonical set so tests and source can't drift independently.
    expect(dirs).toEqual(['context', 'decisions', 'gotchas', 'patterns']);
  });

  it('ensureMemoryStore creates index.md — the session-start recall entry point', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    const memPath = join(repo, '.memory');
    const stat = await lstat(join(memPath, 'index.md'));
    expect(stat.isFile()).toBe(true);

    const content = await readFile(join(memPath, 'index.md'), 'utf8');
    // Must be a readable Markdown file — the recall protocol reads this first.
    expect(content.startsWith('# ')).toBe(true);
  });

  it('no other files or directories appear at the .memory root (clean layout)', async () => {
    const repo = await makeRepo('alpha', tmpDir);
    await ensureMemoryStore(repo);

    const memPath = join(repo, '.memory');
    const entries = await readdir(memPath);
    const expected = new Set([...CATEGORIES, 'index.md']);
    const actual = new Set(entries);

    for (const item of actual) {
      expect(expected.has(item)).toBe(true, `unexpected item at .memory root: ${item}`);
    }
    expect(actual.size).toBe(expected.size);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FR-9 / FR-3: recall is "read the files + judge" — no harness-side search.
// ═══════════════════════════════════════════════════════════════════════════

describe('FR-9 / FR-3: LocalMemoryProvider has no search or retrieval methods', () => {
  it('LocalMemoryProvider exposes only kind and name — no search/retrieve interface', () => {
    // FR-3: the harness is a dumb conduit. The local provider has no query,
    // search, retrieve, rank, embed, or score methods. All retrieval is
    // performed by the LLM agent reading the files and judging relevance.
    const ownKeys = Object.keys(LocalMemoryProvider);
    expect(ownKeys).toContain('kind');
    expect(ownKeys).toContain('name');

    // Negative-path: provider must NOT expose any retrieval interface.
    const retrievalMethods = ownKeys.filter((k) =>
      /search|retrieve|query|rank|embed|score|similar/i.test(k),
    );
    expect(retrievalMethods).toEqual([]);
  });

  it('LocalMemoryProvider kind is memory_provider and name is local', () => {
    // FR-9: the built-in default is always `local` (no service/network/creds needed).
    expect(LocalMemoryProvider.kind).toBe('memory_provider');
    expect(LocalMemoryProvider.name).toBe('local');
  });
});
