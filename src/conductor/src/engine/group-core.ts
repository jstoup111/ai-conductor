/**
 * Concurrent group core — shared types and domain-integrity primitives for
 * the engine's concurrent group executor.
 *
 * See ADRs:
 * - .docs/decisions/adr-2026-07-10-concurrent-group-core.md
 * - .docs/decisions/adr-2026-07-10-validation-group-join.md
 *
 * This module defines the branch-outcome discriminated union, the group
 * member/result shapes, the exhaustive classify helper, the concurrency
 * semaphore, and the per-branch skill executor (`runGroupBranch`). Abort
 * handling (Task 8) is threaded through both `runWithConcurrency` and
 * `runGroupBranch`. Task 9 threads the SERIAL loop's stale-marker sweep
 * (`sweepStaleReviewArtifacts`, artifacts.ts) through per-member, scoped to
 * that member's own step name — so sweeping branch A's leftover marker can
 * never touch branch B's.
 */

import { v4 as uuidv4 } from "uuid";
import type { StepName, ConductState } from "../types/index.js";
import type { StepRunResult, StepRunOptions } from "./conductor.js";
import { sweepStaleReviewArtifacts } from "./artifacts.js";
import type { ConductorEvent } from "../types/events.js";

/** The three possible verdicts a validator branch can produce. */
export type Verdict = "pass" | "fail" | "blocked";

/**
 * A branch reached a verdict (PASS/FAIL/BLOCKED) — the normal, expected
 * terminal state of a validator branch.
 */
export interface VerdictOutcome {
  kind: "verdict";
  verdict: Verdict;
}

/**
 * A branch exhausted its retries without ever producing a verdict — an
 * infra-shaped failure. Per adr-2026-07-10-validation-group-join.md, this
 * is NOT the same thing as a skipped branch: a no-verdict outcome fails the
 * whole group through the normal step-failure path (halt), while a skipped
 * branch is an intentional, expected non-dispatch.
 */
export interface NoVerdictOutcome {
  kind: "no-verdict";
  reason: string;
}

/**
 * A branch was not dispatched at all (member skip rules — tier/track/
 * feature-type/skipWhenSkipped). Distinct from NoVerdictOutcome: skipped is
 * an intentional non-dispatch, no-verdict is a failure after dispatch.
 */
export interface SkippedOutcome {
  kind: "skipped";
}

/**
 * The outcome of a single group branch. A discriminated union — never
 * boolean flags — so that every consumer is forced to handle each case
 * explicitly (see classifyOutcome below for the exhaustiveness contract).
 */
export type BranchOutcome = VerdictOutcome | NoVerdictOutcome | SkippedOutcome;

export function makeVerdictOutcome(verdict: Verdict): VerdictOutcome {
  return { kind: "verdict", verdict };
}

export function makeNoVerdictOutcome(reason: string): NoVerdictOutcome {
  return { kind: "no-verdict", reason };
}

export function makeSkippedOutcome(): SkippedOutcome {
  return { kind: "skipped" };
}

/** A single member of a concurrent group: its name, dispatched skill, and outcome. */
export interface GroupMember {
  name: string;
  skill: string;
  outcome: BranchOutcome;
}

/** The aggregate result of a concurrent group's branches, ready for join. */
export interface GroupResult {
  members: GroupMember[];
}

/**
 * This helper's `never` assignment inside the switch is what forces a
 * compile error if a new BranchOutcome variant is ever added without
 * updating this function — the domain-integrity requirement from
 * adr-2026-07-10-concurrent-group-core.md. There is deliberately NO
 * `default:` branch: a `default:` would silently swallow a missing variant
 * at runtime instead of failing the build.
 */
export function classifyOutcome(outcome: BranchOutcome): string {
  switch (outcome.kind) {
    case "verdict":
      return `verdict:${outcome.verdict}`;
    case "no-verdict":
      return "no-verdict";
    case "skipped":
      return "skipped";
  }
  return assertNever(outcome);
}

function assertNever(x: never): never {
  throw new Error(`group-core: unhandled BranchOutcome kind: ${JSON.stringify(x)}`);
}

/** The `group_member_step` variant of `ConductorEvent` (Task 25). */
export type GroupMemberStepEvent = Extract<ConductorEvent, { type: "group_member_step" }>;

/** The `parallel_started` variant of `ConductorEvent`. */
export type ParallelStartedEvent = Extract<ConductorEvent, { type: "parallel_started" }>;

/** The `parallel_failure` variant of `ConductorEvent`. */
export type ParallelFailureEvent = Extract<ConductorEvent, { type: "parallel_failure" }>;

