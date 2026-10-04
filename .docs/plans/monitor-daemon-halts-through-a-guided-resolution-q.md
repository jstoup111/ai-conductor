# Implementation Plan: Monitor daemon HALTs through a guided resolution queue

**Date:** 2026-09-20
**Design:** .docs/specs/monitor-daemon-halts-through-a-guided-resolution-q.md
**Stories:** .docs/stories/monitor-daemon-halts-through-a-guided-resolution-q.md
**Conflict check:** Clean as of 2026-09-20
**Source:** jstoup111/ai-conductor#1228

## Summary

Adds one foreground operator verb and one provider-agnostic interactive launch seam, in 21 tasks. The queue holds no durable membership: it is re-derived from halt markers on every pass, so only the operator's deferral decisions persist. No new service, no supervised process, no schema, and no change to how halts are produced, classified, or recorded.

## Technical Approach

- **Membership is derived, never stored (adr-2026-09-20-halt-resolution-queue-derived-from-markers D1).** Tasks 1-3 build a read-only inventory over halt markers per project and across the registry; task 6 derives the queue fresh each pass. Nothing persists what is in the queue, so a monitor that dies leaves nothing stale behind.
- **Only deferrals persist (D3, D4).** Tasks 4-5 own the deferral record: one module, the main-root seam for its location, a structured key carrying halt identity, atomic replace, and a fail direction that always favours offering work over suppressing it.
- **Deferral partitions ahead of priority (D5, as amended).** Task 7 orders unseen work before deferred work and applies the existing band ranking within each partition; task 8 degrades to the stable fallback on a priority outage without ever emptying the queue. The existing resolver and its cache are reused; no second fetch path is introduced.
- **The session retains authority because it is not engine-dispatched (adr-2026-09-20-operator-launched-sessions-retain-conductor-authority D1, D3).** Task 9 generalises the existing attached-session launcher to the configured provider; task 10 confines that seam to a foreground operator command with a terminal attached, which is what keeps the boundary rule honest and is review condition C1; task 13 runs the session inside the halted feature's worktree so provider-state writes cannot trip the self-host live boundary.
- **Exit is never resolution (D6).** Task 16 re-derives resolution from the halt marker alone, so a session that exits zero without fixing anything leaves its halt queued.
- **Transitions ride the existing spine (D6).** Task 18 adds union members with exhaustive sink declarations rather than a bespoke ledger.
- **Sequencing.** Inventory (1-3) and the launch seam (9-10) are independent and fan out first; the queue (6-8) depends on the inventory and the deferral record (4-5); the session (11-13) depends on the seam; the loop (14-17) joins them; events (18), reconciliation (19), dispatch wiring (20) and docs (21) close.

## Prerequisites

- Built engine in the worktree (`cd src/conductor && npm run build`) so `ai-conductor` resolves in tests that shell out.

## Tasks

### Task 1: Enumerate halted features with their halt class, per project
**Story:** 3
**Story:** 8
**Type:** infrastructure

**Steps:**
1. Write failing test: a fixture project with two halted worktrees yields two entries, each carrying slug, first-line reason, and halt class read from the `.pipeline/HALT.class` sidecar.
2. Verify RED.
3. Implement a read-only enumerator over one project's worktrees that reuses the existing state scan for halted bucketing and attaches the class via the halt-marker module's tolerant class reader. Re-spell no marker path (adr-2026-07-04-operator-park-marker D6); rediscover via symbols `scanInheritedState`, `readHaltClass`, `HALT_MARKER`.
4. Verify GREEN. Commit: "monitor: enumerate halted features with their halt class"

**Done when:**
- The enumerator returns one entry per halted worktree carrying slug, reason, and halt class, as asserted by the two-halt fixture test. The first enumeration after startup returns both halts that existed before startup, so the first pass queues and offers them before any wait for a new halt; every entry also carries its project, and a feature whose halt was resolved before startup yields no entry.
- A halt whose class sidecar is missing yields the existing `unclassified` disposition rather than an invented label or an empty string. The displayed classification for such an entry reads as undetermined and the entry is still returned and offered.
- A halt whose marker body is empty yields a reason reported as unstated and the entry is still returned. A reason spanning several lines is reported as its first line in readable single-line form rather than as raw multiline text.
- A halt marker whose worktree directory is absent yields no entry and throws nothing. A project with no worktrees at all yields no entries and no error; and a halt marker that cannot be read yields an entry reporting the read failure against that item while every other entry is still returned.
- Enumeration performs no write: a fixture checksum of the project tree is unchanged after a pass.

**Files likely touched:**
- `src/conductor/src/engine/monitor/halt-inventory.ts`
- `src/conductor/test/engine/monitor/halt-inventory.test.ts`

**Dependencies:** none

