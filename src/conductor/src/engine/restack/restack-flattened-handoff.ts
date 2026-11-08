import { withDaemonCoAuthorTrailer } from '../bot-co-author.js';
import type { GitRunner } from '../rebase.js';
import { authorOf, mergeParents, messageOf, requiredCommitSha, sideLineageCount } from './restack-commit-metadata.js';
import { selectReplayCandidates } from './restack-replay-candidates.js';
import type { ChildRange, CommitSha } from './restack-types.js';

export interface FlattenedHandoff {
  readonly todo: readonly CommitSha[];
  readonly tip: CommitSha;
  readonly candidates: readonly CommitSha[];
  readonly flattenedMergesByCommit: ReadonlyMap<CommitSha, CommitSha>;
  /** Synthetic ordinary hand-off commits mapped to their source commits. */
  readonly flattenedOrdinaryCommitsByCommit: ReadonlyMap<CommitSha, CommitSha>;
  readonly audit: {
    readonly flattenedMerges: readonly CommitSha[];
    readonly ancestryOnlyMerges: readonly CommitSha[];
    readonly sideLineageCount: number;
  };
}

export interface BuildFlattenedHandoffOptions {
  readonly comparisonCommits?: readonly CommitSha[];
  readonly haltRecordSlug?: string;
  readonly classifyMerge: (git: GitRunner, commit: CommitSha, newParent: CommitSha, mode: 'stacked') => Promise<ReplayMerge>;
}

interface ReplayMerge {
  readonly kind: 'ancestry-only' | 'q-carried' | 'flattened';
  readonly firstParent: string;
  readonly secondParent: string;
  readonly mergeTree: string;
  readonly autoTree?: string;
}

async function commitTree(git: GitRunner, commit: CommitSha): Promise<CommitSha> {
  const result = await git(['rev-parse', `${commit}^{tree}`]);
  if (result.exitCode !== 0) throw new Error(`could not read tree for ${commit}: ${result.stderr}`);
  return requiredCommitSha(result.stdout, `tree for ${commit}`);
}

async function writeLinearCommit(git: GitRunner, tree: CommitSha, parent: CommitSha, source: CommitSha, message?: string): Promise<CommitSha> {
  const [author, renderedMessage] = await Promise.all([authorOf(git, source), message === undefined ? messageOf(git, source) : message]);
  const result = await git(['commit-tree', tree, '-p', parent], {
    input: withDaemonCoAuthorTrailer(renderedMessage),
    env: {
      GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_AUTHOR_DATE: author.date,
      GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email, GIT_COMMITTER_DATE: author.date,
    },
  });
  if (result.exitCode !== 0) throw new Error(`could not write flattened hand-off commit for ${source}: ${result.stderr}`);
  return requiredCommitSha(result.stdout, `flattened hand-off commit for ${source}`);
}

async function flattenedMergeIsCarried(git: GitRunner, parent: CommitSha, newParent: CommitSha, flattened: CommitSha): Promise<boolean> {
  const [merged, newParentTree] = await Promise.all([
    git(['merge-tree', '--write-tree', '--merge-base', parent, newParent, flattened]),
    commitTree(git, newParent),
  ]);
  return merged.exitCode === 0 && merged.stdout.trim() === newParentTree;
}

/** Builds the resolver's linear hand-off without depending on its orchestration module. */
export async function buildFlattenedHandoff(range: ChildRange, newParent: CommitSha, git: GitRunner, options: BuildFlattenedHandoffOptions): Promise<FlattenedHandoff> {
  const ordinaryCandidates = new Set(await selectReplayCandidates(git, range, options.comparisonCommits, options.haltRecordSlug));
  const listed = await git(['rev-list', '--first-parent', '--reverse', `${range.oldParent}..${range.oldTip}`]);
  if (listed.exitCode !== 0) throw new Error(`could not list restack range: ${listed.stderr}`);
  const todo: CommitSha[] = [];
  const candidates: CommitSha[] = [];
  const flattenedMergesByCommit = new Map<CommitSha, CommitSha>();
  const flattenedOrdinaryCommitsByCommit = new Map<CommitSha, CommitSha>();
  const flattenedMerges: CommitSha[] = [];
  const ancestryOnlyMerges: CommitSha[] = [];
  let sideLineageCountTotal = 0;
  let accumulator = range.oldParent;
  for (const raw of listed.stdout.split('\n').filter(Boolean)) {
    const commit = requiredCommitSha(raw, 'flattened hand-off range entry');
    const parents = await mergeParents(git, commit);
    if (parents.length < 2) {
      accumulator = await writeLinearCommit(git, await commitTree(git, commit), accumulator, commit);
      flattenedOrdinaryCommitsByCommit.set(accumulator, commit);
      if (ordinaryCandidates.has(commit)) { todo.push(commit); candidates.push(commit); }
      continue;
    }
    const merge = await options.classifyMerge(git, commit, newParent, 'stacked');
    sideLineageCountTotal += await sideLineageCount(git, requiredCommitSha(merge.firstParent, `first parent for ${commit}`), requiredCommitSha(merge.secondParent, `second parent for ${commit}`));
    if (merge.kind === 'ancestry-only') {
      accumulator = await writeLinearCommit(git, requiredCommitSha(merge.mergeTree, `automatic tree for ${commit}`), accumulator, commit);
      ancestryOnlyMerges.push(commit);
      continue;
    }
    if (merge.kind === 'q-carried') {
      accumulator = await writeLinearCommit(git, requiredCommitSha(merge.autoTree ?? '', `automatic tree for ${commit}`), accumulator, commit);
    }
    else flattenedMerges.push(commit);
    const flattenedParent = accumulator;
    const flattened = await writeLinearCommit(git, requiredCommitSha(merge.mergeTree, `merge tree for ${commit}`), accumulator, commit, `${await messageOf(git, commit)}\nFlattened-merge: ${commit}\n`);
    accumulator = flattened;
    flattenedMergesByCommit.set(flattened, commit);
    if (!(await flattenedMergeIsCarried(git, flattenedParent, newParent, flattened))) { todo.push(flattened); candidates.push(flattened); }
  }
  return { todo, tip: accumulator, candidates, flattenedMergesByCommit, flattenedOrdinaryCommitsByCommit, audit: { flattenedMerges, ancestryOnlyMerges, sideLineageCount: sideLineageCountTotal } };
}

export async function replayCandidateSubjects(git: GitRunner, candidates: readonly CommitSha[]): Promise<string[]> {
  const subjects: string[] = [];
  for (const candidate of candidates) {
    const result = await git(['show', '-s', '--format=%s', candidate]);
    if (result.exitCode !== 0 || result.stdout.trim() === '') throw new Error(`could not read restack replay subject for ${candidate}`);
    subjects.push(result.stdout.trim());
  }
  return subjects;
}
