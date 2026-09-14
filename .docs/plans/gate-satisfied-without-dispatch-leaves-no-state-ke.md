# Implementation Plan: Gate satisfied without dispatch leaves no state key, so FINISH invalidates forever

**Date:** 2026-09-14
**Stories:** .docs/stories/gate-satisfied-without-dispatch-leaves-no-state-ke.md
**Track:** technical
**Complexity:** M
**Conflict check:** Clean as of 2026-09-14 — see .docs/conflicts/gate-satisfied-without-dispatch-leaves-no-state-ke.md

## Summary

Seven bounded tasks redirect FINISH's implementation-evidence observation from raw step-state keys
to the loop's own gate-satisfaction authority, and carry the unsatisfied member out to the operator
as a typed field rather than a fixed sentence.

## Technical Approach

Two edits, in dependency order.

**First, the observation.** `observeImplementationEvidence` in
`src/conductor/src/engine/finish-publication-production.ts` currently answers from step state alone
via `stepDone(state, 'build_review') && stepDone(state, 'test_suite')`. It becomes a call to the
selector's exported `gateSatisfied(step, state, verdicts)` for each member, with `verdicts` obtained
from `readAllVerdicts` over the project root. This introduces no new predicate — approved decision
adr-2026-07-11-verdict-aware-resume-entry D5 requires that consumers call the same `gateSatisfied`
the selector uses, and this brings the last state-only consumer into that rule. `gateSatisfied`
already encodes the three behaviors the negative-path stories require: a `stale` step is
unsatisfied regardless of its verdict, a present verdict is authoritative, and an absent verdict
falls back to `done`/`skipped` step state.

**Second, the diagnostic.** The observation stops returning a bare `'present' | 'missing'` for this
member pair and instead reports which members were unsatisfied. That set travels as a typed field on
the `implementation_evidence_invalid` condition and on the `implementation_invalid` result in
`src/conductor/src/engine/finish-publication.ts`, then into the `retry_build` branch in
`src/conductor/src/engine/conductor.ts`, which already composes the kickback evidence and the
`build` retry hint. No consumer may derive the member by matching reason text — approved decisions
adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane D1 and adr-2026-09-05 D5 forbid it, and
adr-2026-08-19-unretryable-step-runner-failures-route-by-kind D1-D3 is the affirmative authority for
routing on a typed kind.

**Sequencing.** Task 1 changes the observation's satisfaction source and must land before the
negative-path tasks that exercise it. Task 5 widens the carried type and must land before Task 6
wires it to the operator-visible strings. Tasks 2, 3 and 4 are independent of each other once Task 1
is in, and Tasks 6 and 7 are independent of each other once Task 5 is in.

### Focused pattern context

The resume clamp in `src/conductor/src/engine/conductor.ts` is the local precedent for this read.
Traits to preserve: read all verdicts once per entry rather than per gate; pass the resulting map
into `gateSatisfied` alongside state rather than consulting either store alone; treat an unreadable
verdict directory as "no verdicts" and continue, never as an exception that escapes. It applies
because the observer asks the same question at a different entry point, and D5 requires the two
entry points not diverge. Allowed variation: where the read sits in the production wiring, and
whether the map is built eagerly at observer construction or lazily inside the closure. Search
hints: `src/conductor/src/engine/conductor.ts`, the `readAllVerdicts` call inside the `this.resume`
branch; `src/conductor/src/engine/selector.ts`, exported symbol `gateSatisfied`;
`src/conductor/src/engine/gate-verdicts.ts`, exported symbols `readAllVerdicts` and `readVerdict`.

## Prerequisites

None. `gateSatisfied`, `readAllVerdicts` and `readVerdict` are already exported and already consumed
in production by the resume clamp and the gate-driven tail.

## Tasks

