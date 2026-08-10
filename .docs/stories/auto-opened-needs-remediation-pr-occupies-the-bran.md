# Stories: One branch, one PR, one halt state (#1415)

**Status:** Accepted

**Track:** technical (no PRD — acceptance criteria live here)
**Source issue:** jstoup111/ai-conductor#1415
**Approved design:** `.docs/decisions/review-2026-08-09-halt-pr-occupies-retained-slot-1415.md`,
`adr-2026-08-09-one-pr-per-branch-halt-is-a-state.md`,
`adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic.md`

Requirement tags reference the source issue's desired outcomes (`OUT-1` … `OUT-5`) and the two
approved ADRs, since the technical track has no `FR-N` set.

- **OUT-1** — a retried build can complete its retained-PR step on a branch that already carries an
  auto-opened remediation PR
- **OUT-2** — the placeholder never leaves a branch whose only recorded PR is one the retry refuses
- **OUT-3** — the PR carrying the implementation is eligible for ci-fix dispatch and the mergeable
  sweep again after a successful resume
- **OUT-4** — an operator can tell a live implementation PR from a remediation placeholder with no
  ambiguity
- **OUT-5** — clearing a HALT and letting the daemon re-dispatch is sufficient to resume

---

## Story 1: Every retained-PR resolution hands back a repaired implementation PR

**Requirement:** OUT-1, OUT-2 / `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`

As the conductor, I want the branch's halt state repaired wherever the retained PR is resolved, so
that no consumer is ever handed a remediation placeholder it can only refuse.

PR *timing* is out of scope: `adr-2026-07-29-ship-start-draft-pr` continues to own when the draft
PR is born, and SHIP entry stays its only birth site.

### Acceptance Criteria

#### Happy Path
- Given a branch whose only OPEN PR carries the halt state, when the conductor resolves the retained
  PR for any consumer, then the returned PR has been repaired first — no `needs-remediation` label,
  no body marker, and a `feat: …` title.
- Given the retained PR is resolved a second time in the same run, when resolution runs, then the
  memoized identity is reused and no repeated repair mutations are issued.
- Given a retained PR that never halted, when resolution runs, then it is returned after a single
  state read with **zero** mutating GitHub calls — the ordinary path is not taxed.

#### Negative Paths
- Given the branch has no OPEN PR at all, when resolution runs, then it returns no identity and the
  caller's existing fail-closed behavior is unchanged (the release gate still HALTs rather than
  inventing a PR).
- Given the branch's only PR is CLOSED or MERGED, when resolution runs, then it is not returned as
  the retained PR and no repair is attempted against it.
- Given the PR state read fails, when resolution runs, then the repair is skipped, one log line is
  recorded, and nothing throws into the conductor loop.
- Given the repair partially succeeds (label removed, marker removal unconfirmed), when resolution
  runs, then the outcome is reported as `partial` and the next resolution retries it.
- Given the base branch cannot be resolved, when resolution runs, then no looser lookup is
  attempted and no unrelated branch's PR can satisfy it.

### Done When
- [ ] A consumer resolving the retained PR on a halted branch observes a `feat:` titled PR with no
      `needs-remediation` label and no body marker.
- [ ] A never-halted PR's resolution issues exactly one read and zero writes.
- [ ] A closed or merged PR is never returned as the retained PR.
- [ ] A failed state read leaves the conductor loop running.

---

## Story 2: A HALT decorates the existing PR instead of creating a second one

**Requirement:** OUT-2, OUT-4 / `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`

As an operator, I want an irrecoverable HALT to mark the branch's existing PR, so that the branch
never ends up with two competing PR shapes and I can see at a glance which branch needs me.

### Acceptance Criteria

#### Happy Path
- Given an OPEN draft PR titled `feat: <desc>` exists for the branch, when an irrecoverable HALT
  escalates, then that PR gains the `needs-remediation` label, the
  `<!-- conductor:needs-remediation -->` body marker, and a halt comment carrying the failure
  reason — and its title still reads `feat: <desc>`.
- Given the same PR is escalated a second time for a later HALT, when escalation runs, then the
  halt comment is edited in place (one marked comment, not two) and the label is not duplicated.
- Given a halted PR carries the label, when an operator lists open PRs, then the halted branch is
  distinguishable from live ones by the label alone, without reading the title or body.

