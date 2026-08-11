**Status:** Accepted

# Stories: Worktree-local provider scratch lifecycle

Technical track — no PRD. Acceptance criteria derive from the technical intent in intake
jstoup111/ai-conductor#1223 and the approved design in
`adr-2026-08-09-worktree-local-provider-scratch`. The six conditions carried by
`architecture-review-2026-08-09-worktree-local-provider-scratch` are covered by Stories 1, 2,
4, 6, and 7.

## Story 1: Scratch root resolves inside the worktree, under an excluded prefix

**Requirement:** ADR decision — placement; review Conditions 1, 4, 6

As the harness, I want every throwaway provider home to resolve to a real directory beneath the
owning worktree's `.daemon/`, so that removing the worktree removes the scratch with it and no
scratch write can ever dirty a tracked path or trip the self-host live boundary.

### Acceptance Criteria

#### Happy Path
- Given a worktree at `«wt»` and an injected run id `R` and attempt `2` for provider `codex`, when the scratch root is resolved, then the returned path is `«wt»/.daemon/scratch/R/2-codex` and it is a real directory beneath `«wt»`.
- Given a resolved scratch path, when `git check-ignore` is run against it from the worktree, then the path is reported as ignored.
- Given a resolved scratch path, when its first path segment relative to the worktree is compared against `LIVE_CHECKOUT_VOLATILE`, then that segment is present in the list.
- Given two different attempts of the same run, when both resolve scratch paths, then the paths are distinct and neither is a prefix of the other.

#### Negative Paths
- Given `«wt»/.pipeline` is an outward symlink to a directory outside the worktree, when the scratch root is resolved, then the resolved path still lies beneath `«wt»` and does not traverse the symlink.
- Given a caller that supplies no worktree path, when scratch resolution is attempted, then it fails with an explicit error and never falls back to the main checkout root or to `process.cwd()`.
- Given a main checkout root and a worktree path that differ, when the scratch root is resolved for the worktree, then the resolved path is beneath the worktree and contains no segment of the main checkout's own `.daemon/`.
- Given a caller that supplies no run id, when scratch resolution is attempted, then it fails with an explicit error rather than resolving a shared root that two runs could collide on.
- Given a worktree path containing a trailing separator or a relative segment, when the scratch root is resolved, then the result is normalized and still lies beneath the worktree.

### Done When
- [ ] `resolveScratchRoot` returns `«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»` for a worktree path, injected run id, attempt index, and provider id.
- [ ] The function takes the worktree path as a required parameter, has no default, and contains no reference to `process.cwd()` or a main-root resolver.
- [ ] A test asserts the resolved path is git-ignored from the worktree.
- [ ] A test asserts the first relative path segment appears in `LIVE_CHECKOUT_VOLATILE` as exported by `live-boundary.ts`.
- [ ] A test constructs `«wt»/.pipeline` as a symlink to a temp directory outside the worktree and asserts the resolved scratch path is unaffected and still inside `«wt»`.

## Story 2: An owner lease records identity for every scratch home

**Requirement:** ADR decision — lease; review Condition 2

As the sweeper, I want each scratch home to carry a lease naming its repository, feature, run,
attempt, and owning process, so that a later reader can decide whether the home is still in use
without inspecting the home's contents.

### Acceptance Criteria

#### Happy Path
- Given a scratch home is acquired for repo `«repo»`, slug `«slug»`, run `R`, attempt `2`, when acquisition returns, then a lease exists in that home recording exactly `«repo»`, `«slug»`, `R`, `2`, the acquiring process id, and its start time.
- Given a lease is written, when it is read back, then every recorded field round-trips unchanged.
- Given a scratch home is acquired, when the lease is inspected, then it contains no token, credential, API key, or captured environment map.
- Given acquisition is in progress, when the acquire call returns to the caller, then the lease has already been written — the caller never observes a home without one.

#### Negative Paths
- Given the lease cannot be written (read-only or full filesystem), when acquisition runs, then acquisition fails, the partially-created home is removed, and the provider is not launched against it.
- Given a lease file containing malformed content, when it is read, then the read reports an unreadable lease rather than throwing or returning partially-populated fields.
- Given a lease missing a required field, when it is read, then the read reports an incomplete lease and does not substitute a default process id.
- Given the provider writes its own auth config into the home, when the lease is read afterward, then the lease content is unchanged and no credential material has leaked into it.
- Given two attempts of the same run acquire concurrently, when both leases are written, then each home carries its own lease with its own attempt index and neither overwrites the other.