### Task 2: Exclude parked and completion-reclaimable features from membership
**Story:** 7
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing tests: a halted feature carrying an operator park marker yields no entry; a halt marker co-present with the completion marker yields no entry; a park-marker read error yields no entry.
2. Verify RED.
3. Implement the exclusion filter using the existing park-marker module's predicate, confirming ABSENCE of a park to include (adr-2026-07-04-operator-park-marker D4). Treat a non-ENOENT park read error as present-and-excluded. Rediscover via symbols `isOperatorParked`, `readParkProvenance`.
4. Verify GREEN. Commit: "monitor: exclude parked and reclaimable features from the queue"

**Done when:**
- A halted, operator-parked feature produces no queue entry, as asserted by the park fixture test.
- Unparking a still-halted feature causes it to be included on the next enumeration.
- A halt marker co-present with the completion marker produces no queue entry.
- A park-marker read error results in the feature being withheld, never included, proving the check confirms absence to proceed.
- A park marker added while that feature's guided session is open excludes the feature from the enumeration taken after the session ends.

**Files likely touched:**
- `src/conductor/src/engine/monitor/halt-inventory.ts`
- `src/conductor/test/engine/monitor/halt-inventory.test.ts`

**Dependencies:** 1

### Task 3: Enumerate across registered projects with a per-project error boundary
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests: three registered projects with halts in two yield a merged list labelled by project; naming one project restricts to it; a project whose path is absent is reported and the others still enumerate; an absent registry reports no projects and exits zero; a malformed registry exits non-zero.
2. Verify RED.
3. Implement selection over the existing registry reader with a per-repo try/catch boundary in the shape the existing fleet helper uses, never aborting the sweep on one repo. Rediscover via symbols `createRegistryReader`, `readRegistry`, `runFleetAction`.
4. Verify GREEN. Commit: "monitor: enumerate halts across selected registered projects"

**Done when:**
- A three-project fixture produces one merged list containing halts from every selected project, each entry labelled with its project.
- Naming a single project restricts enumeration to that project's halts only.
- A project whose path is absent, or whose directory is unreadable, is reported and does not prevent the remaining projects from enumerating. An absent project path is reported as unreadable by name while halts from the remaining projects are still queued.
- An unknown project name exits non-zero with the name reported and nothing enumerated.
- An absent registry reports that no projects are registered and exits zero; a malformed registry exits non-zero. The malformed registry is reported as unreadable rather than silently monitoring nothing.

**Files likely touched:**
- `src/conductor/src/engine/monitor/halt-inventory.ts`
- `src/conductor/test/engine/monitor/halt-inventory.test.ts`

**Dependencies:** 1

### Task 4: Add the deferral record with a structured halt-identity key
**Story:** 18
**Type:** infrastructure

**Steps:**
1. Write failing tests: a recorded deferral round-trips carrying project, feature, and halt identity as separate fields; the record resolves under the main checkout's daemon state directory when written from inside a worktree.
2. Verify RED.
3. Implement a single module owning the deferral path constant and its read/write/clear helpers, resolving the root through the existing main-root seam (adr-2026-07-10-park-marker-main-root-resolution) and writing by atomic temp-then-rename. Key is a named type carrying project, feature, and the marker-identity shape; never a concatenated string. Rediscover via symbols `resolveMainRepoRoot`, `snapshotHaltMarker`, `DAEMON_DIR`.
4. Verify GREEN. Commit: "monitor: add the deferral record keyed by halt identity"

**Done when:**
- The deferral key is a structured type carrying project, feature, and halt identity as separate fields, as asserted by a round-trip test that reads the fields back individually.
- A deferral written from inside a feature worktree resolves to the main checkout's daemon state directory, as asserted by a worktree-rooted write test.
- The record is written by atomic temp-then-rename, leaving no partial file visible under a simulated crash between write and rename.
- Every deferral path and helper lives in the one deferral module; a static check asserts no other module spells the path.
- A deferral key recorded for a halt that was then resolved compares unequal to the key of a new halt for the same feature, so the new halt is offered despite the earlier deferral.

**Files likely touched:**
- `src/conductor/src/engine/monitor/deferrals.ts`
- `src/conductor/test/engine/monitor/deferrals.test.ts`

**Dependencies:** none

### Task 5: Make the deferral record fail toward offering work
**Story:** 18
**Type:** negative-path

**Steps:**
1. Write failing tests: a stored deferral whose halt identity differs from the current marker does not suppress the item; an unestablishable halt identity does not suppress; an unparseable record is preserved by copy and yields no deferrals; an absent record yields no deferrals without error; an unwritable directory reports and keeps the monitor alive.
2. Verify RED.
3. Implement identity comparison and the fail-open paths. Absent is not unparseable (adr-2026-08-12-fail-closed-intake-ledger-durability): an absent record means no deferrals; an unparseable record is preserved BY COPY, never by rename, and the monitor continues with no deferrals in effect.
4. Verify GREEN. Commit: "monitor: deferrals fail toward offering rather than suppressing"

