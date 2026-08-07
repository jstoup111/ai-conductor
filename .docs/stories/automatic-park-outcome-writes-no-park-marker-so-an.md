# Automatic park outcome writes no park marker

**Status:** Accepted

## Context

Source: intake `jstoup111/ai-conductor#1328`. Track: technical (no PRD — these stories are the
acceptance-criteria artifact). Tier: M.

When the daemon's setup-failure triage resolves to `park`, `daemon-runner.ts` logs the decision,
writes a `.pipeline/HALT` note asserting `feature errored — parked for human inspection`, and
returns `status: 'error'`. It never writes `.daemon/parked/<slug>`. Dispatch eligibility
(`daemon-backlog.ts:846`) consults only that marker, so the feature stays dispatchable and is
re-dispatched indefinitely — a full fix-session per cycle, observed twice in an hour with two
different underlying errors in a consumer repo.

The approved design is `adr-2026-08-06-honest-park-termination-boundary.md` (Status: APPROVED). One
termination primitive takes a park intent plus a reason; on park intent it writes the durable
marker first and then *derives* the HALT note's first line from that write's result. The ordering
is the design: it makes a note that claims a park which did not happen unrepresentable, rather than
merely discouraged. Only the triage-park site declares park intent; the other three termination
sites declare none and get honest wording.

Requirements below are stated as `O-N`, the desired outcomes carried on the intake issue. There is
no PRD and therefore no `FR-N` numbering on this track.

Per this repository's test-isolation policy, acceptance coverage for these stories runs the real
internal flow with faithful fakes at the filesystem and git boundaries. No real LLM and no real
provider call is involved — the triage outcome is supplied directly as the `TriageOutcome` value
the boundary consumes.

---

## Story 1: A triage park makes the feature undispatchable

**Requirement:** O-1, O-5

As the daemon, when setup-failure triage resolves to `park`, I want the park recorded as durable
state in the main repository root so that the feature stops being selected for dispatch and cannot
spend a second automatic fix-session on the same unresolved failure.

### Acceptance Criteria

#### Happy Path

- **Given** a daemon-mode feature run whose `prepareWorktree` throws a `SetupFailureError` and
  whose triage returns `{ kind: 'park', outputTail: 'project setup (bin/setup) failed: exit 1' }`,
  **when** the termination boundary runs, **then** a file exists at
  `<mainRepoRoot>/.daemon/parked/<slug>` whose body begins `auto-parked: ` and contains the
  triage's `outputTail` text and a `timestamp:` line.
- **Given** that marker exists, **when** the next backlog scan evaluates eligibility, **then**
  `<slug>` is not returned as dispatchable and does not appear in the scan's ELIGIBLE listing.
- **Given** the boundary is invoked from inside `<root>/.worktrees/<slug>`, **when** the marker is
  written, **then** it lands under the **main repository root**'s `.daemon/parked/`, not under the
  worktree — so removing or recreating the worktree does not remove the park.
- **Given** the park was written, **when** the feature run returns, **then** it still reports
  `status: 'error'` and still keeps the worktree (`teardownWorktree(worktree, true)`), unchanged
  from today.

#### Negative Paths

- **Given** a marker already exists at `.daemon/parked/<slug>` from a prior termination, **when**
  the boundary parks the same slug again, **then** the existing marker's body and timestamp are
  left untouched (idempotent `EEXIST` no-op) and no error is raised.
- **Given** two feature runs for **different** slugs terminate with park intent concurrently,
  **when** both write markers, **then** both `.daemon/parked/<slugA>` and `.daemon/parked/<slugB>`
  exist with their own reasons, and neither write clobbers the other.
- **Given** `.daemon/parked/` does not yet exist, **when** the first park is written, **then** the
  directory is created and the marker write succeeds rather than failing on a missing parent.
- **Given** triage returns an outcome whose `kind` is **not** `park` (`pass`, `quarantined-pass`,
  `fixed-pass`), **when** the run continues to the conductor, **then** no marker is written for
  `<slug>` and the existing continue-to-build behavior is unchanged.

### Done When

- [ ] A test drives the real termination boundary with a `kind: 'park'` triage outcome and asserts
      `.daemon/parked/<slug>` exists with an `auto-parked:` body carrying the triage reason.
