# Implementation Plan: Review is bound by each plan task's Done when: criteria

**Date:** 2026-08-21
**Design:** .docs/decisions/adr-2026-08-21-review-bound-by-plan-done-when-criteria.md
**Stories:** .docs/stories/plan-tasks-lack-falsifiable-done-criteria-so-revie.md
**Conflict check:** Clean as of 2026-08-21 (one degrading accepted)

## Summary

Adds a land-time shape gate for plan `Done when:` blocks, an optional per-finding `boundTo` binding
under contract v3, one reducer relaxation so `beyond` findings never block, a `beyond` record kind
for filing bookkeeping, and a daemon reconciliation that files each record as intake. 19 tasks.

## Technical Approach

- **Sequencing.** Rebase onto main after PRs #1734 (#1629) and #1750 merge; every seam below is
  named by symbol on #1734's branch and must be re-resolved on the rebased HEAD (Task 1).
- **Parser.** `parsePlanTaskDoneWhen(text): Map<taskId, string[]>` in `plan-task-parse.ts`, shaped
  after `parsePlanTaskPreserves`: same task-header split, fenced code stripped first (the fence
  behavior `plan-task-parse-fence.test.ts` already pins), lines of the `**Done when:**` block
  collected until the next `**Header:**` line or task boundary, each line trimmed with Markdown
  emphasis stripped. Pure; no I/O.
- **Gate.** `validatePlanDoneWhen(planText)` in a new pure module `plan-done-when.ts` returns
  `{taskId, reason: 'missing'|'too-few'|'too-many'|'blank'}[]`; `landSpec` throws a `landSpec:`
  error naming each task, placed after `validateArtifactContent('plan')` beside
  `scanPlanProtectedTargets`. Not wired into `daemon-backlog.ts` or the conductor plan gate.
- **Criteria evidence.** `BuildReviewSourceSnapshot` gains optional `doneWhenContext: {taskId,
  criteria: {hash, occurrence, text}[]}[]` read alongside `preservationContext` in
  `build-review-inputs.ts`; projections carry it additively (all four) under `projectionVersion
  'v2'`; `TautologyProjection` also gains `planBody`. Hash = sha256 of the normalized line (the
  same normalization the `content-region` anchor uses).
- **Binding.** `BuildReviewFinding.boundTo?: 'beyond' | BuildReviewFindingAnchor (content-region)`.
  `parseFindings` accepts absent, the literal, or a content-region whose `contentHash`+`occurrence`
  resolve in `doneWhenContext` for the task the finding's anchor names; anything else rejects the
  envelope through the existing shape-diagnosis path with the allowed forms listed. Identity
  (`build-review-finding-identity.ts`) is untouched: `boundTo` is stripped before hashing, the
  `exactKeys` payload stays `{rubric, contractVersion, concernKind, anchor}`.
- **Reducer.** In `deriveEffectiveBuildReviewVerdict` the per-finding loop routes
  `boundTo === 'beyond'` into a new `beyondFindingIds` bucket; `unresolvedFindingIds` and
  `uncoveredInfrastructureCount` otherwise unchanged; PASS predicate unchanged. The exit list that
  reads the verdict is re-derived by grep in Task 10.
- **Record.** Third record kind `beyond` in `build-review-dispositions.ts` following the
  `reduced-coverage` template: `{kind:'beyond', version, feature, findingId, rubric, summary,
  evidenceLocations, status:'unfiled'|'filed', issueUrl?, recordedAt, filedAt?}`, closed status
  vocabulary, `listBeyond`, `appendBeyondIfAbsent`, `markBeyondFiled`; `listReducedCoverage`
  narrowed to `kind === 'reduced-coverage'`.
- **Write point.** After the effective verdict is resolved in the conductor's `build_review` block
  (the call through `buildReviewEffectiveResolver`), append one `beyond` record per new beyond id;
  skipped when the fresh-base exit discards the lap.
- **Filer.** `reconcileBeyondRecords({projectRoot, tracker, log})` beside `reconcileHaltPrs` in
  `daemon-cli.ts`: for each feature store with `unfiled` records call `fileIntakeIssue` with
  `interactive:false`, `sourceRef` = `<slug>:<findingId>`, then `markBeyondFiled` and emit
  `build_review_beyond_filed`. Wrapped so a thrown ledger refusal or tracker error logs and leaves
  the record `unfiled`.
- **Surfaces.** `build-review findings` renders beyond records with status; the shipped record and
  retained PR body render them through the same evidence section path `reducedCoverageEvidence`
  uses, fail-closed (a record that cannot render blocks like an unrenderable acceptance).
- **Contracts.** The `boundTo` grammar is added to the four rubric result-contract sections and to
  `renderBuildReviewJudgedResultShape`; `build-review-rubric-skills.test.ts` pins it.

Test layer per story: unit tests beside each module (vitest, existing file names), the acceptance
spec from `/writing-system-tests`, and the existing daemon integration harness for the filer.

## Prerequisites
- PRs #1734 and #1750 merged to main; this branch rebased onto that main.

## Tasks

### Task 1: Rebase and re-resolve every named seam
**Story:** 4
**Type:** infrastructure
**Verify-only:** yes

