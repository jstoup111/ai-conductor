# Implementation Plan: Every rendered over-scope criterion can be decided, and a rejected entry names its own recovery

**Date:** 2026-10-31
**Design:** `.docs/decisions/architecture-review-2026-10-31-refusing-a-newly-raised-over-scope-criterion-halts.md` (technical track, no PRD)
**Stories:** `.docs/stories/refusing-a-newly-raised-over-scope-criterion-halts.md` (accepted stories)
**Conflict check:** Clean as of 2026-10-31 (`.docs/conflicts/refusing-a-newly-raised-over-scope-criterion-halts.md`)

## Summary

Make over-scope decision capture choose its scope per entry, so a story-criterion decision is recorded beside offer-backed NC entries and a pending entry is inert in every block. Give every capture defect and every stored-history migration failure its own recovery reason, naming the affected criterion. Eight tasks, one PR.

## Technical Approach

- **Recovery vocabulary first (`src/conductor/src/engine/prd-widening-recovery.ts`).** Add the cleared-block reasons the stories need: `changed-offer-reference`, `missing-rationale`, `duplicate-decision-entry`, `unreadable-decision-block`, `unreadable-decision-entry`, `unknown-criterion` and `offered-set-unavailable`. Each gets an action that tells the operator to fix the named entry in the decision block, or leave it pending, and clear again. None tells them to restore history. Export two total maps typed as `Record<…>`: `PRD_WIDENING_CAPTURE_DEFECT_RECOVERY` over `PrdWideningCaptureDefectKind` and `PRD_WIDENING_MIGRATION_FAILURE_RECOVERY` over the migration failure `reason` union. Export that union from `src/conductor/src/engine/prd-widening-migration.ts` as `PrdWideningMigrationFailureReason`. Because both maps are total `Record`s, an unmapped kind is a compile error, which replaces today's catch-all `malformed-history` fallthrough.
- **Per-entry capture (`src/conductor/src/engine/prd-widening-capture.ts`).** `CapturePrdWideningDecisionsOptions` gains `offeredStoryCriteria`, a closed union `{ kind: 'available'; criteria: ReadonlySet<string> } | { kind: 'unavailable' }`. `PrdWideningCaptureDefect` gains an optional `criterion`, and the kind union gains `unknown-criterion` and `offered-set-unavailable`. For a current-format array, capture handles each `parseEntry` result on its own:
  - `pending` → skip.
  - An entry carrying an offer reference, or whose criterion is an NC ordinal (`isPrdAuditNoOwnerOrdinal`) → the existing `matchesPersistedOffer` loop, unchanged except that defects now carry the criterion.
  - An offerless story-criterion entry → check `offeredStoryCriteria` first (`unavailable` → `offered-set-unavailable`; criterion absent → `unknown-criterion`). Then apply the existing rationale and operator checks, `materializeLegacySource`, `legacyClearReference` provenance and the `sameLegacyAuthority` replay/supersession, exactly as the legacy branch does today.
  The legacy whole-block branch (every entry offerless and decided) applies the same offered-set check per entry. Retired formats still return `unsupported-legacy-clear`. Factor the story-entry capture into one helper that both branches call, so replay and provenance stay identical.
- **Offered set at entry (`src/conductor/src/engine/prd-widening-entry.ts`).** `preparePrdWideningEntry` reads `readPrdAuditVerdict(projectRoot)`. When it is `present`, it derives the set of story criteria (not NC ordinals) graded `OVER_SCOPE` whose typed relation is `outside-visible`, through the existing `prdAuditTypedRouteReport`. Anything else yields `{ kind: 'unavailable' }`. The result is passed to capture. Migration still runs first, unchanged.
- **Conductor halt text (`src/conductor/src/engine/conductor.ts`, `preparePrdWideningBeforeAudit`).**
  - The capture-defect branch groups defects by `PRD_WIDENING_CAPTURE_DEFECT_RECOVERY[kind]` and renders one `renderPrdWideningRecovery(reason, criteria)` line per distinct reason, in first-seen order. Each defect's criterion is used when present, falling back to its `offerEntryId`. Rejection events use the criterion, else the `offerEntryId`, else `prd-audit:entry`, as `sourceId`.
  - The migration-failure branch replaces `reason.includes('unsupported')` with `PRD_WIDENING_MIGRATION_FAILURE_RECOVERY[prepared.migration.reason]`, keeping the two history files as the named records.
