# Implementation Plan: Markerless no-verdict daemon exit is always classified needs-human

**Date:** 2026-09-18
**Stories:** .docs/stories/markerless-no-verdict-daemon-exit-is-always-classi.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing halt-classification contract — the same two writable classes, the same four read dispositions, the same best-effort two-file marker protocol, and no change to the retry-decision seam or the daemon's re-kick bounding.

## Summary

Seven tasks deliver the residual gap in the source issue: the prerequisite-resolvability rule already inlined in the resume clamp becomes one exported helper, and the gate-refusal branch that today returns without a marker instead writes an explicit classified HALT — `mechanical` when a `pending` prerequisite resolves to an earlier registry index so the next resume provably reaches it, and `needs-human` otherwise. The catch-all markerless classifier, the halt-class union, the four read dispositions, and the daemon's re-kick bounding are all left unchanged.

## Technical Approach

The gate-refusal branch in the engine conductor module already computes `noRunnablePrerequisite` and already writes a classified `needs-human` HALT when it is true. When it is false the branch returns without writing any marker, so the run falls through to the loop tail's catch-all, which writes `needs-human` unconditionally. That catch-all default is correct as a backstop and is deliberately not touched; the defect is that a recoverable shape never gets classified at the one place that can prove it recoverable.

Recoverability is provable at that branch because the next dispatch's resume clamp walks backward to the earliest unsatisfied prerequisite that sits before the candidate and is present in the resolved step list. A prerequisite the list does not contain, or one at or after the blocked step, is unreachable by that walk — a re-dispatch hits the identical wall and would burn the daemon's re-kick ceiling for nothing. So the classification must ask exactly the question the clamp asks, and the honest way to guarantee the two never drift is to extract the clamp's inner selection into one exported helper and call it from both. That extraction is Task 1 and is a pure refactor with the clamp's existing tests as its regression proof.

The classification itself is then a single added branch: when a `pending` prerequisite resolves earlier, write `mechanical` with a reason naming every unsatisfied prerequisite and its state and saying the daemon will re-dispatch; otherwise write `needs-human` with a reason naming the unreachable prerequisite. Both writes stay inside the existing daemon guard, and both pair the marker write with the loop-halt emission exactly as the sibling branch already does — the alternate-branch side effect that would otherwise be easy to drop.

The local test pattern is the gate-refusal suite already in the clamp test file: it mocks the step registry to a small ordered list, seeds the state file directly, constructs the real `Conductor` with `daemon: true`, runs it, and reads the two marker files plus the emitted events. Every new case in Tasks 2, 3, 5, and 6 reuses that shape, varying only the registry ordering and the seeded statuses; no new fixture machinery, process boundary, or injected provider is needed. Task 4 varies it by making a marker write fail on the filesystem. Allowed variation is the registry contents and the seeded statuses; what must not vary is driving the real `Conductor` rather than calling the classification directly, because the criteria are about what the loop writes. Search hints: the existing suite is the one asserting that a blocked step is named in the marker together with its prerequisite's state.

Task 2 is the cross-boundary integration owner: it proves the classification is reached through the real conductor run loop and observable in the written marker files and the loop-halt event, not merely that a helper returns a value.

## Prerequisites

- None. The helper extraction in Task 1 is the only prerequisite for the classification tasks, and it is itself in this plan.

## Preconditions and claim ledger

