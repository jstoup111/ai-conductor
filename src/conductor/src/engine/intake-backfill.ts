/**
 * intake-backfill: one-shot, non-interactive sweep that stamps `size:`/
 * `priority:` labels onto open, assigned issues that are missing them.
 *
 * Reuses `parseSizeLabel`/`parsePriorityLabels` (backlog-priority.ts) to
 * detect which issues are incomplete, infers a value from the issue body
 * when possible, and otherwise defaults to `size: M` / `priority: medium`
 * (mirroring intake-label-sync.ts's documented defaults).
 *
 * Design constraints (Task 6, FR-3):
 *   - Never HALTs, never prompts — this is a one-shot, non-interactive sweep.
 *   - Isolates single-issue failures: one issue's label-apply failure is
 *     logged and swallowed, never aborts the sweep (C3-style best-effort).
 *   - Idempotent: an issue already carrying both a size and a priority
 *     label is skipped entirely (no gh calls, not counted in the report).
 */

import { parsePriorityLabels, parseSizeLabel } from './backlog-priority.js';
import { ensureLabel, restAddLabelArgs, type GhRunner } from './pr-labels.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type SizeValue = 'S' | 'M' | 'L';
export type PriorityValue = 'critical' | 'high' | 'medium' | 'low';

export const DEFAULT_SIZE: SizeValue = 'M';
export const DEFAULT_PRIORITY: PriorityValue = 'medium';

/** Label color applied when `label create` must auto-create a missing label. */
const LABEL_COLOR = 'ededed';

interface RawIssue {
  number: number;
  title?: string;
  body?: string;
  labels?: Array<{ name: string } | string>;
}

export interface IntakeBackfillDeps {
  gh: GhRunner;
  /** `owner/repo` slug passed to `gh issue list -R` / `gh api`. */
  repo: string;
  /** Working directory for gh calls; defaults to '.'. */
  cwd?: string;
  log?: (msg: string) => void;
}

/** One issue's outcome in the sweep report. */
export interface BackfillOutcome {
  number: number;
  /** Which labels were applied this run ('size', 'priority', or both). */
  applied: Array<'size' | 'priority'>;
  size?: SizeValue;
  priority?: PriorityValue;
  /** How each applied value was determined. */
  sizeSource?: 'inferred' | 'defaulted';
  prioritySource?: 'inferred' | 'defaulted';
}

export interface BackfillFailure {
  number: number;
  error: string;
}

export interface BackfillReport {
  /** Issues that already had both labels — no gh calls made. */
  skipped: number[];
  /** Issues that got at least one label sourced from body-text inference. */
  inferred: BackfillOutcome[];
  /** Issues that got at least one label from the hardcoded default. */
  defaulted: BackfillOutcome[];
  /** Issues whose label-apply failed; the sweep continued past them. */
  failed: BackfillFailure[];
}

// ── Label normalisation ─────────────────────────────────────────────────────

function labelNames(issue: RawIssue): string[] {
  return (issue.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name));
}

// ── Body-text inference ─────────────────────────────────────────────────────

/**
 * Infer a size value from free-form issue body text via a permissive
 * `size: <S|M|L>`-shaped match (case-insensitive, tolerant of surrounding
 * markdown). Returns undefined when no match is found — the caller then
 * falls back to DEFAULT_SIZE.
 */
export function inferSizeFromBody(body: string | undefined): SizeValue | undefined {
  if (!body) return undefined;
  const match = body.match(/size:\s*(S|M|L)\b/i);
  if (!match) return undefined;
  return match[1].toUpperCase() as SizeValue;
}

/**
 * Infer a priority value from free-form issue body text via a permissive
 * `priority: <critical|high|medium|low>`-shaped match (case-insensitive).
 * Returns undefined when no match is found — the caller then falls back to
 * DEFAULT_PRIORITY.
 */
export function inferPriorityFromBody(body: string | undefined): PriorityValue | undefined {
  if (!body) return undefined;
  const match = body.match(/priority:\s*(critical|high|medium|low)\b/i);
  if (!match) return undefined;
  return match[1].toLowerCase() as PriorityValue;
}

// ── Issue listing ────────────────────────────────────────────────────────────

/**
 * List open issues assigned to the authenticated user, matching the idiom
 * established by github-issues.ts's poll() (`gh issue list --assignee @me
 * --state open --json ... -R <repo>`).
 */
