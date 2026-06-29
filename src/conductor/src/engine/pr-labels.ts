/**
 * Shared gh PR-ops seam — the single module through which all `gh`/`git`
 * label + PR primitives flow.
 *
 * Design constraints:
 *   - Every public function is dependency-injected (runner defaults to the
 *     prod factory so call-sites with no fake need no wiring).
 *   - All operations are best-effort / non-throwing: errors are caught
 *     internally, logged via the optional `log` callback, and never
 *     re-thrown to callers.
 */

import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { extractPrUrl } from './state.js';

const execFileP = promisify(execFileCb);

// ── Runner types ──────────────────────────────────────────────────────────────

/**
 * Injectable runner for `gh` CLI commands.
 * Mirrors the GhRunner type in engineer/loop.ts — defined here so pr-labels
 * has no dependency on that module.
 */
export type GhRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

/**
 * Injectable runner for `git` CLI commands.
 */
export type GitRunner = (
  args: string[],
  opts: { cwd: string },
) => Promise<{ stdout: string }>;

// ── Production factories ──────────────────────────────────────────────────────

/** Construct the real gh runner used in production. */
export function makeProductionGh(): GhRunner {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execFileP('gh', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

/** Construct the real git runner used in production. */
export function makeProductionGit(): GitRunner {
  return async (args: string[], opts: { cwd: string }) => {
    const result = await execFileP('git', args, { cwd: opts.cwd });
    return { stdout: String(result.stdout) };
  };
}

// ── Label management ──────────────────────────────────────────────────────────

/**
 * Ensure a label exists in the repo (idempotent via --force).
 * Swallows all errors.
 */
export async function ensureLabel(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  name: string,
  color: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['label', 'create', name, '--color', color, '--force'], { cwd });
  } catch (err) {
    log?.(`[pr-labels] ensureLabel(${name}) error: ${err}`);
  }
}

/**
 * Add a label to a PR by URL.
 * Swallows all errors.
 */
export async function addLabel(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  name: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'edit', prUrl, '--add-label', name], { cwd });
  } catch (err) {
    log?.(`[pr-labels] addLabel(${prUrl}, ${name}) error: ${err}`);
  }
}

/**
 * Remove a label from a PR by URL.
 * Swallows all errors.
 */
export async function removeLabel(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  name: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'edit', prUrl, '--remove-label', name], { cwd });
  } catch (err) {
    log?.(`[pr-labels] removeLabel(${prUrl}, ${name}) error: ${err}`);
  }
}

// ── PR merge state ────────────────────────────────────────────────────────────

export interface PrMergeState {
  state: string;
  mergeable: string;
  hasFailingOrPendingChecks: boolean;
  labels: string[];
}

/** Safe sentinel returned when the gh runner fails. */
const ERROR_SENTINEL: PrMergeState = {
  state: 'UNKNOWN',
  mergeable: 'UNKNOWN',
  hasFailingOrPendingChecks: true,
  labels: [],
};

/** The set of status/conclusion values that indicate a check is failing or still pending. */
const FAILING_OR_PENDING = new Set(['FAILURE', 'ERROR', 'PENDING']);

function isCheckFailingOrPending(c: {
  status?: string | null;
  conclusion?: string | null;
}): boolean {
  const status = (c.status ?? '').toUpperCase();
  const conclusion = (c.conclusion ?? '').toUpperCase();
  // Explicit failure / error / pending status
  if (FAILING_OR_PENDING.has(status)) return true;
  // Explicit failure / error / pending conclusion
  if (FAILING_OR_PENDING.has(conclusion)) return true;
  // Null/empty conclusion = check is still running (not yet completed)
  if (!c.conclusion) return true;
  return false;
}

interface GhPrViewJson {
  state?: string;
  mergeable?: string;
  statusCheckRollup?: Array<{ status?: string | null; conclusion?: string | null }> | null;
  labels?: Array<{ name?: string }> | null;
}

/**
 * Fetch the merge state of a PR (state, mergeable, check rollup, labels).
 * On any runner error returns a safe sentinel so callers can treat it as
 * non-mergeable without special error handling. Never throws.
 */
