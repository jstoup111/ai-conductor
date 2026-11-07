# Implementation Plan: build-review accept and findings refuse every stacked-feature child (#3448)

**Date:** 2026-10-28
**Design:** none (technical track, Small tier; governed by `adr-2026-10-07-per-child-build-region` D4, D9, D10 and `adr-2026-10-20-operator-acceptance-is-durable-case-state` D9)
**Stories:** .docs/stories/build-review-accept-and-findings-refuse-every-stac.md
**Conflict check:** Not required at Small tier

## Summary

On a stacked feature, `build-review findings` and `build-review accept` read only the root
`.pipeline/build-review.json`, but the live gate writes each child's aggregate under
`.pipeline/children/<k>/`. Both commands also hide the cause behind one generic message. This plan
makes `findings --child` read the child's own aggregate and ledger, gives `accept` a `--child`
scope, and makes every refusal name its cause. It has 6 tasks.

## Technical Approach

- **Where the change lives.** The dispatchers change in `src/conductor/src/engine/build-review-cli.ts`.
  The `accept` grammar and help change in `src/conductor/src/cli.ts`. `src/index.ts` already passes
  the detected command object to `dispatchBuildReviewAccept` unchanged.
- **One aggregate reader.** A new module-private helper,
  `readCliBuildReviewAggregate(worktree, child, readFile)`, reads
  `pipelinePathFor(worktree, 'build-review.json', child)` (from `child-context.ts`). It returns
  either the parsed aggregate or a typed failure carrying:
  - `path`: the pipeline-relative path, `.pipeline/build-review.json` or
    `.pipeline/children/<k>/build-review.json`;
  - `cause`: `missing` (the read error's `code` is `ENOENT`), `unreadable` (any other read error;
    detail is the error code or message), or `malformed` (detail `invalid JSON` when `JSON.parse`
    throws, `does not match the build-review aggregate schema` when `parseBuildReviewAggregate`
    returns undefined).
  Both dispatchers use it. In `accept` it serves the first read and the `unchanged()` recheck
  under the lease. When the recheck fails, `unchanged()` returns false, as it does today.
- **Stacked hint.** It is computed only when `--child` is omitted and the cause is `missing`. A
  new optional dep, `listChildAggregates(worktree)`, lists the children that have a build-review
  aggregate. Its default is `listExistingChildren(worktree)` filtered to children whose
  `pipelinePathFor(worktree, 'build-review.json', k)` exists. A non-empty list appends
  ` This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).` to the
  missing message, with the actual ids comma-joined in ascending order. An empty list appends
  nothing.
- **Child-scoped findings reads.** When `child` is defined, `findings` reads:
  - child k's aggregate;
  - child k's kickback ledger, through `readKickbackLedger(worktree, child)`;
  - child k's case store (already the case today);
  - the feature-scoped `BuildReviewDispositionStore(worktree)`, unchanged.
  The ledger seams gain the child: `readKickbackGateEntry(worktree, child?)` and
  `readMechanicalFaults(worktree, child?)`. `resolveEffectiveBuildReviewVerdict` already receives
  `child`. Without `--child`, every read is exactly today's.
- **findings refusals.** The single catch-all becomes typed refusals. Each prints one line and exits 1:
  - invalid child: `build-review findings: invalid child id '<raw>'.` It is checked before feature resolution or any read;
  - aggregate missing: `build-review findings: <path> is missing for '<slug>'.`, followed by the stacked hint if any;
  - aggregate malformed or unreadable: `build-review findings: <path> is malformed for '<slug>' (<detail>).`, or `... could not be read for '<slug>' (<detail>).`;
  - disposition store (`list` or `listReducedCoverage` not ok): `build-review findings: .pipeline/build-review-dispositions.json is <kind> for '<slug>' (<message>).`;
  - ledger gate unreadable (`isUnreadableKickbackGate(ledger, 'build_review')`): `build-review findings: <ledger path> gate 'build_review' is unreadable for '<slug>'.`, where the path is `.pipeline/kickback-ledger.json` or `.pipeline/children/<k>/kickback-ledger.json`;
  - case store: the existing `build-review findings: remediation case store is <reason> for '<slug>'.`, unchanged;
  - anything else (feature identity, config load, the shared resolver, invalid advisories): `build-review findings: current feature state is invalid or unavailable for '<slug>' (<error message>).`
