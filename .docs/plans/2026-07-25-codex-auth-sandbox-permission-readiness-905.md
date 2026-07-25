# Implementation Plan: Codex Authentication and Autonomous Execution Readiness (#905)

**Date:** 2026-07-25
**Design:** `.docs/specs/2026-07-25-codex-auth-sandbox-permission-readiness-905.md`
**Stories:** `.docs/stories/codex-auth-sandbox-permission-readiness-905.md`
**Conflict check:** Clean after resolution, 2026-07-25
**Claims ledger:** `.pipeline/verify-claims-plan.md` — CLEAR

## Summary

Build the approved Codex authentication boundary in 13 TDD tasks. The implementation adds a
provider-local, strict readiness capability and bounded invocation policy; carries sanitized
provider/source metadata to the existing recovery joins; and generalizes the existing park
lifecycle without changing Claude authentication or its permission posture.

## Technical Approach

`execution/codex-provider.ts` becomes the only owner of Codex source selection, captured
`doctor` readiness evidence, sanitization, API-key child-environment scoping, and explicit
unattended argv policy. Additive result metadata flows through the existing provider executor and
step runner to conductor-owned serial and grouped recovery. The conductor coordinates one bounded
park lifecycle, dispatching a narrow provider readiness capability instead of inspecting another
provider's credentials. Finally, self-host setup resolves the preferred build provider before any
Claude-only preparation; the Codex branch retains common release gates and relies on the same
Codex readiness/policy path.

## Prerequisites

- Keep the approved #905 boundaries: no credential store, API-key hot reload, auth-source fallback,
  provider fallback, retry-budget use, or Claude policy migration.
- Preserve issue #904 ownership of Codex skills and `AGENTS.md` behavior.
- Re-read high-contention `llm-provider.ts`, `provider-execution.ts`, and `conductor.ts` immediately
  before their build tasks; run the plan overlap scan for the listed file union.

## Tasks

### Task 1: Define provider-local authentication and readiness contracts
**Story:** Stories 1–6, 9, and 11 — source identity, four-state readiness, sanitized recovery metadata.
**Type:** infrastructure
**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/test/execution/llm-provider-contract.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider`, `src/conductor/src/engine/step-runners.ts#toStepRunResult`
**Dependencies:** none

**Steps:**
1. Write failing contract tests for optional provider-owned readiness and additive auth-source/readiness metadata while preserving legacy/custom providers.
2. Verify the contract tests fail (RED).
3. Add narrow typed source, four-state verdict, sanitized remediation, and optional readiness capability contracts; do not expose raw diagnostics or credential values.
4. Verify the contract tests pass (GREEN).
5. Commit with message: `feat(auth): define provider readiness contracts`.

### Task 2: Implement deterministic Codex source selection and secret-safe result shaping
**Story:** Stories 1–3 and 6 — cached login/API key selection, API-key precedence, no source fallback, no secret persistence.
**Type:** happy-path
**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`, `src/conductor/src/execution/codex-provider.ts#CodexProvider.invokeInteractive`
**Dependencies:** Task 1

**Steps:**
1. Write failing matrix tests for cached-only, key-only, both-present, and neither-present selection, asserting API-key precedence and source-only diagnostics.
2. Verify the matrix fails (RED).
3. Add per-run Codex source selection and a sanitized result builder that retains source kind but never raw credential/path/prefix/suffix/hash content.
4. Verify matrix and adversarial secret-fragment assertions pass (GREEN).
5. Commit with message: `feat(codex): select and sanitize auth sources`.

