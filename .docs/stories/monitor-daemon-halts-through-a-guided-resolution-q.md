**Status:** Accepted

# Stories: Monitor daemon HALTs through a guided resolution queue

Product track — acceptance criteria extracted from the approved PRD
`.docs/specs/monitor-daemon-halts-through-a-guided-resolution-q.md` (FR-1..FR-27), grounded in
APPROVED `adr-2026-09-20-halt-resolution-queue-derived-from-markers` and
`adr-2026-09-20-operator-launched-sessions-retain-conductor-authority`, and carrying review
conditions C1, C2, C3, C5 and C7 from
`.docs/decisions/architecture-review-2026-09-20-monitor-daemon-halts-through-a-guided-resolution-q.md`.

Source: jstoup111/ai-conductor#1228.

## Story 1: The monitor surfaces halted work and stays under the operator's control

**Requirement:** FR-1, FR-23, FR-24

As the supervising operator, I want one command that stays active and shows me halted work, so that
I stop having to remember to go looking for it.

### Acceptance Criteria

#### Happy Path
- Given at least one feature is halted in a selected project, when the operator starts the monitor, then it reports that halt as work to resolve rather than exiting.
- Given the monitor is running and no halts exist anywhere in the selected projects, when a resolution pass completes, then the monitor reports an empty queue, remains active, and opens no session.
- Given the monitor is running with an empty queue, when a feature halts in a selected project, then the next pass reports it without the operator restarting the monitor.
- Given the monitor is running, when the operator ends it with an interrupt, then it stops and reports that it stopped.

#### Negative Paths
- Given the monitor is running with an empty queue, when several passes complete with no halts, then no queue entry and no provider session are created by any of those passes.
- Given a guided session is open, when the operator ends the monitor, then the monitor stops without marking the open item resolved and without writing a deferral for it.
- Given the operator ended the monitor while an item was open, when the monitor is started again and that feature is still halted, then the item is offered again.
- Given the monitor is invoked in an environment carrying the engine's daemon-session marker, when it starts, then it is refused by the existing entry guard and no queue is built.

### Done When
- [ ] Starting the monitor with a halted feature present reports that halt and the process stays alive.
- [ ] Starting the monitor with no halted features present reports an empty queue, stays alive, and creates zero sessions.
- [ ] An interrupt during an open guided session exits without writing a deferral or a resolution for that item.
- [ ] A test asserts the monitor verb is not in the session-sanctioned subcommand set and is refused under the daemon-session marker.

## Story 2: The operator chooses every registered project or one named project

**Requirement:** FR-2

As the supervising operator, I want to point the monitor at all my daemon projects or at just one,
so that I can supervise a fleet or focus on the project I am working in.

### Acceptance Criteria

#### Happy Path
- Given three projects are registered and two contain halted features, when the operator runs the monitor across all registered projects, then the queue contains the halts from both projects.
- Given three projects are registered and the operator names one of them, when the monitor runs, then the queue contains only halts from the named project.
- Given the monitor is running across all registered projects, when a queue item is displayed, then it states which project it belongs to.

#### Negative Paths
- Given the operator names a project that is not registered, when the monitor starts, then it reports the unknown name, lists nothing, and exits non-zero without building a queue.
- Given one registered project's path no longer exists on disk, when the monitor runs across all projects, then that project is reported as unreadable and halts from the remaining projects are still queued.
- Given one registered project's directory is unreadable due to permissions, when the monitor runs, then that project is reported and the pass completes with the other projects' halts.
- Given the registry file is absent, when the monitor runs across all registered projects, then it reports that no projects are registered and exits without error rather than throwing.
- Given the registry file contains malformed content, when the monitor runs, then it reports the registry as unreadable and exits non-zero rather than silently monitoring nothing.

### Done When
- [ ] A multi-project fixture produces one merged queue containing halts from every selected project, each labelled with its project.
- [ ] Naming a single project restricts the queue to that project's halts only.
- [ ] A missing, unreadable, or path-absent project is reported and does not prevent the remaining projects from being queued.
- [ ] An unknown project name exits non-zero with the name reported and no queue built.

## Story 3: Work already halted at startup is discovered before the monitor waits

**Requirement:** FR-3

As the supervising operator, I want halts that happened while I was away to be waiting for me, so
that nothing is missed because the monitor was not running when it happened.

### Acceptance Criteria

