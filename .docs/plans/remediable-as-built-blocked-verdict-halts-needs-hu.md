# Implementation Plan: Remediable as-built BLOCKED halts name their cause

**Date:** 2026-09-05
**Stories:** .docs/stories/remediable-as-built-blocked-verdict-halts-needs-hu.md
**Conflict check:** Not required (Tier S)

## Summary

Make every as-built BLOCKED halt say whether it is a human decision or a repair that did not
route, and why. Seven tasks across `artifacts.ts`, `conductor.ts`, and their tests; no routing,
budget, halt-class, or config change.

## Technical Approach

- **Planner no-plan cause.** `readRemediationPlan` returns `null` for five distinct conditions
  (file absent, file stale against session start, unparseable JSON, `dispositions` not an array,
  and a well-formed `dispositions` array yielding no routable disposition — empty, non-object
  entries, `halt` entries without a category, or `existing-task` entries with blank task ids)
  and its `prd_audit` callers rely on that `null` to fall back to deterministic routing, so the
  `none` kind must survive. Add an exported `readRemediationPlanResult` that returns either the
  plan or a `{ plan: null, cause }` with a closed `RemediationPlanAbsenceCause` union of those five
  values; remove the now caller-less `readRemediationPlan` export entirely and migrate every remaining caller and test to `readRemediationPlanResult` (as-built AB-1: the wrapper is a materially changed exported primitive with no production consumer). `planRemediation`
  then returns `{ kind: 'none', reason }` where `reason` is rendered from the cause. The `none`
  result type gains a required `reason`, so no caller can receive a reason-less no-plan result.
- **Gate reason by class.** `AsBuiltReviewOutcome`'s `blocked-design` member gains
  `designFindings: { id; clause }[]` (additive; `blocked-remediable` unchanged). The
  `architecture_review_as_built` completion gate renders two strings: the design reason names each
  DESIGN id with its clause and says a human decision is needed; the remediable reason says every
  blocking finding is REMEDIABLE and the verdict is a repair, not a decision.
- **Group halt cause + listing.** The validation-group as-built halt already appends the
  `Blocking findings:` block (`renderAsBuiltBlockedFindingDetail`) for `blocked-design`/`invalid`.
  Extend it to `blocked-remediable` and prefix a cause clause chosen from exactly three sources:
  remediation disabled by config, non-daemon run, or the planner's no-plan `reason`. The listing is
  rendered once by the group site only; the gate reason never embeds the listing, which is what
  keeps the block from appearing twice.
- **Serial site.** The serial as-built path already halts with the gate reason plus the listing;
  it only needs to thread the planner's no-plan `reason` into that halt when `planRemediation`
  answered `none`. Nothing else there changes.
- **Test pattern.** Gate tests live in the as-built verdict unit suite and drive
  `checkStepCompletion` with an inline report string; group/serial halt tests live in the engine
  conductor unit suite and build a `Conductor` with `daemon: true`, an
  `architecture_review_as_built.remediation` config, and a fake step runner that writes (or omits)
  `.pipeline/remediation.json` — search for `remediation: { enabled: true }` and `writeAsBuilt` for
  comparable fixtures. Variation allowed: any fixture shape that reaches the same halt text.

## Prerequisites

- None.

## Tasks

### Task 1: Planner no-plan result carries a closed cause
**Story:** Story 1 — happy path (absent, unparseable, non-array) and negative path (stale)
**Type:** infrastructure

**Steps:**
1. Write failing tests: `readRemediationPlanResult` returns `{ plan: null, cause: 'absent' }` with no file, `'stale'` when the file's mtime predates `sessionStartedAt`, `'unparseable'` on invalid JSON, `'non-array-dispositions'` when `dispositions` is an object, `'no-routable-dispositions'` when `dispositions` is a well-formed array yielding no routable disposition (empty array, non-object entries, `halt` entries without a category, `existing-task` entries with blank task ids); and returns `{ plan }` for a valid fresh file.
2. Verify tests fail (RED).
3. Implement: add `RemediationPlanAbsenceCause` and `readRemediationPlanResult` beside `readRemediationPlan`; reimplement `readRemediationPlan` as `(await readRemediationPlanResult(...)).plan`.
4. Verify tests pass (GREEN); former `readRemediationPlan` tests are migrated to `readRemediationPlanResult` and pass.
5. Commit: "feat(remediate): expose the cause when no remediation plan is readable".

**Done when:**
- `readRemediationPlanResult` is exported and a unit test asserts each of the five causes `absent`, `stale`, `unparseable`, `non-array-dispositions`, `no-routable-dispositions` from the matching fixture.
- `readRemediationPlan` is no longer exported; every former caller and test uses `readRemediationPlanResult`, and a tree-wide grep for `readRemediationPlan(` outside `readRemediationPlanResult` finds nothing.
- `RemediationPlanAbsenceCause` is a string-literal union of exactly those five values.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — new cause type, `readRemediationPlanResult`, wrapper removal
- `src/conductor/test/engine/remediation-plan-absence.test.ts` — cause tests

**Dependencies:** none

