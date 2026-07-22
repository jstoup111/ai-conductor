import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { HarnessConfig } from '../types/config.js';
import { isAttributionEnforcementActive } from './config.js';
import { haltMarkerExists, normalizeTasks } from './task-progress.js';

// #505 TS-2: inline build-work attribution enforcement — predicate + marker
// file helpers. The marker file is written by the engine right before a
// build-work step dispatches and removed right after, so a session hook that
// fires mid-step (outside the engine's own dispatch) can tell "this commit
// happened while dispatched build work was in flight" from "this is
// unattributed session activity" without needing IPC.

/**
 * Whether inline build-work attribution enforcement is configured to be
 * active at `now`. Thin wrapper over the config module's cutover predicate —
 * kept here so callers that only care about "is enforcement on" don't need to
 * import the (larger) config module directly. Absent cutover → false.
 */
export function isEnforcementConfigured(config: HarnessConfig, now: Date = new Date()): boolean {
  return isAttributionEnforcementActive(config.attribution_enforcement_cutover, now);
}

/**
 * Resolve the audit sample percentage from config. Returns the configured value
 * if present and valid, or the default (10) if absent. The config parsing
 * already validates and clamps this value at load time, so this function
 * is safe to call without additional validation.
 */
export function resolveAttributionAuditSamplePct(config: HarnessConfig): number {
  return config.attribution_audit_sample_pct ?? 10;
}

/**
 * Path to the build-step-active marker file, relative to `root`.
 * Pure function — does not touch the filesystem.
 */
export function markerPath(root: string): string {
  if (!root) {
    throw new Error('markerPath requires a non-empty root path');
  }
  return join(root, '.pipeline', 'build-step-active');
}

/**
 * Write the build-step-active marker, creating the `.pipeline` directory if
 * necessary. Content is a plain ISO-8601 timestamp so shell/bash hooks can
 * read it without needing a JSON or YAML parser.
 */
export function writeBuildStepMarker(root: string, now: Date = new Date()): void {
  const path = markerPath(root);
  mkdirSync(join(root, '.pipeline'), { recursive: true });
  writeFileSync(path, `${now.toISOString()}\n`, 'utf8');
}

/**
 * Remove the build-step-active marker. Idempotent — does nothing (does not
 * throw) if the marker is already absent.
 */
export function removeBuildStepMarker(root: string): void {
  const path = markerPath(root);
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
}

// #505 TS-15: zero-work-product detection. A build step that dispatched
// nothing (or dispatched work that produced no commits) is a kickback
// candidate — the session ran but the plan didn't move. Detection is
// deliberately narrow: it never fires when the halt marker owns the
// situation (remediation's job, not kickback's), and never fires once the
// task list is already complete (a fully-resolved plan with an unchanged
// HEAD is just "nothing left to do", not a zero-work session).

/**
 * Path to the dispatch-count file written by the session PRE hook (Task 13)
 * — one line appended per dispatched "Task: <id>" trailer during the build
 * step. Relative to `root`. Pure function — does not touch the filesystem.
 */
export function dispatchCountPath(root: string): string {
  return join(root, '.pipeline', 'dispatch-count');
}

/**
 * Number of dispatches recorded for the current build step: the count of
 * (non-empty) lines in `.pipeline/dispatch-count`. Returns 0 when the file
 * is absent — "no file" means "nothing was dispatched", the safe default.
 */
export async function readDispatchCount(root: string): Promise<number> {
  let raw: string;
  try {
    raw = await readFile(dispatchCountPath(root), 'utf8');
  } catch {
    return 0;
  }
  return raw.split('\n').filter((line) => line.trim().length > 0).length;
}

/**
 * Parsed breakdown of `.pipeline/dispatch-count`: how many recorded
 * dispatches carried a real task id ("Task: <id>") versus were unattributed
 * ("Task: none"), plus the attributed task ids in file order. Malformed
 * lines (matching neither form) are ignored — not counted in either bucket,
 * never thrown on. Absent/empty file yields all zeros / an empty array.
 */
export interface DispatchAttribution {
  attributed: number;
  unattributed: number;
  taskIds: string[];
}