- Operator approved the Small tier, the technical track, classification at the gate-block return site, and the pending-and-clamp-resolvable predicate on 2026-09-18.
- Verified: the gate-refusal branch computes `noRunnablePrerequisite` as every unsatisfied prerequisite having a status other than `pending`, and writes a `needs-human` marker plus a loop-halt event only when that is true and the run is a daemon run.
- Verified: when that condition is false the branch removes its signal handlers and returns with no marker written.
- Verified: the loop tail writes a `needs-human` marker for any daemon run that reaches it with neither a DONE nor a HALT marker present.
- Verified: `clampToRunnablePrerequisite` selects the earliest unsatisfied prerequisite whose resolved index is both non-negative and less than the current index, and returns the candidate unchanged when no such prerequisite exists.
- Verified: `stepSatisfied` treats `done`, `skipped`, and `stale` as satisfied, so `pending` and `failed` are both unsatisfied and only `pending` is treated as runnable by the existing predicate.
- Verified: the writable halt classes are `needs-human` and `mechanical`, and the read side returns one of four dispositions, of which `mechanical` and `legacy` are the two the progress re-kick sweep acts on.
- Verified: the shared marker writer is best-effort, removes a stale class sidecar before writing a new body, and returns a partial result when the body is written but the sidecar is not.
- Verified: the clamp test file already contains a gate-refusal case that mocks the step registry, seeds state, runs the real conductor as a daemon, and asserts both the marker body and the class sidecar.
- Verified: the progress re-kick acceptance suite already asserts that a `mechanical` disposition continues ceiling-bounded re-kicks while a `needs-human` disposition is refused and logged once.
- Assumption, ~85% confidence: the reachable recoverable shape is a mid-run navigation jump that steps past a resolvable pending prerequisite. Two such jump sites were read directly; the path set was not exhaustively enumerated. The approach fails safe either way — an unreachable prerequisite is classified `needs-human`, which is exactly today's outcome, so a wrong assumption narrows the fix rather than misclassifying a terminal condition.
- Scope check: harness-repo-only daemon machinery; no new skill; provider-agnostic.
- Event spine: no new event, metric, span, sidecar file, or channel. The existing `gate_blocked` and `loop_halt` events carry the change, and the class sidecar is the existing marker protocol.
- Verify-claims verdict: CLEAR after the predicate refinement. The one assumption above does not change the approach or the task breakdown.

## Tasks

### Task 1: Extract the clamp's resolvable-prerequisite selection into one helper
**Story:** Story 1
**Type:** refactor
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** none

**Steps:**
1. Write a failing unit test for a new exported `earliestResolvablePrerequisiteIndex(steps, state, step, beforeIndex)` covering three cases: an unsatisfied prerequisite at an earlier index returns that index, an unsatisfied prerequisite absent from the resolved step list returns -1, and an unsatisfied prerequisite at or after `beforeIndex` returns -1.
2. Add a fourth case asserting that when several unsatisfied prerequisites resolve earlier, the smallest index is returned.
3. Verify the tests fail (RED) because the helper does not exist.
4. Move the existing inner selection block out of `clampToRunnablePrerequisite` into the new exported helper without changing its logic: skip satisfied prerequisites, skip any whose resolved index is negative or not less than the bound, and keep the earliest remaining index.
5. Call the helper from `clampToRunnablePrerequisite` in place of the inlined block so one rule serves both the clamp and the later classification.
6. Run the narrowest test invocation for the clamp test file plus the repository typecheck target covering test files, then commit the focused change.

**Done when:**
- `earliestResolvablePrerequisiteIndex` is exported from the engine conductor module and returns the smallest earlier index among unsatisfied prerequisites, asserted by the multi-prerequisite unit case.
- The helper returns -1 both for a prerequisite absent from the resolved step list and for one at or after the bound, asserted by two separate unit cases.
- `clampToRunnablePrerequisite` contains no inlined prerequisite-selection loop and delegates to the helper, and every pre-existing clamp test in the file passes unchanged.

### Task 2: Park a gate block the next resume can reach as mechanical
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 1

