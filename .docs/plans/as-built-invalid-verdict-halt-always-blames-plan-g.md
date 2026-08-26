# Implementation Plan: as-built invalid-verdict halt diagnostics

**Date:** 2026-08-26

**Stories:** .docs/stories/as-built-invalid-verdict-halt-always-blames-plan-g.md

## Summary

Give `classifyAsBuiltReviewOutcome`'s `invalid` arm a typed `cause` and render a distinct
operator-facing halt reason per cause at the single `checkStepCompletion` message site.
5 tasks.

## Technical Approach

- Add a lower-level parser `readAsBuiltVerdictLine(content)` in
  `src/conductor/src/engine/artifacts.ts` returning
  `{ found: false } | { found: true; raw: string; recognized: string | null }` —
  `raw` is the cleaned upper-cased value read off the `Verdict:` line, `recognized` is the
  canonical value when `raw` is one of `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`,
  `BLOCKED`, else null. The existing `parseAsBuiltVerdict(content): string | null` becomes a
  thin wrapper (`found && recognized` → recognized, else null), so its two other callers
  (`artifacts.ts:923`, and any external use) keep their exact contract.
- Widen the union: `{ kind: 'invalid'; cause: 'no-verdict-line' } |
  { kind: 'invalid'; cause: 'unrecognized-verdict'; value: string } |
  { kind: 'invalid'; cause: 'plan-gap-missing-outcome' } |
  { kind: 'invalid'; cause: 'unparseable-blocked-findings'; detail: string }`.
  `classifyAsBuiltReviewOutcome` switches to `readAsBuiltVerdictLine` and returns the
  matching cause on each of its existing invalid exits; all non-invalid kinds unchanged.
- Add `renderAsBuiltInvalidReason(outcome)` (exported for tests) producing the per-cause
  operator message; `checkStepCompletion`'s `outcome.kind === 'invalid'` branch
  (currently the fixed PLAN_GAP-flavored string near `artifacts.ts:3288`) calls it.
  The `plan-gap-missing-outcome` message keeps the current wording's substance
  (PLAN_GAP must record `Outcome delivered: yes|no`; re-run the as-built review).
- Conductor consumers (`conductor.ts:6948`, `conductor.ts:10463`) branch on `kind` only;
  the widened arm is source-compatible there — no edits.
- Tests live in `src/conductor/test/as-built-verdict.test.ts` alongside the existing
  classifier coverage; follow that file's existing fixture style (inline markdown report
  strings per case).

## Prerequisites

None — single-module change plus its test file.

## Tasks

### Task 1: readAsBuiltVerdictLine parser split
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/as-built-verdict.test.ts`: heading-style `## Verdict` + `**BLOCKED**` body → `{ found: false }`; empty content → `{ found: false }`; `Verdict: REJECTED` → `{ found: true, raw: 'REJECTED', recognized: null }`; `**Verdict:** approved with drift notes` → `recognized: 'APPROVED WITH DRIFT NOTES'`.
2. Verify tests fail (RED).
3. Implement `readAsBuiltVerdictLine` in `src/conductor/src/engine/artifacts.ts` by hoisting the existing regex + cleanup out of `parseAsBuiltVerdict`; rewrite `parseAsBuiltVerdict` as the wrapper returning `recognized` (null when not found or unrecognized). A matched line whose cleaned value is empty returns `{ found: false }` (a blank value is no verdict).
4. Verify tests pass (GREEN); run the whole `as-built-verdict.test.ts` file to confirm existing `parseAsBuiltVerdict` cases still pass.
5. Commit: "feat(engine): split as-built verdict line reading from recognition".

**Done when:**
- The four new tests above pass.
- Every pre-existing test in `src/conductor/test/as-built-verdict.test.ts` passes unchanged.
- `parseAsBuiltVerdict`'s signature and null-semantics are byte-identical for its caller at `artifacts.ts:923`.

**Files:**
- src/conductor/src/engine/artifacts.ts — hoist parser, add readAsBuiltVerdictLine
- src/conductor/test/as-built-verdict.test.ts — parser tests

**Dependencies:** none

### Task 2: Typed cause on the invalid arm
**Story:** 1
**Story:** 2
**Story:** 3
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: heading-style verdict report → `{ kind: 'invalid', cause: 'no-verdict-line' }`; `Verdict: REJECTED` → `{ kind: 'invalid', cause: 'unrecognized-verdict', value: 'REJECTED' }`; `Verdict: PLAN_GAP` with no `Outcome delivered` and with `Outcome delivered: maybe` → `{ kind: 'invalid', cause: 'plan-gap-missing-outcome' }`; `Verdict: BLOCKED` with a malformed findings block → `{ kind: 'invalid', cause: 'unparseable-blocked-findings', detail: <parser error> }`.
2. Verify tests fail (RED).
3. Widen `AsBuiltReviewOutcome`'s invalid arm per Technical Approach and update `classifyAsBuiltReviewOutcome` to use `readAsBuiltVerdictLine` and return the matching cause at each existing invalid exit; carry `findings.error` (the `parseAsBuiltBlockedFindings` failure detail) as `detail`.
4. Verify tests pass (GREEN); run `npx tsc --noEmit` in `src/conductor` to prove the conductor consumers compile unchanged.
5. Commit: "feat(engine): typed cause on as-built invalid outcome".

