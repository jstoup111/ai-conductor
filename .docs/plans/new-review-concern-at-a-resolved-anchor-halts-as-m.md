# Implementation Plan: New review concern at a resolved anchor halts as malformed case state

**Date:** 2026-10-02
**Design:** none (technical track)
**Stories:** .docs/stories/new-review-concern-at-a-resolved-anchor-halts-as-m.md
**Conflict check:** Clean as of 2026-10-02

## Summary

Let a judge-declared new concern at a source already linked from a resolved action case open its own case, keep an undeclared reuse on the existing regression halt, and report a rejected case transition separately from corrupt persisted history. 13 tasks.

## Technical Approach

- **Ownership (Tasks 1, 2).** `parseBuildReviewCases` in `remediation-case-store.ts` stops treating every source id as globally unique. It enforces one link per source within a case and at most one unresolved owner per source. Resolved cases keep their links. `RemediationCaseStore.mutate` returns a new `rejected-transition` reason when only the proposed next state fails validation. Read-path reasons (`malformed-state`, `malformed-json`, `unknown-version`) are unchanged.
- **Declaration (Tasks 3, 4, 12).** A case-v2 unbound row may carry `distinctFrom`, a list of existing case ids, and the build_review store record persists it.
  - `validateRemediationCaseGraph` admits it only when the list equals exactly the resolved `act` prior cases whose non-merged link matches one of the row's sources.
  - Validation compares ids, dispositions, resolutions, and link outcomes. It never compares rationale, so the "is this the same concern?" judgement stays with the remediate judge, as portable-policy D8 requires.
  - The case-row parser's enumerated key sets become a required-plus-optional check, so adding one optional field does not double the variants.
  - The remediate skill's case-v2 section tells the judge when to declare.
- **Reconciliation (Tasks 5, 6).** `reconcileRemediationCases` stamps an admitted declared row as a new open case carrying its lineage, and never touches R. An undeclared reuse of a resolved action case's source returns a recurrence of every such case, so the coordinator's existing `classifyRemediationCaseReuse` halt-regression branch fires: one `remediation_semantic_repeat_halt` with reason `regressed` per case.
- **Readers (Tasks 8, 9).** `currentSourceCoverageIsConsistent` and the coordinator's finalized-source set read a source through its unresolved owner, so a resolved link never contradicts the current case. A source is settled when a resolved case linking it is finalized under D5.1/D5.3 and no unresolved case owns it.
- **Diagnostics and wiring (Tasks 7, 10).** `remediation_adjudication_failed` gains additive `failureKind`, `caseIds`, and `sourceIds` fields, registered with every sink. The needs-human HALT reason says persisted history is valid. The coordinator lap is the production entry point: it passes prior case records into validation and publishes admitted cases through the unchanged work-order and kickback path.
- **Proof (Tasks 11, 13).** A recovery integration test replays the issue's saved store. The findings view renders the lineage in human and JSON modes.
- **Local pattern.** The #2409 refutation lane is the precedent: an optional judge-authored case-row field, parsed in `remediation-case-artifact.ts`, reference-checked in `remediation-case-validator.ts`, state-gated in `remediation-case-reconciler.ts`, and pinned in the remediate skill contract test. `distinctFrom` carries references only, with no evidence anchors. To rediscover it, search for `refutation` in those files and in `remediation-case-reconciler.test.ts`.
- **Shared fixture.** Tests share one fixture: resolved action case R with an applied effect and a single `acted` link to source S, the shape saved on the halted `no-daemon-level-metrics-queue-depth-halts-and-gate` feature.

## Prerequisites

- None. No migration, envelope version change, or new dependency.

## Tasks

### Task 1: Lifecycle-scoped source ownership in the case store parse
**Story:** 4
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing store tests: a build_review store fixture holding resolved action case R and one open case that both link source S loads through `RemediationCaseStore.load`; a fixture linking S from two unresolved cases fails `malformed-state`; a fixture repeating S within one case fails `malformed-state`; a pre-change v1 and v2 fixture with globally unique sources loads unchanged with its file bytes untouched.
2. Verify the resolved-plus-open test fails (RED) against the current global source set in `parseBuildReviewCases`.
3. Implement: replace the global source-id set in `parseBuildReviewCases` with a per-case uniqueness check plus a map of source id to the single unresolved (`resolution: open`) owner; a second unresolved owner returns `malformed-state`. Resolved cases never count as owners. Do not touch the `prd_widening` parser.
4. Verify GREEN and commit: "fix(remediation): scope build_review source ownership to unresolved cases".

**Done when:**
- `parseBuildReviewCases` admits a build_review store where one source id is linked by a resolved case and by at most one unresolved case, as asserted by a store test that reads the resolved-plus-open fixture back with every case field preserved.
- A persisted store whose same source id is linked by two unresolved cases fails `RemediationCaseStore.load` with reason `malformed-state`, as asserted by a store test over that fixture.
- A source id repeated within one case still fails `RemediationCaseStore.load` with reason `malformed-state`.
- Pre-change v1 and v2 store fixtures with globally unique sources load through `RemediationCaseStore.load` with identical parsed state and no write, as asserted by a byte comparison of each file after the read.
- Any store written before this change — every store the pre-change validator accepted, covering v1, v2, an empty case list, and a store carrying suppressions and PRD-widening cases — is read by the fixed engine and parses unchanged with no migration step and no rewrite on read, as asserted by a parameterized load-and-byte-compare test over those fixtures.

**Files:**
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** none

### Task 2: Distinguish a rejected next state from malformed persisted state
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing store tests: `RemediationCaseStore.mutate` over a valid persisted store whose operation returns a next state linking S from two unresolved cases returns reason `rejected-transition` and leaves the file byte-identical; malformed persisted state and invalid JSON keep their existing reasons through both `load` and `mutate`.
2. Verify RED: today the next-state failure returns `malformed-state`.
3. Implement: add `rejected-transition` to `RemediationCaseStoreFailureReason`; in `mutate`, map a `parseState(mutation.nextState)` failure to `rejected-transition` before `atomicReplace`, leaving the read-path reasons unchanged.
4. Verify GREEN and commit: "fix(remediation): report a rejected case-store transition separately from corrupt history".

**Done when:**
- `RemediationCaseStore.mutate` returns reason `rejected-transition` when the persisted state parses but the next state fails validation, as asserted by a store test whose next state links one source from two unresolved cases.
- On that `rejected-transition` result the store file is byte-identical to its pre-mutation content and no atomic replace is attempted.
- `RemediationCaseStore.mutate` still returns `malformed-state` when the persisted file itself fails validation, as asserted by a store test over that fixture.
- `RemediationCaseStore.load` and `RemediationCaseStore.mutate` both still return `malformed-json` for a persisted file that is not valid JSON.

**Files:**
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** Task 1

### Task 3: Parse and persist an optional distinctFrom declaration
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing tests: the case-v2 artifact parser returns `distinctFrom` on an unbound row; it rejects a row carrying both `existingCaseId` and `distinctFrom`; it rejects an empty or duplicate-id list; a case-v1 row carrying `distinctFrom` is rejected; a build_review store record round-trips an optional `distinctFrom` list and a record without it keeps no such key.
2. Verify RED.
3. Implement: add optional `distinctFrom` to `RemediationCaseRow` and to the build_review `RemediationCaseRecord`; replace the enumerated key-set variants in the case-row parser with a required-plus-optional key check so one optional field does not double the variants (behavior-preserving for every existing key set); accept `distinctFrom` only in case-v2 mode and only without `existingCaseId`.
4. Verify GREEN and commit: "feat(remediation): parse and persist case-v2 distinctFrom declarations".