/**
 * Builds the `parallel_started` event payload from a group's FULL member
 * list (including any `SkippedOutcome` phantom members that were never
 * dispatched). Only members that were actually dispatched — i.e. every
 * outcome kind OTHER than `skipped` — appear in `branches`, so a phantom
 * member (skipped by tier/track/feature-type/skipWhenSkipped) never shows
 * up in the event stream as if it had run (adr-2026-07-10-validation-group-
 * join.md; Task 15 membership resolution). Callers that already filter to a
 * dispatchable-only list before calling this (e.g. conductor.ts's built-in
 * group join) get an identical result either way, since skipped members are
 * filtered here regardless.
 */
export function buildParallelStartedEvent(
  step: StepName,
  members: GroupMember[],
): ParallelStartedEvent {
  return {
    type: "parallel_started",
    step,
    branches: members.filter((m) => m.outcome.kind !== "skipped").map((m) => m.name),
  };
}

/**
 * Builds one `parallel_failure` event per member whose outcome is NOT a
 * passing verdict — `no-verdict` (infra/dispatch failure) or `verdict:fail`/
 * `verdict:blocked` (a real, content-level validator failure) — each event
 * naming that specific member (`branch`), so a mixed-outcome join (some
 * members pass, one or more fail) attributes the failure to the RIGHT
 * validator instead of a single ambiguous group-level failure. Skipped
 * members never produce a `parallel_failure` — they were never dispatched,
 * so there is nothing to attribute a failure to.
 */
export function buildParallelFailureEvents(
  step: StepName,
  members: GroupMember[],
): ParallelFailureEvent[] {
  const events: ParallelFailureEvent[] = [];
  for (const member of members) {
    const { outcome } = member;
    if (outcome.kind === "skipped") continue;
    if (outcome.kind === "verdict" && outcome.verdict === "pass") continue;

    const error =
      outcome.kind === "no-verdict" ? outcome.reason : `branch ${member.name} failed: ${classifyOutcome(outcome)}`;
    events.push({ type: "parallel_failure", step, branch: member.name, error });
  }
  return events;
}

/**
 * Runs a set of async thunks with concurrency capped at `limit` (a small
 * promise-based semaphore, no external deps). Results are returned in the
 * same order as the input thunks, regardless of completion order. A cap of
 * 1 yields strictly sequential execution — the mechanism validation-group
 * fan-out relies on for `validation_concurrency: 1`.
 *
 * If any thunk rejects, the returned promise rejects with that error (the
 * first rejection observed); other in-flight thunks are not cancelled, but
 * no further thunks past those already started/queued are newly launched
 * once rejection has been recorded for the caller's promise chain.
 */
/**
 * Runs `thunks` with concurrency capped at `limit`. When `signal` is
 * provided and aborts mid-run, no NEW thunks are launched, but thunks
 * already in flight are allowed to settle on their own (they are expected
 * to observe the same signal internally — e.g. `runGroupBranch` — and
 * unwind quickly). Once all in-flight thunks have settled after an abort,
 * the promise RESOLVES (never rejects) with only the outcomes that
 * actually completed, in original input order — completed work is never
 * thrown away, letting the caller persist synthetic keys for whatever
 * finished before the abort. Branches that never started, or were
 * in-flight but didn't complete before abort, are simply absent from the
 * result array (there is no outcome to report for them).
 */
export function runWithConcurrency<T>(
  thunks: Array<() => Promise<T>>,
  limit: number,
  signal?: AbortSignal,
): Promise<T[]> {
  if (limit < 1) {
    throw new Error(`group-core: runWithConcurrency limit must be >= 1, got ${limit}`);
  }

  return new Promise<T[]>((resolve, reject) => {
    const results: Array<T | undefined> = new Array(thunks.length);
    let nextIndex = 0;
    let inFlight = 0;
    let completed = 0;
    let settled = false;
    let aborted = signal?.aborted ?? false;

    const finishOnAbort = () => {
      if (settled || !aborted || inFlight > 0) return;
      settled = true;
      resolve(results.filter((v): v is T => v !== undefined));
    };

    if (thunks.length === 0) {
      resolve([]);
      return;
    }

    if (signal && !aborted) {
      signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          finishOnAbort();
        },
        { once: true },
      );
    }

    const launchNext = () => {
      if (settled) return;
      if (aborted) return;
      if (nextIndex >= thunks.length) return;

      const index = nextIndex;
      nextIndex += 1;
      inFlight += 1;

      thunks[index]!()
        .then((value) => {
          results[index] = value;
          completed += 1;
          inFlight -= 1;
          if (aborted) {
            finishOnAbort();
            return;
          }
          if (completed === thunks.length) {
            settled = true;
            resolve(results.filter((v): v is T => v !== undefined));
            return;
          }
          launchNext();
        })
        .catch((err) => {
          inFlight -= 1;
          if (aborted) {
            finishOnAbort();
            return;
          }
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    };

    for (let i = 0; i < limit && i < thunks.length; i += 1) {
      launchNext();
    }

    // Signal was already aborted before any thunk had a chance to launch.
    finishOnAbort();
  });
}