### Done When
- [ ] An owner lease is written inside each acquired scratch home before the home path is returned to the caller.
- [ ] The lease carries exactly: repository identity, feature slug, run id, attempt index, owner process id, start time.
- [ ] A test asserts a lease round-trips all six fields.
- [ ] A test asserts a failed lease write removes the partial home and surfaces a provisioning error.
- [ ] A test asserts malformed and incomplete leases are reported as such rather than throwing or defaulting.
- [ ] A test enumerates the lease's serialized keys and asserts no credential-shaped field is present.

## Story 3: Both build-path creators use the scratch port

**Requirement:** ADR decision — one port; scope amendment excluding token-liveness

As the harness, I want `provisionProviderHome` and `provisionSandboxBuildEnv` to obtain their
homes from the scratch port instead of `os.tmpdir()`, so that every provider home created on a
build path is worktree-local and leased.

### Acceptance Criteria

#### Happy Path
- Given a codex self-host attempt in worktree `«wt»`, when its provider home is provisioned, then the home lies beneath `«wt»/.daemon/scratch/` and `CODEX_HOME` in the child environment points at it.
- Given a claude self-host attempt in worktree `«wt»`, when its sandbox build env is provisioned, then the config dir lies beneath `«wt»/.daemon/scratch/` and `CLAUDE_CONFIG_DIR` in the child environment points at it.
- Given either creator provisions a home, when the resulting environment is inspected, then no scratch path resolves under the system temporary directory.
- Given `verifyTokenLiveness` runs, when its probe home is created, then it is still created under the system temporary directory and no lease is written for it.

#### Negative Paths
- Given the scratch root cannot be created, when either creator provisions, then it raises its existing provisioning error type, removes any partial directory, and the provider is not launched.
- Given a worktree whose required `skills/` asset is missing, when the codex home is provisioned, then the existing missing-asset error is raised unchanged and the acquired scratch home is removed.
- Given a provisioning failure after the home is acquired but before the child launches, when the error propagates, then no leased scratch home is left behind.
- Given the caller supplies an explicit base directory override, when provisioning runs, then the override is honored, so existing tests that inject a temporary base directory continue to pass.
- Given a provider home is provisioned inside the worktree, when `git status` is run in that worktree, then the working tree is reported clean.

### Done When
- [ ] `provisionProviderHome` obtains its home from the scratch port when no explicit base directory is supplied.
- [ ] `provisionSandboxBuildEnv` obtains its config dir from the scratch port when no explicit base directory is supplied.
- [ ] `token-liveness.ts` is unchanged and continues to use the system temporary directory.
- [ ] A test asserts the codex child environment's `CODEX_HOME` resolves beneath the worktree.
- [ ] A test asserts the claude child environment's `CLAUDE_CONFIG_DIR` resolves beneath the worktree.
- [ ] A test asserts `git status` in the worktree reports clean while a provider home exists inside it.

## Story 4: A normally completed attempt leaves nothing behind

**Requirement:** Intake desired outcome 1 — normal completion leaves no provider home

As an operator, I want a provider attempt that finishes normally to remove its own scratch home,
so that steady-state operation accumulates nothing.

### Acceptance Criteria

#### Happy Path
- Given an attempt completes successfully, when its existing teardown runs in the enclosing `finally`, then the attempt's scratch home and its lease no longer exist on disk.
- Given an attempt fails but returns a result, when teardown runs, then the scratch home is still removed.
- Given teardown has already run once, when it is invoked again, then it is a no-op and does not throw.
- Given an attempt completes, when its parent run directory has no remaining attempt homes, then the run directory is removed as well.

#### Negative Paths
- Given the scratch home was already deleted out from under the process, when teardown runs, then it completes without error.
- Given a file inside the scratch home cannot be removed, when teardown runs, then the failure is reported and does not propagate out of the `finally` into the attempt's result.
- Given teardown raises, when the enclosing step has already produced a verdict, then that verdict is preserved and is not reported as a failure — the existing live-boundary precedent for not throwing out of teardown is maintained.
- Given a sibling attempt of the same run is still live, when one attempt tears down, then the sibling's scratch home and the shared run directory are left intact.

### Done When
- [ ] Attempt teardown removes the attempt's scratch home and lease.
- [ ] Teardown is idempotent and tolerates an already-removed home.
- [ ] A removal failure inside teardown is reported and never converts a completed step's verdict into a failure.
- [ ] A test asserts a completed attempt leaves no directory beneath the scratch root.
- [ ] A test asserts a concurrent sibling attempt's home survives another attempt's teardown.

