# Implementation Plan: Child BUILD halts needs-human on another child's already-resolved build-review case

**Date:** 2026-11-15
**Design:** `.docs/decisions/adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement.md`
**Stories:** `.docs/stories/child-build-halts-needs-human-on-another-child-s-a.md`
**Conflict check:** Clean as of 2026-11-15

## Summary

Moves the four remediation inputs into the owning child's region, deletes them when nothing open
depends on them, adopts or removes files an older engine left at the feature level, and answers a
BUILD stall that cites a settled or foreign case with a bounded BUILD re-dispatch. 20 tasks.

## Technical Approach

All engine paths below are under `src/conductor/src/engine/` unless they start at the repo root.

- **Region paths.** `build-review-work-order.ts`, `remediation-plan-store.ts`,
  `remediation-case-artifact.ts` and the stall-question writer in `task-progress.ts` each build a
  path from a module constant and the project root. Each gains an optional child argument and
  forms its path through `pipelinePathFor` in `child-context.ts`. With no child the path is the
  feature-level one, byte for byte. Callers in `conductor.ts`,
  `build-review-adjudication-coordinator.ts`, `remediation-case-effects.ts`, `step-runners.ts` and
  `remediation-projection.ts` pass the active child they already hold.
  *Pattern basis:* the per-child case store and kickback ledger. Preserve: one path seam, a whole
  copy of the existing schema per child, no composite keys, no fallback read of the flat path.
  Search hints: `pipelinePathFor`; the case store's state-path helper.
- **Judgement relocation.** The remediate session keeps writing `.pipeline/remediation.json`. After
  `readRemediationCaseJudgement` returns a parsed judgement to the conductor's judge callback, the
  engine moves the file to the active child's region. A parse failure moves nothing.
- **Prompt-named inputs.** The BUILD retry context names the region path of the judgement when the
  active child has an open admitted repair, and of the gap plan when one exists in the region. The
  `tdd` and `pipeline` skills point at those named paths.
- **Retirement.** Each store module gains a remove function for its own file. The conductor calls
  them: work order and judgement when the active region's case store has no open case after a
  settlement; gap plan when the BUILD it routed to passes its gate or its stall halts; stall
  question when its stall is routed or halted. A failed removal is swallowed and retried at the next
  settlement or BUILD dispatch.
- **Adoption.** Before the BUILD retry context is built for a child, a feature-level work order in
  a stacked feature is moved to the region whose case store records one of its effect ids on an
  open case, else deleted; a feature-level judgement, gap plan or stall question is deleted.
- **Stale citation.** A pure classifier takes the stall question text and every child's case-store
  state and returns one of: stale (with case id, owning child, and resolved or foreign), or not
  stale. It matches only ids the stores hold. A recorder persists a new `ConductorEvent` variant
  `build_stall_stale_citation` and derives the attempt number from `.pipeline/events.jsonl`.
  *Pattern basis:* `recordRoundStall` in `routing/round-admission.ts`. Preserve: the count is read
  from the feature event log, the event is persisted with `persistOnActiveEventSpine`, and a
  persist failure yields a needs-human stop. Allowed variation: attempts 1 and 2 re-dispatch BUILD
  in the run instead of halting; progress is detected by the resolved-task count carried on the
  event, not by a separate event type.
- **Sequencing.** Region paths first, then relocation and prompt naming, then retirement and
  adoption, then the stall check, which depends only on region-scoped stall evidence.

## Prerequisites

- None.

## Tasks

