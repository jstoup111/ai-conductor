# Complexity: engineer claim delivery guard (#243)

Tier: M

## Rationale

- **Scope:** three engine touch points — the `engineer claim` walk (claim-time delivery guard), the `engineer handoff` delivery paths (ledger advance on ALL outcomes incl. local-commit fallback), and a new `engineer resolve` recovery subcommand — plus unit tests, README/conductor-README docs, and CHANGELOG.
- **State-machine depth:** extends ledger lifecycle semantics (`claimed`-with-evidence handling, auto-heal to `done`, interplay with FR-39/40 reopen churn caps) and adds a gh PR-state cross-check with a fail-safe path on lookup failure. This is correctness-critical dedup logic in the duplicate-dispatch regression family (#204/#205/#243).
- **Not L:** no new subsystem, integration, auth surface, or schema migration — gh and the file ledger are existing seams; changes are localized to the intake layer.
- **Not S:** lifecycle/dedup subtleties and prior regressions in this exact area warrant architecture review (lightweight) and conflict-check.

Story count estimate: 4–6.
