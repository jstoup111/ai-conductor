# Implementation Plan: OVER_SCOPE multi-finding decision block

**Date:** 2026-08-24
**Design:** .docs/decisions/adr-2026-08-24-over-scope-decision-block-and-durable-refusals.md
**Stories:** .docs/stories/over-scope-halt-accepts-one-criterion-per-clear-so.md
**Conflict check:** Clean as of 2026-08-24

## Summary

Replaces the single-candidate `OVER_SCOPE_ACCEPT:` halt marker with a fenced
`over-scope-decisions` JSON array covering every blocking finding, adds durable per-criterion
accept/refuse decisions, and fixes blocking-only candidate selection. 12 tasks.

## Technical Approach

All decision-record logic stays in `src/conductor/src/engine/accepted-widenings.ts`
(renamed concepts, same module): the record schema is redefined in place under `version: 1`
(`decisions: [{criterion, summary, decision, rationale, operator, decidedAt}]`), with a
tolerant reader that returns absent for any non-conforming store, an idempotent
last-decision-per-criterion recorder using the existing atomic temp+rename write, a single
exported blocking predicate (grade OVER_SCOPE ∧ relation outside-visible ∧ no durable
decision), one render helper producing the fenced block plus operator-lever prose and
refused-criteria prose, and a wholesale parser with per-entry named defects (parse-don't-
validate). `conductor.ts`'s two halt-emission sites and `routePrdAuditOverScope` call the
shared helpers; the lazy harvest in `routeCurrentPrdAuditOverScope` records decisions and
emits spine events; the prd_audit completion predicate in `artifacts.ts` keeps consuming the
one shared acceptance/blocking definition. Operator identity resolves via the existing
machine-scoped identity chain. Sequencing: record layer first, then render/parse, then wiring,
then legacy removal, then events/projection.

Local pattern context: the tolerant versioned `.pipeline/` ledger conventions (atomic
temp+rename, read-degrades-never-throws) already present in this module and in the kickback
ledger are the template — search hints: `writeAcceptedWidenings`, `rename(`,
`readAcceptedWidenings`. Allowed variation: field names, event payload shape. The fenced-JSON
block render/parse pattern follows `recordedPrdAuditFindingsBlock` in `conductor.ts`.

## Prerequisites

None — pure engine change, no migrations or config.

## Tasks

### Task 1: Redefine the decisions record schema and reader
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests: reader returns `{decisions: []}` for (a) an old-shape `entries` store, (b) corrupt JSON, (c) a missing file; returns parsed decisions for a conforming store.
2. Verify RED.
3. Implement: replace `AcceptedWidening`/`isAcceptedWidening` with `OverScopeDecision {criterion, summary, decision: 'accept'|'refuse', rationale, operator, decidedAt}` and a strict per-entry validator; `readOverScopeDecisions` keeps `version: 1`, tolerant read (non-conforming → absent, never throws). Keep `ACCEPTED_WIDENINGS_PATH` unchanged.
4. Verify GREEN; commit.

**Done when:**
- [ ] Named unit tests pass covering old-shape store, corrupt JSON, missing file (all read as absent without throwing) and a conforming store round-trip
- [ ] The `entries`-shape validator no longer exists in the module

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — schema redefinition
- src/conductor/test/prd-audit-kickback.test.ts — reader tests

**Dependencies:** none

### Task 2: Idempotent decision recorder with override semantics
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests: recording accept + refuse entries persists all fields; recording the same criterion+decision twice yields one entry; recording `accept` after `refuse` for a criterion makes the effective decision accept; write failure (unwritable dir) resolves without throwing and reports failure.
2. Verify RED.
3. Implement `recordOverScopeDecisions(projectRoot, decisions[])`: append-only entries via the existing atomic temp+rename; effective decision = last entry per criterion; duplicate (criterion, decision) is a no-op; best-effort write returns a result object instead of throwing.
4. Verify GREEN; commit.

