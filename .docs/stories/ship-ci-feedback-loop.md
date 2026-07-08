**Status:** Accepted

# Stories: ship→CI feedback loop + fixture-portability guards

Technical track — derived from ADR `adr-2026-07-07-ship-ci-feedback-loop.md` (APPROVED) and
`architecture-review-2026-07-07-ship-ci-feedback-loop.md`. Source-Ref: jstoup111/ai-conductor#397.
Requirement tags TR-N map to the ADR's Decision points 1–7.

## Story: Check-outcome classification on PrMergeState

**Requirement:** TR-1 (ADR Decision 1)

As the daemon, I want each watched PR's check rollup classified as pending / failed / green /
none so that the sweep can act on FAILED distinctly from still-running checks.

### Acceptance Criteria

#### Happy Path
- Given a rollup where any check has conclusion FAILURE (or ERROR/TIMED_OUT/CANCELLED treated as
  failure per existing FAILING_OR_PENDING semantics), when `prMergeState` parses it, then the
  new checks-outcome field is `failed` — even if other checks are still pending (failed wins).
- Given a rollup where no check has failed and at least one is running (null/empty conclusion or
  pending status), when parsed, then the outcome is `pending`.
- Given a rollup where every check has a passing conclusion, when parsed, then the outcome is
  `green`; given an empty/absent rollup, then `none`.
- Given any rollup, when parsed, then `hasFailingOrPendingChecks` and `isMergeable` return
  exactly what they return today (additive change, no behavior drift).

#### Negative Paths
- Given a rollup entry with malformed/missing `status` and `conclusion` fields, when parsed,
  then classification does not throw and treats the entry as pending (fail-safe: no dispatch on
  garbage data).
- Given `gh pr view` fails transiently, when `prMergeState` returns the UNKNOWN sentinel, then
  the checks-outcome carries no `failed` value and the sweep keeps the entry with no CI action
  (existing FR-15 skip preserved).

### Done When
- [ ] `PrMergeState` exposes the checks-outcome field; unit tests cover failed/pending/green/
      none, mixed failed+pending → failed, malformed entries → pending, sentinel → no action
- [ ] Existing `isMergeable`/label tests pass unmodified

## Story: ci-failed label lifecycle + halt-monitor-visible event

**Requirement:** TR-2 (ADR Decision 2)

As the operator, I want a red shipped PR to carry a `ci-failed` label and surface a
halt-monitor-visible event so that a broken ship is observable without reading CI myself.

### Acceptance Criteria

#### Happy Path
- Given a watched entry whose checks-outcome is `failed` and label absent, when the sweep
  processes it, then the `ci-failed` label is ensured+added (idempotent: not re-added when
  present) and a `ci_failed` event line is emitted in the ✋-grade format the halt-monitor tails.
- Given a watched entry whose checks-outcome is `green` and the `ci-failed` label present, when
  the sweep processes it, then the label is removed and `ciFixAttempts` resets to 0.
- Given checks-outcome `pending`, when the sweep processes it, then no label change, no event,
  no dispatch (no-op).

#### Negative Paths
- Given the label add/remove gh call errors, when the sweep processes the entry, then the error
  is logged, the entry survives in the registry, and the sweep continues to the next entry
  (never throws — FR-15 parity).
- Given a PR already carrying `needs-remediation`, when its checks are failed, then NO fix
  dispatch occurs and the `ci-failed` label handling still applies (sticky escalation is
  terminal until a human clears it).
- Given the same PR is failed on two consecutive sweeps with no state change, when the second
  sweep runs, then the ✋ event is not duplicated (emit on transition or dispatch, not every
  tick) — the halt-monitor is not spammed.

### Done When
- [ ] Sweep tests cover: add-once, remove-on-green + counter reset, pending no-op,
      needs-remediation suppression, gh-error resilience, no duplicate ✋ spam
- [ ] `ci_failed` event type added to the events union and rendered ✋-grade in daemon logs

## Story: Bounded CI-fix dispatch seam

**Requirement:** TR-3, TR-6 (ADR Decisions 3, 6)

As the daemon, I want at most one bounded CI-fix dispatch per sweep tick, gated by config, so
that remediation cannot loop, stampede, or run when disabled.

### Acceptance Criteria

#### Happy Path
- Given `ci_watch.enabled` true (the default when the key is absent) and a failed entry with
  `ciFixAttempts < 2` and no resolution in flight, when the sweep's post-label pass runs, then
  the entry's `ciFixAttempts` is incremented and `lastCiFixAt` stamped in the rewritten registry
  BEFORE any git work, and the injected dispatch callback is invoked with the updated entry.
