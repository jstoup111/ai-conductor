/**
 * Candidate commit collector for semantic attribution verification.
 *
 * Extracts commits not yet cited by any stamp, excluding empty commits and
 * engine bookkeeping commits (env-exempt class). Returns candidates with
 * sha, subject, and full diff for input assembly.
 */

import { execa } from 'execa';
import type { TaskEvidence } from './task-evidence.js';
import type { GitRunner } from './rebase.js';
import { filesForCommit } from './autoheal.js';

/**
 * A candidate commit: uncited, non-empty, non-bookkeeping.
 * Returned with full diff for verifier input assembly.
 */
export interface CandidateCommit {
  sha: string;
  subject: string;
  diff: string;
}

/**
 * Collect commits from a range that are not yet attributed.
 *
 * Filters out:
 * - Commits already cited by any stamp in the evidence sidecar
 * - Empty commits (no file changes)
 * - Engine bookkeeping commits (identified by SHA in the provided set)
 *
 * Returns remaining commits with sha, subject, and full diff.
 * Returns empty array if no candidates exist.
 *
 * @param git - GitRunner for executing git commands
 * @param evidence - TaskEvidence sidecar with cited commit tracking
 * @param range - Git commit range (e.g., "origin/main..HEAD")
 * @param bookkeepingCommits - Optional set of engine bookkeeping commit SHAs to exclude
 * @param projectRoot - Project root directory (defaults to '.')
 * @returns Array of candidate commits with diff
 */
export async function collectCandidateCommits(
  git: GitRunner,
  evidence: TaskEvidence,
  range: string,
  bookkeepingCommits?: Set<string>,
  projectRoot: string = '.',
): Promise<CandidateCommit[]> {
  const bookkeeping = bookkeepingCommits || new Set<string>();

  // Get commits in the range with subject using git runner
  const logResult = await git(['log', '--format=%H%x09%s', range]);

  if (logResult.exitCode !== 0 || typeof logResult.stdout !== 'string') {
    return [];
  }

  const commits = logResult.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf('\t');
      if (tab < 0) return null;
      return { sha: line.slice(0, tab), subject: line.slice(tab + 1) };
    })
    .filter((c): c is { sha: string; subject: string } => c !== null);

  const candidates: CandidateCommit[] = [];

  for (const commit of commits) {
    // Filter 1: Already cited by any stamp
    let isCited = false;
    for (const stamp of evidence.evidenceStamps.values()) {
      if (stamp.sha === commit.sha) {
        isCited = true;
        break;
      }
    }
    if (isCited) continue;

    // Filter 2: Empty commits
    const files = await filesForCommit(projectRoot, commit.sha);
    if (files.length === 0) continue;

    // Filter 3: Engine bookkeeping commits
    if (bookkeeping.has(commit.sha)) continue;

    // Get the full diff for this commit using git runner
    const showResult = await git(['show', commit.sha]);

    if (showResult.exitCode === 0 && typeof showResult.stdout === 'string') {
      candidates.push({
        sha: commit.sha,
        subject: commit.subject,
        diff: showResult.stdout,
      });
    }
  }

  return candidates;
}
