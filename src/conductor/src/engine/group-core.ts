/**
 * Concurrent group core — shared types and domain-integrity primitives for
 * the engine's concurrent group executor.
 *
 * See ADRs:
 * - .docs/decisions/adr-2026-07-10-concurrent-group-core.md
 * - .docs/decisions/adr-2026-07-10-validation-group-join.md
 *
 * This module ONLY defines the branch-outcome discriminated union and the
 * group member/result shapes, plus an exhaustive classify helper. It does
 * NOT implement the semaphore, branch executor, or join/dispatch logic
 * (those live in later tasks).
 */

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