- [ ] A test asserts the backlog eligibility check excludes `<slug>` once that marker exists.
- [ ] A test invokes the boundary with a worktree path and asserts the marker resolves to the main
      repository root, not the worktree.
- [ ] A test parks the same slug twice and asserts the first marker's bytes are unchanged.
- [ ] The feature run's returned `status` and worktree-keep behavior are asserted unchanged.

---

## Story 2: The HALT note is derived from the marker write, not written alongside it

**Requirement:** O-2

As an operator reading `.pipeline/HALT`, I want the note's claim about park state to be computed
from the write that just happened so that a note asserting the feature is parked is true of disk at
that moment.

### Acceptance Criteria

#### Happy Path

- **Given** a termination with park intent whose marker write succeeds, **when** the HALT note is
  rendered, **then** its first line states the feature is parked and will not be re-dispatched, and
  `.daemon/parked/<slug>` exists at the moment the note is written.
- **Given** the boundary renders any note, **when** the write sequence is observed, **then** the
  marker write is issued and settled **before** the note content is produced — the note's wording
  is a function of the write result, not a constant chosen by the caller.
- **Given** a termination with park intent, **when** the HALT is written, **then**
  `.pipeline/HALT.class` still contains `needs-human`, unchanged from today's behavior.
- **Given** the note is rendered, **when** it is read, **then** it still carries the existing
  resume procedure and, for a park outcome, the existing triage-evidence block (output tail,
  quarantine ref or the explicit no-quarantine statement, contract outcome, preserved paths).

#### Negative Paths

- **Given** an implementation that writes the note first and the marker second, **when** the
  ordering test runs, **then** it fails — the test asserts observed write order, not merely the
  final on-disk state, because the final state is equally reachable by two independent writes.
- **Given** a termination with park intent, **when** the note is inspected, **then** no code path
  can produce the string asserting a park while `.daemon/parked/<slug>` is absent; a test drives
  the failure branch and asserts the parked-claim string does not appear.
- **Given** the HALT marker's post-write verification read fails (a `.pipeline/HALT` or
  `.pipeline/HALT.class` that cannot be read back), **when** the boundary completes, **then** the
  existing `unrecoverable-state` log line is still emitted for the HALT artifact and the run still
  returns its termination result — this story does not change HALT-verification behavior.

### Done When

- [ ] A test asserts the ordering directly — e.g. an instrumented filesystem boundary records the
      call sequence and the marker write precedes the note write.
- [ ] A test asserts the parked-claim string appears in `.pipeline/HALT` only in runs where
      `.daemon/parked/<slug>` is present.
- [ ] A test asserts `.pipeline/HALT.class` is still `needs-human` after a park termination.
- [ ] A test asserts the triage-evidence block and resume procedure are still rendered.

---

## Story 3: A park that could not be made durable is loud, never silent

**Requirement:** O-2

As an operator, when the daemon decides to park but cannot write the marker, I want the failure
stated in the note and the manual command given, so that I am never told a feature is parked when
nothing is stopping it.

### Acceptance Criteria

#### Happy Path

- **Given** a termination with park intent whose marker write throws a non-`EEXIST` error (for
  example `EACCES` on `.daemon/parked/`), **when** the HALT note is rendered, **then** its first
  line states that the park **failed**, the note names the underlying error message, and the note
  instructs the operator to run `conduct-ts daemon park <slug>`.
- **Given** that same failure, **when** the boundary completes, **then** a log line is emitted
  identifying the slug and the park-write failure, distinguishable from the existing HALT
  `unrecoverable-state` line.
- **Given** that same failure, **when** the run returns, **then** it still returns its termination
  result rather than throwing out of the boundary, so a park-write failure does not crash the
  daemon loop.

#### Negative Paths

- **Given** a park-write failure, **when** the HALT note is inspected, **then** it does **not**
  contain the string asserting the feature is parked for human inspection — the failure note
  replaces the parked claim rather than appending to it.
- **Given** a park-write failure, **when** the next backlog scan runs, **then** `<slug>` is listed
  dispatchable, which is the truthful state; the note is what tells the operator to intervene.
- **Given** the marker write fails with `EEXIST` (already parked), **when** the note is rendered,
  **then** it is treated as a **successful** park — the parked claim is correct and the failure
  wording is not used.
