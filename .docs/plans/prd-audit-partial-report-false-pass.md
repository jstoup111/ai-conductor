# Implementation Plan: prd_audit passes on a partial report

**Date:** 2026-08-09
**Stories:** .docs/stories/prd-audit-partial-report-false-pass.md
**Conflict check:** Clean as of 2026-08-09 (2 blocking conflicts resolved; see `.docs/conflicts/2026-08-09-prd-audit-partial-report-false-pass.md`)

## Summary

Makes an incomplete `prd_audit` impossible to record as a pass, by moving the gate's pass signal
from a markdown blocking-row scan to a coverage-complete manifest, and by teaching the four sites
that read that signal to ask one shared completeness question. 18 tasks.

## Technical Approach

**The defect.** `prd_audit`'s completion predicate scores the audit by looking for *blocking rows
that are present* (`src/conductor/src/engine/artifacts.ts:2300`). An FR that was never audited
contributes no row, therefore no blocking row, therefore the gate passes — and
`writePrdAuditCodeStamp` then persists that pass for later reuse. The same fail-open shape is read
at four sites: `sweptArtifactStillValid:681`, the `#817` preserve pre-check `:2257`, the main path
`:2300`, and `classifyPrdAuditGaps:3267`.

**The pass signal.** A new `.pipeline/prd-audit.json` manifest carries the FR roster the audit
covered plus a verdict per roster entry. It is registered in `ARTIFACT_PATTERNS.prd_audit` with
`run` scope alongside the existing markdown entry, so the existing `findArtifactFiles` and sweep
machinery govern both as one unit — no new reader, no new lifecycle. `.pipeline/prd-audit.md`
survives as the human-readable view and leaves the trust path entirely. This mirrors
`.pipeline/build-review.json`, already registered the same way at `artifacts.ts:279`.

**One question, four callers.** `assessPrdAuditCoverage` is written once and called from all four
sites. The sites differ in what they *do* with the answer — spare, preserve, pass, classify — but
must not differ on what "complete" means; a site left asking the old question keeps the hole open.

**Reuse, don't fork, the FR parser.** `extractPrdFrIds` already exists at
`src/conductor/src/engine/engineer/coherence-validator.ts:184` and is consumed by
`checkFrCoverage:508`. It is module-private, so Task 1 exports it rather than authoring a second
parser — two FR parsers for one concept would be free to drift and would let `prd_audit` and the
coherence gate disagree about what a PRD requires. Verified 2026-08-09: its heading-scoped
semantics enumerate the same 43 of 48 non-`SUPERSEDED-` specs as a whole-file grep, so reuse costs
no coverage. Its empty-set fail-safe (`:509`) is the precedent for Story 5's non-enumerable
carve-out.

**The sweep is three-valued, not boolean.** Conflict 1 established that one boolean cannot mean
both "keep this file" and "this is a trustworthy verdict": sparing a partial manifest for resume
necessarily reports an incomplete audit as valid, and reporting it invalid necessarily deletes the
resume input. The sweep therefore returns `spare-as-valid` / `spare-for-resume` / `delete`, and
`spare-for-resume` grants no exemption from the completeness question.

**Routing.** Incompleteness is classified distinctly from a blocking-verdict gap and re-dispatches
`prd_audit` — BUILD cannot close an unfinished-audit gap. When an audit is both incomplete and
carrying a blocking verdict (reachable whenever it is killed after recording one), incompleteness
takes precedence per the ADR amendment. A lone re-dispatched member hits the width-1 degrade to the
serial path (`conductor.ts:4160`), so it gets the serial retry budget rather than the validation
branch's single attempt.

**Sequencing rationale.** Tasks 1-5 build the shared primitives with no behavior change. Task 6 is
the first behavioral cutover (main path). Tasks 8-11 migrate the remaining three sites. Tasks
12-14 change routing. Tasks 15-16 complete resume semantics. Task 17 updates the skill contract.
Task 18 pins the no-regression properties.

**Out of scope, deliberately.** The straggler itself, the 600s drain, and the frontier-worker /
lightweight-aggregator model split all require the engine to own per-FR dispatch and are tracked by
#1398. Reader-facing documentation for the changed gate contract is delivered by this repository's
`maintain-documentation` custom step, not by a plan task.

## Prerequisites

- None. No migration, no schema, no external setup. `.pipeline/` is already gitignored.

## Tasks

### Task 1: Export the existing PRD FR-id parser
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write failing test: importing `extractPrdFrIds` from the coherence-validator module returns
   `FR-1, FR-2` for a PRD whose Functional Requirements section lists them.
2. Verify test fails (RED) — the symbol is module-private.
3. Implement: change `function extractPrdFrIds` to `export function extractPrdFrIds`. No behavior
   change.
