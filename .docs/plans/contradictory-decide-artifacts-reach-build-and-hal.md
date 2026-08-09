# Implementation Plan: ADR contradiction detection across DECIDE

**Date:** 2026-08-09
**Stories:** .docs/stories/contradictory-decide-artifacts-reach-build-and-hal.md
**Conflict check:** Clean as of 2026-08-09
**Tier:** M
**Source:** intake #1391

## Summary

Adds `.docs/decisions/` to `conflict-check`'s comparison corpus and introduces `adr` as a fifth
coherence row class enforced by the land-time gate. 17 tasks.

## Technical Approach

**Engine before prose — this ordering is a correctness constraint, not a preference.**
`coherence-validator.ts:130` rejects any row class outside the closed `ROW_CLASSES` set, so a skill
told to emit `adr` rows against an un-updated validator breaks the gate outright. Tasks 1–11 land
the engine's acceptance and enforcement; tasks 14–16 then tell the skills to use it. Both halves
ship in one change set per
`adr-2026-08-09-adr-contradiction-detection-in-two-halves`.

**Four type unions and one new check.** `CoherenceRowClass` (:30) and `ROW_CLASSES` (:51) gate
parsing; `CoherenceRequiredLayer` (:1215) gates whether the layer is enforced; `CoherenceGapLayer` +
`GAP_LAYER_ORDER` (:884) gate report rendering. `checkAdrCoverage` joins the five existing per-layer
checks (:325, :389, :503, :601, :735) and is called from `validateCoherence` (:969).

**The layer signal is a two-line addition to existing machinery.** `resolveRequiredLayers` (:1256)
already receives `changeSet` and already tests path prefixes for `.docs/coherence/`. The `adr`
signal is the same shape, so no signature changes — three other layers depend on that signature.

**Deletion is handled at pool derivation, not at the signal.** `resolveIdeaFiles`
(`land-spec.ts:498-503`) builds the change set from `git diff --name-only`, which includes deleted
paths, and `resolveRequiredLayers` receives paths without status codes. The layer therefore engages
on a deletion-only change set; the ADR **pool**, derived inside `runCoherenceGate` from the
status-carrying list `resolveChangedFilesForWaiver` already computes, excludes deleted ADRs, so the
gate finds nothing to adjudicate and passes. This is the resolution recorded in the conflict report.

**No ADR status parsing.** `runCoherenceGate` runs after land's existing unapproved-ADR gate
(`coherence-validator.ts:1297-1298`), so every ADR in the change set is already known approved. The
pool is the filtered file list. This deliberately takes no dependency on `adrApprovalStatus`, which
is not on the base branch.

**`NEGATIVE_VERDICTS` (:290) is not changed.** Unknown verdict strings are affirmative by design;
Task 10 documents that behavior with a test so the footgun is not rediscovered, and the skill-side
prohibition on inventing verdicts (Task 14) is the actual control.

**Corpus scope is configurable and defaults to the cheap path.** Per
`adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`, `conflict_check.adr_corpus`
defaults to `change_set`; `repo_wide` is set in this repository only. Because
`detectUserConfigReadCommand` (`cli.ts:133`) resolves an arbitrary dotted path but reads only the
user config, Task 13 widens it to the merged project+user config using the merge that
`config.ts:1766` already performs. Verified: the release gate's breaking-surface classifier matches
`p === 'bin/conduct'` exactly (`self-host/version-signal.ts:39`), so editing `src/conductor/src/cli.ts`
does not trip it — no migration block and no release waiver are required.

**Documentation is not planned here.** This repository routes documentation upkeep through its
`maintain-documentation` custom step, and the plan skill prohibits documentation tasks. The affected
pages — `docs/reference/skills.md`, `docs/explanation/gates.md`, `docs/reference/configuration.md`,
`docs/reference/cli.md` — are that step's responsibility in this same PR.

## Prerequisites

- None. No migration, no new dependency, no infrastructure.

## Tasks

