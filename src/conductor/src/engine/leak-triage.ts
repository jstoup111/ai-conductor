/**
 * Triage for worktree isolation breaches ("dirty edit leaks" into MAIN checkout).
 *
 * Parses git status --porcelain output to extract dirty state classification.
 */

export interface DirtyStatus {
  /** Files modified in the working tree */
  modified: string[];
  /** Files staged for commit (in index) */
  staged: string[];
  /** Untracked files */
  untracked: string[];
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
