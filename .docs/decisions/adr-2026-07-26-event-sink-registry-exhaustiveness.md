# ADR 2026-07-26: Compile-time exhaustive event-sink registry

Status: Approved
Feature: staleness-decisions-invisible-in-daemon-log
Issue: jstoup111/ai-conductor#982

## Context

Issue #982's fifth desired outcome asks that a staleness rejection be distinguishable in
`.daemon/daemon.log` between a *self-inflicted* rejection (the evidence is stale but the
judged verdict is still valid) and a *genuine* one (the verdict is invalidated). Neither half
of that is currently possible, for two separate reasons.

**The payload cannot express the distinction.** `verdictFreshness` (`artifacts.ts:482-492`)
carries a boolean `fresh`. The diff-preserve path and the genuinely-rewritten path both set
`fresh: true` — `artifacts.ts:1967` and `artifacts.ts:2021` produce byte-identical payloads.
Worse, the `architecture_review_as_built` preserve path (`artifacts.ts:1869`) returns a bare
`{ done: true }` and populates no facet at all, as do the `prd_audit` and `manual_test`
preserve short-circuits. So the preserve case is not merely ambiguous; for three of four
predicates it is silent.

**No payload would reach an operator anyway.** `verdict_freshness` is emitted exactly once
(`conductor.ts:4104-4114`) and consumed nowhere. It has no `case` in `daemon-cli.ts`
`renderDaemonEventUnsafe` (falling to `default: break` at `:1971-1973`), is absent from
`event-persister.ts` `ALL_EVENT_TYPES`, and is absent from `audit-trail.ts`
`SUBSCRIBED_EVENT_TYPES` — despite its own doc comment in `types/events.ts` declaring that it
exists "so the audit trail records whether the verdict artifact was actually (re)written".
The intent was documented and the wiring was never completed.

That second failure is not local to this event. Measured across the 57 `ConductorEvent`
members:

| Sink | Coverage | Gap |
| --- | --- | --- |
| `daemon-cli.ts` rendered cases | 19 / 57 | 38 never rendered |
| `event-persister.ts` `ALL_EVENT_TYPES` | 29 / 57 | 28 never persisted |
| `audit-trail.ts` `SUBSCRIBED_EVENT_TYPES` | 6 / 57 | by design, narrow |
| **dead in all three** | **19** | 17 of which are really emitted |

The dead-everywhere set includes `verdict_freshness`, `rebase_gate_preserved`,
`rebase_gate_invalidated`, `zero_work_product`, `unattributed_dispatch`, `retry_decision`,
`test_suite_verification` and ten `rebase_*` types. A list literally named `ALL_EVENT_TYPES`
is missing half the union.

The mechanism is the type. All three sinks are hand-maintained literals typed
`Array<ConductorEvent['type']>`, which is satisfied by *any* subset — omission is legal and
silent. Every new event type has to be remembered in three separate places, and the record
shows it routinely is not.

## Decision

**Replace the three hand-maintained lists with one registry typed
`Record<ConductorEvent['type'], SinkDeclaration>`, and derive each sink's subscription set
from it.**

A `Record` keyed by the union is *total*: TypeScript rejects the object literal when a key is
missing. Adding a member to `ConductorEvent` therefore fails compilation until that member
declares where it goes.

```ts
type SinkDeclaration = {
  render: boolean;   // rendered by daemon-cli into .daemon/daemon.log
  persist: boolean;  // appended to events.jsonl by EventPersister
  audit: boolean;    // recorded to .pipeline/audit-trail/events.jsonl
};

export const EVENT_SINKS: Record<ConductorEvent['type'], SinkDeclaration> = { … };
```

**`false` is a first-class, reviewable declaration.** Exhaustiveness forces a *decision* per
event type, not membership in every sink. "Emitted but deliberately not persisted" is a
legitimate, greppable statement; an omission is not.

Alongside the registry, `verdictFreshness` gains a discriminated outcome —
`'rewritten' | 'preserved_surface_miss' | 'stale_invalidated'` — populated at **every**
return site, including the preserve paths that currently return a bare `{ done: true }`. The
`verdict_freshness` event carries it through, and `daemon-cli.ts` renders a line that names
the class.

The preserve/rerun decision itself (`gate-code-validity.ts` `gateVerdictStillValid`) is
**not** changed. This ADR covers reporting only.

## Consequences

**Positive.** The next event type added cannot be born dead — the build stops until its sinks
are declared. The 17 emitted-but-dead types surface as an explicit, reviewable decision
instead of an accident. Outcome 5 of #982 is closed with a structured, machine-readable
signal that reaches the audit trail rather than a truncated prose string
(`formatRetryReason` caps at 120 characters). This follows the repository's stated design
principle: when a mistake recurs, the fix is machinery that fails at the point of the
mistake, not discipline.

**Negative / risk.** Routing previously-dropped types into `events.jsonl` changes that file's
volume and content, and other tooling may parse it. Mitigation: the per-type `persist`
decision is made explicitly and reviewed during implementation, defaulting to *preserving
today's behavior* for every type except `verdict_freshness` — the refactor is
behavior-neutral by construction, and any additional routing is a separate, deliberate
follow-up. The registry also adds one indirection between an event and its sink, which is the
cost of making the contract total.

**Migration.** None for consumers. `ALL_EVENT_TYPES` and `SUBSCRIBED_EVENT_TYPES` are
module-private engine internals, not part of the `bin/conduct` CLI, hook wiring,
`settings.json` schema, or skill symlink targets — so no `## Migration` block is required.
If the release gate's path classifier flags a breaking surface, a waiver under
`.docs/release-waivers/` is the correct instrument, since the change is internal-only.

## Alternatives considered

**Wire the three dead events by hand.** ~2–3h, smallest diff, closes outcome 5 exactly.
Rejected: it treats a systemic defect as a local one. The same omission recurs on the next
event added — which is precisely how these 19 accumulated — and the other 16 emitted-but-dead
types stay dead.

**Enrich `completion.reason` only, leaving the event graph untouched.** ~1–2h, tiniest change.
Rejected on correctness rather than cost: the preserve path returns `{ done: true }`, emits no
event and prints no log line at all, so the self-inflicted case would remain invisible and
only the genuine-reject text would improve. The result is also unstructured — truncated at 120
characters and absent from both the audit trail and the persisted event store.

**A runtime assertion that every `ConductorEvent` type appears in some sink.** Rejected: it
fails at runtime, in the daemon, long after the mistake — the design principle calls for
failing at the point of the mistake, which for a type-level contract is compile time.
