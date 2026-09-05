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
import type { ConductorEventEmitter } from '../ui/events.js';
import type { SetupRepairRejectionReason } from '../types/events.js';

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
 *   - `contractOutcome?`: contract verification outcome if applicable. For
 *     `park` outcomes produced by `fixSession`, one of:
 *       - `'setup-still-failing'`: runPrepare threw again after the fix
 *         session — bin/setup itself is still broken.
 *       - `'dirty-tree-uncleaned'`: runPrepare succeeded (bin/setup did NOT
 *         fail) but the worktree was left dirty; residual paths (tracked and
 *         untracked) were quarantined. Distinct from setup failure — must
 *         never be reported as "setup failed".
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
      preservedPaths?: string[];
      contractOutcome?: string;
      /** Present only when a provider failure left the exact dispatch tree intact. */
      treeUnchangedSinceDispatch?: { before: string; after: string };
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
 * Surface quarantine evidence to the resuming build agent (Task 14 / TS-5,
 * all criteria). Called after a triage outcome (of any kind) is settled and
 * BEFORE the dispatch to the build agent resumes.
 *
 * Behavior:
 *   - The outcome carries a `quarantineRef` (a quarantine happened THIS
 *     rotation) → verify the ref still resolves, then write/refresh
 *     `.pipeline/QUARANTINE` naming the ref, the preserved paths, and
 *     "recover deliberately" guidance.
 *   - The outcome carries no ref, but a `wip/setup-quarantine-<slug>` ref
 *     already exists (from a prior rotation) → surface that ref the same way.
 *   - No ref either way (this rotation or a prior one) → no sentinel is
 *     written, and any existing sentinel is left untouched (nothing to do
 *     here — this function never removes a sentinel that names a live ref).
 *   - A ref is known (from the outcome or a prior rotation) but
 *     `git rev-parse --verify <ref>` fails (deleted externally) → write a
 *     sentinel that says the ref is missing; dispatch proceeds regardless
 *     (fail-open — this is diagnostic surfacing, never a dispatch gate).
 *
 * Fail-open throughout: a git or fs failure is logged (if a logger is
 * given) and swallowed — it must never block the build dispatch.
 */
