# Implementation Plan: Daemon merged configuration (#967)

**Date:** 2026-07-26
**Design:** `.docs/track/daemon-merged-config-967.md`
**Architecture:** `.docs/decisions/architecture-review-2026-07-26-daemon-merged-config-967.md`
**Stories:** `.docs/stories/daemon-merged-config-967.md`
**Conflict check:** Clean as of 2026-07-26

## Summary

Replace the daemon runtime composition root's project-only config read with the existing merged-config boundary, then lock down user inheritance, project precedence, failure diagnostics, and entry-path compatibility in four focused TDD tasks. No other config consumer or source boundary is redesigned.

## Technical Approach

- In `runDaemonMode`, consume `loadMergedConfig(projectRoot)` exactly once before runtime construction. Thread its already-validated `HarnessConfig` through the existing provider, model/effort, auth, memory, plugin, backlog, and conductor paths unchanged.
- Reuse `loadMergedConfig`'s established semantics: validate raw project input first; read and validate user input; deep-merge project over user; validate the effective result. Do not create a daemon-specific merge or change `mergeConfigs`.
- Extend daemon startup tests with isolated user/project fixtures or module seams so assertions observe the effective config/provider selection before feature execution. Avoid real LLM, tmux, GitHub, or backlog work.
- Retain intentional source-specific paths: user-only owner identity, project-only full-suite evidence configuration, and config-free read-only daemon management.

## Verified Planning Claims

| Claim | Confidence | Evidence |
|---|---:|---|
| One production loader substitution reaches all daemon SDLC execution. | 99% | `runDaemonMode` loads config before plugin/provider construction and passes the same object into every provider execution context and `Conductor`; all daemon launch paths converge there. |
| Project-over-user precedence needs no new implementation. | 99% | `loadMergedConfig` composes `mergeConfigs(user, project)`; table tests already cover nested objects, scalar replacement, and array replacement. |
| Raw project anti-leak validation remains effective. | 99% | `loadMergedConfig` calls project-only `loadConfig` before merging and returns its error unchanged. |
| User parse errors can be scope-specific and fail before dispatch. | 99% | `loadMergedConfig` returns `user config parse error: ...`; `runDaemonMode` checks config before install freshness, lock ownership, and backlog discovery. |
| Supervisor-specific config loading is unnecessary. | 98% | `daemon start` launches the foreground daemon command; direct dispatch and self-respawn call `runDaemonMode` through `index.ts`. |

No unconfirmed load-bearing assumption changes the task breakdown.

## Prerequisites

- Preserve `mergeConfigs`, project-over-user precedence, raw-project validation, and the machine-identity anti-leak boundary.
- Do not invoke an LLM, tmux daemon, GitHub mutation, or real backlog dispatch from focused tests.
- Do not convert unrelated `loadConfig` consumers.

## Tasks

### Task 1: Inherit user runtime configuration at daemon startup

**Story:** Story 1 — user-only provider and nested runtime-policy happy paths
**Type:** happy-path

**Steps:**
1. Write failing daemon-startup tests whose isolated user config selects Codex and supplies representative nested runtime policy while project config omits those keys; observe the effective provider/config before feature dispatch.
2. Verify the focused tests fail because `runDaemonMode` reads project config only.
3. Change the daemon composition root to consume the existing merged config result and preserve the existing config threading.
4. Verify Codex is first and representative user-only nested keys survive.
5. Commit with message: `fix(daemon): inherit user runtime configuration`

**Files:** `src/conductor/src/daemon-cli.ts`; `src/conductor/test/engine/daemon-cli-config-resolution.test.ts`
**Wired-into:** `src/conductor/src/daemon-cli.ts#runDaemonMode`
**Dependencies:** none

### Task 2: Preserve exact project-over-user precedence

**Story:** Story 2 — project provider override, nested merge, scalar/array replacement, and raw-project validation
**Type:** happy-path

**Steps:**
1. Add failing daemon-boundary tests for project Claude over user Codex, nested project overrides that retain unrelated user keys, and project array/scalar replacement.
2. Verify the tests fail against the project-only daemon boundary because unrelated user keys disappear.
3. Refine only the startup/test seam needed to observe the effective config; do not alter `mergeConfigs` semantics.
4. Add a raw-project anti-leak/validation assertion proving project validation still precedes merging; verify the complete precedence matrix passes.
5. Commit with message: `test(daemon): preserve project config precedence`

**Files:** `src/conductor/test/engine/daemon-cli-config-resolution.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 3: Fail closed on invalid user runtime policy

**Story:** Story 1 — malformed user config and unknown user-only provider negative paths
**Type:** negative-path

**Steps:**
1. Add failing startup tests for malformed user YAML, user-only unknown provider selection, and invalid raw project configuration.
2. Verify malformed user policy is currently ignored while the project error path remains intact.
3. Preserve scope-qualified merged-loader errors through the existing `Config error:` startup boundary and ensure provider validation runs on the effective config before discovery.
4. Verify every invalid case fails before install/backlog/feature dispatch and names the relevant scope or field.
5. Commit with message: `fix(daemon): reject invalid effective configuration`

**Files:** `src/conductor/src/daemon-cli.ts`; `src/conductor/test/engine/daemon-cli-config-validation.test.ts`; `src/conductor/test/engine/daemon-cli-config-resolution.test.ts`
**Wired-into:** same as Task 1
**Dependencies:** Task 2

### Task 4: Prove launch compatibility and source-boundary containment

**Story:** Story 3 — direct/supervised convergence, no-user/default compatibility, and intentional source-specific exclusions
**Type:** negative-path

**Steps:**
1. Add or extend focused assertions that direct and supervisor-started execution target the same daemon runtime, no-user project-only config is unchanged, and no-provider config retains the current default.
2. Verify the launch/default assertions pass only through the merged composition root.
3. Inspect the implementation diff and assert no production loader changes occurred in owner identity, read-only daemon management, or full-suite evidence paths; add a narrow wiring regression only where an existing executable assertion is available.
4. Run config, provider-selection, daemon startup, supervisor wiring, and TypeScript checks.
5. Commit with message: `test(daemon): contain merged config to runtime startup`

**Files:** `src/conductor/test/engine/daemon-cli-config-resolution.test.ts`; `src/conductor/test/engine/daemon-restart-wiring.test.ts`; `src/conductor/test/engine/daemon-supervisor-cli.test.ts`
**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** Task 3

## Task Dependency Graph

```text
Task 1 → Task 2 → Task 3 → Task 4
```

## Integration Points

- After Task 1: user-only effective policy reaches daemon runtime construction.
- After Task 2: the full user-under-project precedence contract is protected at the daemon boundary.
- After Task 3: invalid policy from either scope blocks before autonomous work.
- After Task 4: all daemon launches and compatibility cases are verified without widening source boundaries.

## Coverage Check

| Story | Task(s) | Acceptance coverage |
|---|---|---|
| 1 | 1, 3 | User-only provider/nested settings plus malformed and unknown user policy. |
| 2 | 2 | Project precedence, replacement semantics, and invalid raw-project handling. |
| 3 | 4 | Launch convergence, backward-compatible defaults, and source-boundary containment. |

## Verification

- [x] All happy-path criteria map to at least one task.
- [x] All negative-path criteria map to an explicit task.
- [x] Tasks are bounded TDD increments with an explicit dependency chain.
- [x] Production wiring derives from the architecture review's `runDaemonMode` composition-root seam.
- [x] No task introduces a new configuration schema, precedence rule, or broad loader migration.