**Steps:**
1. Confirm `git merge-base --is-ancestor` for the merge commits of PRs #1734 and #1750 against HEAD.
2. Grep for each symbol named in Technical Approach (`parsePlanTaskPreserves`, `scanPlanProtectedTargets`, `deriveEffectiveBuildReviewVerdict`, `matchesBuildReviewReducedCoverageDisposition`, `listReducedCoverage`, `reconcileHaltPrs`, `renderBuildReviewJudgedResultShape`, `fileIntakeIssue`, `preservationContext`) and record the current file for each in the commit message.
3. Commit empty with trailer `Evidence: skipped rebase-verification`.

**Done when:**
- `git log --oneline main..HEAD` contains no commit from PR #1734 or #1750 (both are ancestors).
- Each of the nine symbols above resolves to exactly one defining file on HEAD and the commit message lists them.

**Files:** none

**Dependencies:** none

### Task 2: Parse the Done when: block per task
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `plan-task-parse.test.ts`: a plan with Tasks 1–3 carrying 2, 3, and 5 criteria lines yields a map of those arrays; emphasis and trailing whitespace are stripped; a block inside a fenced code block is ignored; a task without the block is absent from the map.
2. Verify RED.
3. Implement `parsePlanTaskDoneWhen` in `plan-task-parse.ts` shaped after `parsePlanTaskPreserves` (same task split, same fence stripping).
4. Verify GREEN; commit "feat(plan-task-parse): parse each task's Done when: block".

**Done when:**
- `parsePlanTaskDoneWhen` is exported from `src/conductor/src/engine/plan-task-parse.ts` and the four new cases in `plan-task-parse.test.ts` pass.
- A corpus test over every landed plan on main asserts the parse, not a census: every plan whose tasks carry a `Done when:` block yields one non-empty entry per such task, every plan with no block yields an empty map, and no plan raises. The count of plans carrying the block is deliberately not asserted — it grows as plans land.

**Files:**
- src/conductor/src/engine/plan-task-parse.ts
- src/conductor/test/engine/plan-task-parse.test.ts

**Dependencies:** 1

### Task 3: Validate block shape as a pure rule
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `plan-done-when.test.ts`: a plan where every task has 2–5 non-empty lines yields no violations; missing → `missing`; one line → `too-few`; six → `too-many`; lines all whitespace → `blank`; fenced example ignored.
2. Verify RED.
3. Implement `validatePlanDoneWhen` in new `src/conductor/src/engine/plan-done-when.ts`, consuming `parsePlanTaskDoneWhen` and the task id list from the task-header split.
4. Verify GREEN; commit "feat(plan-done-when): shape rule for Done when: blocks".

**Done when:**
- `validatePlanDoneWhen` returns `[]` for the compliant fixture and one `{taskId, reason}` per offending task for the four reasons, each asserted in `plan-done-when.test.ts`.
- The module imports nothing that performs I/O.

**Files:**
- src/conductor/src/engine/plan-done-when.ts
- src/conductor/test/engine/plan-done-when.test.ts

**Dependencies:** 2

### Task 4: Land rejects a plan that fails the shape rule, naming the task
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests in the land-spec test suite: landing a spec whose plan Task 3 lacks the block throws `landSpec: plan task 3 has no Done when: block …` and leaves the worktree in place; a compliant plan lands; a Small-tier spec is checked identically.
2. Verify RED.
3. In `landSpec`, after `validateArtifactContent('plan', …)`, call `validatePlanDoneWhen(planContent)` and throw naming every violation and its reason.
4. Verify GREEN; commit "feat(land): reject plan tasks without a Done when: block".

> **Amended 2026-08-22 by #1785:** this task additionally authorizes the compatibility migration of
> existing plan fixtures made invalid by the land gate it introduces. Every pre-existing test that
> writes a plan fixture now needs a `Done when:` block to reach its own assertion, so the migration is
> a mechanical consequence of this task and could not be enumerated before the gate existed.
> Authorized files, additive fixture text only — no assertion may be weakened or removed:
> `test/acceptance/adr-approval-gate-before-build.acceptance.test.ts:49`,
> `test/acceptance/build-review-no-longer-judges-wiring.acceptance.test.ts:72,234`,
> `test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts:111,127`,
> `test/acceptance/decide-artifact-coherence-check.acceptance.test.ts:114,504`,
> `test/acceptance/engineer-agent-hosted.test.ts:71,427,690`,
> `test/acceptance/engineer-worktree-isolation.test.ts:91`, and
> `test/engine/engineer/engineer-cli-launch-intake.test.ts:106`.

> **Amended 2026-08-22 by #1785:** Task 6 additionally authorizes the additive
> `Done when:` fixture text in
> `test/acceptance/verify-only-anchored-tautology-exception.acceptance.test.ts`.
> Its plan is consumed by the new frozen criteria projection and must remain
> land-valid; the existing verify-only assertions are retained unchanged.

**Done when:**
- The three land-spec cases pass and the error message contains the task id and reason for each violation.
- `grep -n validatePlanDoneWhen src/conductor/src` lists exactly `plan-done-when.ts` and `engineer/land-spec.ts` — no daemon-backlog or conductor caller.

**Files:**
- src/conductor/src/engine/engineer/land-spec.ts
- src/conductor/test/engine/engineer/land-spec.test.ts
- src/conductor/test/acceptance/adr-approval-gate-before-build.acceptance.test.ts — Done-when fixture migration (amended 2026-08-22)
- src/conductor/test/acceptance/build-review-no-longer-judges-wiring.acceptance.test.ts — Done-when fixture migration (amended 2026-08-22)
- src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts — Done-when fixture migration (amended 2026-08-22)
- src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts — Done-when fixture migration (amended 2026-08-22)
- src/conductor/test/acceptance/engineer-agent-hosted.test.ts — Done-when fixture migration (amended 2026-08-22)
- src/conductor/test/acceptance/engineer-worktree-isolation.test.ts — Done-when fixture migration (amended 2026-08-22)
- src/conductor/test/engine/engineer/engineer-cli-launch-intake.test.ts — Done-when fixture migration (amended 2026-08-22)

