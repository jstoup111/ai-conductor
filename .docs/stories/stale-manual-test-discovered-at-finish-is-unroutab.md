**Status:** Accepted

# Stories: Stale manual_test discovered at FINISH is unroutable

**Feature:** ai-conductor#1613 — technical track, Tier M
**Authoritative design:** `.docs/decisions/adr-2026-08-16-restore-the-current-head-publication-fence.md` (APPROVED),
conforming to decisions 3-5 of `.docs/decisions/adr-2026-07-26-rebase-tail-current-branch-before-publication.md` (APPROVED)
**Binding conditions:** `.docs/decisions/architecture-review-2026-08-16-stale-manual-test-discovered-at-finish-is-unroutab.md` (APPROVED WITH CONDITIONS)

Technical track: there is no PRD, so `**Requirement:**` cites the desired outcome from
`.pipeline/intake-outcomes.md` that the story delivers.

Documentation updates are deliberately **not** stories — they accompany functional work and belong
outside the acceptance criteria.

---

## Story 1: FINISH is never dispatched over a non-green SHIP validator

**Requirement:** outcome-1

As the conductor loop, I want the current-HEAD validation fence to run before every FINISH dispatch
on the production coordinator path, so that a feature whose SHIP validator went stale is redirected
to re-run it instead of reaching a publication step that cannot succeed.

### Acceptance Criteria

#### Happy Path
- Given the production publication coordinator is wired and `manual_test` status is `stale`, when
  the loop reaches `finish`, then `finish` is not marked `in_progress` and no publication side
  effect occurs.
- Given the same run, when the fence finds the validator non-green, then a `kickback` event is
  emitted from `finish` to that validator and the loop redirects there.
- Given a run whose validators are all `done` with satisfied verdicts recomputed at the current
  HEAD, when the loop reaches `finish`, then the fence passes and `finish` dispatches as it does
  today.
- Given several non-green validators, when the fence redirects, then it targets the earliest of
  them and leaves green siblings complete.

#### Negative Paths
- Given a validator legitimately skipped for the run's tier, track, upstream skip, or
  configuration, when the fence resolves membership, then that validator is excluded and does not
  block the dispatch.
- Given `manual_test` whose results contain FAIL rows, when the fence runs, then it is non-green
  even if its status is `done`.
- Given the mocked-dispatch mode used by focused unit tests (`verifyArtifacts` false and not
  daemon), when the fence is consulted, then it stays disabled and those tests are unaffected.
- Given an explicit `--from finish` navigation, when the loop enters `finish`, then it still
  crosses the fence — an explicit target is not publication authorization.

### Done When
- [ ] The production coordinator path runs the fence; a test fails if the disabling disjunct
      returns.
- [ ] A run with `stale` `manual_test` and the coordinator wired emits a `finish`→validator
      kickback and never records a publication side effect.
- [ ] A fully green run still reaches `finish` with no added dispatch.
- [ ] The mocked-dispatch exemption is asserted intact.

---

## Story 2: A redirected validator re-runs and FINISH resumes unattended

**Requirement:** outcome-1

As an operator, I want a run redirected by the fence to re-run the validator and come back to FINISH
on its own, so that a stale SHIP validator no longer costs an intervention at the moment the feature
is shippable.

### Acceptance Criteria

#### Happy Path
- Given a run redirected by the fence, when the targeted validator re-runs and passes against the
  current HEAD, then the loop returns to `finish` and publication proceeds with no operator action.
- Given that run, when it completes, then no `.pipeline/HALT` is written at any point.
- Given the 2026-08-15 shape — `manual_test` stale after review-lap commits — when the run
  resumes, then it ships unattended.
- Given the 2026-08-16 shape — evidence invalidated by ship-tail `rebase` and
  `maintain_documentation` commits — when the run resumes, then it ships unattended.

#### Negative Paths
- Given a redirected validator that genuinely fails on re-run, when its per-gate kickback budget is
  exhausted, then the run halts `needs-human` naming the gate and the lap count.
- Given a validator that cannot produce a verdict at all, when the fence recomputes it, then the
  run halts rather than dispatching FINISH over unreadable evidence.
- Given a halt on this path, when the daemon's re-kick sweep considers it, then it is treated as
  needing a human and is not re-kicked into an identical loop.

