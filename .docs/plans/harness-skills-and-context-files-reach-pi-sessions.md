# Implementation Plan: Harness skills and context files reach Pi sessions like other hosts

**Date:** 2026-09-29
**Design:** .docs/decisions/architecture-review-2026-09-29-harness-skills-and-context-files-reach-pi-sessions.md
**Stories:** .docs/stories/harness-skills-and-context-files-reach-pi-sessions.md
**Conflict check:** Clean as of 2026-09-29

## Summary

A Pi-dispatched step invokes its phase skill with Pi's `/skill:<name>` command. The step is refused before spawning when Pi could not load that skill, and it receives HARNESS.md through `--append-system-prompt` and the project's `.agents/skills` through `--skill`. `bin/install --providers` accepts Pi, and its idempotent readiness check leaves the claude/codex catalog links untouched. 10 tasks.

## Technical Approach

- **Pi syntax lives in the catalog and the adapter (catalog ADR D1).** The Pi descriptor in `src/conductor/src/execution/provider-catalog.ts` changes:
  - `invocationPrefix` becomes `/skill:`.
  - `homeVariable` becomes `PI_CODING_AGENT_DIR` (default home `.pi/agent`), which verified pi 0.84.3 reads.
  - `PROVIDER_CAPABILITY_OWNERS.reviewPolicyCatalog` moves to `#2852`.
  - `renderSkillInvocation` already reads the prefix from the descriptor, so no engine module branches on `pi`.
- **Adapter-owned argv and pre-spawn refusal.** `src/conductor/src/execution/pi-provider.ts` gains:
  - `resolvePiSkill(name, environment)`, a pure resolver. It stat-checks `<root>/<name>/SKILL.md` over the roots non-interactive Pi actually loads: `$PI_CODING_AGENT_DIR/skills` (else `<home>/.pi/agent/skills`), `<home>/.agents/skills`, and `<cwd>/.agents/skills`.
  - An injected `PiEnvironment` seam holding `env`, `homeDir`, and a `stat`-backed filesystem. It defaults to `process.env`, `os.homedir()`, and `node:fs/promises`.
  - `PiProvider.invoke`, which builds its argv once, in the single `invoke` path (one-dispatch-member ADR D7), in this order:
    1. Resolve `<home>/.agents/skills/HARNESS.md` with a following `stat`. When it is missing or dangling, return a run-scope provider-unavailable result.
    2. If the prompt's first whitespace token starts with `/skill:`, resolve that skill. A miss returns the existing unresolved-command classification (`commandUnresolved`, `commandUnresolvedName`), without spawning.
    3. Append `--append-system-prompt <harness path>`, then `--skill <cwd>/.agents/skills` when that path is a directory.
  - The first-token read mirrors `unresolvedCommandName` in `claude-provider.ts` (adr-2026-08-04-unresolved-step-command-fails-by-name D2). It reads the dispatched command and never rewrites the prompt.
- **Engine reuse, no new classification.** Existing machinery handles an unresolved command:
  - `conductor.ts` writes a mechanical HALT naming the command.
  - `runAuxiliaryMember` in `provider-execution.ts` stops retrying.
  - Neither walks the candidate ladder.
  - Pi misses therefore behave exactly like claude's. Because the miss sets no `providerUnavailable`, the run-scope unavailability cache never records Pi for a missing skill.
- **Installer.** `bin/install` changes in these places, all keeping the existing link reconciliation:
  - The `--providers` allowlist, the unsupported-provider message, and the `--help` text gain `pi`.
  - `choose_builtin_provider` offers Pi.
  - `report_selected_provider_readiness` (advisory) and `check_installation` (strict) probe `command -v pi` and `pi --version`.
  - No new catalog link is created, because Pi already reads `~/.agents/skills`.
  - The engine catalog's runtime `readiness` capability stays undeclared for Pi (catalog D6).
- **Pattern hints.**
  - Pi adapter tests follow the existing fake `PiSubprocessFactory` pattern in `src/conductor/test/execution/pi-provider.test.ts`. The new filesystem seam is injected the same way. Search hint: `PiSubprocessFactory`.
  - Installer tests follow the disposable-checkout, `FAKE_HOME`, and `STUBS` pattern in `test/test_install_provider_readiness.sh`. Search hint: `for tool in rtk npm node claude codex uv`.
- **Sequencing with #1885.** The merged #1885 spec (`pi-per-step-model-selection-via-wrapped-providers`, Task 3) also appends `--provider/--model/--thinking` in the same `invoke` argv. Both sets of flags are additive and disjoint, so whichever feature builds second rebases onto the other's argv.
- **Sequencing.**
  - Tasks 1-2 (descriptor), then 3 (resolver), then 4, 6 and 7, chained because they edit the same `invoke`.
  - Task 5 (engine integration) follows 4.
  - Tasks 8-10 (policy check, installer) are independent.

## Prerequisites

- None. There is no config or settings.json schema change. `bin/install --providers` gains a value but no flag, and `bin/install --check` without `--providers` behaves as before.
- Documentation (`docs/guides/multiprovider.md` Pi row, `HARNESS.md` skill-invocation list) is delivered by the `maintain-documentation` step, not by a plan task.

## Tasks

