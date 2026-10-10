**Status:** Accepted

# Stories: Shipped PRs get a re-examined readiness verdict (#438)

Technical track (no PRD). Acceptance derives from the approved
`adr-2026-10-09-shipped-pr-readiness-verdict` and the approved architecture review.
Scope boundary: daemon-shipped PRs in the mergeable watch registry only. Spec PRs and manual or
unledgered PRs are out of scope.

Terms used below: a **watched PR** is a PR whose entry is in `.daemon/mergeable-watch.jsonl`; a
**sweep tick** is one run of the daemon's mergeable sweep (startup or idle poll); the **grace
period** is 30 minutes from when the sweep first observed the PR's current head commit.

## Story 1: Every open watched PR gets exactly one readiness verdict per tick

**Requirement:** ADR D1, D2, D3

As the daemon operator, I want every open shipped PR classified into exactly one readiness verdict
on every sweep tick, so that no shipped PR can sit in a state nothing acts on or reports.

### Acceptance Criteria

#### Happy Path
- Given an open watched PR that is not a draft, reads `MERGEABLE` with `mergeStateStatus` `CLEAN`, base `main`, and all checks on its head commit succeeded, when a sweep tick runs, then its verdict is `ready` and it receives the `mergeable` label exactly as before this change.
- Given the same PR but with `mergeStateStatus` `BLOCKED` (awaiting required review) or `BEHIND`, when a sweep tick runs, then its verdict is still `ready`; only `DIRTY` is treated as a conflict.
- Given an open watched PR that is a draft and also reads `CONFLICTING` with failed checks, when a sweep tick runs, then its verdict is `draft` (draft takes precedence over every other verdict) and it is not offered to autoresolve or ci-fix.
- Given an open watched PR that reads `CONFLICTING` and has failed checks, when a sweep tick runs, then its verdict is `conflicting` (conflict takes precedence over CI state).
- Given an open watched PR whose checks on the head commit are still queued or running, when a sweep tick runs, then its verdict is `ci-pending`, nothing is dispatched for it, `needs-remediation` is not added, and an existing `mergeable` label is removed exactly as before this change.

#### Negative Paths
- Given a watched PR that GitHub reports as MERGED, CLOSED, or not found, when a sweep tick runs, then it receives no readiness verdict and follows the existing shipped-record / prune handling unchanged.
- Given a watched PR whose state read fails (network error or non-zero `gh` exit), when a sweep tick runs, then it receives no readiness verdict, the entry is kept in the registry, and the sweep continues to the next entry.
- Given an open, non-draft watched PR whose read returns a `mergeStateStatus` value outside GitHub's documented set (`BEHIND`, `BLOCKED`, `CLEAN`, `DIRTY`, `DRAFT`, `HAS_HOOKS`, `UNKNOWN`, `UNSTABLE`), when a sweep tick runs, then its verdict is `indeterminate` (never `ready`), no GitHub operation of any kind is issued for it, nothing is dispatched for it, and no `escalationCause` is recorded on its entry.

### Done When
- [ ] A unit test table covers every verdict and every precedence collision (draft over conflicting, conflicting over ci-failing, ci-failing over ci-pending) and asserts exactly one verdict per input.
- [ ] Removing a verdict's route from the route dispatch fails the TypeScript build (no `default` branch).
- [ ] A sweep-level test with one PR per verdict asserts one route invocation per PR and none for MERGED, CLOSED, not-found, or read-failure entries.

## Story 2: A lazily-UNKNOWN mergeability is re-read before it is judged

**Requirement:** ADR D1, D2, D3

As the daemon operator, I want a conflicting shipped PR that GitHub first reports as `UNKNOWN` to
reach conflict resolution, so that GitHub's lazy mergeability computation cannot hide a conflict.

### Acceptance Criteria

#### Happy Path
- Given an open, non-draft watched PR whose first read returns `mergeable` `UNKNOWN` and whose second read in the same tick returns `CONFLICTING`, when a sweep tick runs, then its verdict is `conflicting` and it becomes an autoresolve candidate in that same tick.
- Given an open, non-draft watched PR whose first read returns `mergeable` `MERGEABLE` and `mergeStateStatus` `DIRTY`, when a sweep tick runs, then its verdict is `conflicting`.

