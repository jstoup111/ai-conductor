**Status:** Accepted

# Stories: Config validation gaps

**Track:** Technical
**Source:** jstoup111/ai-conductor#1026
**Architecture:** `.docs/decisions/architecture-review-2026-09-28-config-validation-gaps-satisfiesversion-and-six-ot.md`; `.docs/architecture/config-validation-gaps-satisfiesversion-and-six-ot.md`

"The installed harness version" below is the version the harness reports from its `VERSION` file
and passes to project config loading. Every scenario assumes it is `1.5.0` unless the scenario says
otherwise. "Loading the project config" means the project `.ai-conductor/config.yml` is read and
validated, and, where an installed harness version is supplied, checked against `harness_version`.
"Validation fails" means config loading returns a `validation_error` result rather than a config;
"a version mismatch" means it returns a `version_mismatch` result. Neither ever surfaces as a thrown
exception.

## Story 1: Every harness_version constraint form is actually evaluated

As a maintainer of a consumer project, I want the `harness_version` constraint I write to be
honoured whatever range form I use, so that the gate stops me running against an incompatible
harness instead of silently passing.

### Acceptance Criteria

#### Happy Path

- Given a project config with `harness_version: "^1.2.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds.
- Given a project config with `harness_version: "~1.5.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds.
- Given a project config with `harness_version: ">=1.0.0 <2.0.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds.
- Given a project config with `harness_version: "1.5.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds.
- Given a project config with `harness_version: ">=0.99.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds.

#### Negative Paths

- Given a project config with `harness_version: "^2.0.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `^2.0.0`.
- Given a project config with `harness_version: "~1.4.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `~1.4.0`.
- Given a project config with `harness_version: ">=2.0.0 <3.0.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `>=2.0.0 <3.0.0`.
- Given a project config with `harness_version: "1.4.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `1.4.0`.
- Given a project config with `harness_version: ">=1.6.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `>=1.6.0`.

### Done When

- [ ] Each of the five satisfied constraint forms loads successfully against installed version `1.5.0`.
- [ ] Each of the five unsatisfied constraint forms returns a `version_mismatch` result, and no unsatisfied form returns success.

## Story 2: A harness_version the gate cannot evaluate is rejected at config load

As a maintainer of a consumer project, I want a `harness_version` value that is not a usable version
constraint to fail validation with a clear message, so that the gate is never silently vacuous and a
typo never crashes config loading.

### Acceptance Criteria

#### Happy Path