**Steps:**
1. Following the existing gate-refusal test pattern in the clamp test file — mock the step registry to a small ordered list, seed `conduct-state.json`, run the real `Conductor` with `daemon: true`, and read the written marker files — add a failing test whose registry orders a prerequisite step before the blocked step, seeds that prerequisite `pending`, and asserts the class sidecar contains `mechanical`.
2. Extend that test to assert the marker body contains the prerequisite name with its `pending` state, and that it does not contain the string `Operator action is required`.
3. Add a second registry case whose blocked step has two unsatisfied prerequisites, one `pending` and resolvable earlier and one `failed`, asserting the class is still `mechanical` and the body names both with their states.
4. Subscribe to the loop-halt event in both cases and assert exactly one event whose reason equals the marker body's first line.
5. Verify the tests fail (RED) because the branch currently returns without writing a marker and the catch-all classifies it `needs-human`.
6. Implement: in the gate-refusal branch, when `noRunnablePrerequisite` is false, call the extracted helper for the blocked step at its own loop index; when it returns a non-negative index, build a reason naming every unsatisfied prerequisite with its state and stating the daemon will re-dispatch, then write the marker with class `mechanical` and emit the loop-halt event, mirroring the sibling branch's write-then-emit order.
7. Run the narrowest test invocation for the clamp test file plus the repository typecheck target covering test files, then commit the focused change.

**Done when:**
- A daemon run whose blocked step has a `pending` prerequisite at an earlier registry index writes `.pipeline/HALT.class` containing exactly `mechanical`, asserted by the new gate-refusal case driving the real `Conductor`.
- The written marker body contains the blocking prerequisite's name followed by its `pending` state and does not contain the string `Operator action is required`.
- The mixed case whose unsatisfied set is one resolvable `pending` prerequisite and one `failed` prerequisite writes `mechanical` and names both prerequisites with their states in the body.
- Each new case emits exactly one loop-halt event whose reason equals the trimmed first line of the written marker body.
- The reason text states that the daemon will re-dispatch the feature, asserted by a substring assertion rather than by absence of other text alone.

### Task 3: Keep an unreachable prerequisite classified needs-human
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 1

**Steps:**
1. Add a failing test whose registry omits the blocked step's prerequisite entirely while state seeds it `pending`, asserting the class sidecar contains `needs-human`.
2. Add a second failing test whose registry places the `pending` prerequisite at an index at or after the blocked step, asserting the class sidecar contains `needs-human`.
3. Add a third case whose unsatisfied prerequisites are all `failed` and resolvable earlier, asserting the class sidecar contains `needs-human` so the `pending` requirement is load-bearing and not widened to any unsatisfied state.
4. Verify the tests fail (RED) if the branch is implemented on a `pending`-only predicate without the resolvability test.
5. Implement: when the helper returns -1 for a blocked step that has a `pending` prerequisite, write the marker with class `needs-human` and a reason naming the unreachable prerequisite and its state, then emit the loop-halt event.
6. Run the narrowest test invocation for the clamp test file plus the repository typecheck target covering test files, then commit the focused change.

**Done when:**
- A `pending` prerequisite absent from the resolved registry writes `.pipeline/HALT.class` containing exactly `needs-human`, asserted by its own gate-refusal case.
- A `pending` prerequisite at or after the blocked step's own index writes `.pipeline/HALT.class` containing exactly `needs-human`, asserted by a second case.
- An unsatisfied set that is entirely `failed` writes `needs-human` and never `mechanical`, proving the classification requires a `pending` prerequisite and not merely an unsatisfied one.
- The body written for an unreachable prerequisite names that prerequisite together with its state.

### Task 4: Leave no mechanical sidecar when the marker write fails
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 2

**Steps:**
1. Add a failing test that makes the marker body write fail — for example by pre-creating `.pipeline/HALT` as a directory so the body write raises — drives a recoverable gate block, and asserts that no readable class sidecar exists afterwards.
2. Add a second case that lets the body write succeed but forces the class sidecar write to fail, asserting the sidecar is absent rather than containing `mechanical`.
3. In both cases assert the absence is readable as the fail-closed `unclassified` disposition by calling the existing halt-class reader rather than by inspecting the filesystem alone.
4. Verify the tests fail (RED) against a naive implementation that assumes the write always succeeds.
5. Confirm the implementation needs no change because the shared marker writer is already best-effort and already removes a stale sidecar before writing a new body; if a change is required, make it in the writer rather than at the call site.
6. Run the narrowest test invocation for the clamp test file, then commit the focused change.

