# Stories: Project teardown hook before worktree removal

**Status:** Accepted

**Source:** `.docs/specs/bin-teardown-run-a-project-supplied-teardown-hook-.md` (FR-1 … FR-12)
**Authoritative design:** `adr-2026-08-07-project-teardown-hook-contract-and-containment`,
`adr-2026-08-07-worktree-removal-coverage-guard`

> **Test isolation.** Every scenario below is exercised against a **real, controllable fixture
> script** written into a temporary repository — never a mocked child process. Precedent:
> `src/conductor/test/acceptance/setup-triage-dispatch.acceptance.test.ts`, which builds a real
> `bin/setup` in a tmpdir with no `vi.mock`. No scenario here reaches a third-party service.

> **FR-12 (maintainer documentation) intentionally carries no story.** Per the stories
> documentation boundary, documentation that accompanies functional work is not storied. FR-12 is
> satisfied by plan tasks and is mapped directly to them in the coherence artifact, alongside the
> architecture review's Conditions 5 and 6 (same-PR documentation, and the integrity suite passing
> before commit), which are likewise plan-tracked rather than storied.

---

## Story 1: Teardown runs before removal on the daemon post-ship reap

**Requirement:** FR-1, FR-2, FR-5

As a project maintainer whose setup step provisions a namespaced database, I want my release step
to run when the daemon reaps a shipped feature's worktree, so that the database is dropped instead
of orphaned.

### Acceptance Criteria

#### Happy Path
- Given a prepared worktree containing an executable `bin/teardown` that appends the value of
  `WORKTREE_NAMESPACE` to a file outside the worktree, when the post-ship reap removes that
  worktree, then the file contains the same namespace value the setup run received, and the
  worktree directory no longer exists.
- Given a worktree whose `bin/teardown` records `process.env.CI` and its own working directory,
  when teardown runs, then the recorded `CI` value is `true` and the recorded working directory is
  the worktree path.
- Given a `bin/teardown` that asserts the worktree's own files are readable at the moment it runs,
  when the reap executes, then the assertions pass — proving teardown ran strictly before removal,
  not after.

#### Negative Paths
- Given a worktree with no `bin/teardown` but with a `bin/setup`, when the reap runs, then removal
  completes normally and no teardown process is spawned.
- Given a `bin/teardown` that exists but is **not executable**, when the reap runs, then the spawn
  error is contained, one failure log entry is emitted carrying the worktree path, and the worktree
  is still removed.
- Given a `bin/teardown` that reads `WORKTREE_NAMESPACE` and the variable were absent, when
  teardown runs, then this cannot occur — the scenario asserts the variable is present and
  non-empty on every invocation, so a project script can rely on it unconditionally.

### Done When
- [ ] `runProjectTeardown` is exported from `src/conductor/src/engine/worktree-prepare.ts` and is
      invoked by `daemon-deps.ts`'s `teardownWorktree` before the `git worktree remove` call.
- [ ] A test asserts the child process receives `env.CI === 'true'` and
      `env.WORKTREE_NAMESPACE === sanitizeNamespace(basename(worktreePath))`, and `cwd` equal to
      the worktree path.
- [ ] A test proves ordering by having the fixture script read a file inside the worktree and
      succeed.
- [ ] After the reap, `existsSync(worktreePath)` is false in every scenario above.

---

## Story 2: The namespace is derived from the worktree path, with no persisted state

**Requirement:** FR-3

As a maintainer recovering a feature whose worktree was recreated from its branch, I want teardown
to still address the right resources, so that a recovery does not silently orphan the namespace.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose transient `.pipeline/` directory has been deleted entirely, when teardown
  runs, then `WORKTREE_NAMESPACE` is identical to the value a fresh `prepareWorktree` would compute
  for the same path.
- Given two worktrees at different paths, when teardown runs for each, then each receives the
  namespace derived from its own basename and never the other's.

