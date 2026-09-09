# ADR 2026-07-27-a — Absent provider cost is a first-class `cost-unmetered` state, never zero

Status: APPROVED
Date: 2026-07-27
Feature: 2026-07-27-codex-usage-metering-and-cost-attribution-906 (#906, absorbs one #1008 facet)

## Context

ADR-2026-07-22-a wired usage capture from `claude --print --output-format json`, whose result
object carries `total_cost_usd`. ADR-2026-07-22-b then defined the committed `## Cost` block
with a single `unmetered: {count, duration_ms}` field, on the stated principle that *"a partial
total is visibly partial"*.

Codex was added later (#904 family), which deliberately deferred all usage accounting to this
issue. `parseCodexJsonl` (`codex-provider.ts:80-109`) does parse `turn.completed.usage`, so
Codex dispatches carry real tokens — but the Codex stream contains **no cost field at all**.
Verified directly against `codex-cli 0.145.0`: a full `codex exec --json` transcript emits
`input_tokens`, `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens`,
`reasoning_output_tokens` and nothing else. Session rollouts show `plan_type: "pro"`,
`credits.has_credits: false` — Codex is subscription-billed, so no per-run USD charge exists
to report.

The existing boolean model has no state for "tokens known, cost unknown", and the code
collapses it into the wrong one:

```ts
// cost-rollup.ts:49-59
if (tokenUsage) {
  ...
  target.costUsd += Number(tokenUsage.costUsd) || 0;   // absent -> adds 0
}
if (event.unmetered === true || !tokenUsage) {          // tokenUsage present -> NOT unmetered
  target.unmetered.count += 1;
}
```

A Codex dispatch therefore counts as **fully metered, $0.00**. This repo runs
`llm_provider: [codex, claude]` with `build` on Codex (`.ai-conductor/config.yml:106-137`), so
this understates the cost of essentially every feature it ships. It is the exact failure the
#537 principle was written to prevent, reintroduced through a provider the principle predates.

## Decision

Model metering as **three-valued** rather than boolean, and represent unknown cost by absence:

| State | Tokens | Cost | Source |
|---|---|---|---|
| `fully-metered` | yes | yes | Claude (`total_cost_usd`) |
| `cost-unmetered` | yes | **no** | Codex (subscription) |
| `unmetered` | no | no | non-LLM **dispatches**, parse failure, interactive dispatches (scoped by D5 below) |

Concretely:

1. `parseCodexJsonl` leaves `TokenUsage.costUsd` **undefined**. It is never set to `0`.
2. `addDispatch` adds to `costUsd` only when `typeof tokenUsage.costUsd === 'number'`;
   otherwise it increments a new `costUnmetered.count`. Tokens still accumulate normally.
3. `unmetered` retains its **exact current meaning** (no usage at all), so every record
   already committed on main keeps its original interpretation.
4. Reports render an incomplete cost total as explicitly partial, attributing which provider
   is cost-unmetered, rather than printing a total that silently omits Codex.

`durationMs` is likewise left absent for Codex: the stream carries no model-time figure, and
engine wall-clock measures a different quantity.

### Amendment — 2026-09-07 (feature `stop-counting-provider-free-step-completions-as-un`, #1906)

> Operator-approved on 2026-09-07 after the as-built review raised AB-1 and AB-2. Decisions 1-4
> stand unreversed. The amendment narrows the **input domain** of the classification — which
> records are dispatches at all — rather than redefining any of the three states.
>
> **D5. A provider-free step completion is not a dispatch, and is excluded before metering
> classification.** A retained `step_completed` record that no earlier successful invoked provider
> attempt matched and that carries none of `tokenUsage`, `actualProvider`, `preferredProvider` or
> `model` describes a step that never called a provider. It is neither metered nor unmetered: it
> contributes to no dispatch count, no metering bucket, no token or cost sum, and no per-provider
> sub-rollup. The `unmetered` row's "non-LLM steps" entry is hereby scoped to non-LLM
> *dispatches*; a native step that invoked nothing was never a dispatch to classify, and counting
> it presented a fully measured feature as partially unmetered.
>
> **D6. `unmetered` keeps its Decision-3 meaning for every real dispatch.** An invoked provider
> attempt whose usage is absent is one `unmetered` dispatch. A parse failure and an interactive
> dispatch stay `unmetered`. An unmatched completion carrying provider or model attribution but no
> usage stays one `unmetered` dispatch. An invoked attempt whose tokens are present but whose cost
> is missing or unusable is one `cost-unmetered` dispatch, per Decision 2 — absent cost is never
> collapsed into `unmetered`. Nothing that reached a provider is dropped.
>
> **D7. Historical replay reclassifies provider-free completions, and that is explicitly
> accepted.** The per-feature rollup is a reader-side projection computed on demand over the
> committed `.pipeline/events.jsonl` spine; no dispatch record is stored, so there is no committed
> dispatch meaning for D5 to rewrite. Replaying a ledger written before this amendment under this
> projection therefore reports fewer dispatches than it once did, because the completions it drops
> were never provider calls. Decision 3's compatibility guarantee is honored where it applies —
> the committed `## Cost` block's `unmetered:` field keeps its meaning, format and parse — and the
> recount of provider-free completions is the deliberate correction this amendment exists to make.
> `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` Decision 1 is therefore
> unaffected and needs no amendment: it governs the serialized block's field semantics, which D5
> does not touch, not which events the reader projects into a dispatch.
>
> The state table in
> `.docs/architecture/2026-07-27-codex-usage-metering-and-cost-attribution-906.md:19-25` is
> amended in the same commit to match D5.

## Rejected alternatives

**Derive Codex cost from a per-model price table.** Would give one comparable number across
providers and leave aggregates unreshaped. Rejected: under a Pro subscription the marginal USD
cost of a run is not `tokens x rate`, so the figure would be fiction rendered with the same
authority as Claude's real measured charge. That is the same class of error as the `$0` bug —
an invented number presented as measurement — merely harder to detect. It also creates
standing price-drift maintenance and a new config surface. If an API-key (per-token) Codex
deployment is adopted later, this can be revisited as a genuinely metered path rather than an
estimate.

**Mark Codex dispatches wholly `unmetered`.** Smallest diff and removes the `$0` lie. Rejected:
it discards real, already-parsed token data — regressing issue outcome (1) — and because
`kpi-report.ts:130` drops any feature with an unmetered dispatch from all aggregates, every
Codex-touching feature would vanish from KPI. Strictly worse than today on the token axis.

## Consequences

- `CostRollup` and `ProviderCostRollup` gain `costUnmetered`; the `## Cost` block gains a
  corresponding line (see ADR 2026-07-27-b for the compatibility rules).
- Cost totals for mixed-provider features become explicitly partial. This is a **reporting
  regression in appearance and a correction in fact** — the previous totals were not smaller,
  they were wrong.
- The three-way classification must be applied consistently at every site that reasons about
  metering (`cost-rollup`, `shipped-record`, `kpi-report`, `report-renderer`), or the defect
  reappears in whichever site is missed.
- Per this repo's Design Principle, the classification lives in one exported helper that all
  four sites call, rather than being re-derived inline at each — a re-derived rule is exactly
  what drifted to produce this bug.
