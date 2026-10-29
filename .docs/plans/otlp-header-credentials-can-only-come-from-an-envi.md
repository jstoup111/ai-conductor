# Implementation Plan: OTLP header credentials from a command via a shared credential-reference resolver

**Date:** 2026-10-28
**Design:** .docs/decisions/adr-2026-10-28-shared-credential-reference-resolver.md
**Stories:** .docs/stories/otlp-header-credentials-can-only-come-from-an-envi.md
**Conflict check:** Clean as of 2026-10-28 (.docs/conflicts/2026-10-28-otlp-header-credentials-can-only-come-from-an-envi.md)

## Summary

Adds a shared credential-reference module (`engine/credentials/`) with `env` and `command` sources, a
TTL cache with single-flight refresh, and value-free failures, then moves `otel.headers` onto it for
both spooled and direct OTLP/HTTP export. 10 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/credentials/`.** `credential-reference.ts` holds the parser
  `parseCredentialReference(value)`, which returns `{ ok: true, reference }` or `{ ok: false, error }`
  and never throws or reads a value. `CredentialReference` is a discriminated union
  `{ kind: 'env', variable } | { kind: 'command', argv, prefix?, cacheSeconds? }`. `credential-resolver.ts`
  holds `createCredentialResolver(reference, deps)` with `resolve(): Promise<CredentialResult>`, where
  `CredentialResult` is `{ kind: 'value', value } | { kind: 'unavailable', reason }`. Source dispatch is an
  exhaustive `switch` on `reference.kind` with a `never` check. `command-source.ts` holds the production
  command runner.
- **Command execution.** The production runner calls `child_process.execFile(argv[0], argv.slice(1), {
  shell: false, timeout: 10_000, env })`, with `env` = `scrubTmuxEnvironment({ ...process.env })`. Before
  spawning, each argument starting with `~/` has its `~` replaced by `HOME`, and the runner calls
  `assertRealExecAllowed`-style kill-switch logic: under `AI_CONDUCTOR_NO_REAL_EXEC` it returns a failure
  without invoking `execFile`. Tests inject a fake runner; only the production-adapter test mocks
  `node:child_process`, per the repository's process-isolation rule. Failure reasons name the source
  (argv joined with spaces, or the variable name) plus exit code, timeout or empty-output cause, and
  never include stdout or stderr.
- **Cache.** The resolver takes an injected `now()` clock. A command value is kept for
  `cacheSeconds ?? 300` seconds; an in-flight refresh promise is shared by concurrent callers; an
  `unavailable` result is never cached; `env` references are re-read on every `resolve()`.
- **OTel consumer.** `resolveOtelConfig` (`engine/otel/otel-config.ts`) parses each header through the
  shared parser. Env references keep today's load-time unset/empty refusal. Command references are kept
  on the resolved config as `headerReferences` (argv, prefix, cacheSeconds; never a value) and are not
  run at load. A new `engine/otel/otel-header-provider.ts` builds one resolver per header and exposes
  `headers(): Promise<Record<string, string>>`, rejecting with a value-free `CredentialUnavailableError`
  when any header is unavailable. `createSpoolRuntime` passes it to `SpoolDrainer`, whose `headers` option
  becomes async; `buildHttpExporterOptions` passes it to the OTLP HTTP exporters as their `headers`
  factory (verified: `@opentelemetry/otlp-exporter-base` 0.221.0 awaits it on every send).
- **Failure reporting.** In `SpoolDrainer.deliver`, an unavailable credential skips the POST and is
  treated as a kept, backed-off delivery. It reports through the existing `reportFailure` with a new
  `credential` member of `ReportedFailureClass` (beside `spool`), so a prior network warning never
  suppresses it. It does not write `lastFailures`, so `otel_spool_backlog.lastFailureClass` keeps its
  existing values. The direct path's factory rejection must surface as a failed `ExportResult` with no
  unhandled rejection (architecture-review condition 1); if the SDK does not already do this, the task
  wraps the exporter's `export` to convert it.
- **Local pattern.** `readGithubBotToken` / `GithubBotToken` in `engine/github-bot-credential.ts` is the
  precedent for an at-use-time credential read: async, trimmed value, a typed `unavailable` result
  instead of a throw, no value in diagnostics. Keep those traits; the resolver adds caching,
  single-flight refresh and a source-naming reason.
- **Sequencing.** Parser and env source (Tasks 1–2), command source (3–4), cache (5), config (6), then
  the two delivery paths (7–9) and the leak sweep (10).

## Prerequisites

- None. No dependency, migration or config-table change: `otel.headers` is already a known key in
  `engine/config.ts`.

## Tasks

### Task 1: Parse credential references in a shared module
**Story:** Story 6
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/engine/credentials/credential-reference.test.ts`, importing only `engine/credentials/credential-reference.ts` (no otel import): an `{ env: 'X' }` value parses to `{ kind: 'env', variable: 'X' }`; `{ command: ['a','b'], prefix: 'Bearer ', cache_seconds: 60 }` parses to a command reference with those fields; each malformed shape (string `command`, empty list, non-string element, empty-string element, non-string `prefix`, `cache_seconds` of 0, -1, 1.5 and `'x'`, both `env` and `command`, an unknown key, a literal string) returns `{ ok: false, error }` and does not throw.
2. Verify RED.
3. Implement the `CredentialReference` union and `parseCredentialReference` with an error per shape: list-of-strings requirement for `command`, `prefix` must be a string, `cache_seconds` must be a positive integer, and a listing of the supported reference forms (`{ env: <name> }` and `{ command: [...], prefix?, cache_seconds? }`) for mixed or unknown keys and literal strings.
4. Verify GREEN and commit.

