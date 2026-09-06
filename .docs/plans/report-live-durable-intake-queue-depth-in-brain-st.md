# Implementation Plan: Report live durable intake queue depth in brain status

**Date:** 2026-09-06
**Stories:** .docs/stories/report-live-durable-intake-queue-depth-in-brain-st.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds one read-only summarizer over the existing intake ledger and changes one CLI verb's output, leaving the ledger schema, the notifier contract, the reap policy, and every writer untouched.

## Summary

Four bounded tasks deliver #1132: a pure summarizer over durable intake ledger entries, its adoption by the brain status verb, an honest unavailable path when the ledger cannot be read, and a labelled last-notification line that can never stand in for current depth. Notifier redesign, machine-readable output, per-repository breakdowns, and reap-policy changes are outside this small slice.

## Technical Approach

The defect is an authority mistake, not a formatting one: the brain status verb reads the notifier's status surface and prints its batch-size field under a depth label, and because the notifier writes nothing on an empty batch, that number outlives the tick that produced it. The durable authority for intake lifecycle state is the intake ledger the composition root builds at `ledger.json` under the engineer directory the status verb already resolves. Read it at invocation time; do not have any writer push a snapshot forward.

Add one small pure module under the intake directory that takes a list of ledger entries, a current time in milliseconds, and a stale-claim window in milliseconds, and returns pending, claimed, and stranded counts. Pending and claimed come from the entry status. Stranded reuses the existing shared stale-claim predicate rather than re-deriving staleness, so the count agrees with the bulk requeue path by construction and inherits its deliberate refusals: an entry with a delivered pull request, an absent last-seen value, or an unparseable last-seen value is never stranded. Stranded is a subset of claimed and is reported alongside it, not subtracted from it, so the three numbers can be read independently.

Widen the status verb's injectable dependency record with a ledger-entry reader, a clock, and a stale-claim window, each defaulting to production wiring: the file-backed ledger at the resolved engineer directory, the system clock, and the shared configured window resolver fed by a best-effort project config load — the same resolution the claim and bulk requeue paths already use, so an operator's window override reaches all three. The existing tmux liveness line is unchanged and is printed first, before any ledger work, so a ledger problem never hides whether the loop is up.

Failure is reported, never smoothed. A corrupt ledger and a lease-acquisition failure both surface as thrown errors from the ledger read; catch them at the verb boundary, print one unavailability line naming the reason, print no counts, and return a non-zero exit code. This matters because the intake loop holds that lease periodically, so contention is a real outcome of asking for depth while the loop runs, and a zero printed in its place would recreate the very defect being fixed. The notification surface keeps its existing best-effort read but moves to a line that identifies it as the last notification and carries its recorded timestamp; an absent, empty, or unparseable surface prints no figure rather than a zero, and never affects the exit code.

The existing status-verb tests already inject a fake tmux runner and a fake status reader, and are the pattern to extend: keep dependency injection at the verb boundary, assert on captured output lines and the returned exit code, and add no real filesystem, tmux, or network access. The summarizer is pure and belongs at unit level with plain entry literals. Allowed variation is fixture-builder shape and assertion grouping; what must be preserved is that the verb is exercised through its own exported function with injected dependencies, and that no test constructs a real ledger lease. Search hints: the existing brain CLI test file for the injected-runner pattern, and the existing stale-claim window config test for window-override fixtures.

## Preconditions and claim ledger