**Done when:**
- A deferral whose stored halt identity does not match the feature's current halt does not suppress the item, as asserted by the changed-identity test.
- An unestablishable halt identity results in the item being offered, proving the fail direction is toward offering.
- An unparseable deferral record is preserved by copy rather than rename, and the pass continues with every halt offered.
- An absent deferral record yields no deferrals and no error, distinct from the unparseable case.
- An unwritable deferral directory reports the failure, leaves the item in the queue, and keeps the monitor alive.

**Files likely touched:**
- `src/conductor/src/engine/monitor/deferrals.ts`
- `src/conductor/test/engine/monitor/deferrals.test.ts`

**Dependencies:** 4

### Task 6: Derive queue membership, deduplicated, on every pass
**Story:** 5
**Story:** 4
**Story:** 6
**Type:** feature

**Steps:**
1. Write failing tests: a halt appearing after startup is in a later pass's queue; a halt resolved between passes is absent; one feature enumerated twice collapses to one entry; a halt open in a session is not offered again while open.
2. Verify RED.
3. Implement derivation that recomputes membership from the inventory on every pass, holding no durable membership state (adr-2026-09-20-halt-resolution-queue-derived-from-markers D1). Deduplicate by project and feature within a pass; suppress the currently-open item.
4. Verify GREEN. Commit: "monitor: derive queue membership fresh on every pass"

**Done when:**
- A halt created after startup appears in a subsequent pass's queue with no restart. A halt marker written while a pass is midway through enumerating is picked up by that pass or the next one, each pass's queue is internally consistent, and no duplicate entry for it arises across the two passes.
- A halt created and cleared between passes never reaches the operator. A halt resolved during its guided session is absent from the queue on the next recomputation, and a halt marker removed while its session is open leaves the feature absent from the queue recomputed when the session ends and never reported as unresolved; a halt cleared and then re-written for the same feature before the next pass is offered on that pass as current halted work.
- A duplicate enumeration of one feature collapses to exactly one queue entry. A halt marker co-present with the reclaimable completion marker is not offered as halted.
- While a session is open for an item, no second entry for that item is produced by any subsequent pass. While a queue of three halts is worked, exactly one item is open, and so exactly one guided session exists, at any moment.
- No module persists queue membership: a static check asserts the queue type is constructed per pass and never read from disk. Two monitors over the same project each derive membership independently and each offer the halt, neither writing state the other reads, so the redundant offer is a duplicate prompt and never a data fault.
- While a two-item queue is being worked, a third feature that halts is included in the ordering by the next membership recomputation, which then orders all three items.
- After a halt is resolved, the displayed queue omits the resolved feature entirely: no entry for it is rendered, and no entry is ever shown with a resolved status.

**Files likely touched:**
- `src/conductor/src/engine/monitor/queue.ts`
- `src/conductor/test/engine/monitor/queue.test.ts`

**Dependencies:** 2, 3, 5

### Task 7: Order by deferral partition first, then priority band, stably
**Story:** 9
**Story:** 10
**Story:** 16
**Type:** feature

**Steps:**
1. Write failing tests: unseen halts order by descending band; a deferred critical halt is offered after an unseen low-priority halt; deferred items order by band among themselves; identical contents order identically twice; removing one equal-band item leaves the rest's relative order unchanged.
2. Verify RED.
3. Implement ordering that partitions unseen before deferred, then applies the existing band ranking within each partition with a stable tie-break preserving enumeration order. Reuse the existing priority resolver and its in-process cache; do not introduce a second fetch path. Inherit the existing band rank verbatim, including that unlinked sorts first and unlabeled last. Rediscover via symbols `orderBacklog`, `createPriorityResolver`, `PRIORITY_BAND_RANK`.
4. Verify GREEN. Commit: "monitor: order the queue by deferral partition then priority band"

**Done when:**
- A fixture of mixed-priority unseen halts orders highest band first.
- A fixture pairing a deferred critical halt with an unseen low-priority halt offers the unseen one first, proving deferral partitions ahead of priority.
- Deferred halts of differing bands order by descending band among themselves once unseen work is exhausted. Skipped items are offered after all unseen work regardless of their band, and among themselves are ordered by descending band.
- Ordering identical queue contents twice yields byte-identical sequences for both equal-band and no-priority fixtures, and removing one item from an equal-band group leaves the remaining items' relative order unchanged. Recomputing after an unrelated feature halts keeps the previously-ordered equal-band items in their prior relative order and places the new item by its own band.
- Deferring one of two equal-band halts and recomputing the queue leaves the remaining items in their previous relative order, as asserted by the equal-band deferral fixture.
- Priority is resolved through the existing resolver, and a reference repeated within one pass causes exactly one lookup, as asserted against a counting stub. A lookup failure for one reference while others succeed leaves every halt queued and reports the failure once rather than per item; a halt whose linked issue does not exist stays queued with its band reported as unlabeled (the existing resolver attribution for a not-found issue) and the pass does not fail; a halt with no linked reference is placed by the existing band ranking for unlinked work and still offered; and the ordered queue reports each item's attributed band and the ordering basis applied, reporting the basis as the fallback when every item's priority is unresolved.

