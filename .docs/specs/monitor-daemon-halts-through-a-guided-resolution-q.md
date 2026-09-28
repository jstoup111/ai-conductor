# PRD: Monitor daemon HALTs through a guided resolution queue

**Date:** 2026-09-20
**Status:** Approved
**Approved by:** James Stoup, 2026-09-20, explicit approval in composer chat.

**Source:** jstoup111/ai-conductor#1228
**Parent thread:** jstoup111/ai-conductor#355 (productize the operator-local halt monitor)

## Problem / Background

When a daemon-managed feature halts, the work stops and stays stopped until a human intervenes.
Nothing brings that fact to the operator. The operator has to remember to look, discover which
features are halted, decide which one matters most, gather the evidence for it, work out which
recovery procedure applies, and then do it — once per halt, and once per project if they are
running more than one daemon.

Today three projects on this machine carry daemon state and one daemon is live, so the discovery
problem is already a cross-project problem rather than a hypothetical one.

An operator-local prototype exists outside the harness and demonstrates both the demand and the
failure mode. It watches a single project, notices halts, and runs an unattended diagnosis whose
output is a filed tracker issue describing the *systemic* gap that let the halt happen. It never
helps the operator recover the halted feature itself. It is hard-wired to one project, its
configured paths no longer resolve, and it stopped producing output in July 2026 without anyone
noticing — silent death is the specific criticism already recorded against watchers of this shape.

The harness separately owns a mature operator triage procedure: it gathers evidence read-only,
classifies the failure against a signal table, selects the one recovery procedure that applies, and
executes it only with per-action operator approval. That procedure is sound and is not what is
missing. What is missing is everything around it — being told there is work, being given it in a
sensible order, being dropped into it without setup, and being returned to the next item when the
last one is done.

## Goals & Non-Goals

### Goals

- Turn halt discovery from something the operator must remember to do into something that is
  presented to them.
- Let one operator supervise several daemon projects without checking each one by hand.
- Remove the setup cost between "a feature is halted" and "I am looking at its evidence", so the
  cost of triaging a halt is the decision itself rather than the preparation for it.
- Make the order in which halts are offered predictable, so the operator can trust that working the
  queue top-down is the right thing to do.
- Keep a human in the loop for every judgement and every state change.

### Non-Goals

- Resolving halts without an operator present. There is no unattended mode; nothing is diagnosed,
  decided, or changed while nobody is watching.
- Filing tracker issues automatically on the operator's behalf.
- Replacing the existing triage procedure, its signal table, or its approval contract.
- Supervising, restarting, attaching to, or otherwise managing daemons.
- Automatically clearing a halt because the feature appears to have made progress.
- Reporting on halts that have already been resolved; this is a work queue, not a history.

## Users / Personas

**The supervising operator.** Runs one or more daemon projects and is the only person who can
authorize a recovery. They are interrupted often, context-switch between projects, and are the
scarce resource: the daemon can produce halts faster than they can work them. They know the harness
well enough to run recovery procedures but not well enough to remember which procedure applies to
which failure signal without being told.

They are the only persona. Nothing here is consumed by automation.

## Functional Requirements

### Discovery and membership

- **FR-1:** A single dedicated operator command surfaces halted work as a queue of items to resolve,
  and stays active until the operator ends it.
- **FR-2:** The operator can direct that command at every registered project, or at one named
  project.
- **FR-3:** Before waiting for anything new, the command finds work that is already halted and
  places it in the queue, so a halt that occurred while nobody was monitoring is not missed.
- **FR-4:** While the command is active, work that halts is added to the queue without the operator
  restarting it.
- **FR-5:** A halt that is already in the queue, or that the operator is currently working, is never
  added a second time.
- **FR-6:** A halt that is no longer halted — resolved by the operator, cleared by the daemon, or
  otherwise gone — is removed from the queue rather than offered.
- **FR-7:** Work that is deliberately parked by an operator is not offered as something to resolve.
- **FR-8:** Each queued item carries enough context to act on without further lookup: which project
  it belongs to, which feature, and the stated reason and classification of the halt.

### Ordering

