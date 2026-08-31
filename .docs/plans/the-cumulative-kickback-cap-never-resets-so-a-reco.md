# Implementation Plan: cumulative kickback budget recovery

**Status:** Approved
**Date:** 2026-08-29
**Design:** .docs/specs/the-cumulative-kickback-cap-never-resets-so-a-reco.md
**Architecture:** .docs/decisions/adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class.md
**Stories:** .docs/stories/the-cumulative-kickback-cap-never-resets-so-a-reco.md
**Conflict check:** Clean as of 2026-08-29 after two operator-approved resolutions

## Summary

Nineteen focused TDD tasks add read-only budget inspection, guarded reset and extension, durable
attribution, crash reconciliation, and daemon-owned recovery of one exact cumulative-cap halt. The
default cap, mechanical-fault lane, two-class halt taxonomy, and ordinary needs-human retention stay
unchanged.

## Technical Approach

- Extend `KickbackGateEntry` additively with an optional effective limit, typed exhausted evidence,
  adjustment history, pending adjustment, and resume authorization. Legacy absence remains
  distinguishable from a newly recorded empty history, so inspection can say “unavailable” without
  guessing.
- Put every kickback-ledger read-modify-write behind one `createConductStateLease` instance keyed to
  `.pipeline/kickback-ledger.json` and labelled `kickback-ledger`. Keep pure calculations separate
  from leased persistence; a lost or ambiguous lease returns a typed refusal.
- Reuse the current named-worktree traits from `build-review-cli.ts`, but extract them once for both
  command families. Resolve mutation identity through the machine user-config → GitHub fallback
  chain in `owner-gate/machine-identity.ts`; do not use repository config or `os.userInfo()` as
  recovery authority.
- Keep current `appendCloseoutEvent` behavior for existing callers and add an async idempotent append
  for adjustment authorization. It uses the same `.pipeline/pipeline-events.jsonl` schema/path,
  serializes by adjustment id, and never becomes the source of budget counts.
- A mutating command establishes a park and records whether it created the marker. It stages an
  adjustment with active values unchanged, appends the occurrence once, then atomically applies the
  values/history/resume authorization. Only a command-owned park is released; a pre-existing park
  remains.
- The cap writer stores typed evidence/generation before writing `HALT.class = needs-human`. After
  park and processed checks, daemon re-kick consumes an exact authorization before generic
  needs-human retention, clears through the canonical halt lifecycle, and resumes normal selection.
- Tests use pure/unit seams for schema, arithmetic, rendering, parsing, and refusal matrices;
  filesystem integration only for leased mutation, park ownership, external event append, and halt
  lifecycle. Every external Git/GitHub/process boundary is injected; ordinary tests call no third
  party and use no real waits.

## Prerequisites

- Approved PRD, stories, architecture, and superseding halt-class ADR are present.
- Conflict-check reports zero remaining blocking or degrading conflicts.
- BUILD rebases first and rediscovers live symbols because the advisory overlap scan shows heavy
  contention on CLI, conductor, daemon, and event wiring.

## Tasks

### Task 1: Add backward-compatible budget adjustment state

**Story:** Story 2 HP2/NP1/NP2; Story 5 stale-generation cases; Story 6 staged-state cases
**Type:** infrastructure

**Steps:**
1. Write failing unit fixtures for: legacy entry with no new keys; valid effective limit/history/
   typed evidence/pending/authorization; malformed adjustment identity; unsafe integer values; and
   conflicting generations.
2. Verify RED.
3. Add the typed optional fields and validators. Preserve whether adjustment history was absent
   rather than normalizing legacy absence to a fabricated empty historical record.
4. Verify GREEN and commit `feat(kickback-ledger): model recoverable cumulative budget state`.

**Done when:**