#### Negative Paths
- Given an open, non-draft watched PR whose first and second reads both return `mergeable` `UNKNOWN`, when a sweep tick runs, then its verdict is `indeterminate`, no label is changed and nothing is dispatched for it, and the next tick re-reads it.
- Given an open watched PR whose first read returns `UNKNOWN` and whose re-read fails, when a sweep tick runs, then its verdict is `indeterminate` and the entry is kept in the registry.
- Given an open watched PR whose first read returns `MERGEABLE`, when a sweep tick runs, then no re-read is issued for it (exactly one PR read).

### Done When
- [ ] A test with a stubbed tracker returning `UNKNOWN` then `CONFLICTING` asserts two reads and one autoresolve candidate.
- [ ] A test with `UNKNOWN` twice asserts two reads, verdict `indeterminate`, and zero label or dispatch calls.
- [ ] A test with a first-read `MERGEABLE` asserts exactly one read.

## Story 3: A shipped PR whose CI never ran is surfaced after a grace period

**Requirement:** ADR D2, D3, D4, D7

As the daemon operator, I want a shipped PR into `main` that still has no check runs after the
grace period flagged for me, so that a PR whose CI never started does not sit unnoticed.

### Acceptance Criteria

#### Happy Path
- Given an open, non-draft, mergeable watched PR with base `main`, zero check runs on its head commit, and that head commit first observed more than 30 minutes ago, when a sweep tick runs, then its verdict is `no-checks` and the `needs-remediation` label is added to the PR.
- Given that PR already carries `needs-remediation`, when the next sweep tick runs with the same state, then no label call is made (the label is applied only on the absent-to-present transition).
- Given a watched PR's head commit is observed for the first time, when a sweep tick runs, then the head commit and the time it was first observed are saved in that PR's watch entry and survive a daemon restart.
- Given a PR the sweep labelled `needs-remediation` for `no-checks`, when its checks later register and all succeed, then on the next sweep tick the sweep removes `needs-remediation`, its verdict is `ready`, and it receives the `mergeable` label no later than the following tick.

#### Negative Paths
- Given an open watched PR with base `main`, zero check runs, and its head commit first observed 10 minutes ago, when a sweep tick runs, then its verdict is `ci-pending` and no label is added.
- Given an open watched PR whose base is not `main` (for example a stacked child PR) with zero check runs for more than 30 minutes, when a sweep tick runs, then its verdict is `ci-pending`, never `no-checks`, and no label is added.
- Given a watched PR previously observed with head commit A for more than 30 minutes, when a new head commit B is pushed and a sweep tick runs, then the grace period restarts from B's first observation and the verdict is `ci-pending`.
- Given a `no-checks` PR, when the sweep handles it, then no GitHub operation other than the `needs-remediation` label add and the existing `mergeable` label reconcile is issued: no push, no PR close or reopen, no workflow dispatch, no re-run request.
- Given a watch entry written before this change (no head-commit fields), when a sweep tick runs, then the entry parses, the current head commit is recorded as first observed now, and the verdict is `ci-pending`.
- Given the label add fails, when the sweep handles a `no-checks` PR, then the failure is logged, the entry is kept, and the next tick retries the label add.
- Given a PR the sweep labelled for `no-checks` whose checks later fail, when a sweep tick runs, then the sweep removes `needs-remediation` and the PR becomes eligible for the existing ci-fix path on that tick or the next.
- Given a PR carrying `needs-remediation` that the sweep did not add for a readiness reason (halt presentation, ci-fix exhaustion, or a human), when its verdict becomes `ready`, then the sweep does not remove the label and `mergeable` stays absent.
- Given removing the readiness label fails on three consecutive ticks, when the third attempt fails, then the sweep stops retrying, logs the cap, and leaves the label for a human.

### Done When
- [ ] A test with a fake clock asserts `ci-pending` at 29 minutes and `no-checks` plus one label add at 31 minutes.
- [ ] A test asserts a non-`main` base never yields `no-checks`.
- [ ] A test asserts a head-commit change resets the grace period.
- [ ] A test asserts the watch entry round-trips the head commit and first-observed time through `.daemon/mergeable-watch.jsonl`, and that a legacy entry without them parses.
- [ ] A test asserts a `no-checks` → `ready` sequence ends with `needs-remediation` removed and `mergeable` added, and that a label without the recorded readiness cause is never removed.
- [ ] `GITHUB_OPERATION_REGISTRY` gains no new operation in this change.