- **Local pattern.** The capture tests in `src/conductor/test/engine/prd-widening-capture.test.ts` build stores in a temp project root and call `capturePrdWideningDecisions` with a fenced block string. The conductor tests in `src/conductor/test/engine/conductor-prd-widening-routing.test.ts` write `.pipeline/HALT.cleared` plus a typed `.pipeline/prd-audit.json` and call the private `preparePrdWideningBeforeAudit()` through a cast. Search hints: `preparePrdWideningBeforeAudit`, `persistPrdAuditVerdict`, `capturePrdWideningDecisions(`. Follow those fixture shapes. Allowed variation: new helper builders for mixed blocks.

## Prerequisites

- None. All readers and writers named above exist on main.

## Tasks

### Task 1: Add cleared-block recovery reasons and total recovery maps
**Story:** Story 3, Story 4
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/prd-widening-recovery.test.ts`: for every key of `PRD_WIDENING_CAPTURE_DEFECT_RECOVERY`, the mapped reason is not `malformed-history`. For `PRD_WIDENING_MIGRATION_FAILURE_RECOVERY`, only `corrupt-history` maps to `malformed-history`, `unknown-history-version`/`unsupported-history`/`unsupported-legacy-row` map to `unsupported-history`, `foreign-feature-history` maps to `foreign-feature`, and `unreadable-legacy`/`case-write-failed`/`decision-write-failed` map to `persistence-failed`. Also check that `renderPrdWideningRecovery('changed-offer-reference', ['NC-2'])` names `NC-2` and does not contain "known-good copy".
2. Verify RED.
3. Implement: export `PrdWideningMigrationFailureReason` from `src/conductor/src/engine/prd-widening-migration.ts` (the existing inline union, unchanged). Add the seven reasons and their actions to `src/conductor/src/engine/prd-widening-recovery.ts`, and export the two total `Record` maps. Map `missing-operator` → `missing-operator`, `invalid-decision` → `invalid-decision`, `offer-read-failed` and `write-failed` → `persistence-failed`, and `unsupported-legacy-clear` → `unsupported-history`. Every new kind maps to the reason of the same intent. The new `unknown-criterion` and `offered-set-unavailable` capture kinds are added to `PrdWideningCaptureDefectKind` in this task so the map compiles.
4. Verify GREEN, commit "Add per-kind PRD widening recovery reasons".

**Done when:**
- [test] A recovery test asserts every `PrdWideningCaptureDefectKind` key of `PRD_WIDENING_CAPTURE_DEFECT_RECOVERY` maps to a reason other than `malformed-history`.
- [test] A recovery test asserts `PRD_WIDENING_MIGRATION_FAILURE_RECOVERY` maps only `corrupt-history` to `malformed-history`, unknown-version and unsupported reasons to `unsupported-history`, `foreign-feature-history` to `foreign-feature`, and read/write failures to `persistence-failed`.
- [test] A recovery test asserts `renderPrdWideningRecovery` names the passed criterion and never says "restore the original .pipeline widening history", and its action for `changed-offer-reference` says to correct that entry against the latest halt or leave its decision pending before clearing again, for `missing-rationale` asks for a rationale on that entry, for `duplicate-decision-entry` asks to keep one entry per criterion, and for `unreadable-decision-block` asks to repair the block's JSON before clearing again.
- Both maps are declared as `Record<PrdWideningCaptureDefectKind, PrdWideningRecoveryReason>` and `Record<PrdWideningMigrationFailureReason, PrdWideningRecoveryReason>`, so `tsc` fails if a kind or reason has no entry.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-recovery.ts` — new reasons, actions and the two total maps
- `src/conductor/src/engine/prd-widening-migration.ts` — export the failure reason union
- `src/conductor/src/engine/prd-widening-capture.ts` — add the two new defect kinds and optional `criterion` to the defect type
- `src/conductor/test/engine/prd-widening-recovery.test.ts` — new tests