**Done when:**
- [test] `credential-reference.test.ts` asserts `parseCredentialReference` returns the typed env and command references for the two valid inputs, with `prefix` and `cacheSeconds` carried.
- [test] The same file asserts every listed malformed shape returns `{ ok: false }` with its own named error, and a wrapper asserting no exception is thrown passes for all of them.
- [test] The mixed `env`-and-`command`, unknown-key and literal-string cases each return an error listing both supported reference forms.

**Files likely touched:**
- `src/conductor/src/engine/credentials/credential-reference.ts` — new parser and reference types
- `src/conductor/test/engine/credentials/credential-reference.test.ts` — new tests

**Dependencies:** none

### Task 2: Resolve env references through the shared resolver
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/credentials/credential-resolver.test.ts` (no otel import): resolving an env reference whose variable is set returns `{ kind: 'value', value }`; unset and empty return `{ kind: 'unavailable' }` with a reason naming the variable; neither call throws.
2. Verify RED.
3. Implement `CredentialResult`, `createCredentialResolver` with an exhaustive `switch` on `reference.kind`, and the env source reading the supplied environment at each `resolve()`.
4. Verify GREEN and commit.

**Done when:**
- [test] `credential-resolver.test.ts` asserts `createCredentialResolver(...).resolve()` for a set env reference returns `{ kind: 'value' }` carrying the variable's value, with no otel module imported by the test.
- [test] The same file asserts an unset and an empty variable each resolve to `{ kind: 'unavailable' }` whose reason contains the variable name, and that `resolve()` does not reject.

**Files likely touched:**
- `src/conductor/src/engine/credentials/credential-resolver.ts` — new resolver, result type, env source
- `src/conductor/test/engine/credentials/credential-resolver.test.ts` — new tests

**Dependencies:** Task 1

### Task 3: Resolve a command reference to its trimmed, prefixed output
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests with an injected fake runner in `src/conductor/test/engine/credentials/command-source.test.ts`: a command printing `tok-123\n` with `prefix: 'Bearer '` resolves to `Bearer tok-123`; with no prefix it resolves to `tok-123`; an argument `~/<token>.plist` reaches the runner with `~` replaced by `HOME`, while `a~b` is unchanged; arguments `$(id)`, `a|b` and `x;y` reach the runner as those literal strings. In a separate production-adapter test that mocks `node:child_process`, assert the adapter reaches the mocked `execFile` with the program, the argument list, `shell: false`, `timeout: 10000`, and an `env` without `TMUX` or `TMUX_PANE`.
2. Verify RED.
3. Implement the command source in `command-source.ts`, the `~/` expansion, trailing-whitespace trimming, prefixing, and the production `execFile` runner with `scrubTmuxEnvironment`, then route the resolver's `command` case to it. Follow the `readGithubBotToken` traits (trimmed value, typed unavailable result, no value in diagnostics).
4. Verify GREEN and commit.

**Done when:**
- [test] `command-source.test.ts`, with no otel module imported, asserts `createCredentialResolver(...).resolve()` returns `Bearer tok-123` with the prefix and `tok-123` without it, from a fake runner printing `tok-123` and a newline.
- [test] The same file asserts the fake runner receives `HOME` in place of a leading `~` in `~/<token>.plist`, an unchanged `a~b`, and the literal strings `$(id)`, `a|b` and `x;y`.
- [test] The production-adapter test asserts the mocked `execFile` is called with the argument list, `shell: false`, `timeout: 10000` and an environment with no `TMUX` or `TMUX_PANE` key.

**Files likely touched:**
- `src/conductor/src/engine/credentials/command-source.ts` — new command source and production runner
- `src/conductor/src/engine/credentials/credential-resolver.ts` — route the `command` kind
- `src/conductor/test/engine/credentials/command-source.test.ts` — new tests

**Dependencies:** Task 2

### Task 4: Report command failures by name without leaking output
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `command-source.test.ts` with a fake runner: an exit code 3 resolves to unavailable naming the header-independent source (the argv) and `exit code 3`; whitespace-only output resolves to unavailable stating the output was empty; a runner reporting a timeout resolves to unavailable naming the 10-second timeout; a spawn `ENOENT` resolves to unavailable naming the argv. With stdout `SENTINEL-OUT` and stderr `SENTINEL-ERR` on a non-zero exit, assert neither appears in the reason. With `AI_CONDUCTOR_NO_REAL_EXEC=1`, assert the production runner returns unavailable naming the kill-switch and the mocked `execFile` is never called.
2. Verify RED.
3. Implement the failure mapping in the command source and the kill-switch check before `execFile`.
4. Verify GREEN and commit.

**Done when:**
- [test] `command-source.test.ts` asserts non-zero exit, whitespace-only output, timeout and `ENOENT` each resolve to `{ kind: 'unavailable' }` whose reason names the argv and, respectively, the exit code, empty output, the 10-second timeout or the missing program.
- [test] The same file asserts neither `SENTINEL-OUT` nor `SENTINEL-ERR` appears in the unavailable reason for a failing command that printed them.
- [test] The production-adapter test asserts that under `AI_CONDUCTOR_NO_REAL_EXEC=1` the result is unavailable naming `AI_CONDUCTOR_NO_REAL_EXEC` and the mocked `execFile` has zero calls.

**Files likely touched:**
- `src/conductor/src/engine/credentials/command-source.ts` — failure mapping and kill-switch
- `src/conductor/test/engine/credentials/command-source.test.ts` — failure cases

**Dependencies:** Task 3

### Task 5: Cache command values with single-flight refresh
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `credential-resolver.test.ts` with an injected clock and a counting fake runner: with no `cacheSeconds`, resolutions at t=0 and t=299 run the runner once and return the first value; at t=300 the runner runs again and the changed output `tok-2` is returned; with `cacheSeconds: 60`, t=59 reuses and t=61 re-runs; five concurrent `resolve()` calls after expiry, with a runner that settles after one second, run it once and all receive its output; a runner that fails then succeeds is run again on the next resolution inside the window; an env reference returns a changed value on the next resolution.
2. Verify RED.
3. Implement the per-resolver cache (value and expiry), the shared in-flight promise, no caching of unavailable results, and no caching for env references.
4. Verify GREEN and commit.

**Done when:**
- [test] `credential-resolver.test.ts` asserts with an injected clock that the default cache reuses the value at 299 seconds and re-runs the command at 300 seconds, returning `tok-2`.
- [test] The same file asserts a `cacheSeconds: 60` resolver reuses the value at 59 seconds and re-runs at 61 seconds.
- [test] The same file asserts five concurrent resolutions during one refresh produce exactly one runner invocation and five identical values.
- [test] The same file asserts a failed resolution is not cached, so the next resolution inside the window runs the runner again and returns its value, and that an env reference reflects a changed variable on the next resolution.

**Files likely touched:**
- `src/conductor/src/engine/credentials/credential-resolver.ts` — cache and single-flight refresh
- `src/conductor/test/engine/credentials/credential-resolver.test.ts` — cache tests

**Dependencies:** Task 3

### Task 6: Accept and validate command references in `otel.headers`
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/otel/otel-config.test.ts`: `resolveOtelConfig` with `{ command: [<cmd>], prefix: 'Bearer ', cache_seconds: 60 }` is enabled with no error and no warning and carries the argv, prefix and cache seconds in `headerReferences` and no value; each Story 2 malformed shape disables otel with an error naming the header; a literal string keeps the literal-credential refusal and also names the `command` form; a command header with `protocol: grpc` and with `exporter: file` is refused naming the header; a command header beside an unset env header disables with the existing env error and an injected runner is never called; resolving any command header never calls the runner. In `src/conductor/test/engine/config.test.ts`, assert `validateConfig` with `source: 'project'` accepts an otel block carrying a command header.
2. Verify RED.
3. Extend `OtelConfig.headers` in `types/config.ts` to the union of reference forms, route each header through `parseCredentialReference`, keep env load-time resolution, keep command references unresolved on the result, and extend the literal-credential error text.
4. Verify GREEN and commit.

