# Implementation Plan: Coherent FINISH Publication

**Date:** 2026-08-01
**Design:** `.docs/specs/2026-08-01-unattended-finish-publication.md`
**Architecture:** `.docs/decisions/adr-2026-08-01-engine-owned-resumable-finish-publication.md`
**Stories:** `.docs/stories/unattended-finish-spends-minutes-before-determinis.md`
**Conflict check:** Clean as of 2026-08-01
**Source:** `jstoup111/ai-conductor#1172`

## Summary

Build a typed, engine-owned FINISH publication coordinator in 18 scoped TDD tasks. The coordinator derives progress from verified repository and GitHub state, invokes one safe transition at a time, dispatches judgment only for PR prose, and routes publication-only, implementation-invalid, and human-authority outcomes exhaustively.

## Technical Approach

- Introduce a focused `finish-publication.ts` domain/orchestration module; keep `conductor.ts` limited to composition, judgment invocation, and exhaustive disposition routing.
- Represent intent, observations, transitions, and dispositions as discriminated unions. Derive progress on every entry from authoritative effects; do not add a second durable ledger.
- Compose existing injected Git/GitHub, shipped-record, push-evidence, presentation-repair, and finish-record boundaries. Each mutation is observe-before-act and verify-after-write.
- Treat PR prose as the only judgment-owned transition. Interactive mode supplies operator intent; daemon and foreground-auto supply their existing safe policies.
- Consume the release-readiness contract produced after upstream spec PR #1233; never edit `CHANGELOG.md` or `VERSION`, invoke the legacy token finalizer, or duplicate the release feature's retirement work.
- Tests use pure transition tables, injected adapters, bounded `Conductor.run()` fixtures only where orchestration must be proven, and no real provider or GitHub calls outside explicit smoke coverage.

## Prerequisites

- Upstream spec PR #1233 (`spec/changelog-unreleased-is-a-shared-write-target-conf`) must merge before BUILD so implementation targets the resolved release-readiness contract and does not restore obsolete changelog/version ownership.
- Rebase onto current `main` before Task 1 because `conductor.ts` is a high-overlap surface.
- No new package, service, schema, port, or credential is required.

## Tasks

### Task 1: Define closed publication domain types

**Story:** Story 2 — explicit progress domain
**Story:** Story 3 — exhaustive recovery outcomes
**Story:** Story 6 — typed authority boundary
**Story:** Story 7 — coherent completion states
**Type:** infrastructure

**Steps:**
1. Write failing table tests that require semantic unions for publication intent, observed snapshot, next transition, and terminal disposition.
2. Verify RED on missing exports and exhaustive cases.
3. Implement the domain types plus pure exhaustive helpers; allow no catch-all success or BUILD default.
4. Verify GREEN with unit tests only.
5. Commit `feat(finish): define publication lifecycle types`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — domain unions and pure helpers
- `src/conductor/test/engine/finish-publication.test.ts` — exhaustive type/transition tables

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** none

### Task 2: Derive the next transition from observed state

**Story:** Story 2 — partial progress and restart resume happy paths
**Type:** happy-path

**Steps:**
1. Add failing table cases for every ordered partial-progress snapshot and expected next transition.
2. Verify RED.
3. Implement a pure `nextFinishPublicationTransition` that selects only the first incomplete transition.
4. Verify GREEN and exhaustive compilation.
5. Commit `feat(finish): derive resumable publication transitions`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — pure transition selector
- `src/conductor/test/engine/finish-publication.test.ts` — partial-progress matrix

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Reject contradictory and indeterminate observations

**Story:** Story 1 — indeterminate prerequisite
**Story:** Story 2 — conflicting resume evidence
**Story:** Story 7 — incoherent completion evidence
**Type:** negative-path

**Steps:**
1. Add failing cases for local/external conflict, malformed PR identity, marker-without-evidence, and evidence-without-marker.
2. Verify RED.
3. Implement typed incoherence and indeterminate results that can never map to complete.
4. Verify GREEN without filesystem or network calls.
5. Commit `fix(finish): fail closed on incoherent publication state`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — snapshot validation
- `src/conductor/test/engine/finish-publication.test.ts` — incoherence matrix

**Wired-into:** same as Task 1
**Dependencies:** Task 2

### Task 4: Observe repository and external publication evidence

**Story:** Story 2 — authoritative restart state
**Story:** Story 7 — coherent completion inputs
**Type:** infrastructure

