# Implementation Plan: Recoverable build review when the blocker is mechanical, not judgement

**Date:** 2026-08-18
**Design:** [PRD](../specs/2026-08-18-review-infrastructure-failures-are-operator-unreco.md)
**Stories:** .docs/stories/review-infrastructure-failures-are-operator-unreco.md
**Conflict check:** Clean as of 2026-08-18 — `.docs/conflicts/2026-08-18-review-infrastructure-failures-are-operator-unreco.md`
**ADR:** [mechanical rubric faults are their own lane](../decisions/adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane.md) (APPROVED)

## Summary

Twenty tasks that split mechanical rubric faults out of the semantic review lane: a fault retries
without publishing a verdict or charging the kickback budget, terminates on its own bounded
allowance, and is then cleared by a new operator-only reduced-coverage decision recorded in the
existing disposition store.

## Technical Approach

Four seams, in dependency order. The ordering is a hard requirement from the architecture review's
Condition 1, not a preference.

**1. Preserve the fault's cause (ADR D2) — first, because everything downstream keys on it.**
`build-review-coordinator.ts` types a branch's `reason` as free `string`, and
`step-runners.ts` currently folds every non-cache branch into
`{ reason: 'provider-error', detail: \`${branch.reason}: ${branch.detail}\` }`. The real cause —
including the tautology preflight's own closed 13-member set — survives only in free text.
`BuildReviewInfrastructureFailureReason` in `build-review-domain.ts` is already a closed
eight-member vocabulary with an unused `preflight-failed` member. Task 1 introduces a total,
exhaustive mapping from branch reason to closed cause with no catch-all, so the identity in seam 3
can discriminate. Landing seam 3 on today's mapping would silently produce a decision far broader
than the ADR describes.

**2. Route on kind, and stop charging (D1, D3, D4, D5).** The mechanical test moves from the
`detail`-prefix match at `step-runners.ts:1830` to `result.kind === 'infrastructure-failure'`. With
allowance remaining, the step returns failure and publishes no aggregate, so completion classifies
the verdict `absent` and re-runs — the path `adr-2026-07-13` established and `adr-2026-08-16` D3
already extended to contract violations. `consumeKickbackBudget` is never reached, which is why no
counter needs a new exemption branch. The termination obligation is discharged by a mechanical
allowance on the ledger entry, checked in `conductor.ts`, terminating in a `needs-human` halt.

**3. The decision (D6, D7).** A second record kind in `.pipeline/build-review-dispositions.json`,
under the same lease, same atomic writer, same authority gate as finding acceptance — and a
*separate* CLI action, because `adr-2026-08-13` §4 decides that `accept` refuses infrastructure
failures and that one action accepts exactly one finding. Identity is `{rubric, closed reason}`;
nothing free-text enters it.

**4. The reducer and the evidence (D8, D9, D10).** One relaxation in
`deriveEffectiveBuildReviewVerdict`: an infrastructure branch with a matching decision leaves the
blocking set. `unresolvedFindingIds` is untouched. Rendering reuses `adr-2026-08-13` §6's single
renderer for the retained PR and the shipped record, inheriting its fail-closed rule.

**Local pattern context.** The ledger work should follow the shape `kickback-ledger.ts` already uses
for `cumulative`: an optional field on the persisted type, folded to a default in a normalize step so
a legacy entry reads clean rather than being rejected, with the bump function pure and the I/O
wrapper thin. Preserve those traits — optional-on-read, defaulted-on-normalize, pure bump — and vary
freely on naming and on where the ceiling constant lives. Find the comparable code by searching
`kickback-ledger.ts` for the persisted-entry type and its normalize helper. The disposition-store
work should follow the same file's sibling pattern in `build-review-dispositions.ts`: a strict
`parse*` per record shape returning `undefined` on any deviation, exact-key checks, and validation
before the lease is taken. Tasks affected repeat the relevant traits in their own steps.

