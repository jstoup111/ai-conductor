// ─────────────────────────────────────────────────────────────────────────────
// Generated HARNESS.md model-selection table — splicer + renderer + (future) CLI.
// See .docs/decisions/adr-2026-07-03-generated-model-table-single-source.md
// and .docs/plans/generated-model-table.md (Task 5: pure renderer; Task 6: pure
// splicer).
// ─────────────────────────────────────────────────────────────────────────────

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { StepName, ComplexityTier } from '../types/index.js';
import { DEFAULT_STEP_MODELS } from '../engine/resolved-config.js';
import {
  CLAUDE_MODEL_POLICY,
  CODEX_MODEL_POLICY,
  type ProviderModelPolicy,
} from '../engine/provider-model-policy.js';
import {
  STEP_RATIONALE,
  EXTRA_MODEL_TABLE_ROWS,
  SKILL_STEP_MAP,
  PIN_EXEMPT_SKILLS,
} from '../engine/model-table-metadata.js';

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
// Pure renderer: builds the provider-aware seven-column markdown table from
// the engine's typed provider policies plus STEP_RATIONALE /
// EXTRA_MODEL_TABLE_ROWS metadata. No filesystem access.
//
// Story TS-2 happy path 2 (.docs/stories/generated-model-table.md):
//   - provider-labelled seven-column header
//   - a step whose model/effort varies by complexity tier renders each
//     distinct value once, suffixed with the tiers that share it, e.g.
//     `sonnet (S/M), fable (L)`; a step whose value is tier-invariant renders
//     plain (no suffix)
//   - engine-derived rows are emitted first (STEP_RATIONALE key order, which
//     covers all 24 StepName values), extra rows (EXTRA_MODEL_TABLE_ROWS)
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