/**
 * The narrow slice of `StepRunner` the branch executor needs — dependency
 * injected so group-core has no runtime import of the concrete
 * DefaultStepRunner (mirrors the mock-StepRunner seam used throughout
 * conductor.test.ts).
 */
export interface BranchStepRunner {
  run(step: StepName, state: ConductState, opts?: StepRunOptions): Promise<StepRunResult>;
}

/**
 * The narrow slice of `RateLimitEpisode` the branch executor needs — passed
 * in (dependency-injected) rather than owned by the branch, so multiple
 * concurrent branches hitting rate limits share ONE episode instance, with
 * the later deadline winning (episode extension). Mirrors the semantics of
 * the SERIAL loop's rate-limit handling in conductor.ts:1717-1755.
 */
export interface BranchRateLimitEpisode {
  enter(untilMs: number): void;
  clear(signal?: AbortSignal): Promise<void>;
}

export interface BranchExecutorDeps {
  stepRunner: BranchStepRunner;
  /** Test seam: override session-id minting instead of importing uuid. */
  mintSessionId?: () => string;
  /**
   * Shared rate-limit episode coordinator (Task 6). When a branch's step
   * result is `rateLimited`, the branch calls `enter(deadline)` on this
   * shared episode and awaits `clear()` before retrying — WITHOUT burning
   * the branch's own retry budget, mirroring conductor.ts's SERIAL loop.
   * Optional: when absent, the branch retries immediately without waiting
   * (still without burning budget).
   */
  rateLimitEpisode?: BranchRateLimitEpisode;
  /**
   * Task 8: abort signal threaded through the branch's rate-limit episode
   * wait (`rateLimitEpisode.clear(signal)`) and checked before every
   * dispatch. When aborted, the branch exits cleanly — no unhandled
   * rejection, no further `stepRunner.run` calls — and returns a
   * `no-verdict` outcome with reason "aborted" so the caller still has a
   * recorded outcome to persist a synthetic key for.
   */
  signal?: AbortSignal;
  /**
   * Task 9: project root used to scope the stale-marker sweep
   * (`sweepStaleReviewArtifacts`) to THIS member's own step name before its
   * first dispatch. Optional: when absent, no sweep is performed (matches
   * the SERIAL loop's fail-open default for steps outside STALE_SWEEP_STEPS
   * / missing session timestamps).
   */
  projectRoot?: string;
  /**
   * Task 9: session start timestamp passed through to
   * `sweepStaleReviewArtifacts` — an artifact older than this predates the
   * current session and is swept; a fresher one (e.g. another member's
   * own in-session marker) is left untouched. Mirrors the SERIAL loop's
   * `state.session_started_at` (conductor.ts:1577-1590).
   */
  sessionStartedAt?: number;
  /**
   * Task 25: per-branch step-event attribution. Invoked once with
   * `phase: 'dispatch'` immediately before each `stepRunner.run` call, and
   * once with `phase: 'result'` (carrying the classified outcome) right
   * before `runGroupBranch` returns — always attributed to THIS member
   * (`member.name`/`member.skill`), never the group's own name, so an
   * observer watching the event stream can tell which validator branch a
   * given dispatch/outcome belongs to even when several members share a
   * concurrent join round. Optional: when absent, no event is emitted —
   * existing callers that don't pass it see no behavior change.
   */
  onMemberEvent?: (event: GroupMemberStepEvent) => void | Promise<void>;
}

/**
 * Runs a single concurrent-group branch to completion: mints its own fresh
 * session id (never the shared main-conductor session — adr-2026-07-10-
 * concurrent-group-core.md), dispatches the member's OWN step/skill name
 * (not the group name — the bug the ADR calls out), and retries up to
 * `maxRetries` times, resuming the SAME minted session id on every retry
 * (only the first attempt uses `resume: false`).
 *
 * Returns a `BranchOutcome`: `verdict:pass` on the first successful
 * dispatch, or `no-verdict` (carrying the last failure's output) once
 * `maxRetries` is exhausted without success. Rate-limit/authFailure/
 * sessionExpired handling and verdict parsing beyond pass/fail are out of
 * scope for this task (Tasks 6-7).
 */