**Steps:**
1. Write failing observer tests using injected filesystem, Git, GitHub, shipped-record, push-evidence, and release-readiness fakes.
2. Verify RED with zero real child processes.
3. Implement the observer that maps adapter results into the closed snapshot.
4. Verify GREEN for present, missing, stale, malformed, unpushed, and unavailable rows.
5. Commit `feat(finish): observe authoritative publication evidence`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — observer ports and composition
- `src/conductor/test/engine/finish-publication.test.ts` — injected observer fixtures

**Wired-into:** same as Task 1
**Dependencies:** Tasks 1, 3

### Task 5: Resolve interactive publication intent without mutation

**Story:** Story 5 — interactive operator choice and defer/decline paths
**Type:** happy-path

**Steps:**
1. Write failing tests for operator-confirmed PR, keep, deferred, and destructive choices.
2. Verify RED.
3. Implement interactive intent parsing into authorized intent or `human_required`, with no side effect.
4. Verify GREEN, including deferred/declined no-mutation assertions.
5. Commit `feat(finish): preserve interactive publication intent`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — interactive intent resolver
- `src/conductor/test/engine/finish-publication.test.ts` — intent cases

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 1

### Task 6: Resolve unattended intent by existing mode policy

**Story:** Story 5 — foreground execution modes
**Story:** Story 6 — unattended authority boundaries
**Type:** negative-path

**Steps:**
1. Add failing mode-matrix tests for daemon, foreground-auto with remote/auth, no remote, unavailable auth, unauthorized outcome, and destructive intent.
2. Verify RED.
3. Implement the unattended resolver using injected remote/auth capability and explicit mode.
4. Verify GREEN; assert daemon never chooses keep and no unattended branch chooses merge/discard.
5. Commit `feat(finish): resolve safe unattended publication intent`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — unattended intent policy
- `src/conductor/test/engine/finish-publication.test.ts` — mode matrix

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 5

### Task 7: Preflight deterministic readiness before judgment

**Story:** Story 1 — ready and exact deterministic-blocker paths
**Type:** happy-path

**Steps:**
1. Write failing coordinator tests proving ready state reaches judgment and deterministic gaps return before the dispatcher is called.
2. Verify RED.
3. Implement preflight over observed publication, SHIP, and resolved release-readiness evidence.
4. Verify GREEN; assert exact typed condition and operator message.
5. Commit `feat(finish): preflight publication before judgment`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — preflight coordinator
- `src/conductor/test/engine/finish-publication.test.ts` — zero-dispatch blocker cases

**Wired-into:** same as Task 1
**Dependencies:** Tasks 4, 6

### Task 8: Establish or reuse PR identity idempotently

**Story:** Story 2 — one PR under retry
**Story:** Story 6 — ambiguous identity and dependency failure
**Type:** happy-path

**Steps:**
1. Write failing adapter tests for existing draft reuse, one new draft, lost-response rediscovery, ambiguous identity, and GitHub failure.
2. Verify RED.
3. Advance the PR-identity transition through the existing ship-draft/find-or-create seam and re-observe afterward.
4. Verify GREEN with fake Git/GitHub runners and no real network.
5. Commit `feat(finish): resume stable PR identity transition`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — PR transition adapter
- `src/conductor/src/engine/ship-draft-pr.ts` — expose/reuse load-bearing result as needed
- `src/conductor/test/engine/finish-publication.test.ts` — retry/ambiguity cases
- `src/conductor/test/engine/ship-draft-pr.test.ts` — existing seam regression

**Wired-into:** same as Task 1
**Dependencies:** Task 7

### Task 9: Create and verify durable shipped evidence idempotently

**Story:** Story 2 — one shipped record under retry
**Story:** Story 7 — interrupted write and strict evidence
**Type:** happy-path

**Steps:**
1. Write failing tests for existing-valid no-op, absent record creation, mismatched record refusal, push failure, and response-loss retry.
2. Verify RED.
3. Compose the existing shipped-record writer/verifier as an observe-before-act transition.
4. Verify GREEN with local filesystem/Git fixtures and fake GitHub only.
5. Commit `feat(finish): resume durable shipment transition`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — shipped-evidence transition
- `src/conductor/src/engine/shipment-evidence-cli.ts` — reusable adapter export if needed
- `src/conductor/test/engine/finish-publication.test.ts` — transition matrix
- `src/conductor/test/engine/shipment-evidence-cli.test.ts` — primitive regression

**Wired-into:** same as Task 1
**Dependencies:** Task 8

### Task 10: Dispatch judgment only for stale PR prose

**Story:** Story 4 — one judgment pass and accepted-prose skip
**Type:** happy-path

