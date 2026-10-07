**Status:** Accepted

# Stories: Monitor guided sessions — choose provider, model, and effort

Source PRD: `.docs/specs/monitor-guided-sessions-no-way-to-choose-provider-.md` (FR-1–FR-15).
Governing ADR: `adr-2026-10-06-catalog-owned-interactive-model-and-effort`.
Scope boundary: Balanced. Pi interactive launch is excluded (#1007).

"Guided-session settings" means the project's persisted provider, model, and effort for monitor
guided sessions. They are read from the merged configuration of the project the monitor resolves
its provider from today. "Per-run override" means a value supplied on the monitor command line for
that run only. "Build selection" means the project's existing build provider selection. In every
scenario the provider process boundary is the observable point: the executable and arguments the
monitor would launch.

## Story 1: Persisted guided-session provider, independent of builds

**Requirement:** FR-1, FR-4

As an operator, I want to set which provider monitor guided sessions use, without touching the
build's provider selection, so that triage can run on a different provider from builds.

### Acceptance Criteria

#### Happy Path
- Given a project whose build selection is `claude` and whose guided-session provider is `codex`, when the monitor opens a guided session, then the launched executable is the Codex executable.
- Given that same project, when its resolved configuration is read for a build step, then the build step's provider is still `claude`.
- Given a project with no guided-session provider and a build selection of `codex, claude`, when the monitor opens a guided session, then the launched executable is the Codex executable (the first entry of the build selection).

#### Negative Paths
- Given a guided-session provider of `codex` and a build selection of `claude`, when a build step resolves its provider, then it resolves to `claude` and never to `codex`.
- Given a project whose build selection cannot be resolved because its configuration fails to load, and no guided-session provider is set, when the monitor starts, then it exits non-zero printing `monitor: unable to resolve provider: «load error»` and launches nothing.
- Given a guided-session provider is set and the build selection's first provider is `pi`, when the monitor opens a guided session, then it uses the guided-session provider and the Pi build selection plays no part in the launch.

### Done When
- [ ] A test with a mocked process boundary shows the guided session launching the configured guided-session provider's executable while the build selection names a different provider.
- [ ] A test shows build-step provider resolution unchanged by a guided-session provider setting.
- [ ] A test shows the zero-config fallback launching the first build-selection provider.

## Story 2: Persisted guided-session model and effort

**Requirement:** FR-2, FR-7

As an operator, I want to set the model and effort for guided sessions so that triage runs on the
model and reasoning depth I choose.

### Acceptance Criteria

#### Happy Path
- Given guided-session settings provider `claude`, model `sonnet`, effort `medium`, when the monitor opens a guided session, then the Claude invocation carries `--model sonnet` and `--effort medium`, and the opening prompt is the last argument.
- Given guided-session settings provider `codex`, model `gpt-5.6-terra`, effort `xhigh`, when the monitor opens a guided session, then the Codex invocation carries `--model gpt-5.6-terra` and `--config model_reasoning_effort="xhigh"` before the opening prompt.
- Given only a guided-session effort of `low` is set, with no model, when the monitor opens a session on `claude`, then the invocation carries `--effort low` and the harness-default model for Claude.

#### Negative Paths
- Given a guided-session model is set but no guided-session provider, and the build selection's first provider is `codex`, when the monitor opens a session, then the configured model is applied to the Codex invocation and the launch output reports model source `config`.
- Given the Claude invocation is built with a model and an effort, when its argument order is inspected, then `--permission-mode default` is still present and no option appears after the opening prompt.
- Given a guided-session effort is set, when the session launches, then effort is not delivered through any environment variable and appears only as the provider's effort argument.

### Done When
- [ ] Tests assert the exact Claude and Codex argv (order included) for configured model and effort.
- [ ] A test asserts the independent model-only and effort-only cases.

## Story 3: Per-run overrides

**Requirement:** FR-3, FR-6

As an operator, I want to override the guided-session provider, model, or effort for a single
monitor run without editing configuration.

### Acceptance Criteria

#### Happy Path
- Given guided-session settings `claude`/`opus`/`high`, when the monitor is run with a per-run model override `sonnet`, then the session launches Claude with `--model sonnet --effort high`.
- Given guided-session settings `claude`/`opus`/`high`, when the monitor is run with a per-run provider override `codex` and no other overrides, then the session launches Codex with Codex's harness-default model `gpt-5.6-sol` and effort `high`, not `opus`.
- Given a per-run provider override `codex` plus a per-run model override `gpt-5.6-terra`, when the session launches, then it uses Codex with `gpt-5.6-terra` and Codex's default effort `high`.

#### Negative Paths
- Given a run with per-run overrides has finished, when the monitor is next run with no overrides, then the persisted guided-session settings apply again and project configuration is byte-for-byte unchanged.
- Given a per-run override flag is supplied with no value, when the monitor starts, then it exits non-zero printing the monitor usage and launches nothing.
- Given an unrecognised monitor option is supplied, when the monitor starts, then it exits non-zero printing the monitor usage, as today.

### Done When
- [ ] Tests cover override-over-config precedence for each of provider, model, and effort.
- [ ] A test covers the FR-6 provider-override reset of model and effort.
- [ ] A test asserts project configuration files are not written by an overridden run.

## Story 4: Harness-stated defaults with nothing configured

**Requirement:** FR-5

As an operator, I want guided sessions to work with zero setup on a concrete, named model and effort.

### Acceptance Criteria

#### Happy Path
- Given a project with no guided-session settings and build selection `claude`, when the monitor opens a session, then Claude is launched with `--model opus --effort high` (Claude's built-in `explore` defaults).
- Given no guided-session settings and build selection `codex`, when the monitor opens a session, then Codex is launched with `--model gpt-5.6-sol` and `model_reasoning_effort="high"`.

#### Negative Paths
- Given no guided-session settings and a project that pins its `explore` step to model `sonnet` / effort `low`, when the monitor opens a Claude session, then the defaults are still `opus`/`high` and the project's `explore` pin is not used.
- Given no guided-session settings, when the session launches, then the invocation never omits the model or effort arguments (a concrete value is always passed).

### Done When
- [ ] Tests assert the default model and effort for Claude and Codex come from each provider's built-in `explore` policy.
- [ ] A test asserts a project `explore` step pin does not change guided-session defaults.

## Story 5: Applied values are visible at launch

**Requirement:** FR-8

As an operator, I want to see which provider, model, and effort a triage session is using, and where
each came from.

### Acceptance Criteria

#### Happy Path
- Given a per-run model override `sonnet`, a configured effort `medium`, and no provider setting with build selection `claude`, when the monitor starts, then before any session launches it prints one line naming `provider=claude (default)`, `model=sonnet (override)`, `effort=medium (config)`.
- Given nothing configured, when the monitor starts, then the printed line reports all three values with source `default`.

#### Negative Paths
- Given the selection is refused (see Story 6–8), when the monitor exits, then no applied-selection line is printed.
- Given the monitor queue is empty, when the monitor starts, then the applied-selection line is still printed once, before the queue is offered, so the operator knows what a later session will use.

### Done When
- [ ] A test captures monitor output and asserts the applied-selection line, its value sources, and that it precedes the first launch.

## Story 6: Effort the provider does not accept is rejected

**Requirement:** FR-9, FR-14

As an operator, I want an unsupported effort rejected up front instead of silently dropped.

### Acceptance Criteria

#### Happy Path
- Given each of `low`, `medium`, `high`, `xhigh`, `max` as the per-run effort for `claude` and for `codex`, when the monitor resolves the selection, then each is accepted and applied.
- Given a provider whose declared accepted efforts exclude `max`, when the effort is `max`, then the monitor exits non-zero with an error naming effort `max` and that provider.

#### Negative Paths
- Given a per-run effort `turbo`, when the monitor starts, then it exits non-zero with an error naming `turbo` and the resolved provider, and the process boundary is never reached.
- Given an unaccepted effort, when the monitor exits, then no halt marker, deferral record, or queue state has changed.
- Given an unaccepted effort and a non-empty halt queue, when the monitor exits, then queue membership was never derived (the refusal precedes queue processing).

### Done When
- [ ] Tests assert rejection naming value and provider, non-zero exit, and that the mocked process boundary is never invoked.
- [ ] A test with a narrowed accepted-effort declaration proves the per-provider check is enforced, not just the shared vocabulary.

## Story 7: Malformed or uncatalogued model is rejected

**Requirement:** FR-10, FR-14

As an operator, I want an obviously invalid model rejected before launch, while new valid models
still work.

### Acceptance Criteria

#### Happy Path
- Given a per-run model `claude-fable-5-1` for `claude`, a model absent from every harness policy table, when the monitor starts, then it is accepted and passed through unchanged.

#### Negative Paths
- Given a per-run model of empty string, when the monitor starts, then it exits non-zero with an error naming the empty model value and the provider, and launches nothing.
- Given a model `--dangerously-skip-permissions`, when the monitor starts, then it is rejected naming the value and provider, and it never appears in any launched argv.
- Given a model containing whitespace (`opus high`) or a control character, when the monitor starts, then it is rejected naming the value and provider.
- Given a provider that declares an authoritative model catalog and a model absent from it, when the selection is resolved, then it is rejected naming the value and provider.

### Done When
- [ ] Tests cover empty, leading-dash, whitespace, and control-character models, each refused before the process boundary.
- [ ] A test proves catalog membership is enforced for a catalog-declaring provider and skipped for one without a catalog.

## Story 8: Unknown and non-interactive providers are refused clearly

**Requirement:** FR-11, FR-12, FR-14

As an operator, I want a clear refusal when the chosen provider cannot open a guided session.

### Acceptance Criteria

#### Happy Path
- Given a guided-session provider `pi`, when the monitor starts, then it exits non-zero with a message naming provider `pi`, the missing interactive-launch capability, and #1007, and launches nothing.
- Given a per-run provider `gemini`, when the monitor starts, then it exits non-zero with `monitor: unregistered provider gemini.` and launches nothing.

#### Negative Paths
- Given a build selection whose first entry is `pi` and no guided-session provider, when the monitor starts, then it is refused with the Pi interactive-launch message, not the generic "unregistered provider" message.
- Given a Pi refusal, when the monitor exits, then queue membership was never derived and halt state is unchanged.
- Given Claude is selected but its executable is not installed, when the session launches, then the existing "Interactive launch unavailable for claude: ENOENT." outcome is preserved.

### Done When
- [ ] Tests assert each refusal message, non-zero exit, and that the process boundary is never reached.

## Story 9: Invalid persisted settings are reported at config load

**Requirement:** FR-13

As an operator, I want a broken guided-session setting reported like any other configuration error.

### Acceptance Criteria

#### Happy Path
- Given valid guided-session settings, when project configuration is loaded, then loading succeeds and the settings are available to the monitor.

#### Negative Paths
- Given a guided-session provider `gemini` in configuration, when configuration is loaded, then loading fails with an error naming the setting path and `gemini`.
- Given a guided-session effort `turbo` in configuration, when configuration is loaded, then loading fails with an error naming the setting path and stating the accepted values low, medium, high, xhigh, and max.
- Given an unknown key inside the guided-session settings block, when configuration is loaded, then it is reported the same way other unknown configuration keys are.
- Given an invalid guided-session setting, when a build (not the monitor) loads configuration, then the same configuration error is reported, because the setting belongs to the project's configuration.

### Done When
- [ ] Config validation tests cover invalid provider, invalid effort, and unknown nested key, each naming the path and value.
- [ ] The new configuration block is registered with the configuration consumer registry, and its coverage check passes.

## Story 10: Composer and monitor share one launch definition

**Requirement:** FR-15

As a maintainer, I want monitor and composer interactive launches defined in one place per provider
so that they cannot drift.

### Acceptance Criteria

#### Happy Path
- Given the composer launches Claude with `CONDUCT_ENGINEER_PERMISSION_MODE` unset, `plan`, and `acceptEdits` respectively, when its argv is built, then it is byte-for-byte identical to the argv produced before this change.
- Given the composer launches Codex, when its argv is built, then it is byte-for-byte identical to the argv produced before this change (a single positional prompt).
- Given the monitor launches Claude, when its argv is built, then it uses permission mode `default` regardless of `CONDUCT_ENGINEER_PERMISSION_MODE`.

#### Negative Paths
- Given `CONDUCT_ENGINEER_PERMISSION_MODE=acceptEdits` is set in the operator's environment, when the monitor launches a guided session, then the monitor's Claude argv still carries `--permission-mode default`.
- Given a provider's interactive launch definition is changed, when both the monitor and composer argv are built, then both reflect it; the monitor holds no separate per-provider launch table.
- Given a monitor session is launched with no attached interactive terminal, when the launch is attempted, then the existing "no attached interactive terminal" refusal still applies.

### Done When
- [ ] Characterization tests pin the composer's Claude and Codex argv before and after the change.
- [ ] A test proves the monitor seam builds its invocation from the shared provider definition.
- [ ] A test pins the monitor's permission mode as `default` under a non-default environment.
