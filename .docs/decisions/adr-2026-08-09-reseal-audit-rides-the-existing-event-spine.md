# ADR: The reseal audit entry rides the existing event spine and audit-trail sink

**Date:** 2026-08-09
**Status:** APPROVED
**Deciders:** Operator (jstoup111), architecture-review for #1281

## Context

#1281 requires that `conduct reseal` "records an audit entry (who, which paths, old→new
fingerprint, rationale) in the worktree's audit trail". Two questions had to be settled before
implementation: **what schema** the entry uses, and **where it is written from**.

The second question looked hard at design time. `conduct reseal` is a standalone CLI process
dispatched before the pipeline boots, so it has no live `ConductorEventEmitter`, and appending to a
worktree's `.pipeline/events.jsonl` would make it a second writer to a ledger the engine also
writes. The `event-spine` skill's exceptions A (a writer with no bus access) and B (an atomicity
limit forcing one writer per file) both appeared to apply, pointing at a single-writer sibling
ledger in the same schema — the `adr-2026-08-08-pipeline-owned-closeout-timestamps` shape.

Investigation showed the mechanism already exists and neither exception actually bites.

Verified facts:

- **The worktree audit trail is a real, existing sink.** `AuditTrailWriter`
  (`src/conductor/src/engine/audit-trail.ts:43`) appends whole-line JSON to
  `<projectRoot>/.pipeline/audit-trail/events.jsonl` — a sibling of `events.jsonl`, not a
  competitor to it.
- **Exception B does not bite.** That writer uses `appendFileSync` with `flag: 'a'` (O_APPEND)
  precisely so "concurrent writers never interleave partial lines" (`audit-trail.ts:44-46`). A
  second appending process is already an anticipated condition, not a hazard to design around.
- **Exception A does not bite either.** Routing is declarative, not ambient. `EVENT_SINKS`
  (`event-sinks.ts:9`) maps every `ConductorEvent['type']` to `{render, persist, audit}`, and
  `auditedEventTypes()` (`:90`) drives audit routing. The sinks are constructible from a
  `projectRoot`; a standalone process does not need a *live* bus, it needs the same sinks wired.
- The seal's two existing events, `protected_artifact_rebaseline` and
  `..._refused` (`types/events.ts:250`/`:257`), are already declared in that table
  (`event-sinks.ts:35-36`) with `audit: false`, and are already rendered by
  `daemon-cli.ts:2301`.
- The durable "what is true now" record — the resulting baseline and its provenance — already
  rides the seal's own `rebaselines[]` array, read by name.

## Options Considered

### Option A: A bespoke `.pipeline/reseal-audit.json` sidecar
- **Pros:** Trivial to write; obvious to a reader who already knows to look for it.
- **Cons:** A parallel channel by the `event-spine` skill's §3 test — its own format, its own
  reader path, invisible to the daemon CLI renderer, the dashboard, the OTel exporter, and the
  audit trail. Rejected outright.

### Option B: A new single-writer sibling ledger in the `ConductorEvent` schema
- **Pros:** Compliant with the spine; the pattern named by exceptions A/B.
- **Cons:** Solves a problem that does not exist here. It would add a third ledger and a merge step
  when the audit trail already accepts concurrent appenders by construction.

### Option C (chosen): Emit a `ConductorEvent`; route it via the existing sink table
- **Pros:** No new file, no new schema, no new reader path. The entry lands in the very audit trail
  #1281 asks for, and every existing bus consumer sees it for free.
- **Cons:** Requires the CLI process to construct the sinks it needs, and requires resolving how a
  non-step event is represented in an `AuditRecord` (below).

## Decision

**Adopt Option C.**

1. **Add one variant to the `ConductorEvent` union** — a reseal event beside
   `protected_artifact_rebaseline` / `_refused` in `types/events.ts`, carrying the enumerated
   paths, each path's old→new fingerprint, the operator's verbatim `--reason`, and the from/to
   commits. A companion refusal variant carries the refusal condition and the offending path, so a
   refused reseal is as observable as a performed one.
2. **Declare it in `EVENT_SINKS` with `audit: true`** (unlike the two existing seal events, which
   are `audit: false`). This is what puts the entry in the worktree audit trail, and it is a
   declarative one-line routing change rather than a new write path.
3. **The durable baseline keeps riding the seal's own `rebaselines[]`** — `event-spine` exception C,
   state read by name. The event records *that the reseal happened*; the seal records *what is now
   authoritative*. No bespoke audit sidecar is created.
4. **The CLI constructs the same sinks** rather than inventing a channel, and writes to the
   resolved worktree's `projectRoot`. No new ledger, no merge step, no second schema.

### Open implementation constraint (for `/plan`, not a reopened decision)

`AuditRecord` requires a `step: StepName` (`audit-trail.ts:18`, `types/steps.ts:1`), and an
operator reseal belongs to no step. The plan must resolve this without weakening the type — the
preferred resolution is to widen the audit record's origin field to admit an explicit operator
origin, so an operator action is never misattributed to a pipeline step in the trail. Inventing a
sentinel `StepName` is rejected: it would make every existing consumer that switches on step names
silently mishandle the record.

## Consequences

### Positive
- The audit entry is visible to every existing bus consumer with no per-consumer work.
- No new file, format, reader, or merge step; the union stays the single source of truth.
- A *refused* reseal is auditable too, which the manual heredoc recovery never was.
- Exceptions A and B were tested against the code rather than assumed, avoiding a third ledger
  that would have been permanent once added.

### Negative
- The `AuditRecord` origin widening touches a shared type, so its consumers must be swept.
- Constructing sinks in a pre-boot CLI path is a small amount of wiring that the `decide-grant`
  precedent does not have (it writes a plain JSON artifact and emits nothing).
- The audit trail gains a record type whose `step` is not a step; readers that assume otherwise
  must be updated, which is the cost of not faking a step name.

### Follow-up Actions
- [ ] Add the reseal + reseal-refused variants to the `ConductorEvent` union.
- [ ] Declare both in `EVENT_SINKS`; the performed variant carries `audit: true`.
- [ ] Widen the audit record's origin to admit an operator origin; sweep consumers.
- [ ] Render both variants in `daemon-cli.ts` beside the existing rebaseline cases.

## Related

- `.claude/skills/event-spine/SKILL.md` — the decision procedure applied here; §3's schema-not-file
  test is what rejects Option A, and §4's exceptions are what Options B and C were tested against.
- `adr-2026-08-08-pipeline-owned-closeout-timestamps` — the sibling-ledger pattern that Option B
  would have copied, correctly, had exceptions A/B actually applied.
- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — the command whose audit this decision
  routes.