**Done when:**
- [ ] Named tests pass for persist-all-fields, duplicate no-op, refuse→accept override, and non-throwing write failure
- [ ] `recordOverScopeDecisions` returns a result value on failure; no code path rethrows fs errors

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — recorder
- src/conductor/test/prd-audit-kickback.test.ts — recorder tests

**Dependencies:** 1

### Task 3: Single shared blocking/decided predicate
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing tests: a criterion is blocking iff relation `outside-visible` and effective decision is absent; accepted → not blocking; refused → blocking-but-decided (distinct value); a decision for a criterion the current report no longer flags OVER_SCOPE has no effect (moot).
2. Verify RED.
3. Implement `classifyOverScopeCriterion(criterion, relations, decisions) → 'not-blocking'|'blocking-undecided'|'blocking-refused'|'accepted'`, replacing `overScopeCriterionIsAccepted` as the one definition; keep a thin `isAccepted` shim only if call sites need a boolean.
4. Verify GREEN; commit.

**Done when:**
- [ ] Named tests pass for all four classifications plus mootness
- [ ] `overScopeCriterionIsAccepted`'s logic exists in exactly one exported function; grep shows no duplicated relation/decision checks elsewhere in the module

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — predicate
- src/conductor/test/prd-audit-kickback.test.ts — predicate tests

**Dependencies:** 2

### Task 4: Fenced decision-block renderer
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: given 3 blocking-undecided findings, output contains one fenced ```json over-scope-decisions``` block with 3 entries each `decision: "pending"`, prose naming the criteria, and the operator lever sentence (edit each `decision` to `accept` or `refuse` with a `rationale`, then clear); given refused criteria, output names them as refused — rework required — and excludes them from the block; given zero undecided and ≥1 refused, block is omitted and refused prose present.
2. Verify RED.
3. Implement `renderOverScopeDecisionBlock(findings, refused)` in accepted-widenings.ts; delete nothing yet.
4. Verify GREEN; commit.

**Done when:**
- [ ] Named tests pass for 3-entry block, refused-only body, and mixed refused+undecided body
- [ ] Rendered body contains both the fenced JSON block (when undecided findings exist) and the lever prose; snapshot or substring assertions name the exact fence tag `over-scope-decisions`

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — renderer
- src/conductor/test/prd-audit-kickback.test.ts — renderer tests

**Dependencies:** 3

### Task 5: Wholesale cleared-body parser with named defects
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: valid block with 2 accepts + 1 refuse parses to 3 decisions; entries still `pending` parse to zero decisions; malformed JSON → defect `malformed-block`; entry with unknown criterion (not in supplied blocking set) → per-entry defect `unknown-criterion` while valid siblings still parse; accept/refuse with empty rationale → per-entry defect `missing-rationale`; body with no fence → `{kind: 'absent'}` no-op; a bad `decision` value → per-entry defect `invalid-decision`.
2. Verify RED.
3. Implement `parseClearedOverScopeDecisions(body, blockingCriteria) → {kind:'absent'} | {decisions[], defects[]}` — parse-don't-validate, per-entry validity, defects carry a closed defect-kind union (`malformed-block | unknown-criterion | missing-rationale | invalid-decision`).
4. Verify GREEN; commit.

**Done when:**
- [ ] Named tests pass for all four defect kinds, pending-inert, partial validity, and the absent no-op
- [ ] The defect kind is a closed TypeScript union; no defect path returns bare null

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — parser
- src/conductor/test/prd-audit-kickback.test.ts — parser tests

**Dependencies:** 4

### Task 6: Spine event for recorded decisions and defects
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing test: emitting the new event persists it to `.pipeline/events.jsonl` via the existing persister path.
2. Verify RED.
3. Implement: add `over_scope_decision` (payload: decisions recorded, defects named, criterion list) to the `ConductorEvent` union and declare it in `EVENT_SINKS` (render/persist/audit). Compilation of the total record forces the declaration.
4. Verify GREEN; commit.

**Done when:**
- [ ] `tsc` passes with the new union member declared in `EVENT_SINKS` (total-record check)
- [ ] Named test proves the event round-trips through the persister to events.jsonl