### Task 3: Add strict captured Codex readiness probing
**Story:** Stories 1–4 and 6 — fresh four-state preflight and no model work while non-ready.
**Type:** happy-path
**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.readiness`
**Dependencies:** Task 2

**Steps:**
1. Write failing injected-runner tests for supported `codex doctor --json --summary` ready, missing, rejected, network/timeout, malformed, and conflicting-source evidence.
2. Verify parser and runner tests fail (RED).
3. Implement a bounded, captured runner and strict parser that returns only `ready`, `missing`, `unusable`, or `unverifiable` plus safe remediation; unsupported evidence fails closed.
4. Verify zero substantive `exec` invocations and zero inherited raw doctor output in every non-ready case (GREEN).
5. Commit with message: `feat(codex): add strict auth readiness probe`.

### Task 4: Gate every unattended Codex invocation on readiness
**Story:** Stories 1–5 and 9 — initial, resume, streaming, grouped, auxiliary, and model-ladder parity.
**Type:** happy-path
**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/execution/codex-provider.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#CodexProvider.invoke`, `src/conductor/src/execution/codex-provider.ts#CodexProvider.invokeInteractive`, `src/conductor/src/engine/step-runners.ts#runProviderAware`
**Dependencies:** Task 3

**Steps:**
1. Write failing path-spy tests proving one fresh readiness check immediately precedes each unattended dispatch shape and only `ready` reaches Codex execution.
2. Verify the path tests fail (RED).
3. Invoke the provider-local readiness capability for unattended Codex calls, preserving interactive behavior and provider-local session semantics.
4. Verify missing/unusable/unverifiable cases start no model work or project mutation, and a prior ready verdict cannot authorize resume (GREEN).
5. Commit with message: `feat(codex): gate unattended dispatch on readiness`.

### Task 5: Enforce the explicit Codex unattended policy and key scoping
**Story:** Stories 6–8 — bounded policy, automatic review, no danger bypass, secret filtering, child-env isolation.
**Type:** negative-path
**Files:** `src/conductor/src/execution/codex-provider.ts`, `src/conductor/test/execution/codex-provider.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Wired-into:** `src/conductor/src/execution/codex-provider.ts#buildArgs`, `src/conductor/src/execution/codex-provider.ts#invoke`, `src/conductor/src/execution/codex-provider.ts#invokeInteractive`
**Dependencies:** Task 4

**Steps:**
1. Write failing argv/environment capture tests for initial, resume, streaming, grouped, auxiliary, and model-ladder calls.
2. Verify tests fail (RED).
3. Replace Codex danger-bypass use with explicit `workspace-write`, `on-request`, `auto_review`, and forced secret filtering; scope an API key to the client without passing it to model-proposed subprocesses.
4. Verify user defaults cannot broaden the policy, resumes preserve it, and denied/unknown reviews remain permission failures without policy weakening (GREEN).
5. Commit with message: `feat(codex): enforce bounded unattended policy`.

### Task 6: Propagate sanitized provider/source auth metadata through execution results
**Story:** Stories 3, 5, 6, and 9 — no provider/source loss at serial, grouped, judgment, or auxiliary boundaries.
**Type:** infrastructure
**Files:** `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/engine/group-core.ts`, `src/conductor/src/engine/attribution-lane.ts`, `src/conductor/test/engine/provider-execution.test.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/engine/group-core.test.ts`, `src/conductor/test/engine/attribution-lane.test.ts`
**Wired-into:** `src/conductor/src/engine/provider-execution.ts#executeProviderCandidates`, `src/conductor/src/engine/step-runners.ts#toStepRunResult`, `src/conductor/src/engine/group-core.ts#runGroupBranch`, `src/conductor/src/engine/attribution-lane.ts#runAttributionLane`
**Dependencies:** Tasks 1–5

**Steps:**
1. Write failing propagation tests that assert provider/source/readiness metadata survives success, preflight non-ready, and post-dispatch auth rejection in every adapter shape.
2. Verify tests fail (RED).
3. Thread additive sanitized metadata without changing candidate ordering, model availability, or custom-provider requirements.
4. Verify rate-limit and model-unavailability retain their authoritative classifications even when output contains auth-shaped text (GREEN).
5. Commit with message: `feat(auth): preserve provider readiness metadata`.

