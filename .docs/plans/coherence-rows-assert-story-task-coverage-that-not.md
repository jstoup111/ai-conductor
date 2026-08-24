# Implementation Plan: Criterion-level coherence coverage

**Date:** 2026-08-23
**Stories:** .docs/stories/coherence-rows-assert-story-task-coverage-that-not.md
**Conflict check:** Clean as of 2026-08-23

## Summary

Adds a `criterion` row class to the coherence artifact and a structural land-time layer that
enumerates story criteria with the engine's own extractor, requires one row per criterion, grounds
each row's coverage claim in a verbatim quote from the cited plan task, and requires a diff-locality
disposition. 24 tasks.

## Technical Approach

The defect is an ungrounded claim, not a missing check. `extractAuthoritativeStoryCriteria` in
`src/conductor/src/engine/artifacts.ts` is already the only per-criterion enumerator in the codebase
and is called only by `acceptance_specs`' disposition grounding. The coherence gate stops at
story-level coverage (`collectPlanCoverage(...).has(`${id}|*`)`), so the two disagree by
construction. This plan makes the gate call that same function, which is what makes them agree.

Three design decisions are fixed by APPROVED ADRs and are not open at build time:

- `criterion` is a **structural** layer in `resolveRequiredLayers`, not signal-gated
  (`adr-2026-08-23-criterion-layer-is-structural-at-land`). The tier-S and legacy-change-set escapes
  are inherited, because both short-circuit before layer derivation.
- A coverage claim is grounded by a **verbatim quote** the engine locates in the cited task's body,
  never re-judged at land (`adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`). This is the
  mechanism decision: exact substring match after whitespace normalization, not similarity scoring
  and not a model call.
- Diff-locality is an **authored disposition** the engine requires to be present and drawn from a
  closed union (`adr-2026-08-23-diff-locality-is-an-authored-disposition`). The engine never infers
  diff-locality itself; no keyword heuristic is introduced.

Sequencing: parsing and vocabularies first (Tasks 1–5), because every later check consumes the
parsed row; then the coverage layer (6–10); then quote grounding (11–15); then dispositions and
waivers (16–18); then the backwards-compatibility proofs (19–20); then the `acceptance_specs`
message (21) and the skill contracts (22).

**Local pattern context.** The citation-grounding pattern this work replicates lives in
`groundDispositionOnlyEvidence` and `resolveDispositionCitation` in
`src/conductor/src/engine/artifacts.ts`. The traits to preserve: an authored judgement is accepted,
but the evidence it cites is mechanically resolved and a resolution failure produces a rejection
naming the specific record; the check is a pure function over already-read text with no subprocess.
It fits because the question is identical in shape — an author asserts coverage, the engine verifies
the citation is real. Allowed variation: the citation here is a text span rather than `file:line`,
so the resolution step is a substring search rather than a file read. Find the comparable code by
searching `artifacts.ts` for `disposition-only` and for the exact-then-legacy canonicalization
helper beside it. Tasks 11–14 repeat the applicable subset of this context in their own Steps.

**Layer boundary that must not move.** All added strictness lives inside `runCoherenceGate`. The
discovery-side check `hasCoherenceTableDataRow` in `src/conductor/src/engine/daemon-backlog.ts` is
out of scope for modification and Task 20 proves it unchanged.

## Prerequisites

- None. No migration, no new dependency, no config key.

## Tasks

### Task 1: Extract a task's committed body text
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `plan-task-parse.test.ts`: a plan with Tasks 1–3 yields each task's body text excluding the next task's header; a dotted id `1.2` resolves to its own body; an unknown id returns undefined; fenced code inside a task body is retained verbatim.
2. Verify RED.
3. Implement `parsePlanTaskBodies` in `plan-task-parse.ts`, reusing the same `TASK_HEADER_PATTERN` split that `parsePlanTaskDoneWhen` and `parsePlanTaskPaths` already perform. Preserve the trait that a task's body ends at the next header, not at a blank line.
4. Verify GREEN; commit "feat(plan-task-parse): expose each task's body text".

**Done when:**
- `parsePlanTaskBodies` is exported from `src/conductor/src/engine/plan-task-parse.ts` and returns a Map keyed by task id.
- The four new cases in `plan-task-parse.test.ts` pass.
- A plan whose last task runs to end-of-file yields that task's full remaining text.

**Files:**
- src/conductor/src/engine/plan-task-parse.ts
- src/conductor/test/engine/plan-task-parse.test.ts

**Dependencies:** none

