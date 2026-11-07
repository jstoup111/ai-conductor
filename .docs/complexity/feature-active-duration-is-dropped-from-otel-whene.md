# Complexity: Feature active duration is dropped from OTEL whenever the timing rollup is partial

**Plan stem:** `feature-active-duration-is-dropped-from-otel-whene`

Tier: M

## Signals

| Signal | Reading |
|--------|---------|
| New models / schemas | One additive optional `reason` field on the existing `feature_shipped` variant's `active` object (`src/conductor/src/types/events.ts:624`). One new OTEL counter beside the existing `conductor.feature.duration.active` histogram (`src/conductor/src/engine/otel/metrics.ts:319`), plus bounded attributes on that histogram. No new event variant, ledger, or persisted artifact. |
| Architecture decisions | Amends APPROVED `adr-014-otel-observability-exporter` Decision 9, which today omits `feature.duration.active` whenever the rollup state is `partial`. |
| Integrations | None external. Internal call sites: `otel/metrics-listener.ts` and `otel/metrics.ts` (recording), `daemon-runner.ts` (emission), `timing-rollup.ts` (retired-step identities), `provider-execution.ts` (attempt `invoked` derivation), `claude-provider.ts` / `codex-provider.ts` / `pi-provider.ts` (pre-spawn returns), `step-runners.ts` (remediation-closure judgement dispatch). |
| Auth / secrets | None. |
| State machines | None. |
| Story count | 4, plus in-place amendment of two accepted on-main stories that assert the omission. |

## Rationale

**Medium.** The code change is four localized defect fixes along one data path (provider attempt →
timing rollup → `feature_shipped` → OTEL metric), each reusing an existing seam: the existing
affirmative `executionDisposition: 'not-started'` signal, the existing `nativeSchemaScratch` input
every other native-schema auxiliary dispatch already passes, the existing retired-step registry, and
the existing event variant and metric instruments. It is Medium, not Small, because it reverses an
APPROVED ADR decision: ADR-014 Decision 9 omits active duration on every `partial` rollup, and this
spec records it whenever the active union itself is complete. That amendment needs a lightweight
architecture review and full obligation coverage of ADR-014's decisions.

Not Large: no new component, seam, external integration, or cross-spec reconciliation; the event
change is an additive optional field on an existing variant (the event-spine skill's sanctioned
extension form).

## Operator-approved assumptions (2026-10-26)

- Attempt `invoked` honors `executionDisposition: 'not-started'`, and provider adapters stamp that
  disposition on every return that precedes spawning the provider process. The execution-layer
  `providerInvocationSkipped` flag and its unavailable/fallback routing stay unchanged. Accepted
  consequence: a CI-fix repair session classifies such a failure as not-started
  instead of failed.
- Amend ADR-014 Decision 9 in place; tier M.