**Files likely touched:**
- `src/conductor/src/engine/monitor/ordering.ts`
- `src/conductor/test/engine/monitor/ordering.test.ts`

**Dependencies:** 6

### Task 8: Degrade ordering on a priority outage without emptying the queue
**Story:** 11
**Type:** negative-path

**Steps:**
1. Write failing tests: a forced outage yields a full queue in stable fallback order; the degradation notice appears once per outage rather than per item or per pass; recovery restores band ordering with no restart; a halt whose linked issue is missing is still queued with its band unlabeled.
2. Verify RED.
3. Implement degradation by consuming the existing resolver's fallback mode, which returns input order unchanged (adr-2026-07-03-priority-fetch-fail-soft). Never block a pass on the lookup and never drop an item whose band is unresolved.
4. Verify GREEN. Commit: "monitor: degrade ordering on priority outage without dropping work"

**Done when:**
- A forced priority outage yields a queue containing every halted feature, ordered by the stable fallback, never an empty queue. A priority lookup that never answers does not block the pass, which completes with the queue built from the fallback.
- The degradation notice is emitted once per outage, not once per item and not once per pass.
- Recovery from the outage restores band ordering on a subsequent pass with no restart.
- A halt whose linked issue does not exist is still queued with its band reported as unlabeled.
- A halt with no linked reference at all is still queued, placed by the existing band ranking for unlinked work.

**Files likely touched:**
- `src/conductor/src/engine/monitor/ordering.ts`
- `src/conductor/test/engine/monitor/ordering.test.ts`

**Dependencies:** 7

### Task 9: Add the provider-agnostic interactive launch seam
**Story:** 12
**Type:** infrastructure

**Steps:**
1. Write failing tests against a mocked process boundary: the seam launches the configured provider and resolves on its exit code; both supported providers are launched in their own interactive invocation form; an unknown configured provider is reported and nothing is spawned; a missing provider binary reports and resolves without throwing.
2. Verify RED.
3. Implement one seam that generalises the existing attached-session launcher so the configured provider is honoured rather than one provider hardcoded, inheriting stdio and awaiting exit. It supplies NO stream consumer (adr-2026-08-25 D4) and mints no resumable session (adr-2026-07-27-cold-start-within-step-retries). Per this repo's test-process-isolation rule, mock the process boundary and assert the production adapter reaches the mock before any real spawn. Rediscover via symbols `launchClaudeEngineer`, `engineerLaunchArgs`, `resolveProviderCandidates`.
4. Verify GREEN. Commit: "monitor: add the provider-agnostic interactive launch seam"

**Done when:**
- Both supported providers are exercised through the launch seam via a mocked process boundary, with the production adapter proven to reach the mock before any real spawn. Configuring the non-default provider spawns that provider, not the default, as asserted against the mocked boundary; and invoking the seam for the queue-head item opens the session with no operator step to start it.
- The seam resolves with the child's exit code and rejects on spawn error so the caller can report and continue. The caller-supplied halt project, feature, stated reason, and classification reach the child as explicit opening input rather than a blank prompt, as asserted against the mocked boundary's received arguments.
- A missing provider binary reports the failure and resolves without throwing. For a missing binary, the failure is reported against that item, the seam writes no deferral and no resolution, so the item stays queued, and the calling monitor stays active; a provider that fails to start likewise leaves no deferral written and the item not marked resolved.
- An unregistered configured provider name is reported and no process is spawned.
- The seam supplies no stream consumer and constructs no resume invocation, as asserted against the mocked boundary's received arguments.

**Files likely touched:**
- `src/conductor/src/execution/interactive-launch.ts`
- `src/conductor/test/execution/interactive-launch.test.ts`

**Dependencies:** none

### Task 10: Confine the launch seam to a foreground operator command
**Story:** 14
**Type:** negative-path

**Steps:**
1. Write failing tests: the seam refuses when no interactive terminal is attached; a static reachability check fails if the seam is imported by the daemon, a step runner, or any dispatched path.
2. Verify RED.
3. Implement the terminal-attached precondition at the seam itself, and add a static import-scan test pinning the seam's permitted importers, in the shape of the existing zero-token import guard. This is the invariant that keeps adr-2026-09-20-operator-launched-sessions-retain-conductor-authority D1 honest and is review condition C1.
4. Verify GREEN. Commit: "monitor: confine the unmarked launch seam to foreground operator use"

**Done when:**
- Launching with no attached interactive terminal is refused and reports why, spawning nothing.
- A static reachability test fails if the launch seam becomes importable from the daemon, from a step runner, or from any dispatched execution path.
- The test names the seam's permitted importers explicitly, so adding a new importer is a deliberate, reviewed edit rather than a silent widening.

**Files likely touched:**
- `src/conductor/src/execution/interactive-launch.ts`
- `src/conductor/test/execution/interactive-launch-reachability.test.ts`

**Dependencies:** 9

### Task 11: Render the halt's context into the session's opening input
**Story:** 12
**Type:** feature

