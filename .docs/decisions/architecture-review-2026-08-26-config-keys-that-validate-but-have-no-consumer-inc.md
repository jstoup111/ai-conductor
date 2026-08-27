# Architecture Review: Config keys that validate but have no consumer (#1025)
**Date:** 2026-08-26
**Mode:** lightweight (Tier M, technical track — §2 feasibility + §4 alignment)
**Stories reviewed:** none yet (pre-stories review; input = explore output + approved approach)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

All changes sit in four engine files (`engine/config.ts`, `engine/resolved-config.ts`,
`engine/steps.ts`, `types/config.ts`) plus two templates and `docs/reference/configuration.md`.
No new packages, services, migrations, or external integrations. Every claim about current
consumers was verified against source 2026-08-26 (confidence: verified — file:line evidence in
the ADR and the repo-wide sweep). Worktree-safe: no shared runtime state.

## Alignment

A repo-wide ADR sweep (513 files, all statuses read; 30 read in full) found:

- **Complies:** validator acceptance of `gate`/`kickback_target`
  (adr-2026-07-25-custom-step-completion-artifacts, adr-2026-08-03-fail-closed-decide-entry,
  adr-2026-07-27-daemon-decide-kickback-halt); the project-path `conductor` guard
  (adr-2026-07-01-machine-scoped-operator-identity D1/D2, pre-merge seam per
  architecture-review-2026-07-30-user-level-config-precedence); deleting
  `resolveMergeableAutoresolve` (block stays live per adr-2026-07-04-autoresolve-state-and-config);
  removing `defaults.by_tier` acceptance (unclaimed by adr-2026-07-21-s-tier-pipeline-knobs D1).
- **Conflicted, resolved by operator decision (2026-08-26):** one-shot key removal vs the
  two-phase retirement contract — resolved by an explicit, dated, scoped operator waiver recorded
  in the new ADR, with a mandatory `## Migration` block in the implementation PR;
  `skill_relink_preflight` removal keeps the relink guardrail unconditionally on (verified: all
  four call sites invoke it unconditionally); the coverage check takes the total-registry shape
  mandated by adr-2026-07-26-event-sink-registry-exhaustiveness, not a runtime grep assertion.
- **Constraint honored:** the nested `harness_self_host.auth_park_timeout_minutes` contract is
  untouched (adr-2026-08-07 teardown ADR cross-references its zero-value divergence).

## Wiring Surface

| New/changed surface | Production consumer (design-time commitment) |
|---|---|
| `knownStepKeys` + `gate`/`kickback_target` | `validateConfig` on every config load; values consumed by `buildStepRegistry` (`engine/steps.ts`, already-live reads at ~614-617) |
| `conductor` project-source guard | `validateConfig` project pre-merge pass in `engine/config.ts`, same seam as the `spec_owner` guard |
| Config-key consumer registry (`Record<key, declaration>`) | New module under `src/conductor/src/engine/`, imported by the new coverage test in `src/conductor/test/engine/`; totality enforced at test time against the validator's accepted key sets |
| Validator/type/resolver removals | Existing loaders — removal changes `validateConfig` behavior (unknown-key rejection) on every load |
| `## Migration` block (PR body) | Executed by `bin/migrate` per adr-2026-08-03-ledgered-per-block-migration-execution (idempotent, no relative harness-binary invocation) |

Early overlap scan: run before `/plan` over `src/conductor/src/engine/config.ts`,
`src/conductor/src/engine/resolved-config.ts`, `src/conductor/src/engine/steps.ts`,
`src/conductor/src/types/config.ts` (advisory).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Operator config carrying a removed key hard-fails on upgrade | Integration | Medium | Medium | Waived one-shot break + mandatory `## Migration` block deleting the keys |
| Repo's own `.ai-conductor/config.yml` carries a removed key | Integration | Low | High | Story: assert the live config and both templates validate after the change |
| Registry totality drifts from validator accepted sets | Technical | Medium | Medium | Test derives the key universe from the validator's own sets, not a hand copy |
| Guard fires on merged user `conductor` values | Technical | Low | High | Guard runs pre-merge on the project source only (per #1000 review) |

## ADRs Created

- `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` (DRAFT → pending
  operator approval; carries the dated one-shot removal waiver)

## Conditions

1. The implementation PR body carries a `## Migration` block removing the deleted keys from
   user and project configs; no `.docs/release-waivers/` file may substitute.
2. `docs/reference/configuration.md` is updated in the same PR: the six affected
   known-limitation blocks removed/replaced; the auth-park zero-value divergence cross-reference
   (teardown section) verified intact; surviving inert-by-design keys covered by registry
   `none` declarations.
3. Templates (`templates/project-config.yml.template`, `templates/ai-conductor-config.yml.template`)
   and `config-template.test.ts` updated in the same diff as the key removals.
4. `gate` and `kickback_target` validate as booleans fail-closed; both keys rejected on built-in
   steps (completion_artifact contract).
   > **Amended 2026-08-26 by #1025 DECIDE:** originally read "gate values validate against known
   > gate names" — `gate` is a boolean per `types/config.ts` and `buildStepRegistry`.
