# Implementation Plan: Total HALT classification with legacy compatibility

**Date:** 2026-07-28
**Design:** `.docs/architecture/most-conductor-halts-carry-no-class-sidecar-so-the.md`
**ADR:** `.docs/decisions/adr-2026-07-28-total-halt-classification-legacy-boundary.md`
**Stories:** `.docs/stories/most-conductor-halts-carry-no-class-sidecar-so-the.md`
**Conflict check:** Clean as of 2026-07-28
**Claims ledger:** `.pipeline/verify-claims-plan.md` — CLEAR

## Summary

This plan makes classification mandatory for every new engine-owned HALT, stamps pre-boundary
classless markers `legacy` under the daemon lock, and changes the re-kick sweep to retain malformed
current state. Seventeen TDD tasks cover the shared marker contract, migration, sweep policy, every
current writer funnel, and a deterministic bypass guard.

## Technical Approach

- Make `HaltClass` the two-value writable type (`needs-human | mechanical`) and add a distinct
  four-value read disposition (`HaltClass | legacy | unclassified`). The shared writer removes stale
  authority before replacing a body and atomically publishes the new class after the body.
- Add an idempotent migration that scans live worktree HALTs under exclusive daemon ownership,
  atomically stamps unreadable/missing pre-boundary classes as `legacy`, and records
  `.daemon/migrations/halt-classification-v1` only after the scan completes.
- Preserve the existing canonical re-kick machinery for `mechanical` and `legacy`; retain
  `needs-human` and `unclassified` before any abort, clear, sentinel, or SHA mutation.
- Route every production HALT creation through the required writer. Preserve deliberately explicit
  mechanical choices, classify every currently bare or mismatched path `needs-human`, and avoid
  overwriting an already-existing specific marker from generic fallback code.
- Add a deterministic integrity check so a future direct canonical HALT write fails local and CI
  validation. Tests use temporary files and injected collaborators only; no provider, GitHub, or
  live daemon boundary is exercised.

## Prerequisites

- The approved ADR supersedes ADR-013 for classification and compatibility policy.
- Stories are `Accepted`, conflict check has zero blocking/degrading conflicts, and the plan claims
  ledger is `CLEAR`.
- No package, service, schema, remote API, or data-store migration is required.

## Complete Writer-Classification Inventory

The source locations below are semantic funnels rather than brittle line numbers. `legacy` is
migration-only and is never accepted by the engine writer.

| Current production writer funnel | Target disposition | Rationale | Task |
| --- | --- | --- | --- |
| Operator OAuth preflight: timeout disabled; refresh wait timed out | `needs-human` | Credentials must be refreshed by the operator | 8 |
| Validation-group auth timeout; serial auth timeout; daemon build-token preflight | `needs-human` | Authentication remained unavailable after its bounded park window | 9 |
| Grouped and serial permission-review denial; daemon-runner terminal feature error | `needs-human` | Policy denial or terminal triage requires inspection/re-scoping | 10 |
| Manual-test no-op escalation; validation-member no-op escalation; validation no-verdict; validation-group unclassified terminal fallback | `needs-human` | Automated recovery was exhausted or produced no authoritative route | 11 |
| Progressing-build absolute ceiling; empty/missing-plan auto-park | `needs-human` | An absolute bound or explicit operator park has engaged | 12 |
| Build-stall remediation throw, misroute, human disposition, missing disposition; `writeStallHalt` degraded exits | `needs-human` | The remediation planner failed or explicitly requested judgment | 13 |
| Build-review, wiring-check, prd-audit, and finish/as-built no-op escalations | `needs-human` | Re-entry produced no progress and must not be recycled | 14 |
| Generic unattended hard failure; unexpected conductor exception; terminal-marker guarantee; stuck-gate selection cap | `needs-human` | These broad fallbacks cannot mechanically prove retry safety | 15 |
| Protected-artifact/machinery HALT with omitted class; build-review “needs a human” currently marked mechanical; prd-audit exhausted impl gap currently omitted; finish/as-built human outcome currently direct | `needs-human` | Correct omitted or semantically contradictory classifications | 16 |
| Merged-shipment evidence unavailable (`stopIfPrMerged`, rebase guard); deferred live-boundary violation; manual-test cap; build-stall remediation budget; test-suite cap; provider heartbeat watchdog | `mechanical` | Existing explicit retryable contracts are retained; base/play-forward or a fresh bounded dispatch can change the mechanical evidence | existing, verified by 16 |
| Validation/remediation human dispositions; stale-mirage scope halt; build-review/wiring cap; prd product/plan gap; kickback cap; rebase conflict/durable-evidence re-park; self-host release/version gates | `needs-human` | Existing explicit operator-required contracts remain unchanged | existing, verified by 16 |
| Pre-boundary live marker with no readable class | `legacy` | One-time compatibility stamp preserves historical retry behavior | 3–5 |