### Task 2: `planRemediation` no-plan result names its reason
**Story:** Story 1 — Done When "no caller can receive a bare reason-less no-plan result"
**Type:** infrastructure

**Steps:**
1. Write failing test: with a fake step runner that writes nothing, `planRemediation` (via a daemon `Conductor` whose as-built gate is blocked-remediable) yields a halt/hint text containing "the planner wrote no remediation plan"; with a stale file, text containing "stale".
2. Verify it fails (RED) — today the result is a bare `{ kind: 'none' }`.
3. Implement: `planRemediation` calls `readRemediationPlanResult`; on `plan: null` returns `{ kind: 'none', reason: renderRemediationPlanAbsence(cause) }` where the renderer maps `absent` → "the planner wrote no remediation plan", `stale` → "the planner's remediation plan is stale (predates this session)", `unparseable` → "the planner's remediation plan is not valid JSON", `non-array-dispositions` → "the planner's remediation plan has no dispositions array", `no-routable-dispositions` → "the planner's remediation plan contains no routable dispositions". Make `reason` required on the `none` member of the return type so TypeScript rejects a bare `none`.
4. Verify tests pass (GREEN); `npx tsc --noEmit` in `src/conductor` passes.
5. Commit: "feat(remediate): planRemediation names why no plan was read".

**Done when:**
- The `none` member of `planRemediation`'s return type has a required `reason: string`, and `npx tsc --noEmit` passes.
- A unit test asserts the five rendered reason strings above from the five causes.
- The `prd_audit` callers that fall back on `none` are unchanged in behavior, proven by the existing prd-audit kickback tests passing without edits.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `planRemediation` no-plan branch and return type
- `src/conductor/src/engine/artifacts.ts` — `renderRemediationPlanAbsence`
- `src/conductor/test/engine/remediation-plan-absence.test.ts` — renderer tests

**Dependencies:** Task 1

### Task 3: Gate reason distinguishes DESIGN from REMEDIABLE
**Story:** Story 2 — happy paths (all-DESIGN, all-REMEDIABLE)
**Type:** happy-path

**Steps:**
1. Write failing tests in the as-built verdict suite: a BLOCKED report with one DESIGN finding `ARCH-1` yields a gate reason containing "needs a human decision" and "ARCH-1 (adr-2026-08-25-example decision 3)"; a BLOCKED report with two REMEDIABLE findings yields a reason containing "every blocking finding is REMEDIABLE" and "a repair, not a decision", and not "human decision". Update the existing test that pins the collapsed string to the new design wording.
2. Verify tests fail (RED).
3. Implement: extend `blocked-design` with `designFindings: { id: string; clause: string }[]` populated from `parseAsBuiltBlockedFindings`; in the gate return `as-built review verdict is BLOCKED and needs a human decision — DESIGN finding(s): <id (clause)[, ...]>` for design and `as-built review verdict is BLOCKED and every blocking finding is REMEDIABLE — a repair, not a decision` for remediable. Keep `routeClass: 'named-route'` on both.
4. Verify tests pass (GREEN).
5. Commit: "feat(as-built): gate reason names DESIGN findings and distinguishes repairs".

**Done when:**
- The gate returns two different `reason` strings for `blocked-design` and `blocked-remediable`, asserted by two unit tests, and neither string contains "shipped code violates an approved architecture decision".
- The design reason contains every DESIGN finding id and its governing clause from the fixture.
- The existing test that pinned the collapsed reason is updated in place, not deleted, and passes.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `AsBuiltReviewOutcome`, `classifyAsBuiltReviewOutcome`, gate branch
- `src/conductor/test/as-built-verdict.test.ts` — reason tests

**Dependencies:** none

### Task 4: Gate reason on mixed and unparseable reports
**Story:** Story 2 — negative paths (mixed DESIGN/REMEDIABLE, unparseable table)
**Type:** negative-path

**Steps:**
1. Write failing tests: a BLOCKED report with `AB-1` DESIGN plus `AB-2` and `AB-3` REMEDIABLE yields a design reason naming `AB-1` and not naming `AB-2` or `AB-3`; a BLOCKED report whose findings table has a malformed header yields the existing `as-built BLOCKED findings block is unparseable` reason with neither "human decision" nor "a repair" present.
2. Verify tests fail (RED) if the mixed case lists all ids; otherwise confirm they pass and record that in the commit body.
3. Implement: filter `designFindings` to class DESIGN only.
4. Verify tests pass (GREEN).
5. Commit: "test(as-built): mixed and unparseable BLOCKED reports keep the right reason".

**Done when:**
- A unit test asserts the mixed-report reason contains `AB-1` and does not contain `AB-2` or `AB-3`.
- A unit test asserts the unparseable-report reason is unchanged from the current invalid-findings wording and contains neither "human decision" nor "a repair".

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — DESIGN-only filter if needed
- `src/conductor/test/as-built-verdict.test.ts` — negative tests

**Dependencies:** Task 3

### Task 5: Validation-group halt appends cause and listing for a remediable verdict
**Story:** Story 3 — happy paths (remediation disabled, non-daemon); Story 1 — happy path through the group site
**Type:** happy-path

