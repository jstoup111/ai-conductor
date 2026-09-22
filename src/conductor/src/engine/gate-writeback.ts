/**
 * Gate write-back orchestrator — labels and comments a spec's PR once it
 * becomes owner-gated (Task 17).
 *
 * Design constraints (mirroring the build-failure-escalation.ts / pr-labels.ts
 * seam):
 *   - Read and mutation seams are dependency-injected. An absent mutation
 *     seam keeps the local GATED state but performs no remote write.
 *   - All operations are best-effort / non-throwing: errors are caught
 *     internally, logged via the optional `log` callback, and never
 *     re-thrown to callers.
 *   - Idempotent: repeated calls against the same gated state produce exactly
 *     one label application and one marker comment (upserted in place, never
 *     duplicated).
 */

import {
  type GhRunner,
  type PrRunner,
  makeProductionGh,
  addLabel,
  upsertComment,
  prMergeState,
  OWNER_GATED_MARKER,
} from './pr-labels.js';
import { parseSourceRef } from './engineer/issue-ref.js';
import {
  executeGithubOperation,
  type GithubOperationRunner,
  type GithubOperationResult,
} from './github-operations.js';
import { runTrackerRead } from './tracker-client.js';

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
  /**
   * Required for every announcement mutation. Reads remain on `runGh`, while
   * this guarded seam decides each label/comment write independently.
   */
  operations?: GithubOperationRunner;
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
 * The marker helper needs read access to find an existing comment and the
 * guarded operation seam to mutate it. Combining the two does not expose a
 * raw write path: `pr-labels` directs every mutation through `.run`.
 */
function guardedPrRunner(runGh: GhRunner, operations: GithubOperationRunner): PrRunner {
  const read: GhRunner = (args, opts) => runGh(args, opts);
  return Object.assign(read, { run: operations.run.bind(operations) });
}

function isRefused(result: GithubOperationResult | { readonly kind: 'refused'; readonly reason: string }): boolean {
  return result.kind === 'refused';
}

interface IssueComment {
  body?: string;
  url?: string;
}

function issueCommentId(url: string): string | undefined {
  return /\/issues\/\d+#issuecomment-(\d+)$/.exec(url)?.[1];
}

/**
 * Upsert the Source-Ref issue marker through the intake authorization path.
 * The issue can be closed, so state is deliberately not part of this lookup.
 */
async function upsertGatedIssueMarkerComment(
  spec: GatedSpecEntry,
  repository: string,
  number: number,
  runGh: GhRunner,
  operations: GithubOperationRunner,
  cwd: string,
  log?: (msg: string) => void,
): Promise<GithubOperationResult | { readonly kind: 'refused'; readonly reason: string }> {
  const target = { repository, kind: 'issue' as const, number };
  const body = `${OWNER_GATED_MARKER}\n${renderCommentBody(spec)}`;
  let existing: IssueComment | undefined;
  try {
    const stdout = await runTrackerRead(
      runGh,
      cwd,
      'issue.read',
      repository,
      { kind: 'issue', number },
      ['issue', 'view', `${repository}#${number}`, '--json', 'comments'],
    );
    const parsed = JSON.parse(stdout || '{}') as { comments?: IssueComment[] };
    existing = parsed.comments?.find((comment) => comment.body?.includes(OWNER_GATED_MARKER));
  } catch (error) {
    log?.(`[gate-writeback] issue marker lookup for ${repository}#${number} failed: ${error}`);
  }

  const commentId = existing?.url ? issueCommentId(existing.url) : undefined;
  if (existing && commentId) {
    return await executeGithubOperation({
      operation: 'intake.issue.comment.update',
      repository,
      resource: target,
      context: { actor: 'gate-writeback' },
      payload: { commentId, body },
    }, operations);
  }
  if (existing) {
    // A marker with no canonical comment identity must not be duplicated.
    return { kind: 'refused', reason: 'invalid-target' };
  }
  return await executeGithubOperation({
    operation: 'intake.issue.comment.create',
    repository,
    resource: target,
    context: { actor: 'gate-writeback' },
    payload: { body },
  }, operations);
}