#### Happy Path
- Given two features halted before the monitor was started, when the monitor starts, then both appear in the queue on its first pass.
- Given a feature halted before the monitor was started, when the monitor starts, then it offers that halt before waiting for any new halt to occur.

#### Negative Paths
- Given a feature halted and was then resolved before the monitor was started, when the monitor starts, then that feature does not appear in the queue.
- Given a feature's halt marker exists but its worktree directory has been removed, when the monitor starts, then that feature is not offered as a live halt and the pass completes without throwing.
- Given a project contains no worktrees at all, when the monitor starts, then that project contributes no entries and produces no error.

### Done When
- [ ] A fixture with pre-existing halts yields those halts in the first pass's queue, before any wait.
- [ ] A halt resolved before startup is absent from the first pass's queue.
- [ ] A halt marker whose worktree is gone does not produce a queue entry and does not throw.

## Story 4: Newly halted work joins the queue without a restart

**Requirement:** FR-4

As the supervising operator, I want halts that occur while I am working the queue to be picked up,
so that I do not have to restart the monitor to see current work.

### Acceptance Criteria

#### Happy Path
- Given the monitor has completed a pass with an empty queue, when a feature halts and the next pass runs, then that halt appears in the queue.
- Given the monitor is working through a queue of two items, when a third feature halts and membership is next recomputed, then the third halt is included in the ordering.

#### Negative Paths
- Given a feature halts and is resolved between two consecutive passes, when the later pass runs, then that feature is not offered.
- Given a halt marker is written while a pass is midway through enumerating projects, when that pass completes, then the queue is internally consistent and the halt is picked up by that pass or the next one, never producing a duplicate entry across the two.

### Done When
- [ ] A halt created after startup appears in a subsequent pass's queue with no restart.
- [ ] A halt created and cleared between passes never reaches the operator.
- [ ] A halt appearing mid-pass yields exactly one queue entry across that pass and the next.

## Story 5: A halt is never duplicated in the queue, and only one session is open at a time

**Requirement:** FR-5, FR-18

As the supervising operator, I want a halt to appear as a single item rather than several, so that
the queue reflects work remaining rather than work already in front of me. This is about duplicate
entries, not about permanence: a halt I defer is deliberately offered again later, per Story 16.

### Acceptance Criteria

#### Happy Path
- Given a halt is currently being worked in an open guided session, when membership is recomputed, then that halt is not offered a second time while its session is open.
- Given a queue of three halts, when the monitor works through them, then exactly one guided session exists at any moment.

#### Negative Paths
- Given a halt is currently open in a guided session, when a pass recomputes membership, then the monitor does not open a second session for that same halt.
- Given the same feature is somehow enumerated twice within one pass, when the queue is built, then it yields a single entry for that feature.
- Given two monitors are run over the same project by the same operator, when both compute membership, then each offers the halt independently and neither corrupts the other's state, the redundant offer being accepted as a duplicate prompt rather than a data fault.

### Done When
- [ ] While a session is open for an item, no second session is opened for that item by any subsequent pass.
- [ ] Working a three-item queue never has two sessions open concurrently.
- [ ] A duplicate enumeration of one feature collapses to one queue entry.

## Story 6: A halt that is no longer halted leaves the queue

**Requirement:** FR-6

As the supervising operator, I want resolved work to disappear from the queue, so that the queue
tells me the truth about what still needs me.

### Acceptance Criteria

#### Happy Path
- Given a queued halt is resolved during its guided session, when membership is next recomputed, then that feature is no longer in the queue.
- Given a queued halt is cleared by the daemon between passes, when the next pass runs, then that feature is not offered.
- Given a halt was resolved, when the queue is displayed, then the resolved feature is absent rather than shown with a resolved status.

#### Negative Paths
- Given a feature's halt marker is removed while its guided session is still open, when the session ends and membership is recomputed, then the feature is absent from the queue and is not reported as unresolved.
- Given a feature's halt marker is removed and a new halt marker is written for the same feature before the next pass, when that pass runs, then the feature is offered as current halted work.
- Given a halt marker is present alongside the completion marker that existing state scanning treats as reclaimable, when membership is computed, then that feature is not offered as halted.

### Done When
- [ ] A feature whose halt marker is removed is absent from the next computed queue.
- [ ] No queue entry ever carries a resolved status; resolution is expressed by absence.
- [ ] A halt marker co-present with the completion marker produces no queue entry.

## Story 7: Operator-parked work is never offered as something to resolve

