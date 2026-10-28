# Architecture Review: Stacked feature cost and time broken down by child (#2946)

**Date:** 2026-10-22, re-verified against `main` at `7aa1bba459` on 2026-10-28
**Inputs reviewed:** none of the stories or the plan exist yet. This is the pre-stories, lightweight
(Medium tier) review of a technical-track feature. The inputs were:
- the track marker `.docs/track/stacked-feature-cost-and-time-cannot-be-broken-dow.md`, whose scope
  boundary is binding;
- the complexity record (Tier M);
- the diagrams in `.docs/architecture/stacked-feature-cost-and-time-cannot-be-broken-dow.md`.

**Verdict:** APPROVED WITH CONDITIONS

Lightweight mode runs §2 (feasibility) and §4 (alignment) in full. §3 and §5 are skipped by tier.

## Verified facts

| # | Claim | Basis | Confidence |
|---|---|---|---|
| F1 | `ConductorEvent` is `ConductorEventBody & { child?: ChildId }` (`types/events.ts`, last line of the union) | verified | 99% |
| F2 | `Conductor.withActiveRegionChild` stamps `child` only on `step_started`, `step_completed`, `step_failed`, `step_interrupted`, `step_refused` and `gate_verdict` for a region step, on `kickback` touching a region step, and on `loop_halt` for a region step. Feature-wide occurrences stay unqualified even while the leaf is active (`conductor.ts`, `withActiveRegionChild`) | verified | 97% |
| F3 | `provider_attempt` is emitted by `providerExecutionEventCallbacks(eventTarget).onAttempt` straight to the feature bus, so it never passes `withActiveRegionChild` and never carries `child` today (`provider-execution.ts`, `providerExecutionEventCallbacks`) | verified | 95% |
| F4 | `provider_attempt` is the authoritative dispatch record for cost: `DispatchMeteringTracker` counts it and suppresses the matching `step_completed` (`dispatch-metering.ts`) | verified | 97% |
| F5 | `DefaultStepRunner` captures `providerExecution.onAttempt` into `this.providerAttempt` in its constructor, while it reads `onAuxiliaryAttemptFailed` from the context at call time. In the daemon executor the StepRunner is built before the Conductor, with the same context object (`step-runners.ts` constructor; `executor-child-runtime.ts`) | verified | 95% |
| F6 | `EventPersister` spreads the event into the persisted record and adds `activeInterval` to step terminal records, so a stamped terminal record carries both `child` and `activeInterval` (`event-persister.ts`) | verified | 95% |
| F7 | `computeCostRollup` and `computeTimingRollup` read only `.pipeline/events.jsonl` (plus `pipeline-events.jsonl` for timing). Neither reads `child`, and `shipped-record-cli.ts` composes the record as frontmatter, `## Cost`, `## Time`, `## Build Review`, then the accepted-risk and reduced-coverage sections | verified | 97% |
| F8 | `parseCostBlock` (`kpi-report.ts`) finds `## Cost` with `indexOf` and matches `^<field>:` anywhere after it. A later block whose heading starts with `## Cost`, or whose lines start with a Cost field name, could therefore be read as Cost data. `parseTimeBlock` stops at the next `##` | verified | 95% |
| F9 | A stacked feature runs its children's regions serially in one worktree with one `.pipeline/events.jsonl` (`adr-2026-10-07-per-child-build-region`) | verified | 90% |
| F10 | `activeRegionChild` is set only by `activateChildRegionState`, whose callers pass the `resolveExecutionChild` target (routed host, else re-validating child, else cursor child), and cleared by `restoreWholeFeatureState` after a routed leaf return (`conductor.ts`; `adr-2026-10-12-routed-whole-feature-repair` decision 8, `adr-2026-10-24-operator-route-round-for-closed-stacked-children`) | verified | 95% |
| F11 | `coverage_binding` is a retired built-in step (`config.ts` retired-step table; `adr-2026-10-23-slice-topology-from-sealed-plan` decision 1). Stacked fixtures are built with `writeSliceTopologyFixture` and `sealSliceTopologyPositions` (`test/engine/slice-topology-fixture.ts`) | verified | 97% |
| F12 | `ProviderExecutionContext.onAttempt` takes `(step, attempt: ProviderAttemptMetadata)`, and `ProviderAttemptMetadata` has no `child` field, so forwarding `{ ...attempt, child }` needs one optional field on that interface (`provider-execution.ts`) | verified | 95% |
| F13 | Each daemon dispatch builds its own provider execution context (`daemon-cli.ts` `createProviderExecution`, `daemon-runner.ts`) and the executor child builds one per process (`executor-child-runtime.ts`), so one `Conductor` composes a given context, as the existing `onAuxiliaryAttemptFailed` composition already assumes | verified | 90% |

