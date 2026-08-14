# Implementation Plan: FINISH publication burns its retry budget on an unreachable transition

**Date:** 2026-08-13
**Design:** .docs/decisions/adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns.md
**Stories:** .docs/stories/finish-publication-burns-its-retry-budget-on-an-un.md
**Conflict check:** Clean as of 2026-08-13

## Summary

Eighteen tasks that make a non-advancing FINISH publication transition unrepresentable rather than
merely bounded — on both the advance path and the retry path — and let the engine recognize a
halt-state PR without paying a provider session for an LLM to judge it. Closes ai-conductor#1487.

## Technical Approach

Two changes, one seam each.

**The fixed-point guard (`src/conductor/src/engine/finish-publication.ts`).** Today an effect
reports `advanced` by calling `advancedPublicationTransition` (`:1202-1210`) — a claim the effect
makes about itself. The guard turns that into a fact derived from observation. A dimension map,
total over `PublicationTransition`, names the snapshot slice each transition is responsible for
moving:

| Transition | Owned dimension |
|---|---|
| `establish_pr` | `pr.identity` and `branchPushed` |
| `verify_release_readiness` | `releaseReadiness` |
| `author_pr_prose` | `pr.prose` |
| `judge_pr_prose` | `pr.prose` |
| `write_shipped_record` | `shippedRecord` |
| `ready_pr` | `pr.ready` |
| `record_outcome` | `outcomeRecord` |

The map is a `Record<PublicationTransition, …>`, so adding a union member without a dimension entry
is a compile error. The guard lives in that one helper, not in the seven per-arm call sites — a
per-arm implementation is how one arm gets missed.

The split is evaluated on the **post-effect** observation only, and is three-way:
determinate-and-changed advances; determinate-and-unchanged returns `human_required` on the first
occurrence, spending no retry and no progress tick; indeterminate takes the existing
`publication_retry` path so a degraded observation stays fail-open, matching what `safelyObserve`
(`:211`) exists to provide. A pre-effect `indeterminate` that becomes determinate is a change and
advances — see conflict-check Conflict 2.

**The retry path needs the same rule, and it is the one the filed defect takes.**
`advancedPublicationTransition` is reached only when a transition arm reports success — the judgment
arm returns `result.kind === 'advanced' ? advancedPublicationTransition(…) : result` (`:1342-1344`)
— so a `publication_retry` disposition bypasses the advance-path guard entirely. Cycle B reports
`advanced` and is caught; Cycle A returns a retry and is not. Per the ADR's 2026-08-13 amendment, a
`publication_retry` naming transition T therefore resolves `human_required` when the fresh
observation would not select T: such a retry provably cannot perform what it names, and re-running
it can only re-derive the same stage from the same inputs. The test reuses the existing pure
selector `nextFinishPublicationTransition` (`:357-400`) against the post-effect observation — no new
predicate. `mapPrProseJudgmentResult`'s `revision_required/placeholder` arm (`:1176-1186`) is left
as written; the general rule covers it and every other retry reason, including ones not yet
authored.

The halt text needs to name the transition that ran and the dimension that did not move, but the
`human_required` disposition carries only `reason` and an optional `detail` — it has no
`transition` field, unlike `publication_retry`. Both travel in `detail`, which
`adr-2026-08-08-finish-human-required-halt-rendering` already establishes as the rendered carrier.
The disposition shape is not widened (conflict-check Conflict 3).

**The halt short-circuit (`src/conductor/src/engine/finish-publication-production.ts`).** `prProse`
(`:120-133`) tests two halt signals — the `needs-remediation:` title prefix and the banner sentinel.
The label and the `<!-- conductor:needs-remediation -->` body marker are invisible to it, and
`observePullRequest` (`:233`) does not even request `labels`. The existing four-signal predicate
`hasHaltSignal` (`halt-pr-rehabilitation.ts:500-505`) already implements the complete test; it is
unreachable from the coordinator only because it runs inside `repairPresentation`, gated behind
prose already being `accepted`. This plan adds `labels` to the observation and routes classification
through that predicate. No second halt predicate is authored — two disagreeing halt tests would
recreate the defect class under repair.