### Task 1: Work-order functions take an optional child
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-work-order.test.ts`: publish, read, read attempted case ids, and stamp attempted, each called with a child, use the `.pipeline/children/<k>/build-review-work-order.json` path; called with no child they use the feature-level path.
2. Verify RED.
3. Implement: add an optional child argument to `buildReviewWorkOrderPath`, `publishBuildReviewWorkOrder`, `readBuildReviewWorkOrder`, `readBuildReviewWorkOrderAttemptedCaseIds` and `markBuildReviewWorkOrderAttempted`, forming the path through `pipelinePathFor`. Follow the region-path pattern: one seam, same schema, no fallback read of the flat path.
4. Verify GREEN.
5. Commit: "feat: work-order store accepts a child".

**Done when:**
- [test] The work-order store test asserts that publishing with child 4 writes `.pipeline/children/4/build-review-work-order.json` and leaves no file at `.pipeline/build-review-work-order.json`.
- [test] The work-order store test asserts that a read with child 3 returns `missing-work-order` while an order exists only in child 4's region.
- [test] The work-order store test asserts that every function called with no child reads and writes `.pipeline/build-review-work-order.json` exactly as before.

**Files likely touched:**
- `src/conductor/src/engine/build-review-work-order.ts` — optional child on path, publish, read, attempt functions
- `src/conductor/test/engine/build-review-work-order.test.ts` — region and no-child cases

**Dependencies:** none

### Task 2: The engine publishes and delivers each child's own work order
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing conductor-level tests in `src/conductor/test/engine/remediation-case-child.test.ts` (replacing the case that pins a child case store with a feature-level order) and `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`.
2. Verify RED.
3. Implement: pass the active child to every work-order call in `conductor.ts` (`durableBuildReviewRetryContext`, clean-PASS settlement), `build-review-adjudication-coordinator.ts` and `remediation-case-effects.ts`.
4. Verify GREEN.
5. Commit: "feat: work order is published and read in the active child's region".

**Done when:**
- [test] A stacked-feature test with active child 4 and an admitted repair asserts the published work order exists under `.pipeline/children/4/` and no work order exists at the feature-level `.pipeline/` path.
- [test] The same test asserts that child 4's BUILD dispatch prompt carries that work order's tasks.
- [test] A test with a work order for an open case in child 4's region and no open case in child 3's store asserts child 3's BUILD dispatch prompt carries no work order content.
- [test] A test with open admitted repairs in both child 3 and child 4 asserts child 3's BUILD prompt carries only child 3's tasks and the run does not halt on a foreign work order.
- [test] A no-children test asserts the work order is published at the feature-level `.pipeline/` path and that BUILD's dispatch prompt carries its tasks while its case is open.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — pass active child at work-order call sites
- `src/conductor/src/engine/build-review-adjudication-coordinator.ts` — pass child
- `src/conductor/src/engine/remediation-case-effects.ts` — pass child
- `src/conductor/test/engine/remediation-case-child.test.ts` — region layout
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — two-child prompt cases

**Dependencies:** Task 1

### Task 3: The typed gap plan is written and read in the active child's region
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-plan-store.test.ts` and `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`.
2. Verify RED.
3. Implement: optional child on `persistRemediationPlan` and `readTypedRemediationPlan`, path through `pipelinePathFor`; pass the active child from the gap-plan branch in `step-runners.ts` and from `planRemediation` in `conductor.ts`.
4. Verify GREEN.
5. Commit: "feat: typed gap plan lives in the active child's region".

**Done when:**
- [test] A stacked-feature stall-remediation test with active child 3 asserts the typed gap plan is written under `.pipeline/children/3/` and that the conductor's read returns it from that region.
- [test] A test with a gap plan from an earlier attempt in child 3's region asserts child 4's read does not return child 3's plan.
- [test] A no-children test asserts the gap plan is written at and read from the feature-level `.pipeline/remediation-plan.json` path exactly as before.

**Files likely touched:**
- `src/conductor/src/engine/remediation-plan-store.ts` — optional child
- `src/conductor/src/engine/step-runners.ts` — pass child when persisting
- `src/conductor/src/engine/conductor.ts` — pass child when reading
- `src/conductor/test/engine/remediation-plan-store.test.ts` — region cases
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — conductor read

**Dependencies:** none