**Done when:**
- The case-v2 parser in `remediation-case-artifact.ts` accepts an unbound case row carrying `distinctFrom` as a non-empty list of distinct case ids and returns it on the parsed row.
- The case-v2 parser rejects a row that carries both `existingCaseId` and `distinctFrom` as a malformed judgement, as asserted by an artifact test.
- The case-v1 parser rejects any row carrying `distinctFrom` as malformed, and every pre-existing case-row key set still parses identically, as asserted by the existing artifact tests passing unchanged.
- `RemediationCaseStore` round-trips an optional `distinctFrom` list on a build_review case record, and a record without it reads back with no `distinctFrom` key.

**Files:**
- src/conductor/src/engine/remediation-case-artifact.ts
- src/conductor/src/engine/remediation-case-store.ts
- src/conductor/test/engine/remediation-case-artifact.test.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** Task 1

### Task 4: Validate a distinctFrom declaration against prior-case state
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing validator tests over the shared fixture (resolved `act` case R, applied effect, link to S with outcome `acted`): an exact declaration is admitted even though its rationale differs from R; unknown id, open case, non-act case, merged link, incomplete set, unnecessary declaration, and an unbound refute row carrying `distinctFrom` are each rejected with their typed reason.
2. Verify RED.
3. Implement: extend the validator references with the prior case records (id, disposition, resolution, source links) alongside the existing `existingCaseIds`; for an unbound row, compute the set of resolved cases linking any of its sources and require `distinctFrom` to equal the set of resolved `act` cases whose matching link is not `merged`. Compare only ids, dispositions, resolutions, and link outcomes, never rationale. Keep `refute-without-binding` first.
4. Verify GREEN and commit: "feat(remediation): validate distinctFrom against durable case state".

**Done when:**
- `validateRemediationCaseGraph` admits a declared row when `distinctFrom` equals exactly the set of resolved `act` prior cases whose non-merged link matches one of the row's sources, as asserted by a validator test whose rationale text differs from every prior case's rationale.
- `validateRemediationCaseGraph` rejects with reason `unknown-distinct-case` when `distinctFrom` names an id absent from the supplied prior cases, and with `invalid-distinct-case` naming the case when it names an open case, a non-`act` case, or a case whose link to the source has outcome `merged`; each such rejection returns `ok: false`, so no case is stamped.
- `validateRemediationCaseGraph` rejects with reason `incomplete-distinct-declaration` naming the omitted case when two resolved `act` cases link the source and only one is declared.
- `validateRemediationCaseGraph` rejects with reason `unnecessary-distinct-declaration` when no resolved case links any of the row's sources.
- An unbound `refute` row carrying `distinctFrom` is rejected by `validateRemediationCaseGraph` with the existing `refute-without-binding` reason whether its declaration is valid or would be unknown, invalid, incomplete, or unnecessary, and never with a declaration reason, as asserted by one validator test per case.

**Files:**
- src/conductor/src/engine/remediation-case-validator.ts
- src/conductor/test/engine/remediation-case-validator.test.ts

**Dependencies:** Task 3

### Task 5: Reconcile an admitted distinct case without touching resolved history
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing reconciler tests over the shared fixture: a declared action row for S stamps a new open `act` case with `distinctFrom` [R] and leaves R unchanged; a second unresolved owner of S is rejected with a typed reason naming both cases and S; a judgement containing any rejected row stamps nothing and leaves the store file byte-identical.
2. Verify RED: today the append fails as a store `malformed-state`.
3. Implement: in `reconcileState`, carry the admitted `distinctFrom` onto the new record; before mutation, reject with `second-unresolved-owner` (case ids + source ids) when any proposed source already has an unresolved owner other than a case the same graph binds; keep the all-or-nothing mutation.
4. Verify GREEN and commit: "feat(remediation): admit declared distinct cases at a resolved source".

**Done when:**
- `reconcileRemediationCases` given the shared fixture and a declared action row for S stamps one new open `act` case linking S with `distinctFrom` equal to R's id, as asserted by a reconciler test.
- In that test R's resolution, effect, rationale, and source links are deep-equal to the pre-lap record and the resulting state reads back valid through `RemediationCaseStore.load`.
- When the store already holds another unresolved case linking S, `reconcileRemediationCases` returns `ok: false` with reason `second-unresolved-owner` carrying both case ids and S, and stamps no case.
- When any row in the judgement is rejected, `reconcileRemediationCases` stamps no case for any row and the persisted store file is byte-identical to its pre-lap content.

**Files:**
- src/conductor/src/engine/remediation-case-reconciler.ts
- src/conductor/test/engine/remediation-case-reconciler.test.ts

**Dependencies:** Tasks 2, 4

### Task 6: Treat an undeclared reuse as a recurrence of the prior case
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: in case-v2 and case-v1 modes an unbound action row for S without `distinctFrom` yields a recurrence of R and no new case; the coordinator halts needs-human and emits `remediation_semantic_repeat_halt` reason `regressed` naming R; with R and R2 both linking S, exactly two regressed events name R and R2.
2. Verify RED: today both modes fail as `case store malformed-state`.
3. Implement: in the reconciler, an unbound row with no valid declaration whose sources are linked by resolved `act` cases returns a recurrence result naming every such case instead of appending; in the coordinator, route that result through the existing `classifyRemediationCaseReuse` halt-regression branch once per recurring case.
4. Verify GREEN and commit: "fix(remediation): halt an undeclared resolved-source reuse as a regression".

**Done when:**
- `reconcileRemediationCases` treats an unbound row for S without `distinctFrom` as a recurrence of every resolved `act` case linking S and stamps no new case, as asserted by a reconciler test in case-v2 mode and another in case-v1 mode.
- In both case-v2 and case-v1 modes the adjudication coordinator halts needs-human for that recurrence and emits one `remediation_semantic_repeat_halt` with reason `regressed` per recurring prior case, naming R, as asserted by one coordinator test per mode.
- With resolved cases R and R2 both linking S, the coordinator emits exactly two `regressed` events naming R and R2, and its halt detail names both ids.
- No `remediation_adjudication_failed` reason emitted for the undeclared reuse contains `malformed-state`, as asserted in both mode tests.

**Files:**
- src/conductor/src/engine/remediation-case-reconciler.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/remediation-case-reconciler.test.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 5

### Task 7: Typed failure evidence on remediation_adjudication_failed
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests: a coordinator lap rejected by the validator, by the reconciler, or by a `rejected-transition` store result emits `remediation_adjudication_failed` with `failureKind`, `caseIds`, and `sourceIds`, and its HALT reason states persisted history is valid; a persisted two-unresolved-owner store emits `failureKind` `persisted-malformed`; the event passes every registered sink.
2. Verify RED.
3. Implement: add optional `failureKind` (`rejected-transition`, `invalid-judgement`, `reconciliation-rejected`, `persisted-malformed`), `caseIds`, and `sourceIds` to the event member; set them in the coordinator's `fail` path; append "persisted case history is valid" plus the typed reason to the HALT detail for every non-persisted kind; register the fields with every sink in `event-sinks.ts` (persist-only, as today).
4. Verify GREEN and commit: "feat(remediation): carry typed rejection evidence on adjudication failures".

**Done when:**
- The `remediation_adjudication_failed` member of the `ConductorEvent` union gains optional `failureKind`, `caseIds`, and `sourceIds`, and the coordinator's `fail` path sets all three for every validator rejection, reconciler rejection, and `rejected-transition` store result, as asserted by coordinator tests checking each value, including a `second-unresolved-owner` lap whose event `caseIds` name both owners and whose `sourceIds` name S.
- On those rejections the coordinator's needs-human HALT reason states that persisted case history is valid and names the typed reason.
- A lap whose persisted store links one source from two unresolved cases emits `remediation_adjudication_failed` with `failureKind` `persisted-malformed`, never `rejected-transition`, as asserted by a coordinator test.
- An event-sinks test passes a `remediation_adjudication_failed` event carrying all three new fields through every registered sink with no unknown-key failure.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts
- src/conductor/test/engine/event-sinks.test.ts

