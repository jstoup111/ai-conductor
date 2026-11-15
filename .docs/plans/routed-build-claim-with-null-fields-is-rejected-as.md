# Implementation Plan: Routed build claims say why they are malformed, and an operator-input request wins over the claim

**Date:** 2026-11-15
**Design:** none (technical track, Tier S — see `.docs/track/routed-build-claim-with-null-fields-is-rejected-as.md`)
**Stories:** .docs/stories/routed-build-claim-with-null-fields-is-rejected-as.md
**Conflict check:** Not required (Tier S)

## Summary

A refused routed BUILD claim now carries a field-level reason into its failed-attempt detail and
`step_retry` reason, and a builder's `.pipeline/halt-user-input-required` marker takes precedence
over its routed claim so the request reaches the existing halt-marker stall handling (#3643). Four
tasks.

## Technical Approach

- **Verified current shape (main at `5d2f96421a`).**
  - `parseBuilderClaim` in `src/conductor/src/engine/routing/prerequisite-claim.ts` returns `{ kind: 'malformed' }` with no detail from eight separate checks. `settleRoutedBuildClaim` maps it to `{ kind: 'failed', detail: 'routed prerequisite claim is malformed' }`.
  - `parseBuilderClaim` has one caller, `settleRoutedBuildClaim`. Its one production caller is the routed BUILD block in `src/conductor/src/engine/conductor.ts` (the `step.name === 'build' && routedPrerequisiteClaim !== undefined` branch). That block turns a `failed` settlement into `result = { ...result, success: false, output: settled.detail }`. The generic failure path then sets `lastError` from `result.output` and emits `step_retry` with `reason: lastError`. The new detail therefore reaches the retry reason with no further wiring.
  - The Codex adapter already normalises strict-schema nulls before any parser sees them. `fromCodexStrictResult` in `src/conductor/src/execution/codex-strict-schema.ts` drops admitted nulls and other branches' properties (#3581, #3589). Applied to the incident payload `{"outcome":"blocked-by-prerequisite","child":null,"paths":[...],"symbols":null}`, it yields `{"outcome":"blocked-by-prerequisite","paths":[...]}`. That claim is genuinely invalid because `child` is required, so outcome 1 needs regression coverage only.
  - The failed-attempt path never reads `.pipeline/halt-user-input-required`. Only the completion-check branch reads it: the `build` completion predicate in `src/conductor/src/engine/artifacts.ts` returns not-done while the marker exists, and the stall breaker (`haltMarkerExists` → `stalled = 'halt_marker'`) emits `build_stall`, writes the marker text to `.pipeline/build-stall-question.md` (`writeStallQuestionEvidence`), clears the marker, and in daemon auto mode dispatches `/remediate` with the question. In the incident, the builder wrote the marker, the malformed claim made the attempt a failure, and the retry builder deleted the marker itself.
- **Parser detail (Story 1).** Change `ParsedBuilderClaim`'s malformed variant to `{ kind: 'malformed'; detail: string }`. Checks run in the existing order and return the first fault, with these exact details:
  - A non-object or array result gives `result is not a JSON object`.
  - `outcome: 'completed'` with any other key gives `completed result carries field <key>; completed allows only outcome`.
  - Any other non-`blocked-by-prerequisite` outcome gives `outcome is not completed or blocked-by-prerequisite`.
  - A key other than `outcome`, `child`, `paths`, `symbols` gives `unknown field <key>`.
  - An absent `child` gives `child is missing; blocked-by-prerequisite requires an integer child from 1 to ${MAX_CHILD_ID}`.
  - A present `child` that `parseChildId` refuses gives `child is not an integer from 1 to ${MAX_CHILD_ID}`.
  - An invalid `paths` gives `paths must be a non-empty list of non-empty strings`, and the same for `symbols`.
  - Neither list present gives `blocked-by-prerequisite names neither paths nor symbols`.
  - `<key>` is the first offending key in `Object.keys` order. It is echoed only when it matches `/^[A-Za-z0-9_.-]{1,64}$/`; otherwise it is rendered as `<unprintable>`. No other builder-supplied value is ever echoed.
  - `settleRoutedBuildClaim` returns `routed prerequisite claim is malformed: ${parsed.detail}`. The accepted-claim set does not change, so the schema-agreement test keeps passing.
- **Marker precedence (Story 2).** In the routed BUILD block of `conductor.ts`, check `haltMarkerExists(this.projectRoot)` before calling `settleRoutedBuildClaim`. When the marker exists, skip settlement entirely and leave `result` untouched, so the attempt continues into the existing completion check and its halt-marker stall handling. No reroute, ref move, or claim-failure accounting happens. When the marker is absent, behaviour is unchanged. The provider schema, the marker contract, and the non-routed BUILD paths do not change.
- **Test patterns.**
  - Parser cases extend `src/conductor/test/engine/routing/prerequisite-claim-schema.test.ts`. Codex-normalised cases extend the `fromCodexStrictResult` block in `src/conductor/test/execution/codex-strict-schema.test.ts`.
  - Settlement cases follow `src/conductor/test/engine/routing/prerequisite-claim.realgit.test.ts`, which settles against a real temporary repository.
  - Conductor cases follow `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts`. Its `subject({ buildResult, maxRetries: 2 })` fixture arms a routed audit round for child 1. Its `claimSeam` mock delegates to the real `settleRoutedBuildClaim` when `claimSeam.detail` is unset and records each call in `claimSeam.calls`. Its operator-park boundary ends the run after the first attempt. The existing "passes every rejected claim through" case shows how to collect `step_retry` events.
  - The halt-marker stall assertions follow the "captures halt marker content to evidence file before clearing the marker" case in `src/conductor/test/engine/conductor-loop-policies.test.ts`, which collects `build_stall` and `halt_cleared` events.
  - Existing assertions that expect a bare `{ kind: 'malformed' }` or the bare `'routed prerequisite claim is malformed'` detail are updated to the new detailed values. They live in `prerequisite-claim-schema.test.ts`, `codex-strict-schema.test.ts`, `prerequisite-claim.realgit.test.ts` and `prerequisite-reroute.realgit.test.ts`.

## Prerequisites

- None.

## Tasks

### Task 1: The claim parser names the field and rule behind every refusal
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/prerequisite-claim-schema.test.ts`. Assert `parseBuilderClaim` returns `{ kind: 'malformed', detail }` with the exact detail for each input:
   - `{ outcome: 'surprise' }` gives `outcome is not completed or blocked-by-prerequisite`.
   - A `blocked-by-prerequisite` claim with symbols `['parseB']` and child `0`, `10`, `2.5` or `'2'` gives `child is not an integer from 1 to 9`.
   - `{ outcome: 'blocked-by-prerequisite', child: 2 }` gives `blocked-by-prerequisite names neither paths nor symbols`.
   - `paths: []` or `paths: ['']` with child 2 gives `paths must be a non-empty list of non-empty strings`, and `symbols: []` or `symbols: ['']` gives the matching `symbols` detail.
   - Child 2 with symbols `['parseB']` and `extra: true` gives `unknown field extra`.
   - `outcome` set to a 5000-character string containing `\n` gives the outcome detail, and the result contains no newline and none of the builder-supplied characters.
   - A key of 70 `x` characters gives `unknown field <unprintable>`.
2. Update the existing bare `{ kind: 'malformed' }` expectations in that file to the detailed values.
3. Verify RED.
4. Implement the detailed malformed variant and the check order described in Technical Approach in `src/conductor/src/engine/routing/prerequisite-claim.ts`.
5. Verify GREEN, including the unchanged schema-agreement test, then commit.

**Done when:**
- [test] `parseBuilderClaim` returns `kind: 'malformed'` with exactly `outcome is not completed or blocked-by-prerequisite` for `surprise`, `child is not an integer from 1 to 9` for each of child `0`, `10`, `2.5` and `"2"`, `blocked-by-prerequisite names neither paths nor symbols` for child 2 with no lists, and `unknown field extra` for the extra-field claim.
- [test] `parseBuilderClaim` returns `kind: 'malformed'` with exactly `paths must be a non-empty list of non-empty strings` for `paths: []` and `paths: [""]` with child 2, and `symbols must be a non-empty list of non-empty strings` for `symbols: []` and `symbols: [""]` with child 2.
- [test] For an `outcome` of 5000 characters containing newlines, the malformed detail is a single line that contains none of the builder-supplied characters, and a 70-character unknown key renders as `unknown field <unprintable>`.
- [test] The existing schema-agreement test still shows `parseBuilderClaim` refuses exactly the claims Ajv-compiled `PREREQUISITE_CLAIM_SCHEMA` refuses.

**Files likely touched:**
- src/conductor/src/engine/routing/prerequisite-claim.ts — detailed malformed variant
- src/conductor/test/engine/routing/prerequisite-claim-schema.test.ts — detail cases

**Dependencies:** none

### Task 2: Codex-normalised claims settle with the field-level detail
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in two places.
   - In `src/conductor/test/execution/codex-strict-schema.test.ts`: `parseBuilderClaim(fromCodexStrictResult(PREREQUISITE_CLAIM_SCHEMA, { outcome: 'blocked-by-prerequisite', child: 2, paths: null, symbols: ['parseB'] }))` deep-equals `parseBuilderClaim({ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'] })`.
   - In `src/conductor/test/engine/routing/prerequisite-claim.realgit.test.ts`, settle two payloads, each read back with `fromCodexStrictResult(PREREQUISITE_CLAIM_SCHEMA, …)`. The incident-shaped `{ outcome: 'blocked-by-prerequisite', child: null, paths: ['src/a.ts'], symbols: null }` resolves to `{ kind: 'failed', detail: 'routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9' }`. `{ outcome: 'completed', child: null, paths: ['a.ts'], symbols: null }` resolves to `{ kind: 'none' }`.
2. Update the existing bare-detail expectations in `prerequisite-claim.realgit.test.ts`, `prerequisite-reroute.realgit.test.ts` and `codex-strict-schema.test.ts` to the detailed values.
3. Verify RED.
4. Implement: `settleRoutedBuildClaim` returns `routed prerequisite claim is malformed: ${parsed.detail}`.
5. Verify GREEN; commit.

**Done when:**
- [test] `settleRoutedBuildClaim` given the Codex-normalised incident payload resolves to `kind: 'failed'` with detail exactly `routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9`.
- [test] `parseBuilderClaim` of the Codex-normalised `{ outcome: 'blocked-by-prerequisite', child: 2, paths: null, symbols: ['parseB'] }` deep-equals its parse of `{ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'] }`, both `kind: 'claim'`.
- [test] `settleRoutedBuildClaim` given the Codex-normalised `{ outcome: 'completed', child: null, paths: ['a.ts'], symbols: null }` resolves to `kind: 'none'`, so claim settlement does not fail the attempt.

**Files likely touched:**
- src/conductor/src/engine/routing/prerequisite-claim.ts — settlement detail
- src/conductor/test/engine/routing/prerequisite-claim.realgit.test.ts — Codex-normalised settlement cases
- src/conductor/test/execution/codex-strict-schema.test.ts — null-equivalence case and detail updates
- src/conductor/test/engine/routing/prerequisite-reroute.realgit.test.ts — detail update

**Dependencies:** Task 1

### Task 3: A routed BUILD retry line carries the malformed detail when no marker is present
**Story:** Story 1, Story 2
**Type:** negative-path

**Steps:**
1. Write a test in `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts`. Use `subject({ buildResult: { outcome: 'blocked-by-prerequisite', paths: ['src/a.ts'] }, maxRetries: 2 })` with `claimSeam.detail` unset, so the real `settleRoutedBuildClaim` runs. No `.pipeline/halt-user-input-required` is written. Collect `step_retry` and `build_stall` events, then run the conductor. This input is the Codex-normalised incident payload that Task 2 establishes.
2. Verify it fails before Tasks 1–2 land (bare detail) and passes after.
3. Commit.

**Done when:**
- [test] With no `.pipeline/halt-user-input-required` marker, the routed BUILD attempt emits a `step_retry` event for step `build`, attempt 2, whose `reason` is exactly `routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9`.
- [test] In the same run, `claimSeam.calls` contains the build result, the build-outcome record has `terminalOutcome: 'failed'` and `reason: 'routed-prerequisite-claim'`, and no `build_stall` event with reason `halt_marker` is emitted.

**Files likely touched:**
- src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts — no-marker retry-reason case

**Dependencies:** Task 2

### Task 4: A builder's halt-user-input marker takes precedence over its routed claim
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts`.
   - Give `subject()` a `verifyArtifacts` option (default `false`, preserving existing cases), so the completion check and stall breaker run.
   - Give it an option for the build stub to write `.pipeline/halt-user-input-required` with `Need user decision: sync the worktree` during the build call.
   - Case A: the build result is the malformed `{ outcome: 'blocked-by-prerequisite', paths: ['src/a.ts'] }`. Case B: the build result is the well-formed `{ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'] }`.
   - Record the repository's `HEAD` sha and `readRepairMarker(root, 'demo')` before the run. Collect `build_stall`, `halt_cleared` and `step_retry` events.
   - Allowed variation: end the run after the stall through the fixture's operator-park boundary or a stubbed `remediate` dispatch, whichever reaches the stall without further builder dispatches. The halt-marker assertions follow the "captures halt marker content to evidence file before clearing the marker" case in `src/conductor/test/engine/conductor-loop-policies.test.ts`.
2. Verify RED: today Case A charges a failed claim and Case B calls settlement.
3. Implement in `src/conductor/src/engine/conductor.ts`. In the routed BUILD block, call `haltMarkerExists(this.projectRoot)` before `settleRoutedBuildClaim`. When it is true, skip settlement and leave `result` unchanged so the attempt reaches the existing completion check and halt-marker stall handling. When it is false, keep today's settlement path unchanged.
4. Verify GREEN, plus Task 3's no-marker case; commit.

**Done when:**
- [test] Case A (marker plus malformed claim, daemon auto mode) emits a `build_stall` event with reason `halt_marker` followed by a `halt_cleared` event for step `build`, leaves `.pipeline/build-stall-question.md` containing `Need user decision: sync the worktree`, and leaves no `.pipeline/halt-user-input-required` file.
- [test] Case A emits no `step_retry` event whose `reason` begins `routed prerequisite claim`, and `claimSeam.calls` is empty.
- [test] Case B (marker plus well-formed claim) leaves `claimSeam.calls` empty, emits a `build_stall` event with reason `halt_marker`, and leaves the repository `HEAD` sha and the `readRepairMarker(root, 'demo')` result deep-equal to their values before the run.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — marker precedence before routed claim settlement
- src/conductor/test/engine/routing/conductor-routed-build-settlement-halt.test.ts — marker-precedence cases and fixture options

**Dependencies:** Task 2

## Integration Points

- After Task 3: the routed BUILD retry line, as emitted by the conductor, names the malformed field.
- After Task 4: a routed builder's operator-input marker reaches the halt-marker stall handling through the conductor entry point.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the Codex payload `{"outcome":"blocked-by-prerequisite","child":null,"paths":["src/a.ts"],"symbols":null}` read back through the Codex adapter and no `.pipeline/halt-user-input-required` marker, when the routed BUILD claim is settled, then the attempt fails with detail `routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9` and that detail is the reason on the attempt's `step_retry` event. | 2, 3 | "With no `.pipeline/halt-user-input-required` marker, the routed BUILD attempt emits a `step_retry` event for step `build`, attempt 2, whose `reason` is exactly `routed prerequisite claim is malformed: child is missing; blocked-by-prerequisite requires an integer child from 1 to 9`." | diff-local |
| Story 1 happy: Given the Codex payload `{"outcome":"blocked-by-prerequisite","child":2,"paths":null,"symbols":["parseB"]}` read back through the Codex adapter, when it is parsed, then it yields the same claim as `{"outcome":"blocked-by-prerequisite","child":2,"symbols":["parseB"]}`. | 2 | "`parseBuilderClaim` of the Codex-normalised `{ outcome: 'blocked-by-prerequisite', child: 2, paths: null, symbols: ['parseB'] }` deep-equals its parse of `{ outcome: 'blocked-by-prerequisite', child: 2, symbols: ['parseB'] }`, both `kind: 'claim'`." | diff-local |
| Story 1 happy: Given the Codex payload `{"outcome":"completed","child":null,"paths":["a.ts"],"symbols":null}` read back through the Codex adapter, when the routed BUILD claim is settled, then it is read as no claim and the attempt is not failed by claim settlement. | 2 | "`settleRoutedBuildClaim` given the Codex-normalised `{ outcome: 'completed', child: null, paths: ['a.ts'], symbols: null }` resolves to `kind: 'none'`, so claim settlement does not fail the attempt." | diff-local |
| Story 1 negative: Given a claim whose `outcome` is `surprise`, when it is parsed, then it is refused as malformed with detail `outcome is not completed or blocked-by-prerequisite`. | 1 | "`parseBuilderClaim` returns `kind: 'malformed'` with exactly `outcome is not completed or blocked-by-prerequisite` for `surprise`" | diff-local |
| Story 1 negative: Given a `blocked-by-prerequisite` claim with symbols `["parseB"]` whose `child` is `0`, `10`, `2.5` or the string `"2"`, when it is parsed, then each is refused as malformed with detail `child is not an integer from 1 to 9`. | 1 | "`child is not an integer from 1 to 9` for each of child `0`, `10`, `2.5` and `"2"`" | diff-local |
| Story 1 negative: Given a `blocked-by-prerequisite` claim with child 2 and both `paths` and `symbols` omitted, when it is parsed, then it is refused as malformed with detail `blocked-by-prerequisite names neither paths nor symbols`. | 1 | "`blocked-by-prerequisite names neither paths nor symbols` for child 2 with no lists" | diff-local |
| Story 1 negative: Given a `blocked-by-prerequisite` claim with child 2 whose `paths` is `[]` or `[""]`, when it is parsed, then it is refused as malformed with detail `paths must be a non-empty list of non-empty strings`, and the same input in `symbols` is refused with the matching `symbols` detail. | 1 | "`parseBuilderClaim` returns `kind: 'malformed'` with exactly `paths must be a non-empty list of non-empty strings` for `paths: []` and `paths: [""]` with child 2, and `symbols must be a non-empty list of non-empty strings` for `symbols: []` and `symbols: [""]` with child 2." | diff-local |
| Story 1 negative: Given a `blocked-by-prerequisite` claim with child 2, symbols `["parseB"]` and an extra field `extra`, when it is parsed, then it is refused as malformed with detail `unknown field extra`. | 1 | "`unknown field extra` for the extra-field claim" | diff-local |
| Story 1 negative: Given a claim whose `outcome` is a 5000-character string containing newlines, when it is parsed, then the malformed detail is a single line that contains none of the builder-supplied characters. | 1 | "For an `outcome` of 5000 characters containing newlines, the malformed detail is a single line that contains none of the builder-supplied characters" | diff-local |
| Story 2 happy: Given a routed BUILD attempt that wrote `.pipeline/halt-user-input-required` containing `Need user decision: sync the worktree` and returned a malformed claim, when the attempt settles in daemon auto mode, then a `build_stall` event with reason `halt_marker` is emitted, `.pipeline/build-stall-question.md` contains `Need user decision: sync the worktree`, the marker is cleared by the conductor, and no `step_retry` event carries a reason beginning `routed prerequisite claim`. | 4 | "Case A (marker plus malformed claim, daemon auto mode) emits a `build_stall` event with reason `halt_marker` followed by a `halt_cleared` event for step `build`, leaves `.pipeline/build-stall-question.md` containing `Need user decision: sync the worktree`, and leaves no `.pipeline/halt-user-input-required` file." | diff-local |
| Story 2 happy: Given a routed BUILD attempt that wrote the same marker and returned a well-formed `blocked-by-prerequisite` claim, when the attempt settles, then the claim is not settled, no reroute happens, the routed host's branch tip and repair marker are unchanged, and a `build_stall` event with reason `halt_marker` is emitted. | 4 | "Case B (marker plus well-formed claim) leaves `claimSeam.calls` empty, emits a `build_stall` event with reason `halt_marker`, and leaves the repository `HEAD` sha and the `readRepairMarker(root, 'demo')` result deep-equal to their values before the run." | diff-local |
| Story 2 negative: Given a routed BUILD attempt that returned a malformed claim and wrote no `.pipeline/halt-user-input-required` marker, when the attempt settles, then it remains an ordinary failed attempt whose `step_retry` reason is the Story 1 malformed detail and no `build_stall` event with reason `halt_marker` is emitted. | 3 | "In the same run, `claimSeam.calls` contains the build result, the build-outcome record has `terminalOutcome: 'failed'` and `reason: 'routed-prerequisite-claim'`, and no `build_stall` event with reason `halt_marker` is emitted." | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
