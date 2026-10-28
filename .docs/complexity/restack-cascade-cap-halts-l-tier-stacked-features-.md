# Complexity: Restack cascade cap is sized by the feature's complexity tier (#3472)

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | None. One new optional config key, `stacked_prs.max_restack_cascades`, accepting a positive integer or an `{S, M, L}` map. The resolved allowance is a pure function of (config, tier). |
| External integrations | None |
| Auth / permission surface | None. The operator-authorized `kickback-budget raise|reset --gate restack` recovery is unchanged apart from the default limit it measures against. |
| State machines | None new. `refs/conductor/<slug>/cascades` keeps its version-1 shape; an operator raise is still a per-child `limits` entry and keeps precedence over the tier default. |
| Story count | 4: tier defaults at the enforcement point, configuration and its validation, raise recovery measured against the tier allowance, and the allowance shown on the halt, inspect and daemon status before exhaustion. |
| Files touched | About 7 production files: new `engine/restack/cascade-allowance.ts`, `engine/restack/cascade-cap.ts`, `engine/restack/restack-executor.ts`, `engine/restack/stack-preflight.ts`, `engine/kickback-budget-cli.ts`, `engine/daemon-observe-cli.ts`, `engine/config.ts` and `types/config.ts`; plus the config consumer registry test. |
| ADR work | No new ADR. One additive `Amended 2026-10-28 by #3472` note on `adr-2026-10-10-stacked-restack-journaled-replay` decision 10, which fixes the bound at `MAX_RESTACK_CASCADES_PER_CHILD = 3`. |

## Rationale

Medium. The change mirrors #2413 (tier-aware remediation lap allowances) on a second budget: one
resolver, one new config key reusing the existing integer-or-tier-map validator, and the tier
threaded to the one enforcement site (the stack preflight's discarded duplicate check is removed), the raise/reset CLI and two read-only operator surfaces. A
mistake silently hands a stacked feature the wrong cascade budget or makes a raise refuse as
stale, so the precedence is recorded by amending the governing ADR decision. No new module
boundary, persisted state shape or integration is introduced, and the change builds on #3475's
per-child restack limit model rather than redesigning the ledger.
