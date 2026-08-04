# Implementation Plan: BUILD-verification member reuse after a repair

**Date:** 2026-08-03
**Design:** .docs/decisions/adr-2026-08-03-build-repair-member-reuse-validity.md
**Stories:** .docs/stories/build-repair-preserves-stale-wiring-pass-and-halts.md
**Stories status:** Accepted; TS-1–TS-5
**Conflict check:** .docs/conflicts/build-repair-preserves-stale-wiring-pass-and-halts.md
**Tier:** M
**Track:** technical (no PRD)

## Summary

Close #1249. A BUILD-verification kickback leaves a passing member in a status that the selection
predicate reads as satisfied while the gate check reads as unsatisfied, so the member is never
re-dispatched, `build_review` is then blocked by it, and the run ends with no terminal verdict. The fix
makes the group join the sole authority that declares a member satisfied: the kickback leaves every
member in one status both predicates read alike, a post-repair round dispatches every non-skipped
member instead of trusting an on-disk verdict, and the tail selection can no longer pick a step whose
own entry gate will reject a prerequisite. Reuse is not reimplemented — it stays inside each member's
existing code-state-anchored evidence, which this plan does not modify. Fifteen scoped TDD tasks
reproduce the incident, land the fix, make each member's settle decision observable, and amend the two
accepted assertions whose wording this changes.

## Technical Approach

- Reproduce the incident first as an acceptance test that seeds the divergent state and asserts the
  terminal-less park, so every later task has a RED baseline pinning the mechanism.
- Make both branches of the deterministic BUILD kickback leave every member of that round in `'stale'`
  — the one status the selection predicate reads as needing a re-run and the gate check reads as
  satisfied. Scope this strictly to the BUILD-verification branches; the rebase reset path is untouched.
- Stop excluding a BUILD-verification member from a post-repair round on the strength of an on-disk
  gate verdict. Exclusion remains available only through the existing skip rules.
- Leave each member's own evidence anchor as the sole decider of whether real verification work runs:
  `wiring_check` re-derives when its recorded head moved, and the full-suite verifier returns `REUSED`
  on a matching content fingerprint. Neither predicate, evidence format, nor fingerprint is modified.
- Apply the existing `clampToRunnablePrerequisite` at `advanceTail`'s selection site so a selected step
  is never one whose own entry gate rejects a prerequisite the selector skipped. Backward-only, same
  predicate, no new satisfaction predicate.
- Emit a per-member settle-decision event carrying the basis, declare it in the event-sink registry,
  and render it in `daemon.log` on the same path `verdict_freshness` uses.

## Prerequisites

- Approved ADR `adr-2026-08-03-build-repair-member-reuse-validity`.
- Existing Node/TypeScript stack and the Vitest suite under `src/conductor/test/`; no new external
  service, package, config key, or account.
- Existing machinery consumed unchanged: the concurrent group core and its single-writer join,
  `clampToRunnablePrerequisite` (`src/conductor/src/engine/conductor.ts`), the event-sink registry
  (`src/conductor/src/engine/event-sinks.ts`), `wiring_check`'s head-anchored evidence predicate
  (`src/conductor/src/engine/artifacts.ts`), and the content-addressed full-suite proof
  (`src/conductor/src/engine/full-suite-verifier.ts`).
