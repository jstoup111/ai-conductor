**Status:** Accepted

# Stories: Auto-Resolve Merge Conflicts on Open Watched PRs

Source PRD: `.docs/specs/2026-07-04-auto-resolve-open-pr-conflicts.md`
ADRs: `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`,
`adr-2026-07-04-autoresolve-state-and-config`, `adr-2026-07-04-resolution-worktree-lifecycle`

---

## Story: Sweep detects a conflicting watched PR and dispatches resolution

**Requirement:** FR-1, FR-2

As an operator, I want the daemon's existing merge-status sweep to notice when a watched open
PR has become conflicting and start auto-resolution, so parked PRs stop waiting on me.

### Acceptance Criteria

#### Happy Path
- Given a watch entry for an open PR and the gh runner reports merge state CONFLICTING with no
  `needs-remediation` label, when the sweep tick runs, then the resolution flow is invoked for
  that PR after the label pass completes, and the `mergeable` label is absent.
- Given the feature's `mergeable_autoresolve.enabled` is true in `.ai-conductor/config.yml`,
  when the daemon starts, then the sweep uses the configured cooldown and the existing
  rebase-resolution attempt cap.

#### Negative Paths
- Given `mergeable_autoresolve.enabled` is false or the block is absent, when a watched PR is
  CONFLICTING, then no resolution is attempted, no worktree is created, and the sweep behaves
  exactly as today (label removal only).
- Given a PR whose merge state reads MERGED or CLOSED, when the sweep tick runs, then the
  entry is pruned and the resolution flow is never invoked for it, even if a stale attempt
  count exists on the entry.
- Given a PR whose merge state read fails (gh error → UNKNOWN), when the sweep tick runs, then
  the PR is logged and skipped — no resolution, no label change, entry retained.
- Given an open PR that is NOT in the watch registry, when it goes conflicting on GitHub, then
  the daemon takes no action on it (out of scope by FR-1).

### Done When
- [ ] Unit tests with an injected gh runner cover: conflicting→dispatch, disabled→no-op,
      merged/closed→prune-no-dispatch, unknown→skip.
- [ ] Resolution is invoked only after the label pass over all watch entries completes, and at
      most one PR is resolved per tick (assert a second conflicting PR in the same tick is
      deferred, with a log line).

---

## Story: Sticky escalation and cooldown gate every attempt

**Requirement:** FR-14, FR-15

As an operator, I want an escalated PR to stay parked until I act, and a failing PR to retry
only within bounds, so the daemon never churns on a hopeless conflict.

### Acceptance Criteria

#### Happy Path
- Given a conflicting watched PR whose entry shows `resolveAttempts` under the cap and
  `lastResolveAt` older than `cooldown_minutes`, when the sweep tick runs, then a resolution
  attempt starts and the entry's `resolveAttempts` increments and `lastResolveAt` updates
  before any git work begins.
- Given a PR that is successfully refreshed, when the attempt completes, then
  `resolveAttempts` resets to zero.

#### Negative Paths
- Given a conflicting PR carrying the `needs-remediation` label, when any number of sweep
  ticks run, then no resolution is ever attempted and a skip is logged once per tick —
  clearing the label is the only way to re-enable (sticky escalation).
- Given `lastResolveAt` is 10 minutes ago with `cooldown_minutes: 60`, when the sweep tick
  runs, then the attempt is skipped with a cooldown log line and `resolveAttempts` does NOT
  increment.
- Given `resolveAttempts` equals the cap, when the sweep tick runs after cooldown, then no
  attempt starts; the PR is escalated (labels + comment) exactly once, not repeatedly.
- Given a legacy watch entry with no `resolveAttempts`/`lastResolveAt` fields, when the sweep
  reads the registry, then the entry parses successfully with attempts=0 (backward-compatible
  schema).
- Given the daemon restarts mid-cooldown, when the next tick runs, then cooldown/attempt state
  read from the registry file still gates correctly (restart-safe).

### Done When
- [ ] Registry round-trip tests: legacy entry parses with zero-defaults; extended entry
      round-trips attempts/timestamp through `rewriteWatch`.
- [ ] Tick tests assert: sticky skip, cooldown skip without increment, cap-exhausted →
      single escalation, success → reset.

---

## Story: Resolution runs in a dedicated transient worktree