**Done when:**
- [test] `otel-config.test.ts` asserts the valid command header resolves enabled with no error or warning and `headerReferences` carrying argv, prefix and `cacheSeconds: 60`, and no resolved header value for it.
- [test] The same file asserts each Story 2 malformed shape disables otel with an error naming the header and stating its requirement: `command` must be a non-empty list of strings (string, empty list, non-string element, empty-string element), the `prefix` key must be a string, `cache_seconds` must be a positive integer, and the supported reference forms `{ env: <name> }` and `{ command: [...] }` are listed (mixed `env` and `command`, unknown key, literal string).
- [test] The same file asserts a command header with `protocol: grpc` and with `exporter: file` each disables otel with the existing `unsupportedHeaderTransportError` message naming that header.
- [test] The same file asserts a command header beside an unset env header disables with the error naming the env header and its variable, and that the injected runner has zero calls after any `resolveOtelConfig` call.
- [test] The `validateConfig` test asserts a project-source config with a command header returns no error, and `config-consumer-registry.test.ts` passes with `otel.headers` still declared to `otel-config.ts`.

**Files likely touched:**
- `src/conductor/src/engine/otel/otel-config.ts` — parse headers through the shared parser
- `src/conductor/src/types/config.ts` — header reference union
- `src/conductor/test/engine/otel/otel-config.test.ts` — config cases
- `src/conductor/test/engine/config.test.ts` — project-source acceptance