## Story 4: A shipped PR that went back to draft is surfaced, never acted on

**Requirement:** ADR D2, D3, D4

As the daemon operator, I want a shipped PR that has been converted back to draft flagged for me,
so that a PR the finish step marked ready but is no longer ready does not sit unnoticed.

### Acceptance Criteria

#### Happy Path
- Given an open watched PR that is a draft and does not carry `needs-remediation`, when a sweep tick runs, then its verdict is `draft` and the `needs-remediation` label is added once.

#### Negative Paths
- Given a `draft` PR that is also `CONFLICTING` and has failed checks, when a sweep tick runs, then it is not offered to autoresolve and not offered to ci-fix.
- Given a `draft` PR, when the sweep handles it, then the PR is never marked ready for review by the daemon.
- Given a `draft` PR that already carries `needs-remediation` (for example from a halt presentation), when a sweep tick runs, then no label call is made and no readiness cause is recorded, so the sweep never removes that label later.
- Given a PR the sweep labelled for `draft`, when a human marks it ready for review and its verdict becomes `ready`, then the sweep removes `needs-remediation` on that tick.
- Given a PR the sweep labelled for `draft` that now also carries the halt body marker, when its verdict leaves `draft`, then the sweep does not remove the label.

### Done When
- [ ] A sweep-level test asserts a draft PR gets one `needs-remediation` add, zero autoresolve or ci-fix dispatches, and zero `pull-request.ready` operations.

## Story 5: Readiness verdicts reach the daemon event ledger

**Requirement:** ADR D5

As the daemon operator, I want each shipped PR's readiness verdict recorded on the daemon event
ledger, so that every existing event consumer and `daemon status` can see it.

### Acceptance Criteria

#### Happy Path
- Given a running daemon and a watched PR whose verdict is `no-checks`, when a sweep tick runs, then `.daemon/events.jsonl` gains one `shipped_pr_readiness` event carrying the PR URL, feature slug, verdict, head commit, and the observed fields that decided it.
- Given that PR's verdict changes from `no-checks` to `ready` on a later tick, when that tick runs, then one new `shipped_pr_readiness` event with verdict `ready` is appended.
- Given a watched PR whose checks failed, when a sweep tick runs in the production daemon, then the sweep's existing `ci_failed` event is now present in `.daemon/events.jsonl`.

#### Negative Paths
- Given a watched PR whose verdict and head commit are unchanged since its last emitted event, when the next sweep tick runs, then no new `shipped_pr_readiness` event is appended.
- Given the same verdict but a new head commit, when a sweep tick runs, then a new event is appended.
- Given the event ledger write fails, when a sweep tick runs, then the sweep still completes its label and dispatch work for every entry.

### Done When
- [ ] `shipped_pr_readiness` is a member of the `ConductorEvent` union with typed fields.
- [ ] The production sweep binding in `daemon-cli.ts` passes `onEvent` to the daemon's global emitter, and a test proves the binding reaches the persisted ledger.
- [ ] A test over three ticks (`no-checks`, `no-checks`, `ready`) asserts exactly two events.

## Story 6: `daemon status` lists shipped PRs that are not ready

**Requirement:** ADR D6

As the daemon operator, I want `daemon status` to show each shipped PR that is not ready and why,
so that I can see stuck shipped work without reading logs.

### Acceptance Criteria

#### Happy Path
- Given the ledger's latest `shipped_pr_readiness` verdicts are `no-checks` for PR A, `ready` for PR B, and `draft` for PR C, when the operator runs `daemon status`, then that repo's output has a SHIPPED PRS section listing A with `no-checks` and C with `draft`, and not listing B.
- Given every watched PR's latest verdict is `ready`, when the operator runs `daemon status`, then the section reads that no shipped PRs need attention.

#### Negative Paths
- Given a repo with no `.daemon/events.jsonl`, when the operator runs `daemon status`, then the section reads that shipped-PR readiness is unknown and the command exits successfully.
- Given the ledger holds a malformed `shipped_pr_readiness` line, when the operator runs `daemon status`, then the malformed line is skipped and the remaining verdicts render.
- Given PR A's earlier event was `no-checks` and its latest is `ready`, when the operator runs `daemon status`, then A is not listed.

### Done When
- [ ] A renderer test over a fixture ledger asserts the listed PRs, the "none" line, and the "unknown" line.
- [ ] `daemon status` makes no GitHub call to render the section.
