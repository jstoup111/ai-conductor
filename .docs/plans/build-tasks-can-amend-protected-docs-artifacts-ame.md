# Implementation Plan: Amendment of accepted `.docs/` artifacts belongs to DECIDE

**Date:** 2026-08-04
**Design:** .docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md
**Stories:** .docs/stories/build-tasks-can-amend-protected-docs-artifacts-ame.md
**Stories status:** Accepted; TS-1–TS-6
**Conflict check:** .docs/conflicts/build-tasks-can-amend-protected-docs-artifacts-ame.md
**Architecture:** .docs/architecture/build-tasks-can-amend-protected-docs-artifacts-ame.md
**Tier:** M
**Track:** technical (no PRD)
**Refs:** jstoup111/ai-conductor#1293

## Summary

Close #1293. DECIDE correctly detects that a change falsifies an accepted assertion and then has no
sanctioned way to act on it, so it emits a plan task pointing BUILD at a sealed artifact — the one
phase forbidden to touch it. This plan makes the amendment a DECIDE-time act performed in place before
the seal baseline exists, rejects any plan that directs the amendment elsewhere at two deterministic
checkpoints, and gives a mid-BUILD discovery a recorded, non-blocking route with a SHIP-side
fail-closed backstop on silence.

Nothing about the seal's fingerprinting, schema, or three existing tolerances changes. The enforcement
reuses `parsePlanTaskPaths` and the seal module's own directory set and own-feature predicate rather
than restating either, so a future change to what "sealed" means propagates without a second edit.

## Technical Approach

The load-bearing mechanism already exists: the seal baseline is created at first BUILD entry
(`conductor.ts:4677`). An amendment committed during DECIDE is therefore *in* the baseline, not a
deviation from it — which is why this needs no new tolerance, no rotation, and no reseal command, and
does not depend on #1281.

Three surfaces, in dependency order:

1. **A deterministic scan** (`plan-protected-targets.ts`) mapping each plan task to its resolved
   `**Files:**` set and rejecting any path under the four sealed directories whose stem does not name
   the plan's own feature. Exposed as a blocking CLI command for authoring time and called directly by
   the land gate.
2. **An amendment ledger** at `.docs/amendments/<plan-stem>.md` — deliberately outside the sealed set
   and on the `.docs` write allowlist, so DECIDE can record intent and BUILD can record a late
   discovery without tripping the seal.
3. **Skill and rule updates** across every skill that can direct a mutation, plus `HARNESS.md`. The
   engine checks are the enforcement; the skill text is the instruction that keeps agents from
   authoring a rejection in the first place.

Enforcement is mechanical, never LLM-judged: "is this path under a sealed directory and not this
feature's" is set membership with an authoritative answer already in the engine.

## Prerequisites

- None. This plan is independent of #1281 by design, and does not modify the seal's verification path.

## Tasks

### Task 1: Pin the observed violation as a failing scan

**Story:** TS-2
**Type:** happy-path

**Steps:**
1. Write a failing test that builds a plan fixture in the shape of the observed incident: a plan whose
   stem is one feature and whose task 14 `**Files:**` line names two `.docs/stories/` files belonging
   to other features.
2. Assert the scan reports a violation naming the task id `14` and both story paths.
3. Verify the test fails because the scan module does not yet exist (RED).
4. Commit with message: `test(plan-targets): pin the observed sealed-artifact task as a violation`.

**Files:**
- `src/conductor/test/engine/plan-protected-targets.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Export the engine's sealed-directory set and own-feature predicate

**Story:** TS-2
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting `PROTECTED_ARTIFACT_DIRECTORIES` and `namesOwnFeature` are importable
   from the seal module.
2. Change `PROTECTED_ARTIFACT_DIRECTORIES` and `namesOwnFeature` from module-private to exported in
   `protected-artifact-seal.ts`. Change no behavior, no call site, and no other declaration.
3. Verify the existing seal test suite still passes unchanged — this task must be provably inert.
4. Commit with message: `refactor(seal): export the sealed-directory set and own-feature predicate`.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

**Wired-into:** none (no new production surface; widens existing declarations' visibility only)

**Dependencies:** none

### Task 3: Implement the protected-target scan

**Story:** TS-2
**Type:** happy-path

**Steps:**
1. Create `plan-protected-targets.ts` exporting `scanPlanProtectedTargets`, taking the plan text and
   the plan stem and returning one violation record per offending (task id, path) pair.
2. Derive the task→paths map with `parsePlanTaskPaths` — do not write a second parser.
3. Judge each path with the directory set and own-feature predicate exported in Task 2 — do not
   restate either.
4. Verify Task 1's test now passes (GREEN) and reports every violation, not only the first.
5. Commit with message: `feat(plan-targets): reject plan tasks naming another feature's sealed artifact`.

