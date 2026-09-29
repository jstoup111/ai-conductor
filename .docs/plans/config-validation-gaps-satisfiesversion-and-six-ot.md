# Implementation Plan: Config validation gaps (#1026)

**Date:** 2026-09-28
**Stories:** .docs/stories/config-validation-gaps-satisfiesversion-and-six-ot.md
**Conflict check:** Clean as of 2026-09-28

## Summary

Seven tasks close the #1026 config-validation gaps that are still open. The `harness_version` gate is fixed in two steps: first rejecting values it cannot evaluate, then evaluating every semver range form. The dead top-level `wiring` key is reported as retired. Custom markdown viewers must say what to run, and mermaid renderers must name a preset. An unsupported OTLP protocol disables telemetry by name. Step disable and `when` rejections state the rule the validator applies.

## Technical Approach

- **One module and its types.** Every validation change lives in `src/conductor/src/engine/config.ts` (`validateConfig` and its per-block helpers) and `src/conductor/src/types/config.ts`, except the OTLP protocol check, which lives in `resolveOtelConfig` (`src/conductor/src/engine/otel/otel-config.ts`). No new module, persistence, dependency or event type is added.
- **`harness_version`.** It is validated at config load and evaluated after load. `validateConfig` rejects a non-string, an empty string, and any string that `validRange` from the existing `semver` dependency cannot parse. The empty-string check must come first, because `validRange('')` returns `*`. `satisfiesVersion` then delegates to `satisfies` from the same library, as `plugin-manifest.ts` already does for plugin manifests. The existing `version_mismatch` message already names both the installed version and the constraint.
- **Retired `wiring` key.** This follows the local retired-key precedent (search `DEPRECATED_BUILD_REVIEW_ADR` and the `build_review.perTaskFloor` retirement branch): push a warning naming the key and its retiring ADR, push `{ key, adr }` onto `deprecatedKeys`, and delete the key from the returned config.
  - The key stays on the accepted top-level list, so no consumer config breaks.
  - The existing `emitDeprecatedConfigKeyEvents` carries the deprecation onto the event spine. `loadMergedConfig`'s existing `uniqueDeprecatedConfigKeys` keeps it to one event per load.
  - The retiring ADR is `adr-2026-08-14-retire-build-review-wiring-rubric`.
- **Viewer and renderer shapes follow what their consumers read.**
  - `markdown_viewer` needs `command`, `args` and `mode` only when no preset (or the `custom` preset) is named. `bin/lib/harness-common.sh` falls back to defaults for preset-only blocks.
  - `mermaid_renderer` needs `preset`, the only field `renderDiagramsForFile` reads.
  - Both types make the other fields optional. Installer-written blocks always carry a preset, so they stay valid.
- **OTLP protocol is a telemetry-resolution check, not a config-load check.** An invalid `otel` value disables telemetry with a named error and never fails the run. The new check matches the shape of the sibling unknown-exporter check in `resolveOtelConfig`.
- **Step-disable messages.** `stepSkipAuthorityError` keeps its predicate (structural always rejected; gating rejected unless the step allows config disabling). Only its wording changes.
- **`when` with `parallel` is not rejected.** APPROVED `004-when-parallel-workflow-dsl` defines `when:` on a parallel group as supported, so there is no validator change for it.
- **Sequencing.** Tasks 1→2→3→4→5→7 all edit `config.ts` and its tests, so they run as a chain to avoid same-file collisions. Task 1 precedes Task 2 so only valid ranges reach the evaluator. Task 6 touches only the otel module and runs independently.

## Prerequisites

- None. `semver` is already a runtime dependency of `src/conductor`.

## Tasks