#### Negative Paths
- Given a worktree whose `.env` file has been deleted, when teardown runs, then the namespace is
  still correct — the value is recomputed from the path and is not read back from `.env`.
- Given a worktree whose basename contains characters that `sanitizeNamespace` rewrites, when
  teardown runs, then the value passed to the script is the **sanitized** form, byte-identical to
  what the setup run passed for that same worktree — not the raw basename.
- Given no teardown-specific marker or ledger file exists anywhere in the repository, when the full
  feature is implemented, then no scenario depends on one — asserted by the absence of any new
  persisted artifact in the implementation.

### Done When
- [ ] A test computes the expected namespace via the same `sanitizeNamespace(basename(...))` call
      and asserts equality with the value observed by the fixture script.
- [ ] A test deletes `.pipeline/` and `.env` before teardown and still observes the correct value.
- [ ] The implementation introduces no new file written at prepare time to support teardown.

---

## Story 3: A project with no teardown script is a completely silent no-op

**Requirement:** FR-4

As a maintainer of a project that provisions nothing, I want this feature to be invisible, so that
adopting a harness update costs me no new output, no new failure, and no new obligation.

### Acceptance Criteria

#### Happy Path
- Given a worktree with no `bin/teardown`, when any in-scope removal path runs, then the removal
  completes with its usual outcome and **zero** log lines are emitted about teardown.
- Given a repository that has never had a `bin/teardown`, when a full build-and-reap cycle runs,
  then the captured daemon log is byte-identical to the log produced before this feature existed.

#### Negative Paths
- Given a worktree with no `bin/teardown`, when the removal path runs with the verbose daemon
  setting enabled, then still **no** teardown log line appears — verbosity does not resurrect the
  skip notice.
- Given a `bin/teardown` that exists as a **directory** rather than a file, when the removal path
  runs, then the spawn failure is contained and logged once, and removal proceeds — the absent
  case and the malformed case are distinguishable in the log.
- Given a worktree path that no longer exists on disk when the removal path is reached, when
  teardown would be invited, then it is skipped without error and without a log line.

### Done When
- [ ] A test asserts the log sink receives **zero** calls for a worktree with no `bin/teardown`,
      in both default and verbose modes.
- [ ] The implementation contains no equivalent of `runProjectSetup`'s
      `log?.('no bin/setup — skipping project setup')` line on the teardown side.
- [ ] The removal outcome for the no-script case is asserted equal to the pre-feature behavior.

---

## Story 4: A retained worktree never runs teardown

**Requirement:** FR-5

As an operator resuming a halted build by hand, I want the harness to leave my retained worktree's
resources completely intact, so that resuming does not fail against a database that was dropped
underneath me.

> This is the highest-impact risk in the architecture review's register. `teardownWorktree` returns
> early when `keep === true`, and both `daemon-runner` call sites pass `keep === true` to retain the
> worktree for a human. Teardown must sit **after** that early return.

### Acceptance Criteria

#### Happy Path
- Given a worktree with an executable `bin/teardown` that records every invocation, when
  `teardownWorktree` is called with `keep === true`, then the recorder shows **zero** invocations,
  the worktree still exists, and its provisioned resources are untouched.
- Given the same worktree, when `teardownWorktree` is later called with `keep === false`, then
  teardown runs exactly once and the worktree is removed.

#### Negative Paths
- Given a halted build that retains its worktree via the error path, when the retention occurs,
  then no teardown process is spawned — asserted at the `daemon-runner` retention call site, not
  only at the `daemon-deps` unit level.
- Given a false-ship halt that retains its worktree, when the retention occurs, then likewise no
  teardown process is spawned.
- Given `teardownWorktree` is called with `keep === true` for a worktree with **no** `bin/teardown`,
  when it returns, then it emits no log line and performs no filesystem work — the early return is
  reached before any teardown consideration at all.

