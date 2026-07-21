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
 * three independent, purely-observable signals. Draft status alone is
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
  readHaltPresentation,
  setReady,
  defaultSleep,
  HALT_PR_BANNER_SENTINEL,
  HALT_PR_BANNER_LINES,
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
}

interface PrViewState {
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

  const hasHaltTitle = view.title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX);
  const hasHaltLabel = view.labels.includes(NEEDS_REMEDIATION_LABEL);
  const hasHaltBanner = (view.body ?? '').includes(HALT_PR_BANNER_SENTINEL);
  if (!hasHaltTitle && !hasHaltLabel && !hasHaltBanner) return 'not-halt-pr';

  // Label/draft/body-marker removal is delegated to cleanupHaltPresentation,
  // which retries each mutation (bounded, with backoff) and re-reads to
  // confirm — the same verify-after-write guarantee ADR
  // adr-2026-07-05-halt-pr-presentation-reliability (D5) requires here.
  const cleanupResult = await cleanupHaltPresentation(gh, cwd, prUrl, log);
  const anyFailed = cleanupResult === 'partial';

  // Idempotent Closes injection — injectIssueRef swallows gh failures internally
  // (warn-only) and no-ops when the ref is already present or sourceRef is unusable.
  await injectIssueRef({ gh, prUrl, keyword: 'Closes', sourceRef, cwd, log });

  return anyFailed ? 'partial' : 'rehabilitated';
}

export type RetitleFloorOutcome = 'not-halt-pr' | 'resolved';

export interface RetitleFloorResult {
  outcome: RetitleFloorOutcome;
  title: string;
}

function branchToFeatureDesc(branch: string): string {
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
  if (!remainingBody.includes('## Summary')) {
    const featureDesc = opts.featureDesc?.trim() || 'rehabilitated PR';
    let floorBlock =
      `## Summary\n\n${featureDesc}\n\n` +
      '_Rehabilitated from a reused needs-remediation halt PR; halt history is preserved in the PR comments._';
    const testEvidenceLine = opts.testEvidenceLine?.trim();
    if (testEvidenceLine) {
      floorBlock += `\n\n## Test evidence\n\n- [x] ${testEvidenceLine}`;
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
