# Implementation Plan: Bounded Provider Preparation Lifecycle

**Date:** 2026-07-30
**Design:** `.docs/decisions/adr-2026-07-30-provider-preparation-lifecycle-supervision.md`
**Stories:** `.docs/stories/daemon-build-review-can-wedge-before-provider-laun.md`
**Conflict check:** Clean as of 2026-07-30
**Source:** `jstoup111/ai-conductor#1141`

## Summary

Implement a provider-neutral lifecycle supervisor that bounds only the pre-spawn phase at five
minutes, permits one persisted replacement, fences superseded attempts before process creation,
and makes post-spawn activity telemetry-only. Twenty narrowly scoped TDD tasks reuse the existing
provider interval/event infrastructure and preserve all provider/model fallback semantics.

## Technical Approach

- Add a discriminated provider lifecycle state and an atomic feature-local episode store. The
  record keys authority by logical step and attempt identity, persists one recovery across daemon
  restarts, and resets only after authoritative clean settlement.
- Add a timer-injected supervisor around the existing shared provider candidate boundary. It begins
  before candidate/session/self-host preparation and stops its deadline at acknowledged spawn.
- Extend the provider contract with an explicit lifecycle capability and synchronous spawn permit.
  Built-in adapters check the permit immediately before their subprocess factory. Unsupported
  providers fail closed before invocation.
- Reuse engine-observed intervals and feature events for lifecycle timing/visibility. Preparation
  phase evidence augments rather than replaces the existing provider-active/no-provider-active
  partition.
- Remove all output-silence termination authority. Activity heartbeat data remains observational.
- Add `provider_preparation_timeout_minutes`, default `5`, as an independent config field. Never
  reinterpret `step_heartbeat_stall_minutes`.

## Prerequisites

- The approved ADR remains authoritative.
- Tests use injected clocks, timers, providers, subprocess factories, and temporary directories.
- No ordinary test invokes Claude, Codex, GitHub, a network service, or the aggregate test command.

## Tasks

### Task 1: Define provider lifecycle states and legal transitions

**Story:** TI-1 lifecycle phases; TI-2 timeout/spawn authority
**Type:** infrastructure

**Steps:**
1. Write failing unit tests for `preparing → running`, `preparing → recovering`, and terminal
   settlement, including rejected stale/reversed transitions.
2. Verify RED with the focused lifecycle-state test file.
3. Implement discriminated state types, attempt identity, recovery count, and exhaustive transition
   helpers in a dedicated module.
4. Verify GREEN and TypeScript exhaustiveness.
5. Commit with message: `feat(engine): define provider lifecycle state machine`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/test/engine/provider-lifecycle.test.ts`

**Wired-into:** `src/conductor/src/engine/provider-lifecycle.ts#createProviderLifecycleSupervisor`

**Dependencies:** none

### Task 2: Validate the preparation-timeout configuration

**Story:** TI-6 default, override, invalid, and legacy-only configuration
**Type:** happy-path

**Steps:**
1. Write failing config tests for default `5`, positive override, zero/negative opt-out behavior,
   invalid values, and a legacy config containing only `step_heartbeat_stall_minutes`.
2. Verify RED in config validation/resolution tests.
3. Add `provider_preparation_timeout_minutes` to the typed schema, allowlist, validation, and
   resolver without reading the heartbeat key.
4. Verify GREEN and test-inclusive typecheck.
5. Commit with message: `feat(config): add provider preparation timeout`.

**Files:**
- `src/conductor/src/types/config.ts`
- `src/conductor/src/engine/config.ts`
- `src/conductor/src/engine/resolved-config.ts`
- `src/conductor/test/config-validation.test.ts`
- `src/conductor/test/engine/resolved-config.test.ts`

**Wired-into:** `src/conductor/src/engine/resolved-config.ts#resolveProviderPreparationTimeoutMinutes`

**Dependencies:** none

### Task 3: Persist lifecycle episodes atomically

**Story:** TI-3 restart persistence and per-step reset
**Type:** infrastructure

**Steps:**
1. Write failing temporary-directory tests for absent, current, completed, and per-step lifecycle
   episode records.
2. Verify RED.
3. Implement atomic temp-write/rename persistence under `.pipeline/`, scoped by logical step and
   attempt identity.