### Task 1: Pi catalog descriptor declares the `/skill:` invocation prefix
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/skill-invocation.test.ts`: render the `build` descriptor for `pi` and expect `/skill:pipeline`; render `architecture_review_as_built` for `pi` and expect `/skill:architecture-review --as-built`; render `renderAuxiliarySkillInvocation('build-review-security', 'pi')` and `renderAuxiliarySkillInvocation('coverage-binding', 'pi')` and expect `/skill:build-review-security` and `/skill:coverage-binding`.
2. Add tests that iterate every `kind: 'skill'` entry of `STEP_SKILL_INVOCATIONS` and assert the claude rendering starts `/<skillName>` and the codex rendering starts `$<skillName>`; that rendering the `attribution_verify` descriptor for `pi` throws `Cannot render an engine-native step as a skill invocation`; and that an unknown plugin id such as `my-plugin` renders `/pipeline`.
3. Verify RED.
4. Implement: set the Pi descriptor's `invocationPrefix` to `/skill:` in `src/conductor/src/execution/provider-catalog.ts`. Do not add a `pi` branch anywhere in `skill-invocation.ts`.
5. Verify GREEN and commit.

**Done when:**
- `renderSkillInvocation` for provider `pi` returns `/skill:pipeline` for the build step and `/skill:architecture-review --as-built` for architecture_review_as_built, with the arguments after the skill name, as asserted in skill-invocation.test.ts.
- `renderAuxiliarySkillInvocation` for provider `pi` returns `/skill:build-review-security` and `/skill:coverage-binding`, each starting with `/skill:` followed by the auxiliary skill name, as asserted in skill-invocation.test.ts.
- For every `kind: 'skill'` entry of `STEP_SKILL_INVOCATIONS`, the claude rendering's first line starts `/<skillName>` and the codex rendering's first line starts `$<skillName>`, unchanged from the pre-change output, as asserted in skill-invocation.test.ts.
- Rendering the engine-native `attribution_verify` descriptor for `pi` throws the existing `Cannot render an engine-native step as a skill invocation` error and returns no prompt, and an unknown plugin id `my-plugin` renders `/pipeline` with the `/` default prefix and no `/skill:` text, as asserted in skill-invocation.test.ts.

**Files:** `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/engine/skill-invocation.test.ts`

**Dependencies:** none

### Task 2: Pi home variable and review-policy capability owner corrected in the catalog
**Story:** 2
**Story:** 7
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/provider-catalog.test.ts`: the Pi descriptor's `homeVariable` is `PI_CODING_AGENT_DIR` and its `defaultHome` is `.pi/agent`; `PROVIDER_CAPABILITY_OWNERS.reviewPolicyCatalog` is `#2852`; `requireProviderCapability('pi', 'reviewPolicyCatalog')` throws `ProviderCapabilityUnsupportedError` whose `owningIntake` is `#2852` and whose message contains `#2852` and not `#1888`; the Pi descriptor still declares neither `reviewPolicyCatalog` nor `readiness`.
2. Extend `src/conductor/test/engine/build-review-policy-catalog.test.ts` so the existing Pi refusal also matches `owningIntake: '#2852'`, keeping its assertions that neither the claude metadata command nor the codex transport runs.
3. Add a step-runners test in `src/conductor/test/engine/step-runners.test.ts`: a built-in rubric lap with candidates pi then claude settles Pi as `providerUnavailable` with `providerInvocationSkipped`, spawns no Pi subprocess, and dispatches claude.
4. Verify RED, implement the two descriptor fields and the owner map entry in `src/conductor/src/execution/provider-catalog.ts`, verify GREEN, and commit.

**Done when:**
- The Pi catalog descriptor declares `homeVariable: 'PI_CODING_AGENT_DIR'` and `defaultHome: '.pi/agent'`, and still declares neither the `reviewPolicyCatalog` nor the `readiness` capability, as asserted in provider-catalog.test.ts.
- `requireProviderCapability('pi', 'reviewPolicyCatalog')` throws `ProviderCapabilityUnsupportedError` with `owningIntake` `#2852` and a message naming intake #2852 and not #1888, and the production review-policy catalog rejects a Pi request with that owner before the claude metadata command or codex transport is called, as asserted in provider-catalog.test.ts and build-review-policy-catalog.test.ts.
- A built-in rubric lap with candidates pi then claude settles the Pi candidate with `providerUnavailable` and `providerInvocationSkipped` set and zero Pi subprocess spawns, then dispatches claude, as asserted in step-runners.test.ts.
- The existing claude and codex review-policy discovery and build-review dispatch tests pass with their expected values unedited.

**Files:** `src/conductor/src/execution/provider-catalog.ts`, `src/conductor/test/execution/provider-catalog.test.ts`, `src/conductor/test/engine/build-review-policy-catalog.test.ts`, `src/conductor/test/engine/step-runners.test.ts`

**Dependencies:** 1