1. The legacy fixture reads count and default limit without rejection and reports history origin as unavailable.
2. The complete fixture round-trips every adjustment, pending, exhausted, and authorization field.
3. Each malformed identity, generation, and unsafe-number fixture is rejected by the validator.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/test/engine/kickback-ledger.test.ts`

**Dependencies:** none

### Task 2: Derive one canonical budget view

**Story:** Story 1 HP1-HP3/NP1-NP2; Story 2 HP1-HP2/NP1-NP2; Story 9 HP2/NP1
**Type:** happy-path

**Steps:**
1. Write failing pure tests for count, effective limit, clamped remaining allowance, exhausted flag,
   latest reason, mechanical exclusion, chronological history, and legacy unavailable labels.
2. Verify RED.
3. Add a pure `deriveKickbackBudgetView` plus human and JSON renderers. Use explicit unavailable
   fields; do not infer history from reason prose or timestamps.
4. Verify GREEN and commit `feat(kickback-budget): derive one canonical inspection view`.

**Done when:**

1. Count 3/limit 5 renders remaining 2 and exhausted false in both formats.
2. Mechanical faults render separately and change none of count, limit, or remaining.
3. A three-adjustment fixture is chronological and a legacy fixture labels history unavailable.

**Files:**
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/test/engine/kickback-budget.test.ts`

**Dependencies:** Task 1

### Task 3: Introduce the leased kickback-ledger transaction boundary

**Story:** Story 6 HP3/NP3
**Type:** infrastructure

**Steps:**
1. Write failing integration tests for one mutation acquiring the existing bounded lease, two
   contenders producing one winner, live-owner timeout, malformed-owner refusal, and ownership loss
   at release.
2. Verify RED.
3. Add `mutateKickbackLedger` around `createConductStateLease` using the ledger path and
   `kickback-ledger` label. Return typed acquisition/release failures and never write after ownership
   loss.
4. Verify GREEN and commit `feat(kickback-ledger): serialize mutations through one bounded lease`.

**Done when:**

1. Two concurrent mutations yield one complete winner and one timeout/refusal with no lost update.
2. Malformed ownership and lost-release fixtures leave the ledger byte-identical.
3. Tests inject clock, wait, liveness, and filesystem behavior and contain no real sleep.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/test/engine/kickback-ledger.test.ts`

**Dependencies:** Task 1

### Task 4: Route every existing ledger read-modify-write through the lease

**Story:** Story 3 NP1; Story 4 NP1
**Story:** Story 8 HP3/NP1-NP2
**Type:** refactor

**Steps:**
1. Write failing contention tests around semantic consumption, mechanical consumption, plan growth,
   rebase credit, rollback restoration, and conductor entry-field updates.
2. Verify RED.
3. Replace direct read-plus-write pairs in ledger helpers and conductor call sites with the leased
   transaction boundary. Read-only inspection remains unleased.
4. Verify GREEN and commit `refactor(kickback-ledger): lease every read-modify-write path`.

**Done when:**

1. The six enumerated mutation families cannot overwrite a concurrent winner.
2. Existing PASS preservation, rebase credit, per-tree count, and mechanical-lane assertions pass.
3. Production search finds no kickback-ledger read followed by a direct write outside the transaction
   implementation or whole-ledger fresh-session clear.
4. Lap credit preserves `effectiveLimit` and adjustment history: a qualifying rebase credits lap-counting fields only, leaves a raised limit readable at its raised value, and never writes a `effectiveLimit: 0` that fails ledger validation.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/kickback-ledger.test.ts`
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts`

**Dependencies:** Task 3

### Task 5: Apply the feature-local limit and persist typed exhaustion evidence

**Story:** Story 4 HP2/NP2; Story 8 HP1-HP3/NP1-NP3; Story 9 HP1/NP2
**Type:** happy-path

**Steps:**
1. Write failing tests proving default limit 5, raised limit arithmetic, halt only at count greater
   than the effective limit, and typed evidence persisted before the needs-human halt.
2. Add negative fixtures for PASS, mechanical fault, ordinary dispatch, source edit, engine change,
   and reworded finding; none may reset or raise the budget.
3. Verify RED.
4. Make cumulative exhaustion consult the entry's effective limit and record gate/count/limit/latest
   reason/stable generation before the canonical needs-human halt.
5. Verify GREEN and commit `feat(build-review): halt against the effective cumulative allowance`.

**Done when:**

1. Default count 5 continues and count 6 halts; raised limit 8 continues and count 9 halts.
2. The halt class remains exactly `needs-human` and typed evidence exists before its writer runs.
3. The six automatic inputs listed in Steps change neither limit nor adjustment history.

**Files:**
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/engine/cumulative-kickback-bound.test.ts`
- `src/conductor/test/engine/conductor-kickback-ledger.test.ts`

