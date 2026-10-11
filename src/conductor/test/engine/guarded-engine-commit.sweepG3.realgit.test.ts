// Covers: task:26
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Record every argv the helper hands to Git while still executing it for real:
// the plumbing sequence (write-tree, commit-tree, update-ref) is the observable
// contract of these checks, and real Git keeps its semantics honest.
const gitCalls = vi.hoisted(() => [] as { args: readonly string[]; env?: NodeJS.ProcessEnv }[]);
vi.mock('execa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('execa')>();
  const recordingExeca = ((file: string, args?: readonly string[], options?: { env?: NodeJS.ProcessEnv }) => {
    if (file === 'git' && Array.isArray(args)) gitCalls.push({ args: [...args], env: options?.env });
    return (actual.execa as (...input: unknown[]) => unknown)(file, args, options);
  }) as unknown as typeof actual.execa;
  return { ...actual, execa: recordingExeca };
});

const { execa } = await import('execa');
const { commitEngineChange } = await import('../../src/engine/guarded-engine-commit.js');
const { prepareWorktree } = await import('../../src/engine/worktree-prepare.js');
const { createRestackJournal, journalRefFor, writeRestackJournalBlob } = await import('../../src/engine/restack/restack-journal.js');
import type { RestackJournalDraft } from '../../src/engine/restack/restack-journal.js';
import type { RestackOpId } from '../../src/engine/restack/restack-types.js';

const roots: string[] = [];

