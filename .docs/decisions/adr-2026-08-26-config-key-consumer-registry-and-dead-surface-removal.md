# ADR: Config-key consumer registry and one-shot dead-surface removal

Status: APPROVED
Date: 2026-08-26
Source: jstoup111/ai-conductor#1025

## Context

Seven config surfaces validate but do nothing (verified against source 2026-08-26):
`defaults.by_tier` (accepted by `validateEffortAndModelBag`, read only from `steps.*`/`phases.*`),
`complexity.default_tier` (type + validator, zero consumers), `harness_self_host.skill_relink_preflight`
(resolved to `skillRelinkPreflight`, read only by tests — all four relink call sites run
unconditionally), `resolveMergeableAutoresolve` (zero callers; the `mergeable_autoresolve` block
itself is live via six raw readers), top-level `auth_park_timeout_minutes` (typed + resolver, absent
from `knownTopLevelKeys` so rejected at load; only the nested `harness_self_host` variant works),
and `steps.<custom>.gate`/`kickback_target` (typed, read by `buildStepRegistry` at
`steps.ts:614-617`, but rejected by `knownStepKeys`). The per-user `conductor` block is also
overridable by a project config because `mergeConfigs` gives project precedence and only
`spec_owner` carries a source guard.

## Decision

1. **Accept `steps.<custom>.gate` and `steps.<custom>.kickback_target` in `knownStepKeys`**, under
   the same contract as `completion_artifact`
   (adr-2026-07-25-custom-step-completion-artifacts): custom-step-only, rejected on built-in
   steps, fail-closed type checks (both keys boolean — `gate` forces gate-loop membership per
   the `StepConfig` type doc; `kickback_target` opts into kickback routing).
   > **Amended 2026-08-26 by #1025 DECIDE:** an earlier draft called `gate` a string naming a
   > known gate; `types/config.ts` and `buildStepRegistry` define it as a boolean
   > (`loopGate: custom.gate ?? targetStep.loopGate`). Validation is a boolean type check.
   The engine already treats custom kickback targets as load-bearing
   (adr-2026-08-03-fail-closed-decide-entry D4); the validator was the outlier.

2. **Remove the dead surface in one shot**: `complexity.default_tier` (type, validator, template
   comments, docs), `harness_self_host.skill_relink_preflight` (type, validator whitelist,
   resolver field, docs — the relink guardrail remains unconditionally on),
   top-level `auth_park_timeout_minutes` (type + `resolveAuthParkTimeoutMinutes`; the nested
   `harness_self_host.auth_park_timeout_minutes` survives with its contract untouched — 0 means
   immediate credentials HALT, non-integer/negative coerce to 60 — and the top-level type doc's
   contradictory claims die with it), `defaults.by_tier` acceptance in
   `validateEffortAndModelBag` (the `steps.*`/`phases.*` `by_tier` readers are unaffected), and
   the `resolveMergeableAutoresolve` helper (the `mergeable_autoresolve` key stays; its six raw
   consumers keep the fail-closed `suite_command` contract).

   > **Operator waiver (2026-08-26, scoped to this change only).** The operator explicitly waived
   > adr-2026-08-11-deprecated-no-op-step-retirement's two-phase accept-and-ignore contract for
   > these key removals, accepting a one-shot breaking change: a config carrying a removed key
   > hard-fails load with the ordinary unknown-key error. The two-phase contract remains in force
   > for future retirements. The implementation PR MUST carry a `## Migration` block deleting the
   > removed keys from user and project configs (a `.docs/release-waivers/` waiver is forbidden —
   > this is a real schema behavior change, per adr-2026-07-06-migration-gate-waiver).

3. **Guard the `conductor` block against project-path override**, copying the `spec_owner`
   pattern (adr-2026-07-01-machine-scoped-operator-identity D1/D2): the guard runs pre-merge on
   the project source (per architecture-review-2026-07-30-user-level-config-precedence), is a
   hard config-load error, and names the offending file and the fix. This discharges the deferred
   "reject self-host/user keys in consumer configs" work noted in
   adr-2026-07-27-project-config-scaffolder for this block.

4. **A total config-key consumer registry, not a runtime grep assertion.** Following
   adr-2026-07-26-event-sink-registry-exhaustiveness, a single
   `Record<DocumentedConfigKey, ConsumerDeclaration>` maps every documented config key to its
   production consumer declaration, where `{ consumer: 'none', reason: '<why, with tracked ref>' }`
   is a first-class, reviewable declaration (grammar mirrors the INERT waiver of
   adr-2026-07-12-wired-into-contract). "Valid but deliberately inert" states
   (adr-2026-07-03-pr-timing-self-host-precedence) are declared, not violations. A test asserts
   (a) the registry is total over the validator's accepted key sets, and (b) every non-`none`
   declaration names a resolvable production consumer. New keys fail the test until they declare
   a consumer or a reasoned `none` — the durable check mandated by
   adr-2026-08-09-conductor-block-single-source-of-truth decision 7.

## Consequences

- Custom steps can finally declare `gate`/`kickback_target` — the documented extension path works.
- Operators with removed keys in a config get a hard load error on upgrade; the migration block
  removes them mechanically.
- The `configuration.md` known-limitation blocks for the removed/unblocked surfaces are deleted in
  the same PR; surviving inert-by-design keys are covered by registry `none` declarations instead
  of contradicting the coverage test.
- Note: adr-2026-07-21-s-tier-pipeline-knobs D5's optional `size: S` → `Tier: S` seed is a
  label-sourced artifact seed, not the `complexity.default_tier` config key; deleting the key does
  not affect D5.

## Alternatives considered

- **Accept-and-ignore (two-phase retirement)** — rejected by explicit operator waiver: pre-v1,
  keys have zero consumers, and carrying decorative accepted keys is the defect class this issue
  exists to remove.
- **Wire the dead keys to new consumers** — rejected as three unrequested features (L tier).
- **Runtime assertion that every key appears in some consumer** — rejected; the shape
  adr-2026-07-26 already rejected, and it cannot express deliberate inertness.
