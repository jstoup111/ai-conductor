# Implementation Plan: Pi runs stay contained despite Pi having no permission model

**Date:** 2026-09-29
**Design:** .docs/decisions/architecture-review-2026-09-29-pi-runs-stay-contained-despite-pi-having-no-permis.md
**Stories:** .docs/stories/pi-runs-stay-contained-despite-pi-having-no-permis.md
**Conflict check:** Clean as of 2026-09-29

## Summary

Pi declares `readOnlyReview` and `nativeSchema` through a harness-owned Pi extension that adds a shell-free `git_read` tool and a terminating `submit_result` tool. Every unattended Pi dispatch ignores project-local `.pi/` files unless `llm_providers.pi.trust_project_files` opts in, and runs with the codex daemon env treatment. OS write-containment is out of scope (#2851). 15 tasks.

## Technical Approach

- **One engine-owned extension (catalog D15).** `execution/pi-harness-extension.ts` exports `PI_HARNESS_EXTENSION_SOURCE`, an import-free TypeScript string constant bundled by tsup, and `materializePiHarnessExtension`, which writes it content-addressed to `~/.ai-conductor/pi/harness-extension-«sha256 prefix».ts` atomically and re-verifies bytes before every use. The engine has no non-TS asset copy step (`scripts/publish-engine.mjs`), which is why the source is a constant. The extension registers tools only when its own flags are present: `git_read` behind a boolean flag, `submit_result` behind an output-schema file flag. Pi loads it only via explicit `-e`, which still works under `--no-extensions`.
- **nativeSchema (catalog D16).** The adapter writes the requested schema into the engine-owned `nativeSchemaScratchHome` (codex precedent: `writeNativeSchema`, `writeScratchSchema`), passes `-e` plus the schema flag, and takes `finalStructuredResult` from the last successful `submit_result` `tool_execution_end` in the `--mode json` stream. Pi validates tool arguments against a raw JSON schema (`pi-ai/dist/utils/validation.js`), so schema mismatches self-correct within one invocation; the engine re-validates as today. No successful call means a failed invocation.
- **readOnlyReview (catalog D17).** The read-only branch adds `--no-extensions -na --tools read,grep,find,ls,git_read[,submit_result] -e «asset»` plus the git-read flag. `git_read` runs `git` through `execFile` with `shell: false`, a closed subcommand enum mirroring Claude's allowlist (`claude-provider.ts` `READ_ONLY_REVIEW_ALLOWED_TOOLS`), an option denylist (output-file, pager, external diff, textconv, config injection), and a neutralized pager env. The pi probe mirrors `probeClaude`: `pi --help` must list `--tools`, `--no-extensions`, `--extension`, `--no-approve`, and the asset must materialize. Custom-policy laps still need `reviewPolicyCatalog` (#1888).
- **Unattended hardening (catalog D18).** A new additive `InvokeOptions.trustProjectFiles`, set by provider-execution from `llm_providers.<dispatched provider>.trust_project_files`, is honored only by the Pi adapter; config validation admits the key only for descriptors declaring `projectFileTrust`. The Pi env mirrors codex `invocationEnv`: `scrubTmuxEnvironment(withDaemonSessionMarker(...))`, marker last.
- **No pi id literals outside the catalog.** Probe selection and trust-key admission read descriptor fields, preserving catalog D1.
- **Sequencing.** Catalog (1) and the extension module (2) first; extension tools (3 to 5) next; the adapter changes (6, 7, 9, 13, 14) are chained because they share `pi-provider.ts`; integration guards (8, 10), probe (11), config (12) and audit (15) run in parallel where dependencies allow.

## Prerequisites

- #1885 (Pi per-step model selection) is built and merged first: it introduces the `llm_providers` block and Pi model argv that Tasks 12 and 13 extend (architecture review condition C1; GitHub `blocked_by` edge recorded on #1886).
- No migration: `llm_providers.pi.trust_project_files` is an additive `.ai-conductor/config.yml` key, not a settings.json schema surface.

## Tasks

### Task 1: Pi catalog descriptor declares readOnlyReview and nativeSchema
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test in `src/conductor/test/execution/provider-catalog.test.ts`: `supportsProviderCapability(pi descriptor, capability)` returns true for `readOnlyReview` and `nativeSchema`, and false for `selfHost`, `reviewPolicyCatalog`, `writeFence`, `costSelfReporting`, `readiness`, and `interactiveLaunch`; the pi descriptor `osSandbox` stays `false`; claude and codex flags are unchanged. Replace any existing assertion that pi lacks `readOnlyReview` or `nativeSchema`.
2. Verify RED.
3. Implement: set `readOnlyReview: true` and `nativeSchema: true` in the pi entry of `BUILT_IN_PROVIDERS` in `src/conductor/src/execution/provider-catalog.ts`. Leave `PROVIDER_CAPABILITY_OWNERS` untouched. No provider id literal is added outside the catalog.
4. Verify GREEN and commit.

**Done when:**
- `supportsProviderCapability` on the pi catalog descriptor returns true for `readOnlyReview` and `nativeSchema`, as asserted in provider-catalog.test.ts.
- For the pi descriptor `supportsProviderCapability` still returns false for `selfHost`, `reviewPolicyCatalog`, `writeFence`, `costSelfReporting`, `readiness` and `interactiveLaunch`, and `osSandbox` stays `false`, as asserted in provider-catalog.test.ts.
- The claude and codex descriptors declare exactly the capability flags they declared before this change, as asserted by the existing provider-catalog tests without edits to their expected values.

**Files:** `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/execution/provider-catalog.test.ts`

**Dependencies:** none

### Task 2: Harness Pi extension source and content-addressed materialization
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-harness-extension.test.ts` for `materializePiHarnessExtension({ homeDir })` in `src/conductor/src/execution/pi-harness-extension.ts`: with a temp `homeDir` it writes `«homeDir»/.ai-conductor/pi/harness-extension-«first 16 hex of sha256(source)».ts` whose bytes equal the exported `PI_HARNESS_EXTENSION_SOURCE`, and returns that absolute path; a second call with the file already correct does not rewrite it (mtime unchanged); a call after the file was tampered with rewrites it to the constant; the write goes to a temp sibling then `rename`; nothing is created under `«homeDir»/.pi` or under any `.pi/` directory of the cwd; a non-writable target directory throws an error naming the asset path.
2. Add a test that the source text contains no `import` or `require` statement, and exports a default factory.
3. Verify RED.
4. Implement the module: `PI_HARNESS_EXTENSION_SOURCE` is a TypeScript string constant containing the extension (default-exported factory; tools added by later tasks), and `materializePiHarnessExtension` resolves `homeDir` from an injected option defaulting to `os.homedir()` (the `~/.ai-conductor/rate-card.json` precedent in `src/conductor/src/execution/rate-card.ts`). Search hints: `writeScratchSchema`, `RATE_CARD_RELATIVE_PATH`.
5. Verify GREEN and commit.

**Done when:**
- `materializePiHarnessExtension` writes `harness-extension-«sha256 prefix».ts` under `«homeDir»/.ai-conductor/pi/` with bytes equal to `PI_HARNESS_EXTENSION_SOURCE`, via a temp file then rename, and returns its absolute path, as asserted in pi-harness-extension.test.ts.
- A tampered asset file is rewritten to the constant on the next `materializePiHarnessExtension` call, and an already-correct file is not rewritten, as asserted in pi-harness-extension.test.ts.
- After materialization no file is created or changed under `«homeDir»/.pi` or under any `.pi/` directory of the cwd, so an interactive `pi` session loads no harness extension or harness tool, as asserted by a directory snapshot in pi-harness-extension.test.ts.
- When the target directory is not writable `materializePiHarnessExtension` throws an error naming the asset path, as asserted in pi-harness-extension.test.ts.
- `PI_HARNESS_EXTENSION_SOURCE` contains no `import` or `require` statement, as asserted in pi-harness-extension.test.ts.

**Files:** `src/conductor/src/execution/pi-harness-extension.ts`, `src/conductor/test/execution/pi-harness-extension.test.ts`

**Dependencies:** none

### Task 3: git_read tool registration and shell-free execution
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-harness-extension-git-read.test.ts`: evaluate `PI_HARNESS_EXTENSION_SOURCE` as a module (write it to a temp `.ts` file and import it through the test runner) and call its default export with a fake `ExtensionAPI` recording `registerFlag`/`registerTool`/`getFlag`, and with an injected process boundary. With the git-read flag set, exactly one tool named `git_read` is registered; its `subcommand` parameter is an enum of exactly `show`, `diff`, `log`, `ls-tree`, `ls-files`, `cat-file`, `rev-parse`, `blame`, `grep`; its `args` parameter is an array of strings. Executing `{subcommand: "diff", args: ["HEAD~1", "--", "src/a.ts"]}` spawns the real-git executable through the mocked boundary with argv `["diff", "HEAD~1", "--", "src/a.ts"]` byte-for-byte, `shell: false`, cwd the session cwd, env with `GIT_PAGER=cat`, `PAGER=cat`, and `GIT_EXTERNAL_DIFF` removed, and returns the child stdout as the tool text.
2. Verify RED.
3. Implement inside `PI_HARNESS_EXTENSION_SOURCE`: register the boolean git-read flag with `pi.registerFlag`; when set, `pi.registerTool` for `git_read` with a raw JSON schema (no typebox import); execute with Node `child_process.execFile` (a Node built-in, allowed by Pi) and `shell: false`. Test process isolation per CLAUDE.md: the mocked boundary must be reached before any argv is exercised.
4. Verify GREEN and commit.

**Done when:**
- With the git-read flag set the extension factory registers exactly one tool named `git_read` whose subcommand parameter is an enum of exactly `show`, `diff`, `log`, `ls-tree`, `ls-files`, `cat-file`, `rev-parse`, `blame` and `grep`, as asserted against a fake `ExtensionAPI` in pi-harness-extension-git-read.test.ts.
- Executing `git_read` with subcommand `diff` and args `["HEAD~1", "--", "src/a.ts"]` reaches the mocked process boundary with argv `diff HEAD~1 -- src/a.ts` byte-for-byte and `shell: false`, and the tool returns the child stdout, as asserted in pi-harness-extension-git-read.test.ts.
- Every `git_read` spawn passes an env with `GIT_PAGER` and `PAGER` set to `cat` and no `GIT_EXTERNAL_DIFF` variable, as asserted in pi-harness-extension-git-read.test.ts.

**Files:** `src/conductor/src/execution/pi-harness-extension.ts`, `src/conductor/test/execution/pi-harness-extension-git-read.test.ts`

**Dependencies:** 2

### Task 4: git_read refuses mutating subcommands, options, and failed git
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests in the same file for each refusal, asserting an error tool result naming the refused subcommand or option and that the mocked process boundary is never reached: subcommand `commit`; arg `--output=/tmp/x`; args `-O` and `--open-files-in-pager=vi`; args `--ext-diff` and `--textconv`; args `-c` then `core.pager=sh`, and `--config-env=core.pager=X`. Add: a single arg `HEAD; rm -rf .` reaches the boundary as one literal argv element with `shell: false` and a sentinel file in the cwd still exists afterwards; git exiting 1 with stderr `fatal: bad revision` yields a tool result marked as an error carrying that stderr.
2. Verify RED.
3. Implement the refusal checks inside the extension before spawning: reject a subcommand outside the enum; reject any arg equal to or prefixed by `--output`, `-O`, `--open-files-in-pager`, `--ext-diff`, `--textconv`, `-c`, `--config-env`; map a non-zero exit to an error result with stderr.
4. Verify GREEN and commit.

**Done when:**
- A `git_read` call with subcommand `commit` returns an error result naming the subcommand as not allowed and never reaches the mocked process boundary, as asserted in pi-harness-extension-git-read.test.ts.
- A `git_read` call with any of `--output=/tmp/x`, `-O`, `--open-files-in-pager=vi`, `--ext-diff`, `--textconv`, `-c core.pager=sh` or `--config-env=core.pager=X` returns an error result naming that refused option and never reaches the mocked process boundary, as asserted per option in pi-harness-extension-git-read.test.ts.
- A `git_read` call with the single arg `HEAD; rm -rf .` reaches the boundary as one literal argv element with `shell: false`, no shell interprets it, and a sentinel file in the cwd is not removed, as asserted in pi-harness-extension-git-read.test.ts.
- When the mocked git exits non-zero for an allowed call, the `git_read` result is marked as an error and carries git stderr, as asserted in pi-harness-extension-git-read.test.ts.

**Files:** `src/conductor/src/execution/pi-harness-extension.ts`, `src/conductor/test/execution/pi-harness-extension-git-read.test.ts`

**Dependencies:** 3

### Task 5: submit_result tool registration from an output-schema flag
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-harness-extension-submit-result.test.ts` using the same fake `ExtensionAPI` harness as Task 3: with the output-schema flag naming a temp file containing `{"type":"object","required":["verdict"],"properties":{"verdict":{"type":"string"}}}`, a tool named `submit_result` is registered whose `parameters` deep-equal that schema, and whose `execute` called with `{"verdict":"pass"}` returns `details` equal to that object and `terminate: true`. With no harness flag at all, the factory registers no tool.
2. Verify RED.
3. Implement inside `PI_HARNESS_EXTENSION_SOURCE`: register the string output-schema flag; when set, read and `JSON.parse` the file with `node:fs` and register `submit_result` with those raw `parameters`, a description telling the model to call it as its final action, and an `execute` returning the args as `details` with `terminate: true` (Pi `examples/extensions/structured-output.ts` pattern).
4. Verify GREEN and commit.

**Done when:**
- With the output-schema flag naming a schema file the extension factory registers a tool named `submit_result` whose `parameters` equal the parsed file JSON schema, as asserted against a fake `ExtensionAPI` in pi-harness-extension-submit-result.test.ts.
- `submit_result` `execute` called with `{"verdict":"pass"}` returns `details` equal to that object and `terminate: true`, as asserted in pi-harness-extension-submit-result.test.ts.
- Loaded with no harness flag, the extension factory calls `registerTool` zero times, as asserted in pi-harness-extension-submit-result.test.ts.

**Files:** `src/conductor/src/execution/pi-harness-extension.ts`, `src/conductor/test/execution/pi-harness-extension-submit-result.test.ts`

**Dependencies:** 3

### Task 6: Pi adapter passes a native output schema to the harness extension
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` with the fake subprocess factory and an injected materializer: an invocation carrying `nativeSchema` and `nativeSchemaScratchHome` writes the schema JSON to a file inside that scratch home and spawns an argv containing `-e «materialized asset path»` and the output-schema flag followed by that file path; an invocation without `nativeSchema` passes no output-schema flag and its `--tools` value (when present) never names `submit_result`; when writing the schema file fails, `invoke` returns a failed result naming the schema path and the fake subprocess factory is never called; the adapter reports `nativeSchemaCapability.nativeOutputSchema === true`.
2. Verify RED.
3. Implement in `src/conductor/src/execution/pi-provider.ts`: `readonly nativeSchemaCapability = { nativeOutputSchema: true }`; a `writeNativeSchema` that requires `nativeSchemaScratchHome` (codex precedent: `writeNativeSchema`, `writeScratchSchema`, `nativeSchemaScratchRoot`); inject `materializePiHarnessExtension` through the constructor with the real default. Keep engine-owned file semantics: the engine owns the file and a missing structured result fails the invocation.
4. Verify GREEN and commit.

**Done when:**
- For an invocation carrying `nativeSchema`, the Pi adapter writes the schema to a file inside `nativeSchemaScratchHome` and the spawned argv contains `-e` followed by the materialized asset path and the output-schema flag followed by that schema file path, as asserted in pi-provider.test.ts.
- For an invocation without `nativeSchema`, the spawned argv carries no output-schema flag and no `--tools` value naming `submit_result`, as asserted in pi-provider.test.ts.
- When the schema file cannot be written, `invoke` returns a failed result whose output names the schema path and the fake subprocess factory is never called, as asserted in pi-provider.test.ts.
- The Pi adapter exposes `nativeSchemaCapability.nativeOutputSchema` equal to true, as asserted in pi-provider.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 1, 2, 5

### Task 7: Pi adapter takes finalStructuredResult from the last successful submit_result
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` with JSONL stream fixtures shaped per Pi `docs/json.md` (`tool_execution_start`/`tool_execution_end` with `toolName`, `result`, `isError`): last successful `submit_result` end with details `{"verdict":"pass"}` gives `success: true` and `finalStructuredResult` deep-equal to it; two successful ends give the last one details; a schema-carrying stream with no `submit_result` end gives a failed result whose output names the missing structured result and no `finalStructuredResult`; a stream whose only `submit_result` end has `isError: true` fails the same way.
2. Verify RED.
3. Implement in the Pi JSONL parser: track `tool_execution_end` events whose `toolName` is `submit_result` and `isError` is false; when the invocation carried `nativeSchema`, set `finalStructuredResult` from the last one's `result.details`, else fail naming the missing structured result.
4. Verify GREEN and commit.

**Done when:**
- For a stream whose last successful `submit_result` `tool_execution_end` has details `{"verdict":"pass"}`, the Pi adapter returns `success: true` with `finalStructuredResult` equal to that object, as asserted in pi-provider.test.ts.
- For a stream with two successful `submit_result` ends, `finalStructuredResult` equals the details of the last one, as asserted in pi-provider.test.ts.
- A schema-carrying stream with no `submit_result` `tool_execution_end` returns a failed invocation whose output names the missing structured result and carries no `finalStructuredResult`, as asserted in pi-provider.test.ts.
- A schema-carrying stream whose only `submit_result` end has `isError: true` returns a failed invocation naming the missing structured result, as asserted in pi-provider.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 6

### Task 8: As-built architecture review admits a pi-only candidate set
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/as-built-pi-native-schema.test.ts`: build a provider runtime whose configured candidate set is only `pi` (fake Pi subprocess emitting a successful `submit_result` end with a schema-valid as-built verdict) and run the `architecture_review_as_built` step runner; assert `providerRuntimes.nativeSchemaCapabilityFor("pi").nativeOutputSchema` is true, the step does not settle with the "cannot enforce its native output schema" reason, and the fake Pi subprocess was invoked once with the output-schema flag.
2. Verify RED (before Tasks 1 and 6 the candidate set is refused).
3. Implement: no production change is expected beyond Tasks 1, 6 and 7; if the runtime does not surface the adapter capability for pi, wire it in the provider runtime where `nativeSchemaCapabilityFor` reads adapters.
4. Verify GREEN and commit.

**Done when:**
- `nativeSchemaCapabilityFor("pi")` on the provider runtime returns `nativeOutputSchema` true, as asserted in as-built-pi-native-schema.test.ts.
- With a candidate set of only `pi`, the `architecture_review_as_built` step runner does not refuse with the native output schema reason and invokes the fake Pi subprocess once with the output-schema flag, as asserted in as-built-pi-native-schema.test.ts.

**Files:** `src/conductor/src/engine/provider-runtime.ts`, `src/conductor/test/engine/as-built-pi-native-schema.test.ts`

**Dependencies:** 7

### Task 9: Pi adapter read-only review argv
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`: with `readOnlyReview: true` and no `nativeSchema`, the spawned argv contains `--no-extensions`, `-na`, `--tools` with value exactly `read,grep,find,ls,git_read`, `-e` followed by the absolute materialized asset path, and the git-read flag; with `readOnlyReview: true` and a `nativeSchema`, the `--tools` value is exactly `read,grep,find,ls,git_read,submit_result`; in both, the `--tools` value never names `bash`, `edit`, `write` or `powershell`; with a worktree cwd containing `.pi/extensions/evil.ts`, the argv has both `-na` and `--no-extensions` and exactly one `-e`, naming the harness asset; with `trustProjectFiles: true` a read-only review argv still contains `-na`.
2. Verify RED.
3. Implement in `pi-provider.ts` a read-only review argv branch that ignores `trustProjectFiles` and `dangerouslySkipPermissions`.
4. Verify GREEN and commit.

**Done when:**
- With `readOnlyReview: true` and no native schema the spawned argv contains `--no-extensions`, `-na`, `--tools` with value exactly `read,grep,find,ls,git_read`, and `-e` followed by the absolute harness asset path, as asserted in pi-provider.test.ts.
- With `readOnlyReview: true` and a native schema the `--tools` value is exactly `read,grep,find,ls,git_read,submit_result`, as asserted in pi-provider.test.ts.
- No read-only review `--tools` value names `bash`, `edit`, `write` or `powershell`, as asserted in pi-provider.test.ts.
- For a read-only review in a cwd whose `.pi/extensions/` holds an extension, the argv carries both `-na` and `--no-extensions` and exactly one `-e`, naming the harness asset, as asserted in pi-provider.test.ts.
- With `trustProjectFiles: true`, a read-only review argv still contains `-na`, as asserted in pi-provider.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 3, 7

### Task 10: Custom-policy lap with a pi candidate still refuses on reviewPolicyCatalog
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing-or-guard test in `src/conductor/test/engine/build-review-pi-custom-member.test.ts`: a custom-policy build_review member whose only candidate is `pi`, with the read-only capability observation for pi `available`, prepared through the step runner's `preparedCandidateOperation`; assert the member settles through `unavailableReviewCapabilityResult` naming `reviewPolicyCatalog`, and the fake Pi subprocess factory is never called.
2. Verify the test fails if `readOnlyReview` admission were the only check (temporarily assert against pre-Task-1 catalog in a scratch run), then passes on the Task 1 catalog.
3. Implement: no production change expected; the existing capability ordering already refuses. Keep this task to the guard test.
4. Verify GREEN and commit.

**Done when:**
- A custom-policy build_review member whose only candidate is pi, with pi read-only capability `available`, settles through `unavailableReviewCapabilityResult` naming `reviewPolicyCatalog`, as asserted in build-review-pi-custom-member.test.ts.
- In that custom-policy lap the fake Pi subprocess factory is never called, as asserted in build-review-pi-custom-member.test.ts.

**Files:** `src/conductor/test/engine/build-review-pi-custom-member.test.ts`

**Dependencies:** 1

### Task 11: Read-only review availability probe for pi
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/build-review-read-only-capability.test.ts` with a fake `ReadOnlyReviewCapabilityProcess` and an injected materializer: `pi --help` exit 0 listing `--tools`, `--no-extensions`, `--extension`, `--no-approve` with a materializer returning a readable path gives `available` with the platform; help lacking `--no-approve` gives `unavailable` naming `--no-approve`; runner throwing ENOENT gives `unavailable` naming the unavailable executable and does not throw; help exit 2 with stderr `boom` gives `unavailable` whose reason carries `2` and `boom`; a materializer throwing gives `unavailable` naming the asset path. Assert the runner receives only `["--help"]` in every case and no provider adapter is constructed.
2. Verify RED.
3. Implement `probePi` in `src/conductor/src/engine/build-review-read-only-capability.ts`, mirroring `probeClaude` (`--help` flag check, `processFailureReason`, `exitedReason`), and route the pi descriptor to it without adding a `pi` id literal outside the catalog: select the probe via a descriptor-declared read-only probe kind on the catalog entry.
4. Verify GREEN and commit.

**Done when:**
- When `pi --help` exits 0 listing `--tools`, `--no-extensions`, `--extension` and `--no-approve` and the asset materializes to a readable file, `probeReadOnlyReviewCapability` for pi returns status `available` with the current platform, as asserted in build-review-read-only-capability.test.ts.
- When `pi --help` output lacks `--no-approve`, the pi probe returns `unavailable` with a reason naming `--no-approve`, as asserted in build-review-read-only-capability.test.ts.
- When the pi executable is not found the pi probe returns `unavailable` naming the unavailable executable without throwing, and when `pi --help` exits 2 with stderr `boom` it returns `unavailable` with a reason carrying the exit code 2 and `boom`, as asserted in build-review-read-only-capability.test.ts.
- When the harness asset cannot be materialized because its directory is not writable, the pi probe returns `unavailable` with a reason naming the asset path, as asserted in build-review-read-only-capability.test.ts.
- In every pi probe case the process runner receives only `--help` and no provider adapter is constructed or invoked, as asserted in build-review-read-only-capability.test.ts.

**Files:** `src/conductor/src/engine/build-review-read-only-capability.ts`, `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/engine/build-review-read-only-capability.test.ts`

**Dependencies:** 2

### Task 12: llm_providers trust_project_files config key
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: `llm_providers.pi.trust_project_files: true` and `false` load; `"yes"` fails naming `llm_providers.pi.trust_project_files` and the expected boolean type; `llm_providers.pi.trust_project_fils: true` fails with the existing unknown-key error naming that key; `llm_providers.claude.trust_project_files: true` fails naming the key as not applicable to provider claude. Add the key to the config-consumer-registry coverage test with consumer `pi-provider`.
2. Verify RED.
3. Implement in `src/conductor/src/engine/config.ts` and `src/conductor/src/types/config.ts`: add `trust_project_files` to the `llm_providers.<id>` sub-key set introduced by #1885, validate boolean, and allow it only for providers whose catalog descriptor declares `projectFileTrust: true` (set on the pi entry in `src/conductor/src/execution/provider-catalog.ts`); declare the consumer in `CONFIG_CONSUMER_KEY_SETS`.
4. Verify GREEN and commit.

**Done when:**
- Config validation in config.ts rejects `llm_providers.pi.trust_project_files: "yes"` with an error naming `llm_providers.pi.trust_project_files` and the expected boolean type, as asserted in config.test.ts.
- Config validation rejects `llm_providers.pi.trust_project_fils: true` with the existing unknown-key error naming that key, as asserted in config.test.ts.
- Config validation rejects `llm_providers.claude.trust_project_files: true` with an error naming the key as not applicable to provider claude, as asserted in config.test.ts.
- `llm_providers.pi.trust_project_files` is declared in `CONFIG_CONSUMER_KEY_SETS` with a consumer and the config-consumer-registry coverage test passes.

**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/src/types/config.ts`, `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/engine/config.test.ts`

**Dependencies:** none

### Task 13: Unattended Pi dispatches pass -na unless trust_project_files opts in
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`: an ordinary build-step invocation with no `trustProjectFiles` spawns an argv containing `-na` and neither `-a` nor `--approve`; with `trustProjectFiles: false` the argv contains `-na`; with `trustProjectFiles: true` the argv contains neither `-na` nor `--no-extensions`; an ordinary build-step argv never contains `--no-extensions`. Add a provider-execution test in `src/conductor/test/engine/provider-execution.test.ts`: with resolved config `llm_providers.pi.trust_project_files: true`, a pi candidate dispatch reaches the adapter with `trustProjectFiles: true`, and a claude candidate in the same run receives no `trustProjectFiles`.
2. Verify RED.
3. Implement: add the optional `trustProjectFiles?: boolean` to `InvokeOptions` in `src/conductor/src/execution/llm-provider.ts` (additive field on the single `invoke` member); set it in `src/conductor/src/engine/provider-execution.ts` from `llm_providers.<dispatched provider>.trust_project_files`; the Pi adapter emits `-na` unless it is true.
4. Verify GREEN and commit.

**Done when:**
- With no `trustProjectFiles` an ordinary build-step Pi argv contains `-na` and contains neither `-a` nor `--approve`, and with `trustProjectFiles: false` it contains `-na`, as asserted in pi-provider.test.ts.
- With `trustProjectFiles: true` an ordinary build-step Pi argv contains neither `-na` nor `--no-extensions`, as asserted in pi-provider.test.ts.
- No ordinary build-step Pi argv contains `--no-extensions`, as asserted in pi-provider.test.ts.
- With resolved config `llm_providers.pi.trust_project_files: true`, provider-execution dispatches a pi candidate with `trustProjectFiles: true` and a claude candidate in the same run without `trustProjectFiles`, as asserted in provider-execution.test.ts.

**Files:** `src/conductor/src/execution/llm-provider.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`, `src/conductor/test/engine/provider-execution.test.ts`

**Dependencies:** 9, 12

### Task 14: Pi subprocess env gets the daemon-session marker and tmux scrub
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`: the env passed to the fake subprocess factory carries `CONDUCT_DAEMON_SESSION` as set by `withDaemonSessionMarker`; with `TMUX` and `TMUX_PANE` present in the parent env, both are masked exactly as `scrubTmuxEnvironment` masks them for codex; with a `selfHost.env` overlay that sets `CONDUCT_DAEMON_SESSION` to an empty value, the marker is still present. In `src/conductor/test/execution/daemon-session-enforcement.test.ts`, add a case where `guardDaemonSessionInvocation` receives the env the Pi adapter built and refuses the recursive `ai-conductor` invocation.
2. Verify RED.
3. Implement a Pi `invocationEnv` mirroring the codex adapter: `scrubTmuxEnvironment(withDaemonSessionMarker({ ...selfHostEnv }))`, applying the marker last, passed as `env` to the subprocess factory. Search hints: `invocationEnv`, `withDaemonSessionMarker`, `scrubTmuxEnvironment` in `codex-provider.ts`.
4. Verify GREEN and commit.

**Done when:**
- The env passed to the Pi subprocess factory carries the daemon-session marker set by `withDaemonSessionMarker`, as asserted in pi-provider.test.ts.
- With `TMUX` and `TMUX_PANE` in the parent env, the Pi spawn env masks both the same way `scrubTmuxEnvironment` does for codex, as asserted in pi-provider.test.ts.
- A `selfHost.env` overlay that empties `CONDUCT_DAEMON_SESSION` cannot remove the marker from the Pi spawn env because it is applied last, as asserted in pi-provider.test.ts.
- `guardDaemonSessionInvocation` refuses a recursive `ai-conductor` invocation carrying the env the Pi adapter built, as asserted in daemon-session-enforcement.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`, `src/conductor/test/execution/daemon-session-enforcement.test.ts`

**Dependencies:** 13

### Task 15: Environment-claim audit adjudicates pi as having no OS sandbox
**Story:** 7
**Type:** verification

**Steps:**
1. Write tests in `src/conductor/test/engine/environment-claim-audit.test.ts`: the provider sandbox table value for `pi` is `false` and equals the pi catalog descriptor `osSandbox`; for a fixed output claiming the sandbox blocked a file write and facts with no write fence installed, `auditEnvironmentBlockerClaims` with provider `pi` returns a non-empty `refuted` list and a message carrying the environment-claim-refuted marker, identical in `refuted` operations to the result for provider `claude`; with provider `codex` it returns an empty `refuted` list and a null message; the provider sandbox table value for `codex` is `true` and equals the codex catalog descriptor `osSandbox`.
2. These tests are expected to pass against existing code (the table derives from the catalog). Commit with an `Evidence:` trailer if no production change is needed.

**Done when:**
- The environment-claim audit sandbox value for pi is `false` and equals the pi catalog descriptor `osSandbox`, as asserted in environment-claim-audit.test.ts.
- For an output claiming the sandbox blocked a file write with no write fence installed, `auditEnvironmentBlockerClaims` with provider pi returns a non-empty `refuted` list and a message carrying the environment-claim-refuted marker, with the same refuted operations as for provider claude, as asserted in environment-claim-audit.test.ts.
- For that same output `auditEnvironmentBlockerClaims` with provider codex returns an empty `refuted` list and a null message, as asserted in environment-claim-audit.test.ts.
- The environment-claim audit sandbox value for codex is `true` and equals the codex catalog descriptor `osSandbox`, so codex has an OS sandbox, as asserted in environment-claim-audit.test.ts.

**Files:** `src/conductor/test/engine/environment-claim-audit.test.ts`

**Verify-only:** yes

**Dependencies:** none

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- none
Task 3 <- 2
Task 4 <- 3
Task 5 <- 3
Task 6 <- 1, 2, 5
Task 7 <- 6
Task 8 <- 7
Task 9 <- 3, 7
Task 10 <- 1
Task 11 <- 2
Task 12 <- none
Task 13 <- 9, 12
Task 14 <- 13
Task 15 <- none
```

## Integration Points

- After Task 7: a fake-subprocess Pi invocation with a native schema returns a structured result end to end through the adapter.
- After Task 8: `architecture_review_as_built` runs on a pi-only candidate set.
- After Task 11: daemon start reports Pi read-only review availability through the existing capability event.
- After Task 13: resolved config reaches the Pi argv through provider-execution.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given the pi catalog descriptor, when `supportsProviderCapability` is queried for `readOnlyReview`, then it returns true, while `selfHost`, `reviewPolicyCatalog`, `writeFence`, `costSelfReporting`, `readiness` and `interactiveLaunch` still return false. | 1 | "`supportsProviderCapability` on the pi catalog descriptor returns true for `readOnlyReview` and `nativeSchema`, as asserted in provider-catalog.test.ts." | diff-local |
| Story 1 happy: Given a Pi invocation with the read-only review option set, when the adapter spawns pi, then the argv contains `--no-extensions`, `-na`, a `--tools` value naming exactly `read,grep,find,ls,git_read`, and `-e` followed by the absolute path of the harness extension asset. | 9 | "With `readOnlyReview: true` and no native schema the spawned argv contains `--no-extensions`, `-na`, `--tools` with value exactly `read,grep,find,ls,git_read`, and `-e` followed by the absolute harness asset path, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 happy: Given a Pi invocation with the read-only review option set and a native output schema, when the adapter spawns pi, then the `--tools` value names exactly `read,grep,find,ls,git_read,submit_result`. | 9 | "With `readOnlyReview: true` and a native schema the `--tools` value is exactly `read,grep,find,ls,git_read,submit_result`, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 negative: Given a Pi invocation with the read-only review option set, when the adapter spawns pi, then the `--tools` value never names `bash`, `edit`, `write` or `powershell`. | 9 | "No read-only review `--tools` value names `bash`, `edit`, `write` or `powershell`, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 negative: Given a Pi read-only review invocation in a worktree whose `.pi/extensions/` directory contains an extension, when the adapter spawns pi, then the argv carries both `-na` and `--no-extensions` and loads no extension other than the harness asset via `-e`. | 9 | "For a read-only review in a cwd whose `.pi/extensions/` holds an extension, the argv carries both `-na` and `--no-extensions` and exactly one `-e`, naming the harness asset, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 negative: Given `llm_providers.pi.trust_project_files: true` in config, when a Pi read-only review invocation is spawned, then the argv still contains `-na`. | 9 | "With `trustProjectFiles: true`, a read-only review argv still contains `-na`, as asserted in pi-provider.test.ts." | diff-local |
| Story 1 negative: Given a custom-policy build_review lap whose only candidate is pi, when the member is prepared, then it still settles through the existing missing-capability path naming `reviewPolicyCatalog` and spawns no pi subprocess. | 10 | "A custom-policy build_review member whose only candidate is pi, with pi read-only capability `available`, settles through `unavailableReviewCapabilityResult` naming `reviewPolicyCatalog`, as asserted in build-review-pi-custom-member.test.ts." | diff-local |
| Story 2 happy: Given `pi --help` exits 0 and lists `--tools`, `--no-extensions`, `--extension` and `--no-approve`, and the harness extension asset materializes to a readable file, when `probeReadOnlyReviewCapability` runs for pi, then it returns status `available` with the current platform. | 11 | "When `pi --help` exits 0 listing `--tools`, `--no-extensions`, `--extension` and `--no-approve` and the asset materializes to a readable file, `probeReadOnlyReviewCapability` for pi returns status `available` with the current platform, as asserted in build-review-read-only-capability.test.ts." | diff-local |
| Story 2 negative: Given `pi --help` output lacks `--no-approve`, when the probe runs for pi, then it returns status `unavailable` with a reason naming the missing flag. | 11 | "When `pi --help` output lacks `--no-approve`, the pi probe returns `unavailable` with a reason naming `--no-approve`, as asserted in build-review-read-only-capability.test.ts." | diff-local |
| Story 2 negative: Given the pi executable is not found, when the probe runs for pi, then it returns status `unavailable` with a reason naming the unavailable executable, and it does not throw. | 11 | "When the pi executable is not found the pi probe returns `unavailable` naming the unavailable executable without throwing, and when `pi --help` exits 2 with stderr `boom` it returns `unavailable` with a reason carrying the exit code 2 and `boom`, as asserted in build-review-read-only-capability.test.ts." | diff-local |
| Story 2 negative: Given `pi --help` exits non-zero, when the probe runs for pi, then it returns status `unavailable` with a reason carrying the exit code and stderr. | 11 | "When the pi executable is not found the pi probe returns `unavailable` naming the unavailable executable without throwing, and when `pi --help` exits 2 with stderr `boom` it returns `unavailable` with a reason carrying the exit code 2 and `boom`, as asserted in build-review-read-only-capability.test.ts." | diff-local |
| Story 2 negative: Given `pi --help` lists every required flag but the harness extension asset cannot be materialized because its directory is not writable, when the probe runs for pi, then it returns status `unavailable` with a reason naming the asset path. | 11 | "When the harness asset cannot be materialized because its directory is not writable, the pi probe returns `unavailable` with a reason naming the asset path, as asserted in build-review-read-only-capability.test.ts." | diff-local |
| Story 3 happy: Given the harness extension is loaded with its git_read flag, when the extension factory runs against a fake extension API, then exactly one tool named `git_read` is registered whose subcommand parameter is an enum of `show`, `diff`, `log`, `ls-tree`, `ls-files`, `cat-file`, `rev-parse`, `blame` and `grep`. | 3 | "With the git-read flag set the extension factory registers exactly one tool named `git_read` whose subcommand parameter is an enum of exactly `show`, `diff`, `log`, `ls-tree`, `ls-files`, `cat-file`, `rev-parse`, `blame` and `grep`, as asserted against a fake `ExtensionAPI` in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 happy: Given a `git_read` call with subcommand `diff` and args `["HEAD~1", "--", "src/a.ts"]`, when the tool executes, then git is spawned without a shell with argv beginning `diff` followed by those args byte-for-byte, and the tool returns git's stdout. | 3 | "Executing `git_read` with subcommand `diff` and args `["HEAD~1", "--", "src/a.ts"]` reaches the mocked process boundary with argv `diff HEAD~1 -- src/a.ts` byte-for-byte and `shell: false`, and the tool returns the child stdout, as asserted in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 happy: Given a `git_read` call, when git is spawned, then the child env sets the pager to `cat` and clears any external-diff program variable. | 3 | "Every `git_read` spawn passes an env with `GIT_PAGER` and `PAGER` set to `cat` and no `GIT_EXTERNAL_DIFF` variable, as asserted in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given a `git_read` call with subcommand `commit`, when the tool executes, then it returns an error result naming the subcommand as not allowed and spawns no process. | 4 | "A `git_read` call with subcommand `commit` returns an error result naming the subcommand as not allowed and never reaches the mocked process boundary, as asserted in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given a `git_read` call whose args include `--output=/tmp/x`, when the tool executes, then it returns an error result naming the refused option and spawns no process. | 4 | "A `git_read` call with any of `--output=/tmp/x`, `-O`, `--open-files-in-pager=vi`, `--ext-diff`, `--textconv`, `-c core.pager=sh` or `--config-env=core.pager=X` returns an error result naming that refused option and never reaches the mocked process boundary, as asserted per option in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given a `git_read` call whose args include `-O` or `--open-files-in-pager=vi`, when the tool executes, then it returns an error result naming the refused option and spawns no process. | 4 | "A `git_read` call with any of `--output=/tmp/x`, `-O`, `--open-files-in-pager=vi`, `--ext-diff`, `--textconv`, `-c core.pager=sh` or `--config-env=core.pager=X` returns an error result naming that refused option and never reaches the mocked process boundary, as asserted per option in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given a `git_read` call whose args include `--ext-diff` or `--textconv`, when the tool executes, then it returns an error result naming the refused option and spawns no process. | 4 | "A `git_read` call with any of `--output=/tmp/x`, `-O`, `--open-files-in-pager=vi`, `--ext-diff`, `--textconv`, `-c core.pager=sh` or `--config-env=core.pager=X` returns an error result naming that refused option and never reaches the mocked process boundary, as asserted per option in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given a `git_read` call whose args include `-c` followed by `core.pager=sh`, or `--config-env=core.pager=X`, when the tool executes, then it returns an error result naming the refused option and spawns no process. | 4 | "A `git_read` call with any of `--output=/tmp/x`, `-O`, `--open-files-in-pager=vi`, `--ext-diff`, `--textconv`, `-c core.pager=sh` or `--config-env=core.pager=X` returns an error result naming that refused option and never reaches the mocked process boundary, as asserted per option in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given a `git_read` call whose single arg is `HEAD; rm -rf .`, when the tool executes, then git receives that string as one literal argv element, no shell interprets it, and no file is removed. | 4 | "A `git_read` call with the single arg `HEAD; rm -rf .` reaches the boundary as one literal argv element with `shell: false`, no shell interprets it, and a sentinel file in the cwd is not removed, as asserted in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 3 negative: Given git exits non-zero for an allowed call, when the tool returns, then the result is marked as an error and carries git's stderr. | 4 | "When the mocked git exits non-zero for an allowed call, the `git_read` result is marked as an error and carries git stderr, as asserted in pi-harness-extension-git-read.test.ts." | diff-local |
| Story 4 happy: Given a Pi invocation carrying a native output schema, when the adapter spawns pi, then the schema is written as a file inside the engine-owned native-schema scratch home, and the argv carries `-e` for the harness asset plus the flag naming that file. | 6 | "For an invocation carrying `nativeSchema`, the Pi adapter writes the schema to a file inside `nativeSchemaScratchHome` and the spawned argv contains `-e` followed by the materialized asset path and the output-schema flag followed by that schema file path, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 happy: Given the harness extension is loaded with an output-schema flag naming a schema file, when the factory runs against a fake extension API, then a tool named `submit_result` is registered whose parameters equal the file's JSON schema and whose execute returns the arguments in `details` with `terminate: true`. | 5 | "With the output-schema flag naming a schema file the extension factory registers a tool named `submit_result` whose `parameters` equal the parsed file JSON schema, as asserted against a fake `ExtensionAPI` in pi-harness-extension-submit-result.test.ts." | diff-local |
| Story 4 happy: Given a Pi JSON stream whose last `submit_result` `tool_execution_end` event has `isError: false` and details `{"verdict":"pass"}`, when the adapter parses it, then the invocation succeeds with `finalStructuredResult` equal to that object. | 7 | "For a stream whose last successful `submit_result` `tool_execution_end` has details `{"verdict":"pass"}`, the Pi adapter returns `success: true` with `finalStructuredResult` equal to that object, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 happy: Given the pi descriptor, when `nativeSchemaCapabilityFor('pi')` is queried, then `nativeOutputSchema` is true, so `architecture_review_as_built` no longer refuses a candidate set whose only provider is pi. | 8, 1 | "With a candidate set of only `pi`, the `architecture_review_as_built` step runner does not refuse with the native output schema reason and invokes the fake Pi subprocess once with the output-schema flag, as asserted in as-built-pi-native-schema.test.ts." | diff-local |
| Story 4 negative: Given a schema-carrying Pi invocation whose stream ends with no `submit_result` `tool_execution_end` event, when the adapter parses it, then the invocation fails with an error naming the missing structured result and carries no `finalStructuredResult`. | 7 | "A schema-carrying stream with no `submit_result` `tool_execution_end` returns a failed invocation whose output names the missing structured result and carries no `finalStructuredResult`, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given a schema-carrying Pi stream whose only `submit_result` `tool_execution_end` event has `isError: true`, when the adapter parses it, then the invocation fails naming the missing structured result. | 7 | "A schema-carrying stream whose only `submit_result` end has `isError: true` returns a failed invocation naming the missing structured result, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given a stream with two successful `submit_result` events, when the adapter parses it, then `finalStructuredResult` equals the details of the last one. | 7 | "For a stream with two successful `submit_result` ends, `finalStructuredResult` equals the details of the last one, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given a Pi invocation with no native output schema, when the adapter spawns pi, then no output-schema flag is passed and no `submit_result` tool is named in `--tools`. | 6 | "For an invocation without `nativeSchema`, the spawned argv carries no output-schema flag and no `--tools` value naming `submit_result`, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given the harness extension is loaded with no harness flag, when the factory runs against a fake extension API, then it registers no tool. | 5 | "Loaded with no harness flag, the extension factory calls `registerTool` zero times, as asserted in pi-harness-extension-submit-result.test.ts." | diff-local |
| Story 4 negative: Given the schema file cannot be written into the scratch home, when a schema-carrying Pi invocation is prepared, then it fails before spawning pi with an error naming the schema path. | 6 | "When the schema file cannot be written, `invoke` returns a failed result whose output names the schema path and the fake subprocess factory is never called, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 happy: Given no `llm_providers.pi.trust_project_files` in config, when a Pi invocation for an ordinary build step is spawned, then the argv contains `-na` and does not contain `-a` or `--approve`. | 13 | "With no `trustProjectFiles` an ordinary build-step Pi argv contains `-na` and contains neither `-a` nor `--approve`, and with `trustProjectFiles: false` it contains `-na`, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 happy: Given `llm_providers.pi.trust_project_files: true`, when a Pi invocation for an ordinary build step is spawned, then the argv contains neither `-na` nor `--no-extensions`. | 13 | "With `trustProjectFiles: true` an ordinary build-step Pi argv contains neither `-na` nor `--no-extensions`, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 happy: Given an ordinary build-step Pi invocation, when the adapter spawns pi, then the argv does not contain `--no-extensions`, so operator-global extensions keep loading. | 13 | "No ordinary build-step Pi argv contains `--no-extensions`, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 negative: Given `llm_providers.pi.trust_project_files: "yes"`, when config loads, then validation fails with an error naming `llm_providers.pi.trust_project_files` and the expected boolean type. | 12 | "Config validation in config.ts rejects `llm_providers.pi.trust_project_files: "yes"` with an error naming `llm_providers.pi.trust_project_files` and the expected boolean type, as asserted in config.test.ts." | diff-local |
| Story 5 negative: Given `llm_providers.pi.trust_project_fils: true` (misspelled), when config loads, then validation fails with the existing unknown-key error naming that key. | 12 | "Config validation rejects `llm_providers.pi.trust_project_fils: true` with the existing unknown-key error naming that key, as asserted in config.test.ts." | diff-local |
| Story 5 negative: Given `llm_providers.claude.trust_project_files: true`, when config loads, then validation fails naming the key as not applicable to provider claude. | 12 | "Config validation rejects `llm_providers.claude.trust_project_files: true` with an error naming the key as not applicable to provider claude, as asserted in config.test.ts." | diff-local |
| Story 5 negative: Given `trust_project_files: false` explicitly, when a Pi build-step invocation is spawned, then the argv contains `-na`, the same as when the key is absent. | 13 | "With no `trustProjectFiles` an ordinary build-step Pi argv contains `-na` and contains neither `-a` nor `--approve`, and with `trustProjectFiles: false` it contains `-na`, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 negative: Given the engine materializes the harness extension asset for a Pi dispatch, when the write completes, then no file is created or changed under `~/.pi` or under any project `.pi/` directory, so an operator's own interactive `pi` session loads no harness extension or harness tool. | 2 | "After materialization no file is created or changed under `«homeDir»/.pi` or under any `.pi/` directory of the cwd, so an interactive `pi` session loads no harness extension or harness tool, as asserted by a directory snapshot in pi-harness-extension.test.ts." | diff-local |
| Story 6 happy: Given any Pi invocation, when the adapter spawns pi, then the spawn env carries the daemon-session marker that `withDaemonSessionMarker` sets for codex. | 14 | "The env passed to the Pi subprocess factory carries the daemon-session marker set by `withDaemonSessionMarker`, as asserted in pi-provider.test.ts." | diff-local |
| Story 6 happy: Given the daemon process env contains `TMUX` and `TMUX_PANE`, when the adapter spawns pi, then the spawn env masks both the same way the codex adapter does. | 14 | "With `TMUX` and `TMUX_PANE` in the parent env, the Pi spawn env masks both the same way `scrubTmuxEnvironment` does for codex, as asserted in pi-provider.test.ts." | diff-local |
| Story 6 negative: Given a Pi invocation whose self-host env overlay would unset the daemon-session marker, when the adapter builds the env, then the marker is still present because it is applied last. | 14 | "A `selfHost.env` overlay that empties `CONDUCT_DAEMON_SESSION` cannot remove the marker from the Pi spawn env because it is applied last, as asserted in pi-provider.test.ts." | diff-local |
| Story 6 negative: Given a Pi process running with the marker, when it invokes the `ai-conductor` entry point recursively, then the existing daemon-session entry guard refuses it, as it does for codex. | 14 | "`guardDaemonSessionInvocation` refuses a recursive `ai-conductor` invocation carrying the env the Pi adapter built, as asserted in daemon-session-enforcement.test.ts." | diff-local |
| Story 7 happy: Given the environment-claim audit's provider sandbox table, when it is read for pi, then the value is `false` and is derived from the pi catalog descriptor. | 15 | "The environment-claim audit sandbox value for pi is `false` and equals the pi catalog descriptor `osSandbox`, as asserted in environment-claim-audit.test.ts." | diff-local |
| Story 7 negative: Given a pi dispatch with no write fence installed whose output claims the sandbox blocked a file write, when `auditEnvironmentBlockerClaims` runs with provider pi, then the claim is refuted and the message carries the environment-claim-refuted marker, the same verdict claude receives for that output. | 15 | "For an output claiming the sandbox blocked a file write with no write fence installed, `auditEnvironmentBlockerClaims` with provider pi returns a non-empty `refuted` list and a message carrying the environment-claim-refuted marker, with the same refuted operations as for provider claude, as asserted in environment-claim-audit.test.ts." | diff-local |
| Story 7 negative: Given the same output, when `auditEnvironmentBlockerClaims` runs with provider codex, then nothing is refuted, because codex has an OS sandbox. | 15 | "For that same output `auditEnvironmentBlockerClaims` with provider codex returns an empty `refuted` list and a null message, as asserted in environment-claim-audit.test.ts." | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
| --- | --- | --- | --- |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D1 | existing | none | The structural test banning provider id literals outside execution/provider-catalog.ts stays in force; this feature adds catalog descriptor fields for trust-key admission and probe selection instead of pi literals. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D2 | task | task-1 | For the pi descriptor `supportsProviderCapability` still returns false for `selfHost`, `reviewPolicyCatalog`, `writeFence`, `costSelfReporting`, `readiness` and `interactiveLaunch`, and `osSandbox` stays `false`, as asserted in provider-catalog.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D3 | existing | none | engine/provider-discovery.ts discoverInstalledProviders runs in both boot paths unchanged; this feature adds no discovery step. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D4 | existing | none | The not-installed configuration error in engine/provider-discovery.ts is unchanged; no task edits provider installation validation. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D5 | task | task-7 | A schema-carrying stream with no `submit_result` `tool_execution_end` returns a failed invocation whose output names the missing structured result and carries no `finalStructuredResult`, as asserted in pi-provider.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D6 | task | task-1 | `supportsProviderCapability` on the pi catalog descriptor returns true for `readOnlyReview` and `nativeSchema`, as asserted in provider-catalog.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D7 | existing | none | engine/live-e2e-providers.ts keeps its catalog-keyed Pi entry; this feature adds no live leg and default-suite tests use a fake Pi subprocess. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D8 | existing | none | Discovery and fail-fast remain on provider-dispatching entry points only; the pi read-only probe runs from the existing read-only capability probe callers. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D9 | task | task-1 | For the pi descriptor `supportsProviderCapability` still returns false for `selfHost`, `reviewPolicyCatalog`, `writeFence`, `costSelfReporting`, `readiness` and `interactiveLaunch`, and `osSandbox` stays `false`, as asserted in provider-catalog.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D10 | existing | none | Compose launcher host selection is untouched; no task edits the launcher. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D11 | existing | none | The compose launcher keeps its non-probing rule and nesting refusal; no task edits the launcher. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D12 | no-change | none | The Pi model and thinking argv delivered by #1885 is not altered by this feature; tasks add only extension, tools, trust and env arguments. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D13 | no-change | none | The required llm_providers.pi model keys and boot model probe delivered by #1885 are not altered; this feature only adds the trust_project_files sub-key. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D14 | no-change | none | The exit-0 stopReason error classification delivered by #1885 is not altered; this feature only adds submit_result parsing for schema-carrying invocations. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D15 | task | task-2 | `materializePiHarnessExtension` writes `harness-extension-«sha256 prefix».ts` under `«homeDir»/.ai-conductor/pi/` with bytes equal to `PI_HARNESS_EXTENSION_SOURCE`, via a temp file then rename, and returns its absolute path, as asserted in pi-harness-extension.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D16 | task | task-5, task-6, task-7 | A schema-carrying stream with no `submit_result` `tool_execution_end` returns a failed invocation whose output names the missing structured result and carries no `finalStructuredResult`, as asserted in pi-provider.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D17 | task | task-3, task-4, task-9, task-11 | With `readOnlyReview: true` and no native schema the spawned argv contains `--no-extensions`, `-na`, `--tools` with value exactly `read,grep,find,ls,git_read`, and `-e` followed by the absolute harness asset path, as asserted in pi-provider.test.ts. |
| adr-2026-09-24-built-in-provider-catalog-and-boot-discovery#D18 | task | task-13, task-14 | With no `trustProjectFiles` an ordinary build-step Pi argv contains `-na` and contains neither `-a` nor `--approve`, and with `trustProjectFiles: false` it contains `-na`, as asserted in pi-provider.test.ts. |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