### Done When
- [ ] An acceptance test drives a stale-validator run to a published PR with zero operator actions.
- [ ] A genuinely failing validator still halts at the existing cap, asserted separately.
- [ ] The number of fence redirects on a converging run is asserted to be one, not repeated.

---

## Story 3: An unchanged validator surface is preserved, not re-staled

**Requirement:** outcome-2

As the conductor loop, I want the fence to recompute each validator's verdict rather than force it
invalid, so that a tail lap which changed nothing the validator depends on does not re-open work and
send the run round a loop.

### Acceptance Criteria

#### Happy Path
- Given a validator whose declared surface is unchanged since its verdict was recorded, when the
  fence recomputes it, then the verdict remains satisfied and the validator is not marked `stale`.
- Given a tail lap that committed only documentation, when the fence runs, then every validator
  stays green and `finish` dispatches.
- Given a validator whose surface did change, when the fence recomputes it, then the verdict is
  re-derived and the validator is marked `stale` for re-run.
- Given `test_suite` evidence whose content fingerprint still matches, when the fence recomputes,
  then it is not forced to re-execute.

#### Negative Paths
- Given a validator whose verdict cannot be recomputed — unreadable, malformed, or indeterminate
  evidence — when the fence runs, then it is treated as non-green rather than passed.
- Given repeated tail laps that each change only documentation, when the fence runs on each, then
  no validator is re-staled and the run does not oscillate.
- Given a validator marked `stale` by the fence, when the fence runs again after the validator has
  re-run and passed, then it is not re-staled a second time for the same cause.

### Done When
- [ ] A docs-only tail lap is shown to preserve every validator verdict and reach `finish`.
- [ ] An oscillation test drives repeated tail laps and asserts zero repeated re-staling.
- [ ] No unconditional `satisfied: false` write and no evidence-artifact deletion is introduced by
      this change.

---

## Story 4: The retired evidence-invalid placeholder cannot be reached

**Requirement:** outcome-2

As a maintainer, I want the router to stop claiming a routing rule is missing, so that a future
reader is not sent chasing a signal that has not been true since the fence was restored.

### Acceptance Criteria

#### Happy Path
- Given any publication condition, when the router routes it, then the reason never contains
  "requires its dedicated BUILD routing rule".
- Given the router's condition handling, when a new condition code is added without declaring how
  it routes, then the project fails to build.
- Given an evidence condition that still reaches the router, when it routes, then it halts with a
  reason describing the unresolved or unreadable observation.

#### Negative Paths
- Given a malformed or contradictory disposition, when the router receives it, then it still halts
  fail-closed rather than falling through to a route.
- Given the five conditions that already remain inside FINISH, when the router routes them, then
  their `retry_finish` behavior is unchanged.
- Given an `implementation_invalid` disposition, when the router routes it, then its existing BUILD
  route is unchanged — this story does not alter the implementation twin.

### Done When
- [ ] The placeholder string is absent from production source.
- [ ] A compile-time check demonstrates an undeclared condition code is rejected.
- [ ] Existing router tests for the five FINISH-local conditions pass unmodified.

---

## Story 5: The restoration is recorded where the next reader will look

**Requirement:** outcome-2

As a maintainer, I want the reason the fence must stay enabled recorded at the fence itself, so the
disjunct that disabled it for two weeks is not reintroduced by the next change that finds it
inconvenient.

### Acceptance Criteria

#### Happy Path
- Given the fence's guard clause, when a reader opens it, then the remaining exemption states why
  it exists and the removed one is explained by a reference to the governing decision.
- Given a change that re-adds a coordinator-based exemption, when the suite runs, then it fails.

#### Negative Paths
- Given the mocked-dispatch exemption, when the suite runs, then it is not treated as the
  prohibited case and continues to pass.

### Done When
- [ ] A test pins that the fence is active whenever the publication coordinator is wired.
- [ ] The guard clause's surviving exemption carries its stated reason.

---

## Assumption flagged for approval (per `/verify-claims`)

**Restoring the fence may have been disabled for an unrecorded reason** — 70%, inferred. Commit
`9a6005e61` added `this.finishPublication ||` with no comment and no ADR, alongside the placeholder
halt, which reads as expedience rather than decision; but absence of a recorded rationale is not
proof there was none. Plan Task 1 discharges this before any other task depends on it. If a genuine
incompatibility exists between the fence and the coordinator, that is a design fork the operator
must decide — it must halt, not be worked around.