### Task 4: The captured stall question is written in the active child's region
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/task-progress.test.ts`, `src/conductor/test/engine/remediation-projection.test.ts` and `src/conductor/test/engine/conductor-loop-policies.test.ts`.
2. Verify RED.
3. Implement: optional child on `writeStallQuestionEvidence`; the conductor passes the active child at each seam that captures a stall question and passes the resulting repo-relative path as the evidence file to `planRemediation`; `remediation-projection.ts` cites the path it is given instead of a fixed one.
4. Verify GREEN.
5. Commit: "feat: stall question evidence lives in the active child's region".

**Done when:**
- [test] A stacked-feature stall test with active child 3 asserts the captured question is written to `.pipeline/children/3/build-stall-question.md` and that the remediation dispatch cites that region path as its evidence file.
- [test] A test with a captured question already in child 3's region asserts that when child 4 stalls with a different question, child 4's remediation dispatch cites only child 4's question file and text.
- [test] A no-children stall test asserts the question is written at `.pipeline/build-stall-question.md` and cited from there exactly as before.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — optional child on the evidence writer
- `src/conductor/src/engine/remediation-projection.ts` — cite the supplied path
- `src/conductor/src/engine/conductor.ts` — pass child and path at the stall seams
- `src/conductor/test/engine/task-progress.test.ts` — region path
- `src/conductor/test/engine/remediation-projection.test.ts` — supplied path
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — stacked stall

**Dependencies:** none

### Task 5: The engine moves a parsed case judgement into the active child's region
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-artifact.test.ts` and `src/conductor/test/engine/conductor-build-review-adjudication.test.ts`.
2. Verify RED.
3. Implement: add a relocate function to `remediation-case-artifact.ts` that renames `.pipeline/remediation.json` to the child's region path through `pipelinePathFor`; the conductor's judge callback calls it only after `readRemediationCaseJudgement` returned a parsed judgement and only when a child is active.
4. Verify GREEN.
5. Commit: "feat: engine relocates the case judgement into the owning region".

**Done when:**
- [test] A stacked-feature test with active child 4 and a fresh parseable judgement at `.pipeline/remediation.json` asserts that after the engine parses it the file exists at `.pipeline/children/4/remediation.json` and no longer exists at the feature-level path.
- [test] A test with a judgement that fails to parse asserts the lap outcome equals the pre-change failure outcome and that the recursive file listing of every `.pipeline/children/` region is identical before and after, so no file is created in any region.
- [test] A no-children test asserts that after a parsed judgement the file is still at `.pipeline/remediation.json`.

**Files likely touched:**
- `src/conductor/src/engine/remediation-case-artifact.ts` — relocate function
- `src/conductor/src/engine/conductor.ts` — call after a parsed judgement
- `src/conductor/test/engine/remediation-case-artifact.test.ts` — relocation unit cases
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — parsed and failed laps

**Dependencies:** none

### Task 6: The BUILD prompt names the remediation inputs a session may read
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing prompt-content tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` and `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`.
2. Verify RED.
3. Implement: when the conductor renders the work-order context for BUILD, append the repo-relative path of the active region's judgement; when a remediation route to BUILD has a gap plan in the active region, append that plan's repo-relative path to the routed hint. Name nothing when the file's condition does not hold.
4. Verify GREEN.
5. Commit: "feat: BUILD prompt names readable remediation inputs".

**Done when:**
- [test] A test with an open admitted repair and a judgement in child 4's region asserts child 4's BUILD dispatch prompt names `.pipeline/children/4/remediation.json` as the judgement the session may read.
- [test] A test where stall remediation routed a typed gap plan back to child 3's BUILD asserts that BUILD dispatch prompt names `.pipeline/children/3/remediation-plan.json` as an input the session may read.
- [test] A test with no open admitted repair in child 3 asserts child 3's BUILD dispatch prompt names no judgement path.
- [test] A test with no gap plan in child 3's region asserts child 3's BUILD dispatch prompt names no gap plan path.
- [test] A no-children test with an open admitted repair asserts the BUILD dispatch prompt names `.pipeline/remediation.json` and that the file is still at that path when BUILD is dispatched.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — name paths in the BUILD retry context and routed hint
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — judgement path cases
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — gap plan path cases

**Dependencies:** Tasks 2, 3, 5

### Task 7: The BUILD skills direct a session to the prompt-named inputs
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Change the assertion in `test/test_skill_pipeline_contract.sh` that currently requires the sentence allowing a read of `.pipeline/remediation.json` in both skills: require instead a sentence directing the session to the remediation input paths named in its prompt, and require that neither skill contains the string `.pipeline/remediation.json` in that read-allowance sentence.
2. Verify RED by running that script.
3. Implement: in `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md`, replace the read-allowance sentence with one directing the session to read the remediation input paths its prompt names and the cited verdict artifact.
4. Verify GREEN.
5. Commit: "feat: BUILD skills point at prompt-named remediation inputs".

**Done when:**
- [test] `test/test_skill_pipeline_contract.sh` asserts that `skills/pipeline/SKILL.md` and `skills/tdd/SKILL.md` each direct a session that needs finding detail to the remediation input paths named in its prompt.
- [test] The same script asserts that neither skill's read-allowance sentence names a fixed feature-level path such as `.pipeline/remediation.json`.
- `test/test_skill_pipeline_contract.sh` exits 0.

**Files likely touched:**
- `skills/pipeline/SKILL.md` — read-allowance sentence
- `skills/tdd/SKILL.md` — read-allowance sentence
- `test/test_skill_pipeline_contract.sh` — contract assertion

**Dependencies:** Task 6

### Task 8: A region's work order and judgement are deleted when its last open case settles
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` and `src/conductor/test/integration/remediation-case-recovery.integration.test.ts`.
2. Verify RED.
3. Implement: add remove functions for the work order (`build-review-work-order.ts`) and the judgement (`remediation-case-artifact.ts`). After each settlement in `conductor.ts` that drains the case-store outbox (clean-PASS settlement and the adjudication outcome path), read the active region's case store and, when it holds no case with resolution `open`, call both. The call sits after the settlement has read the order's attempted case ids.
4. Verify GREEN.
5. Commit: "feat: retire a region's work order and judgement on settlement".