**Dependencies:** none

### Task 2: Capture an offerless story-criterion decision beside offer-backed NC entries
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing capture tests in `src/conductor/test/engine/prd-widening-capture.test.ts`, using the existing temp-store fixture shape. Fixture A: a persisted `NC-2` offer and a block holding offerless `S3.17` decided `refuse` with a rationale plus `NC-2` decided `accept` with its matching offer reference; assert two captured decisions (`S3.17` refuse by criterion, `NC-2` accept bound to the offer id) and no defects. Fixture B: offerless `S4.2` decided `accept` beside a pending offer-backed `NC-1`; assert one captured `S4.2` accept and no defects. Fixture C: capture fixture A's block twice; assert the decision store holds exactly one `S3.17` and one `NC-2` decision.
2. Verify RED: today fixture A yields a `changed-offer-reference` defect for `S3.17`.
3. Implement in `src/conductor/src/engine/prd-widening-capture.ts`: in the current-format loop, send offerless story-criterion entries (not `isPrdAuditNoOwnerOrdinal`, no `offerEntryId`/`originalCaseId`/`originalSource`) to one new helper. The helper runs the rationale and operator checks, `materializeLegacySource`, `legacyClearReference` provenance and the `sameLegacyAuthority` replay/supersession logic, lifted from the legacy branch, which now calls the same helper. NC and offer-bearing entries keep the `matchesPersistedOffer` path. Follow the existing capture tests' temp-root and fenced-block fixture pattern (search `capturePrdWideningDecisions(` in the test file).
4. Verify GREEN, commit "Capture story-criterion decisions per entry in mixed blocks".

**Done when:**
- [test] A capture test asserts `capturePrdWideningDecisions` on a block with offerless `S3.17` refuse and offer-matched `NC-2` accept returns two captured decisions and zero defects, and `accepted-widenings.json` then holds both.
- [test] A capture test asserts offerless `S4.2` accept beside a pending offer-backed `NC-1` yields exactly one captured decision (`S4.2`, authority accept) and zero defects.
- [test] A capture test asserts capturing the identical decided mixed block a second time leaves exactly one `S3.17` and one `NC-2` decision in `accepted-widenings.json`.
- The story-criterion capture is one helper called from both the per-entry loop and the legacy whole-block branch, so both write the same `legacy-clear` criterion-and-summary provenance.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-capture.ts` — per-entry scope and shared story-entry helper
- `src/conductor/test/engine/prd-widening-capture.test.ts` — mixed-block and replay tests

**Dependencies:** Task 1

### Task 3: A pending entry is inert in every block shape
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing capture tests. A story-only block with `S1.2` refuse plus a rationale and `S1.3` pending, with both offered, records exactly one decision (`S1.2`) and no defect. A story-only block, fully decided and offerless, with every criterion offered records each decision with `legacy-clear` provenance as before. A mixed all-pending block records nothing and reports no defect. A retired single-line `OVER_SCOPE_ACCEPT:` body and a fenced non-array block each return `unsupported-legacy-clear`.
2. Verify RED: today the partial story-only block returns `unsupported-legacy-clear`.
3. Implement: in `capturePrdWideningDecisions`, take the legacy whole-block branch only when `parseLegacyPrdWideningClear` is `supported` and no entry carries an offer reference. Send every other JSON array through the per-entry loop from Task 2 instead of returning `unsupported-legacy-clear`. Keep `unsupported-legacy-clear` for no-array and retired-marker bodies.
4. Verify GREEN, commit "Treat pending entries as inert in every cleared block".

**Done when:**
- [test] A capture test asserts a story-only block with one decided and one pending entry captures exactly the decided entry and returns zero defects, never `unsupported-legacy-clear`.
- [test] A capture test asserts an all-pending block mixing offer-backed NC and offerless story entries captures nothing and returns zero defects.
- [test] A capture test asserts a fully decided offerless story-only block with offered criteria captures each decision with `originalSource.id` equal to `legacyClearReference('source', entry)` and `originalSource.snapshot` equal to the entry's summary, the same provenance the legacy import writes.
- [test] Existing capture tests for the retired single-line marker and a non-array fenced block still assert `unsupported-legacy-clear` with nothing captured.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-capture.ts` — branch selection
- `src/conductor/test/engine/prd-widening-capture.test.ts` — pending and legacy tests