**Dependencies:** Task 2, Task 4

### Task 6: Declare the adjustment authorization occurrence

**Story:** Story 10 HP1/NP3
**Type:** infrastructure

**Steps:**
1. Write failing type and sink-registry tests for one `kickback_budget_adjustment_authorized` event
   with adjustment id, feature, gate, kind, before/after count and limit, operator, rationale, and
   timestamp.
2. Verify RED.
3. Add the union member and complete persisted/audited/rendered/OTel sink declarations according to
   the existing registry contract.
4. Verify GREEN and commit `feat(events): declare kickback budget adjustment authorization`.

**Done when:**

1. Compile-time exhaustiveness requires a sink row for the new event.
2. A complete event is accepted and a fixture missing each required field fails type validation.
3. Older event fixtures and every pre-existing sink row remain readable.

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/event-sinks.test.ts`
- `src/conductor/test/event-sink-registry.test.ts`

**Dependencies:** none

### Task 7: Append an adjustment occurrence idempotently on the external event ledger

**Story:** Story 6 HP1-HP2/NP1-NP3; Story 10 HP3/NP1-NP2
**Type:** negative-path

**Steps:**
1. Write failing filesystem integration tests for first append, same-id same-payload retry, same-id
   conflicting payload, writer contention, unreadable ledger, and interrupted append.
2. Verify RED.
3. Add an async idempotent append beside `appendCloseoutEvent`, using the same
   `pipeline-events.jsonl` and a bounded lease. Same payload returns already-recorded; ambiguity or
   conflict returns refusal without appending.
4. Verify GREEN and commit `feat(events): append budget authorization exactly once`.

**Done when:**

1. Five identical retries produce one JSONL record and an already-recorded result.
2. Conflicting payload, unreadable ledger, and ownership-loss fixtures append zero new bytes.
3. Existing synchronous closeout-event callers and their tests are unchanged in behavior.

**Files:**
- `src/conductor/src/engine/closeout-events.ts`
- `src/conductor/test/closeout-events.test.ts`

**Dependencies:** Task 6

### Task 8: Extract one named-feature worktree resolver

**Story:** Story 5 HP1/NP4-NP5
**Type:** refactor

**Steps:**
1. Write failing unit tests for exact slug resolution from main checkout and linked worktree,
   ambiguous/missing worktree, realpath escape, mismatched feature identity, and cross-repository
   lookup.
2. Verify RED.
3. Extract the current build-review resolution traits to a shared module and make existing
   build-review commands use it without output changes.
4. Verify GREEN and commit `refactor(cli): share exact named-feature resolution`.

**Done when:**

1. Both command families can receive the same resolved `{mainRoot, worktree, feature}` shape.
2. Missing, ambiguous, escaping, mismatched, and cross-repository fixtures all return unresolved.
3. Existing build-review CLI snapshots remain unchanged.

**Files:**
- `src/conductor/src/engine/feature-worktree-resolver.ts`
- `src/conductor/src/engine/build-review-cli.ts`
- `src/conductor/test/engine/feature-worktree-resolver.test.ts`
- `src/conductor/test/engine/build-review-cli.test.ts`

**Dependencies:** none

### Task 9: Parse the kickback-budget command family and numeric contract

**Story:** Story 1 NP3; Story 4 NP3; Story 5 NP3
**Type:** negative-path

**Steps:**
1. Write failing parser/help tests for inspect human/JSON, reset with rationale, raise with positive
   safe integer and rationale, unknown format, missing feature, blank/over-1000-character rationale,
   and zero/negative/fractional/non-numeric/unsafe amounts.
2. Verify RED.
3. Add command detection and help declarations with an explicit 1000-character rationale limit and
   `Number.isSafeInteger` amount rule.
4. Verify GREEN and commit `feat(cli): parse guarded kickback budget commands`.

**Done when:**

1. The three approved command forms parse to typed dispatches.
2. Every invalid format, rationale, and amount enumerated in Steps is rejected before mutation.
3. Full help lists inspect, reset, and raise with their required flags.

**Files:**
- `src/conductor/src/cli.ts`
- `src/conductor/test/engine/kickback-budget-cli.test.ts`
- `src/conductor/test/cli/index.test.ts`

**Dependencies:** none

### Task 10: Implement mutation-free inspection

**Story:** Story 1 HP1-HP3/NP1-NP3; Story 2 HP1-HP2/NP1-NP2; Story 5 HP2/NP6
**Type:** happy-path

**Steps:**
1. Write failing dispatcher tests for human and JSON output, mechanical separation, adjustment
   chronology, legacy unavailable history, malformed state, unresolved feature, and non-interactive
   use.
2. Verify RED.
3. Implement inspection with the shared resolver, read-only ledger access, and canonical view. Do not
   acquire a mutation lease, create a park, resolve operator identity, or open a pipeline.
4. Verify GREEN and commit `feat(kickback-budget): inspect one feature without mutation`.

**Done when:**

1. Human and JSON outputs agree on every canonical budget field.
2. Malformed/unresolved cases return non-success with no partial document.
3. Snapshot comparison proves non-interactive inspection changes no worktree or main-root state.

**Files:**
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/test/engine/kickback-budget-cli.test.ts`

