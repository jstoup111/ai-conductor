# Implementation Plan: build_review sees the wiring_check instruction it is grading the response to (#1399)

**Date:** 2026-08-09
**Stem:** build-review-flags-gate-mandated-wired-into-rewrit
**Track:** technical (no PRD)
**Tier:** S
**Stories:** `.docs/stories/build-review-flags-gate-mandated-wired-into-rewrit.md`
**Conflict check:** N/A — skipped at Tier S (per `/engineer` tier rules)

## Summary

Give the `build_review` grader a third engine-recorded context section carrying the
`wiring_check` → `build` kickback instructions issued during this build, so a `.docs/plans/`
edit made in compliance with a gate instruction stops being graded as an unauthorized scope
violation. Three surfaces: persist the `kickback` event, read it in the grader's input
assembly, render it in the grader's prompt. 9 tasks.

## Technical Approach

**The collision.** `checkInertContractContradiction`
(`src/conductor/src/engine/wiring-probe.ts:732`) fails a task whose `Wired-into:` contract is
declared `inert` while the diff adds a production reference, with gap text that explicitly
instructs the remedy: "contract is stale, switch to a declared call site (found in: …)". The
conductor turns that into a kickback to BUILD (`conductor.ts:7240-7255`) with the gap text as
the retry hint. The build agent complies by rewriting the plan's anchors. `build_review`'s
Scope rubric (`build-review-prompt.ts:38`) then fails the build, because it treats any
`.docs/plans/` modification as unauthorized unless the approved plan justifies it — and the
grader's inputs are structurally isolated from everything except the diff and the plan body.
`remediate` derives "restore the anchors", which re-enters the same `wiring_check` failure.

