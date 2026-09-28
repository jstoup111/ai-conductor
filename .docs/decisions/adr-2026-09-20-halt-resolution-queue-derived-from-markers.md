# ADR: The halt resolution queue is derived from halt markers; only operator deferrals persist

Date: 2026-09-20
Source: jstoup111/ai-conductor#1228
Review mode: full, Tier L, product track
Status: APPROVED
Deciders: James Stoup, operator approval in composer session on 2026-09-20.

## Confirmed scope

The operator selected the balanced scope: discovery across all registered projects or one named
project, stable priority ordering, dedup, skip with deferred re-offer, an auto-started guided
session per halt, and advance-on-exit. No unattended mode, no autonomous issue filing, no daemon
supervision, no auto-rekick. This ADR settles the queue's state architecture (PRD OQ-2, OQ-3, OQ-4).
Session authority and launch are settled separately by
adr-2026-09-20-operator-launched-sessions-retain-conductor-authority.

## Context and evidence

Verified in halt-marker.ts: `.pipeline/HALT` plus the `.pipeline/HALT.class` sidecar are declared
the single source of truth for halt state, and every path constant and read/write/remove helper
lives in that one module. `readHaltClass` is tolerant — a missing, unreadable, or unrecognized
sidecar resolves to `unclassified` rather than throwing. `isOperatorActionHalt` already names the
classes that require a human: `needs-human`, `protected-artifact`, `plan-gap`, `unclassified`.

Verified in daemon-dashboard.ts: `scanInheritedState` already buckets every worktree into halted,
in-progress, parked, processed, and other states with a documented precedence, and is callable
outside the daemon with a stubbed discovery function — daemon-observe-cli.ts does exactly that.
Its `HaltedEntry` carries slug, reason, step, tier, and PR URL, but **not** the halt class; the
class must be read alongside it.

Verified in daemon-deps.ts: `isHalted` — the daemon's own dispatch gate — is the presence of
`.pipeline/HALT`. Marker presence is therefore already the authority on whether work is halted.

Verified in halt-marker.ts: `snapshotHaltMarker` captures a marker's identity as
`{present, mtimeMs, size}`, and `readStepWrittenHaltReason` compares that snapshot to distinguish a
halt written by an operation from one it merely inherited. The module documents this comparison as
deliberately failing safe: every ambiguous case resolves to "treat it as stale" rather than risk a
false positive.

Verified in event-sinks.ts and types/events.ts: there is **no** `halt_raised` event. `writeHaltMarker`
emits only on failure. The daemon's `onHaltWritten` is a dependency callback inside the daemon
process, not an event. `halt_cleared` is declared `persist: false` and so never reaches
`events.jsonl`. `feature_dispatch_ended` carries `outcome: 'halted'` but fires at the daemon's
collection point, not at halt-write time, and not at all for a halt the daemon did not dispatch.

Verified in backlog-priority.ts: priority comes only from `priority: <level>` labels on the linked
tracker issue, requiring a network call per reference. `orderBacklog` ranks bands and breaks ties on
the item's original index — a stable sort preserving discovery order. On a fetch outage the resolver
warns once and returns fallback mode, which is input order with no reordering. Note the existing
rank inversion: `no-issue` sorts first and `unlabeled` sorts last.

Verified in queue.ts: the only durable queue primitive in the engine is the intake file queue. It is
strictly FIFO by lexicographic filename and has no priority dimension.

Verified in event-persister.ts and every reader of `events.jsonl`: there is no live tail or
subscribe consumer; every reader slurps the whole file. The only live-watch mechanisms are a
chokidar watch for a halt being *cleared* and byte-offset polling of the daemon log.

Historical evidence: the operator-local prototype at `~/.ai-conductor/halt-monitor/monitor.sh` is
hard-wired to one project, its configured repository path no longer resolves on this machine, and
its log stopped advancing on 2026-07-12 without anyone noticing.
adr-2026-07-10-observed-close-watch-registry records the judgement already formed about that shape,
rejecting "an external tmux monitor (halt-monitor precedent: dies silently)".

## Governing decisions and reuse check

- adr-2026-07-04-operator-park-marker, especially D2, D4 and D6: per-repo operator directives live
  in `.daemon/` at the main root because they must survive worktree teardown; a presence check must
  confirm absence to proceed; every marker path and helper lives in one module with no re-spelled
  paths.
- adr-2026-07-10-park-marker-main-root-resolution: every per-repo state primitive resolves its root
  through the shared main-root seam, so a write from inside a worktree cannot strand.
- adr-2026-08-23-committed-halt-record, especially D8: a durable artifact is state, not a channel;
  the occurrences it generates ride the existing spine as additive `ConductorEvent` members. This is
  the template applied below.
- adr-2026-07-26-event-sink-registry-exhaustiveness: every new event member must declare where it
  goes; the type system rejects the literal otherwise.
- adr-2026-08-11-halt-events-ride-the-persisted-spine: halt events are persisted spine members.
- adr-2026-07-10-intake-claim-priority-banding: priority band ordered above receipt order, resolved
  at claim time, failing open. Reused as the ordering precedent.
- adr-2026-07-03-priority-fetch-fail-soft: a priority fetch failure degrades to date order with a
  single warning rather than blocking.
- adr-2026-07-03-gated-snapshot-status-read-model: an out-of-process read model may be recomputed
  and is distinct from a file serving as a dashboard's source of truth.
- adr-2026-08-12-fail-closed-intake-ledger-durability: absent is not unparseable; a corrupt durable
  file is preserved by copy, never by rename.
- adr-2026-07-28-total-halt-classification-legacy-boundary: halt classification is total, with an
  explicit legacy boundary — no halt is unclassifiable.