- **FR-9:** Higher-priority halts are offered before lower-priority ones.

  > **Amended 2026-09-20 by #1228:** FR-9 orders within a deferral partition, not across one.
  > Items the operator has not yet seen are offered first, ordered among themselves by priority;
  > items the operator deferred are offered after them, ordered among themselves by priority. The
  > original FR-9 and FR-21 were each satisfiable alone but mutually exclusive in practice — strict
  > priority order puts a deferred critical halt ahead of an unseen low-priority one, violating
  > FR-21, while strict deferral-last puts that critical halt behind it, violating FR-9. Deferral
  > takes precedence so that skipping means something the operator can rely on; priority then
  > decides order within each partition.
- **FR-10:** When two halts carry equal priority, or when priority is unavailable for either, their
  relative order is stable: the same queue contents produce the same order every time it is
  computed.
- **FR-11:** The operator can see the ordering that was applied and the priority attributed to each
  item, so an unexpected order is diagnosable rather than mysterious.
- **FR-12:** When priority cannot be determined at all, ordering degrades to the stable fallback and
  the queue is still offered — unavailable priority never empties or blocks the queue.

### The guided session

- **FR-13:** For the item at the head of the queue, the command opens a session using the operator's
  configured provider, without the operator having to start it or describe the halt to it.
- **FR-14:** That session receives the context of the specific halt it was opened for, and begins
  from evidence gathered about that halt rather than from a blank prompt.
- **FR-15:** The session presents the recovery procedure that applies to that halt's failure
  classification.
- **FR-16:** The session is able to carry out the recovery it recommends, subject to the existing
  per-action approval contract: every state change is described and individually approved by the
  operator before it happens.
- **FR-17:** A halt whose classification is not recognized is still presented, with the evidence
  gathered and the classification stated as undetermined. It is never skipped for being
  unclassifiable.
- **FR-18:** Only one guided session exists at a time. The command does not open a second session
  while one is open.

### Advancing, skipping, and ending

- **FR-19:** When the guided session ends, the operator is returned to the queue and the next item is
  offered, without restarting the command.
- **FR-20:** The operator can skip the current item. Skipping ends its session and returns the item
  to the queue for a later pass.
- **FR-21:** A skipped item is not treated as resolved, is not dropped, and is not immediately
  re-offered ahead of work the operator has not yet seen.
- **FR-22:** A halt the operator worked but could not resolve remains in the queue, with its state
  and the evidence gathered still available. Ending a session never marks a halt resolved.
- **FR-23:** When the queue is empty, the command remains active and ready, offers nothing, and
  neither creates queue entries nor opens sessions until new halted work appears.
- **FR-24:** The operator can end the command at any time, including while a session is open, and
  doing so leaves no halt in a state that blocks it from being offered on the next run.
- **FR-25:** Skip decisions survive the command being ended and restarted, so a restart does not
  re-offer everything the operator already chose to defer.

### Reconciliation with existing issue bookkeeping

- **FR-26:** The existing reconciliation that keeps previously filed halt-related tracker issues up
  to date continues to run on the monitoring cycle, with its behavior unchanged.
- **FR-27:** A failure in that reconciliation is reported and does not stop the operator's queue.

## Non-Functional Requirements

- **NFR-1:** Discovering halts is read-only. Building and ordering the queue never changes the state
  of the work being observed, and never changes daemon state.
- **NFR-2:** The command is safe to run while daemons are building, including while the harness is
  building itself, and does not cause running work to fail.
- **NFR-3:** A project that is unreadable, misconfigured, or missing does not stop the other
  projects from being monitored; the affected project is reported and the queue continues.
- **NFR-4:** The command runs in the operator's foreground under their control. The harness neither
  supervises it nor keeps it alive, and it is not required to be running for daemons to operate.
- **NFR-5:** If the command dies, nothing is lost that cannot be recomputed on its next run.
- **NFR-6:** The operator's identity and configuration are resolved the same way the rest of the
  harness resolves them; monitoring introduces no second notion of who the operator is.

## Acceptance Criteria / Success Metrics

- An operator with several projects can learn that a feature has halted, and be looking at its
  evidence, without having run any command other than the monitoring one.
- Working the queue top-down never requires the operator to second-guess the order.
- A halt that occurs while the operator is away is waiting for them when they return, exactly once.
- A halt deferred with skip reappears later in the same session and after a restart, and is never
  confused with one that was resolved.
- Ending a guided session always returns the operator to the queue, for every outcome — resolved,
  skipped, abandoned, or errored.
