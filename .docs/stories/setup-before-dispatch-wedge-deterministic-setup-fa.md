**Status:** Accepted

# Stories: Setup-before-dispatch wedge — deterministic setup-failure triage (#446)

Technical track — acceptance criteria derive from the technical intent and
`adr-2026-07-09-setup-failure-triage.md` (APPROVED). Scope: daemon dispatch only;
`autoresolve` and manual `/conduct` runs are unchanged.

## Story: Setup failure is classified, not generic

**Requirement:** ADR decision 1 (seam) — TS-1

As the daemon, I want a `bin/setup` failure to reach the dispatch layer as a classified
setup failure carrying its evidence, so that triage can act on it and every other error
keeps today's behavior.

### Acceptance Criteria

#### Happy Path
- Given a daemon worktree whose `bin/setup` exits non-zero, when the prepare step runs, then
  the failure reaching the dispatch layer identifies itself as a setup failure and carries
  the setup output tail (at minimum the final 50 lines of combined stdout/stderr).
- Given a daemon worktree whose `bin/setup` exits 0, when the prepare step runs, then
  dispatch proceeds exactly as today — no triage code path executes and no quarantine ref,
  log line, or marker is created.

#### Negative Paths
- Given a worktree where writing the namespace `.env` fails (e.g. permission denied) before
  `bin/setup` runs, when the prepare step throws, then the failure is NOT classified as a
  setup failure, triage does not run, and the feature errors + parks exactly as today.
- Given a project with no `bin/setup` script, when the prepare step runs, then the existing
  no-op path is taken and triage never activates.
- Given a `bin/setup` that cannot be spawned at all (ENOENT/EACCES on an existing script),
  when the prepare step fails, then the failure is still classified as a setup failure and
  carries the spawn error text as its evidence tail.

### Done When
- [ ] A unit test proves setup exit≠0 produces the classified failure with the output tail
      populated, and setup exit 0 produces no triage side effects (no ref, no log line).
- [ ] A unit test proves a namespace-write failure and a missing `bin/setup` both bypass
      triage.

## Story: Uncommitted breakage is quarantined and the feature dispatches

**Requirement:** ADR decisions 2–3 (quarantine + retry-once) — TS-2

As the daemon, I want a dirty worktree that fails setup to be preserved, reset, and retried
once, so a dead agent's uncommitted mess no longer wedges the feature.

### Acceptance Criteria

#### Happy Path
- Given a kept daemon worktree with uncommitted tracked modifications AND untracked files
  whose `bin/setup` fails, but whose HEAD state passes setup, when the feature is
  dispatched, then ALL uncommitted and untracked state is committed to branch
  `wip/setup-quarantine-<slug>` BEFORE any reset, the feature branch is reset to HEAD, the
  full prepare re-runs once (namespace `.env` re-established, then `bin/setup`), setup
  passes, and the feature dispatches normally with no error state.
- Given the quarantine happened, when the daemon logs the dispatch, then the log names the
  quarantine ref and the file paths preserved in it.

#### Negative Paths
- Given the quarantine commit cannot be created (any git failure during preservation), when
  triage runs, then NO reset or clean is performed, the worktree is left byte-for-byte as
  found, and the feature errors + parks exactly as today with the preservation failure named
  in the log.
- Given a quarantine branch `wip/setup-quarantine-<slug>` already exists from a prior
  rotation, when a new quarantine is taken, then the branch is updated to the new quarantine
  commit and the daemon log records that it was refreshed (the prior tip remains reachable
  via reflog).
- Given the post-quarantine setup retry ALSO fails (breakage is committed, not just dirty),
  when the retry completes, then no second mechanical retry occurs and triage proceeds to
  the fix-session stage with the retry's output tail as evidence.
- Given a dirty worktree whose `bin/setup` passes, when the feature is dispatched, then no
  quarantine occurs and the uncommitted state is untouched (resumability preserved).

### Done When
- [ ] An integration-style test (temp git repo, stub `bin/setup` controllable per-run)
      proves: dirty tree + failing-then-passing setup ⇒ quarantine branch exists containing
      exactly the pre-reset dirty state, feature branch clean at HEAD, dispatch proceeded.
- [ ] A test proves preservation failure ⇒ tree untouched (status output identical
      before/after) and outcome equals today's error-park.
- [ ] A test proves the retry re-runs the FULL prepare so `.env`
      (`WORKTREE_NAMESPACE`) exists after the quarantine reset cleaned it.