**Dependencies:** Task 6

### Task 8: Route and check coverage from the current owner of a source
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing reducer tests: with resolved R (`acted`) and an open action case for S carrying a different outcome, coverage is consistent and the route is `build`; with S linked only by resolved cases and absent from the lap, the route is `pass` with no decision stop from them.
2. Verify RED: today the two outcomes for S make coverage contradictory.
3. Implement: in `currentSourceCoverageIsConsistent`, take a source's outcome from its unresolved owner when one exists and ignore resolved links for that source; leave decision-stop and action-case filters keyed on current sources and unresolved cases.
4. Verify GREEN and commit: "fix(build-review): read source coverage from the unresolved owner".

**Done when:**
- `currentSourceCoverageIsConsistent` reads each current source's outcome from its unresolved owner when one exists, so the resolved-plus-open fixture with differing outcomes for S yields consistent coverage, as asserted by a `reduceBuildReviewAdjudication` test.
- In that test `reduceBuildReviewAdjudication` returns route `build` following the open action case for S.
- For a store where S is linked only by resolved cases and the lap does not report S, `reduceBuildReviewAdjudication` returns route `pass` with no decision stop contributed by those resolved cases.

**Files:**
- src/conductor/src/engine/build-review-adjudication.ts
- src/conductor/test/engine/build-review-adjudication.test.ts

**Dependencies:** Task 1

### Task 9: Keep the settled predicate correct for shared sources
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing coordinator tests: with R (`acted`) and an open case linking S, S stays among current findings dispatched to the judge; after the declared distinct case resolves as a finalized deferral, the next lap drops S and writes no regression halt; after it is attempted and refuted (effect `none` or an applied residual deferral), the next lap drops S and writes no regression halt for R or for the refuted case.
2. Verify RED for the refuted-distinct-case lap.
3. Implement: in the coordinator's finalized-source set, a source is finalized when any resolved case linking it is finalized under D5.1/D5.3 and no unresolved case owns it; recurrence classification skips a source the predicate settled.
4. Verify GREEN and commit: "fix(build-review): settle shared sources by their finalized owner".

**Done when:**
- The coordinator's finalized-source set keeps S live when R's link to S is `acted` and an open case links S, as asserted by a coordinator test that dispatches the judge with S among current findings.
- When the declared distinct case for S has resolved as a finalized deferral, the next lap removes S from the live set and writes no regression halt.
- When the declared distinct case for S was attempted and resolved by refutation with effect `none` or an applied residual deferral, the next lap removes S from the live set and writes no regression halt for R or for the refuted case.

**Files:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 7

### Task 10: Wire declarations through the adjudication lap and work order
**Story:** 1
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing coordinator tests replaying the issue-shaped store (resolved R at S, applied action, `acted` link) with a judgement holding a declared action row for S and an unrelated sibling action row; plus an exhausted-budget lap and an attempted-repeat lap for an admitted distinct case.
2. Verify RED: today the lap fails as `case store malformed-state`.
3. Implement: pass the prior case records from the case store into `validateRemediationCaseGraph` references alongside `existingCaseIds`, so the coordinator's lap is the production entry point for declarations; publish admitted cases through the existing work-order and kickback path unchanged.
4. Verify GREEN and commit: "feat(build-review): admit declared distinct cases through the adjudication lap".

**Done when:**
- A coordinator test replaying the issue-shaped store with a declared action row for S plus an unrelated sibling action row publishes one BUILD work order containing both new action cases and does not halt.
- In that test the kickback ledger records exactly one `build_review` charge for the work order's effect id.
- A coordinator test whose kickback budget is exhausted grants no BUILD route for a declared distinct case and halts with the existing exhaustion reason.
- A coordinator test where the admitted distinct case was attempted and the next lap again proposes action on it halts with `remediation_semantic_repeat_halt` reason `already-attempted`.

**Files:**
- src/conductor/src/engine/build-review-adjudication-coordinator.ts
- src/conductor/test/engine/build-review-adjudication-coordinator.test.ts

**Dependencies:** Task 9

### Task 11: Recover a feature halted by the defect without editing history
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write a recovery integration test from the issue-shaped store saved by the defective engine: clear the HALT, re-run the lap with a declared judgement (admitted, R byte-identical), then re-run with an undeclared judgement (regression halt, all cases byte-identical, HALT reason free of delete or accept instructions); add a store test for an unknown envelope version.
2. Verify the declared re-run assertions fail on the pre-change engine (RED).
3. Implement: no new production code is expected beyond Tasks 1-10; fix only what this test exposes inside the files those tasks own.
4. Verify GREEN and commit: "test(remediation): prove recovery of a malformed-state halt preserves history".

**Done when:**
- A recovery integration test loads the issue-shaped store saved by the defective engine, clears the HALT, re-runs the lap with a declared judgement, and the lap admits the new case for S.
- In that test R's serialized record, including its applied effect and resolution evidence, is byte-identical before and after the re-run.
- Re-running the same lap with a judgement that omits the declaration halts as a regression of R, leaves every persisted case byte-identical, and its HALT reason contains no instruction to delete cases or accept the finding.
- `RemediationCaseStore.load` on a file declaring an unknown envelope version returns `unknown-version` and leaves the file byte-identical.

**Files:**
- src/conductor/test/integration/remediation-case-recovery.integration.test.ts
- src/conductor/test/engine/remediation-case-store.test.ts

**Dependencies:** Task 10

### Task 12: Teach the remediate judge when to declare distinctFrom
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Write failing contract test: the pinned case-row field sentence lists optional `distinctFrom` for unbound rows only, and the case-v2 section states the exact-set rule and that an undeclared reuse halts as a regression.
2. Verify RED against the current skill text.
3. Implement: extend the case-v2 section of `skills/remediate/SKILL.md` with `distinctFrom`: when to declare it (a concern the judge concludes is not the resolved case recurring), that it names exactly the resolved action cases linking the row's sources, and that omitting it makes the row a regression of those cases.
4. Verify GREEN and commit: "docs(remediate): describe case-v2 distinctFrom declarations" with the skill and test together.

**Done when:**
- The case-v2 section of `skills/remediate/SKILL.md` lists `distinctFrom` as an optional field of unbound rows only and states that it must name exactly the resolved action cases linking the row's sources.
- The skill text states that a row reusing such a source without `distinctFrom` is treated as a recurrence of the prior case and halts as a regression.
- `remediate-skill-contract.test.ts` pins the extended case-row field sentence including optional `distinctFrom` and fails against the pre-change skill text.

**Files:**
- skills/remediate/SKILL.md
- src/conductor/test/engine/remediate-skill-contract.test.ts

**Dependencies:** Task 3

### Task 13: Render declared lineage in the findings view
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing findings CLI tests in human and JSON modes: a case with `distinctFrom` names its predecessors on its line and carries a `distinctFrom` array in JSON; an undeclared case renders exactly as before in both modes.
2. Verify RED.
3. Implement: append a `distinct from: <ids>` segment to the autonomous case line only when `distinctFrom` is present; include the field in the JSON case object only when present.
4. Verify GREEN and commit: "feat(build-review): show declared distinct lineage in findings".

**Done when:**
- `build-review-cli.ts` findings human output for a case with `distinctFrom` names each declared predecessor case id on that case's line.
- The findings JSON output for that case carries a `distinctFrom` array equal to the declared predecessor ids.
- For a case without a declaration, the human line and its JSON object are byte-identical to the pre-change rendering, with no lineage text and no `distinctFrom` key, as asserted against fixtures captured from current output.

**Files:**
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/test/engine/build-review-cli.test.ts

**Dependencies:** Task 3

## Task Dependency Graph

