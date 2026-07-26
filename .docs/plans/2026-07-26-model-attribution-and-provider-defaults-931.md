# Implementation Plan: Model Attribution and Provider Defaults (#931)

**Date:** 2026-07-26
**Design:** Technical track; architecture review skipped for Small tier
**Stories:** `.docs/stories/model-attribution-and-provider-defaults-931.md`
**Conflict check:** Skipped for Small tier
**Source:** jstoup111/ai-conductor#931

## Summary

Tune existing provider-policy tables and this repository's provider routing in four small tasks. Update only executable mirrors that already enforce these declarative contracts; add no duplicate fallback suite or project-specific test harness.

## Technical Approach

- Change model, effort, and tier values in the existing built-in provider policies.
- Update the existing exhaustive policy fixture and tier-resolution expectations that directly mirror those values; do not create another matrix framework.
- Update rationale metadata and regenerate the already-gated model table.
- Configure `[codex, claude]` globally with Claude preferences on approved judgment steps, then validate the committed YAML using existing configuration tooling and reuse existing #927 fallback coverage.

## Prerequisites

- Work in `.worktrees/model-attribution-931` on `feat/model-attribution-931`.
- Preserve issue #964 as the owner of provider selection below autonomous engine-step boundaries.

## Tasks

### Task 1: Update provider-native policy values and mirrors
**Story:** Models and effort match task shape and feature size — HP-1, HP-2, NP-1, NP-2
**Type:** happy-path

**Steps:**
1. Change existing exhaustive policy expectations and tier-resolution expectations to the approved matrix.
2. Run the focused policy/resolver tests and verify they fail against the old constants (RED).
3. Amend the existing base models, base efforts, and S/M/L overrides without changing precedence, escalation orders, fallback ladders, or policy structure.
4. Run the same focused tests and verify exhaustive provider-native and unchanged-row checks pass (GREEN).
5. Commit with message: `fix(models): align policy with task roles and size`.

**Files:** `src/conductor/test/engine/provider-model-policy.test.ts`, `src/conductor/test/engine/resolved-config.test.ts`, `src/conductor/src/engine/provider-model-policy.ts`

**Wired-into:** none (no new production surface)

**Dependencies:** none

### Task 2: Regenerate the model-selection contract
**Story:** Models and effort match task shape and feature size — HP-3, NP-3
**Type:** negative-path

**Steps:**
1. Update only affected task-fit rationale metadata and any existing metadata expectations.
2. Run the existing metadata/generator checks and verify stale generated content fails (RED).
3. Run `bin/generate-model-table` to regenerate the existing model-selection table.
4. Run the existing metadata, completeness, and drift checks and verify they pass (GREEN).
5. Commit with message: `docs(models): regenerate task-fit model table`.

**Files:** `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/generate-model-table.test.ts`, `HARNESS.md`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 1

### Task 3: Configure this repository's provider split
**Story:** This repository routes execution to Codex and judgment to Claude — HP-1, HP-2, HP-3, NP-3
**Type:** happy-path

**Steps:**
1. Add ordered global providers `codex`, then `claude`, and scalar Claude preferences only on the approved judgment steps.
2. Preserve `manual_test.disable: true` and every existing custom `maintain-documentation` field while adding its Claude preference.
3. Load and validate the committed YAML with existing configuration tooling; verify the resolved structure contains the exact provider order/preferences and no schema error.
4. Correct configuration only if that existing validation fails, then re-run it (GREEN).
5. Commit with message: `config(models): prefer Codex execution and Claude judgment`.

**Files:** `.ai-conductor/config.yml`

**Wired-into:** none (no new production surface)

**Dependencies:** Task 2

### Task 4: Reuse existing regression coverage
**Story:** This repository routes execution to Codex and judgment to Claude — NP-1, NP-2; both stories' Done When checks
**Type:** negative-path

**Steps:**
1. Run the existing provider-policy, resolved-config, model-table, configuration-validation, and #927 provider-fallback tests.
2. Verify both fallback directions still re-resolve provider-native defaults and report fallback visibly.
3. Verify explicit overrides, retry escalation, fallback ladders, unknown-provider compatibility, and disabled manual testing remain green.
4. Inspect the diff and confirm no nested role, provider interface, standalone skill, or lifecycle topology changed.
5. Create an empty evidence commit only if no corrective change is needed, with message: `test(models): verify attribution policy scope`.

**Files:** `src/conductor/src/engine/provider-model-policy.ts`, `src/conductor/test/engine/provider-model-policy.test.ts`, `src/conductor/test/engine/resolved-config.test.ts`, `src/conductor/src/engine/model-table-metadata.ts`, `src/conductor/test/model-table-metadata.test.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`, `.ai-conductor/config.yml`, `HARNESS.md`

**Wired-into:** none (no new production surface)

**Verify-only:** yes

**Dependencies:** Task 3

## Task Dependency Graph

```text
Task 1 → Task 2 → Task 3 → Task 4
```

## Integration Points

- After Task 1: both built-in policies resolve the approved model/effort matrix through existing seams.
- After Task 2: executable policy and generated guidance agree.
- After Task 3: this repository uses Codex-first execution and Claude judgment without altering lifecycle topology.
- After Task 4: existing regression coverage proves fallback and precedence remain intact.

## Acceptance-Criteria Coverage

| Story criterion | Tasks |
|---|---|
| Policy HP-1 | 1 |
| Policy HP-2 | 1 |
| Policy HP-3 | 2 |
| Policy NP-1 | 1 |
| Policy NP-2 | 1 |
| Policy NP-3 | 2 |
| Routing HP-1 | 3 |
| Routing HP-2 | 3 |
| Routing HP-3 | 3 |
| Routing NP-1 | 4 |
| Routing NP-2 | 4 |
| Routing NP-3 | 3 |

## Verification

- [ ] Existing executable mirrors—not duplicate new suites—cover every model/effort criterion.
- [ ] Existing fallback tests cover both routing negative paths.
- [ ] Dependencies are explicit and acyclic; all tasks use existing production surfaces.
- [ ] No provider selection is added below the engine-step boundary.