## Feasibility

| Check | Result |
|---|---|
| Stack compatibility | No new package or service |
| Prerequisites | The stacked chain this reads from has shipped (#2940 through #2945, and #3053), as have routed repair and operator rounds (#2944, #3203) and the slice-topology loader (#3365). No migration |
| Integration surface | One emission seam (Conductor and StepRunner), two rollup modules and the shipped-record renderer and CLI. No external API |
| Data implications | One additive optional key on `provider_attempt` records, present only while a region child is active. One additive shipped-record block, present only when the ledger names a child. No existing record changes |
| Performance | One more pass over an already parsed ledger. Interval unions are already computed |
| Worktree isolation | Unchanged: the ledger is per worktree |

**Technical intent, item by item:**
1. *Child identity on dispatch records.* This is feasible, with one trap (F5). Composing the attempt
   callback in the Conductor, as it already does for `onAuxiliaryAttemptFailed`, would not reach
   StepRunner dispatches, because the StepRunner already holds the uncomposed callback. Condition C1
   addresses this. The forwarded attempt needs one optional `child` field on
   `ProviderAttemptMetadata` (F12). Because the stamp reads the execution child (F10), a dispatch in a
   routed-repair or operator-round host region is charged to that host child.
2. *Per-child cost and dispatch partition.* This is feasible inside `computeCostRollup`. The
   per-dispatch bucket comes from the selected record's `child`. Because the tracker selects each
   dispatch exactly once (F4), the buckets partition the totals.
3. *Per-child active time.* This is feasible inside `computeTimingRollup` from the stamped terminal
   records (F6), with ordered claiming over interval unions, as in the diagram's partition rules.
   Only the existing `unionIntervals` is needed.
4. *Shipped-record block.* This is feasible as an additive append between `## Time` and
   `## Build Review`, with a heading and row labels that the KPI parsers cannot read as Cost data
   (F8, condition C3).

## Alignment

- **Event spine (`.agents/skills/event-spine/SKILL.md`).**

  ```
  Event spine
    Channel?    no      — an existing optional field on an existing variant, and a read-side projection
    Concern:    occurrence — which child a dispatch belonged to, when it happened
    Verdict:    extend the union (an existing field on an existing variant)
    Exception:  none
  ```

  The `## Children` block is a projection of the ledger, rendered beside the existing `## Cost` and
  `## Time` projections (`adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` D1). It is not
  a stamped field read back to reconstruct occurrences: nothing reads it to learn when something
  happened.
- **`adr-2026-10-03-stacked-child-plans-identity-and-state` decision 12** says "Rollups ignore it,
  so shipped-record Cost and Time stay once per feature". The design keeps `## Cost` and `## Time`
  exactly once per feature, but a new rollup projection now reads the field. That changes the
  recorded decision, so this review amends decision 12 additively (see ADRs Created). Decision 14,
  the N=1 structural contract, is unchanged: with no child there is no event field and no new block.
- **`adr-2026-10-07-per-child-build-region` decision 13** says region events carry `child` by
  conditional spread (umbrella D12). A provider attempt made for a region step is a region
  occurrence, so stamping it under the same rule applies that decision rather than changing it.
- **`adr-2026-10-17-stacked-feature-publication-as-native-stack` decision 1** requires the shipped
  record and its Cost block to be byte-identical for a non-stacked feature. This holds: no child
  appears, so nothing is appended.
- **`adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` D1** says the `## Cost`
  block grows only by addition. The design does not touch `## Cost` at all.
- **`adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` D3** says attribution needs no
  shared-bus change. That decision concerns per-feature attribution, which stays per worktree. The
  additive field is governed by umbrella D12, not D3.
- **Feature-wide work.** By umbrella D12 and `withActiveRegionChild`, feature-wide occurrences stay
  unqualified even while the leaf is active. They therefore form their own feature-wide row rather
  than being charged to the leaf. This follows from the code and the ADR, not from a new product
  choice.
- **Domain types.** Child identity is the existing branded `ChildId`, parsed with `parseChildId` at
  the ledger read. A malformed or out-of-range value is never a bucket key.
- **Production DI defaults.** No store is introduced.

## Wiring Surface

| New or changed surface | Production caller |
|---|---|
| `child` on `provider_attempt` while a region child is active | Emitted by the existing feature-bus `onAttempt` path for every StepRunner and Conductor provider dispatch, and persisted by the existing `EventPersister` subscription |
| Per-child partition on `CostRollup` | `computeCostRollup`, which `shipped-record-cli.ts` already calls |
| Per-child partition on `TimingRollup` | `computeTimingRollup`, which `shipped-record-cli.ts` already calls |
| `## Children` block renderer | `shipped-record-cli.ts`, called by `conduct shipped-record` at FINISH and by the post-finish refresh |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Stamping is wired into a callback the StepRunner never calls (F5), so dispatches stay unqualified and everything lands in the feature-wide row | Technical | High without C1 | Medium | C1, plus an integration test from a real Conductor region dispatch through the StepRunner to the persisted record |
| A new block is parsed as Cost data by `conduct kpi` (F8) | Data | Medium without C3 | Medium | C3 |
| An N=1 record changes | Data | Low | High | Conditional spread, and a block appended only when a child is present. The existing N=1 golden shipped-record Cost cell stays green unchanged (C4) |
| Per-child rows fail to sum to the totals through rounding | Technical | Medium | Low | Rows are rendered from rounded prefix sums, whose last prefix is the block's own total (diagram partition rules) |
| A worktree recreate loses the ledger (#497), so a stacked feature renders no block | Data | Low | Low | Accepted: the existing Cost and Time blocks degrade the same way. No new state is added to survive it |
| The active child is read when the attempt is emitted, which could misattribute an attempt around a child switch | Technical | Low | Low | Switches happen between steps, after the step's terminal event, and are serial (F9) |

## ADRs Created

No new ADR. The change makes no structural decision: it adds an existing optional field to an
existing event, and a read-side projection. The governing ADR is
`adr-2026-10-03-stacked-child-plans-identity-and-state`, whose decision 12 is amended additively by
#2946.

## Conditions

- **C1.** Every provider dispatch made for a region step while a region child is active persists
  its `provider_attempt` with that child. The stamping is owned by the Conductor's region rule (one
  predicate shared with `withActiveRegionChild`). The callback the StepRunner invokes must reach
  that stamping, which means not relying on the constructor-captured `onAttempt` alone. The proof is
  an integration test through a real Conductor and StepRunner, not a direct helper test.
- **C2.** The rendered per-child rows and the feature-wide row sum exactly to the `## Cost` block's
  `cost_usd` and `dispatches` and to the `## Time` block's `active_ms`.
- **C3.** The new block's heading does not start with `## Cost` or `## Time`, and none of its lines
  starts with a `## Cost` field name. The existing `parseCostBlock` and `parseTimeBlock` results for
  a record that carries the block equal those for the same record without it.
- **C4.** A feature with no child produces a byte-identical shipped record and ledger. The existing
  N=1 golden cells pass without being re-recorded.

## Early overlap scan (advisory)

Re-checked 2026-10-28. No open spec PR or in-flight composer worktree changes
`adr-2026-10-03-stacked-child-plans-identity-and-state`, the rollup modules, the shipped-record
modules or `kpi-report.ts`. Open build PR #3373 edits `conductor.ts`, a textual overlap in a very
large file with no design dependency. The `main` amendments to decision 12's ADR since 2026-10-22
(#3365 on decisions 5, 7, 8, 10 and 11, and #3203 on decision 13) do not touch decision 12.

The original 2026-10-22 scan:

`ai-conductor overlap-scan` reported unmerged branches touching `conductor.ts`
(`planner-escalation-to-architecture-review-halts-as`, `run-resolves-another-feature-s-track-marker-when-s`,
`daemon-self-host-guardrails`, `self-host-phase6-wiring`) and `step-runners.ts`
(`untracked-root-node-modules-symlink-gets-committed`). These are textual overlaps in very large
files and are unrelated in behavior. Open build PR #3310 also edits `shipped-record.ts` and
`shipped-record-cli.ts`, which means a likely rebase-time textual conflict but no design dependency.
