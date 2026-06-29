# Stories: Daemon PR Labeling

**Status:** Accepted
**Spec:** .docs/specs/2026-06-29-daemon-pr-labels.md
**Tier:** Medium

Persona: **the engineer** — the human operator who reviews the daemon's output and triages its PRs.

---

## Story: Recognize an irrecoverable daemon build failure

**Requirement:** FR-1, FR-8

As the engineer, I want the daemon to recognize when an autonomous build has irrecoverably
failed so that the failure can be surfaced for me instead of silently parked.

### Acceptance Criteria

#### Happy Path
- Given the conductor is in daemon/auto mode, when the BUILD step exhausts its retries without
  completing, then the run is classified as an irrecoverable build failure and the failure-
  surfacing behavior is triggered.
- Given an irrecoverable build failure, when surfacing runs, then the existing local HALT marker
  is still written first and the run still parks exactly as it does today.

#### Negative Paths
- Given the conductor is in **interactive** mode, when BUILD retries are exhausted, then the
  failure-surfacing behavior does NOT run (no push/PR/comment/label) and the existing interactive
  recovery path is used unchanged.
- Given a daemon run where BUILD **succeeds** (or a non-build step fails), when the run proceeds,
  then failure-surfacing is NOT triggered.
- Given an irrecoverable build failure where the surfacing step itself throws, when the run
  finishes handling the failure, then the HALT marker and run-state are still written and the run
  returns cleanly (failure never escalates into a crash). [cross-ref FR-7]

### Done When
- [ ] Surfacing is invoked only on the auto-mode BUILD retries-exhausted path, gated on `mode === 'auto'` and `step === 'build'`
- [ ] HALT marker + state write happen before/independent of surfacing; an exception in surfacing does not prevent them
- [ ] An interactive-mode build failure produces zero GitHub side effects (asserted by test)

---

## Story: Open a draft needs-remediation PR when commits exist

**Requirement:** FR-2, FR-4

As the engineer, I want a failed build that produced commits to appear as a draft PR labeled
`needs-remediation` so that I can see the stranded work and know it needs me.

### Acceptance Criteria

#### Happy Path
- Given an irrecoverable build failure and the feature branch has ≥1 commit ahead of the base,
  when surfacing runs, then the branch is pushed and a **draft** PR is opened for it.
- Given the draft PR is opened, when surfacing completes, then the PR carries the
  `needs-remediation` label (the label is created on the repo first if it does not yet exist).

#### Negative Paths
- Given the `needs-remediation` label does not exist on the repo, when surfacing applies it, then
  the label is created idempotently and applied — a pre-existing label does not cause an error.
- Given the branch has commits but `git push` fails (e.g. no remote / auth), when surfacing runs,
  then no PR is created, the failure is logged, and the run still parks (no throw). [cross-ref FR-7]
- Given `gh pr create` fails after a successful push, when surfacing runs, then the failure is
  logged, no comment/label step is attempted against a non-existent PR, and the run still parks.
- Given a base ref that cannot be determined, when counting commits, then surfacing derives the
  default branch via origin's HEAD (never hardcodes `main`) and degrades gracefully if still unknown.

### Done When
- [ ] PR is created with `--draft` and labeled `needs-remediation`
- [ ] Label-create is idempotent (`--force`/create-then-ignore-exists), verified by test
- [ ] Push failure → returns without a PR, no throw; asserted by a fake-runner test
- [ ] Base branch is derived, not hardcoded

---

## Story: Comment the failure reason on the needs-remediation PR

**Requirement:** FR-3

As the engineer, I want the PR to carry a comment explaining *why* the build failed so that I can
triage without digging through daemon logs or the worktree.

### Acceptance Criteria

#### Happy Path
- Given a needs-remediation PR (new or reused), when surfacing runs, then a comment is posted
  containing the failure reason and the relevant error text, and stating that manual remediation
  is required.

#### Negative Paths
- Given the PR exists but `gh pr comment` fails, when surfacing runs, then the failure is logged
  and swallowed — the run still parks and the label (if applied) remains. [cross-ref FR-7]
- Given a very long error string, when the comment is built, then it is included in a bounded/
  trimmed form (no failure to post due to size).
- Given both the comment and the label steps are attempted, when the comment step fails, then the
  label step is still attempted independently (one failing step does not abort the others).

