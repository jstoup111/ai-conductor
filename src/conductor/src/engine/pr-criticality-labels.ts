/**
 * Mirror an originating issue's criticality labels onto the PR that delivers it.
 *
 * The daemon dispatches by criticality (`priority: <band>`, see
 * `backlog-priority.ts`), but that signal died at the issue: neither the SPEC PR
 * (`openSpecPr`) nor the implementation PR (`openShipDraftPr`) carried it, so a
 * reviewer scanning the PR list could not tell a `priority: critical` fix from a
 * `priority: low` cleanup without opening the linked issue.
 *
 * This module copies the criticality labels — and only those — from the linked
 * issue onto the PR.
 *
 * **Fail-open by construction.** Every failure path (no source ref, unparseable
 * ref, gh unavailable, label read failure, per-label write failure) logs one
 * line and returns an outcome. Nothing here ever throws into a caller: a
 * cosmetic label must never cost a delivered spec or a running build.
 */

import {
  makeProductionGh,
  parseIssueRef,
  restAddLabelArgs,
  type GhRunner,
} from './pr-labels.js';
import { parseSourceRef } from './engineer/issue-ref.js';

/**
 * The criticality label family. Matches `backlog-priority.ts`'s parser exactly
 * — same bands, same single space after the colon, same case sensitivity — so
 * the labels mirrored onto a PR are precisely the ones the daemon dispatches
 * on. `size:` labels are deliberately NOT mirrored: they describe the issue's
 * estimated effort, not the delivered change's criticality.
 */
const CRITICALITY_LABEL = /^priority: (critical|high|medium|low)$/;

/** True when `name` is a criticality label. */
export function isCriticalityLabel(name: string): boolean {
  return CRITICALITY_LABEL.test(name);
}

/** Keep only the criticality labels from an arbitrary label list. */
export function selectCriticalityLabels(names: readonly string[]): string[] {
  return names.filter(isCriticalityLabel);
}

export interface MirrorCriticalityLabelsDeps {
  /** Injected gh runner; defaults to the production factory. */
  gh?: GhRunner;
  /** Working directory for every gh invocation. */
  cwd: string;
  /** The PR to label (full github.com URL). */
  prUrl: string;
  /** Originating intake reference (`owner/repo#N`). Absent → no-op. */
  sourceRef: string | undefined;
  log?: (msg: string) => void;
}

export type MirrorCriticalityLabelsResult =
  /** No usable linkage (no source ref, unparseable ref, unparseable PR URL). */
  | { outcome: 'skipped'; reason: string }
  /** The issue carries no criticality label — nothing to mirror. */
  | { outcome: 'none-on-issue' }
  /** At least one label was applied (or was already present). */
  | { outcome: 'mirrored'; labels: string[]; failed: string[] }
  /** The issue's labels could not be read — advisory, caller continues. */
  | { outcome: 'failed'; reason: string };

/**
 * Read the label names on an issue via the REST labels endpoint.
 *
 * `gh api repos/{owner}/{repo}/issues/{n}/labels` is used rather than
 * `gh issue view --json labels` for the same reason `pr-labels.ts` avoids
 * `gh pr edit`: the higher-level commands run a GraphQL query that pulls
 * sunset Projects (classic) metadata and error out before returning.
 */
async function readIssueLabels(
  gh: GhRunner,
  cwd: string,
  repo: string,
  number: string,
): Promise<string[]> {
  const { stdout } = await gh(['api', `repos/${repo}/issues/${number}/labels`], { cwd });
  const parsed: unknown = JSON.parse(stdout);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((entry) =>
      typeof entry === 'object' && entry !== null && typeof (entry as { name?: unknown }).name === 'string'
        ? (entry as { name: string }).name
        : undefined,
    )
    .filter((name): name is string => name !== undefined);
}

/**
 * Copy the linked issue's criticality labels onto `prUrl`.
 *
 * Idempotent: the REST add-labels endpoint is additive and a label already on
 * the PR is accepted unchanged, so re-entering SHIP (resume, kickback, rework)
 * never duplicates or churns labels.
 */
export async function mirrorIssueCriticalityLabels(
  deps: MirrorCriticalityLabelsDeps,
): Promise<MirrorCriticalityLabelsResult> {
  const log = deps.log ?? (() => {});
  const { cwd, prUrl } = deps;

  const issue = parseSourceRef(deps.sourceRef);
  if (!issue) {
    return {
      outcome: 'skipped',
      reason: deps.sourceRef
        ? `unparseable source ref "${deps.sourceRef}"`
        : 'no linked issue',
    };
  }
  const pr = parseIssueRef(prUrl);
  if (!pr) {
    log(`[pr-criticality] unparseable PR URL "${prUrl}" — no labels mirrored`);
    return { outcome: 'skipped', reason: `unparseable PR URL "${prUrl}"` };
  }

  const gh = deps.gh ?? makeProductionGh();

  let labels: string[];
  try {
    labels = selectCriticalityLabels(
      await readIssueLabels(gh, cwd, issue.repo, issue.number),
    );
  } catch (err) {
    const reason = String(err);
    log(
      `[pr-criticality] could not read labels on ${issue.repo}#${issue.number} ` +
        `(advisory, nothing mirrored): ${reason}`,
    );
    return { outcome: 'failed', reason };
  }

  if (labels.length === 0) return { outcome: 'none-on-issue' };

  const applied: string[] = [];
  const failed: string[] = [];
  for (const name of labels) {
    try {
      await gh(restAddLabelArgs(pr.repo, pr.number, name), { cwd });
      applied.push(name);
    } catch (err) {
      failed.push(name);
      log(`[pr-criticality] could not apply "${name}" to ${prUrl} (advisory): ${err}`);
    }
  }

  if (applied.length > 0) {
    log(
      `[pr-criticality] mirrored ${applied.map((l) => `"${l}"`).join(', ')} ` +
        `from ${issue.repo}#${issue.number} onto ${prUrl}`,
    );
  }
  return { outcome: 'mirrored', labels: applied, failed };
}