**Done when:**
- A recoverable gate block whose body write fails leaves no `mechanical` class sidecar on disk, asserted by reading the class path and expecting absence.
- A recoverable gate block whose class sidecar write fails after a successful body write leaves the sidecar absent rather than containing `mechanical`.
- The existing halt-class reader returns the `unclassified` disposition for both failure cases, asserted directly rather than inferred from the missing file.

### Task 5: Write nothing on an interactive run and add no new class value
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 2

**Steps:**
1. Add a failing test that drives the same recoverable gate-block registry and state with `daemon` omitted, asserting that neither `.pipeline/HALT` nor `.pipeline/HALT.class` exists after the run.
2. Add an assertion over every class value the changed branch can write, checking each is a member of the existing halt-class union and that the union gained no new member.
3. Verify the tests fail (RED) against an implementation that writes the marker unconditionally rather than only under the daemon guard.
4. Implement: keep the new classified writes inside the existing daemon guard so an interactive run still returns without a marker.
5. Run the narrowest test invocation for the clamp test file plus the repository typecheck target covering test files, then commit the focused change.

**Done when:**
- A non-daemon run blocked by a resolvable `pending` prerequisite creates neither `.pipeline/HALT` nor `.pipeline/HALT.class`, asserted by expecting both reads to reject.
- Every class value written by the changed branch is `mechanical` or `needs-human`, both pre-existing members of the halt-class union, asserted by an explicit membership check.
- The halt-class union and the four read dispositions are unchanged by this diff, asserted by a test that enumerates them.

### Task 6: Preserve the existing needs-human branch and the catch-all default
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/resume-verdict-clamp.test.ts
**Dependencies:** 2

**Steps:**
1. Assert the pre-existing gate-refusal case — whose blocked step's only prerequisite is `failed` and absent from the resolved registry — still writes `needs-human` with its current body text, unchanged.
2. Add a failing regression case whose unsatisfied prerequisites are all non-`pending` and resolvable, asserting the body still names every unsatisfied prerequisite with its state and still states that operator action is required.
3. Add a case driving the daemon loop to a markerless exit that is not a gate block, asserting the loop tail's catch-all still writes class `needs-human`.
4. Add a case in which the run has already written the terminal DONE marker, asserting the catch-all writes no marker and does not overwrite that terminal state.
5. Verify the tests fail (RED) against an implementation that widens the recoverable branch to cover non-`pending` states or that weakens the catch-all default.
6. Run the narrowest test invocation for the clamp test file, then commit the focused change.

**Done when:**
- The pre-existing gate-refusal assertion over a `failed`, unresolvable prerequisite passes with its current body text and `needs-human` class, unmodified by this diff.
- A blocked step whose unsatisfied prerequisites are all non-`pending` writes `needs-human` and a body naming every unsatisfied prerequisite with its state, and still states that operator action is required.
- A daemon markerless exit that is not a gate block still writes class `needs-human` through the loop tail's catch-all.
- A run that already wrote the terminal DONE marker reaches the loop tail without any HALT marker being created.

### Task 7: Confirm a mechanical park is re-kickable and ceiling-bounded
**Story:** Story 1
**Type:** verification
**Files:** none
**Verify-only:** yes
**Dependencies:** 2

**Steps:**
1. Read the existing progress re-kick acceptance suite and confirm its `mechanical` case asserts the sweep continues ceiling-bounded re-kicks rather than refusing them as operator-action.
2. Confirm the same suite's `needs-human` case asserts the sweep refuses and logs the blocking disposition once, so the two classes this feature writes are already separated by existing coverage.
3. Record the verification result on the task and complete it with an empty commit carrying the task trailer and an evidence trailer naming the existing coverage.

**Done when:**
- The existing progress re-kick acceptance suite asserts that a `mechanical` disposition continues ceiling-bounded re-kicks, so a park written by this feature is resumed by the daemon rather than refused.
- The same suite asserts that the dispatch count stops at the configured ceiling rather than growing without bound, so the recoverable class cannot become an unbounded retry.
- No new test or production change is required for either behavior, and the task completes with an evidence trailer naming that suite.

