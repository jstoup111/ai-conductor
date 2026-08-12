// self-host/release-gate.ts — ReleaseArtifactGate (TR-8/10).
//
// Two fail-closed sub-gates a harness self-build must clear at finish before a
// PR opens (adr-2026-06-30-halt-based-release-gates):
//   1. TR-8  integrity suite  — `test/test_harness_integrity.sh` must exit 0
//              (missing script or timeout → HALT, never a silent pass).
//   2. TR-10 migration block  — a breaking surface requires a runnable
//              PR-metadata block that `bin/migrate` can execute.
// Every failure writes a distinct HALT reason; uncertainty errs toward HALT.

import { execa } from 'execa';
import { access as fsAccess, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { isRunnableMigrationBlock, type ReleaseDisposition } from '../release-metadata.js';
import { writeSelfHostHalt, type GateVerdict } from './gate-halt.js';
import type { HaltMarkerWriteResult } from '../halt-marker.js';

export const INTEGRITY_SCRIPT = 'test/test_harness_integrity.sh';
export const DEFAULT_INTEGRITY_TIMEOUT_MS = 120_000;

// ── TR-8: integrity suite ────────────────────────────────────────────────────

export interface IntegrityExec {
  /** Run the integrity suite rooted at `harnessRoot`, bounded by `timeoutMs`. */
  (harnessRoot: string, timeoutMs: number): Promise<{ code: number; timedOut: boolean }>;
}

export const realIntegrityExec: IntegrityExec = async (harnessRoot, timeoutMs) => {
  const r = await execa('bash', [join(harnessRoot, INTEGRITY_SCRIPT)], {
    cwd: harnessRoot,
    reject: false,
    timeout: timeoutMs,
  });
  return { code: typeof r.exitCode === 'number' ? r.exitCode : 1, timedOut: Boolean(r.timedOut) };
};

export interface IntegrityOptions {
  harnessRoot: string;
  timeoutMs?: number;
  access?: (path: string, mode: number) => Promise<void>;
  exec?: IntegrityExec;
}

/**
 * Run the integrity suite. Fail-closed: a missing script HALTs (never treated as
 * a pass), a timeout is a failure (never an indefinite block), and any non-zero
 * exit HALTs naming the failure.
 */
export async function runIntegritySuite(opts: IntegrityOptions): Promise<GateVerdict> {
  const access = opts.access ?? ((p, m) => fsAccess(p, m));
  const scriptPath = join(opts.harnessRoot, INTEGRITY_SCRIPT);
  try {
    await access(scriptPath, constants.F_OK);
  } catch {
    return {
      ok: false,
      reason:
        `harness integrity suite not found: ${scriptPath} (self-host release gate) — ` +
        'refusing to open a PR without running it.',
    };
  }
  const exec = opts.exec ?? realIntegrityExec;
  const { code, timedOut } = await exec(opts.harnessRoot, opts.timeoutMs ?? DEFAULT_INTEGRITY_TIMEOUT_MS);
  if (timedOut) {
    return {
      ok: false,
      reason:
        'harness integrity suite timed out (self-host release gate) — treated as failure, ' +
        'not an indefinite block.',
    };
  }
  if (code !== 0) {
    return {
      ok: false,
      reason: `harness integrity suite failed (exit ${code}) (self-host release gate).`,
    };
  }
  return { ok: true };
}

// ── TR-10: migration block for breaking surfaces ─────────────────────────────

export interface ChangedFile {
  /** git name-status code: A / M / D / R<score> / C<score>. */
  status: string;
  /** Destination path (the new path for a rename/copy, else the only path). */
  path: string;
  /**
   * Source path for a rename/copy (`R<score>\told\tnew` / `C<score>\told\tnew`).
   * A rename has TWO paths; without the origin a skill moved OUT of `skills/`
   * (e.g. `skills/foo → archive/foo`, a breaking symlink-target change) would
   * escape classification because only the destination is inspected.
   */
  origPath?: string;
}

export interface BreakingSurfaces {
  breaking: boolean;
  /** True when the change set is unknown — errs toward requiring a block. */
  uncertain: boolean;
  surfaces: string[];
}

/**
 * Canonical breaking-surface names. Shared by the classifier and the waiver
 * parser (adr-2026-07-06-migration-gate-waiver, rule 3) so the two never drift:
 * a waiver can only cite one of these exact strings.
 */
export const CANONICAL_BREAKING_SURFACES = [
  'bin/conduct CLI',
  'skill symlink targets',
  'hook wiring',
  'settings.json schema',
] as const;

/**
 * Classify which breaking surfaces a change set touches (per CLAUDE.md: settings
 * schema / hook wiring / skill symlink targets / bin/conduct CLI). A null change
 * set is UNCERTAIN — the caller must then require a migration block (fail-closed).
 * Adding a skill is additive (non-breaking); deleting/renaming one changes
 * symlink targets and is breaking.
 */
export function classifyBreakingSurfaces(changed: ChangedFile[] | null): BreakingSurfaces {
  if (changed === null) return { breaking: false, uncertain: true, surfaces: [] };
  const surfaces = new Set<string>();
  for (const { status, path, origPath } of changed) {
    const removedOrRenamed = status.startsWith('D') || status.startsWith('R');
    // Inspect BOTH the destination and (for a rename/copy) the source path, so a
    // move into OR out of a breaking surface is caught on either side.
    for (const p of origPath ? [path, origPath] : [path]) {
      if (p === 'bin/conduct') surfaces.add(CANONICAL_BREAKING_SURFACES[0]);
      if (p === 'bin/install') surfaces.add(CANONICAL_BREAKING_SURFACES[1]);
      if (p.startsWith('hooks/') || p.includes('/hooks/')) surfaces.add(CANONICAL_BREAKING_SURFACES[2]);
      if (/(^|\/)settings(\.local)?\.json$/.test(p)) surfaces.add(CANONICAL_BREAKING_SURFACES[3]);
      if (p.startsWith('skills/') && removedOrRenamed) surfaces.add(CANONICAL_BREAKING_SURFACES[1]);
    }
  }
  return { breaking: surfaces.size > 0, uncertain: false, surfaces: [...surfaces] };
}

// ── TR-10 waiver (adr-2026-07-06-migration-gate-waiver) ─────────────────────

export const RELEASE_WAIVER_DIR = '.docs/release-waivers/';

/**
 * WaiverCheck has no plan-stem input (the composed gate isn't told which
 * feature is building) and there is no directory-listing seam, so a stale
 * on-disk waiver from a prior feature can only be probed at this repo's own
 * conventional example path — the same one cited in the "no waiver" HALT
 * reason below. A waiver committed under a different name is still honored
 * via diff-scanning in `findWaiverInDiff`.
 */
export const CONVENTIONAL_WAIVER_PATH =
  '.docs/release-waivers/self-host-release-gate-bin-conduct-breaking-surfac.md';

export interface ParsedWaiver {
  surfaces: string[];
  rationale: string;
}

const WAIVES_LINE_RE = /^Waives:\s*(.+)$/m;
const RATIONALE_RE = /^Rationale:\s*([\s\S]+)$/m;

/**
 * Parse a waiver's `Waives: <surfaces>` / `Rationale: <prose>` shape. Parse,
 * don't validate: a missing `Waives:` line, an empty rationale, or a surface
 * name outside `CANONICAL_BREAKING_SURFACES` is malformed — no catch-all.
 */
export function parseWaiver(text: string): ParsedWaiver | null {
  const waivesMatch = text.match(WAIVES_LINE_RE);
  if (!waivesMatch) return null;
  const rationaleMatch = text.match(RATIONALE_RE);
  const rationale = rationaleMatch ? rationaleMatch[1].trim() : '';
  if (!rationale) return null;
  const surfaces = waivesMatch[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (surfaces.length === 0) return null;
  const canonical: readonly string[] = CANONICAL_BREAKING_SURFACES;
  if (!surfaces.every((s) => canonical.includes(s))) return null;
  return { surfaces, rationale };
}

function findWaiverInDiff(changed: ChangedFile[]): ChangedFile | null {
  return (
    changed.find(
      (f) =>
        f.path.startsWith(RELEASE_WAIVER_DIR) &&
        f.path.endsWith('.md') &&
        (f.status.startsWith('A') || f.status.startsWith('M'))
    ) ?? null
  );
}

export interface WaiverVerdict {
  ok: boolean;
  reason?: string;
}

/**
 * Rules 1–3 of adr-2026-07-06-migration-gate-waiver (rule 4, uncertain change
 * sets, is enforced by the caller before this runs — an uncertain diff never
 * reaches waiver evaluation). Returns ok only when a waiver is both fresh
 * (committed in this diff) and covers every classified surface.
 */
export async function evaluateWaiver(input: {
  harnessRoot: string;
  surfaces: string[];
  changedFiles: ChangedFile[];
  readText: (path: string) => Promise<string | null>;
}): Promise<WaiverVerdict> {
  const diffEntry = findWaiverInDiff(input.changedFiles);
  const candidatePath = diffEntry?.path ?? CONVENTIONAL_WAIVER_PATH;
  const text = await input.readText(join(input.harnessRoot, candidatePath));

  if (text == null) {
    return {
      ok: false,
      reason:
        'Alternatively, commit a waiver at `.docs/release-waivers/<plan-stem>.md` ' +
        `(e.g. \`${CONVENTIONAL_WAIVER_PATH}\`) with a \`Waives:\` list of the exact breaking ` +
        'surface(s) and a rationale explaining why this is internal-only / no consumer-visible ' +
        'change.',
    };
  }
  if (!diffEntry) {
    return {
      ok: false,
      reason:
        `Waiver found at \`${candidatePath}\` but it is not committed with this change set ` +
        '(self-host release gate) — a waiver merged by a prior feature can never satisfy a new ' +
        'breaking change set; commit the waiver in this diff.',
    };
  }
  const parsed = parseWaiver(text);
  if (!parsed) {
    return {
      ok: false,
      reason:
        `Waiver at \`${candidatePath}\` is malformed (self-host release gate) — expected a ` +
        '`Waives:` line listing canonical surface names and a non-empty `Rationale:`.',
    };
  }
  const uncovered = input.surfaces.filter((s) => !parsed.surfaces.includes(s));
  if (uncovered.length > 0) {
    return {
      ok: false,
      reason:
        `Waiver at \`${candidatePath}\` does not cover: ${uncovered.join(', ')} ` +
        '(self-host release gate) — the waiver must list every touched breaking surface.',
    };
  }
  return { ok: true };
}

const MIGRATION_SECTION_RE = /(?:^|\n)###?\s+Migration\s*\n([\s\S]*?)(?=\n##\s|$)/;

/**
 * True when the text has a runnable migration block — a ```bash migration``` fence
 * inside a `## Migration` (or `### Migration`) section. Mirrors `bin/migrate`'s
 * own regexes, so "runnable" here means exactly what bin/migrate will execute.
 */
export function hasRunnableMigrationBlock(text: string | null | undefined): boolean {
  if (text == null) return false;
  const section = text.match(MIGRATION_SECTION_RE);
  const migration = section?.[1].trim() ?? text.trim();
  return isRunnableMigrationBlock(migration);
}

/**
 * TR-10: when a breaking surface is touched (or the change set is uncertain), a
 * runnable migration block is required; otherwise it is not. Fail-closed on
 * uncertainty.
 */
export function evaluateMigration(input: {
  surfaces: BreakingSurfaces;
  hasBlock: boolean;
}): GateVerdict {
  const { surfaces, hasBlock } = input;
  if (!surfaces.breaking && !surfaces.uncertain) return { ok: true };
  if (hasBlock) return { ok: true };
  const which = surfaces.uncertain
    ? 'the change set could not be determined (fail-closed)'
    : `breaking surface(s): ${surfaces.surfaces.join(', ')}`;
  return {
    ok: false,
    reason:
      `Migration block required (self-host release gate) — ${which}, but CHANGELOG has no ` +
      'runnable ```bash migration``` block under a `## Migration` section for `bin/migrate`.',
  };
}

// ── Composed gate ────────────────────────────────────────────────────────────

export interface ReleaseGateOptions {
  projectRoot: string;
  harnessRoot: string;
  /** Read a file's text, or null when absent (used for a migration waiver). */
  readText: (path: string) => Promise<string | null>;
  /** Parsed release metadata from the implementation PR. */
  releaseMetadata?: ReleaseDisposition;
  /** The build's changed files (git name-status), or null if undeterminable. */
  changedFiles: () => Promise<ChangedFile[] | null>;
  writeHalt?: (projectRoot: string, reason: string) => Promise<void | HaltMarkerWriteResult>;
  timeoutMs?: number;
  access?: (path: string, mode: number) => Promise<void>;
  exec?: IntegrityExec;
}

/**
 * Run both sub-gates in order, HALTing on the FIRST failure with that
 * gate's distinct reason (later gates are not consulted once one HALTs). Returns
 * the verdict; the caller must not open a PR when `verdict.ok` is false.
 */
export async function runReleaseArtifactGate(opts: ReleaseGateOptions): Promise<GateVerdict> {
  const writeHalt = opts.writeHalt ?? writeSelfHostHalt;
  const halt = async (verdict: Extract<GateVerdict, { ok: false }>): Promise<GateVerdict> => {
    const markerWrite = await writeHalt(opts.projectRoot, verdict.reason);
    if (markerWrite?.status === 'failed') {
      return { ok: false, reason: `${verdict.reason}\n\nHALT marker write failed: ${markerWrite.reason}` };
    }
    return verdict;
  };

  const integrity = await runIntegritySuite({
    harnessRoot: opts.harnessRoot,
    timeoutMs: opts.timeoutMs,
    access: opts.access,
    exec: opts.exec,
  });
  if (!integrity.ok) {
    return halt(integrity);
  }

  const changedFiles = await opts.changedFiles();
  const surfaces = classifyBreakingSurfaces(changedFiles);
  const migrationBlock =
    opts.releaseMetadata?.disposition === 'note' ? opts.releaseMetadata.migration : undefined;
  const migration = evaluateMigration({
    surfaces,
    hasBlock: migrationBlock !== undefined && hasRunnableMigrationBlock(migrationBlock),
  });
  if (!migration.ok) {
    // Rule 4: an uncertain (null) change set can never prove freshness (rule 1),
    // so it stays fail-closed and unwaivable — never even mention the waiver path.
    if (surfaces.uncertain) {
      return halt(migration);
    }
    const waiver = await evaluateWaiver({
      harnessRoot: opts.harnessRoot,
      surfaces: surfaces.surfaces,
      changedFiles: changedFiles ?? [],
      readText: opts.readText,
    });
    if (!waiver.ok) {
      const reason = `${migration.reason} ${waiver.reason}`;
      return halt({ ok: false, reason });
    }
    return { ok: true };
  }

  return { ok: true };
}
