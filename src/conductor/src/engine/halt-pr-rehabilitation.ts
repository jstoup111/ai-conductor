/**
 * Halt-PR rehabilitation engine step (adr-2026-07-03-halt-pr-rehabilitation-at-finish).
 *
 * When `finish` completes a feature whose recorded PR was born as a
 * `needs-remediation` halt PR (escalateBuildFailure), this step deterministically
 * fixes the machine-owned facets: draft→ready, clear the `needs-remediation`
 * label (REST), and inject `Closes <sourceRef>` exactly once. Title/body
 * presentation is the /finish//pr skill's job (Decision 1) and is never touched
 * here; the finish completion gate enforces it (Decision 3).
 *
 * Detection is stateless (Decision 4): halt signal = title prefixed
 * `needs-remediation:` OR the `needs-remediation` label OR the engine-authored
 * halt banner sentinel in the body (`HALT_PR_BANNER_SENTINEL`, issue #632) —
 * four independent, purely-observable signals. Draft status alone is
 * NOT a halt signal — `pr_timing: early-draft` opens legitimate clean-titled
 * draft PRs (#199).
 *
 * All mechanics are warn-only: failures log and never throw (mirrors
 * `conduct shipped-record` degradation); partial failure is representable in
 * the outcome.
 */

import type { GhRunner } from './pr-labels.js';
import {
  cleanupHaltPresentation,
  upsertComment,
  readHaltPresentation,
  setReady,
  comment,
  defaultSleep,
  HALT_PR_BANNER_SENTINEL,
  HALT_PR_BANNER_LINES,
  NEEDS_REMEDIATION_MARKER,
  NEEDS_REMEDIATION_BODY_MARKER,
} from './pr-labels.js';
import { injectIssueRef } from './engineer/issue-ref.js';

export const NEEDS_REMEDIATION_TITLE_PREFIX = 'needs-remediation:';
export const NEEDS_REMEDIATION_LABEL = 'needs-remediation';

export type RehabilitationOutcome =
  | 'not-halt-pr'
  | 'rehabilitated'
  | 'partial'
  | 'gh-unavailable';

export interface RehabilitateHaltPrDeps {
  gh: GhRunner;
  cwd: string;
  prUrl: string;
  sourceRef: string | undefined | null;
  log?: (msg: string) => void;
  /**
   * Leave draft status alone. The draft→ready flip is the one mechanic in this
   * function that is genuinely finish-only — a retained SHIP draft PR must stay
   * a draft until the ship gates have run. Every other mechanic (unlabel, body
   * marker, Closes injection) is safe at any point in the SHIP phase.
   */
  preserveDraft?: boolean;
}

export interface PrViewState {
  title: string;
  isDraft: boolean;
  labels: string[];
  body?: string;
}

function parsePrView(stdout: string): PrViewState {
  let raw: { title?: unknown; isDraft?: unknown; labels?: unknown; body?: unknown };
  try {
    raw = JSON.parse(stdout || '{}') as typeof raw;
  } catch {
    raw = {};
  }
  const labels = Array.isArray(raw.labels)
    ? raw.labels.map((l) => String((l as { name?: unknown } | null)?.name ?? ''))
    : [];
  return {
    title: String(raw.title ?? ''),
    isDraft: Boolean(raw.isDraft),
    labels,
    body: String(raw.body ?? ''),
  };
}

/**
 * Rehabilitate a reused halt PR at finish time. Returns:
 *   - 'not-halt-pr'    — no halt signal on the PR; zero mutations issued
 *   - 'rehabilitated'  — every applicable mechanic succeeded (or was already done)
 *   - 'partial'        — halt signal present but some mutation failed (logged)
 *   - 'gh-unavailable' — the initial state read failed; nothing attempted
 */