```text
Task 1 ─┬─> Task 2 ──┐
        ├─> Task 3 ─┬─> Task 4 ──┴─> Task 5 ─> Task 6 ─> Task 7 ─> Task 9 ─> Task 10 ─> Task 11
        │           ├─> Task 12
        │           └─> Task 13
        └─> Task 8
```

## Integration Points

- After Task 10: the build_review adjudication lap admits a declared distinct case end-to-end, from a judge result to a published BUILD work order.
- After Task 11: a feature halted by this defect recovers by clearing its HALT.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the shared fixture and a case-v2 judgement whose unbound action row for S carries `distinctFrom` naming exactly R, when the lap reconciles, then a new open action case is stamped for S, R keeps its resolution, effect, and link unchanged, and the store reads back valid. | 5 | "`reconcileRemediationCases` given the shared fixture and a declared action row for S stamps one new open `act` case linking S with `distinctFrom` equal to R's id, as asserted by a reconciler test." | diff-local |
| Story 1 happy: Given the issue's recorded judgement, with a declared action row for S and an unrelated sibling action row, when the lap reconciles and publishes, then both new action cases appear in one BUILD work order and the lap does not halt. | 10 | "A coordinator test replaying the issue-shaped store with a declared action row for S plus an unrelated sibling action row publishes one BUILD work order containing both new action cases and does not halt." | diff-local |
| Story 1 negative: Given the shared fixture and a declared row for S, when the store already holds a different unresolved case linking S, then the lap is rejected with the typed reason for a second unresolved owner, the event names both case ids and S, and no case is added. | 7, 5 | "The `remediation_adjudication_failed` member of the `ConductorEvent` union gains optional `failureKind`, `caseIds`, and `sourceIds`, and the coordinator's `fail` path sets all three for every validator rejection, reconciler rejection, and `rejected-transition` store result, as asserted by coordinator tests checking each value, including a `second-unresolved-owner` lap whose event `caseIds` name both owners and whose `sourceIds` name S." | diff-local |
| Story 1 negative: Given a declared row for S whose sibling row in the same judgement is invalid, when the lap reconciles, then neither case is stamped and the persisted store is byte-identical to its pre-lap content. | 5, 4 | "When any row in the judgement is rejected, `reconcileRemediationCases` stamps no case for any row and the persisted store file is byte-identical to its pre-lap content." | diff-local |
| Story 2 happy: Given the shared fixture and an unbound action row for S with no `distinctFrom`, when the lap reconciles, then it halts needs-human as a regression of R, a semantic repeat halt event with reason `regressed` names R, and no new case is stamped. | 6 | "In both case-v2 and case-v1 modes the adjudication coordinator halts needs-human for that recurrence and emits one `remediation_semantic_repeat_halt` with reason `regressed` per recurring prior case, naming R, as asserted by one coordinator test per mode." | diff-local |
| Story 2 happy: Given an admitted distinct case for S that BUILD attempted, when the next lap reports S again and the judge again proposes action on it, then the lap halts as an attempted repeat exactly as any action case does. | 10 | "A coordinator test where the admitted distinct case was attempted and the next lap again proposes action on it halts with `remediation_semantic_repeat_halt` reason `already-attempted`." | diff-local |
| Story 2 happy: Given an admitted distinct case for S, when its work order is published, then the build_review kickback is charged exactly once for that route. | 10 | "In that test the kickback ledger records exactly one `build_review` charge for the work order's effect id." | diff-local |
| Story 2 negative: Given the shared fixture and an undeclared reuse row in case-v1 mode, when the lap reconciles, then it halts as a regression of R and never as a malformed case store. | 6 | "`reconcileRemediationCases` treats an unbound row for S without `distinctFrom` as a recurrence of every resolved `act` case linking S and stamps no new case, as asserted by a reconciler test in case-v2 mode and another in case-v1 mode." | diff-local |
| Story 2 negative: Given the kickback budget is exhausted, when a judgement declares a distinct case for S, then no BUILD route is granted and the existing exhaustion halt applies. | 10 | "A coordinator test whose kickback budget is exhausted grants no BUILD route for a declared distinct case and halts with the existing exhaustion reason." | diff-local |
| Story 2 negative: Given two resolved action cases R and R2 both linking S, when an undeclared reuse row for S arrives, then the halt names both R and R2 with one regressed event each. | 6 | "With resolved cases R and R2 both linking S, the coordinator emits exactly two `regressed` events naming R and R2, and its halt detail names both ids." | diff-local |
| Story 3 happy: Given the shared fixture, when a declared row for S names exactly the set of resolved action cases linking its sources, then validation admits it regardless of the row's rationale text. | 4 | "`validateRemediationCaseGraph` admits a declared row when `distinctFrom` equals exactly the set of resolved `act` prior cases whose non-merged link matches one of the row's sources, as asserted by a validator test whose rationale text differs from every prior case's rationale." | diff-local |
| Story 3 negative: Given the shared fixture, when `distinctFrom` names a case id absent from the prior-case context, then the judgement is rejected with a typed unknown-reference reason and no case is stamped. | 4 | "`validateRemediationCaseGraph` rejects with reason `unknown-distinct-case` when `distinctFrom` names an id absent from the supplied prior cases, and with `invalid-distinct-case` naming the case when it names an open case, a non-`act` case, or a case whose link to the source has outcome `merged`; each such rejection returns `ok: false`, so no case is stamped." | diff-local |
| Story 3 negative: Given the shared fixture, when `distinctFrom` names an open case, a non-action case, or a case whose link to S is finalized as merged, then the judgement is rejected with a typed invalid-declaration reason naming that case. | 4 | "`validateRemediationCaseGraph` rejects with reason `unknown-distinct-case` when `distinctFrom` names an id absent from the supplied prior cases, and with `invalid-distinct-case` naming the case when it names an open case, a non-`act` case, or a case whose link to the source has outcome `merged`; each such rejection returns `ok: false`, so no case is stamped." | diff-local |
| Story 3 negative: Given two resolved action cases linking S, when `distinctFrom` names only one of them, then the judgement is rejected as an incomplete declaration naming the omitted case. | 4 | "`validateRemediationCaseGraph` rejects with reason `incomplete-distinct-declaration` naming the omitted case when two resolved `act` cases link the source and only one is declared." | diff-local |
| Story 3 negative: Given a row that binds `existingCaseId`, when it also carries `distinctFrom`, then the judgement is rejected as malformed. | 3 | "The case-v2 parser rejects a row that carries both `existingCaseId` and `distinctFrom` as a malformed judgement, as asserted by an artifact test." | diff-local |
| Story 3 negative: Given a row whose sources are linked by no resolved case, when it carries `distinctFrom`, then the judgement is rejected as an unnecessary declaration. | 4 | "`validateRemediationCaseGraph` rejects with reason `unnecessary-distinct-declaration` when no resolved case links any of the row's sources." | diff-local |
| Story 3 negative: Given an unbound `refute` row that carries `distinctFrom`, when the judgement is validated, then it is rejected with the existing refute-without-binding reason, which takes precedence over any declaration reason. | 4 | "An unbound `refute` row carrying `distinctFrom` is rejected by `validateRemediationCaseGraph` with the existing `refute-without-binding` reason whether its declaration is valid or would be unknown, invalid, incomplete, or unnecessary, and never with a declaration reason, as asserted by one validator test per case." | diff-local |
| Story 4 happy: Given a valid persisted store and a proposed next state that violates the source ownership rule, when the store applies the mutation, then it returns a rejected-transition reason distinct from `malformed-state` and writes nothing. | 2 | "`RemediationCaseStore.mutate` returns reason `rejected-transition` when the persisted state parses but the next state fails validation, as asserted by a store test whose next state links one source from two unresolved cases." | diff-local |
| Story 4 happy: Given any rejected transition or invalid declaration in a lap, when the adjudication fails, then `remediation_adjudication_failed` carries the typed reason, the affected case ids, and the affected source ids as structured fields, and the needs-human HALT reason states that persisted history is valid. | 7 | "The `remediation_adjudication_failed` member of the `ConductorEvent` union gains optional `failureKind`, `caseIds`, and `sourceIds`, and the coordinator's `fail` path sets all three for every validator rejection, reconciler rejection, and `rejected-transition` store result, as asserted by coordinator tests checking each value, including a `second-unresolved-owner` lap whose event `caseIds` name both owners and whose `sourceIds` name S." | diff-local |
| Story 4 negative: Given a persisted store file that itself repeats S across two unresolved cases, when it is read, then the read still fails as `malformed-state` and the event's typed reason identifies persisted corruption, not a rejected transition. | 7, 1 | "A lap whose persisted store links one source from two unresolved cases emits `remediation_adjudication_failed` with `failureKind` `persisted-malformed`, never `rejected-transition`, as asserted by a coordinator test." | diff-local |
| Story 4 negative: Given a persisted store file that is not valid JSON, when it is read, then it still fails as `malformed-json`, unchanged from today. | 2 | "`RemediationCaseStore.load` and `RemediationCaseStore.mutate` both still return `malformed-json` for a persisted file that is not valid JSON." | diff-local |
| Story 4 negative: Given an event carrying the new structured fields, when every registered sink handles it, then each sink accepts it with no unknown-key failure. | 7 | "An event-sinks test passes a `remediation_adjudication_failed` event carrying all three new fields through every registered sink with no unknown-key failure." | diff-local |
| Story 5 happy: Given the shared fixture after Story 1 admits a new open case for S with a different outcome from R's link, when the lap's routing is derived, then source coverage is consistent and the route follows the new case. | 8 | "`currentSourceCoverageIsConsistent` reads each current source's outcome from its unresolved owner when one exists, so the resolved-plus-open fixture with differing outcomes for S yields consistent coverage, as asserted by a `reduceBuildReviewAdjudication` test." | diff-local |
| Story 5 happy: Given R's link to S is `acted` and the new case for S is open, when the settled-recurrence predicate runs, then S stays live. | 9 | "The coordinator's finalized-source set keeps S live when R's link to S is `acted` and an open case links S, as asserted by a coordinator test that dispatches the judge with S among current findings." | diff-local |
| Story 5 negative: Given the new case for S later resolves as a finalized deferral, when the next lap reports S, then S is removed from the live set by the settled predicate and no regression halt is written. | 9 | "When the declared distinct case for S has resolved as a finalized deferral, the next lap removes S from the live set and writes no regression halt." | diff-local |
| Story 5 negative: Given the declared distinct case for S was attempted and then resolved by refutation with effect `none` or an applied residual deferral, when the next lap reports S, then S is settled and no regression halt is written for R or for the refuted case. | 9 | "When the declared distinct case for S was attempted and resolved by refutation with effect `none` or an applied residual deferral, the next lap removes S from the live set and writes no regression halt for R or for the refuted case." | diff-local |
| Story 5 negative: Given a store where S is linked only by resolved cases, when routing is derived for a lap that does not report S, then no resolved case for S blocks PASS or contributes a decision stop. | 8 | "For a store where S is linked only by resolved cases and the lap does not report S, `reduceBuildReviewAdjudication` returns route `pass` with no decision stop contributed by those resolved cases." | diff-local |
| Story 6 happy: Given a store saved by the defective engine and its halted lap, when the HALT is cleared and the lap re-runs on the fixed engine with a declared judgement, then the lap admits the new case and R's applied effect and resolution evidence are preserved byte for byte. | 11 | "A recovery integration test loads the issue-shaped store saved by the defective engine, clears the HALT, re-runs the lap with a declared judgement, and the lap admits the new case for S." | diff-local |
| Story 6 happy: Given any store written before this change, when the fixed engine reads it, then it parses unchanged with no migration and no rewrite on read. | 1 | "Pre-change v1 and v2 store fixtures with globally unique sources load through `RemediationCaseStore.load` with identical parsed state and no write, as asserted by a byte comparison of each file after the read." | diff-local |
| Story 6 negative: Given the re-run judgement again omits the declaration, when the lap re-runs, then it halts as a regression of R with history intact and never asks the operator to delete cases or accept the finding. | 11 | "Re-running the same lap with a judgement that omits the declaration halts as a regression of R, leaves every persisted case byte-identical, and its HALT reason contains no instruction to delete cases or accept the finding." | diff-local |
| Story 6 negative: Given a store file declaring an envelope version the fixed engine does not know, when the fixed engine reads it during recovery, then the read fails closed as an unknown version and the file is left byte-identical. | 11 | "`RemediationCaseStore.load` on a file declaring an unknown envelope version returns `unknown-version` and leaves the file byte-identical." | diff-local |
| Story 7 happy: Given an admitted case for S declared distinct from R, when the operator runs the build_review findings view, then that case's line names R as its declared distinct predecessor. | 13 | "`build-review-cli.ts` findings human output for a case with `distinctFrom` names each declared predecessor case id on that case's line." | diff-local |
| Story 7 happy: Given the findings view in JSON output mode, when a declared case is present, then its JSON carries the declared predecessor case ids, matching the human rendering. | 13 | "The findings JSON output for that case carries a `distinctFrom` array equal to the declared predecessor ids." | diff-local |
| Story 7 negative: Given a case with no declaration, when the findings view renders it, then no lineage text appears and its line is unchanged from today. | 13 | "For a case without a declaration, the human line and its JSON object are byte-identical to the pre-change rendering, with no lineage text and no `distinctFrom` key, as asserted against fixtures captured from current output." | diff-local |
| Story 7 negative: Given a case with no declaration in JSON output mode, when the findings view renders it, then its JSON carries no lineage field and is otherwise unchanged from today. | 13 | "For a case without a declaration, the human line and its JSON object are byte-identical to the pre-change rendering, with no lineage text and no `distinctFrom` key, as asserted against fixtures captured from current output." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D1 | no-change | none | Infrastructure-only versus mixed lap classification is unchanged; this feature only changes case ownership inside an already-admitted content adjudication. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D2 | no-change | none | The single remediate dispatch per lap is unchanged; declarations ride on the existing case-v2 result of that dispatch. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D3 | no-change | none | Content action and infrastructure blocking composition is unchanged; an admitted distinct case reaches BUILD through the existing work-order route. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D4 | no-change | none | Confidence-floor suppression still runs before adjudication; suppressed findings never become sources a declaration could reference. |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D5 | task | task-9 | the next lap removes S from the live set and writes no regression halt for R or for the refuted case |
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication#D6 | task | task-5, task-1, task-4, task-6, task-7, task-8, task-9 | stamps one new open `act` case linking S with `distinctFrom` equal to R's id |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | no-change | none | Operator authority and autonomous case records remain separate; no operator disposition file is touched. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | task | task-1 | admits a build_review store where one source id is linked by a resolved case and by at most one unresolved case |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | no-change | none | PRD widening decision capture is a prd_widening concern this feature does not touch. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | no-change | none | Legacy PRD widening authority migration is unaffected; build_review records keep their existing envelope. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | no-change | none | PRD widening source-complete judgement is a separate domain flow left unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | no-change | none | The PRD widening native output contract is unchanged; only the build_review case-v2 row gains a field. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | no-change | none | PRD widening input bounds and retries are unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | no-change | none | PRD widening relationship commits and freshness classification are unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | no-change | none | PRD widening recovery and observability ownership are unchanged. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | The delivery boundary between PRD widening and build_review is unchanged; D2.1 narrows build_review uniqueness only. |
| adr-2026-09-10-portable-build-review-policy#D1 | no-change | none | The public build_review gate and policy declarations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D2 | no-change | none | Installed-catalog semantic identity adapters are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D3 | no-change | none | Policy bundle binding to execution is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D4 | no-change | none | The installed-policy contract is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D5 | no-change | none | Immutable review access for custom policies is unchanged. |
| adr-2026-09-10-portable-build-review-policy#D6 | no-change | none | Policy-dependent cache operations are unchanged. |
| adr-2026-09-10-portable-build-review-policy#D7 | no-change | none | Result identity derivation is unchanged; finding and source ids are computed exactly as before. |
| adr-2026-09-10-portable-build-review-policy#D8 | no-change | none | No second model or prose matcher re-derives the judgement; the validator checks only ids, dispositions, resolutions, and link outcomes. |
| adr-2026-09-10-portable-build-review-policy#D9 | task | task-3, task-4 | accepts an unbound case row carrying `distinctFrom` as a non-empty list of distinct case ids |
| adr-2026-09-10-portable-build-review-policy#D10 | no-change | none | Attended and daemon execution share the same coordinator path, which this feature changes once for both. |
| adr-2026-09-10-portable-build-review-policy#D11 | task | task-10 | records exactly one `build_review` charge for the work order's effect id |
| adr-2026-09-10-portable-build-review-policy#D12 | task | task-7 | gains optional `failureKind`, `caseIds`, and `sourceIds` |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic

