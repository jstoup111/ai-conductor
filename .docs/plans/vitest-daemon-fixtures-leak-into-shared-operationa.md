# Implementation Plan: Vitest daemon fixtures leak into shared operational OTel metrics (#2471)

**Date:** 2026-10-03
**Stories:** .docs/stories/vitest-daemon-fixtures-leak-into-shared-operationa.md
**Conflict check:** Clean as of 2026-10-03

## Summary

Ordinary test runs stop inheriting the operator's user config, and OTLP network export is refused at the exporter boundary under the suite's test marker unless a smoke-only opt-in is set. The plan has 10 tasks.

## Technical Approach

- **Root cause (verified).** `daemon-cli.ts` loads each project through `loadMergedConfig`, which layers `readUserConfig()` (default `~/.ai-conductor/config.yml`) beneath project config. The operator's user config declares `otel: otlp`, so test fixtures export with their own project identity. The repository's own project config also declares otlp, which is why a second, independent layer is needed.
- **Layer 1, user-config isolation (Tasks 1 to 3).** `userConfigPath()` honours a new `AI_CONDUCTOR_USER_CONFIG_DIR` when no explicit `home` is passed; empty or whitespace values mean unset. `test/setup.ts`, loaded by all three Vitest configs, assigns a run-scoped `mkdtemp` directory inside the redirected run temp root. Every production reader (`loadMergedConfig`, `loadMergedConfigForRead`, `readMachineOwnerConfig`, the CLI user-config commands) already defaults through `userConfigPath()`, so no call site changes. This layer does not depend on `AI_CONDUCTOR_NO_REAL_EXEC`, so tests that delete the marker stay isolated.
- **Layer 2, export backstop (Tasks 4 to 7).** A pure `otlpExportRefusal(env)` decides refusal: the marker equals `1` and `AI_CONDUCTOR_OTEL_SMOKE` is not exactly `1`. `buildExporters(config, env = process.env)`, the single OTLP construction site, returns `{ refused: true, message }` before constructing any OTLP exporter, so no batching or spooling layer can wrap a network exporter. The file exporter is never refused. The three wiring entry points (`wireDaemonOtel`, `wireInteractiveOtelMetrics`, `wireOtelVisualizer`) turn a refusal into one `renderer_error` (`rendererName: otel`) and a `null` result, never a throw (ADR-014 Decision 5). The visualizer reuses `createOtelVisualizer`'s existing constructor-error conversion. An optional `env` on the wiring contexts lets tests drive real exporters against a loopback receiver they own without mutating the process environment (conflict-check resolution, option 1).
- **Proof and guard (Tasks 8 to 10).** Task 8 owns the cross-boundary proof from config load to the export boundary against a fake collector. Task 9 is a guard test that derives the smoke tier from `vitest.smoke.config.ts` include globs. Task 10 moves the existing authenticated-export loopback test onto an explicit env.
- **Local pattern basis.** The override mirrors `AI_CONDUCTOR_ENGINEER_DIR` (env-selected directory, honoured only when non-empty, production default unchanged; search `AI_CONDUCTOR_ENGINEER_DIR` in `test/setup.ts` and `src/engine/engineer-store.ts`). The refusal mirrors the `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch in `src/engine/daemon-tmux.ts` (exact `=== '1'` match, operator-legible reason). Allowed variation: the refusal returns a value instead of throwing, because ADR-014 Decision 5 forbids failing a run.
- **Durable spool (not on this base).** When the spool lands, its direct-send fallback and drainer must consult the same `otlpExportRefusal`, which is why the decision lives in its own module.
- **Sequencing.** Tasks 1 and 4 are independent roots. Layer 1 runs 1 → 2 → 3. Layer 2 runs 4 → 5 → {6, 7, 10}, with 9 after 4. Task 8 joins both layers.

## Prerequisites

- None. No ADR is created or amended; ADR-014 governs the exporter and is unchanged.

## Tasks

### Task 1: Env-overridable user-config location
**Story:** 1
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/user-config.test.ts` for `userConfigPath`: with `AI_CONDUCTOR_USER_CONFIG_DIR` set to a temp directory the defaulted call returns `<dir>/config.yml`; with the variable unset, empty, or whitespace-only it returns `join(homedir(), '.ai-conductor', 'config.yml')`; an explicit `home` argument still wins over the variable. Add a `readUserConfig()` case where the override names a directory with no `config.yml` while a temp `HOME` holds one: the result is `{ config: {}, existed: false }`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/user-config.ts`: export `USER_CONFIG_DIR_ENV = 'AI_CONDUCTOR_USER_CONFIG_DIR'`; change `userConfigPath(home?: string, env: NodeJS.ProcessEnv = process.env)` so an explicit `home` keeps today's path, otherwise a trimmed non-empty override yields `join(override, USER_CONFIG_FILE)`, otherwise `join(homedir(), USER_CONFIG_DIR, USER_CONFIG_FILE)`. `readUserConfig` and `writeUserConfig` keep defaulting through `userConfigPath()`, so every production reader (`loadMergedConfig`, `loadMergedConfigForRead`, `readMachineOwnerConfig`, the CLI user-config commands) inherits the override with no call-site change. Pattern: the env-selected directory precedent `AI_CONDUCTOR_ENGINEER_DIR` (search `engineerDirFromEnv` or `AI_CONDUCTOR_ENGINEER_DIR` in `src/engine/engineer-store.ts`): env wins only when non-empty, production default unchanged.
4. Verify GREEN and commit.

**Done when:**
- `userConfigPath()` returns `<override>/config.yml` when `AI_CONDUCTOR_USER_CONFIG_DIR` is non-empty and returns the `~/.ai-conductor/config.yml` home default when the variable is unset, empty, or whitespace-only, as asserted in `user-config.test.ts`.
- An explicit `home` argument to `userConfigPath(home)` returns `<home>/.ai-conductor/config.yml` even when the override is set.
- `readUserConfig()` with the override naming a directory that contains no config file returns an empty config with `existed: false` and does not read the planted config under the temp `HOME`.
- With neither the override nor `AI_CONDUCTOR_NO_REAL_EXEC` set, `loadMergedConfig` on a fixture project reads the user layer from the home default and the project value wins over the user value for a key both declare, exactly as before.

**Files:** src/conductor/src/engine/user-config.ts; src/conductor/test/engine/user-config.test.ts

**Dependencies:** none

### Task 2: Test setup isolates the user-config layer for every Vitest tier
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in a new `src/conductor/test/user-config-isolation.test.ts`. Each case plants a temp `HOME` whose `.ai-conductor/config.yml` declares `otel: { exporter: otlp, endpoint: http://127.0.0.1:1 }` (restore `HOME` in `afterEach`). Cases: (a) `process.env.AI_CONDUCTOR_USER_CONFIG_DIR` is set and lies under the run temp root (`process.env` key exported as `RUN_TMP_ROOT_ENV` from `test/tmpdir-leak-guard.ts`); (b) `loadMergedConfig` on a `mkdtemp` fixture project without an `otel` block yields `resolveOtelConfig(...).enabled === false`; (c) the same holds, and the run-scoped seeded value is still present, after `delete process.env.AI_CONDUCTOR_NO_REAL_EXEC` (restored after the case); (d) a child `process.execPath` spawned with the inherited environment and `--import tsx` runs `loadMergedConfig` on the fixture and prints the merged config as JSON: it carries the run-scoped seeded value and neither the planted home's differing value for the same key nor its otlp block; (e) a value seeded into `<override>/config.yml` appears in the merged config and a fixture project value for the same key wins.
2. Verify RED (case a fails: setup does not assign the variable).
3. Implement in `src/conductor/test/setup.ts`: mirroring the `AI_CONDUCTOR_ENGINEER_DIR` block already there, when `process.env.AI_CONDUCTOR_USER_CONFIG_DIR` is unset or blank assign `mkdtempSync(join(tmpdir(), 'ai-conductor-test-user-config-'))`. `tmpdir()` already resolves inside the run root at this point (vitest configs call `ensureRunTmpRootSync` first), so teardown removes it with the run root and the tmpdir leak guard never sees it. `vitest.config.ts`, `vitest.e2e.config.ts`, and `vitest.smoke.config.ts` already list `./test/setup.ts` in `setupFiles`; do not change their include or exclude globs.
4. Verify GREEN and commit.

**Done when:**
- `test/setup.ts` assigns `AI_CONDUCTOR_USER_CONFIG_DIR` to a `mkdtemp` directory under the run temp root when it is unset or blank and keeps a preset non-blank value, and `vitest.config.ts`, `vitest.e2e.config.ts`, and `vitest.smoke.config.ts` each load `./test/setup.ts` through `setupFiles`.
- With a planted home user config declaring an otlp exporter, `loadMergedConfig` on a fixture project without an `otel` block resolves OTel disabled and carries the value seeded into the run-scoped `config.yml`, both with the test marker set and after the test deletes `AI_CONDUCTOR_NO_REAL_EXEC`.
- A child process spawned with the inherited test environment runs `loadMergedConfig` on the fixture and prints a merged config carrying the run-scoped seeded value and not the planted home's differing value or its otlp exporter.
- A value seeded into the run-scoped `config.yml` appears in the fixture's merged config, and the fixture project's value wins for a key both layers declare.

**Files:** src/conductor/test/setup.ts; src/conductor/test/user-config-isolation.test.ts

**Dependencies:** Task 1

### Task 3: CLI user-config commands stay inside the run-scoped location
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write a test in `src/conductor/test/cli-config-user-isolation.test.ts` that plants a temp `HOME` holding `.ai-conductor/config.yml` with a known `markdown_viewer.command`, records its bytes and mtime, sets its mode to 000 for the commands (restoring it afterwards), then drives `userConfigSetCommand` and `userConfigReadCommand` from `src/cli.ts` (the same entry points `test/cli-config-user.test.ts` drives) from a project-less cwd with no explicit path.
2. This proves existing behavior inherited from Tasks 1 and 2: the commands default through `userConfigPath()`. Expect GREEN on first run; if it is RED, the fix belongs in `src/engine/user-config.ts` defaults, not in `src/cli.ts`.
3. Commit the test.

**Done when:**
- `userConfigSetCommand` with no explicit path writes the value into `<AI_CONDUCTOR_USER_CONFIG_DIR>/config.yml`, a path the test asserts lies beneath the run temp root, and `userConfigReadCommand` reads the same value back from that run-scoped file.
- With the planted home `.ai-conductor/config.yml` made unreadable (mode 000), both commands still exit 0, proving the home file is never opened, and after restoring its mode it keeps its original bytes and mtime.

**Files:** src/conductor/test/cli-config-user-isolation.test.ts

**Verify-only:** yes

**Dependencies:** Task 2

### Task 4: Pure OTLP export refusal decision
**Story:** 2
**Story:** 4
**Type:** infrastructure

**Steps:**
1. Write failing unit tests in `src/conductor/test/engine/otel/export-refusal.test.ts` for `otlpExportRefusal(env)`: `{ AI_CONDUCTOR_NO_REAL_EXEC: '1' }` returns a message string; adding `AI_CONDUCTOR_OTEL_SMOKE: '1'` returns `null`; opt-in values `'true'`, `'0'`, `''`, and `' 1 '` with the marker still return the message; `{ AI_CONDUCTOR_OTEL_SMOKE: '1' }` alone and `{}` return `null`. Assert the message contains both `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`.
2. Verify RED.
3. Implement `src/conductor/src/engine/otel/export-refusal.ts` exporting `OTEL_SMOKE_ENV`, `otlpExportRefusal(env: NodeJS.ProcessEnv): string | null`, and the refusal message (`[otel] OTLP export refused: AI_CONDUCTOR_NO_REAL_EXEC=1 marks a test run; set AI_CONDUCTOR_OTEL_SMOKE=1 only in a smoke-tier test to opt in`). The marker matches exactly `'1'`, following the kill-switch check in `src/engine/daemon-tmux.ts` (search `AI_CONDUCTOR_NO_REAL_EXEC === '1'`); the opt-in matches exactly `'1'`. Keep it a pure function of its argument so the future durable-spool drainer can import the same decision.
4. Verify GREEN and commit.

**Done when:**
- `otlpExportRefusal` returns the refusal message, which names both `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`, when the marker equals `1` and the opt-in is absent or any value other than `1` (`true`, `0`, empty, and ` 1 ` are asserted).
- `otlpExportRefusal` returns `null` when the marker equals `1` and the opt-in equals `1`, and returns `null` whenever the marker is absent, including when the opt-in equals `1` without it.
- `otlpExportRefusal` reads only the environment object it is given, as asserted by a case whose argument lacks the marker while `process.env` carries it.
- `buildExporters` with `AI_CONDUCTOR_OTEL_SMOKE` set to any value and the marker absent (no `AI_CONDUCTOR_NO_REAL_EXEC`) builds the exact exporters it builds when the opt-in is unset, as asserted by a case comparing both construction results in export-refusal.test.ts.

**Files:** src/conductor/src/engine/otel/export-refusal.ts; src/conductor/test/engine/otel/export-refusal.test.ts

**Dependencies:** none

### Task 5: buildExporters refuses OTLP under the test marker with an injectable environment
**Story:** 3
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/transport.test.ts`. Mock the four OTLP exporter packages (`@opentelemetry/exporter-trace-otlp-http`, `-metrics-otlp-http`, `-trace-otlp-grpc`, `-metrics-otlp-grpc`) with constructor-counting wrappers around the real classes. Cases: http and grpc otlp configs with `{ AI_CONDUCTOR_NO_REAL_EXEC: '1' }` return `{ refused: true, message }` and construct zero OTLP exporters; the same configs with an explicit env lacking the marker construct the expected HTTP or gRPC exporters; marker plus `AI_CONDUCTOR_OTEL_SMOKE: '1'` constructs them and an exported span reaches a test-owned loopback `node:http` receiver at `/v1/traces`; a call with no env argument refuses because the test process carries the marker; a file config under the marker writes an exported span to the configured file.
2. Verify RED.
3. Implement in `src/conductor/src/engine/otel/transport.ts`: `buildExporters(config, env: NodeJS.ProcessEnv = process.env): Exporters | OtlpExportRefused`, where `OtlpExportRefused = { refused: true; message: string }` and an exported `isExportRefused` type guard. Consult `otlpExportRefusal(env)` before constructing any OTLP exporter; the file branch never consults it. Never throw. Update the existing construction cases in the same test file to pass an explicit env without the marker instead of relying on `process.env`; do not delete `process.env.AI_CONDUCTOR_NO_REAL_EXEC` anywhere.
4. Verify GREEN and commit.

**Done when:**
- `buildExporters` with an otlp config and an env carrying the marker but no opt-in returns `{ refused: true }` with the refusal message for both the default http/protobuf protocol and `protocol: grpc`, and the constructor-counting mocks record zero OTLP exporter constructions.
- `buildExporters` called without an env argument refuses an otlp config because the test process carries the marker, and called with an explicit env carrying the marker refuses the same way.
- `buildExporters` with an explicit env lacking the marker, or with the marker plus `AI_CONDUCTOR_OTEL_SMOKE=1`, constructs the HTTP or gRPC span and metric exporters as before, and with the marker plus the opt-in an exported span reaches a test-owned loopback receiver at `/v1/traces`.
- Under the marker, `buildExporters` with a file config returns file exporters and an exported span is appended to the configured file.
- The pre-existing construction cases in `transport.test.ts` pass by supplying an explicit env, and no test file in this task deletes `process.env.AI_CONDUCTOR_NO_REAL_EXEC`.

**Files:** src/conductor/src/engine/otel/transport.ts; src/conductor/test/engine/otel/transport.test.ts

**Dependencies:** Task 4

### Task 6: Daemon and interactive metric wiring surface the refusal
**Story:** 2
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/wire-export-refusal.test.ts` that use the real `buildExporters` (no transport mock) and wrap the four OTLP exporter classes in constructor-counting mocks, as Task 5 does. Start a loopback `node:http` server counting connections and point an otlp config at it. Cases: `wireDaemonOtel` and `wireInteractiveOtelMetrics` under the process marker return `null`, emit exactly one `renderer_error` with `rendererName: 'otel'` carrying the refusal message, then `flush`/`stop` paths are absent and the server records zero connections; with `env` lacking the marker passed through the wiring context, `wireDaemonOtel` returns a live handle and emits no refusal event; with that env and an endpoint on a closed loopback port, `flush()` and `stop()` resolve without throwing.
2. Verify RED.
3. Implement in `src/conductor/src/engine/otel/wire.ts`: add optional `env?: NodeJS.ProcessEnv` to the `wireDaemonOtel` context and to `OtelVisualizerStartContext`, forward it to `buildExporters(resolved, env)`, and when `isExportRefused(...)` emit one `renderer_error` (`rendererName: 'otel'`, `error: refusal.message`) on `rootEvents` or `events` and return `null` before any `MeterProvider` or listener is created. Follow the existing `attributeWarnings` emission in `wireDaemonOtel` (search `attributeWarnings?.length`): fire-and-forget `emit(...).catch(() => {})`, never throw (ADR-014 Decision 5).
4. Verify GREEN and commit.

**Done when:**
- Under the process marker, `wireDaemonOtel` and `wireInteractiveOtelMetrics` each return `null` for an otlp config, create no `MeterProvider`, the constructor-counting mocks of the four OTLP exporter classes record zero constructions, and the loopback receiver configured as the endpoint records zero connections.
- Each refused wiring emits exactly one `renderer_error` event with `rendererName` `otel` whose error names `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`, and neither wiring call throws.
- With a wiring-context `env` lacking the marker, `wireDaemonOtel` returns a live handle, emits no refusal `renderer_error`, and the existing `project_name` and `worker_name` resource-identity assertions in `daemon-otel-wiring.test.ts` pass unchanged.
- With a wiring-context `env` lacking the marker and an endpoint on a closed loopback port, the daemon handle's `flush()` and `stop()` resolve without throwing, matching the existing export-failure handling.

**Files:** src/conductor/src/engine/otel/wire.ts; src/conductor/test/engine/otel/wire-export-refusal.test.ts

**Dependencies:** Task 5

### Task 7: Trace visualizer surfaces the refusal through its production entry
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/visualizer-export-refusal.test.ts` driving `wireOtelVisualizer` (the production entry that `index.ts` and `daemon-cli.ts` call) with an otlp config pointed at a counting loopback server and no injected exporter: under the process marker it returns `null`, exactly one `renderer_error` (`rendererName: 'otel'`) carries the refusal message, emitting `run_start`/`step_start`/`step_complete` events afterwards does not throw, and the server records zero connections. With `env` lacking the marker in the start context, a visualizer is returned.
2. Verify RED.
3. Implement: add optional `env` to `OtelVisualizerContext` in `src/conductor/src/engine/otel/otel-visualizer.ts`, pass it to `buildExporters`, and when the result is refused throw `new Error(refusal.message)` from the constructor. `createOtelVisualizer` already converts a constructor error into one `renderer_error` and `null` (see its doc comment), so no new emission path is added. Forward `startContext.env` from the built-in `visualizer:otel` factory in `src/conductor/src/engine/plugin-loader.ts` (search `createOtelVisualizer(`).
4. Verify GREEN and commit.

**Done when:**
- Under the process marker, `wireOtelVisualizer` with an otlp config returns `null`, constructs no OTLP span exporter, and a loopback receiver configured as the endpoint records zero connections after run events are emitted.
- The refused visualizer wiring emits exactly one `renderer_error` with `rendererName` `otel` naming `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`, and emitting later run events on the same emitter does not throw.
- With a start-context `env` lacking the marker, `wireOtelVisualizer` returns a started visualizer.

**Files:** src/conductor/src/engine/otel/otel-visualizer.ts; src/conductor/src/engine/plugin-loader.ts; src/conductor/test/engine/otel/visualizer-export-refusal.test.ts

**Dependencies:** Task 5

### Task 8: Daemon config-to-export path sends nothing to a planted collector
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing integration tests in `src/conductor/test/integration/otel-test-run-isolation.test.ts` against a local fake OTLP receiver (`node:http` server counting every `connection` event and every request). Drive the daemon's own startup sequence: `loadMergedConfig(fixtureRoot)` then `wireDaemonOtel` and `wireOtelVisualizer` with the fixture as main root, emit run and step events, then call `flush()` and `stop()` on whatever was returned (the periodic reader and batch processor are the downstream wrapping layers). Case 1: a planted temp `HOME` whose `.ai-conductor/config.yml` points otlp at the receiver, fixture project without `otel`, standard test setup. Case 2: `loadMergedConfig` on the live repository root (resolve it from this file's location), assert its resolved OTel is otlp-enabled, replace only the endpoint with the receiver URL, then wire and flush. Case 3: a fixture project whose own project config points otlp at the receiver.
2. Verify RED by running before Tasks 6 and 7 land (Case 3 sends requests).
3. No production change beyond Tasks 1 to 7; this task owns the cross-boundary proof from config load to the export boundary.
4. Verify GREEN and commit.

**Done when:**
- With a planted home user config pointing otlp at the fake receiver, running `loadMergedConfig` then `wireDaemonOtel` and `wireOtelVisualizer` on a fixture project, emitting run events, and calling `flush()` and `stop()` leaves the fake receiver with zero requests.
- With the live repository root's merged config, which the test asserts resolves an otlp exporter, re-pointed at the fake receiver, the daemon wiring is refused with one `renderer_error` and the receiver records zero connections and zero requests.
- With a fixture project config declaring otlp at the fake receiver, flushing and stopping the wiring after run events leaves zero requests at the receiver, so no OTLP request leaves the process through the periodic metric reader or the span batch processor.

**Files:** src/conductor/test/integration/otel-test-run-isolation.test.ts

**Dependencies:** Tasks 2, 6, 7

### Task 9: Guard: only smoke-tier tests may reference the export opt-in
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write `src/conductor/test/otel-smoke-opt-in-guard.test.ts`. It imports `vitest.smoke.config.ts`, reads `test.include`, and lists every `test/**/*.ts` file with `fs.globSync` (Node 22+) that does not match those include globs (use `path.matchesGlob`). It fails, naming each offending file, when any of them contains the opt-in variable name and is not on the guard's explicit exemption list. The exemption list is an in-file array naming exactly the two plan-sanctioned referencing files: `test/engine/otel/export-refusal.test.ts` (Task 4 — its cases reference the name only as env-object arguments to the pure `otlpExportRefusal` and `buildExporters` decision, and its Done-when asserts the function reads only its argument environment) and `test/engine/otel/transport.test.ts` (Task 5 — it supplies explicit environments to `buildExporters` and never mutates `process.env`). Neither writes the shared environment. Adding a file to the list is a visible, reviewed one-line change; every other non-smoke test file that contains the name fails the guard. Build the name by concatenation inside the guard so the guard does not flag itself. Add a second case that runs the same scanner over a temp directory with a non-smoke fixture file containing the name and asserts the scanner reports exactly that path.
2. Verify RED for the fixture case before the scanner exists.
3. Implement the scanner as a helper in the same test file. `test/setup.ts` and `src/` are outside the scanned set by construction (setup never sets the opt-in).
4. Verify GREEN and commit.

**Done when:**
- The guard derives the smoke tier from the `include` globs exported by `vitest.smoke.config.ts`, not from a hand-kept list, and passes on the current tree.
- The guard's scanner, run over a temp tree containing a non-smoke test file that references the opt-in variable, fails naming that file's path.
- The guard's exemption list is an explicit in-file array containing exactly `test/engine/otel/export-refusal.test.ts` and `test/engine/otel/transport.test.ts`; both files reference the opt-in variable without assigning it, and the scanner passes on the current tree with the list in place, as asserted by the guard's self-check case.
- No file loaded by the default, e2e, or acceptance tiers, including `test/setup.ts`, assigns the opt-in variable, as asserted by the guard passing on the current tree.

**Files:** src/conductor/test/otel-smoke-opt-in-guard.test.ts

**Dependencies:** Task 4

### Task 10: Authenticated-export loopback test drives an explicit environment
**Story:** 4
**Type:** happy-path

**Steps:**
1. After Task 5 the existing `src/conductor/test/integration/otel-authenticated-export.test.ts` is RED under the standard setup: `buildExporters` refuses because the process carries the marker. Confirm that failure.
2. Change only its `buildExporters` call to pass an explicit env without `AI_CONDUCTOR_NO_REAL_EXEC` (spread `process.env` and drop that key), and add an assertion that `process.env.AI_CONDUCTOR_NO_REAL_EXEC` is still `'1'` after the export.
3. Add a case with an explicit env that still carries the marker and asserts the loopback server receives nothing.
4. Verify GREEN and commit.

**Done when:**
- In `otel-authenticated-export.test.ts`, `buildExporters` with an explicit env lacking the marker exports a span to the test-owned loopback receiver, which receives `/v1/traces` with the configured `authorization` header.
- After that export `process.env.AI_CONDUCTOR_NO_REAL_EXEC` still equals `1`, so the test process environment is unchanged.
- With an explicit env that still carries the marker, the same test's receiver records zero requests.

**Files:** src/conductor/test/integration/otel-authenticated-export.test.ts

**Dependencies:** Task 5

## Task Dependency Graph

```text
Task 1 ──► Task 2 ──► Task 3
              │
Task 4 ──► Task 5 ──► Task 6 ──┐
   │          ├────► Task 7 ──┼──► Task 8 (also needs Task 2)
   │          └────► Task 10  │
   └──► Task 9                ┘
```

## Integration Points

- After Task 2: any fixture that loads merged config is isolated from the operator's user config.
- After Tasks 6 and 7: every OTel wiring entry point refuses network export under the marker.
- After Task 8: the full config-load to export path is proven against a fake collector.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an ordinary test run and a real home user config that declares an otlp `otel` block, when a fixture project with no `otel` block of its own loads its merged config, then the resolved OTel config is disabled. | 2 | "With a planted home user config declaring an otlp exporter, `loadMergedConfig` on a fixture project without an `otel` block resolves OTel disabled and carries the value seeded into the run-scoped `config.yml`, both with the test marker set and after the test deletes `AI_CONDUCTOR_NO_REAL_EXEC`." | diff-local |
| Story 1 happy: Given an ordinary test run, when a test reads or writes user config through the user-config commands without naming an explicit path, then the read and write use a run-scoped directory beneath the run's temp root and the real home user config is neither read nor modified. | 3 | "`userConfigSetCommand` with no explicit path writes the value into `<AI_CONDUCTOR_USER_CONFIG_DIR>/config.yml`, a path the test asserts lies beneath the run temp root, and `userConfigReadCommand` reads the same value back from that run-scoped file." | diff-local |
| Story 1 happy: Given an ordinary test run that spawns a daemon or CLI child process inheriting the test environment, when that child loads merged config, then it reads the same run-scoped user-config location and not the real home user config. | 2 | "A child process spawned with the inherited test environment runs `loadMergedConfig` on the fixture and prints a merged config carrying the run-scoped seeded value and not the planted home's differing value or its otlp exporter." | diff-local |
| Story 1 negative: Given an ordinary test run in which a test has deleted the `AI_CONDUCTOR_NO_REAL_EXEC` marker, when a fixture project loads its merged config, then the user config is still read from the run-scoped location and the real home user config is not read. | 2 | "With a planted home user config declaring an otlp exporter, `loadMergedConfig` on a fixture project without an `otel` block resolves OTel disabled and carries the value seeded into the run-scoped `config.yml`, both with the test marker set and after the test deletes `AI_CONDUCTOR_NO_REAL_EXEC`." | diff-local |
| Story 1 negative: Given the user-config location override names a directory that contains no config file, when merged config is loaded, then the user layer is treated as empty and the loader does not fall back to the real home user config. | 1 | "`readUserConfig()` with the override naming a directory that contains no config file returns an empty config with `existed: false` and does not read the planted config under the temp `HOME`." | diff-local |
| Story 1 negative: Given the user-config location override is set to an empty or whitespace-only value, when merged config is loaded, then the location resolves to the default home path exactly as when the override is unset. | 1 | "`userConfigPath()` returns `<override>/config.yml` when `AI_CONDUCTOR_USER_CONFIG_DIR` is non-empty and returns the `~/.ai-conductor/config.yml` home default when the variable is unset, empty, or whitespace-only, as asserted in `user-config.test.ts`." | diff-local |
| Story 1 negative: Given a test that needs specific user-config content, when it seeds that content, then it writes into the run-scoped location and the seeded values appear beneath the fixture's project config in merged order. | 2 | "A value seeded into the run-scoped `config.yml` appears in the fixture's merged config, and the fixture project's value wins for a key both layers declare." | diff-local |
| Story 2 happy: Given neither the user-config location override nor the test marker is set, when merged config is loaded, then the user layer is read from `~/.ai-conductor/config.yml` and merged beneath project config exactly as before. | 1 | "With neither the override nor `AI_CONDUCTOR_NO_REAL_EXEC` set, `loadMergedConfig` on a fixture project reads the user layer from the home default and the project value wins over the user value for a key both declare, exactly as before." | diff-local |
| Story 2 happy: Given a real daemon with an otlp `otel` block and configured `project_name` and `worker_name`, when it wires daemon metrics, then OTLP exporters are built and the exported resource carries the configured project and worker identities. | 6, 5 | "With a wiring-context `env` lacking the marker, `wireDaemonOtel` returns a live handle, emits no refusal `renderer_error`, and the existing `project_name` and `worker_name` resource-identity assertions in `daemon-otel-wiring.test.ts` pass unchanged." | diff-local |
| Story 2 negative: Given neither variable is set and the configured OTLP endpoint is unreachable, when the daemon exports, then behavior matches today's export-failure handling and the run is not failed. | 6 | "With a wiring-context `env` lacking the marker and an endpoint on a closed loopback port, the daemon handle's `flush()` and `stop()` resolve without throwing, matching the existing export-failure handling." | diff-local |
| Story 2 negative: Given the smoke opt-in variable is set while the test marker is not set, when OTel exporters are built, then export behaves exactly as when the opt-in is unset. | 4 | "`otlpExportRefusal` returns `null` when the marker equals `1` and the opt-in equals `1`, and returns `null` whenever the marker is absent, including when the opt-in equals `1` without it." | diff-local |
| Story 3 happy: Given the test marker is set and the smoke opt-in is not, when an otlp OTel config reaches daemon metrics wiring, interactive metrics wiring or the trace visualizer, then no OTLP network exporter is constructed and no network connection is attempted. | 6, 7, 5 | "Under the process marker, `wireDaemonOtel` and `wireInteractiveOtelMetrics` each return `null` for an otlp config, create no `MeterProvider`, the constructor-counting mocks of the four OTLP exporter classes record zero constructions, and the loopback receiver configured as the endpoint records zero connections." | diff-local |
| Story 3 happy: Given the test marker is set and an OTLP export is refused, when the wiring completes, then exactly one `renderer_error` event from the `otel` renderer is emitted per refused wiring, naming the `AI_CONDUCTOR_NO_REAL_EXEC` marker and the `AI_CONDUCTOR_OTEL_SMOKE` opt-in, and the run continues. | 6, 7 | "Each refused wiring emits exactly one `renderer_error` event with `rendererName` `otel` whose error names `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`, and neither wiring call throws." | diff-local |
| Story 3 happy: Given the test marker is set and the OTel config uses the file exporter, when telemetry is emitted, then it is written to the configured file as today. | 5 | "Under the marker, `buildExporters` with a file config returns file exporters and an exported span is appended to the configured file." | diff-local |
| Story 3 negative: Given the test marker is set and a test loads config from the live repository root whose project config declares an otlp exporter, when OTel is wired, then the export is refused and no network connection is attempted. | 8 | "With the live repository root's merged config, which the test asserts resolves an otlp exporter, re-pointed at the fake receiver, the daemon wiring is refused with one `renderer_error` and the receiver records zero connections and zero requests." | diff-local |
| Story 3 negative: Given the test marker is set and the otlp config selects the grpc protocol, when exporters are built, then the grpc export is refused the same way as http/protobuf. | 5 | "`buildExporters` with an otlp config and an env carrying the marker but no opt-in returns `{ refused: true }` with the refusal message for both the default http/protobuf protocol and `protocol: grpc`, and the constructor-counting mocks record zero OTLP exporter constructions." | diff-local |
| Story 3 negative: Given the test marker is set and a downstream layer such as batching or a durable spool wraps the exporter, when telemetry is flushed, then no OTLP request leaves the process. | 8 | "With a fixture project config declaring otlp at the fake receiver, flushing and stopping the wiring after run events leaves zero requests at the receiver, so no OTLP request leaves the process through the periodic metric reader or the span batch processor." | diff-local |
| Story 3 negative: Given a planted home user config whose otlp endpoint points at a local fake collector, when an ordinary daemon fixture runs end to end under the standard test setup, then the fake collector receives zero requests. | 8 | "With a planted home user config pointing otlp at the fake receiver, running `loadMergedConfig` then `wireDaemonOtel` and `wireOtelVisualizer` on a fixture project, emitting run events, and calling `flush()` and `stop()` leaves the fake receiver with zero requests." | diff-local |
| Story 4 happy: Given the test marker and `AI_CONDUCTOR_OTEL_SMOKE=1` are both set, when an otlp config is wired, then OTLP exporters are constructed and export proceeds as in production. | 5 | "`buildExporters` with an explicit env lacking the marker, or with the marker plus `AI_CONDUCTOR_OTEL_SMOKE=1`, constructs the HTTP or gRPC span and metric exporters as before, and with the marker plus the opt-in an exported span reaches a test-owned loopback receiver at `/v1/traces`." | diff-local |
| Story 4 happy: Given the default, e2e and acceptance Vitest tiers, when they run, then none of them sets the smoke opt-in. | 9 | "No file loaded by the default, e2e, or acceptance tiers, including `test/setup.ts`, assigns the opt-in variable, as asserted by the guard passing on the current tree." | diff-local |
| Story 4 happy: Given an ordinary test that supplies exporter construction with an explicit environment lacking the test marker and points an otlp config at a loopback receiver the test itself started, when it exports, then the receiver gets the request with the configured headers and the test process environment is left unchanged. | 10 | "In `otel-authenticated-export.test.ts`, `buildExporters` with an explicit env lacking the marker exports a span to the test-owned loopback receiver, which receives `/v1/traces` with the configured `authorization` header." | diff-local |
| Story 4 negative: Given a test file outside the smoke tier references the smoke opt-in variable, when the default test suite runs, then a guard test fails naming that file. | 9 | "The guard's scanner, run over a temp tree containing a non-smoke test file that references the opt-in variable, fails naming that file's path." | diff-local |
| Story 4 negative: Given the smoke opt-in is set to any value other than `1`, when exporters are built under the test marker, then the export is refused as if the opt-in were unset. | 4 | "`otlpExportRefusal` returns the refusal message, which names both `AI_CONDUCTOR_NO_REAL_EXEC` and `AI_CONDUCTOR_OTEL_SMOKE`, when the marker equals `1` and the opt-in is absent or any value other than `1` (`true`, `0`, empty, and ` 1 ` are asserted)." | diff-local |
| Story 4 negative: Given exporter construction is called with an explicit environment that still carries the test marker and no opt-in, when exporters are built, then the export is refused exactly as with the process environment. | 5 | "`buildExporters` called without an env argument refuses an otlp config because the test process carries the marker, and called with an explicit env carrying the marker refuses the same way." | diff-local |
| Story 4 negative: Given exporter construction is called without an explicit environment, when exporters are built, then the refusal decision reads the process environment. | 5 | "`buildExporters` called without an env argument refuses an otlp config because the test process carries the marker, and called with an explicit env carrying the marker refuses the same way." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