**Done when:**
- [test] A test where a clean build review resolves a region's only open case asserts that region's work order and judgement files no longer exist after settlement, and that the case store still records the case as resolved and `.pipeline/events.jsonl` still holds its `remediation_case_reconciled` event.
- [test] A test with two open cases where one resolves asserts the work order and judgement remain and the next BUILD dispatch for that child still receives the remaining case's tasks.
- [test] A test where BUILD attempted a case whose finding is absent on the next lap asserts the case resolves exactly as it does before this change and that the work order still exists at the moment the settlement reads its attempted case ids and is deleted only after that settlement.
- [test] A test where child 4's cases all resolve while child 3 has an open case asserts child 3's work order and judgement files are byte-identical before and after child 4's settlement.

**Files likely touched:**
- `src/conductor/src/engine/build-review-work-order.ts` — remove function
- `src/conductor/src/engine/remediation-case-artifact.ts` — remove function
- `src/conductor/src/engine/conductor.ts` — retire after settlement
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — settlement cases
- `src/conductor/test/integration/remediation-case-recovery.integration.test.ts` — attempted-absent ordering

**Dependencies:** Tasks 2, 5

### Task 9: A failed retirement does not fail settlement and is retried
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write a failing test in `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` that injects a filesystem whose remove rejects once.
2. Verify RED.
3. Implement: the retirement call catches a removal error and continues; the conductor also runs the same no-open-case retirement check before it builds the BUILD retry context for a child.
4. Verify GREEN.
5. Commit: "fix: retirement failure is non-fatal and retried".

**Done when:**
- [test] A test whose work-order removal rejects with a filesystem error asserts the case stays resolved in the case store and the run continues to its next step without a HALT.
- [test] The same test asserts that the next settlement, or the next BUILD dispatch for that child, attempts the removal again and the work order no longer exists afterwards.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — swallow removal errors; retry before BUILD retry context
- `src/conductor/test/engine/conductor-build-review-adjudication.test.ts` — failing-remove case

**Dependencies:** Task 8

### Task 10: The gap plan is deleted when the BUILD it routed to passes or its stall halts
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts`.
2. Verify RED.
3. Implement: add a remove function to `remediation-plan-store.ts`. The conductor calls it for the active region when the BUILD gate passes, and on every stall branch that ends in a HALT (including a remediation dispatch that throws).
4. Verify GREEN.
5. Commit: "feat: retire the gap plan after its routed BUILD or a stall halt".

**Done when:**
- [test] A test where stall remediation routed a typed gap plan back to BUILD asserts the gap plan file no longer exists once that BUILD passes its gate.
- [test] The same test asserts that before that BUILD passes its gate the gap plan is still present at the path its dispatch prompt names.
- [test] A test where the stall remediation dispatch throws before a plan is read asserts that after the stall halts no gap plan from an earlier attempt remains in that region.

**Files likely touched:**
- `src/conductor/src/engine/remediation-plan-store.ts` — remove function
- `src/conductor/src/engine/conductor.ts` — call on BUILD gate pass and stall halt
- `src/conductor/test/engine/conductor-remediation-typed-plan.test.ts` — lifetime cases

**Dependencies:** Tasks 3, 6

### Task 11: The captured stall question is deleted once its stall is routed or halted
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-loop-policies.test.ts`.
2. Verify RED.
3. Implement: add a remove function for the stall-question evidence in `task-progress.ts`; the conductor calls it after a stall's remediation outcome has been turned into a BUILD re-dispatch, and after the HALT for a stall has been written (the HALT body already holds the question).
4. Verify GREEN.
5. Commit: "feat: retire the stall question after its stall is handled".