export async function rehabilitateHaltPr(
  deps: RehabilitateHaltPrDeps,
): Promise<RehabilitationOutcome> {
  const { gh, cwd, prUrl, sourceRef } = deps;
  const log = deps.log ?? (() => {});

  let view: PrViewState;
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title,isDraft,labels,body'], { cwd });
    view = parsePrView(stdout);
  } catch (err) {
    log(`[halt-pr-rehab] gh pr view failed for ${prUrl} — skipping rehabilitation: ${err}`);
    return 'gh-unavailable';
  }

  if (!hasHaltSignal(view)) return 'not-halt-pr';

  // Label/draft/body-marker removal is delegated to cleanupHaltPresentation,
  // which retries each mutation (bounded, with backoff) and re-reads to
  // confirm — the same verify-after-write guarantee ADR
  // adr-2026-07-05-halt-pr-presentation-reliability (D5) requires here.
  const cleanupResult = await cleanupHaltPresentation(gh, cwd, prUrl, log, defaultSleep, {
    preserveDraft: deps.preserveDraft === true,
  });
  const anyFailed = cleanupResult === 'partial';

  // Idempotent Closes injection — injectIssueRef swallows gh failures internally
  // (warn-only) and no-ops when the ref is already present or sourceRef is unusable.
  await injectIssueRef({ gh, prUrl, keyword: 'Closes', sourceRef, cwd, log });

  return anyFailed ? 'partial' : 'rehabilitated';
}

export type ClearHaltStateForResumeOutcome = 'cleared' | 'not-halted' | 'partial' | 'gh-unavailable';

/**
 * Clear the machine-owned halt state before a resumed feature dispatches.
 *
 * The PR remains a draft while the label and body marker are removed, so a
 * resumed BUILD task can reuse its implementation PR without exposing it for
 * review early. Writes are delegated to the verified cleanup seam.
 */
export async function clearHaltStateForResume(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  log: (msg: string) => void = () => {},
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<ClearHaltStateForResumeOutcome> {
  let view: PrViewState;
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'isDraft,labels,body'], { cwd });
    view = parsePrView(stdout);
  } catch (err) {
    log(`[halt-pr-rehab] resume clear state read failed for ${prUrl}: ${err}`);
    return 'gh-unavailable';
  }

  const hasLabel = view.labels.includes(NEEDS_REMEDIATION_LABEL);
  const hasMarker = (view.body ?? '').includes(NEEDS_REMEDIATION_BODY_MARKER);
  if (!hasLabel && !hasMarker) {
    log(`[halt-pr-rehab] resume clear found no halt state for ${prUrl}`);
    return 'not-halted';
  }

  const cleanup = await cleanupHaltPresentation(gh, cwd, prUrl, log, sleep, { preserveDraft: true });
  if (cleanup === 'confirmed') {
    await upsertComment(
      gh,
      cwd,
      prUrl,
      NEEDS_REMEDIATION_MARKER,
      'Halt resolved — the feature resumed and its remediation state was cleared automatically.',
      log,
    );
    log(`[halt-pr-rehab] resume clear confirmed for ${prUrl}`);
    return 'cleared';
  }

  log(`[halt-pr-rehab] resume clear was partial for ${prUrl}`);
  return 'partial';
}

export type RetitleFloorOutcome = 'not-halt-pr' | 'resolved';

export interface RetitleFloorResult {
  outcome: RetitleFloorOutcome;
  title: string;
}

