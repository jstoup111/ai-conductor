# Implementation Plan: Hard-delete the retired wiring_check step name

**Date:** 2026-08-26
**Stories:** .docs/stories/hard-delete-the-retired-wiring-check-step-name-fro.md
**Conflict check:** Clean as of 2026-08-26

## Summary

Deletes the retired `wiring_check` step name from the engine (registry, group, events, config,
policy, model table), re-anchors the BUILD verification semantics the dead fan-out lane carried
onto the serial dispatch path, and proves historical state stays loadable. 13 tasks.

## Technical Approach

`'wiring_check'` is a `StepName` union member (`src/conductor/src/types/steps.ts:18`); removing it
fans out compile errors through every exhaustive `Record<StepName, …>` and literal comparison, so
Task 1 is one atomic deletion across all compile-coupled sites, ending green. The `deprecated`
StepDefinition field and the `deprecated_step` event lose their only user and are deleted
separately (Task 2, with their `EVENT_SINKS` key — the sink registry is exhaustive and rejects
orphans).

`BUILD_VERIFICATION_GROUP` is dissolved, not kept one-member: the executor's width-1 guard
(`src/conductor/src/engine/conductor.ts:6064`, `dispatchable.length > 1`) makes a one-member group
unreachable dead structure (amended adr-2026-07-29). Dissolving it kills the lane that implemented
two load-bearing semantics, which Tasks 6–7 re-anchor on the serial dispatch path
(`conductor.ts:7916+`): post-repair re-verification of a `done` `test_suite`
(`reverifyDoneBuildMembers`, `conductor.ts:6026-6028`; adr-2026-08-03) and deterministic-failure
gate-repair recording + single kickback-budget charge (`conductor.ts:6387-6503`; amended
adr-2026-07-29 point 4). The mechanism is decided here: port the existing
`recordDeterministicGateRepair` + `consumeKickbackBudget` calls (reuse the same functions, not
re-implementations) into the serial `test_suite` failure handling beside
`retainedFullSuiteFailure`, and gate serial dispatch eligibility of a `done` `test_suite` on the
same `buildRepairVerificationPending` flag the lane consulted.

Historical readability needs no new machinery — state reads are untyped and registry-driven
(`readState` validates nothing; `findResumeIndex` iterates the registry, `conductor.ts:11921-11946`)
— so Task 9 pins that property with fixtures rather than adding code. The daemon-cli renderer's
closed member match degrades legacy events to a labeled fallback (Task 10). A leftover consumer
`steps.wiring_check:` block classifies as a custom-step declaration and fails config load by the
existing path (`src/conductor/src/engine/config.ts:550,657-659`) — pinned by test, no new code
(operator decision: no special diagnostic).

Local pattern context for the acceptance tests (Tasks 6, 7, 8, 13): follow the existing
engine-orchestration acceptance tests that drive a fake-provider conductor through BUILD and
assert on emitted events and `.pipeline/` state — e.g. the deterministic-verification flow test
(search `test/acceptance/` for `deterministic-build-verification` and `full-suite`). Traits to
preserve: real engine flow, faithful fakes at the provider boundary, assertions on events +
gate/ledger files, no real LLM calls. Variation allowed: helper setup and fixture shape.

## Prerequisites