### Task 2: Parse the criterion row class
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `coherence-validator.test.ts`: a table row whose first cell is `criterion` parses into a typed row carrying criterion text, cited task ids, verdict, quote, and disposition; a `criterion` row with a missing required cell is rejected as unparseable.
2. Verify RED.
3. Extend `parseCoherenceArtifact` in `coherence-validator.ts` to recognize `criterion` alongside the five existing classes, carrying the two new fields.
4. Verify GREEN; commit "feat(coherence): parse the criterion row class".

**Done when:**
- `parseCoherenceArtifact` returns typed criterion rows for a well-formed table.
- A criterion row missing the quote or disposition cell yields an `unparseable-coherence-artifact` reason naming the row.
- The five pre-existing row classes parse byte-identically to before, proven by the existing parser tests still passing unchanged.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** none

### Task 3: Make the criterion verdict vocabulary a closed union
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write a failing test: a criterion row whose verdict is `probably-covered` is rejected as malformed; a row whose verdict is drawn from the closed set is accepted.
2. Verify RED.
3. Implement the closed verdict union for criterion rows only. Do not change `NEGATIVE_VERDICTS` or the affirmative-by-default behavior of the five legacy row classes, which stays as-is for compatibility.
4. Verify GREEN; commit "feat(coherence): reject unknown criterion verdicts instead of defaulting affirmative".

**Done when:**
- An unrecognized criterion verdict produces a rejection naming that row, not an affirmative pass.
- A test asserts the legacy row classes retain affirmative-by-default, documenting the deliberate asymmetry.
- The closed set is a TypeScript union type, not a runtime string array alone.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 2

### Task 4: Make the diff-locality disposition vocabulary a closed union
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write a failing test: a disposition outside the closed set is rejected as malformed; each member of the closed set parses to its typed value.
2. Verify RED.
3. Implement the disposition union beside the verdict union from Task 3, with an explicit non-negative subset the coverage layer will consult.
4. Verify GREEN; commit "feat(coherence): close the diff-locality disposition vocabulary".

**Done when:**
- An unrecognized disposition produces a rejection naming that criterion.
- The non-negative subset is derived from the union type with no catch-all default branch.
- A test enumerates every union member and asserts each parses.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 2

### Task 5: Engage the criterion layer structurally
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests on `resolveRequiredLayers`: tier M and tier L layer sets contain `criterion`; tier S returns `{engaged: false, reason: 'tier-exempt'}`; a change set with no `.docs/coherence/` path returns `legacy-change-set`.
2. Verify RED.
3. Add `criterion` to the structural layer set. Do not add a new escape hatch — both existing escapes short-circuit before layer derivation and must be inherited unchanged.
4. Verify GREEN; commit "feat(coherence): engage the criterion layer for every non-S spec".

**Done when:**
- `resolveRequiredLayers` includes `criterion` for tier M and tier L and omits it for tier S.
- The tier-S and legacy-change-set tests pass without any new branch added for the criterion layer.
- `CoherenceRequiredLayer` includes `criterion` as a union member.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 2

### Task 6: Reject a criterion the coherence artifact omits
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test: a spec whose stories declare four criteria and whose artifact carries three criterion rows, with no waiver, is rejected and the message contains the omitted criterion's exact text.
2. Verify RED.
3. Implement `checkCriterionCoverage` in `coherence-validator.ts`, obtaining the criterion set by calling `extractAuthoritativeStoryCriteria` from `artifacts.ts`. Compute the omitted set as a set difference; do not re-derive criteria locally.
4. Verify GREEN; commit "feat(coherence): reject a story criterion no task owns".

**Done when:**
- The rejection message contains the omitted criterion's verbatim text.
- The layer imports `extractAuthoritativeStoryCriteria` rather than defining a second extractor.
- Row order relative to the stories file does not affect the verdict, proven by a shuffled-row test.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 1, 5

### Task 7: Reject an invented criterion row
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test: a criterion row whose text matches no criterion in the stories file, with no waiver, is rejected and named as invented.
2. Verify RED.
3. Compute the invented set as the reverse difference in `checkCriterionCoverage`, mirroring the `invented`/`omitted` phrasing `groundDispositionOnlyEvidence` already uses so both messages read alike.
4. Verify GREEN; commit "feat(coherence): reject a criterion row matching no accepted criterion".

**Done when:**
- An invented row is rejected with its text in the message.
- The message distinguishes invented from omitted rather than reporting a single undifferentiated count.
- A spec with both an invented and an omitted criterion reports both in one run.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 6

