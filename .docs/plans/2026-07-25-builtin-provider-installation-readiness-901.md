# Implementation Plan: Built-In Provider Installation and Readiness

**Date:** 2026-07-25  
**Design:** [Built-In Provider Installation and Readiness](../specs/2026-07-25-builtin-provider-installation-readiness-901.md)  
**Stories:** [Built-In Provider Installation and Readiness](../stories/builtin-provider-installation-readiness-901.md)  
**Conflict check:** Skipped — Small tier

## Summary

Make normal TTY `bin/install` prompt for the built-in providers it should prepare,
with a comma-separated `--providers` option as the explicit/scriptable override
for install and strict `--check` modes. The installer will continue to create both
provider surfaces for every selection, while required CLI readiness is advisory
during installation and fatal during an explicit check. Five focused tasks cover
the installer behavior and preserve existing runtime provider routing.

## Technical Approach

`bin/install` remains the only production implementation surface. It will parse
the complete argument list before mode dispatch, validate names against the built-in
`claude`/`codex` set, and use an explicit list whenever supplied. A normal install
with a TTY and no explicit list prompts for Claude, Codex, or both before setup;
the omitted non-interactive case defaults to `claude`. A shared provider-readiness
helper will report each selected CLI independently. Normal installation calls it in
advisory mode after the existing dual-surface setup; `--check` calls it in strict
mode alongside its existing common installation checks. The selection does not
read or write project `llm_provider`, so runtime routing remains unchanged.

The plan starts with a real-binary shell fixture, following the repository's
throwaway-`HOME` installer-test pattern. Tests exercise the external `claude` and
`codex` boundaries through stub executables rather than depending on a developer's
machine state.

## Prerequisites

- Run installer tests with an isolated `HOME`, stubbed `claude`, `codex`, and
  `conduct-ts` executables. Use `script` to feed pseudo-TTY prompt answers and
  closed standard input for non-interactive default cases.
- Preserve the existing worktree-root guard by passing `--allow-worktree-root`
  only inside hermetic test fixtures.

## Tasks

### Task 901-1: Add RED coverage for built-in readiness selection

**Story:** ST-901-1 explicit selection, Claude default, and unsupported-provider rejection (FR-1, FR-2, FR-12, FR-13)  
**Type:** happy-path and negative-path

**Steps:**

1. Write `test/test_install_provider_readiness.sh` using a throwaway `HOME` and
   path-prepended stub binaries to invoke the real `bin/install`; use `script` to
   feed an interactive selection answer through a pseudo-TTY.
2. Add failing assertions that a normal interactive install offers Claude, Codex,
   and both choices; an omitted non-interactive selection requires Claude;
   `--providers claude`, `--providers codex`, and `--providers claude,codex`
   select exactly those built-in CLIs without prompting; and an unknown name fails
   before reporting readiness while listing Claude and Codex.
3. Run the new script and verify these selection assertions are RED against the
   current argument parser.
4. Keep the fixture reusable for installation and `--check` cases in subsequent
   tasks.
5. Commit with message: `test: specify installer provider selection`.

**Files:** `test/test_install_provider_readiness.sh`  
**Wired-into:** none (no new production surface)  
**Dependencies:** none

### Task 901-2: Parse and validate the installer provider list

**Story:** ST-901-1 selection and default behavior (FR-1, FR-2, FR-12, FR-13)  
**Type:** happy-path and negative-path

**Steps:**

1. Use the RED fixture from Task 901-1 to verify failures for every supported
   scalar/combined selection and an unsupported name.
2. Implement whole-argument parsing for `--providers <comma-separated-list>` so
   it composes with normal installation, `--update`, and `--check` regardless of
   argument order.
3. When normal installation has a TTY and no explicit list, prompt for Claude,
   Codex, or both before setup. Preserve the explicit-list bypass and normalize an
   omitted non-interactive list to `claude`; validate every requested name against
   the built-in `{claude,codex}` set; emit an actionable error naming both choices
   before any readiness report for invalid input.
4. Re-run selection cases and verify GREEN for each prompt answer, explicit option,
   and the unchanged non-interactive Claude default.
5. Commit with message: `feat: select built-in installer providers`.

**Files:** `bin/install`; `test/test_install_provider_readiness.sh`  
**Wired-into:** `bin/install#main`  
**Dependencies:** Task 901-1

### Task 901-3: Report selected CLI readiness without blocking installation

**Story:** ST-901-2 and ST-901-3 dual-surface installation plus advisory readiness (FR-3, FR-4, FR-5, FR-6, FR-7)  
**Type:** happy-path and negative-path

**Steps:**

1. Extend the fixture with failing normal-install assertions that every provider
   selection creates both Claude and Codex skill/instruction surfaces, reports
   each selected CLI by provider name, and returns success when one or both
   selected CLI stubs are absent.
