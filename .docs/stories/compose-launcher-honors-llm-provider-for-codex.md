**Status:** Accepted

# Stories: Compose launcher honors llm_provider for Codex

Technical track, so there is no PRD. Requirements come from three sources: issue
jstoup111/ai-conductor#1007; the operator-confirmed scope boundary in
`.docs/track/compose-launcher-honors-llm-provider-for-codex.md`; and the APPROVED amendment D9–D11
to adr-2026-09-24-built-in-provider-catalog-and-boot-discovery.

## Story 1: The launcher selects its host by an explicit precedence

**Requirement:** TI-1. The bare launcher picks its interactive host from `--provider`, then the
first entry of the provider selection that the merged configuration resolves for the `explore` step,
then the catalog default. It never falls back to a later ladder entry (ADR D10).

As an operator who runs Codex, I want `ai-conductor compose` to open the host my project assigns to
DECIDE, so that the idea→spec loop starts on the right host without a Claude install.

### Acceptance Criteria

#### Happy Path
- Given no `--provider` flag and no `llm_provider` configured at user or project level, when the operator runs bare `ai-conductor compose`, then the catalog default provider claude is launched.
- Given the launching directory configures run-level `llm_provider: codex` with no `explore` step pin and no flag is passed, when the operator runs bare `ai-conductor compose`, then codex is launched.
- Given the launching directory configures run-level `llm_provider: [codex, claude]` and pins `steps.explore.llm_provider: claude`, when the operator runs bare `ai-conductor compose`, then claude is launched.
- Given the launching directory configures run-level `llm_provider: [codex, claude]` with no `explore` step pin, when the operator runs bare `ai-conductor compose`, then codex, the first entry, is launched.
- Given the user-level configuration sets `llm_provider: codex` and the project sets no `llm_provider`, when the operator runs bare `ai-conductor compose` in that project, then codex is launched.
- Given the configuration resolves codex for `explore`, when the operator runs `ai-conductor compose --provider claude`, then claude is launched and the configured value is ignored.
- Given the configuration resolves claude for `explore`, when the operator runs the deprecated alias `ai-conductor engineer --provider codex`, then codex is launched exactly as under `compose`.

#### Negative Paths
- Given the operator passes `--provider gemini`, which is not a catalog id, when the launcher resolves its host, then it exits non-zero with the existing unknown-provider error naming gemini and spawns nothing.
- Given the operator passes `--provider` with no value, when the launcher parses its arguments, then it exits non-zero with a usage error naming `--provider` and spawns nothing.
- Given the launching directory's configuration fails to load or validate, when the operator runs bare `ai-conductor compose` with no flag, then it exits non-zero with the existing configuration error and spawns nothing.
- Given the configuration resolves codex for `explore` and codex is missing while claude is installed, when the launcher resolves its host, then it does not fall back to claude or to any later ladder entry.

### Done When
- [ ] A test with a stubbed spawn boundary shows each happy-path precedence case launches the expected catalog executable.
- [ ] A test shows the `explore` step pin wins over a run-level ladder whose first entry differs.
- [ ] A test shows an unknown `--provider` value exits non-zero with the unknown-provider message and records zero spawn calls.

## Story 2: Each host is launched with its own argv from the catalog

**Requirement:** TI-2. Each host is launched with the argv its catalog descriptor declares under
`interactiveLaunch`. A host without that capability is refused by name (ADR D9).

As an operator, I want the launched session to open the composer skill in that host's own
invocation syntax, so that the loop starts immediately on either host.

### Acceptance Criteria

#### Happy Path
- Given claude is selected and `CONDUCT_ENGINEER_PERMISSION_MODE` is unset, when the launcher spawns, then the argv is `--permission-mode default /composer`.
- Given claude is selected and the operator passed `--idea "add retries"`, when the launcher spawns, then the final argv element is `/composer add retries`.
- Given codex is selected and the operator passed `--idea "add retries"`, when the launcher spawns, then the argv is exactly one positional prompt `$composer add retries`, with no sandbox, approval, or model flags.
- Given codex is selected and no idea is passed, when the launcher spawns, then the argv is exactly one positional prompt `$composer`.

#### Negative Paths
- Given `llm_provider: pi` is configured with `llm_providers.pi.model`, `model_escalation_order` and `model_fallback_ladder` set and pi does not declare `interactiveLaunch`, when the operator runs bare `ai-conductor compose`, then it exits non-zero with a message naming pi, `interactiveLaunch`, and #1007, and spawns nothing.
- Given claude is selected and `CONDUCT_ENGINEER_PERMISSION_MODE=plan`, when the launcher spawns, then the argv carries `--permission-mode default`, as it does today.
- Given production source outside the catalog and adapter modules, when the provider-id-literal structural test runs, then the compose launcher module contains no built-in provider id literal.