export async function surfaceQuarantine(
  git: GitRunner,
  worktreePath: string,
  slug: string,
  outcome: TriageOutcome,
  logger?: Logger,
): Promise<void> {
  try {
    let ref = outcome.quarantineRef;
    let preservedPaths: string[] | undefined =
      'preservedPaths' in outcome ? outcome.preservedPaths : undefined;

    if (!ref) {
      // No ref from this rotation's outcome — check for one left over from a
      // prior rotation before concluding there is nothing to surface.
      const priorRef = `wip/setup-quarantine-${slug}`;
      const verifyPrior = await git(['rev-parse', '--verify', priorRef]);
      if (verifyPrior.exitCode === 0) {
        ref = priorRef;
      }
    }

    if (!ref) {
      // No quarantine present this rotation or previously — no sentinel, no notice.
      return;
    }

    const verify = await git(['rev-parse', '--verify', ref]);
    if (verify.exitCode !== 0) {
      await writeQuarantineMissingRefSentinel(worktreePath, ref, logger);
      return;
    }

    await writeQuarantineSentinel(worktreePath, ref, preservedPaths ?? [], logger);
  } catch (err) {
    if (logger) {
      logger.log(`quarantine surfacing failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Write a `.pipeline/QUARANTINE` notice stating the named ref no longer
 * resolves (deleted externally, e.g. by a manual `git branch -D`). The
 * build dispatch proceeds regardless — this is diagnostic only, never a
 * gate. Best-effort: write failures are logged but do not throw.
 */
async function writeQuarantineMissingRefSentinel(
  worktreePath: string,
  quarantineRef: string,
  logger?: Logger,
): Promise<void> {
  try {
    await mkdir(join(worktreePath, '.pipeline'), { recursive: true });
    const content = `Quarantine ref: ${quarantineRef}

This ref no longer resolves — it appears to have been deleted externally.
Dispatch is proceeding regardless; this notice is diagnostic only.

Recover deliberately:
1. If the ref was deleted in error, restore it from reflog: git reflog
2. Otherwise no action is needed — the quarantined changes are gone.
3. Remove this marker: rm .pipeline/QUARANTINE
`;
    await writeFile(join(worktreePath, QUARANTINE_SENTINEL), content, 'utf-8');
    if (logger) {
      logger.log(`quarantine sentinel written: ${quarantineRef} — ref missing (deleted externally)`);
    }
  } catch (err) {
    if (logger) {
      logger.log(`quarantine sentinel (missing-ref) write failed: ${err instanceof Error ? err.message : String(err)}`);
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
      outputTail: commitResult.stderr || `quarantine commit failed with code ${commitResult.exitCode}`,
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

  logger?.log(`quarantine ${quarantineRef}: preserved ${preservedPaths.join(', ')}`);

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
 * 4. On retry success: write quarantine sentinel and return quarantined-pass
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
  const quarantineAttempt = await quarantine(git, slug, logger);

  // If quarantine failed, return park immediately
  if ('kind' in quarantineAttempt) {
    return quarantineAttempt;
  }

  const quarantineResult: QuarantineResult = quarantineAttempt;

  // Single retry attempt after quarantine
  try {
    await runPrepare(worktreePath);
    // Setup succeeded after retry — write quarantine sentinel for build dispatch
    await writeQuarantineSentinel(worktreePath, quarantineResult.ref, quarantineResult.preservedPaths, logger);
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
  events?: ConductorEventEmitter,
): Promise<TriageOutcome> {
  // Both silent stage-1 outcomes deliberately receive the feature-scoped event
  // spine. They emit nothing; carrying it here makes an accidental future
  // setup_repair emission observable by the production acceptance boundary.
  void events;
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
 * 6. If tree is dirty: quarantine the residual paths and return a distinct
 *    'dirty-tree-uncleaned' park (never "setup failed" — bin/setup passed)
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
 *   - (c) runPrepare passes but porcelain dirty → park with contractOutcome
 *         'dirty-tree-uncleaned', quarantineRef set, preservedPaths named
 *         (never "setup failed" — bin/setup itself succeeded)
 *   - (d) seam throws → park, seam called exactly once
 */
type RepairSnapshot = { head: string; tree: string; paths: string[]; dirty: boolean };
type PreservationResult =
  | { ok: true; ref: string; paths: string[] }
  | { ok: false; restored: false; outputTail: string }
  | { ok: false; restored: true; ref: string; paths: string[]; outputTail: string };

function gitFailure(result: GitResult, fallback: string): string {
  return result.stderr || result.stdout || fallback;
}

async function repairSnapshot(git: GitRunner): Promise<{ ok: true; value: RepairSnapshot } | { ok: false; outputTail: string }> {
  const head = await git(['rev-parse', 'HEAD']);
  if (head.exitCode !== 0 || !head.stdout.trim()) return { ok: false, outputTail: gitFailure(head, 'could not resolve HEAD') };
  const status = await git(['status', '--porcelain']);
  if (status.exitCode !== 0) return { ok: false, outputTail: gitFailure(status, 'could not read worktree status') };
  const paths = parsePortcelainPaths(status.stdout);
  if (paths.length === 0) {
    const tree = await git(['rev-parse', 'HEAD^{tree}']);
    return tree.exitCode === 0 && tree.stdout.trim()
      ? { ok: true, value: { head: head.stdout.trim(), tree: tree.stdout.trim(), paths, dirty: false } }
      : { ok: false, outputTail: gitFailure(tree, 'could not resolve HEAD tree') };
  }
  const add = await git(['add', '-A']);
  if (add.exitCode !== 0) return { ok: false, outputTail: gitFailure(add, 'could not stage repair candidate') };
  const tree = await git(['write-tree']);
  // Restore the original index without touching candidate bytes in the working tree.
  const reset = await git(['reset', '--mixed', head.stdout.trim()]);
  if (tree.exitCode !== 0 || reset.exitCode !== 0 || !tree.stdout.trim()) {
    return { ok: false, outputTail: gitFailure(tree.exitCode !== 0 ? tree : reset, 'could not snapshot repair candidate') };
  }
  return { ok: true, value: { head: head.stdout.trim(), tree: tree.stdout.trim(), paths, dirty: true } };
}

async function preserveRepairAttempt(git: GitRunner, slug: string, originalHead: string): Promise<PreservationResult> {
  const status = await git(['status', '--porcelain']);
  if (status.exitCode !== 0) return { ok: false, restored: false, outputTail: gitFailure(status, 'could not inspect attempted repair') };
  const residue = parsePortcelainPaths(status.stdout);
  const changed = await git(['diff', '--name-only', originalHead, 'HEAD']);
  if (changed.exitCode !== 0) return { ok: false, restored: false, outputTail: gitFailure(changed, 'could not inspect attempted commits') };
  const paths = [...new Set([...changed.stdout.split('\n').filter(Boolean), ...residue])];
  if (residue.length > 0) {
    const add = await git(['add', '-A']);
    if (add.exitCode !== 0) return { ok: false, restored: false, outputTail: gitFailure(add, 'could not stage rejected repair') };
    const commit = await git(['commit', '-m', 'wip(setup): preserve rejected repair']);
    if (commit.exitCode !== 0) return { ok: false, restored: false, outputTail: gitFailure(commit, 'could not preserve rejected repair') };
  }
  const attempted = await git(['rev-parse', 'HEAD']);
  if (attempted.exitCode !== 0 || !attempted.stdout.trim()) return { ok: false, restored: false, outputTail: gitFailure(attempted, 'could not resolve attempted repair') };
  const ref = `wip/setup-quarantine-${slug}`;
  const branch = await git(['branch', '-f', ref, attempted.stdout.trim()]);
  if (branch.exitCode !== 0) return { ok: false, restored: false, outputTail: gitFailure(branch, 'could not preserve rejected repair ref') };
  const verify = await git(['rev-parse', '--verify', ref]);
  if (verify.exitCode !== 0) return { ok: false, restored: false, outputTail: gitFailure(verify, 'could not verify rejected repair ref') };
  if (verify.stdout.trim() !== attempted.stdout.trim()) return { ok: false, restored: false, outputTail: 'could not verify rejected repair ref: refreshed ref did not resolve to the attempted HEAD' };
  const reset = await git(['reset', '--hard', originalHead]);
  if (reset.exitCode !== 0) return { ok: false, restored: true, ref, paths, outputTail: gitFailure(reset, 'could not restore original HEAD') };
  return { ok: true, ref, paths };
}

/** Runs one fix session and accepts only a setup-stable, provable Git state. */
export async function fixSession(
  git: GitRunner,
  worktreePath: string,
  slug: string,
  dispatchFixSession: () => Promise<void>,
  runPrepare: (worktreePath: string) => Promise<void>,
  events?: ConductorEventEmitter,
): Promise<TriageOutcome> {
  const initial = await repairSnapshot(git);
  if (!initial.ok || initial.value.dirty) {
    return { kind: 'park', outputTail: initial.ok ? 'fix-session requires a clean initial worktree' : initial.outputTail, contractOutcome: 'precondition-failed' };
  }
  const original = initial.value;
  let settled = false;
  const success = async (disposition: 'engine-committed' | 'accepted-existing-commit' | 'verified-no-tree-change'): Promise<TriageOutcome> => {
    if (!settled) { settled = true; await events?.emit({ type: 'setup_repair', disposition, preservedPaths: [] }); }
    return { kind: 'fixed-pass', outputTail: '', preservedPaths: [], contractOutcome: disposition };
  };
  const reject = async (
    reason: SetupRepairRejectionReason,
    outputTail: string,
    preserve: boolean,
    treeUnchangedSinceDispatch?: { before: string; after: string },
  ): Promise<TriageOutcome> => {
    let ref: string | undefined;
    let paths: string[] = [];
    let finalReason = reason;
    let finalTail = outputTail;
    if (preserve) {
      const result = await preserveRepairAttempt(git, slug, original.head);
      if (result.ok) { ref = result.ref; paths = result.paths; }
      else if (result.restored) { ref = result.ref; paths = result.paths; finalReason = 'restoration-failed'; finalTail = result.outputTail; }
      else { finalReason = 'preservation-failed'; finalTail = result.outputTail; }
    }
    if (!settled) { settled = true; await events?.emit({ type: 'setup_repair', disposition: 'rejected', reason: finalReason, ...(ref ? { quarantineRef: ref } : {}), preservedPaths: paths }); }
    return {
      kind: 'park',
      outputTail: finalTail,
      contractOutcome: finalReason,
      ...(ref ? { quarantineRef: ref } : {}),
      ...(treeUnchangedSinceDispatch ? { treeUnchangedSinceDispatch } : {}),
      preservedPaths: paths,
    };
  };

  try {
    await dispatchFixSession();
  } catch (err) {
    const afterFailure = await repairSnapshot(git);
    if (!afterFailure.ok) return reject('snapshot-failed', afterFailure.outputTail, true);
    const treeUnchanged =
      afterFailure.value.head === original.head &&
      afterFailure.value.tree === original.tree &&
      !afterFailure.value.dirty;
    return reject(
      'provider-failure',
      extractErrorOutput(err),
      !treeUnchanged,
      treeUnchanged ? { before: original.tree, after: afterFailure.value.tree } : undefined,
    );
  }
  const candidate = await repairSnapshot(git);
  if (!candidate.ok) return reject('snapshot-failed', candidate.outputTail, true);
  const forward = await git(['merge-base', '--is-ancestor', original.head, candidate.value.head]);
  if (forward.exitCode !== 0) return reject('history-rewritten', 'fix-session rewrote original history', true);
  if (candidate.value.head !== original.head && candidate.value.dirty) return reject('mixed-commit-and-residue', 'fix-session left commits plus uncommitted residue', true);
  try { await runPrepare(worktreePath); } catch (err) {
    return reject('setup-still-failing', extractErrorOutput(err), candidate.value.head !== original.head || candidate.value.dirty);
  }
  const afterPrepare = await repairSnapshot(git);
  if (!afterPrepare.ok) return reject('snapshot-failed', afterPrepare.outputTail, true);
  if (afterPrepare.value.head !== candidate.value.head || afterPrepare.value.tree !== candidate.value.tree) return reject('setup-drift', 'forced setup changed the repair candidate', true);
  if (!candidate.value.dirty) return candidate.value.head === original.head ? success('verified-no-tree-change') : success('accepted-existing-commit');
  const add = await git(['add', '-A']);
  const commit = add.exitCode === 0 ? await git(['commit', '-m', 'fix(setup): retain verified repair']) : add;
  if (commit.exitCode !== 0) return reject('repair-commit-failed', gitFailure(commit, 'could not commit verified repair'), true);
  const verified = await repairSnapshot(git);
  if (!verified.ok) return reject('repair-postcondition-failed', verified.outputTail, true);
  if (verified.value.head === original.head) {
    return reject('repair-postcondition-failed', 'repair commit postcondition failed: HEAD did not advance past the original commit', true);
  }
  if (verified.value.tree !== candidate.value.tree) {
    return reject('repair-postcondition-failed', 'repair commit postcondition failed: committed tree did not match the verified candidate tree', true);
  }
  if (verified.value.dirty) {
    return reject('repair-postcondition-failed', 'repair commit postcondition failed: worktree left dirty after the repair commit', true);
  }
  const parent = await git(['rev-parse', 'HEAD^']);
  if (parent.exitCode !== 0 || parent.stdout.trim() !== original.head) return reject('repair-postcondition-failed', 'repair commit parent did not match original HEAD', true);
  return success('engine-committed');
}

/**
 * Run the complete, bounded setup-recovery ladder for one failed setup run.
 *
 * Stage 1 first removes only quarantinable residue. Stage 2 is reachable only
 * when setup still fails at a clean HEAD; it owns exactly one provider repair
 * dispatch and its mechanical verification. Keeping this decision beside both
 * stages prevents callers from accidentally treating a stage-1-only recovery
 * as a fix-session candidate.
 */
export async function runSetupFailureTriage(
  git: GitRunner,
  worktreePath: string,
  slug: string,
  setupError: any,
  runPrepare: (worktreePath: string) => Promise<void>,
  dispatchFixSession: () => Promise<void>,
  logger?: Logger,
  events?: ConductorEventEmitter,
): Promise<TriageOutcome> {
  const triageOutcome = await runTriage(
    git,
    worktreePath,
    slug,
    setupError,
    runPrepare,
    logger,
    events,
  );

  if (triageOutcome.kind === 'park' && !triageOutcome.quarantineRef) {
    return triageOutcome;
  }
  if (triageOutcome.kind === 'quarantined-pass') {
    return triageOutcome;
  }

  const fixOutcome = await fixSession(
    git,
    worktreePath,
    slug,
    dispatchFixSession,
    runPrepare,
    events,
  );

  if (fixOutcome.kind === 'park' && !fixOutcome.quarantineRef && triageOutcome.quarantineRef) {
    return { ...fixOutcome, quarantineRef: triageOutcome.quarantineRef };
  }
  return fixOutcome;
}