### Task 3: Pi skill-root resolver over the roots non-interactive Pi loads
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` for an exported `resolvePiSkill(name, environment)` with an injected fake `stat` filesystem, `env`, `homeDir`, and `cwd`. It finds `<home>/.agents/skills/<name>/SKILL.md`; `$PI_CODING_AGENT_DIR/skills/<name>/SKILL.md` when that variable is set; `<home>/.pi/agent/skills/<name>/SKILL.md` when it is unset; and `<cwd>/.agents/skills/<name>/SKILL.md`.
2. Add tests that `$PI_HOME/skills/<name>`, `<cwd>/.pi/skills/<name>`, and a skill directory without `SKILL.md` are not found, and that a miss returns the three searched root paths in order.
3. Verify RED.
4. Implement `resolvePiSkill` and the `PiEnvironment` seam in `src/conductor/src/execution/pi-provider.ts`, reading the agent-dir variable and default from the Pi catalog descriptor (`homeVariable`, `defaultHome`) and checking only that `SKILL.md` exists as a file; never parse frontmatter.
5. Verify GREEN and commit.

**Done when:**
- `resolvePiSkill` returns found for a `SKILL.md` under `<home>/.agents/skills/<name>/`, under `$PI_CODING_AGENT_DIR/skills/<name>/` with the variable set, under `<home>/.pi/agent/skills/<name>/` with it unset, and under `<cwd>/.agents/skills/<name>/`, as asserted in pi-provider.test.ts.
- `resolvePiSkill` returns not-found, listing the three searched root paths in order, for a skill present only under `$PI_HOME/skills/<name>/`, only under `<cwd>/.pi/skills/<name>/`, or as a directory with no `SKILL.md`, as asserted in pi-provider.test.ts.
- `resolvePiSkill` reads the agent-dir variable name and default home from the Pi catalog descriptor and checks only that `SKILL.md` exists as a file without reading its frontmatter, as asserted by a fake filesystem that records no file-content read.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 2

### Task 4: Pi invoke refuses an unresolvable skill before spawning
**Story:** 2
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts` driving `PiProvider.invoke` with the fake subprocess factory and a fake environment that always holds `<home>/.agents/skills/HARNESS.md`. A `/skill:pipeline` prompt spawns once for each of the four roots from Task 3. A prompt without a `/skill:` first token spawns once with no skill-root lookup. A `/skill:pipeline` prompt with the skill absent everywhere, only under `$PI_HOME`, only under `<cwd>/.pi/skills`, or as a directory without `SKILL.md` never spawns and returns the unresolved-command result.
2. Add an explicit-only fixture skill whose `SKILL.md` frontmatter carries `disable-model-invocation: true`; `/skill:<fixture>` spawns once.
3. Verify RED.
4. Implement in the single `invoke` path of `src/conductor/src/execution/pi-provider.ts`: take the prompt's first whitespace-delimited token (the same read `unresolvedCommandName` makes in `claude-provider.ts`); when it starts with the Pi descriptor's `invocationPrefix`, call `resolvePiSkill`; on a miss return `{ success: false, commandUnresolved: true, commandUnresolvedName: <name>, output: <message listing the searched roots> }` without calling the subprocess factory and without `providerUnavailable`.
5. Verify GREEN; confirm the claude and codex provider tests pass unedited; commit.

**Done when:**
- With `pipeline` present only under `<home>/.agents/skills/`, only under `$PI_CODING_AGENT_DIR/skills/` with the variable set, only under `<home>/.pi/agent/skills/` with it unset, or only under `<cwd>/.agents/skills/`, `PiProvider.invoke` of a `/skill:pipeline` prompt calls the fake subprocess factory exactly once in each case, as asserted in pi-provider.test.ts.
- A prompt whose first token does not start with `/skill:` makes `PiProvider.invoke` call the fake subprocess factory once and perform no skill-root lookup, as asserted by the fake filesystem call log in pi-provider.test.ts.
- With `pipeline` absent from every root, present only under `$PI_HOME/skills/`, present only under `<cwd>/.pi/skills/`, or present as a directory without `SKILL.md`, `PiProvider.invoke` never calls the fake subprocess factory and returns `success: false`, `commandUnresolved: true`, `commandUnresolvedName: 'pipeline'`, no `providerUnavailable`, and output naming `pipeline` and all three searched roots, as asserted in pi-provider.test.ts.
- An explicit-only fixture skill whose `SKILL.md` frontmatter carries `disable-model-invocation: true` resolves, and `PiProvider.invoke` of `/skill:<fixture>` calls the fake subprocess factory once and is never refused on account of that key, as asserted in pi-provider.test.ts.
- The Pi skill-resolution check runs only inside `PiProvider.invoke`: `resolvePiSkill` has no importer in `src/conductor/src` other than `pi-provider.ts`, and the existing claude and codex provider dispatch tests pass unedited.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 1, 3

### Task 5: Engine settles a Pi unresolved skill without retry or ladder walk
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing tests that drive the real `PiProvider` (fake subprocess factory, fake environment with HARNESS.md but no `pipeline` skill) through the engine's existing unresolved-command paths:
2. In `src/conductor/test/engine/conductor.test.ts`, a build step whose candidates are pi then a fake claude provider: the run writes the mechanical HALT whose reason names `/pipeline` as not available in the provider skill catalog, the fake claude provider is never invoked, the Pi subprocess factory is never called, and no retry of the step occurs.
3. In `src/conductor/test/engine/provider-execution.test.ts`, an auxiliary member `coverage-binding` on pi with an allowance of 2 and a claude second candidate: exactly one Pi adapter attempt, zero claude invocations, and a returned result with `commandUnresolved` and `commandUnresolvedName: 'coverage-binding'`.
4. In `src/conductor/test/engine/provider-execution.test.ts`, after a Pi unresolved-command result in one dispatch, the run-scope provider-unavailable cache holds no entry for pi, and a second dispatch in the same run with a resolvable skill calls the Pi subprocess factory once.
5. Verify RED against the Task 4 adapter, fix any engine consumer that does not honor the Pi-produced classification, verify GREEN, and commit. No new classification or event is introduced.

**Done when:**
- A build step dispatched on pi with a fake claude second candidate and no resolvable `pipeline` skill writes the mechanical HALT whose reason names `/pipeline` as not available in the provider skill catalog, with zero Pi subprocess spawns, zero claude invocations, and no step retry, as asserted in conductor.test.ts.
- An auxiliary `coverage-binding` member on pi with an allowance of 2 and a claude second candidate records exactly one Pi adapter attempt and zero claude invocations, and returns a result keeping `commandUnresolved` with `commandUnresolvedName` `coverage-binding`, as asserted in provider-execution.test.ts.
- After a Pi unresolved-command result, the run-scope provider-unavailable cache holds no pi entry, and a later dispatch in the same run whose skill resolves calls the Pi subprocess factory once, as asserted in provider-execution.test.ts.

**Files:** `src/conductor/test/engine/conductor.test.ts`, `src/conductor/test/engine/provider-execution.test.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/conductor.ts`

**Dependencies:** 4