2. Implement a shared, provider-named CLI probe with an actionable installation
   remedy for a missing required CLI.
3. Invoke the probe after the existing dual-client surface installation, retaining
   advisory exit behavior so absence never prevents common or either provider
   surface from being established.
4. Verify GREEN for Claude-only, Codex-only, combined, and omitted selection;
   confirm combined output still reports the available provider when the other is
   missing.
5. Commit with message: `feat: report installer provider readiness`.

**Files:** `bin/install`; `test/test_install_provider_readiness.sh`  
**Wired-into:** `bin/install#install`  
**Dependencies:** Task 901-2

### Task 901-4: Make explicit readiness aggregate required provider failures

**Story:** ST-901-4 strict explicit readiness validation (FR-8, FR-9, FR-10, FR-11)  
**Type:** happy-path and negative-path

**Steps:**

1. Add RED `--check` matrix cases to the fixture: all selected CLIs available;
   either or both combined providers absent; an unavailable unselected provider;
   and an existing common-check failure.
2. Assert the strict cases return nonzero only when a required provider or common
   check fails, and that a combined failure reports every missing selected CLI in
   one run rather than short-circuiting.
3. Reuse the provider probe in `check_installation` so it contributes to the
   existing `all_ok` result while allowing every required provider to be checked.
4. Verify GREEN for the full matrix, including success when only the unselected
   CLI is absent and failure when an existing common check is unhealthy.
5. Commit with message: `feat: enforce selected provider readiness`.

**Files:** `bin/install`; `test/test_install_provider_readiness.sh`  
**Wired-into:** `bin/install#check_installation`  
**Dependencies:** Task 901-3

### Task 901-5: Prove runtime provider routing remains independent

**Story:** ST-901-5 existing interactive and unattended execution selection (FR-14)  
**Type:** regression

**Steps:**

1. Run the focused accepted #927 provider-routing acceptance coverage for Claude,
   Codex, and combined execution configuration.
2. Confirm the installer change neither imports nor writes project
   `llm_provider` configuration and that the focused routing coverage remains
   GREEN for interactive and unattended composition paths.
3. Record the evidence with a commit trailer rather than introducing a redundant
   production change.
4. Commit with message: `test: verify installer selection does not affect routing`.

**Files:** `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`; `bin/install`  
**Wired-into:** none (no new production surface)  
**Verify-only:** yes  
**Dependencies:** Task 901-4

## Task Dependency Graph

```text
901-1 → 901-2 → 901-3 → 901-4 → 901-5
```

## Integration Points

- After Task 901-2: normal TTY installs choose providers before setup; scripted
  calls use the explicit option or safely default to Claude; invalid built-in
  requests fail before readiness work begins.
- After Task 901-3: a normal install is safe to run on a machine missing one or
  both selected provider CLIs while still establishing both client surfaces.
- After Task 901-4: `bin/install --check --providers claude,codex` is a strict,
  scriptable readiness gate with aggregated diagnostics.
- After Task 901-5: the existing execution-provider paths demonstrate that the
  installer-only option did not alter runtime routing.

## Coverage Mapping

| Story criterion | Tasks |
|---|---|
| ST-901-1 explicit Claude/Codex/combined selection | 901-1, 901-2 |
| ST-901-1 normal installation prompts for a provider set; omitted non-interactive selection defaults to Claude | 901-1, 901-2 |
| ST-901-1 unsupported selection is rejected with built-in choices | 901-1, 901-2 |
| ST-901-2 both provider surfaces are installed for every selection | 901-3 |
| ST-901-2 missing required CLI does not block installation or surfaces | 901-3 |
| ST-901-3 every required provider has a named ready report | 901-3 |
| ST-901-3 every missing required CLI gets an actionable, independent warning | 901-3 |
| ST-901-4 all selected CLIs and common checks succeed | 901-4 |
| ST-901-4 missing selected CLIs fail and are all reported | 901-4 |
| ST-901-4 unavailable unselected CLI does not fail readiness | 901-4 |
| ST-901-4 common readiness failure remains fatal | 901-4 |
| ST-901-5 interactive/unattended Claude, Codex, and combined routing remains honored | 901-5 |
| ST-901-5 readiness selection cannot mutate execution selection | 901-2, 901-5 |

## Verification

- [x] Accepted stories exist and every story has happy and concrete negative paths.
- [x] Conflict-check is intentionally skipped for this Small-tier feature.
- [x] Every story criterion maps to one or more tasks, including negative paths.
- [x] Five tasks are within the normal 1–20 task scope and each has explicit dependencies.
- [x] Every task declares authoritative repo-relative files and a valid wiring contract.
- [x] Load-bearing claims are verified or operator-confirmed in `.pipeline/verify-claims-plan-901.md`.
- [ ] Run the installer fixture and focused provider-routing acceptance coverage after implementation.
