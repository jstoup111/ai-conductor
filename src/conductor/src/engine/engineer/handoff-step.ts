// handoff-step.ts — the post-authoring handoff step (retro A-2 extraction).
//
// Extracted verbatim-in-behavior from loop.ts `processIdea` steps 4e-4g so the
// engineer loop stays maintainable as 9.3b adds intake adapters and branches.
//
// runHandoff owns, in order:
//   4e. PR vs no-remote local commit:
//        - target.remote present → openSpecPr (prints "Spec PR opened" / "PR skipped").
//          The remote branch is reached ONLY via an explicit gh-present guard — no
//          `gh!` non-null assertion (retro A-3). openSpecPr records the authored key.
//        - no remote → recordAuthoredKey directly + print the local-commit notice.
//   4f. ensure-running fire-and-forget: injected launchFn (tests spy) or real
//        ensureRunning. Errors are swallowed — never on the critical path.
//   4g. returns the authored entry { project } for the caller to push onto the summary.
//
// CONTRACT (unchanged from the inline version):
//   - The authored key is recorded on BOTH the PR-opened and no-remote paths, exactly once.
//   - ensure-running fires at most once per authored idea (ENSURE-NOT-MANAGE boundary).
//   - The engineer NEVER auto-merges and NEVER triggers a build here.

import type { TargetRepo } from './target.js';
import type { GhRunner } from './loop.js';
import { openSpecPr } from './handoff.js';
import { recordAuthoredKey } from './authored-ledger.js';
import { ensureRunning } from '../daemon-lock.js';

/** The authored-ledger entry returned for the session summary. */
export interface HandoffEntry {
  project: string;
  /**
   * The spec PR URL when a PR was opened (absent on the no-remote / pr-skipped
   * paths). Surfaced so the caller can drive intake write-back (FR-36 done report).
   */
  prUrl?: string;
}

/** Dependencies for runHandoff. All external I/O is injectable for testability. */
export interface RunHandoffDeps {
  /** GitHub runner for PR operations. Required only when target.remote is set. */
  gh?: GhRunner;
  /** Engineer directory override forwarded to the authored ledger. */
  engineerDir?: string;
  /**
   * Injectable ensure-running launch (FR-21). Tests spy here to assert call count +
   * repoPath without spawning a process. Absent → real ensureRunning (detached spawn).
   */
  launchFn?: (repoPath: string) => void | Promise<void>;
  /** Output sink for handoff notices. */
  print(s: string): void;
  /**
   * Originating intake reference (`owner/repo#N`). When present, the spec PR is
   * linked to the issue with a non-closing `Refs` line (the daemon's
   * implementation PR is what closes it on merge). Absent → no injection.
   */
  sourceRef?: string;
}

/**
 * Run the post-authoring handoff for a freshly authored spec branch.
 *
 * @param target - Resolved target repo (name + canonicalPath + optional remote).
 * @param branch - The authored spec branch (also the authored-ledger feature key).
 * @param deps   - Injected dependencies.
 * @returns      The authored entry to push onto the session summary.
 * @throws       When target.remote is set but no gh runner is wired (gh-present guard).
 */
export async function runHandoff(
  target: TargetRepo,
  branch: string,
  deps: RunHandoffDeps,
): Promise<HandoffEntry> {
  const ledgerOpts = deps.engineerDir ? { engineerDir: deps.engineerDir } : {};

  let prUrl: string | undefined;

  // 4e. PR / handoff, gated on remote presence.
  if (target.remote) {
    // A-3: explicit gh-present guard — the remote branch is unreachable without a
    // wired gh runner. No `gh!` non-null assertion.
    const gh = deps.gh;
    if (!gh) {
      throw new Error('engineer: remote target requires a gh runner to open a spec PR');
    }
    const handoffResult = await openSpecPr(target, branch, {
      runner: async (args, runnerOpts) => {
        const ghCwd = runnerOpts?.cwd ?? target.canonicalPath;
        const r = await gh(args, { cwd: ghCwd });
        return { stdout: r.stdout, stderr: '' };
      },
      ledgerOpts,
      sourceRef: deps.sourceRef,
    });
    if (handoffResult.kind === 'pr-opened') {
      deps.print(`Spec PR opened: ${handoffResult.url}`);
      prUrl = handoffResult.url;
    } else {
      // pr-skipped (no remote detected at runtime by gh).
      deps.print(`PR skipped: ${handoffResult.reason}`);
    }
  } else {
    // No remote — spec is committed on the branch; work is preserved locally.
    // Record the authored key so the FR-12 flywheel trend counts this authoring
    // event (mirrors openSpecPr's pr-skipped path which also records the ledger entry).
    await recordAuthoredKey(target.name, branch, ledgerOpts);
    deps.print(
      `No remote configured — PR could not be opened. Spec committed on branch "${branch}".`,
    );
  }

  // 4f. Wire ensure-running (FR-21): after spec artifacts land, fire-and-forget a
  //     daemon probe for the target repo. Uses the injected launchFn if present
  //     (tests spy on it); falls back to the real ensureRunning. Errors are
  //     swallowed — a failed ensure-running must never abort spec authoring.
  //
  //     CONTRACT: ensureRunning is the ENSURE-NOT-MANAGE boundary. It fires at most
  //     once per authored idea. The engineer NEVER sends lifecycle signals to a daemon.
  try {
    if (deps.launchFn) {
      await Promise.resolve(deps.launchFn(target.canonicalPath));
    } else {
      await ensureRunning(target.canonicalPath, {});
    }
  } catch {
    // Fire-and-forget: ensure-running failure must never block the engineer loop.
  }

  // 4g. Return the authored entry (work was done on BOTH paths).
  return { project: target.name, ...(prUrl ? { prUrl } : {}) };
}
