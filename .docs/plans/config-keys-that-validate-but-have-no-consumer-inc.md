# Implementation Plan: Config keys that validate but have no consumer (#1025)

**Date:** 2026-08-26
**Design:** .docs/decisions/adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal.md
**Stories:** .docs/stories/config-keys-that-validate-but-have-no-consumer-inc.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Accept `steps.<custom>.gate`/`kickback_target` in the validator, remove five dead config
surfaces one-shot (operator-waived break), guard the `conductor` block against project-source
override, and add a total config-key consumer registry with a coverage test. 10 tasks.

## Technical Approach

All validator changes live in `src/conductor/src/engine/config.ts`: `knownStepKeys` gains
`gate`/`kickback_target` with boolean type checks and a built-in-step rejection modeled on the
existing `completion_artifact` custom-only contract; the `conductor` project-source guard copies
the `spec_owner` anti-leak guard immediately below it (same `opts.source === 'project'` branch,
error names the file and the fix); removals delete entries from `knownTopLevelKeys` was never
needed (top-level `auth_park_timeout_minutes` is already absent) — the removals are from
`types/config.ts`, `resolved-config.ts`, the self-host allowed-key set, `validateEffortAndModelBag`'s
allowed set, and the `complexity` block validator. `buildStepRegistry` already reads both custom
keys (`src/conductor/src/engine/steps.ts` `loopGate: custom.gate ?? targetStep.loopGate`,
`kickbackTarget: custom.kickback_target ?? false`) — no registry change is needed; validation is
the only blocker. The consumer registry is a new module exporting a total
`Record<string, ConsumerDeclaration>` whose key universe is derived at test time from the
validator's exported key sets (export them if not already), with
`{ consumer: 'none', reason }` first-class; its test fails on undeclared keys, unresolvable
consumer modules, and orphaned declarations.

Local pattern context: the `spec_owner` guard (search `config.ts` for `Anti-leak guard (D2`)
is the exact template for Task 6 — preserve its traits: fires only on `opts.source === 'project'`,
rejects a PRESENT key regardless of value, error text names `projectConfigPath(projectRoot)` and
the user-config fix. Allowed variation: error prose specific to `conductor`. The
`completion_artifact` custom-only validation (search `knownStepKeys` and the step-key loop) is
the template for Task 1.

The implementation PR body MUST carry a `## Migration` block deleting the removed keys from user
and project configs (ADR waiver condition; enforced by the release gate — a
`.docs/release-waivers/` file is forbidden for this schema behavior change).

## Prerequisites

None — no migrations, packages, or services.

## Tasks

### Task 1: Validator accepts gate and kickback_target on custom steps, fail-closed
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: (a) a config with a custom step carrying `after`, `skill`, `gate: false`, `kickback_target: true` validates OK; (b) the same keys on built-in step `plan` fail naming the step and "custom steps only"; (c) `gate: "loop"` fails naming `gate` and boolean; (d) `kickback_target: "yes"` fails naming `kickback_target` and boolean.
2. Verify tests fail (RED) — today (a) fails with `Unknown key in steps.<name>: "gate"`.
3. Implement in `src/conductor/src/engine/config.ts`: add `gate`, `kickback_target` to `knownStepKeys`; in the per-step validation loop add boolean type checks and reject both keys on built-in steps, following the `completion_artifact` custom-only pattern (search for its rejection branch; preserve error-message shape naming the step and key).
4. Verify tests pass (GREEN).
5. Commit: "feat(config): accept custom-step gate/kickback_target fail-closed"

**Done when:**
- [ ] The four named assertions in `config.test.ts` pass
- [ ] Fail-closed here means exactly: non-boolean value rejected, key on built-in step rejected, unknown sibling keys still rejected

**Files likely touched:**
- src/conductor/src/engine/config.ts — knownStepKeys + per-step checks
- src/conductor/test/engine/config.test.ts — four new assertions

**Dependencies:** none

