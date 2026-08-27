# Coherence Mapping: Setup once per worktree + per-dispatch lifecycle script (#1930)

Technical track (no PRD — fr row class omitted). Intake outcomes staged from
jstoup111/ai-conductor#1930. Verdicts confirmed against the real artifact files.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Quote / Notes | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2 | covered | Setup once per provisioning; re-dispatch skips |
| outcome | outcome-2 | story-2 | covered | Re-run on re-provisioning with logged reason |
| outcome | outcome-3 | story-3 | covered | Distinct documented per-dispatch mechanism |
| outcome | outcome-4 | story-4 | covered | runSetupTriage still works when setup runs |
| adr | adr-2026-08-26-setup-once-per-worktree-marker | story-1, story-2, story-3, story-4 | covered | New ADR; every sub-decision lands in a story |
| adr | adr-2026-07-09-setup-failure-triage | story-4 | covered | Amended 2026-08-26; force path preserves trigger contract |
| adr | adr-2026-08-07-project-teardown-hook-contract-and-containment | story-3 | covered | Amended 2026-08-26; dispatch-start copies its containment shape |
| story | story-1 | task-2, task-4, task-6, task-13 | covered | Skip + event + daemon threading + honest reporting for a scriptless project |
| story | story-2 | task-1, task-3, task-5, task-7 | covered | Marker mechanics, reasons, exclude |
| story | story-3 | task-10, task-11, task-12 | covered | Resolver, runner, wiring |
| story | story-4 | task-8, task-9 | covered | Force path + acceptance proof |
| task | task-1 | story-2 | covered | Infrastructure: marker helpers |
| task | task-2 | story-1 | covered | Gate predicate |
| task | task-3 | story-2 | covered | Marker write discipline |
| task | task-4 | story-1 | covered | Spine event |
| task | task-5 | story-2 | covered | Reason attribution |
| task | task-6 | story-1 | covered | Infrastructure: dispatch threading |
| task | task-7 | story-2 | covered | info/exclude |
| task | task-8 | story-4 | covered | Force opt + injections |
| task | task-9 | story-4 | covered | Acceptance proof |
| task | task-10 | story-3 | covered | Infrastructure: timeout resolver |
| task | task-11 | story-3 | covered | Contained runner |
| task | task-12 | story-3 | covered | Every-dispatch wiring |
| task | task-13 | story-1 | covered | Cites Story 1; makes the emitted event and daemon line honest when the project has no bin/setup |
| criterion | Story 1 happy: Given a worktree whose last `bin/setup` run succeeded and whose marker matches the current `bin/setup` content hash and resolved-base SHA, when the daemon dispatches the feature again, then `bin/setup` is not executed and a `project_setup` event with `ran: false, reason: marker-valid` is emitted and rendered in the daemon log | task-2, task-4 | covered | emits `{ ran: false, reason: 'marker-valid' }` on skip | diff-local |
| criterion | Story 1 happy: Given a project with no `bin/setup`, when the daemon dispatches, then behavior is unchanged from today (no setup, no marker written, existing "no bin/setup" logging preserved) | task-2, task-13 | covered | The no-`bin/setup` project path is byte-identical to today | diff-local |
| criterion | Story 1 negative: Given a marker file that is missing, corrupt JSON, or carries an unknown version, when the daemon dispatches, then `bin/setup` runs (fail-closed) and the emitted `project_setup` event names the reason (`no-marker` or `marker-invalid`) | task-2, task-5 | covered | corrupt/wrong-version marker ⇒ `marker-invalid` | diff-local |
| criterion | Story 1 negative: Given the marker's stored base SHA cannot be compared because base resolution fails, when the daemon dispatches, then `bin/setup` runs rather than being skipped on doubt | task-6 | covered | Base-resolution failure in the dep results in setup running (fail-closed) | diff-local |
| criterion | Story 2 happy: Given a worktree recreated from its branch (no marker present), when the daemon dispatches, then `bin/setup` runs and the event reason is `no-marker` | task-5 | covered | recreated dir (no marker) ⇒ `no-marker` | diff-local |
| criterion | Story 2 happy: Given a prepared worktree whose `bin/setup` content or mode changed since the marker was written, when the daemon dispatches, then `bin/setup` runs and the event reason is `script-changed` | task-5 | covered | changed script bytes and separately changed mode ⇒ `script-changed` | diff-local |
| criterion | Story 2 happy: Given a prepared worktree whose resolved base SHA moved (engine rebase or re-kick advanced the base), when the daemon dispatches, then `bin/setup` runs and the event reason is `base-moved` | task-5 | covered | changed `baseSha` opt ⇒ `base-moved` | diff-local |
| criterion | Story 2 happy: Given `bin/setup` completes successfully, when the marker is written, then it is written atomically to `«worktree»/.daemon/setup-ok.json` with the script hash and base SHA as identity and the commit as provenance only | task-1, task-3 | covered | The write path is temp-file + `rename` | diff-local |
| criterion | Story 2 negative: Given `bin/setup` exits non-zero, when the dispatch fails, then no marker is written and a subsequent dispatch runs `bin/setup` again | task-3 | covered | marker presence + field values after success, absence after failure | diff-local |
| criterion | Story 2 negative: Given task commits made by the build advanced the worktree HEAD but the resolved base is unchanged, when the daemon re-dispatches, then setup is still skipped (HEAD movement alone never invalidates) | task-2 | covered | HEAD movement alone never invalidates | diff-local |
| criterion | Story 2 negative: Given the marker file exists under `«worktree»/.daemon/`, when any porcelain-based consumer inspects the worktree (build-completion floor, triage tree classifier), then the marker never appears as an untracked file because `.daemon/` is in the worktree's `info/exclude` | task-7 | covered | Porcelain test passes in a real git worktree fixture with a written marker | diff-local |
| criterion | Story 3 happy: Given a project with an executable `bin/dispatch-start`, when the daemon dispatches a feature (including a dispatch that skipped setup), then the script runs in the worktree with `CI=true` and `WORKTREE_NAMESPACE` set, after the setup gate | task-11, task-12 | covered | two executions across two prepares (one cold, one skipped) | diff-local |
| criterion | Story 3 happy: Given a project without `bin/dispatch-start`, when the daemon dispatches, then nothing runs and no log line is added | task-11 | covered | absent script ⇒ silent no-op (no log line) | diff-local |
| criterion | Story 3 negative: Given `bin/dispatch-start` exits non-zero, when the dispatch proceeds, then the failure is contained to a log line (the dispatch is not failed and nothing is thrown) | task-11 | covered | non-zero exit ⇒ logged, not thrown | diff-local |
| criterion | Story 3 negative: Given `bin/dispatch-start` hangs, when the configured `dispatch_start_timeout_seconds` (default 120) elapses, then the script is killed, the timeout is logged, and the dispatch proceeds | task-11 | covered | timeout ⇒ killed, logged, not thrown | diff-local |
| criterion | Story 3 negative: Given a missing, non-numeric, zero, or negative `dispatch_start_timeout_seconds` config value, when the timeout is resolved, then it falls back to the default | task-10 | covered | default + all five malformed-value fallbacks | diff-local |
| criterion | Story 4 happy: Given a setup failure routed to triage, when triage's verification re-runs prepare (post-quarantine retry or post-fix check), then `bin/setup` executes for real (force path bypasses the marker) and a success rewrites the marker | task-8, task-9 | covered | a forced success rewrites the marker | diff-local |
| criterion | Story 4 happy: Given a forced setup run, when the `project_setup` event is emitted, then its reason is `forced` | task-8 | covered | fake setup executed, reason `forced` | diff-local |
| criterion | Story 4 negative: Given a valid marker exists in the worktree, when triage's verification prepare runs, then the marker does not short-circuit it — the verification observes the real `bin/setup` exit status | task-9 | covered | assert they execute the real script anyway | diff-local |
| criterion | Story 4 negative: Given setup was skipped by a valid marker, when the dispatch proceeds, then triage is never invoked (a skip cannot produce a `SetupFailureError`) | task-9 | covered | never invokes triage — asserted (triage spy not called) | diff-local |
| criterion | Story 4 negative: Given a forced setup run fails during triage verification, when triage classifies the outcome, then the existing `setup-still-failing` / dirty-tree handling is unchanged and no marker is written | task-8, task-3 | covered | Existing setup-triage unit tests pass unchanged | diff-local |
