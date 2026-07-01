# ADR: Single swappable self-host detection seam

**Date:** 2026-06-30
**Status:** APPROVED
**Feature:** Harness daemon self-host guardrails
**Related:** adr-2026-06-30-owner-gate-identity-resolution (IdentityResolver precedent),
adr-005-non-autonomy-and-read-only-governor, ADR-010 (single-owner pidfile)

## Context

Making the harness safe to daemon-register requires several guardrails (skill relink, sandbox
build, version + release-artifact gates). Each needs to know one thing: *is the repo under build
the harness itself?* We could scatter `repoRoot === resolveHarnessRoot()` checks at each site, or
centralize the answer.

Separately, the harness-wide rule "design for isolated EKS, not local"
([[feedback_design_for_isolated_eks_not_local]]) requires identity/trust decisions to be swappable
for a platform-provided identity later. The owner-gate already established this pattern with its
`IdentityResolver` seam (PR #175).

## Decision

Introduce **one** `SelfHostDetector` seam that answers "is this a harness self-build?" and gates
the entire guardrail bundle. It is an **interface** with a default implementation that compares the
build's repo root against the existing `resolveHarnessRoot()`
(`src/conductor/src/engine/install-freshness.ts`). Activation resolves as:

1. Config override (`harness_self_host.activation: force_on | force_off`) wins when present.
2. Otherwise auto-detect by normalized-realpath comparison.
3. Unresolvable harness root or any uncertainty → `isSelfHost = false` (fall to the unchanged
   normal path; a self-build activates only on a *positive* identification).

Guardrail activation code depends on the interface, never on `resolveHarnessRoot` directly, so a
platform identity (EKS) can replace path comparison without changing what any guardrail does.

## Consequences

- **Positive:** one attach point for the EKS identity swap; no scattered ad-hoc checks; the
  non-harness hot path costs exactly one boolean check (TR-13).
- **Positive:** consistent with the owner-gate `IdentityResolver` precedent — one mental model for
  identity seams.
- **Negative:** a thin interface for what is today a one-line path compare — accepted deliberately
  as the EKS forward-compatibility cost.
- **Guardrail:** identity is by resolved path, never by repo *name* (avoids a same-basename false
  positive); cosmetic path differences (trailing slash, symlinked segment) are normalized to avoid
  false negatives (TR-1).

## Alternatives rejected

- **Scattered `repo == harnessRoot` checks** (as in `bin/conduct`/`bin/migrate`): no single swap
  point for EKS, drift risk. Rejected.
- **Config-flag only, no auto-detect:** an operator who forgets the flag reintroduces the bootstrap
  hazard on the one repo that most needs it. Rejected; auto-detect is the safe default.