**Concurrent work — read before editing the ledger.** `the-engine-cannot-detect-its-own-spinning-operator`
(#1652) is a merged, unbuilt spec whose plan adds `rubricFailures` to the same `KickbackGateEntry`
and amends the same `isKickbackGateEntry`. Both additions are additive and read-tolerant, so they
co-exist — but Task 5 must read the current entry shape at implementation time rather than trust this
plan's description of it.

**Not covered by a task, deliberately.** The end-to-end resumption path in Story 10 (terminal state →
recorded decision → documented halt clear → re-dispatch → PASS) is a story-level acceptance concern
authored by `/writing-system-tests` at BUILD entry, not an implementation task. The runbook entry for
the new recovery path is owned by this repository's documentation-maintenance step.

## Prerequisites

- None external. All four seams exist in `src/conductor/src/engine/`.

## Tasks

### Task 1: Total branch-reason to closed-cause mapping
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: a coordinator branch whose reason is the tautology preflight's
   `missing-merge-base-file` produces a result whose closed cause is `preflight-failed`, and a branch
   reason naming an artifact write failure produces an artifact-class cause — neither collapses to
   `provider-error`.
2. Verify test fails (RED).
3. Implement a mapping from every coordinator branch reason to a member of
   `BuildReviewInfrastructureFailureReason`, exhaustive at the type level with no `default` arm, and
   call it where the result is constructed. Keep the specific sub-reason in `detail` for the report.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): preserve the closed infrastructure cause across the branch boundary".

**Files:**
- `src/conductor/src/engine/build-review-domain.ts` — mapping and its exhaustiveness
- `src/conductor/src/engine/step-runners.ts` — construct the result through the mapping
- `src/conductor/test/engine/build-review-domain.test.ts` — mapping tests

**Dependencies:** none

### Task 2: An unmapped reason is a contract defect, and no free text enters the cause
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a branch reason with no mapping is surfaced as a contract defect rather than
   recorded as `provider-error`; and the derived cause is byte-identical for two branches whose
   `detail` differs but whose reason class is the same.
2. Verify tests fail (RED).
3. Implement the defect surface and assert no `detail` is read when deriving the cause.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): unmapped branch reasons fail loudly; cause excludes free text".

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 3: Route the mechanical lane on result kind
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a lap with one infrastructure-failure result and three clean judged results
   takes the mechanical branch regardless of the fault's `detail` text — including a `detail` that
   does not match today's `judged-result contract not satisfied after one repair turn:` prefix.
2. Verify test fails (RED).
3. Replace the `detail`-prefix match in the build_review step runner with a check on
   `result.kind === 'infrastructure-failure'`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): classify mechanical faults by result kind, not detail text".

**Files:**
- `src/conductor/src/engine/step-runners.ts` — mechanical classification
- `src/conductor/test/engine/build-review-isolation.test.ts` — classification tests

**Dependencies:** Task 1

### Task 4: Judged, skipped and malformed results are not mechanical
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: a judged finding whose prose describes an environment problem still routes as
   a finding and blocks; a skipped rubric consumes no mechanical allowance; an unparseable result is
   rejected as malformed rather than classified mechanical.
2. Verify tests fail (RED).
3. Implement the guards needed for the three cases.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): only an infrastructure-failure result enters the mechanical lane".

**Files:** same as Task 3

**Dependencies:** Task 3

### Task 5: Mechanical allowance on the ledger entry, tolerant of legacy state
**Story:** 13
**Type:** happy-path, negative-path

**Steps:**
1. Read the current `KickbackGateEntry` and `isKickbackGateEntry` before editing — #1652 may have
   added `rubricFailures` to both by the time this runs; both fields are additive and co-exist.
2. Write failing tests: an entry written without the mechanical counter loads clean with the counter
   folded to a fresh count; a counter present but not a valid count is treated as corrupt consistent
   with the file's existing handling, never as unlimited allowance.
3. Verify tests fail (RED).
4. Implement following the file's own `cumulative` pattern — optional on the persisted type, defaulted
   in the normalize step, pure bump — varying freely on naming.
5. Verify tests pass (GREEN).
6. Commit: "feat(kickback-ledger): mechanical fault allowance with legacy read tolerance".

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts` — entry shape, normalize, bump
- `src/conductor/test/engine/kickback-ledger.test.ts` — legacy and corrupt-state tests

**Dependencies:** Task 3

### Task 6: Allowance advances on a mechanical lap and is credited by an invalidating rebase
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: the allowance advances once per mechanical lap and reaches its declared
   ceiling; a `build_review` PASS does NOT clear it; a rebase that invalidated `build_review`
   credits it back, per `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D6.
