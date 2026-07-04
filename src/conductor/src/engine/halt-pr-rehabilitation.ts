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
 * `needs-remediation:` OR the `needs-remediation` label. Draft status alone is
 * NOT a halt signal — `pr_timing: early-draft` opens legitimate clean-titled
 * draft PRs (#199).
 *
 * All mechanics are warn-only: failures log and never throw (mirrors
 * `conduct shipped-record` degradation); partial failure is representable in
 * the outcome.
 */

import type { GhRunner } from './pr-labels.js';
import { parseIssueRef, restRemoveLabelArgs } from './pr-labels.js';
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
}

function parsePrView(stdout: string): PrViewState {
  let raw: { title?: unknown; isDraft?: unknown; labels?: unknown };
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
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'title,isDraft,labels'], { cwd });
    view = parsePrView(stdout);
  } catch (err) {
    log(`[halt-pr-rehab] gh pr view failed for ${prUrl} — skipping rehabilitation: ${err}`);
    return 'gh-unavailable';
  }

  const hasHaltTitle = view.title.startsWith(NEEDS_REMEDIATION_TITLE_PREFIX);
  const hasHaltLabel = view.labels.includes(NEEDS_REMEDIATION_LABEL);
  if (!hasHaltTitle && !hasHaltLabel) return 'not-halt-pr';

  let anyFailed = false;

  if (view.isDraft) {
    try {
      await gh(['pr', 'ready', prUrl], { cwd });
    } catch (err) {
      anyFailed = true;
      log(`[halt-pr-rehab] ready-flip failed for ${prUrl}: ${err}`);
    }
  }

  if (hasHaltLabel) {
    const ref = parseIssueRef(prUrl);
    if (!ref) {
      anyFailed = true;
      log(`[halt-pr-rehab] unparseable PR URL "${prUrl}" — cannot clear label`);
    } else {
      try {
        await gh(restRemoveLabelArgs(ref.repo, ref.number, NEEDS_REMEDIATION_LABEL), { cwd });
      } catch (err) {
        anyFailed = true;
        log(`[halt-pr-rehab] label clear failed for ${prUrl}: ${err}`);
      }
    }
  }

  // Idempotent Closes injection — injectIssueRef swallows gh failures internally
  // (warn-only) and no-ops when the ref is already present or sourceRef is unusable.
  await injectIssueRef({ gh, prUrl, keyword: 'Closes', sourceRef, cwd, log });

  return anyFailed ? 'partial' : 'rehabilitated';
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
