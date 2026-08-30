// ── Version report — what `ai-conductor --version` prints ───────────────────
//
// Two identities answer "which harness is this?", and both already exist in
// the engine. This module composes them; it does NOT invent a third:
//
//   - the repo `VERSION` file — the released harness version, resolved
//     module-relative (the same probe `index.ts` already used for its
//     migration check, and `plugin-manifest.ts` for `harness_version`);
//   - the pinned engine build id — `dist-versions/<id>`, resolved by
//     `resolveEngineVersion` in `shipped-record.ts`, the same value
//     `ai-conductor daemon status` prints as `version:<id>` and the same value
//     a shipped record stamps.
//
// Module-relative, never cwd-relative: the CLI is normally reached through a
// symlink chain (`~/.local/bin/ai-conductor` → `<harness>/bin/ai-conductor` →
// the pinned `dist-versions/<id>/index.js`), so the caller's working directory
// says nothing about which harness is executing. `bin/ai-conductor` resolves
// its own path with `readlink -f` for exactly this reason; the Node side gets
// the same answer from the entry module's `__dirname`.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveEngineVersion } from './shipped-record.js';

/** The two identities a version report carries. */
export interface VersionReport {
  /** Released harness version from the repo `VERSION` file, or `0.0.0`. */
  readonly harnessVersion: string;
  /** Pinned engine build id (`dist-versions/<id>`), or `dev` when unpublished. */
  readonly engineVersion: string;
}

/** A detected bare version request. */
export interface VersionCommand {
  readonly kind: 'version';
}

/** Reads a UTF-8 file, or resolves null when it is missing/unreadable. */
export type ReadText = (path: string) => Promise<string | null>;

/** Value reported when no candidate `VERSION` file could be read. */
export const UNKNOWN_HARNESS_VERSION = '0.0.0';

const VERSION_TOKENS: ReadonlySet<string> = new Set(['--version', '-V', 'version']);

/**
 * Detect a bare version request. Deliberately strict: the whole invocation
 * must be exactly one version token, so `ai-conductor daemon --version` and
 * `ai-conductor version --json` fall through to their own handlers rather than
 * being silently answered here.
 */
export function detectVersionCommand(argv: readonly string[]): VersionCommand | null {
  const rest = argv.slice(2);
  if (rest.length !== 1) return null;
  return VERSION_TOKENS.has(rest[0]) ? { kind: 'version' } : null;
}

/**
 * The `VERSION` candidates for a module living at `moduleDir`. The depth
 * differs between the bundle (`src/conductor/dist-versions/<id>/` → four levels
 * up) and the source tree (`src/conductor/src/` → three levels up), so probe
 * both, nearest first.
 */
export function harnessVersionCandidates(moduleDir: string): string[] {
  return [
    join(moduleDir, '..', '..', '..', 'VERSION'),
    join(moduleDir, '..', '..', '..', '..', 'VERSION'),
  ];
}

const realReadText: ReadText = (path) =>
  readFile(path, 'utf-8').then(
    (raw) => raw,
    () => null,
  );

/**
 * Resolve the released harness version from the repo `VERSION` file, relative
 * to `moduleDir`. Returns `UNKNOWN_HARNESS_VERSION` when no candidate holds a
 * semver-shaped value — reporting is advisory and must never throw.
 */
export async function resolveHarnessVersion(
  moduleDir: string,
  readText: ReadText = realReadText,
): Promise<string> {
  for (const path of harnessVersionCandidates(moduleDir)) {
    const raw = await readText(path);
    if (raw === null) continue;
    const value = raw.trim();
    if (/^\d+\.\d+\.\d+/.test(value)) return value;
  }
  return UNKNOWN_HARNESS_VERSION;
}

/** One line naming the harness version and the engine build behind it. */
export function renderVersionReport(report: VersionReport): string {
  return `ai-conductor ${report.harnessVersion} (engine ${report.engineVersion})`;
}

export interface VersionDispatchOptions {
  /** Directory of the running entry module (`__dirname` in `index.ts`). */
  readonly moduleDir: string;
  /** Injected `VERSION` reader (tests). */
  readonly readText?: ReadText;
  /** Injected output sink (tests). Defaults to stdout. */
  readonly write?: (chunk: string) => void;
}

/**
 * Print the version report. Always exits 0: an unresolvable `VERSION` file or
 * an unpublished (dev/tsx) engine degrade to `0.0.0` / `dev` rather than
 * failing the command.
 */
export async function dispatchVersionCommand(opts: VersionDispatchOptions): Promise<number> {
  const write = opts.write ?? ((chunk: string) => process.stdout.write(chunk));
  const harnessVersion = await resolveHarnessVersion(opts.moduleDir, opts.readText);
  const engineVersion = resolveEngineVersion(opts.moduleDir);
  write(`${renderVersionReport({ harnessVersion, engineVersion })}\n`);
  return 0;
}