4. Verify GREEN, including awaited cleanup of every temporary directory.
5. Commit with message: `feat(engine): persist provider lifecycle episodes`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle-store.ts`
- `src/conductor/test/engine/provider-lifecycle-store.test.ts`

**Wired-into:** `src/conductor/src/engine/provider-lifecycle.ts#createProviderLifecycleSupervisor`

**Dependencies:** Task 1

### Task 4: Fail closed on malformed lifecycle evidence

**Story:** TI-3 malformed/unreadable restart state
**Type:** negative-path

**Steps:**
1. Add failing tests for malformed JSON, unknown versions/states, impossible recovery counts, and
   interrupted temp files.
2. Verify RED.
3. Implement typed parse results that deny fresh recovery authority on ambiguous current evidence
   while tolerating unrelated stale temp files.
4. Verify GREEN.
5. Commit with message: `fix(engine): fail closed on invalid lifecycle evidence`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle-store.ts`
- `src/conductor/test/engine/provider-lifecycle-store.test.ts`

**Wired-into:** same as Task 3

**Dependencies:** Task 3

### Task 5: Begin preparation supervision before candidate work

**Story:** TI-1 preparing visibility; TI-2 bounds candidate/session/self-host preparation
**Type:** happy-path

**Steps:**
1. Write failing fake-clock tests proving `preparing` begins before the supplied candidate closure
   executes and records the five-minute deadline.
2. Verify RED.
3. Implement the timer-injected supervisor entrypoint and preparation lease.
4. Verify GREEN with no real waits.
5. Commit with message: `feat(engine): supervise provider preparation`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/test/engine/provider-lifecycle.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#dispatchProviderWithLifecycleSupervision`

**Dependencies:** Task 1, Task 2, Task 3

### Task 6: Revoke a timed-out preparation attempt before replacement

**Story:** TI-2 deadline-first behavior and late resume
**Type:** negative-path

**Steps:**
1. Add failing controlled-promise tests where preparation exceeds its deadline and later resumes.
2. Verify RED.
3. Implement revocation-before-recovery ordering and stale-result suppression.
4. Verify GREEN, including full settlement of controlled promises and timers.
5. Commit with message: `feat(engine): revoke timed-out provider preparation`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/test/engine/provider-lifecycle.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 5

### Task 7: Permit exactly one persisted replacement

**Story:** TI-2 one automatic replacement; TI-3 restart persistence
**Type:** happy-path

**Steps:**
1. Add failing tests for first-timeout replacement, daemon-restart reload, and successful replacement
   result propagation.
2. Verify RED.
3. Implement recovery-count persistence before replacement dispatch and preserve the replacement’s
   real result.
4. Verify GREEN.
5. Commit with message: `feat(engine): bound provider preparation recovery`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/src/engine/provider-lifecycle-store.ts`
- `src/conductor/test/engine/provider-lifecycle.test.ts`
- `src/conductor/test/engine/provider-lifecycle-store.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 4, Task 6

### Task 8: Halt needs-human after replacement exhaustion

**Story:** TI-3 repeated preparation failure
**Type:** negative-path

**Steps:**
1. Add failing tests asserting the second timeout writes a `needs-human` HALT with step, phase,
   attempt identity, elapsed time, and recovery count.
2. Verify RED.
3. Connect exhaustion to `writeHaltMarker` and return a terminal provider result without starting a
   third attempt.
4. Verify GREEN and exact diagnostic fields.
5. Commit with message: `feat(engine): halt exhausted provider preparation`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/src/engine/halt-marker.ts`
- `src/conductor/test/engine/provider-lifecycle.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runConductorInWorktree`

**Dependencies:** Task 7

### Task 9: Keep exhausted lifecycle HALTs parked

**Story:** TI-3 re-kick and rediscovery negative paths
**Type:** negative-path

**Steps:**
1. Add failing daemon re-kick tests for a lifecycle-exhaustion `needs-human` HALT.
2. Verify RED if any existing path clears or re-dispatches it.
3. Make the smallest classification/wiring change required; if current shared behavior already
   passes, record a verify-only evidence commit instead of changing production code.
4. Verify GREEN with the focused re-kick suite.
5. Commit with message: `test(daemon): retain exhausted lifecycle halts`.

**Files:**
- `src/conductor/src/engine/daemon-rekick.ts`
- `src/conductor/test/engine/daemon-rekick.test.ts`

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 8

### Task 10: Add the provider lifecycle capability contract

**Story:** TI-5 provider capability and revoked permit
**Type:** infrastructure

**Steps:**
1. Write failing contract tests for capability declaration, current permit, and revoked permit.
2. Verify RED.
3. Extend provider runtime/options with an explicit lifecycle capability and synchronous
   pre-spawn permit that returns a typed denial.
4. Verify GREEN and test-inclusive typecheck.
5. Commit with message: `feat(provider): define lifecycle spawn permit`.

**Files:**
- `src/conductor/src/execution/llm-provider.ts`
- `src/conductor/src/engine/provider-runtime.ts`
- `src/conductor/test/engine/provider-runtime.test.ts`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`