4. Verify test passes (GREEN).
5. Commit with message: "refactor(coherence): export extractPrdFrIds for reuse by prd_audit"

**Files likely touched:**
- `src/conductor/src/engine/engineer/coherence-validator.ts` — add `export`
- `src/conductor/test/engine/coherence-validator.test.ts` — import-surface test

**Wired-into:** `src/conductor/src/engine/engineer/coherence-validator.ts#checkFrCoverage`
**Dependencies:** none

### Task 2: Define the audit manifest shape and its parser
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `readPrdAuditManifest` returns a parsed manifest for well-formed JSON, and
   a distinct `unparseable` outcome for malformed JSON, and `absent` when no file exists.
2. Verify test fails (RED).
3. Implement: manifest interface (`frRoster: string[]`, `verdicts: Array<{ fr, verdict, gapClass?,
   accepted? }>`) plus a reader returning a discriminated outcome. No fallback to the markdown
   report on any failure path.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): add prd-audit manifest shape and reader"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — manifest interface + `readPrdAuditManifest`
- `src/conductor/test/engine/prd-audit-manifest.test.ts` — new

**Wired-into:** none (inert until `src/conductor/src/engine/artifacts.ts`)
**Dependencies:** none

### Task 3: Register the manifest as run-scoped gate evidence
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing test: `findArtifactFiles(dir, 'prd_audit')` returns both `.pipeline/prd-audit.md`
   and `.pipeline/prd-audit.json` when both are present.
2. Verify test fails (RED).
3. Implement: add `{ pattern: '.pipeline/prd-audit.json', scope: 'run' }` to
   `ARTIFACT_PATTERNS.prd_audit`.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): register prd-audit manifest as run-scoped evidence"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `ARTIFACT_PATTERNS`
- `src/conductor/test/engine/prd-audit-manifest.test.ts` — registry assertion

**Wired-into:** `src/conductor/src/engine/artifacts.ts#findArtifactFiles`
**Dependencies:** Task 2

### Task 4: Implement the shared coverage-completeness assessor
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: `assessPrdAuditCoverage` returns complete for a roster whose every entry has
   a verdict, and incomplete naming `FR-3` when `FR-3` has none.
2. Verify test fails (RED).
3. Implement: assessor consuming the Task 2 reader, returning `complete` or `incomplete` with the
   specific missing FR ids. Empty roster is incomplete.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): add shared prd-audit coverage assessor"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `assessPrdAuditCoverage`
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — new

**Wired-into:** none (inert until `src/conductor/src/engine/artifacts.ts`)
**Dependencies:** Task 2

### Task 5: Cross-check the roster against enumerable PRD FR ids
**Story:** Story 5
**Type:** happy-path

**Steps:**
1. Write failing test: a roster of `FR-1..FR-3` against specs enumerating `FR-1..FR-4` is
   incomplete naming `FR-4`; a superset roster is complete; specs with no enumerable ids skip the
   cross-check and record that it was skipped.
2. Verify test fails (RED).
3. Implement: extend the assessor to enumerate ids via the Task 1 export across non-`SUPERSEDED-`
   files in `.docs/specs/`, de-duplicating across files, and block a roster missing any enumerated
   id.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): cross-check prd-audit roster against enumerated FRs"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — assessor cross-check branch
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — cross-check cases

**Wired-into:** same as Task 4
**Dependencies:** Task 1, Task 4

### Task 6: Make the manifest the main path's pass signal
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test: the `prd_audit` predicate returns done for a complete non-blocking manifest
   and writes the code stamp; it returns not-done when a fresh report shows every FR aligned but no
   manifest exists.
2. Verify test fails (RED).
3. Implement: call the assessor in the main completion path before the blocking-row check; return
   not-done with the missing FRs named, and skip the code stamp, on incomplete.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): gate prd_audit completion on manifest coverage"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `prd_audit` completion predicate
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — predicate cases

**Wired-into:** `src/conductor/src/engine/artifacts.ts#prd_audit`
**Dependencies:** Task 3, Task 4

### Task 7: Reject every malformed manifest shape on the main path
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing test: the predicate returns not-done for each of unparseable JSON, empty roster,
   roster entry with no verdict, and roster entry with an unrecognized verdict string — and writes
   no code stamp in any of those cases.
2. Verify test fails (RED).
3. Implement: whatever assessor/predicate branches the four cases require; no path falls back to
   scanning the markdown report.
4. Verify test passes (GREEN).
5. Commit with message: "test(gates): pin prd-audit rejection of every malformed manifest shape"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — assessor branches
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — four negative cases

**Wired-into:** same as Task 6
**Dependencies:** Task 6

### Task 8: Make the stale-evidence sweep outcome three-valued
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test: the sweep decision for `prd_audit` returns `spare-as-valid` for a complete
   non-blocking manifest with a validating stamp, and never returns `spare-as-valid` for an
   incomplete manifest however valid its stamp.
