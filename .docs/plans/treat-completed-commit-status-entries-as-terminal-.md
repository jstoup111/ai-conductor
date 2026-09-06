# Implementation Plan: Treat completed commit-status entries as terminal for ci-fix eligibility

**Date:** 2026-09-06
**Stories:** .docs/stories/treat-completed-commit-status-entries-as-terminal-.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing eligibility contract — the same non-terminal state vocabulary, the same refusal reason format, the same no-rollup-means-no-block rule, and no change to the attempt cap, cooldown, or serial guard.

## Summary

Three bounded tasks deliver #2164: the terminal-CI eligibility gate learns to read a rollup entry's own reported state, the deferral reason learns to name a commit-status entry by its own identifier, and the real sweep entry point proves the corrected classification reaches CI-fix dispatch. Auto-merge readiness classification over the same rollup shape, the sweep's check-name log field, and any change to how the rollup is fetched are outside this slice.

## Technical Approach

The defect is a single fallback in the CI-fix engine module's exported non-terminal-name helper. It reads only `status` and `conclusion`, and treats an empty conclusion as "the run has not finished". A commit-status rollup entry reports its outcome in `state` and its identity in `context`, and carries no `status`, `conclusion`, or `name` at all, so every such entry is classified non-terminal forever and surfaces under the placeholder label. The eligibility gate then refuses on every tick.

Correct the classification by widening the evidence the helper consults rather than by branching on a GraphQL type discriminator. Uppercase `status`, `conclusion`, and `state`; if any of the three is in the existing non-terminal set, the entry is non-terminal, which preserves today's behavior for queued and running check runs and correctly defers a commit-status entry reporting PENDING or EXPECTED. Otherwise the entry is terminal when it reports a non-empty conclusion or a non-empty state, and non-terminal only when it reports neither — the exact residual case the current empty-conclusion fallback was written for. Branching on the reported state rather than the discriminator keeps the fix correct if the discriminator is absent from the fetched payload and degrades to today's behavior when no state is reported.

Choose the entry's label from `name` first, then `context`, then the existing placeholder, and keep the existing whitespace trim so a blank identifier still falls back rather than producing an empty name. Because a completed entry is no longer collected at all, the placeholder can no longer appear for one.

The rollup element type is declared in the merge-state module (`pr-labels.ts`) and reused by the merge-state result the gate reads. Widen that one element type with optional `state` and `context` fields so fixtures and production code describe the payload the GitHub CLI actually returns; the fetcher already passes the parsed entries through unchanged, so no parsing or fetching change is required. This is a type-only edit with no runtime effect of its own, and it deliberately does not touch the failing-or-pending predicate or the overall-outcome classifier in the same module — those govern auto-merge readiness and are a separate observation.

Follow the module's existing test pattern: the CI-fix engine test file already builds a merge-state fixture from a rollup array and asserts the verdict and the refusal reason of the exported eligibility function, so new classification cases belong there as table-shaped unit cases with no injected process, network, or LLM boundary. The integration home is the existing CI-fix sweep test, which drives the real sweep entry point against a fixture watch registry with an injected command runner whose stdout is a real GitHub CLI JSON payload; extend its payload builder so a rollup entry may carry state and context, and add the two dispatch cases there. Both files already isolate their temporary registry directories and inject every boundary, so no new fixture machinery is needed. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, the state-reading approach over discriminator branching, and both stories on 2026-09-06 (delegated).
- Verified: the exported non-terminal-name helper in `src/conductor/src/engine/ci-fix.ts` uppercases only `status` and `conclusion`, returns true when the uppercased conclusion is empty, and maps each collected entry to a trimmed `name` or the placeholder text.
- Verified: the non-terminal state set in that module already contains PENDING and EXPECTED, so the pending commit-status values need no new vocabulary.
- Verified: the eligibility gate calls that helper, shows at most three collected names, and returns a refusal carrying the checks-not-terminal marker; the refusal is logged once through the single outcome call site.
- Verified: `src/conductor/src/engine/pr-labels.ts` declares the rollup element type as status, conclusion, and name only, fetches the rollup through the GitHub CLI's pull-request view JSON, and assigns the parsed entries onto the merge-state result unchanged.
- Verified: `src/conductor/test/engine/ci-fix.test.ts` already contains a terminal-CI-state gate suite with a rollup-to-merge-state fixture builder and pending, queued, and all-terminal cases.
- Verified: `src/conductor/test/integration/mergeable-sweep-ci-fix.test.ts` drives the real sweep entry point with an injected command runner returning a serialized pull-request view payload, and already asserts both a dispatching and a deferring case against the watch registry.
- Verified: the sweep collects CI-fix candidates only when the overall checks outcome is `failed`, so every fixture in this plan pairs its commit-status entry with a completed failing check run to reach the gate under test.
- Assumption, high confidence: the GitHub CLI's pull-request view rollup returns commit-status entries carrying `state` and `context` and no `status`, `conclusion`, or `name`. This is the observation the source issue reports and the shape the placeholder label already evidences. The approach fails safe either way: an entry reporting no state at all keeps today's non-terminal classification, so a wrong assumption cannot make the gate pass on a genuinely running check.
- Scope check: harness-repo-only daemon machinery; no new skill; provider-agnostic. Event spine: no new event, metric, span, or channel — only the content of an existing eligibility refusal reason changes.
- Verify-claims verdict: CLEAR. No unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Read the entry's reported state when deciding terminality
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/pr-labels.ts, src/conductor/src/engine/ci-fix.ts, src/conductor/test/engine/ci-fix.test.ts
**Dependencies:** none