**Done when:**
- [test] A stall test whose remediation routes back to BUILD asserts the captured stall question file no longer exists when BUILD is dispatched again.
- [test] A stall test whose remediation halts asserts the captured stall question file no longer exists after the HALT is written and that the HALT body still begins with the question.

**Files likely touched:**
- `src/conductor/src/engine/task-progress.ts` — remove function
- `src/conductor/src/engine/conductor.ts` — call after route and after halt
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — routed and halted cases

**Dependencies:** Task 4

### Task 12: A feature-level work order with an open owner is adopted into that owner's region
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-child.test.ts` starting from the layout an older engine leaves: child case stores plus a feature-level work order.
2. Verify RED.
3. Implement: before the conductor builds the BUILD retry context for a child in a stacked feature, read the feature-level work order; for each child region read its case store and, when a case with resolution `open` records one of the order's effect ids, move the order file into that region. Run nothing when the feature has no children.
4. Verify GREEN.
5. Commit: "feat: adopt a legacy feature-level work order into its owning region".

**Done when:**
- [test] A test with a feature-level work order whose effect is recorded on an open case in child 4's store asserts that before a child's BUILD dispatch the order is moved to `.pipeline/children/4/` and that child 4's BUILD dispatch prompt carries its tasks.
- [test] The same layout with active child 3 asserts the order is in child 4's region, child 3's BUILD dispatch prompt carries no work order content, and the run does not halt.
- [test] A no-children test with a feature-level work order for an open case asserts that at BUILD dispatch the file is neither moved nor deleted.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — adoption before the BUILD retry context
- `src/conductor/src/engine/build-review-work-order.ts` — move helper
- `src/conductor/test/engine/remediation-case-child.test.ts` — legacy layout cases

**Dependencies:** Task 2

### Task 13: Feature-level remediation inputs with no open owner are removed in a stacked feature
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/remediation-case-child.test.ts`.
2. Verify RED.
3. Implement: in the adoption step, delete the feature-level work order when no region has an open case recording one of its effect ids, including when the file cannot be parsed; delete a feature-level judgement, gap plan and stall question.
4. Verify GREEN.
5. Commit: "feat: remove unowned legacy remediation inputs before a child's BUILD".

**Done when:**
- [test] A stacked-feature test with a feature-level work order whose cases are all resolved asserts that before a child's BUILD dispatch the order is deleted and no region contains a work order.
- [test] A stacked-feature test with a feature-level judgement, gap plan and stall question asserts each of the three files is deleted before a child's BUILD dispatch.
- [test] A stacked-feature test with an unparseable feature-level work order asserts the file is deleted and BUILD is dispatched for a child with no open case.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — removal branch of adoption
- `src/conductor/test/engine/remediation-case-child.test.ts` — removal cases

**Dependencies:** Tasks 3, 4, 5, 12

### Task 14: A classifier decides whether a stall question is a stale citation
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in a new `src/conductor/test/engine/build-stall-stale-citation.test.ts`.
2. Verify RED.
3. Implement a new module `src/conductor/src/engine/build-stall-stale-citation.ts` exporting a pure classifier. Input: the question text, the active child, and each child's case-store read result. It collects every case id held by a readable store that occurs in the text. Result is `stale` with the case id, owning child, and `resolved` or `foreign` only when at least one cited case exists, every store was readable, and no cited case is open in the active child's store; otherwise `not-stale`. It matches stored ids only and never parses the prose.
4. Verify GREEN.
5. Commit: "feat: classify a stale citation in a BUILD stall question".