- **accept with `--child`.** `BuildReviewAcceptCommand` gains `child?: string`. The order of
  checks is: feature resolution, the TTY and operator gate, the lap and rationale check, then the
  child id. An invalid id refuses with reason `invalid-child` and the message
  `build-review accept: refused for '<slug>'; invalid child id '<raw>'.`, before any aggregate read.
  The aggregate refusal keeps reason `aggregate-unreadable`. Its message becomes
  `build-review accept: refused for '<slug>'; <path> is missing.` (plus the stacked hint),
  `... <path> is malformed (<detail>).`, or `... <path> could not be read (<detail>).`. Every other
  refusal, its reason and its message, is unchanged. The disposition record, the success line and
  the `build_review_disposition_accepted` event are unchanged and carry no child field.
- **Grammar.** `detectBuildReviewAcceptCommand` accepts exactly
  `--feature <f> [--child <k>] --lap <l> --finding <id> --rationale <r>`, in that order. It uses
  the same `expected`-array pattern as `detectBuildReviewResolveCaseCommand`, and its result
  carries `child` only when present. The commander `accept` subcommand gains
  `.option('--child <child>', 'Stacked child whose current lap is accepted')`. The `findings`
  `--child` help becomes `'Stacked child whose review state is read'`.
- **Pattern to reuse.** For `--child` parsing and refusal wording, follow
  `dispatchBuildReviewResolveCase` and `detectBuildReviewResolveCaseCommand`. For per-precondition
  refusals with stable reasons, follow the existing `refuse(reason, message)` in
  `dispatchBuildReviewAccept`.
- **Tests.** Tests extend `src/conductor/test/engine/build-review-cli.test.ts` and
  `src/conductor/test/cli/index.test.ts`.
  - The current child test injects a `readFile` that ignores its path, which is why this defect
    passed. The new child tests use a real temporary feature tree: `cwd` and `resolveMainRoot` at a
    temporary main root, the worktree at `<root>/.worktrees/review-rubrics`, real aggregate files,
    and the default file reader. Ledgers are written with the existing kickback-ledger writer.
  - Two existing assertions change, because they pin the old generic text: `/invalid or unavailable/`
    for the malformed root aggregate and the malformed disposition store, and
    `'aggregate is missing or malformed'`.
- **Unchanged.** No halt text, no persisted schema, and no event type or field changes.
  `resolve-case` and `record-reduced-coverage` are untouched.

## Prerequisites

- None.

## Tasks