### Task 6: Pi sessions receive HARNESS.md through the system prompt
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`: with `<home>/.agents/skills/HARNESS.md` resolving to a readable file, the spawned argv contains `--append-system-prompt` immediately followed by `<home>/.agents/skills/HARNESS.md`, including in a cwd that holds neither `AGENTS.md` nor `CLAUDE.md`; with it missing, and with it a symlink to a deleted target, the subprocess factory is never called.
2. Verify RED.
3. Implement in `PiProvider.invoke` (before skill resolution): `stat` the HARNESS.md path (following symlinks); on failure return `{ success: false, providerUnavailable: true, providerUnavailableScope: 'run', providerUnavailableReason }` whose reason names HARNESS.md and `bin/install`; otherwise append `--append-system-prompt <path>`.
4. Verify GREEN; confirm the claude and codex argv tests pass unedited; commit.

**Done when:**
- When `<home>/.agents/skills/HARNESS.md` resolves to a readable file, the argv `PiProvider.invoke` passes to the fake subprocess factory contains `--append-system-prompt` immediately followed by that path, including when the cwd holds neither `AGENTS.md` nor `CLAUDE.md`, as asserted in pi-provider.test.ts.
- When `<home>/.agents/skills/HARNESS.md` does not exist, or is a symlink whose target was removed, `PiProvider.invoke` never calls the fake subprocess factory and returns `providerUnavailable: true` with `providerUnavailableScope: 'run'` and a `providerUnavailableReason` naming HARNESS.md and telling the operator to run `bin/install`, as asserted in pi-provider.test.ts.
- The claude and codex adapter argv tests pass unedited, and no claude or codex spawned argv contains `--append-system-prompt`, as asserted by their existing argv fixtures.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 4

### Task 7: Pi sessions load project `.agents/skills` without trusting the project
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/execution/pi-provider.test.ts`: with `<cwd>/.agents/skills/` a directory, the spawned argv contains `--skill` immediately followed by its absolute path; with no such path, or with it a regular file, the argv contains no `--skill` and the dispatch still spawns; in every case the argv contains neither `--approve` nor `-a`.
2. Verify RED.
3. Implement in `PiProvider.invoke`: after `--append-system-prompt`, append `--skill <absolute cwd>/.agents/skills` only when the fake-able `stat` reports a directory; never append a trust flag.
4. Verify GREEN and commit.

**Done when:**
- When the dispatch cwd contains an `.agents/skills/` directory, the argv `PiProvider.invoke` passes to the fake subprocess factory contains `--skill` immediately followed by that directory's absolute path, as asserted in pi-provider.test.ts.
- When the cwd has no `.agents/skills` path, or `.agents/skills` is a regular file, the spawned argv contains no `--skill` flag and the fake subprocess factory is still called once, so the dispatch is not refused on that account, as asserted in pi-provider.test.ts.
- Across the with-directory, without-directory and regular-file fixtures, no spawned Pi argv contains `--approve` or `-a`, as asserted in pi-provider.test.ts.

**Files:** `src/conductor/src/execution/pi-provider.ts`, `src/conductor/test/execution/pi-provider.test.ts`

**Dependencies:** 6

### Task 8: Invocation-policy check rejects an explicit-only skill missing its model-invocation key
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write a failing mutation case in `test/test_skill_invocation_policy.sh`: copy the catalog to a temp dir, delete the `disable-model-invocation: true` line from an explicit-only skill such as `pipeline`, run `test/check_skill_invocation_policy.sh` against it, and expect a non-zero exit whose output names `pipeline`.
2. Verify RED if the case is not yet present, else confirm it fails for the right reason.
3. Implement: no checker change is expected; if the removal is not reported, make `check_skill_invocation_policy.sh` report zero canonical declarations for an explicit-only skill.
4. Confirm `test/check_skill_invocation_policy.sh` exits 0 on the unmodified shipped catalog, and commit.

**Done when:**
- `test/check_skill_invocation_policy.sh` exits 0 over the unmodified shipped catalog, confirming every explicit-only skill carries its `disable-model-invocation: true` frontmatter line.
- The new mutation case in `test/test_skill_invocation_policy.sh` removes the `disable-model-invocation: true` line from the explicit-only `pipeline` skill and asserts `check_skill_invocation_policy.sh` exits non-zero with output naming `pipeline`.

**Files:** `test/test_skill_invocation_policy.sh`, `test/check_skill_invocation_policy.sh`

**Dependencies:** none

### Task 9: bin/install accepts pi and reports its readiness
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing cases in `test/test_install_provider_readiness.sh` using the disposable checkout with a `FAKE_HOME` and `STUBS` PATH (pattern: `for tool in rtk npm node claude codex uv`), adding a `pi` stub whose `--version` exits 0.
2. The cases: `--providers pi` completes and reports Pi ready; `--providers claude,codex,pi` reports all three; the pseudo-TTY chooser lists Pi; `--check --providers pi` exits 0 after install; without the `pi` stub, `--providers pi` completes with an advisory that Pi is not installed, and `--check --providers pi` exits non-zero naming Pi; `--providers foo` is rejected before any readiness line with an error listing Claude, Codex, and Pi. Update the help-text assertion to the new wording.
3. Verify RED.
4. Implement in `bin/install`: add `pi` to the `--providers` allowlist case, the unsupported-provider message, the usage text, and `choose_builtin_provider`; add a `pi` arm to `report_selected_provider_readiness` (advisory, `command -v pi` and `pi --version`) and to `check_installation` (strict).
5. Verify GREEN and commit.

