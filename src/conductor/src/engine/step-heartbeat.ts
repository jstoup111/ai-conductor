// step-heartbeat.ts — `.pipeline/step-heartbeat` activity telemetry for a
// running step's provider dispatch.
//
// `daemon.log` only records step start/end, never mid-step activity, so a
// step that is genuinely working and a step that is silently wedged look
// identical from the outside for however long the dispatch runs. This module
// gives the operator (`daemon status`) a real signal: a small JSON file
// touched on every observed provider activity boundary (each streamed
// stdout/stderr chunk from the Claude/Codex subprocess — see `onActivity` on
// `InvokeOptions`).
//
// Heartbeats are cheap, best-effort status telemetry. Their absence or age is
// never process-liveness authority: a provider can be silent while reasoning.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/** Path (relative to a worktree root) of the step-heartbeat liveness file. */
export const STEP_HEARTBEAT_PATH = '.pipeline/step-heartbeat';

export interface StepHeartbeat {
  step: string;
  ts: string;
}

export function stepHeartbeatPath(worktreePath: string): string {
  return join(worktreePath, STEP_HEARTBEAT_PATH);
}

/**
 * Write the heartbeat file immediately (not throttled). Best-effort: a
 * failed write must never affect step dispatch, so all errors are swallowed.
 * Timestamp follows the same pattern every other `.pipeline/*.json` writer in
 * this codebase uses (see `event-persister.ts`'s `events.jsonl` `ts` field) —
 * a bare `new Date().toISOString()`, not a shared helper. That "no bare
 * Date.now()" rule is scoped to Workflow *scripts*, not engine code.
 */
export async function writeStepHeartbeat(worktreePath: string, step: string): Promise<void> {
  const path = stepHeartbeatPath(worktreePath);
  try {
    await mkdir(dirname(path), { recursive: true });
    const record: StepHeartbeat = { step, ts: new Date().toISOString() };
    await writeFile(path, JSON.stringify(record), 'utf-8');
  } catch {
    // Heartbeat visibility must never affect step execution.
  }
}

/** Read and parse the heartbeat file. Returns null when absent or malformed. */
export async function readStepHeartbeat(worktreePath: string): Promise<StepHeartbeat | null> {
  try {
    const raw = await readFile(stepHeartbeatPath(worktreePath), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.step === 'string' && typeof parsed.ts === 'string') {
      return { step: parsed.step, ts: parsed.ts };
    }
    return null;
  } catch {
    return null;
  }
}

/** Default minimum gap between heartbeat writes triggered by activity pulses. */
export const DEFAULT_HEARTBEAT_MIN_INTERVAL_MS = 5_000;

/**
 * Create a throttled activity pulse for one step's provider dispatch. Call
 * the returned function on every observed activity boundary; it writes the
 * heartbeat file at most once per `minIntervalMs`, fire-and-forget, so a
 * fast-streaming provider never turns the heartbeat into a per-token fsync.
 */
export function createHeartbeatPulse(
  worktreePath: string,
  step: string,
  minIntervalMs: number = DEFAULT_HEARTBEAT_MIN_INTERVAL_MS,
): () => void {
  let lastWriteMs = 0;
  let inFlight = false;
  return () => {
    const now = Date.now();
    if (inFlight || now - lastWriteMs < minIntervalMs) return;
    lastWriteMs = now;
    inFlight = true;
    void writeStepHeartbeat(worktreePath, step).finally(() => {
      inFlight = false;
    });
  };
}

// ── Age classification (pure — used by status rendering) ────────────────────

export type HeartbeatAgeStatus =
  | { kind: 'none' }
  | { kind: 'fresh'; ageMs: number }
  | { kind: 'stale'; ageMs: number };

/**
 * Classify a heartbeat's age relative to `now`. `null` (no heartbeat file
 * yet, e.g. a step that just started) is reported as `{ kind: 'none' }` —
 * distinct from `stale`, so a fresh dispatch is never misread as hung. A
 * heartbeat is `stale` once its age exceeds `staleAfterMs`.
 */
export function classifyHeartbeatAge(
  heartbeat: StepHeartbeat | null,
  now: number,
  staleAfterMs: number,
): HeartbeatAgeStatus {
  if (!heartbeat) return { kind: 'none' };
  const ts = Date.parse(heartbeat.ts);
  if (!Number.isFinite(ts)) return { kind: 'none' };
  const ageMs = Math.max(0, now - ts);
  return ageMs > staleAfterMs ? { kind: 'stale', ageMs } : { kind: 'fresh', ageMs };
}

/**
 * True when a heartbeat file's contents were produced by the dispatch that is
 * currently running — i.e. it names the same step AND was stamped at or after
 * that dispatch started.
 *
 * `.pipeline/step-heartbeat` is a single per-worktree file that is overwritten,
 * never cleared: after a step finishes, its last pulse stays on disk for the
 * lifetime of the worktree. A later dispatch (a different step, or the same
 * step re-kicked hours later) therefore starts life next to a heartbeat that is
 * arbitrarily old and belongs to nobody. Reading that as "this step has been
 * silent for 3.5 hours" is what killed a freshly-started
 * `architecture_review_as_built` 31 seconds — one poll tick — after it started.
 *
 * A leftover heartbeat carries no information about the current dispatch, so it
 * is treated exactly like "no heartbeat yet": never evidence of a stall.
 */
export function heartbeatBelongsToDispatch(
  heartbeat: StepHeartbeat | null,
  step: string,
  dispatchStartedAtMs: number,
): boolean {
  if (!heartbeat || heartbeat.step !== step) return false;
  const ts = Date.parse(heartbeat.ts);
  return Number.isFinite(ts) && ts >= dispatchStartedAtMs;
}

/** Render a millisecond age as a short human string, e.g. "3m12s" or "45s". */
export function formatHeartbeatAge(ageMs: number): string {
  const totalSeconds = Math.floor(ageMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`;
}
