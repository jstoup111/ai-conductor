# Implementation Plan: Codex readiness park #970

**Date:** 2026-07-26  
**Design:** `.docs/decisions/adr-2026-07-26-codex-auth-evidence-and-recovery-backoff.md`  
**Stories:** `.docs/stories/codex-readiness-park-970.md`  
**Conflict check:** Clean as of 2026-07-26

## Summary

This 12-task plan corrects mixed-health Codex readiness, adds deadline-safe cached-login backoff
and sanitized progress telemetry, and proves the behavior across every dispatch shape. Related
criteria that exercise the same production seam share one table-driven TDD task.

## Technical Approach

- Extend `AuthenticationReadiness` with a closed optional degradation discriminator. Accept exact,
  supported `auth.credentials.status: ok` independently of `overallStatus`; retain fail-closed
  classification for every negative or ambiguous auth shape.
- Keep timing in `Conductor.parkOnAuthFailure`: check immediately, then schedule 1/2/4/8/16/30
  second delays capped by both 30 seconds and the existing absolute deadline. Existing callers
  continue to own resume, so no retry or fallback counter is introduced.
- Add a closed `credentials_park_progress` event. Emit it on sanitized state changes and no more
  than once per 60 seconds while unchanged. Persist it through `EventPersister`, render it through
  `TerminalRenderer.handle`, and deliberately classify it in audit completeness without widening
  the retro friction-record schema.
- Prove component behavior before cross-dispatch and #254-shaped acceptance behavior.

## Prerequisites

- Work only in `.worktrees/codex-readiness-park-970` on `spec/codex-readiness-park-970`.
- Refresh the high-contention adapter signatures/overlap report against `main` immediately before
  BUILD, as required by the approved architecture review.
- Run `/writing-system-tests` before implementation so acceptance-level RED evidence exists.

## Tasks

### Task 1: Classify supported ready evidence independently from overall health
**Story:** Story 1 HP-1, HP-2
**Type:** happy-path

**Steps:**
1. Write failing table-driven tests for auth `ok` under mixed overall failure and all-green health.
2. Verify RED: mixed health is currently `unverifiable`.
3. Extend the readiness metadata and documented-evidence classifier with a closed unrelated-degradation discriminator; omit it for all-green health.
4. Verify both rows are `ready`, raw summaries are absent, and exactly one invocation proceeds (GREEN).
5. Commit with message: `fix: trust supported Codex auth evidence in mixed health`

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.readiness`
**Dependencies:** none

### Task 2: Preserve the complete fail-closed readiness matrix
**Story:** Story 1 NP-1, NP-2, NP-4; Story 4 NP-1
**Type:** negative-path

**Steps:**
1. Add failing rows for missing/rejected/unauthorized/expired, absent/malformed auth, unknown status/schema, source conflict, and overall-green ambiguous auth evidence.
2. Verify RED for any row that becomes ready or begins substantive work.
3. Tighten structural validation and explicit auth-failure precedence without interpreting unrelated provider summaries.
4. Verify exact `missing`/`unusable`/`unverifiable` states, no raw detail, and zero invocation for initial and adjacent-step cases (GREEN).
5. Commit with message: `test: preserve fail-closed Codex readiness matrix`

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`, `src/conductor/test/acceptance/codex-auth-sandbox-readiness.acceptance.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Preserve actual completion-failure precedence after mixed readiness
**Story:** Story 1 NP-3; Story 4 NP-2
**Type:** negative-path

**Steps:**
1. Add failing acceptance rows where mixed-health readiness is followed by either a real auth rejection or a non-auth network/provider failure.
2. Verify RED if provider/source identity is lost, auth rejection falls back, or the non-auth failure is relabeled and parked.
3. Keep readiness degradation metadata out of completion classification; route only explicit auth rejection to the existing same-source park.
4. Verify one park with zero fallback for auth rejection and the original non-auth disposition with zero park events otherwise (GREEN).
5. Commit with message: `test: preserve Codex completion failure precedence`

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/codex-auth-sandbox-readiness.acceptance.test.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.parkOnAuthFailure`
**Dependencies:** Task 1, Task 2

### Task 4: Back off cached-login probes and resume at any rung
**Story:** Story 2 HP-1, HP-2
**Type:** happy-path

