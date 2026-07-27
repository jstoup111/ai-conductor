# Complexity: Codex usage metering and cost attribution (#906, absorbs #1008)

Tier: L

## Rationale

Scored against conduct's signals (models, integrations, auth, state machines, story count):

- **New data models:** yes — one genuinely new concept. Metering becomes **three-valued**
  (token-metered / cost-metered / not metered) where today it is a single boolean.
  `TokenUsage` gains a reasoning-token field, and both `CostRollup` / `ProviderCostRollup`
  gain a cost-metering dimension alongside the existing `unmetered {count, durationMs}`.
- **Integrations:** many internal seams, and critically a **two-sided serialized contract**.
  The `## Cost` block in `.docs/shipped/<slug>.md` is written by `shipped-record.ts:146-172`
  and read back by **regex** in `kpi-report.ts:31-67`; every schema change is a synchronized
  writer+reader edit, and old committed records must keep parsing. Other seams:
  `codex-provider.ts` (`parseCodexJsonl`), `cost-rollup.ts` (`addDispatch`), `conductor.ts:5980`
  (the `unmetered` derivation), `report-renderer.ts`, `otel/metrics.ts`. No external services.
- **Auth:** none.
- **State machines:** none, but the metering-state classification is effectively a small
  decision table that must be applied consistently at four separate sites.
- **Story count:** ~9–11 after absorbing #1008 (parser multi-turn accumulation, parser field
  coverage, three-valued metering model, rollup accounting, shipped-record schema,
  backward-compatible parse-back, `conduct kpi` per-provider rendering, the six
  currently-unrendered fields, real-capture fixture, historical-log compatibility).

**Why Large, not Medium.** The prior feature in this subsystem (#537) was M because it added one
output-format change on a single dispatch path. This is bigger on two independent axes:

1. **It changes a committed, already-in-the-wild artifact schema** that has a regex reader and
   existing records on main. Backward compatibility is a hard requirement, not a nicety —
   issue outcome (3) states cost rollups must keep working for "mixed historical event logs".
2. **It absorbs #1008**, which adds a whole reporting surface (`conduct kpi` per-provider
   rendering plus six fields that are recorded but never surfaced —
   `docs/reference/artifacts.md:534-540`).

The correctness bar is also unusually high for the size: the entire point is to stop reporting a
number that is wrong, so any half-applied rule reintroduces exactly the class of defect being fixed.

Architecture-review depth for L: **full.** The load-bearing decisions are (a) how the third
metering state is represented on the wire and in the committed record, (b) how forward/backward
compatibility of the `## Cost` block is guaranteed against records already on main, and (c) the
#906/#1008 scope merge.
