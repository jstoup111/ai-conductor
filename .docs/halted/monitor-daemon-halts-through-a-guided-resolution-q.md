# Halt record

Status: resolved
Resolution cause: rekick
Resolved at: 2026-09-29T00:57:48.767Z
Slug: monitor-daemon-halts-through-a-guided-resolution-q
Class: needs-human
Halting step: unknown
Phase: unknown
Branch: feat/daemon-monitor-daemon-halts-through-a-guided-resolution-q
Head SHA: a110c3a6977331e6c2a0efd0db7d2294223ed3fa
Halted at: 2026-09-28T23:28:16.988Z

Push status: this record may be ahead of the remote; push is not guaranteed.

## HALT

```text
coverage_binding refused: cited Done when checks do not assert the required claim.

Criterion: Story 1 happy: Given the monitor is running, when the operator ends it with an interrupt, then it stops and reports that it stopped.
Task ids: 17
Done when checks: Starting with no halted features reports an empty queue, stays alive, and creates zero sessions across several passes. | An interrupt during an open guided session exits without writing a deferral or a resolution for that item. | A feature that halts after an empty pass is reported on the next pass without a restart. | The stop condition is injectable, so the loop is tested without sending a real signal.
Missing assertion: The cited checks do not require reporting that the monitor stopped after an interrupt.

Criterion: Story 1 negative: Given the operator ended the monitor while an item was open, when the monitor is started again and that feature is still halted, then the item is offered again.
Task ids: 17
Done when checks: Starting with no halted features reports an empty queue, stays alive, and creates zero sessions across several passes. | An interrupt during an open guided session exits without writing a deferral or a resolution for that item. | A feature that halts after an empty pass is reported on the next pass without a restart. | The stop condition is injectable, so the loop is tested without sending a real signal.
Missing assertion: The cited checks do not require that an interrupted, still-halted item is offered again after the monitor restarts.

Criterion: Story 1 negative: Given the monitor is invoked in an environment carrying the engine's daemon-session marker, when it starts, then it is refused by the existing entry guard and no queue is built.
Task ids: 20
Done when checks: The detector recognizes the verb with all-projects and single-project selectors, and returns help rather than null for a malformed-but-recognized invocation. | The verb is registered before the daemon block, as asserted by a dispatch-order test that fails if a bare token reaches the daemon launcher. | A test asserts the monitor verb is not in the session-sanctioned subcommand set and is refused under the daemon-session marker. | The legacy CLI shim is unmodified, as asserted by a diff check over that path.
Missing assertion: The cited checks require refusal under the daemon-session marker, but do not require that no queue is built.

Criterion: Story 2 negative: Given one registered project's path no longer exists on disk, when the monitor runs across all projects, then that project is reported as unreadable and halts from the remaining projects are still queued.
Task ids: 3
Done when checks: A three-project fixture produces one merged list containing halts from every selected project, each entry labelled with its project. | Naming a single project restricts enumeration to that project's halts only. | A project whose path is absent, or whose directory is unreadable, is reported and does not prevent the remaining projects from enumerating. | An unknown project name exits non-zero with the name reported and nothing enumerated. | An absent registry reports that no projects are registered and exits zero; a malformed registry exits non-zero.
Missing assertion: The cited check requires reporting an absent path, but does not require that it be reported specifically as unreadable.

Criterion: Story 2 negative: Given the registry file contains malformed content, when the monitor runs, then it reports the registry as unreadable and exits non-zero rather than silently monitoring nothing.
Task ids: 3
Done when checks: A three-project fixture produces one merged list containing halts from every selected project, each entry labelled with its project. | Naming a single project restricts enumeration to that project's halts only. | A project whose path is absent, or whose directory is unreadable, is reported and does not prevent the remaining projects from enumerating. | An unknown project name exits non-zero with the name reported and nothing enumerated. | An absent registry reports that no projects are registered and exits zero; a malformed registry exits non-zero.
Missing assertion: The cited check requires non-zero exit for a malformed registry, but does not require reporting the registry as unreadable.

Criterion: Story 3 happy: Given two features halted before the monitor was started, when the monitor starts, then both appear in the queue on its first pass.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not require the monitor's first pass to place both pre-existing halts in its queue.

Criterion: Story 3 happy: Given a feature halted before the monitor was started, when the monitor starts, then it offers that halt before waiting for any new halt to occur.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not require the monitor to offer a pre-existing halt before waiting for a new one.

Criterion: Story 3 negative: Given a feature halted and was then resolved before the monitor was started, when the monitor starts, then that feature does not appear in the queue.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not explicitly require a halt resolved before startup to be absent from the monitor queue.

Criterion: Story 3 negative: Given a project contains no worktrees at all, when the monitor starts, then that project contributes no entries and produces no error.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not explicitly require an empty worktrees directory to produce no entries and no error.

Criterion: Story 4 negative: Given a halt marker is written while a pass is midway through enumerating projects, when that pass completes, then the queue is internally consistent and the halt is picked up by that pass or the next one, never producing a duplicate entry across the two.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: A halt written during enumeration is consistently picked up by that or the next pass without duplication across the two passes.

Criterion: Story 5 happy: Given a queue of three halts, when the monitor works through them, then exactly one guided session exists at any moment.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: Processing a queue of multiple halts permits exactly one guided session at any moment.

Criterion: Story 5 negative: Given two monitors are run over the same project by the same operator, when both compute membership, then each offers the halt independently and neither corrupts the other's state, the redundant offer being accepted as a duplicate prompt rather than a data fault.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: Two monitors independently offer the same halt without corrupting each other's state, treating a redundant offer as a duplicate prompt.

Criterion: Story 6 happy: Given a queued halt is resolved during its guided session, when membership is next recomputed, then that feature is no longer in the queue.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: A halt resolved during its guided session is absent from the queue on the next membership recomputation.

Criterion: Story 6 negative: Given a feature's halt marker is removed while its guided session is still open, when the session ends and membership is recomputed, then the feature is absent from the queue and is not reported as unresolved.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: No check requires removal during an open guided session, recomputation when it ends, or that the feature is not reported unresolved.

Criterion: Story 6 negative: Given a feature's halt marker is removed and a new halt marker is written for the same feature before the next pass, when that pass runs, then the feature is offered as current halted work.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: No check requires a cleared halt followed by a new halt for the same feature to be offered on the next pass.

Criterion: Story 6 negative: Given a halt marker is present alongside the completion marker that existing state scanning treats as reclaimable, when membership is computed, then that feature is not offered as halted.
Task ids: 6
Done when checks: A halt created after startup appears in a subsequent pass's queue with no restart. | A halt created and cleared between passes never reaches the operator. | A duplicate enumeration of one feature collapses to exactly one queue entry. | While a session is open for an item, no second entry for that item is produced by any subsequent pass. | No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk.
Missing assertion: No check requires a halt co-present with a reclaimable completion marker to be excluded.

Criterion: Story 7 negative: Given a park marker is added while that feature's guided session is open, when the session ends, then the feature is absent from the recomputed queue.
Task ids: 2
Done when checks: A halted, operator-parked feature produces no queue entry, as asserted by the park fixture test. | Unparking a still-halted feature causes it to be included on the next enumeration. | A halt marker co-present with the completion marker produces no queue entry. | A park-marker read error results in the feature being withheld, never included, proving the check confirms absence to proceed.
Missing assertion: No check requires a park marker added while a guided session is open to be reflected when that session ends.

Criterion: Story 8 happy: Given a queued halt, when the queue is displayed, then the item states its project, its feature, the stated halt reason, and the halt classification.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not require the displayed item to state its project.

Criterion: Story 8 happy: Given a halt whose stated reason spans several lines, when the item is displayed, then the operator-facing reason is presented without the display becoming unreadable.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not require multiline reasons to be presented readably.

Criterion: Story 8 negative: Given a halt whose classification sidecar is missing, when the item is displayed, then the classification is reported as undetermined and the item is still offered.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The cited check requires the classification to be unclassified, not reported as undetermined.

Criterion: Story 8 negative: Given a halt whose marker cannot be read at display time, when the item is displayed, then the read failure is reported against that item and the remaining items still display.
Task ids: 1
Done when checks: The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. | A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. | A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. | A halt marker whose worktree directory is absent yields no entry and throws nothing. | Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.
Missing assertion: The checks do not require handling an unreadable marker per item while continuing to display remaining items.

Criterion: Story 9 negative: Given a halted feature whose linked issue does not exist, when the queue is ordered, then that item is still queued and its band is reported as unresolved rather than the pass failing.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub.
Missing assertion: A missing linked issue remains queued and is reported with an unresolved band.

Criterion: Story 9 negative: Given a halted feature with no linked issue reference at all, when the queue is ordered, then it is placed according to the existing band ranking for unlinked work and is still offered.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub.
Missing assertion: An unlinked halt is offered according to the existing band ranking for unlinked work.

Criterion: Story 9 negative: Given the priority lookup fails for one reference while succeeding for others, when the queue is ordered, then every halt is still queued and the failure is reported once rather than per item.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub.
Missing assertion: A failed priority lookup leaves every halt queued and reports the failure once per reference.

Criterion: Story 10 happy: Given a queue is displayed, when the operator reads it, then each item shows the band attributed to it and the ordering basis applied to the queue.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub.
Missing assertion: The displayed queue shows each item's attributed band and the ordering basis.

Criterion: Story 10 negative: Given the queue is recomputed after an unrelated feature halts, when the ordering is applied, then previously-ordered equal-band items retain their relative order with the new item placed by its own band.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub.
Missing assertion: No cited check requires recomputation after adding an unrelated halt to preserve the previous relative order of equal-band items.

Criterion: Story 10 negative: Given priority is unresolved for every item, when the queue is displayed, then the ordering basis is reported as the fallback rather than implying a priority order that was never resolved.
Task ids: 7
Done when checks: A fixture of mixed-priority unseen halts orders highest band first. | A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority. | Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. | Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. | Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub.
Missing assertion: No cited check requires the displayed ordering basis to be reported as fallback when all priorities are unresolved.

Criterion: Story 11 negative: Given priority resolution fails, when the queue is built, then the monitor does not block waiting on the lookup and the pass completes.
Task ids: 8
Done when checks: A forced priority outage yields a queue containing every halted feature, ordered by the stable fallback, never an empty queue. | The degradation notice is emitted once per outage, not once per item and not once per pass. | Recovery from the outage restores band ordering on a subsequent pass with no restart. | A halt whose linked issue does not exist is still queued with its band reported as unresolved. | A halt with no linked reference at all is still queued, placed by the existing band ranking for unlinked work.
Missing assertion: No cited check explicitly requires that priority lookup be non-blocking or that the monitor pass completes without waiting.

Criterion: Story 12 happy: Given a queue whose head item is a halt, when the monitor reaches that item, then it opens a session in the operator's configured provider without the operator starting it.
Task ids: 9
Done when checks: Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn. | The seam resolves with the child's exit code and rejects on spawn error so the caller can report and continue. | A missing provider binary reports the failure and resolves without throwing. | An unregistered configured provider name is reported and no process is spawned. | The seam supplies no stream consumer and constructs no resume invocation, as asserted against the mocked boundary's received arguments.
Missing assertion: The monitor opens a session when it reaches the queue head without operator initiation.

Criterion: Story 12 happy: Given a session is opened for a halt, when it begins, then it has been given that halt's project, feature, stated reason, and classification as explicit input rather than starting from a blank prompt.
Task ids: 9
Done when checks: Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn. | The seam resolves with the child's exit code and rejects on spawn error so the caller can report and continue. | A missing provider binary reports the failure and resolves without throwing. | An unregistered configured provider name is reported and no process is spawned. | The seam supplies no stream consumer and constructs no resume invocation, as asserted against the mocked boundary's received arguments.
Missing assertion: The launched session receives the halt project, feature, reason, and classification as explicit input.

Criterion: Story 12 happy: Given the operator's configured provider is the non-default one, when a session is opened, then it is opened in that configured provider.
Task ids: 9
Done when checks: Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn. | The seam resolves with the child's exit code and rejects on spawn error so the caller can report and continue. | A missing provider binary reports the failure and resolves without throwing. | An unregistered configured provider name is reported and no process is spawned. | The seam supplies no stream consumer and constructs no resume invocation, as asserted against the mocked boundary's received arguments.
Missing assertion: The configured non-default provider is selected when opening the session.

Criterion: Story 12 negative: Given the configured provider's binary is not on the path, when the monitor tries to open a session, then the failure is reported against that item, the item remains in the queue, and the monitor stays active.
Task ids: 9
Done when checks: Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn. | The seam resolves with the child's exit code and rejects on spawn error so the caller can report and continue. | A missing provider binary reports the failure and resolves without throwing. | An unregistered configured provider name is reported and no process is spawned. | The seam supplies no stream consumer and constructs no resume invocation, as asserted against the mocked boundary's received arguments.
Missing assertion: A missing binary leaves the item queued and keeps the monitor active.

Criterion: Story 12 negative: Given the configured provider fails to start, when the monitor tries to open a session, then no deferral is written for that item and it is not marked resolved.
Task ids: 9
Done when checks: Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn. | The seam resolves with the child's exit code and rejects on spawn error so the caller can report and continue. | A missing provider binary reports the failure and resolves without throwing. | An unregistered configured provider name is reported and no process is spawned. | The seam supplies no stream consumer and constructs no resume invocation, as asserted against the mocked boundary's received arguments.
Missing assertion: A provider start failure writes no deferral and does not mark the item resolved.

Criterion: Story 13 happy: Given a halt is presented, when the session begins, then its evidence gathering happens without changing the state of the halted feature.
Task ids: 12
Done when checks: Each recognized classification presents its corresponding recovery procedure, as asserted by one case per member of the existing disposition union. | An unrecognized or absent classification presents the halt with its classification stated as undetermined and never removes it from the queue. | Classification handling is exhaustive with no catch-all default, pinned by a test that fails to compile or fails at runtime if a union member is unhandled.
Missing assertion: Evidence gathering leaves the halted feature's state unchanged.

Criterion: Story 14 happy: Given a guided session opened by the monitor, when it attempts a conductor operation needed for recovery, then that operation is permitted rather than refused by the entry guard.
Task ids: 13
Done when checks: A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. | A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs. | The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. | No configuration key is introduced that relaxes the daemon-session entry guard.
Missing assertion: A guided session's required conductor operation is permitted rather than refused by the entry guard.

Criterion: Story 14 happy: Given a guided session proposes a state-changing recovery action, when it is about to act, then it presents the action and its blast radius and waits for approval before acting.
Task ids: 13
Done when checks: A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. | A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs. | The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. | No configuration key is introduced that relaxes the daemon-session entry guard.
Missing assertion: Approval, blast-radius presentation, and waiting before a state-changing recovery action are not required.

Criterion: Story 14 happy: Given the operator approves one recovery action, when a further state-changing action follows, then approval is requested again for that action.
Task ids: 13
Done when checks: A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. | A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs. | The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. | No configuration key is introduced that relaxes the daemon-session entry guard.
Missing assertion: Per-action approval, including renewed approval for subsequent state-changing actions, is not required.

Criterion: Story 14 happy: Given a guided session is diagnosing, when it gathers evidence, then it does so without requesting approval, diagnosis being read-only.
Task ids: 13
Done when checks: A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. | A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs. | The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. | No configuration key is introduced that relaxes the daemon-session entry guard.
Missing assertion: Read-only diagnosis and its lack of approval requests are not required.

Criterion: Story 14 negative: Given a guided session, when the operator declines a proposed recovery action, then the action is not performed and the halt remains.
Task ids: 13
Done when checks: A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. | A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs. | The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. | No configuration key is introduced that relaxes the daemon-session entry guard.
Missing assertion: Declining a recovery action, preventing that action, and preserving the halt are not required.

Criterion: Story 14 negative: Given a guided session runs, when it writes provider configuration or acquires permissions, then those writes land inside the feature worktree and not in the main checkout.
Task ids: 13
Done when checks: A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. | A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs. | The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. | No configuration key is introduced that relaxes the daemon-session entry guard.
Missing assertion: Provider-configuration and permission writes being confined to the feature worktree and excluded from the main checkout are not required.

Criterion: Story 15 happy: Given the last item's session ends and no halts remain, when the monitor continues, then it reports an empty queue and stays active.
Task ids: 14
Done when checks: Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue. | A three-item queue is worked to completion without the monitor being restarted. | Membership is recomputed after each session ends, so a halt resolved inside the session is absent from the next offer. | A session that changed nothing leaves its halt in the recomputed queue.
Missing assertion: No cited check requires reporting an empty queue while remaining active after the final item is resolved.

Criterion: Story 15 negative: Given a guided session exits with a non-zero status, when the monitor continues, then it still returns to the queue and offers the next item.
Task ids: 14
Done when checks: Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue. | A three-item queue is worked to completion without the monitor being restarted. | Membership is recomputed after each session ends, so a halt resolved inside the session is absent from the next offer. | A session that changed nothing leaves its halt in the recomputed queue.
Missing assertion: The cited checks require returning to the queue after a non-zero exit, but do not explicitly require offering the next item.

Criterion: Story 16 happy: Given an item was skipped, when the pass continues, then the skipped item is not offered ahead of items the operator has not yet seen, regardless of its priority band.
Task ids: 15
Done when checks: Skipping ends the current session and advances to the next item. | A skipped item's halt marker is byte-identical before and after the skip, and the item is never marked resolved. | A skipped item is not re-offered ahead of unseen work, and is offered again once unseen work is exhausted. | A skip survives a monitor restart and the item is still not re-offered ahead of unseen work.
Missing assertion: The cited checks require skipped items not be re-offered ahead of unseen work, but do not explicitly require that result regardless of priority band.

Criterion: Story 16 happy: Given every item in the queue has been skipped, when a later pass runs, then the skipped items are offered again, ordered among themselves by priority band.
Task ids: 15
Done when checks: Skipping ends the current session and advances to the next item. | A skipped item's halt marker is byte-identical before and after the skip, and the item is never marked resolved. | A skipped item is not re-offered ahead of unseen work, and is offered again once unseen work is exhausted. | A skip survives a monitor restart and the item is still not re-offered ahead of unseen work.
Missing assertion: Skipped items are ordered among themselves by priority band.

Criterion: Story 18 happy: Given a deferred halt is resolved and the same feature halts again, when the queue is built, then the new halt is offered despite the earlier deferral.
Task ids: 4
Done when checks: The deferral key is a structured type carrying project, feature, and halt identity as separate fields, as asserted by a round-trip test that reads the fields back individually. | A deferral written from inside a feature worktree resolves to the main checkout's daemon state directory, as asserted by a worktree-rooted write test. | The record is written by atomic temp-then-rename, leaving no partial file visible under a simulated crash between write and rename. | Every deferral path and helper lives in the one deferral module; a static check asserts no other module spells the path.
Missing assertion: The cited checks do not require that resolving a deferred halt and later halting the same feature with a new halt causes the new halt to be offered.

Criterion: Story 19 negative: Given the reconciliation exits non-zero, when the cycle continues, then the failure is reported and the operator's queue continues to be offered.
Task ids: 19
Done when checks: A monitoring cycle invokes the existing reconciliation with its behavior unchanged, as asserted against an injected reconciliation stub. | A non-zero exit, a network failure, and a thrown error each leave the monitor active and the queue offered. | Queue work is not blocked on reconciliation completion, as asserted by a slow-reconciliation fixture.
Missing assertion: The cited checks require a non-zero exit to leave the monitor active and the queue offered, but do not require that the failure is reported.

Criterion: Story 19 negative: Given the reconciliation cannot reach the network, when the cycle continues, then the failure is reported once and the queue is unaffected.
Task ids: 19
Done when checks: A monitoring cycle invokes the existing reconciliation with its behavior unchanged, as asserted against an injected reconciliation stub. | A non-zero exit, a network failure, and a thrown error each leave the monitor active and the queue offered. | Queue work is not blocked on reconciliation completion, as asserted by a slow-reconciliation fixture.
Missing assertion: The cited checks require a network failure to leave the monitor active and the queue offered, but do not require that the failure is reported once.
```
