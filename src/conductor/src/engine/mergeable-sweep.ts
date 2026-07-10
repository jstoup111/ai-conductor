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
  upsertComment,
  type PrMergeState,
} from './pr-labels.js';
import type { ConductorEvent } from '../types/events.js';

// ── Task 21: exhaustion escalation ──────────────────────────────────────────

/** Stable hidden marker identifying the CI-exhaustion escalation comment. */
const CI_EXHAUSTION_MARKER = '<!-- conductor:ci-exhaustion -->';

/** Attempt cap mirrored from `ci-fix.ts#evaluateEligibilityGates` (Gate 1). */
const CI_FIX_ATTEMPT_CAP = 2;

/**
 * Build the escalation comment body: failing check names + attempt history.
 */
function buildExhaustionComment(entry: WatchEntry, state: PrMergeState): string {
  const checkNames =
    state.statusCheckRollup?.map((c) => c.name ?? '?').filter(Boolean) ?? [];
  const attempts = entry.ciFixAttempts ?? 0;
  return [
    '## CI fix exhausted',
    '',
    `Automated CI-fix attempts exhausted after ${attempts} attempt(s).`,
    '',
    'Failing checks:',
    ...(checkNames.length > 0 ? checkNames.map((n) => `- ${n}`) : ['- (none reported)']),
    '',
    'Manual remediation is required.',
  ].join('\n');
}

// ── Watch entry ───────────────────────────────────────────────────────────────

