/**
 * Durable authored-keys ledger (Phase 9.3, FR-12, ADR-006).
 *
 * The brain records every (project, feature) pair it has AUTHORED a spec for
 * so FR-12 can later compute the learning trend over
 * `store signals ∩ ledger` (brain-planned features only).
 *
 * The ledger is persisted as a JSON file (`authored-keys.json`) inside the
 * brain dir resolved via `resolveBrainDir(opts)` — identical env override
 * (`$AI_CONDUCTOR_BRAIN_DIR`) and opts shape as the signal store.
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
import { join } from 'node:path';
import { resolveBrainDir } from '../brain-store.js';

// ─── Public types ──────────────────────────────────────────────────────────────

/** One (project, feature) authored-key entry. */
export interface AuthoredKey {
  project: string;
  feature: string;
}

/** Options for `recordAuthoredKey` / `readAuthoredKeys`. */
export interface AuthoredLedgerOpts {
  /** Direct path to the brain directory. Overrides env when provided. */
  brainDir?: string;
  /** Passed to `resolveBrainDir` when `brainDir` is not given. */
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
  const dir = opts.brainDir ?? resolveBrainDir({ home: opts.home, env: opts.env });
  return join(dir, LEDGER_FILE);
}

function pairKey(project: string, feature: string): string {
  return `${project}${KEY_SEP}${feature}`;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Append/persist the (project, feature) pair durably to the ledger.
 * Idempotent — recording the same pair twice does not duplicate it.
 *
 * The ledger file is rewritten atomically (read → merge → write) so that
 * existing entries are never lost. Because the brain is single-writer
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

  const path = ledgerPath(opts);

  // Ensure the brain dir exists before attempting a read.
  const dir = opts.brainDir ?? resolveBrainDir({ home: opts.home, env: opts.env });
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
  } catch {
    // ENOENT (or any read error) → treat as empty ledger.
    return [];
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