**Dependencies:** Task 2, Task 8, Task 9

### Task 11: Enforce human authority and exact current halt preconditions

**Story:** Story 5 HP1/NP1-NP5; Story 7 NP1
**Type:** negative-path

**Steps:**
1. Write a table-driven refusal suite for non-TTY, unresolved machine identity, blank/oversized
   rationale, missing/ambiguous feature, no halt, non-needs-human class, wrong gate, missing evidence,
   changed generation, changed count/limit, and cross-repository target.
2. Verify RED.
3. Resolve identity through `makeMachineOwnerResolver`'s user-config → GitHub chain and compare the
   exact needs-human marker/evidence/generation under the ledger lease before staging.
4. Verify GREEN and commit `feat(kickback-budget): require an exact attributable recovery target`.

**Done when:**

1. A valid TTY/identity/rationale/exact-evidence fixture is admitted for staging.
2. Each of the twelve refusal cases exits non-success and leaves budget, history, halt, and siblings
   byte-identical.
3. No environment flag, project config, or `os.userInfo()` value grants mutation authority.

**Files:**
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/src/engine/owner-gate/machine-identity.ts`
- `src/conductor/test/engine/kickback-budget-cli.test.ts`

**Dependencies:** Task 3, Task 8, Task 9

### Task 12: Own only a recovery-created temporary park

**Story:** Story 6 HP3; Story 7 HP1-HP2/NP2
**Type:** negative-path

**Steps:**
1. Write failing integration tests for absent park creation/release, pre-existing park preservation,
   two creators racing, park-read failure, park-write failure, and adjustment failure after park.
2. Verify RED.
3. Make the canonical park create return whether this caller created the marker. The recovery
   transaction releases only that owned marker after durable authorization; every failure retains a
   protective park, and pre-existing markers keep content and mtime.
4. Verify GREEN and commit `feat(kickback-budget): preserve explicit parks during recovery`.

**Done when:**

1. A command-created park is removed only after durable authorization is installed.
2. A pre-existing park and its mtime remain unchanged through success and failure.
3. Race/read/write/adjustment failure fixtures dispatch nothing and leave the feature parked or
   halted.

**Files:**
- `src/conductor/src/engine/park-marker.ts`
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/test/engine/daemon-park-cli.test.ts`
- `src/conductor/test/engine/kickback-budget.test.ts`

