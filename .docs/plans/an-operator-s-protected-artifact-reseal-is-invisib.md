# Implementation Plan: Operator reseal reaches build_review's Scope rubric as judged evidence

**Date:** 2026-08-12
**Stories:** .docs/stories/an-operator-s-protected-artifact-reseal-is-invisib.md
**Design:** .docs/architecture/an-operator-s-protected-artifact-reseal-is-invisib.md
**Decision:** .docs/decisions/adr-2026-08-12-operator-reseal-as-second-scope-justification.md
**Conflict check:** Clean as of 2026-08-12
**Track:** technical
**Tier:** M
**Source:** jstoup111/ai-conductor#1502

## Summary

Eleven tasks that make an operator's `conduct-ts reseal` visible to `build_review`'s Scope rubric as
judged evidence: a filtered reader over the seal's existing `rebaselines[]`, a new optional field on
`BuildReviewInputs`, and a third evidence section in the grader prompt.

## Technical Approach

The evidence already exists on disk and is simply unread. `resealProtectedArtifactSeal` has been
appending `{ trigger: 'operator-reseal', paths, reason, fromCommit, toCommit }` to
`seal.rebaselines[]` since `adr-2026-08-09-operator-only-scoped-artifact-reseal` shipped
(`protected-artifact-seal.ts:1109-1139`). Nothing new is recorded, persisted, or emitted; no event
variant, ledger, or file is added.

Three seams, mirroring how the two existing evidence channels already reach the same prompt:

1. **Reader** — `readOperatorReseals` lands in `protected-artifact-seal.ts`, which already owns the
   seal's parse and shape. It filters `rebaselines[]` on the literal `trigger === 'operator-reseal'`.
   Exactly three trigger values exist repo-wide; the other two — `defensive-history-rewrite`
   (`:1008`) and `proactive-rebase` (`rebase-translate.ts:470`) — are machinery rotations carrying no
   operator rationale, and rendering them would read as blanket authorization. The filter matches the
   literal, never a fallback, so an unknown future trigger is excluded by default.
2. **Assembly** — `assembleBuildReviewInputs` gains `operatorReseals`, populated from the feature
   root it already derives from `planPath`. It reuses the existing `planIsInFeatureRoot` guard, which
   is the same alternate branch on which `repairContext` already resolves to `[]`. Every failure mode
   (absent file, malformed JSON, version-1 seal, non-array `rebaselines`, unreadable file) degrades to
   an empty list. Assembly must never throw on the seal read — that would convert a Scope kickback
   into a hard step failure, a strictly worse outcome than the bug being fixed.
3. **Rendering** — `buildGraderPrompt` renders an "Operator-authorized protected-artifact reseals"
   section built exactly like `renderedAcceptedWidenings` (`build-review-prompt.ts:32-36`), including
   the `(none)` empty fallback. The framing states that the rationale is an operator claim the grader
   judges, and that unmatched work remains subject to every rubric item. The existing Scope rubric
   sentence at `build-review-prompt.ts:49` is left byte-intact — the ADR extends what counts as
   justification, it does not weaken the rule.

**Sequencing.** Reader first (Tasks 1-4), then assembly (Task 5), then rendering (Tasks 6-9), then
the paired regression that pins #1502's exact shape (Tasks 10-11). The reader and renderer are
independently testable, so only Task 5 and Task 10 are true integration points.

**Testing boundary.** Per this repository's test-isolation policy, the default suite uses faithful
fakes at every LLM boundary, so the grader's *judgement* is not asserted here. Every task below
asserts on prompt assembly and reader output, which is where #1502's defect actually lives — the
evidence never reaches the prompt at all. The judgement scenarios are tagged `[smoke]` in the
stories and belong to the opt-in smoke suite.

**No DECIDE-artifact tasks.** The amendments to
`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` and to Story 3 of
`.docs/stories/2026-07-27-protected-artifact-seal-self-amendment-1047.md` were made during DECIDE
and are already in this change set. No task below names another feature's sealed artifact.