### Task 7: Generalize the bounded auth park by actual provider and source
**Story:** Stories 1, 2, 4, 5, 9, and 11 — common lifecycle with provider-owned recovery checks.
**Type:** infrastructure
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`, `src/conductor/test/engine/provider-runtime.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#parkOnAuthFailure`, `src/conductor/src/engine/provider-runtime.ts#ProviderRuntimeSet`
**Dependencies:** Task 6

**Steps:**
1. Write failing park tests for provider/source retention, cached-login recheck, restart-required API key, existing Claude behavior, and sanitized timeout/opt-out HALTs.
2. Verify tests fail (RED).
3. Refactor the coordinator to select the actual built-in provider's narrow readiness capability; keep Claude checks unchanged and keep custom providers outside the new requirement.
4. Verify no retry, effort/model escalation, provider fallback, or auth-source fallback counter changes; no cross-provider credential collaborator is called (GREEN).
5. Commit with message: `feat(auth): share bounded provider auth park`.

### Task 8: Wire serial Codex preflight and post-dispatch recovery
**Story:** Stories 1–5, 9, and 11 — only the failed serial attempt resumes, API keys remain restart-required.
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/conductor-auth-park.test.ts`, `src/conductor/test/engine/conductor.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 7

**Steps:**
1. Write failing serial integration tests for pre-dispatch missing/unusable/unverifiable and post-dispatch Codex rejection.
2. Verify tests fail (RED).
3. Route each state into the shared park, resume only after fresh same-source readiness, and emit one source-specific HALT on timeout/opt-out.
4. Verify valid cached-login refresh resumes at the same retry rung, while changing a parent-shell API key without daemon restart does not resume work (GREEN).
5. Commit with message: `feat(conductor): recover serial Codex auth failures`.

### Task 9: Wire concurrent-group Codex recovery without sibling reruns
**Story:** Stories 4, 5, and 11 — failed group member recovery and completed-sibling preservation.
**Type:** negative-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/src/engine/group-core.ts`, `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/group-core.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#dispatchGroupRound`, `src/conductor/src/engine/group-core.ts#runGroupBranch`
**Dependencies:** Tasks 6–8

**Steps:**
1. Write failing group tests where one Codex member rejects auth after a sibling passes, plus a preflight non-ready member.
2. Verify tests fail (RED).
3. Re-dispatch only failed indices after the same provider/source becomes ready, retaining all existing group join authority and no-budget behavior.
4. Verify completed siblings never rerun and neither provider nor source fallback occurs (GREEN).
5. Commit with message: `feat(conductor): recover grouped Codex auth failures`.

### Task 10: Resolve the self-host provider before provider-specific setup
**Story:** Stories 9 and 10 — Codex skips only Claude-only preparation while common gates remain.
**Type:** happy-path
**Files:** `src/conductor/src/engine/conductor.ts`, `src/conductor/test/engine/self-host/wiring.test.ts`, `src/conductor/test/engine/conductor-token-injection.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#runSelfBuildDispatch`
**Dependencies:** Tasks 4–8

**Steps:**
1. Write failing self-host tests that select Codex and spy on relink, credential preflight, sandbox provisioning, `CLAUDE_CONFIG_DIR`, and Claude token injection.
2. Verify tests fail (RED).
3. Resolve the preferred build provider before setup; preserve the existing Claude branch byte-for-byte in behavior and give Codex the normal readiness/policy path plus shared release gates.
4. Verify Codex invokes none of the Claude-only collaborators and Claude fixtures retain their existing command, credential, and sandbox behavior (GREEN).
5. Commit with message: `feat(self-host): isolate Codex provider preparation`.

### Task 11: Add end-to-end authentication, policy, and isolation acceptance coverage
**Story:** Stories 1–11 — full FR-1 through FR-22 behavioral matrix.
**Type:** negative-path
**Files:** `src/conductor/test/acceptance/codex-auth-sandbox-readiness.acceptance.test.ts`, `src/conductor/test/acceptance/codex-self-host-isolation.acceptance.test.ts`
**Wired-into:** `src/conductor/src/engine/conductor.ts#run`, `src/conductor/src/execution/codex-provider.ts#CodexProvider`
**Dependencies:** Tasks 1–10