## Task Dependency Graph

```
Task 1 (extract helper)
  ├─▶ Task 2 (mechanical classification, integration owner)
  │     ├─▶ Task 4 (marker write failure)
  │     ├─▶ Task 5 (interactive run, no new class value)
  │     ├─▶ Task 6 (preserve needs-human branch and catch-all)
  │     └─▶ Task 7 (verify re-kickable and ceiling-bounded)
  └─▶ Task 3 (unreachable prerequisite stays needs-human)
```

Tasks 2 and 3 are independent of each other and may run concurrently once Task 1 lands. Tasks 4, 5, 6, and 7 are independent of each other and may all run concurrently once Task 2 lands.

## Integration Points

- After Task 2: a daemon run blocked by a reachable prerequisite can be driven end to end through the real conductor and observed to park in a class the daemon's own sweep resumes.
- After Task 3: the full classification decision — reachable versus unreachable — is observable from the written marker alone.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a daemon run blocked by a `pending` prerequisite that sits at an earlier index in the resolved step registry, when the gate is evaluated, then the run parks with HALT class `mechanical`. | 2 | "writes `.pipeline/HALT.class` containing exactly `mechanical`" | diff-local |
| Story 1 happy: Given that same run, when the gate is evaluated, then the HALT body names that prerequisite together with its `pending` state. | 2 | "contains the blocking prerequisite's name followed by its `pending` state" | diff-local |
| Story 1 happy: Given that same run, when the gate is evaluated, then a loop-halt event carrying the same reason is emitted before the run returns. | 2 | "emits exactly one loop-halt event whose reason equals the trimmed first line" | diff-local |
| Story 1 happy: Given that same run, when the gate is evaluated, then the reason states that the daemon will re-dispatch rather than that operator action is required. | 2 | "states that the daemon will re-dispatch the feature" | diff-local |
| Story 1 happy: Given a feature parked by this path, when the daemon's progress-gated re-kick sweep reads its halt disposition, then the disposition does not refuse the re-kick as requiring operator action. | 7 | "continues ceiling-bounded re-kicks, so a park written by this feature is resumed" | diff-local |
| Story 1 happy: Given a run blocked by two unsatisfied prerequisites where only one is `pending` and resolvable to an earlier index, when the gate is evaluated, then the run still parks `mechanical` and the body names both prerequisites with their states. | 2 | "writes `mechanical` and names both prerequisites with their states in the body" | diff-local |
| Story 1 negative: Given a daemon run blocked by a `pending` prerequisite that the resolved step registry does not contain at all, when the gate is evaluated, then the run parks `needs-human` rather than `mechanical`, because no re-dispatch can reach it. | 3 | "absent from the resolved registry writes `.pipeline/HALT.class` containing exactly `needs-human`" | diff-local |
| Story 1 negative: Given a daemon run blocked by a `pending` prerequisite that sits at or after the blocked step's own index, when the gate is evaluated, then the run parks `needs-human` rather than `mechanical`. | 3 | "at or after the blocked step's own index writes `.pipeline/HALT.class` containing exactly `needs-human`" | diff-local |
| Story 1 negative: Given a recoverable gate block, when the HALT body write fails so no class sidecar is persisted, then no `mechanical` sidecar exists and the missing class is read as the fail-closed `unclassified` disposition rather than as recoverable. | 4 | "whose body write fails leaves no `mechanical` class sidecar on disk" | diff-local |
| Story 1 negative: Given a recoverable gate block, when the class sidecar write fails after the body was written, then the resulting partial state carries no class and is read as `unclassified` rather than defaulting to `mechanical`. | 4 | "whose class sidecar write fails after a successful body write leaves the sidecar absent" | diff-local |
| Story 1 negative: Given a feature repeatedly parked by this path, when the daemon's re-kick dispatch ceiling has already been reached for that slug, then the sweep stops re-kicking it instead of dispatching without bound. | 7 | "stops at the configured ceiling rather than growing without bound" | diff-local |
| Story 1 negative: Given an interactive (non-daemon) run blocked by a resolvable `pending` prerequisite, when the gate is evaluated, then no HALT marker and no class sidecar are written at all. | 5 | "creates neither `.pipeline/HALT` nor `.pipeline/HALT.class`" | diff-local |
| Story 2 happy: Given a daemon run whose unsatisfied prerequisites are all in non-`pending` states, when the gate is evaluated, then the run parks with HALT class `needs-human` and the body still states that operator action is required. | 6 | "writes `needs-human` and a body naming every unsatisfied prerequisite with its state" | diff-local |
| Story 2 happy: Given a daemon run that exits without writing any terminal marker for a reason other than a gate block, when the loop tail's catch-all classifier runs, then the run parks with HALT class `needs-human` exactly as before this change. | 6 | "markerless exit that is not a gate block still writes class `needs-human`" | diff-local |
| Story 2 happy: Given a daemon run whose unsatisfied prerequisites are all non-`pending`, when the gate is evaluated, then the HALT body names every unsatisfied prerequisite with its state, unchanged from current behavior. | 6 | "a body naming every unsatisfied prerequisite with its state" | diff-local |
| Story 2 happy: Given the existing registry fixture whose blocked step's only prerequisite is `failed` and absent from the resolved registry, when the gate is evaluated, then the run parks `needs-human` with its current body text, unchanged. | 6 | "passes with its current body text and `needs-human` class, unmodified by this diff" | diff-local |
| Story 2 negative: Given a daemon run blocked by prerequisites that are all `failed`, when the gate is evaluated, then the run does not park as `mechanical` and is therefore not auto-cleared by the re-kick sweep. | 3 | "entirely `failed` writes `needs-human` and never `mechanical`" | diff-local |
| Story 2 negative: Given a daemon run that already wrote a terminal DONE marker, when the loop tail's catch-all classifier runs, then it writes no HALT marker and does not overwrite the existing terminal state. | 6 | "reaches the loop tail without any HALT marker being created" | diff-local |
| Story 2 negative: Given a gate block under a daemon run, when the written class sidecar is read back, then its value is one of the four dispositions the read side already recognises and never a newly introduced fifth value. | 5 | "both pre-existing members of the halt-class union" | diff-local |

