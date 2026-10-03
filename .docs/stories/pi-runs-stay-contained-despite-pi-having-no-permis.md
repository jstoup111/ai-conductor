**Status:** Accepted

# Stories: Pi runs stay contained despite Pi having no permission model (#1886)

Technical track (no PRD). The source is the operator-confirmed scope in
`.docs/track/pi-runs-stay-contained-despite-pi-having-no-permis.md` and
adr-2026-09-24-built-in-provider-catalog-and-boot-discovery D15–D18. OS write-containment is out of
scope (#2851).

## Story 1: Pi review invocations cannot use write-capable tools

**Requirement:** TI-1 — Pi declares `readOnlyReview`; a read-only review invocation exposes no write-capable or project-supplied tool (ADR D17).

As an operator, I want a Pi reviewer to be limited to read-only tools, so that admitting Pi to a read-only review role cannot change the code under review.

### Acceptance Criteria

#### Happy Path
- Given the pi catalog descriptor, when `supportsProviderCapability` is queried for `readOnlyReview`, then it returns true, while `selfHost`, `reviewPolicyCatalog`, `writeFence`, `readiness` and `interactiveLaunch` still return false.
- Given a Pi invocation with the read-only review option set, when the adapter spawns pi, then the argv contains `--no-extensions`, `-na`, a `--tools` value naming exactly `read,grep,find,ls,git_read`, and `-e` followed by the absolute path of the harness extension asset.
- Given a Pi invocation with the read-only review option set and a native output schema, when the adapter spawns pi, then the `--tools` value names exactly `read,grep,find,ls,git_read,submit_result`.

#### Negative Paths
- Given a Pi invocation with the read-only review option set, when the adapter spawns pi, then the `--tools` value never names `bash`, `edit`, `write` or `powershell`.
- Given a Pi read-only review invocation in a worktree whose `.pi/extensions/` directory contains an extension, when the adapter spawns pi, then the argv carries both `-na` and `--no-extensions` and loads no extension other than the harness asset via `-e`.
- Given `llm_providers.pi.trust_project_files: true` in config, when a Pi read-only review invocation is spawned, then the argv still contains `-na`.
- Given a custom-policy build_review lap whose only candidate is pi, when the member is prepared, then it still settles through the existing missing-capability path naming `reviewPolicyCatalog` and spawns no pi subprocess.

### Done When
- [ ] provider-catalog tests assert pi declares `readOnlyReview` and `nativeSchema` and no other capability.
- [ ] pi-provider tests assert the exact read-only review argv, with and without a native schema, against a fake subprocess.
- [ ] A test asserts `trust_project_files: true` does not remove `-na` from a read-only review argv.

## Story 2: Pi read-only mode availability is probed on the host

**Requirement:** TI-2 — read-only review availability for pi is established by Pi's own mechanism at daemon start and config load (ADR D17; adr-2026-09-10-portable-build-review-policy D5.5).

As an operator, I want the daemon to tell me up front whether Pi's read-only review mode works on this machine, so that an unusable Pi reviewer is skipped with a reason instead of failing mid-lap.

### Acceptance Criteria

#### Happy Path
- Given `pi --help` exits 0 and lists `--tools`, `--no-extensions`, `--extension` and `--no-approve`, and the harness extension asset materializes to a readable file, when `probeReadOnlyReviewCapability` runs for pi, then it returns status `available` with the current platform.

#### Negative Paths
- Given `pi --help` output lacks `--no-approve`, when the probe runs for pi, then it returns status `unavailable` with a reason naming the missing flag.
- Given the pi executable is not found, when the probe runs for pi, then it returns status `unavailable` with a reason naming the unavailable executable, and it does not throw.
- Given `pi --help` exits non-zero, when the probe runs for pi, then it returns status `unavailable` with a reason carrying the exit code and stderr.
- Given `pi --help` lists every required flag but the harness extension asset cannot be materialized because its directory is not writable, when the probe runs for pi, then it returns status `unavailable` with a reason naming the asset path.

### Done When
- [ ] build-review-read-only-capability tests cover the pi available case and each unavailable reason through a fake process runner.
- [ ] The pi probe sends no model prompt and invokes no provider adapter.

## Story 3: Pi reviewers read git history only through a shell-free read-only tool

**Requirement:** TI-3 — `git_read` admits only the fixed read-only subcommands and refuses arguments that write files or run programs (ADR D17; review condition C2).

As an operator, I want a Pi reviewer to read diffs and history the way a Claude reviewer can, without being able to make git write files or run other programs.

### Acceptance Criteria

#### Happy Path
- Given the harness extension is loaded with its git_read flag, when the extension factory runs against a fake extension API, then exactly one tool named `git_read` is registered whose subcommand parameter is an enum of `show`, `diff`, `log`, `ls-tree`, `ls-files`, `cat-file`, `rev-parse`, `blame` and `grep`.
- Given a `git_read` call with subcommand `diff` and args `["HEAD~1", "--", "src/a.ts"]`, when the tool executes, then git is spawned without a shell with argv beginning `diff` followed by those args byte-for-byte, and the tool returns git's stdout.
- Given a `git_read` call, when git is spawned, then the child env sets the pager to `cat` and clears any external-diff program variable.

#### Negative Paths
- Given a `git_read` call with subcommand `commit`, when the tool executes, then it returns an error result naming the subcommand as not allowed and spawns no process.
- Given a `git_read` call whose args include `--output=/tmp/x`, when the tool executes, then it returns an error result naming the refused option and spawns no process.
- Given a `git_read` call whose args include `-O` or `--open-files-in-pager=vi`, when the tool executes, then it returns an error result naming the refused option and spawns no process.
- Given a `git_read` call whose args include `--ext-diff` or `--textconv`, when the tool executes, then it returns an error result naming the refused option and spawns no process.
- Given a `git_read` call whose args include `-c` followed by `core.pager=sh`, or `--config-env=core.pager=X`, when the tool executes, then it returns an error result naming the refused option and spawns no process.
- Given a `git_read` call whose single arg is `HEAD; rm -rf .`, when the tool executes, then git receives that string as one literal argv element, no shell interprets it, and no file is removed.
- Given git exits non-zero for an allowed call, when the tool returns, then the result is marked as an error and carries git's stderr.

### Done When
- [ ] Extension tests load the asset's default export against a fake `ExtensionAPI` and a mocked process boundary, and assert every refused call never reaches that boundary.
- [ ] A test asserts the spawn options disable shell interpretation.

## Story 4: Pi returns structured results through a validated terminating tool

**Requirement:** TI-4 — Pi declares `nativeSchema`; a schema-carrying invocation yields `finalStructuredResult` from a successful `submit_result` call, and never succeeds without one (ADR D16).

As an operator, I want build_review rubric members and the as-built architecture review to be able to run on Pi and return schema-shaped verdicts.

### Acceptance Criteria

#### Happy Path
- Given a Pi invocation carrying a native output schema, when the adapter spawns pi, then the schema is written as a file inside the engine-owned native-schema scratch home, and the argv carries `-e` for the harness asset plus the flag naming that file.
- Given the harness extension is loaded with an output-schema flag naming a schema file, when the factory runs against a fake extension API, then a tool named `submit_result` is registered whose parameters equal the file's JSON schema and whose execute returns the arguments in `details` with `terminate: true`.
- Given a Pi JSON stream whose last `submit_result` `tool_execution_end` event has `isError: false` and details `{"verdict":"pass"}`, when the adapter parses it, then the invocation succeeds with `finalStructuredResult` equal to that object.
- Given the pi descriptor, when `nativeSchemaCapabilityFor('pi')` is queried, then `nativeOutputSchema` is true, so `architecture_review_as_built` no longer refuses a candidate set whose only provider is pi.

#### Negative Paths
- Given a schema-carrying Pi invocation whose stream ends with no `submit_result` `tool_execution_end` event, when the adapter parses it, then the invocation fails with an error naming the missing structured result and carries no `finalStructuredResult`.
- Given a schema-carrying Pi stream whose only `submit_result` `tool_execution_end` event has `isError: true`, when the adapter parses it, then the invocation fails naming the missing structured result.
- Given a stream with two successful `submit_result` events, when the adapter parses it, then `finalStructuredResult` equals the details of the last one.
- Given a Pi invocation with no native output schema, when the adapter spawns pi, then no output-schema flag is passed and no `submit_result` tool is named in `--tools`.
- Given the harness extension is loaded with no harness flag, when the factory runs against a fake extension API, then it registers no tool.
- Given the schema file cannot be written into the scratch home, when a schema-carrying Pi invocation is prepared, then it fails before spawning pi with an error naming the schema path.

### Done When
- [ ] pi-provider tests cover each stream shape above using captured-style JSON fixtures against a fake subprocess.
- [ ] Extension tests assert `submit_result` registration only when the schema flag is present.
- [ ] provider-catalog or provider-runtime tests assert pi reports `nativeOutputSchema: true`.

## Story 5: Unattended Pi dispatches ignore repository-supplied Pi configuration by default

**Requirement:** TI-5 — every unattended Pi invocation ignores project-local `.pi/` files unless the operator opts in (ADR D18).

As an operator, I want a repository's `.pi/` extensions and settings to be unable to run code in a daemon Pi dispatch unless I deliberately enable them.

### Acceptance Criteria

#### Happy Path
- Given no `llm_providers.pi.trust_project_files` in config, when a Pi invocation for an ordinary build step is spawned, then the argv contains `-na` and does not contain `-a` or `--approve`.
- Given `llm_providers.pi.trust_project_files: true`, when a Pi invocation for an ordinary build step is spawned, then the argv contains neither `-na` nor `--no-extensions`.
- Given an ordinary build-step Pi invocation, when the adapter spawns pi, then the argv does not contain `--no-extensions`, so operator-global extensions keep loading.

#### Negative Paths
- Given `llm_providers.pi.trust_project_files: "yes"`, when config loads, then validation fails with an error naming `llm_providers.pi.trust_project_files` and the expected boolean type.
- Given `llm_providers.pi.trust_project_fils: true` (misspelled), when config loads, then validation fails with the existing unknown-key error naming that key.
- Given `llm_providers.claude.trust_project_files: true`, when config loads, then validation fails naming the key as not applicable to provider claude.
- Given `trust_project_files: false` explicitly, when a Pi build-step invocation is spawned, then the argv contains `-na`, the same as when the key is absent.
- Given the engine materializes the harness extension asset for a Pi dispatch, when the write completes, then no file is created or changed under `~/.pi` or under any project `.pi/` directory, so an operator's own interactive `pi` session loads no harness extension or harness tool.

### Done When
- [ ] config tests cover the boolean type, the unknown-key and non-pi rejections, and the consumer-registry declaration of the new key.
- [ ] pi-provider tests cover `-na` presence for the default, false and true cases.
- [ ] A materialization test asserts the asset lands only under the engine's `~/.ai-conductor/pi/` directory.

## Story 6: Pi subprocesses run with the daemon's session treatment

**Requirement:** TI-6 — the Pi subprocess env carries the daemon-session marker and no tmux target variables (ADR D18).

As an operator, I want a Pi dispatch to be recognized as engine-managed and unable to target the daemon's tmux pane, the same as a codex dispatch.

### Acceptance Criteria

#### Happy Path
- Given any Pi invocation, when the adapter spawns pi, then the spawn env carries the daemon-session marker that `withDaemonSessionMarker` sets for codex.
- Given the daemon process env contains `TMUX` and `TMUX_PANE`, when the adapter spawns pi, then the spawn env masks both the same way the codex adapter does.

#### Negative Paths
- Given a Pi invocation whose self-host env overlay would unset the daemon-session marker, when the adapter builds the env, then the marker is still present because it is applied last.
- Given a Pi process running with the marker, when it invokes the `ai-conductor` entry point recursively, then the existing daemon-session entry guard refuses it, as it does for codex.

### Done When
- [ ] pi-provider tests assert the marker and tmux masking in the env passed to the mocked subprocess boundary.

## Story 7: Environment-claim audits treat Pi as having no OS sandbox

**Requirement:** TI-7 — environment-claim auditing gives correct verdicts for pi runs (intake outcome; catalog `osSandbox: false`).

As an operator, I want a Pi agent's "the sandbox blocked me" claim to be judged against Pi's actual, absent, OS sandbox.

### Acceptance Criteria

#### Happy Path
- Given the environment-claim audit's provider sandbox table, when it is read for pi, then the value is `false` and is derived from the pi catalog descriptor.

#### Negative Paths
- Given a pi dispatch with no write fence installed whose output claims the sandbox blocked a file write, when `auditEnvironmentBlockerClaims` runs with provider pi, then the claim is refuted and the message carries the environment-claim-refuted marker, the same verdict claude receives for that output.
- Given the same output, when `auditEnvironmentBlockerClaims` runs with provider codex, then nothing is refuted, because codex has an OS sandbox.

### Done When
- [ ] environment-claim-audit tests include pi cases alongside claude and codex.