**Dependencies:** Task 11

### Task 13: Stage and commit an attributed reset

**Story:** Story 3 HP1-HP3/NP1-NP3
**Type:** happy-path

**Steps:**
1. Write failing transaction tests for count 6/limit 5, count 6/raised-limit 8, preserved mechanical
   and per-tree state, sibling isolation, history retention, and first post-reset semantic failure.
2. Verify RED.
3. Stage the reset with before/after values, append authorization once, then apply count 0, history,
   and resume authorization atomically while preserving effective limit and excluded state.
4. Verify GREEN and commit `feat(kickback-budget): reset one exhausted semantic budget`.

**Done when:**

1. Count 6/limit 5 becomes 0/5 and count 6/limit 8 becomes 0/8 with one attributed reset each.
2. Mechanical, per-tree, sibling, and earlier-history fixtures remain unchanged.
3. The next semantic failure records count 1; a mechanical fault leaves semantic count 0.

**Files:**
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/test/engine/kickback-budget.test.ts`

**Dependencies:** Task 7, Task 12

### Task 14: Stage and commit a positive allowance extension

**Story:** Story 4 HP1-HP3/NP1-NP3
**Type:** happy-path

**Steps:**
1. Write failing transaction tests for raise 6/5 by 3, repeated raise after renewed exhaustion,
   preserved count/default/sibling/mechanical state, exact-limit continuation, and every invalid
   numeric form from Task 9.
2. Verify RED.
3. Stage and commit an extension that adds one positive safe integer to the feature-local effective
   limit, preserving consumed count and recording before/after values.
4. Verify GREEN and commit `feat(kickback-budget): raise one feature's effective allowance`.

**Done when:**

1. Raise 6/5 by 3 yields count 6, limit 8, remaining 2, and one attributed extension.
2. Count 8 continues and count 9 writes the renewed cap halt; a later authorized raise accumulates.
3. Invalid amounts and sibling/default/mechanical assertions show zero mutation.

**Files:**
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/test/engine/kickback-budget.test.ts`

**Dependencies:** Task 7, Task 12

### Task 15: Reconcile every interrupted adjustment phase exactly once

**Story:** Story 6 HP1-HP3/NP1-NP3; Story 10 NP1-NP2
**Type:** negative-path

**Steps:**
1. Write fault-injection tests at: pending write, event append, post-event/pre-apply, apply write,
   authorization install, and park release. Add absent-event, matching-event, duplicate-same-event,
   duplicate-conflicting-event, unreadable-event, and lost-lease reconciliation fixtures.
2. Verify RED.
3. Reconcile by stable adjustment id at command entry: absent occurrence removes safe pending state;
   matching occurrence completes once; ambiguity retains park/halt and reports refusal. Active values
   remain prior or fully adjusted, never intermediate.
4. Verify GREEN and commit `feat(kickback-budget): reconcile interrupted adjustments by identity`.

**Done when:**

1. The six interruption points each yield the complete prior state or one complete adjusted state.
2. Matching retries produce one history entry and one event; absent events apply nothing.
3. Conflicting duplicate, unreadable event, and lost lease retain halt/park and report refusal.

**Files:**
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/src/engine/kickback-ledger.ts`
- `src/conductor/src/engine/closeout-events.ts`
- `src/conductor/test/engine/kickback-budget.test.ts`

**Dependencies:** Task 13, Task 14

### Task 16: Consume exact resume authorization before needs-human retention