2. Verify tests fail (RED).
3. Implement the advance and the declared ceiling constant. Do NOT add a PASS reset: that ADR
   removes the cumulative reset this task previously sat beside, and states the no-PASS-reset rule
   over every lap-counting field on the entry. The credit helper it adds is generic over those
   fields, so the allowance is credited by it without a further call site here — verify that rather
   than re-implementing it.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): bound mechanical re-attempts with a rebase-credited allowance".

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts` — ceiling, and the allowance's participation in the
  generic credit
- `src/conductor/test/engine/kickback-ledger.test.ts` — advance, no-PASS-clear, credited-by-rebase

**Note (amended 2026-08-18):** this task previously instructed adding a PASS reset "beside the
existing cumulative reset". That reset is deleted by `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`
(#1694), whose D6 settles the reset rule for the whole ledger entry on operator decision. If that
feature has not landed when this task runs, read `kickback-ledger.ts` as current and implement the
advance and ceiling only — never add a PASS reset.

**Dependencies:** Task 5

### Task 7: A mechanical lap publishes no aggregate and re-runs the review
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: with allowance remaining, a lap containing a mechanical fault writes no
   `.pipeline/build-review.json` for that lap and the step returns failure, so completion classifies
   the verdict `absent` and build_review re-runs.
2. Verify test fails (RED).
3. Implement the early return before aggregate publication, gated on remaining allowance.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): a mechanical fault re-runs instead of publishing a FAIL".

**Files:**
- `src/conductor/src/engine/step-runners.ts` — pre-publication return
- `src/conductor/test/engine/build-review-verdict.test.ts` — no-publish and re-run tests

**Dependencies:** Task 5

### Task 8: No rework is dispatched and no stale outcome is authority
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: a mechanical lap dispatches no rework and produces no rework hint; a previous
   lap's aggregate left on disk is not read as this lap's result.
2. Verify tests fail (RED).
3. Implement, re-deriving from the current lap's own join per
   `adr-2026-08-03-build-repair-member-reuse-validity`.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): a mechanical lap dispatches no rework and reuses no stale verdict".

**Files:** same as Task 7

**Dependencies:** Task 7

### Task 9: The semantic allowance is untouched, except on a mixed lap
**Story:** 3
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: the durable kickback state is byte-identical across a mechanical lap, in
   every field, and across several consecutive mechanical laps; and a lap carrying both a mechanical
   fault and an unresolved judged finding IS charged as a judged failure.
2. Verify tests fail (RED).
3. Implement whatever guard the mixed case needs so a mechanical fault alongside a real finding does
   not buy a free lap.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): mechanical laps never charge the semantic budget; mixed laps do".

**Files:**
- `src/conductor/src/engine/step-runners.ts` — mixed-lap classification
- `src/conductor/test/engine/cumulative-kickback-bound.test.ts` — budget-invariance tests

**Dependencies:** Task 7

### Task 10: Exhaustion publishes the fault and halts for a human
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: when the allowance is exhausted the lap publishes its aggregate and the run
   terminates with a `needs-human` halt rather than re-running.
2. Verify test fails (RED).
3. Implement the exhaustion branch in the conductor's build_review handling, writing the halt with
   class `needs-human` — the class the daemon's re-kick sweep does not auto-clear.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): exhausted mechanical allowance halts for a human".

**Files:**
- `src/conductor/src/engine/conductor.ts` — exhaustion branch and halt
- `src/conductor/test/engine/build-review-halt-wiring.test.ts` — exhaustion tests

**Dependencies:** Task 6

### Task 11: The halt names the cause and both resumption steps
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: the halt body names the rubric, the closed cause, the bounded diagnostic, the
   allowance consumed, and both resumption steps in order — record a reduced-coverage decision, then
   clear the terminal state by the documented recovery; mechanical faults on different rubrics across
   successive laps all count toward the same bound; and the body states only what was observed, never
   that the run cannot converge.
2. Verify tests fail (RED).
3. Implement as a pure renderer over the ledger entry and the current lap, returning prose to the
   existing halt-marker call site.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): render the mechanical halt with its cause and both resumption steps".

**Files:** same as Task 10

**Dependencies:** Task 10

### Task 12: A reduced-coverage record kind with a closed identity
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests: a reduced-coverage record is stored with rubric, closed cause, rationale,
   operator and time; its identity is derived from rubric and closed cause only; the record survives
   removal of the review's own aggregate file and a fresh process.
2. Verify tests fail (RED).
3. Implement as a discriminated union member of the stored record — never an optional field on the
   finding record — following the file's existing pattern: a strict `parse*` returning `undefined` on
   any deviation, exact-key checks, validation before the lease is taken.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): durable reduced-coverage decisions keyed on rubric and cause".

**Files:**
- `src/conductor/src/engine/build-review-dispositions.ts` — record kind, parse, append
- `src/conductor/test/engine/build-review-dispositions.test.ts` — persistence and identity tests

**Dependencies:** Task 2

### Task 13: Store-level refusals and scope isolation
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests: a blank or whitespace-only rationale is refused with nothing stored;
   unreadable or unwritable state is refused and leaves the review blocking; a decision for one rubric
   does not cover another rubric, another cause class, or another feature.
2. Verify tests fail (RED).
3. Implement the refusals and the scoping predicate.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): reduced-coverage refusals and cross-scope isolation".

**Files:** same as Task 12

**Dependencies:** Task 12

### Task 14: The operator action and its authority gate
**Story:** 8
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: at an interactive terminal with a resolvable local operator, the action
   records the decision and stores the operator identity; a non-interactive caller is refused with
   nothing stored and an observable refusal; an unresolvable identity is refused.
2. Verify tests fail (RED).
3. Implement as a new action in the existing pre-boot `build-review` command family, reusing the
   TTY-plus-operator-identity gate that finding acceptance already applies — checked before any
   artifact or store access. The action's callable interface is fixed by ADR D6 (amended
   2026-08-19) and is exactly:
   `conduct-ts build-review record-reduced-coverage --feature <slug> --lap <lap> --rubric <rubric> --rationale <text>`
   — `--lap` carries `accept`'s exact-current-lap semantics and makes D6's stale-review refusal
   reachable; the closed reason is derived per D7, never an argument.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): operator-only reduced-coverage action".

**Files:**
- `src/conductor/src/engine/build-review-cli.ts` — the action and its gate
- `src/conductor/src/engine/cli-builtins.ts` — command registration
- `src/conductor/test/engine/build-review-cli.test.ts` — authority tests
- `docs/reference/cli.md` — document the action under `conduct-ts build-review`

**Dependencies:** Task 12

### Task 15: The action refuses every state that is not an exhausted mechanical fault
**Story:** 9
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: accepted for a rubric currently in an exhausted mechanical-fault state;
   refused for a judged rubric, a skipped rubric, a rubric with allowance remaining, a duplicate
   decision, an unknown rubric name, and a review that changed while the operator was deciding — each
   refusal stating its reason and leaving state unchanged.
2. Verify tests fail (RED).
3. Implement the state predicate under the existing lease, validating against the current lap.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): reduced-coverage is refused outside an exhausted mechanical fault".

**Files:** same as Task 14

**Dependencies:** Task 14

### Task 16: The reducer honors a matching reduced-coverage decision
**Story:** 10
**Type:** happy-path

**Steps:**
1. Write failing test: with every mechanical fault covered and every finding resolved or accepted,
   the effective verdict is PASS, resolved from current state under the existing lease rather than
   from a prior lap's file.
2. Verify test fails (RED).
3. Implement exactly one relaxation in `deriveEffectiveBuildReviewVerdict`: a covered infrastructure
   branch no longer contributes to the blocking set. Leave `unresolvedFindingIds` untouched.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): covered mechanical faults no longer block the effective verdict".

**Files:**
- `src/conductor/src/engine/build-review-aggregate.ts` — the reducer relaxation
- `src/conductor/src/engine/build-review-effective.ts` — pass the decisions through
- `src/conductor/test/engine/build-review-effective.test.ts` — reducer tests

**Dependencies:** Task 12, Task 5

### Task 17: Findings still block, and the two decision kinds cannot substitute
**Story:** 10
**Story:** 11
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: one covered and one uncovered mechanical fault still FAILs; an unresolved
   finding still FAILs even when a decision names its rubric; a review where every rubric faulted and
   all were covered still FAILs because nothing was judged; malformed decision state fails closed;
   finding acceptance still refuses a mechanical fault; the reduced-coverage action refuses a finding;
   and a full-coverage review's derivation and report are unchanged from today.
2. Verify tests fail (RED).
3. Implement the guards these require.
4. Verify tests pass (GREEN).
5. Commit: "test(build-review): finding primacy and decision-kind separation".

**Preserves:** an unresolved judged finding blocks the effective verdict

**Files:** same as Task 16

**Dependencies:** Task 16

### Task 18: The findings report shows what could not run
**Story:** 6
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: the report names the rubric, cause and diagnostic for an exhausted mechanical
   fault and distinguishes it from unresolved findings, so a review blocked only by a fault no longer
   reads as a failing verdict with nothing unresolved; a review with no mechanical faults produces
   output identical to today; unreadable state is reported as unavailable rather than as an empty view.
2. Verify tests fail (RED).
3. Implement in the existing report renderer, in both human and machine output.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): report exhausted mechanical faults alongside findings".

**Files:**
- `src/conductor/src/engine/build-review-cli.ts` — report rendering
- `src/conductor/test/engine/build-review-cli.test.ts` — report tests

**Dependencies:** Task 15

### Task 19: Reduced coverage reaches the lap evidence and the shipped record
**Story:** 12
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: a lap that passed with a decision in force records rubric, cause, current
   diagnostic, operator, rationale and time on its evidence, and the same entry appears on the shipped
   record from the same renderer; a known decision that cannot be rendered blocks publication rather
   than shipping a record without it; no decision produces no section; unreadable state fabricates
   nothing.
2. Verify tests fail (RED).
3. Implement through the existing accepted-risk renderer and its shared data contract, inheriting its
   fail-closed rule.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): stamp reduced coverage on lap evidence and the shipped record".

**Files:**
- `src/conductor/src/engine/artifacts.ts` — evidence details
- `src/conductor/src/engine/build-review-projections.ts` — shared render contract
- `src/conductor/test/engine/build-review-projections.test.ts` — rendering tests

**Dependencies:** Task 16

### Task 20: Occurrences ride the existing event spine
**Story:** 7
**Story:** 8
**Type:** happy-path, negative-path

**Steps:**
1. Write failing tests: a mechanical lap, an allowance exhaustion, a reduced-coverage acceptance and
   a reduced-coverage refusal each emit on the existing bus, with the standalone action writing
   through the existing external same-schema writer; no new ledger file is created.
2. Verify tests fail (RED).
3. Implement by extending the existing event union and reusing
   `build_review_rubric_infrastructure_failure` where it already fits; register the sink decision
   explicitly.
4. Verify tests pass (GREEN).
5. Commit: "feat(build-review): emit mechanical-lane occurrences on the existing spine".

**Files:**
- `src/conductor/src/engine/events.ts` — event members
- `src/conductor/src/engine/closeout-events.ts` — external writer allowlist
- `src/conductor/test/engine/build-review-halt-wiring.test.ts` — emission tests

**Dependencies:** Task 14, Task 10

## Task Dependency Graph

```
Task 1 ──┬─> Task 2 ──> Task 12 ──┬─> Task 13
         │                        ├─> Task 14 ──┬─> Task 15 ──> Task 18
         │                        │             └─> Task 20
         └─> Task 3 ──┬─> Task 4  └─> Task 16 ──┬─> Task 17
                      └─> Task 5 ──┬─> Task 6 ──> Task 10 ──┬─> Task 11
                                   │                        └─> Task 20
                                   └─> Task 7 ──┬─> Task 8
                                                └─> Task 9
                            Task 5 ──────────────> Task 16
