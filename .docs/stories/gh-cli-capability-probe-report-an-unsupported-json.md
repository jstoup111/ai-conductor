**Status:** Accepted

# Stories: `gh` version floor and machine-level environment gate

Technical track — no PRD. Acceptance criteria derive from the technical intent in
`.docs/track/gh-cli-capability-probe-report-an-unsupported-json.md` and the ten decisions in
`adr-2026-09-05-gh-cli-version-floor-and-environment-gate`.

Per the stories documentation boundary, the floor's appearance in `README.md` and the `docs/`
prerequisite tables carries no story; it is ordinary documentation accompanying functional work.

## Story 1: A machine at or above the floor is unaffected

**Requirement:** adr-2026-09-05-gh-cli-version-floor-and-environment-gate decisions 1 and 2

As an operator whose `gh` is current, I want the version floor to be invisible so that the gate
costs me nothing.

### Acceptance Criteria

#### Happy Path
- Given an installed `gh` reporting version 2.73.0, when the daemon reaches its dispatch cycle, then dispatch proceeds and no waiting condition is raised.
- Given an installed `gh` reporting a version above 2.73.0, when the daemon reaches its dispatch cycle, then dispatch proceeds and no waiting condition is raised.
- Given an installed `gh` reporting version 2.73.0, when the DECIDE/engineer entry runs, then it proceeds without raising an environment refusal.
- Given the floor is consulted, when its value is read, then it resolves to 2.73.0 from a single declared constant rather than from configuration.

#### Negative Paths
- Given an installed `gh` reporting version 2.72.9, when the daemon reaches its dispatch cycle, then dispatch is prevented rather than proceeding.
- Given an installed `gh` reporting version 2.18.0, when the daemon reaches its dispatch cycle, then dispatch is prevented, because 2.18.0 satisfies only `headRefOid` and not `gh pr edit`.
- Given a `settings.json` and a user config that both attempt to set a `gh` version floor key, when the floor is consulted, then the declared constant is still 2.73.0 and neither file changes it.
- Given a `gh` reporting exactly 2.73.0-beta or another pre-release suffix, when the floor is compared, then the comparison resolves deterministically and the chosen verdict is recorded rather than the suffix being silently discarded.

### Done When
- [ ] A single exported constant holds the value 2.73.0 and is the only place that value appears outside documentation and tests.
- [ ] A pure comparison function returns a distinct verdict for at-floor, above-floor, and below-floor inputs, with tests covering 2.72.9, 2.73.0, and a higher version.
- [ ] No `settings.json` key, user-config key, or environment variable can change the floor; a test asserts the constant is unaffected by config.
- [ ] Pre-release and build-metadata version suffixes have a defined, tested comparison result.

## Story 2: A below-floor machine prevents dispatch and is never charged to a feature

**Requirement:** adr-2026-09-05-gh-cli-version-floor-and-environment-gate decisions 3 and 7

As an operator on an old `gh`, I want the problem reported against my machine rather than against a
feature so that no feature's budget or state is consumed by my environment.

### Acceptance Criteria

#### Happy Path
- Given an installed `gh` reporting version 2.14.1, when the daemon reaches its dispatch cycle, then it raises one waiting condition naming the `gh` CLI, the found version, and the required floor.
- Given an installed `gh` reporting version 2.14.1, when the daemon reaches its dispatch cycle, then no feature is claimed from the backlog.
- Given an installed `gh` reporting version 2.14.1 and a backlog of pending features, when several dispatch cycles elapse, then no feature's retry or attempt counter has advanced.
- Given the waiting condition is raised, when the operator upgrades `gh` to 2.73.0, then the next dispatch cycle clears the condition and dispatch resumes.
- Given a feature was in flight when the daemon last ran, when a below-floor `gh` prevents the next dispatch, then that feature's existing state is left untouched.

#### Negative Paths
- Given an installed `gh` reporting version 2.14.1, when the daemon reaches its dispatch cycle, then no per-feature HALT marker is written for any feature.
- Given an installed `gh` reporting version 2.14.1, when the daemon reaches its dispatch cycle, then no per-feature halt-class sidecar records `mechanical` for any feature.
- Given any HALT is written anywhere on this path, when its class is read, then the class is `needs-human` and never `mechanical`.
- Given a below-floor `gh` and twenty consecutive dispatch cycles, when the daemon log is read, then the waiting condition is reported without emitting twenty duplicate identical alarms.
- Given a below-floor `gh`, when the operator inspects the raised condition, then it states the remedy (upgrade `gh`) rather than only the fault.