**Steps:**
1. Write failing tests for accepted prose, placeholder prose, halt prose, and stale content after prior acceptance.
2. Verify RED.
3. Implement a typed judgment-needed predicate and bounded judgment request/result contract.
4. Verify GREEN; assert zero dispatch for accepted prose and one dispatch otherwise.
5. Commit `feat(finish): bound judgment to PR prose quality`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — judgment predicate/result
- `src/conductor/test/engine/finish-publication.test.ts` — dispatch-count cases

**Wired-into:** `src/conductor/src/engine/step-runners.ts#runDispatch, src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 4, 9

### Task 11: Preserve progress across judgment failure

**Story:** Story 4 — provider timeout/unavailability and no-repeat negative paths
**Type:** negative-path

**Steps:**
1. Add failing tests for timeout, provider unavailable, refusal, malformed prose, and a retry after accepted content.
2. Verify RED.
3. Map judgment failures to publication retry or human-required without rolling back verified effects.
4. Verify GREEN with injected provider results and clocks; no real model call or wait.
5. Commit `fix(finish): retain progress when prose judgment fails`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — judgment failure mapping
- `src/conductor/test/engine/finish-publication.test.ts` — provider failure fixtures

**Wired-into:** same as Task 10
**Dependencies:** Task 10

### Task 12: Apply presentation repair and ready transition

**Story:** Story 4 — accepted prose and no placeholder completion
**Story:** Story 6 — ready transition without merge authority
**Type:** happy-path

**Steps:**
1. Write failing fake-GitHub tests for clean ready no-op, reused halt repair, draft ready flip, stale prose refusal, and GitHub unavailability.
2. Verify RED.
3. Compose existing order-gated presentation repair after accepted prose and re-observe PR state.
4. Verify GREEN and assert no merge/auto-merge argv exists.
5. Commit `feat(finish): verify and ready accepted PR presentation`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — presentation transition
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — reusable result seam if needed
- `src/conductor/test/engine/finish-publication.test.ts` — presentation cases
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — existing behavior regression

**Wired-into:** same as Task 1
**Dependencies:** Tasks 10, 11

### Task 13: Record final outcome as the commit point

**Story:** Story 7 — coherent row, interrupted state write, and safe retry
**Type:** happy-path

**Steps:**
1. Write failing tests requiring all coherent evidence before recorder invocation and marker-last ordering on interruption.
2. Verify RED.
3. Invoke the existing fail-closed finish recorder from the coordinator only after final observation passes.
4. Verify GREEN for PR and authorized keep outcomes; preserve absolute path and zero-write refusal guarantees.
5. Commit `feat(finish): record coherent publication outcome`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — final transition
- `src/conductor/src/engine/finish-record-cli.ts` — reusable injected adapter entry
- `src/conductor/test/engine/finish-publication.test.ts` — commit-point cases
- `src/conductor/test/engine/finish-record-cli.test.ts` — primitive regressions

**Wired-into:** same as Task 1
**Dependencies:** Tasks 9, 12

### Task 14: Make retry and concurrent advancement idempotent

**Story:** Story 2 — concurrent resume and lost-response negative paths
**Type:** negative-path

**Steps:**
1. Add failing deterministic interleaving tests for two callers observing one incomplete PR, shipped record, presentation, and final marker transition.
2. Verify RED.
3. Add stable identity, compare/re-observe, and already-complete reconciliation at each mutation boundary.
4. Verify GREEN without real timers; await every interleaved promise and clean fixture state.
5. Commit `fix(finish): prevent duplicate publication effects`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — concurrency/idempotency guards
- `src/conductor/test/engine/finish-publication.test.ts` — bounded interleaving tests

**Wired-into:** same as Task 1
**Dependencies:** Tasks 8, 9, 12, 13

### Task 15: Route publication-only results back to FINISH

**Story:** Story 3 — publication retry and unknown-result halt
**Type:** negative-path

**Steps:**
1. Write failing pure and bounded conductor tests for every `publication_retry` reason and unknown/contradictory disposition.
2. Verify RED; bound `Conductor.run()` from FINISH to the first routed result with an injected sentinel.
3. Replace generic FINISH remediation entry for publication results with exhaustive FINISH-local retry/halt routing.
4. Verify GREEN; assert no BUILD dispatch and no broad remediation dispatch.
5. Commit `fix(finish): keep publication recovery in finish`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — disposition helpers
- `src/conductor/src/engine/conductor.ts` — FINISH result routing
- `src/conductor/test/engine/finish-publication.test.ts` — pure routing cases
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — bounded orchestration fixture

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Tasks 7, 14

### Task 16: Permit BUILD only for invalid implementation evidence

**Story:** Story 3 — cited implementation-invalid route and stale evidence path
**Type:** negative-path

**Steps:**
1. Add failing bounded conductor tests for valid cited implementation defect, stale proof, and publication error lacking implementation evidence.
2. Verify RED.
3. Route only `implementation_invalid` to BUILD and carry its evidence into the retry hint/audit event.
4. Verify GREEN; assert all other result variants cannot navigate to BUILD.
5. Commit `fix(finish): evidence-gate build recovery`.

**Files:**
- `src/conductor/src/engine/finish-publication.ts` — implementation-invalid payload
- `src/conductor/src/engine/conductor.ts` — guarded BUILD navigation
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — bounded route cases

**Wired-into:** same as Task 15
**Dependencies:** Task 15

### Task 17: Wire mode-specific FINISH orchestration and narrow the skill

**Story:** Story 4 — bounded judgment wiring
**Story:** Story 5 — interactive and mode matrix
**Story:** Story 6 — no unauthorized mechanical tail
**Type:** refactor

> **Amended 2026-08-04 by #1172:** this task additionally owns the FINISH retry budget and
> retained attended intent. As originally written it promised terminal mode-matrix coverage while
> omitting both, which is unreachable: `resolved-config.ts:53` permits one FINISH attempt, but
> `finish-publication-production.ts:300-319` returns `publication_retry` after every verified
> transition, so FINISH can never re-enter to reach a terminal disposition. Separately,
> `acquireInteractiveIntent` is invoked inside `advance()`, so an attended run is re-prompted on
> each transition retry rather than once. Steps 6-8, the added files, and the two added declared
> sites below close that omission. The original steps and assertions are unchanged.

**Steps:**
1. Write failing integration tests whose first step is FINISH, expected dispatch is zero or one judgment call, and terminal condition is coordinator completion/HALT.
2. Verify RED with unrelated steps pre-resolved and all participating gate evidence fresh.
3. Wire the coordinator around the FINISH judgment boundary and narrow the machine-consumed finish skill/prompt to intent plus PR prose.
4. Verify GREEN across interactive, default foreground, foreground-auto, and daemon fixtures; assert no test reaches a real provider/GitHub process.
5. Commit `refactor(finish): delegate mechanics to publication coordinator`.
6. Write a failing test pinning a default FINISH retry budget of at least six entries — one per `establish_pr`, `write_shipped_record`, `judge_pr_prose`, `ready_pr`, `record_outcome`, and the terminal authoritative re-observation — then raise `DEFAULT_STEP_RETRIES.finish` to satisfy it. The budget must hold without composition-root overrides.
7. Write a failing test proving an attended FINISH run acquires publication intent exactly once and reuses the authorized choice across every deterministic transition retry, then hoist the intent acquisition out of the per-transition `advance()` path. A daemon run's behavior is unchanged: it still reads `.pipeline/finish-choice` and never prompts.
8. Verify GREEN and commit `fix(finish): budget the transition retries and retain attended intent`.

**Files:**
- `src/conductor/src/engine/conductor.ts` — coordinator composition
- `src/conductor/src/engine/step-runners.ts` — bounded judgment prompt
- `skills/finish/SKILL.md` — machine-consumed responsibility contract
- `src/conductor/test/engine/conductor-finish-publication.test.ts` — bounded mode matrix
- `src/conductor/test/engine/step-runners.test.ts` — prompt contract
- `src/conductor/src/engine/resolved-config.ts` — FINISH retry budget
- `src/conductor/test/engine/resolved-config.test.ts` — budget floor pin
- `src/conductor/src/engine/finish-publication-production.ts` — retained attended intent
- `src/conductor/test/engine/finish-publication-production.test.ts` — intent-acquired-once pin
- `src/conductor/test/acceptance/unattended-finish-publication.acceptance.test.ts` — real `Conductor.run` PR-path fixture across PR-present and PR-absent for interactive, default foreground, foreground-auto, and daemon, with exactly one prose judgment

**Wired-into:** `src/conductor/src/engine/conductor.ts#run, src/conductor/src/engine/step-runners.ts#runDispatch, src/conductor/src/engine/resolved-config.ts#DEFAULT_STEP_RETRIES, src/conductor/src/engine/finish-publication-production.ts#acquireInteractiveIntent`
**Dependencies:** Tasks 6, 10, 13, 16