**Dependencies:** Task 1

### Task 7: Send resolved headers on every spooled delivery
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests: in `src/conductor/test/engine/otel/spool-drainer.test.ts`, a spool runtime built by `createSpoolRuntime` from a resolved config whose `authorization` header is a command reference (fake runner printing `tok-123`, prefix `Bearer `) delivers a spooled batch to a loopback HTTP test double whose received request carries `authorization: Bearer tok-123`; with an `env` header, changing the variable between two deliveries makes the second POST carry the new value.
2. Verify RED.
3. Implement `engine/otel/otel-header-provider.ts` (one resolver per header, async `headers()`, rejecting with a value-free `CredentialUnavailableError` naming the header and source), make `SpoolDrainer`'s `headers` option async and await it in `deliver`, and pass the provider from `createSpoolRuntime`.
4. Verify GREEN and commit.

**Done when:**
- [test] `spool-wiring.test.ts` asserts a batch delivered by the drainer from `createSpoolRuntime` reaches the loopback test double with `authorization: Bearer tok-123` from the fake command runner.
- [test] The same file asserts that after the referenced environment variable changes, the next POST from that runtime's drainer carries the new value.

**Files likely touched:**
- `src/conductor/src/engine/otel/otel-header-provider.ts` — new async header provider
- `src/conductor/src/engine/otel/spool-wiring.ts` — pass the provider to the drainer
- `src/conductor/src/engine/otel/spool-drainer.ts` — async `headers` option
- `src/conductor/test/engine/otel/spool-drainer.test.ts` — delivery cases

