**Status:** Accepted

# Stories: Setup-triage decides on the setup exit, not solely a residual dirty tree (#582)

Technical track (no PRD). Requirements derive from issue jstoup111/ai-conductor#582 and stay
within the APPROVED `adr-2026-07-09-setup-failure-triage` contract (still parks; captures strays;
does not change park→proceed — see track doc scope boundary). Stories state observable behavior
of the daemon setup-failure triage (`engine/setup-triage.ts` `fixSession` + `engine/daemon-runner.ts`
park rendering).

---

## Story 1: A setup-success-with-dirty-tree is never reported as "setup failed" (#582 fixture)

**Requirement:** Issue #582 desired outcome 1 & 2

As the daemon operator, I want a triage whose `bin/setup` re-run exited 0 but left the tree
dirty to be surfaced accurately as a dirty-tree block — not as a setup failure — so that a
healthy environment is never misattributed as a setup failure that hides the real cause.

### Acceptance Criteria

#### Happy Path
- Given the #582 shape — the stage-2 fix-session's `dispatchFixSession` resolves and `runPrepare`
  (bin/setup) **succeeds** (exit 0), but `git status --porcelain` afterward reports
  ` M src/conductor/src/engine/conductor.ts` — when `fixSession` settles, then the returned
  outcome is `kind:'park'` with `contractOutcome:'dirty-tree-uncleaned'` (a discriminator
  distinct from the setup-failure `'setup-still-failing'`) and a non-empty `outputTail` that
  states the setup succeeded and the tree could not be cleaned (never the word combination
  "setup failed").
- Given that same park outcome routed through `makeRunFeature`'s daemon triage path, when the
  feature reason and the `.pipeline/HALT` note are rendered, then neither contains the literal
  `setup failed and parked after triage`; the reason names the dirty-tree cause and the
  `contractOutcome: dirty-tree-uncleaned` line, and the daemon log line for this park is not the
  bare setup-failure form.

#### Negative Paths
- Given the fix-session's `runPrepare` **throws** a `SetupFailureError` (genuine nonzero setup
  exit) after `dispatchFixSession` resolved, when `fixSession` settles, then the outcome is
  `kind:'park'` with `contractOutcome:'setup-still-failing'` and the setup error tail in
  `outputTail` — the genuine-failure path is unchanged from today.
- Given the porcelain check after a successful `runPrepare` reports an **empty** tree, when
  `fixSession` settles, then the outcome is `kind:'fixed-pass'` exactly as today (no dirty-tree
  branch taken, no quarantine attempted).

### Done When
- [ ] An engine test drives `fixSession` with resolving dispatch + succeeding `runPrepare` +
      dirty porcelain and asserts `kind:'park'`, `contractOutcome:'dirty-tree-uncleaned'`, and an
      `outputTail` that does not contain "setup failed".
- [ ] A daemon-runner test asserts the rendered feature reason and HALT note for that outcome
      contain neither `setup failed and parked after triage` nor a bare "setup failed", and do
      contain the dirty-tree cause.
- [ ] A test asserts a throwing `runPrepare` still yields `contractOutcome:'setup-still-failing'`.
- [ ] A test asserts an empty porcelain after success still yields `fixed-pass`.

---

## Story 2: The dirty-tree block quarantines ALL uncommitted paths, including tracked-modified

**Requirement:** Issue #582 desired outcome (capture) + hypothesis 2

As the daemon operator, I want the residual uncommitted paths that survive the fix-session
(including tracked-modified files like `conductor.ts`, which stage-1 quarantine missed because
they went dirty afterward) to be preserved in the quarantine ref, so that a later re-dispatch
reset can never silently discard them and I can recover them deliberately.

### Acceptance Criteria

#### Happy Path
- Given `fixSession` reaches the dirty-tree-after-setup-success branch with porcelain reporting
  a tracked-modified path (` M src/conductor/src/engine/conductor.ts`) and an untracked stray
  (`?? scratch.txt`), when the branch runs, then it captures **all** of those paths via the
  existing quarantine mechanism (`git add -A` → commit → `git branch -f wip/setup-quarantine-<slug>`
  → `reset --hard`), the returned outcome carries the resulting `quarantineRef`, and its
  `preservedPaths` lists exactly the captured paths (tracked-modified included).
- Given a stage-1 quarantine ref `wip/setup-quarantine-<slug>` already exists (from the earlier
  rotation that captured the 3 docs), when the dirty-tree branch quarantines, then the ref is
  refreshed (force-moved) to the new capture — the prior tip remains reachable via reflog — and
  the outcome names the refreshed ref.

#### Negative Paths
- Given the residual-stray quarantine itself fails (e.g. `git add -A` or the commit returns
  nonzero), when the branch runs, then triage falls toward the current error-park behavior (never
  toward data loss): the outcome is `kind:'park'` naming the preservation failure, and the tree
  is not left in a half-reset state — matching stage-1's fail-toward-park discipline
  (`setup-triage.ts` quarantine rollback paths).
- Given `dispatchFixSession` throws (LLM dispatch failed) before any `runPrepare`, when
  `fixSession` settles, then it parks with the dispatch error and **no** quarantine is attempted
  (unchanged) — the dirty-tree capture only runs on the setup-succeeded-but-dirty path.

### Done When
- [ ] An engine test asserts the dirty-tree branch invokes the quarantine mechanism over a
      porcelain that includes a tracked-modified path and asserts the outcome's `preservedPaths`
      contains that tracked path and `quarantineRef` is set.
- [ ] A test with a pre-existing quarantine ref asserts it is force-moved (refreshed), not
      duplicated or errored.
- [ ] A test where the capture's `git add`/commit returns nonzero asserts a park naming the
      preservation failure (no silent proceed, no data loss).
- [ ] A test asserts a throwing `dispatchFixSession` parks with no quarantine attempted.
