# Implementation Plan: Durable base-advance attribution for build_review repair context

**Date:** 2026-08-13
**Stories:** .docs/stories/rebase-invalidated-test-failures-never-reach-build.md
**Conflict check:** Clean as of 2026-08-13

## Summary

Moves base-advance attribution off a gate-verdict field that every gate run overwrites and onto the
existing append-only event spine, makes repair recording gate-agnostic and unbounded per advance,
corrects the path classifier that hid the incident's own file, and records grading provenance.
25 tasks.

## Technical Approach

Four independent seams, sequenced only where one genuinely feeds another.

**The record (Tasks 1–7).** `rebase_changed` gains a second path field carrying the **unfiltered**
rebase delta. `changedCodePaths` is untouched — it answers "what invalidates a gate's judgement"
and `adr-2026-07-20` owns it; the new field answers "what a file read on this branch might now
hit", and those sets differ. `event-sinks.ts` flips `rebase_changed` and `rebase_gate_invalidated`
to `persist: true`; `EventPersister` subscribes via `persistedEventTypes()`, so this is the whole
wiring. Persisted lines already carry `ts` (ISO 8601, `event-persister.ts:123`), which supplies the
join's time conjunct with no new field.

One behavioral split matters: `computeRebaseOutcome` currently returns `{kind:'noop'}` when the
filtered delta is empty (`rebase.ts:774`), which would suppress the record exactly when the delta
is all excluded paths. Emission and invalidation become separate conditions — the record is written
whenever the base advanced, while the no-op outcome (and therefore gate preservation) is unchanged.
Conflict-check C2, operator-confirmed.

**The classifier (Tasks 8–10).** `isCodeOrTestPath` (`rebase.ts:377-388`) drops its blanket
`\.(md|mdx|txt|rst)$` exclusion, leaving the four enumerated exclusions as the whole rule. Three of
those four already carry live behavior — `.docs/audits/*.json`, `.docs/coherence/.gitkeep`, and
`docs/_config.yml` are non-markdown and excluded only by the directory rules — so this narrows the
predicate rather than rewriting it.

**The join (Tasks 11–15).** `wasInvalidatedByRebase` is deleted. A gate failure attributes to an
advance only when it occurred after that advance **and** its diagnostic implicates a path the
advance changed. Path overlap is required, not optional: a time-only join would make any base
advance blanket permission to delete coverage. The search spans the feature's whole recorded
history because `rebase` is a finish-time step (`steps.ts:271`) running *after* `build_review`
(`steps.ts:181`) — a lap-scoped join would be inert on the originating incident.

**The recorder and provenance (Tasks 16–25).** Recording takes the observing gate as a parameter
and keys on `(advance, failure)`, replacing the `consumedInvalidations` cap that allowed one record
per advance. The legacy ledger shape reads as empty — never malformed, never fabricating a record
from the old field. Provenance rides the spine as an event distinguishing three cases: context
available, none warranted, none because nothing joined.

**Verified, not re-derived** (`.pipeline/verify-claims-architecture-review-1535.md`): the Conductor
receives the feature-scoped emitter and `projectRoot === wt.path === EventPersister target ===
featureRoot`, so the ledger writer, event writer, and ledger reader all address one directory. All
`events.jsonl` readers filter by positive type match, so new persisted types are backward
compatible.

**Deliberate constraint.** No task asserts how many evidence blocks or rubric items exist. The
unmerged `repeated-build-review-semantic-failures-can-churn-` adds `removalContext` to the same two
files and imposes the mirror constraint on itself, so the two may land in either order.

**Documentation obligations (not planned here).** This repository configures a gating
`maintain-documentation` step which owns human-facing docs, and `/plan`'s documentation boundary
forbids doc tasks. Recorded so that step does not lose them: `docs/explanation/gates.md` (repair
context is now gate-agnostic and multi-record) and `docs/reference/artifacts.md`
(`rebase_changed`/`rebase_gate_invalidated` now appear in `.pipeline/events.jsonl`).