**Dependencies:** 3

### Task 5: Criteria evidence on the frozen snapshot
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-inputs.test.ts`: a plan with Task 4 carrying three criteria freezes `doneWhenContext` with one entry for Task 4 holding three `{hash, occurrence, text}` items; two identical lines in different tasks produce the same hash with distinct task ids; two identical lines in one task produce occurrences 1 and 2; a plan with no blocks freezes an empty array.
2. Verify RED.
3. Add `doneWhenContext` to `BuildReviewSourceSnapshot`, populated next to `preservationContext` from `parsePlanTaskDoneWhen(planBody)`; hash with the same normalization the content-region anchor uses.
4. Verify GREEN; commit "feat(build-review): freeze Done when: criteria on the source snapshot".

**Done when:**
- The four inputs cases pass and `doneWhenContext` appears in the snapshot's frozen key list beside `preservationContext`.
- A snapshot written before this change (fixture without the field) still parses.

**Files:**
- src/conductor/src/engine/build-review-inputs.ts
- src/conductor/test/engine/build-review-inputs.test.ts

**Dependencies:** 2

### Task 6: Projections carry criteria additively; Tautology gains the plan body
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-projections.test.ts`: all four projections carry `doneWhenContext`; `TautologyProjection` carries `planBody`; the digest for each rubric differs from the pre-change fixture digest exactly once; a stored pre-change verdict fixture still parses through the aggregate.
2. Verify RED.
3. Extend the projection interfaces and `deriveBuildReviewRubricProjections`; leave `projectionVersion: 'v2'` and the registry untouched.
4. Verify GREEN; commit "feat(build-review): criteria evidence in all projections, plan body for tautology".

**Done when:**
- `projectionVersion` in `build-review-registry.ts` is unchanged (`git diff` shows no edit to that file).
- The projection tests assert `doneWhenContext` on all four and `planBody` on tautology, and the digest-change assertion passes.

**Files:**
- src/conductor/src/engine/build-review-projections.ts
- src/conductor/test/engine/build-review-projections.test.ts

**Dependencies:** 5

### Task 7: Parse an optional boundTo on each finding
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts`: a finding with `boundTo: 'beyond'` parses; a finding with a content-region `boundTo` whose hash and occurrence resolve in the reference context's `doneWhenContext` for the finding's task parses; a finding with no `boundTo` parses unchanged.
2. Verify RED.
3. Add `boundTo?` to `BuildReviewFinding`; extend `BuildReviewFindingReferenceContext` with `doneWhenContext`; accept the three forms in `parseFindings`; add the field to `renderBuildReviewJudgedResultShape`.
4. Verify GREEN; commit "feat(build-review): optional boundTo binding on findings".

**Done when:**
- The three domain cases pass and `renderBuildReviewJudgedResultShape` output contains `boundTo`.
- `CURRENT_BUILD_REVIEW_RUBRIC_CONTRACT_VERSION` is still `'v3'`.

**Files:**
- src/conductor/src/engine/build-review-domain.ts
- src/conductor/test/engine/build-review-domain.test.ts

**Dependencies:** 6

### Task 8: Reject a malformed or unresolvable boundTo with a listing diagnosis
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-domain.test.ts`: a `boundTo` whose hash is absent from `doneWhenContext` rejects the whole envelope; a `boundTo` naming a criterion of a different task than the finding's anchor rejects naming the mismatch; a line-number or hunk-offset form rejects with a diagnosis listing `beyond` and `content-region`; a judged result with a second top-level field still rejects.
2. Verify RED.
3. Implement the rejections in `parseFindings` and the shape-diagnosis path.
4. Verify GREEN; commit "feat(build-review): boundTo rejections list the allowed forms".

**Done when:**
- The four rejection cases pass and each diagnosis string names the offending finding index.
- A coordinator test asserts a rejected envelope classifies as `absent` (rerun) and records no kickback.

**Files:**
- src/conductor/src/engine/build-review-domain.ts
- src/conductor/test/engine/build-review-domain.test.ts
- src/conductor/test/engine/build-review-coordinator.test.ts

**Dependencies:** 7

