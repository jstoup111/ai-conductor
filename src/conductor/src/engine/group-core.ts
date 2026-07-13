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
 * semaphore, and the per-branch skill executor (`runGroupBranch`). It does
 * NOT yet implement rate-limit episode pass-through, authFailure/
 * sessionExpired parity, abort handling, or the stale-marker sweep — those
 * are later tasks (6-9).
 */

import { v4 as uuidv4 } from "uuid";
import type { StepName, ConductState } from "../types/index.js";
import type { StepRunResult, StepRunOptions } from "./conductor.js";

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
export function runWithConcurrency<T>(
  thunks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  if (limit < 1) {
    throw new Error(`group-core: runWithConcurrency limit must be >= 1, got ${limit}`);
  }

  return new Promise<T[]>((resolve, reject) => {
    const results: T[] = new Array(thunks.length);
    let nextIndex = 0;
    let inFlight = 0;
    let completed = 0;
    let settled = false;

    if (thunks.length === 0) {
      resolve(results);
      return;
    }

    const launchNext = () => {
      if (settled) return;
      if (nextIndex >= thunks.length) return;

      const index = nextIndex;
      nextIndex += 1;
      inFlight += 1;

      thunks[index]!()
        .then((value) => {
          results[index] = value;
          completed += 1;
          inFlight -= 1;
          if (completed === thunks.length) {
            settled = true;
            resolve(results);
            return;
          }
          launchNext();
        })
        .catch((err) => {
          inFlight -= 1;
          if (!settled) {
            settled = true;
            reject(err);
          }
        });
    };

    for (let i = 0; i < limit && i < thunks.length; i += 1) {
      launchNext();
    }
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

export interface BranchExecutorDeps {
  stepRunner: BranchStepRunner;
  /** Test seam: override session-id minting instead of importing uuid. */
  mintSessionId?: () => string;
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
  const mintSessionId = deps.mintSessionId ?? uuidv4;
  const sessionId = mintSessionId();

  let lastOutput = "";
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const resume = attempt > 1;
    const result = await deps.stepRunner.run(member.name as StepName, state, {
      sessionId,
      resume,
    });

    if (result.success) {
      return makeVerdictOutcome("pass");
    }
    lastOutput = result.output ?? lastOutput;
  }

  return makeNoVerdictOutcome(lastOutput || "retries exhausted");
}
