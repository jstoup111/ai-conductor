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

/**
 * Logger interface for injecting logging into quarantine.
 * Allows test mocks and daemon log sink injection.
 */
export interface Logger {
  log(message: string): void;
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
): Promise<QuarantineResult> {
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
  await git(['add', '-A']);

  // Commit the staged changes
  await git(['commit', '-m', 'Quarantine before reset']);

  // Get the SHA of the new commit
  const revResult = await git(['rev-parse', 'HEAD']);
  const quarantineSha = revResult.stdout.trim();

  // Create/force-move the quarantine branch at this commit
  await git(['branch', '-f', quarantineRef, quarantineSha]);

  // Reset the working tree to the original HEAD (one commit back)
  await git(['reset', '--hard', 'HEAD~1']);

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

  try {
    // Retry the full prepare once on the clean tree
    await runPrepare(worktreePath);

    // Setup succeeded after retry
    return {
      kind: 'quarantined-pass',
      outputTail: '',
      quarantineRef: quarantineResult.ref,
    };
  } catch (err) {
    // Setup failed after retry (committed breakage)
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
