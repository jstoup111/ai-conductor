**Status:** Accepted

# Stories: Deferred Feature-Worktree Reap (#1091)

Technical track. Source: `adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main`,
architecture review `architecture-review-2026-07-29-daemon-reaps-a-feature-worktree-at-pr-open-before-`.
`**Requirement:**` tags cite the desired outcomes enumerated in issue #1091 (DO-1 … DO-6).

Operator decisions (2026-07-29), all recorded in
`.docs/conflicts/daemon-reaps-a-feature-worktree-at-pr-open-before-.md`:

- The rebase-resolution half of DO-5 is descoped to **#1150 (v1.1)**; S6 scopes DO-5 to CI-fix and
  makes the rebase-resolution skip observable rather than silent.
- **The sweep reap deliberately carries no in-flight run guard.** `mid-loop-pipeline-wipe-549`
  Story 5's audit ("no cleanup path issues `rm -rf` or `worktree remove` on a `.pipeline` root
  belonging to an in-progress run") is accepted as satisfied structurally by **#564**, which
  relocates run-state out of the worktree. Residual accepted risk: removing a worktree a live
  session holds as its cwd still interrupts that session; #1091 narrows that window from PR-open to
  record-on-main but does not close it.
- The retained-worktree operator surface is enumerated from disk, not from the watch registry.

## Story S1: The ship path retains the feature worktree instead of reaping it

**Requirement:** DO-1

As a daemon operator, I want a feature's worktree and its `.pipeline/` evidence to survive the moment
its implementation PR is opened, so that evidence is still readable if that PR never merges.

### Acceptance Criteria

#### Happy Path
- Given a feature whose run ends with a verified ship (`done`, finish choice `pr`, a PR URL, and no
  shipment failure reason), when the runner finishes handling that outcome, then `.worktrees/<slug>`
  still exists and `.worktrees/<slug>/.pipeline/task-status.json` is readable.
- Given that same feature, when the runner finishes handling the outcome, then the artifacts the
  task-status reconstructor refuses to rebuild — `HALT`, `HALT.class`, `QUARANTINE`, `DONE`,
  `finish-choice`, `version-approval`, `conduct-state.json`, `gates/*.json`,
  `protected-artifact-seal.json`, `events.jsonl` — are each still present when they were present
  before the outcome was handled.
- Given a verified ship, when the runner finishes, then the PR is still enrolled in
  `.daemon/mergeable-watch.jsonl` and the `.daemon/processed/<slug>` ledger entry is still written —
  neither side effect is disturbed by the retention change.

#### Negative Paths
- Given a run whose outcome is a halt or an error rather than a verified ship, when the runner
  handles it, then the worktree is retained exactly as before this change and no new retain log line
  claims a ship.
- Given a verified ship whose halt-presentation cleanup throws, when the runner handles the outcome,
  then enrollment, `markProcessed`, and retention all still complete and the error is logged.
- Given a verified ship for a slug whose `.worktrees/<slug>` was already removed out-of-band (crash
  leftover, operator deletion), when the runner handles the outcome, then it completes without
  throwing and records the absent worktree rather than attempting to recreate it.

### Done When
- [ ] `daemon-runner.ts`'s `outcome.done` happy path contains no `teardownWorktree` call; a test
      asserts the injected `teardownWorktree` dep is never invoked on a verified ship.
- [ ] A test drives a verified ship end-to-end against a fake worktree and asserts
      `.pipeline/task-status.json` plus each artifact named above is still readable afterwards.
- [ ] Existing runner tests covering `enrollWatch` and `markProcessed` ordering still pass unchanged.

## Story S2: The sweep reaps a merged feature once its shipped record is on origin/main

**Requirement:** DO-3

As a daemon operator, I want a merged feature's worktree cleaned up automatically once its shipped
record is part of main, so that retention does not require me to do anything on the normal path.

### Acceptance Criteria

#### Happy Path
- Given a watched PR whose state reads `MERGED` and whose `.docs/shipped/<slug>.md` is present at
  path on `origin/main` after fetch, when the sweep visits that entry, then `.worktrees/<slug>` is
  removed and the registry entry is pruned.
- Given a feature merged by **squash**, so that its branch is not an ancestor of `origin/main`, when
  the sweep visits its entry, then the record probe still finds the file and the worktree is still
  reaped — the reap decision never consults ancestry.
- Given a merged, record-present feature, when the sweep that follows the merge runs, then the reap
  happens within that single sweep pass — no second pass is required.

#### Negative Paths
- Given a watched PR reading `MERGED` whose `.docs/shipped/<slug>.md` is **absent** on
  `origin/main`, when the sweep visits it, then the worktree is retained, the registry entry is kept,
  and the entry is re-evaluated on the next pass.
- Given the `git fetch` of `origin/main` fails, when the sweep visits a merged entry, then no
  worktree is removed, the entry is kept, and the sweep continues to the next entry without throwing.
