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
 * TS-5 (quarantine surfacing): After a successful triage that results in
 * a quarantine-pass outcome, write a `.pipeline/QUARANTINE` sentinel file
 * to surface the quarantine ref and preserved paths to the build dispatch.
 *
 * Design constraint: GitRunner is injected so helpers are unit-testable
 * without a real repo.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

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
      quarantineRef?: string;
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

/**
 * Logger interface for injecting logging into quarantine.
 * Allows test mocks and daemon log sink injection.
 */
export interface Logger {
  log(message: string): void;
}

/**
 * Sentinel file path for surfacing quarantine state to the build dispatch.
 * Written by writeQuarantineSentinel after a successful quarantine-pass triage.
 * Contains quarantine ref, preserved paths, and recovery instructions.
 */
export const QUARANTINE_SENTINEL = '.pipeline/QUARANTINE';

/**
 * Write a `.pipeline/QUARANTINE` sentinel file to surface quarantine state
 * to the resuming agent's build dispatch context.
 *
 * The sentinel contains:
 * - Quarantine ref name (e.g., 'wip/setup-quarantine-feat-x')
 * - List of preserved paths (files that were committed to quarantine)
 * - "Recover deliberately" instruction for the human operator
 *
 * Used in TS-5 (quarantine surfacing) — called after a quarantine-pass outcome
 * to make the quarantine state visible to the build dispatch.
 *
 * Parameters:
 *   - worktreePath: path to the feature's worktree
 *   - quarantineRef: the quarantine branch ref name
 *   - preservedPaths: array of file paths preserved in the quarantine
 *
 * Best-effort: write failures are logged but do not halt triage.
 */