### Task 1: Answer implementation evidence from the gate-satisfaction authority
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/finish-publication-production.test.ts`: build a project root whose `.pipeline/gates/build_review.json` and `.pipeline/gates/test_suite.json` both carry `satisfied: true`, and whose state carries neither a `build_review` nor a `test_suite` key; assert the observation reports evidence present.
2. Add a second case in the same test: both verdicts satisfied and both step statuses `done`; assert evidence present (parity with today).
3. Add a third case: a member whose verdict was written by `recordSkipVerdict`; assert it counts as satisfied.
4. Verify the tests fail (RED) against the current `stepDone`-only implementation.
5. Implement: in `finish-publication-production.ts`, obtain verdicts via `readAllVerdicts` over the project root and answer each member through the selector's exported `gateSatisfied(step, state, verdicts)`. Follow the resume-clamp traits from Technical Approach — one read per entry, map passed in alongside state, no per-gate read.
6. Verify the tests pass (GREEN).
7. Commit with message: "fix(finish): judge implementation evidence by gate verdict, not step state"

**Done when:**
- The observation returns evidence present for a fixture whose `build_review` and `test_suite` verdicts are satisfied and whose state carries neither key, asserted by the no-state-key test.
- The observation returns evidence present for a fixture whose verdicts are satisfied and whose step statuses are `done`, preserving today's behavior on the ordinary path.
- The observation counts a member resolved by a skip verdict as satisfied, asserted by the skip-verdict test.
- The observation reaches its per-member answer by calling the selector's exported `gateSatisfied` rather than a satisfaction rule defined inside the finish-publication modules, asserted by a test that substitutes that export and observes the call.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication-production.ts` — replace the `stepDone` pair with a verdict-fed `gateSatisfied` call per member
- `src/conductor/test/engine/finish-publication-production.test.ts` — the three happy-path cases and the substitution assertion

**Dependencies:** none

### Task 2: Refuse an unsatisfied or unrecorded member
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture whose `build_review` verdict carries `satisfied: false`; assert the observation reports evidence missing, with the `build_review` step key both absent and set to `done`.
2. Write a second failing test: a fixture whose `test_suite` has neither a verdict file nor a step-status key; assert evidence missing.
3. Verify both fail (RED) where the fixture's state alone would have satisfied the old predicate.
4. Implement: no new code is expected beyond Task 1 — `gateSatisfied` already returns false for a false verdict and for an absent verdict with absent state. Adjust only if the tests prove otherwise.
5. Verify the tests pass (GREEN).
6. Commit with message: "test(finish): refuse implementation evidence on an unsatisfied or unrecorded gate"

**Done when:**
- A fixture whose `build_review` verdict carries a false satisfied flag reports evidence missing, and does so identically whether its step key is absent or `done`, proving the verdict outranks the state key.
- A fixture whose `test_suite` has neither verdict nor step key reports evidence missing rather than defaulting to satisfied.

**Files likely touched:**
- `src/conductor/test/engine/finish-publication-production.test.ts` — the two refusal cases
- `src/conductor/src/engine/finish-publication-production.ts` — only if the tests prove an adjustment is needed

**Dependencies:** Task 1

### Task 3: Let a staled step outrank its own satisfied verdict
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture whose `build_review` verdict carries `satisfied: true` while its step status is `stale`; assert the observation reports evidence missing.
2. Verify the test fails (RED) if the implementation consults the verdict without passing state into `gateSatisfied`.
3. Implement: ensure the state object is passed to `gateSatisfied` so its leading `stale` check applies. This is the guard that stops a superseded verdict from publishing.
4. Verify the test passes (GREEN).
5. Commit with message: "test(finish): a staled gate refuses implementation evidence despite a satisfied verdict"

**Done when:**
- A fixture whose `build_review` step status is `stale` and whose verdict is satisfied reports evidence missing, asserted by the stale-step test.
- The refusal is produced by `gateSatisfied`'s existing `stale` branch receiving the live state, not by a `stale` comparison written into the finish-publication modules.

**Files likely touched:**
- `src/conductor/test/engine/finish-publication-production.test.ts` — the stale-step case
- `src/conductor/src/engine/finish-publication-production.ts` — only if state is not already threaded through

**Dependencies:** Task 1

### Task 4: Degrade to step state when the verdict store cannot be read
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: a fixture with no `.pipeline/gates/` directory at all; assert the observation completes without raising and decides from step status alone.
2. Write a second failing test: a fixture whose `build_review.json` contains unparseable bytes; assert that member is treated as carrying no verdict and, with no step key, reports evidence missing.
3. Verify both fail (RED) if the read is not tolerant.
4. Implement: rely on `readAllVerdicts`'s existing tolerant read — absent directory yields an empty map, malformed content yields no entry for that step. Add no try/catch that converts either case into satisfied.
5. Verify the tests pass (GREEN).
6. Commit with message: "test(finish): an unreadable verdict store degrades to step state, never to satisfied"

**Done when:**
- A fixture with no `.pipeline/gates/` directory completes the observation without raising, and its result is decided by step status alone.
- A fixture whose `build_review.json` is unparseable treats that member as unverdicted and reports evidence missing when no step key is present, proving malformed content never reads as satisfied.