function policyValue(
  policy: ProviderModelPolicy,
  provider: string,
  step: StepName,
  tier: ComplexityTier,
  field: 'model' | 'effort',
): string {
  const base = field === 'model' ? policy.stepModels[step] : policy.stepEfforts[step];
  if (typeof base !== 'string' || base.trim() === '') {
    throw new Error(`Missing ${provider} ${field} for step ${step}`);
  }

  const value = policy.stepTierOverrides[step]?.[tier]?.[field] ?? base;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${provider} ${field} for step ${step}`);
  }
  return value;
}

/**
 * Render a tier-varying field (model or effort) for a step. Groups the three
 * tiers by identical resolved value, preserving S/M/L order both within a
 * group's tier list and across groups (first tier at which a value appears
 * determines the group's position). A step whose value is identical across
 * all three tiers renders as the bare value with no tier suffix.
 */
export function renderTieredField(
  policy: ProviderModelPolicy,
  provider: string,
  step: StepName,
  field: 'model' | 'effort',
): string {
  const groups: { value: string; tiers: ComplexityTier[] }[] = [];

  for (const tier of TIERS) {
    const value = policyValue(policy, provider, step, tier, field);
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
  executionPath: string;
  claudeModel: string;
  claudeEffort: string;
  codexModel: string;
  codexEffort: string;
  why: string;
}

/** All 24 engine-derived rows, in STEP_RATIONALE key order. */
export function buildEngineRows(
  claudePolicy: ProviderModelPolicy = CLAUDE_MODEL_POLICY,
  codexPolicy: ProviderModelPolicy = CODEX_MODEL_POLICY,
): ModelTableRow[] {
  return (Object.keys(STEP_RATIONALE) as StepName[]).map((step) => ({
    name: stepDisplayName(step),
    executionPath: 'autonomous engine',
    claudeModel: renderTieredField(claudePolicy, 'Claude', step, 'model'),
    claudeEffort: renderTieredField(claudePolicy, 'Claude', step, 'effort'),
    codexModel: renderTieredField(codexPolicy, 'Codex', step, 'model'),
    codexEffort: renderTieredField(codexPolicy, 'Codex', step, 'effort'),
    why: STEP_RATIONALE[step],
  }));
}

/** Rows for skills/agents with no corresponding engine step. */
export function buildExtraRows(): ModelTableRow[] {
  return EXTRA_MODEL_TABLE_ROWS.map((row) => ({
    name: row.name,
    executionPath: '',
    claudeModel: row.model,
    claudeEffort: '',
    codexModel: '',
    codexEffort: '',
    why: row.rationale,
  }));
}

const TABLE_HEADER =
  '| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |';
const TABLE_SEPARATOR = '|---|---|---|---|---|---|---|';

function renderRow(row: ModelTableRow): string {
  return `| ${row.name} | ${row.executionPath} | ${row.claudeModel} | ${row.claudeEffort} | ${row.codexModel} | ${row.codexEffort} | ${row.why} |`;
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

// ────────────────────────────────────────────────────────────────────────────
// buildPinsJson
//
// Pure builder for `--pins` mode's JSON output (TS-4 happy path 1). Every
// skill in SKILL_STEP_MAP gets an `{ "expected": "<model>" }` entry, where
// "<model>" remains the legacy Claude *untiered* default
// (DEFAULT_STEP_MODELS[step] — the tier-override base value, not a
// tier-suffixed rendering). Provider-aware pin output is deferred to Task 17.
// Every skill in PIN_EXEMPT_SKILLS gets an `{ "exempt": true }` entry. No
// filesystem access.
// ────────────────────────────────────────────────────────────────────────────

export type PinsJson = Record<string, { expected: string } | { exempt: true }>;

export function buildPinsJson(): PinsJson {
  const result: PinsJson = {};

  for (const [skill, step] of Object.entries(SKILL_STEP_MAP)) {
    result[skill] = { expected: DEFAULT_STEP_MODELS[step] };
  }

  for (const skill of PIN_EXEMPT_SKILLS) {
    result[skill] = { exempt: true };
  }

  return result;
}

export type CliMode = 'write' | 'check' | 'pins';

export const EXIT_OK = 0;
export const EXIT_DRIFT = 1;
export const EXIT_ERROR = 2;

/** Remediation command surfaced whenever --check detects drift (Story TS-3). */
export const REMEDIATION_COMMAND = 'bin/generate-model-table';

// ────────────────────────────────────────────────────────────────────────────
// unifiedDiff — minimal line-based unified diff, no external dependency.
//
// Uses a classic LCS dynamic-programming table to find the minimal edit
// script between oldText and newText, then groups the resulting +/- ops into
// unified-diff hunks with surrounding context lines. Comparison is exact
// (no whitespace/line-ending normalization) so cosmetic corruption (trailing
// spaces, CRLF) shows up as a real diff rather than being hidden — Story
// TS-3 negative path 3.
// ────────────────────────────────────────────────────────────────────────────

type DiffOp = { type: 'equal' | 'del' | 'add'; line: string };

function diffLineOps(oldLines: string[], newLines: string[]): DiffOp[] {
  const n = oldLines.length;
  const m = newLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        oldLines[i] === newLines[j]
          ? dp[i + 1]![j + 1]! + 1
          : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      ops.push({ type: 'equal', line: oldLines[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: 'del', line: oldLines[i]! });
      i++;
    } else {
      ops.push({ type: 'add', line: newLines[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: 'del', line: oldLines[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: 'add', line: newLines[j]! });
    j++;
  }
  return ops;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: DiffOp[];
}

function buildHunks(ops: DiffOp[], context = 3): Hunk[] {
  const withPos: (DiffOp & { oldIdx: number; newIdx: number })[] = [];
  let oldIdx = 0;
  let newIdx = 0;
  for (const op of ops) {
    withPos.push({ ...op, oldIdx, newIdx });
    if (op.type === 'equal') {
      oldIdx++;
      newIdx++;
    } else if (op.type === 'del') {
      oldIdx++;
    } else {
      newIdx++;
    }
  }

  const changeIndices = withPos
    .map((op, idx) => (op.type === 'equal' ? -1 : idx))
    .filter((idx) => idx !== -1);

  if (changeIndices.length === 0) return [];

  const hunks: Hunk[] = [];
  let groupStart = changeIndices[0]!;
  let groupEnd = changeIndices[0]!;

  const flush = (start: number, end: number) => {
    const from = Math.max(0, start - context);
    const to = Math.min(withPos.length - 1, end + context);
    const hunkOps = withPos.slice(from, to + 1);
    const first = withPos[from]!;
    const oldCount = hunkOps.filter((o) => o.type !== 'add').length;
    const newCount = hunkOps.filter((o) => o.type !== 'del').length;
    hunks.push({
      oldStart: first.oldIdx + 1,
      oldLines: oldCount,
      newStart: first.newIdx + 1,
      newLines: newCount,
      ops: hunkOps.map(({ type, line }) => ({ type, line })),
    });
  };

  for (let k = 1; k < changeIndices.length; k++) {
    const idx = changeIndices[k]!;
    if (idx - groupEnd <= context * 2) {
      groupEnd = idx;
    } else {
      flush(groupStart, groupEnd);
      groupStart = idx;
      groupEnd = idx;
    }
  }
  flush(groupStart, groupEnd);

  return hunks;
}

/**
 * Produce a unified diff between `oldText` and `newText`. Pure, exact
 * (no normalization of whitespace or line endings) — used by --check to show
 * drift between the committed HARNESS.md and the freshly rendered table.
 * Returns '' when the texts are identical.
 */
export function unifiedDiff(oldText: string, newText: string, label = 'HARNESS.md'): string {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const ops = diffLineOps(oldLines, newLines);
  const hunks = buildHunks(ops);

  if (hunks.length === 0) return '';

  const lines: string[] = [`--- a/${label}`, `+++ b/${label}`];
  for (const hunk of hunks) {
    lines.push(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`);
    for (const op of hunk.ops) {
      const prefix = op.type === 'equal' ? ' ' : op.type === 'del' ? '-' : '+';
      lines.push(`${prefix}${op.line}`);
    }
  }
  return lines.join('\n');
}

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
 * - `pins`: JSON pin-agreement emission (buildPinsJson) written to stdout;
 *   always exits EXIT_OK (the pin-vs-engine-default comparison is done by
 *   the consuming integrity check, not this CLI).
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
    process.stdout.write(`${JSON.stringify(buildPinsJson(), null, 2)}\n`);
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
    if (spliced === doc) {
      return EXIT_OK;
    }
    const diff = unifiedDiff(doc, spliced, harnessPath);
    process.stderr.write(
      `generate-model-table: drift detected in ${harnessPath}\n\n${diff}\n\n` +
        `Run \`${REMEDIATION_COMMAND}\` to regenerate the table.\n`,
    );
    return EXIT_DRIFT;
  }

  // write mode
  if (spliced !== doc) {
    await io.writeFile(harnessPath, spliced);
  }
  return EXIT_OK;
}