**Steps:**
1. Write failing tests in the engine conductor suite: (a) daemon `Conductor`, `architecture_review_as_built.remediation.enabled: false`, all-REMEDIABLE BLOCKED report in the validation group → halt text contains "remediation is disabled", "Blocking findings:", and `AB-1 (REMEDIABLE;` and `AB-2 (REMEDIABLE;`; (b) non-daemon `Conductor`, same report → halt text contains "remediation runs only in daemon mode" and the listing; (c) daemon, remediation enabled, fake `remediate` runner writes no file → halt text contains "the planner wrote no remediation plan", the listing, and not "shipped code violates an approved architecture decision".
2. Verify tests fail (RED).
3. Implement at the validation-group as-built halt: compute `remediationCause` as `'remediation is disabled by architecture_review_as_built.remediation.enabled'` when the kill switch is off, `'remediation runs only in daemon mode'` when `!this.daemon`, or the `planRemediation` `none` reason captured from the route above; when `asBuiltOutcome.kind === 'blocked-remediable'` render `${gateReason} — remediation did not route: ${remediationCause}` followed by `renderAsBuiltBlockedFindingDetail(asBuiltReport)`. Keep the halt class `needs-human` and the existing refusal stamping.
4. Verify tests pass (GREEN).
5. Commit: "feat(as-built): group halt names why a remediable verdict did not route".

**Done when:**
- Three unit tests (disabled, non-daemon, planner-no-file) each assert the halt text contains its cause phrase and the `Blocking findings:` block with both finding ids and class REMEDIABLE.
- The planner-no-file test asserts the halt text does not contain "shipped code violates an approved architecture decision".
- The halt marker class in all three tests is `needs-human`, and the `step_refused` stamping for the as-built member still occurs.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — validation-group as-built halt site and `none` capture
- `src/conductor/test/engine/conductor.test.ts` — three halt tests

**Dependencies:** Task 2, Task 3

### Task 6: Group halt renders the listing once and leaves invalid reports alone
**Story:** Story 3 — negative paths (DESIGN listing once, invalid report); Story 1 — negative path (stale plan wording)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) daemon `Conductor`, BLOCKED report with a DESIGN finding in the validation group → the substring `Blocking findings:` occurs exactly once in the halt text; (b) report with no `Verdict:` line → halt text equals the existing invalid-verdict wording with no `Blocking findings:` and no "remediation did not route"; (c) daemon, remediation enabled, fake runner writes `.pipeline/remediation.json` with an mtime before session start → halt text contains "stale" and `AB-1 (REMEDIABLE;`.
2. Verify (a) and (b) pass or fail as the current code dictates; (c) fails (RED) until wired.
3. Implement any fix needed so the listing is appended by the group site only once and the invalid path is untouched.
4. Verify tests pass (GREEN).
5. Commit: "test(as-built): group halt lists findings once and keeps invalid-report wording".

**Done when:**
- A unit test asserts `halt.split('Blocking findings:').length - 1 === 1` for a DESIGN-class group halt.
- A unit test asserts the no-verdict-line group halt contains neither `Blocking findings:` nor "remediation did not route".
- A unit test asserts the stale-plan group halt contains "stale" and lists `AB-1` with class REMEDIABLE and its governing clause.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — only if (a)/(b) reveal duplication or leakage
- `src/conductor/test/engine/conductor.test.ts` — three tests

**Dependencies:** Task 5

### Task 7: Serial as-built halt carries the planner no-plan cause
**Story:** Story 1 — negative path (serial site agrees with the group site)
**Type:** negative-path

**Steps:**
1. Write failing test: daemon `Conductor` running the serial `architecture_review_as_built` step (no validation group), all-REMEDIABLE BLOCKED report, fake `remediate` runner writes no file → halt text contains "the planner wrote no remediation plan" and `Blocking findings:` with `AB-1 (REMEDIABLE;`.
2. Verify it fails (RED) — today the serial halt reason is the gate reason alone plus the listing.
3. Implement: when the serial route's `planRemediation` answers `none`, compose the serial halt reason as `${lastError} — remediation did not route: ${none.reason}` before the existing listing append. No other serial-site change.
4. Verify test passes (GREEN); existing serial as-built tests pass.
5. Commit: "feat(as-built): serial halt names the planner no-plan cause".

**Done when:**
- A unit test asserts the serial no-file halt text contains "the planner wrote no remediation plan" and the `Blocking findings:` block.
- The existing serial as-built halt tests pass without edits.
- The serial halt class remains `needs-human` for a remediable verdict and `plan-gap` for an undelivered PLAN_GAP, asserted by the existing tests.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — serial as-built `none` branch
- `src/conductor/test/engine/conductor.test.ts` — serial test

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ─▶ Task 2 ─▶ Task 5 ─▶ Task 6
                 └▶ Task 7
Task 3 ─▶ Task 4
Task 3 ─▶ Task 5
```

## Integration Points

- After Task 5: a daemon validation-group round with a remediable BLOCKED verdict and a missing planner file halts with the cause and listing end to end through `Conductor.run()`.
- After Task 7: the serial as-built step reaches the same cause wording through `Conductor.run()`.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