export function branchToFeatureDesc(branch: string): string {
  const withoutPrefix = branch.replace(/^[a-z]+\//i, '');
  return withoutPrefix.replace(/[-_]+/g, ' ').trim() || branch;
}

/**
 * Deterministic retitle floor (Task 6, adr-2026-07-03-halt-pr-rehabilitation-at-finish).
 *
 * Guards against a stale `needs-remediation:` title surviving to a shipped
 * PR by rewriting it to `feat: <featureDesc>` (or a branch-derived fallback
 * when no featureDesc is supplied). A clean, non-halt title is left
 * completely untouched — zero `gh pr edit` calls are issued — and the PR
 * body is never part of this mutation. All gh failures are warn-only: they
 * log and resolve rather than throw or block.
 */
export async function retitleFloor(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  opts: { featureDesc?: string; branch?: string } = {},
  log: (msg: string) => void = () => {},
): Promise<RetitleFloorResult> {
  let currentTitle = '';
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title'], { cwd });
    currentTitle = String((JSON.parse(stdout || '{}') as { title?: unknown }).title ?? '');
  } catch (err) {
    log(`[halt-pr-rehab] retitle-floor gh pr view failed for ${prUrl} — skipping: ${err}`);
    return { outcome: 'not-halt-pr', title: currentTitle };
  }

  if (!currentTitle.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX)) {
    return { outcome: 'not-halt-pr', title: currentTitle };
  }

  const featureDesc =
    opts.featureDesc?.trim() || (opts.branch ? branchToFeatureDesc(opts.branch) : '') || 'rehabilitated PR';
  const newTitle = `feat: ${featureDesc}`;

  try {
    await gh(['pr', 'edit', prUrl, '--title', newTitle], { cwd });
  } catch (err) {
    log(`[halt-pr-rehab] retitle-floor gh pr edit failed for ${prUrl} — warn-only: ${err}`);
    return { outcome: 'resolved', title: newTitle };
  }

  return { outcome: 'resolved', title: newTitle };
}

/**
 * Fail-open presentation read for the finish completion gate (Decision 3).
 * Returns the stale halt title when a SUCCESSFUL read shows the recorded PR
 * still titled `needs-remediation:…`; returns null both when the title is
 * clean AND on any gh read error (network never blocks a ship — the caller
 * treats null as pass).
 */
export async function readStaleHaltTitle(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<string | null> {
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title'], { cwd });
    const title = String((JSON.parse(stdout || '{}') as { title?: unknown }).title ?? '');
    return title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX) ? title : null;
  } catch (err) {
    log?.(`[halt-pr-rehab] gate read failed for ${prUrl} — fail-open: ${err}`);
    return null;
  }
}

export type EnsureShipReadyOutcome = 'no-op' | 'flipped-ready' | 'partial';

/**
 * Unconditional draft→ready flip for the recorded PR at finish time (Task 7).
 *
 * Distinct from {@link rehabilitateHaltPr}: no halt-signal classification, no
 * unlabel, no retitle, no body-marker mutation — this is purely the ready-flip
 * mechanic with a verify-after-write re-read, reusing the same bounded-retry
 * shape as {@link cleanupHaltPresentation}'s label removal. A PR that is
 * already ready is left completely untouched (zero `gh pr ready` calls).
 *
 * Never throws; all gh failures are warn-only and folded into the 'partial'
 * outcome.
 *
 * @returns 'no-op' when the PR was already ready; 'flipped-ready' when the
 *   flip was verified by re-read; 'partial' when the PR is still draft after
 *   bounded retries, or the initial/verify read failed.
 */
