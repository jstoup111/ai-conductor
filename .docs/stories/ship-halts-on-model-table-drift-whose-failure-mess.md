**Status:** Accepted

# Stories: Bounded mechanical remediation in the self-host release gate

**Source:** jstoup111/ai-conductor#658
**Track:** technical (no PRD; criteria derive from the track marker, the approved architecture, and the amended adr-2026-06-30-halt-based-release-gates)
**Tier:** M

## Story 1: The integrity suite declares a deterministic remediation per failed check

As a harness maintainer, I want a failing integrity check to declare its mechanical remediation in a machine-readable record so that the engine can decide, without parsing prose, whether the failure is self-healable.

### Acceptance Criteria

#### Happy Path
- Given HARNESS.md's generated model table drifts from `bin/generate-model-table` output, when `test/test_harness_integrity.sh` runs, then it exits non-zero and emits exactly one remediation record for check 5a naming the command `bin/generate-model-table` and marking it deterministic
- Given `hooks/claude/docs-guard.sh` drifts from `bin/generate-docs-guard-hook` output, when the suite runs, then it emits exactly one remediation record for that check naming `bin/generate-docs-guard-hook` and marking it deterministic
- Given every check passes, when the suite runs, then it exits 0 and emits zero remediation records
- Given an existing `assert` call that passes only a description and a result, when the suite runs, then that call's pass/fail behavior and human-readable output are byte-for-byte unchanged

#### Negative Paths
- Given a check with no declared remediation fails, when the suite runs, then it exits non-zero and emits a remediation record for that check that names no command and is marked not deterministic
- Given `src/conductor/node_modules` is absent so check 5a warn-skips, when the suite runs, then no remediation record is emitted for check 5a
- Given the remediation record stream is unwritable, when the suite runs, then the suite still reports its FAIL line and exits non-zero rather than aborting before the summary
- Given a remediation record from a previous run is present, when the suite runs, then only records from the current run are present afterward

### Done When
- [ ] `assert` accepts an optional third argument naming a deterministic remediation command; all existing two-argument call sites are unmodified and `test/test_harness_integrity.sh` output for a passing tree is unchanged
- [ ] Checks 5a and the docs-guard drift check pass their remediation command; the emitted record set for a model-table-drift tree contains exactly one deterministic record naming `bin/generate-model-table`
- [ ] A shell test under `test/` drives the suite against a fixture tree with one drifted table and asserts the record contents and exit code
- [ ] `bash -n` and `test/lint_shell.sh` pass over the modified suite

## Story 2: The release gate self-heals an allowlisted mechanical failure once

As a daemon operator, I want the self-host release gate to run an allowlisted remediation, commit the result, and re-check the suite once, so that a feature whose only integrity failure is regenerable drift ships without my hand-running the generator.

### Acceptance Criteria

#### Happy Path
- Given the suite fails with one deterministic record naming `bin/generate-model-table`, when the release gate runs, then it runs that command from the worktree root, commits the regenerated HARNESS.md as an engine commit, re-runs the suite exactly once, and returns ok when the re-run exits 0
- Given the suite fails with two deterministic records naming `bin/generate-model-table` and `bin/generate-docs-guard-hook`, when the gate runs, then both commands run, one commit captures both outputs, the suite re-runs once, and the gate returns ok on a passing re-run
- Given the gate self-healed, when the SHIP tail continues, then the migration sub-gate is evaluated against the changed-file set that includes the remediation commit
- Given the gate self-healed, when the operator inspects the branch, then the remediation commit's message names the commands run and the checks they remediated

#### Negative Paths
- Given the suite fails with a deterministic record and the re-run still fails, when the gate runs, then it does not run any command a second time and halts naming the check that still fails after remediation
- Given the remediation command exits non-zero, when the gate runs, then the suite is not re-run and the gate halts naming the command and its exit code
- Given the remediation command succeeds but the engine commit fails, when the gate runs, then the suite is not re-run and the gate halts naming the commit failure
- Given the remediation command succeeds but produces no working-tree change, when the gate runs, then no commit is made, the suite re-runs exactly once, and a still-failing re-run halts naming the check as unremediated
- Given the suite times out on the re-run, when the gate runs, then the gate halts with the existing timeout reason and does not attempt a further remediation
- Given the gate is invoked for a non-self-host build, when the release gate would run, then no remediation record is read and no command runs

