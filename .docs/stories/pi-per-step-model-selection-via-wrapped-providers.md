**Status:** Accepted

# Stories: Pi per-step model selection via wrapped providers

Technical track (no PRD). Requirements come from issue jstoup111/ai-conductor#1885 and the
operator-confirmed scope boundary in `.docs/track/pi-per-step-model-selection-via-wrapped-providers.md`.
Two amended ADRs govern them: adr-2026-09-24-built-in-provider-catalog-and-boot-discovery (D12–D14)
and adr-2026-07-03-reactive-model-fallback-ladder (items 7–8).

Terms used below:
- A **Pi model id** is `<provider>/<model>`. It splits at the first `/`, and the model part may
  contain `/` and `:`.
- **Pi step** means any dispatch whose provider is pi, including pi as a fallback candidate.
- **Pi is configured** means pi appears as the run-level `llm_provider`, in a step's `llm_provider`
  or candidate ladder, or in a build-review policy.

## Story 1: Pi steps run on the configured model and thinking level

**Requirement:** TI-1. Every Pi step passes its resolved model as `--provider`/`--model` and its
effort as `--thinking`, and never relies on Pi's own default (catalog D12).

As an operator, I want every Pi step to run on the underlying model and thinking level I configured, so that the harness, not Pi's defaults, decides which model does the work.

### Acceptance Criteria

#### Happy Path
- Given `steps.plan` sets `llm_provider: pi`, `model: anthropic/claude-opus-4-5`, and `effort: xhigh`, when the plan step dispatches, then the spawned argv contains `--provider anthropic --model claude-opus-4-5 --thinking xhigh`.
- Given a Pi step resolves the model `cline/google/gemma-4-31b-it:free`, when it dispatches, then the argv contains `--provider cline --model google/gemma-4-31b-it:free` with the model part unchanged.
- Given a Pi step resolves each harness effort level `low`, `medium`, `high`, `xhigh`, and `max`, when it dispatches, then `--thinking` carries the same level name.
- Given a Pi step completes, when the event log is read, then its `provider_attempt` and `step_completed` events carry provider `pi`, the full `provider/model` id, and the effort.

#### Negative Paths
- Given a Pi step resolves the model `cline/google/gemma-4-31b-it:free`, when it dispatches, then the argv contains no `:`-suffixed thinking value on `--model` beyond the model id itself, and exactly one `--thinking` flag.
- Given a Pi step resolves an effort, when it dispatches, then the argv never contains `--thinking off` or `--thinking minimal`, because harness effort has no such levels.
- Given a Pi step fails, when the event log is read, then its `provider_attempt` event carries the full `provider/model` id rather than an empty model string.
- Given a claude or codex step dispatches in the same run as a Pi step, when its argv is inspected, then it matches the pre-change argv for that provider exactly.

### Done When
- [ ] The Pi adapter's argv includes `--provider`, `--model`, and `--thinking` built from the invocation's model and effort, and the #1884 test asserting "passes no `--model`" is replaced by tests asserting the new argv.
- [ ] A fixture Pi model id containing both a nested `/` and a `:free` suffix round-trips into `--provider`/`--model` unchanged.
- [ ] Existing claude and codex argv tests pass without edits to their assertions.

## Story 2: Config requires and validates Pi model selections

**Requirement:** TI-2. When pi is configured, `llm_providers.pi.model`,
`llm_providers.pi.model_escalation_order` and `llm_providers.pi.model_fallback_ladder` are required.
A malformed Pi model id fails config validation with a specific error, and a valid selection
round-trips unchanged (catalog D13, issue outcome 5).

As an operator, I want config validation to reject a missing or malformed Pi model selection, so that no Pi step ever runs on an accidental model.

### Acceptance Criteria

#### Happy Path
- Given `steps.plan` selects pi with `model: anthropic/claude-opus-4-5`, when config loads and resolves, then the resolved model for plan is exactly `anthropic/claude-opus-4-5` and its effort is the configured effort.
- Given pi is configured and `llm_providers.pi.model` is `google/gemini-2.5-flash`, when config resolves, then every Pi step without a step-level Pi model resolves to `google/gemini-2.5-flash`.
- Given a Pi step has a model configured under `steps.plan.by_tier.L`, when config resolves for a tier L feature, then the plan step resolves that tier model.

