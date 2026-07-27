# Track: Staleness preserve-vs-invalidate decisions are invisible in daemon.log

Track: technical

Engine telemetry wiring and daemon log rendering. The audience is the operator reading
`.daemon/daemon.log` and the persisted event store, not a product user; there are no
product-facing functional requirements worth a PRD, and the acceptance criteria are
directly testable so they live in the stories.

## Source

`jstoup111/ai-conductor#982` — "Stale evidence is retried, not swept, across evidence-gated
steps", narrowed by the operator to the **observability slice** (desired outcome 5).

Outcomes 1–4 and 6 of the issue are already satisfied on `main`:

- `3efb0e63` (#897 re-land) — `wiring_check` re-derives stale wiring evidence via
  `deriveAndPersistWiringEvidence` instead of hard-rejecting it.
- `8c12993b` (#982) — engine-computed steps (`wiring_check`, `test_suite`) get a retry
  budget of 1, so a deterministic recomputation is never retried against an unchanged tree.

Outcome 5 — *"the log distinguishes which of the two classes applied"* — is entirely unmet
and is the whole of this feature.

Out of scope by explicit operator decision: generalizing the diff-based preserve overlay to
`retro` / `finish` / the generic `completion_artifact` path, and the empty-commit
"record checked-nothing-to-change without a commit" mechanism (issue comment; belongs in its
own ticket).

## Selected approach

**Discriminate the verdict outcome, then close the sink-drift class by construction.**

Two defects, one feature:

1. **The payload cannot express the distinction.** `verdictFreshness` carries a boolean
   `fresh`, and the diff-preserve path and the genuinely-rewritten path both set
   `fresh: true` (`artifacts.ts:1967` and `artifacts.ts:2021`). Two of the preserve paths
   (`architecture_review_as_built` at `artifacts.ts:1869`, and the `prd_audit` / `manual_test`
   short-circuits) return a bare `{ done: true }` and populate nothing at all. A discriminated
   outcome replaces the boolean so "preserved despite staleness", "rewritten this attempt",
   and "stale, verdict invalidated" are distinct values populated at every return site.

2. **Even a correct payload would reach no sink.** `verdict_freshness` is emitted once
   (`conductor.ts:4106`) and consumed nowhere: no `case` in `daemon-cli.ts`
   `renderDaemonEventUnsafe`, absent from `event-persister.ts` `ALL_EVENT_TYPES`, absent from
   `audit-trail.ts` `SUBSCRIBED_EVENT_TYPES` — despite its own doc comment in
   `types/events.ts` stating it exists "so the audit trail records" the outcome.

The second defect is systemic, not local. Measured over the 57 `ConductorEvent` types:

| Sink | Coverage |
| --- | --- |
| `daemon-cli.ts` rendered cases | 19 / 57 |
| `event-persister.ts` `ALL_EVENT_TYPES` | 29 / 57 |
| dead in all three sinks | 19 (17 of which are really emitted) |

The dead set includes `verdict_freshness`, `rebase_gate_preserved`, `rebase_gate_invalidated`,
`zero_work_product`, `unattributed_dispatch`, `retry_decision`, `test_suite_verification` and
ten `rebase_*` types. The cause is that all three sinks are hand-maintained lists typed
`Array<ConductorEvent['type']>`, which permits omission silently — a list literally named
`ALL_EVENT_TYPES` is missing half the union.

So the fix is machinery, per this repo's design principle: a single registry typed
`Record<ConductorEvent['type'], …>` so adding an event type **fails compilation** until it
declares its sinks. Wiring `verdict_freshness` by hand would leave the next event just as dead.

## Alternatives rejected

**Wire the three events by hand, no registry.** Smallest diff (~2–3h, S tier) and it closes
outcome 5 exactly. Rejected because it treats a systemic defect as a local one: the same
omission recurs on the next event added, and the other 16 emitted-but-dead events stay dead.
The repo's design principle is explicit that when a mistake recurs, the fix is machinery that
fails at the point of the mistake rather than discipline.

**Enrich `completion.reason` only, leaving the event graph untouched.** Tiniest change
(~1–2h). Rejected on correctness, not cost: the preserve path returns `{ done: true }`, which
emits no event and prints **no log line at all**, so the self-inflicted case stays invisible
and only the genuine-reject text improves. It is also unstructured — `formatRetryReason`
(`format-retry-line.ts:12-31`) truncates at 120 characters, and nothing reaches the audit
trail or the persisted event store.

## Load-bearing assumption carried into design

Making the registry exhaustive turns on persistence for the ~28 types currently dropped by
`ALL_EVENT_TYPES`, changing `events.jsonl` volume and content. Anything parsing that file
could be affected. The registry must therefore let a type declare *which* sinks it reaches
(an explicit "emitted but deliberately not persisted" is a valid, reviewable declaration) —
exhaustiveness is about forcing a **decision**, not about forcing every event into every sink.
This is the primary risk for `/architecture-review` to resolve.
