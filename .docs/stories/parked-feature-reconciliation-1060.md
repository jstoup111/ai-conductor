**Status:** Accepted

# Stories: Parked-Feature Reconciliation Sweep (#1060)

Technical track. Source: `adr-2026-07-27-ancestry-proven-park-reconciliation`, architecture review 2026-07-27, conflict report 2026-07-27. Operator decision: full hybrid now — auto-cleanup default ON behind `reconcile_parked_auto_cleanup`, no follow-up.

## Story S1: Sweep runs as an injected daemon dep at startup and each idle tick

As a daemon operator, I want the parked-feature reconciliation pass wired like the existing halt-PR sweep so that parks are reconciled continuously without a new poll loop.

### Acceptance Criteria

#### Happy Path
- Given a daemon booted with a `reconcileParkedFeatures` dep, when startup completes, then the sweep has run once before the first idle sleep, and it runs again on each idle poll tick.
- Given two consecutive ticks with identical outcomes for every parked slug, when the second tick's sweep completes, then no repeat per-slug lines and no repeat summary line are written to the daemon log (outcome-cache suppression).

#### Negative Paths
- Given a daemon booted WITHOUT the dep (undefined), when startup and ticks run, then the sweep is a silent no-op and no error is logged.
- Given the sweep throws internally (e.g. `.daemon/parked/` unreadable), when `sweepBestEffort` runs it, then the daemon loop continues and a single `[daemon] reconcileParkedFeatures error: …` line is logged.
- Given one parked slug whose classification throws (e.g. git failure), when the pass runs, then remaining slugs are still processed and the failing slug is logged as skipped (per-slug error isolation).

### Done When
- [ ] `daemon.ts` declares an optional `reconcileParkedFeatures?: () => Promise<void>` dep and `sweepBestEffort()` invokes it at startup and per idle tick, alongside `reconcileHaltPrs`.
- [ ] `daemon-cli.ts` binds the dep with a per-run outcome cache, mirroring the `haltPrSweepCache` wiring.
- [ ] A wiring test in the shape of `daemon-halt-reconciliation.test.ts` proves: startup invocation before first dispatch, once-per-tick, throw swallowed, absent dep = no-op.

## Story S2: Fully-merged parked feature is auto-reconciled by default

As a daemon operator, I want a parked feature whose branch is already contained in `origin/main` — and whose shipped record is on main — to be cleaned up and unparked automatically so that merged work stops rotting in the parked set.

### Acceptance Criteria

#### Happy Path
- Given `reconcile_parked_auto_cleanup` is unset or `true`, and a parked slug whose `feature/<slug>` branch tip satisfies `git merge-base --is-ancestor feature/<slug> origin/main`, and `.docs/shipped/<slug>.md` exists on the base branch, when the sweep classifies it, then the guarded helper runs: the `.worktrees/<slug>` worktree is removed, the `feature/<slug>` branch is deleted, the park marker is removed last, and one `[parked-reconciliation] reconciled <slug>` line is logged.
- Given the worktree directory is already gone but the branch exists and is an ancestor (record on main), when reconciled, then the branch is deleted and the park marker removed (missing worktree treated as an already-done step).

#### Negative Paths
- Given a parked slug whose branch is NOT an ancestor of `origin/main`, when the sweep runs, then nothing is deleted and the slug is passed to issue-state classification instead.
- Given an ancestry-proven slug whose `.docs/shipped/<slug>.md` is MISSING from the base branch, when the sweep runs, then no worktree/branch/marker is removed this pass; the helper resolves the merged implementation PR (e.g. `gh pr list --state merged --head feature/<slug>`) and hands record creation to the ST-916 record-only repair-PR seam, logging "not reconcilable until the record lands". If no merged PR is resolvable, it reports and makes zero record writes.
- Given `origin/main` does not exist locally (no remote or never fetched), when the sweep classifies the slug, then the slug is skipped for this pass with no state change and no deletion.
- Given the branch `feature/<slug>` does not exist at all, when the sweep classifies the slug, then no ancestry claim is made and the slug falls through to issue-state classification (a missing branch is not "merged").
- Given the worktree's `.pipeline/` indicates an in-progress run (park was placed over a live attempt), when the helper runs, then it refuses to remove the worktree this pass and logs the reason (mid-loop-pipeline-wipe audit invariant).

