# Architecture Review: Daemon build review can wedge before provider launch

**Date:** 2026-07-30
**Input reviewed:** technical intent from issue #1141 and approved exploration
**Complexity:** Large
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

The design is feasible in the current TypeScript engine without new packages or external services.
Verified seams:

- `DefaultStepRunner.executeProviderAwareOneShotCore` sends every provider-aware step through a
  shared dispatch wrapper before `executeProviderCandidates`.
- `executeProviderCandidates` owns candidate selection, self-host preparation, session preparation,
  adapter invocation, fallback, and attempt telemetry.
- `InvokeOptions` already carries spawn and activity callbacks to both built-in adapters.
- `writeHaltMarker` supports durable `needs-human` classification, and the daemon retains that class
  instead of mechanically re-kicking it.

The current post-spawn callback is too late to prove strict no-spawn fencing because it fires after
process creation. The provider contract must therefore gain a synchronous pre-spawn permit checked
by each supported adapter.

No database, external account, port, queue, or shared worktree resource is introduced.

## Complexity

Large remains correct: this is a cross-provider state machine with async cancellation races,
crash-safe recovery budgets, provider capability compatibility, daemon diagnostics, configuration
semantics, and negative-path coverage across every step.

## Alignment

The design strengthens existing boundaries instead of adding a parallel orchestrator:

- Lifecycle policy stays at the shared provider-execution boundary.
- Provider adapters retain process creation and termination mechanics but do not own timeout policy.
- Feature-local `.pipeline/` evidence remains observational/recovery state and never becomes step
  completion authority.
- `needs-human` exhaustion aligns with total HALT classification and prevents automatic re-kick.
- Provider-specific process scanning is explicitly excluded; both built-ins use the same capability
  contract and unsupported providers fail closed.

The architecture diagram is accurate for the proposed state after changing running heartbeats to
telemetry-only.

## Domain Integrity

Use a discriminated lifecycle state rather than independent booleans:

- `preparing` requires attempt identity, start time, deadline, and recovery count.
- `running` requires the same identity plus acknowledged spawn.
- `recovering` requires the superseded identity and reason.
- `halted` requires exhaustion evidence.

Transitions must be exhaustive. A revoked identity can never return to `preparing` or `running`.
Fallback candidates remain children of one lifecycle attempt rather than incrementing the recovery
episode implicitly.

## Wiring Surface

- Lifecycle supervisor module — invoked by `DefaultStepRunner` at the existing shared provider
  dispatch boundary for every provider-aware daemon step.
- Durable lifecycle record — written under the feature worktree’s `.pipeline/` directory and read
  by recovery plus daemon dashboard/status rendering.
- Spawn-permit capability — supplied through `InvokeOptions` and synchronously consumed by Claude,
  Codex, and any supported custom provider immediately before process creation.
- Lifecycle diagnostic events/log lines — emitted through the feature-scoped diagnostic/event sink
  already wired from the daemon runner.
- Preparation-timeout configuration — resolved through the existing config validation/resolution
  layer and consumed only by the lifecycle supervisor.
- Heartbeat telemetry — existing provider activity callbacks continue writing status evidence but
  no longer call a termination-authoritative output-silence watchdog.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Superseded attempt spawns in a cancellation race | Technical | Medium | High | Synchronous permit immediately before process creation; revoke before replacement |
| Recovery count resets on daemon restart and loops | Data | Medium | High | Atomic feature-local record; persist before replacement; reset only on clean completion |
| Quiet live provider is killed | Technical | Low | High | Remove all output-silence termination authority; negative tests with a silent live invocation |
| Unsupported custom provider ignores fencing | Integration | Medium | High | Explicit capability declaration and fail-closed diagnostic before invocation |
| Provider fallback consumes or bypasses recovery budget | Technical | Medium | Medium | Model candidates as children of one lifecycle attempt and test fallback/recovery interaction |
| Lifecycle file is stale after a completed step | Data | Medium | Medium | Terminal transition/reset tied to result settlement and dispatch identity |

## ADRs Created

- `adr-2026-07-30-provider-preparation-lifecycle-supervision` — DRAFT pending operator approval.

## Conditions

1. Spawn authorization must be checked before process creation; post-spawn kill alone does not
   satisfy the duplicate-worker guarantee.
2. Output activity and host process discovery remain non-authoritative for termination and recovery.
3. One automatic replacement is persisted across restarts; exhaustion writes `needs-human`.
4. Unsupported provider lifecycle capability fails closed before invocation.
5. Tests must cover late resume, silent running providers, restart persistence, fallback interaction,
   timeout-vs-spawn races, and lifecycle record reset.