**Files likely touched:**
- src/conductor/src/engine/events.ts — union + sink declaration
- src/conductor/test/engine/events.test.ts — persistence test

**Dependencies:** none

### Task 7: Harvest wiring in the conductor's lazy clear path
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests (round-trip): a `HALT.cleared` body with 2 accepts + 1 refuse harvested once records 3 decisions with machine-resolved operator identity and emits one `over_scope_decision` event; harvesting the same body again records nothing new; defects emit the event naming them without recording the defective entries.
2. Verify RED.
3. Implement: `routeCurrentPrdAuditOverScope` calls `parseClearedOverScopeDecisions` with the blocking set derived from the current report, records via `recordOverScopeDecisions`, resolves operator identity through the existing machine-scoped chain (unresolved identity is a `missing-operator` recording failure surfaced in the event, not a throw), and emits the spine event. No path throws into the conductor loop.
4. Verify GREEN; commit.

**Done when:**
- [ ] Round-trip test proves one clear records 2 accepts + 1 refuse and a repeat harvest is a no-op
- [ ] Defect and identity-failure paths emit the event and never throw (test asserts the route function resolves)

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — harvest wiring
- src/conductor/test/prd-audit-kickback.test.ts — round-trip tests

**Dependencies:** 5, 6

### Task 8: Blocking-only routing with refusal-aware detail
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: report with outside-visible undecided + outside-harmless unaccepted → route halts naming only the visible criterion; all findings accepted/within → no halt; refused-only blocking set → halt whose detail names the refused criteria as refused — rework required; accepted criterion excluded from the halt set; refusal never yields a route to plan/DECIDE (route kinds unchanged).
2. Verify RED.
3. Implement: `routePrdAuditOverScope` consumes `classifyOverScopeCriterion`; the halt route carries `{undecided[], refused[]}` instead of the flat accepted flag; detail string distinguishes undecided vs refused.
4. Verify GREEN; commit.

**Done when:**
- [ ] Named tests pass for visible-only selection, no-halt-when-decided, refused-detail wording, and unchanged route-kind union
- [ ] The route result no longer exposes a `findings.find(!accepted)`-style flat list; halt payload separates undecided from refused

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — routePrdAuditOverScope
- src/conductor/test/prd-audit-kickback.test.ts — routing tests

**Dependencies:** 3

### Task 9: Both halt-emission sites render via the shared helper
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests: the serial-tail and SHIP-join halt paths both produce bodies containing the fenced block for every undecided blocking finding (3-finding fixture) and reach disk via `writeHaltMarker` with the over-scope class.
2. Verify RED.
3. Implement: replace the per-site `candidate = findings.find(...)` + `renderOverScopeAcceptanceCandidate` logic at both sites with one call to `renderOverScopeDecisionBlock(route.undecided, route.refused)` appended to the halt reason.
4. Verify GREEN; commit.

**Done when:**
- [ ] Both emission-path tests assert a 3-entry block in the halt body
- [ ] grep shows zero remaining `.find((finding) => !finding.accepted)` occurrences in conductor.ts

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — both emission sites
- src/conductor/test/prd-audit-kickback.test.ts — emission tests

**Dependencies:** 4, 8

### Task 10: Completion predicate consumes decisions
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in artifacts tests: accepted criterion no longer blocks `checkStepCompletion('prd_audit')`; refused criterion still blocks; sibling isolation (accepting one criterion does not clear an undecided sibling) preserved; old-shape decisions store treated as absent (everything blocks).
2. Verify RED.
3. Implement: both artifacts.ts consultation sites use `readOverScopeDecisions` + `classifyOverScopeCriterion`; update fixtures from `entries` shape to `decisions` shape.
4. Verify GREEN; commit.

**Done when:**
- [ ] Named artifacts tests pass for accepted-satisfies, refused-blocks, sibling isolation, and old-shape-absent
- [ ] No `entries`-shape fixture remains in artifacts tests for this gate

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — completion predicate
- src/conductor/test/engine/artifacts.test.ts — fixtures + tests

**Dependencies:** 3