**Steps:**
1. Write failing acceptance scenarios for cached/key/both/neither, four-state readiness, pre/post-dispatch recovery, no budget/fallback, policy parity, reviewer denial, provider isolation, and self-host selection.
2. Verify every new scenario fails before implementation claims coverage (RED).
3. Use injected Codex runner/reviewer seams and filesystem/process spies to express safe deterministic assertions without real credentials or destructive boundary probes.
4. Verify all scenarios pass and that raw credential fragments cannot be found in event, log, state, audit, or HALT fixtures (GREEN).
5. Commit with message: `test(codex): cover auth and bounded autonomy acceptance`.

### Task 12: Run focused regression suites and enforce the scope boundary
**Story:** Stories 6–11 — existing Claude behavior and non-auth classifications remain unchanged.
**Type:** negative-path
**Files:** `src/conductor/test/execution/claude-provider.test.ts`, `src/conductor/test/engine/model-availability.test.ts`, `src/conductor/test/engine/provider-execution.test.ts`, `src/conductor/test/engine/self-host/wiring.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 1–11

**Steps:**
1. Add regression assertions for no Claude migration, no auth misclassification of rate/model failures, and no #904 skill-surface changes.
2. Verify regressions fail against deliberate local mutations where feasible (RED).
3. Make only narrowly required compatibility adjustments discovered by the suites; do not modify provider ordering or Codex skill discovery.
4. Verify focused suites and the full project test/typecheck commands pass (GREEN).
5. Commit with message: `test(auth): protect provider isolation regressions`.

### Task 13: Verify real Codex CLI compatibility without credentials
**Story:** Stories 4, 7, and 8 — supported CLI surface and fail-closed behavior.
**Type:** infrastructure
**Files:** `src/conductor/test/execution/codex-provider.smoke.test.ts`, `src/conductor/test/execution/codex-provider.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 3–5

**Steps:**
1. Write opt-in real-binary smoke tests for `doctor` JSON structure, invalid-key rejection classification, and initial/resume policy argument compatibility.
2. Verify smoke tests are safely skipped when the Codex binary or credentials are unavailable (RED/guard behavior).
3. Add only test fixtures/guards needed to keep the smoke suite non-mutating and secret-safe.
4. Verify the smoke suite exercises available local CLI evidence without sending model prompts or recording credentials (GREEN).
5. Commit with message: `test(codex): add readiness compatibility smoke coverage`.

## Task Dependency Graph

```text
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12
                  └──────────────────────────────→ 13
```

## Integration Points

- After Task 5: all unattended Codex entrypoints have one source-aware readiness/policy boundary.
- After Task 9: serial and grouped paths share provider/source-preserving auth recovery.
- After Task 10: self-host selects provider before provider-specific preparation.
- After Task 11: acceptance coverage demonstrates the complete operator-visible contract.

## Coverage Mapping

| PRD requirements | Stories | Tasks |
|---|---|---|
| FR-1–FR-5 | 1–3 | 1–4, 6–8, 11 |
| FR-6–FR-9 | 4 | 3–5, 8–9, 11, 13 |
| FR-10–FR-11, FR-20, FR-22 | 5, 9, 11 | 6–9, 11–12 |
| FR-12 | 6 | 2–5, 11–12 |
| FR-13–FR-18 | 7–8 | 4–5, 11, 13 |
| FR-19, FR-21 | 9–10 | 6–12 |

## Verification

- [x] All happy-path criteria map to at least one task.
- [x] All negative-path criteria map to explicit tasks, especially fail-closed readiness, no fallback, no secret leakage, reviewer denial, and self-host isolation.
- [x] Tasks have explicit dependencies and an acyclic graph.
- [x] The technical approach is grounded in the approved wiring surface and current source.
- [x] No task adds #904 skill ownership, a credential store, API-key hot reload, or a Claude policy change.