### Done When
- [ ] Acceptance test: temp git repo with a merged parked feature + shipped record on base → after one sweep pass, worktree, branch, and park marker are gone.
- [ ] Acceptance test: not-ancestor branch → byte-identical worktree/branch/marker state after the pass.
- [ ] Acceptance test: ancestry-proven but record missing → nothing deleted; record creation delegated (repair-PR seam invoked or zero-writes report), marker survives.
- [ ] Acceptance test: in-flight `.pipeline` → worktree untouched.

## Story S3: Auto-cleanup is governed by `reconcile_parked_auto_cleanup` (default `true`)

As an operator, I want a config kill-switch for autonomous cleanup so that I can drop the daemon back to surface-only behavior without losing classification.

### Acceptance Criteria

#### Happy Path
- Given `reconcile_parked_auto_cleanup: false` in `config.yml`, when the sweep classifies a merged, record-on-main park, then NO destructive action occurs and the dashboard annotates the slug `merged — ready to reconcile`.
- Given the key is absent, when config resolves, then the effective value is `true` (auto-cleanup on).
- Given the toggle is `false`, when the operator runs `conduct daemon reconcile-parked <slug>`, then the verb still reconciles that slug (the toggle governs the sweep only, never the operator verb).

#### Negative Paths
- Given `reconcile_parked_auto_cleanup: "yes"` (non-boolean), when config loads, then validation fails with a hard error naming the key (consistent with existing config validation behavior).
- Given the toggle is flipped while the daemon runs, when the next tick fires, then the daemon still uses its startup-resolved value (config is read at daemon startup; a change requires restart — matching existing daemon config semantics) and this is documented.

### Done When
- [ ] Config schema accepts the boolean key, defaults `true`, hard-errors on non-boolean (`config.ts` validation + unit test).
- [ ] Sweep tests cover both toggle states: off → annotate-only with zero destructive calls; on → helper invoked.
- [ ] `docs/reference/configuration.md` documents the key, its default, and restart semantics in the same PR.

## Story S4: Guarded single-slug cleanup helper re-verifies everything at the point of deletion

As a harness maintainer, I want every deletion to flow through one helper that accepts exactly one named slug and re-proves its preconditions itself so that no caller — sweep, verb, or future code — can delete unmerged or live work.

### Acceptance Criteria

