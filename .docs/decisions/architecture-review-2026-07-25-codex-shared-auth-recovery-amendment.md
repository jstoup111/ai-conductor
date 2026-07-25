# Architecture Review: Codex Shared Authentication Recovery Amendment (#905)

**Date:** 2026-07-25
**Mode:** Amendment (Medium tier; conflict-check kickback)
**Input:** Approved amended PRD FR-10 and FR-22; current provider/auth recovery code;
approved ADR `adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`
**Verdict:** APPROVED WITH CONDITIONS
**Approval:** Approved by James Stoup on 2026-07-25.

## Structural Gap

The first #905 architecture routed Codex authentication failures directly to HALT,
while existing provider routing and Claude recovery used a shared auth-precedence
path. The amended product contract requires one parked lifecycle while preserving
provider-owned readiness. This is a genuine recovery-boundary change, so amendment
mode is appropriate; unrelated auth selection, sandbox, permission, and self-host
decisions were not reopened.

## Technical Feasibility

- **Verified:** serial and concurrent-group auth failures already converge at two
  conductor recovery joins and do not enter provider/model fallback.
- **Verified:** the feature-run conductor owns `ProviderRuntimeSet`, whose runtime
  exposes the selected provider instance. A narrow optional readiness capability can
  be consumed without changing custom-provider requirements.
- **Verified:** the planned Codex preflight already needs one reusable captured
  readiness runner/parser. Calling the same capability from recovery avoids a second
  auth implementation and never starts substantive model work.
- **Verified:** existing auth-park timeout, event, no-budget, and failed-group-member
  redispatch behavior can be retained.
- **Verified:** no database, service, package, port, queue, credential store, or
  deployment topology is required.

The amendment is feasible within the existing TypeScript provider runtime and
conductor recovery boundaries.

## Architectural Alignment

- **Provider isolation:** the conductor owns park timing/state; providers own
  credential interpretation and readiness. No cross-provider credential access is
  introduced.
- **Failure precedence:** authentication continues to stop candidate/model walking
  before recovery, preserving #927.
- **State integrity:** provider, source, readiness, and remediation travel together;
  a key that cannot hot-reload is represented as restart-required rather than falsely
  ready or continuously retried.
- **Backward compatibility:** Claude credential sources and permission flags remain
  provider-owned. The operator-visible auth disposition becomes consistently parked,
  as required by amended FR-22.
- **Security:** raw provider diagnostics remain below the adapter boundary. The park
  persists no credential material and creates no new writable credential location.
- **Self-host:** provider selection still precedes setup. “Codex skips Claude setup”
  means only Claude-specific relink/config/credential/hook preparation; common
  self-host release gates remain mandatory.

## Wiring Surface

| Surface | Design-time destination | Production caller / consumer |
|---|---|---|
| Typed Codex readiness result and reusable probe | Codex execution adapter | Pre-dispatch invocation path and shared auth park coordinator |
| Provider/source/readiness recovery metadata | additive invocation and step results | provider executor, step-runner adapters, serial recovery, group join, auxiliary adapters |
| Shared bounded auth park coordinator | existing conductor auth-recovery seam | serial failure branch and concurrent-group auth join |
| Restart-required key disposition | shared auth park result/message builder | environment-key failures, timeout HALT, daemon restart/requeue diagnostics |

The original #905 wiring for explicit Codex policy arguments and provider-aware
self-host preparation remains unchanged.

## Early Overlap Scan

`conduct-ts overlap-scan` completed for the provider interface, Codex adapter,
provider runtime/execution, step-runner, group, and conductor candidates. It emitted
the known broad historical-branch matches for `llm-provider.ts`; current `main`
already contains the relevant Codex/provider-routing deliveries. Treat the provider
interface and conductor recovery joins as high-contention edit sites and re-read
their current signatures immediately before implementation, but no unmerged
behavioral dependency blocks this amendment.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Recovery accidentally starts paid model work | Integration | Low | High | Only call the adapter's captured readiness capability; assert zero substantive invocations while parked |
| Group recovery reruns successful siblings | State | Low | High | Preserve existing failed-index redispatch contract and add Codex group coverage |
| API key appears hot-reloadable but cannot change | Operational | Medium | Medium | Explicit restart-required state/message; no credential-store fallback |
| Raw doctor/auth detail leaks during repeated probes | Security | Low | High | Typed result only; captured streams; adversarial redaction fixtures across park events and HALT |
| Shared coordinator becomes a generalized provider framework | Technical | Low | Medium | Built-in provider/source switch plus narrow optional readiness capability; custom providers remain unchanged |

## ADR

Approved ADR:
`adr-2026-07-25-provider-neutral-auth-park-source-specific-readiness`.

It supersedes the original #905 ADR because it changes the cross-cutting authentication
recovery strategy. The original ADR is retained as superseded decision history and is
no longer authoritative for authentication recovery.

## Conditions

1. No recovery probe may initiate substantive model work.
2. Restart-required API-key handling must add no key storage or hot-reload source.
3. Existing confidentiality, no-budget, no-fallback, bounded-policy, and self-host
   isolation conditions remain implementation gates.

## Verify-Claims Verdict

**CLEAR** — all technical claims above were verified against current source or prior
direct Codex probes. The operator approved the only load-bearing product choice; no
unconfirmed assumption drives this amendment.
