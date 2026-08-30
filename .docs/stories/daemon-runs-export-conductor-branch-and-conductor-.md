**Status:** Accepted

# Stories: Daemon OTel branch and engine identity

## Story 1: Daemon traces identify the branch and engine build

As an operator investigating a daemon-dispatched run, I want its trace resource to name the feature branch and executing engine build so that I can correlate behavior with the code that produced it.

### Acceptance Criteria

#### Happy Path

- Given a daemon dispatch for a feature worktree with a known branch, when its trace resource is exported, then `conductor.branch` equals that feature worktree branch.
- Given a daemon dispatch executed by an installed engine build, when its trace resource is exported, then `conductor.engine.version` equals that executing build's version identifier and changes after the daemon refreshes onto a different engine build.
- Given equivalent interactive and daemon runs, when their trace resource attribute names are compared, then both entry points carry `conductor.branch` and `conductor.engine.version` with the same value semantics.

#### Negative Paths

- Given the daemon's primary checkout is on a different branch from the feature worktree, when the feature trace is exported, then `conductor.branch` still names the feature worktree branch rather than the primary-checkout branch.
- Given the daemon is executing an unpublished source build, when its trace resource is exported, then `conductor.engine.version` is the explicit source-build identity `dev` rather than `unknown` or an installed-build identifier.
- Given OpenTelemetry export is disabled, when a daemon feature runs, then identity handling neither enables export nor blocks or alters the feature run.

### Done When

- [ ] A daemon-path observation proves the exported trace resource contains the exact feature worktree branch and executing engine version.
- [ ] A parity observation proves the interactive and daemon entry points supply the same two trace resource attributes under the same contract.
- [ ] A source-build observation proves `dev` remains distinct from installed engine build identifiers.

## Story 2: Resolution failure is distinct from caller omission

As an operator diagnosing missing telemetry identity, I want an attempted-but-unresolved value to differ from a value an entry point never supplied so that I know whether to investigate the environment or the wiring.

### Acceptance Criteria

#### Happy Path

- Given branch or engine-version resolution is attempted but cannot produce a value, when the trace resource is exported, then the affected attribute is `unresolved` and the telemetry path remains non-blocking.
- Given a supported OTel entry point supplies successful resolution results, when its trace resource is exported, then each affected attribute contains the resolved value rather than a sentinel.

#### Negative Paths

- Given a caller omits a branch or engine-version resolution result, when the OTel wiring contract is checked, then the omission is rejected by the supported typed seam and cannot silently become `unknown`.
- Given an out-of-contract runtime caller nevertheless omits either result, when a trace resource is built, then the affected attribute is `not-supplied`, not `unresolved` or `unknown`, and telemetry remains non-blocking.

### Done When

- [ ] Contract-level proof shows every supported OTel wiring caller must provide both resolution results.
- [ ] Resource-level proof shows `unresolved`, `not-supplied`, and a resolved value are three distinct outcomes for each scoped identity attribute.
- [ ] Failure-path proof shows neither an unresolved result nor a runtime omission halts the feature run.