### Task rem-as-built-rem-d9-1: build-review-adjudication-coordinator.ts:610-653,736-752 — when blockedConsistency is set, exclude ordinary non-escalation admitted cases whose sources intersect blockedConsistency.sourceIds from the reconcileRemediationCases input so the consistency stop (consistency-stop-<lapId>, consistencyStop set, judge source outcomes preserved) is the single durable unresolved owner per D9; in build-review-adjudication-coordinator.test.ts add a test that a blocked judgement with a reject row on S persists exactly one open escalate case carrying consistencyStop for S and no ordinary reject case, and rewrite the :1036 test to seed a pre-existing open owner of S so Task 7's rejected-transition caseIds/sourceIds assertion for the consistency-stop writer is preserved
**Gate:** as-built
**Rationale:** Conforming drift from approved D9 (verified in source, ~85% confidence the fix shape is determinable without a new decision): D9 requires a blocked consistency result to 'produce a durable decision stop', but the coordinator first reconciles blocked-source non-action rows (reject/defer) as ordinary open owners (build-review-adjudication-coordinator.ts:625-653) and only then writes the synthetic stop `consistency-stop-<lapId>` over the same sources (:736-752), which the Task 1/2 store contract rejects as a second unresolved owner (remediation-case-store.ts:524-530), so no stop persists; the changed test at build-review-adjudication-coordinator.test.ts:1036 codifies that failure. The existing escalation path already shows the approved shape — the stop itself carries consistencyStop and owns its sources (:713-724) — so the repair is to let the stop be the sole unresolved owner of blocked sources: exclude ordinary non-escalation rows whose sources intersect blockedConsistency.sourceIds from the reconcile input and write the stop over those sources, keeping their judge outcomes on the stop's source links. No existing Done-when admits decision-stop persistence (Task 7 covers only failure evidence; Tasks 9/10 cover settled sources and declared-case wiring), so this is a new remediation task. Coverage preservation: Task 7's rejected-transition evidence for the consistency-stop writer stays asserted by rewriting the :1036 test to persist a pre-existing open owner of S (a store-rejected stop still emits rejected-transition with both owners), while a new test proves the non-action blocked lap persists exactly one open escalate record with consistencyStop and no ordinary reject case. Found-and-excluded: blocked rows that are action cases are already withheld by authorizeBuildReviewRemediationActionEffects (:603) and are unaffected.
**Governing clause:** adr-2026-09-10-portable-build-review-policy decision 9
**Done when:**
- adr-2026-09-10-portable-build-review-policy decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-d9-1 is complete.