export async function ensureShipReady(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<EnsureShipReadyOutcome> {
  const logFn = log ?? (() => {});

  try {
    const before = await readHaltPresentation(gh, cwd, prUrl, logFn);
    if (!before) {
      logFn(`[halt-pr-rehab] ensureShipReady: could not read PR state for ${prUrl}`);
      return 'partial';
    }

    if (!before.isDraft) {
      return 'no-op';
    }

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await setReady(gh, cwd, prUrl, logFn);

      const after = await readHaltPresentation(gh, cwd, prUrl, logFn);
      if (after && !after.isDraft) {
        return 'flipped-ready';
      }

      if (attempt < maxAttempts) {
        const backoffMs = attempt * 100;
        logFn(
          `[halt-pr-rehab] ensureShipReady(${prUrl}): still draft after attempt ${attempt}, retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }

    logFn(`[halt-pr-rehab] ensureShipReady(${prUrl}): still draft after ${maxAttempts} attempts — non-fatal`);
    return 'partial';
  } catch (err) {
    logFn(`[halt-pr-rehab] ensureShipReady(${prUrl}) error: ${err}`);
    return 'partial';
  }
}

/**
 * Fail-open presentation read analog of {@link readStaleHaltTitle}, but for
 * the body banner signal instead of the title prefix. Returns
 * `HALT_PR_BANNER_SENTINEL` when a SUCCESSFUL read shows the recorded PR
 * body still contains the engine-authored halt banner; returns null both
 * when the body is clean AND on any gh read error (network never blocks a
 * ship — the caller treats null as pass).
 */
export async function readStaleHaltBanner(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<string | null> {
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
    const body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
    return body.includes(HALT_PR_BANNER_SENTINEL) ? HALT_PR_BANNER_SENTINEL : null;
  } catch (err) {
    log?.(`[halt-pr-rehab] gate read failed for ${prUrl} — fail-open: ${err}`);
    return null;
  }
}

/**
 * Invisible marker stamped into an engine-floored PR body. Renders as nothing
 * on GitHub, so the body still reads like a clean finish produced it, but it
 * remains a deterministic signal that no `/pr`-authored prose was ever written
 * for this PR.
 */
export const PR_BODY_FLOOR_MARKER = '<!-- conductor:pr-body-floor -->';

/**
 * Per-section "nobody wrote this yet" text the SHIP-entry draft body stamps
 * into every template slot, and the reader note that same body carries. Both
 * are literal engine output, so their presence is decisive evidence that the
 * floor is intact.
 */
const FLOOR_UNAUTHORED_SECTION = /not yet authored/i;
const FLOOR_DRAFT_NOTE = /draft opened automatically/i;

/**
 * Ceiling on the free text an engine floor can itself contain.
 *
 * Both floor generators emit exactly ONE free-text slot — the feature
 * description ({@link bodyFloor}'s `## Summary`, and the SHIP-entry draft's
 * `## Why`) — and {@link authoredProseLength} already discards the structured
 * appendages the publication path adds to a still-unauthored body. Every
 * shape the engine can produce therefore stays far under this bound, while an
 * authored `/pr` body populates three template sections and runs an order of
 * magnitude larger (the body that triggered #1703 was 3,988 characters). The
 * bound sits in the wide gap between them rather than against either edge.
 *
 * It is deliberately generous in the conservative direction: a body too thin
 * to clear it stays classified as a floor, so FINISH authors it again rather
 * than shipping thin prose.
 */
const FLOOR_FREE_TEXT_MAX_CHARS = 400;

/**
 * Reader-facing prose only, with everything structural removed.
 *
 * Dropped because the engine — not an author — puts them there: fenced code
 * blocks (the release `## Migration` fence), any `<!-- name:start -->` …
 * `<!-- name:end -->` region the engine upserts (the accepted build-review
 * risk section), every other HTML comment (the floor marker itself, the
 * `Closes` hint, the remediation markers), ATX headings, horizontal rules,
 * `Release-*` metadata fields, the injected issue reference, and the two
 * literal floor texts above. What survives is content somebody chose to
 * write, which is exactly what distinguishes an authored body from a floor.
 */
function authoredProseLength(body: string): number {
  return body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/<!--\s*[\w:-]+:start\s*-->[\s\S]*?<!--\s*[\w:-]+:end\s*-->/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .filter((line) => !/^#{1,6}\s/.test(line))
    .filter((line) => !/^(?:-{3,}|\*{3,}|_{3,})$/.test(line))
    .filter((line) => !/^Release-[A-Za-z]+:/.test(line))
    .filter((line) => !/^(?:closes|fixes|resolves)\b/i.test(line))
    .filter((line) => !FLOOR_UNAUTHORED_SECTION.test(line))
    .filter((line) => !FLOOR_DRAFT_NOTE.test(line))
    .reduce((total, line) => total + line.length, 0);
}

/**
 * Is this PR body still the engine's own floor, rather than authored prose?
 *
 * {@link PR_BODY_FLOOR_MARKER} is PROVENANCE, not a verdict. It is an
 * invisible HTML comment, and an authoring pass that rewrites the body around
 * it — a natural thing for a model to do with a structural-looking marker —
 * leaves it in place. Treating marker presence alone as proof of an
 * unauthored body therefore classified 3,988 characters of genuine prose as a
 * placeholder, and the non-advancing-transition guard halted FINISH on
 * finished work (#1703). Prompting the authoring pass to delete the marker is
 * not a fix: the marker's meaning has to hold mechanically whatever the
 * provider writes.
 *
 * So the marker is NECESSARY but never SUFFICIENT. A marked body is a floor
 * only while it still holds floor content: the intact per-section placeholder
 * text, the SHIP-entry draft note, or free text no larger than the single
 * description slot a floor can fill.
 */
export function isEngineFlooredBody(body: string): boolean {
  if (!body.includes(PR_BODY_FLOOR_MARKER)) return false;
  if (FLOOR_UNAUTHORED_SECTION.test(body) || FLOOR_DRAFT_NOTE.test(body)) return true;
  return authoredProseLength(body) <= FLOOR_FREE_TEXT_MAX_CHARS;
}

/**
 * Invisible marker identifying the single harness-authored halt-history
 * comment on a rehabilitated PR (mirrors `NEEDS_REMEDIATION_MARKER`). Used to
 * keep {@link postHaltHistoryComment} idempotent across finish attempts.
 */
export const HALT_HISTORY_COMMENT_MARKER = '<!-- conductor:halt-history -->';

/**
 * Fail-open presentation read analog of {@link readStaleHaltBanner}, but for
 * the engine's own body floor. Returns {@link PR_BODY_FLOOR_MARKER} when a
 * SUCCESSFUL read shows the recorded PR body is an engine-generated
 * placeholder rather than a `/pr`-authored body; returns null both when the
 * body is real AND on any gh read error (network never blocks a ship).
 */
export async function readFlooredBody(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  log?: (msg: string) => void,
): Promise<string | null> {
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
    const body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
    return isEngineFlooredBody(body) ? PR_BODY_FLOOR_MARKER : null;
  } catch (err) {
    log?.(`[halt-pr-rehab] floored-body read failed for ${prUrl} — fail-open: ${err}`);
    return null;
  }
}

export interface HaltHistoryCommentDeps {
  gh: GhRunner;
  cwd: string;
  prUrl: string;
  /** Halt reason text, e.g. the contents of `.pipeline/halt-user-input-required`. */
  haltReason?: string | null;
  log?: (msg: string) => void;
}

export type HaltHistoryCommentOutcome = 'not-halt-pr' | 'already-posted' | 'posted' | 'gh-unavailable';

/**
 * Preserve a reused halt PR's remediation narrative as a PR COMMENT.
 *
 * The shipped PR body is always the plain `/pr` template (no remediation
 * prose, no rehabilitation footnote) — every recovery narrative lives here
 * instead. Called before the body is rewritten (by `/pr` or by the floor), so
 * the halt banner and halt title are captured while still observable.
 *
 * Idempotent via {@link HALT_HISTORY_COMMENT_MARKER}; never throws.
 */
export async function postHaltHistoryComment(
  deps: HaltHistoryCommentDeps,
): Promise<HaltHistoryCommentOutcome> {
  const { gh, cwd, prUrl } = deps;
  const log = deps.log ?? (() => {});

  let view: PrViewState;
  let existingComments: string[] = [];
  try {
    const { stdout } = await gh(
      ['pr', 'view', prUrl, '--json', 'title,isDraft,labels,body,comments'],
      { cwd },
    );
    view = parsePrView(stdout);
    try {
      const raw = JSON.parse(stdout || '{}') as { comments?: unknown };
      if (Array.isArray(raw.comments)) {
        existingComments = raw.comments.map((c) => String((c as { body?: unknown } | null)?.body ?? ''));
      }
    } catch {
      existingComments = [];
    }
  } catch (err) {
    log(`[halt-pr-rehab] halt-history gh pr view failed for ${prUrl} — skipping: ${err}`);
    return 'gh-unavailable';
  }

  const hasHaltTitle = view.title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX);
  const hasHaltLabel = view.labels.includes(NEEDS_REMEDIATION_LABEL);
  const body = view.body ?? '';
  const hasHaltBanner = body.includes(HALT_PR_BANNER_SENTINEL);
  if (!hasHaltTitle && !hasHaltLabel && !hasHaltBanner) return 'not-halt-pr';

  if (existingComments.some((c) => c.includes(HALT_HISTORY_COMMENT_MARKER))) {
    return 'already-posted';
  }

  const parts: string[] = [
    HALT_HISTORY_COMMENT_MARKER,
    '## Halt history',
    '',
    'This PR was reused from a `needs-remediation` halt PR. Its title and body have been ' +
      'rewritten to the standard PR template; the remediation narrative is preserved here ' +
      'rather than in the PR body.',
  ];
  if (hasHaltTitle) {
    parts.push('', `**Original halt title:** \`${view.title}\``);
  }
  if (hasHaltLabel) {
    parts.push('', `**Halt label at rehabilitation:** \`${NEEDS_REMEDIATION_LABEL}\``);
  }
  if (hasHaltBanner) {
    const banner = body
      .split('\n')
      .filter((line) => (HALT_PR_BANNER_LINES as readonly string[]).includes(line))
      .join('\n');
    parts.push('', '**Original halt banner:**', '', '> ' + banner.split('\n').join('\n> '));
  }
  const haltReason = deps.haltReason?.trim();
  if (haltReason) {
    parts.push('', '**Halt reason (`.pipeline/halt-user-input-required`):**', '', '```', haltReason, '```');
  }

  await comment(gh, cwd, prUrl, parts.join('\n'), log);
  return 'posted';
}

export interface MakeRetainedPrPresentableDeps {
  gh: GhRunner;
  cwd: string;
  /** The retained SHIP PR adopted by `openShipDraftPr`. */
  prUrl: string;
  /** Intake source ref, for the idempotent `Closes` injection. */
  sourceRef?: string | undefined | null;
  featureDesc?: string;
  branch?: string;
  /** Contents of `.pipeline/halt-user-input-required`, for the halt-history comment. */
  haltReason?: string | null;
  /** Optional `## Test evidence` line for the body floor. */
  testEvidenceLine?: string;
  log?: (msg: string) => void;
}

export type RetainedPrPresentableOutcome =
  /** No halt signal on the retained PR — zero mutations issued. */
  | 'not-halt-pr'
  /** Every applicable presentation repair succeeded (or was already done). */
  | 'repaired'
  /** Halt signal present but some mutation could not be confirmed (logged). */
  | 'partial'
  /** The state read failed — nothing attempted. */
  | 'gh-unavailable';

/** True when any stateless halt signal is observable on the PR. */
export function hasHaltSignal(view: PrViewState): boolean {
  return (
    view.title.toLowerCase().startsWith(NEEDS_REMEDIATION_TITLE_PREFIX) ||
    view.labels.includes(NEEDS_REMEDIATION_LABEL) ||
    (view.body ?? '').includes(NEEDS_REMEDIATION_BODY_MARKER) ||
    (view.body ?? '').includes(HALT_PR_BANNER_SENTINEL)
  );
}

/**
 * Make the retained SHIP PR presentable for the FIRST SHIP-phase step that
 * consumes it, whatever that step is.
 *
 * ## Why this exists
 *
 * `openShipDraftPr` adopts any OPEN PR already on the branch (`findOrCreatePr`
 * returns it untouched). When an earlier HALT left a `needs-remediation`
 * placeholder PR on the branch, that placeholder silently becomes the retained
 * SHIP PR. Every presentation repair used to be bound to the `finish` step, so
 * a SHIP-phase step scheduled BEFORE finish — any config-declared custom step,
 * e.g. one that writes release metadata into the retained PR — was handed a
 * remediation placeholder and could only refuse.
 *
 * This is the same repair set `repairFinishPr` applies, minus the one mechanic
 * that is genuinely finish-only:
 *
 *   - halt-history comment (idempotent, marker-guarded) — preserved first, while
 *     the halt signals are still observable
 *   - `needs-remediation` label + body marker removal, **draft preserved**
 *   - `Closes` injection — verified safe here: it needs only the intake
 *     `sourceRef` (committed during DECIDE) plus the PR body, it is idempotent
 *     via `bodyReferencesIssue`, and the ref is inert until merge, which a draft
 *     PR cannot reach
 *   - retitle floor (`needs-remediation: …` → `feat: …`)
 *   - body floor (strip the halt banner, floor a `## Summary`)
 *
 * **Excluded: the draft→ready flip.** Flipping the retained PR ready here would
 * put it up for review before the ship gates ran. `finish` still owns that
 * (`ensureShipReady`).
 *
 * Idempotent by construction: every mechanic detects its own halt signal and
 * no-ops when it is already gone, so running this at SHIP adoption AND again at
 * finish leaves exactly one repaired PR and one halt-history comment.
 *
 * Never throws — this is advisory, exactly like `openShipDraftPr`.
 */
export async function makeRetainedPrPresentable(
  deps: MakeRetainedPrPresentableDeps,
): Promise<RetainedPrPresentableOutcome> {
  const { gh, cwd, prUrl } = deps;
  const log = deps.log ?? (() => {});

  // One state read up front. The overwhelmingly common case — a PR with no halt
  // signal — costs exactly this read and issues zero mutations, so putting the
  // repair on the SHIP-adoption path does not tax every ordinary run.
  let view: PrViewState;
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title,isDraft,labels,body'], {
      cwd,
    });
    view = parsePrView(stdout);
  } catch (err) {
    log(`[halt-pr-rehab] retained-PR state read failed for ${prUrl} — skipping repair: ${err}`);
    return 'gh-unavailable';
  }
  if (!hasHaltSignal(view)) return 'not-halt-pr';

  // Step 0: preserve the remediation narrative as a PR COMMENT before anything
  // rewrites the presentation. Marker-guarded, so a second call never doubles it.
  try {
    await postHaltHistoryComment({
      gh,
      cwd,
      prUrl,
      haltReason: deps.haltReason,
      log,
    });
  } catch (err) {
    log(`[halt-pr-rehab] retained-PR halt-history capture failed for ${prUrl}: ${err}`);
  }

  // Step 1: label + body marker + Closes, with draft status left alone.
  let rehabOutcome: RehabilitationOutcome = 'not-halt-pr';
  try {
    rehabOutcome = await rehabilitateHaltPr({
      gh,
      cwd,
      prUrl,
      sourceRef: deps.sourceRef ?? undefined,
      log,
      preserveDraft: true,
    });
  } catch (err) {
    log(`[halt-pr-rehab] retained-PR rehabilitation failed for ${prUrl}: ${err}`);
    return 'partial';
  }

  let anyFailed = rehabOutcome === 'partial' || rehabOutcome === 'gh-unavailable';

  // Step 2: retitle floor (`needs-remediation:` → `feat: …`).
  try {
    await retitleFloor(gh, cwd, prUrl, { featureDesc: deps.featureDesc, branch: deps.branch }, log);
  } catch (err) {
    log(`[halt-pr-rehab] retained-PR retitleFloor failed for ${prUrl}: ${err}`);
    anyFailed = true;
  }

  // Step 3: body floor (strip the halt banner, floor a `## Summary`).
  try {
    const floored = await bodyFloor(
      gh,
      cwd,
      prUrl,
      {
        featureDesc: deps.featureDesc,
        sourceRef: deps.sourceRef,
        testEvidenceLine: deps.testEvidenceLine,
      },
      log,
    );
    if (floored === 'partial') anyFailed = true;
  } catch (err) {
    log(`[halt-pr-rehab] retained-PR bodyFloor failed for ${prUrl}: ${err}`);
    anyFailed = true;
  }

  return anyFailed ? 'partial' : 'repaired';
}

export type BodyFloorOutcome = 'not-halt-body' | 'floored' | 'partial';

/**
 * Deterministic body floor (Task 2, companion to {@link retitleFloor}).
 *
 * Strips the engine-authored halt banner lines from a reused halt PR's
 * body, collapses the resulting blank-line runs, and — if no `## Summary`
 * heading survives — prepends a minimal rehabilitation summary block (with
 * an optional test-evidence checklist item). A body with no halt banner is
 * left completely untouched (zero `gh` mutation calls). All gh failures are
 * warn-only and folded into the 'partial' outcome; the write is verified by
 * a re-read with the same bounded-retry/backoff shape as
 * {@link ensureShipReady}.
 */
export async function bodyFloor(
  gh: GhRunner,
  cwd: string,
  prUrl: string,
  opts: { featureDesc?: string; sourceRef?: string | null; testEvidenceLine?: string } = {},
  log?: (msg: string) => void,
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<BodyFloorOutcome> {
  const logFn = log ?? (() => {});

  let body = '';
  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
    body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
  } catch (err) {
    logFn(`[halt-pr-rehab] bodyFloor gh pr view failed for ${prUrl} — skipping: ${err}`);
    return 'partial';
  }

  if (!body.includes(HALT_PR_BANNER_SENTINEL)) {
    return 'not-halt-body';
  }

  const bannerLines: readonly string[] = HALT_PR_BANNER_LINES;
  const stripped = body
    .split('\n')
    .filter((line) => !bannerLines.includes(line));

  // Collapse runs of 2+ consecutive blank lines down to a single blank line.
  const collapsed: string[] = [];
  for (const line of stripped) {
    if (line.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') {
      continue;
    }
    collapsed.push(line);
  }

  // Trim leading/trailing blank lines.
  let start = 0;
  let end = collapsed.length;
  while (start < end && collapsed[start].trim() === '') start++;
  while (end > start && collapsed[end - 1].trim() === '') end--;
  const remainingBody = collapsed.slice(start, end).join('\n');

  let newBody = remainingBody;
  // An engine-authored placeholder already carries the floor marker (the
  // SHIP-entry draft body does, and it has no `## Summary` heading), so keying
  // "already floored" on the heading alone would stack a SECOND floor block on
  // top of it.
  if (!remainingBody.includes('## Summary') && !remainingBody.includes(PR_BODY_FLOOR_MARKER)) {
    const featureDesc = opts.featureDesc?.trim() || 'rehabilitated PR';
    // The floor never narrates remediation into the body: a shipped PR body
    // must read exactly like a clean first-pass finish produced it. Halt
    // history goes to a PR comment (postHaltHistoryComment). The only
    // floor-specific content is an invisible HTML-comment marker, which lets
    // the finish gate recognise an engine-authored placeholder on a later
    // pass without any reader-visible residue.
    let floorBlock = `${PR_BODY_FLOOR_MARKER}\n\n## Summary\n\n${featureDesc}`;
    const testEvidenceLine = opts.testEvidenceLine?.trim();
    if (testEvidenceLine) {
      // Never assert a checked box for work that is not complete: a
      // zero-completion line ships as an explicitly unchecked item.
      const box = /^0\s*\//.test(testEvidenceLine) ? '- [ ]' : '- [x]';
      floorBlock += `\n\n## Test evidence\n\n${box} ${testEvidenceLine}`;
    }
    newBody = remainingBody ? `${floorBlock}\n\n${remainingBody}` : floorBlock;
  }

  const maxAttempts = 3;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await gh(['pr', 'edit', prUrl, '--body', newBody], { cwd });

      const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
      const verifyBody = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
      if (!verifyBody.includes(HALT_PR_BANNER_SENTINEL)) {
        return 'floored';
      }

      if (attempt < maxAttempts) {
        const backoffMs = attempt * 100;
        logFn(
          `[halt-pr-rehab] bodyFloor(${prUrl}): banner still present after attempt ${attempt}, retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }

    logFn(`[halt-pr-rehab] bodyFloor(${prUrl}): banner still present after ${maxAttempts} attempts — non-fatal`);
    return 'partial';
  } catch (err) {
    logFn(`[halt-pr-rehab] bodyFloor(${prUrl}) error: ${err}`);
    return 'partial';
  }
}