**Dependencies:** Task 1

### Task 11: Enforce the spawn permit in Claude

**Story:** TI-5 Claude happy path and revoked-permit negative path
**Type:** happy-path

**Steps:**
1. Add failing Claude adapter tests asserting the permit is checked immediately before the injected
   subprocess factory and denial creates no child.
2. Verify RED.
3. Declare the capability and enforce the synchronous permit before `execa`.
4. Verify GREEN with a fake subprocess factory only.
5. Commit with message: `feat(provider): fence Claude process spawn`.

**Files:**
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/test/execution/claude-provider.test.ts`

**Wired-into:** `src/conductor/src/execution/claude-provider.ts#runClaude`

**Dependencies:** Task 10

### Task 12: Enforce the spawn permit in Codex

**Story:** TI-5 Codex happy path and revoked-permit negative path
**Type:** happy-path

**Steps:**
1. Add failing Codex adapter tests covering readiness-before-spawn, permit denial, and no subprocess
   factory call after revocation.
2. Verify RED.
3. Declare the capability and check the permit immediately before Codex process creation.
4. Verify GREEN with injected doctor and subprocess fakes.
5. Commit with message: `feat(provider): fence Codex process spawn`.

**Files:**
- `src/conductor/src/execution/codex-provider.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`

**Dependencies:** Task 10

### Task 13: Fail closed for unsupported providers before invocation

**Story:** TI-5 custom-provider compatibility and diagnostics
**Type:** negative-path

**Steps:**
1. Add failing provider-execution tests for an unsupported provider and a compatible custom fake.
2. Verify RED.
3. Gate daemon candidate invocation on lifecycle capability, emitting provider, missing capability,
   and recovery action without calling `invoke`.
4. Verify GREEN and preserve supported custom-provider behavior.
5. Commit with message: `feat(provider): reject unfenced daemon providers`.

**Files:**
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#executeProviderCandidates`

**Dependencies:** Task 10

### Task 14: Wire lifecycle supervision through the shared step boundary

**Story:** TI-1 all phases; TI-2 all pre-spawn awaits; TI-5 capability propagation
**Type:** infrastructure

**Steps:**
1. Add failing `DefaultStepRunner` tests proving representative DECIDE, BUILD, and SHIP steps enter
   the same lifecycle supervisor.
2. Verify RED.
3. Replace the existing watchdog wrapper with a thin call to the lifecycle supervisor and pass the
   permit through candidate execution.
4. Verify GREEN without broad `Conductor.run()` fixtures.
5. Commit with message: `feat(engine): wire provider lifecycle supervisor`.

**Files:**
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/engine/step-runners.test.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#executeProviderAwareOneShotCore`

**Dependencies:** Task 5, Task 7, Task 8, Task 11, Task 12, Task 13

### Task 15: Preserve fallback inside one lifecycle attempt

**Story:** TI-2 candidate fallback interaction; TI-5 unsupported-candidate fallback
**Type:** negative-path

**Steps:**
1. Add failing provider-execution tests for model fallback, cross-provider fallback, and an
   unsupported first candidate followed by a supported candidate.
2. Verify RED against lifecycle attempt and recovery counts.
3. Ensure candidate transitions share one active permit/deadline and do not consume the lifecycle
   replacement budget.
4. Verify GREEN alongside existing provider-policy tests.
5. Commit with message: `fix(provider): preserve fallback lifecycle identity`.

**Files:**
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Wired-into:** same as Task 13

**Dependencies:** Task 13, Task 14

