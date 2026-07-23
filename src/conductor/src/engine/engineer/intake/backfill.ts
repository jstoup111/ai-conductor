/**
 * backfill.ts: one-shot, non-interactive sweep that stamps `size:`/
 * `priority:` labels onto issues missing them (Story 3, FR-3;
 * #695 intake-only-enforcement).
 *
 * Seam contract (test/acceptance/intake-backfill-sweep.test.ts):
 *   backfillIntakeLabels(issues, deps) where issues are
 *   `{ ref: 'owner/repo#N', body, labels }` and deps is `{ gh, cwd }`.
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

import { parsePriorityLabels, parseSizeLabel } from '../../backlog-priority.js';
import { ensureLabel, restAddLabelArgs, type GhRunner } from '../../pr-labels.js';
import { parseSourceRef } from '../issue-ref.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type SizeValue = 'S' | 'M' | 'L';
export type PriorityValue = 'critical' | 'high' | 'medium' | 'low';

export const DEFAULT_SIZE: SizeValue = 'M';
export const DEFAULT_PRIORITY: PriorityValue = 'medium';

/** Label color applied when `label create` must auto-create a missing label. */
const LABEL_COLOR = 'ededed';

export interface BacklogIssue {
  /** `owner/repo#N` ref. */
  ref: string;
  body: string;
  labels: string[];
}

export interface IntakeBackfillDeps {
  gh: GhRunner;
  /** Working directory for gh calls; defaults to '.'. */
  cwd?: string;
  log?: (msg: string) => void;
}

export interface AppliedLabel {
  label: string;
  source: 'inferred' | 'default';
}

/** One issue's outcome in the sweep report. */
export interface BackfillOutcome {
  ref: string;
  applied: AppliedLabel[];
}

export interface BackfillFailure {
  ref: string;
  error: string;
}

export interface BackfillReport {
  /** Issues that got at least one label applied this run. */
  labelled: BackfillOutcome[];
  /** Issues that already had both labels — no gh calls made. */
  skipped: string[];
  /** Issues whose label-apply failed; the sweep continued past them. */
  failed: BackfillFailure[];
  /** Always false — this sweep never HALTs. */
  halted: boolean;
  /** Always false — this sweep never prompts for confirmation. */
  confirmationRequested: boolean;
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

// ── Sweep ─────────────────────────────────────────────────────────────────────

/**
 * Run the one-shot backfill sweep over an in-memory list of issues. Never
 * throws — per-issue failures are isolated (see BackfillFailure) and a
 * malformed ref is treated as a per-issue failure too, never a HALT.
 */
export async function backfillIntakeLabels(
  issues: BacklogIssue[],
  deps: IntakeBackfillDeps,
): Promise<BackfillReport> {
  const { gh } = deps;
  const cwd = deps.cwd ?? '.';
  const log = deps.log ?? (() => {});

  const report: BackfillReport = {
    labelled: [],
    skipped: [],
    failed: [],
    halted: false,
    confirmationRequested: false,
  };

  for (const issue of issues) {
    const existingSize = parseSizeLabel(issue.labels ?? []);
    const existingPriority = parsePriorityLabels(issue.labels ?? []);

    if (existingSize && existingPriority) {
      // Already complete — idempotent skip, no gh calls.
      report.skipped.push(issue.ref);
      continue;
    }

    const parsedRef = parseSourceRef(issue.ref);
    if (!parsedRef) {
      log(`intake-backfill: issue ${issue.ref} failed — unparseable ref`);
      report.failed.push({ ref: issue.ref, error: `unparseable ref: ${issue.ref}` });
      continue;
    }
    const { repo, number } = parsedRef;

    try {
      const applied: AppliedLabel[] = [];

      if (!existingSize) {
        const inferredSize = inferSizeFromBody(issue.body);
        const size = inferredSize ?? DEFAULT_SIZE;
        const source: 'inferred' | 'default' = inferredSize ? 'inferred' : 'default';
        const labelName = `size: ${size}`;
        await ensureLabel(gh, cwd, labelName, LABEL_COLOR, log);
        await gh(restAddLabelArgs(repo, number, labelName), { cwd });
        applied.push({ label: labelName, source });
      }

      if (!existingPriority) {
        const inferredPriority = inferPriorityFromBody(issue.body);
        const priority = inferredPriority ?? DEFAULT_PRIORITY;
        const source: 'inferred' | 'default' = inferredPriority ? 'inferred' : 'default';
        const labelName = `priority: ${priority}`;
        await ensureLabel(gh, cwd, labelName, LABEL_COLOR, log);
        await gh(restAddLabelArgs(repo, number, labelName), { cwd });
        applied.push({ label: labelName, source });
      }

      report.labelled.push({ ref: issue.ref, applied });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`intake-backfill: issue ${issue.ref} failed — ${message}`);
      report.failed.push({ ref: issue.ref, error: message });
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
    lines.push(`  ${report.skipped.join(', ')}`);
  }
  lines.push(`labelled: ${report.labelled.length}`);
  for (const o of report.labelled) {
    const desc = o.applied.map((a) => `${a.label} [${a.source}]`).join(', ');
    lines.push(`  ${o.ref} — ${desc}`);
  }
  lines.push(`failed: ${report.failed.length}`);
  for (const f of report.failed) {
    lines.push(`  ${f.ref} — ${f.error}`);
  }
  return lines.join('\n');
}