### Task 1: Accept `adr` as a parseable row class
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: a coherence artifact row whose row-class cell is `adr` parses and returns `rowClass: 'adr'`.
2. Verify test fails (RED)
3. Implement: add `'adr'` to the `CoherenceRowClass` union and to the `ROW_CLASSES` set.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence): accept adr as a row class"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — `CoherenceRowClass` (:30), `ROW_CLASSES` (:51)
- src/conductor/src/engine/engineer/coherence-validator.test.ts — parse test

**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#parseCoherenceArtifact
**Dependencies:** none

### Task 2: Keep rejecting every other unknown row class
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: a row class of `decision` is still rejected after Task 1 widened the set.
2. Verify test fails (RED)
3. Implement: confirm the membership test at :130 is unchanged in form — the set widened by exactly one member.
4. Verify test passes (GREEN)
5. Commit with message: "test(coherence): unknown row classes still rejected"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.test.ts — rejection test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 3: Cross-check `adr` row citations against a real ADR id pool
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: an `adr` row citing an ADR stem present in the change set resolves; one citing an absent stem is rejected as fabricated.
2. Verify test fails (RED)
3. Implement: derive the `adr` id pool in `crossCheckIds` and validate `adr` row citations against it.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence): cross-check adr row citations"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — `crossCheckIds` (:239)
- src/conductor/src/engine/engineer/coherence-validator.test.ts — cross-check tests

**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#crossCheckIds
**Dependencies:** Task 1

### Task 4: Derive the `adr` required layer from the committed ADR signal
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: an engaged gate whose change set contains a `.docs/decisions/adr-` path returns a layer set including `adr`; one without returns a set omitting it.
2. Verify test fails (RED)
3. Implement: add `'adr'` to `CoherenceRequiredLayer` and add the prefix test to `resolveRequiredLayers`, with no signature change.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence): gate the adr layer on a committed ADR signal"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — `CoherenceRequiredLayer` (:1215), `resolveRequiredLayers` (:1256)
- src/conductor/src/engine/engineer/coherence-validator.test.ts — layer derivation tests

**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#runCoherenceGate
**Dependencies:** Task 1

### Task 5: Exclude non-ADR files in `.docs/decisions/` from the signal
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: a change set containing only `.docs/decisions/architecture-review-*.md` and `.docs/decisions/review-*.md` does NOT require the `adr` layer.
2. Verify test fails (RED)
3. Implement: confirm the prefix is `.docs/decisions/adr-`, not the bare directory.
4. Verify test passes (GREEN)
5. Commit with message: "test(coherence): review reports do not require the adr layer"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.test.ts — prefix precision test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 6: Preserve the tier-S and legacy-change-set exemptions
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: a tier-S spec carrying ADRs returns disengaged `tier-exempt`; a spec with ADR paths but no `.docs/coherence/` path returns disengaged `legacy-change-set`. Neither derives the `adr` layer.
2. Verify test fails (RED)
3. Implement: confirm both short-circuits precede layer derivation; no code change expected.
4. Verify test passes (GREEN)
5. Commit with message: "test(coherence): exemptions short-circuit before adr derivation"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.test.ts — exemption tests

**Wired-into:** none (no new production surface)
**Dependencies:** Task 4

### Task 7: Derive the ADR pool, excluding deleted ADRs
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: given a change list where one ADR is added and one deleted, the derived pool contains only the added ADR.
2. Verify test fails (RED)
3. Implement: build the ADR pool inside `runCoherenceGate` from the status-carrying list `resolveChangedFilesForWaiver` returns, filtering to `adr-` and excluding delete statuses. No new git invocation.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence): derive the ADR pool excluding deletions"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — `runCoherenceGate` (:1383)
- src/conductor/src/engine/engineer/coherence-validator.test.ts — pool derivation tests

**Wired-into:** src/conductor/src/engine/engineer/land-spec.ts#runCoherenceGate
**Dependencies:** Task 4

### Task 8: Pass a deletion-only change set over an empty pool
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: a change set whose only ADR path is a deletion engages the `adr` layer, derives an empty pool, and the gate passes with no row demanded.
2. Verify test fails (RED)
3. Implement: confirm an empty pool is a pass, not a gap.
4. Verify test passes (GREEN)
5. Commit with message: "test(coherence): deletion-only change set passes over an empty pool"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.test.ts — deletion test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