Generic group/hard-failure fallbacks preserve an existing classified HALT without rewriting it. They
create a new `needs-human` marker only when no specific marker already exists.

## Tasks

### Task 1: Require classification and make marker replacement fail closed

**Story:** Story 1 explicit writer contract
**Story:** Story 4 stale-sidecar and partial-write criteria
**Type:** infrastructure

**Steps:**

1. Write failing unit tests proving the class argument is required by typed callers, `legacy` is not
   writable, a stale sidecar is removed before a replacement body, class publication is atomic, and
   an interrupted class write leaves no retryable old class.
2. Run the halt-marker unit file and test typecheck; confirm RED.
3. Make `haltClass` required, remove the legacy omission branch, and implement stale-sidecar removal
   plus body-then-atomic-class publication with best-effort, fail-closed ordering.
4. Re-run the unit file and `npm run typecheck:test`; confirm GREEN.
5. Commit with message: `fix: require safe halt classification writes`.

**Files:** `src/conductor/src/engine/halt-marker.ts`, `src/conductor/test/engine/halt-marker.test.ts`

**Wired-into:** `src/conductor/src/index.ts#main`, `src/conductor/src/daemon-cli.ts#runDaemonMode`, `src/conductor/src/engine/step-runners.ts#dispatchProviderWithWatchdog`, `src/conductor/src/engine/rebase.ts#writeHalt`, `src/conductor/src/engine/self-host/gate-halt.ts#writeSelfHostHalt`

**Dependencies:** none

### Task 2: Separate writable classes from read dispositions

**Story:** Story 2 readable-class preservation; Story 3 disposition matrix
**Type:** happy-path

**Steps:**

1. Write failing unit tests for exact reads of `needs-human`, `mechanical`, and `legacy`, plus a typed
   assertion that the read result is distinct from the writable class type.
2. Run the halt-marker unit file; confirm RED on `legacy`.
3. Add the read-disposition type and return `legacy` only for its exact sidecar value while retaining
   tolerant `unclassified` reads for every other value/error.
4. Re-run the unit file and test typecheck; confirm GREEN.
5. Commit with message: `feat: model legacy halt disposition explicitly`.

**Files:** `src/conductor/src/engine/halt-marker.ts`, `src/conductor/test/engine/halt-marker.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Task 1

### Task 3: Stamp the compatibility boundary idempotently

**Story:** Story 2 migration happy paths
**Type:** infrastructure

**Steps:**

1. Write failing temporary-filesystem tests for first-run discovery of live unclassified HALTs,
   atomic `legacy` stamps, preservation of readable classes, completion-marker-last ordering, and a
   no-op second run.
2. Run the migration unit file; confirm RED because the migration surface does not exist.
3. Implement `migrateLegacyHaltClasses(projectRoot, worktreeBase, log)` and its migration-only atomic
   legacy stamper at `.daemon/migrations/halt-classification-v1`.
4. Re-run the migration unit file; confirm GREEN.
5. Commit with message: `feat: stamp legacy halt compatibility boundary`.

**Files:** `src/conductor/src/engine/halt-class-migration.ts`, `src/conductor/test/engine/halt-class-migration.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Task 2

### Task 4: Fail closed on interrupted or unwritable migration state

**Story:** Story 2 migration negative paths
**Type:** negative-path

**Steps:**

1. Add failing tests for an interrupted scan before the watermark, an individual stamp failure,
   malformed pre-boundary class content, and a bare marker created after the watermark.
2. Run the migration unit file; confirm the failure branches are RED.
3. Make retries idempotent, isolate/log per-slug stamp failure, leave failed stamps unclassified,
   and prevent an existing watermark from reclassifying later state.
4. Re-run the migration unit file; confirm GREEN with exact logs and marker assertions.
5. Commit with message: `fix: keep halt migration failures fail closed`.