**Done when:**
- With a `pi` stub on PATH whose `--version` exits 0, `bin/install --providers pi` exits 0 and its readiness output reports Pi as ready from the installer's own PATH and `pi --version` probe while the Pi engine catalog descriptor declares no `readiness` capability, and `bin/install --providers claude,codex,pi` exits 0 reporting Claude, Codex and Pi, as asserted in test_install_provider_readiness.sh.
- The interactive `choose_builtin_provider` prompt lists Pi as a selectable built-in provider, as asserted by the pseudo-TTY case in test_install_provider_readiness.sh.
- After an install with `--providers pi`, `bin/install --check --providers pi` exits 0 with the stub on PATH and exits non-zero naming Pi as the missing provider without it, as asserted in test_install_provider_readiness.sh.
- Without a `pi` executable on PATH, `bin/install --providers pi` still exits 0 and prints an advisory that Pi is not installed, as asserted in test_install_provider_readiness.sh.
- `bin/install --providers foo` exits non-zero before printing any readiness line, with an error listing Claude, Codex, and Pi as the supported built-in providers, as asserted in test_install_provider_readiness.sh.

**Files:** `bin/install`, `test/test_install_provider_readiness.sh`

**Dependencies:** none

### Task 10: Installing Pi support leaves the claude and codex catalog links untouched
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing cases in `test/test_install_provider_readiness.sh`: run `bin/install --providers claude,codex`, capture `find ~/.claude/skills ~/.agents/skills -maxdepth 1 -printf '%p -> %l\n' | sort`, run `bin/install --providers pi` twice, and capture the listing after each run.
2. Add a case that `bin/install --check` with no `--providers` produces the same exit code and output as before, using the existing default-selection assertions.
3. Verify RED if any listing differs; otherwise the case proves the Task 9 change preserved link reconciliation.
4. Implement only if a difference appears: keep the Pi changes out of the catalog-linking loop in `bin/install`.
5. Commit.

**Done when:**
- The sorted `~/.claude/skills` and `~/.agents/skills` link listings with targets captured after a claude,codex install are identical after a first and a second `bin/install --providers pi`, so no skill or HARNESS.md link is created, removed, or repointed, as asserted in test_install_provider_readiness.sh.
- `bin/install --check` run without `--providers` keeps the exit code and default Claude-only selection output asserted by the existing strict-check cases, which pass without edits to their expected values.

**Files:** `test/test_install_provider_readiness.sh`, `bin/install`

**Dependencies:** 9

## Task Dependency Graph

```text
Task 1 <- none
Task 2 <- 1
Task 3 <- 2
Task 4 <- 1, 3
Task 5 <- 4
Task 6 <- 4
Task 7 <- 6
Task 8 <- none
Task 9 <- none
Task 10 <- 9
```

## Integration Points

