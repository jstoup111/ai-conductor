# Conflict Report: Pi runs report token usage and cost into harness telemetry

**Date:** 2026-10-02
**Scope:** repo_wide (`conflict_check.adr_corpus`).
- Stories: `.docs/stories/` was keyword-scanned for token, cost, metering, rate-card, rollup, and Pi
  terms. These cost-bearing story files were compared pairwise in both directions against
  `.docs/stories/pi-runs-report-token-usage-and-cost-into-harness-t.md`:
  - pi-as-a-build-provider
  - pi-runs-stay-contained-despite-pi-having-no-permis
  - pi-per-step-model-selection-via-wrapped-providers
  - harness-skills-and-context-files-reach-pi-sessions
  - 2026-07-27-codex-usage-metering-and-cost-attribution-906
  - exported-telemetry-carries-no-cost-signal-so-spend
  - exported-step-cost-under-records-spend-20x-so-ever
  - export-the-telemetry-dimensions-the-engine-already
  - qualify-the-reported-cost-figure-when-it-covers-on
  - feature-cost-and-shipment-metrics-cannot-be-groupe
  - streaming-provider-dispatches-record-no-token-usag
  - support-astra-in-the-daemon
  - per-feature-token-accounting
  - stop-counting-provider-free-step-completions-as-un
- ADRs examined (APPROVED):
  - adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (D1–D18 and this spec's D19–D22)
  - adr-2026-07-22-build-dispatch-json-usage-capture
  - adr-2026-07-22-per-feature-cost-rollup-in-shipped-record
  - adr-2026-07-27-cost-unmetered-is-a-first-class-state
  - adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates
  - adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot
  - adr-014-otel-observability-exporter
  - adr-2026-08-19-live-provider-stream-observation
  - adr-2026-08-24-one-dispatch-member-on-the-provider-contract
  - adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope
- ADRs narrowed out: those off-subject for usage, cost, metering, rate card, rollup, catalog
  capabilities, or OTel cost export. None of the examined ADRs is fully superseded.
- Verified compatible: an explicit classification-level `costUsd: 0` in the #906 story is untouched,
  because Pi's zero is dropped at the adapter. `costSource` values `provider` and `rate-card` are
  already accepted by the OTel exporter. No story pins an exact `TokenUsage` key set, and no story
  prices by the requested model.

**Result:**
- 2 blocking conflicts, both in foreign-stem stories. They are resolved by a companion story PR.
- 1 degrading ADR inconsistency and 2 notes, all resolved in this spec.

## Conflict: Pi usage is per-turn and priced, not cumulative and cost-unmetered

**Stories involved:** pi-as-a-build-provider (invoke-result story) vs Story 1 and Story 2
**Files:** [.docs/stories/pi-as-a-build-provider.md] vs [.docs/stories/pi-runs-report-token-usage-and-cost-into-harness-t.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The existing criterion "Given Pi reports cumulative usage in the stream, when the
invoke result is built, then the usage is attached and the cost is recorded as cost-unmetered."
contradicts Story 2, which says "costSource is `provider`, and the dispatch classifies as
`fully-metered`". It also contradicts catalog D19, which says usage is per LLM call. A test built
from either criterion fails the other.

**Resolution Options:**
1. Replace the existing criterion in place so it defers to catalog D19 and D20.
2. Drop the existing criterion.

**Recommendation and resolution:** Option 1. The land stem gate rejects edits to a foreign-stem
story, so the replacement ships as a companion main-based story PR. That PR is merged together with
this spec.

## Conflict: Pi's costSelfReporting capability flips to true

**Stories involved:** pi-runs-stay-contained-despite-pi-having-no-permis Story 1 vs Story 5
**Files:** [.docs/stories/pi-runs-stay-contained-despite-pi-having-no-permis.md] vs [.docs/stories/pi-runs-report-token-usage-and-cost-into-harness-t.md]
**Type:** contradiction
**Severity:** blocking

**Description:** The existing criterion lists `costSelfReporting` among the capabilities that
"still return false". Story 5 says it "returns true" (catalog D22). These are the same
catalog field with opposite assertions.

**Resolution Options:**
1. Remove `costSelfReporting` from the existing false list.

**Recommendation and resolution:** Option 1, through the same companion story PR.

## Conflict: The #1886 amendment says Pi declares no costSelfReporting

**Stories involved:** ADR amendment (#1886) vs ADR amendment (#1889) D22
**Files:** [.docs/decisions/adr-2026-09-24-built-in-provider-catalog-and-boot-discovery.md]
**Type:** contradiction
**Severity:** degrading

**Description:** The #1886 amendment states that Pi "still declares no ... `costSelfReporting`". The
#1889 amendment's "every other statement is unchanged" would have left that clause standing
against D22.

**Resolution:** The #1889 amendment preamble now names the #1886 clause as replaced by D22.

## Notes resolved in this spec

- **Rate-card scope.** adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot D1
  names codex. D20 now states that it extends D1 to Pi.
- **Model dimension.** The rollup and OTel `model` dimension stays the requested model for Pi.
  D21 now says so explicitly, and Story 3 asserts it.