### Task 9: boundTo never enters the finding identity
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-finding-identity.test.ts`: two findings equal except `boundTo` (`beyond` vs bound vs absent) yield the same id; the canonical payload still has exactly the four keys; a stored disposition written before this change rehydrates unchanged.
2. Verify RED.
3. Strip `boundTo` before canonicalization; leave `exactKeys` as is.
4. Verify GREEN; commit "feat(build-review): exclude boundTo from finding identity".

**Done when:**
- The three identity cases pass.
- `build-review-finding-identity.ts` has no reference to `boundTo` other than the strip.

**Files:**
- src/conductor/src/engine/build-review-finding-identity.ts
- src/conductor/test/engine/build-review-finding-identity.test.ts

**Dependencies:** 7

### Task 10: Beyond findings leave the blocking set
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `build-review-effective.test.ts` and `build-review-verdict.test.ts`: beyond-only lap → PASS with `beyondFindingIds` listing them and `unresolvedFindingIds` empty; one bound + two beyond → FAIL with one unresolved; absent `boundTo` → unresolved; a mechanical fault beside beyond-only findings → still blocked by the infrastructure branch; a pre-change stored disposition still binds.
2. Verify RED.
3. In `deriveEffectiveBuildReviewVerdict`, route `boundTo === 'beyond'` to `beyondFindingIds` on `BuildReviewEffectiveVerdict`; leave the PASS predicate and reduced-coverage branch unchanged.
4. Grep every caller of `resolveEffectiveBuildReviewVerdict` / `deriveEffectiveBuildReviewVerdict` and list them in the commit message; confirm each treats the beyond-only verdict as PASS.
5. Verify GREEN; commit "feat(build-review): beyond findings never block".

**Done when:**
- The five effective/verdict cases pass.
- The commit message lists every caller found by grep and a conductor test asserts a beyond-only lap consumes no kickback and advances no `KickbackGateEntry` counter.

**Files:**
- src/conductor/src/engine/build-review-aggregate.ts
- src/conductor/src/engine/build-review-effective.ts
- src/conductor/test/engine/build-review-effective.test.ts
- src/conductor/test/engine/build-review-verdict.test.ts
- src/conductor/test/engine/conductor-kickback-ledger.test.ts

**Dependencies:** 9

### Task 11: accept refuses a beyond finding; a stale-base lap records nothing
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `build-review-cli.test.ts` (accept against a beyond finding id is refused with the existing not-unresolved message) and `conductor.test.ts` (a lap discarded by the fresh-base exit appends no beyond record).
2. Verify RED.
3. Implement: the accept path checks `beyondFindingIds` before `unresolvedFindingIds`; the conductor write point (Task 13) is placed after the fresh-base exit.
4. Verify GREEN; commit "fix(build-review): accept refuses beyond; stale-base laps record nothing".

**Done when:**
- Both cases pass.
- The accept refusal string for a beyond id equals the existing refusal string for any non-unresolved id.

**Files:**
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/test/engine/build-review-cli.test.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 10

### Task 12: A beyond record kind in the disposition store
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `build-review-dispositions.test.ts`: `appendBeyondIfAbsent` writes a record with status `unfiled` once and is a no-op for the same finding id; `listBeyond` returns only beyond records; `listReducedCoverage` excludes beyond records; `markBeyondFiled` sets status and URL; an unknown status reads as malformed; a held lease fails the append with the lease message.
2. Verify RED.
3. Add the record kind, closed status set, parsers, and the three functions following the `reduced-coverage` template; narrow `listReducedCoverage` to `kind === 'reduced-coverage'`.
4. Verify GREEN; commit "feat(build-review): beyond record kind in the disposition store".

**Done when:**
- The six store cases pass and `STORE_VERSION` is unchanged.
- `listReducedCoverage`'s filter reads `kind === 'reduced-coverage'` (asserted by the exclusion test).

**Files:**
- src/conductor/src/engine/build-review-dispositions.ts
- src/conductor/test/engine/build-review-dispositions.test.ts

**Dependencies:** 1

### Task 13: The conductor records beyond findings after the lap
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `conductor.test.ts`: after an effective verdict with two beyond ids, two `unfiled` records exist; a re-run lap with the same ids appends nothing; a lease failure logs and does not change the verdict.
2. Verify RED.
3. After the effective verdict resolves in the `build_review` block, call `appendBeyondIfAbsent` for each `beyondFindingIds` entry with the finding's rubric, summary, and evidence locations.
4. Verify GREEN; commit "feat(conductor): record beyond findings as unfiled".

**Done when:**
- The three conductor cases pass.
- `grep -n TrackerClient src/conductor/src/engine/conductor.ts` returns nothing.

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 10, 12

### Task 14: Render beyond records in findings, the PR body, and the shipped record
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests: `build-review-cli.test.ts` findings output lists each beyond record with summary and `unfiled`/URL; `shipped-record.test.ts` and the finish-publication test render a beyond section beside reduced coverage; an unrenderable beyond record blocks publication with the existing fail-closed message.
2. Verify RED.
3. Extend the findings renderer and the evidence-section path `reducedCoverageEvidence` travels through.
4. Verify GREEN; commit "feat(build-review): render beyond records where a reader meets them".

**Done when:**
- The three render cases pass.
- A shipped record fixture with one filed and one unfiled beyond record contains both lines verbatim.

**Files:**
- src/conductor/src/engine/build-review-cli.ts
- src/conductor/src/engine/build-review-effective.ts
- src/conductor/src/engine/shipped-record.ts
- src/conductor/src/engine/finish-publication-production.ts
- src/conductor/test/engine/build-review-cli.test.ts
- src/conductor/test/engine/shipped-record.test.ts
- src/conductor/test/engine/finish-publication-production.test.ts

**Dependencies:** 12

### Task 15: The build_review_beyond_filed event and its sink row
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in `event-sinks.test.ts`: the member exists with `{feature, lapId, rubric, findingId, issueUrl}` and its sink row is `{render:false, persist:true, audit:true}`.
2. Verify RED.
3. Add the member to `ConductorEvent` in `types/events.ts` and the row to `EVENT_SINKS`.
4. Verify GREEN; commit "feat(events): build_review_beyond_filed".

**Done when:**
- Type-check passes with the new member (the `Record` is total).
- The sink test asserts the exact row.

**Files:**
- src/conductor/src/types/events.ts
- src/conductor/src/engine/event-sinks.ts
- src/conductor/test/engine/event-sinks.test.ts

**Dependencies:** 1

### Task 16: Daemon reconciliation files unfiled beyond records
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `beyond-reconciliation.test.ts` with a fake tracker and fake store: one unfiled record → one `fileIntakeIssue` call with `interactive:false`, `sourceRef` `<slug>:<findingId>`, record marked filed with the URL, one event emitted; two records → two issues; a filed record → no call, no event.
2. Verify RED.
3. Implement `reconcileBeyondRecords` in new `src/conductor/src/engine/beyond-reconciliation.ts` and call it beside `reconcileHaltPrs` in `daemon-cli.ts` with the daemon's existing `tracker`.
4. Verify GREEN; commit "feat(daemon): file beyond records as intake".

**Done when:**
- The three reconciliation cases pass.
- `daemon-cli.ts` calls `reconcileBeyondRecords` in the same cycle as `reconcileHaltPrs`, asserted by `daemon-session-enforcement.test.ts` or the daemon integration harness.

**Files:**
- src/conductor/src/engine/beyond-reconciliation.ts
- src/conductor/src/daemon-cli.ts
- src/conductor/test/engine/beyond-reconciliation.test.ts

**Dependencies:** 12, 15

### Task 17: Filing failures leave the record unfiled and never block
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `beyond-reconciliation.test.ts`: ledger refusal (thrown) → record stays unfiled, error logged, no event; tracker unreachable → same, and the following reconciliation in the cycle still runs; ledger dedup refusing a duplicate `sourceRef` → record marked filed with the existing issue; stamp failure after a successful file → next cycle does not create a second issue.
2. Verify RED.
3. Wrap each record's filing in try/catch; map the ledger's duplicate refusal to the existing issue.
4. Verify GREEN; commit "fix(daemon): beyond filing degrades without blocking".

**Done when:**
- The four failure cases pass.
- No code path in `beyond-reconciliation.ts` rethrows out of the per-record loop.

**Files:**
- src/conductor/src/engine/beyond-reconciliation.ts
- src/conductor/test/engine/beyond-reconciliation.test.ts

**Dependencies:** 16

### Task 18: Rubric contracts state the binding grammar and the drift guard pins it
**Story:** 7
**Type:** happy-path

**Steps:**
1. Extend `build-review-rubric-skills.test.ts` to require, in each of the four result-contract sections, the `boundTo` bullet with the `beyond` literal and the content-region form, and the binding instruction sentence; run — RED.
2. Edit `skills/build-review-scope/SKILL.md`, `skills/build-review-root-cause/SKILL.md`, `skills/build-review-completeness/SKILL.md`, `skills/build-review-tautology/SKILL.md`: add the grammar to the result contract, the instruction "a finding is blocking only when it names a `Done when:` check the diff fails; anything else is `beyond`; a task with no block is judged as before", and the criteria evidence block description.
3. Verify GREEN; run `test/test_harness_integrity.sh`; commit "feat(rubrics): bind findings to Done when: criteria".

**Done when:**
- `build-review-rubric-skills.test.ts` passes with the new assertions and fails when any one SKILL.md loses the bullet.
- `test/test_harness_integrity.sh` passes.

**Files:**
- skills/build-review-scope/SKILL.md
- skills/build-review-root-cause/SKILL.md
- skills/build-review-completeness/SKILL.md
- skills/build-review-tautology/SKILL.md
- src/conductor/test/engine/build-review-rubric-skills.test.ts

**Dependencies:** 7

### Task 19: A task without criteria is judged as before
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write a failing coordinator test: with empty `doneWhenContext`, a provider fixture returning unbound findings parses and blocks; a fixture returning a content-region `boundTo` rejects (nothing to resolve against).
2. Verify RED.
3. Confirm the parser path needs no change beyond Tasks 7–8; adjust the diagnosis text if the rejection does not name the empty evidence.
4. Verify GREEN; commit "test(build-review): no-criteria tasks grade unchanged".

**Done when:**
- Both coordinator cases pass.
- The rejection diagnosis for a binding against empty evidence says the task has no criteria.

**Files:**
- src/conductor/test/engine/build-review-coordinator.test.ts
- src/conductor/src/engine/build-review-domain.ts

**Dependencies:** 8

## Task Dependency Graph

```
1 ─┬─ 2 ─┬─ 3 ── 4
   │     └─ 5 ── 6 ── 7 ─┬─ 8 ── 19
   │                     ├─ 9 ── 10 ── 11
   │                     └─ 18
   ├─ 12 ─┬─ 13 (also needs 10)
   │      ├─ 14
   │      └─ 16 (also needs 15) ── 17
   └─ 15