**Sequencing.** Task 1 discharges review condition 3 before any behavior changes. The dimension map
(2-3) precedes the guard (4-9) because the guard consumes it. The halt short-circuit (12-15) is
independent of the guard and could run in parallel, but is sequenced after so that the Cycle A
regression (task 10) is authored while the historical path is still reachable end to end — it is
then pinned at the coordinator seam, where the short-circuit cannot make it vacuous.

**Why the Cycle A regression is not end-to-end.** Once task 15 lands, a `needs-remediation` PR
resolves `human_required` before judgment is dispatched, so the filed defect's end-to-end path is
unreachable by construction. A test driving it through the production classifier would pass against
an implementation with no guard at all. Task 10 therefore injects a snapshot whose `pr.prose` is a
non-`accepted`, non-halt value, so judgment is genuinely reached and the guard is what stops the
run. Story 4 keeps its own acceptance coverage through the production classifier in task 12. This
is conflict-check Conflict 1, operator-resolved 2026-08-13.

**Documentation.** This repository delivers reader-facing documentation through its
`maintain-documentation` custom step in the same PR, so no documentation tasks appear below. Two
factual items that step needs, recorded here so they are not lost: `docs/explanation/gates.md:265`
states the publication progress allowance as 12, but the constant is `2 * 7 = 14`
(`finish-publication.ts:348`) — `docs/runbooks/stalled-or-stuck-feature.md:269` already says 14. The
"twelve" in `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` is correct
append-only history from when there were six transitions and must not be edited. The runbook's
§"FINISH publication halts" (`:253-296`) needs the new halt shape and its recovery added.

**Out of scope.** `skills/finish/SKILL.md` is not touched — the provider verdict contract is
unchanged, and `test/engine/finish-pr-prose-judgment.test.ts:15` parses that file as test input
(review condition 5). `VERSION` and `CHANGELOG.md` are never written by an implementation branch;
the release disposition travels in the PR body.

## Prerequisites

- None. No migration, no config key, no new dependency.

## Tasks

### Task 1: Record every consumer of the publication-progress disposition
**Story:** 1
**Type:** infrastructure
**Verify-only:** yes

Discharges architecture-review condition 3 before any behavior changes. If a consumer outside the
conductor's FINISH arm treats `advanced` as "the effect ran" rather than "the dimension moved", the
architecture review re-opens rather than the guard landing on a false premise.

**Steps:**
1. Grep `src/conductor/src` for `progress_finish`, `publication_progress`, and
   `advancedPublicationTransition`, excluding `test/`.
2. Confirm the only behavioral consumer is the conductor's FINISH arm at `conductor.ts:6101-6121`.
3. Record the finding — each hit with `file:line` and whether it reads the disposition's meaning or
   only forwards it — in the commit body.
4. If any other behavioral consumer exists, STOP and re-open architecture review rather than
   proceeding to Task 2.
5. Commit with an `Evidence: skipped no-production-change` trailer and the findings in the body.

**Files:** none

**Dependencies:** none

---

### Task 2: RED — the dimension map must be total over PublicationTransition
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting a dimension is resolvable for all seven `PublicationTransition`
   members, plus a type-level assertion that the map is a `Record` keyed by the full union so an
   added member without an entry fails to compile.
2. Verify test fails (RED) — the map does not exist yet.
3. Commit with message: "test(finish-publication): require a total transition dimension map".

**Files:** `src/conductor/test/engine/finish-publication.test.ts`

**Dependencies:** Task 1

---

### Task 3: GREEN — add the exhaustive transition dimension map
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Add a `Record<PublicationTransition, …>` mapping each transition to the snapshot dimension it
   owns, per the table in Technical Approach. `establish_pr` owns the `pr.identity` + `branchPushed`
   pair.
2. Add a pure reader that extracts a comparable value for a dimension from a `PublicationSnapshot`.
3. Verify Task 2's test passes (GREEN).
4. Commit with message: "feat(finish-publication): map each publication transition to the dimension it owns".