- Builds on merged commit `74050ce97` (#1253), which staled the synthetic
  `build_verification__<member>` keys at dispatch; this plan does not revisit those keys.
- Test work follows `.agents/skills/write-tests/SKILL.md`: isolated temporary roots, faithful fakes at
  every third-party boundary, an injected git runner, and no real daemon or provider calls.

## Tasks

### Task 1: Reproduce the terminal-less park from the observed sequence

**Story:** TS-1
**Type:** negative-path

**Steps:**
1. Write a failing acceptance test that seeds a feature at `build` done, a BUILD-verification member
   carrying a satisfied gate verdict but a non-`done` state status, its sibling unsatisfied, and drives
   the production conductor in daemon auto mode.
2. Verify the test fails by observing the incident's shape — the sibling dispatched alone with no
   second fan-out event, a gate block naming the skipped member, and a halt marker of the class the
   daemon refuses to re-kick, carrying the terminal-less park reason.
3. Record the reproduced sequence as the test's pinned expectation with assertions written against the
   desired end state, so it stays RED until Task 2 lands.
4. Verify the test is RED for the stated reason and not for a setup error.
5. Commit with message: `test(engine): reproduce build-repair stale wiring park`.

**Files:**
- `src/conductor/test/acceptance/build-repair-preserves-stale-wiring-pass.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Reconcile the no-verdict kickback branch

**Story:** TS-1
**Type:** happy-path

**Steps:**
1. Write a failing unit test asserting that when a BUILD-verification round settles with a no-verdict
   member, every member of that round is left in the status both satisfaction predicates read alike.
2. Verify the test fails because the branch writes the status the two predicates read differently.
3. Change the no-verdict branch to write the reconciled status for every member of the round, leaving
   the mechanical-suite-failure marking and the kickback event untouched.
4. Verify the unit test and the Task 1 acceptance test both pass.
5. Commit with message: `fix(engine): reconcile no-verdict kickback member status`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** `src/conductor/src/engine/selector.ts#gateSatisfied, src/conductor/src/engine/gates.ts#checkGate`

**Dependencies:** Task 1

### Task 3: Reconcile the failing-member branch for a passing sibling

**Story:** TS-1
**Type:** happy-path

**Steps:**
1. Write a failing unit test asserting that when one member fails outright and its sibling passes, the
   passing sibling is left in the reconciled status rather than whatever it already held.
2. Verify the test fails because only failing members are marked and the passing sibling is left
   untouched — never satisfied-and-done, since only the all-green join writes that.
3. Extend the failing-member branch to place every member of that round in the reconciled status.
4. Verify the test passes and the all-green join path is unaffected.
5. Commit with message: `fix(engine): reconcile passing sibling on build kickback`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/deterministic-build-verification-group.test.ts`

**Wired-into:** same as Task 2

**Dependencies:** Task 2

### Task 4: Prove the reconciliation blocks nothing and leaves other paths alone

**Story:** TS-1
**Type:** negative-path

**Steps:**
1. Write failing tests asserting that a downstream gate check passes with a prerequisite in the
   reconciled status, that the kickback-cap halt is unchanged, that the no-op kickback escalation halt
   is unchanged, and that the rebase invalidation path's reset target and enumerated set are untouched.
2. Verify each assertion fails or passes for the right reason against the current tree.
3. Adjust only what the assertions prove wrong; the cap, escalation, and rebase paths are expected to
   need no change.
4. Verify all four assertions pass and no existing kickback, escalation, or rebase test regressed.
5. Commit with message: `test(engine): pin kickback and rebase paths unchanged`.

**Files:**
- `src/conductor/test/engine/deterministic-build-verification-group.test.ts`
- `src/conductor/test/acceptance/kickback-build-noop-escalation.acceptance.test.ts`
- `src/conductor/test/integration/rebase-loop.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 3

### Task 5: Dispatch every non-skipped member in a post-repair round

**Story:** TS-2
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test asserting that after a repair, a member carrying a satisfied gate
   verdict from an earlier round is still dispatched, and that the round's join is what declares each
   member satisfied.
2. Verify the test fails because membership excludes the member on its recorded status alone.
3. Remove the on-disk-verdict exclusion from the round's membership decision so exclusion remains
   available only through the existing skip rules.
4. Verify the test passes and both members still fan out concurrently under the existing cap.
5. Commit with message: `fix(engine): re-verify every build member after repair`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/acceptance/build-repair-preserves-stale-wiring-pass.acceptance.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor`

**Dependencies:** Task 4

### Task 6: Prove membership still honors every existing exclusion

**Story:** TS-2
**Type:** negative-path

**Steps:**
1. Write failing tests asserting that a member excluded by tier, track, upstream skip, or configuration
   is still excluded; that a round needing only one member keeps the existing width behavior; and that
   observers are never shown a member that did not dispatch.
2. Verify each assertion fails or passes for the right reason.
3. Correct only what the assertions prove wrong.
4. Verify all three pass and the existing group membership tests still pass.
5. Commit with message: `test(engine): pin group membership exclusions preserved`.

**Files:**
- `src/conductor/test/engine/conductor.test.ts`
- `src/conductor/test/acceptance/deterministic-build-verification-flow.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 5

### Task 7: Settle a dispatched member from still-valid evidence

**Story:** TS-3
**Type:** happy-path

**Steps:**
1. Write a failing acceptance test in which a repair changes nothing a member verifies, asserting the
   dispatched member settles from its own recorded evidence without redoing its full verification, and
   still counts as satisfied for the round.
2. Verify the test fails or passes for the right reason against the current tree.
3. Ensure the round surfaces each member's own settle outcome without introducing any second validity
   check over that member's evidence.
4. Verify the test passes and a repair that does invalidate the member instead derives fresh evidence.
5. Commit with message: `feat(engine): surface member settle outcome from evidence`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/acceptance/build-repair-preserves-stale-wiring-pass.acceptance.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 6

### Task 8: Prove no budget is charged and no evidence rule is altered

**Story:** TS-3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting that a member which settled from still-valid evidence charges no retry
   and no kickback budget, that a member whose evidence validity cannot be determined derives fresh
   evidence, and that each member's evidence format and validity rule is byte-for-byte unchanged.
2. Verify each assertion fails or passes for the right reason.
3. Correct only what the assertions prove wrong; the evidence predicates are expected to need no
   change.
4. Verify all three pass and the engine-computed retry budget rule is unchanged.
5. Commit with message: `test(engine): pin member evidence authority unchanged`.

**Files:**
- `src/conductor/test/wiring-check-retry-budget.test.ts`
- `src/conductor/test/wiring-evidence.test.ts`
- `src/conductor/test/engine/full-suite-verifier.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 7

### Task 9: Never select a step whose own gate rejects a prerequisite

**Story:** TS-4
**Type:** happy-path

**Steps:**
1. Write a failing test in which the selection predicate considers a prerequisite satisfied while the
   entry gate rejects it, asserting the loop dispatches that prerequisite instead of entering the step.
2. Verify the test fails because the tail selection site has no such reconciliation.
3. Apply the existing runnable-prerequisite clamp at the tail selection site, using the same predicate
   the entry check uses, backward-only and bounded exactly as at resume entry.
4. Verify the test passes and the originally selected step is entered normally once the prerequisite is
   fresh.
5. Commit with message: `fix(engine): clamp tail selection to a runnable prerequisite`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/resume-verdict-clamp.test.ts`

**Wired-into:** `src/conductor/src/engine/gates.ts#checkGate`

**Dependencies:** Task 4

### Task 10: Prove the selection guard is inert when the predicates agree

**Story:** TS-4
**Type:** negative-path

**Steps:**
1. Write failing tests asserting that when both predicates consider a prerequisite unsatisfied the
   existing blocking behavior is unchanged, that a prerequisite dispatching cannot fix yields an
   explicit terminal verdict naming it rather than a missing marker, that the guard is bounded and
   cannot loop, and that no third satisfaction predicate was introduced.
2. Verify each assertion fails or passes for the right reason.
3. Correct only what the assertions prove wrong.
4. Verify all four pass and the daemon backstop park is not reachable from this path.
5. Commit with message: `test(engine): pin selection guard negative paths`.

**Files:**
- `src/conductor/test/engine/resume-verdict-clamp.test.ts`
- `src/conductor/test/acceptance/build-repair-preserves-stale-wiring-pass.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 9

### Task 11: Emit each member's settle decision and its basis

**Story:** TS-5
**Type:** happy-path

**Steps:**
1. Write failing tests asserting that a member settling from valid evidence and a member deriving fresh
   evidence each emit a decision event naming the member, the decision, and the basis, and that both
   types are declared in the event sink registry and reach a sink.
2. Verify the tests fail because the event types do not exist.
3. Add the event types, declare them in the registry so its totality holds, and emit them from the
   group join using each member's own settle outcome.
4. Verify the tests pass and the registry totality check still passes.
5. Commit with message: `feat(events): emit build member settle decisions`.

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/event-persister.test.ts`

**Wired-into:** `src/conductor/src/engine/event-persister.ts#EventPersister, src/conductor/src/daemon-cli.ts#renderDaemonEventUnsafe`

**Dependencies:** Task 7

### Task 12: Render the settle decision in the daemon log

**Story:** TS-5
**Type:** happy-path

**Steps:**
1. Write a failing test asserting both decision events render a readable line carrying the member, the
   decision, and the basis, with no secret, credential, or absolute host path.
2. Verify the test fails because the renderer has no arm for the new types.
3. Add the render arm alongside the existing verdict-freshness arm, reusing its redaction conventions.
4. Verify the test passes and the existing render-set reconciliation test still passes.
5. Commit with message: `feat(daemon): render build member settle decisions`.

**Files:**
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/acceptance/staleness-decisions-invisible-in-daemon-log.acceptance.test.ts`

**Wired-into:** same as Task 11

**Dependencies:** Task 11

### Task 13: Keep the sink-membership equivalence assertion valid

**Story:** TS-5
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that the existing equivalence assertion between derived subscription
   sets and the pre-refactor membership still holds for the types it was written to cover, with the new
   types accounted for rather than snapshotted away.
2. Verify the assertion's current form either passes or fails, and record which.
3. Re-scope the assertion to the types it covers if and only if the previous step proved a whole-set
   snapshot breaks on an additive type; never delete the assertion.
4. Verify the re-scoped assertion passes and still fails when a type is genuinely dropped from a sink.
5. Commit with message: `test(events): scope sink membership equivalence to covered types`.

**Files:**
- `src/conductor/test/engine/event-sinks.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 11

### Task 14: Verify the two accepted-assertion amendments already delivered

**Story:** none (infrastructure: keep the accepted story corpus truthful in the same change set that changes the behavior it pins, per this repository's precedent for refining a pinned assertion)
**Type:** infrastructure

**Already delivered — do not re-edit.** Both story amendments and their test updates landed in
commit `98b021789`, and the operator rotated the protected-artifact seal for both story files on
2026-08-04 after reviewing the diff. Amending an accepted `.docs/` artifact is DECIDE's
responsibility, not a BUILD task's (#1293); this task is now verification only. Do NOT edit
anything under `.docs/` here, and do NOT treat the `.docs/` entries below as work to perform —
they are listed so build review can match them to the commit that already contains them.

**Steps:**
1. Verify `.docs/stories/deterministic-test-suite-step.md` carries the dated width-1 ordering
   amendment (a round may run a single member; declared member order and the
   wait-for-all-dispatched rule unchanged).
2. Verify `.docs/stories/2026-07-12-wiring-reachability-gate.md` carries the dated
   selector-divergence amendment (dispatch-the-prerequisite rather than block-and-return, with
   review still not entered).
3. Verify the corresponding test assertions match the amended shapes and pass.
4. Verify no other pinned assertion was edited.
5. No commit required — this task's work is already committed as `98b021789`.

**Files:**
- `.docs/stories/deterministic-test-suite-step.md`
- `.docs/stories/2026-07-12-wiring-reachability-gate.md`
- `src/conductor/test/acceptance/deterministic-build-verification-flow.acceptance.test.ts`
- `src/conductor/test/wiring-gate-loop.test.ts`

**Verify-only:** yes

**Wired-into:** none (no new production surface)

**Dependencies:** Task 12

### Task 15: Update the canonical affected documentation

**Story:** none (infrastructure: keep the canonical gate, step, artifact, daemon, and runbook pages truthful about member re-verification and reuse in the same PR that changes them)
**Type:** infrastructure

**Steps:**
1. Update the build-verification group section to state that a post-repair round re-verifies every
   non-skipped member and that reuse is decided by each member's own evidence.
2. Update the gate catalog and evidence pages to state that a gate verdict on disk is not by itself
   authority to skip a member.
3. Update the artifact reference with the new event types, and the daemon guide plus the
   stalled-feature runbook to describe the settle-decision line and the retired terminal-less park path.
4. Verify the documentation smoke checks and the full harness integrity suite pass.
5. Commit with message: `docs: describe post-repair build member re-verification`.

**Files:**
- `docs/reference/steps.md`
- `docs/explanation/gates.md`
- `docs/reference/artifacts.md`
- `docs/guides/running-the-daemon.md`
- `docs/runbooks/stalled-or-stuck-feature.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 14

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
                        7 → 11 → 12 → 14 → 15
                             11 → 13
            4 → 9 → 10
```

## Integration Points

- After Task 4: the observed incident is green and a BUILD kickback can no longer create the status
  divergence. This is the smallest shippable increment and is worth verifying on its own.
- After Task 6: the group join is the sole authority that declares a member satisfied, with every
  pre-existing exclusion rule intact.
- After Task 8: reuse is proven to live in each member's own evidence, costing no budget and altering
  no evidence contract.
- After Task 10: the selection predicate and the gate predicate can no longer disagree their way into a
  run that ends without a terminal verdict.
- After Task 13: an operator can read each member's settle decision and basis from the daemon log, and
  the sink registry's guarantees are intact.
- Tasks 14 and 15 own the corpus and documentation contracts; both land in the same change set, never
  afterwards.

## Acceptance Coverage

| Story criterion group | Owning tasks |
|---|---|
| TS-1 reconciled status on both kickback branches | 2, 3 |
| TS-1 repaired build rejoins and does not park | 1, 2 |
| TS-1 no downstream block; halts and rebase path unchanged | 4 |
| TS-2 post-repair round dispatches every non-skipped member | 5 |
| TS-2 stale satisfied verdict does not exclude a member | 5 |
| TS-2 existing skip rules, width behavior, and truthful member list preserved | 6 |
| TS-3 member settles from still-valid evidence; invalidated evidence re-derives | 7 |
| TS-3 no budget charged; indeterminate evidence re-derives; evidence rules unchanged | 8 |
| TS-4 selected step never rejects a selector-satisfied prerequisite | 9 |
| TS-4 agreement case unchanged; non-resolvable explicit; bounded; no new predicate | 10 |
| TS-5 settle decisions emit events with their basis and reach a sink | 11 |
| TS-5 existing sink-membership equivalence assertion stays valid | 13 |
| TS-5 decisions render in the daemon log without secrets | 12 |

## Verification

- [x] Every accepted happy path maps to at least one task.
- [x] Every accepted negative path maps to an explicit behavior-owning task.
- [x] Every task declares dependencies and the graph is acyclic.
- [x] Every new production surface declares a design-derived `Wired-into:` contract.
- [x] No terminal catch-all validation task exists; Tasks 14 and 15 own the corpus and documentation
      contracts only.
- [x] The reproduction test is Task 1 and every fix task depends on it transitively.
- [x] No task adds a gate-verdict field, a config key, a third satisfaction predicate, or a second
      validity authority over a member's evidence.
- [x] Task count is 15, within the normal 1–20 range.