export async function readDispatchAttribution(root: string): Promise<DispatchAttribution> {
  let raw: string;
  try {
    raw = await readFile(dispatchCountPath(root), 'utf8');
  } catch {
    return { attributed: 0, unattributed: 0, taskIds: [] };
  }
  let attributed = 0;
  let unattributed = 0;
  const taskIds: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const match = trimmed.match(/^Task:\s*(.+)$/);
    if (!match) continue;
    const value = match[1].trim();
    if (value === 'none') {
      unattributed++;
    } else if (value.length > 0) {
      attributed++;
      taskIds.push(value);
    }
  }
  return { attributed, unattributed, taskIds };
}

/**
 * Whether every task in `.pipeline/task-status.json` is `completed` or
 * `skipped`. Requires at least one task — an absent/empty/unparseable
 * status file is treated as "not complete" (the conservative default: we
 * don't know the plan is done, so don't suppress detection on that basis
 * alone).
 */
export async function areAllTasksComplete(root: string): Promise<boolean> {
  const statusPath = join(root, '.pipeline', 'task-status.json');
  let raw: string;
  try {
    raw = await readFile(statusPath, 'utf8');
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  const tasks = normalizeTasks(parsed);
  if (tasks.length === 0) return false;
  return tasks.every((t) => t.status === 'completed' || t.status === 'skipped');
}

export interface ZeroWorkDetectionParams {
  projectRoot: string;
  config: HarnessConfig;
  /** HEAD sha captured at build-step entry. */
  headBefore: string | null;
  /** HEAD sha captured at build-step exit. */
  headAfter: string | null;
  now?: Date;
}

/**
 * Detect a zero-work-product build session: the step ran, but either
 * nothing was dispatched or dispatched work produced no new commits. Order
 * of checks matters — enforcement gate first (cheapest, config-only), then
 * halt marker (remediation owns halted sessions), then task completion
 * (a fully-resolved plan is never "zero work", regardless of HEAD/dispatch
 * counts), and only then the actual zero-work condition.
 */
export async function detectZeroWorkProduct(_params: ZeroWorkDetectionParams): Promise<boolean> {
  // Task 14 (#773): zero-work-product detection is demoted from a gate to
  // telemetry — it must never trigger a build-step kickback/retry,
  // regardless of `attribution_enforcement_cutover` config state. Pinned to
  // `false` unconditionally rather than deleted, so callers (conductor.ts)
  // keep a stable, typed call site if/when this becomes real telemetry.
  return false;
}

// Task 3 (#671): unattributed-dispatch detection. Distinct from
// detectZeroWorkProduct — this fires earlier, at the build dispatch seam
// itself, on the raw attributed/unattributed split rather than on
// HEAD-movement/dispatch-count. A count-based threshold (not a ratio) so a
// mixed cycle that still crosses the streak threshold is caught even when
// it isn't 100% unattributed.

export interface UnattributedDispatchResult {
  triggered: true;
  reason: 'unattributed_dispatch';
  unattributedCount: number;
}

/**
 * Detect an unattributed-dispatch streak within a single build cycle's
 * `DispatchAttribution`. Triggers when `unattributed` is nonzero and meets
 * or exceeds `threshold` (default 3). Returns `null` when quiet (no
 * dispatch activity at all, or below threshold).
 */
export function detectUnattributedDispatch(
  attribution: DispatchAttribution,
  threshold = 3,
): UnattributedDispatchResult | null {
  // Task 14 (#773): this detector only ever drives the loud
  // `unattributed_dispatch` telemetry event (conductor.ts) — it does not
  // gate, kick back, or auto-park anything, so it is unaffected by the
  // enforcement-to-advisory demotion (that demotion targets blocking/
  // parking behavior, e.g. detectZeroWorkProduct below). Detection logic
  // stays live so the streak signal keeps firing.
  const { unattributed } = attribution;
  if (unattributed <= 0) return null;
  if (unattributed < threshold) return null;
  return { triggered: true, reason: 'unattributed_dispatch', unattributedCount: unattributed };
}