- Operator approved Small scope, the read-the-ledger approach over a richer written snapshot, the technical track, and all three stories on 2026-09-06 (delegated).
- Verified: the status verb reads the notifier surface and prints its `count` field as `queued:`; the notifier defines that field as the newly-notified batch size and returns without writing when the batch is empty.
- Verified: the intake composition root builds the file-backed ledger at `ledger.json` under the engineer directory, which is the same directory the status verb already resolves for the notification surface.
- Verified: the ledger's `list()` returns every entry with its lifecycle status and last-seen value; a corrupt store throws a dedicated corrupt-ledger error and a failed lease acquisition throws a lease error, both from the same call.
- Verified: the shared stale-claim predicate refuses to mark an entry stranded when it is not claimed, carries a pull request, or has an absent or unparseable last-seen value; the bulk requeue path already pairs it with the shared configured window resolver, whose default is twenty-four hours.
- Verified: the existing brain CLI tests inject a fake tmux runner and a fake status reader and assert on captured lines and the exit code, so widening the dependency record needs no new test harness.
- Scope check: harness-repo-only (this repository's host-wide intake supervisor and its ledger layout); no skill addition; provider-agnostic. Event spine: no new channel — durable state is read at read time, which is the state-not-occurrence exception; no watcher, poller, sidecar, or stamped timestamp is added, and the notifier surface gains no fields.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in the worktree; no load-bearing assumption remains open.

## Tasks

### Task 1: Summarize durable queue depth over ledger entries
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/intake/queue-depth.ts, src/conductor/test/engine/intake-queue-depth.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit tests for a summarizer taking ledger entries, a current time in milliseconds, and a stale-claim window in milliseconds: entries across every lifecycle status, claimed entries inside and outside the window, the same fixture under two different windows, and claimed entries with an absent last-seen value, an unparseable last-seen value, and a recorded pull request.
2. Establish RED, then implement the summarizer as a pure function returning pending, claimed, and stranded counts, delegating the stranded decision entirely to the shared stale-claim predicate rather than re-deriving staleness. Keep stranded a subset of claimed, not a deduction from it.
3. Assert the summarizer performs no input mutation and no I/O, so the verb boundary owns every read.
4. Run the focused unit file through the repository's scoped test runner and commit the focused change.

**Done when:**
1. Unit cases prove the summarizer counts pending and claimed entries separately and excludes every other lifecycle status from both counts.
2. Unit cases prove the stranded count contains exactly the claimed entries the shared stale-claim predicate accepts for the supplied window, and that the same fixture under a different window yields a different stranded count.
3. Unit cases prove claimed entries with an absent last-seen value, an unparseable last-seen value, or a recorded pull request are counted as claimed and never as stranded.

### Task 2: Report the durable counts from brain status
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/brain-supervisor-cli.ts, src/conductor/test/engine/daemon-brain-cli.test.ts
**Dependencies:** 1

**Steps:**
1. Extend the existing brain CLI tests with an injected ledger-entry reader, an injected clock, and an injected stale-claim window: a mixed-lifecycle fixture, a fixture whose entries change between two invocations, and a fixture read twice under two different windows. Repeat the pattern context from Technical Approach: exercise the exported status function with injected dependencies, assert on captured output lines and the returned exit code, and never construct a real ledger lease.
2. Establish RED, then widen the verb's dependency record with the ledger-entry reader, the clock, and the window, defaulting to the file-backed ledger under the resolved engineer directory, the system clock, and the shared configured window resolver fed by a best-effort project config load.
3. Print the liveness line first and unchanged, then the pending, claimed, and stranded counts on separate labelled lines from the Task 1 summarizer. Remove the line that printed the notification batch size under a depth label.
4. Run the focused CLI test file through the repository's scoped test runner and commit.

**Done when:**
1. Brain status prints the pending count and the claimed count on separate labelled lines for an injected mixed-lifecycle fixture, and prints the stranded count on its own labelled line.
2. Two consecutive invocations against an injected reader whose entries change in between report the second reading, with no poll or notification occurring between them.
3. An injected window override changes the reported stranded count, and the production default is the shared configured window resolver.
4. No output line presents the notification batch size as a queue depth, and the liveness line is emitted before any ledger read is attempted.

### Task 3: Report queue unavailability when the ledger cannot be read
**Story:** Story 1 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/brain-supervisor-cli.ts, src/conductor/test/engine/daemon-brain-cli.test.ts
**Dependencies:** 2

**Steps:**
1. Write RED tests injecting a ledger reader that throws the dedicated corrupt-ledger error, and a second that throws a lease-acquisition failure, asserting captured lines and exit code for both.
2. Implement the catch at the verb boundary: emit one unavailability line naming the underlying reason and return a non-zero exit code, leaving the already-printed liveness line intact.
3. Assert that neither failure prints a pending, claimed, or stranded figure, so a read failure can never be mistaken for an empty queue.
4. Run the focused CLI test file through the repository's scoped test runner and commit.

**Done when:**
1. A ledger read that throws the corrupt-ledger error makes the verb print the liveness line, then one unavailability line naming the reason, and return a non-zero exit code.
2. A ledger read that throws a lease-acquisition failure produces the same unavailability shape and the same non-zero exit code.
3. Neither unavailable path prints a pending, claimed, or stranded figure.

### Task 4: Label the prior notification batch and never fabricate one
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/brain-supervisor-cli.ts, src/conductor/test/engine/daemon-brain-cli.test.ts
**Dependencies:** 2

**Steps:**
1. Write RED tests over the injected status reader: a well-formed batch record with a recorded timestamp, an absent surface, an empty surface, and an unparseable surface, each asserted against the captured lines and the exit code.
2. Establish RED, then render the batch on its own line identifying it as the last notification and carrying its recorded timestamp, positioned after the durable count lines.
3. Suppress the line entirely when the surface is absent, empty, unparseable, or missing its batch field, and keep every one of those cases at exit code zero with the durable count lines still printed.
4. Run the focused CLI test file through the repository's scoped test runner and commit.

**Done when:**
1. A recorded batch is printed on its own line identifying it as the last notification and carrying its recorded timestamp, distinct from the pending, claimed, and stranded lines.
2. Absent, empty, and unparseable surface fixtures each print no numeric batch figure while the durable count lines are still printed and the exit code is zero.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the durable intake ledger holds entries in several lifecycle states, when brain status runs, then it reports the count of pending entries and the count of claimed entries as separate labelled values. | 1, 2 | "Brain status prints the pending count and the claimed count on separate labelled lines for an injected mixed-lifecycle fixture, and prints the stranded count on its own labelled line." | diff-local |
| Story 1 happy: Given the ledger changes between two brain status invocations without any poll happening in between, when brain status runs the second time, then the reported counts reflect the ledger as it stands at that invocation. | 2 | "Two consecutive invocations against an injected reader whose entries change in between report the second reading, with no poll or notification occurring between them." | diff-local |
| Story 1 negative: Given the durable ledger cannot be read because its contents are corrupt or its lease cannot be acquired, when brain status runs, then it reports the queue as unavailable with the underlying reason, prints no counts at all, and exits non-zero. | 3 | "A ledger read that throws the corrupt-ledger error makes the verb print the liveness line, then one unavailability line naming the reason, and return a non-zero exit code." | diff-local |
| Story 2 happy: Given some claimed entries were last seen longer ago than the configured stale-claim window, when brain status runs, then those entries are reported as a stranded count on its own labelled line, in addition to the claimed count. | 1, 2 | "Unit cases prove the stranded count contains exactly the claimed entries the shared stale-claim predicate accepts for the supplied window, and that the same fixture under a different window yields a different stranded count." | diff-local |
| Story 2 happy: Given no claimed entry is older than the configured stale-claim window, when brain status runs, then the stranded count is zero and the claimed count is unchanged. | 1, 2 | "An injected window override changes the reported stranded count, and the production default is the shared configured window resolver." | diff-local |
| Story 2 negative: Given a claimed entry carries a missing or unparseable last-seen timestamp, or already carries a delivered pull request, when brain status runs, then that entry is counted as claimed and never as stranded. | 1 | "Unit cases prove claimed entries with an absent last-seen value, an unparseable last-seen value, or a recorded pull request are counted as claimed and never as stranded." | diff-local |
| Story 3 happy: Given an earlier non-empty poll recorded a notification batch, when brain status runs, then that batch is reported on its own line identified as the last notification with its recorded time, separate from every durable count. | 4 | "A recorded batch is printed on its own line identifying it as the last notification and carrying its recorded timestamp, distinct from the pending, claimed, and stranded lines." | diff-local |
| Story 3 negative: Given the notification status surface is absent, empty, or unparseable, when brain status runs, then no batch figure is reported at all, the durable counts are still reported, and the command exits zero. | 4 | "Absent, empty, and unparseable surface fixtures each print no numeric batch figure while the durable count lines are still printed and the exit code is zero." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against injected fixtures. Task 1 owns the pure summarizer at unit level with plain entry literals — the lowest sufficient layer for counting and predicate delegation. Task 2 owns the integration proof at the operator-visible boundary: the exported status verb, invoked with injected dependencies, observed through its printed lines and returned exit code, which is the only entry point an operator reaches. Tasks 3 and 4 extend that same boundary with the two degradation classes, so no separate aggregate or end-to-end test is required. No test contacts a real tmux server, a real ledger file, an LLM, or any network service, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 2 -> Task 4
