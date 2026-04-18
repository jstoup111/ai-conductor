# Implementation Plan: Phase 4 — Skill Override System

**Date:** 2026-04-12
**Design:** .docs/specs/2026-04-12-pluggable-harness-architecture.md
**Stories:** .docs/stories/features/config/ST-050 through ST-061
**Conflict check:** Clean as of 2026-04-12 (2 conflicts resolved — enforcement locked for gating steps, hooks wrap active skill)

## Summary

Adds per-project config loading (`.harness/config.yml`), step disabling, custom step insertion,
full skill replacement, and before/after hooks. 18 tasks across the 5 stories. All work extends
the existing TypeScript conductor in `src/conductor/`.

## Prerequisites

- Phase 3 conductor code exists in `src/conductor/` (all 310 tests passing)
- `js-yaml` already in package.json dependencies
- `HarnessConfig` type already defined in `src/types/config.ts`

## Tasks

---

### Task 1: Config loader — parse .harness/config.yml (happy path)
**Story:** ST-052 happy path: valid YAML parsed and returned
**Type:** happy-path

**Steps:**
1. Write test in `test/engine/config.test.ts`: `loadConfig() parses valid .harness/config.yml and returns HarnessConfig`
2. Verify test fails (RED)
3. Implement `src/engine/config.ts`: `loadConfig(projectRoot: string): Promise<ConfigResult<HarnessConfig>>` — reads `.harness/config.yml`, parses with js-yaml, returns typed result
4. Verify test passes (GREEN)
5. Commit: "Add config loader — parse .harness/config.yml"

**Files likely touched:**
- `src/engine/config.ts` — new
- `test/engine/config.test.ts` — new

**Dependencies:** none

---

### Task 2: Config loader — missing config fails with migration message
**Story:** ST-052 happy path: no config fails with migration instructions
**Type:** happy-path

**Steps:**
1. Write test: `loadConfig() returns error with migration message when .harness/config.yml missing`
2. Verify fails (RED)
3. Implement: check for ENOENT, return `{ ok: false, error: { type: 'missing', message: 'No .harness/config.yml found. Run bin/migrate to generate one.' } }`
4. Verify passes (GREEN)
5. Commit: "Add missing config detection with migration instructions"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add test

**Dependencies:** Task 1

---

### Task 3: Config loader — YAML parse errors with line numbers
**Story:** ST-052 negative: malformed YAML reports line/column
**Type:** negative-path

**Steps:**
1. Write test: `loadConfig() reports parse error with line number for malformed YAML`
2. Verify fails (RED)
3. Implement: catch js-yaml YAMLException, extract line/column from exception
4. Verify passes (GREEN)
5. Commit: "Report YAML parse errors with line numbers"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add test

**Dependencies:** Task 1

---

### Task 4: Config loader — version compatibility check
**Story:** ST-052 happy path: harness_version match accepted; negative: version mismatch rejected
**Type:** happy-path

**Steps:**
1. Write tests: `loadConfig() accepts config when harness version satisfies constraint` AND `loadConfig() rejects config when version too low`
2. Verify fail (RED)
3. Implement: parse semver constraint from `harness_version`, compare against VERSION file
4. Verify pass (GREEN)
5. Commit: "Add harness version compatibility check"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add tests

**Dependencies:** Task 1

---

### Task 5: Config validation — type checking and unknown keys
**Story:** ST-052 negative: invalid types rejected, unknown keys warned
**Type:** negative-path

**Steps:**
1. Write tests: `validateConfig() rejects steps.disable as string (not array)` AND `validateConfig() warns on unknown top-level keys`
2. Verify fail (RED)
3. Implement: `validateConfig(raw: unknown): ConfigResult<HarnessConfig>` — type-check each field, collect warnings for unknown keys
4. Verify pass (GREEN)
5. Commit: "Add config validation with type checking and unknown key warnings"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add tests

**Dependencies:** Task 1

---