**Steps:**
1. Write failing test: the input handed to the mocked launch boundary contains the halt's project, feature, stated reason, and classification, and requests the existing operator triage procedure for that feature.
2. Verify RED.
3. Implement context rendering as an explicit input to the cold-start session, never a resumed one. The session body is the existing operator triage procedure invoked as-is; the monitor supplies identity and evidence, not a second diagnostic implementation.
4. Verify GREEN. Commit: "monitor: render halt context into the guided session's opening input"

**Done when:**
- The session's opening input contains the halt's project, feature, reason, and classification, as asserted against a mocked launch boundary.
- The opening input invokes the existing operator triage procedure for that feature rather than restating a diagnostic procedure of its own.
- Each session is minted fresh; no code path passes a prior session identifier to the seam.

**Files likely touched:**
- `src/conductor/src/engine/monitor/session.ts`
- `src/conductor/test/engine/monitor/session.test.ts`

**Dependencies:** 9

### Task 12: Present the recovery procedure for the halt's classification, exhaustively
**Story:** 13
**Type:** feature

**Steps:**
1. Write failing tests: each recognized classification resolves to its recovery procedure; an unrecognized or absent classification presents the halt with the classification stated as undetermined and never filters it; a type-level check rejects a non-exhaustive match over the classification union.
2. Verify RED.
3. Implement classification-to-procedure resolution with an exhaustive match over the existing disposition union and no catch-all default, so a future member is a compile error rather than a silent absorption. This is review condition C5. Rediscover via symbols `HaltDisposition`, `isOperatorActionHalt`.
4. Verify GREEN. Commit: "monitor: resolve the recovery procedure exhaustively by halt class"

**Done when:**
- Each recognized classification presents its corresponding recovery procedure, as asserted by one case per member of the existing disposition union.
- An unrecognized or absent classification presents the halt with its classification stated as undetermined and never removes it from the queue.
- Classification handling is exhaustive with no catch-all default, pinned by a test that fails to compile or fails at runtime if a union member is unhandled.
- Presenting the halt and gathering its evidence performs no write: a fixture checksum of the halted feature's worktree and halt marker is unchanged afterward.

**Files likely touched:**
- `src/conductor/src/engine/monitor/session.ts`
- `src/conductor/test/engine/monitor/session.test.ts`

**Dependencies:** 11

### Task 13: Keep conductor authority in the guided session and the approval contract intact
**Story:** 14
**Type:** feature

**Steps:**
1. Write failing tests: a session launched through the seam carries no daemon-session marker in its child environment; the session-sanctioned subcommand set is unchanged; the session's resolved working directory is the halted feature's worktree.
2. Verify RED.
3. Implement the working-directory resolution to the halted feature's worktree so provider-state writes land in an already-excluded path and cannot trip the self-host live boundary (adr-2026-09-20-operator-launched-sessions-retain-conductor-authority D5). Add no verb to the sanctioned set and no configuration off-switch. Rediscover via symbols `SESSION_SANCTIONED_SUBCOMMANDS`, `withDaemonSessionMarker`.
4. Verify GREEN. Commit: "monitor: guided sessions retain conductor authority inside the feature worktree"

**Done when:**
- A session launched through the seam is not stamped with the daemon-session marker, as asserted on the child environment handed to the mocked boundary. A conductor recovery subcommand invoked from that child environment passes the entry guard and is permitted rather than refused.
- A test asserts the session-sanctioned subcommand set is unchanged and an engine-dispatched session is still refused for state-changing verbs.
- The guided session's resolved working directory is the halted feature's worktree, as asserted against the mocked boundary. Project-scoped provider configuration and permission writes made by the session (for example `.claude/settings.local.json`) therefore land inside the feature worktree, and a fingerprint of the main checkout is unchanged after the session. User-level provider homes (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) are deliberately inherited from the operator environment unchanged so the session keeps the operator's credentials; the launch neither overrides nor relocates them, as asserted on the child environment handed to the mocked boundary.
- No configuration key is introduced that relaxes the daemon-session entry guard.
- The per-action approval contract is intact, as asserted against the opening input's invocation of the existing triage procedure: each state-changing recovery action is presented with its blast radius and waits for approval before acting, a further state-changing action requests approval again, read-only evidence gathering requests no approval, and a declined action is not performed and the halt marker remains byte-identical.

**Files likely touched:**
- `src/conductor/src/engine/monitor/session.ts`
- `src/conductor/test/engine/monitor/session.test.ts`

**Dependencies:** 10, 11

### Task 14: Return to the queue when a session ends, for every outcome
**Story:** 15
**Type:** feature

**Steps:**
1. Write failing tests: sessions ending zero, non-zero, and by signal each advance to the next item; a three-item queue is worked to completion without restart; the last item's end reports an empty queue and stays active.
2. Verify RED.
3. Implement advance-on-exit that recomputes membership before offering the next item, so a resolution performed inside the session is reflected without a restart.
4. Verify GREEN. Commit: "monitor: return to the queue on every session outcome"

