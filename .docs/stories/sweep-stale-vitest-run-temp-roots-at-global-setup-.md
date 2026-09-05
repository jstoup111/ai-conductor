**Status:** Accepted

# Stories: Sweep stale vitest run temp roots at global setup

Source: jstoup111/ai-conductor#2223. Track: technical, Tier S, sweep-only scope per `.docs/track/sweep-stale-vitest-run-temp-roots-at-global-setup-.md`. Repo-only: the tmpdir leak guard exists only in this repository's own vitest suite (`src/conductor/test/`).

Design constraint carried from explore: self-host containment runs `--unshare-pid` with the real `/` bound, so concurrent daemon builds share the operator's tmpdir but cannot see each other's pids. Liveness is therefore a heartbeat marker inside each run root, never a pid probe (departure from `adr-2026-08-09-worktree-local-provider-scratch`, recorded there by amendment).

## Story 1: A live run advertises its ownership of its temp root

**Requirement:** #2223 expected behaviour, "show no live owner".

As a suite maintainer, I want every vitest run to leave a namespace-independent liveness signal inside its own run root so that a later sweep can tell a live concurrent run from an abandoned one without seeing its process.

### Acceptance Criteria

#### Happy Path

- H1: Given global setup has installed this run's root, when setup completes, then the root contains an owner marker file recording the run's pid, hostname, and start time, and its mtime is the heartbeat.
- H2: Given a run in progress, when the heartbeat interval elapses, then the owner marker's mtime is refreshed without creating any other entry in the root or the real tmpdir.
- H3: Given a run reaching global teardown, when the run root is removed, then the heartbeat timer is cleared first and the marker disappears with the root; the teardown leak diff reports no new real-tmpdir entry attributable to the marker.

#### Negative Paths

- N1: Given the owner marker cannot be written or refreshed (permission denied, root already removed), when setup or a heartbeat tick hits the error, then the failure is logged once through the guard logger and the run continues; the suite neither throws nor fails because of the marker.
- N2: Given a run interrupted by SIGINT or SIGTERM, when the existing interrupt reap runs, then the heartbeat timer is cleared so the process can exit and no further marker refresh occurs after the root is reaped.

### Done When

- [ ] `src/conductor/test/tmpdir-leak-guard.ts` exports a marker writer and heartbeat starter/stopper that take the root path and an injected clock/fs seam, unit-tested without touching the real tmpdir.
- [ ] `src/conductor/test/global-setup.ts` writes the marker after the root is installed, starts the heartbeat, and stops it in both the teardown path and the interrupt reap path.
- [ ] A unit test proves a marker write failure logs and does not throw.

## Story 2: Global setup reaps orphaned run roots left by earlier interrupted runs

**Requirement:** #2223 expected behaviour, sweep at setup and report what was swept.

As an operator, I want a suite run to remove run roots abandoned by previous interrupted runs so that repeated interrupted runs no longer accumulate until the tmpdir is exhausted.

### Acceptance Criteria

#### Happy Path

- H1: Given the real tmpdir contains `ai-conductor-vitest-run-*` roots whose owner marker heartbeat is older than the staleness window, when global setup runs its pre-run sweep before the baseline tmpdir snapshot, then each such root is removed recursively, including read-only nested directories.
- H2: Given at least one root is reaped, when the sweep completes, then one logger line names the count and every removed root path and states the debris came from a previous run, mirroring the tmux sweep's report shape.
- H3: Given no stale roots exist, when the sweep runs, then nothing is removed and nothing is logged.
- H4: Given the sweep decision is computed from an enumerated entry list plus per-root marker readings, when the decision helper is called with injected inputs, then it returns the reap and retain sets with a reason per retained root, with no filesystem access.

#### Negative Paths

- N1: Given a stale root whose removal fails (EACCES, EBUSY, or a removal error part-way), when the sweep handles it, then the failure is logged naming the root and the error, the remaining stale roots are still attempted, and setup continues; the run is never failed by the sweep.
- N2: Given the real tmpdir cannot be listed, when the sweep runs, then it reaps nothing, logs the read failure once, and setup continues (fail open toward retention, matching the guard's failed-baseline stance).
- N3: Given the sweep runs under the real tmpdir window opened for the tmux sweep, when it reaps, then it observes `os.tmpdir()` as the real tmpdir, not this run's redirected root, and never enumerates entries inside the run root.

### Done When

- [ ] `tmpdir-leak-guard.ts` exports a pure sweep decision helper and an fs-backed sweep runner with an injected removal seam; both are unit-tested with fixture snapshots, never the real tmpdir.
- [ ] `global-setup.ts` runs the sweep before `snapshotTmpdirEntries` and inside the existing real-tmpdir window, and its report line is asserted in a test.
- [ ] A unit test proves a removal failure is logged, later roots are still attempted, and no error propagates.

## Story 3: The sweep never reaps a root that might still be owned

**Requirement:** #2223 expected behaviour, "a concurrent run's root is legitimately not this run's leak"; adr-2026-08-09 retention-on-ambiguity.

As an operator running concurrent daemon builds, I want the sweep to leave any root that could still belong to a live run untouched so that one suite can never destroy another suite's temp state.

### Acceptance Criteria

#### Happy Path

- H1: Given a root whose owner marker heartbeat is younger than the staleness window, when the sweep decides, then the root is retained with reason `live`.
- H2: Given this run's own root, when the sweep decides, then it is retained with reason `own-root` regardless of its marker state.
- H3: Given a root with no owner marker at all and a directory mtime older than the legacy fallback window (24h), when the sweep decides, then it is reaped so pre-marker debris drains once.
- H4: Given the staleness window is overridden through the guard's single named override, when the sweep decides, then the override value is used and reported in the retain reasons.

#### Negative Paths

- N1: Given a root with no owner marker and a directory mtime younger than the legacy fallback window, when the sweep decides, then the root is retained with reason `unmarked-recent`.
- N2: Given a root whose owner marker is present but unreadable or malformed, when the sweep decides, then the root is retained with reason `marker-unreadable` and the reason is logged; it is never reaped on that evidence.
- N3: Given an entry under the real tmpdir that matches the prefix but is a file or a symlink rather than a directory, when the sweep decides, then it is retained with reason `not-a-directory` and never followed or removed.
- N4: Given two suites start within the same second and both sweep, when each reads the other's fresh marker, then neither reaps the other's root and both runs complete with their roots intact until their own teardown.

### Done When

- [ ] The decision helper's unit tests cover every retain reason (`live`, `own-root`, `unmarked-recent`, `marker-unreadable`, `not-a-directory`) and both reap cases (stale marker, legacy unmarked past 24h).
- [ ] The staleness window and legacy fallback are named exported constants in `tmpdir-leak-guard.ts` with one documented override, not literals at the call site.

### Coverage disposition

Stories 1–3 map to a single build task set in the plan. Every criterion is unit-testable through injected fs/clock/logger seams (no real-tmpdir topology, per `architecture-review-2026-07-29-deterministic-test-suite-step`). The change touches test infrastructure, so the aggregate suite runs at validation. Relevant negatives are deletion safety, concurrent ownership, and fail-open cleanup; no auth, network, queue, or schema behaviour is introduced.

Status: Accepted