A new ADR is warranted for the uncovered structural decision of how an operator work queue over
halted features holds — or declines to hold — durable state. The decisions above are reused, not
replaced. No existing ADR governs an operator triage queue.

## Alternatives

### A. Derived queue, deferrals persisted — selected by operator

Membership is recomputed from halt markers on every pass; the only durable state is the operator's
own deferral decisions. Cannot drift, because there is nothing to drift from. Does not answer
"how many times has this halt been offered" across restarts beyond the deferral record.

### B. Durable priority queue artifact

A per-repo queue file holding membership, attempt counts, and per-halt history, written atomically
and reconciled at startup. Gives cross-run history directly. Rejected for now: it introduces a
second store that can disagree with the halt markers, and it must be fully reconciled against those
markers at every startup anyway — which is exactly what A does continuously. It buys history at the
cost of a drift class, a lease design, and the reconciliation story. Deferred, not refused; D7
records what would justify revisiting it.

### C. Event-driven membership

Detect halts by consuming persisted halt events rather than reading markers. Rejected on present
evidence: no `halt_raised` event exists, and `halt_cleared` is `persist: false`, so such a monitor
would both miss halts and keep offering resolved ones. D2 records what would change this.

## Decision

1. **Queue membership is derived, never stored.** The monitor recomputes the set of halted features
   from halt markers on every pass — at startup, after a guided session ends for any reason, after
   an approved recovery, and while idle. No component holds a durable record of what is in the
   queue. Membership for a project is the set of features whose halt marker is present, excluding
   any feature carrying an operator park marker, and excluding a marker co-present with the
   completion marker that existing state-scanning already treats as reclaimable rather than halted.
   The existing state scan and the existing halt-class read are reused; the class must be attached
   to each entry, because the existing halted-entry shape does not carry it. This is what makes a
   monitor that dies leave nothing stale behind: its next launch re-derives everything.

2. **Detection reads halt markers as state, not halt events as occurrences.** Marker presence is
   already the authority the daemon's own dispatch gate consults, and the question the queue asks —
   "what is halted now" — is a question about durable state rather than about occurrences in time.
   This is a deliberate departure from a preference for spine-driven observation, taken on specific
   evidence and not on convenience: no positive halt-raised event exists, the universal choke point
   is a dependency callback inside the daemon process rather than an event, and `halt_cleared` is
   declared `persist: false`. An event-driven monitor would today miss halts and continue offering
   resolved ones. Should a persisted halt-raised member and a persisted clear both exist, this
   decision should be revisited; adding them is out of scope here, and this ADR does not block
   them. Polling interval is a liveness floor for *noticing*, never a correctness boundary, because
   every consumer of the queue re-derives membership before acting on it.

3. **The operator's deferral decisions are the only persisted state.** A deferral is the one fact
   that cannot be recomputed from anywhere else: it is the operator's choice, not an observable
   property of the halt. It is per-repo operator state and is written under the main checkout's
   daemon state directory, resolved through the existing main-root seam so a write from inside a
   worktree cannot strand. Its path constant and its read/write/clear helpers live in one module
   and are never re-spelled by a caller. That directory is live-boundary excluded, so writing it
   cannot halt a self-host build. A corrupt or unreadable deferral record is preserved by copy —
   never by rename — and the monitor continues with no deferrals recorded, which re-offers work
   rather than suppressing it.

4. **A deferral is keyed by project, feature, and halt identity, and fails toward re-offering.**
   Keying on project and feature alone is insufficient: a feature that halts again after being
   resolved is a new halt and must be offered again, not silently suppressed by a stale deferral.
   Halt identity therefore incorporates the marker-identity shape the halt-marker module already
   captures for exactly this "is this the same marker" question. When a stored deferral's halt
   identity does not match the current marker, the deferral does not apply and the item is offered.
   When halt identity cannot be established at all, the item is offered. The fail direction is
   always toward showing the operator work, because the failure this feature exists to prevent is
   halted work going unnoticed; a redundant offer costs one skip, a suppressed offer costs a
   stalled feature.

5. **Ordering is priority band first, then a stable tie-break, and degrades without emptying.**
   The existing linked-issue priority signal and its band ranking are reused rather than duplicated;
   equal or absent bands preserve a stable order, so identical queue contents always produce an
   identical sequence. When priority cannot be resolved — an outage, no linked reference, or no
   network — ordering degrades to the stable fallback and the queue is still offered in full; an
   unresolvable priority never empties, blocks, or reorders the queue into an arbitrary shape. The
   band attributed to each item and the ordering applied are shown to the operator, so an unexpected
   order is diagnosable. Note for implementation: the existing band rank sorts unlinked work first
   and unlabeled work last; that inversion is inherited deliberately and must not be silently
   "corrected" here.

6. **Queue transitions ride the existing spine as additive event members.** An item offered, a
   guided session opened, an item deferred, and a session ended are occurrences other components
   need to know about, so each is a new `ConductorEvent` member with its exhaustive sink
   declaration. No bespoke ledger, no second event format, and no reader path forked from the
   existing one. The deferral record of D3 is state with its own schema read by name — exception C —
   and is explicitly not a second event-shaped ledger; exception B is not claimed, because no write
   is being moved off an existing ledger.

7. **No durable queue artifact ships now, and what would justify one is recorded.** Alternative B
   becomes the right design when the operator needs a question answered that a derived queue cannot
   answer — how often a given halt has been offered and abandoned across restarts, or how long halts
   wait before being worked. Such an artifact must then carry its own reconciliation story against
   the halt markers, because the markers remain authoritative under D1; it may not become a second
   source of truth for membership.