### Task 6: Disable steps — skip disabled steps in conductor (happy path)
**Story:** ST-050 happy path: disabled steps marked skipped, never execute
**Type:** happy-path

**Steps:**
1. Write test in `test/engine/conductor.test.ts`: `Conductor skips steps listed in config.steps.disable`
2. Verify fails (RED)
3. Modify `Conductor` to accept `HarnessConfig` in options, check `config.steps.disable` before each step — mark 'skipped' if disabled
4. Verify passes (GREEN)
5. Commit: "Skip config-disabled steps in conductor"

**Files likely touched:**
- `src/engine/conductor.ts` — modify (add config to options, disable check in loop)
- `test/engine/conductor.test.ts` — add test

**Dependencies:** Tasks 1, 5

---

### Task 7: Disable steps — disabled steps satisfy gates
**Story:** ST-050 happy path: disabled counts as skipped for gates
**Type:** happy-path

**Steps:**
1. Write test: `Disabled step satisfies downstream gate` (gate check passes when prerequisite is disabled/skipped)
2. Verify fails (RED) — likely already passes since 'skipped' satisfies gates, but verify
3. If needed, ensure disabled steps are marked 'skipped' which already satisfies `stepSatisfied()`
4. Verify passes (GREEN)
5. Commit: "Verify disabled steps satisfy downstream gates"

**Files likely touched:**
- `test/engine/conductor.test.ts` — add test

**Dependencies:** Task 6

---

### Task 8: Disable steps — reject disabling gating steps
**Story:** ST-050 negative: cannot disable gating steps
**Type:** negative-path

**Steps:**
1. Write test: `validateConfig() rejects disabling gating step (stories, plan, build, finish)` with message "Cannot disable gating step: [step]"
2. Verify fails (RED)
3. Implement: in `validateConfig`, check `steps.disable` entries against gating steps list
4. Verify passes (GREEN)
5. Commit: "Reject disabling gating steps in config validation"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add test

**Dependencies:** Task 5

---

### Task 9: Disable steps — unknown step name warning
**Story:** ST-050 negative: unknown step names produce warning
**Type:** negative-path

**Steps:**
1. Write test: `validateConfig() warns on unknown step name in steps.disable`
2. Verify fails (RED)
3. Implement: check each name in `steps.disable` against ALL_STEPS names, add warning if not found
4. Verify passes (GREEN)
5. Commit: "Warn on unknown step names in steps.disable"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add test

**Dependencies:** Task 5

---

### Task 10: Custom steps — insert at specified position (happy path)
**Story:** ST-051 happy path: custom step inserted after specified step
**Type:** happy-path

**Steps:**
1. Write test in `test/engine/steps.test.ts`: `buildStepRegistry() inserts custom step after specified step`
2. Verify fails (RED)
3. Implement `buildStepRegistry(config: HarnessConfig): StepDefinition[]` — takes ALL_STEPS, applies config.steps.add insertions
4. Verify passes (GREEN)
5. Commit: "Insert custom steps at configured positions"

**Files likely touched:**
- `src/engine/steps.ts` — add `buildStepRegistry()`
- `test/engine/steps.test.ts` — add test

**Dependencies:** Task 1

---

### Task 11: Custom steps — validate SKILL.md exists and has valid frontmatter
**Story:** ST-051 negative: missing or invalid SKILL.md detected
**Type:** negative-path

**Steps:**
1. Write tests: `validateConfig() rejects custom step with missing SKILL.md` AND `rejects custom step with invalid frontmatter` AND `rejects custom step with unknown after target`
2. Verify fail (RED)
3. Implement: in `validateConfig`, check file existence and parse SKILL.md frontmatter
4. Verify pass (GREEN)
5. Commit: "Validate custom step SKILL.md existence and frontmatter"

**Files likely touched:**
- `src/engine/config.ts` — modify
- `test/engine/config.test.ts` — add tests

**Dependencies:** Task 5

