/**
 * Durable authored-keys ledger (Phase 9.3, FR-12, ADR-006).
 *
 * The engineer records every (project, feature) pair it has AUTHORED a spec for
 * so FR-12 can later compute the learning trend over
 * `store signals ∩ ledger` (engineer-planned features only).
 *
 * The ledger is persisted as a JSON file (`authored-keys.json`) inside the
 * engineer dir resolved via `resolveEngineerDir(opts)` — identical env override
 * (`$AI_CONDUCTOR_ENGINEER_DIR`) and opts shape as the signal store.
 *
 * Invariants:
 *   - `recordAuthoredKey` is idempotent: the same (project, feature) pair is
 *     never duplicated in the file.
 *   - `readAuthoredKeys` returns [] when the file is absent (no throw).
 *   - `readAuthoredKeys` throws a clear error naming the file when the file
 *     is malformed JSON (consistent with registry's corrupt-surface convention).
 *   - Pairs are keyed as "project\x00feature" (null-byte separator — cannot
 *     appear in normal project/feature names) to uniquely identify each pair
 *     without ambiguity even when names contain colons or slashes.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { resolveEngineerDir } from '../engineer-store.js';

// ─── Public types ──────────────────────────────────────────────────────────────

/** One (project, feature) authored-key entry. */
export interface AuthoredKey {
  project: string;
  feature: string;
}

/** Options for `recordAuthoredKey` / `readAuthoredKeys`. */
export interface AuthoredLedgerOpts {
  /** Direct path to the engineer directory. Overrides env when provided. */
  engineerDir?: string;
  /** Passed to `resolveEngineerDir` when `engineerDir` is not given. */
  home?: string;
  env?: NodeJS.ProcessEnv;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const LEDGER_FILE = 'authored-keys.json';

/** Separator used to build the idempotency key. Null-byte never appears in
 *  normal project/feature names; guarantees no false-positive collision even
 *  when names include colons, slashes, or other punctuation. */
const KEY_SEP = '\x00';

// ─── Internal helpers ──────────────────────────────────────────────────────────

function ledgerPath(opts: AuthoredLedgerOpts = {}): string {
  const dir = opts.engineerDir ?? resolveEngineerDir({ home: opts.home, env: opts.env });
  return join(dir, LEDGER_FILE);
}

function pairKey(project: string, feature: string): string {
  return `${project}${KEY_SEP}${feature}`;
}

/**
 * Guard against writing the ledger under a bogus base directory. A caller
 * that fails to resolve the engineer dir (e.g. an unset env var stringified
 * to `"undefined"`, or a blank/relative path) must NOT silently fall through
 * to `mkdir`/`writeFile`, which would create `authored-keys.json` under
 * whatever `process.cwd()` happens to be at call time — a silent,
 * hard-to-diagnose data-location bug. Fail closed instead: throw a clear
 * error naming the bad base and the file it would have written.
 */
function assertLedgerBase(dir: string): string {
  if (!dir || dir.trim() === '' || dir === 'undefined' || dir === 'null' || !isAbsolute(dir)) {
    throw new Error(
      `recordAuthoredKey: refusing to write authored-keys.json under invalid base directory ${JSON.stringify(dir)} — ` +
        'expected a non-empty absolute path',
    );
  }
  return dir;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Append/persist the (project, feature) pair durably to the ledger.
 * Idempotent — recording the same pair twice does not duplicate it.
 *
 * The ledger file is rewritten atomically (read → merge → write) so that
 * existing entries are never lost. Because the engineer is single-writer
 * (one orchestration session at a time) this read-modify-write is safe.
 *
 * @throws {Error} when project or feature is an empty string.
 */
export async function recordAuthoredKey(
  project: string,
  feature: string,
  opts: AuthoredLedgerOpts = {},
): Promise<void> {
  if (!project || project.trim() === '') {
    throw new Error('recordAuthoredKey: project must not be empty');
  }
  if (!feature || feature.trim() === '') {
    throw new Error('recordAuthoredKey: feature must not be empty');
  }

  // Resolve the engineer dir once; derive both the mkdir target and file path from it.
  const dir = assertLedgerBase(opts.engineerDir ?? resolveEngineerDir({ home: opts.home, env: opts.env }));
  const path = join(dir, LEDGER_FILE);
  await mkdir(dir, { recursive: true });

  // Read the existing ledger (or start from an empty set).
  const existing = await readAuthoredKeys(opts);

  // Build a de-duplication set keyed by null-byte-separated composite key.
  const seen = new Set<string>(existing.map((e) => pairKey(e.project, e.feature)));

  const key = pairKey(project, feature);
  if (seen.has(key)) {
    // Already recorded — idempotent, nothing to write.
    return;
  }

  // Append the new pair and persist.
  const next: AuthoredKey[] = [...existing, { project, feature }];
  await writeFile(path, JSON.stringify(next, null, 2), 'utf-8');
}

/**
 * Return all recorded (project, feature) pairs.
 *
 * - Absent ledger file → returns [] (no throw).
 * - Malformed JSON → throws a clear error that includes the file path.
 */
export async function readAuthoredKeys(
  opts: AuthoredLedgerOpts = {},
): Promise<AuthoredKey[]> {
  const path = ledgerPath(opts);

  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    // ENOENT → file genuinely absent, treat as empty ledger.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    // Any other error (EACCES, EISDIR, ENOTDIR, …) → surface it so the
    // caller learns the ledger is unreadable (consistent with the
    // malformed-JSON branch that also names the file).
    throw new Error(
      `authored-keys.json at ${path} could not be read: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `authored-keys.json at ${path} is malformed JSON — ` +
        `unable to parse ledger: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      `authored-keys.json at ${path} is malformed — expected a JSON array but got ${typeof parsed}`,
    );
  }

  // Validate each entry has the expected shape; skip malformed entries
  // rather than crashing (defensive, in case a future schema extension
  // wrote an incompatible entry).
  const keys: AuthoredKey[] = [];
  for (const item of parsed) {
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>)['project'] === 'string' &&
      typeof (item as Record<string, unknown>)['feature'] === 'string'
    ) {
      keys.push({
        project: (item as AuthoredKey).project,
        feature: (item as AuthoredKey).feature,
      });
    }
  }
  return keys;
}
