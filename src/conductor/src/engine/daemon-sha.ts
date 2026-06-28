import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GitRunner } from './rebase.js';

// ── Base-SHA tracking (ADR-013 / FR-4, FR-11) ────────────────────────────────
//
// Pure, injected helpers that read the base-branch tip SHA from a resolved
// discovery ref and persist the last-seen value to `.daemon/last-base-sha`.
// A re-kick sweep fires only on a genuine base-SHA advance, so these are the
// load-bearing detection primitives. They never throw: a corrupt/empty/
// unreadable persisted file is treated as ABSENT (first-run path), NEVER as a
// real differing SHA that would trigger a spurious advance.

/** Relative path (under the project root / daemon dir) of the persisted SHA. */
export const LAST_BASE_SHA_PATH = '.daemon/last-base-sha';

const SHA40 = /^[0-9a-f]{40}$/;

/**
 * Validate + normalize a raw SHA string. Returns the trimmed 40-hex SHA, or
 * `null` for anything that is not a full git object id — empty/whitespace, a
 * branch name like `main`, or a short/over-long/non-hex string. This is what
 * makes a half-written or garbage `last-base-sha` safe (FR-11): a non-SHA is
 * indistinguishable from "absent", never a spurious advance.
 */
export function parseSha(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  return SHA40.test(trimmed) ? trimmed : null;
}

/**
 * Resolve the tip SHA of `ref` via `git rev-parse <ref>` using the injected git
 * runner (which never throws). Returns the validated SHA, or `null` when the
 * ref cannot be resolved (offline, unset HEAD, unknown ref) — treated by the
 * caller as "no advance this tick", never a crash (FR-4 negative / FR-10).
 */
export async function readBaseSha(git: GitRunner, ref: string): Promise<string | null> {
  const r = await git(['rev-parse', ref]);
  if (r.exitCode !== 0) return null;
  return parseSha(r.stdout);
}

/**
 * Read the persisted last-seen base SHA from `<dir>/.daemon/last-base-sha`.
 * Empty / garbage / non-40-hex / unreadable (ENOENT, EACCES) all degrade to
 * `null` (absent) so detection treats them as the FR-5 first-run path rather
 * than a differing SHA (FR-11). Never throws.
 */
export async function readPersistedBaseSha(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, LAST_BASE_SHA_PATH), 'utf-8');
    return parseSha(raw);
  } catch {
    return null; // absent / unreadable → first-run path
  }
}

/**
 * Persist `sha` to `<dir>/.daemon/last-base-sha` (creating `.daemon/` if
 * needed). A failed write is swallowed (logged via `log`, if given) so a
 * persistence failure degrades detection without crashing the poll loop
 * (FR-4 negative). Writes the SHA with a trailing newline; `parseSha` trims it
 * back on read for an exact round-trip.
 */
export async function writePersistedBaseSha(
  dir: string,
  sha: string,
  log?: (msg: string) => void,
): Promise<void> {
  const target = join(dir, LAST_BASE_SHA_PATH);
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${sha}\n`, 'utf-8');
  } catch (err) {
    log?.(`could not persist last-base-sha: ${err instanceof Error ? err.message : String(err)}`);
  }
}