**Files:** `src/conductor/src/engine/halt-class-migration.ts`, `src/conductor/test/engine/halt-class-migration.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Task 3

### Task 5: Run migration under daemon ownership before normal work

**Story:** Story 2 lock and startup-order criteria
**Type:** happy-path

**Steps:**

1. Write a failing startup-order test with injected collaborators that records lock acquisition,
   worktree-base creation, migration, discovery, and re-kick calls.
2. Run the focused daemon wiring test; confirm migration is absent/RED.
3. Invoke migration in `runDaemonMode` after lock ownership and worktree-base creation but before
   backlog discovery, dispatch, or sweep setup can perform normal work.
4. Re-run the focused test, including the lock-acquisition-failure branch; confirm GREEN and no
   migration/normal-work calls without ownership.
5. Commit with message: `feat: migrate halt classes before daemon work`.

**Files:** `src/conductor/src/daemon-cli.ts`, `src/conductor/test/engine/daemon-cli-halt-migration-wiring.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Task 4

### Task 6: Apply the four-way re-kick disposition matrix

**Story:** Story 3 retry/retain happy paths and malformed-state negative path
**Type:** happy-path

**Steps:**

1. Write failing sweep tests asserting `mechanical` and `legacy` clear through the canonical path,
   while `needs-human` and every unclassified form are retained and logged by slug/disposition.
2. Run the daemon-rekick unit file; confirm RED for `legacy` and unclassified retention.
3. Extend the injected read contract and sweep branch so only `mechanical`/`legacy` reach the existing
   SHA, abort, clear, sentinel, and rebase-first path.
4. Re-run the daemon-rekick unit file; confirm GREEN.
5. Commit with message: `fix: retain unclassified halts during re-kick`.

**Files:** `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`, `src/conductor/src/daemon-cli.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`

**Dependencies:** Task 2

### Task 7: Prove retained state has no retry side effects

**Story:** Story 3 negative guards
**Story:** Story 4 clear idempotency
**Type:** negative-path

**Steps:**

1. Add failing matrix tests proving unclassified/needs-human state performs no rebase abort, clear,
   sentinel, last-SHA update, or eligibility mutation; retain park/processed precedence and
   once-per-SHA behavior for retryable classes.
2. Run the daemon-rekick unit file; confirm any uncovered side-effect branch is RED.
3. Tighten sweep ordering and canonical clear cleanup only where the tests expose leakage; keep
   repeated class-sidecar cleanup idempotent.
4. Re-run the focused file plus operator-park and shipped-skip acceptance files; confirm GREEN.
5. Commit with message: `test: pin fail-closed re-kick side effects`.

**Files:** `src/conductor/src/engine/daemon-rekick.ts`, `src/conductor/test/engine/daemon-rekick.test.ts`, `src/conductor/test/acceptance/operator-park-rekick-sweep.acceptance.test.ts`, `src/conductor/test/acceptance/rekick-shipped-skip.acceptance.test.ts`

**Wired-into:** same as Task 6

**Dependencies:** Task 6

### Task 8: Classify operator OAuth preflight HALTs

**Story:** Story 1 complete writer inventory — OAuth preflight row
**Type:** refactor

**Steps:**

1. Add failing focused tests asserting `needs-human` sidecars for immediate opt-out and timed-out
   operator OAuth preflight, while an existing classified marker remains untouched.
2. Run the targeted conductor tests; confirm RED on the missing sidecars.
3. Replace both direct body writes with the required writer and preserve the existing-marker guard.
4. Re-run the focused tests; confirm GREEN.
5. Commit with message: `fix: classify operator oauth preflight halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 9: Classify authentication timeout and build-token HALTs

**Story:** Story 1 complete writer inventory — authentication row
**Type:** refactor

**Steps:**

1. Add failing tests for grouped auth timeout, serial auth timeout, and daemon build-token preflight,
   asserting exact `needs-human` sidecars and preserved reasons.
2. Run the focused conductor and build-auth-preflight files; confirm RED.
3. Route all three funnels through the required classified writer without changing their durable
   state/event ordering.
4. Re-run the focused files; confirm GREEN.
5. Commit with message: `fix: classify authentication timeout halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/self-host/build-auth-preflight.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/self-host/build-auth-preflight.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 10: Classify permission denials and daemon terminal errors

**Story:** Story 1 complete writer inventory — permission/error row
**Type:** refactor