export async function writeQuarantineSentinel(
  worktreePath: string,
  quarantineRef: string,
  preservedPaths: string[],
  logger?: Logger,
): Promise<void> {
  try {
    await mkdir(join(worktreePath, '.pipeline'), { recursive: true });

    const pathsLine = preservedPaths.length > 0 ? `Preserved paths:\n${preservedPaths.map(p => `  - ${p}`).join('\n')}\n\n` : '';
    const content = `Quarantine ref: ${quarantineRef}

${pathsLine}Recover deliberately:
1. Review the changes in ${quarantineRef}
2. Understand why setup failed and how the fix addresses it
3. Commit the fix to the current branch
4. Remove this marker: rm .pipeline/QUARANTINE
5. Restart the daemon or re-run the feature
`;

    await writeFile(join(worktreePath, QUARANTINE_SENTINEL), content, 'utf-8');
    if (logger) {
      logger.log(`quarantine sentinel written: ${quarantineRef}, preserved ${preservedPaths.length} path(s)`);
    }
  } catch (err) {
    // Best-effort: log but do not throw
    if (logger) {
      logger.log(`quarantine sentinel write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Quarantine result from preserving dirty tree state.
 *
 * Fields:
 *   - `ref`: the quarantine branch ref name (e.g., 'wip/setup-quarantine-slug')
 *   - `preservedPaths`: array of file paths that were preserved in the quarantine branch
 */
export interface QuarantineResult {
  ref: string;
  preservedPaths: string[];
}

/**
 * Preserve all uncommitted and untracked changes in a quarantine branch,
 * then reset the working tree to clean.
 *
 * Process:
 * 1. Check if quarantine branch already exists (detect refresh)
 * 2. Capture the current dirty state (files to preserve)
 * 3. `git add -A` to stage all changes
 * 4. `git commit` to create a commit containing all changes
 * 5. Capture the new commit SHA with `git rev-parse HEAD`
 * 6. Create/force-move the branch to that SHA: `git branch -f wip/setup-quarantine-<slug> <sha>`
 * 7. Reset the working tree to clean: `git reset --hard HEAD~1`
 *
 * If the branch already existed, logs "refreshed" to the logger (if provided).
 * Old commit SHAs remain resolvable after the force-move.
 *
 * Parameters:
 *   - git: GitRunner for accessing the repository
 *   - slug: identifier for the quarantine branch (e.g., feature branch name)
 *   - logger: optional Logger for recording refresh events
 *
 * Returns:
 *   - ref: the quarantine branch ref name
 *   - preservedPaths: paths that were preserved in the quarantine branch
 */
export async function quarantine(
  git: GitRunner,
  slug: string,
  logger?: Logger,
): Promise<QuarantineResult | (TriageOutcome & { kind: 'park' })> {
  const quarantineRef = `wip/setup-quarantine-${slug}`;

  // Check if the quarantine branch already exists
  const existingRefResult = await git(['rev-parse', '--verify', quarantineRef]);
  const branchExists = existingRefResult.exitCode === 0;

  if (branchExists && logger) {
    logger.log(`quarantine branch ${quarantineRef} already exists, refreshed`);
  }

  // Capture the current dirty state before modifying anything
  const statusResult = await git(['status', '--porcelain']);
  const preservedPaths = parsePortcelainPaths(statusResult.stdout);

  // Stage all changes
  const addResult = await git(['add', '-A']);
  if (addResult.exitCode !== 0) {
    return {
      kind: 'park',
      outputTail: addResult.stderr || `git add -A failed with code ${addResult.exitCode}`,
    };
  }

  // Commit the staged changes
  const commitResult = await git(['commit', '-m', 'Quarantine before reset']);
  if (commitResult.exitCode !== 0) {
    // Commit failed — roll back the index
    await git(['reset', '--mixed', 'HEAD']);
    return {
      kind: 'park',
      outputTail: commitResult.stderr || `git commit failed with code ${commitResult.exitCode}`,
    };
  }

  // Get the SHA of the new commit
  const revResult = await git(['rev-parse', 'HEAD']);
  if (revResult.exitCode !== 0) {
    // rev-parse failed — roll back the index and return park
    await git(['reset', '--mixed', 'HEAD']);
    return {
      kind: 'park',
      outputTail: revResult.stderr || `git rev-parse HEAD failed with code ${revResult.exitCode}`,
    };
  }
  const quarantineSha = revResult.stdout.trim();

  // Create/force-move the quarantine branch at this commit
  const branchResult = await git(['branch', '-f', quarantineRef, quarantineSha]);
  if (branchResult.exitCode !== 0) {
    // branch failed — roll back the index and return park
    await git(['reset', '--mixed', 'HEAD']);
    return {
      kind: 'park',
      outputTail: branchResult.stderr || `git branch -f failed with code ${branchResult.exitCode}`,
    };
  }

  // Reset the working tree to the original HEAD (one commit back)
  const resetResult = await git(['reset', '--hard', 'HEAD~1']);
  if (resetResult.exitCode !== 0) {
    // reset failed — we're in a bad state, return park
    return {
      kind: 'park',
      outputTail: resetResult.stderr || `git reset --hard HEAD~1 failed with code ${resetResult.exitCode}`,
    };
  }

  return {
    ref: quarantineRef,
    preservedPaths,
  };
}

/**
 * Parse file paths from git status --porcelain output.
 * Each line has format: XY path, where XY is the status code.
 * We extract the path (everything after the 3rd character).
 * Note: use trimEnd() to preserve leading spaces in status codes.
 */
function parsePortcelainPaths(porcelain: string): string[] {
  const lines = porcelain.trimEnd().split('\n').filter(line => line.length > 0);
  return lines.map(line => {
    // Skip the first 3 characters (status codes + space): "XY "
    return line.substring(3);
  });
}

/**
 * Retry full prepare after quarantining a dirty tree.
 *
 * Process:
 * 1. Quarantine the dirty tree state to preserve it for inspection
 * 2. Reset the working tree to clean
 * 3. Retry the full prepare process once (runPrepare)
 * 4. On retry success: return quarantined-pass outcome
 * 5. On retry failure: return park outcome (fall through to fix-session)
 *
 * Parameters:
 *   - git: GitRunner for accessing the repository
 *   - worktreePath: path to the working tree (passed to runPrepare)
 *   - slug: identifier for the quarantine branch (e.g., feature branch name)
 *   - runPrepare: injected prepare function (takes worktreePath, performs full setup)
 *   - logger: optional Logger for recording quarantine events
 *
 * Returns:
 *   - quarantined-pass: setup succeeded after retry (ready for dispatch)
 *   - park: setup failed after retry (committed breakage, needs fix-session)
 */
export async function retryPrepareAfterQuarantine(
  git: GitRunner,
  worktreePath: string,
  slug: string,
  runPrepare: (worktreePath: string) => Promise<void>,
  logger?: Logger,
): Promise<TriageOutcome> {
  // Preserve dirty state and reset working tree to clean
  const quarantineResult = await quarantine(git, slug, logger);

  // If quarantine failed, return park immediately
  if ('kind' in quarantineResult && quarantineResult.kind === 'park') {
    return quarantineResult;
  }

  // Single retry attempt after quarantine
  try {
    await runPrepare(worktreePath);
    // Setup succeeded after retry
    return {
      kind: 'quarantined-pass',
      outputTail: '',
      quarantineRef: quarantineResult.ref,
    };
  } catch (err) {
    // Retry failed (committed breakage) — return park with output tail
    const outputTail = extractErrorOutput(err);
    return {
      kind: 'park',
      outputTail,
      quarantineRef: quarantineResult.ref,
    };
  }
}

/**
 * Extract output tail from an error thrown by runPrepare.
 * Looks for `.output` property on the error, falls back to message.
 */
function extractErrorOutput(err: unknown): string {
  if (err instanceof Error) {
    const output = (err as any).output;
    if (typeof output === 'string') {
      return output;
    }
    return err.message;
  }
  return String(err);
}

/**
 * Main entry point for setup-failure triage.
 *
 * Task 8 (zero-touch guarantees):
 * - Constructor guard: requires SetupFailureError input (no triage without failure)
 * - Happy path (clean tree): returns pass outcome with no side effects
 * - Dirty tree + failure: quarantines, retries prepare, reports outcome
 *
 * Process:
 * 1. Guard: require SetupFailureError as input (fail-closed if missing)
 * 2. Classify the tree (clean vs dirty)
 * 3. If tree is clean: return pass outcome (no quarantine needed)
 * 4. If tree is dirty: quarantine and retry prepare via retryPrepareAfterQuarantine
 *
 * Parameters:
 *   - git: GitRunner for accessing the repository
 *   - worktreePath: path to the working tree
 *   - slug: identifier for quarantine branch (e.g., feature branch name)
 *   - setupError: the classified SetupFailureError (constructor guard)
 *   - runPrepare: injected prepare function for retry (takes worktreePath, performs full setup)
 *   - logger: optional Logger for recording triage events
 *
 * Returns:
 *   - pass: tree was clean, no quarantine needed
 *   - quarantined-pass: tree was dirty, quarantined, retried successfully
 *   - park: tree was dirty, quarantined, but retry also failed
 *
 * Throws:
 *   - Error if setupError is not provided (guard enforcement)
 */
export async function runTriage(
  git: GitRunner,
  worktreePath: string,
  slug: string,
  setupError: any, // Import SetupFailureError at call site for type checking
  runPrepare: (worktreePath: string) => Promise<void>,
  logger?: Logger,
): Promise<TriageOutcome> {
  // Task 8 guard: require SetupFailureError as input
  if (!setupError) {
    throw new Error('runTriage requires a SetupFailureError to enter; no triage without failure');
  }

  // Classify the working tree
  const treeState = await classifyTree(git);

  // Happy path: clean tree, no quarantine needed
  if (treeState === 'clean') {
    logger?.log('triage: tree is clean, no quarantine needed');
    return {
      kind: 'pass',
      outputTail: setupError.outputTail || '',
    };
  }

  // Dirty tree: quarantine and retry
  logger?.log('triage: tree is dirty, quarantining and retrying');
  return retryPrepareAfterQuarantine(git, worktreePath, slug, runPrepare, logger);
}

/**
 * Fix-session stage: dispatch an LLM fix session, then mechanically verify the contract.
 *
 * Task 10 (fix-session stage — mechanical contract verification):
 * - Dispatch the LLM fix-session (dispatchFixSession)
 * - Verify contract: run prepare + check tree is clean
 * - Engine-side verification only; LLM success is validated by prepare + porcelain
 *
 * Process:
 * 1. Dispatch the LLM fix-session (dispatchFixSession)
 * 2. On dispatch error: return park with error output
 * 3. Retry the full prepare process (runPrepare)
 * 4. If prepare fails: return park with contractOutcome 'setup-still-failing'
 * 5. Check tree is clean (git status --porcelain)
 * 6. If tree is dirty: return park with dirty paths named
 * 7. If all checks pass: return fixed-pass
 *
 * Parameters:
 *   - git: GitRunner for accessing the repository
 *   - worktreePath: path to the working tree (passed to runPrepare)
 *   - slug: identifier for logging/branching
 *   - dispatchFixSession: injected LLM fix session dispatcher
 *   - runPrepare: injected prepare function (takes worktreePath, performs full setup)
 *
 * Returns:
 *   - fixed-pass: LLM fix succeeded, prepare passed, tree clean (ready for dispatch)
 *   - park: any contract verification failure (dispatch error, prepare fails, tree dirty)
 *
 * Outcomes documented in union:
 *   - (a) seam resolves, runPrepare passes, porcelain empty → fixed-pass
 *   - (b) seam resolves but runPrepare fails → park with contractOutcome 'setup-still-failing'
 *   - (c) runPrepare passes but porcelain dirty → park with dirty paths
 *   - (d) seam throws → park, seam called exactly once
 */
export async function fixSession(
  git: GitRunner,
  worktreePath: string,
  slug: string,
  dispatchFixSession: () => Promise<void>,
  runPrepare: (worktreePath: string) => Promise<void>,
): Promise<TriageOutcome> {
  try {
    // Step 1: Dispatch the LLM fix-session
    await dispatchFixSession();
  } catch (err) {
    // Step 2: Dispatch failed — park immediately
    const outputTail = extractErrorOutput(err);
    return {
      kind: 'park',
      outputTail,
    };
  }

  try {
    // Step 3: Retry prepare after the fix attempt
    await runPrepare(worktreePath);
  } catch (err) {
    // Step 4: Prepare still fails after fix attempt — park with contract outcome
    const outputTail = extractErrorOutput(err);
    return {
      kind: 'park',
      outputTail,
      contractOutcome: 'setup-still-failing',
    };
  }

  // Step 5: Verify tree is clean after prepare succeeds
  const porcelainResult = await git(['status', '--porcelain']);
  const dirtyPaths = parsePortcelainPaths(porcelainResult.stdout);

  if (dirtyPaths.length > 0) {
    // Step 6: Tree is dirty after prepare succeeded — park with dirty paths
    return {
      kind: 'park',
      outputTail: '',
      preservedPaths: dirtyPaths,
    };
  }

  // Step 7: All checks passed — fixed!
  return {
    kind: 'fixed-pass',
    outputTail: '',
    preservedPaths: [],
  };
}
