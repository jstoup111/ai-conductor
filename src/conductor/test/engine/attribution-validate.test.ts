/**
 * Unit tests for citation validator (Task 9).
 *
 * Engine-side citation validation: validates that cited commits are reachable
 * ancestors and have path overlap with the task's Files: lines.
 *
 * Acceptance criteria:
 * - Unreachable SHA → task refused with reason recorded
 * - Non-ancestor SHA → task refused with reason recorded
 * - Empty commit → task refused with reason recorded
 * - Bookkeeping commit → task refused with reason recorded
 * - Zero path overlap (segment-anchored rule) → task refused with reason recorded
 * - Reachable, overlapping citations → task clears with all reasons cleared
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { execa } from 'execa';
import { makeGitRunner } from '../../src/engine/rebase.js';

async function loadAttributionValidate() {
  return import('../../src/engine/attribution-validate.js');
}

interface TestRepo {
  root: string;
  git: ReturnType<typeof makeGitRunner>;
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'attribution-validate-test-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

async function initRepo(): Promise<TestRepo> {
  const root = tmpDir;
  const git = makeGitRunner(root);

  // Initialize git repo
  await execa('git', ['init', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Test User'], { cwd: root });

  // Create initial commit
  await writeFile(join(root, 'README.md'), '# Test\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-m', 'chore: init'], { cwd: root });

  return { root, git };
}

async function commitFile(repo: TestRepo, file: string, content: string, message: string): Promise<string> {
  const filePath = join(repo.root, file);
  const dir = filePath.split('/').slice(0, -1).join('/');
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, content);
  await execa('git', ['add', file], { cwd: repo.root });
  await execa('git', ['commit', '-m', message], { cwd: repo.root });
  const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return result.stdout.trim();
}

async function commitEmpty(repo: TestRepo, message: string): Promise<string> {
  await execa('git', ['commit', '--allow-empty', '-m', message], { cwd: repo.root });
  const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return result.stdout.trim();
}

async function getCurrentHead(repo: TestRepo): Promise<string> {
  const result = await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root });
  return result.stdout.trim();
}

describe('validateCitations', () => {
  it('accepts a valid, reachable citation with path overlap', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    const sha = await commitFile(repo, 'src/widget.ts', 'export const widget = 1;', 'feat: add widget');
    const head = await getCurrentHead(repo);

    const verdictEntry = { taskId: '1', verdict: 'satisfied' as const, citations: [{ sha, rationale: 'adds widget' }] };
    const taskPaths = new Set(['src/widget.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('refuses an unreachable SHA', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    await commitFile(repo, 'src/test.ts', 'export const test = 1;', 'feat: test');
    const head = await getCurrentHead(repo);

    const unreachableSha = '0'.repeat(40);
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha: unreachableSha, rationale: 'unreachable' }],
    };
    const taskPaths = new Set(['src/test.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toMatch(/unreachable|not found|sha/i);
  });

  it('refuses a non-ancestor SHA', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    // Create a commit on main
    const mainSha = await commitFile(repo, 'src/main.ts', 'export const main = 1;', 'feat: main');
    await getCurrentHead(repo);

    // Create a divergent branch
    await execa('git', ['checkout', '-b', 'divergent'], { cwd: repo.root });
    const divergentSha = await commitFile(repo, 'src/divergent.ts', 'export const div = 1;', 'feat: divergent');

    // Switch back to main
    await execa('git', ['checkout', 'main'], { cwd: repo.root });
    const head = await getCurrentHead(repo);

    // Try to cite the divergent commit (not an ancestor of main's HEAD)
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha: divergentSha, rationale: 'not an ancestor' }],
    };
    const taskPaths = new Set(['src/divergent.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toMatch(/ancestor|not.*ancestor/i);
  });

  it('refuses an empty commit', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    const emptySha = await commitEmpty(repo, 'chore: empty');
    const head = await getCurrentHead(repo);

    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha: emptySha, rationale: 'empty commit' }],
    };
    const taskPaths = new Set(['src/widget.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toMatch(/empty|no file|no change/i);
  });

  it('refuses a bookkeeping commit', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    // Commit with CONDUCT_ENGINE_COMMIT=1
    const filePath = join(repo.root, 'src/bookkeep.ts');
    await mkdir(join(repo.root, 'src'), { recursive: true });
    await writeFile(filePath, 'export const bk = 1;');
    await execa('git', ['add', 'src/bookkeep.ts'], { cwd: repo.root });
    await execa('git', ['commit', '-m', 'chore: bookkeeping'], {
      cwd: repo.root,
      env: { ...process.env, CONDUCT_ENGINE_COMMIT: '1' },
    });

    const bookkeepSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root })).stdout.trim();
    const head = bookkeepSha;

    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha: bookkeepSha, rationale: 'bookkeeping' }],
    };
    const taskPaths = new Set(['src/bookkeep.ts']);
    const bookkeepingCommits = new Set([bookkeepSha]);

    const result = await mod.validateCitations(
      repo.git,
      { taskId: '1', paths: taskPaths },
      verdictEntry,
      head,
      bookkeepingCommits,
    );

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toMatch(/bookkeeping|engine commit/i);
  });

  it('refuses zero path overlap', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    // Commit touches file1.ts
    const sha = await commitFile(repo, 'src/file1.ts', 'export const f1 = 1;', 'feat: file1');
    const head = await getCurrentHead(repo);

    // But task declares file2.ts (no overlap)
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha, rationale: 'no path overlap' }],
    };
    const taskPaths = new Set(['src/file2.ts', 'src/file3.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons[0]).toMatch(/path|overlap|touch|file/i);
  });

  it('accepts path overlap via segment-anchored suffix match', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    // Commit touches full path
    const sha = await commitFile(repo, 'src/conductor/src/engine/widget.ts', 'export const w = 1;', 'feat: widget');
    const head = await getCurrentHead(repo);

    // Task declares partial path (segment-anchored suffix)
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha, rationale: 'path overlap via suffix' }],
    };
    const taskPaths = new Set(['src/engine/widget.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('rejects path overlap when segment boundary is not aligned', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    // Commit touches file
    const sha = await commitFile(repo, 'src/trail.ts', 'export const t = 1;', 'feat: trail');
    const head = await getCurrentHead(repo);

    // Task declares different file (not segment-anchored)
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha, rationale: 'boundary not aligned' }],
    };
    const taskPaths = new Set(['audit-trail.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('handles task with no declared paths', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    const sha = await commitFile(repo, 'anything.txt', 'content', 'feat: anything');
    const head = await getCurrentHead(repo);

    // Task has no paths declared
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha, rationale: 'no paths required' }],
    };
    const taskPaths = new Set([]); // empty

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    // Should pass because task requires no specific paths
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('validates multiple citations and returns combined reasons on first failure', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    const validSha = await commitFile(repo, 'src/valid.ts', 'export const v = 1;', 'feat: valid');
    const unreachableSha = '0'.repeat(40);
    const head = await getCurrentHead(repo);

    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [
        { sha: validSha, rationale: 'valid' },
        { sha: unreachableSha, rationale: 'invalid' },
      ],
    };
    const taskPaths = new Set(['src/valid.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('clears reasons when citation validation succeeds', async () => {
    const mod = await loadAttributionValidate();
    const repo = await initRepo();

    const sha1 = await commitFile(repo, 'src/file1.ts', 'content1', 'feat: file1');
    const sha2 = await commitFile(repo, 'src/file2.ts', 'content2', 'feat: file2');
    const head = await getCurrentHead(repo);

    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [
        { sha: sha1, rationale: 'reason1' },
        { sha: sha2, rationale: 'reason2' },
      ],
    };
    const taskPaths = new Set(['src/file1.ts', 'src/file2.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    expect(result.valid).toBe(true);
    // All previous reasons should be cleared
    expect(result.reasons).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RED (Task 8 of rebase-orphans-every-sha-anchored-evidence-citatio.md):
// read-time resolution through a persisted rebase rewrite map.
//
// Per adr-2026-07-12-rebase-evidence-stamp-translation.md: a citation naming a
// commit sha that a sanctioned engine rebase has rewritten must still validate
// successfully against the new HEAD, by resolving through the persisted
// `.pipeline/rebase-rewrites.json` map (via `resolveThroughMap`) BEFORE the
// `merge-base --is-ancestor` check in `validateCitations`. Task 9 wires this
// resolution in; today `validateCitations` does not consult the map at all,
// so a citation naming the OLD (pre-rebase, now-pruned) sha fails ancestry —
// this test pins the desired post-Task-9 behavior and is expected to FAIL
// (genuine RED) until that wiring lands.
//
// The rewrite map is built here the same way `buildRewriteMap` would after a
// real rebase: the pre-rebase work commit is cherry-picked onto a fresh base
// (new sha, identical patch), the pre-rebase objects are then pruned from the
// object database so the old sha is genuinely unreachable/gone (not merely
// "still lying around"), and the map is persisted via `persistRewriteMap`.
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCitations resolves citations through a persisted rebase rewrite map (RED, Task 8)', () => {
  it('a satisfied-by citation naming the pre-rebase sha still validates against the new HEAD', async () => {
    const mod = await loadAttributionValidate();
    const { persistRewriteMap } = await import('../../src/engine/rebase-translate.js');
    const repo = await initRepo();

    // Pre-rebase: base -> oldWorkSha (touches src/widget.ts).
    const baseSha = await getCurrentHead(repo);
    const oldWorkSha = await commitFile(repo, 'src/widget.ts', 'export const widget = 1;', 'feat: add widget');

    // Simulate the sanctioned rebase: rewind the branch to base (via a
    // force checkout of a recreated branch, not `reset --hard`), add an
    // upstream commit to change `onto` (so the cherry-picked replay lands
    // on a genuinely different parent and gets a NEW sha rather than
    // reproducing the identical old commit bit-for-bit), then cherry-pick
    // the work commit's patch back on. This mirrors what `buildRewriteMap`'s
    // patch-id correspondence would match post-rebase.
    await execa('git', ['checkout', '-f', '-B', 'main', baseSha], { cwd: repo.root });
    await commitFile(repo, 'UPSTREAM.md', 'upstream change\n', 'chore: upstream commit (onto)');
    await execa('git', ['cherry-pick', oldWorkSha], { cwd: repo.root });
    const newWorkSha = (await execa('git', ['rev-parse', 'HEAD'], { cwd: repo.root })).stdout.trim();
    const head = newWorkSha;

    // Prune the pre-rebase object out of the odb so the old sha is genuinely
    // gone — not lingering, which would let the existence check pass by
    // accident and mask whether resolution actually happened.
    await execa('git', ['reflog', 'expire', '--expire=now', '--all'], { cwd: repo.root });
    await execa('git', ['gc', '--prune=now'], { cwd: repo.root });
    const goneCheck = await execa('git', ['cat-file', '-e', `${oldWorkSha}^{commit}`], {
      cwd: repo.root,
      reject: false,
    });
    expect(goneCheck.exitCode).not.toBe(0); // sanity: fixture genuinely pruned the old object

    // Persist the rewrite map old -> new, exactly as `performRebase` would
    // after a `changed` outcome.
    await persistRewriteMap(repo.root, { [oldWorkSha]: newWorkSha });

    // The verdict cites the OLD (pre-rebase) sha — this is the immutable
    // satisfied-by citation text that a rebase can never rewrite in place.
    const verdictEntry = {
      taskId: '1',
      verdict: 'satisfied' as const,
      citations: [{ sha: oldWorkSha, rationale: 'adds widget' }],
    };
    const taskPaths = new Set(['src/widget.ts']);

    const result = await mod.validateCitations(repo.git, { taskId: '1', paths: taskPaths }, verdictEntry, head);

    // Desired post-Task-9 behavior: resolves oldWorkSha -> newWorkSha through
    // the persisted map before the ancestry check, so validation succeeds.
    expect(result.valid).toBe(true);
    expect(result.reasons).toEqual([]);

    // Load-bearing invariant (ADR): the citation TEXT itself is never
    // mutated — only in-memory resolution changes. The verdict entry we
    // constructed still names the old sha after validation.
    expect(verdictEntry.citations[0].sha).toBe(oldWorkSha);
  });
});