#### Negative Paths
- Given pi is configured and `llm_providers.pi.model` is absent, when config loads, then validation fails with an error naming `llm_providers.pi.model` as required because pi is configured.
- Given pi is configured and `llm_providers.pi.model_escalation_order` or `llm_providers.pi.model_fallback_ladder` is absent or empty, when config loads, then validation fails naming each missing key.
- Given pi is configured with all three `llm_providers.pi` keys, when every Pi step resolves, then none resolves to `sonnet` or any other built-in Claude or Codex alias.
- Given pi is not configured anywhere and no `llm_providers.pi` block exists, when config loads, then no `llm_providers.pi` key is required.
- Given a Pi step model `claude-opus-4-5` with no `/`, when config loads, then validation fails with an error naming the config path and the expected `provider/model` form.
- Given a Pi step model `anthropic/` or `/claude-opus-4-5`, when config loads, then validation fails naming the config path and the empty segment.
- Given a Pi step model containing whitespace, when config loads, then validation fails naming the config path.
- Given a claude step configured with the alias `opus`, when config loads, then no Pi model-id validation applies to it and it loads as before.

### Done When
- [ ] Config validation rejects a configuration naming pi without all three `llm_providers.pi` keys, and rejects a malformed Pi model id, each with a distinct message naming the config path.
- [ ] A test asserts a valid Pi selection round-trips through resolved config unchanged.
- [ ] The Pi descriptor model policy ships no model ids, and the #1884 single-empty-rung assertion is replaced.

## Story 3: Boot rejects Pi model ids that Pi does not list

**Requirement:** TI-3. On provider-dispatching entry points, when Pi is installed and configured,
boot checks every configured Pi model id against `pi --list-models` and fails on an unknown provider
or model (catalog D13).

As an operator, I want the daemon to refuse to start when a configured Pi model does not exist, so that a typo fails at boot instead of silently mid-build, since Pi passes unknown model ids through.

### Acceptance Criteria

#### Happy Path
- Given every configured Pi model id, including `llm_providers.pi.model` and every ladder and escalation entry, appears in the `pi --list-models` listing, when a provider-dispatching command boots, then boot continues.
- Given Pi is installed but pi is not configured anywhere, when a provider-dispatching command boots, then `pi --list-models` is not invoked.
- Given a non-dispatching subcommand such as `render-diagrams` runs with Pi configured, when it starts, then `pi --list-models` is not invoked.

#### Negative Paths
- Given a configured Pi model id whose provider segment is absent from the listing, when a provider-dispatching command boots, then startup fails with an unknown-Pi-provider error naming the id, the config path, and the step.
- Given a configured Pi model id whose provider is listed but whose model is not, when a provider-dispatching command boots, then startup fails with an unknown-Pi-model error naming the id, the config path, and the step, worded distinctly from the unknown-provider error.
- Given the `pi --list-models` run exceeds its timeout, when boot probes, then startup fails with a message stating that the Pi model listing timed out.
- Given `pi --list-models` exits non-zero or prints no header row with `provider` and `model` columns, when boot probes, then startup fails with a message quoting the unparseable header and never passes the configured ids.
- Given Pi is configured but not installed, when a provider-dispatching command boots, then the existing not-installed error fires and the model probe never runs.
- Given the default test suite runs, when any Pi boot path is exercised, then the probe runs through an injected fake runner and no real `pi` process is spawned.

### Done When
- [ ] A fixture captured from pi 0.84.3 `--list-models` output parses into provider/model pairs, including ids with nested `/` and `:`.
- [ ] Boot on a provider-dispatching command fails with distinct unknown-provider and unknown-model errors naming id, config path, and step.
- [ ] A test proves the probe is skipped for non-dispatching subcommands and when no Pi selection is configured.

## Story 4: Per-step tiers mix underlying providers within one run

**Requirement:** TI-4. Per-step models, `by_tier` promotions, and efforts are expressible for Pi,
including different underlying providers in one run and Pi steps mixed with claude or codex steps
(issue outcome 2).

