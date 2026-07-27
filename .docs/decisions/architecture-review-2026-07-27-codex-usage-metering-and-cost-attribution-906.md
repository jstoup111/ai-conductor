# Architecture Review — Codex usage metering and cost attribution (#906, absorbs #1008)

Status: APPROVED
Date: 2026-07-27
Depth: full (tier L)
Feature: 2026-07-27-codex-usage-metering-and-cost-attribution-906

## Scope reviewed

The three-valued metering model (ADR 2026-07-27-a), the additive `## Cost` schema evolution
and split aggregates (ADR 2026-07-27-b), and the parser corrections in `parseCodexJsonl`.

## Feasibility

Feasible with no new subsystem, no new dependency, no external service, and no auth surface.
Every seam already exists; the change is corrective rather than expansionary. The per-provider
rollup dimension needed for attribution is **already present** (`cost-rollup.ts:20`
`providers?: Record<string, ProviderCostRollup>`, populated from `provider_attempt` events),
which removes what would otherwise have been the largest piece of work.

## Alignment with existing decisions

- **ADR-2026-07-22-b** ("a partial total is visibly partial"): this feature extends that
  principle to a case it did not anticipate rather than contradicting it. Consistent.
- **ADR-2026-07-24 provider-aware step execution**, Preserved Decisions, final bullet —
  *"preferred/actual provider attribution for warnings, events, and usage"*: cost-metering
  state is per-provider, which is the natural completion of that bullet.
- **#927 stories** already committed acceptance that *"Codex's attempt is not reported as
  Claude usage"*. Reporting Codex at `$0` inside a shared total is arguably already a violation
  of that; this feature brings the implementation in line.
- **Repo Design Principle** (deterministic over prompt discipline): the metering classification
  is computed by one shared helper, not restated at four call sites. Consistent.

## Findings

**F1 — The issue body's premise is stale; scope was re-derived from source.**
#906 states the Codex event schema "ha[s] not been validated in this repo". In fact
`codex-provider.ts` runs `codex exec --json` and parses usage today. Desired outcome (1) is
largely already met. The real defects are different and were verified by reading source and by
capturing a live `codex exec --json` transcript. The spec targets the verified defects, and the
stories restate the outcomes accordingly. **The issue should be updated on merge so the
premise does not mislead a future reader.**

**F2 — The `$0` defect is live in this repo's own shipped records.**
`.docs/shipped/2026-07-26-model-attribution-and-provider-defaults-931.md:8-18` ships with
`input: 0 / output: 0 / cost_usd: 0 / dispatches: 0 / unmetered: count: 1` — and that is the
very feature that moved this repo to `llm_provider: [codex, claude]`. This is corroborating
evidence, not merely a theoretical gap.

**F3 — Multi-turn undercount is independent of the cost bug and equally real.**
`codex-provider.ts:97` assigns rather than accumulates across `turn.completed`. Fixing cost
without fixing this would leave Codex token figures wrong in a way that is *harder* to notice,
because they would now be trusted.

## Risks

**R1 — Widening `unmetered` naively empties the KPI aggregate. (highest)**
`kpi-report.ts:130` drops any partial feature from all aggregates. If Codex dispatches were
folded into the existing `unmetered` counter, every feature this repo builds would leave the
aggregate and `conduct kpi` would report across ~0 features while appearing to work.
*Mitigation:* ADR-b's split; a story pins that a cost-unmetered feature still contributes
tokens to the aggregate.

**R2 — Writer/reader schema desync.**
The `## Cost` block has a regex reader; changing one side alone lands records the other
misreads. *Mitigation:* additive-only rule; a round-trip test; an explicit test that parses a
record captured **before** this change.

**R3 — Partial application of the three-way rule.**
Four sites reason about metering. Any missed site silently reintroduces a zero.
*Mitigation:* single exported classification helper; the sites call it rather than re-deriving.

**R4 — Codex CLI schema drift.**
Parsing is pinned to `codex-cli 0.145.0`'s `turn.completed.usage` shape, exactly as
ADR-2026-07-22-a pinned Claude to CLI v2.1.218 with a "re-verify if the schema changes" note.
*Mitigation:* the committed real-capture fixture makes drift detectable, and the parser must
degrade to `cost-unmetered`/`unmetered` on unrecognized shapes rather than to zeros. Note the
`--json` **stdout** schema differs from the on-disk session-rollout schema
(`event_msg`/`token_count`); the stdout schema is the one parsed, and `--ephemeral` suppresses
rollout files entirely, so the rollout format must not be relied on.

**R5 — Scope growth from absorbing #1008.**
Tier moves M→L. *Mitigation:* accepted deliberately by the operator; the writer/reader are
being changed together regardless, so splitting would mean touching the same contract twice.

## Assumptions (verify-claims)

| # | Assumption | Basis | Confidence | If wrong |
|---|---|---|---|---|
| A1 | Codex exposes no per-run USD cost | **verified** — full transcript captured; no cost field; `plan_type: "pro"` | 95% (verified this machine; unverified across all deployments) | An API-key Codex with per-token billing would make a real metered cost path viable; the rejected price-table alternative would deserve reconsideration |
| A2 | Multiple `turn.completed` events can occur in one dispatch | inferred from the per-turn event design; the captured single-turn run shows exactly one | 85% | If only ever one, the accumulation fix is harmless (sum of one term) |
| A3 | No machine consumer parses `conduct kpi` stdout | inferred — it is documented as a read-only operator report | 80% | Output-shape change could break an unknown consumer; mitigated by it being additive |

A1 was presented to the operator and the cost-absent model was explicitly chosen, so no
load-bearing assumption remains unconfirmed. A2 and A3 are non-blocking: both fail safe.

## Verdict

**APPROVED.** The decisions are internally consistent, aligned with the governing ADRs, and
grounded in directly verified evidence rather than the issue's stale premise. R1 and R3 are the
risks that would silently reintroduce the defect class being fixed; both must be pinned by
tests, which the stories require.