**Steps:**
1. Add failing injected clock/sleep tests for immediate check, 1/2/4/8/16/30/capped waits, and ready-at-each-rung return.
2. Verify RED against fixed one-second polling.
3. Implement cached-login-only exponential scheduling while retaining the existing absolute timeout owner.
4. Verify exact cadence, immediate resume after readiness, and unchanged retry/effort/model/provider/source counters (GREEN).
5. Commit with message: `fix: back off Codex cached-login recovery probes`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.parkOnAuthFailure`
**Dependencies:** Task 1

### Task 5: Enforce deadline and disabled-timeout boundaries
**Story:** Story 2 NP-1, NP-2
**Type:** negative-path

**Steps:**
1. Add failing fake-clock rows for a final interval longer than remaining time and zero/negative timeout.
2. Verify RED for oversleep, deadline extension, repeated disabled probing, or normal retry.
3. Clamp sleeps to non-negative remaining time and short-circuit disabled parks through the existing source-specific terminal disposition.
4. Verify exact deadline, sanitized timeout HALT, and no repeated disabled loop (GREEN).
5. Commit with message: `fix: bound Codex auth recovery by its deadline`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 6: Isolate cached-login cadence from API-key and Claude recovery
**Story:** Story 2 NP-3
**Type:** negative-path

**Steps:**
1. Add characterization rows for Codex API-key restart-required and Claude daemon-token/operator-OAuth probe, sleep, reload, timeout, event, and remediation traces.
2. Verify the tests detect accidental use of the cached-login scheduler.
3. Keep the new cadence strictly inside the Codex cached-login guard.
4. Verify all pre-existing recovery traces remain behaviorally unchanged (GREEN).
5. Commit with message: `test: isolate Codex cached-login backoff`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** same as Task 4
**Dependencies:** Task 4

### Task 7: Add the typed progress event to every consumer
**Story:** Story 3 HP-1, HP-2; Story 3 NP-3
**Type:** infrastructure

**Steps:**
1. Add failing union, JSONL persistence, terminal rendering, and exhaustive audit-classification fixtures for `credentials_park_progress`.
2. Verify RED through missing subscriptions/branches and exhaustive fixture coverage.
3. Add the closed fields, subscribe/persist/render the variant, and mark it deliberately `not-audited-by-design` in the retro audit contract.
4. Verify typed fields persist/render and no exhaustive consumer drops or crashes on the event (GREEN).
5. Commit with message: `feat: add Codex credential park progress event`

**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-persister.ts`, `src/conductor/src/ui/terminal-renderer.ts`, `src/conductor/test/engine/event-persister.test.ts`, `src/conductor/test/ui/terminal-renderer.test.ts`, `src/conductor/test/integration/audit-trail-completeness.integration.test.ts`
**Wired-into:** `src/conductor/src/engine/event-persister.ts#EventPersister.start`, `src/conductor/src/ui/dispatch.ts#dispatchRenderers`
**Dependencies:** Task 1

### Task 8: Emit one lifecycle start and independently rate-limit progress
**Story:** Story 3 HP-3; Story 3 NP-1, NP-4
**Type:** negative-path

**Steps:**
1. Add failing event-sequence fake-clock rows for multiple probes, sanitized state changes, and unchanged sub-60-second probes.
2. Verify RED for duplicate `credentials_park` starts or excess unchanged progress.
3. Emit lifecycle start outside the loop; track last emitted sanitized state/time independently from probe cadence and emit state changes immediately.
4. Verify one start, immediate changed-state events, and at-most-once-per-60-second unchanged events without changing subprocess timing (GREEN).
5. Commit with message: `feat: rate limit Codex credential park progress`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor.parkOnAuthFailure`
**Dependencies:** Task 4, Task 7

### Task 9: Prove progress confidentiality across every output sink
**Story:** Story 3 NP-2
**Type:** negative-path

**Steps:**
1. Add adversarial doctor stdout/stderr, summaries, paths, tokens, fragments, upstream names, and arbitrary text to event/log/audit/HALT assertions.
2. Verify RED if any raw value crosses the provider boundary or if numeric fields escape configured bounds.
3. Restrict degradation and progress construction to closed literals and bounded non-negative numbers.
4. Verify events, persisted JSONL, terminal rendering, audit classification, state, and HALT contain no raw fragments (GREEN).
5. Commit with message: `test: sanitize Codex park progress end to end`

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/execution/codex-provider.test.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`, `src/conductor/test/engine/event-persister.test.ts`, `src/conductor/test/ui/terminal-renderer.test.ts`
**Wired-into:** same as Task 8
**Dependencies:** Task 2, Task 7, Task 8

### Task 10: Exhaust recovery without dispatching alternatives
**Story:** Story 2 NP-4; Story 4 NP-4
**Type:** negative-path

