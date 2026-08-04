import { parseReleaseDisposition, type ReleaseDisposition } from './release-metadata.js';

export interface ReleaseCandidatePullRequest {
  number: number;
  merged: boolean;
  mergedAt: string | null;
  mergeSha: string;
  body: string;
}

export interface ReleaseCandidateGit {
  latestTag(): Promise<string>;
  /**
   * Every commit that landed on the base branch after `tag`. Repositories that
   * disable merge commits land each PR as a single-parent squash or rebase
   * commit, so this range is not restricted to merge commits.
   */
  mergeRange(tag: string): Promise<string[]>;
}

export interface ReleaseCandidateGithub {
  listMergedPullRequests(page: number): Promise<{
    items: ReleaseCandidatePullRequest[];
    hasNextPage: boolean;
    totalCount: number;
  }>;
  /**
   * Merged pull requests GitHub associates with a commit that is not itself any
   * pull request's merge sha. A rebase merge replays every branch commit onto
   * the base branch and reports only the last one as `merge_commit_sha`; the
   * earlier ones are explained by the same pull request. Omitting this reader,
   * or failing the lookup, leaves such a commit unexplained (fail-closed).
   */
  pullRequestNumbersForCommit?(commitSha: string): Promise<number[]>;
}

export interface ReleaseCandidate {
  number: number;
  mergedAt: string;
  mergeSha: string;
  disposition: ReleaseDisposition;
}

export interface ReleaseCandidateCollection {
  latestTag: string;
  mergeCommits: string[];
  candidates: ReleaseCandidate[];
  audit: ReleaseCandidateAudit[];
  completeness: ReleaseCandidateCompleteness;
}

export interface ReleaseCandidateAudit {
  number: number;
  mergeSha: string;
  disposition: ReleaseDisposition['disposition'];
}

export type ReleaseCandidateIncompleteReason =
  | { kind: 'unreachable-page'; page: number }
  | { kind: 'truncated-total'; expected: number; actual: number }
  | { kind: 'unexplained-merge'; mergeSha: string }
  | { kind: 'duplicate-pr'; number: number }
  | { kind: 'duplicate-merge'; mergeSha: string }
  | { kind: 'invalid-disposition'; number: number };

export type ReleaseCandidateCompleteness =
  | { status: 'complete' }
  | { status: 'incomplete'; reasons: ReleaseCandidateIncompleteReason[] };