**Files:** `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 2

---

### Task 4: RED — a transition that moves its dimension still advances
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests through `advancedPublicationTransition` for three representative
   transitions: `author_pr_prose` moving `pr.prose` from `placeholder` to `accepted`,
   `write_shipped_record` moving `shippedRecord` to `valid`, and `ready_pr` moving `pr.ready` to
   true. Each asserts an `advanced` result.
2. Verify tests fail (RED) — the helper does not yet take a post-effect observation.
3. Commit with message: "test(finish-publication): a moved dimension still reports advanced".

**Files:** `src/conductor/test/engine/finish-publication.test.ts`

**Dependencies:** Task 3

---

### Task 5: GREEN — evaluate the guard in the single advance choke point
**Story:** 1
**Type:** happy-path

**Steps:**
1. Change `advancedPublicationTransition` (`finish-publication.ts:1202-1210`) to take the
   pre-effect snapshot and the post-effect re-observation, and to report `advanced` only when the
   transition's owned dimension differs between them.
2. Thread the two observations from each transition arm in `advanceFinishPublication` into that one
   helper; add no per-arm guard logic.
3. Verify Task 4's tests pass (GREEN).
4. Commit with message: "feat(finish-publication): derive advanced from the observed dimension".

**Files:** `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 4

---

### Task 6: RED — an unmoved dimension does not advance, even when a foreign dimension moved
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test where `judge_pr_prose` completes and `pr.prose` is still `halt`, asserting
   the result is not `advanced`.
2. Write a failing test where `judge_pr_prose` completes, `pr.prose` is still `halt`, but
   `shippedRecord` moved to `valid` — asserting the result is still not `advanced`, so foreign
   churn cannot mask a stalled stage.
3. Write a failing test where `establish_pr` completes with `pr.identity` now `one` but
   `branchPushed` still not `valid`, asserting the paired dimension requires both.
4. Verify tests fail (RED).
5. Commit with message: "test(finish-publication): an unmoved owned dimension is not an advance".

**Files:** `src/conductor/test/engine/finish-publication.test.ts`

**Dependencies:** Task 5

---

### Task 7: RED — a non-advance halts human-required, spending no retry and no progress tick
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a failing conductor-level test where a transition completes without moving its dimension,
   asserting the FINISH attempt counter is unchanged, `publicationProgressAttempts` is unchanged,
   a `needs-human` halt marker is written, and a `loop_halt` event is emitted.
2. Assert no `step_retry` event is emitted for the FINISH step and no `PUBLICATION_RETRY_REASONS`
   reason string appears in the disposition.
3. Verify tests fail (RED).
4. Commit with message: "test(conductor): a non-advancing transition halts without spending budget".

**Files:** `src/conductor/test/engine/conductor-finish-publication.test.ts`

**Dependencies:** Task 6

---

### Task 8: GREEN — return human_required for a determinately unmoved dimension
**Story:** 2
**Type:** negative-path

**Steps:**
1. Make the guard return a `human_required` disposition when the owned dimension is determinate on
   the post-effect observation and unchanged.
2. Confirm the existing `human_required` routing at `conductor.ts:6207` carries it to a halt with no
   attempt or progress accounting — no conductor change should be required.
3. Verify Tasks 6 and 7 pass (GREEN).
4. Commit with message: "feat(finish-publication): halt human-required on a non-advancing transition".

**Files:** `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 7

---

### Task 9: RED — the halt names the stage that ran and the dimension that did not move
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the rendered halt text for a non-advancing `judge_pr_prose` names
   the transition, names the dimension in operator-locatable terms, states the observed value that
   did not change, and includes a concrete next action.
2. Assert the text never reproduces the `authoring_required_after_judgment` shape, which named a
   transition that was never dispatched.
3. Verify tests fail (RED).
4. Commit with message: "test(finish-publication): halt text names the stage and the stuck dimension".

**Files:** `src/conductor/test/engine/finish-publication.test.ts`

**Dependencies:** Task 8

---

### Task 10: GREEN — add the HumanRequiredReason member, its guidance row, and the detail carrier
**Story:** 3
**Type:** happy-path

**Steps:**
1. Add the new member to the `HumanRequiredReason` union and a matching row to the guidance table
   (`finish-publication.ts:469-510`) — the union's exhaustiveness makes an omitted row a compile
   error.
2. Populate the disposition's existing optional `detail` with the transition name and the unmoved
   dimension. Do not add a `transition` field to the `human_required` shape.
3. Verify Task 9's tests pass (GREEN).
4. Commit with message: "feat(finish-publication): render a non-advance halt naming stage and dimension".

**Files:** `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 9

