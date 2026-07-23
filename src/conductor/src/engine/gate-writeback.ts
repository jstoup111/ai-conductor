/**
 * Gate write-back orchestrator — labels and comments a spec's PR once it
 * becomes owner-gated (Task 17).
 *
 * Design constraints (mirroring the build-failure-escalation.ts / pr-labels.ts
 * seam):
 *   - Every public function is dependency-injected (runner defaults to the
 *     prod factory so call-sites with no fake need no wiring).
 *   - All operations are best-effort / non-throwing: errors are caught
 *     internally, logged via the optional `log` callback, and never
 *     re-thrown to callers.
 *   - Idempotent: repeated calls against the same gated state produce exactly
 *     one label application and one marker comment (upserted in place, never
 *     duplicated).
 */

import {
  type GhRunner,
  makeProductionGh,
  ensureLabel,
  addLabel,
  upsertComment,
  upsertIssueComment,
  prMergeState,
  OWNER_GATED_MARKER,
} from './pr-labels.js';
import { parseSourceRef } from './engineer/issue-ref.js';

export { OWNER_GATED_MARKER };

/**
 * PR states for which write-back is a no-op: the PR is dead and there is
 * nothing left to label/comment on. `NOTFOUND` (deleted/inaccessible) is
 * treated the same way — see {@link announceGatedPr}.
 *
 * `MERGED` is deliberately NOT in this set. The owner gate runs only on
 * specs whose PR has already been merged onto the base branch (gating
 * happens pre-dispatch, after merge), so every gated spec's PR is MERGED by
 * the time write-back runs. Skipping MERGED here would mean gated specs are
 * never announced at all — there is no "while it was open" window in which
 * the announcement could have already happened.
 */
const TERMINAL_PR_STATES = new Set(['CLOSED', 'NOTFOUND']);

// ── Constants ─────────────────────────────────────────────────────────────────

export const OWNER_GATED_LABEL = 'owner-gated';
const LABEL_COLOR = 'FBCA04';

// ── Types ─────────────────────────────────────────────────────────────────────

// 'other-owner' is the only reason `decideSpecGate` still returns a
// `build: false` for — un-owned specs always default-build now (see
// gate.ts), so 'unowned-post-cutover'/'unowned-indeterminate' can no longer
// reach a GatedSpecEntry.
export type GatedReason = 'other-owner';

export interface GatedSpecEntry {
  kind: 'spec';
  slug: string;
  reason: GatedReason;
  otherOwner?: string;
  remedy: string;
}

export interface GateWritebackDeps {
  runGh?: GhRunner;
  cwd: string;
  log?: (msg: string) => void;
  /**
   * Shared across a daemon run (not per-call) to dedup skip notices per
   * (slug, reason) key — see {@link logSkipOnce}. When omitted, every skip
   * logs unconditionally (matches prior behavior for one-off/test callers).
   */
  warnedSkips?: Set<string>;
  /**
   * Suppresses gated skip notices at default verbosity; verbose surfaces
   * them (subject to `warnedSkips` dedup).
   */
  verbose?: boolean;
}

/**
 * Log a skip notice at most once per (slug, reason) key for the lifetime of
 * the given `warnedSkips` set. Repeated calls with the same key are silent
 * no-ops after the first. When `warnedSkips` is undefined, always logs
 * (no dedup state to track against).
 */
