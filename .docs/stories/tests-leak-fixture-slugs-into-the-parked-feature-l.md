**Status:** Accepted

# Stories: Tests leak fixture slugs into the parked-feature ledger (#1251)

Technical track (no PRD) — acceptance criteria are stated directly here. Tier **S**, so
negative paths are required per story (at least one), not per criterion.

## Background (verified root cause)

`writeAutoPark`/`writeOperatorPark`/`removeOperatorPark` in
`src/conductor/src/engine/park-marker.ts` call `resolveMainRepoRoot(root)`, which runs
`git rev-parse --git-common-dir` from the passed root. When that root sits inside a git
repository, resolution walks **up** to the enclosing repo and the marker is written to
*that* repo's `.daemon/parked/`.

Every vitest fixture root is `mkdtemp(join(tmpdir(), …))`, and `os.tmpdir()` reads `TMPDIR`
at call time. So whenever `TMPDIR` resolves inside a git repository — a daemon build agent
or a sandbox that points `TMPDIR` into the workspace — every park-marker test writes into
the developer's real `.daemon/parked/`.

Reproduced directly: with `TMPDIR` set inside a disposable git repo, one run of
`test/engine/park-marker.test.ts` deposited `slug-1`, `slug-2`, `non-git-feature`,
`callback-fire-test`, `my-feature`, `permission-denied-test`,
`non-git-auto-provenance`, `non-git-operator-park`, `non-git-operator-provenance` into
that repo's root — the same slug family named in #1251.

`park-marker.ts` itself is correct and is **not** changed by this work: resolving to the
main root is the #486 fix that makes worktree-written markers visible to the daemon gate.
The defect is that the test harness lets fixture roots be *inside a real repo at all*.

---

## Story 1: Fixture roots can never resolve to an enclosing real repository

**Requirement:** #1251 desired outcome — "Test fixture park markers remain isolated to
disposable test roots."

As a developer running the default test suite, I want every temp fixture root to be
invisible to any enclosing git repository, so that repo-resolving production code under
test can never reach my real repository.

### Acceptance Criteria

#### Happy Path
- Given the vitest run temp root is installed, when any test resolves a repository root from
  a directory under that run root, then git discovery stops at the run root and resolution
  falls back to the passed directory — it never returns a path outside the run root.
- Given a test creates its own git repository inside its fixture directory, when production
  code resolves the repository root from that fixture, then it resolves to the fixture's own
  repository (containment does not break legitimate in-fixture git usage).
- Given a test creates a linked worktree of a fixture repository under the run root, when
  production code resolves the main root from that worktree, then it resolves to the fixture
  repository's own git directory — the #486 worktree-visibility behavior is preserved.
- Given the containment is installed in the parent vitest process, when a forked test worker
  runs, then the worker observes the same containment (it is inherited, not re-derived).

#### Negative Paths
- Given `TMPDIR` is pointed at a directory nested inside a real git repository, when the
  park-marker test files run, then no marker file is created anywhere in that enclosing
  repository's `.daemon/parked/` — this is the exact reproduction above and it must not
  reproduce after the fix.
- Given a test writes a park marker from a fixture root that is *not* a git repository,
  when the write completes, then the marker is at `<fixtureRoot>/.daemon/parked/<slug>` and
  the fixture root is unchanged as the resolution result (the existing non-git fallback
  tests keep passing).
- Given the containment mechanism cannot be installed (its value cannot be computed), when
  the run starts, then the run fails loudly at setup with a message naming the missing
  containment — it never silently proceeds unprotected.

### Done When
- [ ] Running `test/engine/park-marker.test.ts` with `TMPDIR` set inside a disposable git
      repository leaves that repository's `.daemon/parked/` absent or empty, and the file's
      tests pass.
- [ ] A test asserts, from inside a forked worker, that the containment value is present and
      equals the parent's — mirroring `test/tmpdir-redirect-propagation.test.ts`.
- [ ] A test asserts resolution from a fixture directory under the run root does **not**
      return a path outside the run root when an enclosing repository exists.
- [ ] A test asserts resolution still succeeds for a git repository created *inside* a
      fixture, and for a linked worktree of it.
- [ ] `src/conductor/src/engine/park-marker.ts` is byte-for-byte unchanged by this work.

---

## Story 2: A park-leak guard fails the run on any change to the real parked ledger

**Requirement:** #1251 desired outcomes — "After a test run, the real `.daemon/parked/`
inventory is byte-for-byte unchanged" and "Default tests never create, remove, or retain
park markers in the developer's real repository."