---

### Task 10a: RED — a retry naming an unselectable transition does not retry
**Story:** 2
**Type:** negative-path

The advance-path guard from Tasks 5 and 8 cannot see this case: a `publication_retry` never reaches
`advancedPublicationTransition`. This is the path the filed defect takes.

**Steps:**
1. Write a failing test producing a `publication_retry` that names `author_pr_prose` while the
   post-effect observation would select `judge_pr_prose`, asserting the disposition resolves
   `human_required` rather than being routed as a retry.
2. Write a failing test for the converse: a `publication_retry` naming the transition the fresh
   observation WOULD select — for example `judgment_dispatch_failed` naming `judge_pr_prose` while
   prose is still unjudged — asserting it retries exactly as it does today.
3. Assert the FINISH attempt counter is unchanged for the unselectable case.
4. Verify tests fail (RED).
5. Commit with message: "test(finish-publication): a retry that cannot perform what it names must not retry".

**Files:** `src/conductor/test/engine/finish-publication.test.ts`

**Dependencies:** Task 10

---

### Task 10b: GREEN — resolve an unperformable retry as human-required
**Story:** 2
**Type:** negative-path

**Steps:**
1. Before returning a `publication_retry`, apply the existing pure selector
   `nextFinishPublicationTransition` (`finish-publication.ts:357-400`) to the post-effect
   observation; when it would not select the retry's named transition, return `human_required`
   carrying the named transition and the transition the selector would actually choose in `detail`.
2. Reuse the reason member from Task 10 or add a sibling member with its own guidance row —
   whichever renders an operator-actionable halt for "the retry named a stage that cannot run".
3. Leave `mapPrProseJudgmentResult`'s `revision_required/placeholder` arm (`:1176-1186`) unchanged;
   the general rule subsumes it.
4. Verify Task 10a's tests pass (GREEN) and Tasks 4-9 still pass.
5. Commit with message: "feat(finish-publication): halt a retry that cannot perform the transition it names".