#### Negative Paths
- Given the branch has commits but **no** OPEN PR yet (the HALT preceded SHIP entry), when
  escalation runs, then it creates the placeholder exactly as it does today — and the next dispatch
  repairs that PR into a usable implementation PR via Story 1 and Story 3, so the retry is not
  blocked.
- Given the branch has **zero** commits over base, when a HALT escalates, then no PR is created, no
  label is applied, and no comment is posted.
- Given the branch's push fails during escalation, when escalation runs, then no partial PR is
  created and no label or comment is written.
- Given the label API call fails, when escalation runs, then the halt comment is still posted (the
  failure reason is never lost because a label write failed).
- Given the PR body already contains the marker, when escalation runs again, then the marker is not
  appended a second time.
- Given the PR was closed by a human between build and escalation, when escalation runs, then no
  write is attempted against the closed PR and the outcome is recorded.

### Done When
- [ ] Escalating against an existing `feat:` PR leaves its title and body prose unmodified while
      adding label, marker, and comment.
- [ ] No code path creates a PR titled `needs-remediation: …` when a PR already exists for the
      branch.
- [ ] Two consecutive HALTs on the same PR yield exactly one marked halt comment and one label.

---

## Story 3: Resume clears the halt state atomically and keeps the PR a draft

**Requirement:** OUT-5, OUT-3 / `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`

As an operator, I want clearing the HALT and letting the daemon re-dispatch to be sufficient, so
that I never hand-edit a PR title, body, or label to unblock a build.

### Acceptance Criteria

#### Happy Path
- Given a branch whose PR carries the `needs-remediation` label and the body marker, when the daemon
  re-dispatches the feature after the HALT marker is cleared, then both the label and the body
  marker are removed before the first step that consumes the retained PR runs.
- Given the clear has run, when the PR is re-read, then `isDraft` is still `true` — the clear never
  flips the PR ready for review.
- Given the clear has run, when the PR thread is read, then the halt comment has been superseded in
  place with a resolution note, so the halt narrative is preserved rather than deleted.

#### Negative Paths
- Given the label removal cannot be confirmed by re-read, when the clear runs, then it retries with
  backoff and reports `partial` rather than success, and the next dispatch retries the clear.
- Given the body-marker removal cannot be confirmed, when the clear runs, then the outcome is
  `partial` and success is **not** reported — a marker left behind is never treated as cleared.
- Given GitHub is unreachable, when the clear runs, then it reports an unavailable outcome, logs one
  line, and does not throw into the dispatch loop.
- Given the PR carries the label but **no** body marker, when the clear runs, then the label is
  still removed (a partially-cleared PR converges rather than sticking).
- Given two dispatches race on the same PR, when both run the clear, then the result is one cleared
  PR and one resolution comment — no duplicated comment and no error.
- Given the halt is **not** in fact resolved (the HALT marker is still present), when the daemon
  declines to re-dispatch, then no clear is attempted and the PR retains its halt state.

### Done When
- [ ] After a re-dispatch, the PR has neither the `needs-remediation` label nor the body marker.
- [ ] After a re-dispatch, the PR is still a draft.
- [ ] An unconfirmed removal of either facet yields a `partial` outcome, never a success outcome.
- [ ] The PR thread carries exactly one marked halt comment, superseded to a resolution note.

---

## Story 4: The reconciliation sweep does not re-heal a cleared PR

**Requirement:** OUT-5 / `adr-2026-08-09-halt-state-clear-is-marker-and-label-atomic`

As the daemon, I want the halt-PR sweep and the resume-time clear to agree, so that a resumed build
is not silently re-labelled back into a halted state on the next tick.

### Acceptance Criteria

#### Happy Path
- Given a PR whose halt state was cleared at resume, when `reconcileHaltPrs` next runs, then the PR
  is not in the marked set, no write is issued against it, and it keeps its `feat:` title, absent
  label, and draft status.
- Given a PR that is genuinely still halted (marker present, feature not resumed), when the sweep
  runs, then it continues to heal that PR back to draft + labelled, exactly as today.
- Given a PR whose feature has shipped (a committed shipped record on its head branch), when the
  sweep runs, then it clears the marking as it does today — this behavior is unchanged.