- Architecture review approved with conditions C1–C5; ADR amendments to adr-2026-08-14 and
  adr-2026-07-29 committed (already in this spec's baseline).
- PR body must carry a `## Migration` bash fence removing `steps.wiring_check` blocks from
  consumer configs (consumer-visible break; not a plan task — release-gate contract).
- Landing note (C5): merge after the in-flight worktrees whose `conduct-state.json` names the
  step have shipped or been reset — hygiene only; Task 9 proves resume is safe regardless.

## Tasks

### Task 1: Delete the wiring_check name from all compile-coupled engine sites
**Story:** 1
**Type:** refactor

**Steps:**
1. Remove `'wiring_check'` from the `StepName` union (`src/conductor/src/types/steps.ts:18`).
2. Chase every compile error to a deletion, per /code-removal (survivor behavior is owned by later
   tasks' tests): registry entry `src/conductor/src/engine/steps.ts:155-167`; `build_review`
   prerequisites → `['test_suite']` (`steps.ts:189`); `BUILD_VERIFICATION_GROUP` definition and
   its `STEP_GROUPS` registration (`steps.ts:346-353,375`) plus the now-dead
   `builtinGroup.name === BUILD_VERIFICATION_GROUP.name` branches and import in
   `src/conductor/src/engine/conductor.ts` (`:131,6026-6028,6120-6136,6354-6385,6387-6503`);
   serial arm + `runWiringCheckStep` (`conductor.ts:7916-7917,10934-10941`); step-runner guard
   (`src/conductor/src/engine/step-runners.ts:738-743`); artifact contract key + completion
   predicate (`src/conductor/src/engine/artifacts.ts:298,3343-3345`); exhaustive config/policy/
   metadata keys (`src/conductor/src/engine/resolved-config.ts:50,81`,
   `src/conductor/src/engine/provider-model-policy.ts:49,78,107`,
   `src/conductor/src/engine/model-table-metadata.ts:5-10,23,50`); events member unions →
   `'test_suite'` (`src/conductor/src/types/events.ts:685,696`); daemon-cli renderer arm →
   fallback label (`src/conductor/src/daemon-cli.ts:2360-2361`).
3. Grep pass over the non-exhaustive `Partial<Record<StepName, …>>` maps for quoted leftovers:
   `src/conductor/src/engine/gate-verdicts.ts`, `src/conductor/src/engine/skill-invocation.ts`,
   `src/conductor/src/engine/selector.ts`, `src/conductor/src/ui/dashboard-snapshot.ts`.
4. `npx tsc --noEmit` for the conductor package passes.
5. Commit.

**Done when:**
- [ ] `tsc --noEmit` passes with `'wiring_check'` absent from the `StepName` union
- [ ] `grep -rn "wiring_check" src/conductor/src` returns zero hits (the closed enumeration for "complete excision" at the engine-source surface; tests/docs are later tasks)
- [ ] `build_review`'s prerequisites are exactly `['test_suite']` and `STEP_GROUPS` contains only the SHIP validation group

**Files likely touched:**
- src/conductor/src/types/steps.ts — union member removed
- src/conductor/src/engine/steps.ts — registry entry, prerequisites, group
- src/conductor/src/engine/conductor.ts — group branches, serial arm, runWiringCheckStep
- src/conductor/src/engine/step-runners.ts — retired-step guard
- src/conductor/src/engine/artifacts.ts — contract key, predicate
- src/conductor/src/engine/resolved-config.ts — default retries/review keys
- src/conductor/src/engine/provider-model-policy.ts — model/effort keys
- src/conductor/src/engine/model-table-metadata.ts — rationale + model-free entries
- src/conductor/src/types/events.ts — member unions
- src/conductor/src/daemon-cli.ts — renderer arm

**Dependencies:** none

### Task 2: Delete the orphaned deprecated-step machinery
**Story:** 1
**Type:** refactor

**Steps:**
1. Delete the `deprecated?: { adr: string }` field (`src/conductor/src/types/steps.ts:108`) and
   the `step.deprecated` suppression branch (`src/conductor/src/engine/conductor.ts:7401-7407`).
2. Delete the `deprecated_step` `ConductorEvent` variant and its `EVENT_SINKS` key in the same
   commit (exhaustive sink registry, adr-2026-07-26 — an orphan key fails compile).
3. `tsc --noEmit` passes; commit.

**Done when:**
- [ ] `tsc --noEmit` passes with no `deprecated` field on `StepDefinition`, no `deprecated_step` event variant, and no `deprecated_step` sink key
- [ ] `grep -rn "deprecated_step" src/conductor/src` returns zero hits

**Files likely touched:**
- src/conductor/src/types/steps.ts — field removed
- src/conductor/src/types/events.ts — event variant removed
- src/conductor/src/engine/conductor.ts — suppression branch removed
- src/conductor/src/engine/event-sinks.ts — sink key removed (locate by `EVENT_SINKS` definition)

**Dependencies:** Task 1

### Task 3: Update the rebase invalidation set
**Story:** 5
**Type:** refactor

**Steps:**
1. Remove `wiring_check` from the `applyRebaseVerdicts` invalidation set (locate in
   `src/conductor/src/engine/` by `applyRebaseVerdicts`; adr-2026-07-20 refines this invariant).
2. Update the directly-affected unit test(s) for the invalidation set to the surviving members.
3. Run those tests green; commit.

**Done when:**
- [ ] The invalidation-set unit tests pass naming only surviving steps
- [ ] `grep -n "wiring_check"` over the invalidation module returns zero hits

**Files likely touched:**
- src/conductor/src/engine/rebase-verdicts.ts — invalidation set (locate by `applyRebaseVerdicts`)
- test/ — the invalidation set's unit tests

**Dependencies:** Task 1

### Task 4: Sweep the test suite
**Story:** 1
**Type:** refactor

**Steps:**
1. `grep -rln wiring_check test/` (~80 files). For each: delete tests whose subject was the
   retired step's own behavior (the no-op run, the group fan-out with two members, the retired
   guard); rewrite tests that exercise surviving behavior (group core, join, kickback, resume) to
   the `test_suite`-only topology. Fixtures used by Task 9 keep their `wiring_check` residue —
   they exist to prove historical loads.
2. Run the full default suite green; commit (split into a few commits by area if large).

**Done when:**
- [ ] Default test suite passes
- [ ] `grep -rln "wiring_check" test/` matches only fixtures exercised by the Task 9 historical-load tests (closed enumeration recorded in that test file)

**Files likely touched:**
- test/ — sweep (wiring-gate-loop.test.ts, deterministic-build-verification acceptance, model-table-metadata.test.ts, others per grep)

**Dependencies:** Task 1, Task 2, Task 3

### Task 5: Regenerate the model table
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Run `bin/generate-model-table`; commit the regenerated HARNESS.md generated section.
2. Run `test/test_harness_integrity.sh`; fix any 5a/5b drift it names.

**Done when:**
- [ ] `test/test_harness_integrity.sh` passes, including check 5a
- [ ] The generated HARNESS.md table contains no `wiring_check` row

**Files likely touched:**
- HARNESS.md — regenerated table section

**Dependencies:** Task 1

### Task 6: Re-anchor post-repair re-verification of test_suite on the serial path (C1)
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing acceptance test (pattern: deterministic-verification flow tests, see Technical
   Approach): build completes → `test_suite` green → build repair occurs → on resume,
   `test_suite` re-executes against the repaired tree (evidence recomputed, not reused) before
   `build_review` dispatches; a failing re-run blocks `build_review` (Story 4 negative paths).
2. Verify RED.
3. Implement: gate serial dispatch of a `done` `test_suite` on the same
   `buildRepairVerificationPending` signal the deleted lane consulted
   (`reverifyDoneBuildMembers` semantics); evidence reuse refusal rides the existing
   tree-anchored evidence check.
4. Verify GREEN; commit.

**Done when:**
- [ ] Acceptance test passes: repair → test_suite re-runs → build_review only after green re-run
- [ ] Acceptance test passes: pre-repair test_suite evidence is not reused after a repair (recomputed evidence observed)
- [ ] Acceptance test passes: failing re-run blocks build_review dispatch

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — serial test_suite eligibility after repair
- test/acceptance/ — new acceptance test

**Dependencies:** Task 4

### Task 7: Re-anchor deterministic-failure classification and budget on the serial path (C2)
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing acceptance test: deterministic `test_suite` failure on the serial path →
   `recordDeterministicGateRepair` record written for `test_suite`, kickback budget charged
   exactly once, `build_review` not dispatched; then a fixing tree change → re-run green →
   feature proceeds and the ledger shows reset-on-progress.
2. Verify RED (or document GREEN if the serial path already routes through the same calls —
   then this task's implementation step is dropped and the test pins the equivalence).
3. Implement if RED: port the `recordDeterministicGateRepair` + `consumeKickbackBudget` calls
   from the deleted lane (`conductor.ts:6387-6503` pre-deletion) into the serial `test_suite`
   failure handling beside `retainedFullSuiteFailure` — reuse the same functions.
4. Verify GREEN; commit.

**Done when:**
- [ ] Acceptance test passes: single budget charge + gate-repair record per deterministic failure
- [ ] Acceptance test passes: unchanged repeated failure reaches the existing per-gate cap halt naming `test_suite`
- [ ] Acceptance test passes: tree-changed re-run resets the count per the ledger's made-progress rule

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — serial failure classification
- test/acceptance/ — new acceptance test

**Dependencies:** Task 4

### Task 8: Preserve the infrastructure-failure class for the suite
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing (or pinning) test: `test_suite` infrastructure failure (suite could not run —
   e.g. runner spawn failure) on the serial path is not charged as a semantic kickback and the
   failure class is preserved in the emitted event/halt output.
2. Verify, implement if needed (same classification taxonomy the aggregate verifier already
   emits — reuse, don't re-derive), GREEN; commit.

**Done when:**
- [ ] Test passes: infra failure produces no kickback-budget charge (kickback ledger count for `test_suite` unchanged by the run)
- [ ] Test passes: the emitted event/halt output carries the infrastructure failure class, not the deterministic-failure class

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — failure-class routing (if any change needed)
- test/ — the test

**Dependencies:** Task 7

### Task 9: Pin historical-state loadability with fixtures (C3)
**Story:** 5
**Type:** negative-path

**Steps:**
1. Add committed fixtures (or reuse the two existing stale-key state fixtures under
   `test/fixtures/rebase-invalidated-test-suite-proof-halts-build-review/`): a
   `conduct-state.json` with `wiring_check: done`, `build_verification__wiring_check: done`, and
   `last_step: wiring_check`; a `kickback-ledger.json` with a `gates.wiring_check` entry; an
   `events.jsonl` with `parallel_started` branches naming `wiring_check` and a
   `parallel:wiring_check` execution key; a `.pipeline/gates/wiring_check.json` verdict file.
2. Write tests: state loads and resume derives its index from the registry walk without error;
   ledger loads with other gates honored; event log renders/rolls up without crashing; orphan
   verdict file affects no gate decision.
3. GREEN (expected — reads are untyped); commit. This task pins behavior; if any load throws,
   fix the reader to be lenient at that site.

**Done when:**
- [ ] All four fixture-load tests pass
- [ ] The test file enumerates the fixture paths (the closed list Task 4's grep check references)

**Files likely touched:**
- test/ — historical-load tests + fixtures

**Dependencies:** Task 4

### Task 10: Legacy member events render with a labeled fallback
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write test: a persisted `build_member_evidence_reused` event with `member: 'wiring_check'`
   (as raw JSON, bypassing the narrowed type) renders through the daemon-cli renderer as the
   existing labeled unknown-member fallback, not a crash.
2. Verify against the Task 1 renderer change; GREEN; commit.

**Done when:**
- [ ] Renderer test passes: legacy member value renders as the labeled fallback string
- [ ] Renderer test passes: a current `member: 'test_suite'` event still renders with its member name

**Files likely touched:**
- src/conductor/src/daemon-cli.ts — renderer (if adjustment needed)
- test/ — renderer test

**Dependencies:** Task 1

### Task 11: Leftover consumer config fails the ordinary custom-step way
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write test: config with `steps: { wiring_check: { max_retries: 2 } }` fails `loadConfig` with
   the existing custom-step validation error naming `wiring_check` (missing `after:`); and a
   config naming any other undeclared step fails with the identical shape.
2. GREEN (expected from Task 1 — the name leaves `builtInNames`); commit.

**Done when:**
- [ ] Config test passes: `steps.wiring_check` block → custom-step error naming `wiring_check`, non-zero load failure
- [ ] Config test passes: another undeclared step name fails with the same error shape

**Files likely touched:**
- test/ — config validation test

**Dependencies:** Task 1

### Task 12: Operator-supplied unknown step names fail by name
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write test: `rewind --to wiring_check` (through the mutation-port validation path,
   adr-2026-08-19) fails by name against the resolved registry with an error naming
   `wiring_check`, mutating nothing.
2. GREEN (expected — registry validation already exists); commit.

**Done when:**
- [ ] Rewind test passes: unknown-step error names `wiring_check` and exits non-zero
- [ ] Rewind test passes: the state file bytes are unchanged after the refused rewind

**Files likely touched:**
- test/ — rewind validation test

**Dependencies:** Task 1

### Task 13: Pin the surviving BUILD verification topology
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write acceptance test (pattern per Technical Approach): full BUILD flow — after `build`,
   `test_suite` executes and `build_review` dispatches only on its green result; no
   `parallel_started` event for a BUILD verification group is emitted; a deterministic
   `test_suite` failure blocks `build_review` with no review dispatch; a mid-verification engine
   restart resumes at the correct step.
2. GREEN against Tasks 1–7; commit.

**Done when:**
- [ ] Acceptance test passes: build → test_suite → build_review ordering with zero `build_verification` group events in the emitted stream
- [ ] Acceptance test passes: failing suite yields no build_review dispatch
- [ ] Acceptance test passes: restart mid-verification resumes without error

**Files likely touched:**
- test/acceptance/ — topology acceptance test

**Dependencies:** Task 6, Task 7

## Task Dependency Graph

```
T1 ─┬─ T2 ─┐
    ├─ T3 ─┤
    │      ├─ T4 ─┬─ T6 ─┐
    ├─ T5  │      ├─ T7 ─┼─ T13
    ├─ T10 │      │  └─ T8
    ├─ T11 │      └─ T9
    └─ T12 ┘
```

## Integration Points

- After Task 4: engine compiles and the default suite is green on the test_suite-only topology.
- After Task 7: the full deterministic-verification semantics (C1 + C2) are live and tested.
- After Task 13: end-to-end BUILD flow pinned.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work (Task 1 and 4 are mechanical compile-chases; split
      commits allowed)
- [ ] Every task has a `Done when:` block of falsifiable checks; "complete excision" is closed by
      the grep enumerations in Tasks 1 and 4
- [ ] Dependencies are explicit and acyclic