export interface WatchEntry {
  prUrl: string;
  slug: string;
  repoCwd: string;
  resolveAttempts?: number;
  lastResolveAt?: string;
  ciFixAttempts?: number;
  lastCiFixAt?: string;
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
 * Normalizes legacy entries: resolveAttempts defaults to 0 if missing.
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
            const raw = obj as Record<string, unknown>;
            const entry: WatchEntry = {
              prUrl: raw.prUrl as string,
              slug: raw.slug as string,
              repoCwd: raw.repoCwd as string,
              // Zero-default normalization for legacy entries
              resolveAttempts: typeof raw.resolveAttempts === 'number' ? raw.resolveAttempts : 0,
              // lastResolveAt is optional; only include if present
              ...(typeof raw.lastResolveAt === 'string' && { lastResolveAt: raw.lastResolveAt }),
              // Zero-default normalization for ciFix fields
              ciFixAttempts: typeof raw.ciFixAttempts === 'number' ? raw.ciFixAttempts : 0,
              // lastCiFixAt is optional; only include if present
              ...(typeof raw.lastCiFixAt === 'string' && { lastCiFixAt: raw.lastCiFixAt }),
            };
            return [entry];
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

/**
 * Task 17: sweep-driven autoresolve dispatch, injected so the sweep can pick
 * the first eligible CONFLICTING PR after the label pass and hand it off to
 * the resolution pipeline — without the sweep needing to know how that
 * pipeline works (worktree prep, rebase, guards, etc. live elsewhere).
 *
 * `enabled` is read by the caller from `mergeable_autoresolve.enabled` so the
 * sweep stays byte-identical to today when the feature is off (AC4).
 */
export interface AutoresolveDispatchOpts {
  /** Config gate — when false, the sweep runs exactly as before (no new work). */
  enabled: boolean;
  /**
   * Eligibility check for a single entry (cooldown, attempt cap, sticky
   * labels, etc. — see `autoresolve.ts#isEligibleForResolve`). Injected so
   * this module never imports the resolution pipeline directly.
   */
  isEligible: (
    entry: WatchEntry,
    state: PrMergeState,
  ) => Promise<{ eligible: boolean; reason?: string }>;
  /**
   * Dispatch resolution for the chosen entry. Called with the entry AFTER
   * its attempt counter has already been bumped and `lastResolveAt` set
   * (AC3) — the git work itself happens inside this callback.
   * Returns the outcome kind so the sweep can reset the counter on success.
   */
  dispatch: (entry: WatchEntry) => Promise<{ kind: 'refreshed' | 'escalated' } | void>;
  /** Clock override for tests; defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * Task 10: sweep-driven CI fix dispatch, injected so the sweep can pick
 * the first eligible failed PR after the label pass and hand it off to
 * the CI fix pipeline — without the sweep needing to know how that
 * pipeline works (worktree prep, fix session, guards, etc. live elsewhere).
 *
 * `enabled` is read by the caller from `ci_watch.enabled` so the
 * sweep stays byte-identical to today when the feature is off (AC4).
 */
export interface CiFixDispatchOpts {
  /** Config gate — when false, the sweep runs exactly as before (no new work). */
  enabled: boolean;
  /**
   * Eligibility check for a single entry (cooldown, attempt cap, sticky
   * labels, etc. — see `ci-fix.ts#isEligibleForCiFix`). Injected so
   * this module never imports the CI fix pipeline directly.
   */
  isEligible: (
    entry: WatchEntry,
    state: PrMergeState,
  ) => Promise<{ eligible: boolean; reason?: string }>;
  /**
   * Dispatch CI fix for the chosen entry. Called with the entry AFTER
   * its attempt counter has already been bumped and `lastCiFixAt` set
   * (AC3) — the git work itself happens inside this callback.
   * Returns the outcome kind so the sweep can reset the counter on success.
   */
  dispatch: (entry: WatchEntry) => Promise<{ kind: 'green-verified' } | void>;
  /** Clock override for tests; defaults to `new Date()`. */
  now?: () => Date;
}

export interface SweepOpts {
  projectRoot: string;
  log?: (msg: string) => void;
  runGh?: GhRunner;
  /** Task 17: optional autoresolve dispatch, run once per tick after the label pass. */
  autoresolve?: AutoresolveDispatchOpts;
  /** Task 10: optional CI fix dispatch, run once per tick after the label pass. */
  ciFix?: CiFixDispatchOpts;
  /** Task 8: optional event callback for sweep events (e.g. ci_failed on transition). */
  onEvent?: (event: ConductorEvent) => void;
}

/**
 * For each tracked PR: evaluate merge state then update the `mergeable` label
 * according to the decision tree; prune closed/merged PRs. Never throws (FR-15).
 */
export async function sweepMergeableLabels({
  projectRoot,
  log,
  runGh,
  autoresolve,
  ciFix,
  onEvent,
}: SweepOpts): Promise<void> {
  const gh = runGh ?? makeProductionGh();
  try {
    const entries = await readWatch(projectRoot);
    const survivors: WatchEntry[] = [];
    // Task 17 (AC1/AC2): PRs whose `mergeable` field is CONFLICTING, gathered
    // during the label pass so the autoresolve dispatch below never re-fetches
    // PR state. Only populated/consulted when autoresolve is configured.
    const conflictingCandidates: Array<{ entry: WatchEntry; state: PrMergeState }> = [];
    // Task 10 (AC1/AC2): PRs whose `checksOutcome` is 'failed', gathered
    // during the label pass so the ciFix dispatch below never re-fetches
    // PR state. Only populated/consulted when ciFix is configured.
    const failedCandidates: Array<{ entry: WatchEntry; state: PrMergeState }> = [];

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

        // Task 17 (AC1): track CONFLICTING PRs for the post-label-pass
        // autoresolve dispatch below. Collected unconditionally (cheap) but
        // only ever consulted when `autoresolve` is configured, so a disabled
        // config leaves the sweep's observable behavior unchanged (AC4).
        if (state.mergeable === 'CONFLICTING') {
          conflictingCandidates.push({ entry, state });
        }

        // FR-12: if the PR carries `needs-remediation`, ensure `mergeable` is absent.
        let hasRemediation = state.labels.includes('needs-remediation');

        // Task 21: exhaustion — escalate exactly once. Gated on the
        // label-absent→present transition so a sweep that finds
        // needs-remediation already present (sticky) performs zero new gh
        // mutations or events, matching the Task 8 ci_failed transition
        // pattern above.
        if (
          !hasRemediation &&
          state.checksOutcome === 'failed' &&
          (entry.ciFixAttempts ?? 0) >= CI_FIX_ATTEMPT_CAP
        ) {
          await ensureLabel(gh, entry.repoCwd, 'needs-remediation', 'B60205', log);
          await addLabel(gh, entry.repoCwd, entry.prUrl, 'needs-remediation', log);
          await upsertComment(
            gh,
            entry.repoCwd,
            entry.prUrl,
            CI_EXHAUSTION_MARKER,
            buildExhaustionComment(entry, state),
            log,
          );
          onEvent?.({
            type: 'ci_failed',
            prUrl: entry.prUrl,
            slug: entry.slug,
            checks: state.statusCheckRollup?.map((c) => c.name ?? '?').filter(Boolean) ?? [],
            attempts: entry.ciFixAttempts ?? 0,
            phase: 'exhausted',
          });
          hasRemediation = true;
        }

        if (hasRemediation) {
          if (state.labels.includes('mergeable')) {
            await removeLabel(gh, entry.repoCwd, entry.prUrl, 'mergeable', log);
          }
        } else {
          // Task 10 (AC1): track failed PRs for the post-label-pass
          // ciFix dispatch below. Only added when needs-remediation is NOT present
          // (needs-remediation sticky label takes precedence over CI fix dispatch).
          // Collected unconditionally (cheap) but only ever consulted when `ciFix`
          // is configured, so a disabled config leaves the sweep's observable behavior
          // unchanged (AC4).
          if (state.checksOutcome === 'failed') {
            failedCandidates.push({ entry, state });
          }
        }

        // Task 6: ci-failed label on failed checks (idempotent)
        // Add `ci-failed` label when checks outcome is 'failed' and not already present.
        // This happens regardless of needs-remediation status.
        if (state.checksOutcome === 'failed') {
          if (!state.labels.includes('ci-failed')) {
            await ensureLabel(gh, entry.repoCwd, 'ci-failed', 'E8451F', log);
            await addLabel(gh, entry.repoCwd, entry.prUrl, 'ci-failed', log);
            // Task 8: emit ci_failed event on label-absent→present transition (detected phase)
            onEvent?.({
              type: 'ci_failed',
              prUrl: entry.prUrl,
              slug: entry.slug,
              checks: state.statusCheckRollup?.map((c) => c.name ?? '?').filter(Boolean) ?? [],
              attempts: (entry.ciFixAttempts ?? 0) + 1,
              phase: 'detected',
            });
          }
        }

        // Task 7: green path removes ci-failed and resets attempts (idempotent)
        // When checks outcome is 'green', remove `ci-failed` if present and reset ciFixAttempts.
        if (state.checksOutcome === 'green') {
          if (state.labels.includes('ci-failed')) {
            await removeLabel(gh, entry.repoCwd, entry.prUrl, 'ci-failed', log);
          }
          // Reset ciFixAttempts to 0 on green
          const greenIdx = survivors.findIndex((s) => s.prUrl === entry.prUrl);
          if (greenIdx >= 0) {
            survivors[greenIdx] = { ...survivors[greenIdx], ciFixAttempts: 0 };
          }
        }

        // FR-10 / C2 / FR-12: add/remove `mergeable` only when needs-remediation is absent.
        if (!hasRemediation) {
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
        }
      } catch (err) {
        // Per-PR exception (including gh label ensure/add/remove failures):
        // log + skip, continue with other entries (FR-15, Task 9). The entry
        // may already be in survivors (pushed above once its state was read
        // as live) — only push again here if it never made it in, so a
        // label-operation error never duplicates the entry in the registry.
        log?.(`[mergeable-sweep] error processing ${entry.prUrl}: ${err}`);
        if (!survivors.some((s) => s.prUrl === entry.prUrl)) {
          survivors.push(entry);
        }
      }
    }