**Files:** `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 10a

---

### Task 11: RED — the Cycle A regression, pinned at the coordinator seam
**Story:** 2
**Type:** negative-path

Per conflict-check Conflict 1 this is driven at the `advanceFinishPublication` seam with an injected
snapshot, NOT end to end through the production classifier — the halt short-circuit in Tasks 15-16
makes the end-to-end path unreachable, and a test pinned there would pass with no guard present.
Cycle A exercises the retry-path rule from Tasks 10a-10b; Cycle B exercises the advance-path guard
from Tasks 5 and 8. They are different mechanisms and both must be asserted.

**Steps:**
1. Write a failing acceptance test injecting a snapshot whose `pr.prose` is a non-`accepted`,
   non-halt value so the judgment branch is genuinely selected, with a judgment effect returning
   `revision_required` reason `placeholder`.
2. Assert the run resolves `human_required` on the first occurrence, never reaching
   `FINISH publication retry exhausted: authoring_required_after_judgment`, and that the judgment
   effect spy was called exactly once.
3. Add the Cycle B variant: the same snapshot with an `accepted` verdict, asserting zero
   progress-allowance accumulation rather than fourteen refunded laps.
4. Verify tests fail (RED).
5. Commit with message: "test(finish): pin the #1487 non-advancing judgment cycles at the coordinator seam".

**Files:** `src/conductor/test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts`

**Dependencies:** Task 10b

---

### Task 12: RED — every transition's legitimate revisit still advances
**Story:** 5
**Type:** happy-path

Discharges architecture-review condition 2. The `establish_pr`-after-`write_shipped_record` case is
mandatory: it is the revisit `adr-2026-08-06-bounded-progress-allowance-for-finish-publication`
cites from #1342, and the case a naive visit-count bound would break.

**Steps:**
1. Write a failing test for the `establish_pr` revisit — committing the shipped record leaves the
   branch unpushed, so `branchPushed` returns to non-`valid` and the second `establish_pr` visit
   moves it back, which must report `advanced`.
2. Write a legitimate-repeat test for each of the remaining six transitions.
3. Assert a full healthy publication run reaches completion with an unchanged transition count, no
   `human_required` disposition, and a progress counter that never reaches the allowance.
4. Verify tests fail or pass as appropriate against the current guard, and that none is vacuous.
5. Commit with message: "test(finish-publication): every transition's legitimate revisit advances".

**Files:** `src/conductor/test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts`

**Dependencies:** Task 11

---

### Task 13: RED — an indeterminate post-effect dimension retries instead of halting
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write a failing test where the owned dimension observes `indeterminate` after the effect,
   asserting a `publication_retry` on the existing path rather than `human_required`.
2. Write a failing test where the dimension was `indeterminate` before the effect and determinate
   after, asserting `advanced` — a recovered observation is a real change, not an undeterminable
   comparison (conflict-check Conflict 2).
3. Write a failing test asserting repeated indeterminate observations still terminate through the
   existing `stepMaxRetries` exhaustion rather than looping.
4. Verify tests fail (RED).
5. Commit with message: "test(finish-publication): indeterminate is undeterminable, not a non-advance".

**Files:** `src/conductor/test/engine/finish-publication.test.ts`

**Dependencies:** Task 12

---

### Task 14: GREEN — complete the three-way split on the post-effect observation
**Story:** 6
**Type:** negative-path

**Steps:**
1. Make the guard distinguish changed, determinately-unchanged, and undeterminable, deciding solely
   on the post-effect value; route only the undeterminable case to `publication_retry`.
2. Verify Task 13's tests pass (GREEN) and Tasks 6-12 still pass.
3. Commit with message: "feat(finish-publication): fail open on an undeterminable dimension".

**Files:** `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 13

---

### Task 15: RED — a halt-state PR resolves human-required with no judgment dispatched
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write a failing acceptance test with a faked `gh` boundary returning a PR that carries only the
   `needs-remediation` label — no halt title prefix, no banner — asserting `human_required` and a
   judgment spy that is never called.
2. Add the marker-only variant: a normal `feat:` title with the
   `<!-- conductor:needs-remediation -->` body marker.
3. Add the residual-signal variant from the Story 4 amendment: ordinary authored prose plus a live
   label, asserting halt state — the halt was never cleared.
4. Add negative variants: ordinary authored prose with no signal proceeds to judgment; an empty
   label list is not a halt signal; a failing `gh pr view` takes the existing degraded path and
   makes no halt claim from absent data.
5. Assert the FINISH attempt counter and progress counter are unchanged for a halt-state PR.
6. Verify tests fail (RED).
7. Commit with message: "test(finish-publication): a halt-state PR resolves before judgment".

**Files:** `src/conductor/test/acceptance/finish-publication-non-advancing-transition.acceptance.test.ts`

**Dependencies:** Task 14

---

### Task 16: GREEN — observe labels and classify halt through the existing predicate
**Story:** 4
**Type:** negative-path

**Steps:**
1. Add `labels` to `observePullRequest`'s `gh pr view --json` field list
   (`finish-publication-production.ts:233`) and carry them into the observation.
2. Replace `prProse`'s two-signal halt test (`:125-128`) with a call to the existing `hasHaltSignal`
   predicate (`halt-pr-rehabilitation.ts:500-505`), passing title, body, and labels. Author no
   second halt predicate — `src/` must retain exactly one implementation of the four-signal test.
3. Resolve a halt-state PR to `human_required` ahead of the `isPrProseJudgmentNeeded` branch
   (`finish-publication.ts:1332`), reusing the reason from Task 10 or a sibling member with its own
   guidance row.
