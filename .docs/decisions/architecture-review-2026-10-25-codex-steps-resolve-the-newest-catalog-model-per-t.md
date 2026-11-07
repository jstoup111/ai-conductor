# Architecture Review: Codex steps resolve the newest catalog model per tier
**Date:** 2026-10-25
**Inputs reviewed:** explore output and track scope (`.docs/track/codex-steps-resolve-the-newest-catalog-model-per-t.md`), complexity (`Tier: M`), architecture diagram (`.docs/architecture/codex-steps-resolve-the-newest-catalog-model-per-t.md`), `.memory/decisions/2026-10-25-codex-tier-model-resolution.md`
**Mode:** Lightweight (Medium) — Sections 2 and 4
**Verdict:** APPROVED

## Feasibility

- **Stack compatibility.** No new dependency. `codex debug models` exists on the installed CLI and
  printed the tiered catalog as JSON on 2026-10-25 (codex-cli 0.160.1; verified). The probe reuses
  the `execa` runner shape, `assertRealExecAllowed` guard, and 5-second timeout of
  `engine/provider-model-probe.ts`.
- **Prerequisites.** None. Discovery (adr-2026-09-24 D3) already reports whether Codex is
  installed before the probe would run.
- **Integration surface.** Five areas: the Codex descriptor, policy defaults, policy lookup, the
  three dispatching boot paths, and the token-liveness probe. No external API beyond the local CLI.
- **Data implications.** None. No persisted state, schema, or migration. The registry is per
  process.
- **Performance risk.** One CLI subprocess (bounded at 5 s) per dispatching process start. Daemon
  concurrency 3 means at most a few probes per feature dispatch wave.
- **Worktree isolation.** No port, database, or shared file. Each process holds its own registry.

## Alignment

- **Reused governing decisions.** adr-2026-09-24 D8 and D13 govern where a provider catalog is
  listed (dispatching boot paths only, once, injected runner, guarded exec). This design follows
  them exactly. adr-2026-07-03 items 2–6 still hold: ladder entries remain opaque strings and the
  ladder walks whatever ids the materialized policy holds. Item 7's `llm_providers.codex`
  precedence is preserved because the registry policy is the base that configuration overrides.
- **Not reusing `modelCatalog`.** Declaring Codex's listing as `modelCatalog` would switch on
  adr-2026-09-24 D13 configured-id validation and adr-2026-10-06 D5 monitor membership, both
  outside the operator's scope. A separate tier-catalog member keeps those decisions unchanged. No
  on-main ADR assertion is falsified, so none is amended.
- **Floors over tier names.** Monitor defaults (adr-2026-10-06 D4), `generate-model-table`, and
  `rate-card refresh` read the static policy without probing. With floors, those readers keep
  today's ids rather than receiving a bare tier name. The operator approved this revision of the
  diagram on 2026-10-25.
- **Event spine.** No new channel. The resolved id travels in the existing `model` fields of
  dispatch, retry, and cost events, and warnings use the existing step-output log path.
- **Pattern consistency.** The process registry mirrors the per-process `ModelAvailability` cache.
  The tier-catalog member mirrors the descriptor-declared `modelCatalog` pattern with a narrower
  contract.
- **New structural decision.** Making policy ids floors that a CLI listing upgrades is a new
  integration pattern with an external catalog and changes how the built-in policy is
  materialized. It is captured in `adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog`.
- **Security.** The probe runs a fixed argv under the existing real-exec guard and parses JSON
  defensively. A parse failure degrades to floors.
- **Production DI defaults.** Not applicable; no store is introduced.

## Wiring Surface

- **Codex tier-catalog descriptor member** — declared on the Codex entry in
  `execution/provider-catalog.ts`; consumed only by the tier probe.
- **Tier probe** — called from the existing post-discovery startup sequence of the three
  dispatching boot paths, beside `validateConfiguredProviderModels`: `index.ts`, `daemon-cli.ts`,
  and `engine/executor-child-runtime.ts`.
- **Tier resolver and process policy registry** — the probe's result installs the registry;
  `resolveProviderModelPolicy` in `engine/provider-model-policy.ts` reads it for Codex, which is the
  lookup `resolveStepConfig`, `escalateAttempt`, `ModelAvailability`, and cost attribution already
  go through.
- **Unpriced-id warning** — emitted once at registry install, reading the committed rate card the
  cost path already loads.
- **Liveness alias** — the existing `token-liveness.ts` argv.

Advisory `ai-conductor overlap-scan` over these paths: no overlap, no open blockers.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| `codex debug models` output format changes | Integration | Medium | Medium | Parser returns unparseable; floors stay in force with a boot warning |
| A listed model is not usable by the account | Integration | Low | Medium | Existing `modelUnavailable` detection walks the resolved ladder |
| Newly resolved models are unpriced | Data | High | Low | One warning per id with the exact `rate-card refresh --model` remedy; dispatches stay counted as unmetered |
| Escalation to astra raises cost | Technical | Medium | Medium | Astra is only the last escalation rung, never a default or fallback rung |
| A policy reader bypasses `resolveProviderModelPolicy` | Technical | Medium | Low | That reader sees floors, today's behavior |

## ADRs Created

- `adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog` — APPROVED by operator 2026-10-25
