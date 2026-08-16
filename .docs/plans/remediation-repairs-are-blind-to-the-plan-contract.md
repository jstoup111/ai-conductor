# Implementation Plan: remediation context pointer joins (#1620)

**Date:** 2026-08-16
**Stories:** .docs/stories/remediation-repairs-are-blind-to-the-plan-contract.md
**Conflict check:** Skipped (S tier)

## Summary

Adds deterministic, fail-open pointer joins to the build_review remediation context —
finding anchor → governing plan task, and finding anchor → same-anchor findings in
prior laps — injected as compact references only, plus a /remediate skill amendment
mandating the agent read the referenced files. 7 tasks.

## Technical Approach

- **New pure module** `src/conductor/src/engine/remediation-context-pointers.ts` with
  two functions, both pure (data in, pointer strings out, no disk):
  - `planContractPointers(findings, planText, planPath)` — for a `completeness`
    finding, join `anchor.planTask` to the plan's task headers; for other rubrics,
    join the anchor's changed-file field to a plan task via the existing task→files
    mapping (`parsePlanTaskPaths`). Emit one line per resolved finding:
    `plan contract: <planPath> — Task <id> (anchor: <anchor summary>)`. Unresolvable →
    emit nothing for that finding.
  - `priorAttemptPointers(findings, priorLaps)` — match current finding anchors
    against findings in earlier-lap artifacts (`.pipeline/build-review/<lapId>/<rubric>.json`)
    using the same anchor-equality rules as `build-review-finding-identity.ts`. Emit
    `prior attempts (<n>): <lapDir>/<rubric>.json#<findingRef>, …`. No match or
    malformed lap → emit nothing.
- **Wiring** at the build_review failure handling in `conductor.ts` (~line 7440–7490):
  append the pointer lines to both the rework hint routed to `build` and the
  `/remediate` dispatch context, after loading plan text and enumerating prior lap
  artifacts (read failures → empty inputs, join skipped). Pointer resolution is
  advisory: any thrown error is caught and dispatch proceeds with today's context.
- **Skill amendment** in `skills/remediate/SKILL.md`: when the dispatch context carries
  `plan contract:` / `prior attempts:` pointers, the agent MUST read the referenced
  files before planning; when it carries none, the agent checks `.docs/plans/` and
  `.pipeline/build-review/` directly.
- Sequencing: pure joins first (unit-testable in isolation), then wiring, then skill.
  No new events, ledgers, or persisted artifacts — reads existing spine artifacts only.

## Prerequisites

None — all inputs (`parsePlanTaskPaths`, anchor types in `build-review-domain.ts`,
lap artifacts) already exist.

## Tasks

### Task 1: Plan-contract pointer join (completeness anchors)
**Story:** Story 1 — happy path (planTask anchor)
**Type:** happy-path

**Steps:**
1. Write failing test: `planContractPointers` with a completeness finding whose
   `anchor.planTask` matches a `### Task <id>:` header in a sample plan returns one
   pointer line containing the plan path, task id, and anchor — and none of the task's
   Steps text.
2. Verify test fails (RED)
3. Implement `planContractPointers` in a new `remediation-context-pointers.ts` for the
   completeness case.
4. Verify test passes (GREEN)
5. Commit: "feat(remediation): plan-contract pointer join for completeness anchors"

**Files likely touched:**
- src/conductor/src/engine/remediation-context-pointers.ts — new pure module
- src/conductor/src/test/remediation-context-pointers.test.ts — new unit tests

**Dependencies:** none

### Task 2: Plan-contract pointer join (file-anchored rubrics)
**Story:** Story 1 — happy path (task→files mapping)
**Type:** happy-path

**Steps:**
1. Write failing test: a non-completeness finding whose anchor names a changed file
   mapped to exactly one plan task (via `parsePlanTaskPaths`) yields a pointer line
   for that task; a file mapped to zero or multiple tasks yields none.
2. Verify test fails (RED)
3. Implement the file→task branch of `planContractPointers`.
4. Verify test passes (GREEN)
5. Commit: "feat(remediation): plan-contract pointer join via task file mapping"