### Task 1: Validate harness_version at config load
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/config-validation.test.ts` for `validateConfig` and in `src/conductor/test/engine/config.test.ts` for `loadProjectConfig` (installed version `1.5.0`, fixture project roots under a temp dir): `harness_version: 1` (YAML number), the empty string, `latest` (both through `validateConfig` with no installed version and through `loadProjectConfig`), the accepted values `*` and `^1.2.0`, and a config with no `harness_version` key loaded under installed versions `1.5.0` and `0.0.1`.
2. Verify the new tests fail (RED): today `harness_version: 1` reaches `satisfiesVersion` and throws, and the empty string and `latest` validate clean.
3. Implement in `src/conductor/src/engine/config.ts` inside `validateConfig`, next to the other top-level scalar checks: when `harness_version` is present, reject a non-string (`harness_version must be a string`), reject an empty or whitespace-only string (`harness_version must not be empty` — `semver.validRange('')` returns `*`, so this check must come first), and reject a string for which `validRange` from the existing `semver` dependency returns `null` (message names `harness_version` and the rejected value as not a valid version range). Import `validRange` from `semver` the way `plugin-manifest.ts` imports `satisfies`. Return the existing `errVal` shape; nothing throws.
4. Verify the tests pass (GREEN).
5. Commit: "fix(config): reject harness_version values the gate cannot evaluate"

**Done when:**
- `validateConfig` in `src/conductor/src/engine/config.ts` returns a `validation_error` stating `harness_version` must be a string for `harness_version: 1`, and `loadProjectConfig` with installed version `1.5.0` returns that result without throwing, as asserted by the non-string harness_version tests
- `validateConfig` returns a `validation_error` stating `harness_version` must not be empty when `harness_version` is the empty string, and `loadProjectConfig` with installed version `1.5.0` returns that result, as asserted by the empty harness_version test
- `validateConfig` returns a `validation_error` naming `harness_version` and the rejected value `latest` as not a valid version range both when called with no installed version and through `loadProjectConfig` with installed version `1.5.0`, as asserted by the invalid-range tests
- `validateConfig` accepts `harness_version` values `*` and `^1.2.0` with no installed version supplied, and `loadProjectConfig` with installed version `1.5.0` succeeds for `*`, as asserted by the accepted-range tests
- `loadProjectConfig` succeeds for a config with no `harness_version` key under installed versions `1.5.0` and `0.0.1`, showing no version check is applied, as asserted by the absent-key test

**Files:**
- `src/conductor/src/engine/config.ts` — harness_version type, emptiness and range validation
- `src/conductor/test/config-validation.test.ts` — validateConfig harness_version tests
- `src/conductor/test/engine/config.test.ts` — loadProjectConfig harness_version tests

**Dependencies:** none

### Task 2: Evaluate harness_version constraints with semver
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing table tests in `src/conductor/test/engine/config.test.ts` driving `loadProjectConfig` with installed version `1.5.0` against fixture project roots: satisfied constraints `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0`, `>=0.99.0`; unsatisfied constraints `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0`, `>=1.6.0`, each expecting `version_mismatch` with a message containing `1.5.0` and the constraint.
2. Verify the unsatisfied-constraint cases fail (RED): today every form except `>=X.Y.Z` returns `true`.
3. Implement in `src/conductor/src/engine/config.ts`: replace the body of `satisfiesVersion` with `satisfies(installed, constraint)` from the existing `semver` dependency (the same call `plugin-manifest.ts` makes). Keep the existing `version_mismatch` result and message in `loadProjectConfig`, which already names both the installed version and the constraint. Task 1 guarantees only a non-empty valid range reaches this function.
4. Verify the tests pass (GREEN).
5. Commit: "fix(config): evaluate harness_version with semver ranges"

**Done when:**
- `satisfiesVersion` in `src/conductor/src/engine/config.ts` evaluates the constraint with `satisfies` from `semver`, and `loadProjectConfig` with installed version `1.5.0` succeeds for each of `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0` and `>=0.99.0`, as asserted by the satisfied-constraint table test in `src/conductor/test/engine/config.test.ts`
- `loadProjectConfig` with installed version `1.5.0` returns a `version_mismatch` result, never success, whose message contains both `1.5.0` and the constraint for each of `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0` and `>=1.6.0`, as asserted by the unsatisfied-constraint table test

**Files:**
- `src/conductor/src/engine/config.ts` — satisfiesVersion delegates to semver
- `src/conductor/test/engine/config.test.ts` — constraint-form table tests

**Dependencies:** Task 1

### Task 3: Report the retired top-level wiring key as a deprecated no-op
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/config-validation.test.ts` for `validateConfig` with top-level `wiring` values `{ entry_points: [src/cli.ts] }`, the same plus `bogus: 1`, the scalar `5`, and a config with no `wiring` key; and in `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts` a `loadMergedConfig` test with a project config and a user config under a temporary `HOME` that both contain `wiring`, emitting the result through `emitDeprecatedConfigKeyEvents`, plus an emit test for a result with no `wiring` key. Also add a `src/conductor/test/config-validation.test.ts` regression test that `validateConfig` accepts a custom step carrying both `when:` and a `parallel` group with no `validation_error`, pinning ADR `004-when-parallel-workflow-dsl`; it fails today because a custom step must declare `skill` while `skill` and `parallel` are mutually exclusive.
2. Verify the tests fail (RED): today `wiring` passes through untouched with no warning or deprecated-key entry, and the when-with-parallel custom step is rejected for lacking `skill`.
3. Implement in `src/conductor/src/engine/config.ts` inside `validateConfig`, following the retired-key precedent used for `build_review.perTaskFloor` (search `DEPRECATED_BUILD_REVIEW_ADR`): when `obj` has an own `wiring` key, push a warning naming `wiring` as retired and ignored that cites `adr-2026-08-14-retire-build-review-wiring-rubric`, push `{ key: 'wiring', adr: 'adr-2026-08-14-retire-build-review-wiring-rubric' }` onto `deprecatedKeys`, and delete `wiring` from the returned config. Keep `wiring` on the top-level accepted-key list. Remove the orphan field comment for the retired wiring entry points in `src/conductor/src/types/config.ts`. In the same file, correct the `when` field comment that says it is mutually exclusive with `parallel`: state that `when:` on a `parallel` group is supported and a false `when` skips every branch, per ADR `004-when-parallel-workflow-dsl`. Add no rejection for `when` on a `parallel` group. Operator-approved validator change (plan-gap recovery, 2026-09-29): in the custom-step branch of `validateConfig`, require `skill: <path-to-SKILL.md>` only when the step has no `parallel` group, so a custom step whose work lives in `parallel` branches validates without a top-level `skill`; keep the `skill`/`parallel` mutual-exclusion check and the skill-file existence check unchanged. `loadMergedConfig` already de-duplicates deprecated keys with `uniqueDeprecatedConfigKeys`; do not add a second dedup.
4. Verify the tests pass (GREEN).
5. Commit: "fix(config): report the retired top-level wiring key"

**Done when:**
- `validateConfig` given a top-level `wiring` of `{ entry_points: [...] }`, of `{ entry_points: [...], bogus: 1 }`, or of `5` succeeds, returns a config with no `wiring` key, and returns a warning naming `wiring` as retired and ignored that cites `adr-2026-08-14-retire-build-review-wiring-rubric`, as asserted by the retired-wiring validation tests
- `validateConfig` given a top-level `wiring` key returns `deprecatedKeys` containing key `wiring` with ADR `adr-2026-08-14-retire-build-review-wiring-rubric`, and given a config with no `wiring` key returns no warning and no `deprecatedKeys` entry mentioning `wiring`, as asserted by the deprecated-keys tests
- `loadMergedConfig` with a project config and a user config under a temporary `HOME` that both contain `wiring` returns `deprecatedKeys` listing `wiring` exactly once, and `emitDeprecatedConfigKeyEvents` then emits exactly one `config_deprecated_key` event naming `wiring`, as asserted in `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts`
- `emitDeprecatedConfigKeyEvents` given the result of loading a config with no `wiring` key emits no `config_deprecated_key` event naming `wiring`, as asserted in the same integration test file
- The `when` field comment in `src/conductor/src/types/config.ts` states that `when:` on a `parallel` group is supported and a false `when` skips every branch, per ADR `004-when-parallel-workflow-dsl`, with no mutual-exclusion claim, and `validateConfig` accepts a custom step with `when:` and a `parallel` group and no top-level `skill`, as asserted by the when-with-parallel regression test in `src/conductor/test/config-validation.test.ts`

