/**
 * Triage for worktree isolation breaches ("dirty edit leaks" into MAIN checkout).
 *
 * Parses git status --porcelain output to extract dirty state classification.
 * Enumerates candidate branches with worktrees prioritized for in-flight daemon build triage.
 */

import type { GitRunner, GitResult } from './rebase.js';

export interface DirtyStatus {
  /** Files modified in the working tree */
  modified: string[];
  /** Files staged for commit (in index) */
  staged: string[];
  /** Untracked files */
  untracked: string[];
}

export interface FileClassification {
  /** Path to the modified file */
  path: string;
  /** Branch that explains this file (if any) */
  explainedBy?: string;
}

/**
 * Parse `git status --porcelain` output into a dirty status classification.
 *
 * Porcelain format (2 status chars + filename):
 * - First char: index status (space/M/A/D/R/C/U)
 * - Second char: working tree status (space/M/A/D/R/C/U)
 * - ' M' = modified in working tree only
 * - 'M ' = modified in index (staged)
 * - 'MM' = modified in both index and working tree
 * - 'D ' = deleted in index, ' D' = deleted in working tree
 * - 'R  old -> new' = renamed
 * - '??' = untracked
 *
 * @param output - Raw `git status --porcelain` output
 * @returns Object with modified, staged, and untracked file arrays
 */
export function parseDirtyStatus(output: string): DirtyStatus {
  const result: DirtyStatus = {
    modified: [],
    staged: [],
    untracked: [],
  };

  const lines = output.split('\n');

  for (const line of lines) {
    // Skip empty lines and comments
    if (!line.trim()) {
      continue;
    }

    // Lines are at least 3 chars (2 status chars + space + filename)
    if (line.length < 3) {
      continue;
    }

    const statusIndex = line.charAt(0);
    const statusWorking = line.charAt(1);
    const filename = line.substring(3);

    // Handle untracked files
    if (statusIndex === '?' && statusWorking === '?') {
      result.untracked.push(filename);
      continue;
    }

    // Handle renames and copies (treat as modified, not staged)
    if (statusIndex === 'R' || statusIndex === 'C') {
      // Renames/copies show as "R  old -> new"
      result.modified.push(filename);
      continue;
    }

    // Check if file is deleted (always treat as modified)
    if (statusIndex === 'D' || statusWorking === 'D') {
      result.modified.push(filename);
    } else {
      // Check if file is modified in working tree (working tree status is not space)
      if (statusWorking !== ' ') {
        result.modified.push(filename);
      }
    }

    // Check if file is staged (index status is not space, and not a rename/copy)
    if (statusIndex !== ' ') {
      result.staged.push(filename);
    }
  }

  // Remove duplicates while preserving order
  result.modified = Array.from(new Set(result.modified));
  result.staged = Array.from(new Set(result.staged));
  result.untracked = Array.from(new Set(result.untracked));

  return result;
}

/**
 * Enumerate candidate branches for leak triage, prioritizing worktree branches.
 *
 * Returns branches in this order:
 * 1. Branches that have active worktrees (via `git worktree list --porcelain`)
 * 2. Local `feat/*` branches without worktrees (via `git for-each-ref refs/heads/feat`)
 *
 * This prioritization ensures in-flight daemon build branches (which typically use
 * worktrees) are evaluated before plain local feature branches.
 *
 * @param git - GitRunner for executing git commands
 * @returns Array of branch names (without 'refs/heads/' prefix), worktree branches first
 */
export async function enumerateCandidates(git: GitRunner): Promise<string[]> {
  // Get all active worktree branches
  const worktreeResult = await git(['worktree', 'list', '--porcelain']);
  const worktreeBranches = new Set<string>();

  if (worktreeResult.exitCode === 0) {
    // Parse worktree output: each line is "worktree <path>" or "detached"
    // We need to get the branch name from the detached HEAD or follow the path
    const worktreeLines = worktreeResult.stdout.split('\n').filter((l) => l.trim());

    for (const line of worktreeLines) {
      // Format: "worktree <path>" or "detached"
      // We need to extract branch info. Let's use git branch -a --contains to find the branch
      if (line.startsWith('worktree ')) {
        const path = line.substring('worktree '.length).trim();
        if (!path) continue;

        // For each worktree, get the current branch using git -C
        const branchResult = await git(['--work-tree', path, 'rev-parse', '--abbrev-ref', 'HEAD']);
        if (branchResult.exitCode === 0) {
          const branch = branchResult.stdout.trim();
          // Only include feat/* branches
          if (branch && branch !== 'HEAD' && branch.startsWith('feat/')) {
            worktreeBranches.add(branch);
          }
        }
      }
    }
  }

  // Get all local feat/* branches via git for-each-ref
  const refResult = await git(['for-each-ref', 'refs/heads/feat', '--format=%(refname:short)']);
  const allFeatBranches = new Set<string>();

  if (refResult.exitCode === 0) {
    const lines = refResult.stdout.split('\n').filter((l) => l.trim());
    for (const branch of lines) {
      allFeatBranches.add(branch);
    }
  }

  // Return worktree branches first, then other feat branches
  const result: string[] = [];

  // Add worktree branches in the order they were discovered
  for (const branch of worktreeBranches) {
    result.push(branch);
  }

  // Add non-worktree feat branches
  for (const branch of allFeatBranches) {
    if (!worktreeBranches.has(branch)) {
      result.push(branch);
    }
  }

  return result;
}

/**
 * Classify modified files by comparing their content hash against candidate branches.
 *
 * For each modified file, computes its content hash via `git hash-object` and
 * checks it against each candidate branch via `git rev-parse <branch>:<path>`.
 * If a match is found, the file is "explained by" that branch.
 *
 * This helps identify which edits in the working tree may have leaked from
 * worktree isolation — files byte-identical to a candidate branch indicate
 * the source of the leak.
 *
 * @param git - GitRunner for executing git commands
 * @param candidates - List of candidate branch names to check against
 * @param modifiedFiles - List of file paths that have been modified
 * @returns Array of classifications, one per modified file, with optional explainedBy
 */
export async function classifyModifiedFiles(
  git: GitRunner,
  candidates: string[],
  modifiedFiles: string[],
): Promise<FileClassification[]> {
  const classifications: FileClassification[] = [];

  for (const filePath of modifiedFiles) {
    const classification: FileClassification = { path: filePath };

    // Get the hash of the modified file in the working tree
    const fileHashResult = await git(['hash-object', filePath]);
    if (fileHashResult.exitCode !== 0) {
      // File doesn't exist or can't be hashed, mark as unexplained
      classifications.push(classification);
      continue;
    }

    const fileHash = fileHashResult.stdout.trim();
    if (!fileHash) {
      classifications.push(classification);
      continue;
    }

    // Check against each candidate branch in order
    for (const branch of candidates) {
      // Get the blob hash of the file in the candidate branch
      const blobResult = await git(['rev-parse', `${branch}:${filePath}`]);
      if (blobResult.exitCode === 0) {
        const blobHash = blobResult.stdout.trim();
        // Compare the hashes
        if (fileHash === blobHash) {
          classification.explainedBy = branch;
          break;
        }
      }
    }

    classifications.push(classification);
  }

  return classifications;
}