```

## Integration Points

- **After Task 9** — the whole budget-accounting half is testable end to end: a repeating mechanical
  fault re-runs the review, leaves the semantic budget untouched, and dispatches no rework.
- **After Task 11** — the terminal state is complete: the run halts for a human naming the cause and
  both resumption steps.
- **After Task 17** — the recovery half is complete: a recorded decision unblocks the review while
  every finding guarantee holds.
- **After Task 19** — the full path is observable by a later reader on the shipped record.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Condition 1 honored: the cause-preserving mapping (Tasks 1–2) precedes the identity work (Task 12)

## Coverage Check

| Story | Task(s) | Paths covered |
|---|---|---|
| 1 | 3, 4 | happy (3), negative (4) |
| 2 | 1, 2 | happy (1), negative (2) |
| 3 | 9 | happy and negative (9) |
| 4 | 7, 8 | happy (7), negative (8) |
| 5 | 6, 10, 11 | happy (6, 10), negative (11) |
| 6 | 18 | happy and negative (18) |
| 7 | 12, 13, 20 | happy (12, 20), negative (13) |
| 8 | 14, 20 | happy and negative (14), negative (20) |
| 9 | 15 | happy and negative (15) |
| 10 | 16, 17 | happy (16), negative (17) |
| 11 | 17 | happy and negative (17) |
| 12 | 19 | happy and negative (19) |
| 13 | 5 | happy and negative (5) |