**Steps:**

1. Add failing focused tests for grouped and serial permission denials plus daemon-runner terminal
   triage, asserting `needs-human` and unchanged diagnostic bodies.
2. Run the narrow conductor and daemon-runner tests; confirm RED.
3. Replace the three direct writes with the shared classified writer while retaining best-effort
   logging and original error preservation.
4. Re-run the focused files; confirm GREEN.
5. Commit with message: `fix: classify permission and daemon error halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/daemon-runner.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/daemon.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 11: Classify validation-group terminal funnels

**Story:** Story 1 complete writer inventory — validation-group row
**Type:** refactor

**Steps:**

1. Add failing focused tests for manual-test no-op, validation-member no-op, no-verdict, and generic
   non-green fallback; assert each new marker is `needs-human` and a prior specific marker/class is
   preserved by the fallback.
2. Run the validation-group acceptance file; confirm RED.
3. Replace the four direct writes with required classified calls and make generic fallback creation
   conditional on no existing marker.
4. Re-run the focused acceptance file; confirm GREEN with unchanged event/state order.
5. Commit with message: `fix: classify validation group terminal halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/parallel-validation-phase-fan-out-manual-test-prd-.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 12: Classify build ceilings and auto-park HALTs

**Story:** Story 1 complete writer inventory — build ceiling/park row
**Type:** refactor

**Steps:**

1. Add failing tests for the absolute progress-attempt ceiling and empty/missing-plan auto-park,
   asserting `needs-human` while preserving resolved-count stamps and park markers.
2. Run the progress-halt and daemon-auto-park focused files; confirm RED.
3. Route both body writes through the required classified writer without changing counter/state/event
   ordering.
4. Re-run the focused files; confirm GREEN.
5. Commit with message: `fix: classify build ceiling and auto park halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/daemon-halts-a-build-that-is-making-forward-progre.acceptance.test.ts`, `src/conductor/test/engine/daemon-auto-park.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 13: Classify degraded build-stall remediation exits

**Story:** Story 1 complete writer inventory — stall remediation row
**Type:** refactor

**Steps:**

1. Add failing unit/acceptance assertions for remediation throw, misroute, human disposition,
   missing disposition, and the shared `writeStallHalt` helper; each must persist `needs-human` and
   keep the question as the first non-empty line.
2. Run the task-progress and stall-remediation focused files; confirm RED.
3. Make `writeStallHalt` delegate to the classified writer and replace the four remaining direct
   conductor writes without changing remediation/state/event ordering.
4. Re-run the focused files; confirm GREEN.
5. Commit with message: `fix: classify degraded stall remediation halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/task-progress.ts`, `src/conductor/test/engine/task-progress.test.ts`, `src/conductor/test/acceptance/daemon-mode-route-halt-user-input-required-through.acceptance.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 14: Classify no-progress gate escalations

**Story:** Story 1 complete writer inventory — gate no-op row
**Type:** refactor

**Steps:**

1. Add failing sidecar assertions for build-review, wiring-check, prd-audit, and finish/as-built
   kickback-to-build no-op HALTs.
2. Run the kickback-ledger and wiring gate-loop files; confirm RED.
3. Replace the four direct marker writes with `needs-human` classified calls while preserving ledger,
   remediation PR, event, and signal-detach order.