**Requirement:** FR-12 (isolation aspect), NFR-2; adr-2026-07-04-resolution-worktree-lifecycle

As an operator, I want resolution to happen in its own disposable workspace so my checkouts
and the daemon's build worktrees are never disturbed.

### Acceptance Criteria

#### Happy Path
- Given an eligible conflicting PR with branch `feat/x`, when resolution starts, then the
  repo is fetched and a worktree is added at `.worktrees/resolve-<slug>` checked out at the PR
  branch tip, and the namespace preparation step runs (worktree `.env` gets
  `WORKTREE_NAMESPACE`) before any suite run.
- Given a resolution attempt ends — success OR failure — when the flow returns, then the
  `resolve-<slug>` worktree is removed and `git worktree list` no longer shows it, while the
  `spec`/feature branch and its commits remain reachable.

#### Negative Paths
- Given a stale `resolve-<slug>` directory left by a crashed prior run (dirty or locked), when
  a new attempt starts, then the leftover is force-removed and recreated fresh; the attempt
  proceeds against the current PR branch tip, not the stale checkout.
- Given the feature's build worktree `.worktrees/<slug>` currently exists (mid-build, halted,
  or awaiting rekick), when the sweep evaluates the PR, then resolution is skipped with a
  logged reason and no `resolve-<slug>` worktree is created (daemon-owned precedence).
- Given worktree creation itself fails (e.g. git error), when the attempt aborts, then the
  primary checkout and all other worktrees are untouched, the failure is logged, and the
  attempt counts toward the cap (no infinite retry on a broken environment).
- Given the resolution worktree exists mid-attempt, when another sweep tick fires (long suite
  run), then no second resolution starts for any PR while one is in flight (serial guard).

### Done When
- [ ] Tests with injected git/worktree runners cover: create-at-tip, namespace prep before
      suite, teardown on success, teardown on failure, stale-leftover recreate,
      build-worktree-exists skip, in-flight serial guard.
- [ ] A real-binary smoke exercises worktree add/remove against a scratch git repo.

---

## Story: CHANGELOG conflicts resolve deterministically at zero token cost

**Requirement:** FR-4, FR-6

As an operator, I want the overwhelmingly common CHANGELOG `[Unreleased]` collision resolved
mechanically, so no assistant session is spent on it.

### Acceptance Criteria

#### Happy Path
- Given a rebase paused with only `CHANGELOG.md` conflicted where main added entries under
  `[Unreleased]` and the feature added its own lines, when Tier 1 runs, then the resolved file
  contains main's entries plus exactly this feature's lines appended under the correct
  subsection, with no duplicated block, and the rebase continues without any skill dispatch.

#### Negative Paths
- Given the feature's CHANGELOG hunk deletes or rewrites main's existing entries (not purely
  additive), when Tier 1 evaluates it, then the file is NOT auto-resolved and falls through to
  Tier 2 (never silently drop main's lines).
- Given the same feature lines already exist verbatim in main's `[Unreleased]` (an earlier
  push landed them), when Tier 1 resolves, then the lines are not duplicated (idempotent
  re-append — dedup key is the exact entry lines).
- Given a conflict in `CHANGELOG.md` outside the `[Unreleased]` section (e.g. a released
  version block), when Tier 1 evaluates it, then it falls through to Tier 2.

### Done When
- [ ] Unit tests over real conflict-marker fixtures: additive merge, non-additive
      fall-through, idempotent re-append, outside-Unreleased fall-through.
- [ ] Zero dispatch-runner invocations asserted on the fully-deterministic path.

---

## Story: Parallel-feature .docs artifacts resolve keep-both

**Requirement:** FR-5; review Condition 4

As an operator, I want spec/story/plan artifact collisions from parallel features to keep both
sides, since those files are additive by convention.

### Acceptance Criteria

#### Happy Path
- Given a rebase conflict where main added `.docs/stories/feature-a.md` and the feature adds
  `.docs/stories/feature-b.md` (add/add or rename collisions inside `.docs/`), when Tier 1
  runs, then both files exist after resolution and the rebase continues without dispatch.

#### Negative Paths
- Given a conflict on the SAME `.docs/` file with divergent content edits on both sides, when
  Tier 1 evaluates it, then keep-both does NOT apply (no blind union of one file) and it falls
  through to Tier 2.
