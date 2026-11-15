# Conflict Check: Stacked feature cost and time broken down by child (#2946)

**Date:** 2026-10-22, re-run against `main` at `7aa1bba459` on 2026-10-28
**New stories:** `.docs/stories/stacked-feature-cost-and-time-cannot-be-broken-dow.md` (Stories 1–4)
**Result:** PASSED: zero blocking conflicts, zero degrading conflicts.

## Inventory

- The full `.docs/stories/` corpus was searched (615 files) for stories that touch the same
  surfaces:
  - the shipped-record `## Cost` and `## Time` blocks and `conduct shipped-record`;
  - `provider_attempt` records;
  - the event `child` field;
  - `conduct kpi` parsing.

  63 files mention the shipped record or a Cost or Time block, and 4 existing files assert
  behavior of the `child` field. Every story in those files whose criteria name the same
  surface was compared pairwise, in both directions.
- `.docs/specs/` has no PRD for this technical-track feature.
- Earlier conflict reports for the stacked chain were consulted for recurring patterns. None
  recurs here.

## Pairs examined (both directions)

| Existing story | Shared surface | A then B | B then A | Verdict |
|---|---|---|---|---|
| `engine-cannot-represent-more-than-one-branch-step-` Story 10 (events can name a child; Cost and Time reported once per feature; a step appears once in the Cost and Time blocks with summed totals) | Cost and Time rollups and the `child` field | Our Stories 2–4 leave `## Cost` and `## Time` byte-identical and add a separate block, so its "once per feature" and per-step criteria still hold | Its criteria constrain only the Cost and Time blocks and the absence of a `child` key with no child, so our Children block and our Story 1 stamping still hold | compatible |
| `engine-cannot-represent-more-than-one-branch-step-` Story 1 (N=1 golden suite covers the shipped-record Cost block and `events.jsonl`; a `"child"` key with no child fails it) | N=1 byte identity | Our Story 1 (no `child` key with no active child) and Story 4 (no block with no child) keep every golden cell unchanged | Its golden suite does not constrain stacked features | compatible |
| `build-loop-cannot-complete-a-feature-child-by-chil` (region events carry `child` by conditional spread; whole-feature steps such as `manual_test` carry no `child`; no child gives no `child` key) | `child` stamping rule | Our Story 1 applies the same region rule to `provider_attempt` and keeps whole-feature attempts unqualified | Its rule is exactly the rule our Story 1 extends | compatible |
| `stacked-features-cannot-be-published-reviewed-and-` (N=1 shipped-record Cost block byte-identical; one shipped record per feature, on the leaf) | shipped record | Our Story 4 adds a block only for stacked features and leaves Cost byte-identical | Its publication flow writes the one record our block lives in | compatible |
| `a-change-to-one-stacked-child-cannot-be-carried-in` (restack events carry `child`; N=1 golden byte-identical) | `child` on events | Restack events are not dispatch records, and our rollups count only dispatch and terminal step records | No restack criterion constrains rollups | compatible |
| Cost-block stories (per-feature cost rollup, the additive cost block, cost-unmetered, provider failed-attempt cost) | `## Cost` block and `parseCostBlock` | Our Story 4 requires equal `parseCostBlock` results with and without the block, and an unchanged `## Cost` text | Those stories do not constrain blocks other than `## Cost` | compatible |
| Timing stories (execution-lifecycle completeness, the Time block's states and reasons) | `## Time` block and the interval union | Our Story 3 partitions the same union and mirrors the Time state; the `## Time` text is unchanged | Their criteria fix the Time block only | compatible |

| `feature-active-duration-is-dropped-from-otel-whene` (added since 2026-10-22: retired `coverage_binding` lifecycle intervals count toward the active total; pre-spawn failures record `provider_attempt` with `invoked: false`; `feature_shipped` carries the timing state and active total) | timing rollup, `provider_attempt`, `feature_shipped` | Our Story 3 partitions the same active union, so a retired-step interval with no `child` lands in the feature-wide row, and our Story 2 counts only the dispatches the existing metering tracker selects, so an `invoked: false` record is counted exactly as in the `## Cost` block | `daemon-runner.ts` builds `feature_shipped` field by field from `state` and `activeMs`, so the optional per-child claims never reach the event or OTel | compatible |
| `a-change-to-one-stacked-child-cannot-be-carried-in` and the operator-round stories (amended since 2026-10-22: routed repairs and operator rounds re-enter a closed child's region) | the execution child | Our Story 1 stamps the execution child, so a dispatch inside a re-entered host region is charged to that host, where the work ran | Their criteria constrain routing state, refs and halts, not dispatch telemetry | compatible |

There are no oscillating pairs: no pair has a "no" answer in either direction.

## ADRs

**Examined (subject overlaps the stories):**
- `adr-2026-10-03-stacked-child-plans-identity-and-state`: decision 12 as amended by #2946, and
  decision 14;
- `adr-2026-10-07-per-child-build-region` decision 13;
- `adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 1;
- `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` D1–D5;
- `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` D1–D3;
- `adr-2026-07-27-cost-unmetered-is-a-first-class-state`;
- `adr-2026-10-07-provider-cost-includes-failed-attempts`;
- `adr-2026-08-12-execution-lifecycle-completeness-for-timing`;
- `adr-2026-10-12-routed-whole-feature-repair` decision 8 (the execution-child resolver), read on
  2026-10-28. Our Story 1 reads that resolver's result and changes nothing it decides.

The ADR-versus-story comparison found no conflict. Decision 12's original sentence, "Rollups ignore
it, so shipped-record Cost and Time stay once per feature", is now read together with its #2946
amendment, committed on this spec branch before these stories. Under that amendment, Cost and Time
still ignore `child`, and only the separate `## Children` block reads it. That is what Stories 2–4
assert.

**Narrowed out** (no overlap with dispatch attribution, the shipped-record body or `child`): every
other ADR in `.docs/decisions/`. That includes the restack, routing and publication-lifecycle
decisions of the stacked chain, which govern git and PR state rather than telemetry rollups.

**Re-run 2026-10-28.** Every story file added or changed on `main` since 2026-10-22 was searched for
the same surfaces. The two new rows above are the only ones that share a surface. The retired
`coverage_binding` step no longer appears in these stories: the feature-wide examples are now
`manual_test` and `prd_audit`.

## Resolutions

None required.
