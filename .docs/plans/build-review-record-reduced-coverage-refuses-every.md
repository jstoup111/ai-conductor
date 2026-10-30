# Implementation Plan: build-review record-reduced-coverage refuses every stacked-feature child (#3498)

**Date:** 2026-10-29
**Design:** none (technical track, Small tier; governed by `adr-2026-10-07-per-child-build-region` D4, D9, D10, `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` D6, D9 and `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9)
**Stories:** .docs/stories/build-review-record-reduced-coverage-refuses-every.md
**Conflict check:** Not required at Small tier

## Summary

On a stacked feature, `build-review record-reduced-coverage` reads only the root
`.pipeline/build-review.json` and the root kickback ledger. The live gate writes each child's
aggregate and `build_review` ledger entry under `.pipeline/children/<k>/`. The child's
exhausted-allowance HALT prints a command with no way to name the child. This plan gives the
command a `--child` scope, judges the allowance on that child's ledger, makes every refusal name
its artifact and reason, and makes the child halt print `--child <k>`. It has 7 tasks.

## Technical Approach

- **Where the change lives.**
  - The dispatcher changes in `src/conductor/src/engine/build-review-cli.ts`.
  - The grammar and help change in `src/conductor/src/cli.ts`.
  - The halt text changes in `src/conductor/src/engine/build-review-halt-render.ts`, and its one
    call site in `src/conductor/src/engine/conductor.ts`.
  - `src/index.ts` already passes the detected command object to
    `dispatchBuildReviewRecordReducedCoverage` unchanged.
- **Reuse #3448's child-scoped reader.** `dispatchBuildReviewRecordReducedCoverage` uses the
  existing module-private `readCliBuildReviewAggregate(worktree, child, readFile)` and
  `describeCliAggregateFailure(...)`. It uses them for the initial read and for the in-lease
  recheck. The recheck keeps its current semantics: any recheck failure sets
  `stateRefusal = 'the inspected review lap changed'` and returns false. The stacked hint uses the
  existing `listChildAggregates` dep and its `defaultListChildAggregates` default, which the record
  deps type gains.
- **Order of checks.** The order follows `dispatchBuildReviewAccept`:
  1. feature resolution;
  2. the TTY and operator gate;
  3. the lap and rationale check;
  4. the child id, through `parseChildId`;
  5. the aggregate read;
  6. the unknown rubric;
  7. the no-current-fault check;
  8. under the store lease: the unchanged-lap recheck, the fault recheck, the allowance check and
     the duplicate check.

  An invalid child id therefore refuses before any aggregate or ledger read.
- **Child-scoped allowance.** The default `readMechanicalFaults` becomes `(root, child) =>`. It
  reads `readKickbackLedger(root, child)`, and the dep signature gains `child?: ChildId`. An
  unreadable `build_review` gate sets a typed ledger refusal and returns false from the lease
  callback; it does not throw. The allowance-remaining refusal prints the consumed count, the
  `MAX_MECHANICAL_FAULTS_BUILD_REVIEW` bound and the ledger's pipeline-relative path. The path
  comes from the existing `pipelineRelativePath(worktree, 'kickback-ledger.json', child)`. The
  allowance exemption for `projection-oversized` and `read-only-review-unavailable` is unchanged.
- **Refusal messages and reasons.** Each refusal prints one line and exits 1:
  - Feature unresolved: `build-review record-reduced-coverage: refused for '<slug>'; the feature worktree could not be resolved.` No event is recorded, because there is no worktree to append to.
  - Invalid child: `... refused for '<slug>'; invalid child id '<raw>'.`, reason `invalid-child`.
  - Aggregate missing, malformed or unreadable: `... refused for '<slug>'; <path> is missing.` plus the stacked hint, or `<path> is malformed (<detail>).`, or `<path> could not be read (<detail>).`. The reason is `aggregate-unreadable`.
  - Lap not current: `... refused for '<slug>'; lap '<requested>' is not the current lap ('<current>') in <path>.`, reason `requested-lap-not-current`.
  - Ledger gate unreadable: `... refused for '<slug>'; <ledger path> gate 'build_review' is unreadable.`, reason `kickback-ledger-unreadable`.
  - Allowance remains: `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (<n> of 3 consumed in <ledger path>).`, reason `current-rubric-lap-or-state-invalid`, as today.
  - Store rejection (`appended.ok === false` with no state or ledger refusal): `... refused for '<slug>'; .pipeline/build-review-dispositions.json rejected the decision (<kind>): <message>.`, reason `disposition-store-<kind>`.
  - Every other existing refusal keeps its text and reason: non-interactive, invalid lap or blank rationale, unknown rubric, no current fault, lap changed, fault changed, and duplicate.
  - The final catch-all stays, for unexpected throws only.
- **Record and success output.** The record stays feature-scoped and carries no child field
  (`adr-2026-08-18` D9). The success line and the `build_review_reduced_coverage_accepted` event
  are unchanged.
- **Grammar.** `detectBuildReviewRecordReducedCoverageCommand` accepts exactly
  `--feature <f> [--child <k>] --lap <l> --rubric <r> --rationale <t>`, in that order. It uses the
  same `expected`-array pattern as `detectBuildReviewResolveCaseCommand`, and its result carries
  `child` only when present. `BuildReviewRecordReducedCoverageDispatch` and
  `BuildReviewRecordReducedCoverageCommand` gain `child?: string`. The commander subcommand gains
  `.option('--child <child>', 'Stacked child whose current lap and allowance are checked')`.
- **Halt text.** `renderExhaustedMechanicalBuildReviewHalt(entry, currentLap, child?: ChildId)`
  inserts ` --child <k>` between `--feature <feature-slug>` and `--lap` in recovery line 1, only
  when a child is supplied. With no child, the text is byte-identical to today's. The
  unavailable-diagnostic form ignores the child. In `conductor.ts`, the exhausted-allowance call
  site passes `this.activeRegionChild`, which it already uses for the ledger and aggregate paths.
  The `withActiveChild` suffix is unchanged.
- **Pattern to reuse.**
  - For `--child` parsing, refusal wording and the `refuse(reason, message)` closure, follow
    `dispatchBuildReviewAccept`, which #3448 made child-scoped. Search hint: `accept --child` in
    `build-review-cli.ts`.
  - For the grammar, follow `detectBuildReviewResolveCaseCommand`.
- **Tests.** Tests extend:
  - `src/conductor/test/engine/build-review-cli.test.ts`. A new
    `describe('build-review record-reduced-coverage --child')` block follows the existing
    `describe('build-review accept --child')` fixture. That fixture is a real temporary feature tree
    at `<root>/.worktrees/review-rubrics`, with real aggregate files written under
    `.pipeline/children/<k>/` and the default file reader. Ledgers are written with the
    kickback-ledger JSON shape that `readKickbackLedger` parses.
  - `src/conductor/test/cli/index.test.ts`, for the grammar and help.
  - `src/conductor/test/engine/conductor-halt.test.ts`, for the renderer and the conductor halt.
    The conductor halt test sets the active child the way `conductor-kickback-transition.test.ts`
    does (its `activeRegionChild` option). It drives a `build_review` runner result with
    `currentLapMechanicalFault: true`, as `operator-park-boundary.test.ts` does.
- **Unchanged.** No persisted schema, event type or event field changes. `findings`, `accept` and
  `resolve-case` are untouched.

## Prerequisites

- None. The child-scoped reader comes from #3448, which shipped in PR #3513 and is on main.

## Tasks

### Task 1: record-reduced-coverage grammar accepts --child
**Story:** Story 1 (happy 5; negative 7)
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/cli/index.test.ts`, beside the existing `detectBuildReviewRecordReducedCoverageCommand` test, for every Done-when check below.
2. Verify they fail (RED). Today the detector rejects any argument vector that contains `--child`.
3. Implement in `src/conductor/src/cli.ts`:
   - give `BuildReviewRecordReducedCoverageDispatch` an optional `child`;
   - rewrite `detectBuildReviewRecordReducedCoverageCommand` with the optional `--child` slot after `--feature`, using `detectBuildReviewResolveCaseCommand`'s `expected`-array pattern;
   - add the commander `--child <child>` option.
4. Verify they pass (GREEN).
5. Commit: "feat(build-review): record-reduced-coverage grammar accepts --child"

**Done when:**
- [test] `detectBuildReviewRecordReducedCoverageCommand` for `build-review record-reduced-coverage --feature review-rubrics --child 2 --lap lap-current --rubric testQuality --rationale risk` returns `{ kind: 'record-reduced-coverage', feature: 'review-rubrics', child: '2', lapId: 'lap-current', rubric: 'testQuality', rationale: 'risk' }`.
- [test] `detectBuildReviewRecordReducedCoverageCommand` returns null when `--child 2` follows `--lap` and when `--child` appears twice.
- [test] The existing flat argument vector still returns the result with no `child` key, and the `createProgram()` help for `build-review record-reduced-coverage` lists a `--child <child>` option.

**Files likely touched:**
- `src/conductor/src/cli.ts` — dispatch type, detector and commander option
- `src/conductor/test/cli/index.test.ts` — grammar and help tests

**Dependencies:** none

### Task 2: record-reduced-coverage --child records against the child's lap and ledger
**Story:** Story 1 (happy 1, 2, 3, 4)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts`, in a new `describe('build-review record-reduced-coverage --child')` block, for every Done-when check below. Use the real temporary feature tree of `describe('build-review accept --child')`.
2. Verify they fail (RED). Today the dispatcher reads `.pipeline/build-review.json` and the root ledger.
3. Implement in `src/conductor/src/engine/build-review-cli.ts`:
   - add `child?: string` to `BuildReviewRecordReducedCoverageCommand`, and parse it with `parseChildId` after the lap and rationale check;
   - replace both `.pipeline/build-review.json` reads with `readCliBuildReviewAggregate(worktree, child, readFile)`;
   - make the default `readMechanicalFaults` read `readKickbackLedger(root, child)`, and pass the child to the seam.
   Follow `dispatchBuildReviewAccept`'s child handling (search `accept --child`).
4. Verify they pass (GREEN).
5. Commit: "fix(build-review): record-reduced-coverage --child reads the child's aggregate and ledger"

**Done when:**
- [test] With no root aggregate, child 2's aggregate on `lap-child-2` with a testQuality `provider-error` infrastructure failure, and child 2's ledger at `mechanicalFaults` 3, the command that `detectBuildReviewRecordReducedCoverageCommand` returns for the `--child 2` argv, passed to `dispatchBuildReviewRecordReducedCoverage`, prints `build-review record-reduced-coverage: recorded testQuality for lap lap-child-2.` and exits 0. The worktree's `.pipeline/build-review-dispositions.json` then lists exactly one reduced-coverage record for testQuality with reason `provider-error`, and the injected `appendEvent` received `build_review_reduced_coverage_accepted` with `lapId` `lap-child-2`.
- [test] After that record, `resolveEffectiveBuildReviewVerdict(worktree, childTwoAggregate, …)` returns an effective verdict whose `uncoveredInfrastructureFailureRubrics` excludes testQuality and whose `hasRecordedReducedCoverage` is true.
- [test] On that success path, a file-reader spy and a `readMechanicalFaults` spy show reads of `.pipeline/children/2/build-review.json` and of child `2`'s ledger only, and no read of `.pipeline/build-review.json` or the root ledger, even though the root ledger records `mechanicalFaults` 0.
- [test] With child 2's testQuality failure reason `projection-oversized` and no `build_review` entry in child 2's ledger, the `--child 2` command records and prints `build-review record-reduced-coverage: recorded testQuality for lap lap-child-2.`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — child-scoped aggregate and ledger reads in `dispatchBuildReviewRecordReducedCoverage`
- `src/conductor/test/engine/build-review-cli.test.ts` — child-scoped record tests

**Dependencies:** Task 1

### Task 3: Child-scoped lease and precondition refusals
**Story:** Story 1 (negative 1, 2, 3, 4, 5, 6), Story 3 (happy 3)
**Type:** negative-path

**Steps:**
1. Write failing tests in the `record-reduced-coverage --child` block for every Done-when check below.
2. Verify they fail (RED). Today the allowance message carries no count or path, and the lap and child refusals fall into the catch-all.
3. Implement in `dispatchBuildReviewRecordReducedCoverage`:
   - a `requested-lap-not-current` refusal naming the aggregate path;
   - an `invalid-child` refusal, checked before any read;
   - the allowance message with `<n> of 3 consumed in <ledger path>`, through `pipelineRelativePath(worktree, 'kickback-ledger.json', child)`.
   Keep the lap-changed and duplicate refusals as they are.
4. Verify they pass (GREEN).
5. Commit: "fix(build-review): record-reduced-coverage refusals name the child lap and allowance"

**Done when:**
- [test] With child 2's ledger at `mechanicalFaults` 2 and the root ledger at 3, `--child 2` prints exactly `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (2 of 3 consumed in .pipeline/children/2/kickback-ledger.json).`, exits 1, and leaves the disposition-store file bytes unchanged. On a flat feature with the root ledger at 1, the no-child form prints exactly `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (1 of 3 consumed in .pipeline/kickback-ledger.json).` and exits 1.
- [test] `--child 1 --lap lap-child-2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; lap 'lap-child-2' is not the current lap ('lap-child-1') in .pipeline/children/1/build-review.json.`, records reason `requested-lap-not-current`, exits 1, and leaves the disposition-store file bytes unchanged.
- [test] When an injected `createStore` wrapper overwrites child 2's aggregate file with a new lap before delegating to the real store's `appendReducedCoverageIfCurrent`, `--child 2` prints exactly `build-review record-reduced-coverage: refused because the inspected review lap changed.`, exits 1, and leaves the disposition-store file bytes unchanged. A repeated `--child 2` record after a success prints exactly `build-review record-reduced-coverage: refused because reduced coverage is already recorded for 'testQuality'.`, exits 1, and leaves exactly one record.
- [test] `--child x` from an interactive verified operator prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; invalid child id 'x'.`, records reason `invalid-child`, and exits 1, while file-reader and `readMechanicalFaults` spies record no aggregate or ledger read.
- [test] `--child 2` with `isInteractive: false` prints `build-review record-reduced-coverage: requires an interactive terminal and a verified local operator identity.`, records reason `non-interactive-or-unidentified-operator`, and the file-reader and `readMechanicalFaults` spies record no aggregate or ledger read.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — lap, child and allowance refusals
- `src/conductor/test/engine/build-review-cli.test.ts` — child refusal tests

**Dependencies:** Task 2

### Task 4: Aggregate refusals name the path, with the stacked hint
**Story:** Story 3 (happy 1; negative 1, 2, 3, 4)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts` for every Done-when check below.
2. Verify they fail (RED). Today each case prints `the current rubric, lap, or state could not be verified.`.
3. Implement: when `readCliBuildReviewAggregate` fails, refuse with reason `aggregate-unreadable` and the message built from `describeCliAggregateFailure` (path, predicate, trailing detail, stacked hint). Add the optional `listChildAggregates` dep to `BuildReviewRecordReducedCoverageDeps`.
4. Verify they pass (GREEN).
5. Commit: "fix(build-review): record-reduced-coverage names an unreadable aggregate"

**Done when:**
- [test] With child aggregates for children 1 and 2 and no root aggregate, the command without `--child` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1.
- [test] With child 2's aggregate containing `{bad json`, `--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/2/build-review.json is malformed (invalid JSON).`, records reason `aggregate-unreadable`, and exits 1.
- [test] With child 2's aggregate being valid JSON outside the aggregate schema, `--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).` and exits 1.
- [test] With no `.pipeline/children/3/`, `--child 3` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/3/build-review.json is missing.` and exits 1. With no root aggregate and no `.pipeline/children/`, the no-child form prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/build-review.json is missing.` and exits 1. Neither message contains `This feature is stacked`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — aggregate refusal
- `src/conductor/test/engine/build-review-cli.test.ts` — aggregate refusal tests

**Dependencies:** Task 2

### Task 5: Ledger, store and feature refusals name their cause; flat recording is unchanged
**Story:** Story 3 (happy 2; negative 5, 6, 7)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts` for every Done-when check below. Update only the failure-message assertions of the existing flat `record-reduced-coverage` tests that pin the old catch-all text.
2. Verify they fail (RED).
3. Implement in `dispatchBuildReviewRecordReducedCoverage`:
   - an unreadable `build_review` ledger gate sets a ledger refusal inside the lease callback and returns false, with reason `kickback-ledger-unreadable`;
   - a store rejection with no state or ledger refusal refuses with reason `disposition-store-<kind>`, naming `.pipeline/build-review-dispositions.json`;
   - an unresolved feature prints the feature-worktree message.
4. Verify they pass (GREEN).
5. Commit: "fix(build-review): record-reduced-coverage names ledger, store and feature failures"

**Done when:**
- [test] With child 2's ledger listing `build_review` in `unreadableGates`, `--child 2` on child 2's current lap and failed rubric prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/2/kickback-ledger.json gate 'build_review' is unreadable.`, records reason `kickback-ledger-unreadable`, exits 1, and leaves the disposition-store file bytes unchanged.
- [test] With an injected store whose `appendReducedCoverageIfCurrent` returns `{ ok: false, kind: 'invalid', message: 'store rejected' }`, `--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/build-review-dispositions.json rejected the decision (invalid): store rejected.`, records reason `disposition-store-invalid`, and exits 1.
- [test] With feature resolution returning no worktree, `--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; the feature worktree could not be resolved.` and exits 1.
- [test] On a flat feature with a root aggregate on `lap-root` with a testQuality infrastructure failure and the root ledger at `mechanicalFaults` 3, the no-child command prints exactly `build-review record-reduced-coverage: recorded testQuality for lap lap-root.` and exits 0, while file-reader and `readMechanicalFaults` spies record only `.pipeline/build-review.json` and the root ledger (child `undefined`).

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — ledger, store and feature refusals
- `src/conductor/test/engine/build-review-cli.test.ts` — refusal tests; updated flat failure-message assertions

**Dependencies:** Task 3

### Task 6: The exhausted-allowance renderer prints --child for a child
**Story:** Story 2 (happy 3; negative 1, 2)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/conductor-halt.test.ts`, inside `describe('renderExhaustedMechanicalBuildReviewHalt')`, for every Done-when check below.
2. Verify they fail (RED).
3. Implement in `src/conductor/src/engine/build-review-halt-render.ts`: add an optional `child?: ChildId` parameter, and insert ` --child <k>` after `--feature <feature-slug>` in recovery line 1 only when it is supplied.
4. Verify they pass (GREEN).
5. Commit: "feat(build-review): exhausted-allowance halt names the child in its recovery command"

**Done when:**
- [test] `renderExhaustedMechanicalBuildReviewHalt(entry, aggregate, parseChildId(2))` returns line 1 exactly `1. Record a reduced-coverage decision: ai-conductor build-review record-reduced-coverage --feature <feature-slug> --child 2 --lap lap-current --rubric testQuality --rationale "<rationale>".`, with the other three lines unchanged.
- [test] With `parseChildId(3)`, the returned text contains `--child 3` and no other `--child` value.
- [test] The existing `keeps the aggregate-present recovery text byte-for-byte unchanged` test passes unmodified with no child argument, and its output contains no `--child`.
- [test] With child 2 and an aggregate that has no infrastructure-failure result, the renderer returns the `current-lap diagnostic is unavailable` form, which contains neither `record-reduced-coverage` nor `--child`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-halt-render.ts` — optional child parameter
- `src/conductor/test/engine/conductor-halt.test.ts` — renderer tests

**Dependencies:** none

### Task 7: The conductor's child halt prints a command the CLI accepts
**Story:** Story 2 (happy 1, 2)
**Type:** happy-path

**Steps:**
1. Write a failing conductor test in `src/conductor/test/engine/conductor-halt.test.ts` for every Done-when check below.
   - Set active child 2 the way `conductor-kickback-transition.test.ts` does.
   - Write `.pipeline/children/2/kickback-ledger.json` with `build_review` `mechanicalFaults` 3, and `.pipeline/children/2/build-review.json` with lap `lap-child-2` and a testQuality infrastructure failure.
   - Use a `build_review` runner returning `{ success: false, currentLapMechanicalFault: true }`, as `operator-park-boundary.test.ts` does.
2. Verify it fails (RED). Today the HALT command has no `--child`.
3. Implement: pass `this.activeRegionChild` to `renderExhaustedMechanicalBuildReviewHalt` at the exhausted-allowance call site in `src/conductor/src/engine/conductor.ts`.
4. Verify it passes (GREEN).
5. Commit: "fix(conductor): child exhausted-allowance halt passes the active child to its recovery text"

**Done when:**
- [test] The conductor run with active child 2 writes `.pipeline/HALT` containing `ai-conductor build-review record-reduced-coverage --feature <feature-slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<rationale>"` and `3 of 3 shared faults consumed`.
- [test] The command line extracted from that HALT, with `<feature-slug>` replaced by `review-rubrics` and `"<rationale>"` by `risk`, split into argv and passed to `detectBuildReviewRecordReducedCoverageCommand`, returns a command with `child: '2'`, `lapId: 'lap-child-2'` and `rubric: 'testQuality'`.
- [test] The same conductor run on a flat feature with no active child, an exhausted root ledger, and a root aggregate on `lap-current` with a testQuality infrastructure failure, writes `.pipeline/HALT` whose body equals, byte for byte, the pre-change four-line text pinned by the `keeps the aggregate-present recovery text byte-for-byte unchanged` renderer test, followed by the trailing newline, and contains no `--child`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — pass the active child to the renderer
- `src/conductor/test/engine/conductor-halt.test.ts` — conductor child-halt test

**Dependencies:** Tasks 1, 6

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ──┬── Task 3 ── Task 5
         │            └── Task 4
         └──────────────────────────── Task 7
Task 6 ─────────────────────────────── Task 7
```

## Integration Points

- After Task 2, `ai-conductor build-review record-reduced-coverage --feature <slug> --child <k> …`
  reaches `dispatchBuildReviewRecordReducedCoverage` with the child, through
  `detectBuildReviewRecordReducedCoverageCommand` in `src/index.ts`. It records against child k's
  lap and ledger.
- After Task 7, a stacked child's exhausted-allowance HALT prints a command that the CLI detector
  accepts for that child.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a stacked feature with no root aggregate, child 2's aggregate on lap `lap-child-2` whose testQuality result is an infrastructure failure, and an exhausted child 2 ledger, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: recorded testQuality for lap lap-child-2.`, exits 0, the disposition store holds one reduced-coverage record for testQuality with that failure's closed cause, and a `build_review_reduced_coverage_accepted` event carries `lapId` `lap-child-2`. | 2 | "lists exactly one reduced-coverage record for testQuality with reason `provider-error`, and the injected `appendEvent` received `build_review_reduced_coverage_accepted` with `lapId` `lap-child-2`" | diff-local |
| Story 1 happy: Given that record, when the effective `build_review` verdict is resolved over child 2's aggregate, as child 2's next `build_review` pass resolves it, then the testQuality infrastructure failure no longer contributes to the blocking set and the verdict carries `hasRecordedReducedCoverage`. | 2 | "returns an effective verdict whose `uncoveredInfrastructureFailureRubrics` excludes testQuality and whose `hasRecordedReducedCoverage` is true" | diff-local |
| Story 1 happy: Given the root ledger records `build_review` `mechanicalFaults` of 0 and child 2's ledger is exhausted, when the operator records reduced coverage with `--child 2` for child 2's current lap and failed rubric, then the record succeeds, because the allowance is judged on child 2's ledger. | 2 | "no read of `.pipeline/build-review.json` or the root ledger, even though the root ledger records `mechanicalFaults` 0" | diff-local |
| Story 1 happy: Given child 2's testQuality failure has closed cause `projection-oversized` and child 2's ledger records no mechanical faults, when the operator records reduced coverage with `--child 2` for that rubric on child 2's current lap, then the record succeeds, as the same cause does today on a flat feature. | 2 | "With child 2's testQuality failure reason `projection-oversized` and no `build_review` entry in child 2's ledger, the `--child 2` command records and prints `build-review record-reduced-coverage: recorded testQuality for lap lap-child-2.`" | diff-local |
| Story 1 happy: Given the argument vector `build-review record-reduced-coverage --feature <slug> --child 2 --lap <lap> --rubric <rubric> --rationale <text>`, when the CLI detects the command, then it dispatches a record-reduced-coverage command carrying child `2`, and `build-review record-reduced-coverage --help` lists a `--child` option. | 1 | "returns `{ kind: 'record-reduced-coverage', feature: 'review-rubrics', child: '2', lapId: 'lap-current', rubric: 'testQuality', rationale: 'risk' }`" | diff-local |
| Story 1 negative: Given child 2's ledger records `build_review` `mechanicalFaults` of 2 and the root ledger is exhausted, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (2 of 3 consumed in .pipeline/children/2/kickback-ledger.json).`, exits 1, and the disposition store is unchanged. | 3 | "prints exactly `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (2 of 3 consumed in .pipeline/children/2/kickback-ledger.json).`, exits 1, and leaves the disposition-store file bytes unchanged" | diff-local |
| Story 1 negative: Given child 1's aggregate is on lap `lap-child-1` and child 2's aggregate is on lap `lap-child-2`, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 1 --lap lap-child-2 --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; lap 'lap-child-2' is not the current lap ('lap-child-1') in .pipeline/children/1/build-review.json.`, records reason `requested-lap-not-current`, exits 1, and the disposition store is unchanged. | 3 | "records reason `requested-lap-not-current`, exits 1, and leaves the disposition-store file bytes unchanged" | diff-local |
| Story 1 negative: Given child 2's aggregate is replaced by a new lap after `record-reduced-coverage --child 2` has read it and before the record is written, when the decision is validated under the store lease, then it prints `build-review record-reduced-coverage: refused because the inspected review lap changed.`, exits 1, and the disposition store is unchanged. | 3 | "`--child 2` prints exactly `build-review record-reduced-coverage: refused because the inspected review lap changed.`, exits 1, and leaves the disposition-store file bytes unchanged" | diff-local |
| Story 1 negative: Given `build-review record-reduced-coverage --feature <slug> --child x --lap <lap> --rubric <rubric> --rationale "<why>"`, when it runs, then it prints `build-review record-reduced-coverage: refused for '<slug>'; invalid child id 'x'.`, records reason `invalid-child`, reads no aggregate or ledger, and exits 1. | 3 | "records reason `invalid-child`, and exits 1, while file-reader and `readMechanicalFaults` spies record no aggregate or ledger read" | diff-local |
| Story 1 negative: Given a non-interactive session, when `build-review record-reduced-coverage --feature <slug> --child 2 --lap <lap> --rubric <rubric> --rationale "<why>"` runs, then it refuses with the existing interactive-terminal message and reason `non-interactive-or-unidentified-operator` before reading any aggregate or ledger. | 3 | "records reason `non-interactive-or-unidentified-operator`, and the file-reader and `readMechanicalFaults` spies record no aggregate or ledger read" | diff-local |
| Story 1 negative: Given the disposition store already holds a reduced-coverage record for testQuality with child 2's current closed cause, when the operator records it again with `--child 2`, then it prints `build-review record-reduced-coverage: refused because reduced coverage is already recorded for 'testQuality'.`, exits 1, and the store still holds exactly one such record. | 3 | "A repeated `--child 2` record after a success prints exactly `build-review record-reduced-coverage: refused because reduced coverage is already recorded for 'testQuality'.`, exits 1, and leaves exactly one record" | diff-local |
| Story 1 negative: Given the argument vector places `--child 2` after `--lap`, or repeats `--child`, when the CLI detects `build-review record-reduced-coverage`, then the detector returns no command. | 1 | "returns null when `--child 2` follows `--lap` and when `--child` appears twice" | diff-local |
| Story 2 happy: Given a stacked feature whose active child is 2, child 2's ledger is exhausted, and child 2's aggregate is on lap `lap-child-2` with a testQuality infrastructure failure, when the conductor halts on the exhausted `build_review` mechanical-fault allowance, then the HALT body contains `ai-conductor build-review record-reduced-coverage --feature <feature-slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<rationale>"` and reports `3 of 3 shared faults consumed`. | 7 | "writes `.pipeline/HALT` containing `ai-conductor build-review record-reduced-coverage --feature <feature-slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<rationale>"` and `3 of 3 shared faults consumed`" | diff-local |
| Story 2 happy: Given the recovery command from that HALT with the feature slug and rationale filled in, when the CLI detects it, then it dispatches a record-reduced-coverage command with child `2`, lap `lap-child-2` and rubric `testQuality`. | 7 | "returns a command with `child: '2'`, `lapId: 'lap-child-2'` and `rubric: 'testQuality'`" | diff-local |
| Story 2 happy: Given a flat feature with no active child, an exhausted root ledger, and a root aggregate with an infrastructure failure, when the conductor halts on the exhausted allowance, then the HALT body is byte-identical to the pre-change text, with no `--child` in the command. | 6, 7 | "writes `.pipeline/HALT` whose body equals, byte for byte, the pre-change four-line text pinned by the `keeps the aggregate-present recovery text byte-for-byte unchanged` renderer test, followed by the trailing newline, and contains no `--child`" | diff-local |
| Story 2 negative: Given a stacked feature whose active child is 2 and whose child 2 aggregate has no infrastructure-failure result, when the exhausted-allowance halt is rendered, then it prints the existing `current-lap diagnostic is unavailable` form, which names no recovery command and no `--child`. | 6 | "returns the `current-lap diagnostic is unavailable` form, which contains neither `record-reduced-coverage` nor `--child`" | diff-local |
| Story 2 negative: Given a stacked feature whose active child is 3, when the exhausted-allowance halt is rendered, then the printed command carries `--child 3` and never another child id. | 6 | "With `parseChildId(3)`, the returned text contains `--child 3` and no other `--child` value." | diff-local |
| Story 3 happy: Given a stacked feature with child aggregates for children 1 and 2 and no root aggregate, when the operator runs `build-review record-reduced-coverage --feature <slug> --lap <lap> --rubric testQuality --rationale "<why>"` without `--child`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1. | 4 | "the command without `--child` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1" | diff-local |
| Story 3 happy: Given a flat feature with no `.pipeline/children/`, a root aggregate on lap `lap-root` with a testQuality infrastructure failure, and an exhausted root ledger, when the operator runs `build-review record-reduced-coverage` without `--child` for that lap and rubric, then it prints `build-review record-reduced-coverage: recorded testQuality for lap lap-root.`, exits 0, and the only aggregate and ledger it read are `.pipeline/build-review.json` and `.pipeline/kickback-ledger.json`. | 5 | "the no-child command prints exactly `build-review record-reduced-coverage: recorded testQuality for lap lap-root.` and exits 0, while file-reader and `readMechanicalFaults` spies record only `.pipeline/build-review.json` and the root ledger (child `undefined`)" | diff-local |
| Story 3 happy: Given a flat feature whose root ledger records `build_review` `mechanicalFaults` of 1, when the operator runs `build-review record-reduced-coverage` without `--child` on the current lap and failed rubric, then it prints `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (1 of 3 consumed in .pipeline/kickback-ledger.json).` and exits 1. | 3 | "the no-child form prints exactly `build-review record-reduced-coverage: refused because the mechanical-fault allowance remains (1 of 3 consumed in .pipeline/kickback-ledger.json).` and exits 1" | diff-local |
| Story 3 negative: Given child 2's aggregate contains `{bad json`, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 --lap <lap> --rubric testQuality --rationale "<why>"`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/2/build-review.json is malformed (invalid JSON).`, records reason `aggregate-unreadable`, and exits 1. | 4 | "`--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/2/build-review.json is malformed (invalid JSON).`, records reason `aggregate-unreadable`, and exits 1" | diff-local |
| Story 3 negative: Given child 2's aggregate is valid JSON that does not match the aggregate schema, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 ...`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).` and exits 1. | 4 | "`--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).` and exits 1" | diff-local |
| Story 3 negative: Given a stacked feature with no `.pipeline/children/3/` directory, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 3 ...`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/3/build-review.json is missing.` with no stacked hint, and exits 1. | 4 | "`--child 3` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/3/build-review.json is missing.` and exits 1" | diff-local |
| Story 3 negative: Given a flat feature with no root aggregate and no `.pipeline/children/`, when the operator runs `build-review record-reduced-coverage --feature <slug> ...` without `--child`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/build-review.json is missing.` with no stacked hint, and exits 1. | 4 | "the no-child form prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/build-review.json is missing.` and exits 1. Neither message contains `This feature is stacked`." | diff-local |
| Story 3 negative: Given child 2's ledger has an unreadable `build_review` gate entry, when the operator records reduced coverage with `--child 2` on child 2's current lap and failed rubric, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/children/2/kickback-ledger.json gate 'build_review' is unreadable.`, records reason `kickback-ledger-unreadable`, exits 1, and the disposition store is unchanged. | 5 | "prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/children/2/kickback-ledger.json gate 'build_review' is unreadable.`, records reason `kickback-ledger-unreadable`, exits 1, and leaves the disposition-store file bytes unchanged" | diff-local |
| Story 3 negative: Given the disposition store rejects the write with failure kind `invalid` and message `<message>`, when the operator records reduced coverage with `--child 2`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; .pipeline/build-review-dispositions.json rejected the decision (invalid): <message>.`, records reason `disposition-store-invalid`, and exits 1. | 5 | "prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; .pipeline/build-review-dispositions.json rejected the decision (invalid): store rejected.`, records reason `disposition-store-invalid`, and exits 1" | diff-local |
| Story 3 negative: Given `--feature` names no resolvable feature worktree, when the operator runs `build-review record-reduced-coverage --feature <slug> --child 2 ...`, then it prints `build-review record-reduced-coverage: refused for '<slug>'; the feature worktree could not be resolved.` and exits 1. | 5 | "`--child 2` prints exactly `build-review record-reduced-coverage: refused for 'review-rubrics'; the feature worktree could not be resolved.` and exits 1" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic

### Task rem-prd-audit-R1: Add a conductor-run test in src/conductor/test/conductor-halt.test.ts (Covers: task:7). Drive a Conductor with active region child 2, an exhausted child kickback ledger, and a child build-review.json on lap-child-2 with a testQuality infrastructure failure. Assert that .pipeline/HALT contains `ai-conductor build-review record-reduced-coverage --feature <feature-slug> --child 2 --lap lap-child-2 --rubric testQuality --rationale "<rationale>"` and `3 of 3 shared faults consumed`.
**Gate:** prd-audit
**Rationale:** Verified from the audit evidence: the production wiring already exists. conductor.ts:12055-12087 reads the child ledger and the child build-review.json and passes activeRegionChild to the renderer, and the renderer emits --child. The gap is only that no test runs the conductor. Task 7's first and third doneWhen criteria require that test, so the repair falls inside approved task 7. No architectural or product decision is needed. This is BUILD test work (confidence 95%).
**Criterion:** S2.1
**Parent task:** 7
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-R1 is committed and its targeted tests pass.

### Task rem-prd-audit-R2: Add a flat-feature conductor-run test in the same file (Covers: task:7). Use no active child, an exhausted root ledger, and a root aggregate on lap-current with a testQuality infrastructure failure. Assert the HALT body equals, byte for byte, the four-line text pinned by the `keeps the aggregate-present recovery text byte-for-byte unchanged` renderer test plus a trailing newline, and that it contains no `--child`.
**Gate:** prd-audit
**Rationale:** Verified from the audit evidence: the production wiring already exists. conductor.ts:12055-12087 reads the child ledger and the child build-review.json and passes activeRegionChild to the renderer, and the renderer emits --child. The gap is only that no test runs the conductor. Task 7's first and third doneWhen criteria require that test, so the repair falls inside approved task 7. No architectural or product decision is needed. This is BUILD test work (confidence 95%).
**Criterion:** S2.1
**Parent task:** 7
**Done when:**
- [test] S2.1 is satisfied by this task.
- The repair for task rem-prd-audit-R2 is committed and its targeted tests pass.

### Task rem-prd-audit-R3: Extend the active-child-2 conductor-run test (Covers: task:7). Extract the `ai-conductor build-review record-reduced-coverage` line from the written HALT and drop the sentence-ending period. Replace `<feature-slug>` with `review-rubrics` and `"<rationale>"` with `risk`, split the line into argv, and pass it to detectBuildReviewRecordReducedCoverageCommand. Assert the result has child '2', lapId 'lap-child-2' and rubric 'testQuality'.
**Gate:** prd-audit
**Rationale:** The audit confirms that the rendered argument order matches the strict vector the detector in cli.ts expects. The gap is a missing round-trip test, which task 7's second doneWhen criterion requires. That is BUILD test work inside task 7. When extracting the command line, the test must remove the sentence-ending period after "<rationale>" before substituting `risk`, so the rationale value is exact (confidence 90%).
**Criterion:** S2.2
**Parent task:** 7
**Done when:**
- [test] S2.2 is satisfied by this task.
- The repair for task rem-prd-audit-R3 is committed and its targeted tests pass.
