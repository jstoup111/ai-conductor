**Status:** Accepted

# Stories: Flow-Level Eval Harness (#786)

Technical-track stories. Acceptance criteria are the definition of done for the eval
infrastructure. "Flow" = one of {inline, interactive, daemon, engineer, intake-loop}. "Tier" =
`ComplexityTier` ∈ {S, M, L}. "Scenario" = a (flow, tier) pair driven by a scripted `LLMProvider`
inside a throwaway sandbox.

---

## Story 1: Scripted LLMProvider drives a step without a live model

**Requirement:** ADR-flow-eval-scripted-provider

As a harness maintainer, I want a `ScriptedProvider` registered as `llm_provider:scripted` so that
flows run their real orchestration with canned, artifact-producing step responses and zero live
`claude` calls.

### Acceptance Criteria

#### Happy Path
- Given a sandbox config with `llm_provider: scripted` and a scenario script mapping steps to
  responses, when a flow resolves its provider via `registry.get('llm_provider', …)`, then the
  `ScriptedProvider` is returned (not `ClaudeProvider`) and no `claude` subprocess is spawned.
- Given a scenario script whose step response declares an artifact + commit action, when
  `invoke()` runs for that step, then the named `.docs/` artifact is written into the sandbox and a
  commit with the expected `Task:`/evidence trailer is created, so the downstream gate is satisfied.

#### Negative Paths
- Given a step with no scripted response, when `invoke()` is called for it, then the provider fails
  with a clear "no scripted response for step <name>" error (not a silent empty success that would
  falsely satisfy a gate).
- Given `AI_CONDUCTOR_NO_REAL_EXEC=1`, when any scenario runs, then no real `gh`/network call is
  made; only sandbox-local `git` runs.
- Given the scripted provider is NOT selected (default config), when a normal (non-eval) run
  resolves its provider, then `ClaudeProvider` is returned — the scripted provider never activates
  outside the eval.

### Done When
- [ ] `ScriptedProvider implements LLMProvider` and is registered as `llm_provider:scripted`, gated so it is inert in normal operation.
- [ ] A scenario script can attach per-step artifact-write + commit actions that satisfy a real gate.
- [ ] Missing scripted response yields an explicit error, not a false success.
- [ ] A test asserts zero `claude` spawns for a full scenario.

---

## Story 2: SandboxRepo isolates each scenario from real state