**Files:**
- `src/conductor/src/engine/plan-protected-targets.ts`
- `src/conductor/test/engine/plan-protected-targets.test.ts`

**Wired-into:** `src/conductor/src/engine/plan-protected-targets.ts#parsePlanTaskPaths`

**Dependencies:** Task 1, Task 2

### Task 4: Prove the scan's exemptions

**Story:** TS-2
**Type:** negative-path

**Steps:**
1. Write failing tests for each case that must PASS: a task naming a sealed path whose stem names the
   plan's own feature; a task naming a `.docs/` path outside the four sealed directories; a task
   naming only ordinary source paths; a plan with no violations at all.
2. Assert the clean cases produce an empty violation list and that the scan writes nothing and mutates
   no file.
3. Verify the tests pass against Task 3's implementation, adjusting the implementation only if a case
   genuinely fails.
4. Commit with message: `test(plan-targets): pin own-feature, unsealed, and clean-plan exemptions`.

**Files:**
- `src/conductor/test/engine/plan-protected-targets.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Task 3

### Task 5: Judge inherited file sets on their resolved value

**Story:** TS-2
**Type:** negative-path

**Steps:**
1. Write a failing test where a task declares `same` or `same as Task N` and the inherited set contains
   another feature's sealed path.
2. Assert the inheriting task is itself reported as a violation, carrying its own task id.
3. Confirm the resolution comes from `parsePlanTaskPaths`'s existing inheritance handling rather than
   new logic in the scan.
4. Verify the test passes (GREEN).
5. Commit with message: `test(plan-targets): judge same/same-as-Task-N sets on their resolved paths`.

**Files:**
- `src/conductor/test/engine/plan-protected-targets.test.ts`
- `src/conductor/src/engine/plan-protected-targets.ts`

**Wired-into:** same as Task 3

**Dependencies:** Task 3

### Task 6: Expose the scan as a blocking CLI command

**Story:** TS-2
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the command exits non-zero on a violating plan and zero on a clean
   one, and that its output names every offending task id and path.
2. Register the command in `cli.ts` alongside the existing `overlap-scan` registration, reading only
   and writing nothing.
3. Verify the exit codes and message content (GREEN).
4. Commit with message: `feat(cli): add the blocking protected-target plan check`.

**Files:**
- `src/conductor/src/cli.ts`
- `src/conductor/test/engine/plan-protected-targets.test.ts`

**Wired-into:** `src/conductor/src/cli.ts#scanPlanProtectedTargets`

**Dependencies:** Task 3

### Task 7: Refuse a landing spec whose plan directs a sealed-artifact edit

**Story:** TS-3
**Type:** happy-path

**Steps:**
1. Write a failing test that lands a spec whose plan contains a violating task and asserts the land is
   refused with a message naming the task id and path.
2. Call the scan inside `land-spec.ts`'s existing gate sequence, after the plan-content gate and
   without reordering any existing gate.
3. Verify the land is refused (GREEN) and that the existing keep-on-failure worktree behavior applies
   unchanged.
4. Commit with message: `feat(land): refuse a spec whose plan targets a sealed artifact`.

**Files:**
- `src/conductor/src/engine/engineer/land-spec.ts`
- `src/conductor/test/engine/engineer/land-spec.test.ts`

**Wired-into:** `src/conductor/src/engine/engineer/land-spec.ts#scanPlanProtectedTargets`

**Dependencies:** Task 3

### Task 8: Prove the land gate's blast radius

**Story:** TS-3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: a clean spec still lands; the gate runs for an S-tier spec as well as
   M and L; and every pre-existing land gate still fires for its own reasons in its original order.
