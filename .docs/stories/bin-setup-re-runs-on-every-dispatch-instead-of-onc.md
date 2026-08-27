**Status:** Accepted

# Stories: Setup once per worktree + per-dispatch lifecycle script (#1930)

Technical track — criteria derive from adr-2026-08-26-setup-once-per-worktree-marker (APPROVED)
and the intake outcomes of jstoup111/ai-conductor#1930.

## Story 1: Re-dispatch of a prepared worktree skips project setup

As an operator, I want a re-dispatched feature to start the conductor without re-running `bin/setup` so that resume/re-kick/halt-clear stop paying minutes of provisioning cost.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose last `bin/setup` run succeeded and whose marker matches the current `bin/setup` content hash and resolved-base SHA, when the daemon dispatches the feature again, then `bin/setup` is not executed and a `project_setup` event with `ran: false, reason: marker-valid` is emitted and rendered in the daemon log
- Given a project with no `bin/setup`, when the daemon dispatches, then behavior is unchanged from today (no setup, no marker written, existing "no bin/setup" logging preserved)

#### Negative Paths
- Given a marker file that is missing, corrupt JSON, or carries an unknown version, when the daemon dispatches, then `bin/setup` runs (fail-closed) and the emitted `project_setup` event names the reason (`no-marker` or `marker-invalid`)
- Given the marker's stored base SHA cannot be compared because base resolution fails, when the daemon dispatches, then `bin/setup` runs rather than being skipped on doubt

### Done When
- [ ] A second dispatch against an unchanged prepared worktree produces no `bin/setup` process execution (asserted via a recording fake setup script) and a persisted `project_setup {ran:false, reason:"marker-valid"}` event in the worktree's `.pipeline/events.jsonl`
- [ ] `EVENT_SINKS` carries an exhaustive declaration for `project_setup` and the daemon log line is produced by the event renderer, not a separate raw log write

## Story 2: Setup re-runs exactly when the prepared state is invalidated, with the reason named

As an operator, I want setup to re-run when the worktree was re-provisioned, the base moved, or `bin/setup` changed, and I want the log to say why it ran.

### Acceptance Criteria

#### Happy Path
- Given a worktree recreated from its branch (no marker present), when the daemon dispatches, then `bin/setup` runs and the event reason is `no-marker`
- Given a prepared worktree whose `bin/setup` content or mode changed since the marker was written, when the daemon dispatches, then `bin/setup` runs and the event reason is `script-changed`
- Given a prepared worktree whose resolved base SHA moved (engine rebase or re-kick advanced the base), when the daemon dispatches, then `bin/setup` runs and the event reason is `base-moved`
- Given `bin/setup` completes successfully, when the marker is written, then it is written atomically to `«worktree»/.daemon/setup-ok.json` with the script hash and base SHA as identity and the commit as provenance only

#### Negative Paths
- Given `bin/setup` exits non-zero, when the dispatch fails, then no marker is written and a subsequent dispatch runs `bin/setup` again
- Given task commits made by the build advanced the worktree HEAD but the resolved base is unchanged, when the daemon re-dispatches, then setup is still skipped (HEAD movement alone never invalidates)
- Given the marker file exists under `«worktree»/.daemon/`, when any porcelain-based consumer inspects the worktree (build-completion floor, triage tree classifier), then the marker never appears as an untracked file because `.daemon/` is in the worktree's `info/exclude`

### Done When
- [ ] Each invalidation cause (`no-marker`, `script-changed`, `base-moved`, `marker-invalid`) is covered by a test asserting both the setup re-run and the emitted reason
- [ ] A failed setup leaves no `setup-ok.json` (asserted), and the marker write path uses temp-file + rename
- [ ] `git status --porcelain` in a prepared worktree shows no `.daemon/` entries

## Story 3: Optional per-dispatch lifecycle script

As a consumer project author, I want a documented per-dispatch hook distinct from `bin/setup` so that "on dispatch start" behavior has its own vehicle.

### Acceptance Criteria

#### Happy Path
- Given a project with an executable `bin/dispatch-start`, when the daemon dispatches a feature (including a dispatch that skipped setup), then the script runs in the worktree with `CI=true` and `WORKTREE_NAMESPACE` set, after the setup gate
- Given a project without `bin/dispatch-start`, when the daemon dispatches, then nothing runs and no log line is added

#### Negative Paths
- Given `bin/dispatch-start` exits non-zero, when the dispatch proceeds, then the failure is contained to a log line (the dispatch is not failed and nothing is thrown)
- Given `bin/dispatch-start` hangs, when the configured `dispatch_start_timeout_seconds` (default 120) elapses, then the script is killed, the timeout is logged, and the dispatch proceeds
- Given a missing, non-numeric, zero, or negative `dispatch_start_timeout_seconds` config value, when the timeout is resolved, then it falls back to the default

### Done When
- [ ] `bin/dispatch-start` executes on every dispatch of a feature regardless of whether setup ran, verified with a recording fake across two consecutive dispatches
- [ ] Failure and timeout paths leave the dispatch outcome unchanged and produce the containment log line
- [ ] `dispatch_start_timeout_seconds` is resolved in `resolved-config.ts` with the same fallback rules as the teardown timeout

## Story 4: Setup-failure triage still verifies against real setup runs

As an operator, I want triage's fix verification to actually re-run `bin/setup` so that a `fixed-pass` verdict can never come from a marker skip.

### Acceptance Criteria

#### Happy Path
- Given a setup failure routed to triage, when triage's verification re-runs prepare (post-quarantine retry or post-fix check), then `bin/setup` executes for real (force path bypasses the marker) and a success rewrites the marker
- Given a forced setup run, when the `project_setup` event is emitted, then its reason is `forced`

#### Negative Paths
- Given a valid marker exists in the worktree, when triage's verification prepare runs, then the marker does not short-circuit it — the verification observes the real `bin/setup` exit status
- Given setup was skipped by a valid marker, when the dispatch proceeds, then triage is never invoked (a skip cannot produce a `SetupFailureError`)
- Given a forced setup run fails during triage verification, when triage classifies the outcome, then the existing `setup-still-failing` / dirty-tree handling is unchanged and no marker is written

### Done When
- [ ] A test seeds a valid marker, injects a failing `bin/setup`, and asserts triage's verification prepare still executes the script and reports the failure
- [ ] Triage entry guard behavior is unchanged: it still throws unless given a `SetupFailureError`