---

### Task 12: Custom steps — multiple at same position preserve order
**Story:** ST-051 negative: two custom steps after build ordered by config file order
**Type:** negative-path

**Steps:**
1. Write test: `buildStepRegistry() preserves config file order for multiple custom steps at same position`
2. Verify fails (RED)
3. Implement: insertion logic processes add entries in order
4. Verify passes (GREEN)
5. Commit: "Preserve config order for multiple custom steps at same insertion point"

**Files likely touched:**
- `src/engine/steps.ts` — modify
- `test/engine/steps.test.ts` — add test

**Dependencies:** Task 10

---

### Task 13: Skill replacement — resolve project-local over harness default (happy path)
**Story:** ST-060 happy path: override skill replaces harness default
**Type:** happy-path

**Steps:**
1. Write test in `test/engine/skill-resolver.test.ts`: `resolveSkill() returns project override path when configured`
2. Verify fails (RED)
3. Implement `src/engine/skill-resolver.ts`: `resolveSkill(stepName: StepName, config: HarnessConfig, projectRoot: string): string` — checks `config.skills.overrides[stepName]`, returns override path or harness default
4. Verify passes (GREEN)
5. Commit: "Add skill resolver — project override takes precedence"

**Files likely touched:**
- `src/engine/skill-resolver.ts` — new
- `test/engine/skill-resolver.test.ts` — new

**Dependencies:** Task 1

---

### Task 14: Skill replacement — validate override exists and has valid frontmatter
**Story:** ST-060 negative: missing file detected, invalid frontmatter reported
**Type:** negative-path

**Steps:**
1. Write tests: `resolveSkill() fails when override path doesn't exist` AND `resolveSkill() fails when override has invalid frontmatter`
2. Verify fail (RED)
3. Implement: check file exists, parse frontmatter, validate required fields
4. Verify pass (GREEN)
5. Commit: "Validate skill override file existence and frontmatter"

**Files likely touched:**
- `src/engine/skill-resolver.ts` — modify
- `test/engine/skill-resolver.test.ts` — add tests

**Dependencies:** Task 13

---

### Task 15: Skill replacement — enforcement locked for gating steps
**Story:** ST-060 negative (conflict resolution): gating step enforcement cannot be downgraded
**Type:** negative-path

**Steps:**
1. Write tests: `resolveSkill() ignores enforcement override for gating step` AND `resolveSkill() accepts enforcement override for non-gating step`
2. Verify fail (RED)
3. Implement: after loading override, if step is gating, force enforcement to original value
4. Verify pass (GREEN)
5. Commit: "Lock enforcement level for gating steps during skill override"

**Files likely touched:**
- `src/engine/skill-resolver.ts` — modify
- `test/engine/skill-resolver.test.ts` — add tests

**Dependencies:** Task 14

---

### Task 16: Skill hooks — before/after execution (happy path)
**Story:** ST-061 happy path: hooks execute in order around skill
**Type:** happy-path

**Steps:**
1. Write test in `test/engine/hooks.test.ts`: `runWithHooks() executes before-hook, then skill, then after-hook`
2. Verify fails (RED)
3. Implement `src/engine/hooks.ts`: `runWithHooks(step, config, skillRunner)` — reads `config.skills.hooks[step]`, runs before-hook (subprocess), runs skill, runs after-hook
4. Verify passes (GREEN)
5. Commit: "Add before/after hook execution around skills"

**Files likely touched:**
- `src/engine/hooks.ts` — new
- `test/engine/hooks.test.ts` — new

**Dependencies:** Task 1

---

### Task 17: Skill hooks — failure handling
**Story:** ST-061 negative: before-hook failure prevents skill, after-hook failure marks step failed
**Type:** negative-path

