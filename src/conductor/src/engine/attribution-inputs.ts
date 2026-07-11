/**
 * Candidate commit collector and residue input assembler for semantic
 * attribution verification.
 *
 * Extracts commits not yet cited by any stamp, excluding empty commits and
 * engine bookkeeping commits (env-exempt class). Returns candidates with
 * sha, subject, and full diff for input assembly.
 *
 * Input assembly gathers task definitions and candidate commits into a
 * prompt object, deliberately starving the inputs to avoid leaking
 * implementation state (task-status.json, maker-summary artifacts).
 * Pattern: mirror build-review-inputs.ts isolation model.
 */

import { readFile } from 'node:fs/promises';
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

/**
 * Verifier inputs: residue task sections, candidate commits, and file declarations.
 * Deliberately excludes task-status.json and maker-summary artifacts.
 */
export interface AttributionInputs {
  /** Assembled task sections + candidate commits, ready for verifier input. */
  prompt: string;
}

/**
 * Assemble attribution verifier inputs: residue task sections + candidates.
 *
 * Reads the plan file and extracts task sections for the given residue IDs,
 * includes candidate commits with sha/subject/diff, and preserves Files: lines.
 * Deliberately excludes task-status.json content and maker-summary artifacts
 * (input isolation — the verifier judges diffs against tasks, never maker narrative).
 *
 * Pattern mirrors build-review-inputs.ts: Inputs are strictly
 * (planPath, residueIds, candidates) — no conductor state, no sidecars.
 *
 * @param planPath - Path to the plan file
 * @param residueIds - Array of task IDs needing attribution verification
 * @param candidates - Candidate commits from collectCandidateCommits (sha/subject/diff)
 * @returns String prompt assembled from plan tasks + candidates, ready for verifier
 */
export async function assembleAttributionInputs(
  planPath: string,
  residueIds: string[],
  candidates: CandidateCommit[],
): Promise<string> {
  const planBody = await readFile(planPath, 'utf-8');

  // Parse task sections: extract lines between "### Task {id}" and the next task or EOF
  // Pattern: "### Task N:" or "### Task N — " followed by content until next "### Task" or end
  const taskSections: Record<string, string[]> = {};

  const lines = planBody.split('\n');
  let currentTaskId: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    // Match task headers: "### Task {number}" at the beginning
    const taskMatch = line.match(/^###\s+Task\s+(\d+)/);
    if (taskMatch) {
      // Save the previous task if exists
      if (currentTaskId !== null) {
        taskSections[currentTaskId] = currentLines;
      }
      // Start new task
      currentTaskId = taskMatch[1];
      currentLines = [line];
    } else if (currentTaskId !== null) {
      // Collect lines for current task (but skip Maker Summary section)
      // Deliberately exclude maker-summary content by stopping at certain markers
      if (line.match(/^##\s+Maker\s+Summary/) || line.match(/^##\s+maker-summary/)) {
        // Stop collecting task lines when we hit a Maker Summary section
        break;
      }
      currentLines.push(line);
    }
  }

  // Save the last task
  if (currentTaskId !== null) {
    taskSections[currentTaskId] = currentLines;
  }

  // Assemble output: task sections for residue IDs + candidate commits
  const output: string[] = [];

  output.push('## Residue Tasks for Attribution Verification\n');

  // Add task sections for each residue ID (preserve order of residueIds)
  for (const taskId of residueIds) {
    if (taskSections[taskId]) {
      // Join lines and trim trailing empty lines within the task
      const taskContent = taskSections[taskId].join('\n').trimEnd();
      output.push(taskContent);
      output.push('');
    }
  }

  // Add candidate commits section
  if (candidates.length > 0) {
    output.push('## Candidate Commits\n');
    for (const candidate of candidates) {
      output.push(`### Commit ${candidate.sha}`);
      output.push(`**Subject:** ${candidate.subject}`);
      output.push('');
      output.push('**Diff:**');
      output.push('```');
      output.push(candidate.diff);
      output.push('```');
      output.push('');
    }
  }

  return output.join('\n');
}