### Done When
- [ ] Comment body contains the failure reason + trimmed error + "manual remediation required"
- [ ] Comment failure is swallowed and logged; does not block parking or other steps (test)
- [ ] Comment is the prioritized artifact — surfacing attempts it whenever a PR is available

---

## Story: Reuse an existing PR instead of creating a duplicate

**Requirement:** FR-5

As the engineer, I want a re-dispatched failure to update the existing PR rather than open a
second one so that my PR list isn't cluttered with duplicates.

### Acceptance Criteria

#### Happy Path
- Given an open PR already exists for the feature branch, when surfacing runs, then that PR is
  reused — the failure comment and `needs-remediation` label are applied to it and no new PR is
  created.

#### Negative Paths
- Given the existence check (`gh pr view <branch>`) fails or returns no PR, when surfacing runs,
  then it falls back to attempting `gh pr create` (does not crash on a missing PR).
- Given a prior PR for the branch is already merged/closed, when surfacing runs, then it does not
  comment on the closed PR as if reopening it; behavior degrades to "create new / log" rather than
  resurrecting a closed PR.

### Done When
- [ ] Existing-open-PR path applies comment+label and skips `pr create` (test)
- [ ] Missing/failed existence check falls through to create without throwing
- [ ] No duplicate PR is created when one is already open for the branch

---

## Story: No GitHub artifacts when a failed build has no commits

**Requirement:** FR-6

As the engineer, I want a build that failed before producing anything to stay a local signal only
so that empty PRs aren't opened.

### Acceptance Criteria

#### Happy Path
- Given an irrecoverable build failure and the branch has **zero** commits ahead of the base, when
  surfacing runs, then no push, PR, comment, or label is produced and the function returns early.
- Given that case, when the run finishes, then the local HALT marker + daemon dashboard/logs remain
  the only signal — unchanged from today.

#### Negative Paths
- Given the commit count cannot be computed (git error), when surfacing runs, then it treats the
  state conservatively (no spurious empty PR) and logs the condition rather than throwing.
- Given exactly one trivial/empty commit vs. zero commits, when counting, then the "≥1 commit"
  boundary is evaluated correctly (off-by-one guarded by test).

### Done When
- [ ] Zero commits → zero GitHub calls (asserted by fake-runner test)
- [ ] Git-error path does not open a PR and does not throw
- [ ] Commit-count boundary (0 vs 1) is covered by a test

---

## Story: Failure surfacing is best-effort and never blocks the run

**Requirement:** FR-7

As the engineer, I want the surfacing side-effects to never disrupt the daemon so that a GitHub
outage can't cost me a parked-feature record or crash the run.

### Acceptance Criteria

#### Happy Path
- Given any individual GitHub step (push, create, comment, label-create, label-apply) fails, when
  surfacing runs, then that failure is logged and swallowed and the remaining steps that can still
  run are attempted.
- Given surfacing finishes (success or partial failure), when the run continues, then the feature
  is parked/halted exactly as today and recorded in the daemon log.

#### Negative Paths
- Given `gh` is unauthenticated or the network is down, when surfacing runs, then it no-ops
  gracefully and the run parks normally.
- Given surfacing throws an unexpected exception, when the conductor handles the build failure,
  then the exception is caught at the call site and the HALT/state writes still complete.
- Given every step fails, when surfacing returns, then it returns without a PR url and without
  throwing.

### Done When
- [ ] Each step independently try/caught; a failure in one does not abort the rest (test per step)
- [ ] Conductor integration test: surfacing stubbed to throw → HALT file still exists, state written, run returns cleanly
- [ ] Every swallowed failure is logged to the daemon log

---

## Story: Only fully-shipped PRs are eligible for the mergeable label

**Requirement:** FR-9, FR-15

As the engineer, I want only successfully-shipped features' PRs to be considered for `mergeable`
so that in-flight or failed work is never mislabeled as ready.

### Acceptance Criteria

#### Happy Path
- Given a feature reaches a `done` outcome with a PR url in daemon mode, when the feature completes,
  then its PR is enrolled for `mergeable` tracking.
- Given the daemon is the runtime, when tracking/labeling runs, then it runs in daemon/auto mode
  only.