**Requirement:** architecture-review §Alignment (operator safety #497/#681/#438)

As a harness maintainer, I want each scenario to run in a throwaway git repo with env-isolated
registry/state so that the eval never touches the real registry, worktrees, or daemon.

### Acceptance Criteria

#### Happy Path
- Given a scenario starts, when `SandboxRepo` is created, then a fresh `mkdtemp` repo exists with
  `git init -b main`, a seed commit, a fake `origin`, and `AI_CONDUCTOR_REGISTRY` /
  `AI_CONDUCTOR_ENGINEER_DIR` / conductor state pointed inside the tmpdir.
- Given a scenario finishes (pass or fail), when teardown runs, then the tmpdir is removed and no
  `.pipeline`/registry artifacts leak into the real repo or `$HOME/.ai-conductor`.

#### Negative Paths
- Given a scenario crashes mid-run, when teardown runs in a `finally`, then the sandbox is still
  removed (no leaked tmpdir accumulation).
- Given the eval process starts, when it initializes, then it asserts it is NOT pointed at the real
  registry (`AI_CONDUCTOR_REGISTRY` resolves inside the sandbox), refusing to run otherwise.
- Given a scenario would launch a daemon, when it runs, then real tmux/daemon autolaunch is disabled
  (`AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH`) so no real daemon is spawned.

### Done When
- [ ] `SandboxRepo` builder produces an isolated repo + env; extracted from the `daemon-ship`/`engineer` recipes.
- [ ] Teardown is `finally`-guaranteed and leak-checked.
- [ ] A guard refuses to run against the real registry.

---

## Story 3: A FlowDriver runs a flow to its completion oracle and reports pass/fail

**Requirement:** #786 desired-outcome (observable pass/fail per flow)

As a harness maintainer, I want one `FlowDriver` per flow that drives the flow through its public
entry point to its completion checkpoint and returns a discriminated pass/fail result with a reason.

### Acceptance Criteria

#### Happy Path
- Given a green scenario for a flow, when its driver runs, then the flow reaches its oracle
  (inline/interactive → `feature_status === 'complete'`; daemon → `isVerifiedShip()` +
  `.docs/shipped/<slug>.md`; engineer → spec PR / handoff result; intake-loop → routed+notified) and
  the driver returns `{ status: 'pass' }`.
- Given a flow reaches its oracle, when the driver reports, then the result names the flow, the
  tier, and the oracle evidence observed.

#### Negative Paths
- Given a flow does NOT reach its oracle within the scenario's bounded budget, when the driver
  finishes, then it returns `{ status: 'fail', reason }` with a captured reason (wedge/park signal,
  non-zero git exit, missing artifact, or HALT marker) — never a hang and never a bare boolean.
- Given a flow HALTs (writes a `.pipeline/HALT-*.md`), when the driver observes it, then the result
  is `fail` with the HALT reason surfaced.
- Given a flow exceeds the budget (would run forever), when the deadline passes, then the driver
  aborts and reports `fail: timeout` rather than blocking the runner.

### Done When
- [ ] A `FlowDriver` interface with a discriminated `PASS | FAIL(reason)` result exists.
- [ ] Drivers exist for daemon, engineer, and inline (full E2E), intake-loop (routed+notified), and interactive (wiring-level — see Story 7).
- [ ] Each driver asserts the flow's real public oracle, not internal step order.
- [ ] Failure always carries a captured reason; no driver can hang the runner.

---

## Story 4: S/M/L scenarios exercise real tier step-skipping

**Requirement:** ADR-flow-eval-tier-mapping-and-surface

As a harness maintainer, I want S/M/L scenarios keyed to `ComplexityTier` so the eval covers
tier-dependent step-skipping in `selector.ts`, not just prompt-length variation.

### Acceptance Criteria

#### Happy Path
- Given an `L` scenario, when the flow runs, then the full step set executes (no tier skips) and the
  driver observes the architecture/conflict/retro steps ran.
- Given an `S` scenario, when the flow runs, then the tier-skippable steps
  (conflict_check/architecture_*/retro/manual_test per `skippableForTiers`) are skipped and the
  driver observes they did not run.

#### Negative Paths
- Given a scenario pins tier `S` but a tier-skippable step nonetheless executes (a regression in
  `selector.ts`), when the driver checks the executed-step set, then it reports `fail` naming the
  step that should have been skipped.
- Given a scenario's tier is not one of S/M/L, when the runner loads it, then it rejects the fixture
  with a validation error (unrepresentable tier).

### Done When
- [ ] Each flow has committed S/M/L example prompt fixtures keyed to `ComplexityTier`.
- [ ] Scenario pins `state.complexity_tier` deterministically (no live classification turn).
- [ ] An assertion compares executed steps against the tier's expected skip set.

---

## Story 5: A single runner executes the flow × tier matrix and reports per-combination pass/fail

**Requirement:** #786 observable-acceptance (single runner, per-combination report)

As a harness operator, I want `conduct-ts eval` / `npm run eval` to run the scenario matrix and
print a per-(flow,tier) pass/fail table so I can see flow health at a glance.

### Acceptance Criteria

#### Happy Path
- Given the scenario matrix, when I run `conduct-ts eval`, then every (flow, tier) combination runs
  and the output is a table with one PASS/FAIL row per combination plus a captured reason on failures.
- Given all scenarios pass, when the runner finishes, then it exits `0`.
- Given `--flow <name>` or `--tier <S|M|L>`, when I run the eval, then only the matching subset runs.

#### Negative Paths
- Given at least one scenario fails, when the runner finishes, then it exits non-zero and the failing
  rows carry their captured reasons.
- Given a scenario throws unexpectedly, when the runner catches it, then that combination is reported
  `FAIL: <error>` and the remaining combinations still run (one failure does not abort the matrix).
- Given `--flow bogus`, when I run the eval, then it errors with the list of valid flow names.

### Done When
- [ ] `conduct-ts eval` subcommand + `npm run eval` script invoke the matrix runner.
- [ ] Output is a per-combination PASS/FAIL table; exit code reflects overall result.
- [ ] `--flow` / `--tier` filters work; unknown values are rejected.
- [ ] One scenario's failure does not prevent others from running.

---

## Story 6: A deliberately broken flow is caught by the eval

**Requirement:** #786 observable-acceptance (injected break is caught, not only seen live)

As a harness maintainer, I want an injected-break scenario (e.g. a daemon wedge / no-progress
stall) so I can prove the eval catches a flow-level regression rather than only surfacing it in a
live run.

### Acceptance Criteria

#### Happy Path
- Given a break scenario whose scripted provider produces no task progress (reproducing
  `no_task_progress`), when the daemon driver runs it, then the driver reports `FAIL` with the wedge
  reason within the bounded budget.
- Given a break scenario that forces a `git worktree add` failure, when the driver runs it, then the
  eval reports `FAIL` naming the non-zero git exit — not a pass, not a hang.

#### Negative Paths
- Given the break is later fixed (scenario made green), when the eval re-runs, then that combination
  reports PASS — the eval distinguishes broken from healthy (no false positives).
- Given an engineer-flow break (land rejects on a DRAFT/stub artifact), when the driver runs it, then
  the eval reports `FAIL` with the land-guard rejection reason.

### Done When
- [ ] At least one injected-break scenario per high-risk flow (daemon, engineer) is committed and asserted to FAIL.
- [ ] A test proves the same scenario, when repaired, reports PASS (break-detection is real, not a constant fail).

---

## Story 7: Interactive flow is covered at wiring level with a documented boundary

**Requirement:** architecture-review §Feasibility (interactive boundary)

As a harness maintainer, I want the interactive flow covered at command-dispatch/wiring level so its
regressions are not silently uncovered, while the "not headlessly automatable end-to-end" boundary
is explicit.

### Acceptance Criteria

#### Happy Path
- Given the interactive flow, when the eval runs its coverage, then it verifies the interactive
  dispatch path is wired (the `--interactive` flag routes steps into REPL mode / `invokeInteractive`)
  without requiring a live TTY.
- Given the eval docs, when a reader consults them, then the interactive boundary (why it is
  wiring-level, not full E2E) is stated.

#### Negative Paths
- Given the interactive dispatch wiring is broken (the `--interactive` flag no longer routes to REPL
  mode), when the wiring check runs, then it reports `FAIL`.
- Given a maintainer expects a full interactive E2E oracle, when they read the report, then the
  scope note prevents a false expectation (documented boundary).

### Done When
- [ ] A wiring-level interactive coverage check exists and can fail on a broken dispatch path.
- [ ] The boundary is documented alongside the eval.

---

## Story 8: Documentation tracks the new eval surface

**Requirement:** CLAUDE.md Documentation Upkeep + Release gates

As a harness operator, I want the README and CHANGELOG to describe the eval so the new command and
its posture are discoverable and the release gate passes.

### Acceptance Criteria

#### Happy Path
- Given the eval ships, when I read `README.md` and `src/conductor/README.md`, then the
  `conduct-ts eval` / `npm run eval` command, the flow×tier matrix, and the on-demand/nightly (not
  per-PR gate) posture are documented.
- Given the PR, when CI runs the release workflow, then `CHANGELOG.md` `[Unreleased]` carries an
  Added entry for the eval harness.

#### Negative Paths
- Given a new `conduct-ts eval` flag is added without a README update, when the docs-upkeep check
  runs, then the gap is surfaced (docs stale = PR incomplete).
- Given `[Unreleased]` is empty, when the release workflow runs post-merge, then it fails (existing
  CI enforcement) — so the entry must be present.

### Done When
- [ ] `README.md` + `src/conductor/README.md` document the eval command, matrix, and posture.
- [ ] `CHANGELOG.md` `[Unreleased]` has an Added entry.
- [ ] No new eval flag ships without a corresponding doc line.
