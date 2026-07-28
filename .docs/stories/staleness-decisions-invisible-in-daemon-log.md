# Staleness preserve-vs-invalidate decisions are visible in daemon.log

Status: Accepted

## Context

Issue jstoup111/ai-conductor#982, narrowed to its fifth desired outcome: *"When a step is
rejected for staleness, the log distinguishes which of the two classes applied, so an operator
reading `.daemon/daemon.log` can tell a self-inflicted rejection from a real one."*

Outcomes 1–4 and 6 are already satisfied on `main` by `3efb0e63` (wiring evidence
re-derivation, #897) and `8c12993b` (engine-computed steps get a retry budget of 1, #982).
Outcome 5 is entirely unmet, for two independent reasons established during `/explore`:

1. The `verdictFreshness` facet carries a boolean `fresh`; the diff-preserve path
   (`artifacts.ts:1967`) and the genuinely-rewritten path (`artifacts.ts:2021`) both emit
   `fresh: true`, and three of the four preserve paths populate nothing at all.
2. The `verdict_freshness` event reaches no sink — not the daemon-cli renderer, not
   `event-persister.ts` `ALL_EVENT_TYPES`, not `audit-trail.ts` `SUBSCRIBED_EVENT_TYPES` —
   despite its own doc comment saying it exists so the audit trail records the outcome. This
   is systemic: 19 of 57 `ConductorEvent` types are dead in all three sinks, 17 of them
   genuinely emitted.

Design is fixed by `adr-2026-07-26-event-sink-registry-exhaustiveness.md`. The gate decision
itself (`gateVerdictStillValid`) is out of scope; only its reporting changes.

## Story 1 — A preserved verdict is reported, not silent

As the operator reading `.daemon/daemon.log`, when a gate's evidence is stale but the diff
shows the judged surface was untouched, I need the log to say the verdict was **preserved**,
so I can tell a self-inflicted staleness event from a real finding.

### Happy Path

- **Given** a step whose verdict artifact carries a code stamp, and a HEAD advance whose
  `codeStamp..HEAD` diff touches no file in that gate's `GATE_SURFACE`,
- **When** the completion predicate runs and `gateVerdictStillValid` returns `'preserve'`,
- **Then** the completion result populates `verdictFreshness` with
  `outcome: 'preserved_surface_miss'`,
- **And** a `verdict_freshness` event is emitted carrying that outcome,
- **And** `.daemon/daemon.log` contains a line naming the step, the artifact, and the fact
  that the verdict was preserved despite the evidence being stale.

### Negative Paths

- **Given** the same preserve outcome on `architecture_review_as_built`, `prd_audit` or
  `manual_test` — the predicates that today return a bare `{ done: true }`,
- **When** the completion predicate short-circuits on preserve,
- **Then** it MUST NOT return without populating `verdictFreshness`; a silent `{ done: true }`
  on a preserve path is a defect, and every preserve return site populates the facet.

- **Given** a verdict artifact that was genuinely rewritten by the current attempt,
- **When** the completion predicate passes on freshness rather than on preservation,
- **Then** the outcome is `'rewritten'` and MUST NOT be reported as preserved — the two cases
  are distinguishable in the log, not merely both "fresh".

## Story 2 — An invalidated verdict is reported as a real rejection

As the operator, when evidence is stale *and* the judged surface actually changed, I need the
log to say the verdict was invalidated, so I do not dismiss a genuine finding as harness noise.

### Happy Path

- **Given** a verdict artifact whose `codeStamp..HEAD` diff touches the gate's own surface (or
  whose mtime predates the attempt floor with no preserve applicable),
- **When** the completion predicate rejects,
- **Then** `verdictFreshness.outcome` is `'stale_invalidated'`,
- **And** the daemon log line distinguishes it from the preserved class,
- **And** the existing rejection reason and retry/kickback routing are unchanged.

### Negative Path

- **Given** the gate-code-validity config is disabled, or the artifact carries no code stamp,
- **When** the predicate rejects on the plain mtime floor,
- **Then** the outcome is still populated (`'stale_invalidated'`) rather than left undefined —
  no rejection path reports an absent outcome.

## Story 3 — Adding an event type without declaring its sinks fails the build

As a future contributor, when I add a member to the `ConductorEvent` union, I need the
compiler to stop me until I have declared which sinks it reaches, so a new event cannot be
born dead the way `verdict_freshness` was.

### Happy Path

- **Given** the `EVENT_SINKS` registry typed `Record<ConductorEvent['type'], SinkDeclaration>`,
- **When** a new member is added to the `ConductorEvent` union and the registry is not updated,
- **Then** `tsc` fails with a missing-key error on the registry,
- **And** the build does not pass until the new type declares `render`, `persist` and `audit`.

### Negative Paths

- **Given** an event type that should deliberately not be persisted,
- **When** its declaration sets `persist: false`,
- **Then** that is a valid, reviewable declaration and the build passes — exhaustiveness forces
  a decision per type, and MUST NOT force every event into every sink.

- **Given** the registry marks a type `render: true`,
- **When** `renderDaemonEventUnsafe` has no matching `case` for it,
- **Then** a test fails reconciling the registry's render set against the switch's handled set,
  so the registry and the renderer cannot drift apart silently.

## Story 4 — The refactor changes no event's routing except verdict_freshness

As the operator, when the three hand-maintained sink lists are replaced by the registry, I
need the set of events actually reaching `events.jsonl`, `daemon.log` and the audit trail to
be unchanged except for the one event this feature is fixing, so a telemetry refactor does not
silently change what tooling downstream sees.

### Happy Path

- **Given** the registry replaces `ALL_EVENT_TYPES` and `SUBSCRIBED_EVENT_TYPES`,
- **When** the derived subscription sets are compared against the pre-refactor literals,
- **Then** they are identical except for the addition of `verdict_freshness`,
- **And** a test asserts this equivalence explicitly rather than leaving it to review.

### Negative Path

- **Given** an implementation that routes all 28 previously-dropped types into `events.jsonl`,
- **When** the equivalence test runs,
- **Then** it fails — expanding persistence is a separate, deliberate change and MUST NOT ride
  along with this refactor.

## Story 5 — The audit trail records the outcome its doc comment promised

As the operator reconstructing why a gate passed, I need `verdict_freshness` in
`.pipeline/audit-trail/events.jsonl`, so a preserved verdict is reconstructable after the run.

### Happy Path

- **Given** `verdict_freshness` declared with `audit: true`,
- **When** a completion check emits it,
- **Then** `AuditTrail` records it with the step, artifact and outcome,
- **And** the record survives for post-hoc inspection.

### Negative Path

- **Given** an event whose `toRecordInput` mapping is missing,
- **When** the audit trail receives it,
- **Then** it is skipped without throwing, and a test covers that the mapping exists for
  `verdict_freshness` so the subscription is not silently inert.

## Out of scope

- Changing `gateVerdictStillValid` or any preserve/rerun *decision*.
- Extending the diff-based preserve overlay to `retro`, `finish`, or the generic
  `completion_artifact` path (operator decision).
- The empty-commit / "record checked-nothing-to-change without a commit" mechanism from the
  issue comment — its own ticket.
- Wiring the other 16 emitted-but-dead event types into sinks; the registry surfaces them as
  explicit declarations preserving current behavior, and any routing change is follow-up work.