- Given two failed eligible entries in one tick, when the pass runs, then only the first is
  dispatched and the second logs a defer (one-per-tick, mirrors autoresolve AC2).
- Given a legacy watch entry with no `ciFixAttempts` field, when read, then it normalizes to 0
  (same pattern as `resolveAttempts`).

#### Negative Paths
- Given `ci_watch.enabled` false, when the sweep runs against failed entries, then registry
  writes, labels, and gh calls are byte-identical to a build without the feature except the
  `ci-failed` label/event handling — no dispatch is invoked.
- Given `ciFixAttempts` already at 2, when the pass runs, then no dispatch occurs and the
  exhaustion path (TR-5 story) triggers instead.
- Given any resolution already in flight (conflict autoresolve OR another CI fix — shared serial
  guard), when the pass runs, then the entry is deferred with a logged reason, and its attempt
  counter is NOT consumed.
- Given the dispatch callback throws, when the pass runs, then the sweep logs and continues
  (non-throwing), and the pre-bumped counter persists — a crash mid-dispatch can never yield an
  uncounted attempt.
- Given a malformed `ci_watch` config value, when config loads, then the default (enabled)
  applies without crashing the daemon.
- Given a watched entry that is BOTH `mergeable: CONFLICTING` and checks-failed, when the pass
  runs, then conflict autoresolve takes precedence and CI-fix skips the entry with a logged
  reason and NO `ciFixAttempts` burn — CI-fix eligibility requires `mergeable ≠ CONFLICTING`
  (CI results on a conflicted PR are stale; resolve the conflict first, let CI re-run, then
  fix on fresh results). *(Added by conflict-check 2026-07-07 — precedence vs
  auto-resolve-open-pr-conflicts.)*

### Done When
- [ ] `CiFixDispatchOpts` seam exists with injected `enabled`/`isEligible`/`dispatch` (no direct
      import of the resolution pipeline from mergeable-sweep.ts)
- [ ] Tests cover: bump-before-dispatch persistence, one-per-tick defer, legacy normalization,
      disabled-config inertness, cap reached, shared serial guard defer without counter burn,
      dispatch-throw resilience
- [ ] README + src/conductor/README document `ci_watch.enabled`

## Story: Fix-CI resolver run pushes a verified fix to the PR branch

**Requirement:** TR-4 (ADR Decision 4)

As the daemon, I want the dispatched fix run to work from the shipped PR's branch tip with the
failing checks' evidence as its retry hint, and to push only a guard-verified result.

### Acceptance Criteria

#### Happy Path
- Given a dispatched entry, when the resolver starts, then it creates an isolated worktree from
  the PR branch tip under `.worktrees/` (primary checkout untouched, stale dir from a crashed
  prior run removed first), and tears it down afterward.
- Given the failing checks are readable, when the RETRY hint is built, then it names the failing
  check(s) and includes a failing-job log excerpt.
- Given the fix run produces changes, when acceptance guards (work preservation) and the full
  suite gate pass in the worktree, then the result is pushed to the same PR branch — and the
  next sweep re-reads the rollup (CI is the verifier; the resolver never merges, never touches
  the processed ledger).

#### Negative Paths
- Given the log excerpt fetch fails (external check, token scope, deleted run), when the hint is
  built, then it degrades to check names + links and the dispatch still proceeds.
- Given the suite gate fails in the worktree, when the resolver finishes, then NOTHING is pushed,
  the attempt stays consumed, the worktree outcome is logged, and the sweep remains healthy.
- Given the acceptance guards detect lost feature commits, when the resolver finishes, then the
  push is rejected (work preservation) and the outcome logged.
- Given worktree creation fails (e.g. branch deleted on origin), when the resolver starts, then
  it aborts non-throwing with a logged reason; a NOTFOUND PR is pruned by the next sweep.
- Given the fix run modifies files outside the worktree (leak), when guards run, then the push
  is rejected — the primary checkout's cleanliness is asserted untouched in tests.

### Done When
- [ ] Resolver tests (injected runners, no real gh/git spawns per the env kill-switch
      convention) cover: worktree-from-PR-tip, hint with excerpt, hint degradation, gate-fail
      no-push, guard-fail no-push, worktree-create abort, teardown on both outcomes
- [ ] A real-binary smoke exercises the resolver argv path end-to-end (injected-runner argv
      tests alone are insufficient per prior harness lesson)