**Steps:**
1. Write tests: `runWithHooks() skips skill when before-hook fails` AND `runWithHooks() returns failure when after-hook fails` AND `runWithHooks() reports missing hook script at load time` AND `runWithHooks() falls back to bash for non-executable scripts`
2. Verify fail (RED)
3. Implement: check hook file exists, check executable permission, handle exit codes
4. Verify pass (GREEN)
5. Commit: "Handle hook failures — before blocks skill, after marks step failed"

**Files likely touched:**
- `src/engine/hooks.ts` — modify
- `test/engine/hooks.test.ts` — add tests

**Dependencies:** Task 16

---

### Task 18: Integration — conductor uses config, resolver, and hooks together
**Story:** All stories (end-to-end config flow)
**Type:** infrastructure

**Steps:**
1. Write integration test in `test/integration/config-flow.test.ts`:
   - `Conductor with config disabling steps skips them`
   - `Conductor with custom step executes it at correct position`
   - `Conductor with skill override uses project-local skill`
   - `Conductor with hooks wraps skill execution`
2. Verify fail (RED)
3. Wire config loading into Conductor startup: load config → validate → build registry → resolve skills → run with hooks
4. Verify pass (GREEN)
5. Commit: "Integrate config, skill resolver, and hooks into conductor"

**Files likely touched:**
- `src/engine/conductor.ts` — modify (load config at startup, use built registry)
- `test/integration/config-flow.test.ts` — new

**Dependencies:** Tasks 6, 10, 13, 16

## Task Dependency Graph

```
Task 1 (config loader)
├── Task 2 (missing config)
├── Task 3 (parse errors)
├── Task 4 (version check)
├── Task 5 (validation)
│   ├── Task 8 (reject gating disable)
│   ├── Task 9 (unknown step warning)
│   └── Task 11 (custom step validation)
├── Task 6 (disable steps) → Task 7 (gates)
├── Task 10 (custom steps) → Task 12 (ordering)
├── Task 13 (skill resolver) → Task 14 (validation) → Task 15 (enforcement lock)
└── Task 16 (hooks) → Task 17 (hook failures)

Task 18 (integration) depends on: 6, 10, 13, 16
```

## Integration Points

- After Task 5: Config loading and validation testable end-to-end
- After Task 9: Full disable-steps flow testable
- After Task 12: Custom step insertion testable
- After Task 15: Skill override resolution testable
- After Task 17: Hook execution testable
- After Task 18: Full config flow integrated into conductor

## Coverage Mapping

| Criterion | Task(s) |
|-----------|---------|
| ST-052: valid YAML parsed | 1 |
| ST-052: version match accepted | 4 |
| ST-052: missing config fails | 2 |
| ST-052: malformed YAML line numbers | 3 |
| ST-052: version mismatch rejected | 4 |
| ST-052: unknown keys warned | 5 |
| ST-052: type validation | 5 |
| ST-050: disabled steps skip | 6 |
| ST-050: disabled satisfy gates | 7 |
| ST-050: gating steps cannot disable | 8 |
| ST-050: unknown step warning | 9 |
| ST-050: dashboard shows skip note | 6 (status icon) |
| ST-050: empty phase skipped | 6 (all steps in phase disabled) |
| ST-051: custom step inserted | 10 |
| ST-051: custom step invoked | 18 |
| ST-051: custom step state tracked | 18 |
| ST-051: missing SKILL.md detected | 11 |
| ST-051: invalid insertion point | 11 |
| ST-051: multiple at same position | 12 |
| ST-060: override replaces default | 13 |
| ST-060: project override precedence | 13 |
| ST-060: missing override detected | 14 |
| ST-060: invalid frontmatter reported | 14 |
| ST-060: enforcement locked gating | 15 |
| ST-060: enforcement changeable non-gating | 15 |
| ST-061: before/after order | 16 |
| ST-061: before failure blocks skill | 17 |
| ST-061: after failure marks failed | 17 |
| ST-061: missing hook detected | 17 |
| ST-061: non-executable fallback | 17 |
| ST-061: hooks wrap replacement | 18 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