**Done when:**
- Sessions ending with zero status, non-zero status, and by signal all return the operator to the queue. After a non-zero exit the monitor offers the next item.
- A three-item queue is worked to completion without the monitor being restarted. When the last item's session ends and no halts remain, the monitor reports an empty queue and stays active.
- Membership is recomputed after each session ends, so a halt resolved inside the session is absent from the next offer.
- A session that changed nothing leaves its halt in the recomputed queue.
- When the head item's session ends normally, membership is recomputed and the next item in the recomputed order is offered; the session is not required to resolve its halt, and an unresolved head halt stays in the recomputed queue without being re-offered ahead of the remaining items.
- With a queue of three halts, as each session ends in turn all three items are offered in queue order, and the monitor is never restarted.
- A session that ends having changed nothing leaves its halt in the recomputed queue and that same halt is offered to the operator again on a later offer, never silently consumed.

**Files likely touched:**
- `src/conductor/src/engine/monitor/loop.ts`
- `src/conductor/test/engine/monitor/loop.test.ts`

**Dependencies:** 6, 13

### Task 15: Skip an item by deferring it rather than resolving it
**Story:** 16
**Type:** feature

**Steps:**
1. Write failing tests: skipping ends the session and advances; the skipped item's halt marker is untouched; the skipped item is not offered ahead of unseen work; once unseen work is exhausted the deferred items are offered again.
2. Verify RED.
3. Implement the operator-to-monitor skip protocol as a post-session prompt owned by the monitor loop: when a guided session ends for any reason (exit, crash, or launch failure), the monitor asks the operator to choose `skip` (defer this item) or `continue` (recompute and advance without deferring). Choosing `skip` records a deferral keyed by halt identity, recomputes, and advances. The session's exit status never selects an answer (Task 16), no conductor verb is added to the session-sanctioned set (Task 13), and the prompt is identical for every provider. A closed or non-interactive input settles the prompt as `continue`. Never remove or rewrite the halt marker on skip.
4. Verify GREEN. Commit: "monitor: skip defers an item without resolving it"

**Done when:**
- Skipping ends the current session and advances to the next item.
- After every guided session ends, the production monitor loop presents a post-session prompt offering `skip` and `continue`, as asserted by driving the real loop with a mocked launch boundary and mocked operator input; answering `skip` writes a deferral through the production deferral store and answering `continue` writes none.
- The post-session prompt's answer is never derived from the session's exit status: an exit code of 0, a nonzero exit code and an unavailable provider each still present the prompt, and a closed input settles as `continue` with no deferral written.
- A skipped item's halt marker is byte-identical before and after the skip, and the item is never marked resolved.
- A skipped item is not re-offered ahead of unseen work, and is offered again once unseen work is exhausted. A skipped item stays behind unseen work regardless of the skipped item's priority band, and when every item has been skipped a later pass offers them again ordered among themselves by descending priority band.
- A skip survives a monitor restart and the item is still not re-offered ahead of unseen work.

**Files likely touched:**
- `src/conductor/src/engine/monitor/loop.ts`
- `src/conductor/test/engine/monitor/loop.test.ts`

**Dependencies:** 5, 14

### Task 16: Never infer resolution from a session's exit
**Story:** 17
**Type:** negative-path

**Steps:**
1. Write failing tests: a session exiting zero with the halt marker still present leaves the halt queued; a session claiming resolution in its output with the marker present leaves the halt queued; a re-offered halt displays the same context as the first offer.
2. Verify RED.
3. Implement re-derivation of resolution from the halt marker alone. Add no resolution verdict of the monitor's own and no parsing of session output for a resolution claim (adr-2026-09-20-halt-resolution-queue-derived-from-markers D1, adr-2026-09-20-operator-launched-sessions-retain-conductor-authority D6).
4. Verify GREEN. Commit: "monitor: resolution is re-derived from the marker, never from session exit"

**Done when:**
- A session exiting zero with the halt marker still present leaves the halt in the queue.
- No code path marks a halt resolved on session exit; a static check asserts the monitor writes no resolution verdict and parses no session output for one.
- A re-offered halt displays the same project, feature, reason, and classification it displayed the first time.

**Files likely touched:**
- `src/conductor/src/engine/monitor/loop.ts`
- `src/conductor/test/engine/monitor/loop.test.ts`

**Dependencies:** 14

### Task 17: Stay ready when the queue is empty and exit cleanly on interrupt
**Story:** 1
**Type:** feature

**Steps:**
1. Write failing tests: an empty queue reports empty, stays active, and creates no session across several passes; an interrupt during an open session exits without writing a deferral or a resolution; a feature halting after an empty pass is reported on the next pass.
2. Verify RED.
3. Implement the idle path and interrupt handling, modelled on the existing foreground follow command's injectable stop condition so tests need no real signal. Rediscover via symbols `waitForSigint`, `followDaemonLog`.
4. Verify GREEN. Commit: "monitor: stay ready on an empty queue and exit cleanly on interrupt"

