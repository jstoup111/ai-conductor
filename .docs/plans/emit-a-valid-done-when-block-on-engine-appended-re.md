# Implementation Plan: Engine-appended remediation tasks carry a valid Done-when block

**Date:** 2026-09-06
**Stories:** .docs/stories/emit-a-valid-done-when-block-on-engine-appended-re.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; scoped intent conforms to the existing contracts: the remediation id scheme and its non-numeric guarantee are untouched, the criterion and governing-clause fields both remain mandatory on their paths, the 2-5 check bound is unchanged, and appended checks restate only the obligation the cited clause already carries.

## Summary

Four bounded tasks deliver #1802. Both engine writers that append remediation tasks emit one well-formed completion block per appended task through a single shared renderer, and the land-time shape refusal marks an engine-appended task id as engine-written. The 2-5 bound itself, remediation routing, dispositions, plan-growth budgets, and the per-task evidence rule at task close are outside this small slice.

## Technical Approach

There are two engine writers and they disagree with the land-time shape rule in different ways. The criterion-bound renderer emits a completion block only when a criterion with a parent task or a governing clause is present, and each such block carries exactly one check, which the validator grades `too-few`. The second writer appends a bare heading line with no metadata at all, which the validator grades `missing`. Both are engine-authored, so the plan author named in the current refusal message is the wrong reader.

Introduce one exported pure helper in the remediation-append module that turns the fields already available at append time into an ordered list of two to three single-line checks, and route both writers through it. The first check restates the obligation the task already cites: the criterion when present, otherwise the governing clause, otherwise the gap rationale, otherwise the task title. When both a criterion and a governing clause are present, both are restated and the block carries three checks; that same consolidation removes today's duplicate rendering, in which the two conditional branches each emit their own completion block and their own parent-task line for one task. The last check is the observable one: the gate finding recorded under this task id is no longer reported when that gate re-runs against the change. Every source string is whitespace-collapsed to one physical line and trimmed before it becomes a check, because a multi-line rationale would otherwise terminate the block at its first non-list line; a source that collapses to empty is dropped and the id-and-title derivation supplies the check instead, so the block can never fall below two nonblank checks. The block is rendered last within a task, after the metadata lines, since any non-list content after the marker ends the block.

Deliberately keep the checks bounded by the clause the task already cites. Restating the cited obligation adds no mechanism the approved plan or the governing clause does not authorize, and the re-run check names an event the gate performs anyway. This also matters for how a review reads these tasks: a task carrying a block has blocking findings narrowed to those citing one of its checks, so the second check is written broadly enough that a genuine finding against the remediation still cites it rather than falling outside the block. Adding a block additionally moves these tasks off the legacy no-block close rule onto per-check evidence at close; that is the intended consequence of the desired outcome, it is the regime the criterion-bound path has already been in since remediable as-built findings began appending tasks, and it is the reason both checks are written to be provable from the committed change rather than from an external system.

For the refusal message, export a predicate over the id scheme from the same module that mints the ids, and have the land-time refusal consult it per violation. The second writer already tests the same `rem-` prefix to warn about a missing gate-source prefix, so the prefix is the established engine-appended signal; keeping the predicate next to the minting code prevents the two from drifting. A violation on an engine-appended id renders with an explicit engine-appended attribution and a pointer away from re-authoring the plan; a hand-authored violation renders exactly as it does today. The ordering, the per-violation reason vocabulary, and the fail-before-commit position of the rung are unchanged.