**Steps:**
1. Extend the existing terminal-CI-state gate suite in the CI-fix engine test file with cases whose rollup pairs a completed failing check run with a commit-status entry reporting SUCCESS, then FAILURE, then ERROR, and assert the eligibility verdict is eligible for each.
2. Add cases for a commit-status entry reporting PENDING and one reporting EXPECTED, asserting the refusal carries the checks-not-terminal marker, and a case for a check-run entry reporting neither a conclusion nor a state, asserting the same refusal.
3. Establish RED, then widen the classification: uppercase status, conclusion, and reported state; treat the entry as non-terminal when any of the three is in the existing non-terminal set; otherwise treat it as terminal when it reports a non-empty conclusion or a non-empty state, and non-terminal only when it reports neither.
4. Widen the rollup element type in the merge-state module with optional reported-state and context fields so the fixtures and the helper describe the fetched payload; change no fetching, parsing, or predicate behavior in that module.
5. Run the narrowest test invocation for the CI-fix engine test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. Unit cases return an empty non-terminal list for rollups whose commit-status entries report SUCCESS, FAILURE, or ERROR, and the eligibility verdict for each is eligible.
2. Unit cases collect a commit-status entry reporting PENDING or EXPECTED, and the eligibility verdict for that rollup is the checks-not-terminal refusal.
3. A check-run entry reporting neither a conclusion nor a state remains in the non-terminal list, and every pre-existing case in the terminal-CI-state gate suite still passes unchanged.
4. The shared rollup element type declares the reported state and context fields as optional, and the repository typecheck target that covers test files passes.

### Task 2: Label a pending entry by its own identifier
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/ci-fix.ts, src/conductor/test/engine/ci-fix.test.ts
**Dependencies:** 1

**Steps:**
1. Add cases to the same suite for a pending entry that reports a context and no name, a pending entry that reports no identifier at all, and a pending entry whose identifier is only whitespace, asserting the refusal reason text in each.
2. Add a case whose rollup entries have all reached a completed state, asserting the verdict is eligible and that the injected logger captured no deferral line.
3. Establish RED, then choose the collected entry's label from the trimmed name, then the trimmed context, then the existing placeholder text, leaving the existing three-name display and overflow suffix untouched.
4. Run the narrowest test invocation for the CI-fix engine test file and the repository typecheck target that covers test files, then commit the focused change.

**Done when:**
1. A pending entry reporting a context and no name is labelled by that context in the checks-not-terminal reason.
2. A pending entry reporting no identifier at all, or a whitespace-only identifier, is labelled by the existing placeholder text.
3. A rollup whose entries have all reached a completed state produces an eligible verdict and no deferral line at all.

### Task 3: Prove the corrected classification reaches CI-fix dispatch
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/integration/mergeable-sweep-ci-fix.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Extend the payload builder in the CI-fix sweep integration test so a rollup entry in the serialized pull-request view JSON may carry a reported state and a context alongside the existing status, conclusion, and name fields.
2. Add a case whose payload pairs a completed failing check run with a completed commit-status entry, driving the real sweep entry point once and asserting one dispatch and the recorded attempt in the persisted watch registry.
3. Add a case whose payload pairs the same failing check run with a pending commit-status entry, asserting no dispatch and an unchanged recorded attempt count.
4. Keep every boundary injected as the file already does — the command runner is the only external seam, no process is launched, and no network or third-party service is contacted.
5. Run the narrowest test invocation for that integration file, then run it together with the CI-fix engine test file, and commit the focused change.