### Task 8: Reject duplicate criterion rows
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test: two criterion rows carrying the same criterion text, with no waiver, are rejected naming the duplicated criterion.
2. Verify RED.
3. Enforce one-to-one rather than merely onto: detect duplicates before the set difference so the duplicate is not silently collapsed.
4. Verify GREEN; commit "feat(coherence): reject duplicate criterion rows".

**Done when:**
- A duplicated criterion is rejected naming that criterion once, not once per occurrence.
- A test proves duplicates are caught even when the criterion set is otherwise fully covered.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 6

### Task 9: Reject an unparseable stories file rather than passing empty coverage
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write a failing test: a stories file with no parseable story blocks yields a rejection naming the stories file, not a pass on an empty criterion set.
2. Verify RED.
3. Guard `checkCriterionCoverage` so a zero-criterion enumeration from a non-empty stories file is a rejection, following the existing `unparseable-stories` reason used by `checkStoryCoverage`.
4. Verify GREEN; commit "fix(coherence): treat zero extracted criteria as unparseable, not covered".

**Done when:**
- A non-empty stories file yielding zero criteria is rejected naming the file.
- A genuinely criterion-free stories file is distinguished from an unparseable one, or the test records that this case cannot occur because the stories gate requires both path sections.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 6

### Task 10: Prove the gate and acceptance_specs share one extractor
**Story:** 1
**Type:** happy-path
**Verify-only:** yes

**Steps:**
1. Write a test asserting that the criterion set the coherence layer derives for a fixture stories file is deeply equal to the set `groundDispositionOnlyEvidence` derives for the same file.
2. Confirm the test passes against the implementation from Task 6 with no production change.
3. Commit with an `Evidence: skipped` trailer per the verify-only convention.

**Done when:**
- The equality test passes and fails if either call site is pointed at a different extractor.
- No production file is modified by this task.

**Files:**
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 6

### Task 11: Accept a criterion row whose quote is found in the cited task
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test: a criterion row citing task 10 and quoting a span present verbatim in task 10's body is accepted. Follow the citation-grounding trait from `resolveDispositionCitation` — the authored judgement is accepted and only its cited evidence is resolved, as a pure function over already-read text with no subprocess.
2. Verify RED.
3. Implement quote grounding inside `checkCriterionCoverage`, resolving the cited task's body via `parsePlanTaskBodies` from Task 1.
4. Verify GREEN; commit "feat(coherence): ground a coverage claim in the cited task's text".

**Done when:**
- A row whose quote occurs in the cited task's body is accepted.
- A row citing two tasks is accepted when the quote is found in either.
- Grounding performs no file read beyond the plan text already loaded by the gate.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 1, 6

### Task 12: Normalize whitespace when comparing a quote
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write a failing test: a quote differing from the task text only by line wrapping and repeated spaces is accepted; a quote differing by a changed word is not.
2. Verify RED.
3. Normalize runs of whitespace to a single space on both sides before the substring search. The mechanism is exact substring match on the normalized strings — not similarity scoring, not token overlap.
4. Verify GREEN; commit "feat(coherence): normalize whitespace in quote grounding".

**Done when:**
- A line-wrapped quote matching the task text is accepted.
- A quote differing by one substantive word is rejected, proving paraphrase does not ground a claim.
- Normalization is applied to both the quote and the task body, asserted by a test where only the task body is wrapped.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 11

### Task 13: Reject a quote absent from the cited task, naming criterion and task
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a quote appearing nowhere in the cited task, with no waiver, is rejected with a message containing both the criterion text and the cited task id; a quote appearing in a different task than the one cited is also rejected.
2. Verify RED.
3. Implement the rejection, mirroring the naming style of the disposition-grounding failure message so the two read alike.
4. Verify GREEN; commit "feat(coherence): reject an ungrounded coverage claim".

**Done when:**
- The rejection message contains both the criterion text and the cited task id.
- A quote present elsewhere in the plan but not in a cited task is rejected.
- A test asserts the message names the task it was attributed to, not merely that grounding failed.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 11

### Task 14: Reject malformed quote citations
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a criterion row citing a task id absent from the plan is rejected naming that id; a row with an empty quote is rejected naming the criterion.
2. Verify RED.
3. Implement both guards before the substring search so an unresolvable citation never falls through to a grounding failure with a misleading message.
4. Verify GREEN; commit "feat(coherence): reject unresolvable and empty quote citations".

**Done when:**
- An unknown cited task id is rejected naming that id.
- An empty quote is rejected naming the criterion.
- The two produce distinct messages, asserted by tests on message content.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 11