export async function runGroupBranch(
  member: GroupMember,
  state: ConductState,
  deps: BranchExecutorDeps,
  maxRetries: number,
): Promise<BranchOutcome> {
  const outcome = await runGroupBranchInner(member, state, deps, maxRetries);
  // Task 25: emit the member-attributed result event AFTER the outcome is
  // known, regardless of which of the inner function's several return
  // points produced it — a single exit point for event emission so every
  // outcome (pass, no-verdict/aborted/authFailure, retries exhausted) is
  // reported exactly once, attributed to THIS member.
  await deps.onMemberEvent?.({
    type: "group_member_step",
    member: member.name,
    skill: member.skill,
    phase: "result",
    outcome: classifyOutcome(outcome),
  });
  return outcome;
}

async function runGroupBranchInner(
  member: GroupMember,
  state: ConductState,
  deps: BranchExecutorDeps,
  maxRetries: number,
): Promise<BranchOutcome> {
  const mintSessionId = deps.mintSessionId ?? uuidv4;
  let sessionId = mintSessionId();

  // Task 9: sweep THIS member's own stale marker (if any) before its first
  // dispatch — scoped to member.name so branch A's leftover marker can
  // never touch branch B's. No-op when projectRoot is not provided, or when
  // the member's step is outside STALE_SWEEP_STEPS / the artifact is fresh
  // (see sweepStaleReviewArtifacts, artifacts.ts).
  if (deps.projectRoot !== undefined) {
    await sweepStaleReviewArtifacts(deps.projectRoot, member.name as StepName, deps.sessionStartedAt);
  }

  let lastOutput = "";
  let hasRun = false;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    // Task 8: check before every dispatch — an abort observed while queued
    // behind the semaphore, or between retries, must stop the branch from
    // issuing another stepRunner.run() call.
    if (deps.signal?.aborted) {
      return makeNoVerdictOutcome("aborted");
    }

    // `resume` is true once this branch's session has ever been dispatched
    // before — including a prior rate-limited/sessionExpired cycle, which
    // still consumed the fresh (attempt 1) session slot but must not burn
    // retry budget. A sessionExpired reset re-arms this to false below.
    const resume = hasRun;
    await deps.onMemberEvent?.({
      type: "group_member_step",
      member: member.name,
      skill: member.skill,
      phase: "dispatch",
    });
    const result = await deps.stepRunner.run(member.name as StepName, state, {
      sessionId,
      resume,
    });
    hasRun = true;

    if (result.success) {
      return makeVerdictOutcome("pass");
    }

    // Rate limit: enter the shared episode with the parsed deadline (or a
    // default backoff window), await clear(), then retry WITHOUT burning
    // the branch's retry budget — mirrors conductor.ts:1717-1755.
    if (result.rateLimited) {
      const deadline = result.deadline ?? Date.now() + (result.waitSeconds ?? 300) * 1000;

      if (deps.rateLimitEpisode) {
        deps.rateLimitEpisode.enter(deadline);
        await deps.rateLimitEpisode.clear(deps.signal);
      }

      // The episode wait may have resolved BECAUSE the signal aborted
      // (not because the rate limit actually cleared) — exit cleanly with
      // a recorded outcome instead of looping back into another dispatch.
      if (deps.signal?.aborted) {
        return makeNoVerdictOutcome("aborted");
      }

      attempt -= 1;
      continue;
    }

    // Stale session: mint a fresh session id and retry WITHOUT burning the
    // retry budget — mirrors conductor.ts:1757-1769 (resets to a fresh
    // session, not a resume of the expired one).
    if (result.sessionExpired) {
      sessionId = mintSessionId();
      hasRun = false;
      attempt -= 1;
      continue;
    }

    // Auth failure: does NOT burn the retry budget (matches the SERIAL
    // loop's park-then-resume semantics, conductor.ts:1771-1775), but this
    // task does not implement park/resume itself — that belongs to the
    // group CORE/join logic (Tasks 17+). Surface immediately as a
    // no-verdict outcome carrying the "authFailure" reason so the core can
    // route it to halt/park handling instead of silently retrying it.
    if (result.authFailure) {
      return makeNoVerdictOutcome("authFailure");
    }

    lastOutput = result.output ?? lastOutput;
  }

  return makeNoVerdictOutcome(lastOutput || "retries exhausted");
}