**Files likely touched:**
- `src/conductor/test/engine/finish-publication-production.test.ts` — the absent-directory and malformed-file cases
- `src/conductor/src/engine/finish-publication-production.ts` — only if a non-tolerant read is introduced by Task 1

**Dependencies:** Task 1

### Task 5: Carry the unsatisfied members as a typed field
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/engine/finish-publication.test.ts`: with only `build_review` unsatisfied, assert the blocked preflight condition exposes a typed field naming exactly that member; repeat for `test_suite` only, and for both.
2. Verify the tests fail (RED) — no such field exists today.
3. Implement: widen the implementation-evidence observation result so it reports the unsatisfied members, carry that set onto the `implementation_evidence_invalid` condition, and onto the `implementation_invalid` result returned from `advanceFinishPublicationUnreconciled`. Keep the existing `message` and `nextAction` values unchanged.
4. Verify the tests pass (GREEN).
5. Commit with message: "feat(finish): carry the unsatisfied evidence members as a typed field"

**Done when:**
- A blocked preflight whose only unsatisfied member is `build_review` exposes a typed field whose value is exactly that member, asserted by the single-member test.
- A blocked preflight whose only unsatisfied member is `test_suite` exposes a typed field whose value is exactly that member.
- A blocked preflight with both members unsatisfied exposes both, in the order the members are evaluated.
- The `implementation_invalid` result returned to the conductor carries the same typed field, so the member survives the hop out of the preflight.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication.ts` — the condition shape, the `implementation_invalid` result shape, and the preflight that populates them
- `src/conductor/src/engine/finish-publication-production.ts` — report the unsatisfied members from the observation
- `src/conductor/test/engine/finish-publication.test.ts` — the three naming cases

**Dependencies:** Task 1

### Task 6: Name the member in the kickback evidence and the build retry hint
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/conductor-finish-publication.test.ts`: drive a FINISH whose implementation evidence is invalid for `build_review` only; assert the recorded kickback evidence and the `build` retry hint each name that member, asserted against the recorded values rather than log text.
2. Write a second failing test asserting that rewriting the `implementation_evidence_invalid` message text leaves the named member and every consumer assertion unchanged.
3. Verify both fail (RED).
4. Implement: in the `retry_build` branch of `conductor.ts`, read the typed field from the route's evidence and compose it into the kickback evidence string and the `pendingRetryHints` entry for `build`. Derive the member only from that field — never by inspecting the message.
5. Verify the tests pass (GREEN).
6. Commit with message: "feat(finish): name the unsatisfied evidence member in the build kickback"

**Done when:**
- A FINISH blocked on `build_review` alone records kickback evidence naming that member, asserted against the recorded evidence value rather than rendered log output.
- The `build` retry hint composed on that same branch names the member, so the operator-visible remedy and the recorded evidence agree.
- A test that rewrites the invalid-evidence message text leaves the named member and every consumer assertion passing, proving no consumer parses the message.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — the `retry_build` branch's kickback evidence and `pendingRetryHints` composition
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — the naming case and the message-rewrite inertness case

**Dependencies:** Task 5

### Task 7: Name no member when none was established
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: an implementation-evidence observation that is indeterminate rather than invalid; assert the refusal carries no named member.
2. Write a second failing test: a publication blocked on a condition other than invalid implementation evidence; assert it carries no named member and renders its existing guidance unchanged.
3. Verify both fail (RED) if the field is populated unconditionally.
4. Implement: populate the typed field only on the `implementation_evidence_invalid` path, where members were actually evaluated and found unsatisfied. Leave every other condition's shape and guidance untouched.
5. Verify the tests pass (GREEN).
6. Commit with message: "test(finish): an indeterminate or unrelated block names no evidence member"

**Done when:**
- An indeterminate implementation-evidence observation produces a refusal carrying no named member, because no member was established as unsatisfied.
- A refusal for a different publication condition carries no named member and renders its existing guidance unchanged, asserted against that condition's existing message and nextAction values.

**Files likely touched:**
- `src/conductor/src/engine/finish-publication.ts` — restrict population to the invalid-evidence path
- `src/conductor/test/engine/finish-publication.test.ts` — the indeterminate and unrelated-condition cases

**Dependencies:** Task 5

## Task Dependency Graph

```text
Task 1 (verdict-fed observation)
  ├── Task 2 (unsatisfied / unrecorded refusal)
  ├── Task 3 (stale outranks verdict)
  ├── Task 4 (tolerant read)
  └── Task 5 (typed field on condition + result)
        ├── Task 6 (kickback evidence + retry hint)
        └── Task 7 (no member when none established)
