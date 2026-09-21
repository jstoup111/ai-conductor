**Status:** Accepted

# Stories: attributable live-boundary fingerprint cost (#1219)

Technical track — no PRD. Scope boundary (`.docs/track/generated-project-artifacts-delay-provider-startup.md`,
as amended): the fingerprint-duration signal alone. No story here asserts that provider startup
becomes faster; the deliverable is attribution (architecture review condition C-2).

## Story 1: The fingerprint reports what each surface cost

As an operator diagnosing a slow self-host dispatch, I want the live-boundary fingerprint to report
how long each surface took and how many files it hashed, so that pre-provider latency can be
attributed to fingerprinting or ruled out.

### Acceptance Criteria

#### Happy Path
- Given a self-host dispatch whose live checkout and provider home both exist, when the live-boundary fingerprint is built, then its result carries one measurement per surface, labelled `live checkout` and `provider state`, each with a non-negative integer elapsed-milliseconds value and the count of files hashed on that surface.
- Given a surface containing exactly N files outside its exclusion set, when the fingerprint is built, then that surface's reported file count is N and excluded subtrees contribute nothing to it.

#### Negative Paths
- Given a provider home directory that does not exist, when the fingerprint is built, then the `provider state` measurement reports a file count of 0 with a non-negative elapsed value, and the surface's manifest is still the existing single `<absent>` entry.
- Given a surface whose walk fails with an error other than a missing root, when the fingerprint is built, then the fingerprint fails with that same error exactly as it does today and no measurement is returned for a fingerprint that did not complete.
- Given a file that disappears between being listed and being read, when the fingerprint is built, then the existing symlink-or-missing fallback still applies and the file is counted once, never zero times or twice.

### Done When
- [ ] `fingerprintLiveBoundary` returns per-surface measurements (`label`, `elapsedMs`, `fileCount`) as data alongside the existing `surfaces`.
- [ ] A unit test over a fixture tree asserts `fileCount` equals the number of non-excluded files per surface.
- [ ] A unit test asserts an absent provider home yields `fileCount: 0` and the unchanged `<absent>` manifest.
- [ ] `live-boundary.ts` imports no event emitter; measurements leave the module only as a return value.

## Story 2: One fingerprint event reaches the persisted spine and the daemon log

As an operator, I want each completed fingerprint to appear as one event in `.pipeline/events.jsonl`
and one line in the daemon log, so that a stall between step entry and provider start can be read
off the existing telemetry without re-deriving it from source.

### Acceptance Criteria

#### Happy Path
- Given a self-host dispatch whose fingerprint completes, when the conductor receives the snapshot, then it emits exactly one `self_host_boundary_fingerprint` event carrying both surfaces' label, elapsed milliseconds, and file count, before the provider is launched.
- Given that event is emitted with the production sinks attached, when the run's `.pipeline/events.jsonl` is read, then it contains one record of type `self_host_boundary_fingerprint` with the same per-surface values.
- Given that event is emitted with the daemon renderer attached, when the daemon log is read, then it contains one line naming each surface with its duration and file count.

#### Negative Paths
- Given a dispatch that is not self-hosted, when a step is dispatched, then no `self_host_boundary_fingerprint` event is emitted.
- Given a fingerprint that throws, when the conductor handles the failure, then no `self_host_boundary_fingerprint` event is emitted and the existing failure handling is unchanged.
- Given an event subscriber that throws while handling `self_host_boundary_fingerprint`, when the event is emitted, then the dispatch proceeds to containment probing and provider launch exactly as if the subscriber had succeeded.
- Given a provider candidate that fails and a second candidate is prepared, when each candidate's fingerprint completes, then one event is emitted per completed fingerprint and none is duplicated for a single fingerprint.

### Done When
- [ ] `ConductorEvent` gains a `self_host_boundary_fingerprint` member and `EVENT_SINKS` declares it with `render: true, persist: true, audit: false, otel: false`, matching `self_host_containment_verdict`.
- [ ] The conductor emits it from the existing self-host candidate preparation path, the only emission site.
- [ ] A test asserts the event is persisted to `.pipeline/events.jsonl` with both surfaces' values.
- [ ] A test asserts the daemon renderer produces a line containing both surface labels, durations, and file counts.
- [ ] A test asserts no event is emitted for a non-self-host dispatch or a failed fingerprint.

## Story 3: Measuring the guard does not change what it guards

As the maintainer of the self-host safety boundary, I want the instrumentation to leave the
fingerprint's protective behaviour untouched, so that a diagnostic can never weaken the guard.

### Acceptance Criteria

#### Happy Path
- Given the same fixture tree, when the fingerprint is built before and after this change, then each surface's manifest (paths and digests) and exclusion sets are identical.
- Given a snapshot produced with measurements, when `verifyLiveBoundary` runs against an unchanged tree, then it returns ok exactly as today.

#### Negative Paths
- Given a snapshot produced with measurements, when an unexcluded untracked file appears in the live checkout before verification and containment is not in force, then verification fails with the existing `live checkout changed during self-host execution` reason naming that path.
- Given two fingerprints of an unchanged tree whose elapsed times differ, when the second is verified against the first's snapshot, then verification returns ok, because measurements are never part of the manifest comparison.
- Given a file inside an excluded subtree such as `node_modules` or `.git`, when the fingerprint is built, then that file is neither hashed nor counted.

### Done When
- [ ] A test pins manifest contents and exclusion sets as identical with the instrumentation present, over a fixture containing excluded and non-excluded paths.
- [ ] A test asserts differing `elapsedMs` between snapshot and verify never produces a boundary mismatch.
- [ ] `LIVE_CHECKOUT_VOLATILE`, the provider-state volatile lists, `diffManifests`, and `classifyLiveCheckoutDiff` are unmodified in the diff.