/**
 * Result shape returned by {@link runGenerateModelTableCli} — a richer,
 * in-process-friendly variant of {@link runGenerateModelTable} that surfaces
 * the diff/message directly instead of only writing to stderr, so acceptance
 * tests (and future callers, e.g. an in-process integrity check) can assert
 * on the content without capturing process streams.
 */
export interface CliResult {
  exitCode: number;
  diff?: string;
  message?: string;
}

export interface CliOptions {
  harnessMdPath: string;
  mode: CliMode;
}

/**
 * Public in-process CLI entry point used by `bin/generate-model-table` (via
 * tsx) and by acceptance tests. Always uses real filesystem IO (`nodeIO`).
 *
 * Unlike {@link runGenerateModelTable}, this never writes to process.stderr
 * itself — instead it returns `diff`/`message` on the result so callers
 * decide how to surface them. `check` mode never writes to `harnessMdPath`
 * on any exit path (pass or drift).
 */
export async function runGenerateModelTableCli(opts: CliOptions): Promise<CliResult> {
  const argv = opts.mode === 'check' ? ['--check'] : opts.mode === 'pins' ? ['--pins'] : [];
  const mode = parseCliArgs(argv);

  if (mode === 'pins') {
    const json = `${JSON.stringify(buildPinsJson(), null, 2)}\n`;
    return { exitCode: EXIT_OK, message: json };
  }

  let doc: string;
  try {
    doc = await nodeIO.readFile(opts.harnessMdPath);
  } catch (err) {
    return {
      exitCode: EXIT_ERROR,
      message: `generate-model-table: failed to read ${opts.harnessMdPath}: ${(err as Error).message}`,
    };
  }

  const table = renderModelTable();

  let spliced: string;
  try {
    spliced = spliceGeneratedRegion(doc, table);
  } catch (err) {
    if (err instanceof MarkerError) {
      return { exitCode: EXIT_ERROR, message: `generate-model-table: ${err.message}` };
    }
    throw err;
  }

  if (mode === 'check') {
    if (spliced === doc) {
      return { exitCode: EXIT_OK, message: 'generate-model-table --check: OK' };
    }
    const diff = unifiedDiff(doc, spliced, opts.harnessMdPath);
    const message =
      `generate-model-table: drift detected in ${opts.harnessMdPath}\n\n${diff}\n\n` +
      `Run \`${REMEDIATION_COMMAND}\` to regenerate the table.`;
    return { exitCode: EXIT_DRIFT, diff, message };
  }

  // write mode
  if (spliced !== doc) {
    await nodeIO.writeFile(opts.harnessMdPath, spliced);
  }
  return { exitCode: EXIT_OK };
}

// ────────────────────────────────────────────────────────────────────────────
// Direct-execution entry point — invoked by `bin/generate-model-table` via
// `tsx` (Task 11). Resolves the repo-root HARNESS.md relative to this source
// file's location (src/conductor/src/tools/ -> ../../../../HARNESS.md), runs
// runGenerateModelTable against real filesystem IO, and exits with the
// resulting code (0 ok, 1 drift, 2 environment/marker error).
//
// Guarded so importing this module (e.g. from tests) never triggers process
// exit / stdio side effects — only running it directly does.
// ────────────────────────────────────────────────────────────────────────────

function defaultHarnessMdPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolvePath(here, '../../../../HARNESS.md');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const harnessPath = process.env.GENERATE_MODEL_TABLE_HARNESS_MD ?? defaultHarnessMdPath();
  runGenerateModelTable(process.argv.slice(2), nodeIO, harnessPath)
    .then((code) => {
      process.exit(code);
    })
    .catch((err) => {
      console.error('generate-model-table: fatal:', err instanceof Error ? err.message : err);
      process.exit(EXIT_ERROR);
    });
}
