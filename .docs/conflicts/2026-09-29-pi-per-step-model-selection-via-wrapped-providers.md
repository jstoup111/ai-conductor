# Conflict Report: Pi per-step model selection via wrapped providers

**Date:** 2026-09-29
**Scope:** repo_wide (`conflict_check.adr_corpus`).
- Stories: every file in `.docs/stories/` was keyword-scanned. Twenty-five provider, model,
  ladder and table story files were compared pairwise in both directions.
- ADRs examined (APPROVED):
  - adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (D1–D14)
  - adr-2026-07-03-reactive-model-fallback-ladder (items 1–8)
  - adr-2026-07-05-retry-as-escalation-ladder
  - adr-2026-07-03-generated-model-table-single-source
  - adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
  - adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
  - adr-2026-09-23-provider-admission-gate
  - adr-2026-07-21-s-tier-pipeline-knobs
  - adr-2026-08-12-live-provider-coverage-from-plugin-registry
  - adr-2026-08-24-one-dispatch-member-on-the-provider-contract
  - adr-2026-07-27-cost-unmetered-is-a-first-class-state
- ADRs narrowed out:
  - Off-subject: memory provider, auth park, rate-limit coordinator, build-review, rebase, halt,
    ship, version gate, project-config scaffolder.
  - Fully superseded, so excluded: gated-writeback-announcements,
    completeness-as-build-review-rubric, build-review-remediate-case-adjudication.

**Result:**
- 1 blocking conflict, resolved by operator decision.
- 6 degrading conflicts, each resolved.
- 0 remain after the re-check.

## Conflict: Pi as a fallback candidate has no native default model

**Stories involved:** Story 2 and Story 4 (pi-per-step-model-selection-via-wrapped-providers) vs
the per-step provider routing explicit-model story (#927)
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/stories/per-step-provider-routing-927.md, .docs/stories/pi-as-a-build-provider.md
**Type:** state-conflict
**Severity:** blocking
**ADR filename stem:** adr-2026-09-24-built-in-provider-catalog-and-boot-discovery
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "Pi's built-in model policy ships no model ids."
**Story opposing sentence (verbatim):** "Given a preferred Codex attempt that falls back to Claude, when Claude executes, then Claude receives its native default model, effort, and model-fallback behavior for that step and tier."

**Description:** Pi was already a legal fallback candidate (#1884 Story 4 uses a ladder of pi then
claude), and a fallback provider runs on its native default. With no built-in Pi models, a
fallback to pi would have no model to run.

**Resolution Options:**
1. When pi is configured anywhere, require `llm_providers.pi.model`, `model_escalation_order` and `model_fallback_ladder`, and make `llm_providers.pi.model` Pi's native default.
2. Refuse pi anywhere but first in a candidate ladder.

**Recommendation and selection:** Option 1, selected by the operator. Catalog D13 is updated in
this spec's amendment. Stories 2, 3 and 4 are updated in place.

## Conflict: Top-level fallback ladder scope

**Stories involved:** Story 5 vs the #902 ladder story and model-availability TS-5
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/stories/model-and-effort-resolution-provider-aware-902.md, .docs/stories/model-availability-fallback-ladder.md
**Type:** contradiction
**Severity:** degrading

**Description:** As drafted, ladder item 7 limited the top-level `model_fallback_ladder` to the
run-level provider. That would change the ladder for a codex step inside a claude run, contrary to
#902: "when a model is unavailable under either provider, then that exact configured order replaces
the provider default."

**Resolution Options:**
1. Preserve today's behavior, and exempt only a provider whose built-in policy ships no models (Pi).
2. Per-provider scoping as drafted, and amend #902 and TS-5.

**Recommendation and selection:** Option 1, selected by the operator. Ladder item 7 is updated in
this spec's amendment. Story 5 gains a negative path asserting that codex behavior is unchanged.

## Conflict: Exit-0 error stop vs Pi success parsing

**Stories involved:** Story 7 vs pi-as-a-build-provider Story 5
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/stories/pi-as-a-build-provider.md
**Type:** contradiction
**Severity:** degrading

**Description:** The older story says any exit-0 stream that ends in a terminal assistant message
succeeds: "Given Pi emits a JSONL stream ending in a terminal assistant message and exits 0, when
the adapter parses it, then the invoke result carries that message as output and the step reaches
its normal verdict."

**Resolution:** That criterion is narrowed to a terminal message whose stop reason is not an error.
It is replaced in place in a companion main-based PR, because the land stem gate rejects edits to a
foreign-stem story (catalog D14).

## Conflict: Pi ladder trigger under an explicit provider

**Stories involved:** Story 5 vs pi-as-a-build-provider Story 6
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/stories/pi-as-a-build-provider.md
**Type:** sequencing
**Severity:** degrading

**Description:** With `--provider` always passed, Pi forwards unknown model ids upstream instead of
printing its own not-found error. The model-unavailable signal can therefore come only from an
upstream signature that is not yet anchored.

**Resolution:** Accepted as a compromise. The boot probe is the primary guard against unknown ids.
Story 5 fires on the adapter's model-unavailable signal, and anchoring upstream model-not-found
output belongs to #2718. Story 5's requirement states this.

## Conflict: Pi table cells vs table completeness gates

**Stories involved:** Story 6 vs the #902 table story NP-3 and the interactive-skill model contract
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/stories/model-and-effort-resolution-provider-aware-902.md, .docs/stories/interactive-skill-model-contract.md
**Type:** overlap
**Severity:** degrading

**Description:** The completeness gates reject blank provider cells, and interactive rows have no
Pi step effort.

**Resolution:** `config-required` (engine-row Pi model) and `n/a` (interactive-row Pi model and
effort) become explicit sentinels that the gates accept. Blank cells still fail. This was selected
by the operator, and Story 6 is updated in place.

## Conflict: Stale two-provider wording in the table story

**Stories involved:** Story 6 vs generated-model-table
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/stories/generated-model-table.md
**Type:** overlap
**Severity:** degrading

**Description:** The older story's header says: "Engine-step rows now source and label both
built-in provider policies."

**Resolution:** The sentence is replaced in place, in the companion main-based PR, with wording
about every catalog provider's policy.

## Conflict: New config key vs the consumer registry

**Stories involved:** Story 5 vs adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal
**Files:** .docs/stories/pi-per-step-model-selection-via-wrapped-providers.md vs .docs/decisions/adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md
**Type:** overlap
**Severity:** degrading

**Description:** The ADR says new keys fail the registry test until they declare a consumer.

**Resolution:** Story 5's Done-When now requires declaring `llm_providers` in the consumer
registry.

## Re-check

After the resolutions, the pairs were re-examined in both directions:
- Stories 2, 4 and 5 against #927, #902 and TS-5.
- Stories 6 and 7 against the table and Pi stories.

No blocking or oscillating conflicts remain.