#### Negative Paths
- Given a feature outcome is `halted` or `error`, when it completes, then its PR (if any) is NOT
  enrolled for `mergeable` tracking.
- Given a `done` feature with **no** PR url (e.g. kept locally / no remote), when it completes, then
  nothing is enrolled.
- Given enrollment is attempted but writing the tracking record fails, when it completes, then the
  failure is logged and swallowed and the feature still tears down/marks processed normally.
- Given interactive mode, when a feature completes, then no `mergeable` tracking/sweep runs.

### Done When
- [ ] Only `done` + has-PR-url features are enrolled (test across done/halted/error and no-url)
- [ ] Enrollment happens before worktree teardown and is best-effort (does not block teardown)
- [ ] No sweep/labeling occurs in interactive mode

---

## Story: Apply mergeable when a tracked PR is genuinely ready

**Requirement:** FR-10, FR-14

As the engineer, I want a tracked PR to get the `mergeable` label once CI is green and there are no
conflicts so that I can filter to ready-to-merge work — even though CI isn't done when the PR opens.

### Acceptance Criteria

#### Happy Path
- Given a tracked, open PR with no merge conflicts and all CI checks passing, when the sweep
  evaluates it, then it adds the `mergeable` label (creating the label on the repo first if needed).
- Given a tracked, open PR with **no required checks at all**, when the sweep evaluates it, then it
  is treated as passing and labeled `mergeable`.
- Given CI is not finished at PR-open time, when the sweep re-evaluates the PR on a later pass, then
  the label is applied once the PR has become ready (determination is repeated over time, not once).

#### Negative Paths
- Given a tracked PR whose merge state is still being computed (`UNKNOWN`), when the sweep evaluates
  it, then it does NOT apply the label this pass and re-checks next pass (omit rather than assert).
- Given a tracked PR with a failing or pending check, when the sweep evaluates it, then it does NOT
  apply `mergeable`.
- Given a tracked PR with merge conflicts, when the sweep evaluates it, then it does NOT apply
  `mergeable`.
- Given the PR-state read (`gh pr view --json …`) fails, when the sweep evaluates it, then it
  logs and skips that PR without throwing and continues with the other tracked PRs.

### Done When
- [ ] Mergeable = open AND no conflicts AND no failing/pending checks (zero checks = pass), encoded and unit-tested
- [ ] `UNKNOWN` merge state → no label this pass (test)
- [ ] Sweep runs repeatedly (daemon startup + after each feature + per poll tick) so late CI is caught
- [ ] A read failure on one PR does not abort the sweep of the others

---

## Story: Keep the mergeable label in sync with reality

**Requirement:** FR-11

As the engineer, I want the `mergeable` label removed when a PR stops being mergeable so that the
filter never lies to me.

### Acceptance Criteria

#### Happy Path
- Given a tracked PR currently labeled `mergeable`, when a later sweep finds it has new conflicts,
  a broken/pending check, or is no longer open, then the `mergeable` label is removed.
- Given a tracked PR that lost the label after breaking, when a still-later sweep finds it green and
  conflict-free again, then `mergeable` is re-added.

#### Negative Paths
- Given a PR that is already in the correct labeled state, when the sweep runs, then it does not
  thrash (no redundant add/remove that produces noise) — the label only changes on an actual state
  change.
- Given the label-remove call fails, when the sweep runs, then the failure is logged and swallowed
  and the rest of the sweep proceeds.
- Given two sweeps run close together (startup + post-feature), when they evaluate the same PR, then
  the outcome is idempotent (no duplicate labels, no flapping).

### Done When
- [ ] Non-mergeable transition removes the label; re-ready re-adds it (test both directions)
- [ ] Idempotent: re-running the sweep on an unchanged PR makes no change
- [ ] Remove-failure is swallowed; sweep continues

---

## Story: Never label a needs-remediation PR as mergeable

**Requirement:** FR-12

As the engineer, I want a `needs-remediation` PR to never carry `mergeable` so that a failed build
can't masquerade as ready-to-merge.

### Acceptance Criteria

#### Happy Path
- Given a tracked PR carrying the `needs-remediation` label, when the sweep evaluates it, then it
  never adds `mergeable`, and if `mergeable` is somehow present it is removed.

#### Negative Paths
- Given a PR that is technically green/conflict-free but carries `needs-remediation`, when the sweep
  evaluates it, then `mergeable` is still withheld (the exclusion takes precedence over the
  green-check result).