### Task rem-as-built-rem-ar-ab-d6-1-1: remediation-case-validator.ts:128-130,247-255 — when an unbound refute row carries distinctFrom, keep reason refute-without-binding (Task 4 Done-when 5 unchanged) but return caseIds = the row's distinctFrom ids and sourceIds = the sourceOutcomes rows whose caseRef is that row; in remediation-case-validator.test.ts extend the existing unbound-refute-with-distinctFrom cases to assert those ids, and in build-review-adjudication-coordinator.test.ts add a lap test asserting remediation_adjudication_failed carries failureKind invalid-judgement, caseIds = the declared ids, and sourceIds = S
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from approved D6.6 (verified in source, 95%): two invalid distinctFrom declaration sites lose typed evidence. (1) remediation-case-validator.ts:129 returns scalar refute-without-binding from validateEffect (called at :254) before the row's sources are known, so the coordinator fallback at build-review-adjudication-coordinator.ts:601-607 derives caseIds only from existingCaseId and yields [] for an unbound refute. (2) remediation-case-artifact.ts:289-297 rejects existingCaseId+distinctFrom as invalid-case-keys; the conductor.ts:12755-12757 judge closure throws a plain Error(reason) and the coordinator catch at :573-574 fails as 'remediate judgement failed' with no failureEvidence. The fix shape is fully determined by D6.6 (typed reason + affected case and source ids on remediation_adjudication_failed) with no new decision. Existing tasks examined: Task 3 Done-when only requires the parser to reject, Task 4 requires refute-without-binding to stay the reason, Task 7 requires typed evidence for validator rejections but its Files exclude the validator, artifact parser, and conductor judge closure, so new tasks are appended. Coverage preserved: the rejection reasons (refute-without-binding per Task 4 Done-when 5, invalid-case-keys per Task 3 Done-when 2) are unchanged; only additive caseIds/sourceIds evidence is attached, so no existing assertion is relaxed. Matched pair: no new rejection-reason member is added to RemediationCaseArtifactRejection or the validator reason union, so neither vocabulary nor the event failureKind set drifts. Sibling sweep: other parser rejections (invalid-case-priority etc.) and other validator scalar returns carry no declaration and are outside D6.6's declaration clause; they are found-and-excluded and keep the existing fallback.
**Governing clause:** adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication decision 6
**Done when:**
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d6-1-1 is complete.

### Task rem-as-built-rem-ar-ab-d6-1-2: remediation-case-artifact.ts:289-297,361-377 + conductor.ts:12751-12757 + build-review-adjudication-coordinator.ts:573-574 — when a case-v2 row carries both existingCaseId and distinctFrom, keep the invalid-case-keys rejection (Task 3 Done-when 2 unchanged) but attach caseIds = [existingCaseId, ...distinctFrom] and sourceIds = the raw sourceOutcomes rows citing that caseRef; have readRemediationCaseJudgement surface them, have the conductor judge closure throw a typed judgement-rejected error carrying reason/caseIds/sourceIds instead of a plain Error, and have the coordinator catch map that error to failureEvidence { failureKind: 'invalid-judgement', caseIds, sourceIds } while any other thrown error keeps the generic 'remediate judgement failed' path; tests: remediation-case-artifact.test.ts asserts the ids on that rejection, and a coordinator test with a judge that throws the typed error asserts the event's failureKind, caseIds, and sourceIds
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from approved D6.6 (verified in source, 95%): two invalid distinctFrom declaration sites lose typed evidence. (1) remediation-case-validator.ts:129 returns scalar refute-without-binding from validateEffect (called at :254) before the row's sources are known, so the coordinator fallback at build-review-adjudication-coordinator.ts:601-607 derives caseIds only from existingCaseId and yields [] for an unbound refute. (2) remediation-case-artifact.ts:289-297 rejects existingCaseId+distinctFrom as invalid-case-keys; the conductor.ts:12755-12757 judge closure throws a plain Error(reason) and the coordinator catch at :573-574 fails as 'remediate judgement failed' with no failureEvidence. The fix shape is fully determined by D6.6 (typed reason + affected case and source ids on remediation_adjudication_failed) with no new decision. Existing tasks examined: Task 3 Done-when only requires the parser to reject, Task 4 requires refute-without-binding to stay the reason, Task 7 requires typed evidence for validator rejections but its Files exclude the validator, artifact parser, and conductor judge closure, so new tasks are appended. Coverage preserved: the rejection reasons (refute-without-binding per Task 4 Done-when 5, invalid-case-keys per Task 3 Done-when 2) are unchanged; only additive caseIds/sourceIds evidence is attached, so no existing assertion is relaxed. Matched pair: no new rejection-reason member is added to RemediationCaseArtifactRejection or the validator reason union, so neither vocabulary nor the event failureKind set drifts. Sibling sweep: other parser rejections (invalid-case-priority etc.) and other validator scalar returns carry no declaration and are outside D6.6's declaration clause; they are found-and-excluded and keep the existing fallback.
**Governing clause:** adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication decision 6
**Done when:**
- adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication decision 6 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d6-1-2 is complete.

