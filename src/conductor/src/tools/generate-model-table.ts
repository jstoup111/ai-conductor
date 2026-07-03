// ─────────────────────────────────────────────────────────────────────────────
// Generated HARNESS.md model-selection table — splicer + renderer + (future) CLI.
// See .docs/decisions/adr-2026-07-03-generated-model-table-single-source.md
// and .docs/plans/generated-model-table.md (Task 5: pure renderer; Task 6: pure
// splicer).
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile } from 'node:fs/promises';
import type { StepName, ComplexityTier } from '../types/index.js';
import {
  DEFAULT_STEP_MODELS,
  DEFAULT_STEP_EFFORT,
  DEFAULT_STEP_TIER_OVERRIDES,
} from '../engine/resolved-config.js';
import { STEP_RATIONALE, EXTRA_MODEL_TABLE_ROWS } from '../engine/model-table-metadata.js';

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

// ────────────────────────────────────────────────────────────────────────────
// renderModelTable
//
// Pure renderer: builds the full "| Skill/Agent | Model | Effort | Why |"
// markdown table from the engine's typed defaults (DEFAULT_STEP_MODELS /
// DEFAULT_STEP_EFFORT / DEFAULT_STEP_TIER_OVERRIDES, resolved-config.ts) plus
// the STEP_RATIONALE / EXTRA_MODEL_TABLE_ROWS metadata. No filesystem access.
//
// Story TS-2 happy path 2 (.docs/stories/generated-model-table.md):
//   - header row `| Skill/Agent | Model | Effort | Why |`
//   - a step whose model/effort varies by complexity tier renders each
//     distinct value once, suffixed with the tiers that share it, e.g.
//     `sonnet (S/M), fable (L)`; a step whose value is tier-invariant renders
//     plain (no suffix)
//   - engine-derived rows are emitted first (STEP_RATIONALE key order, which
//     covers all 21 StepName values), extra rows (EXTRA_MODEL_TABLE_ROWS)
//     after
// ────────────────────────────────────────────────────────────────────────────

const TIERS: readonly ComplexityTier[] = ['S', 'M', 'L'];

/**
 * Display-name mapping from engine StepName to the table's "Skill/Agent"
 * column text. Default: snake_case -> kebab-case. A handful of steps are
 * dispatched under a different, more recognizable skill/agent name — those
 * are listed explicitly here (ADR's naming mapping).
 */
const DISPLAY_NAME_OVERRIDES: Partial<Record<StepName, string>> = {
  build: 'pipeline',
  worktree: 'worktree-manager',
  acceptance_specs: 'writing-system-tests',
  architecture_review_as_built: 'architecture-review --as-built',
  conflict_check: 'conflict-check',
};

export function stepDisplayName(step: StepName): string {
  return DISPLAY_NAME_OVERRIDES[step] ?? step.replace(/_/g, '-');
}

function tierValue(step: StepName, tier: ComplexityTier, field: 'model' | 'effort'): string {
  const override = DEFAULT_STEP_TIER_OVERRIDES[step]?.[tier]?.[field];
  if (override !== undefined) return override;
  return field === 'model' ? DEFAULT_STEP_MODELS[step] : DEFAULT_STEP_EFFORT[step];
}

/**
 * Render a tier-varying field (model or effort) for a step. Groups the three
 * tiers by identical resolved value, preserving S/M/L order both within a
 * group's tier list and across groups (first tier at which a value appears
 * determines the group's position). A step whose value is identical across
 * all three tiers renders as the bare value with no tier suffix.
 */
export function renderTieredField(step: StepName, field: 'model' | 'effort'): string {
  const groups: { value: string; tiers: ComplexityTier[] }[] = [];

  for (const tier of TIERS) {
    const value = tierValue(step, tier, field);
    const existing = groups.find((g) => g.value === value);
    if (existing) {
      existing.tiers.push(tier);
    } else {
      groups.push({ value, tiers: [tier] });
    }
  }

  if (groups.length === 1) {
    return groups[0]!.value;
  }

  return groups.map((g) => `${g.value} (${g.tiers.join('/')})`).join(', ');
}

export interface ModelTableRow extends NamedRow {
  model: string;
  effort: string;
  why: string;
}

/** All 21 engine-derived rows, in STEP_RATIONALE key order (bootstrap..remediate). */
export function buildEngineRows(): ModelTableRow[] {
  return (Object.keys(STEP_RATIONALE) as StepName[]).map((step) => ({
    name: stepDisplayName(step),
    model: renderTieredField(step, 'model'),
    effort: renderTieredField(step, 'effort'),
    why: STEP_RATIONALE[step],
  }));
}