## Story 5: An interrupted attempt's orphan is reclaimed at the next dispatch boundary

**Requirement:** Intake desired outcome 2 — deterministic orphan removal without deleting live homes

As an operator, I want a scratch home whose owning process was killed to be identified and
removed automatically, so that an interrupted run does not accumulate storage until a human
intervenes.

### Acceptance Criteria

#### Happy Path
- Given a scratch home whose lease names a process id that is no longer running, when the sweep runs at a dispatch boundary, then that home is removed.
- Given a scratch home whose lease names a currently-running process, when the sweep runs, then the home is left untouched.
- Given several orphaned homes across different runs of the same worktree, when the sweep runs once, then every orphan is removed in that single pass.
- Given no orphans exist, when the sweep runs, then nothing is removed and the sweep completes.
- Given the harness runs on a supported Linux or macOS host, when reclamation operates, then it uses the same code path on both, with no platform branch in the liveness probe or the sweep.
- Given a host with no systemd, launchd, cron entry, or operator-installed cleanup configuration, when the daemon runs, then reclamation still occurs — the sweep is driven only by the daemon's own dispatch boundary.

#### Negative Paths
- Given a scratch home with no lease at all, when the sweep runs, then the home is retained and the retention reason is reported — this covers the window where a directory exists before its lease is written.
- Given a scratch home whose lease is malformed or incomplete, when the sweep runs, then the home is retained and the reason is reported.
- Given process liveness cannot be determined, when the sweep runs, then the home is retained and the reason is reported.
- Given a lease whose recorded process id has been reused by an unrelated process, when the sweep runs, then the home is retained — the sweep never removes a home it believes is live.
- Given removal of an orphan fails, when the sweep runs, then the failure is reported, the sweep continues with the remaining candidates, and it does not throw into the dispatch loop.
- Given the sweep itself raises, when it runs at a dispatch boundary, then the throw is caught and reported and the daemon proceeds to dispatch exactly as it does for the adjacent reconciliation hooks.
- Given a scratch home is being acquired concurrently with the sweep, when the sweep evaluates it, then the home is retained.

### Done When
- [ ] A sweep runs at the daemon dispatch boundary alongside the existing reconciliation hooks and is optional in the same way they are.
- [ ] The sweep removes only homes whose lease names a positively-dead owner.
- [ ] Missing, malformed, incomplete, and undeterminable-liveness leases all result in retention plus a reported reason.
- [ ] A throw anywhere inside the sweep is caught; a test asserts dispatch still proceeds after a sweep that throws.
- [ ] A test asserts a live-owner home survives a sweep.
- [ ] A test asserts a dead-owner home is removed by a sweep.
- [ ] The liveness probe and the sweep contain no platform branch; a test asserts the module references no scheduler, service manager, or cron mechanism.

## Story 6: Feature cleanup removes all remaining scratch for that feature

**Requirement:** Intake desired outcome 4 — feature completion or worktree cleanup removes remaining scratch while preserving durable run-state

As an operator, I want retiring a feature's worktree to take all of that feature's scratch with
it, so that no reclamation depends on the sweep having run first.

### Acceptance Criteria

#### Happy Path
- Given a worktree containing scratch homes, when the worktree is removed via the existing force-removal path, then no scratch directory for that feature remains on disk.
- Given a worktree containing both scratch homes and run-state, when the worktree is removed, then durable run-state that lives outside the worktree is untouched.
- Given a worktree is removed while some of its scratch homes have live owners, when removal completes, then those homes are gone along with everything else in the worktree, exactly as the existing removal semantics dictate.

#### Negative Paths
- Given the git worktree removal fails and the existing filesystem fallback runs, when the fallback completes, then the scratch directories are still removed.
- Given durable run-state has been relocated outside the worktree, when the worktree is removed, then the relocated run-state directory still exists afterward and only the worktree-local scratch is gone.
- Given a scratch home contains a file the removal cannot delete, when worktree removal runs, then the existing removal error handling applies unchanged and the failure is not silently swallowed.
- Given a feature's worktree was already removed, when cleanup runs again, then it completes without error and removes nothing.

### Done When
- [ ] No new reaper is added; scratch removal on feature cleanup is a consequence of the existing worktree removal paths.
- [ ] A test creates scratch homes inside a worktree, removes the worktree through the production removal path, and asserts the scratch is gone.
- [ ] A test asserts run-state located outside the worktree survives that same removal.

