# Implementation Plan: Shared plan-task reference resolver (#2064)

**Date:** 2026-08-30
**Design:** .docs/decisions/adr-2026-08-30-shared-plan-task-reference-resolver.md
**Stories:** .docs/stories/remediation-task-ids-are-non-numeric-by-design-but.md
**Conflict check:** Clean as of 2026-08-30

## Summary

Introduce one shared resolver for cited plan-task references and adopt it in prd_audit's Verdict
Table parser, so engine-appended `rem-…` tasks are citable and rejections carry named
diagnostics. 7 tasks.

## Technical Approach

- New export `resolvePlanTaskReference(raw: string, planTaskIds: ReadonlySet<string>)` in
  `src/conductor/src/engine/plan-task-parse.ts` — the module that already owns `TASK_ID_PATTERN`
  (H9 grammar `[A-Za-z0-9._-]+`). Return shape is a discriminated union:
  `{ kind: 'resolved', id: string }` | `{ kind: 'unresolvable', id: string }` |
  `{ kind: 'malformed', raw: string }`. Resolution: trim; strip at most one trailing
  parenthesized annotation (`/\s*\([^()]*\)$/`); the remainder must match
  `^${TASK_ID_PATTERN}$` (else malformed); then membership in `planTaskIds` (else
  unresolvable).
- Adoption in `src/conductor/src/engine/artifacts.ts` prd_audit parse (~4417): replace the
  `Number(rawPlanTask)` block with the resolver, keeping `—`/empty → undefined. The parsed
  finding's `planTask` field (artifacts.ts:4155) changes `number` → `string`. Verified
  downstream: `conductor.ts:3884-3887` passes it as `parentTask` into
  `remediation-append.ts:32`, whose type is already `number | string` — the compiler bounds the
  ripple (verified by grep, 100%).
- Existing semantics preserved: FIXABLE requires a task; FIXABLE citing an absent id rejects
  (the resolver's `unresolvable` arm replaces the current membership check at 4436-4437, and
  applies to every grade, not only FIXABLE).
- Skill text `skills/prd-audit/SKILL.md` states the enforced rule: any row may cite a task
  present in the active plan, FIXABLE must, emit the bare id (no annotation).
- Local test pattern: unit tests for engine modules live in `src/conductor/test/` (vitest);
  find siblings with `ls src/conductor/test | grep -i 'plan-task\|artifacts'` and match their
  describe/fixture style. Mocked adapters only; no live LLMs.

## Prerequisites

None — pure in-repo change.

## Tasks

### Task 1: Resolver resolves valid references
**Story:** Story 1 happy paths
**Type:** happy-path

**Steps:**
1. Write failing tests: `resolvePlanTaskReference` returns `{kind:'resolved', id:'4'}` for raw `4` with plan set `{4}`; `{kind:'resolved', id:'rem-prd-audit-rem-s1-6-1'}` for that raw id; same for `rem-as-built-rem-ab1-2 (landed)` (annotation stripped). Follow the vitest style of existing `src/conductor/test` plan-task tests.
2. Verify RED.
3. Implement `resolvePlanTaskReference` in `plan-task-parse.ts` per Technical Approach.
4. Verify GREEN.
5. Commit: "feat(engine): shared plan-task reference resolver".

**Done when:**
- [ ] `plan-task-parse.ts` exports `resolvePlanTaskReference` with the discriminated-union return shape from Technical Approach
- [ ] The three happy-path tests above pass, asserting exact returned objects
- [ ] Grammar is checked via the existing `TASK_ID_PATTERN` constant, not a new regex literal

**Files likely touched:**
- src/conductor/src/engine/plan-task-parse.ts — new export
- src/conductor/test/plan-task-reference-resolver.test.ts — new tests

**Dependencies:** none

### Task 2: Resolver rejects absent, malformed, and trailing-garbage references
**Story:** Story 1 negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests: raw `rem-test-9-9` with a plan set lacking it → `{kind:'unresolvable', id:'rem-test-9-9'}`; raw `task#7` → `{kind:'malformed', raw:'task#7'}`; raw `7 landed extra words` with plan set `{7}` → malformed (not resolved to `7`).
2. Verify RED.
3. Implement/adjust the resolver arms.
4. Verify GREEN.
5. Commit: "test(engine): resolver negative paths".

**Done when:**
- [ ] The three negative tests pass with exact expected union values
- [ ] Only a single trailing parenthesized annotation is stripped; any other trailing text is malformed (asserted by the trailing-garbage test)

**Files likely touched:**
- src/conductor/src/engine/plan-task-parse.ts — resolver arms
- src/conductor/test/plan-task-reference-resolver.test.ts — negative tests

**Dependencies:** 1

### Task 3: prd_audit parser adopts the resolver; planTask becomes a string id
**Story:** Story 2 happy paths
**Type:** happy-path