**Steps:**
1. Add a failing timeout matrix for serial, grouped, judgment, and auxiliary recovery with dispatch/counter/event spies.
2. Verify RED for any substantive, completed-sibling, retry-rung, model-rung, provider, or alternate-source dispatch.
3. Preserve the shared coordinator's timeout return contract and sanitized provider/source terminal disposition across callers.
4. Verify identical terminal behavior and zero retry/escalation/fallback consumption in all shapes (GREEN).
5. Commit with message: `test: preserve zero-budget Codex auth timeout`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
**Wired-into:** same as Task 4
**Dependencies:** Task 5, Task 6, Task 8

### Task 11: Resume only the failed grouped member
**Story:** Story 4 HP-2, NP-3
**Type:** negative-path

**Steps:**
1. Add a failing grouped trace with one completed sibling and one auth-failed member that becomes ready on a scheduled recheck.
2. Verify RED if the completed index reruns, the failed member skips fresh readiness, or a different provider/source dispatches.
3. Preserve the existing failed-index resume seam while using the shared backed-off coordinator.
4. Verify only the failed member resumes once and completed work remains completed (GREEN).
5. Commit with message: `test: resume only failed Codex group member`

**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
**Wired-into:** same as Task 4
**Dependencies:** Task 4, Task 10

### Task 12: Prove adjacent and auxiliary dispatch parity
**Story:** Story 4 HP-1, HP-2; TI-6 canary Done When
**Type:** happy-path

**Steps:**
1. Add a failing #254-shaped BUILD-then-`build_review` scenario plus serial/judgment/auxiliary recovery traces.
2. Verify RED if the adjacent mixed-health step parks, changes source, or any dispatch shape bypasses shared recovery/progress.
3. Complete only the minimal shared wiring needed for every path to use the corrected readiness and coordinator.
4. Verify adjacent success under the same cached login, failed-work-only resume, durable progress, and zero fallback counters (GREEN).
5. Commit with message: `test: prove Codex readiness parity across dispatch shapes`

**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/engine/conductor.ts`, `src/conductor/test/acceptance/codex-auth-sandbox-readiness.acceptance.test.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.readiness`, `src/conductor/src/engine/conductor.ts#Conductor.parkOnAuthFailure`
**Dependencies:** Task 3, Task 9, Task 10, Task 11

## Task Dependency Graph

```text
1 -> 2 -> 3 ---------------------------> 12
|    |    `------------------------------^
|    `-----------------> 9 --------------^
|                       ^
|-> 4 -> 5 -> 10 -> 11 -----------------^
|    `-> 6 -> 10
`-> 7 -> 8 -> 9
          `-> 10
```

## Integration Points

- After Task 3: readiness and real completion failure precedence form a stable provider slice.
- After Task 8: classification, backed-off recovery, persistence, rendering, and progress cadence
  form one component-level vertical slice.
- After Task 10: deadline, provider/source, confidentiality, and zero-budget timeout invariants are
  proven across dispatch shapes.
- After Task 12: the #254 canary shape and every shared recovery caller are acceptance-tested.

## Acceptance-Criteria Coverage

| Story | Criterion | Task(s) |
|---|---|---|
| 1 | HP-1, HP-2 | 1 |
| 1 | NP-1, NP-2, NP-4 | 2 |
| 1 | NP-3 | 3 |
| 2 | HP-1, HP-2 | 4 |
| 2 | NP-1, NP-2 | 5 |
| 2 | NP-3 | 6 |
| 2 | NP-4 | 10 |
| 3 | HP-1, HP-2 | 7 |
| 3 | HP-3 | 8 |
| 3 | NP-1, NP-4 | 8 |
| 3 | NP-2 | 9 |
| 3 | NP-3 | 7 |
| 4 | HP-1 | 12 |
| 4 | HP-2 | 11, 12 |
| 4 | NP-1 | 2 |
| 4 | NP-2 | 3 |
| 4 | NP-3 | 11 |
| 4 | NP-4 | 10 |

## Verification

- [x] Every happy and negative criterion maps to a task; each negative scenario is named explicitly
      in its task's story reference and test matrix.
- [x] Related cases are consolidated by production seam; no catch-all cleanup task remains.
- [x] Every task has authoritative repo-relative files, wiring, and explicit dependencies.
- [x] Dependencies are explicit and acyclic.
- [x] Task count is 12, within the normal 1–20 scope band.
- [x] No task adds ordinary documentation work.