### Task 16: Reset lifecycle episodes only after authoritative settlement

**Story:** TI-2 successful replacement reset; TI-3 per-step isolation
**Type:** happy-path

**Steps:**
1. Add failing tests for success, ordinary failure, fallback success, stale result, and the next
   logical step.
2. Verify RED.
3. Reset persisted recovery evidence only when the current attempt settles authoritatively; preserve
   evidence on stale or interrupted settlement.
4. Verify GREEN.
5. Commit with message: `feat(engine): settle provider lifecycle episodes`.

**Files:**
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/src/engine/provider-lifecycle-store.ts`
- `src/conductor/test/engine/provider-lifecycle.test.ts`

**Wired-into:** same as Task 5

**Dependencies:** Task 14, Task 15

### Task 17: Make provider activity heartbeat telemetry-only

**Story:** TI-4 silent running provider and stale/malformed heartbeat paths
**Type:** negative-path

**Steps:**
1. Rewrite/add failing tests where a spawned provider stays silent beyond the former threshold and
   later succeeds without kill, HALT, or replacement.
2. Verify RED against current termination behavior.
3. Remove output-silence kill/HALT authority while retaining throttled activity timestamps and
   formatting helpers used by status.
4. Verify GREEN for absent, stale, malformed, and prior-dispatch heartbeat cases.
5. Commit with message: `fix(engine): make provider heartbeat observational`.

**Files:**
- `src/conductor/src/engine/step-heartbeat.ts`
- `src/conductor/src/engine/step-runners.ts`
- `src/conductor/test/engine/step-heartbeat.test.ts`
- `src/conductor/test/engine/step-runners.test.ts`

**Wired-into:** `src/conductor/src/engine/daemon-dashboard.ts#scanInheritedState`

**Dependencies:** Task 14

### Task 18: Persist lifecycle timing through existing events

**Story:** TI-1 phase diagnostics; merged provider-time telemetry reuse
**Type:** happy-path

**Steps:**
1. Add failing event persistence tests for preparation start/end, running transition, recovery, and
   exhaustion with attempt identity.
2. Verify RED.
3. Extend existing event types/persister with lifecycle phase timing and reuse engine-observed
   interval semantics; do not create a parallel timing ledger.
4. Verify GREEN for serial, fallback, and concurrent event persistence.
5. Commit with message: `feat(events): persist provider lifecycle timing`.

**Files:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-persister.ts`
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/test/engine/event-persister.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#runConductorInWorktree`

**Dependencies:** Task 5, Task 16

### Task 19: Render lifecycle phase and attempt diagnostics

**Story:** TI-1 status/log visibility; TI-3 exhaustion diagnostics; TI-4 telemetry labels
**Type:** happy-path

**Steps:**
1. Add failing dashboard and daemon-render tests for preparing, running, recovering, and halted
   states with attempt/reason fields.
2. Verify RED.
3. Read lifecycle evidence in the dashboard and render concise feature-scoped log lines; label
   heartbeat age as activity telemetry rather than liveness authority.
4. Verify GREEN, including missing/malformed evidence fallback.
5. Commit with message: `feat(daemon): surface provider lifecycle phases`.

**Files:**
- `src/conductor/src/engine/daemon-dashboard.ts`
- `src/conductor/src/engine/daemon-log.ts`
- `src/conductor/src/daemon-cli.ts`
- `src/conductor/test/engine/daemon-dashboard.test.ts`
- `src/conductor/test/daemon-render-provider-attempt.test.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#renderDaemonEvent`

**Dependencies:** Task 4, Task 18

### Task 20: Prove preparation supervision at the provider boundary

**Story:** TI-2 timeout-versus-spawn race; TI-4 silent running; TI-5 provider parity; TI-6 legacy config separation
**Type:** infrastructure

**Steps:**
1. Write a focused integration test using the real lifecycle, candidate executor, built-in adapter
   seams, event persister, and temporary worktree, with fake providers/process factories and clock.
2. Verify RED at the first missing production integration point.
3. Wire the behavior-specific boundary needed for the test: five-minute preparation timeout,
   revoked late spawn, one replacement, silent running success, and legacy heartbeat-key separation.
4. Verify GREEN alone and with the neighboring lifecycle/provider test files; await every promise,
   timer, and listener in cleanup.
5. Commit with message: `test(engine): prove provider preparation supervision boundary`.