```

Tasks 2, 3 and 4 are mutually independent and may run concurrently once Task 1 lands. Tasks 6 and 7
are mutually independent once Task 5 lands.

## Integration Points

- After Task 1: a feature whose gates the loop resolved without dispatching them passes FINISH's
  implementation-evidence preflight instead of being kicked back to build.
- After Task 6: the operator-visible kickback names the member that must be re-run. Task 6 is the
  single integration-owning task for this feature's cross-boundary behavior — it proves the typed
  field reaches the conductor's kickback composition, which is the production path named in the
  architecture review's Wiring Surface.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given `build_review` and `test_suite` each carry a satisfied gate verdict and neither has a step-status key, when FINISH observes implementation evidence, then the evidence reads valid and publication proceeds past the implementation-evidence preflight. | 1 | "asserted by the no-state-key test" | diff-local |
| Story 1 happy: Given `build_review` and `test_suite` each carry a satisfied gate verdict and each also has a `done` step status, when FINISH observes implementation evidence, then the evidence reads valid, as it does today. | 1 | "preserving today's behavior on the ordinary path" | diff-local |
| Story 1 happy: Given a gate was resolved by a skip verdict rather than a run, when FINISH observes implementation evidence, then that gate counts as satisfied and does not by itself make the evidence invalid. | 1 | "asserted by the skip-verdict test" | diff-local |
| Story 1 negative: Given `build_review` carries a gate verdict whose satisfied flag is false, when FINISH observes implementation evidence, then the evidence reads invalid and publication is blocked at the implementation-evidence preflight. | 2 | "proving the verdict outranks the state key" | diff-local |
| Story 1 negative: Given `test_suite` has no gate verdict on disk and no step-status key, when FINISH observes implementation evidence, then the evidence reads invalid rather than defaulting to satisfied. | 2 | "reports evidence missing rather than defaulting to satisfied" | diff-local |
| Story 1 negative: Given `build_review` carries a satisfied gate verdict but its step status is `stale`, when FINISH observes implementation evidence, then the evidence reads invalid, because a staled step must re-run regardless of an older verdict. | 3 | "asserted by the stale-step test" | diff-local |
| Story 1 negative: Given the gate-verdict directory cannot be read at all, when FINISH observes implementation evidence, then the observation falls back to step status alone and does not throw, and a feature whose steps are not `done` still reads invalid. | 4 | "completes the observation without raising, and its result is decided by step status alone" | diff-local |
| Story 1 negative: Given a gate-verdict file exists but its content is malformed, when FINISH observes implementation evidence, then that gate is treated as carrying no verdict rather than as satisfied. | 4 | "proving malformed content never reads as satisfied" | diff-local |
| Story 2 happy: Given `build_review` is the only unsatisfied member when FINISH observes implementation evidence, when publication is blocked, then the refusal carries `build_review` as the named unsatisfied step in a typed field. | 5 | "asserted by the single-member test" | diff-local |
| Story 2 happy: Given `test_suite` is the only unsatisfied member, when publication is blocked, then the refusal carries `test_suite` as the named unsatisfied step in a typed field. | 5 | "exposes a typed field whose value is exactly that member" | diff-local |
| Story 2 happy: Given both members are unsatisfied, when publication is blocked, then the refusal names both, in the order the members are evaluated. | 5 | "exposes both, in the order the members are evaluated" | diff-local |
| Story 2 happy: Given a blocked publication is routed back to build, when the kickback evidence and the build retry hint are composed, then each names the unsatisfied step or steps carried on the typed field. | 6 | "so the operator-visible remedy and the recorded evidence agree" | diff-local |
| Story 2 negative: Given a consumer needs to know which step was unsatisfied, when it obtains that step, then it reads the typed field, and a test that changes the refusal's human-readable message leaves every consumer's behavior unchanged. | 6 | "proving no consumer parses the message" | diff-local |
| Story 2 negative: Given implementation evidence is indeterminate rather than invalid, when publication is blocked, then the refusal carries no named unsatisfied step, because no step was established as unsatisfied. | 7 | "because no member was established as unsatisfied" | diff-local |
| Story 2 negative: Given a publication is blocked for a condition other than invalid implementation evidence, when the refusal is rendered, then it carries no named unsatisfied step and the existing guidance for that condition is unchanged. | 7 | "asserted against that condition's existing message and nextAction values" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks, each on one physical line
- [x] Dependencies are explicit and acyclic
- [x] Exactly one integration-owning task (Task 6) states observable behavior at the conductor boundary