As an operator, I want cheap steps on a small model and heavy steps on a large one through Pi, even across underlying providers, so that Pi carries the same tiering I use for claude and codex.

### Acceptance Criteria

#### Happy Path
- Given `steps.explore` selects pi with `google/gemini-2.5-flash` and `steps.plan` selects pi with `anthropic/claude-opus-4-5`, when both steps dispatch in one run, then each argv carries its own provider and model.
- Given `steps.plan.by_tier.L` sets a Pi model and effort that differ from `steps.plan`, when a tier L feature runs plan on pi, then the tier L model and effort are used, and a tier M feature uses the base step values.
- Given the run-level provider is claude and only `steps.plan` selects pi with a Pi model, when the run executes, then plan dispatches through pi with that model and every other step dispatches through claude with its Claude alias.
- Given a claude step whose candidate ladder is claude then pi and claude is run-scope unavailable, when the step falls back to pi, then pi dispatches with `llm_providers.pi.model` and the step's effort.

#### Negative Paths
- Given the run-level provider is claude with a Claude alias in `defaults.model` and `steps.plan` selects pi with no model of its own, when plan dispatches, then pi receives `llm_providers.pi.model` and never the Claude alias.
- Given a claude step falls back to pi, when pi dispatches, then pi never receives the claude step's Claude model alias.
- Given `steps.plan` selects claude but sets a Pi-form model `anthropic/claude-opus-4-5`, when config loads, then it loads unchanged, because non-Pi providers keep their existing opaque model-string handling.

### Done When
- [ ] A resolution test covers two Pi steps with different underlying providers, a mixed claude and pi run, and pi as a fallback candidate, asserting each dispatch's resolved provider, model, and effort.
- [ ] A test asserts a `by_tier` Pi promotion resolves by feature tier.

## Story 5: Pi fallback ladder and retry escalation walk configured Pi rungs

**Requirement:** TI-5. `llm_providers.<id>.model_fallback_ladder` and `.model_escalation_order`
drive the availability ladder and retry escalation per dispatched provider. Pi never inherits the
top-level `model_fallback_ladder`, and every rung is logged (ladder items 7–8, issue outcome 3).
The ladder fires on the adapter's model-unavailable signal. Anchoring upstream model-not-found
output under an explicit `--provider` belongs to #2718, so until then the boot probe is the primary
guard against unknown ids.

As an operator, I want an unavailable Pi model to fall to my next configured Pi model, and retries to escalate along my Pi order, so that Pi steps recover the same way claude steps do.

### Acceptance Criteria

#### Happy Path
- Given `llm_providers.pi.model_fallback_ladder` lists `anthropic/claude-opus-4-5` then `openai/gpt-5.6-sol` and the first is reported model-unavailable, when a Pi step invokes, then it re-invokes with `openai/gpt-5.6-sol` and emits a downgrade warning naming the configured model, the actual model, and the reason.
- Given `llm_providers.pi.model_escalation_order` lists a small, a mid, and a large Pi model and a Pi step on the small model fails twice, when attempt 3 dispatches, then it uses the mid model.
- Given the run-level provider is claude with a top-level `model_fallback_ladder` of Claude aliases and `steps.plan` selects pi with a configured Pi ladder, when plan hits model-unavailable, then it walks the Pi ladder and never a Claude alias.

#### Negative Paths
- Given a Pi step's model is absent from `llm_providers.pi.model_escalation_order` and the step fails twice, when attempt 3 dispatches, then the model is unchanged and only the effort escalates.
- Given the top-level `model_fallback_ladder` lists Claude aliases and a Pi rung is model-unavailable, when the Pi ladder is consulted, then no Claude alias is ever passed to pi.
- Given a claude run with a codex step and a top-level `model_fallback_ladder`, when the codex step hits model-unavailable, then it walks the top-level ladder exactly as before this change.
- Given `llm_providers.pi.model_fallback_ladder` contains an empty string or a malformed Pi model id, when config loads, then validation fails naming `llm_providers.pi.model_fallback_ladder` and the offending entry.
- Given `llm_providers` names a key that is not a catalog provider id, when config loads, then validation fails with the unknown-provider error listing catalog ids.
- Given every rung of the Pi ladder is model-unavailable, when the walk exhausts it, then the last failure returns to the normal retry machinery and the retry budget is not consumed by the downgrades.
- Given a claude run with no `llm_providers` block, when steps dispatch and fall back, then the claude ladder and escalation behavior equal the pre-change behavior.

