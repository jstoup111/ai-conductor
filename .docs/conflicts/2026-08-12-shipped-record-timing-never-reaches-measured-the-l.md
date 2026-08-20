# Conflict Check: Shipped-record timing reaches `measured`, or says why not (#1260)

**Date:** 2026-08-12
**Scope:** the five stories in `.docs/stories/shipped-record-timing-never-reaches-measured-the-l.md`
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:82`)
**Result:** **PASSED CLEAN — zero blocking conflicts, zero degrading conflicts accepted**

## Corpus Selection

267 ADRs exist in `.docs/decisions/`. Narrowed to the 14 whose decision subject overlaps these
stories' behavior, entities, fields, or gates — the timing partition, the shipped record's body,
event-sink routing and persistence, and the ledger's schema.

**Examined (13, all APPROVED):**

| ADR filename stem | Subject overlap |
|---|---|
| `adr-2026-07-29-engine-observed-provider-time-partition` | Governing ADR — the timing partition and its `partial`/`unavailable` states |
| `adr-2026-07-27-cost-unmetered-is-a-first-class-state` | Unknown measurements stay absent rather than fabricated |
| `adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates` | Additive evolution of the record's blocks |
| `adr-2026-07-22-per-feature-cost-rollup-in-shipped-record` | The committed record as durable per-feature history |
| `adr-2026-07-25-fail-closed-durable-shipment-evidence` | Shipped-record evidence contract |
| `adr-2026-07-26-event-sink-registry-exhaustiveness` | Adding a `ConductorEvent` member obliges an `EVENT_SINKS` declaration |
| `adr-2026-07-07-audit-trail-event-sink` | Audit consumer of the same events |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` | #1477 — same conductor emit region |
| `adr-2026-07-10-intra-step-build-progress-events` | Single-writer ledger in the same schema |
| `adr-2026-08-08-pipeline-owned-closeout-timestamps` | Events rather than timestamps stamped into artifacts |
| `adr-2026-08-09-hook-owned-containment-event-ledger` | Sibling ledger, same union |
| `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` | Spine reuse over a new channel |
| `adr-014-otel-observability-exporter` | Durable timing must not depend on the exporter |

**Excluded as unambiguously fully superseded (1):**
`adr-2026-07-03-committed-shipped-record-dispatch-dedup` — `superseded_by:
adr-2026-07-25-fail-closed-durable-shipment-evidence`, which is in the examined set. No partial or
ambiguous supersession was found in the corpus, so nothing was retained on that basis.

**Narrowed out (253):** ADRs whose subject is park/unpark, rebase, release and versioning, intake
and labelling, attribution and evidence judging, provider auth and readiness, build-review
kickbacks, worktree lifecycle, or docs/skill authoring. None shares a behavior, entity, field, or
gate with these stories.

**Prior conflict reports:** `grep` over `.docs/conflicts/` for `## Time`, `provider_active_ms`,
`computeTimingRollup`, `activeInterval`, and `openExecutions` returns nothing. No recurring pattern
applies.

**Other stories:** the same `grep` over `.docs/stories/` returns nothing. No story outside this
spec touches the timing surface. The only adjacent story set is #1477's, examined below because it
shares the conductor's emit region rather than because a keyword matched.

## Pairs Examined

Every pair sharing a behavior, entity, field, or gate was tested in **both** directions —
"if A is fully satisfied, does B still hold?" — as required to tell an oscillation from an ordinary
contradiction. No pair was passed on the assumption that it was compatible.

### Story 1 (uninterrupted run reaches `measured`) vs Story 4 (never close an open execution)

This is the pair that would oscillate if the design were wrong, and it is worth stating explicitly
rather than recording as trivially clean.

- **Satisfy Story 1 fully — does Story 4 still hold?** Yes. Story 1's precondition is a ledger whose
  starts and terminals already balance; reaching `measured` there requires closing nothing by
  inference.
- **Satisfy Story 4 fully — does Story 1 still hold?** Yes, **because Story 2 exists.** Without
  Story 2 these two would be a genuine oscillation: the only way to reach `measured` on a ledger
  with stale starts would be to close them reader-side, which Story 4 forbids, and the only way to
  honor Story 4 would be to stay `partial` forever, which Story 1 forbids. Story 2 dissolves it by
  making the ledger balance at **emit** time, with a real interval, so neither requirement has to
  give. Confidence 90%, basis: verified — the one live ledger with no open executions already
  returns a complete `measured` result today.

Recorded as **no conflict**, with the note that Story 2 is load-bearing for that verdict and must
not be dropped or deferred from the plan.

### Story 2 (interrupt emits a terminal) vs Story 4 (rollup never closes an open execution)

Different layers, no contention: Story 2 closes an execution at emit time when the real
`activeInterval` is still available in the persister's map; Story 4 forbids closing one at read time
when it is not. Both directions hold. **No conflict.**

### Story 3 (reason names the route) vs Story 5 (historical records keep parsing)

- Satisfy Story 3 → Story 5 holds, because Story 3's negative path requires no reason line on
  `measured` and leaves `unavailable` output unchanged, and the field is read by name.