**Done when:**
1. A sweep fixture whose injected command runner returns a rollup mixing a completed commit-status entry with a failed check run dispatches CI-fix once and records the attempt in the watch registry.
2. A sweep fixture whose rollup carries a pending commit-status entry alongside a failed check run dispatches nothing and leaves the recorded attempt count unchanged.
3. Both sweep fixtures drive the real sweep entry point with no process launch, network call, or third-party service contacted.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a pull request rollup carrying a completed commit-status entry reporting SUCCESS alongside a completed failing check run, when CI-fix eligibility is evaluated, then the terminal-CI gate passes and the pull request is eligible. | 1 | "return an empty non-terminal list for rollups whose commit-status entries report SUCCESS, FAILURE, or ERROR" | diff-local |
| Story 1 happy: Given a rollup carrying a completed commit-status entry reporting FAILURE or ERROR alongside a completed check run, when CI-fix eligibility is evaluated, then the terminal-CI gate passes and the pull request is eligible. | 1 | "return an empty non-terminal list for rollups whose commit-status entries report SUCCESS, FAILURE, or ERROR" | diff-local |
| Story 1 happy: Given a sweep observes a pull request whose fetched rollup mixes a completed commit-status entry with a failed check run, when the sweep runs one tick, then it dispatches CI-fix for that pull request and records the attempt. | 3 | "dispatches CI-fix once and records the attempt in the watch registry" | diff-local |
| Story 1 negative: Given a rollup carrying a commit-status entry reporting PENDING alongside a completed failing check run, when CI-fix eligibility is evaluated, then the pull request is ineligible for the checks-not-terminal reason and no attempt is recorded. | 1 | "the eligibility verdict for that rollup is the checks-not-terminal refusal" | diff-local |
| Story 1 negative: Given a rollup carrying a check-run entry with no reported conclusion and no reported state, when CI-fix eligibility is evaluated, then the pull request stays ineligible for the checks-not-terminal reason exactly as before this change. | 1 | "A check-run entry reporting neither a conclusion nor a state remains in the non-terminal list" | diff-local |
| Story 1 negative: Given a sweep observes a pull request whose fetched rollup carries a pending commit-status entry alongside a failed check run, when the sweep runs one tick, then it dispatches nothing and leaves the recorded attempt count unchanged. | 3 | "dispatches nothing and leaves the recorded attempt count unchanged" | diff-local |
| Story 2 happy: Given a pending rollup entry that reports an identifying context but no check-run name, when the deferral reason is produced, then the reason contains that context. | 2 | "is labelled by that context in the checks-not-terminal reason" | diff-local |
| Story 2 happy: Given every entry in a rollup has reached a completed state, when eligibility is evaluated, then the deferral reason is not produced at all and no placeholder label reaches the log. | 2 | "produces an eligible verdict and no deferral line at all" | diff-local |
| Story 2 negative: Given a pending rollup entry that reports neither a name nor a context, when the deferral reason is produced, then the reason falls back to the existing placeholder label rather than an empty or malformed entry name. | 2 | "is labelled by the existing placeholder text" | diff-local |
| Story 2 negative: Given a pending rollup entry whose name or context is only whitespace, when the deferral reason is produced, then the reason falls back to the existing placeholder label rather than a blank entry name. | 2 | "is labelled by the existing placeholder text" | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided by a pure classification over a fixture payload constructed inside the changed diff, so no commit outside this feature can change whether it holds. Task 1 owns the unit-level classification cases and the type widening; Task 2 owns the unit-level labelling and no-deferral cases at the same seam. Task 3 owns the single cross-boundary integration proof — that the corrected classification is actually reached from the sweep's fetched pull-request payload through to CI-fix dispatch and the persisted attempt record — because a unit test of the helper proves the helper works, not that the sweep reaches it. No third-party service, process launch, or network call appears in any of the three tasks; the injected command runner is the only external seam and it returns fixture JSON. No aggregate or terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