**Story:** Story 7 HP1-HP3/NP1-NP3; Story 8 HP1-HP2
**Type:** happy-path

**Steps:**
1. Write failing daemon tests for matching authorization, pre-existing park, missing authorization,
   stale generation, changed class/gate, clear failure, record-resolution failure, and authorization
   cleanup after clear.
2. Verify RED.
3. After park and processed checks but before generic needs-human retention, validate typed evidence
   and authorization. Exact match uses canonical clear/record/event lifecycle, consumes authority,
   and permits normal selection; every listed mismatch retains the halt and dispatches nothing.
4. Verify GREEN and commit `feat(daemon): resume an operator-authorized cap halt`.

**Done when:**

1. One exact authorized needs-human cap halt clears canonically, resolves its record, and resumes at the earliest unsatisfied step.
2. Parked, missing, stale, changed-class, changed-gate, clear-failure, and record-failure fixtures retain the halt and dispatch nothing.
3. Generic needs-human halts without typed cap evidence still survive every sweep unchanged.

**Files:**
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`
- `src/conductor/test/acceptance/resume-halt-state.acceptance.test.ts`

**Dependencies:** Task 5, Task 15

### Task 17: Wire all three commands through the pre-boot CLI boundary

**Story:** Story 1 command surface; Story 3/4 mutation surface; Story 5 NP6; Story 7 NP3
**Type:** infrastructure

**Steps:**
1. Write failing dispatch tests proving inspect/reset/raise are detected before pipeline boot and
   receive shared resolver, machine identity, event writer, and park dependencies.
2. Add negative tests proving inspect cannot reach mutation dispatch and no command constructs a
   Conductor, builds, publishes, merges, or marks shipment.
3. Verify RED.
4. Wire the typed dispatchers in `index.ts` and help in `cli.ts`.
5. Verify GREEN and commit `feat(cli): dispatch kickback budget recovery before pipeline boot`.

**Done when:**

1. Each command reaches exactly its intended dispatcher and returns that dispatcher's exit code.
2. Non-interactive inspect succeeds; non-interactive reset/raise refuse before state mutation.
3. Injected boot/build/PR/merge/shipment spies each record zero calls for all three commands.

**Files:**
- `src/conductor/src/cli.ts`
- `src/conductor/src/index.ts`
- `src/conductor/src/engine/kickback-budget-cli.ts`
- `src/conductor/test/engine/kickback-budget-cli.test.ts`
- `src/conductor/test/cli/index.test.ts`

**Dependencies:** Task 10, Task 13, Task 14

### Task 18: Render cap halts from the same budget view as inspection

**Story:** Story 9 HP1-HP2/NP1-NP2; Story 1 HP1
**Type:** happy-path

**Steps:**
1. Write failing conductor tests for adjusted exhaustion diagnostics and exact equality with the
   shared human/JSON view fields. Add legacy-unavailable and unrelated-halt fixtures.
2. Verify RED.
3. Replace cap-specific string assembly with the canonical budget renderer while keeping the halt
   class needs-human and latest reason diagnostic-only.
4. Verify GREEN and commit `feat(build-review): render cap halts from canonical budget state`.

**Done when:**

1. The cap halt names gate, count, effective limit, remaining, latest reason, all adjustments, and mechanical exclusion.
2. Its shared fields equal both inspection formats for the same fixture.
3. Legacy detail is labelled unavailable and unrelated halt classes acquire no budget diagnosis.

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/src/engine/kickback-budget.ts`
- `src/conductor/test/engine/cumulative-kickback-bound.test.ts`
- `src/conductor/test/engine/kickback-budget.test.ts`

**Dependencies:** Task 5, Task 13, Task 14

### Task 19: Carry authorization through merged event, audit, and operator views

**Story:** Story 10 HP1-HP3/NP1-NP3
**Type:** infrastructure

**Steps:**
1. Write failing integration tests that append one external authorization, read it through the
   merged event history, tail/re-emit it once, map it to audit output, and compare every field with
   durable inspection history.