**Why a third context section is the right shape.** `build_review` already solves this exact
class twice. `repairContext` and `acceptedWidenings` (`build-review-inputs.ts:45-47`) are
engine-computed records rendered into their own prompt sections
(`build-review-prompt.ts:90,94`) under an explicit "evidence, not an exemption" framing: the
grader judges whether an apparently out-of-plan hunk implements the recorded context, and
unmatched work stays subject to every rubric. A gate instruction is the same kind of object,
and it must arrive the same way — engine-assembled, never asserted by the maker in prose the
grader can disbelieve (this repo's Design Principle). The LLM's only job stays the match
judgement; the deterministic part is entirely engine-side.

**Why the event ledger and not a new record.** The instruction is already an emitted
occurrence: `conductor.ts:7243` emits `{ type: 'kickback', from: 'wiring_check', to: 'build',
evidence, count }`. Inventing a provenance sidecar for it would be a parallel channel for a
concern the spine carries (`.agents/skills/event-spine/SKILL.md` §3). The event is currently
`persist: false` in the declarative sink table (`event-sinks.ts:56`), so it reaches the audit
trail — where `from` is flattened into a `cause` prose string (`audit-trail.ts:138-144`) — but
not `.pipeline/events.jsonl`. Flipping the one sink flag makes the structured record available
where the grader's inputs are assembled, with no new schema, no new writer, and no new reader
path. Event-spine verdict: channel? no. Concern: occurrence, already on the bus. Verdict:
extend nothing — persist an existing variant. Exception: none required.

**Durability.** `.pipeline/` is outside git, so the ledger survives the rebases that rewrite
commit shas — the same property the rebase-repair ledger relies on
(`docs/explanation/gates.md:316`) — and it is excluded from the graded diff by
`MACHINERY_AUTHORED_PATHS` (`build-review-inputs.ts:63`), so persisting more into it cannot
change what `build_review` grades.

**Failure posture.** Every read is fail-open. A missing, unreadable, or partially malformed
ledger yields an empty or partial collection and never throws — matching `readKickbackLedger`'s
documented posture and `assembleBuildReviewInputs`'s local-fallback behavior. A degraded ledger
must never be able to block a `build_review` that would otherwise run.

**Scope boundary.** `wiring_check` only, per operator decision. Only records with
`from === 'wiring_check'` **and** `to === 'build'` are surfaced; other gates' kickbacks are
filtered out. The conductor's kickback path itself is not modified. Making `remediate` reject a
remedy that contradicts a recorded gate instruction is out of scope and filed separately.

**Sequencing.** Task 1 persists the record. Tasks 2–4 build the reader. Tasks 5–7 build the
renderer. Task 8 is the end-to-end acceptance. Task 9 is docs plus the mandatory validation
suite.

## Prerequisites

- None. No new dependency, no config key, no schema migration, no step-topology change.

## Tasks

### Task 1: Persist the kickback event to the event ledger
**Story:** Story 1
**Type:** feature

**Steps:**
1. Write failing test: emit a `kickback` event through a wired `EventPersister` and assert a
   line lands in `.pipeline/events.jsonl` whose parsed JSON carries `type`, `from`, `to`,
   `evidence`, `count` and `ts`; assert the audit-trail record for the same event is unchanged.
2. Verify test fails (RED) — `kickback` is `persist: false` today.
3. Implement: set `kickback` to `persist: true` in `EVENT_SINKS`.
4. Add a test asserting an `evidence`-less kickback persists as valid JSON with the field absent.
5. Verify tests pass (GREEN).
6. Commit: "feat(events): persist kickback events to the event ledger"

**Files likely touched:**
- `src/conductor/src/engine/event-sinks.ts` — flip the `kickback` persist flag
- `src/conductor/test/engine/event-sinks.test.ts` — sink-declaration assertion
- `src/conductor/test/integration/audit-trail-completeness.integration.test.ts` — audit record unchanged

**Wired-into:** `src/conductor/src/engine/event-sinks.ts#EVENT_SINKS`
**Dependencies:** none

### Task 2: Existing ledger consumers tolerate the new line type
**Story:** Story 1, negative path 1
**Type:** test

**Steps:**
1. Write failing test: feed a ledger containing `kickback` lines to the report renderer, the
   timing rollup and the cost rollup; assert each produces the same output as for the same
   ledger with the `kickback` lines removed, and that none throws.
2. Verify tests fail or pass as characterization (RED where an assertion is new).
3. Implement whatever narrow tolerance a consumer turns out to lack; make no behavioral change
   to one that already ignores unknown types.
4. Verify tests pass (GREEN).
5. Commit: "test(events): ledger consumers ignore persisted kickback lines"

**Files likely touched:**
- `src/conductor/test/engine/report-renderer.test.ts` — unknown-type tolerance
- `src/conductor/src/engine/report-renderer.ts` — only if a gap is found

**Wired-into:** `src/conductor/src/engine/event-sinks.ts#persistedEventTypes`
**Dependencies:** Task 1

### Task 3: Read this feature's wiring_check kickbacks from the ledger
**Story:** Story 2, happy paths 1 & 2
**Type:** feature

**Steps:**
1. Write failing test: with a ledger containing two `{from:'wiring_check', to:'build'}`
   kickbacks, assert `assembleBuildReviewInputs` returns both in ledger order with verbatim
   `evidence` and their `count`; with a ledger containing none, assert an empty collection.
2. Verify test fails (RED).
3. Implement: add an optional gate-instruction field to `BuildReviewInputs`, documented in the
   same style as `repairContext`/`acceptedWidenings`, and a module-local reader that parses the
   ledger line-by-line and collects the qualifying records.
4. Verify tests pass (GREEN).
5. Commit: "feat(build_review): read wiring_check gate instructions from the event ledger"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — new optional input + ledger reader
- `src/conductor/test/engine/build-review-inputs.test.ts` — present/absent cases

**Wired-into:** `src/conductor/src/engine/build-review-inputs.ts#assembleBuildReviewInputs`
**Dependencies:** Task 1

### Task 4: The reader filters to wiring_check → build only
**Story:** Story 2, negative path 4
**Type:** feature

**Steps:**
1. Write failing test: a ledger containing `{from:'test_suite', to:'build'}`,
   `{from:'wiring_check', to:'plan'}` and `{type:'step_failed', step:'wiring_check'}`; assert
   none is returned.
2. Verify test fails (RED).
3. Implement the conjunctive `type`/`from`/`to` filter.
4. Verify tests pass (GREEN).
5. Commit: "feat(build_review): surface only wiring_check-to-build kickbacks"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — the filter predicate
- `src/conductor/test/engine/build-review-inputs.test.ts` — three rejection cases

**Wired-into:** `src/conductor/src/engine/build-review-inputs.ts#assembleBuildReviewInputs`
**Dependencies:** Task 3

### Task 5: A degraded ledger never blocks build_review
**Story:** Story 2, negative paths 1-3
**Type:** feature

**Steps:**
1. Write failing tests: ledger file absent; ledger with three truncated/malformed lines
   interleaved with well-formed ones; ledger unreadable (read rejects). Assert the call returns
   normally in all three cases, that the malformed case still returns every well-formed
   qualifying record, and that no error propagates.
2. Verify tests fail (RED).
3. Implement per-line parse isolation and a swallow-and-continue read, mirroring
   `readKickbackLedger`'s fail-open posture.
4. Verify tests pass (GREEN).
5. Commit: "fix(build_review): fail open on a missing or corrupt event ledger"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — error handling in the reader
- `src/conductor/test/engine/build-review-inputs.test.ts` — three degradation cases

**Wired-into:** `src/conductor/src/engine/build-review-inputs.ts#assembleBuildReviewInputs`
**Dependencies:** Task 3

### Task 6: The graded diff and the grader's input isolation are unchanged
**Story:** Story 2, happy path 3 and negative path 5
**Type:** test

**Steps:**
1. Write failing test: for a fixed repository state, assert the returned `diff` is
   byte-identical with and without ledger records present; assert the assembled inputs contain
   no task-status content, no transcript and no maker summary.
2. Verify tests fail or pass as characterization (RED where the assertion is new).
3. Implement only if a leak is found; otherwise no production change.
4. Verify tests pass (GREEN).
5. Commit: "test(build_review): graded diff and input isolation unchanged by gate context"

**Files likely touched:**
- `src/conductor/test/engine/build-review-isolation.test.ts` — isolation assertions
- `src/conductor/test/engine/build-review-inputs.test.ts` — diff-stability assertion

**Wired-into:** `src/conductor/src/engine/build-review-inputs.ts#MACHINERY_AUTHORED_PATHS`
**Dependencies:** Task 3

### Task 7: Render the third engine-recorded context section
**Story:** Story 3, happy paths 1, 2 & 4
**Type:** feature

**Steps:**
1. Write failing test: with one instruction, assert the prompt contains a new engine-recorded
   section naming the issuing gate and its verbatim evidence; with none, assert it renders
   `(none)`; with two, assert both appear as separate entries; assert the two pre-existing
   sections render byte-identically to their current output.
2. Verify test fails (RED).
3. Implement the renderer and its `(none)` fallback in `buildGraderPrompt`, positioned with the
   other engine-recorded sections.
4. Verify tests pass (GREEN).
5. Commit: "feat(build_review): render recorded gate instructions in the grader prompt"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — the third section
- `src/conductor/test/engine/build-review-prompt.test.ts` — populated/empty/multiple cases

**Wired-into:** `src/conductor/src/engine/build-review-prompt.ts#buildGraderPrompt`
**Dependencies:** Task 3

### Task 8: The section reads as evidence, not as an exemption
**Story:** Story 3, happy path 3 and negative paths 2-4
**Type:** feature

**Steps:**
1. Write failing tests: assert the section's prose states the instructions are evidence and not
   an exemption, directs the grader to judge whether the plan hunk implements the recorded
   instruction, and states that unmatched work remains subject to every rubric; assert a
   fenced-backtick `evidence` value leaves every section boundary intact.
2. Verify tests fail (RED).
3. Implement the framing prose and whatever escaping the fence case requires.
4. Verify tests pass (GREEN).
5. Commit: "feat(build_review): frame recorded gate instructions as evidence, not exemption"

**Files likely touched:**
- `src/conductor/src/engine/build-review-prompt.ts` — framing prose and escaping
- `src/conductor/test/engine/build-review-prompt.test.ts` — framing and fence-injection cases

**Wired-into:** `src/conductor/src/engine/build-review-prompt.ts#buildGraderPrompt`
**Dependencies:** Task 7

### Task 9: Acceptance — a gate-mandated anchor rewrite is not a scope violation
**Story:** Story 3, negative path 1
**Type:** test

**Steps:**
1. Write failing acceptance test: seed a ledger with a `wiring_check` kickback whose evidence
   names a task and its anchor, and a diff that rewrites that anchor in `.docs/plans/`; drive
   the real input-assembly and prompt-assembly flow with a faithful fake at the provider
   boundary; assert the assembled prompt carries the instruction and the anchor hunk together
   so the grader can attribute one to the other. Add the converse case: an unrelated
   `.docs/plans/` edit with no matching instruction is presented with no covering evidence.
2. Verify test fails (RED).
3. Implement any wiring gap the acceptance test exposes.
4. Verify tests pass (GREEN).
5. Commit: "test(build_review): gate-mandated anchor rewrite carries its instruction"

**Files likely touched:**
- `src/conductor/test/acceptance/build-review-gate-instruction-context.acceptance.test.ts` — new acceptance test

**Wired-into:** `src/conductor/src/engine/build-review-prompt.ts#buildGraderPrompt`
**Dependencies:** Task 5, Task 8

### Task 10: Documentation and validation
**Story:** Story 3
**Type:** docs

**Steps:**
1. Update `docs/explanation/gates.md` where `build_review`'s engine-recorded context is
   documented, describing the third section, its `wiring_check`-only scope, its
   evidence-not-exemption status, and its fail-open behavior on a degraded ledger.
2. Update `docs/reference/steps.md` if it enumerates the grader's inputs.
3. Run `test/test_harness_integrity.sh` and the full test suite; fix any failure.
4. Verify all checks pass.
5. Commit: "docs(gates): document build_review's recorded gate-instruction context"

**Files likely touched:**
- `docs/explanation/gates.md` — third engine-recorded context section
- `docs/reference/steps.md` — grader input enumeration, if present

**Wired-into:** none (no new production surface)
**Dependencies:** Task 9

## Task Dependency Graph

```
Task 1 ──┬─▶ Task 2
         └─▶ Task 3 ──┬─▶ Task 4
                      ├─▶ Task 6
                      ├─▶ Task 5 ─────────────┐
                      └─▶ Task 7 ──▶ Task 8 ──┴─▶ Task 9 ──▶ Task 10
```
