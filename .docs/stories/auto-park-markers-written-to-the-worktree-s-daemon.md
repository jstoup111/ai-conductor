**Status:** Accepted

# Stories: Park-Marker Main-Root Resolution (#486)

Technical track — acceptance criteria derived from
`adr-2026-07-10-park-marker-main-root-resolution.md` (APPROVED). Roles: "daemon" = the
autonomous build loop; "operator" = a human running `conduct-ts` verbs.

## Story: resolveMainRepoRoot anchors any in-repo directory to the main root

**Requirement:** ADR decision 1

As the daemon, I want one helper that maps any directory to its main repository root so
that every park operation lands at a single, predictable location.

### Acceptance Criteria

#### Happy Path
- Given a linked worktree directory `<main>/.worktrees/<slug>`, when
  `resolveMainRepoRoot(worktreeDir)` is called, then it returns `<main>` (the parent of
  the common `.git` directory).
- Given the main checkout root itself, when `resolveMainRepoRoot(mainRoot)` is called,
  then it returns `mainRoot` (relative `--git-common-dir` output `.git` is joined against
  the start directory before taking its parent).
- Given the same directory resolved twice in one process, when the second call happens,
  then no second `git` subprocess is spawned (memoized per `startDir`).

#### Negative Paths
- Given a temp directory that is not inside any git repository, when
  `resolveMainRepoRoot(tmpDir)` is called, then it returns `tmpDir` unchanged and does not
  throw.
- Given a directory where the `git` binary is unavailable or `rev-parse` exits non-zero
  (e.g. unborn/corrupt repo), when resolution is attempted, then the helper returns the
  start directory unchanged and the failure is observable via an injectable log callback
  (no silent divergence).
- Given a start directory that does not exist, when resolution is attempted, then the
  helper returns the given path unchanged and does not throw.

### Done When
- [ ] `resolveMainRepoRoot` is exported from `park-marker.ts` and unit-tested for:
      worktree → main, main → main, non-git → identity, missing dir → identity.
- [ ] A memoization test proves one subprocess per unique `startDir` (spy/counter on the
      git runner).

## Story: All park-marker primitives converge on the main root

**Requirement:** ADR decision 2

As the daemon, I want every park-marker primitive to read and write
`<main>/.daemon/parked/<slug>` regardless of the root the caller holds, so that writer and
gate can never diverge.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree of a real repo, when `writeAutoPark(worktreeRoot, slug, reason)`
  runs, then the marker file exists at `<main>/.daemon/parked/<slug>` with the
  `auto-parked: <reason>` body, and NO `.daemon/parked/` entry is created under the
  worktree.
- Given that marker, when `isOperatorParked(mainRoot, slug)` and
  `isOperatorParked(worktreeRoot, slug)` are called, then both return `true` (gate and
  writer see the same file).
- Given that marker, when `getProvenanceType(worktreeRoot, slug)` is called, then it
  returns `'auto'`; and `listOperatorParkedSlugs(worktreeRoot)` includes `slug`.
- Given `removeOperatorPark(worktreeRoot, slug)`, when it completes, then the main-root
  marker is gone and `isOperatorParked(mainRoot, slug)` returns `false`.

#### Negative Paths
- Given a non-git temp root (unit-test fixture), when any primitive runs against it, then
  it behaves exactly as before this change (markers under `<tmpRoot>/.daemon/parked/`) —
  the fallback preserves byte-for-byte pre-#486 semantics.
- Given two concurrent `writeAutoPark` calls for the same slug from DIFFERENT roots
  (worktree and main) of the same repo, when both run, then exactly one marker file exists
  at the main root (exclusive `wx` create; loser sees EEXIST → no-op) and neither call
  throws.
- Given an unreadable marker (permission error), when `isOperatorParked` is called from a
  worktree root, then it still fails toward parked (`true`) and reports via the log
  callback — the resolution change does not weaken read semantics.

### Done When
- [ ] Integration-style test on a real temp git repo + linked worktree proves
      write-from-worktree / read-from-main convergence for all six primitives.
- [ ] Existing park-marker unit tests (tmp-dir, non-git) pass unmodified.

## Story: Capped features stop re-dispatching (sweep gate sees worktree-placed parks)