2. Add retry/refusal/legacy-stream fixtures proving one occurrence, no false success, and unchanged
   readability of older events.
3. Verify RED.
4. Register merged-reader, audit, daemon-renderer, and UI handling without a new event file or
   control-state dependency.
5. Verify GREEN and commit `feat(observability): surface kickback budget authorization once`.

**Done when:**

1. One successful reset and one extension each appear once through merged history and audit with all required fields.
2. Event and durable history agree on adjustment id, kind, values, operator, rationale, and time.
3. Retry, refusal, and legacy-stream fixtures respectively show one event, zero success event, and unchanged old-event parsing.

**Files:**
- `src/conductor/src/engine/closeout-events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/src/engine/audit-trail.ts`
- `src/conductor/src/ui/events.ts`
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`
- `src/conductor/test/closeout-events.test.ts`
- `src/conductor/test/ui/events.test.ts`

**Dependencies:** Task 6, Task 7, Task 17

## Task Dependency Graph

```text
1 → 2 → 5 → 18
1 → 3 → 4 → 5
6 → 7 ─────────────┐
8 → 10             │
9 → 10             │
3 + 8 + 9 → 11 → 12 → 13 ─┐
                      └────→ 14 ─┤→ 15 → 16
10 + 13 + 14 → 17 ───────────────┘
6 + 7 + 17 → 19
```

## Integration Points

- After Task 5: existing conductor consumption can halt against a feature-local effective limit and
  leaves typed needs-human evidence.
- After Task 10: operators can inspect current and legacy budget state without mutation.
- After Tasks 13-15: reset and raise are durable, attributable, idempotent transactions.
- After Task 16: an exact authorization returns the feature to the existing daemon resume lifecycle.
- After Task 19: external authorization is visible through every standard event/audit consumer.

## Plan Safety Checks

- `ai-conductor plan-protected-targets` passed on 2026-08-29 with no protected-target violations.
- The required advisory overlap scan ran against the complete union of planned production and test
  paths, source reference `jstoup111/ai-conductor#1760`, and base `main`. It reported 56 overlapping
  `spec/*` branch entries, concentrated in shared CLI, conductor, daemon, ledger, and event seams.
  This is a rebase-first BUILD constraint: rediscover live symbols and reconcile current contracts
  before Task 1. It is not a plan blocker and does not authorize edits outside each task's file set.

## Coverage Mapping

| Story | Criteria | Tasks |
|---|---|---|
| Story 1 | HP1-HP3, NP1-NP3 | 1, 2, 9, 10, 18 |
| Story 2 | HP1-HP2, NP1-NP2 | 1, 2, 10 |
| Story 3 | HP1-HP3, NP1-NP3 | 4, 13, 17 |
| Story 4 | HP1-HP3, NP1-NP3 | 5, 9, 14, 17 |
| Story 5 | HP1-HP2, NP1-NP6 | 8-11, 17 |
| Story 6 | HP1-HP3, NP1-NP3 | 3, 7, 12, 15 |
| Story 7 | HP1-HP3, NP1-NP3 | 11, 12, 16, 17 |
| Story 8 | HP1-HP3, NP1-NP3 | 4, 5, 16 |
| Story 9 | HP1-HP2, NP1-NP2 | 2, 5, 18 |
| Story 10 | HP1-HP3, NP1-NP3 | 6, 7, 15, 19 |

## Verification

- [x] All 10 stories and all happy/negative criteria map to at least one behavior-owning task.
- [x] Every task has an explicit dependency and 2-5 falsifiable Done-when checks.
- [x] Negative paths have named refusal/fault fixtures in Tasks 3, 7, 9, 11, 12, 15, and 16.
- [x] No task targets ordinary documentation or another feature's sealed DECIDE artifact.
- [x] No terminal catch-all validation task exists; Task 19 owns the event/audit integration point it
      implements.