2. Verify test fails (RED).
3. Implement: replace the boolean at the `prd_audit` branch of `sweptArtifactStillValid` with the
   three-valued outcome, keeping `architecture_review_as_built` behavior unchanged.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): split prd-audit sweep outcome from verdict validity"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `sweptArtifactStillValid`
- `src/conductor/test/engine/prd-audit-sweep.test.ts` — new

**Wired-into:** `src/conductor/src/engine/artifacts.ts#sweptArtifactStillValid`
**Dependencies:** Task 4

### Task 9: Retain an incomplete manifest as resume input when code is unchanged
**Story:** Story 7
**Type:** happy-path

**Steps:**
1. Write failing test: with an incomplete manifest and a validating stamp the sweep returns
   `spare-for-resume` and the file survives on disk; with a stamp that does not validate it returns
   `delete` and both manifest and report are removed.
2. Verify test fails (RED).
3. Implement: `spare-for-resume` branch driven by the existing `gateVerdictStillValid` answer.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): retain a partial prd-audit manifest for resume"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — sweep resume branch
- `src/conductor/test/engine/prd-audit-sweep.test.ts` — resume cases

**Wired-into:** same as Task 8
**Dependencies:** Task 8

### Task 10: Re-ask completeness in the code-validity preserve pre-check
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test: with a validating stamp, a complete non-blocking manifest preserves
   completion; an incomplete manifest does not preserve and the step re-dispatches; a stamp plus
   report but no manifest does not preserve.
2. Verify test fails (RED).
3. Implement: call the assessor inside the preserve pre-check before returning preserved.
4. Verify test passes (GREEN).
5. Commit with message: "fix(gates): stop preserving a prd_audit pass formed from a partial audit"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — preserve pre-check
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — preserve cases

**Wired-into:** same as Task 6
**Dependencies:** Task 6

### Task 11: Teach the daemon gap classifier to report incompleteness
**Story:** Story 4
**Type:** happy-path

**Steps:**
1. Write failing test: `classifyPrdAuditGaps` returns clean and impl-only unchanged for complete
   manifests, returns an incompleteness classification for an incomplete one with no blocking
   entries, and carries both facts when an incomplete manifest also holds a blocking verdict.
2. Verify test fails (RED).
3. Implement: extend `PrdGapClassification` with the incompleteness kind and populate it from the
   assessor; leave staleness handling untouched.
4. Verify test passes (GREEN).
5. Commit with message: "feat(gates): classify an incomplete prd-audit distinctly from a clean one"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `classifyPrdAuditGaps`, `PrdGapClassification`
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — classifier cases

**Wired-into:** `src/conductor/src/engine/artifacts.ts#classifyPrdAuditGaps`
**Dependencies:** Task 4

### Task 12: Route an incomplete audit back to prd_audit, never to BUILD
**Story:** Story 6
**Type:** happy-path

**Steps:**
1. Write failing test: in auto mode an incomplete audit re-dispatches `prd_audit` and constructs no
   BUILD-targeted remediation work order; a complete audit with an `impl-gap` still routes to BUILD
   and one with `intended-drift` still halts.
2. Verify test fails (RED).
3. Implement: branch on the incompleteness classification at the `prd_audit` routing site before
   the gap-class routing.
4. Verify test passes (GREEN).
5. Commit with message: "fix(conductor): re-dispatch prd_audit on an incomplete audit"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — `prd_audit` kickback routing
- `src/conductor/test/engine/prd-audit-incomplete-routing.test.ts` — new

**Wired-into:** `src/conductor/src/engine/conductor.ts#run`
**Dependencies:** Task 11

### Task 13: Give incompleteness precedence over a co-occurring blocking verdict
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing test: an audit that is both incomplete and carries a blocking `impl-gap`
   re-dispatches `prd_audit` rather than routing to BUILD; the same with `intended-drift`
   re-dispatches rather than halting; the recorded blocking verdicts survive the re-dispatch.
2. Verify test fails (RED).
3. Implement: order the incompleteness branch ahead of gap-class routing for both classes.
4. Verify test passes (GREEN).
5. Commit with message: "fix(conductor): incompleteness outranks a blocking prd-audit verdict"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — routing precedence
- `src/conductor/test/engine/prd-audit-incomplete-routing.test.ts` — precedence cases

**Wired-into:** same as Task 12
**Dependencies:** Task 12

### Task 14: Halt naming the missing FRs when re-audits are exhausted
**Story:** Story 6
**Type:** negative-path

**Steps:**
1. Write failing test: an audit still incomplete after the retry budget halts with a reason naming
   the FRs that never received a verdict, rather than looping; interactive mode surfaces the
   missing FRs and proposes no BUILD kickback.
