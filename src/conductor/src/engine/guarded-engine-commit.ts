import { execa } from 'execa';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withDaemonCoAuthorTrailer } from './bot-co-author.js';
import { withEngineCommitEnv } from './engine-commit-env.js';
import { readRestackJournal } from './restack/restack-journal.js';
import { hasDurableChildState } from './child-cursor.js';

export interface CommitEngineChangeOptions {
  readonly worktree: string;
  readonly slug: string;
  readonly pathspec: readonly string[];
  readonly message: string;
  readonly noVerify?: boolean;
}

export type CommitEngineChangeResult =
  | { readonly kind: 'written'; readonly sha: string }
  | { readonly kind: 'noop' }
  | { readonly kind: 'refused'; readonly reason: string }
  | { readonly kind: 'failed'; readonly reason: string };

/**
 * Use the commit fence only for a feature which has entered the durable
 * stacked-child lifecycle.  Call sites retain their historical `git commit`
 * command for ordinary (N=1) features; that distinction is deliberate, not a
 * best-effort probe hidden at each caller.
 */
export async function commitEngineChangeWhenStacked(
  options: CommitEngineChangeOptions,
): Promise<CommitEngineChangeResult | undefined> {
  const durable = await hasDurableChildState(options.worktree, options.slug);
  return durable === true ? commitEngineChange(options) : undefined;
}

const FENCED_STATES = new Set(['ready', 'moved', 'rolling-back']);

function commandFailure(result: { readonly stderr?: string; readonly shortMessage?: string }): string {
  return result.stderr?.trim() || result.shortMessage || 'Git command failed';
}

async function journalAllowsCommit(worktree: string, slug: string): Promise<boolean> {
  const journal = await readRestackJournal(worktree, slug);
  return journal.kind !== 'journal' || !FENCED_STATES.has(journal.journal.state);
}

async function runHook(
  cwd: string,
  env: NodeJS.ProcessEnv,
  hook: 'pre-commit' | 'prepare-commit-msg' | 'commit-msg' | 'post-commit',
  args: readonly string[] = [],
): Promise<boolean> {
  const result = await execa('git', ['hook', 'run', '--ignore-missing', hook, ...(args.length === 0 ? [] : ['--', ...args])], {
    cwd, env, reject: false,
  });
  return result.exitCode === 0;
}

/**
 * Commit an engine-owned bookkeeping change without letting a restack move
 * race it. The temporary index deliberately isolates the site from unrelated
 * staged work in a feature worktree.
 */
export async function commitEngineChange(options: CommitEngineChangeOptions): Promise<CommitEngineChangeResult> {
  if (options.pathspec.length === 0) return { kind: 'noop' };
  if (!await journalAllowsCommit(options.worktree, options.slug)) {
    return { kind: 'refused', reason: 'restack journal is moving refs' };
  }

  const indexDirectory = await mkdtemp(join(tmpdir(), 'conductor-engine-commit-'));
  const indexPath = join(indexDirectory, 'index');
  const messagePath = join(indexDirectory, 'message');
  const env = withEngineCommitEnv({ ...process.env, GIT_INDEX_FILE: indexPath });
  try {
    const head = await execa('git', ['rev-parse', '--verify', 'HEAD'], { cwd: options.worktree, reject: false });
    if (head.exitCode !== 0 || head.stdout.trim() === '') return { kind: 'failed', reason: commandFailure(head) };
    const oldHead = head.stdout.trim();
    const seeded = await execa('git', ['read-tree', oldHead], { cwd: options.worktree, env, reject: false });
    if (seeded.exitCode !== 0) return { kind: 'failed', reason: commandFailure(seeded) };
    const staged = await execa('git', ['add', '--', ...options.pathspec], { cwd: options.worktree, env, reject: false });
    if (staged.exitCode !== 0) return { kind: 'failed', reason: commandFailure(staged) };
    const changed = await execa('git', ['diff', '--cached', '--quiet'], { cwd: options.worktree, env, reject: false });
    if (changed.exitCode === 0) return { kind: 'noop' };
    if (changed.exitCode !== 1) return { kind: 'failed', reason: commandFailure(changed) };

    await writeFile(messagePath, withDaemonCoAuthorTrailer(options.message).replace(/\n?$/, '\n'), 'utf8');
    if (!options.noVerify && !await runHook(options.worktree, env, 'pre-commit')) return { kind: 'failed', reason: 'pre-commit hook failed' };
    if (!await runHook(options.worktree, env, 'prepare-commit-msg', [messagePath, 'message'])) return { kind: 'failed', reason: 'prepare-commit-msg hook failed' };
    if (!options.noVerify && !await runHook(options.worktree, env, 'commit-msg', [messagePath])) return { kind: 'failed', reason: 'commit-msg hook failed' };

    const tree = await execa('git', ['write-tree'], { cwd: options.worktree, env, reject: false });
    if (tree.exitCode !== 0 || tree.stdout.trim() === '') return { kind: 'failed', reason: commandFailure(tree) };
    const signing = await execa('git', ['config', '--bool', 'commit.gpgSign'], { cwd: options.worktree, reject: false });
    const commit = await execa('git', [
      'commit-tree', tree.stdout.trim(), '-p', oldHead,
      ...(signing.exitCode === 0 && signing.stdout.trim() === 'true' ? ['-S'] : []),
    ], {
      cwd: options.worktree,
      env,
      // Hooks may rewrite the message file; the helper is idempotent and
      // restores the daemon trailer if a hook dropped it.
      input: withDaemonCoAuthorTrailer(await readFile(messagePath, 'utf8')),
      reject: false,
    });
    if (commit.exitCode !== 0 || commit.stdout.trim() === '') return { kind: 'failed', reason: commandFailure(commit) };

    if (!await journalAllowsCommit(options.worktree, options.slug)) return { kind: 'refused', reason: 'restack journal began moving refs' };
    const moved = await execa('git', ['update-ref', 'HEAD', commit.stdout.trim(), oldHead], { cwd: options.worktree, env, reject: false });
    if (moved.exitCode !== 0) return { kind: 'failed', reason: commandFailure(moved) };
    const updateIndex = await execa('git', ['add', '--', ...options.pathspec], { cwd: options.worktree, reject: false });
    if (updateIndex.exitCode !== 0) return { kind: 'failed', reason: commandFailure(updateIndex) };
    if (!await runHook(options.worktree, env, 'post-commit')) return { kind: 'failed', reason: 'post-commit hook failed' };
    return { kind: 'written', sha: commit.stdout.trim() };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}