Tests follow the repository test-design rules. Pure rendering, collapsing, and predicate cases belong at unit level over the exported helpers. One new integration file drives the real second writer against a real temporary plan file for both of its branches and then runs the real validator over the resulting text, so the two writers and the shape rule are proven to agree in one place rather than by two independent unit assertions. Land refusal cases extend the existing land-spec fixtures, which already drive the real land path against a seeded worktree with injected identity; no third-party service, provider, or network boundary is involved anywhere in this slice.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, satisfying the existing rule rather than narrowing it, and all three stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/plan-done-when.ts:10-31` reports `missing` for a task heading with no completion block, `too-few` for one check, `too-many` for more than five, and `blank` for a declared block with no or blank checks.
- Verified: `src/conductor/src/engine/engineer/land-spec.ts:265-276` is the only production caller of that validator and renders `no Done when: block` or `an invalid Done when: block (<reason>)` per violation.
- Verified: `src/conductor/src/engine/remediation-append.ts:72-104` renders the criterion branch and the governing-clause branch independently, so a gap carrying a criterion, a parent task, and a clause emits two completion blocks and two parent-task lines, and each branch emits exactly one check.
- Verified: `src/conductor/src/engine/conductor.ts:13394` appends `### Task <id>: <title>` and nothing else on the non-criterion-bound branch, and `src/conductor/src/engine/conductor.ts:13295` already tests the `rem-` prefix to log a missing gate-source prefix.
- Verified: `src/conductor/src/engine/plan-task-parse.ts:226-283` accumulates checks across every completion block inside one task section, ends a block at the first non-blank non-list line, and treats a declared block with no list item as malformed.
- Verified: `src/conductor/test/engine/engineer/land-spec.test.ts:1346-1397` already covers a missing block and a too-few block through the real land path and asserts the head is unmoved.
- Verified: `src/conductor/test/engine/conductor.test.ts:16110` already owns the second writer's cases, and `src/conductor/test/remediation-append.test.ts` owns the criterion-bound renderer's cases.
- Verified: `isEngineAppendedRemediationAmendment` in `src/conductor/src/engine/protected-artifact-seal.ts:341` is a different, seal-scoped predicate; the new predicate takes a distinct name and does not replace it.
- Verified by a full sweep of the decision records: no approved decision fixes the field list or completion-block shape of an appended remediation task, the 2-5 bound is stated for every task heading rather than for hand-authored plans only, and the mandatory criterion, parent-task, and governing-clause fields are floors that this change preserves. No decision record is created or amended.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no new event, metric, span, log line, or report channel — the refusal text is an existing rung's existing message.
- Verify-claims verdict: CLEAR. Every path, symbol, and line above was read in the worktree. No pending product or scope assumption remains.

## Tasks

### Task 1: Render one well-formed completion block on every criterion-bound append
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/remediation-append.ts, src/conductor/test/remediation-append.test.ts
**Dependencies:** none

**Steps:**
1. Write unit cases over the renderer for a criterion-with-parent gap, a governing-clause gap, a gap carrying both, a gap whose criterion and rationale span several lines or carry surrounding blank space, and a gap whose optional fields are all absent or blank. Assert the emitted text through the real validator so the cases state the rule rather than restating the template.
2. Establish RED, then add an exported pure helper that collapses each source string to one trimmed physical line, drops sources that collapse to empty, and returns an ordered list of two to three nonblank checks: the restated criterion, the restated governing clause when present, and the re-run check naming the task id and its gate source.
3. Rewrite the renderer to emit the metadata lines once — criterion, parent task, and governing clause each at most once — followed by one completion block built from the helper and placed last in the block.
4. Keep the existing idempotent upsert and ordinal-suffix behavior untouched, and assert re-appending an identical gap returns the same ids and byte-identical text.
5. Run the focused unit file through the repository scoped-run command, then its typecheck target that includes tests, and commit.

**Done when:**
1. Criterion-bound, clause-bound, and both-fields gaps each render one completion block whose checks the real validator accepts with no violation.
2. A gap carrying a criterion, a parent task, and a governing clause renders exactly one completion block and exactly one parent-task line.
3. Multi-line and blank-padded source text yields only single-line nonblank checks, and a gap with every optional field absent or blank still yields at least two nonblank checks.
4. Re-appending an identical gap returns the same ids and leaves the plan text byte-for-byte unchanged.