## Prerequisites

None. No migration, dependency, config key, or scaffolding is required.

## Tasks

### Task 1: Reader returns operator-reseal rebaselines
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: given a seal fixture whose `rebaselines` holds one `operator-reseal` entry with a path, reason, `fromCommit` and `toCommit`, `readOperatorReseals` returns one record exposing all four.
2. Verify test fails (RED).
3. Implement `readOperatorReseals` and its exported record type, filtering `rebaselines` on `trigger === 'operator-reseal'`.
4. Verify test passes (GREEN).
5. Commit: "feat(seal): read operator-reseal rebaselines for build_review evidence"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.ts` — new exported reader and record type
- `src/conductor/src/engine/protected-artifact-seal.test.ts` — reader coverage

**Dependencies:** none

### Task 2: Reader preserves order and multi-path entries
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: three `operator-reseal` entries return in `rebaselines` order; an entry listing two paths exposes both.
2. Verify test fails (RED).
3. Implement ordering and multi-path passthrough.
4. Verify test passes (GREEN).
5. Commit: "feat(seal): preserve reseal order and multi-path entries"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 3: Reader excludes machinery rotations
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: a seal whose only rebaseline is `proactive-rebase` returns empty; same for `defensive-history-rewrite`; a mixed fixture returns only the `operator-reseal` entry; an unknown future trigger is excluded.
2. Verify test fails (RED).
3. Implement the literal-match filter so no fallback or catch-all admits an unrecognized trigger.
4. Verify test passes (GREEN).
5. Commit: "fix(seal): exclude machinery rotations from reseal evidence"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 4: Reader tolerates an absent rationale and unusable seals
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write failing test: an `operator-reseal` entry with no `reason` (the field is optional on the persisted type) is still returned with an empty rationale; absent file, malformed JSON, version-1 seal, non-array `rebaselines`, and an unreadable file each return an empty list without throwing.
2. Verify test fails (RED).
3. Implement the degradation paths.
4. Verify test passes (GREEN).
5. Commit: "fix(seal): degrade to an empty reseal channel on any unusable seal"

**Files:** same as Task 1

**Dependencies:** Task 1

### Task 5: Thread operatorReseals through input assembly
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test: `assembleBuildReviewInputs` populates `operatorReseals` from the feature root derived from `planPath`, and returns an empty channel on the non-feature-root branch where `repairContext` already resolves to `[]`.
2. Verify test fails (RED).
3. Add the optional `operatorReseals` field to `BuildReviewInputs` and populate it behind the existing `planIsInFeatureRoot` guard.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): thread operator reseals into grader inputs"

**Files:**
- `src/conductor/src/engine/build-review-inputs.ts` — new optional field and its population
- `src/conductor/src/engine/build-review-inputs.test.ts` — assembly coverage

**Dependencies:** Task 4

### Task 6: Render the operator-reseal evidence section
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test: with one reseal, the assembled prompt contains the section heading, the resealed path, the rationale byte-identical to the input `reason`, and both commit shas; with two reseals covering different paths, both render as separate entries.
2. Verify test fails (RED).
3. Implement the renderer alongside `renderedAcceptedWidenings`.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): render operator-authorized reseals in the grader prompt"

**Files:**
- `src/conductor/src/engine/build-review-prompt.ts` — new rendered section
- `src/conductor/src/engine/build-review-prompt.test.ts` — rendering coverage

**Dependencies:** Task 5

### Task 7: Empty and omitted channels render the (none) marker
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing test: with an empty `operatorReseals`, the section body is exactly the `(none)` marker and no path reads as authorized; with the field omitted entirely, the same marker renders rather than `undefined` or a crash.
2. Verify test fails (RED).
3. Implement the empty fallback and the field default.
4. Verify test passes (GREEN).
5. Commit: "fix(build-review): render (none) for an empty or omitted reseal channel"

**Files:** same as Task 6

**Dependencies:** Task 6

### Task 8: Framing presents the rationale as a claim to be judged
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing test: the section's framing text instructs the grader to judge whether each rationale justifies the amendment and states that unmatched work remains subject to every rubric item; a reseal with an empty `reason` still renders its path and commit range with a visibly empty rationale; a rationale containing instruction-shaped text renders inside the judged section rather than as prompt direction.
2. Verify test fails (RED).
3. Implement the framing text, mirroring the accepted-widenings section.
4. Verify test passes (GREEN).
5. Commit: "feat(build-review): frame reseal rationale as judged evidence, not exemption"

**Files:** same as Task 6

**Dependencies:** Task 6

### Task 9: The Scope rubric and the other four items are unweakened
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write failing test: with reseals present, the existing Scope rubric sentence about approved DECIDE artifacts is present and unmodified in the assembled prompt; the Tautology, Root cause, Completeness, and Wiring instruction text is identical with and without reseals; a path outside the resealed set appears nowhere in the section.
2. Verify test fails (RED).
3. Adjust rendering so the new section is purely additive to the rubric text.
4. Verify test passes (GREEN).
5. Commit: "test(build-review): pin the Scope rubric as unweakened by reseal evidence"

**Files:** same as Task 6

**Dependencies:** Task 8

### Task 10: Paired with-reseal / without-reseal regression
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test: build a fixture reproducing #1502 — a diff amending a sealed DECIDE artifact — and assemble the prompt twice, once with a matching `operator-reseal` rebaseline and once with none; assert the amended path appears with its rationale in the first and the `(none)` marker in the second, and that the two prompts differ only within the evidence section.
2. Verify test fails (RED).
3. Implement whatever assembly wiring the paired fixture exposes as missing.
4. Verify test passes (GREEN).
5. Commit: "test(build-review): pin #1502 in both directions"

**Files:**
- `src/conductor/src/engine/build-review-prompt.test.ts` — paired regression fixtures
- `src/conductor/src/engine/build-review-inputs.test.ts` — assembly side of the pair

**Dependencies:** Task 9

### Task 11: Reseal evidence survives a machinery rotation
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing test: after an `operator-reseal` entry, appending a `proactive-rebase` rotation leaves the operator entry readable, and a reseal covering a path the diff does not touch still renders without labeling any diff path.
2. Verify test fails (RED).
3. Implement or confirm the append-only read path holds across rotation.
4. Verify test passes (GREEN).
5. Commit: "test(seal): pin reseal evidence surviving rebase rotation"

**Files:**
- `src/conductor/src/engine/protected-artifact-seal.test.ts` — rotation-survival coverage
- `src/conductor/src/engine/build-review-prompt.test.ts` — unused-reseal rendering

**Dependencies:** Task 10

## Task Dependency Graph

```
Task 1 (reader)
  ├── Task 2 (order, multi-path)
  ├── Task 3 (exclude machinery triggers)
  └── Task 4 (absent reason, unusable seals)
        └── Task 5 (thread into input assembly)   ← integration point
              └── Task 6 (render the section)
                    ├── Task 7 ((none) marker)
                    └── Task 8 (judged framing)
                          └── Task 9 (rubric unweakened)
                                └── Task 10 (paired #1502 regression)   ← integration point
                                      └── Task 11 (survives rotation)
```

Acyclic. Tasks 2, 3 and 4 are independent of one another and may run in any order after Task 1.

## Integration Points

- **After Task 5:** a real seal on disk reaches `BuildReviewInputs` end-to-end; the channel is
  populated but not yet visible to the grader.
- **After Task 10:** the full #1502 path is exercised in both directions — a resealed amendment
  carries its evidence into the prompt, and the identical diff without a reseal does not.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No task names another feature's sealed DECIDE artifact
