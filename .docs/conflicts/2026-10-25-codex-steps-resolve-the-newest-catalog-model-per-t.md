# Conflict Check: Codex steps resolve the newest catalog model per tier

**Date:** 2026-10-25
**New stories:** `.docs/stories/codex-steps-resolve-the-newest-catalog-model-per-t.md` (Stories 1–7)
**Result:** Passed after resolution — 2 blocking conflicts and 1 degrading overlap resolved by operator decision; 0 remain.

## Inventory

- **Stories narrowed in** (subject: Codex model ids, escalation, fallback, astra, rate card, liveness probe, model catalog): `support-astra-in-the-daemon`, `model-and-effort-resolution-provider-aware-902`, `retry-as-escalation`, `escalation-ladder-docs-cumulative-bump`, `model-attribution-and-provider-defaults-931`, `model-availability-fallback-ladder`, `monitor-guided-sessions-no-way-to-choose-provider-`, `coherence-check-l-tier-model-escalation-is-documen`, `pi-per-step-model-selection-via-wrapped-providers`, `pi-runs-report-token-usage-and-cost-into-harness-t`, `2026-07-27-codex-usage-metering-and-cost-attribution-906`, `exported-step-cost-under-records-spend-20x-so-ever`, `build-auth-token-check-and-classify`, `interrupted-self-host-runs-leak-provider-homes-unt`, `per-step-provider-routing-927`, `first-class-codex-harness-parity-904`, `interactive-skill-model-contract`, `simplify-evaluator-model-routing-to-a-two-way-risk`, `coverage-binding-retries-past-its-3-3-budget-when-`. All other story files were narrowed out by subject.
- **ADRs examined:** `adr-2026-07-03-reactive-model-fallback-ladder`, `adr-2026-07-05-retry-as-escalation-ladder`, `adr-2026-07-27-cost-unmetered-is-a-first-class-state`, `adr-2026-09-24-built-in-provider-catalog-and-boot-discovery`, `adr-2026-10-06-catalog-owned-interactive-model-and-effort`, `adr-2026-10-25-codex-model-floors-upgraded-from-cli-catalog`; plus `architecture-review-2026-09-10-support-astra-in-the-daemon` and `architecture-review-2026-07-23-provider-model-policies`.
- **ADRs narrowed out:** every other ADR in `.docs/decisions/` — none governs Codex model selection, escalation, fallback, pricing, or the liveness probe.

## Conflict: Astra was specified as never reachable by automatic escalation

**Stories involved:** Story 3 (escalation reaches astra) vs support-astra Story 2
**Files:** `.docs/stories/codex-steps-resolve-the-newest-catalog-model-per-t.md` vs `.docs/stories/support-astra-in-the-daemon.md`
**Type:** contradiction
**Severity:** blocking

**Description:** support-astra Story 2 required that Sol retries never introduce Astra ("when automatic model escalation runs, then it does not introduce Astra"), and its architecture review kept Astra out of "any default step model, tier override, automatic escalation order, or default fallback ladder". The new Story 3 escalates a Sol base to `gpt-6-astra` at attempt 3.

**Resolution Options:**
1. Amend the astra story in place and add amendment notes to its architecture review and PRD; astra becomes the top escalation rung and stays off defaults and the fallback ladder.
2. Drop astra from Codex escalation in this spec.

**Resolution (operator, 2026-10-25):** Option 1. support-astra Story 2's criterion and Done When now state Astra is reached from Sol only as the top escalation rung (attempt 3+), never by fallback; `architecture-review-2026-09-10-support-astra-in-the-daemon` and `specs/2026-09-10-support-astra-in-the-daemon` carry `Amended 2026-10-25` notes; the new ADR's context records the reversal.

## Conflict: Codex escalation cap stated as gpt-5.6-sol

**Stories involved:** Story 3 vs 902 escalation story, retry-as-escalation preamble, escalation-ladder-docs-cumulative-bump
**Files:** `.docs/stories/model-and-effort-resolution-provider-aware-902.md`, `.docs/stories/retry-as-escalation.md`, `.docs/stories/escalation-ladder-docs-cumulative-bump.md`
**Type:** contradiction
**Severity:** blocking

**Description:** These stated Codex escalation runs `gpt-5.6-luna → gpt-5.6-terra → gpt-5.6-sol`, capped at Sol. ADR D1 adds `gpt-6-astra` as the cap.

**Resolution Options:**
1. Replace the cap assertions in place with `… → gpt-5.6-sol → gpt-6-astra`, capped at Astra.
2. Keep Sol as the cap (equivalent to dropping astra escalation).

**Resolution (operator, 2026-10-25):** Option 1, applied in place. The retry-as-escalation preamble's amendment block was folded into plain text. The docs story's `HARNESS.md`/`README` prose obligations are left to the `maintain-documentation` pre-finish gate, not this spec.

## Overlap: Codex default-model tables read as the dispatched models

**Stories involved:** Story 1 vs 902 Story 1 and fallback story, 931 policy story, support-astra Story 2 HP-1
**Type:** overlap
**Severity:** degrading

**Description:** These tables and criteria present `gpt-5.6-*` as the Codex models for each step. The static policy keeps those ids, so their policy-level tests stay true, but a dispatching process now runs newer same-tier ids.

**Resolution (operator, 2026-10-25):** Each assertion now states in place that every Codex model is a floor a dispatching process may upgrade to a newer listed model of the same tier (this spec's Story 1).

## Pairs checked with no conflict (both directions)

- Story 6 vs `monitor-guided-sessions-…`: the monitor keeps launching `--model gpt-5.6-sol`; consistent.
- Story 1 vs `coherence-check-l-tier-…`: that story resolves through the static descriptor policy, which still returns `gpt-5.6-sol`; consistent.
- Story 5 vs metering and cost-unmetered stories (906, 2026-09 exported cost, Pi usage): unpriced resolved ids stay unmetered, never zero-priced; consistent.
- Story 5 vs support-astra Story 4: refresh still includes `gpt-6-astra` without extra arguments; consistent.
- Story 7 vs `build-auth-token-check-and-classify` and `interrupted-self-host-runs-…`: those assert credential handling and probe-home location, nothing about the model; consistent.
- Story 3 vs `adr-2026-07-05-retry-as-escalation-ladder`: caps remain at the top of each provider's order; consistent.
- Story 2 vs `adr-2026-09-24` D8/D13: the tier probe follows the same dispatching-only, once-per-boot, guarded-runner shape; no oscillation.
- Pi stories: Pi's operator-configured models are untouched.
