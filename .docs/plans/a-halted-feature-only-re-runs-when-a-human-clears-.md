# Implementation Plan: retry at the raiser, and operator budget recovery (#2190)

**Date:** 2026-09-05
**Stories:** .docs/stories/a-halted-feature-only-re-runs-when-a-human-clears-.md
**Conflict check:** Clean as of 2026-09-05 (one blocking overlap resolved by architecture-review condition 3; see the conflict report of the same date)

## Summary

Bounded retries where retry is safe (validation-group member budget, a suite-infrastructure lane), three budget halts reclassified so no sweep auto-clears them, and the `kickback-budget inspect|reset|raise` command family from adr-2026-08-29 with a `--gate` selector, consumed by the daemon at its halted-feature boundary. 19 tasks.

## Technical Approach

- **Group member budget (Story 1).** The two validation-group member dispatch sites in `src/conductor/src/engine/conductor.ts` pass a trailing literal `1` as the attempt budget. Replace both with the resolved serial attempt budget the serial path already computes (search: `runValidationGroup`, the `onMemberEvent` callback, the trailing numeric argument after it). No new counter: escalation still derives from `attempt` (adr-2026-07-05 §7).
- **Suite-infrastructure lane (Story 2).** In the `test_suite` branch where `fullSuiteFailure.reason !== 'nonzero_exit'` writes an immediate `needs-human` halt, insert a bounded lane shaped like the build-review mechanical-fault lane (adr-2026-08-18 D3–D5): a `suiteInfrastructureRetries` counter on the `test_suite` gate entry of `.pipeline/kickback-ledger.json`, a `MAX_SUITE_INFRASTRUCTURE_RETRIES` constant in `kickback-ledger.ts`, a `step_retry` emission with an infrastructure reason, then an in-step re-run. The counter is lap-counting (credited by rebase invalidation like `mechanicalFaults`), never charges `count`/`cumulative`, and is read fail-closed: unreadable → treated as spent. Search hints: `bumpMechanicalFaultsInLedger`, `MAX_MECHANICAL_FAULTS_BUILD_REVIEW`, `creditKickbackGateLaps`.
- **Budget-halt classes (Story 3).** Three `writeHaltMarker(…, 'mechanical')` sites — the manual-test cap, the test_suite cap, and the serial "Remediation budget exhausted (max N kickbacks per gate)" halt — pass `needs-human`. `HaltClass`, `readHaltClass`, `isOperatorActionHalt`, the legacy migration, and `rekickSweep` are untouched; the exclusion of live-boundary and seal halts is proven by tests over the unchanged sweep, not by new code.
- **Ledger extension (Stories 4–7, adr-2026-08-29 D1/D2, adr-2026-08-31).** `KickbackGateEntry` gains optional `effectiveLimit` (build_review cumulative), `effectiveLapCap` (prd_audit / as-built), `adjustments` (history), `pendingAdjustment`, `capEvidence` (gate, consumed, limit, latest reason, `haltGeneration`), and `resumeAuthorization` (adjustment id + generation + consumed flag). All are non-lap-counting except nothing; `creditKickbackGateLaps` must preserve them. The validator validates enforcement values and history independently (08-31 §2), scopes invalidity to the gate (§3), never repairs a field (§4), and the credit path never writes an `effectiveLimit` the validator rejects (§5). Every read-modify-write of the ledger goes through one `withKickbackLedgerLease` helper built on `conduct-state-lease.ts` with label `kickback-ledger`; a live or ambiguous owner fails closed (D1).
- **Typed cap evidence.** The three cap terminals (build_review cumulative in `bumpKickbackGate`'s exhausted branch consumer, prd_audit lap cap, as-built lap cap in the remediation routing block) persist `capEvidence` with a fresh generation before `writeHaltMarker`. This is the producer for every generation-match rule downstream.
- **Renderer (D8).** A pure `renderKickbackBudgetView(entry, gate)` in a new `src/conductor/src/engine/kickback-budget-view.ts` produces the human and JSON views; the cumulative-cap halt body and `inspect` both call it.
- **CLI (D3–D5, D7).** `detectKickbackBudgetCommand` in `src/conductor/src/cli.ts` beside `detectDecideGrantCommand`; `dispatchKickbackBudgetCommand` in a new `src/conductor/src/engine/kickback-budget-cli.ts` modeled on `build-review-cli.ts`: `resolveCliFeature` through `resolveMainRepoRoot` + `.worktrees/<slug>` realpath, the interactive-TTY + local-operator refusal, and its `appendEvent` external same-schema sibling-ledger writer. Mutations: ensure park (owned vs pre-existing, `park-marker.ts`), acquire the ledger lease, verify live halt + `capEvidence` + generation agree, stage `pendingAdjustment`, append `kickback_budget_adjustment_authorized` (idempotent by adjustment id), reacquire lease, apply, move to history, install `resumeAuthorization`, remove pending, release owned park. Reconciliation on every command entry finishes or discards a stale pending record by looking up its adjustment id in the sibling ledger. Pre-boot dispatch in `src/conductor/src/index.ts` after `decideGrantCmd`.
- **Daemon boundary (D6, successor D3).** A per-iteration `consumeResumeAuthorizations` sweep in `src/conductor/src/engine/daemon-rekick.ts`, sibling to `rekickSweep` and wired in `daemon-cli.ts` beside it: for each halted worktree, after the operator-park and processed checks and before operator-action retention, read the ledger (fail-closed), match `resumeAuthorization` to live `capEvidence.haltGeneration`, then clear through the existing `clearMarker` (marker + class + REKICK sentinel) and `cleanupHaltPresentation`, mark consumed under the lease, and emit `halt_cleared` with cause `kickback-budget`. It only clears the marker: `pickEligible` and `isHalted` remain the sole dispatch authority (adr-2026-07-04 §3), and the existing rebase-first resume runs from the sentinel.
- **Status.** `daemon-observe-cli.ts` gains a `KICKBACK BUDGET [slug]` line from the same renderer for any feature with an adjustment.
- **Tests.** Unit suites under `src/conductor/test/engine/`: `conductor.test.ts` (search `writeAsBuilt`, `remediation: { enabled: true }` for daemon fixtures), `kickback-ledger.test.ts`, `daemon-rekick.test.ts`, `daemon-cli-rekick-park-wiring.test.ts`, `halt-marker.test.ts`. Mocked provider/step runners only; no real git remote or gh.

## Prerequisites

- Spec #2197 merges first (shared `conductor.ts` regions are disjoint; rebase absorbs it).

## Tasks

### Task 1: Validation-group members get the serial attempt budget
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in the conductor suite: a daemon validation group whose `prd_audit` member throws once then completes joins with no HALT marker; a member that throws on every attempt halts `needs-human` with a reason containing the member name and an attempt count equal to the serial budget; the auth-failure park-and-poll path still consumes no attempt (search `authFailure` fixtures in the existing group tests).
2. Verify RED (today the first case halts after one attempt).
3. Implement: replace the trailing literal `1` at both validation-group member dispatch sites with the resolved serial attempt budget; render the attempt count in the existing no-verdict halt reason.
4. Verify GREEN; existing validation-group join tests pass unchanged; commit.

**Done when:**
- [ ] A conductor test proves a member that throws once then completes yields a group join with no HALT marker and a `prd_audit` verdict.
- [ ] A conductor test proves a member that throws on every attempt halts with class `needs-human` and a reason naming the member and the attempt count.
- [ ] Neither validation-group dispatch site passes a literal attempt budget; both pass the resolved serial budget.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — both member dispatch sites and the no-verdict reason
- src/conductor/test/engine/conductor.test.ts — group budget tests

**Dependencies:** none

### Task 2: Suite-infrastructure retry counter on the ledger
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in the ledger suite: `bumpSuiteInfrastructureRetriesInLedger` increments `gates.test_suite.suiteInfrastructureRetries` and leaves `count`/`cumulative` unchanged; `creditKickbackGateLaps` credits it like `mechanicalFaults`; a non-integer value fails the entry validator for `test_suite` only; `readSuiteInfrastructureRetries` returns `'unreadable'` for a malformed entry.
2. Verify RED.
3. Implement: add `MAX_SUITE_INFRASTRUCTURE_RETRIES = 2`, the optional `suiteInfrastructureRetries` field, the bump helper (atomic temp+rename like the existing writer), the credit rule, and the fail-closed reader.
4. Verify GREEN; commit.

**Done when:**
- [ ] `kickback-ledger.test.ts` proves the bump increments only `suiteInfrastructureRetries` and rebase credit resets it.
- [ ] `kickback-ledger.test.ts` proves a malformed `suiteInfrastructureRetries` invalidates only the `test_suite` entry and the reader reports `'unreadable'`.
- [ ] `MAX_SUITE_INFRASTRUCTURE_RETRIES` is exported and equals 2.

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts — field, constant, bump, credit, reader
- src/conductor/test/engine/kickback-ledger.test.ts — counter tests

**Dependencies:** none

### Task 3: test_suite infrastructure failure re-runs within the step
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in the conductor suite with a fake full-suite verifier: `FAILED` with reason `timeout` then a pass → the step completes, exactly one `step_retry` event carries an infrastructure reason, and `count`/`cumulative` on `test_suite` are unchanged; reason `nonzero_exit` → the existing code-repair kickback route and no lane entry.
2. Verify RED (today the timeout halts immediately).
3. Implement: in the `fullSuiteFailure.reason !== 'nonzero_exit'` branch, read the counter fail-closed; when below the constant, bump it, emit `step_retry` `{ step: 'test_suite', attempt, reason }`, and re-run the verifier; otherwise fall through to the halt in Task 4.
4. Verify GREEN; commit.

**Done when:**
- [ ] A conductor test proves a `timeout` then pass completes `test_suite` with one `step_retry` event carrying an infrastructure reason and unchanged `count`/`cumulative`.
- [ ] A conductor test proves `nonzero_exit` takes the existing kickback route and leaves `suiteInfrastructureRetries` absent.
- [ ] The lane is reached only from the non-`nonzero_exit` verifier branch of the `test_suite` step.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — test_suite infrastructure branch
- src/conductor/test/engine/conductor.test.ts — lane tests

**Dependencies:** 2

### Task 4: Suite-infrastructure exhaustion and unreadable counter halt needs-human
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests: a verifier that fails with `spawn_failed` on every run halts after `MAX_SUITE_INFRASTRUCTURE_RETRIES` re-runs with class `needs-human`, a body containing the reason, the retries spent, and `.pipeline/test-suite-evidence.json`; a malformed counter halts `needs-human` naming the counter as unreadable without re-running; a counter of 1 persisted before a simulated re-dispatch continues to 2 and then halts.
2. Verify RED.
3. Implement the exhaustion and unreadable branches on the lane from Task 3.
4. Verify GREEN; commit.

**Done when:**
- [ ] A conductor test proves exhaustion writes `HALT.class` `needs-human` and a body naming the verifier reason and the retries spent.
- [ ] A conductor test proves a malformed counter halts without invoking the verifier again.
- [ ] A conductor test proves the counter continues from its persisted value across a re-dispatch.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — exhaustion and unreadable branches
- src/conductor/test/engine/conductor.test.ts — negative tests

**Dependencies:** 3

### Task 5: Three budget halts are classified needs-human
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests reading `HALT.class` after each halt: manual-test FAIL unresolved at the per-gate cap, test_suite failure unresolved at the per-gate cap, and the serial "Remediation budget exhausted" halt.
2. Verify RED (each reads `mechanical`).
3. Implement: pass `needs-human` at those three `writeHaltMarker`/`haltSerialExecution` sites; change nothing else about their bodies.
4. Verify GREEN; commit.

**Done when:**
- [ ] Three conductor tests each read `HALT.class` as `needs-human` for the manual-test cap, the test_suite cap, and the per-gate remediation-budget halt.
- [ ] The `HaltClass` union in `halt-marker.ts` is byte-for-byte unchanged in this diff.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — three halt-class arguments
- src/conductor/test/engine/conductor.test.ts — class tests

**Dependencies:** none

### Task 6: The re-kick sweep retains every judgement halt and still clears mechanical
**Story:** 3
**Type:** negative-path
**Verify-only:** yes

**Steps:**
1. In the daemon-rekick suite, drive `rekickSweep` over worktrees carrying `needs-human`, `plan-gap`, `unclassified`, and `protected-artifact` with no operator authorization present and assert each is skipped with a logged disposition, and over a `mechanical` worktree and assert it is cleared with the REKICK sentinel written; assert a `legacy` sidecar is left as-is by `migrateLegacyHaltClasses`.
2. Where an assertion already exists, cite it; add only the missing cases.
3. Commit with `Evidence: satisfied-by` or a test-only commit.

**Done when:**
- [ ] `daemon-rekick.test.ts` proves `needs-human`, `plan-gap`, and `unclassified` halts are skipped by the sweep and `mechanical` is cleared.
- [ ] A test proves a live-boundary halt body and a seal halt body are unchanged after a sweep pass.
- [ ] No production file changes in this task.

**Files likely touched:**
- src/conductor/test/engine/daemon-rekick.test.ts — retention matrix

**Dependencies:** 5

### Task 7: Ledger gate entry carries budget-recovery fields and validates them independently
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing ledger tests: an entry with `effectiveLimit`, `effectiveLapCap`, `adjustments`, `pendingAdjustment`, `capEvidence`, and `resumeAuthorization` round-trips; malformed `adjustments` marks history unavailable while `effectiveLimit` still reads (08-31 §2); a malformed `effectiveLimit` invalidates only that gate (§3) and is never defaulted (§4); `creditKickbackGateLaps` preserves all six fields (D2); `bumpKickbackGate` reports `cumulativeExhausted` against `effectiveLimit` when present.
2. Verify RED.
3. Implement the fields, the validator branches, the non-lap-counting exemption, and the effective-limit comparison.
4. Verify GREEN; commit.

**Done when:**
- [ ] `kickback-ledger.test.ts` proves the six fields round-trip and survive `creditKickbackGateLaps`.
- [ ] `kickback-ledger.test.ts` proves malformed history is reported unavailable while validated enforcement values are preserved, and a malformed `effectiveLimit` invalidates only its gate.
- [ ] `bumpKickbackGate` reports `cumulativeExhausted` at `effectiveLimit` when present and at the default constant otherwise.

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts — fields, validator, credit exemption, exhaustion comparison
- src/conductor/test/engine/kickback-ledger.test.ts — schema tests

**Dependencies:** none

### Task 8: Every ledger read-modify-write runs under one feature-local lease
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests: `withKickbackLedgerLease` serializes two concurrent bumps (both increments land); a live foreign owner makes the operation refuse with a typed failure and leave the ledger unchanged; the lease file carries label `kickback-ledger`.
2. Verify RED.
3. Implement `withKickbackLedgerLease` on `conduct-state-lease.ts` and route `bumpKickbackGateInLedger`, `bumpMechanicalFaultsInLedger`, the Task 2 bump, `recordGrowth`, and the credit writer through it.
4. Verify GREEN; commit.

**Done when:**
- [ ] `kickback-ledger.test.ts` proves two concurrent bumps both land and a live foreign owner refuses with the ledger unchanged.
- [ ] Every exported ledger writer in `kickback-ledger.ts` calls `withKickbackLedgerLease`.
- [ ] The lease label is `kickback-ledger`.

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts — lease wrapper and writer routing
- src/conductor/test/engine/kickback-ledger.test.ts — lease tests

**Dependencies:** 7

### Task 9: Typed cap evidence is persisted before each cap halt
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing conductor tests: reaching the build_review cumulative cap, the prd_audit lap cap, and the as-built lap cap each leave `capEvidence` on the gate entry (gate, consumed, limit, latest reason, a fresh `haltGeneration`) before the halt marker exists; a second halt on the same gate carries a different generation.
2. Verify RED.
3. Implement: at each terminal, write `capEvidence` under the lease, then call the existing halt writer.
4. Verify GREEN; commit.

**Done when:**
- [ ] Three conductor tests each read `capEvidence` with a `haltGeneration` from the ledger after the cap halt for build_review, prd_audit, and architecture_review_as_built.
- [ ] A test proves two successive cap halts on one gate carry distinct generations.
- [ ] The halt marker mtime is later than the ledger write in each test.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — three cap terminals
- src/conductor/src/engine/kickback-ledger.ts — evidence writer
- src/conductor/test/engine/conductor.test.ts — terminal tests

**Dependencies:** 8

### Task 10: One renderer for the budget view and the cap halt body
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: `renderKickbackBudgetView` on a fixture entry yields consumed, limit, remaining, latest reason, adjustment history, and a separate mechanical-fault section for build_review, and laps/lap-cap for the two remediation gates; a legacy entry reports history unavailable; the build_review cumulative-cap halt body contains the renderer's text for the same entry.
2. Verify RED.
3. Implement `kickback-budget-view.ts` (pure) and call it from the cumulative-cap halt terminal.
4. Verify GREEN; commit.

**Done when:**
- [ ] A test proves the renderer output for a fixture entry contains consumed, limit, remaining, latest reason, and a history section, with mechanical faults listed separately.
- [ ] A conductor test proves the cumulative-cap halt body contains the renderer output for the same entry.
- [ ] A test proves a legacy entry renders history as unavailable and never infers it from the reason text.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-view.ts — renderer
- src/conductor/src/engine/conductor.ts — halt body composition
- src/conductor/test/engine/kickback-budget-view.test.ts — renderer tests

**Dependencies:** 9

### Task 11: kickback-budget command parsing, pre-boot dispatch, and refusals
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests: `detectKickbackBudgetCommand` parses `inspect --feature X [--format json]`, `reset --feature X --gate G --rationale R`, `raise --feature X --gate G --by N --rationale R`, and returns null on any other argv; dispatch refuses (exit 2, no file created) for a non-TTY on reset/raise, an empty rationale, `--by` of `0`, `-1`, or `1.5`, an unknown gate, and an unresolved feature; `inspect` runs without a TTY.
2. Verify RED.
3. Implement the parser in `cli.ts`, `dispatchKickbackBudgetCommand` in `kickback-budget-cli.ts` with the `build-review-cli.ts` feature resolution and interactive-operator refusal, and the pre-boot branch in `index.ts` after `decideGrantCmd`.
4. Verify GREEN; commit.

**Done when:**
- [ ] A cli test proves all three subcommands parse and every malformed argv returns null.
- [ ] Tests prove each refusal (non-TTY mutation, empty rationale, non-positive or non-integer `--by`, unknown gate, unresolved feature) exits non-zero and creates no park, lease, or ledger change.
- [ ] `index.ts` dispatches `kickback-budget` before the pipeline boots, proven by an index dispatch test.

**Files likely touched:**
- src/conductor/src/cli.ts — parser
- src/conductor/src/engine/kickback-budget-cli.ts — dispatch and refusals
- src/conductor/src/index.ts — pre-boot branch
- src/conductor/test/engine/kickback-budget-cli.test.ts — parser and refusal tests

**Dependencies:** 10

### Task 12: kickback-budget inspect renders every gate
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests: inspect on a fixture ledger prints both `build_review` and `prd_audit` views with remaining 0 and exits 0; `--format json` prints one JSON document with per-gate fields and an `adjustments` array; malformed history prints values with history unavailable; a legacy entry prints defaults as authoritative.
2. Verify RED.
3. Implement inspect over Task 10's renderer with a read-only ledger read (no lease).
4. Verify GREEN; commit.

**Done when:**
- [ ] A test proves human inspect lists both gates with consumed, limit, remaining, and latest reason.
- [ ] A test proves `--format json` emits a single parseable document with an `adjustments` array (empty when none).
- [ ] Tests prove malformed-history and legacy entries render as unavailable rather than invented.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts — inspect
- src/conductor/test/engine/kickback-budget-cli.test.ts — inspect tests

**Dependencies:** 11

### Task 13: raise and reset stage, authorize, apply, and record under quiescence
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests with a fake park store, lease, and sibling event writer: `raise --gate build_review --by 1` on a feature with matching `capEvidence` creates an owned park, stages `pendingAdjustment`, appends one `kickback_budget_adjustment_authorized` event keyed by adjustment id, applies `effectiveLimit + 1` with `cumulative` unchanged, appends history, installs `resumeAuthorization` bound to the id and generation, removes the pending record, and releases only the owned park; a pre-existing park is preserved and the output names the unpark action; `reset` zeroes `cumulative` and keeps `effectiveLimit`; every other gate, `growth`, `count`, and mechanical fields are unchanged; a held lease or a generation mismatch refuses with no change.
2. Verify RED.
3. Implement the mutation path: park (owned vs existing) → lease → verify live halt class + `capEvidence` + generation → stage → append event → reacquire → apply + history + authorization + unpending → release owned park. Declare the new event in `types/events.ts` and `event-sinks.ts`.
4. Verify GREEN; commit.

**Done when:**
- [ ] A test proves raise applies `effectiveLimit + N` with `cumulative` unchanged, appends exactly one history record and one sibling-ledger event, and installs a resume authorization bound to the adjustment id and halt generation.
- [ ] A test proves reset zeroes `cumulative` and preserves a raised `effectiveLimit`, and a before/after comparison proves other gates, growth, count, and mechanical fields are byte-for-byte unchanged.
- [ ] Tests prove a pre-existing park is preserved with the unpark action printed, and that a held lease or generation mismatch refuses with the ledger unchanged.
- [ ] `kickback_budget_adjustment_authorized` is declared in the sink registry with persist and audit set to true.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts — mutation path
- src/conductor/src/types/events.ts — new event member
- src/conductor/src/engine/event-sinks.ts — sink declaration
- src/conductor/test/engine/kickback-budget-cli.test.ts — mutation tests

**Dependencies:** 11

### Task 14: An interrupted adjustment reconciles exactly once
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: a ledger with a `pendingAdjustment` whose id has no sibling-ledger event is discarded on the next command entry with active fields unchanged; a pending record whose event exists is applied exactly once and no second event is appended; an unreadable sibling ledger leaves the pending record and refuses the command.
2. Verify RED.
3. Implement command-entry reconciliation keyed on the adjustment id.
4. Verify GREEN; commit.

**Done when:**
- [ ] A test proves a pending record with no event is discarded and active fields are unchanged.
- [ ] A test proves a pending record with an event is applied once and the event count is unchanged afterward.
- [ ] A test proves an unreadable sibling ledger keeps the pending record and exits non-zero.

**Files likely touched:**
- src/conductor/src/engine/kickback-budget-cli.ts — reconciliation
- src/conductor/test/engine/kickback-budget-cli.test.ts — crash-window tests

**Dependencies:** 13

### Task 15: Remediation gates honor a feature-local lap cap and reset
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests: `remediationGateAppendBudget` resolves `lapCap` to `effectiveLapCap` when the gate entry carries one and to the config value otherwise; `raise --gate prd_audit --by 1` writes `effectiveLapCap` configured+1 and leaves `laps` unchanged; `reset --gate architecture_review_as_built` zeroes `laps` and keeps `effectiveLapCap`.
2. Verify RED.
3. Implement the lap-cap read in the append-budget resolution and the two gate branches in the CLI apply step.
4. Verify GREEN; commit.

**Done when:**
- [ ] A conductor test proves the append budget uses `effectiveLapCap` when present and the config cap otherwise.
- [ ] A test proves raise on `prd_audit` yields `effectiveLapCap` of configured plus N with `laps` unchanged.
- [ ] A test proves reset on the as-built gate zeroes `laps` and keeps `effectiveLapCap`.

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — lap-cap resolution
- src/conductor/src/engine/kickback-budget-cli.ts — gate branches
- src/conductor/test/engine/conductor.test.ts — lap-cap tests
- src/conductor/test/engine/kickback-budget-cli.test.ts — gate tests

**Dependencies:** 13

### Task 16: Lap credit and validation never widen an authorized limit
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests: after a raise, a rebase-invalidation credit leaves `effectiveLimit` and `effectiveLapCap` intact; re-reading through `readKickbackLedger` after every CLI write in the suite validates; a ledger whose `resumeAuthorization` is malformed reads as having no authorization while enforcement values still read.
2. Verify RED where a case fails.
3. Implement any missing validator or credit branch.
4. Verify GREEN; commit.

**Done when:**
- [ ] A test proves a credit after a raise preserves `effectiveLimit` and `effectiveLapCap`.
- [ ] Every CLI mutation test re-reads the ledger through `readKickbackLedger` and asserts it validates.
- [ ] A test proves a malformed `resumeAuthorization` reads as absent without invalidating enforcement values.

**Files likely touched:**
- src/conductor/src/engine/kickback-ledger.ts — validator or credit branch if needed
- src/conductor/test/engine/kickback-ledger.test.ts — credit and validation tests

**Dependencies:** 15

### Task 17: The daemon consumes a matching authorization and clears the halt atomically
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write failing tests in the daemon-rekick suite for `consumeResumeAuthorizations`: a halted worktree with a valid unconsumed authorization matching `capEvidence.haltGeneration` and no park is cleared (marker, class sidecar, presentation) via the existing clear path, the authorization is marked consumed under the lease, a `halt_cleared` event with cause `kickback-budget` is emitted, and the REKICK sentinel exists; a stale generation, an operator park, a `partial` presentation clear, and an unreadable ledger each retain the halt, leave the authorization unconsumed, and dispatch nothing. Wire it in `daemon-cli.ts` beside the rekick sweep binding and prove per-iteration invocation in the wiring suite.
2. Verify RED.
3. Implement the sweep and its wiring; it never dispatches — `pickEligible` sees the cleared marker on the next poll.
4. Verify GREEN; commit.

**Done when:**
- [ ] `daemon-rekick.test.ts` proves a matching authorization clears the halt through `clearMarker` and `cleanupHaltPresentation`, marks it consumed, emits `halt_cleared` with cause `kickback-budget`, and writes the REKICK sentinel.
- [ ] Tests prove stale generation, operator park, partial clear, and unreadable ledger each retain the halt with the authorization unconsumed and no dispatch.
- [ ] A daemon-cli wiring test proves the sweep runs each loop iteration ahead of operator-action retention and after the park and processed checks.

**Files likely touched:**
- src/conductor/src/engine/daemon-rekick.ts — authorization sweep
- src/conductor/src/daemon-cli.ts — wiring
- src/conductor/test/engine/daemon-rekick.test.ts — sweep tests
- src/conductor/test/engine/daemon-cli-rekick-park-wiring.test.ts — wiring test

**Dependencies:** 16

### Task 18: daemon status shows the adjustment and remaining allowance
**Story:** 7
**Type:** happy-path

**Steps:**
1. Write a failing renderer test: `daemon status` for a repo whose feature ledger carries an adjustment prints a `KICKBACK BUDGET [slug]` line with the gate, adjustment kind, and remaining allowance from Task 10's renderer; a feature with no adjustment prints no such line.
2. Verify RED.
3. Implement the section in `daemon-observe-cli.ts` beside the plan-growth section.
4. Verify GREEN; commit.

**Done when:**
- [ ] A status test proves a feature with an adjustment prints gate, kind, and remaining allowance.
- [ ] A status test proves a feature without an adjustment prints no kickback-budget line.

**Files likely touched:**
- src/conductor/src/engine/daemon-observe-cli.ts — status section
- src/conductor/test/engine/daemon-observe-cli.test.ts — status tests

**Dependencies:** 17

### Task 19: A resumed feature enforces the adjusted budget from the ledger
**Story:** 7
**Type:** negative-path

**Steps:**
1. Extend an existing resume-entry test with a ledger fixture: after the Task 17 clear, the feature's first dispatched step is the step after its last completed one; the raised gate then enforces `effectiveLimit` (or `effectiveLapCap`) from the ledger while repository config still holds the default.
2. Verify RED where the assertion fails.
3. Implement nothing new unless RED reveals a gap in Tasks 7–17; otherwise record the verification.
4. Commit.

**Done when:**
- [ ] A resume test proves the first dispatched step after an authorized clear is the step after the last completed one.
- [ ] A test proves the raised gate halts at the ledger's effective limit while config still holds the default.

**Files likely touched:**
- src/conductor/test/engine/conductor.test.ts — resume and enforcement test

**Dependencies:** 17

## Task Dependency Graph

```
1
2 -> 3 -> 4
5 -> 6
7 -> 8 -> 9 -> 10 -> 11 -> 12
                     11 -> 13 -> 14
                           13 -> 15 -> 16 -> 17 -> 18
                                             17 -> 19
```

## Integration Points
- After Task 4: a flaky suite runner no longer pages the operator; a broken one still halts after two re-runs.
- After Task 6: no budget halt is auto-cleared by any sweep.
- After Task 14: an operator can raise or reset from a terminal with exactly-once durability.
- After Task 17: the daemon resumes a feature from an operator adjustment with no config edit and no commit on main.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D1 | task | task-7, task-8 | `kickback-ledger.test.ts` proves the six fields round-trip and survive `creditKickbackGateLaps`. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D2 | task | task-13, task-15 | A test proves reset zeroes `cumulative` and preserves a raised `effectiveLimit`, and a before/after comparison proves other gates, growth, count, and mechanical fields are byte-for-byte unchanged. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D3 | task | task-11 | Tests prove each refusal (non-TTY mutation, empty rationale, non-positive or non-integer `--by`, unknown gate, unresolved feature) exits non-zero and creates no park, lease, or ledger change. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D4 | task | task-13 | Tests prove a pre-existing park is preserved with the unpark action printed, and that a held lease or generation mismatch refuses with the ledger unchanged. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D5 | task | task-14 | A test proves a pending record with an event is applied once and the event count is unchanged afterward. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D6 | task | task-17 | Tests prove stale generation, operator park, partial clear, and unreadable ledger each retain the halt with the authorization unconsumed and no dispatch. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D7 | task | task-13 | `kickback_budget_adjustment_authorized` is declared in the sink registry with persist and audit set to true. |
| adr-2026-08-29-operator-authorized-kickback-budget-recovery#D8 | task | task-10 | A conductor test proves the cumulative-cap halt body contains the renderer output for the same entry. |

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism
- [ ] Dependencies are explicit and acyclic
