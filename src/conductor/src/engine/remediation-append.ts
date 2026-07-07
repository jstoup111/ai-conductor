// remediation-append.ts — remediation tasks ARE plan tasks (ADR H3/H9, plan
// Tasks 19–20).
//
// /remediate's blocking gaps used to reach build only as a prompt hint; under
// the engine-owned task-status contract they must instead EXTEND THE PLAN with
// deterministic, parseable task ids so the ordinary seed → trailer-commit →
// derive cycle evidences them like any other task. This module is the pure
// append/upsert half: text in, text out. The caller (conductor's remediation
// kickback path) re-reads and re-writes the plan file and then re-seeds.
//
// Id scheme: `rem-<gateSource>-<gapTaskId>`, all segments sanitized to the H9
// grammar (`[A-Za-z0-9._-]+`). The gate-source segment keeps identical raw ids
// from different gates distinct (`rem-prd-audit-10-1` vs `rem-test-10-1`), and
// the `rem-` prefix guarantees the id is never purely numeric — so
// `expandTaskIds`'s numeric range expansion (`10-1`) can never mangle it.
//
// Upsert semantics (H9):
//   - id not in the plan            → append a new task block;
//   - id present, SAME title        → idempotent no-op (the id is returned,
//                                     nothing is re-appended — one task per
//                                     logical gap no matter how many rounds);
//   - id present, DIFFERENT title   → the existing block (which may already be
//                                     completed and evidenced) is NEVER
//                                     mutated; the new content gets an ordinal
//                                     suffix (`…-2`, `…-3`, …) instead.

import type { RemediationGap } from './artifacts.js';

/** H9 id grammar — must stay in lockstep with autoheal.ts TASK_ID_PATTERN. */
const ID_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

export interface AppendRemediationResult {
  /** The plan text with any new task blocks appended (input text untouched otherwise). */
  planText: string;
  /** One resolved plan-task id per input gap task (existing or newly appended). */
  ids: string[];
}

/** Sanitize a raw segment into the H9 grammar; empty result is a caller error. */
function sanitizeSegment(raw: string, what: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleaned === '' || !ID_SEGMENT_RE.test(cleaned)) {
    throw new Error(
      `remediation-append: ${what} ${JSON.stringify(raw)} does not reduce to a non-empty ` +
        'deterministic id under the H9 grammar [A-Za-z0-9._-]+ — a remediation task must ' +
        'never be written unaddressable.',
    );
  }
  return cleaned;
}

/** Parse existing `### Task <id>: <title>` headers into an id → title map. */
function existingTaskTitles(planText: string): Map<string, string> {
  const map = new Map<string, string>();
  const headerRe = /^#{1,6}\s+Task\s+([A-Za-z0-9._-]+)\s*:\s*(.*)$/;
  for (const line of planText.split('\n')) {
    const m = line.match(headerRe);
    if (m) map.set(m[1], m[2].trim());
  }
  return map;
}

/** Render one appended plan task block. Format parses via parsePlanTaskPaths. */
function renderTaskBlock(id: string, title: string, gateSource: string, rationale: string): string {
  return [
    `### Task ${id}: ${title}`,
    `**Gate:** ${gateSource}`,
    `**Rationale:** ${rationale}`,
    '',
  ].join('\n');
}

/**
 * Append remediation gap tasks to the plan text with deterministic H9 ids.
 * Pure: never touches disk. Throws on an empty/unsanitizable gap-task id or
 * gate source (an unaddressable task must never be written). See the module
 * header for the id scheme and upsert semantics.
 */
export function appendRemediationTasks(
  planText: string,
  gaps: RemediationGap[],
  gateSource: string,
): AppendRemediationResult {
  const source = sanitizeSegment(gateSource, 'gate source');
  const existing = existingTaskTitles(planText);

  const ids: string[] = [];
  const blocks: string[] = [];

  for (const gap of gaps) {
    // A gap without concrete tasks still yields one addressable plan task
    // derived from the gap itself.
    const gapTasks = gap.tasks.length > 0 ? gap.tasks : [{ id: gap.id, title: gap.rationale }];

    for (const t of gapTasks) {
      const base = sanitizeSegment(t.id !== '' ? t.id : gap.id, 'gap task id');
      const canonical = `rem-${source}-${base}`;
      const title = t.title.trim() !== '' ? t.title.trim() : gap.rationale.trim();

      const existingTitle = existing.get(canonical);
      if (existingTitle !== undefined && existingTitle === title) {
        // Idempotent re-round: exactly one task per logical gap.
        ids.push(canonical);
        continue;
      }

      let id = canonical;
      if (existingTitle !== undefined) {
        // Content drift on an existing (possibly completed + evidenced) row:
        // never mutate it — bump to the next free ordinal instead.
        let ordinal = 2;
        while (existing.has(`${canonical}-${ordinal}`)) {
          const bumpedTitle = existing.get(`${canonical}-${ordinal}`);
          if (bumpedTitle === title) break; // same drifted content already appended
          ordinal += 1;
        }
        id = `${canonical}-${ordinal}`;
        if (existing.get(id) === title) {
          ids.push(id);
          continue;
        }
      }

      blocks.push(renderTaskBlock(id, title, source, gap.rationale));
      existing.set(id, title);
      ids.push(id);
    }
  }

  if (blocks.length === 0) {
    return { planText, ids };
  }

  const separator = planText.endsWith('\n') ? '\n' : '\n\n';
  return { planText: planText + separator + blocks.join('\n'), ids };
}