## Prerequisites

None. No migration, no config key, no new dependency. `.pipeline/` is run evidence and is rebuilt
per feature.

## Tasks

### Task 1: Add the unfiltered-delta field to the rebase_changed event type
**Story:** 2
**Type:** infrastructure

**Steps:**
1. Write failing test: a `rebase_changed` event literal carrying both `changedPaths` and the new
   unfiltered field type-checks, and the new field is optional so existing emitters compile.
2. Verify test fails (RED)
3. Implement: add the field to the `rebase_changed` member of the `ConductorEvent` union with a
   doc comment stating it is the complete delta, distinct from the gate-invalidation set.
4. Verify test passes (GREEN)
5. Commit with message: "rebase_changed carries the complete base-advance delta"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — new optional field on `rebase_changed`

**Dependencies:** none

---

### Task 2: Carry the unfiltered delta through the changed outcome
**Story:** 2
**Type:** happy-path

**Steps:**
1. Write failing test: `computeRebaseOutcome` over a delta containing both a source path and an
   excluded path returns an outcome whose complete path set has both, while `changedCodePaths` has
   only the source path.
2. Verify test fails (RED)
3. Implement: retain the pre-filter `changed` list on the `changed` outcome alongside
   `changedCodePaths`.
4. Verify test passes (GREEN)
5. Commit with message: "carry the complete rebase delta on the changed outcome"

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `RebaseOutcome` changed variant, `classifyClean`

**Dependencies:** Task 1

---

### Task 3: Preserve gate-invalidation behavior byte-for-byte
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: for a delta mixing source, test and excluded paths,
   `classifyGateInvalidation` returns exactly the gate set it returns before this change.
2. Verify test fails (RED) — or passes immediately, in which case keep it as the regression lock.
3. Implement: assert no call site reads the new field for invalidation decisions.
4. Verify test passes (GREEN)
5. Commit with message: "lock gate invalidation against the delta-field split"

**Files likely touched:**
- `src/conductor/test/engine/gate-invalidation.test.ts` — regression lock

**Dependencies:** Task 2

---

### Task 4: Preserve the uncomputable-delta fail-closed path
**Story:** 2
**Type:** negative-path

**Steps:**
1. Write failing test: when the rebase delta diff throws, the outcome carries no complete path set
   and still forces the existing fail-closed behavior (treated as changed, `featureSurface`
   undefined).
2. Verify test fails (RED)
3. Implement: leave the new field undefined on the `dUncomputable` branch.
4. Verify test passes (GREEN)
5. Commit with message: "uncomputable delta leaves the complete path set absent"

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `dUncomputable` branch

**Dependencies:** Task 2

---

### Task 5: Emit the base-advance record when the delta is entirely excluded paths
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a rebase whose delta contains only `.docs/` and `docs/` paths still emits a
   `rebase_changed` record carrying those paths, while the outcome remains a no-op and
   `applyRebaseVerdicts` invalidates no gate.
2. Verify test fails (RED)
3. Implement: split emission from classification at the `codePaths.length === 0` early return so
   the record is emitted whenever the base advanced; the no-op outcome is unchanged.
4. Verify test passes (GREEN)
5. Commit with message: "record a base advance even when its delta invalidates nothing"

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `computeRebaseOutcome` no-op return, `emitRebaseEvent`

**Dependencies:** Task 2

---

### Task 6: Persist the base-advance events
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `persistedEventTypes()` includes `rebase_changed` and
   `rebase_gate_invalidated`.
2. Verify test fails (RED)
3. Implement: flip both sink declarations to `persist: true`, leaving `render` and `audit` as they
   are.
4. Verify test passes (GREEN)
5. Commit with message: "persist base-advance events to the feature event log"

**Files likely touched:**
- `src/conductor/src/engine/event-sinks.ts` — two sink declarations

**Dependencies:** none

---

### Task 7: Read base-advance history from the feature event log
**Story:** 1
**Type:** infrastructure