### Task rem-as-built-rem-ar-ab-d9-2-1: remediation-case-effects.ts:87-100 — in persistBuildReviewDecisionStop's single store.mutate, for every open build_review case (other than the stop itself) that links any of the stop's sources, set resolution 'resolved' and, when its effect is action or deferral with status 'reserved', rewrite the effect to status 'failed' with diagnostic 'superseded by decision stop <stop id>' (applied/failed effects unchanged), then append the stop as sole open owner (D9.2); keep the sameDecisionStop already-persisted replay branch; return the superseded case ids on the persisted result so the coordinator (build-review-adjudication-coordinator.ts:742-780, both the escalation and the blocked-consistency writer) emits one existing case-transition occurrence per superseded case; add effects/coordinator tests that an escalation and a blocked consistency over S with a pre-existing open act owner holding a reserved effect persist exactly one open owner (the stop), the prior owner resolved with its effect failed/superseded, and no remediation_adjudication_failed
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from the operator-approved D9.2 amendment (commit bf10f7e2e; verified in source, 85% on fix shape): persistBuildReviewDecisionStop (remediation-case-effects.ts:87-100), called by both decision-stop paths (build-review-adjudication-coordinator.ts:742-780), only appends the stop, so store validation rejects the second unresolved owner (remediation-case-store.ts:524-530) and coordinator tests at :1021 and :1062 codify that rejection. D9.2 fixes the transition: in the same mutation, resolve each existing open owner of a stop source and discard its unfinished effect, then append the stop as sole owner. The existing vocabulary carries this with no envelope change (D6.7): resolution 'resolved' plus an unfinished (status 'reserved') action/deferral effect rewritten to status 'failed' with a diagnostic naming the superseding stop id; applied effects are finished and stay unchanged. Existing task rem-as-built-rem-d9-1 was examined and NOT re-staged: its title directs rewriting the :1036 test to keep the rejection, which D9.2 now forbids, so a new task supersedes that instruction. Coverage preserved: Task 7 Done-when 1's second-unresolved-owner rejected-transition evidence (caseIds naming both owners, sourceIds naming S) moves to a lap whose ordinary reconciliation (not a decision stop) proposes a second open owner, or to a coordinator test whose store mutate returns rejected-transition, so the assertion survives; rem-as-built-rem-d9-1's 'blocked non-action lap persists only its consistency stop' test (:1103) stays unchanged. sameDecisionStop idempotence is kept so a replayed stop still reports already-persisted. Found-and-excluded: the stale feature diagram drift note is non-blocking and its file is a sealed DECIDE artifact that BUILD may not edit, so it is not tasked here.
**Governing clause:** adr-2026-09-10-portable-build-review-policy decision 9
**Done when:**
- adr-2026-09-10-portable-build-review-policy decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d9-2-1 is complete.

### Task rem-as-built-rem-ar-ab-d9-2-2: build-review-adjudication-coordinator.test.ts:1021-1100 — rewrite the two 'records both unresolved owners when ... stop is rejected by the store' tests to assert D9.2 supersession instead of rejection, and preserve Task 7 Done-when 1's second-unresolved-owner coverage in the same change with a coordinator test whose ordinary (non-decision-stop) transition is rejected by the store as rejected-transition, asserting remediation_adjudication_failed failureKind rejected-transition, caseIds naming both owners, and sourceIds naming S; leave the :1103 consistency-stop-only test unchanged
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from the operator-approved D9.2 amendment (commit bf10f7e2e; verified in source, 85% on fix shape): persistBuildReviewDecisionStop (remediation-case-effects.ts:87-100), called by both decision-stop paths (build-review-adjudication-coordinator.ts:742-780), only appends the stop, so store validation rejects the second unresolved owner (remediation-case-store.ts:524-530) and coordinator tests at :1021 and :1062 codify that rejection. D9.2 fixes the transition: in the same mutation, resolve each existing open owner of a stop source and discard its unfinished effect, then append the stop as sole owner. The existing vocabulary carries this with no envelope change (D6.7): resolution 'resolved' plus an unfinished (status 'reserved') action/deferral effect rewritten to status 'failed' with a diagnostic naming the superseding stop id; applied effects are finished and stay unchanged. Existing task rem-as-built-rem-d9-1 was examined and NOT re-staged: its title directs rewriting the :1036 test to keep the rejection, which D9.2 now forbids, so a new task supersedes that instruction. Coverage preserved: Task 7 Done-when 1's second-unresolved-owner rejected-transition evidence (caseIds naming both owners, sourceIds naming S) moves to a lap whose ordinary reconciliation (not a decision stop) proposes a second open owner, or to a coordinator test whose store mutate returns rejected-transition, so the assertion survives; rem-as-built-rem-d9-1's 'blocked non-action lap persists only its consistency stop' test (:1103) stays unchanged. sameDecisionStop idempotence is kept so a replayed stop still reports already-persisted. Found-and-excluded: the stale feature diagram drift note is non-blocking and its file is a sealed DECIDE artifact that BUILD may not edit, so it is not tasked here.
**Governing clause:** adr-2026-09-10-portable-build-review-policy decision 9
**Done when:**
- adr-2026-09-10-portable-build-review-policy decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d9-2-2 is complete.

### Task rem-as-built-rem-ar-ab-d12-1-1: remediation-case-effects.ts:46-124 + build-review-adjudication-coordinator.ts:751-819 — have persistBuildReviewDecisionStop return, alongside supersededCaseIds, a supersededEffects list of { caseId, effectId, effectKind, reason: 'superseded by decision stop <stop id>' } for exactly the superseded cases whose effect was action/deferral with status 'reserved' (applied or already-failed effects and the already-persisted replay branch contribute none); collect them from both the escalation writer and the blocked-consistency writer and, after the existing remediation_case_reconciled occurrence for each superseded case, emit exactly one remediation_effect_failed { domain 'build_review', lapId, caseId, effectId, effectKind, reason } per entry, mirroring the operator-retirement emission at :386-390 (keep rem-as-built-rem-ar-ab-d9-2-1's supersession behaviour and assertions unchanged); tests in remediation-case-effects.test.ts and build-review-adjudication-coordinator.test.ts: escalation and blocked consistency each superseding a reserved action owner and a reserved deferral owner emit one remediation_effect_failed with the case id, effect id, effect kind, and supersession diagnostic, while a superseded owner whose effect is applied or already failed, and a replayed already-persisted stop, emit none
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from approved D12 (verified in source, 97%): persistBuildReviewDecisionStop (remediation-case-effects.ts:101-124) rewrites each superseded case's reserved action/deferral effect to status 'failed' with diagnostic 'superseded by decision stop <id>' but returns only supersededCaseIds, and the shared emission loop (build-review-adjudication-coordinator.ts:802-819) emits only remediation_case_reconciled plus newly reserved effects, so neither the escalation writer (:751-776) nor the blocked-consistency writer (:777-795) puts a remediation_effect_failed occurrence on the spine. The fix is mechanical with no new decision: the event already exists (types/events.ts:711-719, reason: string, persisted per event-sinks.ts:78) and the operator-retirement path (coordinator :336-390, retiredEffect then emit) is the exact precedent to mirror; no event-schema or vocabulary change, so no matched pair drifts. Existing task rem-as-built-rem-ar-ab-d9-2-1 was examined and not re-staged as existing-task: its Done-when governs decision 9 only and its title directs emitting the case-transition occurrence (remediation_case_reconciled), which it delivered; D12's effect-failure occurrence is outside what it admits, so a new task is appended. Coverage preserved: rem-as-built-rem-ar-ab-d9-2-1's supersession assertions (one open owner, prior owner resolved, effect failed/superseded, no remediation_adjudication_failed) and the remediation_case_reconciled emission are unchanged; this is additive. Sibling sweep: the other reserved-to-failed writers (operator retirement :386-390, effect application :941, :1003, :1010) already emit remediation_effect_failed; the already-persisted replay branch (supersededCaseIds: []) must emit nothing; no other site found.
**Governing clause:** adr-2026-09-10-portable-build-review-policy decision 12
**Done when:**
- adr-2026-09-10-portable-build-review-policy decision 12 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d12-1-1 is complete.