```

## Integration Points
- After Task 4: a spec with a criteria-less task cannot land.
- After Task 10: a beyond-only lap passes in the engine.
- After Task 13: beyond records appear in the feature's disposition store.
- After Task 16: the daemon files them as intake issues.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] No unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic

_Revised 2026-08-22 (#1785): the two `Done when:` checks above are authoring judgement, exercised here and by the
`build_review` rubric prompt. The land gate this feature delivers is mechanically shape-only —
presence of the block and 2–5 non-blank criteria — per approved ADR D1 ("mechanical shape at land;
the quality-word rule stays prompt", adr-2026-07-22). `validatePlanDoneWhen` neither reads criterion
prose nor judges falsifiability, and no task in this plan asks it to._
### Task rem-scope-001: src/conductor/test/acceptance/adr-approval-gate-before-build.acceptance.test.ts:49 — add the existing plan fixture to the approved Done-when compatibility-migration scope and pin that ADR approval behavior still reaches its intended assertion
**Done when:**
- The plan fixture includes a two-item `Done when:` block.
- The ADR approval assertion still passes.

### Task rem-scope-002: src/conductor/test/acceptance/build-review-no-longer-judges-wiring.acceptance.test.ts:72 — authorize and verify both cited Done-when fixture migrations while preserving the legacy-wiring scenarios
**Done when:**
- Both cited plan fixtures include a two-item `Done when:` block.
- The legacy-wiring scenarios still pass.

### Task rem-scope-003: src/conductor/test/acceptance/build-tasks-can-amend-protected-docs-artifacts-ame.acceptance.test.ts:111 — authorize and verify the cited Done-when fixture migrations without changing protected-artifact behavior
**Done when:**
- Each cited plan fixture includes a two-item `Done when:` block.
- The protected-artifact assertions still pass unchanged.

### Task rem-scope-004: src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts:114 — authorize and verify both cited Done-when fixture migrations so the cases still reach coherence validation
**Done when:**
- Both cited plan fixtures include a two-item `Done when:` block.
- Each scenario reaches and passes its coherence-validation assertion.

### Task rem-scope-005: src/conductor/test/acceptance/engineer-agent-hosted.test.ts:71 — authorize and verify all three cited Done-when fixture migrations while retaining each hosted-engineer scenario
**Done when:**
- All three cited plan fixtures include a two-item `Done when:` block.
- Every hosted-engineer scenario still passes.

### Task rem-scope-006: src/conductor/test/acceptance/engineer-worktree-isolation.test.ts:91 — authorize and verify the Done-when fixture migration while preserving worktree-isolation assertions
**Done when:**
- The cited plan fixture includes a two-item `Done when:` block.
- The worktree-isolation assertions still pass.

### Task rem-scope-007: src/conductor/test/engine/engineer/engineer-cli-launch-intake.test.ts:106 — authorize and verify the Done-when fixture migration while preserving the CLI intake launch scenario
**Done when:**
- The cited plan fixture includes a two-item `Done when:` block.
- The CLI intake launch scenario still passes.

### Task rem-rootcause-001: src/conductor/src/engine/build-review-domain.ts:492 and src/conductor/test/engine/build-review-domain.test.ts:1 — derive owning-task identity for all four rubric anchor shapes and add cross-task rejection coverage for each
**Done when:**
- Each of the four anchor shapes resolves its owning task before binding validation.
- A binding to a different task is rejected for every anchor shape.

### Task rem-rootcause-002: src/conductor/src/engine/beyond-reconciliation.ts:23 and src/conductor/test/engine/beyond-reconciliation.test.ts:1 — isolate failures inside each record iteration and prove a failed first record does not skip the next
**Done when:**
- A filing failure for the first record leaves that record unfiled.
- A later record is still filed during the same reconciliation pass.

### Task rem-rootcause-003: src/conductor/src/engine/beyond-reconciliation.ts:28 and src/conductor/test/engine/beyond-reconciliation.test.ts:1 — file with sourceRef `<slug>:<findingId>`, recover an existing issue on duplicate, and prove a post-file stamp retry creates no second issue
**Done when:**
- New filings use sourceRef `<slug>:<findingId>` and duplicate sourceRefs recover the existing issue.
- A retry after a post-file stamp failure creates no second issue.

### Task rem-completeness-001: src/conductor/src/engine/build-review-effective.ts:128, shipped-record.ts:261, finish-publication-production.ts:289 and their Task 14 tests — render filed/unfiled beyond evidence beside reduced coverage and fail closed when it is unrenderable
**Done when:**
- Findings, PR body, and shipped record render filed and unfiled beyond evidence beside reduced coverage.
- An unrenderable beyond record fails the publication path closed.

### Task rem-completeness-002: src/conductor/src/engine/build-review-domain.ts:490 and src/conductor/test/engine/build-review-domain.test.ts:1 — preserve the finding index and diagnose all four malformed/unresolvable boundTo cases with allowed `beyond` and `content-region` forms
**Done when:**
- Each malformed or unresolvable binding reports its original finding index.
- Every diagnosis lists the allowed `beyond` and `content-region` forms.

### Task rem-completeness-003: src/conductor/test/engine/build-review-coordinator.test.ts:1 and src/conductor/src/engine/build-review-domain.ts:497 — add both empty-doneWhenContext coordinator cases and make the rejected binding say the task has no criteria
**Done when:**
- Unbound findings against empty criteria continue to block.
- Bound findings against empty criteria are rejected with a no-criteria diagnosis.

### Task rem-completeness-004: src/conductor/src/engine/beyond-reconciliation.ts:26 and src/conductor/test/engine/beyond-reconciliation.test.ts:1 — implement and cover ledger refusal, tracker failure with continuation, duplicate-sourceRef recovery, and stamp-failure idempotency
**Done when:**
- Ledger refusal, tracker failure, duplicate recovery, and stamp-failure retry are each covered by a focused test.
- A failure in one record does not prevent a subsequent record from being reconciled.

### Task rem-completeness-005: src/conductor/src/engine/beyond-reconciliation.ts:28, src/conductor/src/daemon-cli.ts:1755, and src/conductor/test/engine/beyond-reconciliation.test.ts:1 — deliver Task 16's three reconciliation cases, sourceRef filing, filed event, and same-cycle daemon assertion
**Done when:**
- Reconciliation files the required records with sourceRef and emits the filed event.
- The daemon observes the filing in the same reconciliation cycle.

### Task rem-completeness-006: skills/build-review-scope/SKILL.md:1, skills/build-review-root-cause/SKILL.md:1, skills/build-review-completeness/SKILL.md:103, skills/build-review-tautology/SKILL.md:1, and src/conductor/test/engine/build-review-rubric-skills.test.ts:1 — add the criteria-evidence and blocking-vs-beyond instructions to all four contracts and pin the full grammar in the drift guard
**Done when:**
- All four rubric contracts state the criteria-evidence and blocking-versus-beyond rules.
- The drift-guard test fails if any contract loses a required grammar clause.

### Task rem-completeness-007: src/conductor/test/engine/build-review-effective.test.ts:1, build-review-verdict.test.ts:1, and conductor-kickback-ledger.test.ts:1 — add Task 10's five effective/verdict cases and prove a beyond-only lap advances no kickback
**Done when:**
- The five effective/verdict cases pass.
- A beyond-only lap advances without adding a kickback.

### Task rem-completeness-008: src/conductor/test/engine/conductor.test.ts:1 — prove two beyond ids append two unfiled records, a rerun appends none, and lease failure logs without changing the verdict
**Done when:**
- Two distinct beyond identifiers append two unfiled records and a rerun appends none.
- Lease failure is logged without changing the lap verdict.

### Task rem-completeness-009: src/conductor/test/engine/build-review-cli.test.ts:345 and src/conductor/test/engine/conductor.test.ts:1 — pin the beyond-id accept refusal and prove a fresh-base-discarded lap appends no beyond record
**Done when:**
- The accept command refuses an identifier for a beyond finding.
- A fresh-base-discarded lap appends no beyond record.

### Task rem-completeness-010: src/conductor/test/engine/build-review-finding-identity.test.ts:1 — prove beyond, content-region, and absent boundTo variants share an id, the canonical payload keeps four keys, and a pre-change disposition rehydrates
**Done when:**
- Beyond, content-region, and absent bindings share one finding identity and the canonical payload has four keys.
- A disposition written before the binding field exists rehydrates successfully.

### Task rem-completeness-011: src/conductor/test/engine/build-review-domain.test.ts:1 — add parsing cases for `beyond`, a resolving content-region binding, and absent boundTo, and assert the rendered result shape includes boundTo
**Done when:**
- `beyond`, resolving content-region, and absent binding payloads parse successfully.
- Rendered findings include the optional `boundTo` field.

### Task rem-completeness-012: src/conductor/test/engine/build-review-inputs.test.ts:1 — add the three-criteria, same-hash/distinct-task, repeated-occurrence, empty-array, and legacy-snapshot cases required by Task 5
**Done when:**
- Each of the five named criteria-input cases passes.
- Legacy snapshots without criteria remain accepted.

### Task rem-completeness-013: src/conductor/src/engine/plan-done-when.ts:24 and src/conductor/test/engine/plan-done-when.test.ts:5 — preserve blank-block evidence and add separate compliant, blank, and fenced-example cases alongside all existing reason coverage
**Done when:**
- Blank blocks retain blank evidence rather than becoming missing blocks.
- Compliant, blank, and fenced-example validation cases pass alongside existing reason coverage.
### Task rem-rootcause-004: skills/build-review-root-cause/SKILL.md:31 and src/conductor/test/engine/build-review-rubric-skills.test.ts:1 — pin ADR D1's shape-only boundary and require authoring-only semantic-falsifiability concerns outside a failed task criterion to bind as `beyond`
### Task rem-scope-008: src/conductor/src/engine/artifacts.ts:864, src/conductor/src/engine/conductor.ts:7102, and src/conductor/test/engine/conductor.test.ts:1 — remove the CompletionResult effective-resolution extension, keep effective-verdict resolution inside conductor.ts at Task 13's write point, and prove beyond records append from that local verdict
### Task rem-rootcause-005: src/conductor/src/engine/build-review-domain.ts:496-516 and src/conductor/test/engine/build-review-domain.test.ts:1 — replace path-only owning-task inference with explicit task identity for every binding-capable anchor or binding, and add a shared-file fixture proving same-task bindings pass while cross-task bindings reject
### Task rem-rootcause-006: src/conductor/src/engine/beyond-reconciliation.ts:29-36, src/conductor/src/engine/engineer/intake/file-issue.ts:148-152, and src/conductor/test/engine/beyond-reconciliation.test.ts:1 — enforce sourceRef as an idempotency key by looking up and recovering an existing issue before creation, then prove a crash or stamp failure after creation cannot create a second issue on retry
### Task rem-rootcause-007: src/conductor/src/engine/plan-done-when.ts:6-23 and src/conductor/test/engine/plan-done-when.test.ts:1 — enumerate tasks through the same fence-aware task-section parser used for Done-when extraction and prove a fenced Task heading is ignored
### Task rem-scope-009: src/conductor/src/engine/conductor.ts:7105 and src/conductor/test/engine/build-review-disposition-race.test.ts:249,384 — remove the completion-path effective-verdict resolution, retain beyond recording only at Task 13's local post-fresh-base resolution, and change the race assertions from three resolutions to the two authorized decision-point resolutions
### Task rem-rootcause-008: src/conductor/src/engine/plan-task-parse.ts:97-100, src/conductor/test/engine/plan-task-parse-fence.test.ts:1, and src/conductor/test/engine/plan-task-parse.test.ts:1 — track the opening fence character and run length, close only on the same character with a run at least as long, and prove an inner triple-backtick line cannot expose a Task heading inside an outer four-backtick fence
### Task rem-rootcause-009: src/conductor/src/engine/tracker-client.ts:69, src/conductor/src/engine/engineer/intake/file-issue.ts:155-159, src/conductor/src/engine/beyond-reconciliation.ts:30, and src/conductor/test/engine/beyond-reconciliation.test.ts:90 — replace caller-side find-then-create with a sourceRef-keyed create-or-recover operation serialized at the tracker seam, then prove concurrent reconciliations and a retry after creation-before-local-stamp produce one issue URL and one created issue
### Task rem-completeness-014: src/conductor/test/engine/build-review-effective.test.ts:1, src/conductor/test/engine/build-review-verdict.test.ts:1, and src/conductor/test/engine/conductor-kickback-ledger.test.ts:1 — add the beyond-only PASS, one-bound-plus-two-beyond FAIL, absent-boundTo unresolved, mechanical-fault blocked, and legacy-disposition cases, plus prove a beyond-only lap increments no KickbackGateEntry counter
### Task rem-completeness-015: src/conductor/test/engine/shipped-record.test.ts:1 and src/conductor/test/engine/finish-publication-production.test.ts:740 — add a fixture with one filed and one unfiled beyond record, assert both lines verbatim under `## Build-review findings beyond plan criteria` in shipped/PR output, and prove an unrenderable beyond record blocks publication
### Task rem-completeness-016: src/conductor/test/engine/build-review-inputs.test.ts:1 — cover three criteria for one task, identical lines across tasks with equal hashes and distinct task ids, repeated lines with occurrences 1 and 2, an empty doneWhenContext when no blocks exist, and parsing a legacy snapshot without the field
### Task rem-completeness-017: src/conductor/test/engine/build-review-finding-identity.test.ts:1 — prove beyond, resolving content-region, and absent boundTo variants yield one finding id, assert the canonical payload has exactly rubric/contractVersion/concernKind/anchor, and rehydrate a disposition stored before boundTo existed
### Task rem-completeness-018: src/conductor/test/engine/build-review-coordinator.test.ts:1 and src/conductor/src/engine/build-review-domain.ts:748 — add empty-doneWhenContext coordinator cases proving unbound findings parse and block, while a content-region binding rejects with the task-has-no-criteria diagnosis, classifies absent, and records no kickback
### Task rem-completeness-019: src/conductor/test/engine/build-review-cli.test.ts:348 and src/conductor/test/engine/conductor.test.ts:2563 — assert accepting a beyond finding id returns the existing non-unresolved refusal string, and prove a lap discarded by the fresh-base exit appends no beyond record
### Task rem-completeness-020: src/conductor/src/daemon-cli.ts:1755 and src/conductor/test/engine/daemon-cli-beyond-reconciliation-wiring.test.ts:1 — add a daemon wiring case that runs the reconciliation cycle with a fake tracker and proves the same cycle invoking reconcileHaltPrs also invokes reconcileBeyondRecords with that tracker
### Task rem-completeness-021: src/conductor/test/engine/build-review-domain.test.ts:27,534 — add a successful `boundTo: "beyond"` parse case and assert renderBuildReviewJudgedResultShape includes the `boundTo: "beyond" | {…}` grammar, while retaining the existing resolving content-region and absent-field cases
### Task rem-scope-010: src/conductor/src/engine/artifacts.ts:2951 and src/conductor/test/engine/build-review-disposition-race.test.ts:249,383 — revert the residual local-variable/return-formatting and unchanged-assertion hunks to the baseline form, preserving only Task 13's local post-fresh-base effective-verdict resolution in src/conductor/src/engine/conductor.ts:8022
### Task rem-completeness-022: src/conductor/test/engine/daemon-cli-beyond-reconciliation-wiring.test.ts:1 — add a daemon-cycle case with a fake tracker proving the cycle that invokes reconcileHaltPrs also invokes reconcileBeyondRecords with that tracker, exercising the wiring at src/conductor/src/daemon-cli.ts:1755
### Task rem-completeness-023: src/conductor/test/engine/build-review-effective.test.ts:1, src/conductor/test/engine/build-review-verdict.test.ts:1, and src/conductor/test/engine/conductor-kickback-ledger.test.ts:1 — add the beyond-only PASS, one-bound-plus-two-beyond FAIL, absent-boundTo unresolved, mechanical-fault blocked, and legacy-disposition cases, then prove a beyond-only lap consumes no kickback and advances no KickbackGateEntry counter
### Task rem-completeness-024: src/conductor/test/engine/build-review-coordinator.test.ts:1 — add empty-doneWhenContext coordinator cases proving an unbound finding parses and blocks, while a content-region boundTo rejects with the task-has-no-criteria diagnosis from src/conductor/src/engine/build-review-domain.ts:748, classifies absent, and records no kickback
### Task rem-completeness-025: src/conductor/test/engine/shipped-record.test.ts:1 and src/conductor/test/engine/finish-publication-production.test.ts:740 — add one filed and one unfiled beyond record, assert both lines verbatim under `## Build-review findings beyond plan criteria` in shipped-record and retained PR-body output, and prove an unrenderable record triggers the existing fail-closed publication message
### Task rem-completeness-026: src/conductor/test/engine/conductor.test.ts:2585 — drive the local post-fresh-base write point at src/conductor/src/engine/conductor.ts:8022 and prove two beyond ids append two unfiled records, rerunning the lap appends none, and an append lease failure logs without changing the effective verdict
