// self-host/release-gate.ts — ReleaseArtifactGate (TR-8/9/10).
//
// Three fail-closed sub-gates a harness self-build must clear at finish before a
// PR opens (adr-2026-06-30-halt-based-release-gates):
//   1. TR-8  integrity suite  — `test/test_harness_integrity.sh` must exit 0
//              (missing script or timeout → HALT, never a silent pass).
//   2. TR-9  CHANGELOG        — a non-empty `## [Unreleased]` section.
//   3. TR-10 migration block  — a breaking surface requires a runnable
//              ```bash migration``` block that `bin/migrate` can execute.
// Every failure writes a distinct HALT reason; uncertainty errs toward HALT.

import { execa } from 'execa';
import { access as fsAccess, constants } from 'node:fs/promises';
import { join } from 'node:path';
import { writeSelfHostHalt, type GateVerdict } from './gate-halt.js';

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

// ── TR-9: CHANGELOG [Unreleased] ─────────────────────────────────────────────

const HEADER_RE = /^##\s+\[([^\]]+)\]/;

/**
 * Extract the text under `## [Unreleased]` up to the next VERSIONED header.
 * Tolerates duplicate `## [Unreleased]` headers (the real CHANGELOG has them):
 * content is gathered across consecutive Unreleased sections until the first
 * versioned `## [x.y.z]` header. Returns null when there is no Unreleased header.
 */
export function extractUnreleasedBody(changelog: string | null | undefined): string | null {
  if (changelog == null) return null;
  const lines = changelog.split('\n');
  let i = 0;
  // Find the first real Unreleased header.
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(HEADER_RE);
    if (m && m[1].toLowerCase() === 'unreleased') break;
  }
  if (i >= lines.length) return null;
  const body: string[] = [];
  for (i += 1; i < lines.length; i++) {
    const m = lines[i].trim().match(HEADER_RE);
    if (m) {
      if (m[1].toLowerCase() === 'unreleased') continue; // skip duplicate headers
      break; // reached the next versioned section
    }
    body.push(lines[i]);
  }
  return body.join('\n');
}

/** True when the section body has at least one real entry (a `- ` bullet). */
function hasChangelogEntry(body: string): boolean {
  return body.split('\n').some((l) => /^\s*-\s+\S/.test(l));
}

/**
 * TR-9: a self-build needs a non-empty `## [Unreleased]` with ≥1 entry. A
 * missing section, an empty section, or subheaders-only all HALT (fail-closed).
 */
export function evaluateChangelogUnreleased(changelog: string | null | undefined): GateVerdict {
  const body = extractUnreleasedBody(changelog);
  if (body === null) {
    return {
      ok: false,
      reason:
        'CHANGELOG has no `## [Unreleased]` section (self-host release gate) — add one with the ' +
        'change under Added/Changed/Fixed/Removed.',
    };
  }
  if (!hasChangelogEntry(body)) {
    return {
      ok: false,
      reason:
        'CHANGELOG `## [Unreleased]` is empty (self-host release gate) — a header alone does not ' +
        'satisfy the gate; add at least one entry.',
    };
  }
  return { ok: true };
}

// ── TR-10: migration block for breaking surfaces ─────────────────────────────

export interface ChangedFile {
  /** git name-status code: A / M / D / R<score> / C<score>. */
  status: string;
  path: string;
}

export interface BreakingSurfaces {
  breaking: boolean;
  /** True when the change set is unknown — errs toward requiring a block. */
  uncertain: boolean;
  surfaces: string[];
}

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
  for (const { status, path } of changed) {
    const removedOrRenamed = status.startsWith('D') || status.startsWith('R');
    if (path === 'bin/conduct') surfaces.add('bin/conduct CLI');
    if (path === 'bin/install') surfaces.add('skill symlink targets');
    if (path.startsWith('hooks/') || path.includes('/hooks/')) surfaces.add('hook wiring');
    if (/(^|\/)settings(\.local)?\.json$/.test(path)) surfaces.add('settings.json schema');
    if (path.startsWith('skills/') && removedOrRenamed) surfaces.add('skill symlink targets');
  }
  return { breaking: surfaces.size > 0, uncertain: false, surfaces: [...surfaces] };
}

const MIGRATION_SECTION_RE = /(?:^|\n)###?\s+Migration\s*\n([\s\S]*?)(?=\n##\s|$)/;
const MIGRATION_FENCE_RE = /```bash migration\s*\n[\s\S]*?```/;

/**
 * True when the text has a runnable migration block — a ```bash migration``` fence
 * inside a `## Migration` (or `### Migration`) section. Mirrors `bin/migrate`'s
 * own regexes, so "runnable" here means exactly what bin/migrate will execute.
 */
export function hasRunnableMigrationBlock(text: string | null | undefined): boolean {
  if (text == null) return false;
  const section = text.match(MIGRATION_SECTION_RE);
  if (!section) return false;
  return MIGRATION_FENCE_RE.test(section[1]);
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
  /** Read a file's text, or null when absent (used for CHANGELOG). */
  readText: (path: string) => Promise<string | null>;
  /** The build's changed files (git name-status), or null if undeterminable. */
  changedFiles: () => Promise<ChangedFile[] | null>;
  writeHalt?: (projectRoot: string, reason: string) => Promise<void>;
  timeoutMs?: number;
  access?: (path: string, mode: number) => Promise<void>;
  exec?: IntegrityExec;
}

/**
 * Run all three sub-gates in order, HALTing on the FIRST failure with that
 * gate's distinct reason (later gates are not consulted once one HALTs). Returns
 * the verdict; the caller must not open a PR when `verdict.ok` is false.
 */
export async function runReleaseArtifactGate(opts: ReleaseGateOptions): Promise<GateVerdict> {
  const writeHalt = opts.writeHalt ?? writeSelfHostHalt;

  const integrity = await runIntegritySuite({
    harnessRoot: opts.harnessRoot,
    timeoutMs: opts.timeoutMs,
    access: opts.access,
    exec: opts.exec,
  });
  if (!integrity.ok) {
    await writeHalt(opts.projectRoot, integrity.reason);
    return integrity;
  }

  const changelog = await opts.readText(join(opts.harnessRoot, 'CHANGELOG.md'));
  const changelogVerdict = evaluateChangelogUnreleased(changelog);
  if (!changelogVerdict.ok) {
    await writeHalt(opts.projectRoot, changelogVerdict.reason);
    return changelogVerdict;
  }

  const surfaces = classifyBreakingSurfaces(await opts.changedFiles());
  const migration = evaluateMigration({
    surfaces,
    hasBlock: hasRunnableMigrationBlock(extractUnreleasedBody(changelog)),
  });
  if (!migration.ok) {
    await writeHalt(opts.projectRoot, migration.reason);
    return migration;
  }

  return { ok: true };
}
