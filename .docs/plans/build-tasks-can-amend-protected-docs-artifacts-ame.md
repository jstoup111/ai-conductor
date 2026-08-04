# Implementation Plan: DECIDE mutates accepted `.docs/` artifacts; no task may

**Date:** 2026-08-04
**Design:** .docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md
**Stories:** .docs/stories/build-tasks-can-amend-protected-docs-artifacts-ame.md
**Stories status:** Accepted; TS-1–TS-4
**Conflict check:** .docs/conflicts/build-tasks-can-amend-protected-docs-artifacts-ame.md
**Architecture:** .docs/architecture/build-tasks-can-amend-protected-docs-artifacts-ame.md
**Tier:** M
**Track:** technical (no PRD)
**Refs:** jstoup111/ai-conductor#1293

## Summary

Close #1293. DECIDE correctly detects that a change falsifies an accepted assertion and then, having
no sanctioned way to act on it, emits a plan task pointing BUILD at a sealed artifact — the one phase
forbidden to touch it. This plan makes the mutation a DECIDE-time act performed in place before the
seal baseline exists, rejects any plan that directs the mutation at BUILD at two deterministic
checkpoints, and keeps a BUILD-discovered falsification routed back to DECIDE rather than recorded
somewhere else.

No new artifact directory, no new write-guard exception, no new SHIP gate. The seal's fingerprinting,
schema, and three existing tolerances are untouched, and its halt remains the fail-closed backstop.

## Technical Approach

The load-bearing mechanism already exists: the seal baseline is created at first BUILD entry
(`conductor.ts:4677`). A mutation committed during DECIDE is therefore *in* the baseline, not a
deviation from it — which is why this needs no new tolerance, no rotation, and no reseal command, and
does not depend on #1281.

Two surfaces, in dependency order:

1. **A deterministic scan** (`plan-protected-targets.ts`) mapping each plan task to its resolved
   `**Files:**` set and rejecting any path under the four sealed directories whose stem does not name
   the plan's own feature. Exposed as a blocking CLI command for authoring time and called directly by
   the land gate.
2. **Skill and rule updates** across every skill that can direct a mutation, plus `HARNESS.md`. The
   engine checks are the enforcement; the skill text is what stops a violation being authored.

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
2. Change both from module-private to exported in `protected-artifact-seal.ts`. Change no behavior, no
   call site, and no other declaration.
3. Verify the existing seal test suite still passes unchanged — this task must be provably inert.
4. Commit with message: `refactor(seal): export the sealed-directory set and own-feature predicate`.

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

**Wired-into:** `src/conductor/src/engine/plan-protected-targets.ts#scanPlanProtectedTargets`

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
3. Verify the tests pass against Task 3's implementation, adjusting it only if a case genuinely fails.
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

**Wired-into:** `src/conductor/src/cli.ts#planProtectedTargetsCommand`

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

### Task 9: Keep a sealed-artifact remediation gap out of BUILD

**Story:** TS-4
**Type:** happy-path

**Steps:**
1. Write a failing test asserting a remediation gap whose fix requires amending another feature's
   sealed artifact is routed to its owning DECIDE step and never given a `build` or
   `acceptance_specs` disposition.
2. Implement the narrowing in the remediation disposition path in `conductor.ts`, reusing the scan's
   sealed-path judgement rather than a second copy of it.
3. Assert the routing reaches the existing operator gate and that no new gate or disposition value is
   introduced.
4. Verify the test passes (GREEN).
5. Commit with message: `feat(remediate): route sealed-artifact gaps to DECIDE, never to build`.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/remediation-routing.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#scanPlanProtectedTargets`

**Dependencies:** Task 3

### Task 10: Prove the routing change adds nothing and removes nothing

**Story:** TS-4
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: every other remediation disposition is unchanged; the existing
   own-plan task append is unchanged; and no request, ledger, or record artifact is written anywhere
   on the BUILD-discovery path.
