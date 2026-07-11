**Status:** Accepted

# Stories: engineer handoff write-back gh ENOENT fix

Technical track (tier S, no PRD). Source: intake issue jstoup111/ai-conductor#290.
Technical intent: the github-issues intake write-back must never depend on a
deleted working directory, and a failed write-back must be visible and actionable
instead of advisory-and-forgotten — while preserving FR-37 semantics (write-back
never blocks or reverts a delivered spec PR) and FR-38 de-dup (post once per
(sourceRef, status)).

---

## Story: Write-back gh calls run from a guaranteed-existing directory

**Requirement:** TR-1 (issue #290 — root cause)

As an operator handing off a spec from a per-idea worktree, I want the intake
write-back to succeed even after the worktree is removed, so that the originating
issue gets its PR comment and `engineer:handled` label without manual patching.

### Acceptance Criteria

#### Happy Path
- Given a github-issues adapter constructed fresh (no `poll()` ever called, as on
  the `engineer handoff` CLI path) and a registry containing the target repo with
  an existing local path, when `report(sourceRef, 'done', { prUrl })` runs, then
  every `gh` invocation it makes receives a cwd that exists on disk (the repo's
  registered path), and the comment + label calls are issued with `-R <owner/repo>`.
- Given the per-idea worktree has been removed and the process's original working
  directory no longer exists, when `reportDone` runs during `engineer handoff
  --source-ref`, then the issue comment and `engineer:handled` label calls are
  still attempted with an existing cwd and succeed when `gh` succeeds.

#### Negative Paths
- Given a `sourceRef` whose repo is NOT present in the registry, when `report()`
  runs, then it falls back to a directory that is guaranteed to exist (never a
  poll-cache value and never an unverified `process.cwd()`), still targets the
  issue via `-R <owner/repo>`, and does not throw.
- Given the registry read itself fails (e.g. unreadable registry file), when
  `report()` runs, then the failure is treated as advisory: no exception
  propagates to the handoff, and the failure-visibility behavior of TR-2 applies.

### Done When
- [ ] A unit test constructs the adapter with an injected GhRunner that records
      each call's `cwd`, calls `report(..., 'done', ...)` WITHOUT a prior `poll()`,
      and asserts every recorded cwd exists on disk and none equals a deleted
      worktree path.
- [ ] A regression test simulates the handoff sequence (worktree path removed
      before `reportDone`) and asserts the GhRunner is invoked (not short-circuited
      by `spawn gh ENOENT`) and the ledger reaches `done` with the prUrl.
- [ ] The `repoPaths.get(repo) ?? process.cwd()` fallback in
      `github-issues.ts` `report()` is gone from the write-back path (grep-verifiable).

---

## Story: A failed write-back is visible and actionable, never silent

**Requirement:** TR-2 (issue #290 — "Expected" clause)

As an operator, I want a failed issue write-back to tell me exactly how to finish
it by hand and to be recorded on the ledger entry, so that a delivered spec PR
never silently strands its originating issue without link or label.

### Acceptance Criteria

#### Happy Path
- Given `gh` fails while commenting the PR URL on the originating issue, when
  `reportDone` completes during `engineer handoff --source-ref owner/repo#N`, then
  stderr contains the concrete remediation commands with real values substituted —
  `gh issue comment N --repo owner/repo --body "Spec PR opened: <prUrl>"` and the
  REST label call `gh api repos/owner/repo/issues/N/labels -f "labels[]=engineer:handled"`
  — and the ledger entry advances to `done` carrying the prUrl AND a
  writeback-pending marker.
- Given the write-back failed, when the handoff finishes, then its exit code is
  still 0 and the `{ "kind": "pr-opened", "url": ... }` JSON output is unchanged
  (FR-37: the spec PR is the real artifact).

#### Negative Paths
- Given the issue comment succeeds but the label application fails (partial
  failure), when `reportDone` completes, then stderr contains the remediation
  command for the label step, and the ledger entry carries the writeback-pending
  marker (a partially-completed write-back is not reported as clean).
- Given the ledger write itself fails while recording the writeback-pending
  marker, when `reportDone` completes, then no exception propagates (advisory
  semantics preserved) and stderr still carries the remediation commands.

### Done When
- [ ] A unit test with a GhRunner that rejects on `issue comment` asserts stderr
      output contains both fully-substituted remediation commands (issue number,
      repo, prUrl) and the ledger entry equals `done` + prUrl + writeback-pending.
- [ ] A unit test for the partial-failure case (comment resolves, label rejects)
      asserts the pending marker is set and remediation output covers the label step.
- [ ] A CLI-level test of `engineer handoff --source-ref` with a failing write-back
      asserts exit code 0 and unchanged pr-opened JSON on stdout.

---

## Story: Successful write-back stays clean and clears a stale pending marker

**Requirement:** TR-3 (regression guard + recovery)

As an operator, I want a normal, successful write-back to look exactly like it
does today, and a later successful retry to clear the pending marker, so the
new failure plumbing adds no noise and pending never sticks after recovery.

### Acceptance Criteria

#### Happy Path
- Given `gh` succeeds for comment and label, when `reportDone` runs, then stderr
  contains no remediation text, the ledger entry is `done` with the prUrl and NO
  writeback-pending marker, and the FR-38 posted-marker de-dup still suppresses a
  second post for the same (sourceRef, status).
- Given a ledger entry carrying a writeback-pending marker from a prior failed
  run, when a later `report(..., 'done', ...)` for the same sourceRef succeeds,
  then the pending marker is cleared on the ledger entry.

#### Negative Paths
- Given a repeated `report(sourceRef, 'done')` in the same process after a
  successful post, when it runs, then no duplicate gh calls are made (FR-38
  unchanged by the cwd/visibility changes).

### Done When
- [ ] Existing github-issues write-back unit tests pass unmodified (or with
      mechanical-only updates), demonstrating no behavior change on success.
- [ ] A test seeds a ledger entry with the pending marker, runs a successful
      `reportDone`, and asserts the marker is cleared while status/prUrl are intact.
- [ ] A de-dup test asserts call counts to the GhRunner are unchanged from the
      pre-fix behavior on repeated report() invocations.