**Dependencies:** Task 4

### Task 4: Accept only story entries the halting verdict offered
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing capture tests. An offerless `S9.9` decided `accept`, with `offeredStoryCriteria` available but not containing `S9.9`, beside a valid offered `S3.17` refuse, captures only `S3.17` and returns one `unknown-criterion` defect with `criterion: 'S9.9'`. The same block in story-only legacy shape gives the same result. With `offeredStoryCriteria` `{ kind: 'unavailable' }`, an offerless `S3.17` refuse captures nothing and returns `offered-set-unavailable` with `criterion: 'S3.17'`.
2. Verify RED.
   Write a failing entry test in `src/conductor/test/engine/prd-widening-entry.test.ts`: with a typed `.pipeline/prd-audit.json` (written by `persistPrdAuditVerdict`) grading `S3.17` outside-visible OVER_SCOPE, `S5.1` outside-harmless OVER_SCOPE and `NC-2` outside-visible, `preparePrdWideningEntry` captures an offerless `S3.17` decision but reports `unknown-criterion` for an offerless `S5.1`. With no verdict file, or a non-JSON one, it reports `offered-set-unavailable` for `S3.17`.
3. Implement: add `offeredStoryCriteria` (`{ kind: 'available'; criteria: ReadonlySet<string> } | { kind: 'unavailable' }`) to `CapturePrdWideningDecisionsOptions` and run the check at the top of the story-entry helper from Task 2. In `src/conductor/src/engine/prd-widening-entry.ts`, `preparePrdWideningEntry` reads `readPrdAuditVerdict(input.projectRoot)` and derives the set through `prdAuditTypedRouteReport`: OVER_SCOPE findings that are not `isPrdAuditNoOwnerOrdinal` with relation `outside-visible`. Any non-`present` read yields `{ kind: 'unavailable' }`. Update existing capture tests to pass an available set naming their story criteria.
4. Verify GREEN, commit "Accept only offered story criteria in cleared blocks".