#### Happy Path
- Given a slug whose branch is an ancestor of `origin/main`, record on main, and no in-flight run, when the helper is called with that single slug, then it performs worktree remove → branch delete → unpark (marker removal last, via the unpark implementation's missing-worktree counter-reset fallback), and returns a structured outcome naming each step taken.

#### Negative Paths
- Given a caller that classified the slug as merged but the branch has since gained a new commit (no longer an ancestor), when the helper runs, then it refuses to delete anything and returns/logs a refusal naming the failed ancestry check (re-verification is internal, never trusts the caller).
- Given a slug argument containing a glob, a path separator, or a comma-separated list, when the helper is called, then it rejects the input without touching git.
- Given the branch delete fails after the worktree was removed, when the helper completes, then the failure is reported in the outcome (not swallowed) and the park marker is left in place so the slug is re-examined next pass.
- Given the unpark counter-reset genuinely fails (not the missing-worktree fallback), when the helper reaches the unpark step, then the park marker survives and the outcome is non-success (never half-unparked, per the accepted unpark contract).

### Done When
- [ ] Unit tests: refusal on not-ancestor, refusal on record-missing, refusal on in-flight, refusal on malformed slug input, ordering (marker removal last), partial-failure reporting.
- [ ] The sweep and the CLI verb both call this helper; a grep/audit test asserts no other code path in the change deletes a worktree or branch, and the operator-park single-writer assertion is re-scoped to "park-marker module + guarded reconcile helper" exactly as the amended FR-7 story states.

## Story S5: Operator verb `conduct daemon reconcile-parked <slug>`

As an operator, I want a safe manual command for reconciling one parked feature so that I never hand-run `rm -rf` / `git branch -D` sequences again.

### Acceptance Criteria

#### Happy Path
- Given a parked, fully-merged slug with its record on main, when I run `conduct daemon reconcile-parked <slug>`, then the guarded helper reconciles it and the command prints what was done (worktree removed / branch deleted / unparked) and exits 0.

#### Negative Paths
- Given a slug that is not parked or does not validate (no `.docs/plans/<slug>.md` and no `.worktrees/<slug>`), when I run the verb, then it prints an actionable message and exits non-zero without touching git.
- Given a parked slug whose branch is not an ancestor of `origin/main`, when I run the verb, then it refuses with the ancestry result (and the issue-state classification when resolvable) and exits non-zero — it never offers a force path.
- Given no slug argument or extra arguments, when I run the verb, then usage guidance is printed and nothing is executed.

### Done When
- [ ] `daemon reconcile-parked <slug>` is detected pre-boot alongside `daemon park|unpark` and dispatched without starting the daemon.
- [ ] The verb is registered in the `bin/conduct` known-subcommand forwarding list (unknown-subcommand guard) with a shell test.
- [ ] CLI tests in the shape of `daemon-park-cli.test.ts` cover: happy reconcile, not-ancestor refusal, invalid slug, usage errors.
- [ ] `docs/reference/cli.md` and `docs/guides/running-the-daemon.md` document the verb in the same PR.

## Story S6: Orphaned parks are surfaced as a distinct dashboard category

As a daemon operator, I want parks whose target issue is closed but whose branch is not merged to be visibly flagged so that they stop hiding among normally-parked features.

### Acceptance Criteria

#### Happy Path
- Given a parked slug with an intake marker whose `Source-Ref:` issue is closed and whose branch is NOT an ancestor of `origin/main`, when the dashboard renders, then the slug's PARKED line carries a distinct `orphan — needs manual review` annotation alongside its existing provenance suffix.
- Given the same conditions, when the sweep classifies the slug, then a log line records the orphan verdict once (not repeated every tick while unchanged).

#### Negative Paths
- Given a parked slug whose intake marker is missing or whose `Source-Ref:` does not parse (parse via the shared sourceRef parser — the intake brain-sweep's parse, not a new one), when the sweep runs, then the slug is NOT labeled orphan, nothing is deleted, and the slug renders as a normal parked entry (fail-closed: no classification → no action).
- Given the `gh` issue-state lookup fails (network, rate limit, issue not found), when the sweep runs, then the slug keeps its previous rendering for this pass and no orphan label is added on error.
- Given a parked slug whose issue is still open, when the sweep runs, then the slug renders as a normal parked entry with no annotation.

### Done When
- [ ] `ParkedEntry` (or its rendering) carries the orphan annotation and `renderDashboard` output shows it, proven by a dashboard unit test (PARKED precedence over other groups unchanged).
- [ ] Acceptance test: closed-issue + not-ancestor park renders orphan; missing-marker park does not.
- [ ] An orphan is never passed to the cleanup helper (asserted in sweep tests).

## Story S7: Remote and tracker failures degrade to inaction, never to a guess

As a harness maintainer, I want every external failure in the sweep to fail toward "do nothing this pass" so that transient conditions can never trigger deletion or mislabeling.

### Acceptance Criteria

#### Happy Path
- Given a pass where git and `gh` behave, when the sweep completes, then a single summary line reports counts (reconciled / deferred-awaiting-record / orphaned / parked / skipped), suppressed on subsequent unchanged passes.

#### Negative Paths
- Given `git merge-base` exits with an unexpected error (not the documented exit 1 "not ancestor"), when classifying a slug, then the slug is skipped (not treated as not-ancestor, not treated as merged) and the error is logged once.
- Given `gh` is entirely unavailable, when the pass runs, then merged-class reconciliation (a pure-git fact plus a record already on the base branch) still proceeds, orphan classification and repair-PR delegation are skipped, and the pass completes without throwing.
- Given the daemon is running in a repo with no remote at all, when the pass runs, then the sweep is a per-slug no-op (no `origin/main` → no ancestry proof → no deletion) and logs this reason at most once.

### Done When
- [ ] Sweep unit tests cover: unexpected git error → skip; gh-down → record-on-main path still works, delegation skipped; no-remote → no-op with single log line.
- [ ] No code path in the sweep or helper interprets an external failure as authorization to delete.