### Done When
- [ ] A test asserts zero teardown invocations for `keep === true` and exactly one for
      `keep === false`, using the same worktree fixture for both.
- [ ] The teardown call is positioned after the `if (keep) return;` guard in `teardownWorktree`,
      verified by a test rather than by inspection.
- [ ] Both `daemon-runner` retention paths are covered by a scenario asserting no spawn.

---

## Story 5: The operator's reclaim-worktree command releases resources

**Requirement:** FR-5

As an operator reclaiming a retained worktree by hand, I want its provisioned resources released
too, so that manual cleanup is real cleanup rather than a directory deletion.

### Acceptance Criteria

#### Happy Path
- Given a retained worktree with an executable `bin/teardown`, when the operator runs the
  reclaim-worktree command for that slug, then teardown runs once before the worktree is removed,
  and the command still reports the removal in its normal output.

#### Negative Paths
- Given a slug whose reclaim is refused because the feature is in progress, when the command exits
  non-zero, then **no** teardown is spawned — a refused reclaim must not release resources for work
  still running.
- Given a slug with no retained worktree on disk, when the command reports there is nothing to
  reclaim, then no teardown is spawned and no error is raised.
- Given a retained worktree whose `bin/teardown` exits non-zero, when the operator runs the
  command, then the failure is reported in the command's output, the worktree is still removed, and
  the command's exit status is unchanged from the success case.

### Done When
- [ ] Teardown is invoked in the reclaim path immediately before `removeWorktree`.
- [ ] A test asserts no spawn on the in-progress refusal branch and on the nothing-to-reclaim
      branch.
- [ ] A test asserts the command's exit status is identical with a passing and a failing teardown.

---

## Story 6: Parked-feature reconciliation releases resources on both removal branches

**Requirement:** FR-5

As an operator reconciling a parked feature that has since shipped, I want its resources released
whether the worktree is a registered git worktree or a leftover directory, so that neither shape of
cleanup leaves an orphan.

### Acceptance Criteria

#### Happy Path
- Given a reconciled slug whose worktree is a registered git worktree with an executable
  `bin/teardown`, when reconciliation cleans it up, then teardown runs once before removal and
  reconciliation reports its usual `worktree-removed` step.
- Given a reconciled slug whose path git never registered as a worktree, when reconciliation falls
  back to deleting the directory, then teardown has **already run** — the single invitation sits
  before the removal attempt, so both branches are covered by one call.

#### Negative Paths
- Given a reconciled slug whose worktree path does not exist on disk, when reconciliation runs,
  then teardown is skipped entirely — there is no script to execute — and reconciliation proceeds
  to its remaining steps.
- Given a worktree whose `bin/teardown` exits non-zero and whose `git worktree remove` then also
  fails on a path git **does** own, when reconciliation runs, then it still returns its existing
  `worktree-remove-failed` refusal — the teardown failure does not change the refusal reason or
  mask it.
- Given a `bin/teardown` that exceeds the time bound, when reconciliation runs, then teardown is
  abandoned at the bound and reconciliation's own outcome is identical to a run with no teardown
  script at all.

### Done When
- [ ] Exactly one teardown call exists in the reconciliation removal path, positioned before the
      `git worktree remove` attempt and inside the on-disk guard.
- [ ] A test drives the `rm -rf` fallback branch and asserts teardown ran.
- [ ] A test asserts the `worktree-remove-failed` refusal is preserved verbatim when teardown also
      failed.

---

## Story 7: A failing teardown never blocks removal and is reported loudly

**Requirement:** FR-6, FR-8

As an operator, I want a broken release script to be visible and harmless, so that I learn about a
leak without losing a worktree or a daemon to it.

### Acceptance Criteria

#### Happy Path
- Given a `bin/teardown` that exits non-zero after writing distinctive output, when any in-scope
  removal path runs, then exactly one failure log entry is emitted containing the worktree path and
  a tail of that output, and the worktree is removed.
