**Status:** Accepted

# Stories: Reliable Vitest temporary storage

Source: jstoup111/ai-conductor#2224. Technical track, Tier S. The operator accepted these three stories on 2026-09-11 with “great, yes then proceed”, explicitly restricting the feature to ai-conductor's own Vitest tooling. The scope is placement plus preserved protections, not quotas or scheduling.

## Story 1: Run Vitest using checkout-local temporary storage

**Requirement:** Approved default-storage story and repository-only scope.

As an ai-conductor contributor, I want ordinary and smoke test temporary files on the checkout's filesystem so the suite does not select the system temporary filesystem by default.

### Acceptance Criteria

#### Happy Path
- Given no storage override and a writable checkout, when an ordinary or smoke test invocation starts, then its temporary root and early Vitest temporary allocations are contained in ignored checkout-local storage before tests execute.
- Given an initialized test run, when configuration reloads or workers start, then they reuse that run's temporary root and preserve the Git discovery ceiling.

#### Negative Paths
- Given concurrent invocations or nested smoke execution, when another run starts and finishes, then its disposable root is distinct and its cleanup leaves the other run's root and files intact.

### Done When
- [ ] Ordinary-launcher and smoke-entry fixtures record checkout-local allocation before their injected Vitest boundary runs.
- [ ] Configuration/worker proof records a stable root and a canonical Git ceiling; concurrent and nested fixtures retain the surviving run's sentinel file.

## Story 2: Select storage explicitly and stop when it is unavailable

**Requirement:** Approved override-and-failure story; no silent fallback to the original temporary directory.

As a contributor or CI operator, I want an explicit temporary-storage override and an actionable startup failure when that storage cannot be used.

### Acceptance Criteria

#### Happy Path
- Given an explicit valid writable storage path, when an ordinary or smoke invocation starts, then its disposable temporary files use that selected storage instead of the default checkout-local location.

#### Negative Paths
- Given an invalid configured storage path, when startup validates the selection, then it reports the invalid path and stops before starting Vitest without allocating a fallback root.
- Given a selected storage location that cannot be created, written, or resolved, when startup attempts to allocate its root, then it reports the location and underlying failure and stops before starting Vitest without falling back to the system temporary directory.

### Done When
- [ ] Entry-point fixtures observe the override in the launched environment and zero Vitest launches for rejected selections.
- [ ] Controlled invalid-path, permission, capacity, and path-resolution failures produce a nonzero startup outcome and no fallback allocation.

## Story 3: Preserve cleanup and leak detection after relocation

**Requirement:** Approved preserved-protections story; existing stale-root policy remains authoritative.

As an ai-conductor contributor, I want relocating fixture files to retain the existing cleanup and operator-state protections.

### Acceptance Criteria

#### Happy Path
- Given relocated test state, when a run ends successfully, fails, or receives a supported interrupt, then its owned temporary files are reclaimed and its caller's temporary-directory environment is restored without removing the storage parent.
- Given abandoned eligible run roots in the selected storage or original temporary directory, when startup performs stale-root cleanup, then it applies the existing staleness policy at both locations.

#### Negative Paths
- Given live or ambiguous sibling roots or unrelated paths, when cleanup runs, then it retains those paths and does not broaden daemon-session cleanup to the checkout or storage parent.
- Given a fixture bypasses redirection and creates an unignored entry in the original temporary directory, when teardown runs, then the existing leak guard still reports that entry and fails the run.

### Done When
- [ ] Global-setup fixtures with separate original and selected directories demonstrate teardown cleanup, stale-root selection, and retention using exact fixture-owned paths.
- [ ] A planted original-directory leak fails teardown; mocked tmux-boundary tests refuse unrelated checkout paths, prefix lookalikes, unknown pane paths, and failed-baseline deletion.

## Negative-path assessment

Invalid configuration, filesystem permission/capacity failures, concurrent execution, partial cleanup, dependency unavailability, idempotent reuse, and deletion scope apply and are covered above. No authentication, network, application data model, or immutable record changes are involved. Filesystem error permutations belong at the lowest sufficient test layer with injected failures; do not exhaust real storage or call third-party systems.

## Verified basis and limits

- Verified from scripts/run-vitest.mjs and both Vitest configs: startup currently allocates under os.tmpdir(). Paths in this section are relative to src/conductor/.
- Verified from test/global-setup.ts: original temporary-directory monitoring and stale-root sweeping currently share dirname(runTmpRoot); relocation must separate those responsibilities.
- Verified from scripts/smoke.ts and src/engine/smoke-runner.ts: the local entry imports the shared smoke runner, which loads Vitest and owns disposable discovery/child directories. Adapt the repository-local entry/config, not the shared engine.
- Verified with df -T on 2026-09-11: this checkout uses ext4 and /tmp uses tmpfs. The behavior selects the checkout filesystem; it does not certify filesystem backing on every machine. Explicit storage selection supports other environments. Mount detection, capacity admission, quotas, and concurrency throttling are excluded.
- Scope-check: repository-only; no new skill; provider-agnostic. Event-spine check: no new occurrence channel. Temporary-directory environment values are execution state, not telemetry; retain the existing guard reporting paths.
- Verify-claims verdict: CLEAR for the accepted behaviors. The implementation plan proposes concrete internal interfaces for operator review before land.
