# Implementation Plan: Prime priority labels when the resolver cache is cold

**Date:** 2026-09-06
**Stories:** .docs/stories/prime-priority-labels-when-the-resolver-cache-is-c.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the two approved priority ADRs — the linked-issue label source with its between-refresh in-memory cache, and the fail-soft contract of whole-scan fallback with one warning per outage and no stale-ranking reuse.

## Summary

Four bounded tasks deliver #2158 inside the existing priority resolver: it records which issue
references it has actually attempted, reads the ones it has not before banding, and keeps the
established outage behavior on that new read site. Cache freshness policy, discovery cadence,
persisted priority state, and eligibility are outside this slice.

## Technical Approach

`createPriorityResolver` currently reaches its reader only when `options.refresh` is true, so a
`refresh:false` resolve over an empty cache silently bands every linked item as `unlabeled` and
still reports `banded`. Add one piece of process-local state next to the existing cache: the set of
references the reader has already produced a result for, whether that result was a label list or a
missing issue. A resolve then computes the references it has never attempted, and reads them when
either the caller asked for a refresh (unchanged: the full reference set is re-read) or the
unattempted set is non-empty and no outage is in force. When neither holds, the reader is not
called at all — which is the steady poll path today and stays free of network calls.

Keep the read inside the existing single `try`, so the new site inherits the outage contract
verbatim: a throw sets the outage flag, clears both the cache and the attempted set, logs one
warning for that outage episode, and returns fallback immediately. Gating the new read on the outage
flag is what prevents a poll-rate read storm while a source is down — recovery still arrives through
a successful refresh resolve, exactly as the fail-soft ADR specifies. A successful read resets the
outage flag and its warn-once flag, as it does now.

Nothing outside the resolver closure changes. `localWorkSource.discover` keeps passing its own
`refresh` through, `orderBacklog` keeps stamping `band` and `resolutionMode`, and the dashboard keeps
deriving its reported mode from those stamps — so the fallback the new read site can now produce is
already rendered correctly by existing code, and the acceptance tasks below prove it end to end
rather than re-implementing it.

Follow the local test patterns already in this area rather than inventing new ones. The resolver's
own unit file drives `createPriorityResolver` directly with an injected reader that records the
reference batch it received, which is what makes "which references were read, and how many times"
assertable; new unit cases belong there and must assert on batches, not just call counts, because the
point of the change is that only unattempted references are read. The acceptance file for this
feature area drives the real `localWorkSource(...).discover()` and the real backlog discovery over a
temporary directory of seeded plan and stories fixtures, with fakes only at the label-source seam and
the fast-forward and ledger hooks; new acceptance cases belong there and must go through
`discover({ refresh: false })` as the first scan of the process, since a refresh first scan is
precisely the condition that hides the defect. Search hints: the resolver unit file's cached-scan
describe block, and the acceptance file's refresh-caching and outage flows. No exact-copy pattern
declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the read-unattempted-references approach, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `createPriorityResolver` in `src/conductor/src/engine/backlog-priority.ts` guards its reader call with `options.refresh || sourceRefs.length === 0`, and the second disjunct's body is a no-op, so a non-refresh resolve with linked items never reads.
- Verified: the same function, after that guard, maps every reference absent from the cache to `unlabeled` and returns `{ mode: 'banded' }`, so a cold non-refresh resolve reports banded ordering built from no data.
- Verified: the outage path clears the cache, sets the outage flag, logs one warning per episode, and returns fallback; a later non-refresh resolve short-circuits to fallback while that flag is set.
- Verified: `localWorkSource.discover` in `src/conductor/src/engine/daemon-work-source.ts` calls `priorityResolver.resolve(items, { refresh })` after the gates and hands the result to `orderBacklog`.
- Verified: `orderBacklog` stamps `band` and `resolutionMode` on returned items, and `src/conductor/src/engine/daemon-dashboard.ts` derives its reported priority resolution from `resolutionMode`.
- Verified: the daemon run loop in `src/conductor/src/engine/daemon.ts` only reaches a refresh discovery when the local non-refresh pass produced no eligible candidate; its startup dashboard hook does run one refresh discovery but returns early when the daemon boots paused.
- Verified: every existing test that asserts zero reader calls on a non-refresh scan performs a refresh scan first, so the new read site leaves them green.
- Verified: the two approved priority ADRs already state that the first scan of a daemon run primes the cache and that an outage degrades the whole scan with one warning; no ADR amendment is required.
- Scope check: consumer-facing daemon scheduling behavior; no new skill; provider-agnostic. Event spine: no new event, metric, or channel — the existing resolution mode already travels on the discovered items.
- Verify-claims verdict: CLEAR. No load-bearing assumption remains unconfirmed.