### Task 11: Machine clears are inert
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: a `HALT.cleared` produced by the rekick rename of an untouched (all-pending) halt body harvests zero decisions; a rewind-style halt removal (no `HALT.cleared` at all) records nothing; a reseal `--clear-halt`-shaped cleared body (pending entries) records nothing; in each case a subsequent route re-halts with the same blocking set. Also assert the existing tree-keyed cumulative convergence bound still terminates repeated refusal laps over an unchanged tree (identical report + recorded refusal each lap) — regression only, no new mechanism.
2. Verify RED (some may already pass via Task 5's pending-inert parser — keep the assertions as regression coverage; if all pass immediately, record that in the test names and commit them as regression tests).
3. Implement any gap (expected: none beyond Tasks 5/7).
4. Verify GREEN; commit.

**Done when:**
- [ ] Three named tests (rekick-shaped, rewind-shaped, reseal-shaped clear) each assert zero recorded decisions and an unchanged re-halt blocking set

**Files likely touched:**
- src/conductor/test/prd-audit-kickback.test.ts — inertness regression tests

**Dependencies:** 7, 8

### Task 12: Legacy marker removal, projection, and cleanliness
**Story:** 6
**Type:** refactor

**Steps:**
1. Write failing tests: production source contains no `OVER_SCOPE_ACCEPT:` string (meta test or direct removal of its tests); an old-form single-line cleared body harvests nothing and re-halts in the new format; recorded decisions project into the prd_audit verdict artifact's Recorded Findings shape (criterion, decision, rationale); an accepted criterion flips `classifyPrdAuditGaps` cleanliness on the next lap; a recorded decision that cannot be rendered blocks completion with a named reason.
2. Verify RED.
3. Implement: delete `renderOverScopeAcceptanceCandidate`, `acceptClearedOverScopeHalt`, and the `OVER_SCOPE_ACCEPTANCE_CANDIDATE` constant; extend the Recorded Findings persistence to include decisions; wire decisions into `classifyPrdAuditGaps`'s clean computation; unrenderable-decision path returns a blocking completion reason.
4. Verify GREEN; commit.

**Done when:**
- [ ] grep of src/conductor/src finds zero `OVER_SCOPE_ACCEPT` occurrences
- [ ] Named tests pass for old-form-inert, verdict projection, cleanliness flip, and unrenderable-decision block
- [ ] Full conductor test suite passes

**Files likely touched:**
- src/conductor/src/engine/accepted-widenings.ts — deletions
- src/conductor/src/engine/conductor.ts — projection + cleanliness wiring
- src/conductor/test/prd-audit-kickback.test.ts — removal/projection tests

**Dependencies:** 7, 9, 10, 11

## Task Dependency Graph

```
1 → 2 → 3 → 4 → 5 ─┐
                    ├→ 7 ─┐
6 ──────────────────┘     ├→ 11 ─┐
3 → 8 ────────────────────┤      ├→ 12
4,8 → 9 ──────────────────┘──────┤
3 → 10 ──────────────────────────┘
```

## Integration Points

- After Task 9: an end-to-end halt render is testable (multi-finding block on both paths).
- After Task 11: the full halt → operator edit → clear → harvest → re-route loop is testable.

## Coverage

- S1: Tasks 4, 8, 9 (happy + mixed-relation/decided exclusion negatives in 4, 8)
- S2: Tasks 2, 7 (idempotency, write-failure, override negatives in 2, 7)
- S3: Task 11 (all three machine-clear negatives)
- S4: Tasks 3, 8, 10 (refusal blocks/changed halt/mootness; no-DECIDE-route in 8; convergence bound untouched — existing tree-keyed bound covers it, no new mechanism)
- S5: Task 5 (all four defect classes, partial validity, absent no-op), surfaced via 7
- S6: Tasks 1, 12 (old-shape absent, old-form inert, removal proof)
- S7: Tasks 6, 12 (event + sink totality; projection; cleanliness flip; unrenderable block)

All criteria diff-local: each is decided by this feature's own diff and its tests.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block
- [ ] Dependencies are explicit and acyclic