2. Verify test fails (RED).
3. Implement: carry the missing-FR list into the exhaustion halt reason and the interactive
   message.
4. Verify test passes (GREEN).
5. Commit with message: "feat(conductor): name the unaudited FRs when re-audits are exhausted"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — exhaustion halt reason
- `src/conductor/test/engine/prd-audit-incomplete-routing.test.ts` — exhaustion cases

**Wired-into:** same as Task 12
**Dependencies:** Task 13

### Task 15: Prove repeated partial resumes cannot accumulate into a pass
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing test: a resumed run that is itself killed early still returns not-done; a
   preserved blocking verdict survives resume and still blocks; a resumed run is granted no
   exemption from the coverage check.
2. Verify test fails (RED).
3. Implement: whatever merge/assessor ordering the cases require so the assessor always runs
   against the merged manifest.
4. Verify test passes (GREEN).
5. Commit with message: "test(gates): pin that partial prd-audit resumes never accumulate a pass"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — assessor ordering on the resume path
- `src/conductor/test/engine/prd-audit-sweep.test.ts` — resume negative cases

**Wired-into:** same as Task 9
**Dependencies:** Task 9

### Task 16: Force a full re-audit when no code stamp is present
**Story:** Story 7
**Type:** negative-path

**Steps:**
1. Write failing test: an incomplete manifest with no code stamp yields `delete`, so every FR is
   re-audited — failing safe toward more work rather than less.
2. Verify test fails (RED).
3. Implement: treat an absent or unreadable stamp as non-validating in the sweep's resume branch.
4. Verify test passes (GREEN).
5. Commit with message: "fix(gates): re-audit every FR when a prd-audit code stamp is absent"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — sweep resume branch
- `src/conductor/test/engine/prd-audit-sweep.test.ts` — missing-stamp case

**Wired-into:** same as Task 9
**Dependencies:** Task 9

### Task 17: Make the skill write the manifest and fill only missing FRs
**Story:** Story 7
**Type:** infrastructure

**Steps:**
1. Write failing test: the skill asset asserts the manifest write obligation and the
   resume-from-surviving-manifest instruction are present in `skills/prd-audit/SKILL.md`.
2. Verify test fails (RED).
3. Implement: update SKILL.md §3/§4 — write `.pipeline/prd-audit.json` with the roster and per-FR
   verdicts as the authoritative output, rewrite the merged report, and when a manifest survives,
   audit only the FRs lacking a verdict.
4. Verify test passes (GREEN).
5. Commit with message: "docs(skill): prd-audit writes a coverage-complete manifest"

**Files likely touched:**
- `skills/prd-audit/SKILL.md` — sections 3 and 4
- `src/conductor/test/skill-contract.test.ts` — skill contract assertion

**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

### Task 18: Pin the no-regression properties of the clean path
**Story:** Story 8
**Type:** negative-path

**Steps:**
1. Write failing test: a complete all-aligned audit passes with no review marker; an `ACCEPTED`
   divergence remains non-blocking; `#655` delta-aware rebase preservation of a complete
   `prd_audit` still holds in both the preserve and the invalidate direction; the finish-time
   validation fence reports a complete clean audit green.
2. Verify test fails (RED) for any property the new code has disturbed.
3. Implement: correct whatever the failures expose; if all pass unchanged, the task is a
   verification of existing behavior.
4. Verify test passes (GREEN).
5. Commit with message: "test(gates): pin prd-audit clean-path and rebase-preservation behavior"

**Files likely touched:**
- `src/conductor/test/engine/prd-audit-coverage.test.ts` — clean-path cases
- `src/conductor/test/integration/rebase-tail-preserve.test.ts` — preservation regression

**Wired-into:** none (no new production surface)
**Dependencies:** Task 10, Task 11

## Task Dependency Graph

```text
Task 1 ─┐
        ├─► Task 5 ─┐
Task 2 ─┼─► Task 4 ─┼─► Task 6 ─┬─► Task 7
        └─► Task 3 ─┘           ├─► Task 10 ─┐
                    │           └─► Task 17  │
                    ├─► Task 8 ─► Task 9 ─┬─► Task 15
                    │                     ├─► Task 16
                    └─► Task 11 ─┬─► Task 12 ─► Task 13 ─► Task 14
                                 └─────────────────────────────────► Task 18
                                                (also depends on Task 10)
```

## Integration Points

- **After Task 6:** an incomplete manifest blocks the gate on the main path — the false ship is
  closed for the primary route, though the other three sites still read the old way.
- **After Task 11:** all four read sites share one completeness question; no path scores a partial
  audit as clean.
- **After Task 14:** an incomplete audit self-heals through re-dispatch and halts legibly when it
  cannot.
- **After Task 17:** the skill produces the manifest the gate requires, so the loop closes
  end-to-end.

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