2. Assert no historical or previously merged plan is consulted — the gate reads only the spec being
   landed.
3. Verify all cases pass (GREEN).
4. Commit with message: `test(land): pin tier-independence and unchanged gate ordering`.

**Files:**
- `src/conductor/test/engine/engineer/land-spec.test.ts`

**Wired-into:** same as Task 7

**Dependencies:** Task 7

### Task 9: Make the amendment directory writable and prove it is unsealed

**Story:** TS-4
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a write to a path under the amendment directory is classified as
   allowed during BUILD for any step, and that the same path is not a member of the seal's protected
   directory set.
2. Add the amendment directory prefix to `DOCS_WRITE_ALWAYS_ALLOWED` in `phase-marker.ts`.
3. Verify both assertions pass (GREEN), including that the seal's protected set is unchanged.
4. Commit with message: `feat(docs-guard): allow the unsealed amendment-request directory`.

**Files:**
- `src/conductor/src/engine/phase-marker.ts`
- `src/conductor/test/engine/phase-marker.test.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

**Wired-into:** `src/conductor/src/engine/protected-artifact-seal.ts#resolveDocsAllowlist`

**Dependencies:** none

### Task 10: Parse the amendment ledger

**Story:** TS-1
**Type:** happy-path

**Steps:**
1. Write a failing test for a ledger parser over `.docs/amendments/<plan-stem>.md`, returning one
   record per row with the amended path, the falsified assertion, a performed/unresolved status, and an
   optional follow-up reference.
2. Implement the parser in a new `amendment-ledger.ts`, fail-closed on an unparseable or empty file.
3. Verify a well-formed ledger parses and a malformed one is rejected naming the row (GREEN).
4. Commit with message: `feat(amendments): parse the amendment ledger`.

**Files:**
- `src/conductor/src/engine/amendment-ledger.ts`
- `src/conductor/test/engine/amendment-ledger.test.ts`

**Wired-into:** none (inert until Task 11 validates it and Task 12 consumes it)

**Dependencies:** none

### Task 11: Validate ledger rows against the sealed set

**Story:** TS-1
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a row naming a path that does not exist, or a path outside the four
   sealed directories, is rejected naming the row and the path.
2. Implement the validation in `amendment-ledger.ts`, reusing the directory set exported in Task 2.
3. Assert a feature with no ledger file at all is valid — an empty ledger is the common case and must
   add no ceremony.
4. Verify all cases pass (GREEN).
5. Commit with message: `feat(amendments): validate ledger rows against the sealed directory set`.

**Files:**
- `src/conductor/src/engine/amendment-ledger.ts`
- `src/conductor/test/engine/amendment-ledger.test.ts`

**Wired-into:** `src/conductor/src/engine/amendment-ledger.ts#PROTECTED_ARTIFACT_DIRECTORIES`

**Dependencies:** Task 2, Task 10

### Task 12: Fail `finish` closed on an unsurfaced amendment

**Story:** TS-5
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the `finish` completion predicate is not satisfied while the ledger
   carries an unresolved row with no follow-up reference, and that its message names that row.
2. Extend the `finish` completion checker in `artifacts.ts` to consult the ledger parser.
3. Verify the predicate blocks on the unsurfaced row (GREEN).
4. Commit with message: `feat(finish): fail closed on an unsurfaced amendment request`.

**Files:**
- `src/conductor/src/engine/artifacts.ts`
- `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** `src/conductor/src/engine/artifacts.ts#parseAmendmentLedger`

**Dependencies:** Task 10

### Task 13: Prove the SHIP backstop blocks only on silence

**Story:** TS-5
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: a resolved row raises nothing; an unresolved row carrying a follow-up
   reference raises nothing; a feature with no ledger behaves exactly as before.
2. Assert the predicate reports an unsurfaced amendment and does not alter or consult any build
   verification verdict.
3. Verify all cases pass (GREEN).
4. Commit with message: `test(finish): pin that the backstop blocks on silence, not on the build`.

**Files:**
- `src/conductor/test/engine/artifacts.test.ts`

**Wired-into:** same as Task 12

**Dependencies:** Task 12

### Task 14: Keep remediation from routing a sealed-artifact gap into BUILD

