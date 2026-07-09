/**
 * Triage for worktree isolation breaches ("dirty edit leaks" into MAIN checkout).
 *
 * Parses git status --porcelain output to extract dirty state classification.
 * Enumerates candidate branches with worktrees prioritized for in-flight daemon build triage.
 */

import type { GitRunner, GitResult } from './rebase.js';

export interface TriageResult {
  /** Whether the triage can proceed with healing (no staged changes present) */
  healable: boolean;
  /** Whether healing is possible given the current state (no unexplained modifications) */
  canHeal: boolean;
  /** File classifications with optional explainedBy branch */
  classifications: FileClassification[];
}

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
  /** All branches that explain this file (if multiple match byte-for-byte) */
  allExplainedBy?: string[];
}

export interface HealPlan {
  /** Whether all dirty state can be healed */
  canHeal: boolean;
  /** The single branch explaining everything (if canHeal is true) */
  explainedBy?: string;
  /** All branches that explain everything (if multiple candidates match byte-for-byte) */
  explainedByAll?: string[];
  /** Files to restore via git restore */
  filesToRestore: string[];
  /** Untracked strays to delete */
  filesToDelete: string[];
  /** If canHeal is false, why healing is vetoed */
  reason?: string;
}

export interface ReVerificationResult {
  /** Whether re-verification passed (all hashes match) */
  verified: boolean;
  /** The file that failed re-verification (if verified is false) */
  failedFile?: string;
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
 * Classify untracked (stray) files by checking if their content hash exists
 * in the blob set of any candidate branch.
 *
 * For each untracked file, computes its content hash via `git hash-object` and
 * checks it against the blob hashes in each candidate branch via `git ls-tree -r`.
 * If a match is found, the file is "explained by" that branch.
 *
 * This helps identify which untracked files may have leaked from worktree isolation —
 * files whose content matches a blob in a candidate branch indicate a potential source.
 *
 * @param git - GitRunner for executing git commands
 * @param candidates - List of candidate branch names to check against
 * @param untrackedFiles - List of untracked file paths
 * @returns Array of classifications, one per untracked file, with optional explainedBy
 */
export async function classifyStrays(
  git: GitRunner,
  candidates: string[],
  untrackedFiles: string[],
): Promise<FileClassification[]> {
  const classifications: FileClassification[] = [];

  for (const filePath of untrackedFiles) {
    const classification: FileClassification = { path: filePath };
    const allMatching: string[] = [];

    // Get the hash of the untracked file in the working tree
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

    // Check against each candidate branch to find ALL that match
    for (const branch of candidates) {
      // Get all blob hashes in the candidate branch tree
      const treeResult = await git(['ls-tree', '-r', branch]);
      if (treeResult.exitCode === 0 && treeResult.stdout) {
        // Parse ls-tree output: each line is "mode type hash\tpath"
        // We extract the hash (third field)
        const blobHashes = new Set<string>();
        const lines = treeResult.stdout.split('\n').filter((l) => l.trim());

        for (const line of lines) {
          // Format: "100644 blob <hash>\t<path>"
          const parts = line.split(/\s+/);
          if (parts.length >= 3) {
            // The hash is the third field
            const blobHash = parts[2];
            blobHashes.add(blobHash);
          }
        }

        // Check if our file's hash is in this branch's blob set
        if (blobHashes.has(fileHash)) {
          allMatching.push(branch);
          if (!classification.explainedBy) {
            classification.explainedBy = branch;
          }
        }
      }
    }

    // Store all matching candidates if we found any
    if (allMatching.length > 0) {
      classification.allExplainedBy = allMatching;
    }

    classifications.push(classification);
  }

  return classifications;
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
    const allMatching: string[] = [];

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

    // Check against each candidate branch to find ALL that match
    for (const branch of candidates) {
      // Get the blob hash of the file in the candidate branch
      const blobResult = await git(['rev-parse', `${branch}:${filePath}`]);
      if (blobResult.exitCode === 0) {
        const blobHash = blobResult.stdout.trim();
        // Compare the hashes
        if (fileHash === blobHash) {
          allMatching.push(branch);
          if (!classification.explainedBy) {
            classification.explainedBy = branch;
          }
        }
      }
    }

    // Store all matching candidates if we found any
    if (allMatching.length > 0) {
      classification.allExplainedBy = allMatching;
    }

    classifications.push(classification);
  }

  return classifications;
}