**Requirement:** FR-7

As the supervising operator, I want work I deliberately parked to stay out of the queue, so that my
own decision to stop something is not presented back to me as a failure.

### Acceptance Criteria

#### Happy Path
- Given a feature is halted and also carries an operator park marker, when membership is computed, then that feature is not offered.
- Given a parked feature is unparked while still halted, when membership is next computed, then it is offered.

#### Negative Paths
- Given a feature carries a park marker and the park-marker check cannot complete due to a read error, when membership is computed, then the feature is treated as parked and is not offered, the check confirming absence of a park before offering.
- Given a park marker is added while that feature's guided session is open, when the session ends, then the feature is absent from the recomputed queue.

### Done When
- [ ] A halted, parked feature produces no queue entry.
- [ ] Unparking a still-halted feature causes it to be offered on the next pass.
- [ ] A park-marker read error results in the feature being withheld from the queue, never offered.

## Story 8: Each queue item carries enough context to act on

**Requirement:** FR-8

As the supervising operator, I want each item to tell me what it is without further lookup, so that
I can decide what to work next without opening anything.

### Acceptance Criteria

#### Happy Path
- Given a queued halt, when the queue is displayed, then the item states its project, its feature, the stated halt reason, and the halt classification.
- Given a halt whose stated reason spans several lines, when the item is displayed, then the operator-facing reason is presented without the display becoming unreadable.

#### Negative Paths
- Given a halt whose marker body is empty, when the item is displayed, then the reason is reported as unstated and the item is still offered.
- Given a halt whose classification sidecar is missing, when the item is displayed, then the classification is reported as undetermined and the item is still offered.
- Given a halt whose marker cannot be read at display time, when the item is displayed, then the read failure is reported against that item and the remaining items still display.

### Done When
- [ ] Every displayed item shows project, feature, reason, and classification.
- [ ] An empty halt body displays as an unstated reason with the item still present.
- [ ] A missing classification sidecar displays as undetermined with the item still present.

## Story 9: Higher-priority halts are offered first

**Requirement:** FR-9

As the supervising operator, I want the most important halt offered first, so that working the
queue top-down is the right thing to do.

### Acceptance Criteria

#### Happy Path
- Given two unseen halted features whose linked issues carry different priority labels, when the queue is ordered, then the higher-priority halt is offered before the lower-priority one.
- Given unseen halts spanning several priority bands, when the queue is ordered, then they appear in descending band order among themselves.
- Given one deferred critical halt and one unseen low-priority halt, when the queue is ordered, then the unseen low-priority halt is offered first, deferral partitioning the queue ahead of priority.
- Given several deferred halts of differing bands, when they are offered after unseen work is exhausted, then they appear in descending band order among themselves.
- Given the ordering reuses the existing priority resolver, when several halts share one linked reference, then that reference's priority is fetched once for the pass rather than once per item.

#### Negative Paths
- Given a halted feature whose linked issue does not exist, when the queue is ordered, then that item is still queued and its band is reported as unresolved rather than the pass failing.
- Given a halted feature with no linked issue reference at all, when the queue is ordered, then it is placed according to the existing band ranking for unlinked work and is still offered.
- Given the priority lookup fails for one reference while succeeding for others, when the queue is ordered, then every halt is still queued and the failure is reported once rather than per item.

### Done When
- [ ] A fixture of mixed-priority unseen halts orders highest band first.
- [ ] A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority.
- [ ] Priority is resolved through the existing resolver, and a repeated reference within one pass causes one lookup, verified against a counting stub.
- [ ] A halt whose linked issue is missing is still queued with its band reported as unresolved.

## Story 10: Ties break stably and the applied ordering is visible

**Requirement:** FR-10, FR-11

As the supervising operator, I want equal-priority items to hold a predictable order I can see, so
that an unexpected order is diagnosable rather than mysterious.

### Acceptance Criteria

#### Happy Path
- Given several halts carrying the same priority band, when the queue is ordered twice over identical contents, then both orderings are identical.
- Given several halts for which no priority is available, when the queue is ordered twice over identical contents, then both orderings are identical.
- Given a queue is displayed, when the operator reads it, then each item shows the band attributed to it and the ordering basis applied to the queue.