**Done when:**
- Starting with no halted features reports an empty queue, stays alive, and creates zero sessions across several passes.
- An interrupt during an open guided session exits without writing a deferral or a resolution for that item. After the interrupt the monitor reports that it stopped, and when it is started again with that feature still halted the item is offered again.
- A feature that halts after an empty pass is reported on the next pass without a restart.
- The stop condition is injectable, so the loop is tested without sending a real signal.
- Starting with at least one halted feature reports that halt as work to resolve and offers it, and the monitor does not exit.
- An interrupt while no guided session is open stops the monitor, and the monitor then reports that it stopped.

**Files likely touched:**
- `src/conductor/src/engine/monitor/loop.ts`
- `src/conductor/test/engine/monitor/loop.test.ts`

**Dependencies:** 14

### Task 18: Emit queue transitions onto the existing event spine
**Story:** 5
**Story:** 15
**Story:** 16
**Type:** infrastructure

**Steps:**
1. Write failing tests: offering an item, opening a session, deferring an item, and ending a session each emit their `ConductorEvent` member; the sink registry declares each new member exhaustively.
2. Verify RED.
3. Implement the new union members and their sink declarations. Extend the existing union rather than inventing a ledger (adr-2026-09-20-halt-resolution-queue-derived-from-markers D6, adr-2026-07-26-event-sink-registry-exhaustiveness). Rediscover via symbols `ConductorEvent`, `EVENT_SINKS`, `persistedEventTypes`.
4. Verify GREEN. Commit: "monitor: emit queue transitions onto the existing event spine"

**Done when:**
- Offering an item, opening a session, deferring an item, and ending a session each emit their own union member, as asserted by a recording emitter.
- Each new member carries an explicit sink declaration, so the registry's exhaustiveness check rejects an undeclared member at compile time.
- No bespoke ledger or second event format is introduced: a static check asserts the monitor writes only through the existing emitter.

**Files likely touched:**
- `src/conductor/src/types/events.ts`
- `src/conductor/src/engine/event-sinks.ts`
- `src/conductor/test/engine/monitor/events.test.ts`

**Dependencies:** 14, 15

### Task 19: Run halt-issue reconciliation on the cycle without blocking the queue
**Story:** 19
**Type:** feature

**Steps:**
1. Write failing tests: a cycle invokes the existing reconciliation; a non-zero exit, a network failure, and a thrown error each leave the monitor active and the queue offered; queue work is not blocked on reconciliation completion.
2. Verify RED.
3. Implement invocation of the existing reconciliation on the monitoring cycle with its behavior unchanged, isolated so its failure is reported and never propagates into the queue path.
4. Verify GREEN. Commit: "monitor: run halt-issue reconciliation on the cycle, failure-isolated"

**Done when:**
- A monitoring cycle invokes the existing reconciliation with its behavior unchanged, as asserted against an injected reconciliation stub.
- A non-zero exit, a network failure, and a thrown error each leave the monitor active and the queue offered. A non-zero exit or thrown error is reported, and a network failure is reported exactly once while the queue is unaffected.
- Queue work is not blocked on reconciliation completion, as asserted by a slow-reconciliation fixture.

**Files likely touched:**
- `src/conductor/src/engine/monitor/loop.ts`
- `src/conductor/test/engine/monitor/loop.test.ts`

**Dependencies:** 17

### Task 20: Wire the monitor verb into the pre-boot command dispatch
**Story:** 1
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests: the detector recognizes the verb and its project selectors; a malformed-but-recognized invocation returns help rather than null so it never falls through to the pipeline launcher; the verb is refused under the daemon-session marker.
2. Verify RED.
3. Implement the detector and dispatcher in their own module and register them in the existing pre-boot chain BEFORE the daemon block, using a lazy import because the module reaches the provider launch path. Add no verb to the session-sanctioned set, so the guard refuses the monitor inside a dispatched session. Per review condition C4 and adr-2026-08-01-scoped-run-verb-release-surface, do NOT edit the legacy CLI shim. Rediscover via symbols `detectIntakeLoopCommand`, `detectDaemonCommand`, `guardDaemonSessionInvocation`.
4. Verify GREEN. Commit: "monitor: wire the verb into the pre-boot command dispatch"

**Done when:**
- The detector recognizes the verb with all-projects and single-project selectors, and returns help rather than null for a malformed-but-recognized invocation.
- The verb is registered before the daemon block, as asserted by a dispatch-order test that fails if a bare token reaches the daemon launcher.
- A test asserts the monitor verb is not in the session-sanctioned subcommand set and is refused under the daemon-session marker. A refused invocation builds no queue, as asserted by an enumeration stub that records zero calls.
- The legacy CLI shim is unmodified, as asserted by a diff check over that path.