export async function prMergeState(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<PrMergeState> {
  try {
    const { stdout } = await runGh(
      ['pr', 'view', prUrl, '--json', 'state,mergeable,statusCheckRollup,labels'],
      { cwd },
    );
    const data: GhPrViewJson = JSON.parse(stdout);
    const state = data.state ?? 'UNKNOWN';
    const mergeable = data.mergeable ?? 'UNKNOWN';
    const checks = data.statusCheckRollup ?? [];
    const hasFailingOrPendingChecks =
      checks.length > 0 && checks.some(isCheckFailingOrPending);
    const labels = (data.labels ?? []).map((l) => l.name ?? '').filter(Boolean);
    return { state, mergeable, hasFailingOrPendingChecks, labels };
  } catch (err) {
    log?.(`[pr-labels] prMergeState(${prUrl}) error: ${err}`);
    return { ...ERROR_SENTINEL };
  }
}

/**
 * True iff the PR is open, unambiguously mergeable, and has no failing or
 * pending checks. A runner error (sentinel) always returns false.
 */
export function isMergeable(s: PrMergeState): boolean {
  return (
    s.state === 'OPEN' && s.mergeable === 'MERGEABLE' && !s.hasFailingOrPendingChecks
  );
}

// ── Find-or-create PR ─────────────────────────────────────────────────────────

export interface FindOrCreatePrOpts {
  branch: string;
  base: string;
  draft?: boolean;
  title: string;
  body: string;
}

export interface FindOrCreatePrResult {
  prUrl?: string;
}

/**
 * Return the URL of an existing OPEN PR for the branch, or create a new one.
 *
 * - If a PR for the branch already exists and is OPEN, its URL is returned
 *   without creating a new PR.
 * - If a PR exists but is CLOSED or MERGED, it is NOT resurrected; a new PR
 *   is created instead.
 * - On any runner error, returns {} (swallows).
 */
export async function findOrCreatePr(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  opts: FindOrCreatePrOpts,
  log?: (msg: string) => void,
): Promise<FindOrCreatePrResult> {
  try {
    // ── Step 1: check for an existing PR ──────────────────────────────────
    try {
      const { stdout } = await runGh(
        ['pr', 'view', opts.branch, '--json', 'url,state'],
        { cwd },
      );
      const data: { url?: string; state?: string } = JSON.parse(stdout);
      if (data.state === 'OPEN' && data.url) {
        return { prUrl: data.url };
      }
      // CLOSED / MERGED: fall through to create a fresh PR
      log?.(
        `[pr-labels] findOrCreatePr: existing PR for ${opts.branch} is ${data.state ?? 'unknown'} — creating new`,
      );
    } catch {
      // No PR found for branch — proceed to create
    }

    // ── Step 2: create a new PR ───────────────────────────────────────────
    const createArgs: string[] = [
      'pr',
      'create',
      '--head',
      opts.branch,
      '--base',
      opts.base,
      '--title',
      opts.title,
      '--body',
      opts.body,
    ];
    if (opts.draft) createArgs.push('--draft');

    const { stdout: createOut } = await runGh(createArgs, { cwd });
    const prUrl = extractPrUrl(createOut);
    if (prUrl) return { prUrl };

    log?.(`[pr-labels] findOrCreatePr: could not parse URL from output: ${createOut}`);
    return {};
  } catch (err) {
    log?.(`[pr-labels] findOrCreatePr(${opts.branch}) error: ${err}`);
    return {};
  }
}

// ── PR comment + ready ────────────────────────────────────────────────────────

/**
 * Post a comment on a PR.
 * Swallows all errors.
 */
export async function comment(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  body: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'comment', prUrl, '--body', body], { cwd });
  } catch (err) {
    log?.(`[pr-labels] comment(${prUrl}) error: ${err}`);
  }
}

/**
 * Mark a draft PR as ready for review.
 * Swallows all errors.
 */
export async function setReady(
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<void> {
  try {
    await runGh(['pr', 'ready', prUrl], { cwd });
  } catch (err) {
    log?.(`[pr-labels] setReady(${prUrl}) error: ${err}`);
  }
}