As a developer, I want the suite to fail loudly if a test run added, removed, or modified
any marker in my real `.daemon/parked/`, so that a future leak is caught at the moment it
appears instead of surfacing weeks later as a wrong dashboard count.

### Acceptance Criteria

#### Happy Path
- Given a snapshot of the real `.daemon/parked/` taken before the run and an identical
  snapshot taken at teardown, when the two are diffed, then the diff is empty and the run
  passes with no guard output.
- Given a marker file was **added** to the real parked directory during the run, when
  teardown diffs the snapshots, then the run fails with an error naming the added slug(s)
  and citing #1251.
- Given a marker file was **removed** from the real parked directory during the run, when
  teardown diffs the snapshots, then the run fails naming the removed slug(s) — a test that
  unparks a real operator park is as damaging as one that parks a fake feature.
- Given a marker file's **contents changed** during the run, when teardown diffs the
  snapshots, then the run fails naming the modified slug(s) — provenance (`auto` vs
  `operator`) must survive a test run intact.

#### Negative Paths
- Given the real parked directory does not exist at all (a fresh clone that has never
  parked anything), when the guard snapshots and diffs, then it reports no leak and does
  not throw — an absent directory is a valid empty ledger, not a guard failure.
- Given the pre-run snapshot could not be read (permissions, transient I/O error), when
  teardown runs, then the guard fails **open**: it logs a warning that it was not enforced
  and does not fail the run — matching the fail-safe stance of the tmux and tmpdir guards.
- Given the guard's own diff decision is invoked with an added slug, when the decision
  function is called directly in a unit test, then it throws — the throw-vs-warn decision is
  unit-testable in isolation from vitest and filesystem wiring, like
  `applyTeardownDecision` / `applyTmpdirTeardownDecision`.

### Done When
- [ ] A new guard module exists alongside its four siblings in `src/conductor/test/`,
      exporting a snapshot function and a pure diff function.
- [ ] A pure `apply…TeardownDecision`-shaped function exists that throws on a non-empty diff
      and is unit-tested directly for added, removed, modified, and empty diffs.
- [ ] Unit tests cover: absent directory → no leak; failed baseline snapshot → warn, not
      throw; identical snapshots → empty diff.
- [ ] The failure message names the offending slugs and references #1251.

---

## Story 3: The guard is wired into the real run without pre-empting existing guards

**Requirement:** #1251 desired outcome — "The parked dashboard count reflects only real
operator or daemon actions."

As a developer, I want the park-leak guard wired into the actual vitest lifecycle against
the real repository, so that it protects every default run rather than existing only as
unit-tested helpers.

### Acceptance Criteria

#### Happy Path
- Given `test/global-setup.ts` runs, when setup completes, then the real parked directory
  has been snapshotted before any test executes.
- Given all tests complete, when teardown runs, then the park-leak guard is evaluated and,
  on a clean run, produces no output and does not fail.
- Given the guard watches the **real** repository's parked directory, when it resolves that
  path, then it resolves it independently of any test-process redirect — the same stance as
  `REAL_ENGINEER_DIR`, which deliberately ignores the redirected env var so the guard can
  prove the redirect is working.
- Given a full default `vitest run` of the suite, when it completes, then the real
  `.daemon/parked/` listing and every marker body are identical to before the run.

#### Negative Paths
- Given both a `.pipeline` leak and a park leak occurred in the same run, when teardown
  evaluates its guards, then the `.pipeline` failure is reported first — the new guard is
  ordered so it never pre-empts an existing, more specific guard's verdict.
- Given the guard throws an unexpected non-guard error at teardown (not its own leak
  verdict), when teardown handles it, then the error degrades to a logged warning and the
  run is not failed by it — the fail-safe wrapper used for the signals guard.
- Given a park leak is detected at teardown, when the guard fails the run, then it does
  **not** delete or "repair" the real markers — it reports only; cleanup of a real
  repository is the operator's decision.

### Done When
- [ ] `test/global-setup.ts` snapshots the real parked directory in `setup()` and evaluates
      the guard inside `runTeardownGuards()`.
- [ ] The guard's position in `runTeardownGuards()` is after the `.pipeline`, tmux, and
      signals guards; a test or explicit comment records the ordering rationale.
- [ ] A full `vitest run` leaves the real `.daemon/parked/` byte-for-byte unchanged
      (listing and file contents), verified against a snapshot taken before the run.
- [ ] The guard never writes to or removes anything from the real parked directory.
