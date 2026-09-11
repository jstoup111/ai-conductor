# Conflict Check: Support Astra in the daemon

**Date:** 2026-09-10
**Verdict:** PASS
**Blocking conflicts:** 0
**Degrading conflicts:** 0
**Resolutions:** 0

## Corpus and method

The repository config explicitly sets `conflict_check.adr_corpus: repo_wide`. The ADR comparison therefore includes relevant approved historical decisions, not only the change set (which adds no ADR).

Repository-wide content searches across `.docs/stories/`, `.docs/specs/`, `.docs/conflicts/`, and `.docs/decisions/` selected the model configuration, provider routing, retry/fallback, rate-card, and Codex metering concerns. This is a relevance scan followed by passage-level semantic review; it does not claim a full-text reading of every unrelated historical artifact. The five new stories were checked against the approved PRD and architecture review and against each other in both directions.

Relevant historical story/spec comparisons: `model-and-effort-resolution-provider-aware-902`, `model-availability-fallback-ladder`, `retry-as-escalation`, `per-step-provider-routing-927`, `2026-07-27-codex-usage-metering-and-cost-attribution-906`, `streaming-provider-dispatches-record-no-token-usag`, and `exported-step-cost-under-records-spend-20x-so-ever`. The earlier provider-model conflict report records that concrete defaults are provider-scoped; opaque overrides remain authoritative. The current feature preserves these meanings rather than adopting obsolete historical default values as a fresh policy migration.

## Examined ADRs and supersession handling

| ADR filename stem | Compared stories | Disposition |
|---|---|---|
| adr-2026-07-03-reactive-model-fallback-ladder | 1, 3 | Retained; opaque IDs, off-ladder fallback, empty ladder, and exhaustion agree |
| adr-2026-07-05-retry-as-escalation-ladder | 2, 3 | Retained; effort/model escalation remains distinct from availability substitution |
| adr-2026-07-24-provider-aware-step-execution-fresh-session-scope | 1, 3 | Retained; provider fallback retains native context and settings; no new session policy |
| adr-2026-07-27-cost-unmetered-is-a-first-class-state | 4, 5 | Retained with partial supersession; missing-cost classification survives, rejection of rate-card pricing is superseded by the August 25 ADR |
| adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates | 5 | Retained; no serialized cost fields or aggregation meanings change |
| adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope | 1, 5 | Retained with partial supersession; pricing restriction is amended by August 25; machine-envelope behavior remains |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot | 4, 5 | Retained; explicitly authorizes committed pricing at dispatch time and forbids historical repricing |

No partially superseded ADR was discarded wholesale. The provider-policy ADR named by the historical #902 report is absent from this checkout; it is not represented as an examined document or used as independent authority.

## Narrowed-out ADR subjects

Repository-wide matches outside the changed behavior were narrowed out: CI-fix dispatch (2026-07-20), auth park-and-poll (2026-07-04), daemon DECIDE preseed (2026-07-26), cold-start retries (2026-07-27), readiness disposition, verification fanout and provider-time partition (2026-07-29), provider preparation supervision (2026-07-30), scoped tests and resumable publication (2026-08-01), protected-artifact commit gates (2026-08-07), timing completeness (2026-08-12), build-review rubric branches (2026-08-13), live stream observation (2026-08-19), review-cache engine identity (2026-08-21), one dispatch member (2026-08-24), retrospective removal (2026-08-26), and coverage-binding judge ownership (2026-08-31). Astra selection does not alter their lifecycle, safety, ownership, or session contracts. The OTel exporter ADR is narrowed out as an exporter design: Story 5 preserves the existing event and cost-source fields consumed by it.

Other ADR subjects (intake, worktree maintenance, publication, artifact seals, memory, test and review gates, documentation hosting, and release ownership) do not share a changed behavior or resource with this feature. They remain governing project conventions; this report grants no exception to them.

## Pairwise new-story review

For every pair, assessed both “satisfy A, does B still hold?” and the reverse.

| Pair | Compatibility rationale |
|---|---|
| 1 / 2 | Explicit selection and unchanged defaults have distinct configuration preconditions; precedence remains the selector |
| 1 / 3 | Successful selection identifies Astra; unavailability deliberately identifies the actual fallback model |
| 1 / 4 | Selecting a model does not require a usable price; refresh availability never becomes model entitlement |
| 1 / 5 | Dispatch identity supplies accounting identity; absent cost does not invalidate execution |
| 2 / 3 | Retry escalation and in-attempt fallback are separate; retaining configured Astra for retries does not prohibit unavailable-model substitution |
| 2 / 4 | Pricing enrollment does not add Astra to default selection or retry/fallback orders |
| 2 / 5 | Pricing a selected Astra dispatch does not change any model policy |
| 3 / 4 | Fallback can use existing model rates independently of whether Astra has a published price |
| 3 / 5 | Successful fallback uses its actual model's rate; no charge is fabricated from the requested Astra identity |
| 4 / 5 | Refresh updates rates for future dispatches; pricing uses rates in force at dispatch time; missing rates remain explicitly cost-unmetered |

## Six conflict types

- Contradiction: none; opt-in selection, unchanged defaults, and conditional metering can all hold.
- Behavioral overlap: compatible; historical contracts supply the same precedence, fallback, and cost semantics.
- State conflict: none; a successful dispatch may be cost-unmetered, and that state does not mean execution failed.
- Resource contention: no new writer, cache, ledger, or external service; the existing rate-card maintenance path retains ownership.
- Sequencing: refresh is not a dispatch prerequisite, and no circular dependency is introduced.
- Oscillation: no pair requires undoing another story. In particular, pricing registration never changes default routing, and missing pricing never forces a model-selection change.

## Verify-Claims and outcome

Confidence: 95%, grounded in the accepted feature artifacts and the specific historical passages listed above. No unconfirmed load-bearing assumption was used. Published-price availability and account entitlement are explicit runtime contingencies, not prerequisites assumed true.

Verdict: CLEAR. No conflict resolution, superseding ADR, degrading compromise, or conflict-review marker is required. The feature is ready for implementation planning after the Composer output checkpoint.