**Requirement:** ADR decisions 1–2 (the #486 regression itself)

As the daemon, I want a feature auto-parked during a worktree-rooted run to be skipped by
every subsequent rekick sweep so that a capped feature never burns agent rounds again.

### Acceptance Criteria

#### Happy Path
- Given a conductor run inside `.worktrees/<slug>` that hits the no-evidence cap, when
  `checkAndAutoPark(worktreeRoot, slug, {daemon: true, …})` fires, then the next
  `rekickSweep` skips `<slug>` with the `operator-parked` skip log line and performs no
  abort/clear/re-dispatch for it.

#### Negative Paths
- Given an interactive run (`daemon: false`) inside a worktree, when the cap is reached,
  then no marker is written at ANY root (auto-park stays daemon-gated).
- Given the park marker is removed between sweeps (operator unpark), when the next sweep
  runs, then `<slug>` is eligible again (no residual cached "parked" state).

### Done When
- [ ] A daemon-mode test seeds a capped feature in a linked worktree, runs the sweep, and
      asserts `skipped` contains the slug with zero dispatch side effects.
- [ ] The conductor call site (`checkAndAutoPark(this.projectRoot, …)`) is verified to
      need no change (the primitive resolves) — asserted by the integration test above.

## Story: daemon park/unpark act on the main root from anywhere in the repo

**Requirement:** ADR decision 3

As an operator, I want `conduct-ts daemon park <slug>` run from inside a worktree to park
the feature for the daemon (not silently no-op), and to see exactly where the marker went.

### Acceptance Criteria

#### Happy Path
- Given a shell cwd inside `.worktrees/<slug>`, when `daemon park <slug>` runs, then the
  marker is created at `<main>/.daemon/parked/<slug>` and the command output contains that
  ABSOLUTE marker path.
- Given a shell cwd at the main root, when `daemon park <slug>` runs, then behavior is
  unchanged from today plus the echoed absolute path.
- Given a slug whose plan exists only at the main root (`.docs/plans/<slug>.md`), when
  `daemon park <slug>` runs from a worktree, then `validateSlug` passes (validation runs
  against the RESOLVED root, not raw cwd).

#### Negative Paths
- Given a typo'd slug known at neither the resolved root's `.docs/plans/` nor
  `.worktrees/`, when `daemon park <slug>` runs from a worktree, then it exits 1 with the
  existing "not found" error and writes nothing at either root.
- Given a slug already parked at the main root, when `daemon park <slug>` runs from a
  worktree, then the "already parked" message appears (with original timestamp when
  readable) and the marker is untouched (same mtime/content).
- Given a cwd outside any git repository, when `daemon park <slug>` runs, then the
  fallback keeps today's cwd-anchored behavior (no crash, no new failure mode).

### Done When
- [ ] `dispatchDaemonPark` tests cover park/unpark from a worktree cwd of a real temp
      repo, asserting main-root marker placement and the absolute path in output.
- [ ] `validateSlug` is tested against the resolved root (plan-only-at-main case from a
      worktree cwd).

## Story: Unpark resets the no-evidence counter where it actually lives

**Requirement:** ADR decision 4

As an operator, I want unparking an auto-parked feature to reset the counter that caused
the park so that the feature does not instantly re-park on its next dispatch.

### Acceptance Criteria

#### Happy Path
- Given an auto-parked slug whose worktree `.worktrees/<slug>/.pipeline/task-evidence.json`
  records attempts ≥ cap, when `daemon unpark <slug>` runs (from any cwd in the repo),
  then that WORKTREE counter file is reset and the "reset no-evidence counter" message is
  printed.
- Given the reset counter, when the daemon next dispatches the feature and evaluates
  `checkAndAutoPark`, then `{ parked: false }` is returned (no instant re-park).

#### Negative Paths
- Given an auto-parked slug whose worktree no longer exists, when `daemon unpark <slug>`
  runs, then the counter reset falls back to the resolved root's own `.pipeline/`
  (pre-#486 location), the command still exits 0, and the fallback is stated in output.
- Given an operator-parked (not auto-parked) slug, when `daemon unpark <slug>` runs, then
  NO counter is reset anywhere (provenance check unchanged).
- Given a worktree whose `.pipeline/` is unwritable, when unpark attempts the reset, then
  the command reports the failure and exits non-zero WITHOUT having removed the park
  marker (marker removal only after a successful reset — no freed-but-doomed state).

### Done When
- [ ] Unpark tests cover: worktree counter reset, missing-worktree fallback,
      operator-provenance no-reset, and reset-failure ordering (marker survives).
- [ ] The reset targets `.worktrees/<slug>/.pipeline/task-evidence.json` under the
      RESOLVED main root — asserted with a worktree-cwd invocation.

## Story: Sweep-start reconciliation rescues stranded worktree markers

**Requirement:** ADR decision 5

As the daemon, I want markers stranded under `.worktrees/*/.daemon/parked/` by pre-fix
runs to be moved to the main root automatically so that already-looping features park
without manual ops.

### Acceptance Criteria

#### Happy Path
- Given `.worktrees/<slug>/.daemon/parked/<slug>` exists (pre-fix stranded auto-park) and
  no main-root marker, when the rekick sweep starts, then the marker file exists at
  `<main>/.daemon/parked/<slug>` with its ORIGINAL body (provenance preserved), the
  worktree copy is gone, and the same sweep already skips `<slug>` as parked.
- Given no stranded markers anywhere, when the sweep starts, then reconciliation is a
  no-op (no logs beyond debug, no filesystem writes).
- Given reconciliation already ran once, when the next sweep starts, then it finds nothing
  to move (idempotent — second run is a no-op).

#### Negative Paths
- Given markers for the same slug at BOTH the worktree and the main root, when
  reconciliation runs, then the MAIN copy's content is kept unchanged (first-writer-wins,
  matching `wx` semantics) and the worktree copy is deleted.
- Given a stranded marker that cannot be moved (e.g. unreadable/permission error), when
  reconciliation runs, then that marker is logged and skipped, the sweep continues, and
  every other stranded marker is still reconciled (per-marker isolation, never fatal).
- Given a worktree directory that contains `.daemon/parked/` entries for a DIFFERENT slug
  than the worktree's own (cross-slug stray), when reconciliation runs, then the marker is
  still moved to the main root keyed by its own filename (the marker filename, not the
  worktree name, is the slug).

### Done When
- [ ] `reconcileStrandedParkMarkers(mainRoot)` exists in `park-marker.ts`, is invoked at
      rekick-sweep start in daemon-cli, and is covered by tests for: move, both-roots
      main-wins, idempotence, per-marker failure isolation, cross-slug stray.
- [ ] An end-to-end daemon test proves a pre-seeded stranded marker results in the slug
      being skipped in the SAME sweep that reconciled it.