beforeEach(() => {
  gitCalls.length = 0;
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  return (await execa('git', args, { cwd, ...(env ? { env } : {}) })).stdout.trim();
}

/** A primary repository plus a linked `feat/c1/demo` feature worktree. */
async function stackedWorktree(): Promise<{ root: string; worktree: string }> {
  const root = await mkdtemp(join(tmpdir(), 'guarded-commit-sweep-'));
  roots.push(root);
  const primary = join(root, 'primary');
  const worktree = join(root, 'demo');
  await mkdir(primary);
  await git(primary, ['init', '-q', '-b', 'main']);
  await git(primary, ['config', 'user.email', 'guard@example.invalid']);
  await git(primary, ['config', 'user.name', 'Guarded commit sweep']);
  await git(primary, ['config', 'commit.gpgSign', 'false']);
  await writeFile(join(primary, 'note.txt'), 'note v1\n');
  await writeFile(join(primary, 'other.txt'), 'other v1\n');
  await git(primary, ['add', '.']);
  await git(primary, ['commit', '-qm', 'base']);
  await git(primary, ['worktree', 'add', '-q', '-b', 'feat/c1/demo', worktree]);
  return { root, worktree };
}

async function fenceJournal(worktree: string, state: 'ready' | 'moved' | 'rolling-back'): Promise<void> {
  const draft: RestackJournalDraft = {
    opId: `sweep-fence-${state}` as RestackOpId,
    cause: 'feature-repair',
    committer: { name: 'Sweep', email: 'sweep@example.invalid', date: '2030-01-01T00:00:00Z' },
    dirtyPaths: [], refs: [], ranges: [], children: [],
  };
  const created = await createRestackJournal(worktree, 'demo', draft);
  if (created.kind !== 'created') throw new Error('journal was not created');
  const fenced = await writeRestackJournalBlob(worktree, { ...created.journal.journal, state });
  await git(worktree, ['update-ref', journalRefFor('demo'), fenced, created.journal.blob]);
}

/** Hooks that log their name, the index they were given and HEAD at run time. */
async function loggingHooks(root: string, worktree: string, extra: Record<string, string> = {}): Promise<string> {
  const hooks = join(root, 'logging-hooks');
  const log = join(root, 'hooks.log');
  await mkdir(hooks, { recursive: true });
  for (const name of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']) {
    await writeFile(join(hooks, name), [
      '#!/bin/sh',
      `printf '%s index=%s head=%s\\n' ${name} "$GIT_INDEX_FILE" "$(git rev-parse HEAD)" >> '${log}'`,
      extra[name] ?? '',
      'exit 0',
      '',
    ].join('\n'));
    await chmod(join(hooks, name), 0o755);
  }
  await git(worktree, ['config', 'core.hooksPath', hooks]);
  return log;
}

async function hookLog(log: string): Promise<{ name: string; index: string; head: string }[]> {
  const text = await readFile(log, 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).map((line) => {
    const [name, index, head] = line.split(' ');
    return { name, index: index.slice('index='.length), head: head.slice('head='.length) };
  });
}

function callIndex(predicate: (args: readonly string[]) => boolean): number {
  return gitCalls.findIndex((call) => predicate(call.args));
}

describe('commitEngineChange sweep (real local Git)', () => {
  // Covers: task:26
  it('refuses every fenced journal state (ready, moved, rolling-back) and leaves HEAD unchanged', async () => {
    for (const state of ['ready', 'moved', 'rolling-back'] as const) {
      const { worktree } = await stackedWorktree();
      const before = await git(worktree, ['rev-parse', 'HEAD']);
      await fenceJournal(worktree, state);
      await writeFile(join(worktree, 'note.txt'), `fenced ${state}\n`);

      const result = await commitEngineChange({
        worktree, slug: 'demo', pathspec: ['note.txt'], message: 'chore: fenced', noVerify: true,
      });

      expect(result, state).toMatchObject({ kind: 'refused' });
      expect(await git(worktree, ['rev-parse', 'HEAD']), state).toBe(before);
      expect(await git(worktree, ['rev-parse', 'refs/heads/feat/c1/demo']), state).toBe(before);
    }
  });

  // Covers: task:26
  it('commits only its own pathspec from a temporary HEAD-seeded index while stray staged changes stay staged', async () => {
    const { worktree } = await stackedWorktree();
    const worktreeIndex = await git(worktree, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
    const before = await git(worktree, ['rev-parse', 'HEAD']);
    await writeFile(join(worktree, 'stray.txt'), 'stray staged\n');
    await git(worktree, ['add', 'stray.txt']);
    await writeFile(join(worktree, 'other.txt'), 'other unstaged edit\n');
    await writeFile(join(worktree, 'note.txt'), 'note v2\n');
    gitCalls.length = 0;

    const result = await commitEngineChange({
      worktree, slug: 'demo', pathspec: ['note.txt'], message: 'chore: engine note', noVerify: true,
    });

    expect(result).toMatchObject({ kind: 'written' });
    const head = await git(worktree, ['rev-parse', 'HEAD']);
    expect(head).not.toBe(before);
    expect(await git(worktree, ['rev-parse', 'HEAD^'])).toBe(before);
    // The commit carries only the site's own path.
    expect((await git(worktree, ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'])).split('\n')).toEqual(['note.txt']);
    // The tree was built from a temporary index seeded from HEAD, not the worktree index.
    const seed = gitCalls.find((call) => call.args[0] === 'read-tree');
    const writeTree = gitCalls.find((call) => call.args[0] === 'write-tree');
    expect(seed?.args).toEqual(['read-tree', before]);
    expect(seed?.env?.GIT_INDEX_FILE).toBeDefined();
    expect(writeTree?.env?.GIT_INDEX_FILE).toBe(seed?.env?.GIT_INDEX_FILE);
    expect(writeTree?.env?.GIT_INDEX_FILE).not.toBe(worktreeIndex);
    // The stray change stays staged and uncommitted; the unrelated edit stays unstaged.
    expect(await git(worktree, ['diff', '--cached', '--name-only'])).toBe('stray.txt');
    expect(await git(worktree, ['diff', '--name-only'])).toBe('other.txt');
    expect(await git(worktree, ['cat-file', '-e', 'HEAD:stray.txt']).catch(() => 'absent')).toBe('absent');
    // The worktree index was refreshed for the site's own path only.
    expect(await git(worktree, ['status', '--porcelain', '--', 'note.txt'])).toBe('');
    const indexRefresh = gitCalls.filter((call) => call.args[0] === 'add' && call.env?.GIT_INDEX_FILE === undefined);
    expect(indexRefresh.map((call) => call.args)).toEqual([['add', '--', 'note.txt']]);
  });

  // Covers: task:26
  it('runs commit hooks in git order on the temporary index, signs via commit-tree, CAS-moves HEAD from the pre-staging read, then runs post-commit', async () => {
    for (const noVerify of [false, true]) {
      const { root, worktree } = await stackedWorktree();
      const key = join(root, 'signing-key');
      await execa('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'sweep', '-f', key]);
      const publicKey = (await readFile(`${key}.pub`, 'utf8')).trim();
      await writeFile(join(root, 'allowed-signers'), `guard@example.invalid ${publicKey}\n`);
      await git(worktree, ['config', 'gpg.format', 'ssh']);
      await git(worktree, ['config', 'user.signingkey', key]);
      await git(worktree, ['config', 'gpg.ssh.allowedSignersFile', join(root, 'allowed-signers')]);
      await git(worktree, ['config', 'commit.gpgSign', 'true']);
      const log = await loggingHooks(root, worktree);
      const worktreeIndex = await git(worktree, ['rev-parse', '--path-format=absolute', '--git-path', 'index']);
      const before = await git(worktree, ['rev-parse', 'HEAD']);
      await writeFile(join(worktree, 'note.txt'), `hooked ${String(noVerify)}\n`);
      gitCalls.length = 0;

      const result = await commitEngineChange({
        worktree, slug: 'demo', pathspec: ['note.txt'], message: 'chore: hooked', noVerify,
      });

      expect(result, `noVerify=${String(noVerify)}`).toMatchObject({ kind: 'written' });
      const head = await git(worktree, ['rev-parse', 'HEAD']);
      const entries = await hookLog(log);
      expect(entries.map((entry) => entry.name)).toEqual(noVerify
        ? ['prepare-commit-msg', 'post-commit']
        : ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']);
      // Pre-commit hooks see the temporary index and the old HEAD; post-commit sees the moved HEAD.
      for (const entry of entries.filter((item) => item.name !== 'post-commit')) {
        expect(entry.index).not.toBe('');
        expect(entry.index).not.toBe(worktreeIndex);
        expect(entry.head).toBe(before);
      }
      expect(entries.at(-1)).toMatchObject({ name: 'post-commit', head });
      // Hooks are run through `git hook run`, in the recorded order.
      const hookRuns = gitCalls.filter((call) => call.args[0] === 'hook').map((call) => call.args[3]);
      expect(hookRuns).toEqual(noVerify
        ? ['prepare-commit-msg', 'post-commit']
        : ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit']);
      // write-tree and commit-tree (signed) build the commit; update-ref CASes from the pre-staging HEAD.
      const headRead = callIndex((args) => args[0] === 'rev-parse' && args.includes('HEAD'));
      const seeded = callIndex((args) => args[0] === 'read-tree');
      const writeTree = callIndex((args) => args[0] === 'write-tree');
      const commitTree = callIndex((args) => args[0] === 'commit-tree');
      const updateRef = callIndex((args) => args[0] === 'update-ref');
      const postCommit = callIndex((args) => args[0] === 'hook' && args[3] === 'post-commit');
      expect(headRead).toBeGreaterThanOrEqual(0);
      expect(headRead).toBeLessThan(seeded);
      expect(writeTree).toBeGreaterThan(callIndex((args) => args[0] === 'hook' && args[3] === 'prepare-commit-msg'));
      expect(commitTree).toBeGreaterThan(writeTree);
      expect(gitCalls[commitTree].args).toContain('-S');
      expect(gitCalls[commitTree].args.slice(0, 4)).toEqual(['commit-tree', await git(worktree, ['rev-parse', 'HEAD^{tree}']), '-p', before]);
      expect(gitCalls[updateRef].args).toEqual(['update-ref', 'HEAD', head, before]);
      expect(postCommit).toBeGreaterThan(updateRef);
      await expect(execa('git', ['verify-commit', head], { cwd: worktree })).resolves.toMatchObject({ exitCode: 0 });
    }
  });

  // Covers: task:26
  it('fails the compare-and-swap and keeps the other process tip when the branch moves after the HEAD read', async () => {
    const { root, worktree } = await stackedWorktree();
    const before = await git(worktree, ['rev-parse', 'HEAD']);
    const otherTip = await git(worktree, ['commit-tree', `${before}^{tree}`, '-p', before, '-m', 'other process']);
    // A separate process (the hook) moves the checked-out branch after the helper read HEAD.
    await loggingHooks(root, worktree, {
      'prepare-commit-msg': `git update-ref refs/heads/feat/c1/demo ${otherTip} ${before}`,
    });
    await writeFile(join(worktree, 'note.txt'), 'raced\n');
    gitCalls.length = 0;

    const result = await commitEngineChange({
      worktree, slug: 'demo', pathspec: ['note.txt'], message: 'chore: raced', noVerify: true,
    });

    expect(result).toMatchObject({ kind: 'failed' });
    expect(await git(worktree, ['rev-parse', 'refs/heads/feat/c1/demo'])).toBe(otherTip);
    expect(await git(worktree, ['rev-parse', 'HEAD'])).toBe(otherTip);
    const updateRef = gitCalls.find((call) => call.args[0] === 'update-ref');
    expect(updateRef?.args.slice(0, 2)).toEqual(['update-ref', 'HEAD']);
    expect(updateRef?.args[3]).toBe(before);
  });

  // Covers: task:26
  it('moves HEAD through the reference-transaction hook installed by prepareWorktree', async () => {
    const { root, worktree } = await stackedWorktree();
    await prepareWorktree(worktree);
    const hooksPath = await git(worktree, ['config', '--worktree', 'core.hooksPath']);
    expect(hooksPath).toBe(join(worktree, '.pipeline', 'git-hooks'));
    // The installed hook chains to the common hooks directory; a chained logger
    // there proves the installed hook ran for this update and let it through.
    const commonHooks = join(root, 'primary', '.git', 'hooks');
    const log = join(root, 'reference-transaction.log');
    await mkdir(commonHooks, { recursive: true });
    await writeFile(join(commonHooks, 'reference-transaction'), [
      '#!/bin/sh',
      `{ echo "state=$1"; cat; } >> '${log}'`,
      'exit 0',
      '',
    ].join('\n'));
    await chmod(join(commonHooks, 'reference-transaction'), 0o755);
    const before = await git(worktree, ['rev-parse', 'HEAD']);
    await writeFile(join(worktree, 'note.txt'), 'through the installed hook\n');

    const result = await commitEngineChange({
      worktree, slug: 'demo', pathspec: ['note.txt'], message: 'chore: hooked ref', noVerify: true,
    });

    expect(result).toMatchObject({ kind: 'written' });
    const head = await git(worktree, ['rev-parse', 'HEAD']);
    expect(head).not.toBe(before);
    const transaction = await readFile(log, 'utf8');
    expect(transaction).toContain('state=prepared');
    expect(transaction).toContain('state=committed');
    expect(transaction).toMatch(new RegExp(`${before} ${head} (HEAD|refs/heads/feat/c1/demo)`));
  });
});