**Done when:**
- The new classification tests for all four causes pass.
- Tests asserting `approved`, `plan-gap-delivered`, `plan-gap-undelivered`, `blocked-remediable`, `blocked-design` classifications pass unchanged.
- `tsc --noEmit` passes with zero edits under `src/conductor/src/engine/conductor.ts`.

**Files:**
- src/conductor/src/engine/artifacts.ts — union + classifier
- src/conductor/test/as-built-verdict.test.ts — classification tests

**Dependencies:** 1

### Task 3: Per-cause halt reason renderer
**Story:** 1
**Story:** 2
**Story:** 3
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests for exported `renderAsBuiltInvalidReason`: `no-verdict-line` → message states no parseable `Verdict:` line was found and names the expected one-line `Verdict: <value>` form, and contains neither "PLAN_GAP" nor "Outcome delivered"; `unrecognized-verdict` with value `REJECTED` → message contains `REJECTED` and all of `APPROVED`, `APPROVED WITH DRIFT NOTES`, `PLAN_GAP`, `BLOCKED`; `plan-gap-missing-outcome` → message contains "PLAN_GAP", "Outcome delivered: yes|no", and "re-run the as-built review"; `unparseable-blocked-findings` with detail `"missing findings table"` → message names the BLOCKED findings block and contains that detail.
2. Verify tests fail (RED).
3. Implement `renderAsBuiltInvalidReason(outcome)` in `src/conductor/src/engine/artifacts.ts` as an exported function switching exhaustively on `cause` (no default arm — exhaustiveness enforced by the type checker via a `never` check).
4. Verify tests pass (GREEN).
5. Commit: "feat(engine): per-cause as-built invalid halt reasons".

**Done when:**
- The four renderer tests above pass, including the two negative content assertions on `no-verdict-line`.
- The switch has no default arm and compiles with a `never` exhaustiveness check, so a future 5th cause fails the build rather than falling back to a generic string.

**Files:**
- src/conductor/src/engine/artifacts.ts — renderer
- src/conductor/test/as-built-verdict.test.ts — renderer tests

**Dependencies:** 2

### Task 4: Wire renderer into checkStepCompletion
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a failing test driving `checkStepCompletion` (or the narrowest existing test seam covering the `architecture_review_as_built` completion predicate in `src/conductor/test/as-built-verdict.test.ts`'s style) with a fresh heading-style-verdict report on disk, asserting the returned `reason` is the `no-verdict-line` rendering and `routeClass` stays `'absent'`.
2. Verify it fails (RED) — the current code returns the fixed PLAN_GAP-flavored string.
3. Replace the fixed string in the `outcome.kind === 'invalid'` branch (near `artifacts.ts:3288`) with `renderAsBuiltInvalidReason(outcome)`; leave `done: false` and `routeClass: 'absent'` untouched.
4. Verify it passes (GREEN).
5. Commit: "fix(engine): as-built invalid halt names the actual defect (#1911)".

**Done when:**
- The predicate-level test asserts the rendered `no-verdict-line` reason reaches the completion result with `routeClass: 'absent'` unchanged.
- `grep -n "must record \`Verdict:\` plus" src/conductor/src/engine/artifacts.ts` returns no invalid-branch occurrence (the fixed catch-all string is gone from that branch).

**Files:**
- src/conductor/src/engine/artifacts.ts — invalid-branch wiring
- src/conductor/test/as-built-verdict.test.ts — predicate test

**Dependencies:** 3

### Task 5: Recognized-verdict and consumer regression net
**Story:** 3
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write tests (failing only if Tasks 2-4 regressed anything): `Verdict: PLAN_GAP` + `Outcome delivered: yes` → `plan-gap-delivered`; `+ no` → `plan-gap-undelivered`; `Verdict: BLOCKED` + well-formed findings block → `blocked-remediable`/`blocked-design` per finding class; `Verdict:` followed by only `**` markers → invalid with a non-PLAN_GAP-worded reason.
2. Run the full `src/conductor/test/as-built-verdict.test.ts` file and `npx tsc --noEmit`.
3. Commit: "test(engine): as-built outcome regression net for cause split".

**Done when:**
- All listed regression cases pass in one run of `as-built-verdict.test.ts`.
- `tsc --noEmit` passes with `src/conductor/src/engine/conductor.ts` untouched in the feature diff.

**Files:**
- src/conductor/test/as-built-verdict.test.ts — regression tests

**Dependencies:** 4

## Task Dependency Graph

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5
```

## Integration Points

- After Task 4: a real malformed report on disk produces the cause-specific halt reason end-to-end through the completion predicate.

## Verification

- [ ] All happy path criteria covered (Tasks 1-4)
- [ ] All negative path criteria covered (Tasks 1, 3, 5)
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable `Done when:` block
- [ ] Dependencies are explicit and acyclic (strict chain)