2. Assert the protected-artifact seal's existing halt still fires unchanged for a BUILD task that
   edits a sealed artifact, naming the path.
3. Verify all cases pass (GREEN).
4. Commit with message: `test(remediate): pin unchanged dispositions and the seal halt backstop`.

**Files:**
- `src/conductor/test/engine/remediation-routing.test.ts`
- `src/conductor/test/engine/protected-artifact-seal.test.ts`

**Wired-into:** same as Task 9

**Dependencies:** Task 9

### Task 11: Codify the rule in every skill that can direct a mutation

**Story:** TS-1
**Type:** infrastructure

**Steps:**
1. Add the DECIDE-time mutation act and the dated-note form to `conflict-check` (perform the mutation
   rather than defer it), `architecture-review` (perform it rather than instruct a later phase), and
   `stories` (replace the vague supersession sentence with the codified form).
2. Add to `plan` a blocking rule that no task's `**Files:**` may name another feature's sealed
   artifact, naming the check command to run, with a Verification checklist item.
3. Add to `remediate` the prohibition on routing a sealed-artifact gap to `build` or
   `acceptance_specs`.
4. Scope every host-specific invocation on its own line per the provider contract, and verify
   `test/test_provider_skill_contracts.sh` passes.
5. Commit with message: `docs(skills): make artifact mutation a DECIDE-time act`.

**Files:**
- `skills/conflict-check/SKILL.md`
- `skills/architecture-review/SKILL.md`
- `skills/stories/SKILL.md`
- `skills/plan/SKILL.md`
- `skills/remediate/SKILL.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 6

### Task 12: State the contract once in HARNESS.md and update the canonical docs

**Story:** none (infrastructure: this repository requires a change's canonical affected documentation
to be truthful in the same PR that changes behavior)
**Type:** infrastructure

**Steps:**
1. Add the amendment-ownership rule to `HARNESS.md` as the single consumer-facing statement of the
   contract, and regenerate any generated region the edit touches.
2. Document the new command in `docs/reference/cli.md`, and the two new gates in
   `docs/explanation/gates.md` — which today does not mention the protected-artifact seal at all.
3. Update `docs/reference/artifacts.md` so the seal section names the DECIDE-time mutation as the
   sanctioned route, and `docs/runbooks/stalled-or-stuck-feature.md` so its protected-artifact section
   points there as the first resort.
4. Run `test/test_harness_integrity.sh` and fix any check it reports.
5. Commit with message: `docs: document DECIDE-owned artifact mutation and its gates`.

**Files:**
- `HARNESS.md`
- `docs/reference/cli.md`
- `docs/reference/artifacts.md`
- `docs/explanation/gates.md`
- `docs/runbooks/stalled-or-stuck-feature.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 11

## Task Dependency Graph

```text
1 → 3 → 4
2 → 3 → 5
    3 → 6 → 11 → 12
    3 → 7 → 8
    3 → 9 → 10
```

## Integration Points

- **After Task 8:** the observed incident is impossible in both directions — a plan directing a
  sealed-artifact edit is rejected at authoring and again at land. This is the smallest shippable
  increment and is worth verifying alone.
- **After Task 10:** no path routes a sealed-artifact mutation into BUILD, and the seal halt is proven
  intact as the backstop.
- **After Task 12:** the contract is stated once and every canonical page agrees with the machinery.

## Verification

- [ ] A plan task naming another feature's sealed artifact is rejected, naming the task and the path.
- [ ] A task naming an unsealed path, an own-feature sealed path, or ordinary source is not rejected.
- [ ] A DECIDE-authored mutation lands in the seal baseline and BUILD completes with no halt.
- [ ] A BUILD-discovered falsification routes to DECIDE and writes no record artifact.
- [ ] The protected-artifact seal's halt is unchanged as the fail-closed backstop.
- [ ] `test/test_harness_integrity.sh` passes, including the provider skill-contract suite.