### Done When
- [ ] `release-gate.ts` contains an exact-string readonly allowlist with exactly two entries, `bin/generate-model-table` and `bin/generate-docs-guard-hook`, and the self-heal path runs only commands that string-equal an entry
- [ ] The self-heal path is bounded to one remediation pass and one suite re-run per gate invocation, asserted by a unit test that counts `exec` invocations
- [ ] The remediation commit is made with the engine-commit environment set and bypasses the protected-artifact and plan-scope commit hooks, asserted by a unit test through the injected git seam
- [ ] Unit tests cover the happy path and each negative path above through injected `exec`, record-reader, and git fakes; no real suite or generator runs

## Story 3: Every non-provable failure still halts fail-closed for a human

As a daemon operator, I want any integrity failure the gate cannot prove mechanically remediable to reach the existing halt with a halt class that survives daemon sweeps, so that the self-heal lane can never loop, never mask a real regression, and never run an unreviewed command.

### Acceptance Criteria

#### Happy Path
- Given the suite fails and at least one failed check has no deterministic remediation record, when the gate runs, then no command runs and the gate halts naming every undeclared failing check
- Given the suite fails and a deterministic record names a command not on the allowlist, when the gate runs, then no command runs and the gate halts naming the rejected command verbatim
- Given the gate halts on any self-heal path, when the halt marker is written, then its class is `needs-human`
- Given a remediation record cannot be fully parsed, when the gate runs, then the record is treated as undeclared and the gate halts naming the malformed record

#### Negative Paths
- Given a deterministic record names `bin/generate-model-table --force`, when the gate runs, then the command is rejected as not allowlisted because matching is exact-string, not prefix
- Given a deterministic record names a command whose path is `../bin/generate-model-table`, when the gate runs, then the command is rejected as not allowlisted
- Given the halt marker write fails after a declined self-heal, when the gate runs, then the returned verdict is not ok and its reason includes the marker-write failure, matching the existing gate behavior
- Given the gate halted after a failed self-heal, when its halt marker is read, then the marker class is `needs-human`, the class the daemon's re-kick sweep retains rather than clears

### Done When
- [ ] A unit test asserts that every declined and failed self-heal path calls the halt writer with class `needs-human`
- [ ] A unit test asserts exact-string allowlist matching rejects argument-suffixed and path-prefixed variants of an allowlisted command
- [ ] A unit test asserts that a malformed record yields a halt whose reason names the record and that no `exec` call was made

## Story 4: Self-heal outcomes are observable on the event spine

As a harness maintainer, I want every self-heal decision and outcome emitted as a `ConductorEvent`, so that the daemon log, `.pipeline/events.jsonl`, and every existing spine consumer see why a gate passed or halted without a sidecar file.

### Acceptance Criteria

#### Happy Path
- Given the gate self-heals successfully, when the gate runs, then the spine carries an attempted event naming the commands and checks followed by a succeeded event, both persisted to `.pipeline/events.jsonl`
- Given the gate declines because a check declared no remediation, when the gate runs, then the spine carries a declined event whose reason names the undeclared checks
- Given the gate declines because a command is not allowlisted, when the gate runs, then the spine carries a declined event whose reason names the rejected command
- Given the remediation ran but the re-run failed, when the gate runs, then the spine carries an attempted event followed by a failed event naming the still-failing check

#### Negative Paths
- Given the event emitter is absent from the gate options, when the gate self-heals, then the gate still completes its verdict and no error is thrown
- Given a self-heal event type is added without an `EVENT_SINKS` declaration, when the conductor package compiles, then compilation fails
- Given the terminal renderer receives a self-heal event, when it renders, then the line identifies the gate and outcome without printing the full remediation record body

### Done When
- [ ] The `ConductorEvent` union carries variants for attempted, succeeded, failed, and declined self-heal outcomes, each with an `EVENT_SINKS` declaration that persists
- [ ] A unit test drives each gate branch through a recording emitter and asserts the exact event sequence per branch
- [ ] The event-sink exhaustiveness test passes with the new variants