**Files:**
- `src/conductor/src/engine/config.ts` — wiring deprecation in validateConfig; custom step with `parallel` needs no top-level `skill`
- `src/conductor/src/types/config.ts` — remove orphan wiring field comment; correct the when/parallel comment
- `src/conductor/test/config-validation.test.ts` — retired-wiring validation tests and when-with-parallel regression test
- `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts` — merged-config dedup and event tests

**Dependencies:** Task 2

### Task 4: Require command, args and mode for a custom markdown viewer
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/config-validation.test.ts` for `validateConfig` with `markdown_viewer` blocks: `{ preset: glow }`; `{ preset: custom, command: bat, args: [{file}], mode: inline }`; `{ command: bat, args: [{file}], mode: blocking }`; `{}`; a `custom` block with no `args`; a preset-less block with no `mode`; and `{ preset: glow, args: [-p] }`.
2. Verify the missing-field cases fail (RED): today they validate clean.
3. Implement in `validateMarkdownViewerBlock` in `src/conductor/src/engine/config.ts`: after the existing per-field type checks, when `preset` is absent or equals `custom`, require `command`, then `args`, then `mode`, each missing field returning a `validation_error` naming `markdown_viewer.<field>` as required when no preset (or the `custom` preset) is named. Keep the existing `{file}` placeholder check. In `src/conductor/src/types/config.ts` make `command`, `args` and `mode` optional on `MarkdownViewerConfig` so the type matches the preset-only shape. Installer-written blocks always carry a preset, so they stay valid.
4. Verify the tests pass (GREEN).
5. Commit: "fix(config): require a custom markdown viewer to say what to run"

**Done when:**
- `validateMarkdownViewerBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: glow }` with no other fields, `{ preset: custom, command: bat, mode: inline }` with `args` containing the `{file}` placeholder, and `{ command: bat, mode: blocking }` with `args` containing the `{file}` placeholder and no preset, as asserted by the markdown_viewer shape tests
- `validateMarkdownViewerBlock` returns a `validation_error` naming `markdown_viewer.command` as required when no preset is named for `{}`, naming `markdown_viewer.args` as required for a `custom` block with no `args`, and naming `markdown_viewer.mode` as required for a preset-less block with no `mode`, as asserted by the missing-field tests
- `validateMarkdownViewerBlock` still returns a `validation_error` stating `markdown_viewer.args` must include the `{file}` placeholder for `{ preset: glow, args: [-p] }`, as asserted by the placeholder test
- `MarkdownViewerConfig` in `src/conductor/src/types/config.ts` declares `command`, `args` and `mode` optional, and the conductor TypeScript build compiles with that change

**Files:**
- `src/conductor/src/engine/config.ts` — custom-shape required fields
- `src/conductor/src/types/config.ts` — MarkdownViewerConfig optional fields
- `src/conductor/test/config-validation.test.ts` — markdown_viewer tests

**Dependencies:** Task 3

### Task 5: Require a mermaid renderer to name its preset
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/config-validation.test.ts` for `validateConfig` with `mermaid_renderer` blocks: `{ preset: html }`; the installer-written `{ preset: html, command: '', args: [{file}], mode: external }`; `{ preset: none }`; `{}`; `{ command: mmdc, args: [{file}], mode: external }`; and `{ preset: 3 }`.
2. Verify the missing-preset cases fail (RED): today they validate clean.
3. Implement in `validateMermaidRendererBlock` in `src/conductor/src/engine/config.ts`: after the existing `preset` type check, return a `validation_error` naming `mermaid_renderer.preset` as required when `preset` is absent — `renderDiagramsForFile` in `mermaid-renderer.ts` reads only `preset`. In `src/conductor/src/types/config.ts` make `command`, `args` and `mode` optional on `MermaidRendererConfig`.
4. Verify the tests pass (GREEN).
5. Commit: "fix(config): require mermaid_renderer.preset"

**Done when:**
- `validateMermaidRendererBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: html }`, the installer-written block with `preset: html`, an empty `command`, `args` containing the `{file}` placeholder and `mode: external`, and `{ preset: none }`, as asserted by the mermaid_renderer shape tests
- `validateMermaidRendererBlock` returns a `validation_error` naming `mermaid_renderer.preset` as required for `{}` and for a block with `command: mmdc`, `args` and `mode` but no preset, as asserted by the missing-preset tests
- `validateMermaidRendererBlock` returns a `validation_error` stating `mermaid_renderer.preset` must be a string for `{ preset: 3 }`, as asserted by the non-string preset test
- `MermaidRendererConfig` in `src/conductor/src/types/config.ts` declares `command`, `args` and `mode` optional, and the conductor TypeScript build compiles with that change

**Files:**
- `src/conductor/src/engine/config.ts` — mermaid_renderer preset required
- `src/conductor/src/types/config.ts` — MermaidRendererConfig optional fields
- `src/conductor/test/config-validation.test.ts` — mermaid_renderer tests

**Dependencies:** Task 4