### Done When
- [ ] The ladder is chosen per dispatched provider from `llm_providers.<id>`, then the top-level key (never for Pi), then the policy; the escalation order from `llm_providers.<id>`, then the policy.
- [ ] `step_retry` and `provider_attempt` events for a Pi rung carry the full `provider/model` id.
- [ ] Config validation covers the new `llm_providers` keys and rejects non-catalog `llm_providers` keys.
- [ ] `llm_providers` and its sub-keys are declared in the config-key consumer registry, and the registry coverage test passes.

## Story 6: The model table represents every catalog provider

**Requirement:** TI-6. `bin/generate-model-table` renders one model/effort column pair per catalog
provider, shows Pi, and `--check` passes (issue outcome 4).

As the harness maintainer, I want the generated model table to show Pi next to claude and codex, so that the documented model selection matches every provider the engine can run.

### Acceptance Criteria

#### Happy Path
- Given the catalog declares claude, codex, and pi, when `bin/generate-model-table` runs, then the table header has a model column and an effort column for each of the three providers, in catalog order, plus the existing skill, execution-path, and why columns.
- Given the Pi policy ships no model ids, when the table renders, then every engine-step Pi model cell reads `config-required` and every engine-step Pi effort cell shows the policy's step effort.
- Given an interactive-skill row, when the table renders, then its Pi model and effort cells read `n/a`.
- Given the regenerated table is committed, when `bin/generate-model-table --check` runs, then it exits 0.

#### Negative Paths
- Given the regenerated table, when the claude and codex model and effort cells are compared with the pre-change table, then every value is identical except that a pre-change blank Claude effort cell on an interactive row now reads `n/a`.
- Given the committed table lacks the Pi columns, when `bin/generate-model-table --check` runs, then it exits non-zero with a diff showing the missing columns.
- Given a catalog provider whose policy is added to the catalog, when the table renders, then its columns appear without any edit to the generator.
- Given a generated row with a blank cell for any catalog provider, when the completeness checks run, then they fail naming the row, while `config-required` and `n/a` pass as explicit sentinels.

### Done When
- [ ] `buildEngineRows` and the table header take their provider columns from the catalog, not from two positional policies.
- [ ] ARCHITECTURE.md's generated region shows Pi columns, and `--check` passes.

## Story 7: A Pi error stream that exits 0 fails the step

**Requirement:** TI-7. A Pi run whose terminal assistant message has `stopReason: "error"` is a
failed invocation carrying Pi's `errorMessage`, never a successful empty result (catalog D14).

As an operator, I want a Pi run that ended in an error to fail its step, so that a missing key or bad model never counts as a completed step.

### Acceptance Criteria

#### Happy Path
- Given Pi exits 0 and its terminal assistant message has `stopReason: "error"` and `errorMessage: "No API key for provider: cline"`, when the adapter parses the stream, then the invocation result is a failure whose error text contains `No API key for provider: cline`.
- Given Pi exits 0 and its terminal assistant message has a normal stop reason with text content, when the adapter parses the stream, then the invocation succeeds with that text as output, as before.

#### Negative Paths
- Given Pi exits 0 with `stopReason: "error"`, when the result is classified, then it sets none of `authFailure`, `rateLimited`, or `modelUnavailable`, and the step fails as an ordinary step failure.
- Given Pi exits 0 with `stopReason: "error"` and no `errorMessage`, when the adapter parses the stream, then the invocation fails with a message stating that Pi reported an error stop with no message.
- Given a Pi stream whose last line is malformed JSON after an error-stop message, when the adapter parses it, then the error-stop message still determines a failed result.

### Done When
- [ ] A fixture of the exit-0 error stream captured from pi 0.84.3 on 2026-09-29 produces a failed invocation carrying the error message.
- [ ] Existing Pi success-stream fixture tests pass unchanged.