## Story: Exhaustion escalates to a human and goes sticky

**Requirement:** TR-5 (ADR Decision 5)

As the operator, I want a permanently-red shipped PR to converge to an explicit escalation
instead of endless fix attempts.

### Acceptance Criteria

#### Happy Path
- Given a failed entry with `ciFixAttempts` at 2, when the sweep processes it, then the
  `needs-remediation` label is applied, an escalation comment is upserted on the PR via the
  build-failure-escalation path (naming the failing checks and attempt history), and a
  HALT-grade event is emitted for the halt-monitor.
- Given the escalation has fired, when subsequent sweeps see the PR still failed, then no
  further dispatches or duplicate escalation comments occur (needs-remediation is the existing
  sticky suppressor).

#### Negative Paths
- Given the escalation comment gh call fails, when escalation runs, then the label is still
  applied, the failure is logged, and the sweep does not throw.
- Given the PR is merged or closed between detection and escalation, when the sweep re-reads
  state, then the entry is pruned and no escalation is posted to a dead PR.
- Given a human later clears `needs-remediation` and pushes a fix, when the sweep sees the PR
  green, then `ciFixAttempts` resets to 0 and the `ci-failed` label is removed (recovery path).

### Done When
- [ ] Tests cover: escalation exactly-once, comment-failure resilience, merged/closed prune
      race, post-human-clear recovery reset
- [ ] Escalation comment content includes failing check names + attempts (fixture-asserted)

## Story: Fixture-portability structural guard

**Requirement:** TR-7 (ADR Decision 7)

As a harness maintainer, I want a structural meta-test that fails when a test fixture or engine
path uses a non-portable pattern, so the #384/#392/#393 class cannot be authored again.

### Acceptance Criteria

#### Happy Path
- Given a test file under `src/conductor/test/**` running `git init` without `-b «branch»`
  (non-bare) via ANY of the exec wrapper shapes (`execa`, `execFile`, `exec`, local `git()`
  helpers), when the guard runs, then it fails naming the file and line.
- Given a `.unref()` call on a timer in `src/conductor/src/engine/**`, when the guard runs, then
  it fails naming the site (the #396 class) unless annotated.
- Given a source file staging a temp file OUTSIDE the target file's directory followed by
  rename/copy, when the guard runs, then it fails naming the site (cross-device/teardown
  atomicity class).
- Given a flagged line carrying `// portability-ok: <reason>` (non-empty reason), when the guard
  runs, then that site is exempt.

#### Negative Paths
- Given `git init --bare` or `git init -b main`, when the guard runs, then no flag (no false
  positive on portable forms).
- Given a `portability-ok` marker with an EMPTY reason, when the guard runs, then the site is
  still flagged (an unexplained exemption is not an exemption).
- Given the known-bad falsifiability fixtures (one per pattern, embedded as strings in the guard
  test itself), when the guard's matchers run against them, then every pattern fires — proving
  the guard is not vacuously green.
- Given a commented-out `git init` line, when the guard runs, then it is not flagged
  (comment-line exemption, same convention as non-autonomy.test.ts).

### Done When
- [ ] New structural test under `src/conductor/test/` (glob-based over test/** for pattern (a),
      over src/engine/** for (b) and (c)) with falsifiability fixtures for all three patterns
- [ ] `daemon-log.ts` interval timer (the one legitimate unref) is annotated or exempted with a
      reasoned marker

## Story: Existing non-portable fixtures are fixed so the guard lands green

**Requirement:** TR-7 (ADR Follow-up)

As a harness maintainer, I want the ~16 existing `git init` sites made portable in the same
change so the guard merges enforcing, not aspirational.

### Acceptance Criteria

#### Happy Path
- Given the inventoried non-portable `git init` call sites in src/conductor/test/**, when the
  change lands, then each passes `-b main` (or documents a reasoned `portability-ok` marker) and
  the guard passes over the whole tree.
- Given the fixed fixtures, when the full suite runs, then it is green (fixes do not alter test
  semantics).

#### Negative Paths
- Given a runner whose global `init.defaultBranch` is NOT main, when the fixed fixtures run,
  then they still pass (the guard's whole point — verified by the suite not depending on git
  global config; spot-checked by running one fixed test with `GIT_CONFIG_GLOBAL=/dev/null`).

### Done When
- [ ] Guard test green over the entire tree with zero unexplained exemptions
- [ ] Full suite green; at least one previously-non-portable test verified passing with
      `GIT_CONFIG_GLOBAL=/dev/null`