**Files likely touched:**
- `src/conductor/src/engine/monitor-cli.ts`
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/monitor-cli.test.ts`

**Dependencies:** 17, 19

### Task 21: Document the verb in help and the reference docs
**Story:** 1
**Type:** documentation

**Steps:**
1. Write failing test: the generated full help reference contains the monitor verb and its selectors.
2. Verify RED.
3. Declare the verb in the existing Commander program so the generated help walks it, and document it in the CLI reference, the repository README, and the engine README, per the established new-verb docs obligation and review condition C6.
4. Verify GREEN. Commit: "monitor: document the verb in help and the reference docs"

**Done when:**
- The generated full help reference contains the monitor verb and its project selectors, as asserted by a help-rendering test.
- The CLI reference documents the verb, its selectors, and its exit codes.
- The repository README and the engine README both mention the verb.

**Files likely touched:**
- `src/conductor/src/cli.ts`
- `docs/reference/cli.md`
- `README.md`
- `src/conductor/README.md`

**Dependencies:** 20

### Task 22: Launch the Codex guided session as an attached interactive TUI
**Story:** 14
**Type:** feature

**Steps:**
1. Write failing tests against the mocked process boundary: the Codex guided launch argv contains no `exec` subcommand, the opening prompt is passed as the final positional argument, and stdio is inherited on all three streams; the Claude guided launch argv and stdio are unchanged.
2. Verify RED.
3. Change the Codex branch of the guided-session launch seam to spawn `codex [OPTIONS] "<prompt>"` with inherited stdio and no stdin write, per adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot D5. Leave every other codex dispatch on the one-shot shape.
4. Verify GREEN. Commit: "monitor: launch codex guided sessions as the attached TUI"

**Done when:**
- A test asserts the Codex guided launch argv handed to the mocked boundary contains no `exec` subcommand.
- A test asserts the Codex guided launch passes the opening prompt as the final positional argument and writes nothing to the child's stdin.
- A test asserts the Codex guided launch spawns with stdio inherited on stdin, stdout, and stderr.
- A test asserts the Claude guided launch argv and stdio are unchanged.

**Files likely touched:**
- `src/conductor/src/engine/monitor/interactive-launch.ts`
- `src/conductor/test/engine/monitor/interactive-launch.test.ts`

**Dependencies:** 9, 13

## Architecture Obligation Coverage

| Decision | Disposition | Tasks | Evidence |
|---|---|---|---|
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D1 | task | task-6 | No module persists queue membership |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D2 | task | task-1 | The enumerator returns one entry per halted worktree carrying slug, reason, and halt class |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D3 | task | task-4 | A deferral written from inside a feature worktree resolves to the main checkout's daemon state directory |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D4 | task | task-5 | An unestablishable halt identity results in the item being offered, proving the fail direction is toward offering. |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D5 | task | task-7, task-8 | proving deferral partitions ahead of priority |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D6 | task | task-18 | Each new member carries an explicit sink declaration |
| adr-2026-09-20-halt-resolution-queue-derived-from-markers#D7 | no-change | none | D7 ships no durable queue artifact; it records only what would justify one later. Nothing in this change set builds a queue artifact, and task-6 pins the absence of persisted membership, so there is no obligation to deliver here. |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D1 | task | task-13 | is not stamped with the daemon-session marker |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D2 | task | task-13 | the session-sanctioned subcommand set is unchanged |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D3 | task | task-9 | Both supported providers are exercised through the launch seam via a mocked process boundary |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D4 | task | task-10 | A static reachability test fails if the launch seam becomes importable from the daemon |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D5 | task | task-13 | resolved working directory is the halted feature's worktree |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D6 | task | task-16 | No code path marks a halt resolved on session exit |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D7 | existing | none | The per-action approval contract is already owned and shipped by the existing operator triage procedure, which task-11 invokes as-is rather than reimplementing. This feature adds no standing consent and no approval path of its own, so D7 is satisfied by existing behavior. |
| adr-2026-09-20-operator-launched-sessions-retain-conductor-authority#D8 | no-change | none | The composer's direct interactive spawn in engineer-cli.ts is exempt from the sole-seam rule and is left untouched by this feature. |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot#D1 | no-change | none | Decision 1 of this ADR is unchanged by the amendment and this feature changes no rate-card pricing, metering state, or non-monitor codex dispatch shape. |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot#D2 | no-change | none | Decision 2 of this ADR is unchanged by the amendment and this feature changes no rate-card pricing, metering state, or non-monitor codex dispatch shape. |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot#D3 | no-change | none | Decision 3 of this ADR is unchanged by the amendment and this feature changes no rate-card pricing, metering state, or non-monitor codex dispatch shape. |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot#D4 | no-change | none | Decision 4 of this ADR is unchanged by the amendment and this feature changes no rate-card pricing, metering state, or non-monitor codex dispatch shape. |
| adr-2026-08-25-committed-rate-card-prices-codex-and-its-repl-is-one-shot#D5 | task | task-22 | A test asserts the Codex guided launch argv handed to the mocked boundary contains no `exec` subcommand. |