- Given a project config with `harness_version: "*"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds.
- Given a project config with no `harness_version` key, when the project config loads with installed harness version `1.5.0`, then loading succeeds with no version check applied.
- Given a project config with `harness_version: "^1.2.0"`, when the config is validated with no installed harness version supplied, then validation succeeds.

#### Negative Paths

- Given a project config with `harness_version: 1` (a YAML number), when the project config loads with installed harness version `1.5.0`, then validation fails with a message stating `harness_version` must be a string, and no exception is thrown.
- Given a project config with `harness_version: ""`, when the project config loads with installed harness version `1.5.0`, then validation fails with a message stating `harness_version` must not be empty.
- Given a project config with `harness_version: "latest"`, when the project config loads with installed harness version `1.5.0`, then validation fails with a message naming `harness_version` and the rejected value `latest` as not a valid version range.
- Given a project config with `harness_version: "latest"`, when the config is validated with no installed harness version supplied, then validation still fails with a message naming `harness_version` and `latest`.

### Done When

- [ ] `harness_version: 1`, `harness_version: ""` and `harness_version: "latest"` each return a `validation_error` result naming `harness_version`, with no exception escaping config loading.
- [ ] `harness_version: "*"` and an absent `harness_version` both load successfully.

## Story 3: The retired top-level wiring key is a reported no-op

As a maintainer whose config still carries the retired top-level `wiring` key, I want it accepted
but reported as retired and ignored, so that my config keeps loading and I can see the key does
nothing.

### Acceptance Criteria

#### Happy Path

- Given a config containing `wiring: { entry_points: ["src/cli.ts"] }`, when the config is validated, then validation succeeds and the returned config contains no `wiring` key.
- Given a config containing `wiring: { entry_points: ["src/cli.ts"] }`, when the config is validated, then the returned warnings include one naming `wiring` as retired and ignored and citing `adr-2026-08-14-retire-build-review-wiring-rubric`.
- Given a config containing a top-level `wiring` key, when the config is validated, then the result's deprecated keys include `wiring` with the ADR `adr-2026-08-14-retire-build-review-wiring-rubric`.
- Given a config with no `wiring` key, when the config is validated, then no warning and no deprecated-key entry mentions `wiring`.

#### Negative Paths

- Given a config containing `wiring: { entry_points: ["src/cli.ts"], bogus: 1 }`, when the config is validated, then validation succeeds, the returned config contains no `wiring` key, and a retired-and-ignored warning for `wiring` is present rather than the unknown inner key silently passing through.
- Given a config containing `wiring: 5`, when the config is validated, then validation succeeds, the returned config contains no `wiring` key, and a retired-and-ignored warning for `wiring` is present.
- Given a project config and a user config that both contain a top-level `wiring` key, when the merged config loads and its deprecated keys are emitted, then the deprecated keys list `wiring` exactly once and exactly one deprecated-config-key event naming `wiring` is emitted.
- Given a config with no `wiring` key, when the config loads during a run, then no deprecated-config-key event names `wiring`.

### Done When

- [ ] Validating a config with any top-level `wiring` value succeeds, strips the key, returns a warning naming `wiring` and the retiring ADR, and lists `wiring` in the deprecated keys.
- [ ] The deprecated-config-key event for `wiring` reaches the event spine exactly once per load.

## Story 4: A custom markdown viewer must say what to run

As an operator configuring a markdown viewer by hand, I want a viewer block that names no preset (or
the `custom` preset) to fail validation unless it gives a command, arguments and mode, so that a
half-written viewer fails at load instead of at first use.

### Acceptance Criteria

#### Happy Path

- Given a `markdown_viewer` block of `{ preset: glow }` with no `command`, `args` or `mode`, when the config is validated, then validation succeeds.
- Given a `markdown_viewer` block of `{ preset: custom, command: bat, args: ["{file}"], mode: inline }`, when the config is validated, then validation succeeds.
- Given a `markdown_viewer` block of `{ command: bat, args: ["{file}"], mode: blocking }` with no preset, when the config is validated, then validation succeeds.

#### Negative Paths

- Given a `markdown_viewer` block of `{}`, when the config is validated, then validation fails with a message naming `markdown_viewer.command` as required when no preset is named.
- Given a `markdown_viewer` block of `{ preset: custom, command: bat, mode: inline }` with no `args`, when the config is validated, then validation fails with a message naming `markdown_viewer.args` as required.
- Given a `markdown_viewer` block of `{ command: bat, args: ["{file}"] }` with no preset and no `mode`, when the config is validated, then validation fails with a message naming `markdown_viewer.mode` as required.
- Given a `markdown_viewer` block of `{ preset: glow, args: ["-p"] }`, when the config is validated, then validation fails with a message stating `markdown_viewer.args` must include the `{file}` placeholder.

### Done When

- [ ] A preset-only viewer block validates successfully.
- [ ] Each custom-shape viewer block missing one of `command`, `args` or `mode` returns a `validation_error` naming the missing field.

## Story 5: A mermaid renderer must name its preset

As an operator configuring diagram rendering, I want a `mermaid_renderer` block without a preset to
fail validation, so that a block the renderer would silently treat as disabled is caught at load.

### Acceptance Criteria

#### Happy Path

- Given a `mermaid_renderer` block of `{ preset: html }` with no `command`, `args` or `mode`, when the config is validated, then validation succeeds.
- Given a `mermaid_renderer` block of `{ preset: html, command: "", args: ["{file}"], mode: external }`, when the config is validated, then validation succeeds.
- Given a `mermaid_renderer` block of `{ preset: none }`, when the config is validated, then validation succeeds.

#### Negative Paths

- Given a `mermaid_renderer` block of `{}`, when the config is validated, then validation fails with a message naming `mermaid_renderer.preset` as required.
- Given a `mermaid_renderer` block of `{ command: mmdc, args: ["{file}"], mode: external }` with no preset, when the config is validated, then validation fails with a message naming `mermaid_renderer.preset` as required.
- Given a `mermaid_renderer` block of `{ preset: 3 }`, when the config is validated, then validation fails with a message stating `mermaid_renderer.preset` must be a string.

### Done When

- [ ] A `mermaid_renderer` block with a string preset and no other fields validates successfully.
- [ ] A `mermaid_renderer` block without `preset` returns a `validation_error` naming `mermaid_renderer.preset`.

## Story 6: An unsupported OTLP protocol disables telemetry by name instead of silently falling back

As an operator enabling telemetry export, I want an unsupported `otel.protocol` to disable telemetry
with a named error, so that a typo neither silently sends telemetry over HTTP/protobuf nor stops my
run from loading its config.

"Resolving telemetry config" below means the harness turns the loaded `otel` block into the
telemetry exporter settings it will use for the run.

### Acceptance Criteria

#### Happy Path

- Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: grpc`, when telemetry config is resolved, then telemetry is enabled with protocol `grpc`.
- Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: http/protobuf`, when telemetry config is resolved, then telemetry is enabled with protocol `http/protobuf`.
- Given an `otel` block with `exporter: otlp`, an endpoint, and no `protocol`, when telemetry config is resolved, then telemetry is enabled and exports over HTTP/protobuf.

#### Negative Paths

- Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: http/json`, when telemetry config is resolved, then telemetry is disabled with an error naming `otel.protocol`, the rejected value `http/json`, and the accepted values `http/protobuf` and `grpc`.
- Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: gprc`, when telemetry config is resolved, then telemetry is disabled with an error naming `otel.protocol` and the rejected value `gprc`, and nothing is exported over HTTP/protobuf.
- Given a project config whose `otel` block has `protocol: http/json`, when the project config loads, then loading succeeds and the run is not blocked by the telemetry error.

### Done When

- [ ] `otel.protocol` values `grpc`, `http/protobuf` and absent each resolve to enabled telemetry.
- [ ] Any other `otel.protocol` value resolves to disabled telemetry with an error naming `otel.protocol` and the accepted values, while the project config still loads.

## Story 7: Step disable and when rejections state the real rule

As a maintainer trying to disable or condition a built-in step, I want the rejection message to
describe the rule the validator actually applies, so that I know gating steps that opt in (such as
`manual_test`) can be disabled and why this one cannot.

### Acceptance Criteria

#### Happy Path

- Given a config with `steps.manual_test.disable: true`, when the config is validated, then validation succeeds.
- Given a config with `steps.prd_audit.disable: true`, when the config is validated, then validation succeeds.
- Given a config with `steps.memory.disable: true`, when the config is validated, then validation succeeds.

#### Negative Paths

- Given a config with `steps.build_review.disable: true`, when the config is validated, then validation fails with a message naming `build_review` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be disabled.
- Given a config with `steps.build.disable: true`, when the config is validated, then validation fails with a message naming `build` as a structural step and stating that structural steps can never be disabled.
- Given a config with `steps.finish.when: "tier == L"`, when the config is validated, then validation fails with a message naming `finish` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be conditional.
- Given a config with `steps.rebase.when: "tier == L"`, when the config is validated, then validation fails with a message naming `rebase` as a structural step and stating that structural steps can never be conditional.

### Done When

- [ ] Disabling `manual_test`, `prd_audit` or an advisory step validates successfully.
- [ ] Every rejected disable or `when:` message names the step, its enforcement level, and the rule that applies to that level; no rejection message says only advisory steps may be disabled or conditional.