**Done when:**
- [test] The classifier test asserts `stale` with state `resolved` and owner child 4 for a question naming a case resolved in child 4's store while the active child is 3, and `stale` with state `foreign` for a case open only in child 4's store.
- [test] The classifier test asserts `not-stale` for a question naming a case open in the active child's store, for a question naming no id held by any store, and for a null or empty question.
- [test] The classifier test asserts `not-stale` when any child's case store read failed, and `not-stale` when the question names both a resolved case and a case open in the active child's store.

**Files likely touched:**
- `src/conductor/src/engine/build-stall-stale-citation.ts` — new classifier module
- `src/conductor/test/engine/build-stall-stale-citation.test.ts` — unit cases

**Dependencies:** none

### Task 15: A stale citation is recorded on the event spine with its attempt number
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/build-stall-stale-citation.test.ts`.
2. Verify RED.
3. Implement: add a `build_stall_stale_citation` variant to the `ConductorEvent` union in `src/conductor/src/types/events.ts` with `caseId`, `ownerChild`, `state` (`resolved` or `foreign`), `resolvedTasks`, and `attempt`. In the classifier module add a recorder that reads `.pipeline/events.jsonl` backwards, counts consecutive `build_stall_stale_citation` events with the same `caseId` and the same `resolvedTasks`, stops at the first such event that differs in either, sets `attempt` to that count plus one, and persists the event with `persistOnActiveEventSpine`. It returns the attempt, or a persist-failed result when the write throws. Follow the bounded-stop pattern of `recordRoundStall`: count from the feature event log; a persist failure is reported, never swallowed.
4. Verify GREEN.
5. Commit: "feat: record stale citations with an event-derived attempt".

**Done when:**
- [test] The recorder test asserts the persisted `build_stall_stale_citation` event in `.pipeline/events.jsonl` carries the case id, the owning child, the state, and the attempt number.
- [test] The recorder test asserts attempts 1, 2, 3 for three consecutive records of the same case with the same resolved-task count, read from the event log with a fresh recorder each time.
- [test] The recorder test asserts attempt 1 after two records of one case when the next record has a higher resolved-task count, and attempt 1 when the next record names a different case.
- [test] The recorder test asserts a persist-failed result, and no attempt, when the event write throws.

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new event variant
- `src/conductor/src/engine/build-stall-stale-citation.ts` — recorder
- `src/conductor/test/engine/build-stall-stale-citation.test.ts` — recorder cases

**Dependencies:** Task 14

### Task 16: A stale citation re-dispatches BUILD and dispatches no remediation
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-loop-policies.test.ts`.
2. Verify RED.
3. Implement: at each seam in `conductor.ts` where a BUILD `halt_marker` stall question has been read and before the marker is cleared or `planRemediation` is called, read every child's case store, run the classifier, and for a `stale` result call the recorder. For attempt 1 or 2: clear the marker, set the BUILD retry hint to a sentence stating the case id, that it is resolved or belongs to the named child, and that it is not this session's work, then continue the BUILD loop without consuming a retry and without changing the remediation round count. A `not-stale` result falls through to the existing code unchanged.
4. Verify GREEN.
5. Commit: "feat: answer a stale citation with a BUILD re-dispatch".

**Done when:**
- [test] A conductor test where child 3's BUILD stalls naming a case resolved in child 4's store asserts no remediation session is dispatched, the stall marker file is cleared, and BUILD is dispatched again for child 3 in the same run.
- [test] A conductor test where the named case is open only in child 4's store asserts BUILD is dispatched again for child 3 and no remediation session is dispatched.
- [test] The re-dispatched BUILD's prompt is asserted to state the case id, that the case is settled or belongs to child 4, and that it is not this session's work.
- [test] The conductor test asserts exactly one `build_stall_stale_citation` event with the case id, owning child, state and attempt is in `.pipeline/events.jsonl` after the stale citation is handled.
- [test] The conductor test asserts the run's remediation round count is the same after the stale-citation re-dispatch as before the stall.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — stale-citation branch at the stall seams
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — resolved and foreign cases

**Dependencies:** Tasks 4, 14, 15