**Done when:**
- [test] A capture test asserts an offerless `S9.9` absent from an available offered set yields an `unknown-criterion` defect naming `S9.9`, no `S9.9` decision, and a captured sibling `S3.17` decision, for both mixed and story-only blocks.
- [test] A capture test asserts an unavailable offered set yields an `offered-set-unavailable` defect naming `S3.17` and no decision for `S3.17`.
- [test] An entry test asserts `preparePrdWideningEntry` derives the offered set from the persisted typed verdict: an offerless `S3.17` graded outside-visible OVER_SCOPE is captured, an offerless `S5.1` graded outside-harmless yields `unknown-criterion`, and a missing verdict and a non-JSON (unreadable) verdict each yield `offered-set-unavailable`.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-capture.ts` — offered-set option and check
- `src/conductor/src/engine/prd-widening-entry.ts` — read verdict, derive and pass the offered set
- `src/conductor/test/engine/prd-widening-capture.test.ts` — negative tests and offered-set fixtures
- `src/conductor/test/engine/prd-widening-entry.test.ts` — offered-set derivation test

**Dependencies:** Task 2

### Task 5: Name the criterion on every per-entry capture defect
**Story:** Story 1, Story 3
**Type:** negative-path

**Steps:**
1. Write failing capture tests, each on a mixed block with a valid sibling.
   - Offerless `S3.17` with an empty rationale yields `missing-rationale` with `criterion: 'S3.17'`, and `NC-2` is still captured.
   - An `NC-2` entry whose offer reference was removed yields `changed-offer-reference` with `criterion: 'NC-2'`, and offerless `S3.17` is still captured.
   - Two entries with the same `offerEntryId` yield `duplicate-offer-entry` naming that entry's criterion.
   - A non-object array element yields `malformed-entry`, and readable siblings are still captured.
   - With `operator` undefined, every decided entry yields `missing-operator` with its criterion and nothing is captured.
2. Verify RED: the defects carry no `criterion` today, and `S3.17` is rejected.
3. Implement: set `criterion` from the parsed entry on every defect the per-entry loop and the story helper push. Only `malformed-entry`, `malformed-block` and `offer-read-failed` stay without one.
4. Verify GREEN, commit "Name the criterion on PRD widening capture defects".

**Done when:**
- [test] A capture test asserts an empty-rationale offerless `S3.17` yields `{ kind: 'missing-rationale', criterion: 'S3.17' }` while the offer-matched `NC-2` decision is captured.
- [test] A capture test asserts an `NC-2` entry stripped of its offer reference yields `{ kind: 'changed-offer-reference', criterion: 'NC-2' }` while offerless `S3.17` is captured.
- [test] A capture test asserts a duplicated offer entry yields `duplicate-offer-entry` carrying its criterion, and a non-object element yields `malformed-entry` with its readable siblings still captured.
- [test] A capture test asserts an undefined operator yields a `missing-operator` defect naming each decided entry's criterion (including `S3.17`) and zero captured decisions.

**Files likely touched:**
- `src/conductor/src/engine/prd-widening-capture.ts` — criterion on defects
- `src/conductor/test/engine/prd-widening-capture.test.ts` — defect naming tests

**Dependencies:** Task 4

### Task 6: Prove the #3548 reproduction through PRD-audit entry
**Story:** Story 1, Story 2
**Type:** happy-path

**Steps:**
1. Write conductor tests in `src/conductor/test/engine/conductor-prd-widening-routing.test.ts`, following its existing pattern: write `.pipeline/HALT.cleared` and a typed `.pipeline/prd-audit.json` with `persistPrdAuditVerdict`, then call `preparePrdWideningBeforeAudit()` through the cast.
   - (a) The #3548 reproduction. The verdict grades `S3.17` and `NC-2` outside-visible OVER_SCOPE, a persisted `NC-2` offer exists, and the cleared block has `S3.17` refuse and `NC-2` accept.
   - (b) The verdict grades `S4.2` outside-visible OVER_SCOPE; the block holds `S4.2` accept beside a pending offer-backed `NC-1`.
   - (c) A story-only block with `S1.2` decided and `S1.3` pending, both offered.
2. These exercise the production entry point over Tasks 2–4; no production change is expected. If one fails, fix the owning task's code.

**Done when:**
- [test] A conductor test asserts `preparePrdWideningBeforeAudit` on the #3548 mixed block returns `undefined`, appends one `imported` `prd_widening_reconciled` event each for `S3.17` and `NC-2`, and `routeTypedPrdAuditOverScope` over that verdict and the stored decisions classifies `S3.17` refused and `NC-2` accepted.
- [test] A conductor test asserts an offerless `S4.2` accept beside a pending offer-backed `NC-1` returns `undefined` and `routeTypedPrdAuditOverScope` no longer reports `S4.2` as blocking.
- [test] A conductor test asserts a story-only block with `S1.2` decided and `S1.3` pending returns `undefined`, records exactly one decision (for `S1.2`), and the next `routeTypedPrdAuditOverScope` halt block offers `S1.3` with `decision: "pending"`.

**Files likely touched:**
- `src/conductor/test/engine/conductor-prd-widening-routing.test.ts` — entry-level reproduction tests

**Verify-only:** yes

**Dependencies:** Tasks 3, 4

### Task 8: Render one named recovery per capture defect reason at PRD-audit entry
**Story:** Story 1, Story 2, Story 3
**Type:** negative-path

**Steps:**
1. Write failing conductor tests calling `preparePrdWideningBeforeAudit()` with a typed verdict grading the criteria used.
   - A table-driven test over cleared blocks: a `changed-offer-reference` `NC-2`, a `missing-rationale` `S3.17`, a duplicated offer entry, an unparsable fenced block, a non-object array element, an offerless `S9.9` the verdict never graded (with the offered sibling `S3.17` recorded), an offerless `S3.17` with no verdict file, an offerless `S3.17` with a non-JSON verdict file, a retired single-line `OVER_SCOPE_ACCEPT:` marker, and a fenced block that is not a JSON array. Each returned halt names its own reason, names its criterion where readable, and carries that reason's action. None contains `malformed-history`, `known-good copy` or `no specific record`; the retired marker names `unsupported-history`.
   - Mixed-block sibling cases: empty-rationale `S3.17` → the halt names `S3.17`/`missing-rationale` and `NC-2` is recorded; a stripped `NC-2` offer reference → the halt names `NC-2`/`changed-offer-reference` and `S3.17` is recorded.
   - No resolvable machine owner (stub `resolveDaemonOwner` unresolved, as existing tests do): the halt names `S3.17` with `missing-operator` and nothing is recorded.
   - Two defect kinds (changed-offer-reference `NC-2`, missing-rationale `S3.17`): two recovery lines, each naming its reason and criterion, with rejection events whose `sourceId` values are `NC-2` and `S3.17`.
2. Verify RED: today these halt `malformed-history` with "affected no specific record".
3. Implement in `src/conductor/src/engine/conductor.ts`, in the capture-defect branch of `preparePrdWideningBeforeAudit`: map each defect through `PRD_WIDENING_CAPTURE_DEFECT_RECOVERY`, join one `renderPrdWideningRecovery(reason, records)` line per distinct reason in first-seen order (records = each defect's criterion, else its `offerEntryId`), and emit each rejection with `sourceId` = criterion, else `offerEntryId`, else `prd-audit:entry`.
4. Verify GREEN, commit "Name capture recovery per reason at PRD-audit entry".

**Done when:**
- [test] A table-driven conductor test asserts that for a changed-offer-reference `NC-2`, a missing-rationale `S3.17`, a duplicated offer entry (`duplicate-decision-entry`), an unparsable block (`unreadable-decision-block`), a non-object element (`unreadable-decision-entry`), an unoffered `S9.9`, and an `S3.17` with an absent or non-JSON verdict file, `preparePrdWideningBeforeAudit` returns that kind's own reason, its criterion where readable, and its action text, never `malformed-history`, `known-good copy` or `no specific record`, and each rejection `prd_widening_reconciled` event's `sourceId` is the entry's criterion where readable.
- [test] A conductor test asserts the retired single-line `OVER_SCOPE_ACCEPT:` marker and a fenced block that is not a JSON array each return an `unsupported-history` recovery and record nothing, the unoffered-`S9.9` case still records the sibling `S3.17` decision, and both the absent-verdict and the non-JSON-verdict cases name `S3.17` with an action that says to leave the entry pending so the next audit offers it again, and record nothing.
- [test] A conductor test asserts that in the mixed block an empty-rationale `S3.17` halt names `S3.17` and `missing-rationale`, records no `S3.17` decision, and records `NC-2`, and a stripped-offer `NC-2` halt names `NC-2` and `changed-offer-reference`, records no `NC-2` decision, and records `S3.17`.
- [test] A conductor test asserts an unresolved machine owner returns a `missing-operator` recovery naming `S3.17`, records no decision for any entry, and emits its rejection event with `sourceId` `S3.17`.
- [test] A conductor test asserts a changed-offer-reference `NC-2` plus a missing-rationale `S3.17` returns two recovery lines naming each reason with its criterion, and the rejection `prd_widening_reconciled` events carry `sourceId` `NC-2` and `S3.17`.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — capture-defect branch mapping, rendering and event source ids
- `src/conductor/test/engine/conductor-prd-widening-routing.test.ts` — entry-level recovery tests

**Dependencies:** Tasks 1, 3, 4, 5

### Task 7: Map stored-history migration failures exhaustively at PRD-audit entry
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing conductor tests calling `preparePrdWideningBeforeAudit()`.
   - Non-JSON `.pipeline/accepted-widenings.json` plus a valid decided cleared entry: the halt reports `malformed-history`, names `.pipeline/accepted-widenings.json` and `.pipeline/remediation-cases.json`, and no decision is appended.
   - An `accepted-widenings.json` with an unknown version: the halt reports `unsupported-history` and the file bytes are unchanged.
   - An `accepted-widenings.json` whose feature identity names another feature: the halt reports `foreign-feature` and the file bytes are unchanged.
   - A migration write failure injected through the existing store-failure seam used in `src/conductor/test/engine/prd-widening-migration.test.ts` (search `decision-write-failed`): the halt reports `persistence-failed`.
   - Well-formed history with one rejected entry and one valid offer-matched `NC-2` entry: the valid decision is the only change to `accepted-widenings.json`, and `remediation-cases.json` is byte-identical.
2. Verify RED: today the unknown-version and foreign-feature cases halt `malformed-history`.
3. Implement: in the migration-failure branch of `preparePrdWideningBeforeAudit` in `src/conductor/src/engine/conductor.ts`, replace `reason.includes('unsupported')` with `PRD_WIDENING_MIGRATION_FAILURE_RECOVERY[prepared.migration.reason]`.
4. Verify GREEN, commit "Map widening migration failures to their own recovery".

**Done when:**
- [test] A conductor test asserts non-JSON `accepted-widenings.json` makes `preparePrdWideningBeforeAudit` return a `malformed-history` recovery naming both history files and append no decision.
- [test] A conductor test asserts an unknown-version `accepted-widenings.json` returns an `unsupported-history` recovery, not `malformed-history`, and leaves the file byte-identical.
- [test] A conductor test asserts a foreign-feature `accepted-widenings.json` returns a `foreign-feature` recovery, not `malformed-history`, and leaves the file byte-identical.
- [test] A conductor test asserts that when the migration's decision or case write fails, `preparePrdWideningBeforeAudit` returns a `persistence-failed` recovery, not `malformed-history`.
- [test] A conductor test asserts well-formed history plus one rejected entry and one valid offer-matched `NC-2` entry records the valid decision, changes `accepted-widenings.json` only by that append, and leaves `remediation-cases.json` byte-identical.

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — migration-failure branch mapping
- `src/conductor/test/engine/conductor-prd-widening-routing.test.ts` — stored-history tests

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ─┬─> Task 2 ──> Task 4 ─┬─> Task 3 ─┬─> Task 6
        │                      │           └─> Task 8
        │                      └─> Task 5 ─────> Task 8
        └─> Task 7
```

