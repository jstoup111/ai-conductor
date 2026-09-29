# Conflict Report: Compose launcher honors llm_provider for Codex

**Date:** 2026-09-28
**Scope:** repo_wide (`conflict_check.adr_corpus`). All 322 ADRs were examined: 58 were narrowed in
on subject and 264 narrowed out, 8 of them fully SUPERSEDED. Eleven story files touching compose
launch, provider selection, the provider catalog, or Codex parity were compared against Stories 1–5.
**Result:** 0 blocking. 2 degrading, both resolved: one by the operator's selected option and one by
an additive clarification. Four wording gaps were closed in the stories.

## Conflict: Run-level ladder would override DECIDE-step host pins

**Stories involved:** Story 1 (compose-launcher-honors-llm-provider-for-codex) vs adr-2026-07-24 Preserved Decisions
**Files:** .docs/stories/compose-launcher-honors-llm-provider-for-codex.md vs .docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md
**Type:** state-conflict
**Severity:** degrading
**ADR filename stem:** adr-2026-07-24-provider-aware-step-execution-fresh-session-scope
**Story ID:** Story 1
**ADR opposing sentence (verbatim):** "explicit per-step preferred providers; […] all-path routing through one resolver/runtime boundary."
**Story opposing sentence (verbatim):** "The bare launcher picks its interactive host from `--provider`, then the first entry of the launching directory's run-level `llm_provider`, then the catalog default."

**Description:** This repository sets run-level `llm_provider: [codex, claude]` and pins `explore`,
`prd`, `architecture_review`, and `conflict_check` to claude. A run-level first-entry rule would host
the whole composer DECIDE loop on codex, ignoring the per-step pins. It would also read
configuration outside the provider-selection resolver.

**Resolution Options:**
1. Resolve the `explore` step's provider selection (its pin, else run-level) through the existing resolver, and take the first entry.
2. Add a dedicated `compose.llm_provider` configuration key.
3. Keep run-level selection and require `--provider claude` or a reordered ladder.

**Recommendation and selection:** Option 1, selected by the operator. D10 of the amendment to
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery now names the `explore` step and the
merged configuration. Story 1 is updated in place, and the architecture review records the change.

## Conflict: Launcher argv builder outside the single dispatch member

**Stories involved:** Stories 2 and 3 (compose-launcher-honors-llm-provider-for-codex) vs adr-2026-08-24 D1, D7
**Files:** .docs/stories/compose-launcher-honors-llm-provider-for-codex.md vs .docs/decisions/adr-2026-08-24-one-dispatch-member-on-the-provider-contract.md
**Type:** overlap
**Severity:** degrading
**ADR filename stem:** adr-2026-08-24-one-dispatch-member-on-the-provider-contract
**Story ID:** Story 2
**ADR opposing sentence (verbatim):** "Neither adapter may keep a second private dispatch body."
**Story opposing sentence (verbatim):** "Each host is launched with the argv its catalog descriptor declares under `interactiveLaunch`."

**Description:** A provider-keyed argv builder outside the adapters could be graded at as-built as
a second dispatch path. The launcher does not dispatch engine work: it starts the operator's own
agent host, as `spawn('claude')` does today.

**Resolution Options:**
1. State in D9 that the launched session is an operator-hosted session under ADR-008, not engine provider dispatch.
2. Route the launch through the adapter `invoke` member.

**Recommendation and selection:** Option 1. D9 now carries that sentence, and the adapters are not
changed. Option 2 would force an interactive, stdio-inherited session through a one-shot dispatch
contract.

## Wording gaps closed (no conflict)

- **Merged configuration.** Story 1 now covers a user-level `llm_provider` with no project value,
  matching daemon-merged-config-967's merge semantics.
- **Plugin names.** Story 1 no longer says "nor a registered plugin". `compose` dispatches before
  plugin registration, so any non-catalog name gets the unknown-provider error, per D10.
- **Alias parity.** Story 1 adds `ai-conductor engineer --provider`, because the rename story
  requires both verbs to parse flags identically.
- **gh version floor ordering.** Story 4 now asserts that no intake issue is fetched or enqueued,
  instead of "no GitHub call". The existing adr-2026-09-05 floor check runs before the `launch` case
  and is kept.

## Assumptions carried to the plan

- The refusal message for `interactiveLaunch` takes its owning intake from the catalog's capability
  owner map. The map gains `interactiveLaunch` mapped to #1007.
- The skill-invocation prefix is read from the catalog descriptor rather than a third copy of the
  `/` and `$` rendering (adr-2026-07-25 D4).
- `--provider` is argv, not a configuration key, so it needs no config-consumer registry entry
  (adr-2026-08-26) and does not touch `bin/conduct`.
