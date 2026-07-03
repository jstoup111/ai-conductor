// ─────────────────────────────────────────────────────────────────────────────
// Generated HARNESS.md model-selection table — splicer + (future) renderer/CLI.
// See .docs/decisions/adr-2026-07-03-generated-model-table-single-source.md
// and .docs/plans/generated-model-table.md (Task 6: pure splicer).
// ─────────────────────────────────────────────────────────────────────────────

import type { StepName } from '../types/steps.js';

export const BEGIN_MARKER = '<!-- BEGIN GENERATED: model-selection-table -->';
export const END_MARKER = '<!-- END GENERATED: model-selection-table -->';

/**
 * Thrown when a document does not contain a well-formed BEGIN/END marker
 * pair. Callers must treat this as a hard error before any write (ADR C2):
 * never silently append or regenerate the whole file.
 */
export class MarkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MarkerError';
  }
}

/**
 * Splices `table` into the region between the BEGIN/END generated-table
 * markers in `doc`, replacing everything from the BEGIN marker line through
 * the END marker line (inclusive). Every byte outside that region — prose,
 * the markers' surrounding newlines, the interim-fallback blockquote, etc. —
 * is preserved byte-for-byte.
 *
 * Pure function: no I/O, no side effects, deterministic for a given
 * (doc, table) pair.
 *
 * Markers must each appear on their own line, and BEGIN must precede END.
 * Malformed marker arrangements (missing BEGIN, missing END, END before
 * BEGIN, duplicate BEGIN) throw a MarkerError and leave `doc` untouched
 * (strings are immutable, so this is automatic — callers must not have
 * already written anything before calling this function).
 */
export function spliceGeneratedRegion(doc: string, table: string): string {
  const beginIndex = doc.indexOf(BEGIN_MARKER);
  const endIndex = doc.indexOf(END_MARKER);

  if (beginIndex === -1) {
    throw new MarkerError(
      `missing "${BEGIN_MARKER}" marker — refusing to write (markers must be present before regeneration)`,
    );
  }
  if (endIndex === -1) {
    throw new MarkerError(
      `missing "${END_MARKER}" marker — refusing to write (markers must be present before regeneration)`,
    );
  }

  const secondBeginIndex = doc.indexOf(BEGIN_MARKER, beginIndex + BEGIN_MARKER.length);
  if (secondBeginIndex !== -1) {
    throw new MarkerError(
      `duplicate "${BEGIN_MARKER}" marker found — expected exactly one BEGIN marker`,
    );
  }
  const secondEndIndex = doc.indexOf(END_MARKER, endIndex + END_MARKER.length);
  if (secondEndIndex !== -1) {
    throw new MarkerError(
      `duplicate "${END_MARKER}" marker found — expected exactly one END marker`,
    );
  }

  if (endIndex < beginIndex) {
    throw new MarkerError(
      `"${END_MARKER}" appears before "${BEGIN_MARKER}" — markers are out of order`,
    );
  }

  // Markers must be on their own line: validate that only whitespace
  // precedes each marker on its line, and only whitespace/newline follows.
  const beginLineStart = doc.lastIndexOf('\n', beginIndex - 1) + 1;
  const beforeBeginOnLine = doc.slice(beginLineStart, beginIndex);
  if (beforeBeginOnLine.trim().length > 0) {
    throw new MarkerError(`"${BEGIN_MARKER}" must be on its own line`);
  }

  const endLineEndSearch = doc.indexOf('\n', endIndex);
  const endLineEnd = endLineEndSearch === -1 ? doc.length : endLineEndSearch;
  const afterEndOnLine = doc.slice(endIndex + END_MARKER.length, endLineEnd);
  if (afterEndOnLine.trim().length > 0) {
    throw new MarkerError(`"${END_MARKER}" must be on its own line`);
  }

  // Region to replace runs from the start of the BEGIN marker's line through
  // the end of the END marker's line (inclusive of both markers).
  const regionStart = beginLineStart;
  const regionEnd = endLineEndSearch === -1 ? doc.length : endLineEndSearch;

  const before = doc.slice(0, regionStart);
  const after = doc.slice(regionEnd);

  return `${before}${BEGIN_MARKER}\n${table}\n${END_MARKER}${after}`;
}

// ────────────────────────────────────────────────────────────────────────────
// classifyPinnedSkill
//
// Validates a single skill's `model:` pin (if any) against SKILL_STEP_MAP /
// PIN_EXEMPT_SKILLS from src/engine/model-table-metadata.ts. Pure function —
// no filesystem access — so it can be unit-tested with fixture inputs
// (.docs/stories/generated-model-table.md TS-1 negative path 2, TS-4).
// ────────────────────────────────────────────────────────────────────────────

export type PinClassification =
  | { status: 'no-pin'; skill: string }
  | { status: 'mapped'; skill: string; step: StepName }
  | { status: 'exempt'; skill: string }
  | { status: 'unmapped'; skill: string };

/**
 * Classify a skill's `model:` pin.
 *
 * - `hasPin` false               -> 'no-pin' (absence of a pin is never an
 *                                    error; the skill legally inherits from
 *                                    session/engine defaults).
 * - skill present in stepMap     -> 'mapped' (pin can be checked against the
 *                                    engine default for that step).
 * - skill present in exemptions  -> 'exempt' (no engine step to compare
 *                                    against).
 * - otherwise                    -> 'unmapped' (hard failure — an unmapped
 *                                    pinned skill must never be silently
 *                                    passed).
 */
export function classifyPinnedSkill(
  skillName: string,
  hasPin: boolean,
  stepMap: Readonly<Record<string, StepName>>,
  exemptions: Readonly<Record<string, string>> | readonly string[],
): PinClassification {
  if (!hasPin) {
    return { status: 'no-pin', skill: skillName };
  }

  if (Object.prototype.hasOwnProperty.call(stepMap, skillName)) {
    return { status: 'mapped', skill: skillName, step: stepMap[skillName] as StepName };
  }

  const exemptSet = Array.isArray(exemptions)
    ? new Set<string>(exemptions)
    : new Set<string>(Object.keys(exemptions));

  if (exemptSet.has(skillName)) {
    return { status: 'exempt', skill: skillName };
  }

  return { status: 'unmapped', skill: skillName };
}

// ────────────────────────────────────────────────────────────────────────────
// assertNoDuplicateRowNames
//
// Guards the (future) renderer against two rows landing on the same
// "Skill/Agent" name — whether the collision is between two extra rows or
// between an extra row and an engine-derived row (e.g. an EXTRA_MODEL_TABLE_ROWS
// entry accidentally reusing an engine step's display name like "plan").
// A silent collision would drop one row from the rendered table, so this is
// a hard error, not a dedupe-and-continue.
//
// Story TS-1 negative path 3.
// ────────────────────────────────────────────────────────────────────────────

/** Minimal shape the duplicate-name guard needs from a rendered/candidate row. */
export interface NamedRow {
  name: string;
}

export function assertNoDuplicateRowNames(
  engineRows: readonly NamedRow[],
  extraRows: readonly NamedRow[],
): void {
  const seen = new Map<string, number>();

  for (const row of [...engineRows, ...extraRows]) {
    seen.set(row.name, (seen.get(row.name) ?? 0) + 1);
  }

  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);

  if (duplicates.length > 0) {
    throw new Error(`Duplicate model-table row name(s): ${duplicates.join(', ')}`);
  }
}
