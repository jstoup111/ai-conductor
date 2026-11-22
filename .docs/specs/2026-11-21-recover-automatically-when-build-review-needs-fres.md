# Recover missing or stale test proof before build review

**Date:** 2026-11-21  
**Status:** Approved

## Problem / Background

When build review discovers that it needs fresh test results, the daemon can halt and ask the operator to rerun the suite. The operator wants the daemon to detect the problem before dispatching review and recover even if the proof becomes stale after that check. The frequency of this halt after the earlier preservation fix is unknown.

## Goals & Non-Goals

**Goal.** Reach a review verdict without operator intervention when rerunning the suite supplies the required proof.

**Non-goals.** General retry policy for other gates and changes to what counts as passing the suite are outside this feature.

## Users / Personas

A daemon operator wants recoverable proof problems handled automatically and a specific explanation when further attempts require intervention.

## Functional Requirements

- **FR-1.** Before dispatching build review, check whether the feature or active stacked child has usable test proof. Apply this on ordinary progression, direct or routed entry, and resume.
- **FR-2.** Allow review to proceed without a suite rerun when proof is current or becomes current under the existing preservation rules.
- **FR-3.** When review needs fresh proof, automatically rerun the suite for the same build context before dispatching review, subject to the feature limit.
- **FR-4.** If proof becomes unusable after the early check, recover under the same rules when review detects it.
- **FR-5.** When the rerun establishes current proof, resume review for the same feature or child so it can reach its verdict.
- **FR-6.** Count each automatic proof-recovery rerun once against one feature-wide allowance of two reruns across both checks, all children, and daemon restarts. Ordinary suite executions do not consume the allowance.
- **FR-7.** If fresh proof is required again after the allowance is spent, halt for operator intervention and identify build review, the test suite, and the actual number of recovery reruns attempted.
- **FR-8.** A suite execution that reports failing tests takes the existing test-failure route immediately.

## Non-Functional Requirements

Resuming an interrupted recovery must preserve the number of attempts already spent. Both checks must judge proof for the same build context.

## Acceptance Criteria / Success Metrics

- A resumed run with stale proof reruns the suite before its first review dispatch and reaches a verdict when the new proof is current.
- A run whose proof changes after the early check recovers at review. A stacked child uses its own test scope at both checks.
- With an allowance of two, two recovery reruns are possible. A restart between them does not reset the allowance. If proof is still unusable, the next request halts before a third rerun and reports two attempts.
- Current or successfully preserved proof causes zero recovery reruns. A failing test observed during recovery reaches the ordinary failure route without waiting for exhaustion.

## Scope

In scope are daemon runs using proof verification and retry routing for build review. Other step pairs and operator-initiated suite runs are outside scope.

## Key Decisions & Rationale

The operator selected early detection plus recovery during review because a change after the first check could otherwise still strand the run. Two attempts permit a second recovery after a late change. A feature-wide limit bounds the total cost even when several children encounter the problem.

## Dependencies

Existing suite verification, proof preservation, and test-failure handling supply the outcomes this feature acts on.

## Open Questions

None.