### Task 9: Block an unadjudicated or negative-verdict ADR
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: an ADR in the pool with no matching `adr` row yields a gap with id `adr-<stem>`; a row with verdict `gap` or `fail` also blocks; two `covered` rows pass silently.
2. Verify test fails (RED)
3. Implement: add `checkAdrCoverage` beside the existing per-layer checks and call it from `validateCoherence`, gated to run only when the `adr` layer is required.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence): block unadjudicated ADRs"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — new `checkAdrCoverage`, `validateCoherence` (:969)
- src/conductor/src/engine/engineer/coherence-validator.test.ts — coverage tests

**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#validateCoherence
**Dependencies:** Task 7

### Task 10: Render `adr` gaps in fixed layer order
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: a gap list spanning several layers renders `adr` gaps at a fixed position, byte-identical across runs, each naming its id and quoted item.
2. Verify test fails (RED)
3. Implement: add `'adr'` to `CoherenceGapLayer` and to `GAP_LAYER_ORDER` at its fixed position.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence): order adr gaps in the aggregate report"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.ts — `CoherenceGapLayer` and `GAP_LAYER_ORDER` (:884)
- src/conductor/src/engine/engineer/coherence-validator.test.ts — ordering test

**Wired-into:** src/conductor/src/engine/engineer/coherence-validator.ts#renderGapReport
**Dependencies:** Task 9

### Task 11: Document the affirmative-unknown-verdict behavior with a test
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: an `adr` row whose verdict is an unrecognized string is treated as affirmative and does not block, asserting the existing `NEGATIVE_VERDICTS` semantics explicitly.
2. Verify test fails (RED)
3. Implement: no production change — `NEGATIVE_VERDICTS` (:290) stays as-is; the test pins the behavior.
4. Verify test passes (GREEN)
5. Commit with message: "test(coherence): pin unknown-verdict-is-affirmative for adr rows"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.test.ts — verdict semantics test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 9

### Task 12: Waive an ADR gap through the existing waiver mechanism
**Story:** 6
**Type:** negative-path

**Steps:**
1. Write failing test: a waiver naming `adr-<stem>` exactly waives that gap; a waiver naming a different id does not.
2. Verify test fails (RED)
3. Implement: confirm `adr` gaps flow into the existing waiver evaluation with no ADR-specific waiver path added.
4. Verify test passes (GREEN)
5. Commit with message: "test(coherence): adr gaps are waivable by exact id"

**Files likely touched:**
- src/conductor/src/engine/engineer/coherence-validator.test.ts — waiver test

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10

### Task 13: Resolve `config read` against the merged project and user config
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `config read conflict_check.adr_corpus` returns the project value when set in the project config, falls back to the user config otherwise, and returns empty when set in neither.
2. Verify test fails (RED)
3. Implement: widen the read dispatch to resolve a dotted path against the merged project+user config using the merge `config.ts:1766` already performs; preserve current behavior outside a project.
4. Verify test passes (GREEN)
5. Commit with message: "feat(cli): resolve config read against merged project config"

**Files likely touched:**
- src/conductor/src/cli.ts — `detectUserConfigReadCommand` (:133) and its handler
- src/conductor/src/engine/config.ts — expose the merged lookup
- src/conductor/src/cli.test.ts — resolution tests

**Wired-into:** src/conductor/src/cli.ts#detectUserConfigReadCommand
**Dependencies:** none

### Task 14: Add the `conflict_check.adr_corpus` key with a `change_set` default
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: an absent key resolves to `change_set`; `repo_wide` resolves as given; an unrecognized value is rejected rather than silently accepted.
2. Verify test fails (RED)
3. Implement: add the key to the project config schema and validation, defaulting to `change_set`, and set `adr_corpus: repo_wide` in this repository's `.ai-conductor/config.yml`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(config): add conflict_check.adr_corpus"

**Files likely touched:**
- src/conductor/src/engine/config.ts — schema and validation
- .ai-conductor/config.yml — set `repo_wide` for this repository
- src/conductor/src/engine/config.test.ts — default and validation tests

**Wired-into:** src/conductor/src/engine/config.ts#loadProjectConfig
**Dependencies:** Task 13