### Task rem-as-built-rem-ar-ab-d9-3-1: build-review-adjudication-coordinator.ts:754-797 — make every blockedConsistency source owned by a persisted decision stop: track the source ids covered by persisted escalation stops, let an escalation carry consistencyStop only when its sources cover every blockedConsistency.sourceId, and otherwise still persist the consistency-stop-<lapId> stop (carrying consistencyStop) over the blocked sources not already owned by a persisted escalation stop, so persistBuildReviewDecisionStop supersedes the open owners of those sources and their reserved effects fail with the existing remediation_case_reconciled + remediation_effect_failed occurrences (keep rem-as-built-rem-d9-1 and rem-as-built-rem-ar-ab-d9-2-1 behaviour); tests in build-review-adjudication-coordinator.test.ts: a blocked result over S1 and S2 with an escalation over only S1 and a pre-existing open act owner of S2 holding a reserved effect ends with exactly one open owner per source, both decision stops, the S2 owner resolved with effect failed 'superseded by decision stop <id>', one remediation_effect_failed, and no remediation_adjudication_failed; an escalation covering all blocked sources still carries consistencyStop and no synthetic stop is written
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from approved D9/D9.2 (both sites verified in source, 97%): (1) build-review-adjudication-coordinator.ts:755-764 lets an escalation whose sources merely intersect blockedConsistency.sourceIds carry consistencyStop and set persistedConsistencyStop, which suppresses the synthetic stop at :778, yet the stop record holds only the escalation's own sources, so persistBuildReviewDecisionStop (remediation-case-effects.ts:113-115) never supersedes owners of the uncovered blocked sources and they get no durable stop; (2) :755 reuses proposed.case.existingCaseId as the stop id, so persistBuildReviewDecisionStop finds that non-stop owner at effects.ts:105-110 and returns conflicting-case-id before supersession. The correct fix is determinable from the ADR's 'every targeted source is owned by a sole durable decision stop' requirement and the as-built resolution, needs no new decision, and changes no event or vocabulary, so it routes build. Existing tasks rem-as-built-rem-d9-1 and rem-as-built-rem-ar-ab-d9-2-1 were examined and not re-staged as existing-task: their delivered behaviour (consistency stop as single owner; supersession of intersecting owners) is correct and stays, but neither title directs covering uncovered blocked sources or minting a distinct identity for a bound escalation, so new tasks are appended. Coverage preserved: rem-as-built-rem-ar-ab-d9-2-1's supersession assertions, rem-as-built-rem-ar-ab-d12-1-1's remediation_effect_failed emission, rem-as-built-rem-ar-ab-d9-2-2's rejected-transition coverage, rem-as-built-rem-d9-1's consistency-stop-only test, and the sameDecisionStop already-persisted replay branch are all unchanged; this is additive. Sibling sweep: the only two decision-stop writers are the escalation loop (:754-778) and the blocked-consistency writer (:779-797), both covered; line 882's 'existing case identity was not reconciled' guard applies to non-escalation admitted cases and is unaffected. Found-and-excluded: the stale feature diagram drift note is non-blocking and its file is a sealed DECIDE artifact.
**Governing clause:** adr-2026-09-10-portable-build-review-policy decision 9
**Done when:**
- adr-2026-09-10-portable-build-review-policy decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d9-3-1 is complete.

### Task rem-as-built-rem-ar-ab-d9-3-2: build-review-adjudication-coordinator.ts:755 + remediation-case-effects.ts:99-153 — give a bound escalation (proposed.case.existingCaseId set) a distinct deterministic stop id (e.g. decision-stop-<lapId>-<existingCaseId>) instead of reusing the bound owner's id, and have persistBuildReviewDecisionStop accept an optional supersedeCaseIds input so the bound owner is superseded in the same mutation even when its sources do not intersect the stop's; map caseIdsByRef to the new stop id; keep the sameDecisionStop already-persisted replay branch and the conflicting-case-id result for a genuinely different record at the same id; tests in remediation-case-effects.test.ts and build-review-adjudication-coordinator.test.ts: a valid case-v2 escalation bound to an open act owner with a reserved effect persists a stop with a new id as the sole open owner, resolves the bound owner with its effect failed 'superseded by decision stop <new id>', emits remediation_case_reconciled for both and one remediation_effect_failed, emits no remediation_adjudication_failed, and a replay of the same lap reports already-persisted with no new occurrences
**Gate:** as-built
**Rationale:** REMEDIABLE conforming drift from approved D9/D9.2 (both sites verified in source, 97%): (1) build-review-adjudication-coordinator.ts:755-764 lets an escalation whose sources merely intersect blockedConsistency.sourceIds carry consistencyStop and set persistedConsistencyStop, which suppresses the synthetic stop at :778, yet the stop record holds only the escalation's own sources, so persistBuildReviewDecisionStop (remediation-case-effects.ts:113-115) never supersedes owners of the uncovered blocked sources and they get no durable stop; (2) :755 reuses proposed.case.existingCaseId as the stop id, so persistBuildReviewDecisionStop finds that non-stop owner at effects.ts:105-110 and returns conflicting-case-id before supersession. The correct fix is determinable from the ADR's 'every targeted source is owned by a sole durable decision stop' requirement and the as-built resolution, needs no new decision, and changes no event or vocabulary, so it routes build. Existing tasks rem-as-built-rem-d9-1 and rem-as-built-rem-ar-ab-d9-2-1 were examined and not re-staged as existing-task: their delivered behaviour (consistency stop as single owner; supersession of intersecting owners) is correct and stays, but neither title directs covering uncovered blocked sources or minting a distinct identity for a bound escalation, so new tasks are appended. Coverage preserved: rem-as-built-rem-ar-ab-d9-2-1's supersession assertions, rem-as-built-rem-ar-ab-d12-1-1's remediation_effect_failed emission, rem-as-built-rem-ar-ab-d9-2-2's rejected-transition coverage, rem-as-built-rem-d9-1's consistency-stop-only test, and the sameDecisionStop already-persisted replay branch are all unchanged; this is additive. Sibling sweep: the only two decision-stop writers are the escalation loop (:754-778) and the blocked-consistency writer (:779-797), both covered; line 882's 'existing case identity was not reconciled' guard applies to non-escalation admitted cases and is unaffected. Found-and-excluded: the stale feature diagram drift note is non-blocking and its file is a sealed DECIDE artifact.
**Governing clause:** adr-2026-09-10-portable-build-review-policy decision 9
**Done when:**
- adr-2026-09-10-portable-build-review-policy decision 9 is satisfied by this task.
- Re-run as-built and confirm task rem-as-built-rem-ar-ab-d9-3-2 is complete.