- After Task 4: a fake-spawner Pi step with a `/skill:` prompt either spawns or returns the unresolved-command result.
- After Task 5: a lifecycle step on Pi with a missing skill halts the run mechanically through `conductor.ts`, and an auxiliary member stops, both without walking the ladder.
- After Task 7: the Pi argv carries HARNESS.md and project skills end to end.
- After Task 9: `bin/install --providers pi` and `bin/install --check --providers pi` work through the real installer entry point.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given pi is the provider for the build step, when the step prompt is rendered, then its first line is `/skill:pipeline`. | 1 | "`renderSkillInvocation` for provider `pi` returns `/skill:pipeline` for the build step and `/skill:architecture-review --as-built` for architecture_review_as_built, with the arguments after the skill name, as asserted in skill-invocation.test.ts." | diff-local |
| Story 1 happy: Given pi is the provider for a skill step with arguments such as architecture_review_as_built, when the step prompt is rendered, then its first line is `/skill:architecture-review --as-built` with the arguments after the skill name. | 1 | "`renderSkillInvocation` for provider `pi` returns `/skill:pipeline` for the build step and `/skill:architecture-review --as-built` for architecture_review_as_built, with the arguments after the skill name, as asserted in skill-invocation.test.ts." | diff-local |
| Story 1 happy: Given pi is a build_review rubric or coverage-binding auxiliary candidate, when the auxiliary skill invocation is rendered, then it starts with `/skill:` followed by the auxiliary skill name. | 1 | "`renderAuxiliarySkillInvocation` for provider `pi` returns `/skill:build-review-security` and `/skill:coverage-binding`, each starting with `/skill:` followed by the auxiliary skill name, as asserted in skill-invocation.test.ts." | diff-local |
| Story 1 negative: Given claude or codex is the provider for any skill step, when the step prompt is rendered, then the first line is unchanged from before this feature (`/<name>` for claude, `$<name>` for codex). | 1 | "For every `kind: 'skill'` entry of `STEP_SKILL_INVOCATIONS`, the claude rendering's first line starts `/<skillName>` and the codex rendering's first line starts `$<skillName>`, unchanged from the pre-change output, as asserted in skill-invocation.test.ts." | diff-local |
| Story 1 negative: Given an engine-native step such as attribution_verify, when a skill invocation is rendered for pi, then rendering fails with the existing engine-native error and no Pi prompt is produced. | 1 | "Rendering the engine-native `attribution_verify` descriptor for `pi` throws the existing `Cannot render an engine-native step as a skill invocation` error and returns no prompt, and an unknown plugin id `my-plugin` renders `/pipeline` with the `/` default prefix and no `/skill:` text, as asserted in skill-invocation.test.ts." | diff-local |
| Story 1 negative: Given a plugin provider id that is not in the built-in catalog, when a skill invocation is rendered for it, then the existing `/` default prefix is used and no Pi syntax leaks to it. | 1 | "Rendering the engine-native `attribution_verify` descriptor for `pi` throws the existing `Cannot render an engine-native step as a skill invocation` error and returns no prompt, and an unknown plugin id `my-plugin` renders `/pipeline` with the `/` default prefix and no `/skill:` text, as asserted in skill-invocation.test.ts." | diff-local |
| Story 2 happy: Given the invoked skill's `SKILL.md` exists under `~/.agents/skills/<name>/`, when a Pi step dispatches, then Pi is spawned. | 4 | "With `pipeline` present only under `<home>/.agents/skills/`, only under `$PI_CODING_AGENT_DIR/skills/` with the variable set, only under `<home>/.pi/agent/skills/` with it unset, or only under `<cwd>/.agents/skills/`, `PiProvider.invoke` of a `/skill:pipeline` prompt calls the fake subprocess factory exactly once in each case, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 happy: Given `PI_CODING_AGENT_DIR` is set and the skill exists only under `$PI_CODING_AGENT_DIR/skills/<name>/`, when a Pi step dispatches, then Pi is spawned. | 4 | "With `pipeline` present only under `<home>/.agents/skills/`, only under `$PI_CODING_AGENT_DIR/skills/` with the variable set, only under `<home>/.pi/agent/skills/` with it unset, or only under `<cwd>/.agents/skills/`, `PiProvider.invoke` of a `/skill:pipeline` prompt calls the fake subprocess factory exactly once in each case, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 happy: Given `PI_CODING_AGENT_DIR` is unset and the skill exists only under `~/.pi/agent/skills/<name>/`, when a Pi step dispatches, then Pi is spawned. | 4 | "With `pipeline` present only under `<home>/.agents/skills/`, only under `$PI_CODING_AGENT_DIR/skills/` with the variable set, only under `<home>/.pi/agent/skills/` with it unset, or only under `<cwd>/.agents/skills/`, `PiProvider.invoke` of a `/skill:pipeline` prompt calls the fake subprocess factory exactly once in each case, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 happy: Given the skill exists only under the dispatch working directory's `.agents/skills/<name>/`, when a Pi step dispatches, then Pi is spawned. | 4 | "With `pipeline` present only under `<home>/.agents/skills/`, only under `$PI_CODING_AGENT_DIR/skills/` with the variable set, only under `<home>/.pi/agent/skills/` with it unset, or only under `<cwd>/.agents/skills/`, `PiProvider.invoke` of a `/skill:pipeline` prompt calls the fake subprocess factory exactly once in each case, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 happy: Given a Pi prompt whose first line does not start with `/skill:`, when it dispatches, then no skill-resolution check runs and Pi is spawned as before. | 4 | "A prompt whose first token does not start with `/skill:` makes `PiProvider.invoke` call the fake subprocess factory once and perform no skill-root lookup, as asserted by the fake filesystem call log in pi-provider.test.ts." | diff-local |
| Story 2 negative: Given the invoked skill exists in none of the Pi skill roots, when a Pi step dispatches, then Pi is not spawned and the result carries the existing unresolved-skill-command classification naming the skill, with output listing every root searched. | 4 | "With `pipeline` absent from every root, present only under `$PI_HOME/skills/`, present only under `<cwd>/.pi/skills/`, or present as a directory without `SKILL.md`, `PiProvider.invoke` never calls the fake subprocess factory and returns `success: false`, `commandUnresolved: true`, `commandUnresolvedName: 'pipeline'`, no `providerUnavailable`, and output naming `pipeline` and all three searched roots, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 negative: Given the skill exists only under the retired `$PI_HOME/skills/<name>/` location, when a Pi step dispatches, then the check does not count it as found and the dispatch is refused. | 4 | "With `pipeline` absent from every root, present only under `$PI_HOME/skills/`, present only under `<cwd>/.pi/skills/`, or present as a directory without `SKILL.md`, `PiProvider.invoke` never calls the fake subprocess factory and returns `success: false`, `commandUnresolved: true`, `commandUnresolvedName: 'pipeline'`, no `providerUnavailable`, and output naming `pipeline` and all three searched roots, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 negative: Given the skill exists only under the working directory's `.pi/skills/<name>/`, which non-interactive Pi ignores for an untrusted project, when a Pi step dispatches, then the dispatch is refused. | 4 | "With `pipeline` absent from every root, present only under `$PI_HOME/skills/`, present only under `<cwd>/.pi/skills/`, or present as a directory without `SKILL.md`, `PiProvider.invoke` never calls the fake subprocess factory and returns `success: false`, `commandUnresolved: true`, `commandUnresolvedName: 'pipeline'`, no `providerUnavailable`, and output naming `pipeline` and all three searched roots, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 negative: Given the skill directory exists but contains no `SKILL.md`, when a Pi step dispatches, then the dispatch is refused. | 4 | "With `pipeline` absent from every root, present only under `$PI_HOME/skills/`, present only under `<cwd>/.pi/skills/`, or present as a directory without `SKILL.md`, `PiProvider.invoke` never calls the fake subprocess factory and returns `success: false`, `commandUnresolved: true`, `commandUnresolvedName: 'pipeline'`, no `providerUnavailable`, and output naming `pipeline` and all three searched roots, as asserted in pi-provider.test.ts." | diff-local |
| Story 2 negative: Given a lifecycle step on Pi is refused for a missing skill and a further provider candidate is configured, when the step settles, then no other provider is invoked, no retry occurs, and the run halts mechanically naming the unresolved skill, exactly as for a claude unresolved command. | 5 | "A build step dispatched on pi with a fake claude second candidate and no resolvable `pipeline` skill writes the mechanical HALT whose reason names `/pipeline` as not available in the provider skill catalog, with zero Pi subprocess spawns, zero claude invocations, and no step retry, as asserted in conductor.test.ts." | diff-local |
| Story 2 negative: Given a coverage-binding auxiliary member on Pi is refused for a missing skill, when the auxiliary executor settles that member, then it makes no further provider attempt and the recorded result keeps the unresolved-command classification. | 5 | "An auxiliary `coverage-binding` member on pi with an allowance of 2 and a claude second candidate records exactly one Pi adapter attempt and zero claude invocations, and returns a result keeping `commandUnresolved` with `commandUnresolvedName` `coverage-binding`, as asserted in provider-execution.test.ts." | diff-local |
| Story 2 negative: Given a Pi dispatch is refused for a missing skill, when the next Pi step of the same run dispatches a skill that does resolve, then Pi is spawned, because the refusal is not recorded as run-wide provider unavailability. | 5 | "After a Pi unresolved-command result, the run-scope provider-unavailable cache holds no pi entry, and a later dispatch in the same run whose skill resolves calls the Pi subprocess factory once, as asserted in provider-execution.test.ts." | diff-local |
| Story 2 negative: Given a claude or codex dispatch, when its skill is missing from every Pi root, then no Pi skill-resolution check runs and the dispatch proceeds unchanged. | 4 | "The Pi skill-resolution check runs only inside `PiProvider.invoke`: `resolvePiSkill` has no importer in `src/conductor/src` other than `pi-provider.ts`, and the existing claude and codex provider dispatch tests pass unedited." | diff-local |
| Story 3 happy: Given the installed skill catalog at `~/.agents/skills/HARNESS.md` resolves to a readable file, when a Pi step dispatches, then the Pi argv includes `--append-system-prompt` followed by that file's path. | 6 | "When `<home>/.agents/skills/HARNESS.md` resolves to a readable file, the argv `PiProvider.invoke` passes to the fake subprocess factory contains `--append-system-prompt` immediately followed by that path, including when the cwd holds neither `AGENTS.md` nor `CLAUDE.md`, as asserted in pi-provider.test.ts." | diff-local |
| Story 3 happy: Given a project with neither `AGENTS.md` nor `CLAUDE.md`, when a Pi step dispatches, then HARNESS.md is still supplied through `--append-system-prompt`. | 6 | "When `<home>/.agents/skills/HARNESS.md` resolves to a readable file, the argv `PiProvider.invoke` passes to the fake subprocess factory contains `--append-system-prompt` immediately followed by that path, including when the cwd holds neither `AGENTS.md` nor `CLAUDE.md`, as asserted in pi-provider.test.ts." | diff-local |
| Story 3 negative: Given `~/.agents/skills/HARNESS.md` does not exist, when a Pi step dispatches, then Pi is not spawned and the result is a run-scope provider-unavailable failure, like a missing Pi executable, whose reason names HARNESS.md and tells the operator to run `bin/install`. | 6 | "When `<home>/.agents/skills/HARNESS.md` does not exist, or is a symlink whose target was removed, `PiProvider.invoke` never calls the fake subprocess factory and returns `providerUnavailable: true` with `providerUnavailableScope: 'run'` and a `providerUnavailableReason` naming HARNESS.md and telling the operator to run `bin/install`, as asserted in pi-provider.test.ts." | diff-local |
| Story 3 negative: Given `~/.agents/skills/HARNESS.md` is a dangling symlink to a removed checkout, when a Pi step dispatches, then Pi is not spawned and the same failure is returned. | 6 | "When `<home>/.agents/skills/HARNESS.md` does not exist, or is a symlink whose target was removed, `PiProvider.invoke` never calls the fake subprocess factory and returns `providerUnavailable: true` with `providerUnavailableScope: 'run'` and a `providerUnavailableReason` naming HARNESS.md and telling the operator to run `bin/install`, as asserted in pi-provider.test.ts." | diff-local |
| Story 3 negative: Given claude or codex is the provider, when a step dispatches, then its argv contains no `--append-system-prompt` added by this feature. | 6 | "The claude and codex adapter argv tests pass unedited, and no claude or codex spawned argv contains `--append-system-prompt`, as asserted by their existing argv fixtures." | diff-local |
| Story 4 happy: Given the dispatch working directory contains `.agents/skills/`, when a Pi step dispatches, then the Pi argv includes `--skill` followed by the absolute path of that directory. | 7 | "When the dispatch cwd contains an `.agents/skills/` directory, the argv `PiProvider.invoke` passes to the fake subprocess factory contains `--skill` immediately followed by that directory's absolute path, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given the dispatch working directory has no `.agents/skills/` directory, when a Pi step dispatches, then the argv contains no `--skill` flag and the dispatch is not refused on that account. | 7 | "When the cwd has no `.agents/skills` path, or `.agents/skills` is a regular file, the spawned argv contains no `--skill` flag and the fake subprocess factory is still called once, so the dispatch is not refused on that account, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given any Pi dispatch, when its argv is built, then it never contains `--approve` or `-a`, so project-local Pi extensions and settings stay untrusted. | 7 | "Across the with-directory, without-directory and regular-file fixtures, no spawned Pi argv contains `--approve` or `-a`, as asserted in pi-provider.test.ts." | diff-local |
| Story 4 negative: Given `.agents/skills` in the working directory is a regular file rather than a directory, when a Pi step dispatches, then no `--skill` flag is added for it. | 7 | "When the cwd has no `.agents/skills` path, or `.agents/skills` is a regular file, the spawned argv contains no `--skill` flag and the fake subprocess factory is still called once, so the dispatch is not refused on that account, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 happy: Given a shipped skill whose `SKILL.md` frontmatter carries `disable-model-invocation: true`, when a Pi step invokes it explicitly with `/skill:<name>`, then the resolution check finds it and Pi is spawned. | 4 | "An explicit-only fixture skill whose `SKILL.md` frontmatter carries `disable-model-invocation: true` resolves, and `PiProvider.invoke` of `/skill:<fixture>` calls the fake subprocess factory once and is never refused on account of that key, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 happy: Given the skill invocation-policy integrity check, when it runs over the shipped catalog, then every explicit-only skill still carries the `disable-model-invocation: true` frontmatter that Pi honors. | 8 | "`test/check_skill_invocation_policy.sh` exits 0 over the unmodified shipped catalog, confirming every explicit-only skill carries its `disable-model-invocation: true` frontmatter line." | diff-local |
| Story 5 negative: Given the skill-resolution check, when it evaluates an explicit-only skill, then it does not refuse the dispatch because of the `disable-model-invocation` key. | 4 | "An explicit-only fixture skill whose `SKILL.md` frontmatter carries `disable-model-invocation: true` resolves, and `PiProvider.invoke` of `/skill:<fixture>` calls the fake subprocess factory once and is never refused on account of that key, as asserted in pi-provider.test.ts." | diff-local |
| Story 5 negative: Given a shipped explicit-only skill with its `disable-model-invocation: true` line removed, when the invocation-policy integrity check runs, then it fails naming that skill. | 8 | "The new mutation case in `test/test_skill_invocation_policy.sh` removes the `disable-model-invocation: true` line from the explicit-only `pipeline` skill and asserts `check_skill_invocation_policy.sh` exits non-zero with output naming `pipeline`." | diff-local |
| Story 6 happy: Given `pi` is on PATH and `pi --version` exits 0, when `bin/install --providers pi` runs, then it completes successfully and the installer's own readiness report shows Pi as ready, independent of the engine catalog's runtime readiness capability. | 9, 2 | "With a `pi` stub on PATH whose `--version` exits 0, `bin/install --providers pi` exits 0 and its readiness output reports Pi as ready from the installer's own PATH and `pi --version` probe while the Pi engine catalog descriptor declares no `readiness` capability, and `bin/install --providers claude,codex,pi` exits 0 reporting Claude, Codex and Pi, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 happy: Given `pi` is on PATH, when `bin/install --providers claude,codex,pi` runs, then all three are reported and the install completes successfully. | 9 | "With a `pi` stub on PATH whose `--version` exits 0, `bin/install --providers pi` exits 0 and its readiness output reports Pi as ready from the installer's own PATH and `pi --version` probe while the Pi engine catalog descriptor declares no `readiness` capability, and `bin/install --providers claude,codex,pi` exits 0 reporting Claude, Codex and Pi, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 happy: Given the interactive provider chooser, when it is shown, then Pi appears as a selectable built-in provider. | 9 | "The interactive `choose_builtin_provider` prompt lists Pi as a selectable built-in provider, as asserted by the pseudo-TTY case in test_install_provider_readiness.sh." | diff-local |
| Story 6 happy: Given `pi` is on PATH and the install already ran with `--providers pi`, when `bin/install --check --providers pi` runs, then it exits 0. | 9 | "After an install with `--providers pi`, `bin/install --check --providers pi` exits 0 with the stub on PATH and exits non-zero naming Pi as the missing provider without it, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 happy: Given a completed `bin/install --providers pi`, when it runs a second time, then no skill or HARNESS.md link under `~/.claude/skills` or `~/.agents/skills` is created, removed, or repointed. | 10 | "The sorted `~/.claude/skills` and `~/.agents/skills` link listings with targets captured after a claude,codex install are identical after a first and a second `bin/install --providers pi`, so no skill or HARNESS.md link is created, removed, or repointed, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 negative: Given `pi` is not on PATH, when `bin/install --providers pi` runs, then the install still completes and prints an advisory that Pi is not installed. | 9 | "Without a `pi` executable on PATH, `bin/install --providers pi` still exits 0 and prints an advisory that Pi is not installed, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 negative: Given `pi` is not on PATH, when `bin/install --check --providers pi` runs, then it exits non-zero naming Pi as the missing provider. | 9 | "After an install with `--providers pi`, `bin/install --check --providers pi` exits 0 with the stub on PATH and exits non-zero naming Pi as the missing provider without it, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 negative: Given an unsupported value such as `--providers foo`, when `bin/install` runs, then it is rejected before any readiness check with an error listing Claude, Codex, and Pi as the supported built-in providers. | 9 | "`bin/install --providers foo` exits non-zero before printing any readiness line, with an error listing Claude, Codex, and Pi as the supported built-in providers, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 negative: Given existing `~/.claude/skills` and `~/.agents/skills` link sets from a claude and codex install, when `bin/install --providers pi` runs, then the listing of both directories with link targets is identical before and after. | 10 | "The sorted `~/.claude/skills` and `~/.agents/skills` link listings with targets captured after a claude,codex install are identical after a first and a second `bin/install --providers pi`, so no skill or HARNESS.md link is created, removed, or repointed, as asserted in test_install_provider_readiness.sh." | diff-local |
| Story 6 negative: Given the daemon freshness check, when it runs `bin/install --check` without `--providers`, then its result is unchanged by this feature. | 10 | "`bin/install --check` run without `--providers` keeps the exit code and default Claude-only selection output asserted by the existing strict-check cases, which pass without edits to their expected values." | diff-local |
| Story 7 happy: Given pi is a build_review candidate, when the lap checks the review-policy catalog capability, then the refusal message names intake #2852. | 2 | "`requireProviderCapability('pi', 'reviewPolicyCatalog')` throws `ProviderCapabilityUnsupportedError` with `owningIntake` `#2852` and a message naming intake #2852 and not #1888, and the production review-policy catalog rejects a Pi request with that owner before the claude metadata command or codex transport is called, as asserted in provider-catalog.test.ts and build-review-policy-catalog.test.ts." | diff-local |
| Story 7 negative: Given pi is a build_review candidate, when the lap runs, then Pi is still refused before spawning and the ladder proceeds exactly as before this feature. | 2 | "A built-in rubric lap with candidates pi then claude settles the Pi candidate with `providerUnavailable` and `providerInvocationSkipped` set and zero Pi subprocess spawns, then dispatches claude, as asserted in step-runners.test.ts." | diff-local |
| Story 7 negative: Given claude or codex is a build_review candidate, when the lap runs, then review-policy discovery and dispatch are unchanged. | 2 | "The existing claude and codex review-policy discovery and build-review dispatch tests pass with their expected values unedited." | diff-local |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Every task has a `Done when:` block of falsifiable checks
- [x] Dependencies are explicit and acyclic