**Files likely touched:**
- same as Task 1

**Dependencies:** 1

### Task 3: Prior-attempt pointer join
**Story:** Story 2 — happy path
**Type:** happy-path

**Steps:**
1. Write failing test: `priorAttemptPointers` with a current finding whose anchor
   equals (per the finding-identity anchor rules) a finding in two earlier lap
   artifacts returns pointer lines with both lap artifact paths, finding references,
   and count 2 — and none of the prior findings' summary/evidence text.
2. Verify test fails (RED)
3. Implement `priorAttemptPointers` reusing the anchor-equality logic from
   `build-review-finding-identity.ts`.
4. Verify test passes (GREEN)
5. Commit: "feat(remediation): prior-attempt pointer join over lap artifacts"

**Files likely touched:**
- same as Task 1

**Dependencies:** 1

### Task 4: Fail-open negative paths for both joins
**Story:** Story 1 — negative path
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) unresolvable/drifted `planTask` anchor → empty pointer
   output; (b) no same-anchor prior finding → empty output; (c) malformed lap artifact
   JSON passed in → that lap skipped, others still matched; (d) both functions never
   throw on arbitrary malformed finding input.
2. Verify tests fail (RED)
3. Implement the guards.
4. Verify tests pass (GREEN)
5. Commit: "test(remediation): fail-open guards for pointer joins"

**Files likely touched:**
- same as Task 1

**Dependencies:** 2, 3

### Task 5: Wire pointers into the build_review failure context
**Story:** Story 1 — happy path (dispatch context contains pointers)
**Type:** happy-path

**Steps:**
1. Write failing test: the build_review failure context builder (extracted or exercised
   via its seam) given findings + a plan file + prior laps produces a rework hint /
   dispatch context ending with the pointer lines; with no resolvable joins it is
   byte-identical to today's context.
2. Verify test fails (RED)
3. In `conductor.ts`'s build_review failure handling, load the active plan text and
   enumerate prior lap artifacts (each read failure → empty input), call both join
   functions inside a try/catch, and append any pointer lines to both the rework hint
   and the /remediate dispatch context.
4. Verify test passes (GREEN)
5. Commit: "feat(remediation): inject plan-contract and prior-attempt pointers at dispatch"

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — build_review failure hint/dispatch assembly
- src/conductor/src/test/remediation-context-pointers.test.ts — wiring-level test

**Dependencies:** 4

### Task 6: Dispatch-unchanged negative path at the wiring seam
**Story:** Story 2 — negative path
**Type:** negative-path

**Steps:**
1. Write failing test: with an unreadable lap directory and an unresolvable anchor, the
   assembled context equals today's (no pointer section, no error), and dispatch is not
   blocked (builder returns normally).
2. Verify test fails (RED)
3. Implement any remaining guard needed at the wiring seam.
4. Verify test passes (GREEN)
5. Commit: "test(remediation): dispatch unchanged when joins miss"

**Files likely touched:**
- same as Task 5

**Dependencies:** 5

### Task 7: Amend /remediate to consume the pointers
**Story:** Story 3 — happy path and negative path
**Type:** infrastructure

**Steps:**
1. Edit `skills/remediate/SKILL.md`: name both pointer kinds (`plan contract:`,
   `prior attempts:`); mandate reading each referenced file before planning repairs and
   treating the plan task's Steps as the governing contract; state the fallback paths
   (`.docs/plans/`, `.pipeline/build-review/`) for the no-pointer case.
2. Run `test/test_harness_integrity.sh` and verify it passes.
3. Commit: "feat(remediate): read plan-contract and prior-attempt pointers"

**Files likely touched:**
- skills/remediate/SKILL.md — pointer-consumption instructions

**Dependencies:** 5

## Task Dependency Graph

```
1 → 2 → 4 → 5 → 6
1 → 3 ↗      ↘ 7
```

## Integration Points

- After Task 4: both joins fully unit-tested in isolation.
- After Task 6: end-to-end context assembly verified at the conductor seam.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