### Task 1: findings --child reads the child's aggregate and ledger
**Story:** Story 1 (happy 1, 2, 3, 4, 5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts`, in a new `describe('build-review findings --child')` block, for every Done-when check below. Use a real temporary feature tree as described in Technical Approach.
2. Verify the tests fail (RED). Today the dispatcher reads `.pipeline/build-review.json` and the root ledger.
3. Implement in `src/conductor/src/engine/build-review-cli.ts`:
   - add `readCliBuildReviewAggregate` and use it in `dispatchBuildReviewFindings` with the parsed child;
   - pass the child to `readKickbackLedger` and to the `readKickbackGateEntry` and `readMechanicalFaults` seams.
4. Verify the tests pass (GREEN).
5. Commit: "fix(build-review): findings --child reads the child's own aggregate and ledger"

**Done when:**
- [test] With child 2's aggregate on lap `lap-child-2` holding unresolved finding F2 and no root aggregate, `dispatchBuildReviewFindings` with `child: '2'` in JSON form exits 0 and reports `lapId` `lap-child-2` with F2 in `unresolvedFindingIds`.
- [test] With a root aggregate on `lap-root` beside child 2's aggregate, findings `--child 2` JSON reports `lapId` `lap-child-2`, contains none of the root aggregate's finding ids, and a spy on the file reader shows `.pipeline/build-review.json` is never read.
- [test] With a case-store seam returning case C2 for child 2 and case C0 for no child, the human output of findings `--child 2` lists C2 and does not list C0.
- [test] With child 2's ledger recording a `build_review` `lastMechanicalFault` on lap `lap-child-2` and the root ledger recording none, findings `--child 2` JSON carries that `lastMechanicalFault`.
- [test] With the disposition store holding an acceptance of F2, findings `--child 2` JSON lists F2 in `acceptedFindingIds` and in `acceptedDispositions` and not in `unresolvedFindingIds`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — aggregate reader; child-scoped aggregate and ledger reads in `dispatchBuildReviewFindings`
- `src/conductor/test/engine/build-review-cli.test.ts` — child-scoped findings tests

**Dependencies:** none

### Task 2: findings names a missing or malformed aggregate, with the stacked hint
**Story:** Story 3 (happy 1; negative 1, 3), Story 1 (negative 1, 2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts` for every Done-when check below. Use the real temporary feature tree from Task 1.
2. Verify the tests fail (RED). Today each case prints the generic message.
3. Implement in `dispatchBuildReviewFindings`:
   - validate the child id first, with the invalid-child message;
   - map the aggregate reader's failure to the missing, malformed and could-not-be-read messages from Technical Approach;
   - add the `listChildAggregates` dep with its default, and append the stacked hint only when `--child` is omitted and the cause is `missing`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(build-review): findings names the missing or malformed aggregate"

**Done when:**
- [test] With child aggregates for children 1 and 2 and no root aggregate, findings without `--child` prints exactly `build-review findings: .pipeline/build-review.json is missing for 'review-rubrics'. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).` and exits 1.
- [test] With no root aggregate and no `.pipeline/children/`, findings without `--child` prints exactly `build-review findings: .pipeline/build-review.json is missing for 'review-rubrics'.` and exits 1; with no `.pipeline/children/3/`, findings `--child 3` prints exactly `build-review findings: .pipeline/children/3/build-review.json is missing for 'review-rubrics'.` and exits 1.
- [test] With child 2's aggregate containing `{bad json`, findings `--child 2` prints exactly `build-review findings: .pipeline/children/2/build-review.json is malformed for 'review-rubrics' (invalid JSON).` and exits 1.
- [test] Findings with `child: '0'` and with `child: 'x'` print exactly `build-review findings: invalid child id '0'.` and `build-review findings: invalid child id 'x'.`, exit 1, and a file-reader spy records no read of any `build-review.json`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — findings aggregate refusals and the stacked hint
- `src/conductor/test/engine/build-review-cli.test.ts` — findings aggregate-refusal tests

**Dependencies:** Task 1

### Task 3: findings names store and ledger failures, and keeps flat output identical
**Story:** Story 3 (happy 3; negative 4, 5, 6)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts` for every Done-when check below. Update the two existing `/invalid or unavailable/` assertions in `describe('build-review findings CLI')` to the new exact messages.
2. Verify the tests fail (RED).
3. Implement the disposition-store, ledger-gate and fallback refusals from Technical Approach in `dispatchBuildReviewFindings`. Keep the case-store message unchanged.
4. Verify the tests pass (GREEN).
5. Commit: "fix(build-review): findings names the failing store or ledger"

**Done when:**
- [test] With a disposition-store seam whose `list` returns `{ ok: false, kind: 'unreadable', message: 'store is corrupt' }`, findings `--child 2` prints exactly `build-review findings: .pipeline/build-review-dispositions.json is unreadable for 'review-rubrics' (store is corrupt).` and exits 1.
- [test] With child 2's ledger holding an unreadable `build_review` gate entry, findings `--child 2` prints exactly `build-review findings: .pipeline/children/2/kickback-ledger.json gate 'build_review' is unreadable for 'review-rubrics'.` and exits 1.
- [test] With a `loadConfig` seam returning `{ ok: false }` with error message `config is broken`, findings `--child 2` prints exactly `build-review findings: current feature state is invalid or unavailable for 'review-rubrics' (config is broken).` and exits 1.
- [test] A flat-feature fixture with a valid root aggregate and no `.pipeline/children/` prints human and JSON output equal to strings captured from the pre-change dispatcher, and the existing read-list test still records `.pipeline/build-review.json` as the only aggregate read.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — findings store, ledger and fallback refusals
- `src/conductor/test/engine/build-review-cli.test.ts` — refusal tests and updated generic-message assertions

**Dependencies:** Task 2

### Task 4: accept --child accepts a finding on the child's current lap
**Story:** Story 2 (happy 1, 2; negative 1, 2, 3, 4, 5)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts`, in a new `describe('build-review accept --child')` block, for every Done-when check below. Use the real temporary feature tree and a real `BuildReviewDispositionStore` rooted at the worktree.
2. Verify the tests fail (RED).
3. Implement in `dispatchBuildReviewAccept`:
   - add `child?: string` to `BuildReviewAcceptCommand`;
   - validate it after the lap and rationale check with reason `invalid-child`;
   - read the first aggregate and the `unchanged()` recheck through `readCliBuildReviewAggregate(worktree, child, readFile)`;
   - keep the disposition store feature-scoped.
4. Verify the tests pass (GREEN).
5. Commit: "feat(build-review): accept --child accepts a stacked child's finding"

**Done when:**
- [test] An interactive verified `accept` with `child: '2'`, lap `lap-child-2` and finding F2 prints `build-review accept: accepted <F2> for lap lap-child-2.`, exits 0, and the worktree's `.pipeline/build-review-dispositions.json` lists exactly one record for F2 with `sourceLapId` `lap-child-2`; a following findings `--child 2` JSON lists F2 in `acceptedFindingIds` and not in `unresolvedFindingIds`, and child 2's aggregate file bytes equal their pre-accept bytes.
- [test] With child 1 on `lap-child-1` without F2 and child 2 on `lap-child-2`, `accept --child 1 --lap lap-child-2` refuses with a message containing `lap 'lap-child-2' is not the current lap ('lap-child-1')`, and `accept --child 1 --lap lap-child-1 --finding <F2>` refuses with a message containing `'<F2>' is not a current judged finding on lap 'lap-child-1'`; each exits 1 and leaves the disposition-store file bytes unchanged.
- [test] When a file-reader seam returns a different-lap child 2 aggregate on the `unchanged()` recheck under the lease, `accept --child 2` refuses with a message containing `the disposition store rejected the acceptance`, exits 1, and leaves the disposition-store file bytes unchanged.
- [test] An interactive verified `accept` with `child: 'x'` prints exactly `build-review accept: refused for 'review-rubrics'; invalid child id 'x'.`, records a `build_review_disposition_refused` event with reason `invalid-child`, exits 1, leaves the disposition-store file bytes unchanged, and a file-reader spy records no read of any `build-review.json`.
- [test] A non-interactive `accept` with `child: '2'` prints `build-review accept: requires an interactive terminal and a verified local operator identity.`, records reason `non-interactive-or-unidentified-operator`, leaves the disposition-store file bytes unchanged, and a file-reader spy records no read of any `build-review.json`.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — `BuildReviewAcceptCommand.child`; child-scoped reads in `dispatchBuildReviewAccept`
- `src/conductor/test/engine/build-review-cli.test.ts` — child-scoped accept tests

**Dependencies:** Task 1

### Task 5: The accept grammar and help carry --child
**Story:** Story 2 (happy 3; negative 6)
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/cli/index.test.ts`, beside the existing accept grammar test, for every Done-when check below.
2. Verify the tests fail (RED).
3. Implement in `src/conductor/src/cli.ts`:
   - add `child?: string` to `BuildReviewAcceptDispatch`;
   - make `detectBuildReviewAcceptCommand` follow the `detectBuildReviewResolveCaseCommand` expected-array pattern with an optional `--child` after `--feature`;
   - add the `--child <child>` option to the commander `accept` subcommand and update the `findings` `--child` description.
4. Verify the tests pass (GREEN).
5. Commit: "feat(cli): build-review accept accepts --child"

**Done when:**
- [test] `detectBuildReviewAcceptCommand` on `build-review accept --feature review-rubrics --child 2 --lap lap-current --finding sha256:abc --rationale known-risk` returns `{ kind: 'accept', feature: 'review-rubrics', child: '2', lapId: 'lap-current', findingId: 'sha256:abc', rationale: 'known-risk' }`, and the existing childless vector still returns an object with no `child` key.
- [test] `detectBuildReviewAcceptCommand` returns null when `--child 2` follows `--lap` and when `--child` appears twice.
- [test] The rendered help of the `build-review accept` subcommand from `createProgram()` (its `helpInformation()` text, which is what `build-review accept --help` prints) lists `--child <child>`.

**Files likely touched:**
- `src/conductor/src/cli.ts` — accept dispatch type, detector and commander option
- `src/conductor/test/cli/index.test.ts` — accept grammar and help tests

**Dependencies:** Task 4

### Task 6: accept names a missing or malformed aggregate, and flat accept is unchanged
**Story:** Story 3 (happy 2, 4; negative 2)
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-cli.test.ts` for every Done-when check below. Update the existing `'aggregate is missing or malformed'` assertion in `names the failed check in the refusal and in its event reason` to the new malformed message.
2. Verify the tests fail (RED).
3. Implement the accept aggregate messages from Technical Approach. Reuse Task 2's stacked hint and `listChildAggregates` dep. Keep reason `aggregate-unreadable`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(build-review): accept names the missing or malformed aggregate"

**Done when:**
- [test] With child aggregates for children 1 and 2 and no root aggregate, an interactive verified `accept` without `child` prints exactly `build-review accept: refused for 'review-rubrics'; .pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1.
- [test] With child 2's aggregate holding valid JSON that `parseBuildReviewAggregate` rejects, an interactive verified `accept --child 2` prints exactly `build-review accept: refused for 'review-rubrics'; .pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).`, records reason `aggregate-unreadable`, and exits 1.
- [test] The existing flat accept test through the real disposition store still prints `build-review accept: accepted <id> for lap lap-current.` and exits 0 with no `child` in the command, and its file reader receives only `.pipeline/build-review.json` as an aggregate path.

**Files likely touched:**
- `src/conductor/src/engine/build-review-cli.ts` — accept aggregate refusal messages
- `src/conductor/test/engine/build-review-cli.test.ts` — accept aggregate-refusal tests and the updated existing assertion

**Dependencies:** Task 2, Task 4

## Task Dependency Graph

```
Task 1 ──┬── Task 2 ──┬── Task 3
         │            └── Task 6
         └── Task 4 ──┬── Task 5
                      └── Task 6