- Given `git worktree remove --force` itself fails (path busy, corrupt worktree), when the sweep
  attempts the reap, then the sweep does not throw, the remaining entries are still processed, and
  the failure is surfaced rather than swallowed silently.
- Given a merged, record-present entry whose `.worktrees/<slug>` no longer exists, when the sweep
  visits it, then the entry is pruned and no error is raised (reap is idempotent).
- Given two sweep passes racing over the same entry, when both reach the reap, then the second is a
  no-op and neither throws.
- Given an entry dropped from the registry by the size cap before it ever reached a terminal state,
  when subsequent sweeps run, then no sweep-driven reap occurs for that slug and its worktree remains
  visible and reclaimable through the operator surface of S5 — the disposition is never silently
  lost. (Conflict report, Conflict 2.)

### Done When
- [ ] A helper resolving "shipped record present at path on `origin/main` for `<slug>`" exists, is
      unit-tested against a fixture repo with a squash-merged branch, and is proven to return true
      where `git merge-base --is-ancestor` returns false.
- [ ] `mergeable-sweep.ts`'s `MERGED` branch calls that helper before any teardown, and a test
      asserts teardown is not called when the helper returns false.
- [ ] A test asserts fetch failure, teardown failure, and an already-absent worktree each leave the
      sweep non-throwing and the remaining entries processed.

## Story S3: A closed-unmerged PR retains its evidence and stays resumable

**Requirement:** DO-2, DO-6

As a daemon operator, I want a feature whose PR was closed without merging to keep its build
evidence, so that resuming it does not stall or redo finished work.

### Acceptance Criteria

#### Happy Path
- Given a watched PR whose state reads `CLOSED` and which was not merged, when the sweep visits it,
  then the registry entry is pruned but `.worktrees/<slug>` and its `.pipeline/` are retained.
- Given such a retained feature, when it is next dispatched or resumed, then the build reads the
  existing `task-status.json` and does not report a `no_task_progress` stall.
- Given such a retained feature whose task-status records tasks 1-4 complete, when the build resumes,
  then it starts at task 5 and does not re-execute tasks 1-4.
- Given a watched PR whose state reads `NOTFOUND` (deleted / 404), when the sweep visits it, then it
  is treated as closed-unmerged: entry pruned, worktree retained.

#### Negative Paths
- Given a watched PR whose state reads `UNKNOWN` because the state read failed, when the sweep visits
  it, then nothing is reaped, nothing is pruned, and the entry is skipped until the next pass.
- Given a PR that reads `CLOSED` **and** whose shipped record is present on `origin/main` (closed
  after a merge landed by another route), when the sweep visits it, then the merged disposition wins
  and the worktree is reaped — a closed-state read never suppresses a proven-on-main reap.
- Given a closed-unmerged feature whose `.pipeline/task-status.json` is malformed, when the build
  resumes, then it reports the malformed state explicitly rather than silently treating the feature
  as having zero progress.

### Done When
- [ ] `mergeable-sweep.ts` handles `MERGED`, `CLOSED`-unmerged, and `NOTFOUND` as three distinct
      dispositions; a test asserts `CLOSED` prunes the entry without calling teardown.
- [ ] A test proves a resumed closed-unmerged feature reads pre-existing task-status and reports no
      `no_task_progress`.
- [ ] A test asserts `UNKNOWN` state performs no destructive action and keeps the entry.

## Story S4: Every retain-or-reap decision is logged with its driving condition

**Requirement:** DO-4

As a daemon operator, I want each feature's worktree disposition and the reason for it in the daemon
log, so that I can tell a deliberate retention from a leak without reading code.

### Acceptance Criteria

#### Happy Path
- Given a verified ship, when the runner retains the worktree, then the daemon log carries a line
  naming the slug, the disposition `retained`, and the reason `pr-open-awaiting-main`.
- Given a merged, record-present entry, when the sweep reaps it, then the daemon log carries a line
  naming the slug, the disposition `reaped`, and the reason `shipped-record-on-main`.
- Given a merged entry whose record is not yet on main, when the sweep retains it, then the log names
  the reason `record-not-yet-on-main`.
- Given a closed-unmerged entry, when the sweep retains it, then the log names the reason
  `pr-closed-unmerged` and marks it reclaimable.

#### Negative Paths
- Given a reap that fails at `git worktree remove`, when the sweep logs the outcome, then the line
  reports the failure and does **not** claim the worktree was reaped.
- Given many sweep passes over an unchanged set of retained entries, when the passes run, then the
  per-entry retain lines do not repeat on every pass (log-noise suppression, matching the halt-PR
  reconciliation pattern), while any *change* in disposition is always logged.
- Given a slug whose disposition cannot be determined (state `UNKNOWN`), when the sweep logs, then
  the line says so explicitly rather than defaulting to `retained` with a fabricated reason.

### Done When
- [ ] Each disposition emits a distinct, greppable line through the existing daemon log seam; a test
      asserts the exact reason token for all five cases above.
- [ ] A test asserts an unchanged second pass emits no repeat per-entry lines but a changed
      disposition does emit one.