### Task 2: Route the bare id-and-title writer through the same renderer
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/conductor.ts, src/conductor/test/engine/conductor.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing second-writer cases with a new task, an idempotent repeat, and a content-drift suffix case, asserting the appended text through the real validator rather than through a hardcoded string.
2. Establish RED, then append the shared helper's checks under a completion marker after each appended heading, deriving the checks from the task id and title on this branch because no criterion, clause, or rationale is available to it.
3. Preserve the branch's existing id validation, missing-prefix warning, duplicate detection, content-hash suffixing, reported ids, and temp-file-and-rename replacement exactly as they are.
4. Run the focused test file through the repository scoped-run command, then its typecheck target that includes tests, and commit.

**Done when:**
1. Each heading appended by the second writer is followed by a completion block whose checks the real validator accepts with no violation.
2. The reported appended ids, the missing-prefix warning, the idempotent skip, and the content-hash suffix for drifted content are unchanged by this task.
3. A second append of the same input adds no further heading and no further completion block.

### Task 3: Mark an engine-appended task id in the land-time shape refusal
**Story:** Story 3
**Type:** negative-path
**Files:** src/conductor/src/engine/remediation-append.ts, src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 1

**Steps:**
1. Add land cases for a plan whose only violation is on an engine-appended id, a plan whose only violations are hand-authored ids, and a plan carrying one of each, driving the real land path against the existing seeded worktree fixture with the existing injected identity runner.
2. Establish RED, then export a predicate over the minted id scheme from the append module and consult it per violation when rendering the refusal.
3. Render an engine-appended violation with an explicit engine-appended attribution and a pointer away from re-authoring the plan; leave a hand-authored violation's wording, its reason vocabulary, and the violation ordering exactly as they are.
4. Keep the rung's position ahead of any commit and assert the worktree head is unmoved after the refusal.
5. Run the focused land test file through the repository scoped-run command, then its typecheck target that includes tests, and commit.

**Done when:**
1. A refusal over an engine-appended id names that id and carries the engine-appended attribution.
2. A refusal over hand-authored ids only carries no engine-appended attribution and matches the existing wording for its reasons.
3. A mixed refusal names both ids, each with its own attribution and neither attribution applied to the other.
4. Every refusal names each offending task id, leaves the worktree head unmoved, and leaves the worktree in place.
5. A plan whose hand-authored tasks each carry two to five nonblank checks lands with no shape refusal.

### Task 4: Prove both writers and the shape rule agree in one integration
**Story:** Story 1 (negative path)
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/remediation-append-land-shape.test.ts
**Dependencies:** 1, 2

**Steps:**
1. Add this new integration test file. Drive the real second writer against a real temporary plan file seeded with a hand-authored task that already carries two checks, once through its criterion-bound branch and once through its bare id-and-title branch.
2. Read the written file back and run the real validator over it, asserting no violation for any appended id on either branch.
3. Add the negative half: seed the same temporary plan with a hand-authored task missing its block, a hand-authored task with one check, a hand-authored task with a blank check, and a hand-authored task with six checks; after appending, assert the validator reports each of those ids with its own reason and reports nothing for the appended ids.
4. Use only real temporary files and the real internal path; inject no provider and contact no external service. Await every write before cleanup removes the temporary directory.
5. Run the new file through the repository scoped-run command, then its typecheck target that includes tests, then the configured aggregate suite command, and commit.