- [ ] A test proves quarantined content is byte-for-byte identical to the pre-reset state
      (content hash comparison per file, including untracked files).

## Story: Committed breakage gets exactly one mechanically-verified fix-session

**Requirement:** ADR decision 4 (fix-session bound + contract) — TS-3

As the daemon, I want a worktree that fails setup at a clean HEAD to receive one bounded
fix-session, so committed breakage from a dead agent is repaired without an operator.

### Acceptance Criteria

#### Happy Path
- Given a daemon worktree failing `bin/setup` at a clean HEAD, when triage reaches the
  fix-session stage, then exactly ONE fix-session is dispatched whose prompt contains the
  setup output tail, and after it returns the engine itself re-runs `bin/setup` and checks
  the tree: setup exit 0 AND a clean tree (fix committed) ⇒ the feature dispatches normally.

#### Negative Paths
- Given the fix-session returns claiming success but `bin/setup` still exits non-zero, when
  the engine verifies the contract, then the claim is ignored, the outcome is contract
  failure, and the HALT path is taken (agent reports are never trusted).
- Given the fix-session leaves uncommitted changes (setup passes but tree dirty), when the
  engine verifies the contract, then the contract fails (an unverifiable half-fix is not a
  pass) and the HALT path is taken with the dirty paths named.
- Given the fix-session dispatch itself throws (provider error, spawn failure), when triage
  handles it, then the outcome is contract failure routed to the HALT path — never an
  unhandled throw and never a second dispatch in this rotation.
- Given a feature already HALTed by a failed fix-session, when the operator clears the HALT
  and the feature is re-dispatched, then the next rotation may run one new fix-session
  (bound is per rotation, operator-gated between rotations).

### Done When
- [ ] Tests drive triage with an injected fix-session seam (no real agent spawn; production
      spawn guarded by the env kill-switch convention) proving: one dispatch per rotation,
      contract verified mechanically by re-running setup + tree-clean check, all three
      negative outcomes route to HALT.
- [ ] A test proves the fix-session prompt contains the setup output tail.

## Story: Triage failure HALTs with full evidence, never a silent discard

**Requirement:** ADR decisions 4–5 (HALT + surfacing) — TS-4

As the operator, I want a feature that triage could not heal to park with everything I need
named, so repair starts from evidence instead of forensics.

### Acceptance Criteria

#### Happy Path
- Given triage exhausted its ladder (quarantine+retry failed or was inapplicable, fix-session
  contract failed), when the feature parks, then a diagnostic `.pipeline/HALT` is written in
  the worktree naming: the setup output tail, the quarantine ref (when one was taken), and
  the fix-session contract outcome; the daemon log carries the same evidence; the feature is
  parked identically to today's error-park (rekick/clear semantics unchanged).

#### Negative Paths
- Given triage HALTs a feature for which NO quarantine was taken (clean-HEAD case), when the
  HALT is written, then it explicitly states no quarantine ref exists — the operator is never
  pointed at a ref that isn't there.
- Given the HALT write itself fails (fs error), when triage completes, then the feature still
  parks as an error and the write failure is logged — a marker failure never converts a
  failed triage into a dispatch.

### Done When
- [ ] A test proves the HALT content names setup tail + quarantine ref + contract outcome in
      the quarantined case, and states the absence of a ref in the clean-HEAD case.
- [ ] A test proves park semantics (kept worktree, parked status, rekick eligibility) are
      identical to the pre-feature error-park.

## Story: The resuming agent is told about quarantined WIP

**Requirement:** ADR decision 5 (surfacing) — TS-5

As the next build agent dispatched into a previously-quarantined worktree, I want the
quarantine ref surfaced to me, so legitimate WIP can be recovered deliberately instead of
silently lost.

### Acceptance Criteria

#### Happy Path
- Given a feature that dispatched after a quarantine, when the build session for that feature
  starts, then its context names the quarantine ref and the preserved file paths, and states
  that recovery is deliberate (inspect, cherry-pick or discard — never blind-merge).

#### Negative Paths
- Given a feature with no quarantine in its history, when its build session starts, then no
  quarantine notice appears (no noise on the normal path).
- Given the quarantine branch was deleted between rotations (external actor), when the build
  session starts, then the notice states the ref is missing rather than failing the dispatch.

### Done When
- [ ] A test proves the dispatch context contains the quarantine notice exactly when a
      quarantine was taken this rotation or a `wip/setup-quarantine-<slug>` ref exists.
- [ ] A test proves absence of the notice when no quarantine exists.