**Dependencies:** Tasks 5, 6

### Task 8: Hold spooled batches and report credential failures once
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `spool-drainer.test.ts` with a fake runner that fails: no POST reaches the test double, the batch file remains in the spool, and one `renderer_error` with `rendererName: 'otel'` names the header and the command; across ten delivery attempts exactly one credential `renderer_error` is emitted and the delays follow the drainer's existing backoff sequence; after a network-class `renderer_error` for a signal, a credential failure emits one new `renderer_error` naming header and command, and the next `otel_spool_backlog` `lastFailureClass` is still `network`; when the runner recovers, the retained batch is delivered with the new value and the delivery-recovered `renderer_error` is emitted once. In `src/conductor/test/engine/otel/otel-header-provider.test.ts`, with fake runners for a non-zero exit, whitespace-only output, a timeout and the kill-switch, assert `headers()` rejects with `CredentialUnavailableError` whose message names the header, the argv and that cause.
2. Verify RED.
3. In `SpoolDrainer.deliver`, catch `CredentialUnavailableError` before sending, return a kept/backed-off outcome without writing `lastFailures`, and report it through `reportFailure` with a new `credential` member of `ReportedFailureClass`.
4. Verify GREEN and commit.

**Done when:**
- [test] `spool-drainer.test.ts` asserts a credential failure sends zero POSTs, leaves the batch file in the spool directory, and emits one `renderer_error` with `rendererName: 'otel'` whose text names the header and the command.
- [test] The same file asserts ten failing attempts emit exactly one credential `renderer_error` and follow the existing backoff delays.
- [test] The same file asserts a credential failure after a network-class warning emits one new `renderer_error` whose text names the header and the command, and the next `otel_spool_backlog` event's `lastFailureClass` is still `network`.
- [test] The same file asserts recovery delivers the retained batch with the recovered value and emits the delivery-recovered `renderer_error` exactly once.
- [test] `otel-header-provider.test.ts` asserts `headers()` rejects with `CredentialUnavailableError` whose message names the header and the argv plus, respectively, the exit code, empty output, the 10-second timeout or `AI_CONDUCTOR_NO_REAL_EXEC`.

**Files likely touched:**
- `src/conductor/src/engine/otel/spool-drainer.ts` — credential failure handling and reporting class
- `src/conductor/test/engine/otel/spool-drainer.test.ts` — failure cases
- `src/conductor/test/engine/otel/otel-header-provider.test.ts` — header-named failure reasons

**Dependencies:** Task 7