### Done When
- [ ] With a probe reporting 2.14.1, a dispatch cycle raises exactly one waiting condition whose text contains the string `gh`, the found version, and `2.73.0`.
- [ ] With a probe reporting 2.14.1, a test asserts zero features claimed and zero retry/attempt counters advanced across multiple cycles.
- [ ] With a probe reporting 2.14.1, a test asserts no `.pipeline/HALT` and no `.pipeline/HALT.class` file is created for any feature.
- [ ] A test asserts that if this path writes a halt class at all, the value is `needs-human`.
- [ ] With a probe that reports 2.14.1 then 2.73.0 on successive cycles, a test asserts the condition clears and dispatch resumes with no manual intervention.

## Story 3: The DECIDE/engineer entry refuses below the floor

**Requirement:** adr-2026-09-05-gh-cli-version-floor-and-environment-gate decision 3

As an operator starting spec work by hand, I want the same floor enforced at the interactive entry
so that I learn immediately rather than at the first `gh` call.

### Acceptance Criteria

#### Happy Path
- Given an installed `gh` reporting 2.73.0 or above, when the DECIDE/engineer entry runs, then it proceeds to its normal entry decision.
- Given an installed `gh` reporting 2.14.1, when the DECIDE/engineer entry runs, then it refuses with a message naming the CLI, the found version, and the floor.
- Given the floor check and the existing fail-closed DECIDE-entry policy both apply, when the entry runs, then the floor check composes with that policy rather than replacing or duplicating its decision.

#### Negative Paths
- Given an installed `gh` reporting 2.14.1, when the DECIDE/engineer entry refuses, then no spec worktree is created and no branch is cut.
- Given an installed `gh` reporting 2.14.1, when the DECIDE/engineer entry refuses, then no claim record is written and no intake issue is mutated.
- Given `gh` is absent from `PATH`, when the DECIDE/engineer entry runs, then it refuses naming the absent binary rather than reporting a version comparison failure.

### Done When
- [ ] A test asserts the entry proceeds with a probe reporting 2.73.0 and refuses with one reporting 2.14.1.
- [ ] A test asserts a refusal creates no worktree, no branch, and no claim record.
- [ ] A test asserts an absent `gh` produces an absent-binary refusal distinct from a below-floor refusal.

## Story 4: The version probe never shells out where real execution is forbidden

**Requirement:** adr-2026-09-05-gh-cli-version-floor-and-environment-gate decision 4

As a maintainer, I want the probe to obey the harness's real-execution kill switch so that booting
the daemon or the engineer under test does not invoke the real CLI.

### Acceptance Criteria

#### Happy Path
- Given the probe is constructed in production, when it runs, then it invokes the real `gh --version` through the guarded runner.
- Given a test injects a fake probe, when the daemon dispatch cycle or the DECIDE/engineer entry runs, then the injected probe is used and no process is spawned.

#### Negative Paths
- Given `AI_CONDUCTOR_NO_REAL_EXEC` is set and no probe is injected, when the probe attempts to run, then it throws the existing real-exec guard error rather than spawning `gh`.
- Given the daemon dispatch cycle and the DECIDE/engineer entry are exercised by this feature's own tests, when those tests run, then each uses an injected probe and spawns no real `gh --version`.
- Given `gh --version` does not return within a bounded time, when the probe runs, then the probe terminates with a distinct timeout verdict rather than hanging the dispatch cycle.
- Given `gh --version` exits non-zero, when the probe runs, then the probe reports an absent-or-unusable verdict rather than treating empty output as a satisfied floor.

### Done When
- [ ] The probe accepts an injected runner and its production default calls the existing real-exec guard.
- [ ] A test asserts that with the real-exec kill switch set and no injection, the probe throws the guard error and spawns nothing.
- [ ] A test asserts a hung `gh --version` yields a bounded timeout verdict, not an unbounded wait.
- [ ] A test asserts a non-zero exit and empty stdout each yield a refusing verdict, never a passing one.

## Story 5: An unsupported `--json` field is reported as a CLI capability problem

**Requirement:** adr-2026-09-05-gh-cli-version-floor-and-environment-gate decision 5