/**
 * Log a skip notice at most once per (slug, reason) key for the lifetime of
 * the given `warnedSkips` set. Repeated calls with the same key are silent
 * no-ops after the first. Requires `verbose: true` to log at all; when
 * `warnedSkips` is undefined, dedup is skipped but the verbose gate still applies.
 */
function logSkipOnce(
  log: ((msg: string) => void) | undefined,
  warnedSkips: Set<string> | undefined,
  slug: string,
  reason: string,
  msg: string,
  verbose?: boolean,
): void {
  if (verbose !== true) return;

  if (warnedSkips) {
    const key = `${slug}:${reason}`;
    if (warnedSkips.has(key)) return;
    warnedSkips.add(key);
  }
  log?.(msg);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply the pre-existing `owner-gated` label to the given PR. Definition
 * creation is shared repository administration and is deliberately excluded.
 */
export async function ensureGatedPrLabel(
  _spec: GatedSpecEntry,
  prUrl: string,
  runGh: PrRunner = makeProductionGh(),
  cwd: string,
  log?: (msg: string) => void,
): Promise<GithubOperationResult> {
  // Label definitions are repository-wide shared state. D4 deliberately
  // forbids an owner-gated feature from creating or force-updating one; the
  // association below is enough when an administrator has installed it.
  return await addLabel(runGh, cwd, prUrl, OWNER_GATED_LABEL, log);
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
  runGh: PrRunner = makeProductionGh(),
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

  // Local GATED visibility is recorded by the discovery snapshot/dashboard
  // before this write-back callback runs. Without an injected guarded seam,
  // retain that local state and decline all remote escalation writes.
  if (!deps.operations) return;
  const guarded = guardedPrRunner(runGh, deps.operations);
  const label = await ensureGatedPrLabel(spec, prUrl, guarded, cwd, log);
  // A policy refusal is terminal for this resource: never turn a denied label
  // into a comment fallback on the same foreign PR (ADR D6/D8).
  if (isRefused(label)) return;
  // Transport failure remains per-surface best-effort; the marker can still
  // make the gated state visible if the existing label association failed.
  await upsertGatedMarkerComment(spec, prUrl, guarded, cwd, log);
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
 * Otherwise labels + posts the marker comment on the issue through its own
 * guarded authorization path. Commenting is attempted regardless of the
 * issue's open/closed state (a closed issue can still receive comments). Both
 * steps are best-effort/non-throwing — this function itself never throws,
 * mirroring {@link announceGatedPr}.
 */
export async function announceGatedIssue(
  spec: GatedSpecEntry,
  sourceRef: string | undefined,
  deps: GateWritebackDeps,
): Promise<void> {
  const { log, warnedSkips, verbose } = deps;

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

  // A Source-Ref identifies a target but grants no authority. Its policy is
  // intentionally independent from the gated implementation PR.
  if (!deps.operations) return;
  const number = Number(parsed.number);
  if (!Number.isSafeInteger(number) || number < 1) return;
  const target = { repository: parsed.repo, kind: 'issue' as const, number };
  const label = await executeGithubOperation({
    operation: 'intake.issue.label.add',
    repository: parsed.repo,
    resource: target,
    context: { actor: 'gate-writeback' },
    payload: { label: OWNER_GATED_LABEL },
  }, deps.operations);
  if (isRefused(label)) return;

  const comment = await upsertGatedIssueMarkerComment(
    spec,
    parsed.repo,
    number,
    deps.runGh ?? makeProductionGh(),
    deps.operations,
    deps.cwd,
    log,
  );
  if (comment.kind === 'failed') {
    log?.(`[gate-writeback] issue announcement for ${parsed.repo}#${parsed.number} failed: ${comment.error}`);
  }
}
