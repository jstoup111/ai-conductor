/**
 * Per-repo watch registry and mergeable label sweep.
 *
 * Watch registry — `.daemon/mergeable-watch.jsonl`, one JSON object per line
 * `{prUrl, slug, repoCwd}`. Three helpers:
 *   - enrollWatch    — append an entry; best-effort.
 *   - readWatch      — parse entries; tolerate missing file / malformed lines.
 *   - rewriteWatch   — overwrite the file; swallow write failures (C3).
 *
 * sweepMergeableLabels — for each tracked PR:
 *   1. MERGED / CLOSED → prune (FR-13).
 *   2. UNKNOWN state (read error) → log + skip (FR-15).
 *   3. labels includes `needs-remediation` → ensure `mergeable` absent (FR-12).
 *   4. isMergeable → add `mergeable` if not already present (FR-10, C2).
 *   5. otherwise → remove `mergeable` if currently present (FR-11, C2).
 *
 * All operations are best-effort / non-throwing (C3, FR-15).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  GhRunner,
  makeProductionGh,
  ensureLabel,
  addLabel,
  removeLabel,
  prMergeState,
  isMergeable,
} from './pr-labels.js';

// ── Watch entry ───────────────────────────────────────────────────────────────

export interface WatchEntry {
  prUrl: string;
  slug: string;
  repoCwd: string;
}

const WATCH_FILE = '.daemon/mergeable-watch.jsonl';

// ── Registry helpers ──────────────────────────────────────────────────────────

/**
 * Append an entry to the watch registry (mkdir -p .daemon first).
 * Best-effort: swallows all errors.
 */
export async function enrollWatch(projectRoot: string, entry: WatchEntry): Promise<void> {
  try {
    await mkdir(join(projectRoot, '.daemon'), { recursive: true });
    await writeFile(join(projectRoot, WATCH_FILE), JSON.stringify(entry) + '\n', { flag: 'a' });
  } catch {
    // best-effort
  }
}

/**
 * Read all valid entries from the watch registry.
 * Tolerates a missing file (returns []) and skips malformed lines.
 */
export async function readWatch(projectRoot: string): Promise<WatchEntry[]> {
  try {
    const content = await readFile(join(projectRoot, WATCH_FILE), 'utf-8');
    return content
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const obj: unknown = JSON.parse(line);
          if (
            obj !== null &&
            typeof obj === 'object' &&
            'prUrl' in obj &&
            'slug' in obj &&
            'repoCwd' in obj &&
            typeof (obj as Record<string, unknown>).prUrl === 'string' &&
            typeof (obj as Record<string, unknown>).slug === 'string' &&
            typeof (obj as Record<string, unknown>).repoCwd === 'string'
          ) {
            return [obj as WatchEntry];
          }
          return [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

/**
 * Overwrite the watch registry with the given entries.
 * Swallows write failures (C3).
 */
export async function rewriteWatch(projectRoot: string, entries: WatchEntry[]): Promise<void> {
  try {
    const content =
      entries.length > 0 ? entries.map((e) => JSON.stringify(e)).join('\n') + '\n' : '';
    await writeFile(join(projectRoot, WATCH_FILE), content);
  } catch {
    // swallow (C3)
  }
}

// ── Sweep ─────────────────────────────────────────────────────────────────────

export interface SweepOpts {
  projectRoot: string;
  log?: (msg: string) => void;
  runGh?: GhRunner;
}

/**
 * For each tracked PR: evaluate merge state then update the `mergeable` label
 * according to the decision tree; prune closed/merged PRs. Never throws (FR-15).
 */
export async function sweepMergeableLabels({ projectRoot, log, runGh }: SweepOpts): Promise<void> {
  const gh = runGh ?? makeProductionGh();
  try {
    const entries = await readWatch(projectRoot);
    const survivors: WatchEntry[] = [];

    for (const entry of entries) {
      try {
        const state = await prMergeState(gh, entry.repoCwd, entry.prUrl, log);

        // FR-13: MERGED / CLOSED / NOTFOUND → prune from registry.
        // NOTFOUND means the PR is genuinely gone (404 / deleted); prune it so
        // the watch registry does not grow without bound.
        if (
          state.state === 'MERGED' ||
          state.state === 'CLOSED' ||
          state.state === 'NOTFOUND'
        ) {
          log?.(`[mergeable-sweep] pruning ${entry.prUrl} (state: ${state.state})`);
          continue; // not added to survivors
        }

        // FR-15: UNKNOWN state (transient read/fetch error) → log + skip this
        // iteration; keep the entry so it is retried on the next sweep cycle.
        if (state.state === 'UNKNOWN') {
          log?.(`[mergeable-sweep] skipping ${entry.prUrl} (could not read state)`);
          survivors.push(entry);
          continue;
        }

        // Entry is live — keep it in the registry.
        survivors.push(entry);

        // FR-12: if the PR carries `needs-remediation`, ensure `mergeable` is absent.
        if (state.labels.includes('needs-remediation')) {
          if (state.labels.includes('mergeable')) {
            await removeLabel(gh, entry.repoCwd, entry.prUrl, 'mergeable', log);
          }
          // Never add `mergeable` when `needs-remediation` is present.
          continue;
        }

        // FR-10 / C2: add `mergeable` only when not already present.
        if (isMergeable(state)) {
          if (!state.labels.includes('mergeable')) {
            await ensureLabel(gh, entry.repoCwd, 'mergeable', '0E8A16', log);
            await addLabel(gh, entry.repoCwd, entry.prUrl, 'mergeable', log);
          }
        } else {
          // FR-11 / C2: remove `mergeable` only when currently present.
          if (state.labels.includes('mergeable')) {
            await removeLabel(gh, entry.repoCwd, entry.prUrl, 'mergeable', log);
          }
        }
      } catch (err) {
        // Per-PR exception: log + skip, continue with other entries (FR-15).
        log?.(`[mergeable-sweep] error processing ${entry.prUrl}: ${err}`);
        survivors.push(entry);
      }
    }

    await rewriteWatch(projectRoot, survivors);
  } catch (err) {
    // Sweep-level exception: swallow so callers are never disrupted (FR-15).
    log?.(`[mergeable-sweep] sweep error: ${err}`);
  }
}