## Story S5: An operator can see and reclaim an abandoned retained worktree

**Requirement:** DO-6

As a daemon operator, I want retained worktrees surfaced and reclaimable by name, so that a feature
abandoned after its PR was closed does not hold a worktree forever with no way to act on it.

### Acceptance Criteria

#### Happy Path
- Given one or more retained worktrees, when the operator runs the daemon status/dashboard, then each
  is listed under a retained-worktree category with its slug and the reason it is retained.
- Given the retained-worktree category is rendered, when it is built, then it is enumerated from the
  `.worktrees/` directory on disk — never from `.daemon/mergeable-watch.jsonl` — so registry
  membership never determines visibility. (Conflict report, Conflict 2.)
- Given a retained worktree for a slug with no in-flight run, when the operator runs the reclaim verb
  with that exact slug, then the worktree path is printed, the worktree is removed, and the removal
  is logged.
- Given the reclaim verb is invoked, when it runs, then it works from any working directory within
  the repo (root resolution matches the existing park/unpark verbs).

#### Negative Paths
- Given a slug whose `.pipeline/` belongs to an in-progress run, when the operator runs the reclaim
  verb on it, then the reclaim is refused with a message naming the in-flight run, and nothing is
  removed. The in-flight predicate reuses `adr-2026-07-27-ancestry-proven-park-reconciliation`
  rule 5's rather than introducing a second one.
- Given a slug whose watch-registry entry was dropped by the registry size cap, when the operator
  lists retained worktrees, then that slug still appears and is still reclaimable by name.
  (Conflict report, Conflict 2.)
- Given an argument that is a glob, a path, a comma-separated list, or more than one slug, when the
  reclaim verb is invoked, then it is rejected without removing anything — the verb accepts exactly
  one well-formed slug and has no force flag and no bulk mode.
- Given a slug with no retained worktree, when the reclaim verb is invoked, then it reports that
  there is nothing to reclaim and exits without error.
- Given the reclaim verb name is passed through `bin/conduct`, when it is invoked there, then it is
  recognized rather than falling into the unknown-subcommand path.
- Given a retained worktree whose removal fails, when reclaim runs, then the failure is reported and
  no partial state is left claiming success.

### Done When
- [ ] `conduct daemon reclaim-worktree <slug>` exists, is registered in the daemon subcommand table,
      is detected pre-boot beside `daemon park|unpark`, and is present in `bin/conduct`'s
      known-subcommand forwarding list.
- [ ] A test asserts each rejection case: in-flight run, glob, path, list, multiple slugs, unknown
      slug.
- [ ] The daemon dashboard renders a retained-worktree category enumerated from `.worktrees/` on
      disk; a test asserts a retained slug appears with its reason **and** that a slug absent from
      `.daemon/mergeable-watch.jsonl` still appears.
- [ ] `docs/reference/cli.md` documents the verb and `docs/guides/running-the-daemon.md` documents
      the retention/reclaim behavior.

## Story S6: A retained worktree does not break post-ship CI remediation

**Requirement:** DO-5 (CI-fix scope; rebase-resolution descoped to #1150, v1.1)

As a daemon operator, I want post-ship remediation to keep working while a feature's own worktree
exists, so that retention does not silently disable the recovery paths.

### Acceptance Criteria

#### Happy Path
- Given a shipped feature with `.worktrees/<slug>` retained and an open PR with failing CI, when
  CI-fix is dispatched, then it provisions `.worktrees/resolve-<slug>` at the branch tip and runs to
  completion.
- Given both `.worktrees/<slug>` and `.worktrees/resolve-<slug>` exist during that run, when the
  CI-fix attempt ends, then the transient `resolve-` worktree is torn down and the retained feature
  worktree and its `.pipeline/` are untouched.

#### Negative Paths
- Given a shipped feature with `.worktrees/<slug>` retained and an open PR that is `CONFLICTING`,
  when the sweep evaluates rebase-resolution eligibility, then the attempt is skipped and the skip is
  logged with a reason that names the retained build worktree — the suppression is observable in the
  daemon log, never silent. **This is the known, operator-accepted limitation; #1150 owns the
  repair.**
- Given `prepareWorktree` fails while provisioning `.worktrees/resolve-<slug>`, when the CI-fix
  attempt aborts, then the retained feature worktree is not removed as part of the cleanup.
- Given a stale `.worktrees/resolve-<slug>` from a crashed prior run alongside a retained
  `.worktrees/<slug>`, when the next attempt force-recreates the transient worktree, then only the
  `resolve-` path is recreated and the feature worktree is untouched.

### Done When
- [ ] A test provisions a retained `.worktrees/<slug>` and asserts a CI-fix run still completes and
      leaves that worktree and its `.pipeline/` intact.
- [ ] A test asserts the rebase-resolution skip for a retained slug emits a log line whose reason
      names the build worktree, and that the skip does not remove or modify anything.
- [ ] `docs/guides/running-the-daemon.md` records the rebase-resolution limitation and cites #1150.