- Given a failing teardown on the reap path, when the reap completes, then the reap's own outcome
  is identical to a run with a passing teardown.

#### Negative Paths
- Given a `bin/teardown` that emits far more than the tail limit, when it fails, then the log
  carries only the trailing portion — bounded, not the whole stream.
- Given a `bin/teardown` that exits non-zero and produces **no** output at all, when it fails, then
  a failure entry is still emitted, identifying the worktree, rather than an empty or absent line.
- Given a `bin/teardown` that cannot be spawned at all (missing interpreter on its shebang line),
  when the removal path runs, then the spawn error is contained, one failure entry is emitted, and
  removal still proceeds.
- Given a failing teardown, when the removal path completes, then no exception propagates to the
  caller — asserted by the caller having no `try`/`catch` around the teardown call.

### Done When
- [ ] `runProjectTeardown` has a return type that carries no error and a test asserts it never
      rejects across the non-zero, no-output, and spawn-error cases.
- [ ] Failure log entries carry a stable, greppable prefix asserted by test.
- [ ] The output tail is asserted bounded to the same limit the setup side uses.
- [ ] Each of the three in-scope removal paths has a scenario asserting its outcome is unchanged by
      a failing teardown.

---

## Story 8: A hanging teardown is bounded, and the bound is configurable

**Requirement:** FR-7

As an operator, I want a hung release script to cost me a bounded delay rather than a wedged
daemon, and I want to raise that bound when my infrastructure genuinely needs longer.

### Acceptance Criteria

#### Happy Path
- Given a `bin/teardown` that never returns and a short configured bound, when the removal path
  runs, then teardown is abandoned at the bound, one timeout log entry naming the worktree is
  emitted, and the worktree is removed.
- Given no `teardown_timeout_seconds` in configuration, when the bound is resolved, then it is the
  documented default of 120 seconds.
- Given `teardown_timeout_seconds` set to a valid positive number, when the bound is resolved, then
  that value is used and is the value applied to the child process.

#### Negative Paths
- Given `teardown_timeout_seconds` set to `0`, when the bound is resolved, then the default is used
  and one warning is logged — zero does **not** disable the bound, deliberately diverging from
  `auth_park_timeout_minutes` where zero is an opt-out signal.
- Given `teardown_timeout_seconds` set to a negative number, when the bound is resolved, then the
  default is used and one warning is logged.
- Given `teardown_timeout_seconds` set to a non-numeric value, when the bound is resolved, then the
  default is used and one warning is logged rather than an exception being thrown.
- Given `teardown_timeout_seconds` set to a non-finite number, when the bound is resolved, then the
  default is used and one warning is logged.
- Given a teardown that hangs and is abandoned, when the daemon continues, then the next dispatch
  proceeds normally — the abandoned child does not hold the loop.

### Done When
- [ ] A resolver for `teardown_timeout_seconds` exists in `resolved-config.ts` alongside the
      existing timeout resolvers, with a table-driven test covering zero, negative, non-numeric,
      non-finite, absent, and valid inputs.
- [ ] No configuration value produces an unbounded teardown — asserted exhaustively by that test.
- [ ] A test with a genuinely non-terminating fixture script asserts the timeout entry is emitted
      and the worktree is removed.

---

## Story 9: A successful teardown does not flood the log

**Requirement:** FR-9

As an operator reading the daemon log, I want a successful release step to be one line, so that
routine cleanup does not drown the signal I am actually looking for.

### Acceptance Criteria

#### Happy Path
- Given a `bin/teardown` that succeeds after printing many lines, when the removal path runs in
  default mode, then the log carries a single summary line and not the script's full output.
- Given the same script, when the removal path runs with the verbose daemon setting enabled, then
  the full output is echoed line by line.

#### Negative Paths
- Given a `bin/teardown` that succeeds and prints **nothing**, when the removal path runs, then no
  output-summary line is emitted — an empty stream produces no noise.