async function listAssignedOpenIssues(gh: GhRunner, repo: string, cwd: string): Promise<RawIssue[]> {
  const { stdout } = await gh(
    ['issue', 'list', '--assignee', '@me', '--state', 'open', '--json', 'number,title,body,labels', '-R', repo],
    { cwd },
  );
  const parsed: unknown = JSON.parse(stdout || '[]');
  return Array.isArray(parsed) ? (parsed as RawIssue[]) : [];
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Run the one-shot backfill sweep. Never throws for per-issue failures
 * (isolated via try/catch — see BackfillFailure); a transport-level failure
 * while LISTING issues does propagate, since there is nothing to sweep.
 */
export async function runIntakeBackfill(deps: IntakeBackfillDeps): Promise<BackfillReport> {
  const { gh, repo } = deps;
  const cwd = deps.cwd ?? '.';
  const log = deps.log ?? (() => {});

  const issues = await listAssignedOpenIssues(gh, repo, cwd);

  const report: BackfillReport = { skipped: [], inferred: [], defaulted: [], failed: [] };

  for (const issue of issues) {
    const labels = labelNames(issue);
    const existingSize = parseSizeLabel(labels);
    const existingPriority = parsePriorityLabels(labels);

    if (existingSize && existingPriority) {
      // Already complete — idempotent skip, no gh calls.
      report.skipped.push(issue.number);
      continue;
    }

    try {
      const outcome: BackfillOutcome = { number: issue.number, applied: [] };

      if (!existingSize) {
        const inferredSize = inferSizeFromBody(issue.body);
        const size = inferredSize ?? DEFAULT_SIZE;
        const sizeSource = inferredSize ? 'inferred' : 'defaulted';
        const labelName = `size: ${size}`;
        await ensureLabel(gh, cwd, labelName, LABEL_COLOR, log);
        await gh(restAddLabelArgs(repo, String(issue.number), labelName), { cwd });
        outcome.size = size;
        outcome.sizeSource = sizeSource;
        outcome.applied.push('size');
      }

      if (!existingPriority) {
        const inferredPriority = inferPriorityFromBody(issue.body);
        const priority = inferredPriority ?? DEFAULT_PRIORITY;
        const prioritySource = inferredPriority ? 'inferred' : 'defaulted';
        const labelName = `priority: ${priority}`;
        await ensureLabel(gh, cwd, labelName, LABEL_COLOR, log);
        await gh(restAddLabelArgs(repo, String(issue.number), labelName), { cwd });
        outcome.priority = priority;
        outcome.prioritySource = prioritySource;
        outcome.applied.push('priority');
      }

      // An issue counts as "inferred" if ANY applied label was inferred;
      // otherwise (all applied labels defaulted) it counts as "defaulted".
      const anyInferred = outcome.sizeSource === 'inferred' || outcome.prioritySource === 'inferred';
      if (anyInferred) {
        report.inferred.push(outcome);
      } else {
        report.defaulted.push(outcome);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`intake-backfill: issue #${issue.number} failed — ${message}`);
      report.failed.push({ number: issue.number, error: message });
      // Isolated: continue the sweep past this issue.
    }
  }

  return report;
}

// ── Operator report rendering ───────────────────────────────────────────────

/**
 * Render the BackfillReport as a human-readable operator summary. Used by
 * the bin/intake-backfill CLI entry point; kept pure/testable here.
 */
export function renderBackfillReport(report: BackfillReport): string {
  const lines: string[] = [];
  lines.push('intake-backfill report');
  lines.push('=======================');
  lines.push(`skipped (already complete): ${report.skipped.length}`);
  if (report.skipped.length > 0) {
    lines.push(`  #${report.skipped.join(', #')}`);
  }
  lines.push(`inferred: ${report.inferred.length}`);
  for (const o of report.inferred) {
    lines.push(`  #${o.number} — ${o.applied.join('+')} (${describeOutcome(o)})`);
  }
  lines.push(`defaulted: ${report.defaulted.length}`);
  for (const o of report.defaulted) {
    lines.push(`  #${o.number} — ${o.applied.join('+')} (${describeOutcome(o)})`);
  }
  lines.push(`failed: ${report.failed.length}`);
  for (const f of report.failed) {
    lines.push(`  #${f.number} — ${f.error}`);
  }
  return lines.join('\n');
}

function describeOutcome(o: BackfillOutcome): string {
  const parts: string[] = [];
  if (o.size) parts.push(`size: ${o.size} [${o.sizeSource}]`);
  if (o.priority) parts.push(`priority: ${o.priority} [${o.prioritySource}]`);
  return parts.join(', ');
}