## Tasks

### Task 1: Read the references the resolver has never attempted
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/backlog-priority.ts, src/conductor/test/backlog-priority.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit cases against `createPriorityResolver` with a reader that records each batch it receives: a first non-refresh resolve over linked items must read them and band by label; a second non-refresh resolve over the same items must record no new batch; a third resolve after a new linked item joins must record exactly one batch containing only the new reference; a reference the reader reports as missing must band unlabeled and never appear in a later batch.
2. Run the new cases and confirm RED for the reasons above, not for a module or type error.
3. Implement: keep a process-local set of references the reader has returned a result for, populated on every successful read for both label lists and missing issues, and cleared wherever the cache is cleared. Compute the unattempted references of this resolve and read when the caller asked for a refresh or the unattempted set is non-empty; leave the refresh path reading the full reference set as it does today.
4. Confirm GREEN, including the pre-existing cached-scan and relabel cases in this file, then commit the focused change.

**Done when:**
1. A first non-refresh resolve over linked items reads them and returns bands from the reader's labels rather than unlabeled.
2. A repeat non-refresh resolve over an unchanged item set records no further reader batch.
3. A non-refresh resolve after a new linked item joins records exactly one further batch, containing only the new reference.
4. A reference reported as missing bands unlabeled and appears in no later reader batch across two further non-refresh resolves.
5. Every pre-existing case in the resolver's unit file still passes unchanged.

### Task 2: Keep the outage contract on the new read site
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/backlog-priority.ts, src/conductor/test/backlog-priority.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit cases for a rejected read on a cold non-refresh resolve: the resolve returns fallback rather than banded, logs exactly one warning, and the two following non-refresh resolves stay fallback while recording no further reader batch and no second warning.
2. Add a failing recovery case: after that outage, a refresh resolve that succeeds restores banded ordering on the following non-refresh resolve, and a later new outage warns again.
3. Confirm RED, then implement by keeping the new read inside the existing try and skipping it while the outage flag is set, so a throw clears the cache and the attempted set, warns once, and returns fallback exactly as the refresh path does today.
4. Confirm GREEN, including the pre-existing outage cases in this file, then commit.

**Done when:**
1. A cold non-refresh resolve whose read is rejected returns fallback mode and logs exactly one warning.
2. Two further non-refresh resolves during the same outage return fallback, record no reader batch, and add no second warning.
3. A successful refresh resolve after the outage restores banded ordering on the next non-refresh resolve.
4. A new outage after that recovery logs one further warning.

### Task 3: Prove the daemon's local discovery bands a cold backlog
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts
**Dependencies:** 1

**Steps:**
1. Add failing acceptance cases that drive the real `localWorkSource(...).discover({ refresh: false })` as the first scan of the process, over seeded plan and stories fixtures whose intake markers link issues of differing priority, with the label source faked at its reader seam only.
2. Assert the first non-refresh scan returns the label-banded slug order and not the plan-file order, that a second non-refresh scan records no further reader batch, and that a scan taken after a further linked spec becomes part of the resolved backlog reads only that spec's reference and places it in its labeled band.
3. Confirm RED against current behavior — the first scan returns plan-file order — then confirm GREEN once Task 1 has landed, without editing production code in this task.
4. Run the affected acceptance file plus the resolver unit file and commit.

**Done when:**
1. The first non-refresh discovery of the process returns the label-banded slug order through the real work source.
2. A second non-refresh discovery over the unchanged backlog records no further call to the label source.
3. A non-refresh discovery taken after a further linked spec joins the resolved backlog reads only that spec's reference and returns it in its labeled band.