### Task 15: Teach coherence-check to author `adr` rows
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: `test/test_harness_integrity.sh` passes and the skill declares the `adr` row class, its cited-id form, and its gap-id form.
2. Verify test fails (RED)
3. Implement: add the `adr` row class to §4a, its gap id to §4c, and ADR-versus-story to §4d's cross-layer pairs. Leave §4b's verdict vocabulary unchanged and state why inventing a verdict silently passes.
4. Verify test passes (GREEN)
5. Commit with message: "feat(coherence-check): author adr rows"

**Files likely touched:**
- skills/coherence-check/SKILL.md — §4a, §4c, §4d, Verification

**Wired-into:** none (no new production surface)
**Dependencies:** Task 12

### Task 16: Add the ADR corpus to conflict-check, scoped by `adr_corpus`
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: `test/test_harness_integrity.sh` passes and the skill's §1 Inventory names `.docs/decisions/`, the six conflict types are unchanged in membership, and the narrowing and conservative-supersession rules are marked `repo_wide` only.
2. Verify test fails (RED)
3. Implement: add `.docs/decisions/` to §1; add the corpus-scope rule reading `conflict_check.adr_corpus` with a `change_set` fallback; scope narrowing and the retain-on-partial-supersession rule to `repo_wide`.
4. Verify test passes (GREEN)
5. Commit with message: "feat(conflict-check): compare stories against approved ADRs"

**Files likely touched:**
- skills/conflict-check/SKILL.md — §1 Inventory, conflict scan, Verification

**Wired-into:** none (no new production surface)
**Dependencies:** Task 14, Task 15

### Task 17: Require both sides of an ADR conflict to be quoted verbatim
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: `test/test_harness_integrity.sh` passes and the skill's conflict report format requires, for an ADR-versus-story conflict, the ADR filename stem, the story id, and a verbatim quotation of the opposing sentence from each side.
2. Verify test fails (RED)
3. Implement: extend the §3 report format with the two-sided verbatim requirement, add a worked ADR-versus-story example showing both quoted sides, and state that an ungrounded suspicion is surfaced as an assumption rather than recorded as a conflict.
4. Verify test passes (GREEN)
5. Commit with message: "feat(conflict-check): quote both sides of an ADR conflict"

**Files likely touched:**
- skills/conflict-check/SKILL.md — §3 report format, worked example

**Wired-into:** none (no new production surface)
**Dependencies:** Task 16

## Task Dependency Graph

```
Task 1 ─┬─ Task 2
        ├─ Task 3
        └─ Task 4 ─┬─ Task 5
                   ├─ Task 6
                   └─ Task 7 ─┬─ Task 8
                              └─ Task 9 ─┬─ Task 10 ── Task 12 ── Task 15 ─┐
                                         └─ Task 11                        │
Task 13 ── Task 14 ────────────────────────────────────────────────────────┴─ Task 16 ── Task 17
```

Acyclic. Tasks 1–12 are engine-only; 15–16 are the skill prose that depends on the engine already
accepting `adr`, which is the hard sequencing constraint.

## Integration Points

- **After Task 9:** the gate blocks an unadjudicated ADR end-to-end — the core behavior is live.
- **After Task 12:** the engine half is complete and every exemption and escape is covered.
- **After Task 14:** the corpus-scope key resolves, so the skill can read it.
- **After Task 16:** both halves are in the change set, satisfying the same-PR constraint.

## Coverage Check

| Story | Tasks | Story title |
|---|---|---|
| 1 | 13, 14, 16 | conflict-check reads approved ADRs |
| 2 | 17 | verbatim naming of both sides |
| 3 | 15 | coherence-check authors `adr` rows |
| 4 | 1, 2, 3 | validator parses and cross-checks |
| 5 | 4, 5, 7, 8 | layer gated on committed signal |
| 6 | 9, 10, 11, 12 | unadjudicated ADR blocks |
| 7 | 6 | existing and exempt specs unaffected |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] `test/test_harness_integrity.sh` passes; check 5a reports no model-table drift (this change adds no skill and changes no tier — drift would signal an unintended change)
- [ ] The existing coherence-validator test suite passes with no assertion loosened