#### Negative Paths
- Given two halts whose bands are equal, when one of them is deferred and the queue is recomputed, then the remaining items hold their previous relative order.
- Given the queue is recomputed after an unrelated feature halts, when the ordering is applied, then previously-ordered equal-band items retain their relative order with the new item placed by its own band.
- Given priority is unresolved for every item, when the queue is displayed, then the ordering basis is reported as the fallback rather than implying a priority order that was never resolved.

### Done When
- [ ] Ordering the same queue contents twice yields byte-identical sequences, for both equal-band and no-priority fixtures.
- [ ] Each displayed item carries its attributed band, and the queue reports the ordering basis applied.
- [ ] Removing one item from an equal-band group leaves the remaining items' relative order unchanged.

## Story 11: Unavailable priority degrades the order without emptying the queue

**Requirement:** FR-12

As the supervising operator, I want the queue to keep working when priority cannot be fetched, so
that a network problem never hides halted work from me.

### Acceptance Criteria

#### Happy Path
- Given priority resolution is in an outage, when the queue is built, then every halt is still offered, ordered by the stable fallback.
- Given priority resolution is in an outage, when the queue is displayed, then the operator is told once that ordering degraded to the fallback.

#### Negative Paths
- Given priority resolution fails for every item, when the queue is built, then the queue is not empty and contains every halted feature.
- Given priority resolution fails, when several passes run during the same outage, then the operator is warned once for the outage rather than once per pass per item.
- Given priority resolution fails, when the queue is built, then the monitor does not block waiting on the lookup and the pass completes.
- Given priority resolution recovers after an outage, when the next pass runs, then band ordering is applied again without restarting the monitor.

### Done When
- [ ] A forced priority outage yields a full queue ordered by the stable fallback, never an empty one.
- [ ] The degradation notice appears once per outage, not per item or per pass.
- [ ] Recovery from the outage restores band ordering on a subsequent pass with no restart.

## Story 12: The guided session starts itself, carrying the halt's context

**Requirement:** FR-13, FR-14

As the supervising operator, I want to be dropped straight into the halt with its evidence already
in hand, so that the cost of triaging is the decision rather than the setup.

### Acceptance Criteria

#### Happy Path
- Given a queue whose head item is a halt, when the monitor reaches that item, then it opens a session in the operator's configured provider without the operator starting it.
- Given a session is opened for a halt, when it begins, then it has been given that halt's project, feature, stated reason, and classification as explicit input rather than starting from a blank prompt.
- Given the operator's configured provider is the non-default one, when a session is opened, then it is opened in that configured provider.
- Given a session is opened, when it begins, then it is a fresh session rather than a resumption of any previous session.

#### Negative Paths
- Given the configured provider's binary is not on the path, when the monitor tries to open a session, then the failure is reported against that item, the item remains in the queue, and the monitor stays active.
- Given the configured provider fails to start, when the monitor tries to open a session, then no deferral is written for that item and it is not marked resolved.
- Given no interactive terminal is attached, when the monitor reaches an item, then it refuses to open a session and reports why rather than spawning an unattended one.
- Given the configured provider name is not a registered provider, when the monitor starts, then it reports the unknown provider and opens no session.

### Done When
- [ ] A session is opened for the head item without operator action, in the configured provider.
- [ ] The session's opening input contains the halt's project, feature, reason, and classification, asserted against a mocked launch boundary.
- [ ] Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn (C2).
- [ ] A missing provider binary reports the failure, leaves the item queued, and keeps the monitor alive.
- [ ] Launching with no attached terminal is refused.

## Story 13: The session presents the recovery procedure for the halt's classification

**Requirement:** FR-15, FR-17

As the supervising operator, I want to be shown the one procedure that applies, so that I am not
guessing which recovery is right.

### Acceptance Criteria

#### Happy Path
- Given a halt whose classification maps to a recovery procedure, when the guided session runs, then that procedure is presented.
- Given a halt whose classification differs from the previous item's, when its session runs, then the procedure presented is the one for its own classification.
- Given a halt is presented, when the session begins, then its evidence gathering happens without changing the state of the halted feature.

#### Negative Paths
- Given a halt whose classification is not one the monitor recognizes, when the session runs, then the halt is still presented with its classification stated as undetermined and is not skipped.
- Given a halt whose classification sidecar is absent, when the session runs, then the halt is presented with its classification stated as undetermined and is not skipped.
- Given a halt classification is added to the underlying classification set in future, when the monitor handles classifications, then handling is exhaustive over that set with no catch-all branch that would silently absorb the new member.