**Steps:**
1. Write failing test: given an `events.jsonl` containing two `rebase_changed` lines and unrelated
   lines, the reader returns both advances in order with their paths and `ts`.
2. Verify test fails (RED)
3. Implement: a reader that scans the worktree's `.pipeline/events.jsonl` for base-advance records.
4. Verify test passes (GREEN)
5. Commit with message: "read recorded base advances from the feature event log"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — base-advance reader

**Dependencies:** Task 6

---

### Task 8: Tolerate an absent or malformed event log
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing test: an absent `events.jsonl` yields an empty advance list without throwing; a
   log containing one malformed line and two valid records yields both valid records.
2. Verify test fails (RED)
3. Implement: skip unparseable lines; treat a read failure as an empty history.
4. Verify test passes (GREEN)
5. Commit with message: "tolerate absent and malformed lines when reading advances"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — reader error handling

**Dependencies:** Task 7

---

### Task 9: Invert the markdown default in the path classifier
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing test: `agents/planner.md`, `skills/tdd/SKILL.md`, `tech-context/x.md`,
   `templates/y.md`, `HARNESS.md` and `AGENT_INSTRUCTIONS.md` all classify as code/test.
2. Verify test fails (RED)
3. Implement: remove the blanket markdown exclusion, leaving the four enumerated exclusions.
4. Verify test passes (GREEN)
5. Commit with message: "harness markdown classifies as source, not documentation"

**Files likely touched:**
- `src/conductor/src/engine/rebase.ts` — `isCodeOrTestPath`

**Dependencies:** none

---

### Task 10: Hold the documentation exclusions, including their non-markdown members
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: `.docs/plans/x.md`, `.docs/audits/y.json`, `.docs/coherence/.gitkeep`,
   `docs/guides/z.md`, `docs/_config.yml`, `README`, `README.md`, `a/b/README.md` and
   `CHANGELOG.md` all classify as NOT code/test.
2. Verify test fails (RED)
3. Implement: confirm the enumerated exclusions cover every case, including the three tracked
   non-markdown paths previously excluded only by the directory rules.
4. Verify test passes (GREEN)
5. Commit with message: "documentation exclusions cover their non-markdown members"

**Files likely touched:**
- `src/conductor/test/engine/rebase-path-classification.test.ts` — exclusion coverage

**Dependencies:** Task 9

---

### Task 11: Keep the test-path distinction unchanged under the inverted default
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing test: `isRuntimeSourcePath` still excludes `x.test.ts` and `test/y.ts`, and a
   markdown file under `test/` classifies as a test path rather than runtime source.
2. Verify test fails (RED)
3. Implement: confirm `isTestPath` is untouched and composes correctly with the new predicate.
4. Verify test passes (GREEN)
5. Commit with message: "runtime-source and test-path distinction survives the inversion"

**Files likely touched:**
- `src/conductor/test/engine/gate-invalidation.test.ts` — runtime/test composition

**Dependencies:** Task 9

---

### Task 12: Match a failure diagnostic against an advance's changed paths
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: a diagnostic naming `agents/planner.md` overlaps an advance whose paths
   include it, and does not overlap an advance whose paths do not.
2. Verify test fails (RED)
3. Implement: a path-overlap predicate over an advance's complete path set and a failure
   diagnostic.
4. Verify test passes (GREEN)
5. Commit with message: "match a failure diagnostic against an advance's paths"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — overlap predicate

**Dependencies:** Task 7

---

### Task 13: Require the failure to follow the advance
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: a failure observed before an advance's `ts` does not attribute to it even
   when the paths overlap.
2. Verify test fails (RED)
3. Implement: add the ordering conjunct to the join.
4. Verify test passes (GREEN)
5. Commit with message: "a failure preceding an advance never attributes to it"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — ordering conjunct

**Dependencies:** Task 12

---

### Task 14: Search the feature's whole recorded history
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: an advance recorded before an earlier `build_review` grade still matches a
   failure observed on a later lap; with several advances recorded, the matching one is identified.