```

## Integration Points

- After Task 1, `ai-conductor build-review findings --feature <slug> --child <k>` reports child k's
  real review state through `dispatchBuildReviewFindings`.
- After Task 5, `ai-conductor build-review accept --feature <slug> --child <k> …` reaches
  `dispatchBuildReviewAccept` with the child, through `detectBuildReviewAcceptCommand` in
  `src/index.ts`.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a stacked feature whose child 2's aggregate has lap `lap-child-2` with one unresolved testQuality finding F2, and no root aggregate, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then it exits 0 and the JSON reports `lapId` `lap-child-2` and lists F2 in `unresolvedFindingIds`. | 1 | "in JSON form exits 0 and reports `lapId` `lap-child-2` with F2 in `unresolvedFindingIds`" | diff-local |
| Story 1 happy: Given a stacked feature with both a root aggregate on lap `lap-root` and child 2's aggregate on lap `lap-child-2`, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then the JSON reports `lapId` `lap-child-2` and none of the root aggregate's finding ids. | 1 | "findings `--child 2` JSON reports `lapId` `lap-child-2`, contains none of the root aggregate's finding ids" | diff-local |
| Story 1 happy: Given child 2's case store holds case C2 and the root case store holds case C0, when the operator runs `build-review findings --feature <slug> --child 2`, then the output lists C2 and does not list C0. | 1 | "the human output of findings `--child 2` lists C2 and does not list C0" | diff-local |
| Story 1 happy: Given child 2's ledger records a `build_review` `lastMechanicalFault` on lap `lap-child-2` and the root ledger records none, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then the JSON carries that `lastMechanicalFault`. | 1 | "findings `--child 2` JSON carries that `lastMechanicalFault`" | diff-local |
| Story 1 happy: Given the disposition store holds an acceptance of child 2's finding F2, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then F2 is listed in `acceptedFindingIds` and in `acceptedDispositions` and is absent from `unresolvedFindingIds`. | 1 | "findings `--child 2` JSON lists F2 in `acceptedFindingIds` and in `acceptedDispositions` and not in `unresolvedFindingIds`" | diff-local |
| Story 1 negative: Given a stacked feature with no `.pipeline/children/3/` directory, when the operator runs `build-review findings --feature <slug> --child 3`, then it prints `build-review findings: .pipeline/children/3/build-review.json is missing for '<slug>'.` and exits 1. | 2 | "findings `--child 3` prints exactly `build-review findings: .pipeline/children/3/build-review.json is missing for 'review-rubrics'.` and exits 1" | diff-local |
| Story 1 negative: Given `build-review findings --feature <slug> --child 0` or `--child x`, when it runs, then it prints `build-review findings: invalid child id '0'.` (or `'x'`), exits 1, and reads no aggregate. | 2 | "print exactly `build-review findings: invalid child id '0'.` and `build-review findings: invalid child id 'x'.`, exit 1, and a file-reader spy records no read of any `build-review.json`" | diff-local |
| Story 2 happy: Given an interactive verified operator and child 2's aggregate on lap `lap-child-2` with unresolved finding F2, when the operator runs `build-review accept --feature <slug> --child 2 --lap lap-child-2 --finding <F2> --rationale "<why>"`, then it prints `build-review accept: accepted <F2> for lap lap-child-2.`, exits 0, and the disposition store holds one record for F2 with `sourceLapId` `lap-child-2`. | 4 | "prints `build-review accept: accepted <F2> for lap lap-child-2.`, exits 0, and the worktree's `.pipeline/build-review-dispositions.json` lists exactly one record for F2 with `sourceLapId` `lap-child-2`" | diff-local |
| Story 2 happy: Given that acceptance, when the operator runs `build-review findings --feature <slug> --child 2 --json`, then F2 is listed in `acceptedFindingIds` and absent from `unresolvedFindingIds`, and child 2's aggregate bytes are unchanged by the acceptance. | 4 | "a following findings `--child 2` JSON lists F2 in `acceptedFindingIds` and not in `unresolvedFindingIds`, and child 2's aggregate file bytes equal their pre-accept bytes" | diff-local |
| Story 2 happy: Given the argument vector `build-review accept --feature <slug> --child 2 --lap <lap> --finding <id> --rationale <text>`, when the CLI detects the command, then it dispatches an accept command carrying child `2`, and `build-review accept --help` lists a `--child` option. | 5 | "returns `{ kind: 'accept', feature: 'review-rubrics', child: '2', lapId: 'lap-current', findingId: 'sha256:abc', rationale: 'known-risk' }`" | diff-local |
| Story 2 negative: Given child 2's aggregate is on lap `lap-child-2` and child 1's aggregate is on lap `lap-child-1`, when the operator runs `build-review accept --feature <slug> --child 1 --lap lap-child-2 --finding <F2> --rationale "<why>"`, then it refuses with `lap 'lap-child-2' is not the current lap ('lap-child-1')`, exits 1, and the disposition store is unchanged. | 4 | "`accept --child 1 --lap lap-child-2` refuses with a message containing `lap 'lap-child-2' is not the current lap ('lap-child-1')`" | diff-local |
| Story 2 negative: Given child 1's aggregate does not contain F2, when the operator runs `build-review accept --feature <slug> --child 1 --lap lap-child-1 --finding <F2> --rationale "<why>"`, then it refuses with `'<F2>' is not a current judged finding on lap 'lap-child-1'`, exits 1, and the disposition store is unchanged. | 4 | "`accept --child 1 --lap lap-child-1 --finding <F2>` refuses with a message containing `'<F2>' is not a current judged finding on lap 'lap-child-1'`; each exits 1 and leaves the disposition-store file bytes unchanged" | diff-local |
| Story 2 negative: Given child 2's aggregate is replaced by a new lap after `accept --child 2` has read it and before the disposition is written, when the acceptance is validated under the store lease, then it refuses through the disposition store rejection, exits 1, and the disposition store is unchanged. | 4 | "`accept --child 2` refuses with a message containing `the disposition store rejected the acceptance`, exits 1, and leaves the disposition-store file bytes unchanged" | diff-local |
| Story 2 negative: Given `build-review accept --feature <slug> --child x --lap <lap> --finding <id> --rationale "<why>"` from an interactive verified operator, when it runs, then it refuses with `invalid child id 'x'`, records a `build_review_disposition_refused` event with reason `invalid-child`, reads no aggregate, and exits 1. | 4 | "prints exactly `build-review accept: refused for 'review-rubrics'; invalid child id 'x'.`, records a `build_review_disposition_refused` event with reason `invalid-child`, exits 1, leaves the disposition-store file bytes unchanged, and a file-reader spy records no read of any `build-review.json`" | diff-local |
| Story 2 negative: Given a non-interactive session, when `build-review accept --feature <slug> --child 2 --lap <lap> --finding <id> --rationale "<why>"` runs, then it refuses with the existing interactive-terminal message and reason `non-interactive-or-unidentified-operator` before reading any aggregate. | 4 | "prints `build-review accept: requires an interactive terminal and a verified local operator identity.`, records reason `non-interactive-or-unidentified-operator`, leaves the disposition-store file bytes unchanged, and a file-reader spy records no read of any `build-review.json`" | diff-local |
| Story 2 negative: Given the argument vector places `--child 2` after `--lap`, or repeats `--child`, when the CLI detects `build-review accept`, then the detector returns no accept command. | 5 | "`detectBuildReviewAcceptCommand` returns null when `--child 2` follows `--lap` and when `--child` appears twice" | diff-local |
| Story 3 happy: Given a stacked feature with child aggregates for children 1 and 2 and no root aggregate, when the operator runs `build-review findings --feature <slug>` without `--child`, then it prints `build-review findings: .pipeline/build-review.json is missing for '<slug>'. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).` and exits 1. | 2 | "findings without `--child` prints exactly `build-review findings: .pipeline/build-review.json is missing for 'review-rubrics'. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).` and exits 1" | diff-local |
| Story 3 happy: Given the same stacked feature, when an interactive verified operator runs `build-review accept --feature <slug> --lap <lap> --finding <id> --rationale "<why>"` without `--child`, then it refuses with `.pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1. | 6 | "prints exactly `build-review accept: refused for 'review-rubrics'; .pipeline/build-review.json is missing. This feature is stacked; pass --child <k> (children with a build-review aggregate: 1, 2).`, records reason `aggregate-unreadable`, and exits 1" | diff-local |
| Story 3 happy: Given a flat feature with a valid root aggregate and no `.pipeline/children/`, when the operator runs `build-review findings --feature <slug>` in human and in JSON form, then the output is identical to the pre-change output and the only aggregate read is `.pipeline/build-review.json`. | 3 | "prints human and JSON output equal to strings captured from the pre-change dispatcher, and the existing read-list test still records `.pipeline/build-review.json` as the only aggregate read" | diff-local |
| Story 3 happy: Given a flat feature with a valid root aggregate, when an interactive verified operator runs `build-review accept` without `--child` on a current unresolved finding, then it accepts exactly as before and prints `build-review accept: accepted <id> for lap <lap>.`. | 6 | "still prints `build-review accept: accepted <id> for lap lap-current.` and exits 0 with no `child` in the command" | diff-local |
| Story 3 negative: Given child 2's aggregate contains `{bad json`, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints `build-review findings: .pipeline/children/2/build-review.json is malformed for '<slug>' (invalid JSON).` and exits 1. | 2 | "findings `--child 2` prints exactly `build-review findings: .pipeline/children/2/build-review.json is malformed for 'review-rubrics' (invalid JSON).` and exits 1" | diff-local |
| Story 3 negative: Given child 2's aggregate is valid JSON that does not match the aggregate schema, when the operator runs `build-review accept --feature <slug> --child 2 --lap <lap> --finding <id> --rationale "<why>"` interactively, then it refuses with `.pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).`, records reason `aggregate-unreadable`, and exits 1. | 6 | "prints exactly `build-review accept: refused for 'review-rubrics'; .pipeline/children/2/build-review.json is malformed (does not match the build-review aggregate schema).`, records reason `aggregate-unreadable`, and exits 1" | diff-local |
| Story 3 negative: Given a flat feature with no root aggregate and no `.pipeline/children/`, when the operator runs `build-review findings --feature <slug>`, then it prints `build-review findings: .pipeline/build-review.json is missing for '<slug>'.` with no stacked hint and exits 1. | 2 | "With no root aggregate and no `.pipeline/children/`, findings without `--child` prints exactly `build-review findings: .pipeline/build-review.json is missing for 'review-rubrics'.` and exits 1" | diff-local |
| Story 3 negative: Given the disposition store is unreadable, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints a message naming `.pipeline/build-review-dispositions.json` and the store's failure kind, and exits 1. | 3 | "findings `--child 2` prints exactly `build-review findings: .pipeline/build-review-dispositions.json is unreadable for 'review-rubrics' (store is corrupt).` and exits 1" | diff-local |
| Story 3 negative: Given child 2's ledger has an unreadable `build_review` gate entry, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints a message naming `.pipeline/children/2/kickback-ledger.json` and gate `build_review` as unreadable, and exits 1. | 3 | "findings `--child 2` prints exactly `build-review findings: .pipeline/children/2/kickback-ledger.json gate 'build_review' is unreadable for 'review-rubrics'.` and exits 1" | diff-local |
| Story 3 negative: Given the project config fails to load with error message `config is broken`, when the operator runs `build-review findings --feature <slug> --child 2`, then it prints `build-review findings: current feature state is invalid or unavailable for '<slug>' (config is broken).` and exits 1. | 3 | "findings `--child 2` prints exactly `build-review findings: current feature state is invalid or unavailable for 'review-rubrics' (config is broken).` and exits 1" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
