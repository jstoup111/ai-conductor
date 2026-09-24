**Status:** Accepted

# Stories: Pi as a build provider

Technical track (no PRD). Requirements derive from issue jstoup111/ai-conductor#1884, the operator-confirmed scope boundary in `.docs/track/pi-as-a-build-provider.md`, and adr-2026-09-24-built-in-provider-catalog-and-boot-discovery.

## Story 1: Built-in providers come from one catalog

**Requirement:** TI-1 — every built-in provider id, executable, env namespace, home, model policy, and capability is declared once; no production code hardcodes the provider set (ADR D1).

As the harness maintainer, I want the built-in provider set declared in one catalog so that adding a provider cannot leave a stale two-provider branch behind.

### Acceptance Criteria

#### Happy Path
- Given the catalog declares claude, codex, and pi, when the engine boots with all three installed, then the registered llm_provider ids are exactly the catalog ids.
- Given an existing claude or codex configuration, when a step dispatches after the refactor, then the argv, environment prefixes, provider home, model ladder, and fallback behavior equal the pre-refactor behavior.
- Given `CLAUDE_EXECUTABLE` is set to an absolute path, when a claude step dispatches, then that path is the spawned executable.

#### Negative Paths
- Given a production source file outside the catalog and the provider's own adapter module, when it contains a built-in provider id literal, then the structural test fails naming the file and line.
- Given a user-facing display string that names a provider, when the structural test runs, then it passes only if the string is supplied by the catalog descriptor rather than written literally.
- Given `CLAUDE_EXECUTABLE` names a path that does not exist, when the engine boots with claude configured, then startup fails with the not-installed error for claude naming reason not-found.

### Done When
- [ ] `execution/provider-catalog.ts` exports `BUILT_IN_PROVIDERS`, `BuiltInProviderId`, and `DEFAULT_PROVIDER`, and `BuiltInProviderId` is derived from the table.
- [ ] A structural test scanning production source reports zero built-in id literals outside the catalog and adapter modules.
- [ ] Existing claude and codex provider test suites pass without edits to their assertions.

## Story 2: Provider-specific paths refuse providers lacking the capability

**Requirement:** TI-2 — consumers of provider-specific behavior narrow by declared capability and refuse by name; absent capability means unsupported (ADR D2, D6).

As an operator, I want a step that needs a capability Pi does not yet have to fail with a clear reason so that Pi never silently runs through claude- or codex-specific logic.

### Acceptance Criteria

#### Happy Path
- Given claude and codex declare their current capabilities, when self-host, build-review containment, and review-policy catalog paths run for them, then behavior is unchanged.
- Given pi is selected for an ordinary build step, when the step dispatches, then no capability refusal occurs.

#### Negative Paths
- Given pi is selected for a path that requires the selfHost capability, when that path is reached, then it fails before spawning with an error naming provider pi, capability selfHost, and the owning intake.
- Given pi is selected for build-review with a custom review policy, when the review-policy catalog path is reached, then it fails naming capability reviewPolicyCatalog instead of falling into the codex or claude branch.
- Given a descriptor omits a capability flag, when any consumer queries it, then the capability is treated as unsupported.

### Done When
- [ ] Every provider-specific consumer accepts a capability-narrowed provider type instead of a literal id union.
- [ ] A test per refused capability asserts the error text names the provider and capability and that no subprocess was spawned.

## Story 3: Boot discovers installed providers and registers only those

**Requirement:** TI-3 — at boot the daemon and CLI detect which built-in providers are installed and register only those (ADR D3).

As an operator, I want the engine to know at startup which provider CLIs are actually installed so that it never registers a provider it cannot run.

### Acceptance Criteria

#### Happy Path
- Given claude and codex executables resolve and their version probes exit 0 and pi is absent, when the daemon boots, then claude and codex are registered and pi is not.
- Given a provider executable override env var is set, when discovery runs, then the override path is probed instead of the PATH lookup.
- Given discovery completes, when the event log is read, then one provider-discovery event lists the installed ids and each missing id with its reason.
- Given the CLI entry point boots, when discovery runs, then it produces the same installed set as the daemon for the same environment.

#### Negative Paths
- Given an executable resolves but its version probe exits non-zero, when discovery runs, then that provider is missing with reason version-failed.
- Given an executable resolves but is not executable, when discovery runs, then that provider is missing with reason not-executable.
- Given a version probe does not exit within the probe timeout, when discovery runs, then that provider is missing with reason timeout and boot is not delayed beyond the timeout.
- Given the test environment forbids real exec, when discovery runs without an injected runner, then it throws the real-exec guard error rather than spawning.

### Done When
- [ ] `engine/provider-discovery.ts` returns installed and missing sets with the closed reason set not-found, not-executable, version-failed, timeout.
- [ ] Both boot paths call discovery before built-in registration.
- [ ] A provider-discovery `ConductorEvent` variant is emitted once per boot and persisted to `.pipeline/events.jsonl`.

## Story 4: Configured provider that is not installed fails startup

**Requirement:** TI-4 — configuration naming an uninstalled built-in provider anywhere fails startup with an actionable, distinct error (ADR D4).

As an operator, I want the daemon to refuse to start when my config names a provider that is not installed so that I learn about it immediately rather than through per-step failures.

### Acceptance Criteria

#### Happy Path
- Given every provider named in config is installed, when the daemon boots, then startup continues and no provider error is raised.

