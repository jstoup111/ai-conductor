**Status:** Accepted

# Stories: Daemon merged configuration (#967)

## Story 1: Daemon inherits machine-scoped runtime policy

**Requirement:** Technical intent — user-scoped daemon settings remain effective when the project does not override them.

As a daemon operator, I want unattended execution to inherit my machine-scoped runtime policy so it uses my selected provider and associated settings without requiring a risky repository-local duplicate.

### Acceptance Criteria

#### Happy Path

- Given user configuration selects `llm_provider: codex` and project configuration omits `llm_provider`, when the daemon constructs its provider execution context, then Codex is the first configured provider.
- Given user configuration supplies other valid runtime policy such as nested default/step settings, build authentication, or a memory-provider selection and the project omits those keys, when the daemon constructs its runtime, then the effective configuration retains those user values.

#### Negative Paths

- Given user configuration is malformed YAML, when the daemon starts, then it fails before backlog dispatch with an actionable configuration error that identifies user configuration.
- Given a user-only provider selection names an unregistered provider, when the daemon starts, then provider validation rejects it before backlog dispatch rather than falling back silently.

### Done When

- [ ] A daemon startup regression test observes Codex as the first configured provider from user-only configuration.
- [ ] Tests prove representative user-only nested runtime settings reach the daemon's effective configuration.
- [ ] Malformed and invalid user-scoped settings fail before any feature dispatch with scope-specific diagnostics.

## Story 2: Project policy retains precise precedence

**Requirement:** Technical intent — project configuration overrides user configuration under the established merge contract.

As a project maintainer, I want repository policy to override operator defaults only where the project explicitly declares values so shared project constraints remain authoritative without erasing unrelated machine defaults.

### Acceptance Criteria

#### Happy Path

- Given user configuration selects Codex and project configuration selects Claude, when the daemon constructs provider execution, then Claude is first and the user provider does not override it.
- Given user and project configuration contain different keys inside the same nested runtime object, when the daemon starts, then project keys override matching user keys while unrelated user keys remain present.

#### Negative Paths

- Given project configuration supplies a scalar or array for a key also present in user configuration, when effective configuration is formed, then the project value replaces the user value rather than concatenating or index-merging it.
- Given raw project configuration violates a source-specific guard or validation rule, when the daemon starts, then merging does not launder that invalid project value into a valid effective configuration.

### Done When

- [ ] Daemon-boundary tests prove project provider selection overrides user selection.
- [ ] Nested-object and scalar/array precedence remain identical to `mergeConfigs` semantics.
- [ ] Raw project validation still runs before merging and remains fail-closed.

## Story 3: Every daemon launch uses one effective-config boundary

**Requirement:** Technical intent — direct, supervised, and restarted daemon execution stay behaviorally consistent without a broad config redesign.

As an operator, I want every way of launching the daemon to reach the same configuration boundary so provider and runtime policy do not depend on whether the process is foreground, supervised, or respawned.

### Acceptance Criteria

#### Happy Path

- Given a direct foreground daemon launch or a supervisor-started daemon launch, when execution begins, then both reach `runDaemonMode` and consume the same merged runtime configuration.
- Given no user configuration exists and a valid project configuration is present, when the daemon starts, then its effective runtime behavior is unchanged from the project-only configuration.

#### Negative Paths

- Given neither scope selects an LLM provider, when the daemon starts, then the existing default-provider behavior remains unchanged.
- Given a config consumer is intentionally source-specific—machine identity, read-only daemon management, or project-owned full-suite evidence—when #967 is implemented, then that consumer is not indiscriminately converted to merged configuration.

### Done When

- [ ] Existing dispatch wiring proves supervised and direct launches converge on `runDaemonMode`.
- [ ] Regression tests cover no-user and no-provider compatibility.
- [ ] The implementation diff remains localized to the daemon runtime composition root and its focused tests.