### Task 2: Loaded config drives buildStepRegistry gate/kickback flags end-to-end
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test in `src/conductor/test/integration/config-flow.test.ts`: load (via `validateConfig`, not a hand-built object) a config with a custom step `gate: false, kickback_target: true`; assert the `buildStepRegistry` entry has `loopGate === false` and `kickbackTarget === true`; a second custom step declaring only `gate: false` (no `kickback_target`) gets `kickbackTarget === false`; a third with neither key inherits its `after` target's `loopGate`.
2. Verify RED (load fails before Task 1's validator change lands, or assertion missing).
3. No production change expected — `steps.ts:614-617` already applies both; fix only if the assertion exposes a wiring gap.
4. Verify GREEN.
5. Commit: "test(config): custom-step gate/kickback flags flow from validated config to registry"

**Done when:**
- [ ] The integration test loads through `validateConfig` (not a hand-built steps object) and both assertions pass
- [ ] The inheritance default assertions (target loopGate, kickbackTarget false) pass

**Files likely touched:**
- src/conductor/test/integration/config-flow.test.ts — new test

**Dependencies:** Task 1

### Task 3: Remove complexity.default_tier
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test in `src/conductor/test/engine/config.test.ts`: a config with `complexity: { default_tier: 'M' }` fails validation with an unknown-key error naming `default_tier`.
2. Verify RED (it validates today via the `must be S|M|L` branch).
3. Removal per /code-removal: delete `default_tier` from the `ComplexityConfig` type (`src/conductor/src/types/config.ts:408-410`), delete its validator branch (`config.ts:726-727`), delete the commented examples from both templates. Surviving behavior: the rest of the `complexity` block (if any keys remain) validates as before; tier still comes from the assessment artifact.
4. Verify GREEN; run the template test.
5. Commit: "feat(config)!: remove consumerless complexity.default_tier"

**Done when:**
- [ ] The unknown-key rejection test passes and `grep -r default_tier src/conductor/src templates` returns nothing
- [ ] `src/conductor/test/engine/config-template.test.ts` passes with the template edits in the same commit

**Files likely touched:**
- src/conductor/src/types/config.ts — drop field
- src/conductor/src/engine/config.ts — drop validator branch
- templates/project-config.yml.template — drop example
- templates/ai-conductor-config.yml.template — drop example
- src/conductor/test/engine/config.test.ts — rejection test

**Dependencies:** none

### Task 4: Remove harness_self_host.skill_relink_preflight
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: a config with `harness_self_host: { skill_relink_preflight: false }` fails validation with an unknown-key error naming the key.
2. Verify RED.
3. Removal: delete the field from `types/config.ts:349-350`, the self-host allowed-key entry (`config.ts:1279`), the `skillRelinkPreflight` field + default from `resolved-config.ts:595,652`, and the test references in `self-host-config.test.ts` / `build-auth-cli.test.ts`. Surviving behavior: the relink preflight itself is untouched — all four call sites (`daemon-cli.ts`, `daemon-supervisor-cli.ts`, `self-host/wiring.ts`) already invoke it unconditionally and keep doing so.
4. Verify GREEN; run the self-host config tests.
5. Commit: "feat(config)!: remove consumerless skill_relink_preflight; relink stays always-on"

**Done when:**
- [ ] The rejection test passes and `grep -ri skill_relink src/conductor/src` returns nothing
- [ ] Self-host config tests pass; no relink call site was edited in this task's diff

**Files likely touched:**
- src/conductor/src/types/config.ts — drop field
- src/conductor/src/engine/config.ts — drop allowed-key entry
- src/conductor/src/engine/resolved-config.ts — drop resolver field
- src/conductor/test/engine/self-host-config.test.ts — drop key references
- src/conductor/test/engine/build-auth-cli.test.ts — drop key reference

**Dependencies:** none

### Task 5: Remove top-level auth_park_timeout_minutes type + resolver
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Confirm via existing or new test that a config with top-level `auth_park_timeout_minutes` fails with `Unknown top-level key` (already true — it was never in `knownTopLevelKeys`; add the assertion if absent).
2. Removal: delete the field + doc comment from `types/config.ts:547-553` and `resolveAuthParkTimeoutMinutes` from `resolved-config.ts:524-539`; delete its resolver-only tests (`resolved-config.test.ts:933-1006`). Surviving behavior: nested `harness_self_host.auth_park_timeout_minutes` keeps its exact contract — 0 → immediate credentials HALT, non-integer/negative → 60 — proven by its existing resolution and conductor tests passing unmodified.
3. Verify GREEN.
4. Commit: "feat(config)!: remove dead top-level auth_park_timeout_minutes; nested variant is canonical"

**Done when:**
- [ ] `grep -n auth_park_timeout_minutes src/conductor/src` hits only the `harness_self_host` nested declarations/consumers
- [ ] The unknown-top-level-key assertion passes and all existing nested auth-park tests pass unmodified

**Files likely touched:**
- src/conductor/src/types/config.ts — drop top-level field
- src/conductor/src/engine/resolved-config.ts — drop resolver
- src/conductor/test/engine/resolved-config.test.ts — drop resolver tests, keep/ensure the unknown-key assertion
- src/conductor/test/engine/config.test.ts — unknown-top-level-key assertion if not already present

**Dependencies:** none

### Task 6: Remove defaults.by_tier acceptance
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: a config with `defaults: { by_tier: { S: {} } }` fails validation with an unknown-key error naming `defaults.by_tier`; and configs with `steps.<name>.by_tier` / `phases.<name>.by_tier` still validate.
2. Verify RED (the `defaults` case validates today).
3. Implement: in `validateEffortAndModelBag` (`config.ts:2119-2146`), make `by_tier` acceptance conditional on the bag being a step/phase bag, not `defaults` (parameterize the allowed set or pass a flag from the call sites). Surviving behavior: step/phase `by_tier` resolution (`resolved-config.ts:242-243,354-355`) unchanged.
4. Verify GREEN.
5. Commit: "feat(config)!: reject decorative defaults.by_tier"

**Done when:**
- [ ] `defaults.by_tier` rejection and step/phase `by_tier` acceptance assertions all pass
- [ ] Existing by_tier resolution tests pass unmodified

**Files likely touched:**
- src/conductor/src/engine/config.ts — validateEffortAndModelBag parameterization
- src/conductor/test/engine/config.test.ts — new assertions

**Dependencies:** none

### Task 7: Delete resolveMergeableAutoresolve
**Story:** Story 3
**Type:** refactor

**Steps:**
1. Removal per /code-removal: delete `resolveMergeableAutoresolve` and its result interface (`resolved-config.ts:678-691`). Zero callers exist (verified 2026-08-26). Surviving behavior: raw-block consumers in `daemon-cli.ts`, `autoresolve.ts`, `mergeable-sweep.ts` are untouched; disabled/absent block still means no autoresolve dispatch.
2. Run the autoresolve consumer tests (`autoresolve-loop`, `ci-fix`, engine config tests) — all pass unmodified; confirm the disabled/absent no-dispatch path is asserted by one of them (add a scoped assertion only if none exists).
3. Commit: "refactor(config): delete uncalled resolveMergeableAutoresolve"

**Done when:**
- [ ] `grep -rn resolveMergeableAutoresolve src/conductor` returns nothing
- [ ] `autoresolve-loop`, `ci-fix`, and engine config tests pass; a passing test covers disabled/absent-block ⇒ no dispatch

**Files likely touched:**
- src/conductor/src/engine/resolved-config.ts — delete helper + interface
- src/conductor/test/integration/autoresolve-loop.test.ts — assertion only if the no-dispatch path is uncovered

**Dependencies:** none

### Task 8: Project-source guard for the conductor block
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing tests in `src/conductor/test/engine/config.test.ts`: (a) `validateConfig` with `opts.source === 'project'` on a config carrying `conductor: {}` fails with an error containing the project config path and "Move" + user-config path (mirror the `spec_owner` error's shape); (b) the merged/user path with a valid `conductor` block still validates.
2. Verify RED.
3. Implement in `config.ts` directly beside the `spec_owner` anti-leak guard (same `opts.source === 'project'` branch, search `Anti-leak guard (D2`): a PRESENT `conductor` key — regardless of value — is a hard rejection naming `projectConfigPath(projectRoot)` and the fix (the block is user-level update-check state). Preserve the template's traits; vary only the prose.
4. Verify GREEN, including existing `spec_owner` guard tests and `validateConductorBlock` tests unmodified.
5. Commit: "feat(config): reject project-source conductor block like spec_owner"

**Done when:**
- [ ] Project-source rejection asserts file naming + fix text; merged/user path test passes
- [ ] Existing spec_owner and validateConductorBlock tests pass unmodified

**Files likely touched:**
- src/conductor/src/engine/config.ts — guard beside spec_owner
- src/conductor/test/engine/config.test.ts — two tests

**Dependencies:** none

### Task 9: Config-key consumer registry module
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing test skeleton in `src/conductor/test/engine/config-consumer-registry.test.ts`: import the registry; assert it is total over the validator's accepted key universe (every top-level key, every conductor/self-host/step/complexity/autoresolve block key the validator accepts) and every `none` declaration has a non-empty `reason`.
2. Verify RED (module absent).
3. Implement `src/conductor/src/engine/config-consumer-registry.ts`: export `interface ConsumerDeclaration { consumer: string | 'none'; reason?: string }` (consumer = repo-relative production module path; `none` requires `reason`, INERT-waiver grammar `none (inert until <ref>)` welcome) and a `Record<string, ConsumerDeclaration>` keyed `<block>.<key>` / `<key>`. Derive the key universe by EXPORTING the validator's existing key sets from `config.ts` (`knownTopLevelKeys`, `knownStepKeys`, the self-host allowed set, conductor allowed set, etc.) — the registry test consumes those exports; never a hand-copied list. Totality mechanism: the test diffs registry keys against the exported sets both directions.
4. Verify the totality half passes GREEN.
5. Commit: "feat(config): total config-key consumer registry"

**Done when:**
- [ ] Registry module exists; every accepted key from the exported validator sets has exactly one declaration (both-direction diff in the test)
- [ ] Every `none` declaration carries a non-empty reason
- [ ] `config.ts` exports its key sets (or a single aggregator) and the registry/test consume the exports, not copies

**Files likely touched:**
- src/conductor/src/engine/config-consumer-registry.ts — new module
- src/conductor/src/engine/config.ts — export key sets
- src/conductor/test/engine/config-consumer-registry.test.ts — totality test

**Dependencies:** Task 1; Task 3; Task 4; Task 5; Task 6

### Task 10: Coverage test red cases — undeclared, unresolvable, orphaned
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Extend `config-consumer-registry.test.ts` with the three red cases, each exercised against a locally-constructed registry/key-set pair (not by mutating the shipped registry): (a) a key in the sets with no declaration fails naming the key; (b) a declaration whose `consumer` module path does not exist on disk fails naming the declaration and path; (c) a declaration for a key absent from the sets fails as orphaned.
2. Verify each case is RED against a deliberately broken fixture and GREEN against the shipped registry.
3. Implement the check function (`assertRegistryCovers(sets, registry)`) in the registry module so the shipped test and the fixture cases share one mechanism; consumer resolution = `fs.existsSync` on the repo-relative path.
4. Verify GREEN.
5. Commit: "test(config): registry coverage fails on undeclared/unresolvable/orphaned keys"

**Done when:**
- [ ] Three fixture-driven failure cases each assert the exact failure message naming the offending key/declaration
- [ ] The shipped registry passes the same shared check function; consumer paths verified against disk, not string shape

**Files likely touched:**
- src/conductor/src/engine/config-consumer-registry.ts — shared check function
- src/conductor/test/engine/config-consumer-registry.test.ts — red cases

**Dependencies:** Task 9

## Task Dependency Graph

```
Task 1 ──> Task 2
Task 1, Task 3, Task 4, Task 5, Task 6 ──> Task 9 ──> Task 10
Task 7 (independent)   Task 8 (independent)
```

## Integration Points

- After Task 2: custom-step gate/kickback flow is provable end-to-end from a YAML config.
- After Task 9: the registry is total over the post-removal key universe — the durable check is live.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks
- [ ] Dependencies are explicit and acyclic