export async function collectReleaseCandidates(input: {
  git: ReleaseCandidateGit;
  github: ReleaseCandidateGithub;
}): Promise<ReleaseCandidateCollection> {
  const latestTag = await input.git.latestTag();
  const mergeCommits = await input.git.mergeRange(latestTag);
  const pullRequests: ReleaseCandidatePullRequest[] = [];
  let totalCount: number | undefined;

  for (let page = 1; ; page += 1) {
    let result: Awaited<ReturnType<ReleaseCandidateGithub['listMergedPullRequests']>>;
    try {
      result = await input.github.listMergedPullRequests(page);
    } catch {
      return incompleteCollection(latestTag, mergeCommits, pullRequests, [{ kind: 'unreachable-page', page }]);
    }

    totalCount ??= result.totalCount;
    pullRequests.push(...result.items);
    if (!result.hasNextPage) break;
  }

  const reasons: ReleaseCandidateIncompleteReason[] = [];
  if (pullRequests.length !== totalCount) {
    reasons.push({ kind: 'truncated-total', expected: totalCount!, actual: pullRequests.length });
  }
  const uniqueMergeCommits = new Set<string>();
  for (const mergeSha of mergeCommits) {
    if (uniqueMergeCommits.has(mergeSha)) reasons.push({ kind: 'duplicate-merge', mergeSha });
    else uniqueMergeCommits.add(mergeSha);
  }

  const mergedPullRequests = pullRequests.filter(
    (pullRequest) => pullRequest.merged && pullRequest.mergedAt !== null,
  );
  const pullRequestsByMerge = new Map<string, ReleaseCandidatePullRequest[]>();
  const seenNumbers = new Set<number>();
  const seenMergeShas = new Set<string>();

  for (const pullRequest of mergedPullRequests) {
    if (seenNumbers.has(pullRequest.number)) reasons.push({ kind: 'duplicate-pr', number: pullRequest.number });
    else seenNumbers.add(pullRequest.number);
    if (seenMergeShas.has(pullRequest.mergeSha)) reasons.push({ kind: 'duplicate-merge', mergeSha: pullRequest.mergeSha });
    else seenMergeShas.add(pullRequest.mergeSha);

    const matchingPullRequests = pullRequestsByMerge.get(pullRequest.mergeSha) ?? [];
    matchingPullRequests.push(pullRequest);
    pullRequestsByMerge.set(pullRequest.mergeSha, matchingPullRequests);
  }

  const candidates: ReleaseCandidate[] = [];
  const audit: ReleaseCandidateAudit[] = [];
  const candidateNumbers = new Set(
    [...uniqueMergeCommits].flatMap((mergeSha) =>
      (pullRequestsByMerge.get(mergeSha) ?? []).map((pullRequest) => pullRequest.number)),
  );
  for (const mergeSha of uniqueMergeCommits) {
    const matchingPullRequests = pullRequestsByMerge.get(mergeSha) ?? [];
    if (matchingPullRequests.length === 0) {
      // A rebase-merged pull request contributes its non-head commits to this
      // range too. Those are already represented by the pull request's own
      // merge sha, so attributing them keeps the range complete without
      // duplicating a candidate. Anything else — a direct push, or a commit
      // whose pull request is outside this range — stays unexplained.
      if (await isExplainedByRangePullRequest(input.github, mergeSha, candidateNumbers)) continue;
      reasons.push({ kind: 'unexplained-merge', mergeSha });
      continue;
    }

    for (const pullRequest of matchingPullRequests) {
      try {
        const disposition = parseReleaseDisposition(pullRequest.body);
        audit.push({ number: pullRequest.number, mergeSha, disposition: disposition.disposition });
        candidates.push({
          number: pullRequest.number,
          mergedAt: pullRequest.mergedAt!,
          mergeSha,
          disposition,
        });
      } catch {
        reasons.push({ kind: 'invalid-disposition', number: pullRequest.number });
      }
    }
  }

  candidates.sort((left, right) => left.mergedAt.localeCompare(right.mergedAt) || left.number - right.number);
  audit.sort((left, right) => left.number - right.number);

  if (reasons.length > 0) {
    return { latestTag, mergeCommits, candidates: [], audit, completeness: { status: 'incomplete', reasons } };
  }

  return { latestTag, mergeCommits, candidates, audit, completeness: { status: 'complete' } };
}

async function isExplainedByRangePullRequest(
  github: ReleaseCandidateGithub,
  commitSha: string,
  candidateNumbers: ReadonlySet<number>,
): Promise<boolean> {
  if (github.pullRequestNumbersForCommit === undefined) return false;
  try {
    const numbers = await github.pullRequestNumbersForCommit(commitSha);
    return numbers.some((number) => candidateNumbers.has(number));
  } catch {
    return false;
  }
}

function incompleteCollection(
  latestTag: string,
  mergeCommits: string[],
  pullRequests: ReleaseCandidatePullRequest[],
  reasons: ReleaseCandidateIncompleteReason[],
): ReleaseCandidateCollection {
  const audit = pullRequests
    .filter((pullRequest) => pullRequest.merged && pullRequest.mergedAt !== null)
    .flatMap((pullRequest) => {
      try {
        return [{
          number: pullRequest.number,
          mergeSha: pullRequest.mergeSha,
          disposition: parseReleaseDisposition(pullRequest.body).disposition,
        }];
      } catch {
        return [];
      }
    })
    .sort((left, right) => left.number - right.number);
  return { latestTag, mergeCommits, candidates: [], audit, completeness: { status: 'incomplete', reasons } };
}