**Steps:**
1. Write failing test: a prd_audit report whose Verdict Table has a PASS row citing `rem-prd-audit-rem-s1-6-1 (landed)` and a FIXABLE row citing `rem-as-built-rem-ab1-3`, against an active plan containing those ids, parses with both rows accepted and `planTask` carrying the bare string ids.
2. Verify RED (today the PASS row is rejected as invalid Plan task).
3. Replace the `Number(rawPlanTask)` block in `artifacts.ts` (~4417-4441) with `resolvePlanTaskReference` using the existing `activePlanTaskIds`; change the finding type's `planTask?: number` (artifacts.ts:4155) to `planTask?: string`; fix compile fallout (conductor.ts:3884-3887 pass-through only).
4. Verify GREEN and `tsc` clean.
5. Commit: "fix(engine): prd_audit cites plan tasks via shared resolver (#2064)".

**Done when:**
- [ ] The `Number()` pre-parse is gone from the Verdict Table Plan-task handling; the only validity source is `resolvePlanTaskReference`
- [ ] `planTask` is typed `string` on the parsed finding and the project compiles
- [ ] The new test passes; existing prd_audit parser tests pass (integer citations still accepted as strings)

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — parser adoption, type change
- src/conductor/src/engine/conductor.ts — pass-through typing if needed
- src/conductor/test/ — parser test file (match the existing prd_audit parse test file)

**Dependencies:** 2

### Task 4: #2064 regression — appending remediation tasks never breaks a parseable report
**Story:** Story 2 happy path (regression shape) and negative path "appending never invalidates"
**Type:** happy-path

**Steps:**
1. Write test reproducing the observed shape: plan with integer tasks plus `rem-prd-audit-rem-s1-6-1`…`rem-as-built-rem-ab1-4`; report parses; then extend the plan via `appendRemediationTasks` and re-parse the unchanged report — still parses with identical accepted rows.
2. Verify it passes (GREEN-first regression lock; RED was Task 3's step 2).
3. Commit: "test(engine): #2064 regression lock".

**Done when:**
- [ ] A test named for #2064 builds the plan through `remediation-append.ts` output (not hand-written ids) and asserts the report parses before and after the append with identical accepted rows
- [ ] The test's fixture includes at least one PASS row citing an appended `rem-` id with a trailing `(landed)` annotation, matching the observed halt shape

**Files likely touched:**
- src/conductor/test/ — regression test beside Task 3's file

**Verify-only:** no — it lands a new test file.

**Dependencies:** 3

### Task 5: FIXABLE semantics preserved under the widened citation rule
**Story:** Story 2 negative paths (also enforces Story 4's negative path: the FIXABLE requirement is not weakened)
**Type:** negative-path

**Steps:**
1. Write failing/locking tests: FIXABLE row with Plan task `—` → rejected "is FIXABLE but has no Plan task"; FIXABLE row citing `rem-prd-audit-zz-1` absent from the plan → rejected with a reason containing the criterion key and `rem-prd-audit-zz-1`.
2. Verify state (first may already pass — lock it; second RED until Task 6's wording if not yet exact).
3. Adjust rejection wiring as needed.
4. Verify GREEN.
5. Commit: "test(engine): FIXABLE citation semantics under resolver".

**Done when:**
- [ ] FIXABLE-without-task rejection behavior is unchanged and test-locked
- [ ] Absent-id rejection applies to every grade's citation, asserted for a FIXABLE row

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — rejection wiring
- src/conductor/test/ — same parser test file as Task 3

**Dependencies:** 3

### Task 6: Rejection diagnostics name the criterion and the offending reference
**Story:** Story 3 happy and negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests asserting exact reason strings: unresolvable → `PRD audit finding S2.3 names Plan task rem-x-1, which is absent from the active plan.`; malformed → a reason containing `S2.3` and the malformed raw text verbatim (replacing the bare `has an invalid Plan task.`).
2. Verify RED.
3. Implement the two reason strings from the resolver's union arms.
4. Verify GREEN.
5. Commit: "fix(engine): named diagnostics for rejected plan-task citations".

**Done when:**
- [ ] Both reason strings include the criterion key and the cited reference text verbatim, asserted exactly
- [ ] No rejection path emits `has an invalid Plan task.` without the offending reference

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — reason strings
- src/conductor/test/ — same parser test file

**Dependencies:** 3

### Task 7: prd-audit skill states the enforced citation rule
**Story:** Story 4 happy path
**Type:** infrastructure

**Steps:**
1. Edit `skills/prd-audit/SKILL.md` Verdict Table instructions: any row may cite a task present in the active plan; FIXABLE rows must; emit the bare task id with no annotation; `—` for no task.
2. Run `test/test_harness_integrity.sh`; fix any failures.
3. Commit: "docs(skill): prd-audit plan-task citation rule".

**Done when:**
- [ ] The SKILL.md Plan-task guidance matches the parser behavior shipped in Tasks 3-6 (any-row-may-cite, FIXABLE-must, bare id)
- [ ] `test/test_harness_integrity.sh` exits 0

**Files likely touched:**
- skills/prd-audit/SKILL.md — citation rule text

**Dependencies:** 3

## Task Dependency Graph

```
1 → 2 → 3 → 4
        3 → 5
        3 → 6
        3 → 7
```

## Integration Points

- After Task 3: a live prd_audit report citing `rem-` ids parses end-to-end (the #2064 halt shape is fixed).
- After Task 6: operator-facing halt bodies carry named diagnostics.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