### Task 9: Resolve headers per export on the direct OTLP/HTTP path
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/integration/otel-authenticated-export.test.ts`: exporters built by `buildExporters` from a resolved config with a command header (fake runner printing `tok-123`, prefix `Bearer `, spooling off) export a span to the loopback receiver with `authorization: Bearer tok-123`; with a failing runner and with a runner reporting `ENOENT`, the span exporter's result code is FAILED, the receiver records zero requests, and an `unhandledRejection` listener records nothing. Using the credential runner and clock seams on `ExporterBuildOptions`, also cover: no-prefix header value; two exports 299 seconds apart reusing one runner call; an export at 300 seconds carrying a changed `tok-2`; five concurrent exports after expiry sharing one runner call; a fail-once runner whose first export fails and whose next export inside the window succeeds. Keep the existing env-only `sends resolved headers to the traces endpoint` case unchanged and add an assertion that `resolveOtelConfig` returns the same enabled result and `headers` map for its config.
2. Verify RED.
3. Add optional credential runner and clock seams to `ExporterBuildOptions` (production defaults: the `execFile` runner and `Date.now`), pass the header provider from `buildHttpExporterOptions` as the exporters' `headers` factory; if the SDK does not already convert a factory rejection into a failed `ExportResult`, wrap the span and metric exporters' `export` to do so.
4. Verify GREEN and commit.

**Done when:**
- [test] `otel-authenticated-export.test.ts` asserts a span exported through `buildExporters` with spooling off reaches the loopback receiver with `authorization: Bearer tok-123` from the fake runner, and a header configured with no `prefix` arrives as `tok-123`.
- [test] The same file asserts that for a failing runner and for a missing program the export result code is FAILED, the receiver has zero requests, and no `unhandledRejection` is recorded.
- [test] The existing `sends resolved headers to the traces endpoint` case passes unchanged, and for its env-only header config `resolveOtelConfig` returns the same enabled result and `headers` map as before this change.
- [test] With an injected clock and counting runner, two exports 299 seconds apart send two requests both carrying the first value from one runner invocation, and an export 300 seconds after the first resolution sends a request carrying `tok-2`.
- [test] Five concurrent span exports after cache expiry, with a runner settling after one second, produce one runner invocation and five received requests each carrying its output; with a runner that fails once then succeeds, the first export result is FAILED and the next export inside the cache window sends a request carrying the output.

**Files likely touched:**
- `src/conductor/src/engine/otel/transport.ts` — async headers factory on the direct exporters
- `src/conductor/test/integration/otel-authenticated-export.test.ts` — direct-path cases

**Dependencies:** Task 7

### Task 10: Keep credential values out of spool files, events and config errors
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests: in `spool-drainer.test.ts`, after a successful spooled export with a fake runner printing `SENTINEL-VALUE`, no file under the spool directory and no captured event contains `SENTINEL-VALUE`; with a runner that prints `SENTINEL-OUT` on stdout and `SENTINEL-ERR` on stderr then exits non-zero, neither sentinel appears in the emitted `renderer_error`. In `otel-config.test.ts`, every Story 2 error string produced while an injected fake runner is configured to print `SENTINEL-VALUE` excludes it.
2. Verify RED.
3. Fix any path that leaks (the expected outcome is that Tasks 4, 6 and 8 already prevent it; this task adds the sweep and repairs any gap it finds).
4. Verify GREEN and commit.

**Done when:**
- [test] `spool-wiring.test.ts` asserts `SENTINEL-VALUE` appears in no spool-directory file and no captured event after a successful spooled export.
- [test] The same file asserts neither `SENTINEL-OUT` nor `SENTINEL-ERR` appears in the credential `renderer_error`.
- [test] `otel-config.test.ts` asserts no Story 2 error string contains `SENTINEL-VALUE` while a command reference is configured to contain it.

**Files likely touched:**
- `src/conductor/test/engine/otel/spool-drainer.test.ts` — spool and event sweep
- `src/conductor/test/engine/otel/otel-config.test.ts` — config error sweep

**Dependencies:** Tasks 8, 6

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ── Task 3 ─┬─ Task 4
        │                    └─ Task 5 ─┐
        └─ Task 6 ──────────────────────┴─ Task 7 ─┬─ Task 8 ── Task 10
                                                   └─ Task 9
```

## Integration Points