### Task 15: Regression-test the #1799 exemplar and the stale-quote case
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write a test using the real failing shape from the intake: a story-2 row claiming its cited task carries three acceptance variants while that task's committed text assigns two. Assert rejection naming the criterion and the task.
2. Write a second test: a plan task's wording is edited after its row was authored so the quote no longer occurs; assert the re-run is rejected rather than passing on the stale quote.
3. Verify both RED against a build without Tasks 11–14, then GREEN with them.
4. Commit "test(coherence): regression-cover the #1799 exemplar and stale quotes".

**Done when:**
- The exemplar test fails on a build without quote grounding and passes with it.
- The stale-quote test proves a previously valid row is re-checked rather than cached.

**Files:**
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 12, 13, 14

### Task 16: Require a present, non-negative diff-locality disposition
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: a criterion row with no disposition, with no waiver, is rejected naming the criterion; a row whose disposition marks dependence on outside state, with no waiver, is rejected naming the criterion; a row marked diff-local is accepted.
2. Verify RED.
3. Consult the non-negative subset from Task 4 inside `checkCriterionCoverage`. The engine performs no analysis of the criterion's text; it only reads the authored disposition.
4. Verify GREEN; commit "feat(coherence): require a non-negative diff-locality disposition".

**Done when:**
- An absent disposition is rejected naming that criterion.
- A negative disposition is rejected naming that criterion.
- No code path inspects criterion prose for corpus keywords, asserted by a test that a criterion mentioning the default branch is accepted when marked diff-local.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 4, 6

### Task 17: Regression-test the census criterion
**Story:** 3
**Type:** negative-path

**Steps:**
1. Recover the census criterion text from the plan deleted in commit `e93914b2f` (available at `e93914b2f^`): a corpus test over every landed plan on the default branch finding exactly one plan with a non-empty map.
2. Write a test authoring it as a criterion row with a negative disposition and assert the land is rejected.
3. Verify RED then GREEN; commit "test(coherence): regression-cover the census-pinned criterion".

**Done when:**
- The census criterion, authored with a negative disposition, is rejected.
- The test carries the recovered criterion text verbatim as a fixture rather than paraphrasing it.

**Files:**
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 16

### Task 18: Register criterion gap ids in the waiver vocabulary
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: each criterion rejection class emits a stable gap id; a fresh waiver naming that id with a rationale clears the rejection; a waiver naming an unreported id is rejected; a waiver covering some but not all criterion gaps is rejected naming the uncovered ones; a waiver merged by an earlier feature fails freshness.
2. Verify RED.
3. Emit stable gap ids from every criterion rejection class and ensure `evaluateCoherenceWaiver` receives them in its reported-gap set. Do not add a second waiver mechanism.
4. Verify GREEN; commit "feat(coherence): make every criterion gap waivable".

**Done when:**
- A test enumerates every criterion rejection class introduced by this feature and asserts each emits a waivable id.
- Partial coverage and stale-waiver cases are rejected for criterion gaps exactly as for existing gap classes.
- No new waiver file format or directory is introduced.

**Files:**
- src/conductor/src/engine/engineer/coherence-validator.ts
- src/conductor/src/engine/engineer/coherence-waiver.ts
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 6, 13, 16

### Task 19: Prove a legacy coherence artifact stays valid at discovery
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write a failing-then-passing test: `hasCoherenceTableDataRow` accepts an artifact containing only the five legacy row classes and no criterion rows.
2. Write a discovery test: a merged spec whose artifact carries no criterion rows produces no `missing-coherence` blocked item and remains eligible.
3. Verify GREEN; commit "test(daemon-backlog): a legacy coherence artifact still builds".

**Done when:**
- `hasCoherenceTableDataRow` returns true for a criterion-free artifact.
- The discovery test asserts the blocked-item list is empty for that spec.
- Both tests fail if the criterion layer is wired into discovery.

**Files:**
- src/conductor/test/engine/daemon-backlog.test.ts

**Dependencies:** 5

### Task 20: Prove the discovery-side check is unmodified
**Story:** 4
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. Confirm by inspection and by the passing Task 19 tests that this feature's diff contains no change to `hasCoherenceTableDataRow` or the coherence branch of `daemon-backlog.ts`.
2. Record the confirmation; commit with an `Evidence: skipped` trailer per the verify-only convention.

**Done when:**
- `git diff` for this feature shows no modification to the coherence branch of `src/conductor/src/engine/daemon-backlog.ts`.
- Task 19's two tests pass.

**Files:**
- none

**Dependencies:** 19