- **Given** the park-write failure path, **when** the code is reviewed, **then** the failure is not
  routed into the existing swallow-and-log block used for HALT-marker verification; a test asserts
  the failure reaches the rendered note.

### Done When

- [ ] A test injects a non-`EEXIST` marker-write failure and asserts the HALT note names the park
      failure, the underlying error text, and the `conduct-ts daemon park <slug>` remedy.
- [ ] A test asserts the parked-claim string is absent from that note.
- [ ] A test asserts an `EEXIST` failure renders the ordinary parked note, not the failure note.
- [ ] A test asserts the boundary returns normally (does not throw) on a park-write failure.

---

## Story 4: A non-park error termination writes no marker and says so

**Requirement:** O-4

As the daemon, when a feature errors at a termination site that is not a park decision, I want no
marker written and a note that says the feature will be re-dispatched, so that ordinary error
retry behavior is preserved and the note does not mislead.

### Acceptance Criteria

#### Happy Path

- **Given** a feature run whose loop ends without a `DONE` or `HALT` marker, **when** the
  termination boundary runs, **then** no file is created at `.daemon/parked/<slug>`, and the HALT
  note states the feature errored and will be re-dispatched on the next scan.
- **Given** that termination, **when** the next backlog scan evaluates eligibility, **then**
  `<slug>` is **not** excluded by the park check.
- **Given** a feature run that fails the false-ship guard (returning `status: 'halted'` and
  escalating a draft PR), **when** the boundary runs, **then** no marker is written, the note
  carries no parked claim, and the existing escalation still occurs.
- **Given** a feature run that terminates through the catch-all thrown-error path, **when** the
  boundary runs, **then** no marker is written and the note carries no parked claim.

#### Negative Paths

- **Given** any of the three non-park termination sites, **when** the HALT note is inspected,
  **then** it does not contain the parked-for-human-inspection claim — a test covers each of the
  three sites independently rather than one representative site.
- **Given** an implementation that derives park intent from the returned `status` rather than from
  an explicit caller argument, **when** the false-ship site returns `'halted'` and the triage-park
  site returns `'error'`, **then** the partition is wrong in at least one case; a test pins that
  the triage-park site parks while both other `status: 'error'` sites do not.
- **Given** a non-park termination, **when** `.pipeline/HALT.class` is read, **then** it is still
  `needs-human`, unchanged — this story changes note wording and marker behavior only.
- **Given** a non-park termination for a slug that an operator has **already** parked by hand,
  **when** the boundary runs, **then** the existing operator marker is not removed or overwritten,
  and the next scan still excludes the slug.

### Done When

- [ ] A test per non-park termination site asserts `.daemon/parked/<slug>` does not exist after
      termination.
- [ ] A test per non-park termination site asserts the note states re-dispatch and omits the
      parked claim.
- [ ] A test asserts the backlog scan still lists a non-park-errored slug as dispatchable.
- [ ] A test asserts an existing operator-placed marker survives a non-park termination untouched.
- [ ] A test asserts the false-ship site's escalation behavior is unchanged.

---

## Story 5: The reconciliation sweep reports the park that was just performed

**Requirement:** O-3

As an operator watching the daemon log, I want the parked-reconciliation line to reflect a park the
daemon performed automatically, so that the log is not reporting `parked=0` while a feature is in
fact parked.

### Acceptance Criteria

#### Happy Path

- **Given** a triage park wrote `.daemon/parked/<slug>`, **when** the next parked-reconciliation
  sweep runs, **then** its summary line reports a `parked` count that includes `<slug>` rather than
  `parked=0`.

  > **Amended 2026-08-06 by #1328:** this assertion holds for a feature whose originating intake
  > issue is still OPEN. When that issue is CLOSED, `park-reconciliation` classifies the slug as
  > `orphan` and its exclusive counter chain reports `orphaned` instead of `parked`. That path is
  > covered as a negative path below rather than changing the existing reporting contract. The
  > original assertion is unchanged for the open-issue case.

- **Given** that marker's body begins `auto-parked: `, **when** reconciliation classifies its
  provenance, **then** it is classified as machine-provenance (`auto`), distinct from an
  operator-placed marker.