- After Task 7: a spooled delivery carries a command-sourced header end to end through `createSpoolRuntime`.
- After Task 9: a direct export carries it through `buildExporters`, the construction point `wireOtelVisualizer` uses.

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-10-28-shared-credential-reference-resolver#D1 | task | task-1, task-2 | asserts `createCredentialResolver(...).resolve()` for a set env reference returns `{ kind: 'value' }` carrying the variable's value, with no otel module imported by the test |
| adr-2026-10-28-shared-credential-reference-resolver#D2 | task | task-3, task-4 | asserts the mocked `execFile` is called with the argument list, `shell: false`, `timeout: 10000` and an environment with no `TMUX` or `TMUX_PANE` key |
| adr-2026-10-28-shared-credential-reference-resolver#D3 | task | task-5 | asserts five concurrent resolutions during one refresh produce exactly one runner invocation and five identical values |
| adr-2026-10-28-shared-credential-reference-resolver#D4 | task | task-6, task-7, task-9 | asserts a batch delivered by the drainer from `createSpoolRuntime` reaches the loopback test double with `authorization: Bearer tok-123` from the fake command runner |
| adr-2026-10-28-shared-credential-reference-resolver#D5 | task | task-8, task-9 | asserts a credential failure sends zero POSTs, leaves the batch file in the spool directory, and emits one `renderer_error` with `rendererName: 'otel'` whose text names the header and the command |
| adr-2026-10-28-shared-credential-reference-resolver#D6 | task | task-6 | The `validateConfig` test asserts a project-source config with a command header returns no error |
| adr-2026-10-28-shared-credential-reference-resolver#D7 | no-change | none | Decision 7 records that `github_bot.token_file`, the daemon build OAuth token and `tracker.credentials` are not migrated; no task touches `engine/github-bot-credential.ts`, `engine/self-host/sandbox-build-env.ts` or the tracker config. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
- [ ] Tasks do not invalidate each other's fixtures or assertions

### Task rem-as-built-R1: Trim only trailing whitespace from command output in src/conductor/src/engine/credentials/command-source.ts (trimEnd), with a RED test in src/conductor/test/engine/credentials/command-source.test.ts asserting leading whitespace is preserved
**Gate:** as-built
**Rationale:** Verified (99%): command-source.ts:85 uses `stdout.trim()`, which strips leading whitespace too. ADR D2 and plan Task 3 Step 3 both say 'trailing-whitespace trimming'. The approved architecture is clear and the code does not conform, so this is BUILD work admitted by Task 3. Use `trimEnd()` before the empty check and prefixing. Add a RED test where the fake runner prints `  tok-123\n` and the resolved value keeps the leading spaces. Existing Task 3 assertions (`Bearer tok-123` and `tok-123` from `tok-123\n`) still hold, and Task 8's whitespace-only-output unavailable case still holds because `trimEnd()` of whitespace-only output is ''.
**Governing clause:** adr-2026-10-28-shared-credential-reference-resolver decision 2
**Done when:**
- adr-2026-10-28-shared-credential-reference-resolver decision 2 is satisfied by this task.
- The repair for task rem-as-built-R1 is committed and its targeted tests pass.

### Task rem-as-built-R2: Build resolved headers in src/conductor/src/engine/otel/otel-header-provider.ts so every configured key, including __proto__, is an own property, with a RED test in src/conductor/test/engine/otel/otel-header-provider.test.ts
**Gate:** as-built
**Rationale:** Verified (99%): otel-header-provider.ts:30 builds `headers` as a `{}` literal and :34 assigns `headers[header] = result.value`. For a `__proto__` header name this calls the inherited Object.prototype setter, so the header never becomes an own property and is dropped from both the spool and direct requests. ADR D5 requires every configured header to be sent. This is a conforming implementation defect in the provider that plan Task 7 created (Task 9 reuses it on the direct path), so it is BUILD work admitted by Task 7. Build the record so arbitrary keys stay own properties, e.g. Object.fromEntries over the resolved pairs, or Object.defineProperty on the result. Add a RED test in otel-header-provider.test.ts asserting a `__proto__` header resolves as an own key with its value. Out of scope and left unchanged: the `{ ...fallback }` path, since spread copies own properties correctly. Sibling resolver map at :25 already uses Object.fromEntries.
**Governing clause:** adr-2026-10-28-shared-credential-reference-resolver decision 5
**Done when:**
- adr-2026-10-28-shared-credential-reference-resolver decision 5 is satisfied by this task.
- The repair for task rem-as-built-R2 is committed and its targeted tests pass.