4. Verify Task 15's tests pass (GREEN) and the existing suites
   `test/acceptance/unattended-finish-publication.acceptance.test.ts` and
   `test/acceptance/finish-publication-progress-budget.acceptance.test.ts` still pass without any
   assertion being weakened.
5. Commit with message: "feat(finish-publication): recognize a halt-state PR without dispatching judgment".

**Files:** `src/conductor/src/engine/finish-publication-production.ts`; `src/conductor/src/engine/finish-publication.ts`

**Dependencies:** Task 15

---

## Task Dependency Graph

```text
Task 1  (condition-3 consumer sweep, verify-only)
  └─ Task 2  (RED: total dimension map)
       └─ Task 3  (GREEN: dimension map)
            └─ Task 4  (RED: moved dimension advances)
                 └─ Task 5  (GREEN: guard in the advance choke point)
                      └─ Task 6  (RED: unmoved dimension does not advance)
                           └─ Task 7  (RED: non-advance halts, no budget spent)
                                └─ Task 8  (GREEN: human_required on a non-advance)
                                     └─ Task 9  (RED: halt names stage + dimension)
                                          └─ Task 10 (GREEN: reason member, guidance row, detail)
                                            └─ Task 10a (RED: retry naming an unselectable stage)
                                              └─ Task 10b (GREEN: halt an unperformable retry)
                                               └─ Task 11 (RED: Cycle A/B at the coordinator seam)
                                                    └─ Task 12 (RED: 7 legitimate revisits)
                                                         └─ Task 13 (RED: indeterminate retries)
                                                              └─ Task 14 (GREEN: three-way split)
                                                                   └─ Task 15 (RED: halt-state PR)
                                                                        └─ Task 16 (GREEN: labels + hasHaltSignal)
```

Linear by construction: each RED task pins behavior the next GREEN task delivers, and the guard
must exist before the halt short-circuit is layered on top of it, so that Task 11's regression is
authored while the historical path is still reachable.

## Integration Points

- **After Task 5** — the guard is live in the single choke point; every transition's advance is
  derived from observation rather than asserted.
- **After Task 10** — a stuck publication produces a complete, operator-actionable halt end to end.
- **After Task 10b** — both dispositions a transition can return are covered: an advance that moved
  nothing and a retry that cannot perform what it names both resolve human-required on the first
  occurrence. This is the point at which the filed Cycle A defect actually terminates.
- **After Task 14** — the guard's contract is total: changed, unchanged, undeterminable.
- **After Task 16** — a halt-state PR is recognized deterministically; the full #1487 outcome set is
  satisfied and the feature is testable end to end through the production classifier.

## Coverage Mapping

| Story | Acceptance criteria covered by |
|---|---|
| Story 1 — a transition advances only when it moves its dimension | Tasks 2, 3, 4, 5, 6 |
| Story 2 — a non-advance resolves human-required on the first occurrence | Tasks 7, 8, 10a, 10b, 11 |
| Story 3 — the halt names the stage and the dimension | Tasks 9, 10 |
| Story 4 — a halt-state PR resolves before judgment | Tasks 15, 16 |
| Story 5 — legitimate runs converge with no extra attempts | Tasks 12, 16 (step 4) |
| Story 6 — an indeterminate dimension retries | Tasks 13, 14 |

| Outcome | Delivered by |
|---|---|
| outcome-1 — a retry that cannot advance is never issued | Tasks 5, 8, 10a, 10b, 14 |
| outcome-2 — a halt-boilerplate PR resolves human-required without consuming attempts | Tasks 15, 16 |
| outcome-3 — the halt reason names the stage that ran and why it could not advance | Tasks 9, 10 |
| outcome-4 — verdict/observation disagreement surfaces as a defect | Tasks 6, 8, 11 |
| outcome-5 — legitimately converging paths keep working with no extra attempts | Tasks 12, 16 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] No task names another feature's sealed DECIDE artifact
- [ ] `skills/finish/SKILL.md`, `VERSION`, and `CHANGELOG.md` are untouched
