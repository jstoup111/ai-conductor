# ADR: Shipped-readiness grace bookkeeping is durable watch-registry state (event-spine exception C)

**Date:** 2026-10-10
**Status:** APPROVED
**Deciders:** operator (James Stoup)

<!-- Filename convention: adr-2026-10-10-watch-registry-grace-state-is-durable-state.md. Cite by filename stem. -->

## Context

`adr-2026-10-09-shipped-pr-readiness-verdict` D7 stores the shipped PR's head SHA and the time
that head was first observed (`headSha`, `headFirstSeenAt`) as optional fields on the existing
`WatchEntry` in `.daemon/mergeable-watch.jsonl`. The sweep reads `headFirstSeenAt` on later ticks
to decide whether the 30-minute `no-checks` grace period has elapsed.

During BUILD of `shipped-is-fire-and-forget-no-reconciliation-sweep`, the `eventSpine` build-review
rubric flagged `headFirstSeenAt` as "a timestamp stamped into an artifact to be read back later",
which the event-spine skill treats as a parallel channel unless an approved decision record names
the concern, the applicable exception, the consumers, and a reconciliation story. D7 classifies
the field as "durable sweep state, not telemetry" but does not name those elements, so the
adjudicator escalated the finding to the architecture owner. This record supplies them.

## Decision

### D1 — `headFirstSeenAt` is durable state under event-spine exception C

```text
Event spine
  Channel?    no new channel — two optional fields on the existing `WatchEntry` schema
  Concern:    durable state — "when did the sweep first see this head commit" is what is true now
              for a watched PR, read by name on every tick as a control input
  Verdict:    keep it in the existing watch registry
  Exception:  C — durable state, not an occurrence in time
```

- **Concern.** The grace window is a control input to the readiness classifier, not a record of
  something that happened. It is set once per head SHA and reset only when the head changes.
- **Consumers.** The mergeable sweep (`mergeable-sweep.ts`) is the only writer and the only reader
  of `headFirstSeenAt`. `daemon status` reads the registry only for PR membership; it takes
  verdicts from the spine.
- **Reconciliation story.** The only information shared by the registry and the spine is the head
  SHA. The registry is authoritative for grace computation (`headSha`, `headFirstSeenAt`). The
  spine is authoritative for verdict history and status (`shipped_pr_readiness` events, which also
  carry `headSha`). Nothing reconstructs an occurrence from registry state, and nothing derives
  grace control from the event ledger.

### D2 — Control state does not depend on the best-effort event ledger

Deriving the grace window from `shipped_pr_readiness` events in `.daemon/events.jsonl` was
rejected. Event emission and persistence are best-effort by design
(`adr-2026-10-09-shipped-pr-readiness-verdict` D5): a ledger failure must never interrupt the sweep.
If the grace window lived in the ledger, an unwritable ledger would mean the window never starts,
so a PR without checks would never be flagged.

## Consequences

### Positive

- The approved D7 design stands; completed BUILD work is not reversed.
- The event-spine rubric has an approved record that names the exception, consumers, and
  reconciliation, so the same finding should not recur.

### Negative

- `rewriteWatch` swallows write failures. A failed rewrite drops a freshly stamped
  `headFirstSeenAt`, and the grace window restarts on the next tick. This delays, but does not
  suppress, a `no-checks` verdict while the registry stays writable.

### Follow-up Actions

- None required. If registry write failures become observable in practice, emit them on the spine
  rather than adding a sidecar.