Every criterion is `diff-local`: each is decided entirely by the classification branch and the tests in this diff, and no commit outside this feature can change whether it holds. Criteria S1.5 and S1.11 cite existing daemon coverage rather than new tests; they remain diff-local because what this diff decides is which class is written, and the cited suite already fixes the daemon's behavior for each class.

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks, each naming a mechanism and its observable assertion, on one physical line
- [x] Dependencies are explicit and acyclic
- [x] Exactly one task (Task 2) owns the cross-boundary integration proof through the real conductor run loop

### Task rem-prd-audit-rem-s16-1: src/conductor/test/engine/resume-verdict-clamp.test.ts — add a failing daemon gate-refusal case whose mocked registry is build (index 0, state failed), test_suite (index 1, state pending), build_review (index 2, prerequisites build and test_suite, state in_progress): assert .pipeline/HALT.class is exactly `mechanical`, the body contains `build (failed)`, `test_suite (pending)` and `daemon will re-dispatch`, and exactly one loop_halt event equals the trimmed body; also retitle the existing case at resume-verdict-clamp.test.ts:788 from 'parks needs-human when the earliest reachable prerequisite is failed' to name what its fixture actually pins (a pending prerequisite at or after the blocked step stays needs-human), keeping all of its current needs-human assertions delivered by plan task 3 unchanged
**Gate:** prd-audit
**Rationale:** Implementation defect, not a planning miss: src/conductor/src/engine/conductor.ts:9214-9221 applies the `=== 'pending'` status check to the *earliest* unsatisfied prerequisite returned by earliestResolvablePrerequisiteIndex (src/conductor/src/engine/conductor.ts:14802-14814), so the mixed shape [failed earlier, pending later] parks needs-human, while plan task 2's Done when already requires that exact mixed set to park mechanical and names it verbatim — the repair is admitted by task 2, and it is emitted as concrete work rather than a bare task re-stage because the previous lap implemented task 2 and produced this guard. The status check is redundant for plan task 3's all-`failed` case, which never reaches this branch: `noRunnablePrerequisite` at src/conductor/src/engine/conductor.ts:9200-9202 is true whenever no unsatisfied prerequisite is `pending` and routes that shape to the untouched sibling branch, so S2.3/S2.5 coverage (resume-verdict-clamp.test.ts:989, :1091) is preserved unchanged by these tasks. Sibling sweep: the only other status-on-prerequisite predicate in this path is that `noRunnablePrerequisite` guard, which is correct and is deliberately left alone; the helper is shared with clampToRunnablePrerequisite (src/conductor/src/engine/conductor.ts:14790), so the filter is added as a defaulted argument and the clamp's unfiltered rule stays one source rather than a second copy that can drift. No task removes or relaxes an assertion: the existing needs-human case at resume-verdict-clamp.test.ts:788 keeps every assertion plan task 3's Done when delivered and is only retitled to describe the fixture it actually pins.
**Criterion:** S1.6
**Parent task:** 2
**Done when:**
- S1.6 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s16-1 is complete.

