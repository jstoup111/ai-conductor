import { withEngineCommitEnv } from './engine-commit-env.js';
import { haltRecordPathFor } from './restack/halt-record-bookkeeping.js';
import { parseCommitSha, type CommitSha, type RefName } from './restack/restack-types.js';
import { makeGitRunner, type GitRunner } from './rebase.js';

const ZERO_SHA = '0'.repeat(40) as CommitSha;

export interface HaltRecordRefDependencies {
  readonly git?: GitRunner;
}

export type AppendHaltRecordRefResult =
  | { readonly kind: 'updated'; readonly commit: CommitSha }
  | { readonly kind: 'stale' }
  | { readonly kind: 'unavailable' };

export type ReadHaltRecordRefResult =
  | { readonly kind: 'record'; readonly text: string; readonly commit: CommitSha; readonly source: 'ref' | 'head' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unavailable' };

export function haltRecordRefFor(slug: string): RefName {
  return `refs/conductor/${slug}/halt-record` as RefName;
}

async function runGit(git: GitRunner, args: string[], input?: string, env?: NodeJS.ProcessEnv) {
  try {
    return await git(args, {
      ...(input === undefined ? {} : { input }),
      ...(env === undefined ? {} : { env }),
    });
  } catch {
    return undefined;
  }
}

async function writeTree(git: GitRunner, slug: string, text: string): Promise<CommitSha | undefined> {
  const blob = await runGit(git, ['hash-object', '-w', '--stdin'], text);
  const record = blob?.exitCode === 0 ? parseCommitSha(blob.stdout.trim()) : undefined;
  if (!record) return undefined;
  const halted = await runGit(git, ['mktree'], `100644 blob ${record}\t${slug}.md\n`);
  const haltedTree = halted?.exitCode === 0 ? parseCommitSha(halted.stdout.trim()) : undefined;
  if (!haltedTree) return undefined;
  const docs = await runGit(git, ['mktree'], `040000 tree ${haltedTree}\thalted\n`);
  const docsTree = docs?.exitCode === 0 ? parseCommitSha(docs.stdout.trim()) : undefined;
  if (!docsTree) return undefined;
  const root = await runGit(git, ['mktree'], `040000 tree ${docsTree}\t.docs\n`);
  return root?.exitCode === 0 ? parseCommitSha(root.stdout.trim()) : undefined;
}

/** Append one independently-addressable halt record without changing any branch tip. */
export async function appendHaltRecordRef(
  worktree: string,
  slug: string,
  text: string,
  expected: CommitSha | undefined,
  dependencies: HaltRecordRefDependencies = {},
): Promise<AppendHaltRecordRefResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const tree = await writeTree(git, slug, text);
  if (!tree) return { kind: 'unavailable' };
  const committed = await runGit(git, [
    'commit-tree', tree,
    ...(expected === undefined ? [] : ['-p', expected]),
  ], `halt record: ${slug}\n`, withEngineCommitEnv());
  const commit = committed?.exitCode === 0 ? parseCommitSha(committed.stdout.trim()) : undefined;
  if (!commit) return { kind: 'unavailable' };
  const updated = await runGit(git, ['update-ref', '--stdin'], [
    'start',
    `update ${haltRecordRefFor(slug)} ${commit} ${expected ?? ZERO_SHA}`,
    'prepare',
    'commit',
    '',
  ].join('\n'));
  if (updated?.exitCode === 0) return { kind: 'updated', commit };
  return updated === undefined ? { kind: 'unavailable' } : { kind: 'stale' };
}

/** Read the ref-backed record first, falling back to the current branch's committed record. */
export async function readHaltRecordRef(
  worktree: string,
  slug: string,
  dependencies: HaltRecordRefDependencies = {},
): Promise<ReadHaltRecordRefResult> {
  const git = dependencies.git ?? makeGitRunner(worktree);
  const ref = haltRecordRefFor(slug);
  const resolved = await runGit(git, ['rev-parse', '-q', '--verify', ref]);
  if (resolved === undefined || (resolved.exitCode !== 0 && resolved.exitCode !== 1)) return { kind: 'unavailable' };
  const revision = resolved.exitCode === 0 ? parseCommitSha(resolved.stdout.trim()) : undefined;
  if (resolved.exitCode === 0 && !revision) return { kind: 'unavailable' };
  const source = revision === undefined ? 'HEAD' : revision;
  const record = await runGit(git, ['show', `${source}:${haltRecordPathFor(slug)}`]);
  if (record?.exitCode !== 0) return revision === undefined ? { kind: 'missing' } : { kind: 'unavailable' };
  const commit = revision ?? await (async () => {
    const head = await runGit(git, ['rev-parse', '--verify', 'HEAD']);
    return head?.exitCode === 0 ? parseCommitSha(head.stdout.trim()) : undefined;
  })();
  return commit === undefined
    ? { kind: 'unavailable' }
    : { kind: 'record', source: revision === undefined ? 'head' : 'ref', commit, text: record.stdout };
}