- No state change is made to any feature that the operator did not individually approve.
- The queue reflects reality: nothing resolved is offered, and nothing halted is invisible.

## Scope

### In Scope

- Discovery of halted work across all registered projects or one named project.
- A durable ordering of that work, with a stated, observable tie-break.
- Presenting each halt once, with its project, feature, reason, and classification.
- Opening a guided, evidence-based session for the head item using the configured provider, and
  presenting the recovery procedure for that halt's classification.
- Advancing to the next item when the session ends; skip with deferred re-offer.
- Persisting the operator's skip decisions across restarts.
- Continuing to run the existing halt-issue reconciliation on the monitoring cycle.

### Out of Scope

- Any unattended or headless mode, and any automatic tracker-issue filing.
- Automatically clearing halts or re-kicking features based on inferred progress.
- Daemon lifecycle management of any kind.
- A browsable history of resolved halts, or metrics and reporting over them.
- Changing the existing triage procedure, its signal table, or its approval contract.
- Changing how halts are produced, classified, or recorded.
- Monitoring anything other than halts.

## Key Decisions & Rationale

- **A human is in the loop for every halt; the triage merely starts by itself.** The operator
  explicitly rejected an unattended mode. The value on offer is removing setup cost, not removing
  the operator — a halt is where a confident wrong move is most expensive.
- **The monitor guides recovery; it does not record systemic gaps.** The prototype's unattended
  issue-filing addressed a different problem — improving the harness over time — and solving both in
  one place would couple them. The existing reconciliation of already-filed issues is kept running
  because it is cheap and already correct.
- **The queue reflects what is halted now, rather than accumulating a record of what was.** An
  operator work queue that can disagree with reality is worse than no queue; the prototype's silent
  death is the cautionary case. Only the operator's own deferral decisions are remembered, because
  those cannot be recomputed from anywhere else.
- **Ordering is a product commitment, not an implementation detail.** The operator must be able to
  trust top-down order, so equal and missing priority need a defined, visible answer rather than
  whatever order discovery happened to produce.
- **Ending a session never means "resolved".** Sessions end for many reasons. Inferring resolution
  from an exit would silently drop work, which is the one failure this feature exists to prevent.

## Dependencies

- **The harness's existing operator triage procedure** — the evidence gathering, failure
  classification, recovery-procedure selection, and per-action approval contract it already owns.
  This feature invokes it rather than reimplementing it, and inherits its approval contract whole.
- **The existing recovery procedures** for each failure classification, which the guided session
  presents.
- **The operator's configured provider**, and the harness's existing rules about how provider
  sessions are started and what they are permitted to do.
- **The registry of projects** the harness already maintains, which defines what "every registered
  project" means.
- **The existing priority signal** attached to work, which is resolved from the linked tracker issue
  and requires network access.
- **The existing halt-issue reconciliation** that this command continues to run.
- **Existing daemon state and halt records** as the source of what is currently halted.

## Open Questions

Each is a trade-off for architecture-review to weigh and record as an ADR; none is decided here.

- **OQ-1:** Sessions started by the harness are deliberately forbidden from invoking harness
  operations, which would prevent a guided session from carrying out any recovery (FR-16). Whether
  the guided session is exempted, started outside that boundary, or restricted to advising while the
  operator acts elsewhere, is the central technical decision of this feature.
- **OQ-2:** Whether the operator's deferral decisions (FR-25) are the only thing persisted, or
  whether attempt counts and per-halt history justify a durable record of the queue itself — and if
  so, how that record is reconciled against reality so it cannot drift.
- **OQ-3:** Whether membership in the queue is derived from the recorded state of each halt or from
  the stream of events the harness already publishes, given that not every halt transition is
  currently observable on that stream.
- **OQ-4:** How priority is attributed to a *halt*, given the existing priority signal is attached to
  work awaiting dispatch rather than to halted work, and requires a network call per item.
- **OQ-5:** Whether monitoring several projects continuously is compatible with the standing
  position that the harness supervises no always-on process, and with the existing refusal to follow
  several projects' output at once.
- **OQ-6:** Whether a guided session operating on a halted feature can do so without disturbing a
  concurrently running build, particularly when the harness is building itself.
- **OQ-7:** Whether this supersedes the parent thread (#355) or implements it, and what becomes of
  the operator-local prototype once this ships.