As an operator whose `gh` changed under a running daemon, I want the failure to name the CLI and the
field so that I am not told the PR cannot be verified.

### Acceptance Criteria

#### Happy Path
- Given a `gh` invocation fails with `Unknown JSON field: "headRefOid"`, when the seam handles it, then it produces a typed capability error naming the `gh` CLI and the field `headRefOid`.
- Given a typed capability error reaches an operator-visible surface, when that surface is read, then it states the CLI version problem rather than an inability to verify PR identity.
- Given the seam classifies a failure, when it reads the evidence, then it reads the error's structured fields (`stderr` and exit code) and not its `message` string.
- Given a `gh` invocation succeeds, when the seam handles it, then the result is returned unchanged and no capability error is produced.

#### Negative Paths
- Given a `gh` invocation fails because the PR genuinely does not exist, when the seam handles it, then no capability error is produced and the original failure is preserved.
- Given a `gh` invocation fails with a network error, when the seam handles it, then no capability error is produced and the original failure is preserved.
- Given a downstream consumer receives a capability error, when it decides how to route, then it branches on the error's type and never on the words `Unknown JSON field`.
- Given `gh` changes its unsupported-field wording, when the seam handles the new wording, then the seam's own recognition is the only place that requires updating.
- Given a `gh` failure whose structured fields carry no recognizable unsupported-field signal, when the seam classifies it, then it produces no capability error and the original failure is preserved unchanged.
- Given a `gh` failure with a non-zero exit code but empty or ambiguous `stderr`, when the seam classifies it, then it produces no capability error, because an exit code alone must never assert a capability problem.

### Done When
- [ ] A typed capability error class exists and carries the CLI name and the offending field name as structured fields, not only in its message.
- [ ] A test asserts a `gh` failure whose text is `Unknown JSON field: "headRefOid"` yields that typed error with field `headRefOid`.
- [ ] The classifier reads `stderr` and exit code, never `message`; a test asserts a failure carrying the signal only in `message` is not classified as a capability error.
- [ ] A test asserts a non-zero exit with empty or ambiguous `stderr` yields no capability error.
- [ ] A test asserts a not-found failure and a network failure each pass through without becoming a capability error.
- [ ] A repository search shows no consumer outside the seam matching the string `Unknown JSON field`.

## Story 6: Every `gh` caller keeps its existing failure disposition

**Requirement:** adr-2026-09-05-gh-cli-version-floor-and-environment-gate decision 6

As a maintainer, I want the seam wrapper to change only the error's type and text so that no
caller's deliberately-chosen fail-open or fail-closed behavior is altered.

### Acceptance Criteria

#### Happy Path
- Given the seam wrapper is in place, when a `gh` call succeeds, then every caller observes the same result it observed before the wrapper existed.

#### Negative Paths
- Given the finish-record path receives a capability error while verifying PR identity, when it decides, then it refuses to record an outcome, preserving its fail-closed zero-write behavior.
- Given the finish-record path receives a capability error, when it refuses, then it writes nothing at all rather than writing a partial or marker record.
- Given the finish completion gate receives a capability error on its PR read, when it decides, then it still passes with a warning, preserving its fail-open behavior.
- Given a PR genuinely does not exist, when the finish-record path decides, then it refuses exactly as it does today and records no outcome on an unverifiable PR.
- Given the park-reconciliation path receives a capability error while reading a merged PR head, when it decides, then it takes no action and deletes no branch or worktree.
- Given the park-reconciliation path takes no action because of a capability error, when its refusal reason is reported, then the reason is still `no-merge-proof` and this feature adds no member to the refusal vocabulary.
- Given a capability error caused a `no-merge-proof` refusal, when the daemon log is read, then the typed capability error is logged so the cause stays recoverable without changing the reason string.

### Done When
- [ ] A test asserts the finish-record path records no outcome and writes no file when a capability error is raised during PR identity verification.
- [ ] A test asserts the finish-record path behaves identically for a genuinely missing PR as it did before this change.
- [ ] A test asserts the finish completion gate still passes with a warning when its PR read raises a capability error.
- [ ] A test asserts the park-reconciliation path deletes no branch and no worktree when a capability error is raised, and still reports reason `no-merge-proof`.
- [ ] A test asserts `RefusalReason` gains no new member from this feature.
