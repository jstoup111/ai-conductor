# Architecture Review: Provider Model Policy Effort Amendment

**Date:** 2026-07-23
**Mode:** Lightweight amendment (Medium tier)
**Input reviewed:** conflict-check effort objection, accepted #902 stories,
current provider-policy architecture, S-tier effort decision, and operator
clarification
**Verdict:** APPROVED

## Amendment Scope

This review addresses only the effort-policy gap reopened during conflict
review. It does not re-derive the provider registry, model mapping, escalation
and fallback orders, explicit-override precedence, plugin boundary, or wiring
surface.

The approved amendment sets:

- `explore.S` to `low` for both built-in providers.
- `explore` at M/L or without a tier to `high` for both providers.
- `prd` at every tier to `high` for both providers.

## Feasibility

- **Stack compatibility — verified:** `high` is already a valid
  `EffortLevel` and is supported by both provider invocation paths.
- **Resolution seam — verified:** the explicit per-provider effort table and
  existing tier override represent the amendment without a new field, schema,
  branch, or public contract.
- **Escalation composition — verified:** the existing effort order makes
  attempt 2 a deterministic `high → xhigh` bump; model escalation remains
  unchanged on attempt 3+.
- **S-tier composition — verified:** retaining `explore.S: low` preserves the
  approved cheap-small-work override and its retry safety net.
- **Worktree isolation — verified:** this is immutable table data and generated
  documentation; it introduces no shared runtime resource.

## Alignment

- **Per-step policy intent:** the policy contract exists specifically to tune
  individual tasks; raising two high-cascade DECIDE steps fits that boundary.
- **Provider independence:** selecting the same initial effort for Claude and
  Codex does not couple their model tables; future evidence may still tune them
  independently.
- **Compatibility posture:** Claude model IDs, model orders, fallback order,
  overrides, and all other effort values remain unchanged. The two effort
  changes are deliberate and exhaustively specified rather than accidental
  refactor drift.
- **Retry resilience:** `high` leaves `xhigh` as the first retry rung, whereas
  restoring `xhigh` would skip directly to `max`.
- **Diagram accuracy:** the provider-policy component description and retry
  comparison now identify the deliberate Claude effort exception; no component
  or control-flow edge changes.
- **Security and data:** no input, persistence, authorization, or sensitive-data
  boundary changes.
- **Verify-claims verdict:** CLEAR. The operator explicitly approved `high` for
  both providers and retained `explore.S: low`.

## Wiring Surface

Unchanged from
`architecture-review-2026-07-23-provider-model-policies`. The amended values
flow through the same policy lookup, resolver, retry escalator, provider
invocation paths, and generated-table consumer.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|------|------|------------|--------|------------|
| Discovery/PRD token use increases | Performance/cost | Certain | Medium | Limit the change to two steps; retain `explore.S: low`; keep override precedence |
| A compatibility test preserves stale `medium` | Technical | Medium | Medium | Exhaustive provider × step × tier expected-value tests |
| Retry tests miss `high → xhigh` | Technical | Low | Medium | Add explicit attempt-2 assertions for both steps/providers |

## ADRs Created

- `adr-2026-07-23-provider-policies-with-deeper-discovery-effort` — APPROVED by
  the operator on 2026-07-23; supersedes
  `adr-2026-07-23-built-in-provider-model-policies`.

## Conditions

1. The plan must preserve `explore.S: low` while changing the M/L base.
2. Generated documentation and compatibility tests must show the deliberate
   Claude effort delta rather than claim exact equality with the pre-#902 table.

## Blocking Issues

None.