### Task 4: Prove a failed cold scan is reported as fallback
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/acceptance/daemon-issue-priority-scheduling.test.ts
**Dependencies:** 2

**Steps:**
1. Add a failing acceptance case where the faked label source rejects the read attempted by the first non-refresh discovery of the process, over a fixture whose linked spec would outrank an unlinked one if the labels had been read.
2. Assert that discovery returns plan-file order, that its items carry no band annotation, and that exactly one outage warning is logged across it and the two following non-refresh discoveries.
3. Assert through the real dashboard state builder over that same failed non-refresh scan that the reported ordering is the fallback mode and carries no band annotations.
4. Confirm RED against current behavior — the cold scan reports banded ordering with every item unlabeled — then confirm GREEN once Task 2 has landed, and commit.

**Done when:**
1. A first non-refresh discovery whose label read is rejected returns plan-file order with no band annotation on any item.
2. Exactly one outage warning is logged across that discovery and the two following non-refresh discoveries.
3. The dashboard state built from that failed non-refresh scan reports fallback ordering and carries no band annotations.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a backlog of linked specs whose labels this process has never read, when a non-refresh discovery runs, then the returned order is banded by each spec's current priority label rather than plan-file order. | 1, 3 | "The first non-refresh discovery of the process returns the label-banded slug order through the real work source." | diff-local |
| Story 1 happy: Given every linked spec in the backlog has already had its labels read this process, when another non-refresh discovery runs, then the priority source is called zero further times and the previously read bands are reused. | 1, 3 | "A second non-refresh discovery over the unchanged backlog records no further call to the label source." | diff-local |
| Story 1 happy: Given a linked spec becomes part of the resolved backlog only after earlier scans, when the next non-refresh discovery runs, then that spec's labels are read, the already-read specs are not re-read, and the new spec is placed in its labeled band. | 1, 3 | "A non-refresh discovery taken after a further linked spec joins the resolved backlog reads only that spec's reference and returns it in its labeled band." | diff-local |
| Story 1 negative: Given a linked spec whose issue no longer exists, when a non-refresh discovery reads it, then it is banded as unlabeled and no further read is made for it on later non-refresh scans. | 1 | "A reference reported as missing bands unlabeled and appears in no later reader batch across two further non-refresh resolves." | diff-local |
| Story 2 happy: Given the priority source recovered on a refresh scan after an outage, when a later non-refresh discovery runs, then banded ordering resumes from the labels that refresh read. | 2 | "A successful refresh resolve after the outage restores banded ordering on the next non-refresh resolve." | diff-local |
| Story 2 negative: Given the priority source rejects the read attempted by a non-refresh discovery over a cold backlog, when that discovery completes, then it returns plan-file order in fallback mode with no band annotations and logs exactly one outage warning. | 2, 4 | "A first non-refresh discovery whose label read is rejected returns plan-file order with no band annotation on any item." | diff-local |
| Story 2 negative: Given that outage persists, when further non-refresh discoveries run, then each stays in fallback mode, makes no further call to the priority source, and adds no second warning. | 2, 4 | "Two further non-refresh resolves during the same outage return fallback, record no reader batch, and add no second warning." | diff-local |
| Story 2 negative: Given the dashboard renders the state of a non-refresh scan whose priority read failed, when it reports the ordering section, then it names the fallback mode rather than a banded order. | 4 | "The dashboard state built from that failed non-refresh scan reports fallback ordering and carries no band annotations." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided by the resolver's own state machine and the fixtures
these tasks control, and no commit outside this diff can change whether it holds. Task 1 owns the
unit dispositions for the read cadence, asserting on the reference batches the injected reader
receives rather than on call counts alone. Task 2 owns the unit dispositions for the outage
contract at the new read site. The changed production boundary is the daemon's local discovery pass,
and Task 3 owns its integration proof through the real work source and real backlog discovery, with
fakes only at the label source and the fast-forward and ledger hooks. Task 4 owns the integration
proof for the degraded path, including the dashboard state the operator actually reads. No new
external service is contacted at any level, and no aggregate or terminal validation task is added:
the existing suite for this feature area already covers the refresh path, relabel freshness, and
eligibility invariants, which this change leaves untouched.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 2 -> Task 4
