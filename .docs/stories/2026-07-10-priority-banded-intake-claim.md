**Status:** Accepted

# Stories: Priority-banded intake claim (#461)

**Track:** technical (no PRD — derived from issue #461 intent + APPROVED
`adr-2026-07-10-intake-claim-priority-banding`)
**Feature area:** `conduct-ts engineer claim` candidate ordering

---

## Story: Claim serves the highest-priority band first

**Requirement:** TR-1 (issue #461 acceptance sketch 1)

As an operator, I want `engineer claim` to serve the highest-priority pending idea so that
marking an issue `priority: critical` jumps the idea→spec queue, not just the build queue.

### Acceptance Criteria

#### Happy Path
- Given pending entries {A: `priority: low`, receivedAt oldest; B: `priority: critical`,
  receivedAt newest} and both unblocked, when `engineer claim` runs, then B is claimed
  (JSON `kind: claim`, B's sourceRef) and A remains pending in the inbox.
- Given pending entries spanning bands {unlabeled, high, medium}, when claim runs, then the
  high entry is served, and a subsequent claim serves the medium entry (band rank:
  no-issue → critical → high → medium → low → unlabeled).
- Given an entry whose issue was relabeled `priority: critical` AFTER capture, when the next
  claim runs, then the new label is honored (labels are read at claim time — no re-poll,
  no restart, no cache from a prior claim).

#### Negative Paths
- Given a pending entry whose sourceRef issue returns 404 (deleted), when claim runs, then
  that entry is banded `unlabeled` (not an error, not skipped by banding) and ordering
  proceeds; the 404 does not trigger the outage fallback.
- Given a pending entry whose issue has multiple priority labels
  (`priority: low` + `priority: critical`), when claim runs, then the highest band wins
  (critical) — per `parsePriorityLabels`' existing highest-rank rule.
- Given an envelope with no sourceRef held in the walk, when banding is applied, then it
  takes the `no-issue` band (rank 0, first) — parity with the daemon's ranking, no network
  call attempted for it.

### Done When
- [ ] A test with pending {low(oldest), critical(newest)} asserts claim returns the
  critical entry's sourceRef and the low entry is still pending (inbox file present).
- [ ] A test asserts the relabel-after-capture case: same inbox, label fixture changed
  between two claims → second claim reflects the new band.
- [ ] Band ranking used by the claim walk is imported from `backlog-priority.ts` (single
  exported ranking/comparator); `grep` shows no duplicate rank map in dependency-claim.ts.

---

## Story: Label-reader outage fails open to today's FIFO

**Requirement:** TR-2 (issue #461 acceptance sketch 2; adr fail-open contract)

As an operator, I want a gh outage to degrade claim ordering to plain FIFO so that intake
never stalls on the label source.

### Acceptance Criteria

#### Happy Path
- Given the label reader throws (transport error / quota), when claim runs, then the claim
  still succeeds, candidates are evaluated in pure receivedAt-FIFO drain order, and exactly
  one warning line is emitted for that invocation.

#### Negative Paths
- Given the reader throws after resolving some refs (partial failure mid-batch), when claim
  runs, then NO partial band map is used — the whole claim falls back to FIFO order (never
  a half-banded order).
- Given the reader throws, when the claim completes via fallback, then the selected entry
  is still ack'd and its ledger entry still transitions to `claimed` (the fallback branch
  performs the same side effects as the banded branch).
- Given the reader hangs are NOT handled by this feature (no new timeout machinery), when
  reviewing scope, then only thrown errors trigger fallback — hang behavior is unchanged
  from today's gh invocations elsewhere in the claim path.

### Done When
- [ ] A test injects a throwing label reader and asserts: claim returns the OLDEST
  unblocked entry (FIFO), exit code 0, exactly one outage warning logged.
- [ ] A test injects a reader that throws on the second ref and asserts the final order is
  pure FIFO (no partial banding).
- [ ] Fallback-path claim asserts ack + ledger `claimed` transition occurred (side effects
  identical to banded path).

---

## Story: Within-band order is stable receivedAt FIFO

**Requirement:** TR-3 (issue #461 acceptance sketch 3)

As an operator, I want deterministic within-band ordering so that repeated claims drain a
band oldest-first with no reordering surprises.

### Acceptance Criteria

#### Happy Path
- Given three pending entries all `priority: high` with distinct receivedAt, when claim
  runs repeatedly, then entries are served strictly oldest-first within the band.
- Given a mix of banded and unlabeled entries, when claim runs, then unlabeled entries
  retain their relative FIFO order among themselves (stable sort).

#### Negative Paths
- Given two entries with identical receivedAt in the same band, when claim runs, then the
  order is still deterministic (falls back to the drain order, which derives from the
  queue's lexicographic filename sort including envelope id) — never nondeterministic
  between runs.

### Done When
- [ ] A test with 3 same-band entries asserts strict oldest-first service across 3
  sequential claims.
- [ ] A stable-sort test asserts relative order preservation for same-band entries.

---

## Story: Banding composes with blocker deferral — and never drops an entry

**Requirement:** TR-4 (issue #461 acceptance sketch 4; ADR consequence — deferral stateless)

As an operator, I want priority banding layered on top of the existing blocker/liveness
deferral so that a blocked critical defers to the next candidate in banded order, and no
envelope is ever lost.

### Acceptance Criteria

#### Happy Path
- Given pending {critical (blocked by an open dependency), high (unblocked)}, when claim
  runs, then verdicts are evaluated in banded order, the blocked critical is deferred
  (released back, no ledger write, no attempt increment), and the high entry is claimed.
- Given every pending entry is blocked, when claim runs, then the all-blocked outcome is
  reported with entries in banded order — semantics of `all-blocked` vs `empty` unchanged.

#### Negative Paths
- Given the walk throws unexpectedly after draining (e.g. resolver crash), when the process
  exits, then every held envelope has been released back to the inbox (finally-block
  guarantee preserved) — a later `claim` sees the full pending set.
- Given a concurrent second claim starts while the first holds the drained set, when the
  second runs, then it reports `empty` (pre-existing hold-window behavior, unchanged) and
  the first claim's release restores all non-selected entries.
- Given closed-issue liveness (#279) marks an entry's verdict non-unblocked, when claim
  runs, then that entry is deferred exactly as today — banding changes candidate ORDER
  only, never verdict handling.

### Done When
- [ ] A test with a blocked critical + unblocked high asserts the high is claimed and the
  critical remains pending afterward with unchanged ledger status/attempts.
- [ ] A crash-injection test asserts all drained envelopes are back in the inbox after an
  unexpected throw.
- [ ] `createFileQueue` (queue.ts) is byte-identical to main (`git diff` empty for that
  file) — the atomic-rename primitive is untouched.

### Notes
- CLI output contract: the `claim` JSON shape (`kind/text/source/sourceRef`) is unchanged;
  band information may appear in stderr logging only. Downstream consumers (the /engineer
  skill) need no changes.