### Done When
- [ ] Each recognized classification presents its corresponding recovery procedure.
- [ ] An unrecognized or absent classification presents the halt with classification stated as undetermined and never filters it from the queue (C5).
- [ ] Classification handling is exhaustive over the existing classification union with no catch-all default (C5).

## Story 14: The guided session can carry out recovery under per-action approval

**Requirement:** FR-16

As the supervising operator, I want the session that diagnosed the halt to be able to fix it with my
approval, so that I am not retyping every command in another terminal.

### Acceptance Criteria

#### Happy Path
- Given a guided session opened by the monitor, when it attempts a conductor operation needed for recovery, then that operation is permitted rather than refused by the entry guard.
- Given a guided session proposes a state-changing recovery action, when it is about to act, then it presents the action and its blast radius and waits for approval before acting.
- Given the operator approves one recovery action, when a further state-changing action follows, then approval is requested again for that action.
- Given a guided session is diagnosing, when it gathers evidence, then it does so without requesting approval, diagnosis being read-only.
- Given a guided session runs, when its working directory is resolved, then it runs within the halted feature's own worktree.

#### Negative Paths
- Given a guided session, when the operator declines a proposed recovery action, then the action is not performed and the halt remains.
- Given the launch seam, when it is invoked from the daemon, a step runner, or any non-foreground path, then the launch is refused and no unmarked session is created.
- Given a session dispatched by the engine rather than launched by the monitor, when it attempts a conductor state-changing operation, then it is refused exactly as it is today, the sanctioned-subcommand set being unchanged.
- Given a guided session runs, when it writes provider configuration or acquires permissions, then those writes land inside the feature worktree and not in the main checkout.

### Done When
- [ ] A session opened through the launch seam is not stamped with the daemon-session marker and can invoke conductor operations.
- [ ] A test asserts the launch seam is unreachable from the daemon, from a step runner, and from any non-interactive invocation, failing if that reachability is introduced (C1).
- [ ] A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs.
- [ ] The guided session's resolved working directory is the halted feature's worktree.

## Story 15: Ending a session returns the operator to the queue

**Requirement:** FR-19

As the supervising operator, I want the next item offered when I finish one, so that I can work the
queue without restarting anything.

### Acceptance Criteria

#### Happy Path
- Given a guided session for the head item ends normally, when the monitor continues, then it recomputes membership and offers the next item.
- Given a queue of three halts, when each session ends in turn, then all three are offered in order without the monitor being restarted.
- Given the last item's session ends and no halts remain, when the monitor continues, then it reports an empty queue and stays active.

#### Negative Paths
- Given a guided session exits with a non-zero status, when the monitor continues, then it still returns to the queue and offers the next item.
- Given a guided session is terminated by a signal, when the monitor continues, then it still returns to the queue rather than exiting.
- Given a guided session ends having changed nothing, when membership is recomputed, then the same halt is offered again rather than being silently consumed.

### Done When
- [ ] Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue.
- [ ] A three-item queue is worked to completion without a restart.
- [ ] A session that changed nothing leaves its halt in the recomputed queue.

## Story 16: Skipping defers an item rather than resolving or dropping it

**Requirement:** FR-20, FR-21

As the supervising operator, I want to put an item aside without losing it, so that I can work what
matters now and come back to the rest.

### Acceptance Criteria

#### Happy Path
- Given a guided session is open, when the operator skips the item, then that session ends and the monitor moves to the next item.
- Given an item was skipped, when the pass continues, then the skipped item is not offered ahead of items the operator has not yet seen, regardless of its priority band.
- Given every item in the queue has been skipped, when a later pass runs, then the skipped items are offered again, ordered among themselves by priority band.

#### Negative Paths
- Given an item is skipped, when membership is recomputed, then that item is not treated as resolved and its halt is still present.
- Given an item is skipped, when the queue is next displayed, then the item is not dropped from the system and remains discoverable.
- Given an item is skipped, when the immediately following item is selected, then the skipped item is not re-offered immediately ahead of unseen work.
- Given the last unseen item is skipped and only skipped items remain, when the monitor continues, then it offers a deferred item again rather than reporting an empty queue.

### Done When
- [ ] Skipping ends the current session and advances to the next item.
- [ ] A skipped item's halt marker is untouched and the item is never marked resolved.
- [ ] A skipped item is not re-offered ahead of unseen work, and is offered again once unseen work is exhausted.

