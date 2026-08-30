**Status:** Accepted

# Stories: Setup-triage decides on the setup exit, not solely a residual dirty tree (#582)

Technical track (no PRD). Requirements derive from issue jstoup111/ai-conductor#582 and stay
within the APPROVED `adr-2026-07-09-setup-failure-triage` contract (still parks; captures strays;
does not change park→proceed — see track doc scope boundary). Stories state observable behavior
of the daemon setup-failure triage (`engine/setup-triage.ts` `fixSession` + `engine/daemon-runner.ts`
park rendering).

---

## Story 1: Setup-success repair state is classified accurately (#582 fixture)

**Requirement:** Issue #582 desired outcome 1 & 2

As the daemon operator, I want a triage whose `bin/setup` re-run exited 0 to distinguish a stable
repair from setup-added drift, so that a valid repair can proceed and a rejected attempt is never
misattributed as a setup failure.

### Acceptance Criteria

#### Happy Path
- Given the #582 shape — the stage-2 fix-session leaves
  ` M src/conductor/src/engine/conductor.ts` without moving HEAD, and forced `runPrepare`
  (bin/setup) **succeeds** without changing the captured Git tree — when `fixSession` settles,
  then the engine commits exactly the captured repair, verifies a clean worktree, and returns
  `kind:'fixed-pass'` rather than quarantining the repair.
- Given forced setup succeeds but adds, removes, or changes Git-visible content relative to the
  captured repair, when the resulting park is routed through `makeRunFeature`, then the reason,
  `.pipeline/HALT`, and daemon log name setup drift and the preserved attempt; none reports that
  setup failed.

#### Negative Paths
- Given the fix-session's `runPrepare` **throws** a `SetupFailureError` (genuine nonzero setup
  exit) after `dispatchFixSession` resolved, when `fixSession` settles, then the outcome is
  `kind:'park'` with `contractOutcome:'setup-still-failing'` and the setup error tail in
  `outputTail` — the genuine-failure path is unchanged from today.
- Given the porcelain check after a successful `runPrepare` reports an **empty** tree, when
  `fixSession` settles, then the outcome is `kind:'fixed-pass'` exactly as today (no dirty-tree
  branch taken, no quarantine attempted).
- Given the provider leaves commits plus uncommitted residue, when `fixSession` classifies the
  attempt, then it preserves and parks with `mixed-commit-and-residue`; it never treats the setup
  exit alone as proof that the repair is safe.

### Done When
- [ ] An engine test drives `fixSession` with resolving dispatch + succeeding `runPrepare` +
      a byte-stable captured repair and asserts an exact engine commit plus `kind:'fixed-pass'`.
- [ ] A daemon-runner test asserts a setup-drift park's rendered feature reason and HALT note
      contain neither `setup failed and parked after triage` nor a bare "setup failed", and do
      contain the drift cause and preservation evidence.
- [ ] A test asserts a throwing `runPrepare` still yields `contractOutcome:'setup-still-failing'`.
- [ ] A test asserts an empty porcelain after success still yields `fixed-pass`.

---

## Story 2: Every rejected dirty repair is preserved completely before reset

**Requirement:** Issue #582 desired outcome (capture) + hypothesis 2

As the daemon operator, I want a rejected fix-session attempt, including tracked modifications,
provider commits, and untracked residue, preserved completely before any reset, so that rejection
never silently discards work and I can recover it deliberately.

### Acceptance Criteria

#### Happy Path
- Given `fixSession` rejects an attempt for setup drift or mixed commits plus residue, including
  a tracked-modified path (` M src/conductor/src/engine/conductor.ts`) and an untracked stray
  (`?? scratch.txt`), when preservation runs, then `wip/setup-quarantine-<slug>` reaches the
  complete attempted state before any reset, the returned outcome carries that `quarantineRef`,
  and `preservedPaths` lists every captured path.
- Given a stage-1 quarantine ref `wip/setup-quarantine-<slug>` already exists (from the earlier
  rotation that captured the 3 docs), when a rejected attempt is preserved, then the ref is
  refreshed (force-moved) to the new capture — the prior tip remains reachable via reflog — and
  the outcome names the refreshed ref.

#### Negative Paths
- Given preservation itself fails before the ref reaches the complete attempted state, when the
  branch runs, then triage parks naming the preservation failure and performs no reset; an older
  quarantine tip is never treated as proof that the current attempt is safe to discard.
- Given `dispatchFixSession` throws (LLM dispatch failed) before any `runPrepare`, when
  `fixSession` settles, then it parks with the dispatch error and **no** quarantine is attempted
  (unchanged) — preservation runs only when the attempt produced Git-visible repair state.

### Done When
- [ ] A real Git test rejects a mixed commit-plus-residue attempt, proves the quarantine ref
      contains the complete attempted state, and asserts `preservedPaths` plus `quarantineRef`.
- [ ] A test with a pre-existing quarantine ref asserts it is force-moved (refreshed), not
      duplicated or errored.
- [ ] A test where ref refresh or capture returns nonzero asserts a park naming the preservation
      failure and proves the attempted state was not reset.
- [ ] A test asserts a throwing `dispatchFixSession` parks with no quarantine attempted.