**Story:** TS-6
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a remediation gap whose fix requires amending another feature's
   sealed artifact is recorded as an amendment request rather than given a `build` or
   `acceptance_specs` disposition.
2. Implement the narrowing in the remediation disposition path in `conductor.ts`.
3. Assert the existing own-plan task append and every other disposition are unchanged, and that no
   DECIDE rewind is attempted on the gap's account.
4. Verify all cases pass (GREEN).
5. Commit with message: `feat(remediate): record sealed-artifact gaps instead of routing them to build`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/remediation-routing.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#parseAmendmentLedger`

**Dependencies:** Task 10

### Task 15: Codify the rule in every skill that can direct a mutation

**Story:** none (infrastructure: the enforcement machinery rejects a violation, but the skill text is
what stops an agent authoring one — both halves are required for the contract to hold)
**Type:** infrastructure

**Steps:**
1. Add the DECIDE-time amendment act and the dated-note form to `conflict-check` (perform and record
   rather than defer), `architecture-review` (record a ledger row rather than instruct a later phase),
   and `stories` (replace the vague supersession sentence with the codified form).
2. Add to `plan` a blocking rule that no task's `**Files:**` may name another feature's sealed
   artifact, naming the check command to run, with a Verification checklist item.
3. Add to `remediate` the prohibition on routing a sealed-artifact gap to `build` or
   `acceptance_specs`.
4. Scope every host-specific invocation on its own line per the provider contract, and verify
   `test/test_provider_skill_contracts.sh` passes.
5. Commit with message: `docs(skills): make artifact amendment a DECIDE-time act`.

**Files:**
- `skills/conflict-check/SKILL.md`
- `skills/architecture-review/SKILL.md`
- `skills/stories/SKILL.md`
- `skills/plan/SKILL.md`
- `skills/remediate/SKILL.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

### Task 16: State the contract once in HARNESS.md and update the canonical docs

**Story:** none (infrastructure: this repository requires a change's canonical affected documentation
to be truthful in the same PR that changes behavior)
**Type:** infrastructure

**Steps:**
1. Add the amendment-ownership rule to `HARNESS.md` as the single consumer-facing statement of the
   contract, and regenerate any generated region the edit touches.
2. Document the new command in `docs/reference/cli.md`, the amendment ledger and the unsealed
   amendment directory in `docs/reference/artifacts.md`, and the two new gates in
   `docs/explanation/gates.md` — which today does not mention the protected-artifact seal at all.
3. Update `docs/runbooks/stalled-or-stuck-feature.md` so the protected-artifact section points at the
   DECIDE-time route as the first resort.
4. Run `test/test_harness_integrity.sh` and fix any check it reports.
5. Commit with message: `docs: document DECIDE-owned artifact amendment and its gates`.

**Files:**
- `HARNESS.md`
- `docs/reference/cli.md`
- `docs/reference/artifacts.md`
- `docs/explanation/gates.md`
- `docs/runbooks/stalled-or-stuck-feature.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 15

## Task Dependency Graph

```text
1 → 3 → 4
2 → 3 → 5
    3 → 6 → 15 → 16
    3 → 7 → 8
9
10 → 11
10 → 12 → 13
10 → 14
2 → 11
```

## Integration Points

- **After Task 8:** the observed incident is impossible in both directions — a plan directing a
  sealed-artifact edit is rejected at authoring and again at land. This is the smallest shippable
  increment and is worth verifying alone.
- **After Task 13:** the mid-BUILD route exists end to end and cannot go silent.
- **After Task 16:** the contract is stated once and every canonical page agrees with the machinery.

## Verification

- [ ] A plan task naming another feature's sealed artifact is rejected, naming the task and the path.
- [ ] A task naming an unsealed path, an own-feature sealed path, or ordinary source is not rejected.
- [ ] A DECIDE-authored amendment lands in the seal baseline and BUILD completes with no halt.
- [ ] A mid-BUILD amendment request halts nothing and rewinds nothing.
- [ ] An unresolved, unsurfaced amendment request fails `finish` closed and names the row.
- [ ] Remediation never routes a sealed-artifact gap to `build` or `acceptance_specs`.
- [ ] `test/test_harness_integrity.sh` passes, including the provider skill-contract suite.