### Task 6: Disable telemetry by name on an unsupported OTLP protocol
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/otel-config.test.ts`: `resolveOtelConfig` with `exporter: otlp`, an endpoint, and `protocol` of `grpc`, `http/protobuf`, absent, `http/json` and `gprc`; `buildExporters` given the absent-protocol result; the otel visualizer factory registered by `src/conductor/src/engine/plugin-loader.ts` given configs with `protocol: gprc` and `protocol: http/json`; and `loadProjectConfig` on a fixture project root whose `otel` block has `protocol: http/json`.
2. Verify the unsupported-protocol cases fail (RED): today `resolveOtelConfig` passes any `protocol` through and `buildExporters` falls back to HTTP/protobuf.
3. Implement in `resolveOtelConfig` in `src/conductor/src/engine/otel/otel-config.ts`, beside the existing unknown-exporter check and in its shape (disabled result plus a named error listing valid options; never throw): when `protocol` is present and is not `http/protobuf` or `grpc`, return `enabled: false` with an error naming `otel.protocol`, the rejected value, and the accepted values `http/protobuf` and `grpc`. Do not add an `otel` check to `validateConfig`: an invalid `otel` value disables telemetry and never fails config load or the run.
4. Verify the tests pass (GREEN).
5. Commit: "fix(otel): disable telemetry on an unsupported OTLP protocol"

**Done when:**
- `resolveOtelConfig` in `src/conductor/src/engine/otel/otel-config.ts` returns `enabled: true` with protocol `grpc` for `protocol: grpc` and with protocol `http/protobuf` for `protocol: http/protobuf`, as asserted by the supported-protocol tests in `src/conductor/test/engine/otel/otel-config.test.ts`
- `resolveOtelConfig` with `exporter: otlp`, an endpoint and no `protocol` returns `enabled: true` with no protocol, and `buildExporters` given that result constructs the HTTP/protobuf span and metric exporters, as asserted by the default-protocol test
- `resolveOtelConfig` returns `enabled: false` with an error naming `otel.protocol`, the rejected value, and the accepted values `http/protobuf` and `grpc` for `protocol: http/json` and for `protocol: gprc`, as asserted by the unsupported-protocol tests
- The otel visualizer factory registered in `src/conductor/src/engine/plugin-loader.ts` returns `null` without throwing for configs with `protocol: gprc` and `protocol: http/json`, so no HTTP/protobuf exporter is constructed, as asserted by the unsupported-protocol visualizer test
- `loadProjectConfig` in `src/conductor/src/engine/config.ts` succeeds for a project config whose `otel` block has `protocol: http/json`, and the registered otel visualizer factory returns `null` for that loaded config without throwing, as asserted by the config-load test in `src/conductor/test/engine/otel/otel-config.test.ts`

**Files:**
- `src/conductor/src/engine/otel/otel-config.ts` — protocol check in resolveOtelConfig
- `src/conductor/test/engine/otel/otel-config.test.ts` — protocol, factory and config-load tests

**Dependencies:** none

### Task 7: State the real rule in step disable and when rejections
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: `validateConfig` accepting `steps.manual_test.disable: true`, `steps.prd_audit.disable: true` and `steps.memory.disable: true`; rejecting `steps.build_review.disable: true`, `steps.build.disable: true`, `steps.finish.when: tier == L` and `steps.rebase.when: tier == L` with the new wording. Update the existing custom-step message assertions for gating and structural `lint` to the new wording.
2. Verify the new-wording assertions fail (RED).
3. Implement in `stepSkipAuthorityError` in `src/conductor/src/engine/config.ts` without changing its predicate (structural always rejected; gating rejected unless the step allows config disabling — the #1777 rule stays green): for `disable`, a gating step gets `Cannot disable gating step: <name>. Only advisory steps and gating steps that allow config disabling may be disabled.` and a structural step gets `Cannot disable structural step: <name>. Structural steps can never be disabled.`; for `when`, the same two shapes ending `may be conditional.` and `can never be conditional.`, keeping the quoted step name and the `with when:` phrase the current messages use.
4. Verify the tests pass (GREEN).
5. Commit: "fix(config): describe the real step disable rule"

**Done when:**
- `validateConfig` accepts `steps.manual_test.disable: true`, `steps.prd_audit.disable: true` and `steps.memory.disable: true`, as asserted by the allowed-disable tests in `src/conductor/test/engine/config.test.ts`
- `stepSkipAuthorityError` in `src/conductor/src/engine/config.ts` makes `validateConfig` reject `steps.build_review.disable: true` with a message naming `build_review` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be disabled, as asserted by the gating-disable message test
- `stepSkipAuthorityError` makes `validateConfig` reject `steps.build.disable: true` with a message naming `build` as a structural step and stating that structural steps can never be disabled, as asserted by the structural-disable message test
- `stepSkipAuthorityError` makes `validateConfig` reject `steps.finish.when` with a message naming `finish` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be conditional, as asserted by the gating-when message test
- `stepSkipAuthorityError` makes `validateConfig` reject `steps.rebase.when` with a message naming `rebase` as a structural step and stating that structural steps can never be conditional, as asserted by the structural-when message test

**Files:**
- `src/conductor/src/engine/config.ts` — stepSkipAuthorityError wording
- `src/conductor/test/engine/config.test.ts` — disable and when message tests

**Dependencies:** Task 5

## Task Dependency Graph

```text
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 7
Task 6 (independent)
```

## Integration Points

- **After Task 2:** `loadProjectConfig` (called by `loadMergedConfig` from the CLI entry with `readHarnessVersion()`) rejects an unevaluable constraint and evaluates every range form. Task 2 owns the `harness_version` boundary proof.
- **After Task 3:** the `wiring` deprecation travels `loadMergedConfig` → `emitDeprecatedConfigKeyEvents` → event spine. Task 3 owns that boundary proof.
- **After Task 6:** the otel visualizer factory registered in `plugin-loader.ts` declines to build an exporter for an unsupported protocol while config load succeeds. Task 6 owns that boundary proof.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a project config with `harness_version: "^1.2.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds. | 2 | "`satisfiesVersion` in `src/conductor/src/engine/config.ts` evaluates the constraint with `satisfies` from `semver`, and `loadProjectConfig` with installed version `1.5.0` succeeds for each of `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0` and `>=0.99.0`, as asserted by the satisfied-constraint table test in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 happy: Given a project config with `harness_version: "~1.5.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds. | 2 | "`satisfiesVersion` in `src/conductor/src/engine/config.ts` evaluates the constraint with `satisfies` from `semver`, and `loadProjectConfig` with installed version `1.5.0` succeeds for each of `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0` and `>=0.99.0`, as asserted by the satisfied-constraint table test in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 happy: Given a project config with `harness_version: ">=1.0.0 <2.0.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds. | 2 | "`satisfiesVersion` in `src/conductor/src/engine/config.ts` evaluates the constraint with `satisfies` from `semver`, and `loadProjectConfig` with installed version `1.5.0` succeeds for each of `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0` and `>=0.99.0`, as asserted by the satisfied-constraint table test in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 happy: Given a project config with `harness_version: "1.5.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds. | 2 | "`satisfiesVersion` in `src/conductor/src/engine/config.ts` evaluates the constraint with `satisfies` from `semver`, and `loadProjectConfig` with installed version `1.5.0` succeeds for each of `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0` and `>=0.99.0`, as asserted by the satisfied-constraint table test in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 happy: Given a project config with `harness_version: ">=0.99.0"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds. | 2 | "`satisfiesVersion` in `src/conductor/src/engine/config.ts` evaluates the constraint with `satisfies` from `semver`, and `loadProjectConfig` with installed version `1.5.0` succeeds for each of `^1.2.0`, `~1.5.0`, `>=1.0.0 <2.0.0`, `1.5.0` and `>=0.99.0`, as asserted by the satisfied-constraint table test in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 1 negative: Given a project config with `harness_version: "^2.0.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `^2.0.0`. | 2 | "`loadProjectConfig` with installed version `1.5.0` returns a `version_mismatch` result, never success, whose message contains both `1.5.0` and the constraint for each of `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0` and `>=1.6.0`, as asserted by the unsatisfied-constraint table test" | diff-local |
| Story 1 negative: Given a project config with `harness_version: "~1.4.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `~1.4.0`. | 2 | "`loadProjectConfig` with installed version `1.5.0` returns a `version_mismatch` result, never success, whose message contains both `1.5.0` and the constraint for each of `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0` and `>=1.6.0`, as asserted by the unsatisfied-constraint table test" | diff-local |
| Story 1 negative: Given a project config with `harness_version: ">=2.0.0 <3.0.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `>=2.0.0 <3.0.0`. | 2 | "`loadProjectConfig` with installed version `1.5.0` returns a `version_mismatch` result, never success, whose message contains both `1.5.0` and the constraint for each of `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0` and `>=1.6.0`, as asserted by the unsatisfied-constraint table test" | diff-local |
| Story 1 negative: Given a project config with `harness_version: "1.4.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `1.4.0`. | 2 | "`loadProjectConfig` with installed version `1.5.0` returns a `version_mismatch` result, never success, whose message contains both `1.5.0` and the constraint for each of `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0` and `>=1.6.0`, as asserted by the unsatisfied-constraint table test" | diff-local |
| Story 1 negative: Given a project config with `harness_version: ">=1.6.0"`, when the project config loads with installed harness version `1.5.0`, then the result is a version mismatch whose message names both `1.5.0` and `>=1.6.0`. | 2 | "`loadProjectConfig` with installed version `1.5.0` returns a `version_mismatch` result, never success, whose message contains both `1.5.0` and the constraint for each of `^2.0.0`, `~1.4.0`, `>=2.0.0 <3.0.0`, `1.4.0` and `>=1.6.0`, as asserted by the unsatisfied-constraint table test" | diff-local |
| Story 2 happy: Given a project config with `harness_version: "*"`, when the project config loads with installed harness version `1.5.0`, then loading succeeds. | 1 | "`validateConfig` accepts `harness_version` values `*` and `^1.2.0` with no installed version supplied, and `loadProjectConfig` with installed version `1.5.0` succeeds for `*`, as asserted by the accepted-range tests" | diff-local |
| Story 2 happy: Given a project config with no `harness_version` key, when the project config loads with installed harness version `1.5.0`, then loading succeeds with no version check applied. | 1 | "`loadProjectConfig` succeeds for a config with no `harness_version` key under installed versions `1.5.0` and `0.0.1`, showing no version check is applied, as asserted by the absent-key test" | diff-local |
| Story 2 happy: Given a project config with `harness_version: "^1.2.0"`, when the config is validated with no installed harness version supplied, then validation succeeds. | 1 | "`validateConfig` accepts `harness_version` values `*` and `^1.2.0` with no installed version supplied, and `loadProjectConfig` with installed version `1.5.0` succeeds for `*`, as asserted by the accepted-range tests" | diff-local |
| Story 2 negative: Given a project config with `harness_version: 1` (a YAML number), when the project config loads with installed harness version `1.5.0`, then validation fails with a message stating `harness_version` must be a string, and no exception is thrown. | 1 | "`validateConfig` in `src/conductor/src/engine/config.ts` returns a `validation_error` stating `harness_version` must be a string for `harness_version: 1`, and `loadProjectConfig` with installed version `1.5.0` returns that result without throwing, as asserted by the non-string harness_version tests" | diff-local |
| Story 2 negative: Given a project config with `harness_version: ""`, when the project config loads with installed harness version `1.5.0`, then validation fails with a message stating `harness_version` must not be empty. | 1 | "`validateConfig` returns a `validation_error` stating `harness_version` must not be empty when `harness_version` is the empty string, and `loadProjectConfig` with installed version `1.5.0` returns that result, as asserted by the empty harness_version test" | diff-local |
| Story 2 negative: Given a project config with `harness_version: "latest"`, when the project config loads with installed harness version `1.5.0`, then validation fails with a message naming `harness_version` and the rejected value `latest` as not a valid version range. | 1 | "`validateConfig` returns a `validation_error` naming `harness_version` and the rejected value `latest` as not a valid version range both when called with no installed version and through `loadProjectConfig` with installed version `1.5.0`, as asserted by the invalid-range tests" | diff-local |
| Story 2 negative: Given a project config with `harness_version: "latest"`, when the config is validated with no installed harness version supplied, then validation still fails with a message naming `harness_version` and `latest`. | 1 | "`validateConfig` returns a `validation_error` naming `harness_version` and the rejected value `latest` as not a valid version range both when called with no installed version and through `loadProjectConfig` with installed version `1.5.0`, as asserted by the invalid-range tests" | diff-local |
| Story 3 happy: Given a config containing `wiring: { entry_points: ["src/cli.ts"] }`, when the config is validated, then validation succeeds and the returned config contains no `wiring` key. | 3 | "`validateConfig` given a top-level `wiring` of `{ entry_points: [...] }`, of `{ entry_points: [...], bogus: 1 }`, or of `5` succeeds, returns a config with no `wiring` key, and returns a warning naming `wiring` as retired and ignored that cites `adr-2026-08-14-retire-build-review-wiring-rubric`, as asserted by the retired-wiring validation tests" | diff-local |
| Story 3 happy: Given a config containing `wiring: { entry_points: ["src/cli.ts"] }`, when the config is validated, then the returned warnings include one naming `wiring` as retired and ignored and citing `adr-2026-08-14-retire-build-review-wiring-rubric`. | 3 | "`validateConfig` given a top-level `wiring` of `{ entry_points: [...] }`, of `{ entry_points: [...], bogus: 1 }`, or of `5` succeeds, returns a config with no `wiring` key, and returns a warning naming `wiring` as retired and ignored that cites `adr-2026-08-14-retire-build-review-wiring-rubric`, as asserted by the retired-wiring validation tests" | diff-local |
| Story 3 happy: Given a config containing a top-level `wiring` key, when the config is validated, then the result's deprecated keys include `wiring` with the ADR `adr-2026-08-14-retire-build-review-wiring-rubric`. | 3 | "`validateConfig` given a top-level `wiring` key returns `deprecatedKeys` containing key `wiring` with ADR `adr-2026-08-14-retire-build-review-wiring-rubric`, and given a config with no `wiring` key returns no warning and no `deprecatedKeys` entry mentioning `wiring`, as asserted by the deprecated-keys tests" | diff-local |
| Story 3 happy: Given a config with no `wiring` key, when the config is validated, then no warning and no deprecated-key entry mentions `wiring`. | 3 | "`validateConfig` given a top-level `wiring` key returns `deprecatedKeys` containing key `wiring` with ADR `adr-2026-08-14-retire-build-review-wiring-rubric`, and given a config with no `wiring` key returns no warning and no `deprecatedKeys` entry mentioning `wiring`, as asserted by the deprecated-keys tests" | diff-local |
| Story 3 negative: Given a config containing `wiring: { entry_points: ["src/cli.ts"], bogus: 1 }`, when the config is validated, then validation succeeds, the returned config contains no `wiring` key, and a retired-and-ignored warning for `wiring` is present rather than the unknown inner key silently passing through. | 3 | "`validateConfig` given a top-level `wiring` of `{ entry_points: [...] }`, of `{ entry_points: [...], bogus: 1 }`, or of `5` succeeds, returns a config with no `wiring` key, and returns a warning naming `wiring` as retired and ignored that cites `adr-2026-08-14-retire-build-review-wiring-rubric`, as asserted by the retired-wiring validation tests" | diff-local |
| Story 3 negative: Given a config containing `wiring: 5`, when the config is validated, then validation succeeds, the returned config contains no `wiring` key, and a retired-and-ignored warning for `wiring` is present. | 3 | "`validateConfig` given a top-level `wiring` of `{ entry_points: [...] }`, of `{ entry_points: [...], bogus: 1 }`, or of `5` succeeds, returns a config with no `wiring` key, and returns a warning naming `wiring` as retired and ignored that cites `adr-2026-08-14-retire-build-review-wiring-rubric`, as asserted by the retired-wiring validation tests" | diff-local |
| Story 3 negative: Given a project config and a user config that both contain a top-level `wiring` key, when the merged config loads and its deprecated keys are emitted, then the deprecated keys list `wiring` exactly once and exactly one deprecated-config-key event naming `wiring` is emitted. | 3 | "`loadMergedConfig` with a project config and a user config under a temporary `HOME` that both contain `wiring` returns `deprecatedKeys` listing `wiring` exactly once, and `emitDeprecatedConfigKeyEvents` then emits exactly one `config_deprecated_key` event naming `wiring`, as asserted in `src/conductor/test/integration/config-deprecated-key-event.integration.test.ts`" | diff-local |
| Story 3 negative: Given a config with no `wiring` key, when the config loads during a run, then no deprecated-config-key event names `wiring`. | 3 | "`emitDeprecatedConfigKeyEvents` given the result of loading a config with no `wiring` key emits no `config_deprecated_key` event naming `wiring`, as asserted in the same integration test file" | diff-local |
| Story 4 happy: Given a `markdown_viewer` block of `{ preset: glow }` with no `command`, `args` or `mode`, when the config is validated, then validation succeeds. | 4 | "`validateMarkdownViewerBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: glow }` with no other fields, `{ preset: custom, command: bat, mode: inline }` with `args` containing the `{file}` placeholder, and `{ command: bat, mode: blocking }` with `args` containing the `{file}` placeholder and no preset, as asserted by the markdown_viewer shape tests" | diff-local |
| Story 4 happy: Given a `markdown_viewer` block of `{ preset: custom, command: bat, args: ["{file}"], mode: inline }`, when the config is validated, then validation succeeds. | 4 | "`validateMarkdownViewerBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: glow }` with no other fields, `{ preset: custom, command: bat, mode: inline }` with `args` containing the `{file}` placeholder, and `{ command: bat, mode: blocking }` with `args` containing the `{file}` placeholder and no preset, as asserted by the markdown_viewer shape tests" | diff-local |
| Story 4 happy: Given a `markdown_viewer` block of `{ command: bat, args: ["{file}"], mode: blocking }` with no preset, when the config is validated, then validation succeeds. | 4 | "`validateMarkdownViewerBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: glow }` with no other fields, `{ preset: custom, command: bat, mode: inline }` with `args` containing the `{file}` placeholder, and `{ command: bat, mode: blocking }` with `args` containing the `{file}` placeholder and no preset, as asserted by the markdown_viewer shape tests" | diff-local |
| Story 4 negative: Given a `markdown_viewer` block of `{}`, when the config is validated, then validation fails with a message naming `markdown_viewer.command` as required when no preset is named. | 4 | "`validateMarkdownViewerBlock` returns a `validation_error` naming `markdown_viewer.command` as required when no preset is named for `{}`, naming `markdown_viewer.args` as required for a `custom` block with no `args`, and naming `markdown_viewer.mode` as required for a preset-less block with no `mode`, as asserted by the missing-field tests" | diff-local |
| Story 4 negative: Given a `markdown_viewer` block of `{ preset: custom, command: bat, mode: inline }` with no `args`, when the config is validated, then validation fails with a message naming `markdown_viewer.args` as required. | 4 | "`validateMarkdownViewerBlock` returns a `validation_error` naming `markdown_viewer.command` as required when no preset is named for `{}`, naming `markdown_viewer.args` as required for a `custom` block with no `args`, and naming `markdown_viewer.mode` as required for a preset-less block with no `mode`, as asserted by the missing-field tests" | diff-local |
| Story 4 negative: Given a `markdown_viewer` block of `{ command: bat, args: ["{file}"] }` with no preset and no `mode`, when the config is validated, then validation fails with a message naming `markdown_viewer.mode` as required. | 4 | "`validateMarkdownViewerBlock` returns a `validation_error` naming `markdown_viewer.command` as required when no preset is named for `{}`, naming `markdown_viewer.args` as required for a `custom` block with no `args`, and naming `markdown_viewer.mode` as required for a preset-less block with no `mode`, as asserted by the missing-field tests" | diff-local |
| Story 4 negative: Given a `markdown_viewer` block of `{ preset: glow, args: ["-p"] }`, when the config is validated, then validation fails with a message stating `markdown_viewer.args` must include the `{file}` placeholder. | 4 | "`validateMarkdownViewerBlock` still returns a `validation_error` stating `markdown_viewer.args` must include the `{file}` placeholder for `{ preset: glow, args: [-p] }`, as asserted by the placeholder test" | diff-local |
| Story 5 happy: Given a `mermaid_renderer` block of `{ preset: html }` with no `command`, `args` or `mode`, when the config is validated, then validation succeeds. | 5 | "`validateMermaidRendererBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: html }`, the installer-written block with `preset: html`, an empty `command`, `args` containing the `{file}` placeholder and `mode: external`, and `{ preset: none }`, as asserted by the mermaid_renderer shape tests" | diff-local |
| Story 5 happy: Given a `mermaid_renderer` block of `{ preset: html, command: "", args: ["{file}"], mode: external }`, when the config is validated, then validation succeeds. | 5 | "`validateMermaidRendererBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: html }`, the installer-written block with `preset: html`, an empty `command`, `args` containing the `{file}` placeholder and `mode: external`, and `{ preset: none }`, as asserted by the mermaid_renderer shape tests" | diff-local |
| Story 5 happy: Given a `mermaid_renderer` block of `{ preset: none }`, when the config is validated, then validation succeeds. | 5 | "`validateMermaidRendererBlock` in `src/conductor/src/engine/config.ts` accepts `{ preset: html }`, the installer-written block with `preset: html`, an empty `command`, `args` containing the `{file}` placeholder and `mode: external`, and `{ preset: none }`, as asserted by the mermaid_renderer shape tests" | diff-local |
| Story 5 negative: Given a `mermaid_renderer` block of `{}`, when the config is validated, then validation fails with a message naming `mermaid_renderer.preset` as required. | 5 | "`validateMermaidRendererBlock` returns a `validation_error` naming `mermaid_renderer.preset` as required for `{}` and for a block with `command: mmdc`, `args` and `mode` but no preset, as asserted by the missing-preset tests" | diff-local |
| Story 5 negative: Given a `mermaid_renderer` block of `{ command: mmdc, args: ["{file}"], mode: external }` with no preset, when the config is validated, then validation fails with a message naming `mermaid_renderer.preset` as required. | 5 | "`validateMermaidRendererBlock` returns a `validation_error` naming `mermaid_renderer.preset` as required for `{}` and for a block with `command: mmdc`, `args` and `mode` but no preset, as asserted by the missing-preset tests" | diff-local |
| Story 5 negative: Given a `mermaid_renderer` block of `{ preset: 3 }`, when the config is validated, then validation fails with a message stating `mermaid_renderer.preset` must be a string. | 5 | "`validateMermaidRendererBlock` returns a `validation_error` stating `mermaid_renderer.preset` must be a string for `{ preset: 3 }`, as asserted by the non-string preset test" | diff-local |
| Story 6 happy: Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: grpc`, when telemetry config is resolved, then telemetry is enabled with protocol `grpc`. | 6 | "`resolveOtelConfig` in `src/conductor/src/engine/otel/otel-config.ts` returns `enabled: true` with protocol `grpc` for `protocol: grpc` and with protocol `http/protobuf` for `protocol: http/protobuf`, as asserted by the supported-protocol tests in `src/conductor/test/engine/otel/otel-config.test.ts`" | diff-local |
| Story 6 happy: Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: http/protobuf`, when telemetry config is resolved, then telemetry is enabled with protocol `http/protobuf`. | 6 | "`resolveOtelConfig` in `src/conductor/src/engine/otel/otel-config.ts` returns `enabled: true` with protocol `grpc` for `protocol: grpc` and with protocol `http/protobuf` for `protocol: http/protobuf`, as asserted by the supported-protocol tests in `src/conductor/test/engine/otel/otel-config.test.ts`" | diff-local |
| Story 6 happy: Given an `otel` block with `exporter: otlp`, an endpoint, and no `protocol`, when telemetry config is resolved, then telemetry is enabled and exports over HTTP/protobuf. | 6 | "`resolveOtelConfig` with `exporter: otlp`, an endpoint and no `protocol` returns `enabled: true` with no protocol, and `buildExporters` given that result constructs the HTTP/protobuf span and metric exporters, as asserted by the default-protocol test" | diff-local |
| Story 6 negative: Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: http/json`, when telemetry config is resolved, then telemetry is disabled with an error naming `otel.protocol`, the rejected value `http/json`, and the accepted values `http/protobuf` and `grpc`. | 6 | "`resolveOtelConfig` returns `enabled: false` with an error naming `otel.protocol`, the rejected value, and the accepted values `http/protobuf` and `grpc` for `protocol: http/json` and for `protocol: gprc`, as asserted by the unsupported-protocol tests" | diff-local |
| Story 6 negative: Given an `otel` block with `exporter: otlp`, an endpoint, and `protocol: gprc`, when telemetry config is resolved, then telemetry is disabled with an error naming `otel.protocol` and the rejected value `gprc`, and nothing is exported over HTTP/protobuf. | 6 | "The otel visualizer factory registered in `src/conductor/src/engine/plugin-loader.ts` returns `null` without throwing for configs with `protocol: gprc` and `protocol: http/json`, so no HTTP/protobuf exporter is constructed, as asserted by the unsupported-protocol visualizer test" | diff-local |
| Story 6 negative: Given a project config whose `otel` block has `protocol: http/json`, when the project config loads, then loading succeeds and the run is not blocked by the telemetry error. | 6 | "`loadProjectConfig` in `src/conductor/src/engine/config.ts` succeeds for a project config whose `otel` block has `protocol: http/json`, and the registered otel visualizer factory returns `null` for that loaded config without throwing, as asserted by the config-load test in `src/conductor/test/engine/otel/otel-config.test.ts`" | diff-local |
| Story 7 happy: Given a config with `steps.manual_test.disable: true`, when the config is validated, then validation succeeds. | 7 | "`validateConfig` accepts `steps.manual_test.disable: true`, `steps.prd_audit.disable: true` and `steps.memory.disable: true`, as asserted by the allowed-disable tests in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 7 happy: Given a config with `steps.prd_audit.disable: true`, when the config is validated, then validation succeeds. | 7 | "`validateConfig` accepts `steps.manual_test.disable: true`, `steps.prd_audit.disable: true` and `steps.memory.disable: true`, as asserted by the allowed-disable tests in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 7 happy: Given a config with `steps.memory.disable: true`, when the config is validated, then validation succeeds. | 7 | "`validateConfig` accepts `steps.manual_test.disable: true`, `steps.prd_audit.disable: true` and `steps.memory.disable: true`, as asserted by the allowed-disable tests in `src/conductor/test/engine/config.test.ts`" | diff-local |
| Story 7 negative: Given a config with `steps.build_review.disable: true`, when the config is validated, then validation fails with a message naming `build_review` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be disabled. | 7 | "`stepSkipAuthorityError` in `src/conductor/src/engine/config.ts` makes `validateConfig` reject `steps.build_review.disable: true` with a message naming `build_review` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be disabled, as asserted by the gating-disable message test" | diff-local |
| Story 7 negative: Given a config with `steps.build.disable: true`, when the config is validated, then validation fails with a message naming `build` as a structural step and stating that structural steps can never be disabled. | 7 | "`stepSkipAuthorityError` makes `validateConfig` reject `steps.build.disable: true` with a message naming `build` as a structural step and stating that structural steps can never be disabled, as asserted by the structural-disable message test" | diff-local |
| Story 7 negative: Given a config with `steps.finish.when: "tier == L"`, when the config is validated, then validation fails with a message naming `finish` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be conditional. | 7 | "`stepSkipAuthorityError` makes `validateConfig` reject `steps.finish.when` with a message naming `finish` as a gating step and stating that only advisory steps and gating steps that allow config disabling may be conditional, as asserted by the gating-when message test" | diff-local |
| Story 7 negative: Given a config with `steps.rebase.when: "tier == L"`, when the config is validated, then validation fails with a message naming `rebase` as a structural step and stating that structural steps can never be conditional. | 7 | "`stepSkipAuthorityError` makes `validateConfig` reject `steps.rebase.when` with a message naming `rebase` as a structural step and stating that structural steps can never be conditional, as asserted by the structural-when message test" | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