- Satisfy Story 5 → Story 3 holds, because Story 5 constrains only that absence is not an error.

**No conflict.** The shared constraint — the field is additive and its absence is legal — is
asserted by both stories consistently, and matches
`adr-2026-07-27-additive-cost-block-evolution-and-split-aggregates`.

### Story 3 vs Story 1

Story 1 requires a `measured` block; Story 3 requires the reason to be absent there. Consistent in
both directions. **No conflict.**

### Stories 1-5 vs `adr-2026-07-29-engine-observed-provider-time-partition`

The governing ADR. Its contract 5 defines exactly the degrade states these stories preserve, and its
contract 6 requires an additive section with an explicit evidence state. This spec's ADR extends it
and does not supersede it: contract 4 requires terminal evidence to *carry* an active interval and
never requires that terminal evidence *exist*, which is the gap Story 2 fills. Nothing in contracts
1-8 is contradicted. **No conflict.**

### Stories 1-5 vs `adr-2026-07-27-cost-unmetered-is-a-first-class-state`

Strongly reinforcing rather than conflicting. Its decision represents unknown measurements by
absence and never by a fabricated value, and its item 3 requires that "every record already
committed on main keeps its original interpretation." Story 4 and Story 5 are the timing-side
restatement of both. **No conflict.**

### Stories 1-5 vs `adr-2026-07-26-event-sink-registry-exhaustiveness`

Not a conflict but a **binding constraint carried to `/plan`**: `EVENT_SINKS` is typed
`Record<ConductorEvent['type'], SinkDeclaration>`, so if the implementation adds a new member to the
union rather than reusing an existing terminal variant, compilation fails until that member declares
`render` / `persist` / `audit`. The design prefers reusing existing terminal variants with additive
optional fields, in which case no new declaration is owed. Either way the outcome is compile-checked
and cannot be silently skipped. **No conflict.**

### Story 2 vs #1477 (`adr-2026-08-11-halt-events-ride-the-persisted-spine`, and its TI-6)

The only tension found anywhere in the corpus, and it resolves.

#1477's **TI-6** reads: "non-halt event volume does not measurably grow (negative path — must not
regress)." Story 2 adds a terminal event on interrupt paths, and a terminal emitted because of a
halt is a non-halt event.

- **Satisfy Story 2 fully — does TI-6 still hold?** Yes. Story 2 adds at most one terminal per
  interrupted execution, and its own negative path requires exactly one terminal per start, so the
  addition is bounded by the number of executions a dispatch leaves open — one or two in the ledgers
  measured on 2026-08-12, against 36-157 total events. Not measurable growth. Confidence 85%,
  basis: inferred from the measured ledgers, not from a run of the changed code.
- **Satisfy TI-6 fully — does Story 2 still hold?** Yes. TI-6 bounds volume, not correctness, and
  places no constraint that a bounded per-interrupt emit violates.

One "no" would be a contradiction and two would be an oscillation; there are none. The two changes
are complementary in substance: #1477 makes a halt *visible* in the ledger; Story 2 makes the
execution it interrupted *close*. Neither does the other's work.

**Integration note, not a conflict:** both edit the same conductor emit region, so whichever lands
second rebases onto the other. This is merge friction, already registered in the architecture
review's risk table as Likelihood High / Impact Low, and is not a requirements conflict — no story
changes as a result.

### Stories 1-5 vs the remaining examined ADRs

`adr-2026-07-22-per-feature-cost-rollup-in-shipped-record`,
`adr-2026-07-25-fail-closed-durable-shipment-evidence`, `adr-2026-07-07-audit-trail-event-sink`,
`adr-2026-07-10-intra-step-build-progress-events`,
`adr-2026-08-08-pipeline-owned-closeout-timestamps`,
`adr-2026-08-09-hook-owned-containment-event-ledger`,
`adr-2026-08-09-reseal-audit-rides-the-existing-event-spine`, and `adr-014-otel-observability-exporter`
each govern a neighbouring concern — the Cost block, shipment evidence, the audit sink, sibling
ledgers in the same union, and the optional OTel exporter. This spec touches none of their
decisions: it adds no channel, changes no Cost field, changes no sink's existing declaration, and
introduces no dependency on the exporter. Each was compared against every story on the shared
entity (the ledger, the record, the sinks) in both directions. **No conflict in any pair.**

## Conflicts Found

None. Zero blocking, zero degrading.

## Resolutions Applied

None required. No story was amended, no ADR was superseded, and no accepted DECIDE artifact was
falsified.

## Constraints Carried Forward to `/plan`

1. Story 2 is load-bearing for the Story 1 / Story 4 verdict above — dropping or deferring it
   re-creates a genuine oscillation between them.
2. If the implementation adds a `ConductorEvent` member, `EVENT_SINKS` must declare its three sinks
   (compile-enforced by `adr-2026-07-26-event-sink-registry-exhaustiveness`).
3. #1477 touches the same emit region; expect a rebase for whichever lands second.