### Task 17: A stall that is not a stale citation still takes stall remediation
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing-or-pinning conductor tests in `src/conductor/test/engine/conductor-loop-policies.test.ts` for each not-stale case, asserted at the conductor's stall seam.
2. Verify they exercise the new branch (RED where the branch mis-routes).
3. Implement any correction needed so each case falls through to the existing stall code.
4. Verify GREEN.
5. Commit: "test: non-stale stalls keep the stall-remediation path".

**Done when:**
- [test] A conductor test where child 3's BUILD stalls naming a case open in child 3's own store asserts stall remediation is dispatched with the same projection as before this change and no `build_stall_stale_citation` event is recorded.
- [test] A conductor test where the question names no case known to any child's store asserts stall remediation is dispatched as before.
- [test] A conductor test for a zero-work stall with no question asserts the existing zero-work stall path runs with the same dispatch and events as before this change.
- [test] A conductor test where one child's case store cannot be read during the check asserts stall remediation is dispatched as before.
- [test] A conductor test where the question names both a resolved case and a case open in the active child's store asserts stall remediation is dispatched as before.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — fall-through corrections if any
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — not-stale cases

**Dependencies:** Task 16

### Task 18: Repeated stale citations halt mechanical, then needs-human
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-loop-policies.test.ts` that seed prior `build_stall_stale_citation` events in `.pipeline/events.jsonl` to simulate a restart and a daemon re-kick.
2. Verify RED.
3. Implement: in the stale-citation branch, for attempt 3 call `writeStallHalt` with the session's question, a detail naming the case id, its owning child, and `ai-conductor halt clear --feature <slug> --rationale "<why>"`, and class `mechanical`; for attempt 4 or higher, and for a persist-failed recorder result, the same call with class `needs-human`. The detail never mentions `resolve-case`. After either HALT the run emits its loop halt and dispatches no further BUILD.
4. Verify GREEN.
5. Commit: "feat: bound stale-citation re-dispatch with mechanical then needs-human halts".

**Done when:**
- [test] A conductor test with two prior stale citations of the same case and no completed task between them asserts the third writes a HALT with class `mechanical` whose body carries the session's question verbatim and names the case and its owning child, and that no further BUILD is dispatched in that run.
- [test] A conductor test started fresh with three prior stale citations of the same case in the event log, as after a daemon re-kick, asserts the fourth writes a HALT with class `needs-human` naming the case and its owning child.
- [test] A conductor test whose stale-citation event write throws asserts a HALT with class `needs-human` is written and BUILD is not re-dispatched.
- [test] A conductor test started in a fresh process with two prior stale citations of the same case asserts the next one is counted as attempt 3 and halts `mechanical`.
- [test] The HALT bodies of both classes are asserted to name `ai-conductor halt clear` as the way forward and to contain no mention of `resolve-case`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — halt branches
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — attempts 3 and 4, persist failure, restart

**Dependencies:** Task 16

### Task 19: The stale-citation count restarts on task progress and on a different case
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing conductor tests in `src/conductor/test/engine/conductor-loop-policies.test.ts`.
2. Verify RED where the seam does not pass the current resolved-task count to the recorder.
3. Implement: the stall seam passes the resolved-task count it already computed for the stall to the recorder.
4. Verify GREEN.
5. Commit: "feat: stale-citation bound resets on progress".

**Done when:**
- [test] A conductor test with two prior stale citations of one case followed by a completed task asserts the next stale citation of the same case is recorded as attempt 1 and BUILD is re-dispatched.
- [test] A conductor test with two prior stale citations of one case asserts a stale citation of a different case is recorded as attempt 1 for that case and BUILD is re-dispatched.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — pass resolved-task count
- `src/conductor/test/engine/conductor-loop-policies.test.ts` — reset cases

**Dependencies:** Task 18

### Task 20: The existing halt clear and resolve-case commands behave as before on a stale-citation HALT
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Add tests to `src/conductor/test/engine/halt-clear-cli.test.ts` and `src/conductor/test/engine/daemon-pick-eligible.test.ts`, using a worktree fixture holding a `needs-human` stale-citation HALT whose cited case is resolved.
2. Run them; they prove existing command behavior on the new HALT body.
3. No production change is expected. If either test fails, the HALT body written by Task 18 is corrected so the existing commands accept it.
4. Verify GREEN.
5. Commit: "test: halt clear accepts a stale-citation HALT; resolve-case still refuses".

**Done when:**
- [test] A CLI test asserts that `ai-conductor halt clear` run against a feature holding a `needs-human` stale-citation HALT removes the HALT marker and its class file, and that the daemon's next eligibility pick then selects the feature and dispatches it again.
- [test] A CLI test asserts that `ai-conductor build-review resolve-case` for the cited, already resolved case still exits refused with the already-resolved message and leaves the HALT in place.

**Files likely touched:**
- `src/conductor/test/engine/halt-clear-cli.test.ts` — halt clear and resolve-case on a stale-citation HALT
- `src/conductor/test/engine/daemon-pick-eligible.test.ts` — feature is picked and dispatched after the clear

**Verify-only:** yes

**Dependencies:** Task 18

## Optional Task Dependency Graph

```
1 → 2 → 8 → 9
        2 → 12 → 13