/**
 * Triage workflow for modified files in the main checkout.
 *
 * Orchestrates parseDirtyStatus, enumerateCandidates, and classifyModifiedFiles
 * to determine whether a dirty working tree can be healed (all modifications
 * explained by candidate branches) and whether healing is feasible (no staged changes).
 *
 * Returns early if any staged modifications are present (staged abort), marking
 * the result as not healable to prevent healing attempts while staged changes exist.
 *
 * @param git - GitRunner for executing git commands
 * @param defaultBranchForStatus - Optional default branch name for status lookup (only used when git is a spied/mock runner)
 * @param candidateOverride - Optional explicit candidate list (primarily for testing); when provided, skips enumerateCandidates
 * @returns TriageResult with healable, canHeal flags and file classifications
 */
export async function triageModifiedFiles(
  git: GitRunner,
  defaultBranchForStatus?: string,
  candidateOverride?: string[],
): Promise<TriageResult> {
  // Get the dirty status
  const statusResult = await git(['status', '--porcelain']);
  if (statusResult.exitCode !== 0) {
    // If we can't get status, treat as not healable
    return {
      healable: false,
      canHeal: false,
      classifications: [],
    };
  }

  const dirtyStatus = parseDirtyStatus(statusResult.stdout);

  // Guard 1: Staged abort — if any staged modifications exist, return not-healable immediately
  if (dirtyStatus.staged.length > 0) {
    return {
      healable: false,
      canHeal: false,
      classifications: dirtyStatus.modified.map((path) => ({ path })),
    };
  }

  // If no modified files, nothing to triage
  if (dirtyStatus.modified.length === 0) {
    return {
      healable: true,
      canHeal: true,
      classifications: [],
    };
  }

  // Get candidates (or use override for testing)
  let candidates: string[] = candidateOverride ?? [];
  if (!candidateOverride) {
    candidates = await enumerateCandidates(git);
  }

  // Guard 2 & 3: Zero candidates or missing path
  // If there are no candidates, all modified files are unexplained
  if (candidates.length === 0) {
    return {
      healable: true, // No staged changes, so technically healable
      canHeal: false, // But no candidates to explain the modifications
      classifications: dirtyStatus.modified.map((path) => ({ path })),
    };
  }

  // Classify the modified files
  const classifications = await classifyModifiedFiles(git, candidates, dirtyStatus.modified);

  // Determine if all files are explained
  const allExplained = classifications.every((c) => c.explainedBy !== undefined);

  return {
    healable: true,
    canHeal: allExplained,
    classifications,
  };
}

/**
 * Re-verify byte-identity of files in a heal plan immediately before restoration.
 *
 * Implements TOCTOU (Time-of-Check Time-of-Use) protection: computes the content hash
 * of each file in filesToRestore via `git hash-object` and compares against the originally
 * classified hash. This catches cases where a file's content changed between the initial
 * classification (planHeal) and the actual restore execution (fastForwardRoot).
 *
 * If ANY file's current hash differs from its expected hash, the entire heal is aborted.
 * This fail-closed approach ensures we never restore a file with unexpected content.
 *
 * @param git - GitRunner for executing git commands
 * @param healPlan - The heal plan containing filesToRestore (the files that were classified)
 * @param expectedHashes - Map of file path to its originally computed hash
 * @returns ReVerificationResult with verified flag and optional failedFile
 */
export async function reVerifyHealPlan(
  git: GitRunner,
  healPlan: HealPlan,
  expectedHashes: Map<string, string>,
): Promise<ReVerificationResult> {
  // Re-hash each file to restore and verify it still matches the original hash
  for (const filePath of healPlan.filesToRestore) {
    const currentHashResult = await git(['hash-object', filePath]);
    if (currentHashResult.exitCode !== 0) {
      // File disappeared or can't be hashed — treat as verification failure
      return {
        verified: false,
        failedFile: filePath,
      };
    }

    const currentHash = currentHashResult.stdout.trim();
    const expectedHash = expectedHashes.get(filePath);

    // If we don't have an expected hash or it doesn't match, fail verification
    if (!expectedHash || currentHash !== expectedHash) {
      return {
        verified: false,
        failedFile: filePath,
      };
    }
  }

  // All files verified successfully
  return { verified: true };
}

/**
 * Compose an all-or-nothing heal plan with stray vetoes.
 *
 * Orchestrates parseDirtyStatus, classifyModifiedFiles, and classifyStrays
 * to determine whether all dirty state can be healed and what files need restoration/deletion.
 *
 * Returns early if any staged modifications are present, marking canHeal as false.
 *
 * Validates the heal plan with three vetoes:
 * 1. **No-match veto**: If ANY untracked file is unexplained (no blob match in any branch),
 *    set canHeal to false with reason "unexplained".
 * 2. **Single-branch rule**: All explained files (modified and strays) must be explained
 *    by the SAME branch. If files are explained by different branches, set canHeal to false
 *    with reason mentioning the branch conflict.
 * 3. **Gitignored exclusion**: Gitignored files are naturally absent from porcelain output,
 *    so no extra validation is needed.
 *
 * If canHeal is true, compiles:
 * - filesToRestore: modified files explained by the single branch
 * - filesToDelete: untracked strays explained by the single branch
 *
 * @param git - GitRunner for executing git commands
 * @param porcelain - Raw `git status --porcelain` output
 * @param candidates - List of candidate branch names to check against
 * @returns HealPlan with canHeal, explainedBy, restore/delete lists, and optional reason
 */
