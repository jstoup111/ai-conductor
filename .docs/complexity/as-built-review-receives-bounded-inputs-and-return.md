# Complexity: as-built-review-receives-bounded-inputs-and-return

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | Two: the versioned as-built input projection (diff stat + capped per-file hunks with explicit omissions, plan task/Done-when ownership, sealed story criteria, approved ADR decisions, available pending findings) and the versioned typed as-built verdict (verdict, outcome-delivered, findings with structural ADR-decision or plan-task references) persisted as the run-identity-stamped authority |
| External integrations | Both provider adapters' native structured output (`--json-schema`, `--output-schema`) via the existing #2429 `nativeSchema` seam; no new adapter |
| Auth / permission surface | None |
| State machines | As-built completion gate, validation-group join, serial halt/kickback, remediation admission, recorded-findings projection, rebase/rekick preservation, and restart replay all switch from Markdown scraping to the typed result; mechanical-fault lane gains missing/invalid/unsupported and over-limit-input causes for this step |
| Story count | ~8 (bounded projection, native-schema dispatch, typed validation with field-named faults, engine-rendered report, consumer rewire, parser retirement, skill purge + audit, provider parity and interactive usability) |
| Files touched | ~15 engine modules (`step-runners`, `conductor`, `artifacts`, `as-built-policy`, `as-built-verdict-line`, `shipment-association`, `gate-code-validity`, `kickback-ledger`, `group-core`, `rebase`, `daemon-rekick`, `finish-publication-production`, `provider-execution`, new contract/projection modules), 1 SKILL.md section, 1-2 shell audits, several TS test suites, 3+ ADR amendments (as-built remediable findings D1/D2, ship-tail run identity D3, durable PRD widening D6), `docs/explanation/gates.md`, `docs/reference/steps.md`, a runbook |
| New runtime code | Projection builder with limits, JSON Schema + hand-written validator for the verdict, typed-verdict reader shared by all consumers, Markdown renderer for the human report; ~330-440 lines of Markdown parsers retired |

## Rationale

This moves the authority for one gate's verdict from a reviewer-written Markdown file to an
engine-validated typed object, and every downstream consumer — completion gate, validation-group
join, remediation handoff, shipped record, rebase preservation, restart replay — hangs off that
authority. It amends at least three approved ADRs and sets the pattern #2521, #2522, and #191
follow. Getting the contract or the persistence boundary wrong is expensive to reverse, so this
warrants the full architecture review and a conflict-check. → **Large.**