3 ─┬→ 6 → 7
5 ─┤   6 → 10
2 ─┘
4 → 11
4, 14 → 15 → 16 → 17
                16 → 18 → 19
                     18 → 20
3, 4, 5 → 13
```

## Integration Points

- After Task 2: a two-child feature delivers each child only its own work order through the BUILD dispatch prompt.
- After Task 8: a settled region holds no work order or judgement.
- After Task 13: a feature left mid-remediation by an older engine resumes without a HALT.
- After Task 18: a stale citation is bounded end to end through the conductor's stall seam.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D1 | task | task-2, task-3, task-4 | asserts the published work order exists under `.pipeline/children/4/` and no work order exists at the feature-level `.pipeline/` path |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D2 | task | task-5, task-6, task-7 | asserts that after the engine parses it the file exists at `.pipeline/children/4/remediation.json` and no longer exists at the feature-level path |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D3 | task | task-8, task-10, task-11 | asserts that region's work order and judgement files no longer exist after settlement |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D4 | task | task-12, task-13 | asserts that before a child's BUILD dispatch the order is moved to `.pipeline/children/4/` and that child 4's BUILD dispatch prompt carries its tasks |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D5 | task | task-14, task-16, task-17 | asserts no remediation session is dispatched, the stall marker file is cleared, and BUILD is dispatched again for child 3 in the same run |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D6 | task | task-15, task-18, task-19 | asserts the third writes a HALT with class `mechanical` whose body carries the session's question verbatim and names the case and its owning child |
| adr-2026-11-15-remediation-build-inputs-are-region-state-retired-on-settlement#D7 | task | task-16 | asserts the run's remediation round count is the same after the stale-citation re-dispatch as before the stall |
| adr-2026-07-10-daemon-stall-remediation#D1 | task | task-4, task-11 | asserts the captured question is written to `.pipeline/children/3/build-stall-question.md` and that the remediation dispatch cites that region path as its evidence file |
| adr-2026-07-10-daemon-stall-remediation#D2 | task | task-16, task-17 | asserts stall remediation is dispatched with the same projection as before this change and no `build_stall_stale_citation` event is recorded |
| adr-2026-07-10-daemon-stall-remediation#D3 | existing | none | The conductor's stall branch already consumes a `route` outcome targeting `build` in the retry loop by setting the retry hint and continuing without burning an attempt; this feature leaves that branch unchanged for every stall that is not a stale citation |
| adr-2026-07-10-daemon-stall-remediation#D4 | existing | none | `writeStallHalt` in `task-progress.ts` already writes the question as the first block of `.pipeline/HALT` for a `halt` outcome; the stale-citation halts reuse the same writer |
| adr-2026-07-10-daemon-stall-remediation#D5 | existing | none | The conductor's stall branch already calls `writeStallHalt` with the question on dispatch failure, a `none` outcome, and budget exhaustion; those branches are unchanged |
| adr-2026-07-10-daemon-stall-remediation#D6 | no-change | none | A stale citation is decided before `planRemediation` and charges no remediation round, so the shared `remediationRounds` budget and its cap are untouched |
| adr-2026-07-10-daemon-stall-remediation#D7 | no-change | none | The remediate skill's `build_stall` input class is not modified; a stale citation never reaches the skill |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
