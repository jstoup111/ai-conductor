/**
 * Per-fix watch registry and observation sweep.
 *
 * Watch registry — `.daemon/observation-watch.jsonl`, one JSON object per line
 * with schema version `v:1`. Three helpers:
 *   - enrollObservation    — append an entry; best-effort.
 *   - readObservationWatch — parse entries; tolerate missing file / malformed lines.
 *   - rewriteObservationWatch — overwrite the file; swallow write failures.
 *
 * Tolerant IO: skips malformed JSON lines, skips unknown schema versions (v != 1),
 * logs warnings but never crashes. Enables daemon to restart and recover state
 * without loss, even if the registry file becomes partially corrupted.
 *
 * Concurrency model: rewriteObservationWatch re-reads the current registry before writing
 * to merge any entries that were enrolled after the original read. Deduplication is by prUrl.
 * This ensures append operations during a sweep rewrite do not lose data.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ── Watch entry ───────────────────────────────────────────────────────────────

/**
 * A watched observation entry for tracking fixes in production.
 * v:1 is the current schema version.
 */
export interface ObservationEntry {
  /** Schema version; currently 1. */
  v: 1;
  /** Source reference (e.g., '#42' for issue #42). */
  sourceRef: string;
  /** PR URL where fix was merged. */
  prUrl: string;
  /** Feature slug for logging. */
  slug: string;
  /** Substring or regex pattern to watch for in daemon logs. */
  signature: string;
  /** True if signature is a regex pattern; false for substring. */
  isRegex: boolean;
  /** Number of days to watch after merge before flagging as no-show. */
  windowDays: number;
  /** Unix timestamp when observation was enrolled. */
  enrolledAt: number;
  /** Unix timestamp of last poll (optional; set by sweep). */
  lastPollAt?: number;
  /** Unix timestamp when fix was observed merged in production (optional; set by sweep). */
  mergedAt?: number;
  /** Unix timestamp of last scan (optional; set by sweep). */
  lastScanAt?: number;
}

const OBSERVATION_WATCH_FILE = '.daemon/observation-watch.jsonl';

// ── Logger type ────────────────────────────────────────────────────────────────

/**
 * Optional logger function for warnings and errors.
 */
type Logger = (msg: string) => void;

// ── Registry helpers ──────────────────────────────────────────────────────────

/**
 * Append an entry to the observation watch registry (mkdir -p .daemon first).
 * Best-effort: swallows all errors.
 */
export async function enrollObservation(
  registryPath: string,
  entry: ObservationEntry,
  log?: Logger,
): Promise<void> {
  try {
    await mkdir(join(registryPath, '.daemon'), { recursive: true });
    await writeFile(join(registryPath, OBSERVATION_WATCH_FILE), JSON.stringify(entry) + '\n', {
      flag: 'a',
    });
  } catch (err) {
    // best-effort: silently succeed even on failure
    log?.(`[observation-sweep] failed to enroll entry: ${err}`);
  }
}

/**
 * Read all valid entries from the observation watch registry.
 * Tolerates a missing file (returns []), skips malformed lines, and skips
 * entries with unknown schema versions (v != 1).
 *
 * Returns only v:1 entries; logs warnings for malformed/unknown lines.
 */
export async function readObservationWatch(
  registryPath: string,
  log?: Logger,
): Promise<ObservationEntry[]> {
  try {
    const content = await readFile(join(registryPath, OBSERVATION_WATCH_FILE), 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const obj: unknown = JSON.parse(line);

          // Validate shape: must be an object with all required fields
          if (
            obj !== null &&
            typeof obj === 'object' &&
            'v' in obj &&
            'sourceRef' in obj &&
            'prUrl' in obj &&
            'slug' in obj &&
            'signature' in obj &&
            'isRegex' in obj &&
            'windowDays' in obj &&
            'enrolledAt' in obj
          ) {
            const raw = obj as Record<string, unknown>;

            // Skip entries with unknown schema versions (only v:1 supported)
            if (raw.v !== 1) {
              log?.(`[observation-sweep] skipping entry with unknown schema v:${raw.v}`);
              return [];
            }

            // Type-check required fields
            if (
              typeof raw.sourceRef !== 'string' ||
              typeof raw.prUrl !== 'string' ||
              typeof raw.slug !== 'string' ||
              typeof raw.signature !== 'string' ||
              typeof raw.isRegex !== 'boolean' ||
              typeof raw.windowDays !== 'number' ||
              typeof raw.enrolledAt !== 'number'
            ) {
              return [];
            }

            // Build the entry with optional fields
            const entry: ObservationEntry = {
              v: 1,
              sourceRef: raw.sourceRef,
              prUrl: raw.prUrl,
              slug: raw.slug,
              signature: raw.signature,
              isRegex: raw.isRegex,
              windowDays: raw.windowDays,
              enrolledAt: raw.enrolledAt,
              // Optional fields: only include if present and correct type
              ...(typeof raw.lastPollAt === 'number' && { lastPollAt: raw.lastPollAt }),
              ...(typeof raw.mergedAt === 'number' && { mergedAt: raw.mergedAt }),
              ...(typeof raw.lastScanAt === 'number' && { lastScanAt: raw.lastScanAt }),
            };
            return [entry];
          }
          return [];
        } catch (err) {
          // Malformed JSON: log warning and skip
          log?.(`[observation-sweep] skipping malformed line: ${(err as Error).message}`);
          return [];
        }
      });
  } catch {
    // File doesn't exist or can't be read: return empty array
    return [];
  }
}

/**
 * Merge survivors (entries that passed the sweep) with any entries that were
 * enrolled concurrently after the initial read. Deduplication is by prUrl.
 * Survivors take precedence (they've been processed by sweep logic).
 *
 * When survivors is empty, return empty (can't establish reference for concurrent).
 */
function mergeSurvivorsWithConcurrent(
  survivors: ObservationEntry[],
  current: ObservationEntry[],
): ObservationEntry[] {
  if (survivors.length === 0) {
    // No survivors = can't establish reference point to detect concurrent enrollments
    // Preserve original semantics: empty survivors = empty file
    return [];
  }

  const survivorsByUrl = new Map(survivors.map((e) => [e.prUrl, e]));
  const currentByUrl = new Map(current.map((e) => [e.prUrl, e]));

  // Keep survivors (they passed sweep logic)
  // Add any entries from current that weren't in survivors (newly enrolled)
  for (const [url, entry] of currentByUrl) {
    if (!survivorsByUrl.has(url)) {
      survivorsByUrl.set(url, entry);
    }
  }

  return Array.from(survivorsByUrl.values());
}

/**
 * Overwrite the observation watch registry with the given entries.
 * Re-reads the current registry before writing to merge any entries enrolled
 * concurrently. Swallows write failures.
 */
export async function rewriteObservationWatch(
  registryPath: string,
  survivors: ObservationEntry[],
  log?: Logger,
): Promise<void> {
  try {
    // Read current registry to get any entries added since the sweep started
    const current = await readObservationWatch(registryPath, log);

    // Merge: entries from survivors + any new entries from current that aren't in survivors
    const merged = mergeSurvivorsWithConcurrent(survivors, current);

    const content =
      merged.length > 0
        ? merged.map((e) => JSON.stringify(e)).join('\n') + '\n'
        : '';
    await writeFile(join(registryPath, OBSERVATION_WATCH_FILE), content);
  } catch (err) {
    // Swallow write failures
    log?.(`[observation-sweep] failed to rewrite registry: ${err}`);
  }
}