- Given a `bin/teardown` that succeeds and prints only blank lines, when the removal path runs,
  then those lines are dropped and not counted, matching the setup side's handling.
- Given a `bin/teardown` that **fails** after printing many lines, when the removal path runs in
  default mode, then the failure tail is emitted in full regardless of verbosity — suppression
  applies only to the success path.

### Done When
- [ ] A test asserts exactly one summary line in default mode and full echo in verbose mode for the
      same fixture.
- [ ] A test asserts blank-only and empty output produce no summary line.
- [ ] A test asserts the failure tail is unaffected by the verbose setting.

---

## Story 10: A new worktree-removal path cannot silently skip teardown

**Requirement:** FR-10

As a harness contributor adding a removal path, I want the suite to tell me a release obligation
exists, so that I do not reintroduce this leak without noticing.

### Acceptance Criteria

#### Happy Path
- Given the repository as shipped, when the structural guard runs, then it passes — every module
  containing a worktree-removal call is either routed through the teardown runner or listed in the
  exemption registry.
- Given a routed module, when the guard runs, then it asserts that module actually calls the
  teardown runner — not merely that it is named in the routed set.

#### Negative Paths
- Given a fixture module that issues a worktree-removal call and is in neither set, when the guard
  runs, then it fails with a message naming that module, stating both classification options, and
  citing the coverage-guard ADR.
- Given a routed module from which the teardown call has been deleted while the removal call
  remains, when the guard runs, then it fails — the guard catches regression, not only omission.
- Given a module whose only mention of worktree removal is inside a comment or a log string, when
  the guard runs, then it does **not** fire — the analysis is over call expressions, not text.
- Given a removal call whose command arguments cannot be resolved statically, when the guard runs,
  then it is treated as a match requiring classification rather than being skipped — the guard
  fails closed.
- Given the guard's own source file, when the guard runs, then it does not classify itself.

### Done When
- [ ] The guard lives in `src/conductor/test/structural/` and uses the TypeScript compiler API,
      matching the `test-execution-policy.test.ts` precedent.
- [ ] Fixture-driven tests cover the unclassified, deleted-invitation, comment-only,
      unresolvable-argument, and self-exclusion cases.
- [ ] The failure message text is asserted to contain the module path and the ADR reference.

---

## Story 11: The exemption registry is accurate and self-explaining

**Requirement:** FR-11

As a contributor reading the exemption registry, I want to know which exemptions are safe and which
are known gaps, so that a deferred leak stays actionable instead of looking like a settled decision.

### Acceptance Criteria

#### Happy Path
- Given the shipped registry, when it is inspected, then it contains exactly four entries —
  `autoresolve.ts`, `engineer/worktree-authoring.ts`, `worktree.ts`, and `worktree-shared.ts` —
  each with a non-empty reason.
- Given the `autoresolve.ts` entry, when its reason is read, then it states that the module prepares
  its worktree and therefore leaks, and that the exclusion is a deferred decision — distinguishable
  from the provisions-nothing exemptions.

#### Negative Paths
- Given an entry added with an empty or whitespace-only reason, when the guard runs, then it fails
  — an exemption without a stated reason is not a classification.
- Given an entry naming a module that no longer contains a removal call, when the guard runs, then
  it fails as a stale exemption, so the registry cannot silently rot.
- Given the `autoresolve.ts` reason, when it is compared against the provisions-nothing reasons,
  then it is not identical to them — asserted so a future edit cannot flatten the distinction the
  registry exists to preserve.

### Done When
- [ ] The registry is a literal array of `{ module, reason }` entries declared in the guard's own
      source.
- [ ] A test asserts all four entries are present with non-empty reasons.
- [ ] A test asserts a stale entry fails the guard.
- [ ] A test asserts the deferred-leak reason is distinct from the provisions-nothing reasons.