## Story 7: Cleanup decisions and failures are observable

**Requirement:** Intake desired outcome 7 — observable cleanup decisions including owning feature/run and reason

As an operator diagnosing storage growth, I want every reclamation, retention, and cleanup
failure to appear on the existing telemetry spine with its owning feature, run, and reason, so
that I can see what the harness decided without inspecting directories by hand.

### Acceptance Criteria

#### Happy Path
- Given the sweep reclaims an orphan, when it completes, then an event is emitted naming the owning repository, feature slug, run id, attempt, path, and the reason it was reclaimed.
- Given the sweep retains a home, when it completes, then an event is emitted naming the same identity fields and the specific retention reason (no lease, malformed lease, incomplete lease, live owner, undeterminable liveness).
- Given a cleanup removal fails, when the sweep completes, then an event is emitted naming the path and the error.
- Given any of these events is emitted, when the event ledger is read back, then the events are present in the same `ConductorEvent` schema every existing consumer already parses.
- Given the daemon is running, when cleanup events are emitted, then they are visible through the existing daemon log as a consumer of the spine.

#### Negative Paths
- Given event emission fails, when the sweep runs, then the cleanup itself still completes and the emission failure does not throw into the dispatch loop.
- Given a home has no readable lease, when its retention event is emitted, then the identity fields are reported as unknown rather than fabricated or omitted.
- Given an existing consumer that does not recognize the new event variants, when it reads the ledger, then it continues to parse the ledger without error.
- Given cleanup runs, when the repository is searched for new telemetry sinks, then no bespoke log file, reporting sidecar, or second ledger schema has been introduced. Story 2's `owner.json` lease is durable state, not a telemetry sink, and does not count against this check.

### Done When
- [ ] New `ConductorEvent` union variants exist for reclaimed, retained, and failed scratch cleanup.
- [ ] Each variant carries repository, feature slug, run id, attempt, path, and reason.
- [ ] Events are emitted through `ConductorEventEmitter` and persisted by the existing `EventPersister` with no new persistence path.
- [ ] A test asserts each of the five retention reasons produces a distinct, readable reason value.
- [ ] A test asserts an emission failure does not prevent the cleanup or disrupt dispatch.
- [ ] No new *telemetry* sink is added — no bespoke log file, no second ledger schema, no
      cleanup-reporting sidecar. This criterion constrains reporting channels only. Story 2's
      `owner.json` lease is durable state read by name, not a telemetry sink, and is expressly
      outside this criterion; a test written from this story must not assert that the lease is
      absent.

## Story 8: Historical leaked directories are collected once

**Requirement:** Intake observed evidence — the already-leaked set; review Condition 3

As an operator, I want the directories already leaked under the historical temporary-directory
prefixes to be reclaimed automatically, so that the fix also clears the backlog that caused the
reported quota failure.

### Acceptance Criteria

#### Happy Path
- Given orphaned directories exist matching the historical `self-host-*` and `harness-selfbuild-*` prefixes in the system temporary directory, when the legacy collection runs at the first dispatch boundary, then those directories are removed.
- Given the legacy collection has already run once, when subsequent dispatch boundaries occur, then it does not run again.
- Given legacy directories are collected, when the collection completes, then an event names every directory removed and every one retained, with the reason for each.

#### Negative Paths
- Given a directory in the system temporary directory that does not match the historical prefixes exactly, when the legacy collection runs, then it is not removed.
- Given a legacy-prefixed directory that is still covered by a live lease or is otherwise in use by a running process, when the collection runs, then it is retained and the reason is reported.
- Given a legacy-prefixed directory created after the current process started, when the collection runs, then it is retained — the collection never removes a directory it cannot establish as pre-existing.
- Given removal of one legacy directory fails, when the collection runs, then the failure is reported and the remaining candidates are still evaluated.
- Given the system temporary directory cannot be listed, when the collection runs, then the failure is reported and the dispatch loop is not disrupted.
- Given the collection runs, when directories belonging to another tool or another repository are present, then none of them is removed because prefix matching is exact and liveness is required.

### Done When
- [ ] A one-time legacy collection runs at the first dispatch boundary only.
- [ ] It matches the historical `self-host-*` and `harness-selfbuild-*` prefixes exactly and nothing else.
- [ ] It refuses to remove any directory that is live, leased, or newer than the current process start.
- [ ] It emits an event naming every directory removed and every one retained with its reason.
- [ ] A test asserts a non-matching directory in the same parent is left untouched.
- [ ] A test asserts a matching-but-live directory is retained.