### Task 18: Emit transition and terminal-disposition observability

**Story:** Story 1 — exact blocker diagnostics
**Story:** Story 3 — recovery disposition diagnostics
**Story:** Story 6 — human-HALT diagnostics
**Type:** infrastructure

**Steps:**
1. Write failing event/logger tests for transition start/completion, exact blocker, FINISH retry, BUILD route, human-required HALT, and complete.
2. Verify RED.
3. Add typed publication events and feature-scoped log rendering at the coordinator/conductor boundary.
4. Verify GREEN, including exhaustive sink registration and no sensitive credential content.
5. Commit `feat(finish): expose publication progress and dispositions`.

**Files:**
- `src/conductor/src/types/events.ts` — typed publication event variants
- `src/conductor/src/engine/event-sinks.ts` — exhaustive sink declarations
- `src/conductor/src/engine/finish-publication.ts` — transition emission
- `src/conductor/src/engine/conductor.ts` — terminal disposition emission
- `src/conductor/test/engine/finish-publication.test.ts` — event cases
- `src/conductor/test/engine/event-sinks.test.ts` — sink exhaustiveness

**Wired-into:** `src/conductor/src/engine/conductor.ts#events, src/conductor/src/engine/event-sinks.ts#EVENT_SINKS`
**Dependencies:** Tasks 15, 16, 17