4. Re-run the focused files; confirm GREEN.
5. Commit with message: `fix: classify no progress gate halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-kickback-ledger.test.ts`, `src/conductor/test/wiring-gate-loop.test.ts`, `src/conductor/test/integration/gate-loop.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 15: Classify generic terminal safeguards

**Story:** Story 1 complete writer inventory — generic terminal row
**Type:** refactor

**Steps:**

1. Add failing focused tests for generic unattended hard failure, unexpected conductor exception,
   terminal-marker guarantee, and stuck-gate cap; assert `needs-human` and preservation of an
   existing specific marker/class.
2. Run the conductor and gate-loop files; confirm RED.
3. Route all four fallback creations through the classified writer and avoid rewriting any existing
   classified HALT.
4. Re-run the focused files; confirm GREEN.
5. Commit with message: `fix: classify generic conductor terminal halts`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/integration/gate-loop.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 16: Correct omitted and contradictory typed writer calls

**Story:** Story 1 totality/default-human criterion and reviewed existing-writer inventory
**Type:** refactor

**Steps:**

1. Add failing tests for protected-artifact/machinery HALT, build-review human remediation,
   prd-audit exhausted implementation gap, and finish/as-built human remediation; assert each is
   `needs-human`. Add regression assertions for every deliberately retained `mechanical` funnel.
2. Run the focused attribution, build-review, prd-audit, and step-runner tests; confirm RED where the
   class is omitted or contradictory.
3. Supply/correct the explicit classes and convert the remaining direct human-outcome write; do not
   change the reviewed mechanical calls.
4. Re-run the focused files plus test typecheck; confirm GREEN and no omitted class arguments.
5. Commit with message: `fix: correct halt writer dispositions`.

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/attribution-enforcement.test.ts`, `src/conductor/test/engine/build-review-halt-wiring.test.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/step-runners.test.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 17: Reject future direct canonical HALT writes

**Story:** Story 1 deterministic bypass guard and complete-inventory Done When
**Type:** negative-path

**Steps:**

1. Add a failing integrity fixture/check that reports a production source path which writes the
   canonical HALT body outside `halt-marker.ts`, including constant, multiline, alias-variable, and
   literal-path spellings.
2. Run the new check against a controlled violating fixture and then the repository; confirm RED
   until Tasks 8–16 have removed all bypasses.
3. Implement the deterministic source scan, allow only the canonical writer implementation, and wire
   it into `test/test_harness_integrity.sh`.
4. Run the standalone check, shell lint, and full integrity script; confirm GREEN and zero production
   bypasses.
5. Commit with message: `test: enforce classified halt writer totality`.

**Files:** `test/check_halt_writers.sh`, `test/test_harness_integrity.sh`

**Wired-into:** none (no new production surface)

**Dependencies:** Tasks 8, 9, 10, 11, 12, 13, 14, 15, 16

## Task Dependency Graph

```text
Task 1 ─┬─> Task 2 ─┬─> Task 3 ─> Task 4 ─> Task 5 ───────────┐
        │           └─> Task 6 ─> Task 7 ─────────────────────┤
        ├─> Tasks 8–16 ────────────────────────> Task 17 ─────┤
        └──────────────────────────────────────────────────────┘
                                                               ↓
                                                    final verification gate
```

The graph is acyclic. Tasks 8–16 may run independently after Task 1; Task 17 waits for all writer
conversions so the repository scan can pass.

## Integration Points

- After Task 5: startup owns an explicit, one-time legacy boundary before normal daemon work.
- After Task 7: all four read dispositions have complete retry/retain behavior with existing guards.
- After Tasks 8–16: every current production writer carries its reviewed class through one contract.
- After Task 17: type checking plus repository integrity mechanically rejects both omission and
  bypass.

## Story Coverage

| Story acceptance surface | Tasks |
| --- | --- |
| Story 1 — required classes, allowed values, ambiguous-default-human, complete writer inventory | 1, 8–17 |
| Story 1 negatives — omitted/legacy type rejection, direct-write rejection, unreviewed writer rejection | 1, 16, 17 |
| Story 2 — pre-boundary stamping, preservation, watermark, lock/order | 2–5 |
| Story 2 negatives — no lock, interrupted scan, failed stamp, post-boundary bare marker | 4–5 |
| Story 3 — mechanical/legacy retry; needs-human/unclassified retain and diagnostics | 2, 6 |
| Story 3 negatives — no retry side effects, once-per-SHA, park/processed precedence | 7 |
| Story 4 — stale-sidecar replacement and body/class ordering | 1 |
| Story 4 negatives — partial publication fail-closed and idempotent clear | 1, 7 |

## Verification

- [ ] Run each changed Vitest file narrowly while authoring; no real provider, GitHub, network, or
      daemon process is reachable.
- [ ] Run `npm run typecheck:test` and `npm run lint` from `src/conductor`.
- [ ] Run affected neighboring acceptance files together to expose leaked mocks/listeners/state.
- [ ] Run `test/test_harness_integrity.sh` as the repository aggregate gate and keep it under five
      minutes.
- [ ] Confirm the writer guard reports zero production bypasses and a source-path diagnostic for its
      violating fixture.
- [ ] Confirm every happy and negative story criterion maps to the task table above.
- [ ] Confirm every task is bounded to one 2–5 minute TDD slice and dependencies remain explicit and
      acyclic.
