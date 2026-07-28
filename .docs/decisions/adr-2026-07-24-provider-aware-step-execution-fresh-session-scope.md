# ADR: Provider-aware step execution with fresh step-scoped sessions

**Date:** 2026-07-24
**Status:** APPROVED
**Supersedes:** `adr-2026-07-24-provider-aware-step-execution`
**Deciders:** James Stoup (operator), conflict review for issue #927

## Context

The superseded #927 ADR correctly chose a shared provider-aware resolver and
provider-local runtime contexts, but incorrectly described provider-native
sessions as durable across later steps. That contradicts the accepted and
implemented fresh-session-per-step contract from issue #325:

- every executed step begins with a fresh session;
- a retry within the same step resumes that step's session;
- stale-session recovery may replace that session without consuming retry
  budget; and
- concurrent and one-shot auxiliary work remains isolated.

Per-step provider fallback adds another identity boundary inside a step. A
session identifier created by Claude cannot be resumed by Codex, and a fallback
provider must not inherit the preferred provider's conversation or native
authentication context.

## Decision

Retain the superseded ADR's provider configuration, resolver, native policy,
availability, fallback, auxiliary-path, and attribution decisions. Amend only
session ownership as follows.

### 1. Session identity is scoped by step and provider

Each provider's first invocation for an executed step starts a fresh native
session. Session state is keyed by at least the current step execution and
provider key; it is never reused by another provider or carried into a later
step.

Crossing a normal conductor step boundary invalidates every provider session
created for the prior step. This preserves #325 even when one step attempted
multiple providers.

### 2. Retries resume only within the same step and provider

> **Superseded in part (2026-07-27):**
> `adr-2026-07-27-codex-never-resumes-a-harness-minted-session` qualifies this
> rule by provider capability. A retry may resume only when its provider declares
> `supportsSessionResume`; Codex does not declare that capability.

A budget-consuming retry or non-consuming recovery retry may resume the session
created by the same provider for the current step. It may not resume:

- a different provider's session;
- a session from an earlier step;
- a concurrent branch's session; or
- a one-shot auxiliary session.

If a retry again reaches a fallback provider used earlier in the same step, it
may resume that fallback provider's step-scoped session. Stale-session recovery
replaces only that step-and-provider session and retains the existing
non-consuming retry behavior.

### 3. Provider fallback starts provider-native context

When the candidate loop crosses from one provider to another, the fallback
provider's first attempt for the current step creates a fresh session with that
provider's permissions and authentication context. No session identifier,
created marker, transcript context, or credential state crosses the provider
boundary.

### 4. Concurrency and auxiliary paths stay isolated

Concurrent branches remain branch-, step-, and provider-local. Existing
one-shot judgment, attribution, prelude, rebase, remediation, setup-fix,
CI-fix, and recovery paths keep their stricter fresh-session behavior unless
they implement retries for the same logical step; any such retry may resume
only its own step-and-provider session.

### 5. Persistence remains compatible without restoring cross-step context

The existing scalar/single-provider path retains the accepted #325 behavior and
compatible marker durability needed for retry and crash recovery. Persistence
must identify the owning step and provider before any resume. A legacy marker
must never cause a new step or another provider to resume an old conversation.

## Preserved Decisions

All non-session decisions from
`adr-2026-07-24-provider-aware-step-execution` remain authoritative:

- scalar or ordered run-level provider configuration;
- explicit per-step preferred providers;
- selected-first, configured-order provider fallback;
- provider-native model and effort resolution;
- provider-local model-availability caches;
- fallback only for explicit provider/model unavailability;
- no provider fallback for authentication or ordinary failures;
- all-path routing through one resolver/runtime boundary; and
- preferred/actual provider attribution for warnings, events, and usage.

## Consequences

### Positive

- #927 composes with the already-shipped #325 context-isolation guarantee.
- Mixed-provider fallback cannot leak conversation context across providers.
- Retry continuity remains available without permitting cross-step context
  accumulation.
- Session tests have an explicit key: step execution plus provider.

### Negative

- A provider runtime cannot own one durable session independent of the active
  step.
- Retry/crash-recovery markers need enough ownership metadata to reject a
  different step or provider.
- Candidate-loop tests must distinguish first provider use in a step from a
  later retry on that same provider.

## Follow-up Actions

- [ ] Model session state by step execution and provider.
- [ ] Reset all provider session state at every executed step boundary.
- [ ] Start a fresh session on the first attempt by each provider in a step.
- [ ] Resume only same-step, same-provider retries.
- [ ] Preserve branch and auxiliary one-shot isolation.
- [ ] Add mixed-provider boundary, retry-resume, fallback, stale-session, and
      crash-recovery tests.
