**Status:** Accepted

# Stories: remove the unattended one-shot inline run (--auto remnants)

Technical track (no PRD). Source: jstoup111/ai-conductor#1436. Design authority:
`.docs/decisions/architecture-review-2026-08-26-remove-the-unattended-one-shot-inline-run-auto-the.md`.
Removal-shaped: criteria describe surviving observable behavior per `/code-removal`.

## Story 1: The --auto rejection names the daemon and its guide

As an operator invoking the removed unattended one-shot, I want a clear terminal outcome naming the daemon and its documentation so that I land on the supported unattended path instead of a partial run or crash.

### Acceptance Criteria

#### Happy Path
- Given a repo on a supported checkout, when `conduct-ts inline "x" --auto` is invoked, then the process exits non-zero before any pipeline step runs and stderr names `conduct-ts daemon start` and `docs/guides/running-the-daemon.md`
- Given the rejection fires, when the process exits, then no worktree, branch, `.pipeline/` state, or provider dispatch was created by the invocation

#### Negative Paths
- Given both flags, when `conduct-ts inline "x" --auto --interactive` is invoked, then the process exits non-zero with the mutual-exclusion error and no pipeline step runs
- Given a script that pipes stdin, when `conduct-ts inline "x" --auto < /dev/null` runs headless, then the rejection still exits non-zero without hanging on any prompt

### Done When
- [ ] `src/conductor/test/cli/mode-derivation.test.ts` asserts the rejection message contains both `conduct-ts daemon start` and `docs/guides/running-the-daemon.md`, and the suite is green
- [ ] `deriveMode` returns only `'interactive'` or `'default'`; the unreachable `'auto'` return arm is gone and TypeScript compiles

## Story 2: Surviving inline modes behave exactly as today

As an operator using the human-driven or checkpointed inline run, I want those paths untouched so that removal of the one-shot changes nothing I rely on.

### Acceptance Criteria

#### Happy Path
- Given no mode flag, when `conduct-ts inline "x"` starts, then the run mode is `default` and checkpoint prompts still fire at checkpoint steps
- Given the interactive flag, when `conduct-ts inline "x" --interactive` starts, then the run mode is `interactive` and `dangerouslySkipPermissions` remains off for its dispatches

#### Negative Paths
- Given the deprecation, when any surviving inline mode runs, then no code path skips checkpoint prompts, sets `dangerouslySkipPermissions`, or auto-skips advisory failures on the strength of the removed flag
- Given an unknown flag, when `conduct-ts inline "x" --bogus` is invoked, then the CLI still fails with its normal unknown-option error (the deprecation stub did not widen flag parsing)

### Done When
- [ ] Existing mode-derivation and inline-path unit tests pass unchanged except assertions that referenced the removed `'auto'` return arm
- [ ] `git grep -n "mode === 'auto' && !this.daemon" src/conductor/src` returns nothing, and the recorded audit classifies every remaining `this.mode === 'auto'` site in `conductor.ts` as daemon-reachable, citing its governing ADR

## Story 3: The examples suite ships without the broken one-shot demo

As a new operator following the shipped examples, I want the unattended demo to be the daemon so that the first unattended run I try is the maintained one.

### Acceptance Criteria

#### Happy Path
- Given the examples directory, when its flows are enumerated, then the unattended demo is the daemon flow and every surviving example self-asserts `PASS/FAIL <flow>/<tier>` per the headless contract
- Given the example test suite, when `test/test_examples_common_prompt.sh`, `test_examples_common_sandbox.sh`, and `test_examples_common_timeout.sh` run, then they pass using a surviving flow as their fixture

#### Negative Paths
- Given the re-pointed common sandbox test, when its flow is killed for wedging, then it still exits non-zero and prints its `FAIL <flow>/<tier>: timeout` assertion (the fixture swap preserved the negative-path coverage)
- Given the full validation suite, when `test/test_harness_integrity.sh` runs, then it passes with no reference to the retired example or its test

### Done When
- [ ] `examples/inline.sh` and `test/test_examples_inline.sh` are deleted; `examples/README.md` carries no inline one-shot row and points unattended readers at the daemon flow
- [ ] `ugrep -rn "inline .*--auto" docs/ README.md HARNESS.md examples/ test/` returns only deprecation/removal notices, never an instruction to run it
- [ ] `test/test_harness_integrity.sh` passes

## Story 4: Daemon-dispatched auto-mode behavior is unchanged

As the daemon operator, I want every ADR-pinned `mode: 'auto'` engine behavior preserved so that this cleanup cannot regress unattended builds.

### Acceptance Criteria

#### Happy Path
- Given a daemon dispatch, when the Conductor is constructed, then it still receives `mode: 'auto'` and checkpoint steps do not prompt
- Given a daemon dispatch with no recorded tier, when the complexity step runs, then it still takes the existing tier or defaults to `L` without prompting

#### Negative Paths
- Given a config-declared advisory custom step that fails under daemon dispatch, when the failure is handled, then it is auto-skipped with the skip recorded, exactly as before this change
- Given a daemon build stall with remediation budget, when remediation dispatch is evaluated, then the `daemon && mode === 'auto'` gates fire exactly as before this change

### Done When
- [ ] The full `src/conductor` unit suite is green with zero changes to daemon-mode expectations
- [ ] The commit/PR carries the audit table: each `this.mode === 'auto'` site in `conductor.ts` listed with verdict `keep` and its governing ADR stem; no engine branch deleted