**Done when:**
1. Appending through either writer branch and validating the written file reports no violation for any appended id.
2. The same validation reports the missing, too-few, blank, and too-many hand-authored ids, each with its own reason.
3. The test creates its state under a temporary directory, removes exactly that directory, and starts no provider, subprocess-driven external tool, or network call.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a remediation gap carrying a criterion and a parent task, when the engine appends its task block to a plan, then the land-time shape rule reports no violation for the appended task id. | 1, 4 | "Criterion-bound, clause-bound, and both-fields gaps each render one completion block whose checks the real validator accepts with no violation." | diff-local |
| Story 1 happy: Given a remediation gap carrying only an id and a title, with no criterion and no governing clause, when the engine appends its task block to a plan, then the land-time shape rule reports no violation for the appended task id. | 2, 4 | "Each heading appended by the second writer is followed by a completion block whose checks the real validator accepts with no violation." | diff-local |
| Story 1 happy: Given a remediation gap carrying both a criterion with a parent task and a governing clause, when the engine renders its task block, then the block carries exactly one completion block and exactly one parent-task line, and both the criterion and the clause are restated as checks. | 1 | "A gap carrying a criterion, a parent task, and a governing clause renders exactly one completion block and exactly one parent-task line." | diff-local |
| Story 1 negative: Given a gap whose criterion, clause, or rationale text spans several lines or carries surrounding blank space, when the engine renders its task block, then every emitted check is a single physical line and the land-time shape rule still reports no violation for that task. | 1 | "Multi-line and blank-padded source text yields only single-line nonblank checks, and a gap with every optional field absent or blank still yields at least two nonblank checks." | diff-local |
| Story 1 negative: Given a gap whose optional criterion, parent task, clause, and rationale are all absent or blank, when the engine renders its task block, then it still emits at least two nonblank checks derived from the task id and title, and no check is blank. | 1 | "Multi-line and blank-padded source text yields only single-line nonblank checks, and a gap with every optional field absent or blank still yields at least two nonblank checks." | diff-local |
| Story 2 happy: Given a plan whose hand-authored tasks each carry between two and five nonblank checks, when the spec is landed, then it lands with no shape refusal. | 3 | "A plan whose hand-authored tasks each carry two to five nonblank checks lands with no shape refusal." | diff-local |
| Story 2 negative: Given a hand-authored task with no completion block, when the spec is landed, then landing is refused, the refusal names that task id, and no commit is created. | 3, 4 | "Every refusal names each offending task id, leaves the worktree head unmoved, and leaves the worktree in place." | diff-local |
| Story 2 negative: Given hand-authored tasks with one check, with a blank check, and with six checks, when the spec is landed, then landing is refused and each offending task id is named with its own reason. | 4 | "The same validation reports the missing, too-few, blank, and too-many hand-authored ids, each with its own reason." | diff-local |
| Story 3 happy: Given a plan whose only shape violation is on an engine-appended remediation task id, when landing is refused, then the refusal marks that task as engine-appended and tells the reader the engine wrote the block rather than the plan author. | 3 | "A refusal over an engine-appended id names that id and carries the engine-appended attribution." | diff-local |
| Story 3 negative: Given a plan whose only shape violations are on hand-authored task ids, when landing is refused, then the refusal carries no engine-appended attribution for any named task. | 3 | "A refusal over hand-authored ids only carries no engine-appended attribution and matches the existing wording for its reasons." | diff-local |
| Story 3 negative: Given a plan carrying one engine-appended and one hand-authored violation, when landing is refused, then each named task carries its own attribution and neither attribution is applied to the other. | 3 | "A mixed refusal names both ids, each with its own attribution and neither attribution applied to the other." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against controlled fixtures. Task 1 owns the criterion-bound renderer's unit cases and the shared check-derivation helper. Task 2 owns the second writer's unit cases. Task 3 owns land-path refusal integration for attribution, reusing the existing seeded-worktree fixture and its injected identity runner. Task 4 owns the one cross-writer integration that proves both append branches and the shape rule agree over a real temporary plan file, and it owns the hand-authored refusal reasons that no other task asserts end to end. No provider, GitHub, network, or package-registry boundary is reached anywhere in this slice, so no smoke test applies. Existing coverage for the plan-growth allowance, remediation routing, dispositions, and the per-task evidence rule at task close remains authoritative for those behaviors. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 1 -> Task 4
Task 2 -> Task 4