2. Verify test fails (RED)
3. Implement: scan all recorded advances rather than only the most recent.
4. Verify test passes (GREEN)
5. Commit with message: "attribute across the feature's whole advance history"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — history-wide resolution

**Dependencies:** Task 13

---

### Task 15: Refuse attribution when nothing overlaps
**Story:** 4
**Type:** negative-path

**Steps:**
1. Write failing test: a diagnostic naming an unrelated path, a diagnostic naming no path at all,
   and a feature with no recorded advances each produce no repair record and raise nothing.
2. Verify test fails (RED)
3. Implement: return no result on each branch.
4. Verify test passes (GREEN)
5. Commit with message: "no overlap yields no repair record"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — no-match branches

**Dependencies:** Task 14

---

### Task 16: Delete the gate-verdict attribution predicate
**Story:** 4
**Type:** refactor

**Steps:**
1. Write failing test: the module no longer exports the kickback-provenance predicate.
2. Verify test fails (RED)
3. Implement: remove `wasInvalidatedByRebase` and the assertions covering it.
4. Verify test passes (GREEN)
5. Commit with message: "remove the transient kickback-provenance attribution predicate"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — remove predicate
- `src/conductor/test/engine/test-suite-remediation.test.ts` — remove its assertions

**Dependencies:** Task 15

---

### Task 17: Record a repair against a resolved advance, gate-agnostically
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: recording a failure observed by a gate other than `test_suite` produces a
   repair record naming that gate.
2. Verify test fails (RED)
3. Implement: take the observing gate as a parameter and resolve the advance via the join instead
   of reading a gate verdict.
4. Verify test passes (GREEN)
5. Commit with message: "record repairs from any observing gate"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — recorder signature and body

**Dependencies:** Task 16

---

### Task 18: Accrue several repairs against one advance
**Story:** 5
**Type:** happy-path

**Steps:**
1. Write failing test: two distinct failures against one advance yield two records; the same
   failure recorded twice yields one.
2. Verify test fails (RED)
3. Implement: key records on `(advance, failure)` and drop the `consumedInvalidations` cap.
4. Verify test passes (GREEN)
5. Commit with message: "one advance can explain several repairs"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — ledger keying

**Dependencies:** Task 17

---

### Task 19: Preserve concurrent recordings
**Story:** 5
**Type:** negative-path

**Steps:**
1. Write failing test: two concurrent recordings of distinct failures both survive and the ledger
   remains valid JSON; an unacquirable lock surfaces rather than silently dropping the record.
2. Verify test fails (RED)
3. Implement: retain the existing lease/lock discipline around the new keying.
4. Verify test passes (GREEN)
5. Commit with message: "concurrent repair recordings do not lose each other"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — locked read-modify-write

**Dependencies:** Task 18

---

### Task 20: Read a legacy ledger as empty
**Story:** 8
**Type:** negative-path

**Steps:**
1. Write failing test: a ledger carrying the old advance-consumption field yields zero records, no
   error, and no record fabricated from that field; an unparseable ledger yields zero records
   without throwing; a record missing a required field is skipped while its siblings survive.
2. Verify test fails (RED)
3. Implement: normalize the legacy shape to an empty record set on read.
4. Verify test passes (GREEN)
5. Commit with message: "a legacy repair ledger reads as empty, never fabricated"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — ledger read normalization

**Dependencies:** Task 18

---

### Task 21: Write a valid new-shape ledger over a legacy one
**Story:** 8
**Type:** happy-path

**Steps:**
1. Write failing test: recording a repair against a legacy-shape ledger succeeds and leaves a
   ledger that reads back in the new shape.
2. Verify test fails (RED)
3. Implement: write the normalized shape on the next mutation.
4. Verify test passes (GREEN)
5. Commit with message: "recording over a legacy ledger produces the new shape"

**Files likely touched:**
- `src/conductor/src/engine/test-suite-remediation.ts` — ledger write path

**Dependencies:** Task 20

---