export async function healPlan(git: GitRunner, porcelain: string, candidates: string[]): Promise<HealPlan> {
  const dirtyStatus = parseDirtyStatus(porcelain);

  // Guard 1: Staged abort — if any staged modifications exist, reject healing
  if (dirtyStatus.staged.length > 0) {
    return {
      canHeal: false,
      filesToRestore: [],
      filesToDelete: [],
      reason: 'staged changes present',
    };
  }

  // If no dirty files, healing is successful (nothing to do)
  if (dirtyStatus.modified.length === 0 && dirtyStatus.untracked.length === 0) {
    return {
      canHeal: true,
      explainedBy: undefined,
      filesToRestore: [],
      filesToDelete: [],
    };
  }

  // If no candidates, all files are unexplained
  if (candidates.length === 0) {
    // Check if there are any untracked files that need explanation
    if (dirtyStatus.untracked.length > 0) {
      return {
        canHeal: false,
        filesToRestore: [],
        filesToDelete: [],
        reason: `untracked file ${dirtyStatus.untracked[0]} unexplained`,
      };
    }
    // Check if there are any modified files
    if (dirtyStatus.modified.length > 0) {
      return {
        canHeal: false,
        filesToRestore: [],
        filesToDelete: [],
        reason: `modified file ${dirtyStatus.modified[0]} unexplained`,
      };
    }
  }

  // Classify modified files and strays
  const modifiedClassifications = await classifyModifiedFiles(git, candidates, dirtyStatus.modified);
  const strayClassifications = await classifyStrays(git, candidates, dirtyStatus.untracked);

  // Combine all classifications
  const allClassifications = [...modifiedClassifications, ...strayClassifications];

  // Check for no-match veto: any unexplained file vetoes healing
  for (const classification of allClassifications) {
    if (classification.explainedBy === undefined) {
      return {
        canHeal: false,
        filesToRestore: [],
        filesToDelete: [],
        reason: `untracked file ${classification.path} unexplained`,
      };
    }
  }

  // Find the intersection of candidates that explain ALL files.
  // Start with the candidates that explain the first file, then intersect with others.
  let commonCandidates: Set<string> | null = null;

  for (const classification of allClassifications) {
    // Get all candidates that explain this file (from allExplainedBy, or fallback to explainedBy)
    const fileCandidates = new Set<string>();
    if (classification.allExplainedBy && classification.allExplainedBy.length > 0) {
      for (const candidate of classification.allExplainedBy) {
        fileCandidates.add(candidate);
      }
    } else if (classification.explainedBy) {
      fileCandidates.add(classification.explainedBy);
    }

    // Initialize commonCandidates with the first file's candidates, then intersect
    if (commonCandidates === null) {
      commonCandidates = fileCandidates;
    } else {
      // Compute intersection: keep only candidates that are in both sets
      const intersection = new Set<string>();
      for (const candidate of commonCandidates) {
        if (fileCandidates.has(candidate)) {
          intersection.add(candidate);
        }
      }
      commonCandidates = intersection;
    }
  }

  // If no common candidates, healing is impossible
  if (!commonCandidates || commonCandidates.size === 0) {
    return {
      canHeal: false,
      filesToRestore: [],
      filesToDelete: [],
      reason: 'no common candidate branch explains all files',
    };
  }

  // All validations passed, canHeal is true
  // Use the first common candidate as the primary explainedBy
  const singleBranch = Array.from(commonCandidates)[0];
  const explainedByAll = Array.from(commonCandidates).sort();

  // Compile restore/delete lists
  const filesToRestore: string[] = [];
  const filesToDelete: string[] = [];

  for (const classification of modifiedClassifications) {
    if (classification.explainedBy === singleBranch) {
      filesToRestore.push(classification.path);
    }
  }

  for (const classification of strayClassifications) {
    if (classification.explainedBy === singleBranch) {
      filesToDelete.push(classification.path);
    }
  }

  return {
    canHeal: true,
    explainedBy: singleBranch,
    explainedByAll,
    filesToRestore,
    filesToDelete,
  };
}