### Done When
- [ ] The claude and codex descriptors declare `interactiveLaunch`, and the pi descriptor does not.
- [ ] Tests assert the exact claude and codex argv arrays for both the no-idea and with-idea cases.
- [ ] A test asserts that selecting pi raises the capability refusal and records zero spawn calls.

## Story 3: A missing host executable fails with an actionable message

**Requirement:** TI-3. The launcher resolves only the selected host's executable, runs no boot
discovery, and reports a missing binary explicitly with no fallback (ADR D11).

As a Codex-only operator, I want a clear error when the selected host binary is absent, so that I
know how to fix it instead of seeing a raw spawn failure.

### Acceptance Criteria

#### Happy Path
- Given codex is selected and `CODEX_EXECUTABLE` is set to an absolute path, when the launcher spawns, then that path is the spawned executable.
- Given claude is selected and `CLAUDE_EXECUTABLE` is unset, when the launcher spawns, then the executable is `claude` resolved from `PATH`.

#### Negative Paths
- Given codex is selected and the spawn fails with ENOENT, when the launcher handles the failure, then it exits non-zero with a message naming codex, the executable `codex`, the override `CODEX_EXECUTABLE`, and the in-session alternative `$composer`.
- Given codex is selected and missing while claude is installed, when the spawn fails with ENOENT, then no claude session is spawned as a fallback.
- Given any host is selected, when the launcher starts, then no provider version probe or boot discovery runs before the single spawn.

### Done When
- [ ] A test injecting an ENOENT spawn error asserts the exit code is non-zero and the message contains the provider id, the executable name, the override env var name, and the in-session invocation.
- [ ] A test asserts the spawn stub is called exactly once and the discovery stub is never called.

## Story 4: The launcher refuses to nest inside any capable host session

**Requirement:** TI-4. When the launcher runs inside a session of any host that declares
`interactiveLaunch`, it tells the operator to invoke the skill in place and launches nothing
(ADR D9, D11). The existing `gh` version floor (adr-2026-09-05) still runs first, so with `gh`
missing or below the floor the launcher exits 1 before this guard; the exit-0 outcomes below assume
`gh` passes it.

As an operator already inside Claude Code or Codex, I want the launcher to point me at the
in-session command, so that I do not end up with a nested interactive session.

### Acceptance Criteria

#### Happy Path
- Given `CLAUDECODE` is set in the environment and `gh` passes the launcher's version floor, when the operator runs bare `ai-conductor compose`, then it prints that `/composer` should be run directly, exits 0, and spawns nothing.
- Given `CODEX_THREAD_ID` is set in the environment and `gh` passes the launcher's version floor, when the operator runs bare `ai-conductor compose`, then it prints that `$composer` should be run directly, exits 0, and spawns nothing.
- Given no session marker of any capable host is set, when the operator runs bare `ai-conductor compose`, then the selected host is launched.

#### Negative Paths
- Given only `CODEX_SESSION_ID` is set, when the operator runs bare `ai-conductor compose`, then it still refuses to nest, names `$composer`, and spawns nothing.
- Given `CODEX_THREAD_ID` is set and `--provider claude` is passed, when the operator runs bare `ai-conductor compose`, then it refuses to nest because the operator is inside a codex session, and spawns nothing.
- Given a session marker is set, when the launcher refuses to nest, then the intake pre-poll does not run and no GitHub issue is fetched or enqueued.

### Done When
- [ ] Tests cover the `CLAUDECODE`, `CODEX_THREAD_ID`, and `CODEX_SESSION_ID` markers, each asserting exit 0, the host-specific in-session invocation text, zero spawn calls, and zero intake pre-poll calls.

## Story 5: Follow-on ideas relaunch on the same host

**Requirement:** TI-5. The existing one-fresh-session-per-idea loop keeps the host selected at the
start of the run for every later session (ADR D10).

As a Codex operator working through several ideas, I want each fresh session to open on Codex, so
that the loop does not switch hosts mid-run.

### Acceptance Criteria

#### Happy Path
- Given codex was selected and the first session exits 0, when the operator accepts launching another idea, then the second spawn is codex with `$composer` and no CLI idea appended.

#### Negative Paths
- Given codex was selected and the second spawn fails with ENOENT, when the launcher handles it, then it exits non-zero with the same missing-executable message and does not prompt for another idea.
- Given codex was selected and the operator declines another idea, when the first session exits, then no second spawn occurs and the launcher exits with the first session's exit code.

### Done When
- [ ] A test driving two loop iterations asserts that both spawn calls use the codex executable and that the second prompt is exactly `$composer`.
