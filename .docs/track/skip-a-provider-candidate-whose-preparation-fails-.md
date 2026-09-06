# Track: Skip a provider candidate whose preparation fails

Track: technical

Scope boundary: Small fix for #1285, approved by the operator on 2026-09-06 (delegated). A provider
candidate whose pre-dispatch preparation hook fails must be classified as unavailable for that
attempt so the candidate loop resolves and dispatches the next declared entry, and the skip must be
visible through the attempt telemetry and fallback warning the loop already emits. Out of scope: any
change to the step-level retry budget once every candidate is exhausted, any change to the
self-host preparation hook's own capability checks, run-wide provider disabling for a preparation
failure, and any new event, field, or diagnostic channel.

This is an internal engine dispatch correction; acceptance criteria live in technical stories rather
than a PRD.

The operator approved, on 2026-09-06 (delegated), treating every preparation failure as
candidate-scoped unavailability rather than sniffing the thrown error for a "capability gap"
subclass. The issue left open whether only static capability checks should fall through; a typed
subclass would need a new error contract on the preparation hook, which is neither Small nor
reversible, while classifying any unpreparable candidate as unavailable keeps the loop fail-closed
(the step still fails when no candidate can be prepared) and matches the existing precedent for a
provider that cannot honor a required capability.

The issue's fourth desired outcome — that a setup-time capability failure consume no dispatch retry
— is satisfied for the declared multi-candidate case, because a usable next candidate now completes
the step and no retry is taken at all. Changing what the step-level retry budget does when every
candidate is unpreparable would reach the conductor's retry classifier and is deliberately excluded.

Scope check: A — consumer-facing. The change is in the shared candidate executor
(`src/conductor/src/engine/provider-execution.ts`), not under `src/conductor/src/engine/self-host/`
and not gated behind `isSelfBuild()`; `prepareCandidateSelfHost` is a declared hook on the shared
`ExecuteProviderCandidatesInput` and `ProviderExecutionContext` contracts that the shipped engine
runs in every project. The only production installer of that hook today is this repository's
self-host dispatch, which is why the reported incident is a self-host one, but the mechanism being
corrected is the consumer-facing candidate loop. B — n/a (no new skill). C — provider-agnostic: the
classification forks on no provider name and reads only the shared invoke-result contract; the codex
and claude preparation branches keep their existing separate mechanics. No catalog registration is
required.

Verified foundation: `provider-execution.ts:610-656` awaits `prepareCandidateSelfHost` inside
`invoke()`, whose enclosing `finally` tears down any prepared self-host context and closes the
candidate stream observer, but a rejection there propagates out of `executeProviderCandidates`
entirely, so `classifyProviderCandidateFailure` (`:294-309`) never runs and the loop's
next-candidate branch (`:693-760`) is unreachable. `conductor.ts:5231-5236` is the reported thrower:
it raises `Codex self-host isolation is unavailable for the resolved provider candidate.` when the
resolved runtime lacks `prepareSelfHostAuth`, `resolveSelfHostExecutable`, or
`provisionProviderHome`. `provider-execution.ts:260-271` already constructs exactly the shape this
fix needs for a provider that cannot honor a required capability — `providerUnavailable` with a
`run` scope, `providerInvocationSkipped`, and a reason naming the provider and a recovery action —
and `:503-505` renders such a result as an `unavailable`, uninvoked attempt with a redacted reason.
`:325-349` sets `runWideUnavailable` only from an attempt that reached the runtime, so a synthetic
preparation result does not durably disable the provider for later attempts. The approved
provider-preparation ADR requires a provider lacking a required capability to fail closed before
invocation naming the provider and the recovery action, and the approved provider-aware step
execution ADR limits candidate advancement to explicit provider or model unavailability; classifying
an unpreparable candidate as provider unavailability satisfies both without an amendment.