- **Given** an automatically parked slug, **when** the operator runs `conduct-ts daemon unpark
  <slug>`, **then** the marker is removed and the next backlog scan lists `<slug>` as dispatchable
  again.

#### Negative Paths

- **Given** an automatically parked slug whose worktree still carries a live `.pipeline/HALT`,
  **when** the re-kick sweep runs, **then** the slug is skipped with the operator-parked reason and
  its HALT is not cleared, no `REKICK` sentinel is written, and no `lastRekickSha` is recorded.
- **Given** a marker body that is empty or unreadable, **when** reconciliation classifies it,
  **then** classification does not throw and the slug remains parked (fail-closed), rather than
  being treated as unparked.
- **Given** no automatic park has occurred, **when** the sweep runs, **then** its line still
  reports `parked=0` — the count reflects markers observed, and this change introduces no
  phantom count.
- **Given** an auto-parked slug whose originating intake issue is CLOSED, **when** the sweep runs,
  **then** it classifies the slug as `orphan` and reports it under `orphaned` rather than `parked`,
  and the marker is **not** removed — dispatch stays suppressed either way.
- **Given** an auto-parked slug whose `feat/daemon-<slug>` branch carries no commits of its own
  (the setup-failure case, so the branch is contained in the base branch), **when** the sweep
  classifies it as merged and attempts merged-park reconciliation, **then** reconciliation refuses
  with `record-missing` because no `.docs/shipped/<slug>.md` exists on the base branch, and the
  marker, the worktree, and the branch are all left in place.

### Done When

- [ ] A test asserts the reconciliation summary counts an auto-parked slug whose intake issue is
      open.
- [ ] A test asserts an auto-parked slug whose intake issue is closed is reported as `orphaned`
      and keeps its marker.
- [ ] A test asserts a zero-commit feature branch's park survives a sweep — the merged-park path
      refuses with `record-missing` and deletes nothing.
- [ ] A test asserts provenance classification returns machine provenance for an `auto-parked:`
      body and operator provenance for an operator-written body.
- [ ] A test asserts the re-kick sweep skips an auto-parked slug without clearing its HALT.
- [ ] A test asserts `conduct-ts daemon unpark <slug>` removes an auto-placed marker and restores
      dispatch eligibility.

---

## Story 6: One unresolved setup failure costs at most one automatic fix-session

**Requirement:** O-5

As the operator paying for provider tokens, I want a feature whose setup fails to consume a single
automatic fix-session and then stop, so that an unresolved environment problem cannot bill an
unbounded number of dispatches.

### Acceptance Criteria

#### Happy Path

- **Given** a feature whose `bin/setup` fails and whose triage parks it, **when** the daemon
  completes that scan and runs a subsequent scan without operator action, **then** the feature is
  dispatched exactly once in total and exactly one triage fix-session is invoked.
- **Given** the same feature across a **daemon restart** (in-memory dispatch state cleared), **when**
  the daemon scans the backlog on startup, **then** the feature is still excluded, because the
  marker is durable in the main repository root.
- **Given** the same feature whose **worktree has been removed and recreated** (losing
  `.pipeline/HALT`), **when** the next scan runs, **then** the feature is still excluded.

#### Negative Paths

- **Given** the feature is parked and the operator has **not** unparked it, **when** several
  consecutive scans run, **then** the triage fix-session dispatcher is invoked zero additional
  times — asserted by call count, not by absence of a log line.
- **Given** the operator fixes the underlying setup problem and unparks the slug, **when** the next
  scan runs, **then** the feature is dispatched again and proceeds normally.
- **Given** a **second, different** setup failure occurs after an unpark, **when** triage parks it
  again, **then** a fresh marker is written carrying the new reason, and the count of automatic
  fix-sessions since the unpark is again exactly one.

### Done When

- [ ] A test counts triage fix-session invocations across multiple scans after a park and asserts
      the count stays at one.
- [ ] A test clears the in-memory dispatch state (simulating a daemon restart) and asserts the slug
      remains excluded.
- [ ] A test removes `.pipeline/HALT` (simulating worktree recreation) and asserts the slug remains
      excluded.
- [ ] A test unparks, re-dispatches, parks again on a different reason, and asserts the new marker
      carries the new reason.