- Given a conflicted path outside `.docs/` (code, config, `src/`), when Tier 1 evaluates it,
  then keep-both never applies regardless of conflict shape (strict path scope).
- Given a mixed conflict set (one `.docs/` add/add plus one `src/` content conflict), when
  Tier 1 runs, then the `.docs/` collision may resolve but the attempt still routes the `src/`
  conflict to Tier 2 — Tier 1 alone must not mark the rebase resolved.

### Done When
- [ ] Unit tests over fixture repos: add/add keep-both, same-file edit fall-through,
      non-.docs never-applies, mixed-set routing.

---

## Story: Remaining conflicts go to the gated /rebase session, bounded

**Requirement:** FR-7

As an operator, I want genuinely ambiguous conflicts handled by the same bounded assistant
resolution used at finish time, so one policy governs all conflict resolution.

### Acceptance Criteria

#### Happy Path
- Given Tier 1 leaves conflicts, when Tier 2 runs, then `resolveRebaseConflicts` is invoked
  with the same configured cap the finish-time path reads (default 3), the `/rebase` skill is
  dispatched in the resolution worktree, and a clean resolution reclassifies the outcome for
  verification.

#### Negative Paths
- Given the skill signals cannot-resolve on attempt 1, when the loop evaluates it, then it
  short-circuits (no attempts 2..N) and the flow aborts to escalation.
- Given the cap is exhausted with conflicts remaining, when the loop ends, then the rebase is
  aborted (`git rebase --abort`), the PR branch is untouched, and escalation proceeds.
- Given the configured cap is 0, when Tier 1 leaves conflicts, then no dispatch occurs and the
  flow aborts directly to escalation (resolution disabled ⇒ deterministic-only mode).

### Done When
- [ ] Tests with an injected resolver assert: cap threading from resolved-config,
      short-circuit, cap-exhausted abort, cap=0 no-dispatch.

---

## Story: Work-preservation guards reject lossy resolutions

**Requirement:** FR-8, FR-9

As an operator, I want any resolution that loses my commits or leaves the branch stale
rejected outright, because git drops commits silently during rebase.

### Acceptance Criteria

#### Happy Path
- Given a completed rebase where every pre-rebase feature commit subject is present in
  `base..HEAD` and the branch is current with the base it rebased onto, when the guards run,
  then verification proceeds to the suite gate.

#### Negative Paths
- Given a resolution that `--skip`ped a commit (a pre-rebase subject missing afterward), when
  `featureCommitsPreserved` runs, then the attempt is rejected, the flow aborts, nothing is
  pushed, and the escalation comment names the guard that failed.
- Given the default branch advanced again mid-resolution so the rebased branch is no longer
  current with the base it rebased onto, when `isBranchCurrent` runs, then the attempt is
  rejected and nothing is pushed.
- Given a resolver that claims success while the rebase is actually still paused
  (rebase-merge dir present), when the guards run, then the attempt is treated as failed and
  aborted (never push a mid-rebase tree).

### Done When
- [ ] Tests reuse the existing guard helpers against scratch repos with a real dropped commit
      and a real mid-rebase state — adversarial fixtures, not mocks of the guards.

---

## Story: Full suite must pass before anything publishes — fail-closed without a suite command

**Requirement:** FR-10; adr-2026-07-04-autoresolve-state-and-config

As an operator, I want the project's full suite green in the resolved state before the PR is
touched, and I want the system to refuse to push rather than guess when no suite is configured.

### Acceptance Criteria

#### Happy Path
- Given guards passed and `mergeable_autoresolve.suite_command` is configured, when the suite
  runs in the namespace-prepared resolution worktree and exits 0, then the flow proceeds to
  the push step, and the suite's exit code and duration are logged.

#### Negative Paths
- Given the suite exits non-zero, when verification evaluates it, then the rebase result is
  discarded (abort), nothing is pushed, and the escalation comment includes the suite failure
  as the reason.
- Given `suite_command` is missing while `enabled: true`, when a resolution would otherwise
  push, then the flow aborts BEFORE pushing, escalates with reason "no suite command
  configured", and logs it — it must never push unverified (fail-closed).
- Given the suite command itself cannot spawn (ENOENT/permission), when the run fails, then it
  is treated exactly as a red suite (abort + escalate), not as a pass.