### Task rem-prd-audit-rem-s16-2: src/conductor/src/engine/conductor.ts:9214-9221 — make the mechanical branch test reachability over the pending unsatisfied prerequisites only: add an optional pending-only filter argument to earliestResolvablePrerequisiteIndex at src/conductor/src/engine/conductor.ts:14802 whose default keeps the existing unfiltered behavior (so the sole other caller, clampToRunnablePrerequisite at src/conductor/src/engine/conductor.ts:14790, and plan task 1's Done when are unchanged and the two paths keep one selection rule), call it with the pending filter from the gate branch, and drop the getStepStatus(...) === 'pending' check on the returned index so the mixed [failed earlier, pending later] set parks mechanical while an absent or at/after-blocked pending prerequisite still parks needs-human
**Gate:** prd-audit
**Rationale:** Implementation defect, not a planning miss: src/conductor/src/engine/conductor.ts:9214-9221 applies the `=== 'pending'` status check to the *earliest* unsatisfied prerequisite returned by earliestResolvablePrerequisiteIndex (src/conductor/src/engine/conductor.ts:14802-14814), so the mixed shape [failed earlier, pending later] parks needs-human, while plan task 2's Done when already requires that exact mixed set to park mechanical and names it verbatim — the repair is admitted by task 2, and it is emitted as concrete work rather than a bare task re-stage because the previous lap implemented task 2 and produced this guard. The status check is redundant for plan task 3's all-`failed` case, which never reaches this branch: `noRunnablePrerequisite` at src/conductor/src/engine/conductor.ts:9200-9202 is true whenever no unsatisfied prerequisite is `pending` and routes that shape to the untouched sibling branch, so S2.3/S2.5 coverage (resume-verdict-clamp.test.ts:989, :1091) is preserved unchanged by these tasks. Sibling sweep: the only other status-on-prerequisite predicate in this path is that `noRunnablePrerequisite` guard, which is correct and is deliberately left alone; the helper is shared with clampToRunnablePrerequisite (src/conductor/src/engine/conductor.ts:14790), so the filter is added as a defaulted argument and the clamp's unfiltered rule stays one source rather than a second copy that can drift. No task removes or relaxes an assertion: the existing needs-human case at resume-verdict-clamp.test.ts:788 keeps every assertion plan task 3's Done when delivered and is only retitled to describe the fixture it actually pins.
**Criterion:** S1.6
**Parent task:** 2
**Done when:**
- S1.6 is satisfied by this task.
- Re-run prd-audit and confirm task rem-prd-audit-rem-s16-2 is complete.
