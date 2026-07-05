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
  OWNER_GATED_MARKER,
} from './pr-labels.js';

export { OWNER_GATED_MARKER };

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
 * on yet.
 *
 * Both steps are independently best-effort/non-throwing; a failure in one
 * does not prevent the other from being attempted.
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

  await ensureGatedPrLabel(spec, prUrl, runGh, cwd, log);
  await upsertGatedMarkerComment(spec, prUrl, runGh, cwd, log);
}
