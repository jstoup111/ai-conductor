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
 * PR states for which write-back is a no-op: the PR has already left the
 * "open" lifecycle, so there is nothing left to label/comment on. A PR that
 * merged was presumably already announced while open; a closed PR is dead.
 * `NOTFOUND` (deleted/inaccessible) is treated the same way — see
 * {@link announceGatedPr}.
 */
const TERMINAL_PR_STATES = new Set(['MERGED', 'CLOSED', 'NOTFOUND']);

// ── Constants ─────────────────────────────────────────────────────────────────

export const OWNER_GATED_LABEL = 'owner-gated';
const LABEL_COLOR = 'FBCA04';

// ── Types ─────────────────────────────────────────────────────────────────────

export type GatedReason = 'other-owner' | 'unowned-post-cutover' | 'unowned-indeterminate';

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
 * body content — so when a spec's gated `reason` changes between scan passes
 * (e.g. `unowned-indeterminate` -> `other-owner` -> back again), the same
 * comment is found and PATCHed with the freshly rendered body instead of a
 * new comment being created. This holds across any number of back-and-forth
 * transitions: exactly one comment ever exists, and its body always reflects
 * the most recently observed reason/remedy/owner.
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
 * If the PR is already MERGED, CLOSED, or genuinely gone (404/NOTFOUND), the
 * write-back is also skipped: a merged PR was presumably already announced
 * while it was open, and there is nothing useful to label/comment on a dead
 * PR. This one `pr view` lookup is the only extra `gh` call added for this
 * check — no retries are attempted regardless of its outcome.
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
  const { cwd, log } = deps;
  const runGh = deps.runGh ?? makeProductionGh();

  if (!prUrl) {
    log?.(`[gate-writeback] no PR known for gated spec "${spec.slug}" — skipping label/comment`);
    return;
  }

  const state = await prMergeState(runGh, cwd, prUrl, log);
  if (TERMINAL_PR_STATES.has(state.state)) {
    log?.(
      `[gate-writeback] PR ${prUrl} for gated spec "${spec.slug}" is ${state.state} — skipping label/comment`,
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
 *     skipped with a logged notice, never a `gh` call with garbage
 *     arguments.
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
  const { cwd, log } = deps;
  const runGh = deps.runGh ?? makeProductionGh();

  if (spec.kind !== 'spec') {
    return;
  }

  const parsed = parseSourceRef(sourceRef);
  if (!parsed) {
    log?.(
      `[gate-writeback] no usable Source-Ref for gated spec "${spec.slug}" ` +
        `("${sourceRef ?? ''}") — skipping issue announcement`,
    );
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