## Task Dependency Graph

```text
1 -> 2 -> 3
1,3 -> 4
1 -> 5 -> 6
4,6 -> 7 -> 8 -> 9
4,9 -> 10 -> 11 -> 12
9,12 -> 13
8,9,12,13 -> 14
7,14 -> 15 -> 16
6,10,13,16 -> 17
15,16,17 -> 18
```

## Integration Points

- After Task 7: deterministic blockers can stop FINISH before any judgment dispatch.
- After Task 9: PR and durable shipment effects resume idempotently from authoritative state.
- After Task 13: the coordinator can converge a coherent publication to the existing fail-closed final marker.
- After Task 16: publication-only, implementation-invalid, and human-required outcomes have exhaustive lifecycle routing.
- After Task 17: all interactive and unattended entry modes use the shared coordinator with at most one prose judgment pass.
- After Task 18: operators can observe every transition and terminal disposition through existing event/log infrastructure.

## Advisory Overlap

- `src/conductor/src/engine/conductor.ts` overlaps many active spec branches; implementation must rebase first and keep logic in `finish-publication.ts`.
- Upstream spec PR #1233 owns release metadata, changelog/version rendering, version cutting, and legacy finalizer retirement. This plan deliberately contains no task or file ownership for those surfaces.

## Acceptance-Criteria Coverage

| Story | Acceptance behavior | Tasks |
|---|---|---|
| 1 | ready preflight; exact/indeterminate/multiple blockers; zero judgment on gap | 3, 4, 7, 18 |
| 2 | partial/restart resume; local/external conflict; concurrency; lost response; no duplicates | 2, 3, 4, 8, 9, 14 |
| 3 | publication retry; evidence-backed BUILD; unknown halt; stale implementation proof | 3, 15, 16, 18 |
| 4 | one/zero prose pass; placeholder refusal; provider failure; no repeated accepted judgment | 10, 11, 12, 17 |
| 5 | interactive choice; foreground/auto/daemon matrix; decline; no-remote keep; unauthorized mode | 5, 6, 17 |
| 6 | authorized safe effects; human HALT; ambiguity; no merge; GitHub unavailable | 6, 8, 12, 15, 17, 18 |
| 7 | coherent final record; every evidence mismatch; marker revalidation; interrupted write | 3, 4, 9, 13, 14 |

## Verify-Claims Ledger

### Claims

- [verified] The proposed adapters and production call sites exist in current source or are declared by the approved architecture review.
- [verified] Upstream PR #1233 is open and its approved ADR makes the bot-owned release PR the sole changelog/version writer while removing changelog-specific triggers from #1172.
- [verified] Every story acceptance criterion maps to at least one behavior-owning task, including explicit negative-path tasks.

### Assumptions

- None pending. The upstream merge is an explicit prerequisite, not an assumed implementation surface.

Verdict: CLEAR

## Verification

- [x] All happy and negative acceptance criteria map to tasks.
- [x] Every task has explicit dependencies and the graph is acyclic.
- [x] Every new production surface has a design-derived `Wired-into:` contract.
- [x] No terminal catch-all validation task exists.
- [x] Ordinary tests inject provider/GitHub/process boundaries and bound every conductor fixture.
- [x] Task count is 18, within the normal 1–20 range.