### Task 22: Route the deterministic-failure call sites through the gate-agnostic recorder
**Story:** 5
**Type:** infrastructure

**Steps:**
1. Write failing test: a `test_suite` full-suite failure and a non-`test_suite` deterministic gate
   failure both reach the recorder with their own gate identity, and neither reads a gate verdict
   for attribution.
2. Verify test fails (RED)
3. Implement: replace the verdict-reading helper at both call sites, passing the observing gate.
4. Verify test passes (GREEN)
5. Commit with message: "route deterministic gate failures through the gate-agnostic recorder"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — remove the verdict-reading helper; update both
  deterministic-failure call sites

**Dependencies:** Task 17

---

### Task 23: Add the grading-provenance event
**Story:** 6
**Type:** infrastructure

**Steps:**
1. Write failing test: the provenance event type carries the three distinguishable cases and is
   included in `persistedEventTypes()`.
2. Verify test fails (RED)
3. Implement: add the union member and its sink declaration.
4. Verify test passes (GREEN)
5. Commit with message: "add the build_review grading-provenance event"

**Files likely touched:**
- `src/conductor/src/types/events.ts` — provenance union member
- `src/conductor/src/engine/event-sinks.ts` — provenance sink declaration

**Dependencies:** Task 6

---

### Task 24: Emit provenance distinguishing the three grading cases
**Story:** 6
**Type:** happy-path

**Steps:**
1. Write failing test: with repair records present the event reports context available and their
   count; with none and no recorded advance it reports none warranted; with none but an advance
   recorded it reports no join — all three distinguishable.
2. Verify test fails (RED)
3. Implement: emit from the grader input-assembly path.
4. Verify test passes (GREEN)
5. Commit with message: "record whether build_review graded with repair context"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — provenance emission

**Dependencies:** Task 23

---

### Task 25: Keep grading independent of provenance and of block count
**Story:** 7
**Type:** negative-path

**Steps:**
1. Write failing test: a provenance write failure still produces grader inputs; the repair block
   renders each record with identifier and diagnostic, renders its explicit empty state when there
   are none, and the assertions reference the repair block by name without asserting how many
   evidence blocks exist.
2. Verify test fails (RED)
3. Implement: isolate provenance emission from input assembly; assert the block by name only.
4. Verify test passes (GREEN)
5. Commit with message: "grading survives provenance failure and stays block-count agnostic"

**Files likely touched:**
- `src/conductor/src/engine/build-review-inputs.ts` — provenance isolation
- `src/conductor/test/engine/build-review-prompt.test.ts` — name-anchored block assertions

**Dependencies:** Task 24

---

## Task Dependency Graph

```
Task 1 ─→ Task 2 ─┬─→ Task 3
                  ├─→ Task 4
                  └─→ Task 5

Task 6 ─┬─→ Task 7 ─┬─→ Task 8
        │           └─→ Task 12 ─→ Task 13 ─→ Task 14 ─→ Task 15 ─→ Task 16 ─→ Task 17 ─┬─→ Task 18 ─┬─→ Task 19
        │                                                                                │            └─→ Task 20 ─→ Task 21
        │                                                                                └─→ Task 22
        └─→ Task 23 ─→ Task 24 ─→ Task 25

Task 9 ─┬─→ Task 10
        └─→ Task 11
```

Tasks 1, 6 and 9 are independent roots. The classifier chain (9–11) and the record chain (1–5) can
proceed in parallel with the join chain (6–8, 12–22).

## Integration Points

- **After Task 6:** base-advance records are readable from a real feature worktree's event log.
- **After Task 9:** a base advance touching `agents/*.md` classifies as file-changing end to end.
- **After Task 17:** a base-advance-caused failure from any gate produces a repair record.
- **After Task 22:** the originating incident is exercisable end to end — a base advance deleting a
  markdown persona, a failing branch test, a recorded repair, and a populated grader block.
- **After Task 24:** an operator can read the grading case from the run's artifacts.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No task names another feature's sealed artifact
- [ ] No task asserts an evidence-block or rubric-item count