- Given the label list cannot be read for a PR, when the sweep evaluates it, then it errs on the
  side of NOT adding `mergeable` (omit rather than wrongly assert).

### Done When
- [ ] `needs-remediation` present → `mergeable` never added, and stripped if present (test)
- [ ] Exclusion is checked before the add decision

---

## Story: Stop tracking merged or closed PRs

**Requirement:** FR-13

As the engineer, I want merged/closed PRs dropped from tracking so that the watch list stays small
and the daemon doesn't keep poking dead PRs.

### Acceptance Criteria

#### Happy Path
- Given a tracked PR whose state is `MERGED` or `CLOSED`, when the sweep evaluates it, then it is
  removed from the tracking set and no further labeling is attempted for it.

#### Negative Paths
- Given a tracked PR that 404s / was deleted, when the sweep evaluates it, then it is dropped from
  tracking (treated as gone) rather than retried forever.
- Given the tracking store is rewritten after pruning and the write fails, when the sweep runs, then
  the failure is logged and swallowed (next sweep re-derives state); no crash.
- Given a PR is merged between two sweeps, when the later sweep runs, then it does not attempt to
  add/remove labels on the merged PR.

### Done When
- [ ] MERGED/CLOSED/404 PRs pruned from the tracking set (test)
- [ ] Tracking-store rewrite failure is swallowed
- [ ] Pruning is idempotent across repeated sweeps

---

## Story: Clear the failure signal when a re-kicked feature succeeds

**Requirement:** FR-16

As the engineer, I want a feature that failed, got re-kicked, and then succeeded to drop its stale
`needs-remediation` draft state so that it isn't permanently barred from `mergeable` and its PR
doesn't lie about needing me.

### Acceptance Criteria

#### Happy Path
- Given a feature whose PR carries `needs-remediation` and is a draft, when that feature later
  reaches a `done` outcome on the same branch, then the daemon removes the `needs-remediation`
  label and marks the PR ready-for-review (un-drafts) before/at mergeable enrollment.
- Given that cleared PR, when the next sweep evaluates it and it is green + conflict-free, then it
  is labeled `mergeable` normally (FR-12 no longer blocks it).

#### Negative Paths
- Given a `done` feature whose PR does **not** carry `needs-remediation` (never failed), when it is
  enrolled, then no un-draft/label-removal is attempted unnecessarily (no-op, no error).
- Given the label-removal or un-draft (`gh pr ready`) call fails, when enrollment runs, then the
  failure is logged and swallowed — enrollment and teardown still proceed (best-effort). The next
  sweep will still withhold `mergeable` (FR-12) until the label is actually gone, so the label never
  lies in the failure direction.
- Given a feature that ends `halted`/`error` (not `done`), when it completes, then the failure
  signal is **not** cleared (only a genuine success clears it).

### Done When
- [ ] On `done` enrollment, a PR carrying `needs-remediation` has the label removed and is un-drafted (`gh pr ready`), best-effort
- [ ] Clear-on-success is a no-op when the PR has no `needs-remediation` label
- [ ] A failed clear is swallowed; FR-12 keeps `mergeable` withheld until the label is truly gone (no false "mergeable")
- [ ] Only `done` (not halted/error) triggers the clear

## Coverage map

| FR | Story |
|----|-------|
| FR-1 | Recognize irrecoverable failure |
| FR-2 | Open draft needs-remediation PR |
| FR-3 | Comment failure reason |
| FR-4 | Open draft needs-remediation PR |
| FR-5 | Reuse existing PR |
| FR-6 | No commits → no artifacts |
| FR-7 | Best-effort / never blocks |
| FR-8 | Recognize irrecoverable failure (daemon-only) |
| FR-9 | Only fully-shipped PRs eligible |
| FR-10 | Apply mergeable when ready |
| FR-11 | Keep mergeable in sync |
| FR-12 | Never label needs-remediation as mergeable |
| FR-13 | Stop tracking merged/closed PRs |
| FR-14 | Apply mergeable when ready (re-checked over time) |
| FR-15 | Only fully-shipped PRs eligible (daemon-only, best-effort) |
| FR-16 | Clear failure signal when a re-kicked feature succeeds |