/** Rows for skills/agents with no corresponding engine step. */
export function buildExtraRows(): ModelTableRow[] {
  return EXTRA_MODEL_TABLE_ROWS.map((row) => ({
    name: row.name,
    model: row.model,
    effort: '',
    why: row.rationale,
  }));
}

const TABLE_HEADER = '| Skill/Agent | Model | Effort | Why |';
const TABLE_SEPARATOR = '|---|---|---|---|';

function renderRow(row: ModelTableRow): string {
  return `| ${row.name} | ${row.model} | ${row.effort} | ${row.why} |`;
}

/**
 * Render the full generated model-selection table as markdown. Pure: reads
 * only the imported typed metadata, no filesystem/network access, no
 * randomness — same output every call.
 */
export function renderModelTable(): string {
  const engineRows = buildEngineRows();
  const extraRows = buildExtraRows();

  assertNoDuplicateRowNames(engineRows, extraRows);

  const lines = [TABLE_HEADER, TABLE_SEPARATOR, ...[...engineRows, ...extraRows].map(renderRow)];
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// CLI — arg parsing + file IO (Task 8: write mode + idempotency)
//
// The CLI is split from its IO via an injectable `CliIO` so tests can run
// in-process against temp-dir fixtures without shelling out to the real
// `bin/generate-model-table` wrapper (that real-binary smoke test is
// Task 11). Exit codes follow the ADR: 0 ok, 1 drift (check mode only),
// 2 environment/marker error.
// ────────────────────────────────────────────────────────────────────────────

export type CliMode = 'write' | 'check' | 'pins';

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_ERROR = 2;

/** Minimal filesystem surface the CLI needs — injectable for tests. */
export interface CliIO {
  readFile: (path: string) => Promise<string>;
  writeFile: (path: string, data: string) => Promise<void>;
}

/** Real filesystem IO, used by the bin/ wrapper entrypoint. */
export const nodeIO: CliIO = {
  readFile: (path: string) => readFile(path, 'utf8'),
  writeFile: (path: string, data: string) => writeFile(path, data, 'utf8'),
};

/**
 * Parse CLI args into a mode. `--check` and `--pins` are mutually exclusive;
 * absence of both flags means "write" (the default, regenerating the file
 * in place).
 */
export function parseCliArgs(argv: readonly string[]): CliMode {
  if (argv.includes('--check')) return 'check';
  if (argv.includes('--pins')) return 'pins';
  return 'write';
}

/**
 * Run the generator against `harnessPath` using the injected `io`.
 *
 * - `write` (default): splices the freshly rendered table into the region
 *   between the markers and writes the result back, iff it differs from the
 *   current contents (idempotent no-op write avoided). Returns EXIT_OK.
 * - `check`: same splice, but never writes; returns EXIT_OK if the result
 *   equals the current contents, EXIT_DRIFT otherwise.
 * - `pins`: JSON pin-agreement emission — full implementation is Task 10;
 *   for now emits an empty object and exits EXIT_OK.
 *
 * On any MarkerError (missing/malformed/duplicate marker) or read failure,
 * the file is never written and the function returns EXIT_ERROR.
 */
export async function runGenerateModelTable(
  argv: readonly string[],
  io: CliIO,
  harnessPath: string,
): Promise<number> {
  const mode = parseCliArgs(argv);

  if (mode === 'pins') {
    process.stdout.write('{}\n');
    return EXIT_OK;
  }

  let doc: string;
  try {
    doc = await io.readFile(harnessPath);
  } catch (err) {
    process.stderr.write(
      `generate-model-table: failed to read ${harnessPath}: ${(err as Error).message}\n`,
    );
    return EXIT_ERROR;
  }

  const table = renderModelTable();

  let spliced: string;
  try {
    spliced = spliceGeneratedRegion(doc, table);
  } catch (err) {
    if (err instanceof MarkerError) {
      process.stderr.write(`generate-model-table: ${err.message}\n`);
      return EXIT_ERROR;
    }
    throw err;
  }

  if (mode === 'check') {
    return spliced === doc ? EXIT_OK : EXIT_DRIFT;
  }

  // write mode
  if (spliced !== doc) {
    await io.writeFile(harnessPath, spliced);
  }
  return EXIT_OK;
}