#### Negative Paths
- Given a resume-time clear removed the label but the marker removal failed, when the sweep next
  runs, then the sweep re-heals the label (correctly — the PR still declares itself halted) and the
  next dispatch's clear retries; the system converges rather than oscillating indefinitely.
- Given the sweep's PR enumeration fails, when it runs, then it no-ops for that tick and no PR is
  mutated.
- Given the sweep and a resume-time clear run concurrently against the same PR, when both complete,
  then the final observed state is consistent (either fully cleared or fully halted) and neither
  path throws.

### Done When
- [ ] An acceptance test clears a PR's halt state, ticks `reconcileHaltPrs`, and asserts zero
      mutating GitHub calls against that PR.
- [ ] The same test asserts the PR still has no `needs-remediation` label after the tick.
- [ ] A still-halted PR is unaffected by this change — its existing heal behavior is asserted
      unchanged.

---

## Story 5: A branch already carrying a placeholder is recoverable without hand-editing

**Requirement:** OUT-1, OUT-2 / `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`

As an operator with branches already stuck in the old shape (#1395, #1412), I want the fix to
recover them, so that shipping this change does not leave existing work stranded.

### Acceptance Criteria

#### Happy Path
- Given a branch whose only OPEN PR is a placeholder titled `needs-remediation: <branch> — manual
  remediation required` with the label and marker, when the feature is re-dispatched after its HALT
  marker is cleared, then that PR is adopted, retitled to `feat: <desc>`, stripped of the marker and
  label, and left as a draft.
- Given the adopted PR's body is the halt banner boilerplate, when adoption runs, then the body is
  floored to the implementation template rather than left reading "manual remediation is required".
- Given the feature came from an intake issue, when adoption runs, then the issue reference is
  injected exactly once and remains inert until merge.

#### Negative Paths
- Given the placeholder was already partially rehabilitated by a human (title fixed, label still
  present), when adoption runs, then only the remaining facet is repaired and the hand-written title
  is left untouched.
- Given adoption runs twice, when the second run executes, then no mutation is issued and exactly
  one resolution comment exists.
- Given the PR state read fails, when adoption runs, then it skips the repair, logs one line, and
  does not throw.
- Given the branch's only PR is CLOSED or MERGED, when the feature is re-dispatched, then that PR is
  not adopted as the retained PR and the conductor does not rewrite it.

### Done When
- [ ] A branch in the #1412 shape reaches a usable `feat:` draft PR through re-dispatch alone, with
      no manual `gh pr edit` of title, body, or labels.
- [ ] A hand-repaired title survives adoption unchanged.
- [ ] A closed or merged PR is never adopted or rewritten.

---

## Story 6: Recovery paths are eligible again once the implementation PR is ready

**Requirement:** OUT-3 / `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`

As the daemon, I want a resumed feature's PR to re-enter the recovery machinery once it ships, so
that a branch that halted once is not permanently excluded from ci-fix and the mergeable sweep.

### Acceptance Criteria

#### Happy Path
- Given a PR whose halt state was cleared and which `finish` has flipped ready for review, when the
  mergeable sweep evaluates it, then it is a resolution candidate and the `mergeable` label is no
  longer withheld.
- Given the same ready PR has failing CI, when ci-fix eligibility is evaluated, then it is eligible
  for dispatch (the sticky-label gate no longer rejects it).
- Given a PR that is still a draft mid-build, when the sweep evaluates it, then it is skipped for
  both autoresolve and ci-fix — an in-flight build is never acted on.

#### Negative Paths
- Given a PR that still carries the `needs-remediation` label, when eligibility is evaluated, then
  it remains ineligible for ci-fix and the `mergeable` label remains withheld — the sticky-label
  precedence is unchanged for genuinely halted PRs.
- Given the label was removed but the PR is still a draft, when the sweep evaluates it, then it is
  still skipped — draft-ness alone continues to gate the sweep.
- Given the PR is closed without merging, when the sweep evaluates it, then no recovery dispatch
  occurs.

### Done When
- [ ] A cleared + ready PR is observed as a ci-fix candidate in an acceptance test.
- [ ] A cleared + ready PR is not denied the `mergeable` label by the sticky-label rule.
- [ ] A still-labelled PR remains ineligible on both paths (existing behavior asserted unchanged).
- [ ] A cleared but still-draft PR is skipped by both paths.