    // Task 17: after the label pass, dispatch resolution for the first
    // eligible CONFLICTING PR this tick; any further eligible PR is deferred
    // (AC2). Attempt counter + lastResolveAt are bumped on the survivor entry
    // BEFORE dispatch runs any git work (AC3). Entirely skipped when
    // autoresolve is absent or disabled, so the sweep stays byte-identical to
    // today (AC4).
    if (autoresolve?.enabled) {
      let dispatched = false;
      for (const { entry, state } of conflictingCandidates) {
        const elig = await autoresolve.isEligible(entry, state);
        if (!elig.eligible) continue;

        if (dispatched) {
          log?.(`[mergeable-sweep] deferring ${entry.prUrl} (skip reason: in-flight)`);
          continue;
        }

        dispatched = true;
        const now = autoresolve.now ? autoresolve.now() : new Date();
        const updated: WatchEntry = {
          ...entry,
          resolveAttempts: (entry.resolveAttempts ?? 0) + 1,
          lastResolveAt: now.toISOString(),
        };
        const idx = survivors.findIndex((s) => s.prUrl === entry.prUrl);
        if (idx >= 0) survivors[idx] = updated;

        const dispatchResult = await autoresolve.dispatch(updated);
        if (dispatchResult?.kind === 'refreshed') {
          survivors[idx] = { ...updated, resolveAttempts: 0 };
        }
      }
    }

    // Task 10: after the label pass, dispatch CI fix for the first
    // eligible failed PR this tick; any further eligible PR is deferred
    // (AC2). Attempt counter + lastCiFixAt are bumped on the survivor entry
    // BEFORE dispatch runs any git work (AC3). Entirely skipped when
    // ciFix is absent or disabled, so the sweep stays byte-identical to
    // today (AC4).
    if (ciFix?.enabled) {
      let dispatched = false;
      for (const { entry, state } of failedCandidates) {
        const elig = await ciFix.isEligible(entry, state);
        if (!elig.eligible) continue;

        if (dispatched) {
          log?.(`[mergeable-sweep] deferring ${entry.prUrl} (skip reason: in-flight)`);
          continue;
        }

        dispatched = true;
        const now = ciFix.now ? ciFix.now() : new Date();
        const updated: WatchEntry = {
          ...entry,
          ciFixAttempts: (entry.ciFixAttempts ?? 0) + 1,
          lastCiFixAt: now.toISOString(),
        };
        const idx = survivors.findIndex((s) => s.prUrl === entry.prUrl);
        if (idx >= 0) survivors[idx] = updated;

        try {
          const dispatchResult = await ciFix.dispatch(updated);
          if (dispatchResult?.kind === 'green-verified') {
            survivors[idx] = { ...updated, ciFixAttempts: 0 };
          }
        } catch (err) {
          // Task 11: dispatch error is logged but not propagated (AC1b)
          // The bumped counter persists (already written to survivors[idx])
          log?.(`[mergeable-sweep] ciFix dispatch error: ${err}`);
        }
      }
    }

    await rewriteWatch(projectRoot, survivors);
  } catch (err) {
    // Sweep-level exception: swallow so callers are never disrupted (FR-15).
    log?.(`[mergeable-sweep] sweep error: ${err}`);
  }
}