## Integration Points

- After Task 6: the #3548 reproduction runs through PRD-audit entry (`preparePrdWideningBeforeAudit`) end to end.
- After Task 8: every cleared-block defect reaches the operator as its own named recovery.
- After Task 7: every stored-history failure reason reaches its own recovery through the same entry.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D1 | task | task-2 | returns two captured decisions and zero defects, and `accepted-widenings.json` then holds both |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D2 | no-change | none | No storage envelope, domain union or migration format changes; capture writes the existing `prd_widening` case and v2 decision records through the existing `RemediationCaseStore` and `AcceptedWideningDecisionStore`. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D3 | task | task-2, task-4, task-5, task-8 | yields an `unknown-criterion` defect naming `S9.9`, no `S9.9` decision, and a captured sibling `S3.17` decision |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D4 | task | task-3 | never `unsupported-legacy-clear` |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D5 | no-change | none | NC semantic reconciliation (`coordinatePrdWidening`, `buildPrdWideningContext`) is untouched; offerless capture applies only to story criteria, which D5 already handles mechanically. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D6 | no-change | none | No provider schema, native-output seam or skill contract changes. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D7 | no-change | none | No reconciliation bounds or retry allowances change; the validation-group retry count is operator-confirmed out of scope. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D8 | no-change | none | Classification (`classifyPrdWideningProjection`) and freshness are unchanged; captured story decisions are classified by the existing criterion-keyed branch. |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D9 | task | task-7, task-8 | returns two recovery lines naming each reason with its criterion |
| adr-2026-09-07-durable-prd-widening-decision-reconciliation#D10 | no-change | none | D10 bounds the #2429 delivery: this feature changes no build_review suppression or recurrence behavior, adds no NC confidence floor, plan-task append or cross-gate equivalence, and its only amendments are the #3548 D3/D4 notes landed with this spec. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions
