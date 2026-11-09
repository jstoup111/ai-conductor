import { type ChildId } from '../child-context.js';
import { leafBranchFor } from '../feature-branch-identity.js';
import { type GitRunner } from '../rebase.js';
import { readRouteRecord } from '../routing/route-record-store.js';
import { closureRefFor } from '../routing/routing-refs.js';
import { parseRoundId, type RoundId } from '../routing/route-types.js';
import { parseCommitSha, type CommitSha } from './restack-types.js';

export interface FoldSourceCommit {
  readonly sha: CommitSha;
  readonly roundId: RoundId;
  readonly owner: ChildId;
}

export type CollectFoldSetResult =
  | { readonly kind: 'collected'; readonly commits: readonly FoldSourceCommit[] }
  | { readonly kind: 'refused'; readonly reason: 'fold-owner-invalid'; readonly commit: CommitSha; readonly host: ChildId }
  | { readonly kind: 'unavailable' };

export interface CollectFoldSetInput {
  readonly worktree: string;
  readonly slug: string;
  readonly git: GitRunner;
}

type DeferredRange = {
  readonly host: ChildId;
  readonly roundId: RoundId;
  readonly leafEntryTip: CommitSha;
  readonly exitTip?: CommitSha;
};

function refused(commit: CommitSha, host: ChildId): Extract<CollectFoldSetResult, { readonly kind: 'refused' }> {
  return { kind: 'refused', reason: 'fold-owner-invalid', commit, host };
}

function trailerValues(message: string, key: 'Round' | 'Owner'): string[] {
  const finalParagraph = message.trimEnd().split(/\n\s*\n/).at(-1) ?? '';
  return finalParagraph.split('\n').flatMap((line) => {
    const match = line.match(new RegExp(`^${key}:\\s*(.*)\\s*$`));
    return match === null ? [] : [match[1]!];
  });
}

async function isLeafHost(git: GitRunner, slug: string, host: ChildId): Promise<boolean | undefined> {
  try {
    const closure = await git(['rev-parse', '-q', '--verify', closureRefFor(slug, host)]);
    return closure.exitCode === 1 ? true : closure.exitCode === 0 ? false : undefined;
  } catch {
    return undefined;
  }
}

async function deferredRanges(input: CollectFoldSetInput): Promise<DeferredRange[] | undefined> {
  const prefix = `refs/conductor/${input.slug}/routes/`;
  let listed;
  try {
    listed = await input.git(['for-each-ref', '--format=%(refname)', prefix]);
  } catch {
    return undefined;
  }
  if (listed.exitCode !== 0) return undefined;

  const ranges: DeferredRange[] = [];
  for (const ref of listed.stdout.split('\n').filter(Boolean)) {
    const roundId = parseRoundId(ref.slice(prefix.length));
    if (roundId === undefined || ref !== `${prefix}${roundId}`) return undefined;
    const stored = await readRouteRecord(input.worktree, input.slug, roundId, { git: input.git });
    if (stored.kind !== 'record') return undefined;
    for (const [rawHost, placement] of Object.entries(stored.record.placements ?? {})) {
      const host = Number(rawHost) as ChildId;
      if (placement.state !== 'deferred') continue;
      const leaf = await isLeafHost(input.git, input.slug, host);
      if (leaf === undefined) return undefined;
      if (leaf) continue;
      ranges.push({ host, roundId, leafEntryTip: placement.leafEntryTip, ...(placement.exitTip === undefined ? {} : { exitTip: placement.exitTip }) });
    }
  }
  return ranges;
}

async function rangeCommits(input: CollectFoldSetInput, range: DeferredRange): Promise<CommitSha[] | CollectFoldSetResult> {
  const boundary = range.exitTip ?? range.leafEntryTip;
  if (range.exitTip === undefined) return refused(boundary, range.host);
  try {
    const ancestor = await input.git(['merge-base', '--is-ancestor', range.leafEntryTip, range.exitTip]);
    if (ancestor.exitCode !== 0) return refused(boundary, range.host);
    const listed = await input.git(['rev-list', '--first-parent', '--reverse', `${range.leafEntryTip}..${range.exitTip}`]);
    if (listed.exitCode !== 0) return refused(boundary, range.host);
    const commits = listed.stdout.split('\n').filter(Boolean).map(parseCommitSha);
    return commits.every((commit): commit is CommitSha => commit !== undefined) ? commits : refused(boundary, range.host);
  } catch {
    return refused(boundary, range.host);
  }
}

async function validOwnedCommit(input: CollectFoldSetInput, commit: CommitSha, range: DeferredRange): Promise<boolean> {
  try {
    const parents = await input.git(['rev-list', '--parents', '-n', '1', commit]);
    if (parents.exitCode !== 0 || parents.stdout.trim().split(/\s+/).length !== 2) return false;
    const message = await input.git(['show', '-s', '--format=%B', commit]);
    if (message.exitCode !== 0) return false;
    const rounds = trailerValues(message.stdout, 'Round');
    const owners = trailerValues(message.stdout, 'Owner');
    return rounds.length === 1 && rounds[0] === range.roundId && owners.length === 1 && owners[0] === `c${range.host}`;
  } catch {
    return false;
  }
}

/**
 * Reads only deferred host boundary ranges. Every selected commit is a
 * first-parent, non-merge commit stamped for the round and host that own it.
 */
export async function collectFoldSet(input: CollectFoldSetInput): Promise<CollectFoldSetResult> {
  const ranges = await deferredRanges(input);
  if (ranges === undefined) return { kind: 'unavailable' };

  const commits: FoldSourceCommit[] = [];
  for (const range of ranges) {
    const listed = await rangeCommits(input, range);
    if (!Array.isArray(listed)) return listed;
    for (const commit of listed) {
      if (!await validOwnedCommit(input, commit, range)) return refused(commit, range.host);
      commits.push({ sha: commit, roundId: range.roundId, owner: range.host });
    }
  }

  if (commits.length < 2) return { kind: 'collected', commits };
  try {
    const leaf = await input.git(['rev-list', '--first-parent', '--reverse', `refs/heads/${leafBranchFor(input.slug)}`]);
    if (leaf.exitCode !== 0) return { kind: 'unavailable' };
    const order = new Map(leaf.stdout.split('\n').filter(Boolean).map((sha, index) => [sha, index]));
    if (commits.some(({ sha }) => !order.has(sha))) return { kind: 'unavailable' };
    commits.sort((left, right) => order.get(left.sha)! - order.get(right.sha)!);
  } catch {
    return { kind: 'unavailable' };
  }
  return { kind: 'collected', commits };
}