### Task 21: Make the acceptance_specs uncovered-criterion message conditional
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: for a spec whose coherence artifact carries criterion rows, the uncovered-criterion halt names the DECIDE-time criterion check; for a spec whose artifact carries none, the message is byte-identical to today's; an invented-record failure keeps its own distinct message in both cases.
2. Verify RED.
3. Implement the conditional branch in `groundDispositionOnlyEvidence`, reading the presence of criterion rows from the spec's committed coherence artifact. Keep the completion predicate a pure read — no subprocess, no network call.
4. Verify GREEN; commit "feat(acceptance-specs): name the DECIDE check only when it was in force".

**Done when:**
- A test asserts the legacy message is byte-identical to the pre-change string.
- A test asserts the new message names the criterion check for a spec carrying criterion rows.
- A test asserts the invented and omitted cases produce different messages in both branches.
- The predicate performs no subprocess or network call, asserted by the existing purity test still passing.

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 6

### Task 22: Document the criterion row contract in the skill
**Story:** 3
**Type:** infrastructure

**Steps:**
1. Add the `criterion` row class to the row-format section of `skills/coherence-check/SKILL.md`: its five cells, the closed verdict set, the quote requirement and its exactness rule, and the closed diff-locality vocabulary.
2. Add the diff-locality question to `skills/plan/SKILL.md` beside the existing falsifiability guidance, phrased as the question the author answers per criterion.
3. Run `test/test_harness_integrity.sh` and fix any check it reports.
4. Commit "docs(skills): specify the criterion row class and the diff-locality question".

**Done when:**
- `skills/coherence-check/SKILL.md` documents all five cells of a criterion row and both closed vocabularies.
- `skills/plan/SKILL.md` states the diff-locality question an author answers per criterion.
- `test/test_harness_integrity.sh` exits zero.

**Files:**
- skills/coherence-check/SKILL.md
- skills/plan/SKILL.md

**Dependencies:** 4, 12, 16

### Task 23: Preserve today's message for a spec that predates the check
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests: for a spec whose coherence artifact carries no criterion rows, the uncovered-criterion halt message is byte-identical to the pre-change string; the invented-record message stays distinct from the omitted-criterion message in both branches.
2. Verify RED.
3. Capture the pre-change message as a fixture constant so the assertion is exact rather than a substring check, and route the legacy branch to it.
4. Verify GREEN; commit "test(acceptance-specs): keep the legacy halt message byte-identical".

**Done when:**
- A test compares the legacy branch message to a captured fixture of the pre-change string and asserts equality.
- A test asserts the invented and omitted messages differ in the legacy branch.
- The `acceptance_specs` completion predicate makes no subprocess or network call, asserted by the existing purity test.

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** 21

### Task 24: Land a fully diff-local spec with no added rejection
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write a test authoring a complete criterion table where every row carries a grounded quote and a diff-local disposition, and assert `runCoherenceGate` returns no gaps.
2. Assert the same fixture reports no rejection from any layer, proving the added checks introduce no ceremony beyond the authored rows.
3. Verify GREEN against the implementation from Tasks 11 and 16; commit "test(coherence): a fully diff-local spec lands clean".

**Done when:**
- A complete, grounded, diff-local criterion table produces zero gaps from `runCoherenceGate`.
- The test exercises the real gate facade rather than calling the layer function directly.

**Files:**
- src/conductor/test/engine/engineer/coherence-validator.test.ts

**Dependencies:** 11, 16

## Task Dependency Graph

```
1 ──┬─► 6 ──┬─► 7
    │       ├─► 8
    │       ├─► 9
    │       ├─► 10
    │       ├─► 11 ──┬─► 12 ──┐
    │       │        ├─► 13 ──┼─► 15
    │       │        └─► 14 ──┘
    │       ├─► 16 ──► 17
    │       ├─► 18   (also from 13, 16)
    │       └─► 21
2 ──┬─► 3
    ├─► 4 ──► 16
    └─► 5 ──┬─► 6
            └─► 19 ──► 20
4, 12, 16 ──► 22
11, 16 ──► 24
21 ──► 23
```

Acyclic. Tasks 1 and 2 are the only roots.

## Integration Points

- After Task 6: the criterion layer runs end-to-end at land for coverage presence, testable through the real `runCoherenceGate` facade.
- After Task 15: all three #1799 defect classes for coverage and grounding are enforced together.
- After Task 20: the backwards-compatibility guarantee is proven, so the feature is safe to merge ahead of the remaining message work.

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks; the one enforcement property in this plan (quote matching) names its mechanism — exact substring match on whitespace-normalized text — rather than leaving it to the builder
- [x] Dependencies are explicit and acyclic
- [x] No terminal catch-all validation task