function logSkipOnce(
  log: ((msg: string) => void) | undefined,
  warnedSkips: Set<string> | undefined,
  slug: string,
  reason: string,
  msg: string,
  verbose?: boolean,
): void {
  if (warnedSkips) {
    const key = `${slug}:${reason}`;
    if (warnedSkips.has(key)) return;
    warnedSkips.add(key);
  }
  log?.(msg);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Ensure the `owner-gated` label exists in the repo and is applied to the
 * given PR. Best-effort / non-throwing (delegates to the pr-labels seam,
 * which swallows its own errors).
 */
export async function ensureGatedPrLabel(
  _spec: GatedSpecEntry,
  prUrl: string,
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  log?: (msg: string) => void,
): Promise<void> {
  await ensureLabel(runGh, cwd, OWNER_GATED_LABEL, LABEL_COLOR, log);
  await addLabel(runGh, cwd, prUrl, OWNER_GATED_LABEL, log);
}

/** Render the body of the owner-gated marker comment for a given spec entry. */
function renderCommentBody(spec: GatedSpecEntry): string {
  const ownerSuffix = spec.otherOwner ? ` (${spec.otherOwner})` : '';
  return [
    '## Owner-gated',
    '',
    `\`${spec.slug}\` is currently owner-gated: **${spec.reason}${ownerSuffix}**.`,
    '',
    `Remedy: ${spec.remedy}`,
  ].join('\n');
}

/**
 * Upsert the single owner-gated marker comment on the given PR. Idempotent:
 * repeated calls for the same (or a transitioned) gated state find and edit
 * the existing marked comment in place rather than posting a new one.
 *
 * Reason transitions (Task 18): the underlying {@link upsertComment} locates
 * the existing comment purely by the stable `OWNER_GATED_MARKER`, never by
 * body content — so when a spec's gated `remedy`/`otherOwner` changes between
 * scan passes (e.g. the offending owner stamp is edited to name a different
 * operator), the same comment is found and PATCHed with the freshly rendered
 * body instead of a new comment being created. This holds across any number
 * of transitions: exactly one comment ever exists, and its body always
 * reflects the most recently observed reason/remedy/owner.
 */
export async function upsertGatedMarkerComment(
  spec: GatedSpecEntry,
  prUrl: string,
  runGh: GhRunner = makeProductionGh(),
  cwd: string,
  log?: (msg: string) => void,
): Promise<void> {
  const body = renderCommentBody(spec);
  await upsertComment(runGh, cwd, prUrl, OWNER_GATED_MARKER, body, log);
}

/**
 * Called once per scan pass for each spec that is currently owner-gated and
 * has a known PR. Applies the `owner-gated` label and upserts the marker
 * comment carrying the reason + remedy (+ other-owner name, when present).
 *
 * If no PR is known for the spec (`prUrl` falsy), the write-back is skipped
 * entirely — no `gh` call is made — since there is nothing to label/comment
 * on yet. Zero git side effects either way: this module never shells out to
 * `git`, only `gh`.
 *
 * If the PR is already CLOSED or genuinely gone (404/NOTFOUND), the
 * write-back is also skipped — there is nothing useful to label/comment on
 * a dead PR. This one `pr view` lookup is the only extra `gh` call added for
 * this check — no retries are attempted regardless of its outcome.
 *
 * A MERGED PR is NOT skipped: the owner gate only runs on specs already
 * merged onto the base branch, so every gated spec's PR is MERGED by
 * construction. It is labeled/commented on exactly like an OPEN PR.
 *
 * Both steps (label, comment) are independently best-effort/non-throwing; a
 * failure in one (e.g. a label-add race against a concurrent labeler) does
 * not prevent the other from being attempted — the comment still lands even
 * if the label call failed, and vice versa.
 */
export async function announceGatedPr(
  spec: GatedSpecEntry,
  prUrl: string,
  deps: GateWritebackDeps,
): Promise<void> {
  const { cwd, log, warnedSkips, verbose } = deps;
  const runGh = deps.runGh ?? makeProductionGh();

  if (!prUrl) {
    logSkipOnce(
      log,
      warnedSkips,
      spec.slug,
      'no-pr',
      `[gate-writeback] nothing to announce for gated spec "${spec.slug}" (no PR)`,
      verbose,
    );
    return;
  }

  const state = await prMergeState(runGh, cwd, prUrl, log);
  if (TERMINAL_PR_STATES.has(state.state)) {
    logSkipOnce(
      log,
      warnedSkips,
      spec.slug,
      'pr-terminal',
      `[gate-writeback] nothing to announce for gated spec "${spec.slug}" (PR ${prUrl} is ${state.state}) — will retry if it revives`,
      verbose,
    );
    return;
  }

  await ensureGatedPrLabel(spec, prUrl, runGh, cwd, log);
  await upsertGatedMarkerComment(spec, prUrl, runGh, cwd, log);
}

/**
 * Called once per scan pass for each spec that is currently owner-gated and
 * carries an intake-originated `Source-Ref: owner/repo#N` marker (Task 20).
 * Independent counterpart to {@link announceGatedPr}: this announces on the
 * originating GitHub *issue*, using the exact same label + marker-comment
 * upsert pattern, but is entirely decoupled from the PR path — a failure (or
 * success) here has no bearing on the PR announcement, and vice versa.
 *
 * No-ops (zero `gh` calls) when:
 *   - `spec.kind !== 'spec'` — repo-level warnings have no originating spec/
 *     issue to announce against.
 *   - `sourceRef` is absent (chat-originated spec, no intake marker) —
 *     silent skip.
 *   - `sourceRef` is present but fails to parse via {@link parseSourceRef}
 *     (the single parse source shared with the rest of the intake linkage) —
 *     skipped with a logged notice (deduped per `(slug, 'no-source-ref')` via
 *     {@link logSkipOnce}), never a `gh` call with garbage arguments.
 *
 * Otherwise labels + upserts the marker comment on the issue. Commenting is
 * attempted regardless of the issue's open/closed state (a closed issue can
 * still receive comments). Both steps are best-effort/non-throwing — this
 * function itself never throws, mirroring {@link announceGatedPr}.
 */
export async function announceGatedIssue(
  spec: GatedSpecEntry,
  sourceRef: string | undefined,
  deps: GateWritebackDeps,
): Promise<void> {
  const { cwd, log, warnedSkips, verbose } = deps;
  const runGh = deps.runGh ?? makeProductionGh();

  if (spec.kind !== 'spec') {
    return;
  }

  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    logSkipOnce(
      log,
      warnedSkips,
      spec.slug,
      'no-source-ref',
      `[gate-writeback] nothing to announce on an issue for gated spec "${spec.slug}" ` +
        `(no usable Source-Ref, got "${sourceRef ?? ''}") — will retry when one exists`,
      verbose,
    );
    return;
  }

  // Ownership isolation (the #691-class breach): a gated spec is always
  // `other-owner`, so its originating intake issue belongs to a DIFFERENT
  // operator. This daemon must NOT label or comment on another operator's
  // issue — that is exactly how one operator's daemon left 83 owner-gated
  // comments on issues assigned to another operator. Silently skip; only the
  // issue's own operator (whose daemon does not gate the spec) may write on it.
  if (spec.reason === 'other-owner') {
    return;
  }

  const issueUrl = `https://github.com/${parsed.repo}/issues/${parsed.number}`;

  try {
    await ensureLabel(runGh, cwd, OWNER_GATED_LABEL, LABEL_COLOR, log);
    await addLabel(runGh, cwd, issueUrl, OWNER_GATED_LABEL, log);
    await upsertIssueComment(runGh, cwd, issueUrl, OWNER_GATED_MARKER, renderCommentBody(spec), log);
  } catch (err) {
    log?.(`[gate-writeback] issue announcement for ${issueUrl} failed: ${err}`);
  }
}
