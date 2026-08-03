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
  mergeRange(tag: string): Promise<string[]>;
}

export interface ReleaseCandidateGithub {
  listMergedPullRequests(page: number): Promise<{
    items: ReleaseCandidatePullRequest[];
    hasNextPage: boolean;
  }>;
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
}

export async function collectReleaseCandidates(input: {
  git: ReleaseCandidateGit;
  github: ReleaseCandidateGithub;
}): Promise<ReleaseCandidateCollection> {
  const latestTag = await input.git.latestTag();
  const mergeCommits = await input.git.mergeRange(latestTag);
  const postTagMergeCommits = new Set(mergeCommits);
  const pullRequests: ReleaseCandidatePullRequest[] = [];

  for (let page = 1; ; page += 1) {
    const result = await input.github.listMergedPullRequests(page);
    pullRequests.push(...result.items);
    if (!result.hasNextPage) break;
  }

  const candidates = pullRequests
    .filter((pullRequest) => pullRequest.merged && pullRequest.mergedAt !== null)
    .filter((pullRequest) => postTagMergeCommits.has(pullRequest.mergeSha))
    .map((pullRequest) => ({
      number: pullRequest.number,
      mergedAt: pullRequest.mergedAt!,
      mergeSha: pullRequest.mergeSha,
      disposition: parseReleaseDisposition(pullRequest.body),
    }))
    .sort((left, right) => left.mergedAt.localeCompare(right.mergedAt) || left.number - right.number);

  return { latestTag, mergeCommits, candidates };
}
