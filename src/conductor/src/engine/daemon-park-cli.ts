// daemon-park-cli.ts — filesystem-direct, pre-boot CLI verbs for the
// operator-park marker: `conduct daemon park <slug>` and
// `conduct daemon unpark <slug>`.
//
// Both verbs act directly on `.daemon/parked/<slug>` via park-marker.ts —
// they never start the daemon/supervisor. This mirrors
// daemon-observe-cli.ts's detect/dispatch pattern (hand-rolled argv parsing,
// no heavy imports in the detector) so index.ts can decide whether to
// dispatch before the pipeline boots.

import { existsSync, writeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { writeOperatorPark, removeOperatorPark, isOperatorParked } from './park-marker.js';
import { resetNoEvidenceAttempts } from './task-evidence.js';
import { removeWorktree } from './worktree-shared.js';
import { runProjectTeardown } from './worktree-prepare.js';
import { detectAutoResume } from './auto-resume.js';
import type { ReconcileMergedParkOutcome } from './park-reconciliation.js';
import type { GitRunner, GhRunner } from './pr-labels.js';

const execFile = promisify(execFileCb);
const SINGLE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Resolve the main repo root (the parent of `.git`) from any cwd — the
 * project root itself, or any directory inside a linked worktree.
 * `git rev-parse --git-common-dir` returns the same common `.git` dir for
 * the main checkout and every linked worktree, so its parent is the stable
 * "main repo root" regardless of which worktree/cwd we were invoked from.
 */
export async function resolveMainRepoRoot(
  startCwd: string,
): Promise<{ root: string } | { error: string }> {
  const NOT_A_PROJECT_ERROR =
    "not inside a conduct project — run 'daemon park <slug>' from the project root or any directory inside it";
  try {
    const { stdout } = await execFile('git', ['rev-parse', '--git-common-dir'], {
      cwd: startCwd,
    });
    const raw = stdout.trim();
    if (!raw) {
      return { error: NOT_A_PROJECT_ERROR };
    }
    const absoluteCommonDir = isAbsolute(raw) ? raw : resolve(startCwd, raw);
    return { root: dirname(absoluteCommonDir) };
  } catch {
    return { error: NOT_A_PROJECT_ERROR };
  }
}

export type DaemonParkDispatch =
  | { kind: 'park'; slug: string }
  | { kind: 'unpark'; slug: string }
  | { kind: 'reclaim-worktree'; slug: string; invalidArgs?: true }
  | { kind: 'reconcile-parked'; slug?: string; invalidArgs?: true };

/**
 * Detect a `conduct daemon park <slug>` / `conduct daemon unpark <slug>`
 * command. Returns null for anything else — including a bare `daemon park`
 * with no slug, which is not actionable. `argv` is `process.argv`
 * (`[node, entry, 'daemon', 'park'|'unpark', slug, ...]`).
 */
export function detectDaemonParkCommand(argv: string[]): DaemonParkDispatch | null {
  const args = argv.slice(2);
  if (args[0] !== 'daemon') return null;
  const sub = args[1];
  if (sub === 'reconcile-parked') {
    return args.length === 3 && args[2]
      ? { kind: 'reconcile-parked', slug: args[2] }
      : { kind: 'reconcile-parked', invalidArgs: true };
  }
  if (sub === 'reclaim-worktree') {
    const slug = args[2];
    return slug
      ? {
          kind: 'reclaim-worktree',
          slug,
          ...(args.length === 3 ? {} : { invalidArgs: true as const }),
        }
      : null;
  }
  if (sub !== 'park' && sub !== 'unpark') return null;
  const slug = args[2];
  if (!slug) return null;
  return { kind: sub, slug };
}

/**
 * Validate that `slug` refers to a real unit of work before we let `park`
 * write a marker for it. A slug is considered known if either its plan file
 * (`.docs/plans/<slug>.md`) or its worktree directory (`.worktrees/<slug>`)
 * exists — either one alone is sufficient. This guards against typo'd or
 * stale slugs silently parking nothing.
 *
 * When called from the CLI, the root should be the resolved main root (not a
 * worktree cwd) so that a plan at the main root is visible even when parking
 * from a worktree directory.
 */
export function validateSlug(slug: string, root: string = process.cwd()): boolean {
  const planPath = join(root, '.docs', 'plans', `${slug}.md`);
  const worktreePath = join(root, '.worktrees', slug);
  return existsSync(planPath) || existsSync(worktreePath);
}

export interface DaemonParkDeps {
  /** Project/repo root the marker is written under (tests inject a tmp dir). */
  cwd?: string;
  /** Output sink (tests capture lines; default: synchronous stdout). */
  out?: (line: string) => void;
  /** Guarded reconciliation seam; tests inject a faithful in-process fake. */
  reconcileMergedPark?: (opts: {
    projectRoot: string;
    slug: string;
    log: (line: string) => void;
    runGit?: GitRunner;
    runGh?: GhRunner;
    requestRecordRepair?: (request: { slug: string; prUrl: string }) => Promise<void>;
  }) => Promise<ReconcileMergedParkOutcome>;
  /** ST-916 record-only repair hand-off; defaults to the production adapter. */
  requestRecordRepair?: (request: { slug: string; prUrl: string }) => Promise<void>;
  runGit?: GitRunner;
  runGh?: GhRunner;
  removeWorktree?: (repoRoot: string, worktreePath: string) => Promise<void>;
}

/**
 * Execute a `park`/`unpark` verb against the park-marker primitives.
 *
 * Never throws: any error (e.g. the root is unwritable) is caught, reported
 * via `out`, and surfaced as a non-zero exit code so the caller can
 * `process.exit(code)` without a thrown escape — mirroring
 * dispatchDaemonSupervisor's error handling.
 */
export async function dispatchDaemonPark(
  cmd: DaemonParkDispatch,
  deps: DaemonParkDeps = {},
): Promise<number> {
  const cwd = deps.cwd ?? process.cwd();
  // The pre-boot caller exits immediately after this returns. Write the
  // command result synchronously so usage/refusal output reaches piped CLI
  // callers before that exit, not only an interactive terminal.
  const out = deps.out ?? ((l: string) => writeSync(process.stdout.fd, `${l}\n`));

  try {
    // Reject malformed/manual-usage reconciliation requests before resolving
    // the repository root. This keeps invalid input entirely pre-Git while
    // every valid request still flows through the guarded helper below.
    if (cmd.kind === 'reconcile-parked' && (cmd.invalidArgs || !cmd.slug)) {
      out('Usage: conduct daemon reconcile-parked <slug>');
      return 1;
    }
    if (cmd.kind === 'reconcile-parked' && !SINGLE_SLUG.test(cmd.slug ?? '')) {
      out(`Could not reconcile '${cmd.slug}': invalid-slug`);
      return 1;
    }

    // Resolve the cwd to the main repo root once at dispatch start.
    // This ensures all operations (validation, write, read) happen against
    // the main root even when dispatched from a worktree cwd. If resolution
    // fails (e.g. not a git repo — as in unit tests injecting a tmp dir),
    // fall back to the given cwd (fail-toward-parked, pre-#486 behavior).
    const rootResult = await resolveMainRepoRoot(cwd);
    const resolvedRoot = 'error' in rootResult ? cwd : rootResult.root;

    if (cmd.kind === 'reconcile-parked') {
      const slug = cmd.slug;
      if (!slug) return 1;
      const reconcile =
        deps.reconcileMergedPark ??
        (await import('./park-reconciliation.js')).reconcileMergedPark;
      // Same ST-916 hand-off the daemon sweep uses (adr-2026-07-27 Decision 4),
      // so the operator verb reaches the repair flow too. Resolved lazily on
      // first use to keep the pre-boot dispatch path free of heavy imports.
      const requestRecordRepair =
        deps.requestRecordRepair ??
        (async (request: { slug: string; prUrl: string }) => {
          const { makeRecordRepairRequester } = await import('./shipment-evidence-cli.js');
          await makeRecordRepairRequester({
            cwd: resolvedRoot,
            runGit: deps.runGit,
            runGh: deps.runGh,
            log: out,
          })(request);
        });
      const outcome = await reconcile({ projectRoot: resolvedRoot, slug, log: out, runGit: deps.runGit, runGh: deps.runGh, requestRecordRepair });
      if (outcome.refusal) {
        out(`Could not reconcile '${slug}': ${outcome.refusal}`);
        if (outcome.refusal === 'unmerged-commits' && outcome.unmergedCommits) {
          for (const commit of outcome.unmergedCommits.commits) {
            out(`${commit.sha} ${commit.subject}`);
          }
          if (outcome.unmergedCommits.overflow > 0) {
            out(`… and ${outcome.unmergedCommits.overflow} more`);
          }
        }
        return 1;
      }
      out(`Reconciled '${slug}': ${outcome.steps.join(', ')}`);
      return 0;
    }

    if (cmd.kind === 'reclaim-worktree') {
      if (cmd.invalidArgs || !SINGLE_SLUG.test(cmd.slug)) {
        out(`Could not reclaim-worktree '${cmd.slug}': invalid-slug`);
        return 1;
      }
      const worktreePath = join(resolvedRoot, '.worktrees', cmd.slug);
      if (!existsSync(worktreePath)) {
        out(`No retained worktree to reclaim for '${cmd.slug}'.`);
        return 0;
      }
      const resume = await detectAutoResume(resolvedRoot, cmd.slug);
      if (resume.kind === 'resume') {
        out(`Could not reclaim-worktree '${cmd.slug}': in-progress`);
        return 1;
      }
      out(`Reclaiming retained worktree: ${worktreePath}`);
      await runProjectTeardown(worktreePath, out);
      await (deps.removeWorktree ?? removeWorktree)(resolvedRoot, worktreePath);
      out(`Removed retained worktree '${cmd.slug}': ${worktreePath}`);
      return 0;
    }

    if (cmd.kind === 'park') {
      if (!validateSlug(cmd.slug, resolvedRoot)) {
        out(
          `error: slug '${cmd.slug}' not found under ${resolvedRoot} (no .docs/plans/${cmd.slug}.md or .worktrees/${cmd.slug})`,
        );
        return 1;
      }
      const alreadyParked = await isOperatorParked(resolvedRoot, cmd.slug);
      await writeOperatorPark(resolvedRoot, cmd.slug);
      const markerPath = join(resolvedRoot, '.daemon', 'parked', cmd.slug);
      if (alreadyParked) {
        let since = '';
        try {
          const body = await readFile(markerPath, 'utf-8');
          const firstLine = body.split('\n')[0]?.trim();
          if (firstLine) since = ` (originally parked at ${firstLine})`;
        } catch {
          // Best-effort — marker is present (we just confirmed via
          // isOperatorParked), but if it can't be read, omit the timestamp.
        }
        out(`'${cmd.slug}' is already parked${since} — no change.`);
      } else {
        out(
          `Parked '${cmd.slug}' — it will not be dispatched or re-kicked until unparked.`,
        );
        out(`Marked for park: ${markerPath}`);
      }
    } else {
      const wasParked = await isOperatorParked(resolvedRoot, cmd.slug);
      if (!wasParked) {
        out(`'${cmd.slug}' was not operator-parked — nothing to do.`);
        return 0;
      }

      // Reset the no-evidence counter on unpark regardless of provenance
      // (auto-park or operator-park) — an unpark is a fresh start either
      // way, and the build agent should not inherit stale failed-attempt
      // history (#667). Reset the counter in the feature worktree (where
      // the build agent runs), or fall back to the resolved root.
      const worktreeDir = join(resolvedRoot, '.worktrees', cmd.slug);
      const resetRoot = existsSync(worktreeDir) ? worktreeDir : resolvedRoot;
      const usedFallback = !existsSync(worktreeDir);
      await resetNoEvidenceAttempts(resetRoot);
      if (usedFallback) {
        out(`Unparked '${cmd.slug}' and reset no-evidence counter at resolved root (fallback — worktree missing) — normal dispatch and re-kick resume.`);
      } else {
        out(`Unparked '${cmd.slug}' and reset no-evidence counter — normal dispatch and re-kick resume.`);
      }

      // Only remove the marker after counter reset succeeds.
      // If reset failed, the marker survives for recovery/retry.
      await removeOperatorPark(resolvedRoot, cmd.slug);
    }
    return 0;
  } catch (err) {
    out(`Could not ${cmd.kind} '${cmd.slug}': ${(err as Error).message}`);
    return 1;
  }
}