#### Negative Paths
- Given run-level `llm_provider: pi` and pi is not installed, when the daemon boots, then it exits non-zero with an error naming provider pi, the config path, and the discovery reason.
- Given `steps.build.llm_provider` names codex and codex is not installed, when the daemon boots, then the error names the step config path.
- Given a fallback ladder of pi then claude and only claude is installed, when the daemon boots, then startup fails naming pi rather than silently dropping it from the ladder.
- Given config names an id that is neither a catalog id nor a registered plugin, when the daemon boots, then the existing unknown-provider error is raised, worded differently from the not-installed error.
- Given config names catalog id pi and pi is not installed, when startup validation runs, then the not-installed error is raised and the unknown-provider error is not, and any available-names list shows installed providers only.
- Given no provider CLI is installed on the machine, when a subcommand that never dispatches a provider runs (for example rate-card refresh or overlap-scan), then it neither probes provider executables nor fails for a missing provider.
- Given the CLI entry point with the same missing provider, when a conduct run starts, then it fails with the same not-installed error before any step dispatches.

### Done When
- [ ] The not-installed error text contains the provider id, the config path, and the discovery reason.
- [ ] No feature is claimed, no worktree is created, and no step dispatches when startup fails for a missing provider.
- [ ] A test pins that the not-installed check runs before registered-provider validation for a catalog id.
- [ ] Non-dispatching CLI subcommands run to completion on a machine with no provider CLIs installed.

## Story 5: A Pi step runs headlessly as a fresh session

**Requirement:** TI-5 — `llm_provider: pi` dispatches work through the Pi CLI headlessly, every invocation a fresh session, and the step completes with a normal verdict (ADR D5).

As an operator, I want to select Pi for a run or step so that the work is done by Pi and the step completes like any other.

### Acceptance Criteria

#### Happy Path
- Given pi is installed and selected for a step, when the step dispatches, then Pi is spawned with print mode, no session, and JSON mode, with the prompt on stdin.
- Given Pi emits a JSONL stream ending in a terminal assistant message and exits 0, when the adapter parses it, then the invoke result carries that message as output and the step reaches its normal verdict.
- Given Pi reports cumulative usage in the stream, when the invoke result is built, then the usage is attached and the cost is recorded as cost-unmetered.
- Given a step retries after a failure, when Pi is invoked again, then the retry also runs with no session and never resumes a prior one.

#### Negative Paths
- Given Pi exits 0 but the stream contains no terminal assistant message, when the adapter parses it, then the invoke result is a step failure naming the missing terminal message.
- Given a JSONL line is malformed, when the adapter parses the stream, then that line is ignored and the result is still derived from the valid terminal message if present.
- Given the step is aborted by the lifecycle supervisor, when Pi is running, then the Pi subprocess is terminated and the result is an aborted step, not a success.

### Done When
- [ ] `execution/pi-provider.ts` implements only `invoke` and declares `supportsSessionResume` false.
- [ ] A fake Pi subprocess built from Pi's documented `--mode json` event schema and the observed unknown-model stderr drives the default-suite tests; no default-suite test spawns a real Pi.

## Story 6: Pi failures surface as classified signals and drive fallback

**Requirement:** TI-6 — Pi CLI failures surface as the harness's classified provider signals and Pi participates in the candidate-fallback ladder like claude and codex (ADR D5).

As an operator, I want Pi failures classified the same way as other providers so that fallback, auth parking, and model handling behave consistently.

### Acceptance Criteria

#### Happy Path
- Given a ladder of pi then claude, when Pi fails with a run-scope unavailable signal, then the run advances to claude exactly as it would from codex.
- Given Pi reports its unknown-model error on stderr and exits 1, when the adapter classifies it, then the result carries the model-unavailable signal.

#### Negative Paths
- Given the Pi executable disappears after boot, when a step spawns Pi, then ENOENT or exit 127 maps to provider-unavailable with run scope.
- Given Pi exits non-zero with stderr matching no confirmed signature, when the adapter classifies it, then the result is an ordinary step failure with no provider signal set.
- Given Pi exits non-zero with auth-failure or rate-limit output, when the adapter classifies it, then the result is an ordinary step failure with no auth-failure or rate-limited signal set, because no Pi auth or rate-limit signature is anchored in this feature.

### Done When
- [ ] Classification tests cover ENOENT, exit 127, the verified unknown-model signature, and an unmatched non-zero exit.
- [ ] The Pi adapter anchors no auth-failure or rate-limit signature; classifying those is left to a follow-up intake.
- [ ] A fallback test with ladder pi then claude shows claude invoked after a Pi provider-unavailable result.

## Story 7: Live provider coverage enumerates the whole catalog

**Requirement:** TI-7 — live coverage stays complete for every catalog provider regardless of what is installed on the test machine (ADR D7).

As the harness maintainer, I want the live-coverage check to include Pi so that a registered provider can never lack a smoke leg.

### Acceptance Criteria

#### Happy Path
- Given the catalog includes pi, when the live-coverage structural test runs, then it finds a Pi descriptor entry and a Pi live smoke leg.
- Given an external `llm_provider` plugin is registered, when the live-coverage structural test runs, then that plugin is enumerated alongside the catalog ids.
- Given Pi credentials are present and live tests are opted in, when the Pi smoke leg runs, then a trivial Pi step completes through the real CLI.

#### Negative Paths
- Given a test machine without Pi installed, when the live-coverage structural test runs, then it still requires the Pi entry because it enumerates the catalog plus registered plugins, not discovered providers.
- Given Pi credentials are absent, when the live smoke suite runs, then the Pi leg is skipped with a named reason and the default suite makes no real Pi call.

### Done When
- [ ] `engine/live-e2e-providers.ts` is keyed by catalog ids and contains a pi entry.
- [ ] The live-coverage structural test iterates `BUILT_IN_PROVIDERS` together with registered external plugin ids.