## Story 17: An unresolved halt stays visible, and exit never means resolved

**Requirement:** FR-22

As the supervising operator, I want a halt I could not fix to still be there, so that a hard problem
is never silently dropped.

### Acceptance Criteria

#### Happy Path
- Given a guided session ends without resolving the halt, when membership is recomputed, then that halt is still in the queue with its state and evidence available.
- Given a halt is offered a second time after an unsuccessful session, when it is displayed, then it carries the same project, feature, reason, and classification.

#### Negative Paths
- Given a guided session exits with a success status but the halt marker is still present, when membership is recomputed, then the halt is still offered, resolution being derived from the marker rather than from the exit status.
- Given a guided session claims in its output that the halt is resolved but the marker remains, when membership is recomputed, then the halt is still offered.
- Given a guided session ends, when the monitor records anything about it, then it records no resolution verdict of its own.

### Done When
- [ ] A session exiting zero with the halt marker still present leaves the halt in the queue.
- [ ] No code path marks a halt resolved on session exit; resolution is only ever the absence of the marker on recomputation.
- [ ] A re-offered halt displays the same context it displayed the first time.

## Story 18: Deferrals survive a restart and cannot suppress a new halt

**Requirement:** FR-25

As the supervising operator, I want my skip decisions remembered across restarts but never at the
cost of hiding new work, so that restarting does not re-offer everything and does not conceal
anything.

### Acceptance Criteria

#### Happy Path
- Given the operator skipped an item and then restarted the monitor, when the queue is built, then that item is not re-offered ahead of unseen work.
- Given a deferral was recorded, when the deferral record is read, then it identifies the project, the feature, and the identity of the specific halt that was deferred.
- Given a deferred halt is resolved and the same feature halts again, when the queue is built, then the new halt is offered despite the earlier deferral.

#### Negative Paths
- Given a stored deferral whose halt identity does not match the feature's current halt, when the queue is built, then the deferral does not apply and the item is offered.
- Given a stored deferral whose halt identity cannot be established, when the queue is built, then the item is offered rather than suppressed.
- Given the deferral record contains unparseable content, when the monitor runs, then the record is preserved by copy rather than rename, the monitor continues with no deferrals in effect, and every halt is offered.
- Given the deferral record's directory is unwritable, when the operator skips an item, then the failure is reported, the item is not lost from the queue, and the monitor stays active.
- Given the deferral record is absent, when the monitor runs, then it proceeds with no deferrals rather than treating absence as corruption.
- Given a deferral is written from within a feature worktree, when its location is resolved, then it is written under the main checkout's daemon state directory rather than inside the worktree.

### Done When
- [ ] A skip survives a monitor restart and the item is not re-offered ahead of unseen work.
- [ ] The deferral key is a structured type carrying project, feature, and halt identity as separate fields, not a concatenated string (C3).
- [ ] A deferral whose halt identity no longer matches the current halt does not suppress the item.
- [ ] An unestablishable halt identity results in the item being offered, proving the fail direction is toward offering.
- [ ] An unparseable deferral record is preserved by copy and the monitor continues with every halt offered.
- [ ] The deferral record resolves to the main checkout's daemon state directory when written from a worktree.

## Story 19: Halt-issue reconciliation runs on the cycle without blocking the queue

**Requirement:** FR-26, FR-27

As the supervising operator, I want the existing issue bookkeeping to keep running while I work the
queue, so that I do not lose a capability I have today and do not have to run it by hand.

### Acceptance Criteria

#### Happy Path
- Given the monitor is running, when a monitoring cycle completes, then the existing halt-issue reconciliation is invoked.
- Given the reconciliation runs, when it completes, then its behavior is unchanged from invoking it directly.

#### Negative Paths
- Given the reconciliation exits non-zero, when the cycle continues, then the failure is reported and the operator's queue continues to be offered.
- Given the reconciliation cannot reach the network, when the cycle continues, then the failure is reported once and the queue is unaffected.
- Given the reconciliation throws unexpectedly, when the cycle continues, then the monitor stays active and the next pass still builds a queue.
- Given the reconciliation is slow, when it is running, then the operator's queue work is not blocked waiting for it.

### Done When
- [ ] A monitoring cycle invokes the existing reconciliation with its behavior unchanged.
- [ ] A non-zero exit, a network failure, and a thrown error each leave the monitor active and the queue offered.
- [ ] Queue work is not blocked on reconciliation completion.
