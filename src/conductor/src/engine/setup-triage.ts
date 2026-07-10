/**
 * Setup-failure triage engine — two-stage classification of tree state and
 * setup outcomes for the daemon's setup-before-dispatch flow.
 *
 * TS-2 (dirty vs clean routing): `classifyTree` determines if the working
 * tree has uncommitted changes using `git status --porcelain`.
 *
 * TS-3 (clean-HEAD routing): Additional triage outcomes for handling
 * setup results.
 *
 * Design constraint: GitRunner is injected so helpers are unit-testable
 * without a real repo.
 */

/** Minimal git runner — injected so the helpers are unit-testable without a repo. */
export interface GitRunner {
  (args: string[]): Promise<GitResult>;
}

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Tree classification outcome from classifyTree.
 * - 'clean': working tree has no uncommitted changes (git status --porcelain is empty)
 * - 'dirty': working tree has uncommitted changes (modified, staged, or untracked files)
 */
export type TreeState = 'clean' | 'dirty';

/**
 * Triage outcome for setup handling — a discriminated union representing
 * the result of the two-stage setup-failure triage.
 *
 * Variants:
 *   - `pass`: setup succeeded without issues
 *   - `quarantined-pass`: setup passed but with quarantine flag
 *   - `fixed-pass`: setup recovered from a prior failure
 *   - `park`: setup failed and needs to be parked
 *
 * Each variant includes evidence fields:
 *   - `outputTail`: tail of the setup output for diagnostics
 *   - `quarantineRef?`: ref to quarantine state if applicable
 *   - `preservedPaths?`: paths preserved during recovery if applicable
 *   - `contractOutcome?`: contract verification outcome if applicable
 */
export type TriageOutcome =
  | {
      kind: 'pass';
      outputTail: string;
      quarantineRef?: never;
      preservedPaths?: never;
      contractOutcome?: never;
    }
  | {
      kind: 'quarantined-pass';
      outputTail: string;
      quarantineRef: string;
      preservedPaths?: never;
      contractOutcome?: never;
    }
  | {
      kind: 'fixed-pass';
      outputTail: string;
      quarantineRef?: never;
      preservedPaths: string[];
      contractOutcome?: string;
    }
  | {
      kind: 'park';
      outputTail: string;
      quarantineRef?: never;
      preservedPaths?: never;
      contractOutcome?: string;
    };

/**
 * Classify the working tree as clean or dirty based on `git status --porcelain`.
 *
 * Returns:
 *   - 'clean': no uncommitted changes
 *   - 'dirty': uncommitted changes present (modified, staged, untracked, deleted, renamed)
 */
export async function classifyTree(git: GitRunner): Promise<TreeState> {
  const result = await git(['status', '--porcelain']);

  // Empty stdout means clean working tree; any non-empty output means dirty
  if (result.exitCode === 0 && result.stdout.trim() === '') {
    return 'clean';
  }

  return 'dirty';
}