- Given the suite hangs past a sane timeout, when the timeout elapses, then the attempt is
  aborted and escalated rather than blocking the daemon indefinitely.

### Done When
- [ ] Tests with an injected suite runner assert: green→push, red→abort+reason,
      missing-config→fail-closed escalation, spawn-error→abort, timeout→abort.

---

## Story: The refresh publishes with a lease and never overwrites unseen work

**Requirement:** FR-3, FR-11, FR-12

As an operator, I want the refreshed branch pushed safely so the PR returns to mergeable, and
I want any concurrent push to win over the daemon, never the reverse.

### Acceptance Criteria

#### Happy Path
- Given guards and suite passed, when the flow pushes with `git push --force-with-lease`
  (never bare `--force`), then the PR branch is updated, a follow-up merge-state read shows
  the PR mergeable, the `mergeable` label is restored, attempts reset, and the worktree is
  removed — the push is the ONLY externally visible mutation of the branch.

#### Negative Paths
- Given someone pushed to the PR branch after resolution began, when the lease push runs, then
  it is rejected, the local result is discarded, the PR branch on the remote is untouched, and
  the flow escalates with the lease rejection as the reason (no retry with force).
- Given any earlier stage failed (Tier 2 gave up, a guard failed, the suite was red), when the
  attempt ends, then a diff of the remote PR branch before/after the attempt is empty —
  asserted with real git state, not inferred.
- Given the push succeeds but the follow-up label restore fails (gh error), when the flow
  ends, then the push is not rolled back, the label failure is logged, and the next tick's
  normal label pass reconciles the label (best-effort labels, C3 convention).

### Done When
- [ ] A real-binary smoke against a scratch origin: successful lease push refreshes the
      branch; a simulated concurrent push causes lease rejection with remote intact.
- [ ] Argv-level test asserts `--force-with-lease` and the absence of bare `--force`.

---

## Story: Escalation marks the PR for a human with a concrete reason

**Requirement:** FR-13, FR-16

As an operator, I want a failed auto-resolution to surface as a labelled PR with a comment
telling me exactly why, and I want every outcome in the daemon log.

### Acceptance Criteria

#### Happy Path
- Given an attempt fails at any stage, when escalation runs, then the `mergeable` label is
  removed and `needs-remediation` added via the REST label helpers (never
  `gh pr edit --add-label`), and one PR comment states the failing stage and concrete reason
  (e.g. "commit-preservation guard: 2 of 5 feature commits missing after rebase") — posted via
  the existing marker-tagged `upsertComment` convention (remediation-comment-upsert stories),
  so a later occurrence updates the same comment rather than adding another.
- Given any attempt concludes, when the tick finishes, then the daemon log contains one
  outcome line identifying the PR, the stage reached, and refreshed/escalated/skipped.

#### Negative Paths
- Given the REST label call fails, when escalation runs, then the comment is still attempted,
  the failure is logged, and the sweep does not crash (best-effort, C3).
- Given escalation already happened for this conflict occurrence, when later ticks see the
  same conflicting PR, then no duplicate comment is posted (the sticky label suppresses
  re-entry — at most one escalation comment per occurrence).
- Given the comment API fails but the label succeeded, when the tick ends, then the PR is
  still protected from retries (label is the gate, comment is advisory).

### Done When
- [ ] Injected-gh tests assert REST endpoints for label ops, single-comment-per-occurrence,
      and non-throwing behavior on gh failures.
- [ ] Log-line snapshot tests cover refreshed, escalated (each stage), and skipped outcomes.

---

## Story: Finish-time resolution behavior is unchanged

**Requirement:** Non-goal guard (PRD Non-Goals; adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep)

As an operator, I want the existing finish-time rebase step byte-for-byte unaffected, so this
feature cannot regress the in-pipeline path.

### Acceptance Criteria

#### Happy Path
- Given the finish-time `runRebaseStep` conflict path, when its existing suite runs after this
  feature merges, then all existing rebase/resolution tests pass unmodified (shared helpers
  refactored only additively).

#### Negative Paths
- Given the sweep-path code is faulty or disabled, when a feature finishes normally, then
  finish-time rebase + resolution still work (no shared mutable state between the two call
  sites beyond the pure helpers and config read).

### Done When
- [ ] Existing `rebase.ts` / step-runner test files pass without edits (or with additive-only
      edits justified in review).
