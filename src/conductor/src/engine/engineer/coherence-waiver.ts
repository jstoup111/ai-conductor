// Coherence waiver parser/evaluator (Task 13).
//
// Mirrors the release gate's proven waiver idiom
// (src/engine/self-host/release-gate.ts: parseWaiver/findWaiverInDiff) per
// adr-2026-07-22-coherence-waiver-and-duplicate-claim: parse-don't-validate,
// fresh-in-diff freshness, and partial-coverage-still-blocks. The one
// structural difference from the release gate is that the release gate's
// vocabulary (CANONICAL_BREAKING_SURFACES) is a fixed module constant, while
// a coherence waiver's vocabulary is the validator's own gap-id set for THIS
// change set (dynamic, passed in by the caller) — so a waiver can only ever
// cite a gap id that the validator actually reported, never an invented one.
//
// This module is inert until wired into land-spec.ts.

import { join } from 'node:path';
import type { CoherenceGap } from './coherence-validator.js';

const COHERENCE_WAIVER_DIR = '.docs/coherence-waivers/';

export interface CoherenceWaiverChangedFile {
  /** git name-status code: A / M / D / R<score> / C<score>. */
  status: string;
  /** Destination path (the new path for a rename/copy, else the only path). */
  path: string;
}

export interface ParsedCoherenceWaiver {
  /** The gap ids this waiver covers, in Waives:-list order. */
  gapIds: string[];
  rationale: string;
}

const WAIVES_LINE_RE = /^Waives:\s*(.*)$/m;
const RATIONALE_RE = /^Rationale:\s*([\s\S]*)$/m;

/**
 * Parse a coherence waiver's `Waives: <gap ids>` / `Rationale: <prose>`
 * shape. Parse, don't validate: a missing `Waives:` line, an empty
 * gap-id list, an empty rationale, or a gap id outside `knownGapIds` (the
 * validator's own reported gap-id set for this change set) is malformed —
 * no catch-all, never silently accepted.
 */
export function parseCoherenceWaiver(
  text: string,
  knownGapIds: Iterable<string>,
): ParsedCoherenceWaiver | null {
  const waivesMatch = text.match(WAIVES_LINE_RE);
  if (!waivesMatch) return null;
  const rationaleMatch = text.match(RATIONALE_RE);
  const rationale = rationaleMatch ? rationaleMatch[1].trim() : '';
  if (!rationale) return null;
  const gapIds = waivesMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (gapIds.length === 0) return null;
  const known = new Set(knownGapIds);
  if (!gapIds.every((id) => known.has(id))) return null;
  return { gapIds, rationale };
}

/**
 * Find a coherence waiver file freshly added/modified in this change set
 * (fresh-in-diff): a waiver landed by a prior spec, even if still present on
 * disk, never satisfies a later one.
 */
function findCoherenceWaiverInDiff(
  changed: CoherenceWaiverChangedFile[],
): CoherenceWaiverChangedFile | null {
  return (
    changed.find(
      (f) =>
        f.path.startsWith(COHERENCE_WAIVER_DIR) &&
        f.path.endsWith('.md') &&
        (f.status.startsWith('A') || f.status.startsWith('M')),
    ) ?? null
  );
}

export type CoherenceWaiverVerdict =
  | { ok: true }
  | { ok: false; reason: string; unwaived: CoherenceGap[] };

/**
 * Evaluate whether a fresh, well-formed, fully-covering coherence waiver
 * clears every gap in `gaps`. Partial coverage still blocks, naming the
 * unwaived remainder (FR-8) — never a silent partial pass. Trivially passes
 * when there are no gaps to waive, regardless of waiver presence.
 */
export async function evaluateCoherenceWaiver(input: {
  gaps: CoherenceGap[];
  changedFiles: CoherenceWaiverChangedFile[];
  readText: (path: string) => Promise<string | null>;
  /** Optional root to join waiver paths against (defaults to cwd-relative). */
  root?: string;
}): Promise<CoherenceWaiverVerdict> {
  const { gaps, changedFiles, readText, root } = input;
  if (gaps.length === 0) return { ok: true };

  const knownGapIds = gaps.map((g) => g.gapId);

  const diffEntry = findCoherenceWaiverInDiff(changedFiles);
  if (!diffEntry) {
    return {
      ok: false,
      reason:
        `No coherence waiver found: a waiver is not committed with this change set — a waiver ` +
        `landed by a prior spec is never applied (fresh-in-diff). Commit a waiver at ` +
        `\`${COHERENCE_WAIVER_DIR}<plan-stem>.md\` with a \`Waives:\` list of the exact gap ` +
        `id(s) and a non-empty \`Rationale:\` to cover: ${knownGapIds.join(', ')}.`,
      unwaived: gaps,
    };
  }

  const path = root ? join(root, diffEntry.path) : diffEntry.path;
  const text = await readText(path);
  if (text == null) {
    return {
      ok: false,
      reason: `Waiver at \`${diffEntry.path}\` is listed as changed but could not be read.`,
      unwaived: gaps,
    };
  }

  const parsed = parseCoherenceWaiver(text, knownGapIds);
  if (!parsed) {
    return {
      ok: false,
      reason:
        `Waiver at \`${diffEntry.path}\` is malformed — expected a \`Waives:\` line listing ` +
        `only gap ids reported by this run (${knownGapIds.join(', ')}) and a non-empty ` +
        `\`Rationale:\`.`,
      unwaived: gaps,
    };
  }

  const waivedSet = new Set(parsed.gapIds);
  const unwaived = gaps.filter((g) => !waivedSet.has(g.gapId));
  if (unwaived.length > 0) {
    return {
      ok: false,
      reason:
        `Waiver at \`${diffEntry.path}\` does not cover: ` +
        `${unwaived.map((g) => g.gapId).join(', ')} — the waiver must list every reported gap id.`,
      unwaived,
    };
  }

  return { ok: true };
}
