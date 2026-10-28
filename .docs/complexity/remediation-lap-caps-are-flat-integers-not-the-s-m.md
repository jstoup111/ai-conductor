# Complexity: Remediation lap caps derive from the feature's complexity tier (#2413)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. `max_remediation_laps` widens from a positive integer to a positive integer or an `{S, M, L}` map; the resolved per-feature allowance is a pure function of (gate, config, tier) |
| External integrations | None |
| Auth / permission surface | None |
| State machines | None new. The existing kickback-ledger `effectiveLapCap` raise keeps precedence; no new ledger fields |
| Story count | ~5–7: tier defaults when unset, integer and map overrides with validation, no-tier fallback to M, lazy resolution after the complexity step, tier-and-allowance naming on halts and budget surfaces, root-config override removal |
| Files touched | ~7 production: `engine/config.ts`, `engine/remediation-caps.ts`, `engine/conductor.ts`, `engine/kickback-budget-cli.ts`, `engine/daemon-observe-cli.ts`, `engine/kickback-budget-view.ts`, `.ai-conductor/config.yml`; plus `templates/project-config.yml.template` and reference docs |
| ADR work | No new ADR: additive #2413 amendment notes on the three APPROVED ADRs that state a one-lap default (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback D5, adr-2026-08-25-as-built-remediable-findings-bounded-build-route D4, adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework D5). Precedence: operator raise > configured integer or the map's entry for the tier > tier default; no tier → M |

## Rationale

Medium. The change is localized behind one existing choke point (`remediationLapCapForGate`) but
it changes a consumer-visible configuration contract, stops materializing a default that loading
currently writes, and threads the tier through several enforcement and display call sites in
`conductor.ts`, one of which caches the cap before the complexity step records a tier. A mistake
silently hands a feature the wrong budget, so the precedence is recorded by amending the governing ADRs, but no new module,
state machine, or integration is introduced.