**Files:**
- `src/conductor/test/integration/provider-lifecycle-supervision.integration.test.ts`
- `src/conductor/src/engine/provider-lifecycle.ts`
- `src/conductor/src/engine/provider-execution.ts`
- `src/conductor/src/engine/step-runners.ts`

**Wired-into:** `src/conductor/src/engine/step-runners.ts#executeProviderAwareOneShotCore`

**Dependencies:** Task 2, Task 9, Task 15, Task 17, Task 18, Task 19

## Task Dependency Graph

```text
Task 1 ─┬─> Task 3 ─> Task 4 ───────────────┐
        ├─> Task 5 ─> Task 6 ─> Task 7 ─> Task 8 ─> Task 9
        └─> Task 10 ─┬─> Task 11 ─┐         │
                     ├─> Task 12 ─┼─> Task 14 ─> Task 15 ─> Task 16
                     └─> Task 13 ─┘              │          │
Task 2 ────────────────> Task 5                  │          └─> Task 18 ─> Task 19
                                                └─> Task 17

Task 2 + Task 9 + Task 15 + Task 17 + Task 18 + Task 19 ─> Task 20
```

## Integration Points

- After Task 8: pure lifecycle supervision has bounded recovery and exhaustion behavior.
- After Task 14: every provider-aware step reaches the supervisor and built-in adapters honor the
  spawn permit.
- After Task 17: running providers cannot be reaped from output silence.
- After Task 19: operators can distinguish preparation, running, recovery, and halt.
- Task 20 implements and proves the named provider-boundary integration rather than re-running the
  completed feature as a catch-all validation step.

## Acceptance-Criteria Coverage

| Story | Criteria covered by tasks |
|---|---|
| TI-1 lifecycle phases, stale evidence, write failure | 1, 3, 4, 5, 14, 18, 19 |
| TI-2 timeout, replacement, races, late resume, fallback, no process scan | 5, 6, 7, 14, 15, 20 |
| TI-3 exhaustion, restart, re-kick retention, per-step reset, malformed state | 3, 4, 7, 8, 9, 16 |
| TI-4 silent running, heartbeat telemetry, stale/malformed data, process-scan exclusion | 17, 19, 20 |
| TI-5 built-ins, compatible/unsupported custom providers, revoked permit, fallback | 10, 11, 12, 13, 15, 20 |
| TI-6 default/override/invalid/legacy config and distinct semantics | 2, 17, 20 |

## Verification

- [x] All happy-path criteria map to at least one task.
- [x] All negative-path criteria map to at least one task.
- [x] Every task has an explicit dependency line and the graph is acyclic.
- [x] Every new production surface has a `Wired-into:` contract derived from architecture review.
- [x] No task invokes real providers or third parties in ordinary tests.
- [x] No terminal catch-all validation or speculative repair task exists.
- [x] Plan contains 20 tasks, within the normal 1–20 range.

### Task rem-adr-001: Use the shared spawn-permit validator at both built-in provider spawn boundaries

Invoke `validateSpawnPermit` from the Claude and Codex adapters immediately before process creation, remove their duplicate inline validation, and make the provider-runtime test require the shared validator.

### Task rem-adr-002: Remove unused lifecycle-store wrapper exports and test the production factory API

Delete `defaultStore` and the unreachable module-level wrapper exports from `provider-lifecycle-store.ts`; update its tests to exercise `createProviderLifecycleEpisodeStore()` and its object methods.

### Task rem-adr-003: Retain the heartbeat timeout key only as a deprecated compatibility no-op

Remove the dead `resolveStepHeartbeatStallMinutes` resolver and resolver-only tests while continuing to accept `step_heartbeat_stall_minutes` without giving it termination authority or reusing it as the preparation timeout.

### Task rem-adr-004: Define `onSpawn` as observation-only

Correct the `InvokeOptions.onSpawn` contract and adapter wiring comments so the callback has no timeout, kill, retry, or lifecycle authority.

### Task rem-adr-005: Document preparation timeout and telemetry-only heartbeat behavior

Update the daemon guide, configuration reference, and stalled-feature runbook to document `provider_preparation_timeout_minutes`, remove claims that heartbeat silence terminates providers, and describe the legacy heartbeat setting as a deprecated compatibility no-op.
