**Status:** Accepted

# Stories: Daemon merged-PR guard on step retry (#358)

Technical track — acceptance criteria derive from issue jstoup111/ai-conductor#358 and
APPROVED ADR `adr-2026-07-09-mid-run-merged-pr-guard.md`. All Given/When/Then are against
observable engine behavior (markers, log lines, dispatched steps, ledger writes).

---

## Story: Kickback re-entry exits cleanly when the recorded PR is already merged

**Requirement:** TS-1 (issue #358 primary scenario)

As a daemon operator, I want a gate-failure retry to notice that the feature's recorded PR was
merged out-of-band, so that the daemon stops cleanly instead of rebuilding and re-auditing
already-shipped work.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode run with `pr_url` recorded in `.pipeline/conduct-state.json` and a gate
  failure that routes back to `build` (any of the five kickback routes: manual_test,
  build_review, prd_audit gap, finish remediation, architecture_review_as_built), when the
  guard queries the PR state and receives `MERGED`, then the rewind is NOT committed, no
  further step (`build`, `manual_test`, `prd_audit`, `architecture_review_as_built`, `rebase`)
  is dispatched, and the run terminates successfully.
- Given the same MERGED verdict, when the run terminates, then the worktree contains
  `.pipeline/finish-choice` with exact content `pr` and `.pipeline/DONE`, and
  `conduct-state.json` still carries the original `pr_url`.
- Given the same MERGED verdict, when the run terminates, then the daemon log contains a line
  matching `already shipped out-of-band` including the retained branch tip SHA.

#### Negative Paths
- Given the PR state query returns `OPEN`, when the kickback re-entry guard runs, then the
  rewind proceeds exactly as today (build is re-dispatched), and NO `.pipeline/finish-choice`
  and NO `.pipeline/DONE` are written by the guard.
- Given the PR state query returns `CLOSED` (closed without merge), when the guard runs, then
  the rewind proceeds unchanged — a closed PR is not shipped content — and no synthetic
  markers are written.
- Given the `gh` invocation fails (non-zero exit, network error, or rate limit), when the guard
  runs, then the failure is logged at debug level, the rewind proceeds unchanged, and the run
  does NOT halt — the guard must never be a new HALT source.
- Given `pr_url` is absent from `conduct-state.json` (first pass — finish never ran), when a
  kickback occurs, then the guard makes NO `gh` call and the rewind proceeds unchanged.
- Given a non-daemon (interactive) run with `pr_url` recorded, when a kickback occurs, then
  the guard is inactive: no `gh` call, behavior identical to today.

### Done When
- [ ] A daemon-mode engine test drives a gate-failure kickback with a fake GhRunner returning
      `MERGED` and asserts: no build re-dispatch, `.pipeline/finish-choice` == `pr`,
      `.pipeline/DONE` exists, `pr_url` unchanged, log line contains
      `already shipped out-of-band` + a 40-char SHA.
- [ ] Table-driven tests for verdicts `OPEN`, `CLOSED`, `NOTFOUND`, `UNKNOWN`, and a throwing
      GhRunner assert the rewind proceeds AND neither marker file exists afterward.
- [ ] A test with no `pr_url` and a call-counting fake GhRunner asserts zero gh invocations.

---

## Story: Rebase entry backstop catches a merge that lands mid-chain

**Requirement:** TS-2 (ADR insertion point 2)

As a daemon operator, I want the rebase step itself to re-check the recorded PR immediately
before rebasing, so that a merge landing after the kickback check (mid-chain) still cannot
produce the unresolvable duplicate-branch rebase HALT.

### Acceptance Criteria

#### Happy Path
- Given a daemon-mode run reaching `runRebaseStep` with `pr_url` recorded, when the guard
  queries the PR state and receives `MERGED`, then `performRebase` is NEVER invoked, no
  `.pipeline/HALT` is written, the synthetic verified-ship markers are written
  (`finish-choice` == `pr`, `DONE`), and the run terminates successfully.
- Given the MERGED verdict at rebase entry, when the run terminates, then the local feature
  branch still exists with its tip SHA unchanged (branch never deleted).

#### Negative Paths
- Given the PR state query returns `OPEN`, when `runRebaseStep` starts, then `performRebase`
  runs exactly as today, and a genuine conflict still produces the existing
  `.pipeline/HALT` behavior (the guard must not suppress legitimate rebase HALTs).
- Given the `gh` invocation fails at rebase entry, when the guard runs, then the failure is
  logged and `performRebase` proceeds — degraded behavior equals today's behavior.
- Given `pr_url` is absent, when `runRebaseStep` starts, then no `gh` call is made and the
  rebase proceeds unchanged.

### Done When
- [ ] An engine test enters `runRebaseStep` (daemon:true, isolated repo per existing rebase
      test pattern) with a fake GhRunner returning `MERGED` and asserts `performRebase` was
      not called (spy/injected), no HALT marker, both synthetic markers present, and the
      branch tip SHA is unchanged.
- [ ] A companion test with verdict `OPEN` and a conflicting branch asserts the existing
      conflict HALT still occurs (guard does not swallow real conflicts).

---

## Story: Synthetic verified-ship flows through the daemon-runner's existing ship path

**Requirement:** TS-3 (ADR side-effect ownership)

As a daemon operator, I want the guard's clean stop to register as a verified ship in the
daemon-runner, so that the processed-ledger marker is written by the existing machinery and
the slug is never re-dispatched.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose run ended via the guard (markers `finish-choice` == `pr`, `DONE`,
  `pr_url` present), when the daemon-runner reads the outcome, then `isVerifiedShip` passes
  and `markProcessed` writes `.daemon/processed/<slug>` containing the recorded `prUrl`.
- Given the processed marker exists, when the daemon next scans the backlog or a rekick runs,
  then the slug is skipped (existing dedup honors the marker).

> **Invariant exemption (conflict-check 2026-07-09, vs `daemon-false-ship-guard` Story 6):**
> the `finish-choice=pr` marker still always encodes *proven* ship evidence. The finish skill
> proves it via `gh pr view` + push-ancestry; the guard proves it via the live `MERGED` state
> of the recorded PR — the merge itself is the proof, mirroring the Story 5 repair-path
> exemption ("the ship is proven by the merged record itself"). Push-ancestry may legitimately
> NOT hold at guard time (mid-retry local commits); that does not weaken the invariant.

#### Negative Paths
- Given the guard observed a non-MERGED verdict and the run later halts for an unrelated
  reason, when the daemon-runner reads the outcome, then `isVerifiedShip` is false and NO
  processed marker is written (the guard's mere execution must not fabricate ship evidence).
- Given the guard fires on MERGED twice in one run (kickback guard then a second entry —
  idempotency), when markers are written, then repeated writes are harmless: identical marker
  content, single ledger entry, no duplicate cleanup errors.

### Done When
- [ ] A daemon-runner test feeds a guard-terminated worktree through `readOutcome` and asserts
      the verified-ship path runs (`markProcessed` called with the slug + prUrl) — reusing the
      existing daemon-runner test fixtures.
- [ ] A test asserts a halted (non-guard) outcome writes no processed marker.
- [ ] An idempotency test invokes the guard's stop path twice and asserts stable markers and a
      single ledger entry.

---

## Story: Rekick play-forward skips an out-of-band-merged feature

**Requirement:** TS-5 (conflict-check 2026-07-09 scope extension, operator-approved)

As a daemon operator, I want the rekick play-forward path to check the parked feature's
recorded PR before rebasing, so that a feature merged by hand while parked is retired cleanly
instead of re-halting on a duplicate-branch rebase conflict.

### Acceptance Criteria

#### Happy Path
- Given a halted worktree with `pr_url` recorded whose PR is `MERGED`, when the daemon rekick
  sweep plays it forward (`resumeRebaseFirst` path), then NO rebase is attempted, the
  processed marker `.daemon/processed/<slug>` is written with the recorded `prUrl`, the
  feature is not re-dispatched, and the log carries the `already shipped out-of-band` line.

#### Negative Paths
- Given the parked PR is `OPEN` (or `CLOSED`/`NOTFOUND`/`UNKNOWN`), when rekick plays forward,
  then behavior is byte-identical to today: the gated rebase-resolution flow runs (per
  `2026-07-05-rekick-gated-rebase-resolution`).
- Given the `gh` query fails at rekick, when play-forward runs, then the failure is logged and
  the existing flow proceeds — fail-open, no new HALT class.
- Given a halted worktree with NO `pr_url` recorded, when rekick plays forward, then no `gh`
  call is made and the existing flow proceeds unchanged.

### Done When
- [ ] A rekick test (existing daemon-rekick fixture pattern) with a fake GhRunner returning
      `MERGED` asserts: no `performRebase` call, processed marker written with prUrl, no
      re-dispatch, log line present.
- [ ] Companion table-driven tests for `OPEN`/gh-failure/no-pr_url assert byte-identical
      pass-through to the existing gated-resolution flow.

---

## Story: Guard cost and cadence stay bounded

**Requirement:** TS-4 (review risk register — API budget)

As the repo owner, I want the guard to make at most one PR-state query per checkpoint, so that
the fix never turns into background polling or burns GitHub API quota.

### Acceptance Criteria

#### Happy Path
- Given a full kickback-and-retry cycle with a non-MERGED PR, when the chain runs to the next
  gate, then the guard performed exactly one `gh pr view` at the kickback re-entry and exactly
  one at rebase entry — no loops, no retries of the query itself, no timers.

#### Negative Paths
- Given a slow/hanging `gh` invocation, when the guard queries PR state, then the existing
  GhRunner timeout semantics apply (the guard adds no unbounded wait of its own) and on
  timeout the run proceeds as fail-open.

### Done When
- [ ] A call-counting fake GhRunner test over one kickback + one rebase entry asserts exactly
      two guard queries for the whole chain.
- [ ] Code review confirms no new polling loop, timer, or retry wrapper around the query
      (single-shot call per checkpoint).
