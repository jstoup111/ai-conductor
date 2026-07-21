# Implementation Plan: acceptance_specs RED-evidence determinism (#741)

**Date:** 2026-07-21
**Design:** .docs/decisions/adr-2026-07-21-engine-owned-acceptance-red-execution.md
**Stories:** .docs/stories/acceptance-specs-red-evidence.md
**Conflict check:** Clean as of 2026-07-21 (.docs/conflicts/2026-07-21-acceptance-specs-red-evidence.md — 1 blocking resolved via ADR supersession)
**Complexity:** Medium (.docs/complexity/acceptance-specs-halts-when-the-red-evidence-marke.md)

## Summary
Make acceptance_specs RED-evidence deterministic: the writing-system-tests skill records a
`{command, cwd, targetSpecs}` run contract; the engine executes it (from the recorded cwd) as a
step-path self-heal when the RED marker is missing, writing the marker to the authoritative
worktree-root path and re-validating via the existing validator. 13 tasks.

## Technical Approach
- **New run-contract file** `.pipeline/acceptance-specs-run.json` — authored by the skill at
  spec-generation time (its judgement output; the engine never guesses the command).
- **New engine module** `src/conductor/src/engine/acceptance-red-runner.ts` — (a) parses/validates
  the run contract (shape, `cwd` exists, `targetSpecs` cross-check vs the globbed spec files), (b)
  executes the recorded command from the recorded cwd, (c) writes `.pipeline/acceptance-specs-red.json`
  to the **worktree root**, (d) normalizes a stray nested marker up to the root, (e) re-validates
  with the EXISTING `validateAcceptanceRedEvidence` (reused, unchanged — preserves all negative paths).
- **Self-heal call site** in `Conductor.run`'s acceptance_specs step handling: on a completion-gate
  miss naming the missing/invalid RED marker WITH spec files present, invoke the runner ONCE per step
  attempt, before spending the retry budget — mirroring the existing `deriveCompletion`/self-heal seam.
- **Completion predicate unchanged**: `artifacts.ts` `acceptance_specs` stays a pure read of the
  worktree-root marker. Execution lives only in the step seam (predicates may be evaluated repeatedly).
- **Fallback**: contract absent/malformed → the self-heal declines and the step fails with an explicit
  reason; the retry re-dispatches the skill with a hard directive to author the contract AND execute.
- **Docs**: README + src/conductor/README + CHANGELOG [Unreleased]; SKILL.md §6 records the contract.

## Prerequisites
- None external. All changes are within `src/conductor/` and `skills/writing-system-tests/`.

## Tasks

### Task 1: Contract type + parser (RED)
**Story:** T-2 (happy: contract has command/cwd/targetSpecs)
**Type:** infrastructure
**Steps:**
1. Write failing unit test: `parseAcceptanceRunContract(raw)` returns `{ok:true, contract}` for valid
   JSON and `{ok:false, reason}` for non-JSON / missing `command` / empty `targetSpecs`.
2. Verify RED.
3. Implement `parseAcceptanceRunContract` + the `AcceptanceRunContract` type.
4. Verify GREEN.
5. Commit: "feat(acceptance-red): parse+validate the run contract shape".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — new module, parser + type
- src/conductor/test/engine/acceptance-red-runner.test.ts — parser tests

**Wired-into:** same as Task 6 (parser consumed by the runner, wired at the self-heal call site)
**Dependencies:** none

### Task 2: Contract cross-check — targetSpecs are real committed specs (RED)
**Story:** T-2 (negative: targetSpecs don't match committed specs)
**Type:** negative-path
**Steps:**
1. Write failing test: given globbed spec files `[a.test.ts]` and a contract naming `[b.test.ts]`,
   validation returns `{ok:false, reason: /targetSpecs .* not among committed specs/}`.
2. Verify RED.
3. Implement the cross-check against the caller-supplied globbed spec list.
4. Verify GREEN.
5. Commit: "feat(acceptance-red): reject a contract naming non-committed specs".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — cross-check
- src/conductor/test/engine/acceptance-red-runner.test.ts — cross-check tests

**Wired-into:** same as Task 6
**Dependencies:** 1

### Task 3: Contract cwd existence guard (RED)
**Story:** T-2 (negative: cwd does not exist)
**Type:** negative-path
**Steps:**
1. Write failing test: a contract whose `cwd` is absent under the worktree returns
   `{ok:false, reason: /contract cwd not found/}` — no exec attempted.
2. Verify RED.
3. Implement the cwd existence check (resolved under the worktree root; reject `../` escape).
4. Verify GREEN.
5. Commit: "feat(acceptance-red): guard contract cwd existence + path escape".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — cwd guard
- src/conductor/test/engine/acceptance-red-runner.test.ts — cwd tests

**Wired-into:** same as Task 6
**Dependencies:** 1

### Task 4: Marker written to authoritative worktree-root path (RED)
**Story:** T-3 (happy: marker at root, not nested)
**Type:** happy-path
**Steps:**
1. Write failing test: after a simulated successful run, the runner writes
   `<worktree>/.pipeline/acceptance-specs-red.json` (root), never `<worktree>/src/conductor/.pipeline/`.
2. Verify RED.
3. Implement the writer using the worktree root + `ACCEPTANCE_SPECS_RED_EVIDENCE`, independent of the
   run cwd.
4. Verify GREEN.
5. Commit: "feat(acceptance-red): write RED marker at authoritative worktree-root path".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — marker writer
- src/conductor/test/engine/acceptance-red-runner.test.ts — path test

**Wired-into:** same as Task 6
**Dependencies:** 1

### Task 5: Normalize a stray nested marker up to root (RED)
**Story:** T-3 (happy: relocate nested marker; negative: nested-only never authoritative)
**Type:** negative-path
**Steps:**
1. Write failing test: given only `src/conductor/.pipeline/acceptance-specs-red.json`, the runner
   relocates it to the root path; given both, the root one wins and the nested is ignored.
2. Verify RED.
3. Implement normalization (move/copy nested → root before validation; root precedence).
4. Verify GREEN.
5. Commit: "feat(acceptance-red): normalize stray nested RED marker to root".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — normalization
- src/conductor/test/engine/acceptance-red-runner.test.ts — normalization tests

**Wired-into:** same as Task 6
**Dependencies:** 4

### Task 6: Runner executes contract + re-validates via existing validator (RED)
**Story:** T-1 (happy: run → marker → pass)
**Type:** happy-path
**Steps:**
1. Write failing test: `selfHealAcceptanceRed({worktree, specFiles, exec})` with an injected `exec`
   stub that writes a RED result runs the contract command from `cwd`, writes the root marker, and
   returns `{healed:true}` after `validateAcceptanceRedEvidence` passes.
2. Verify RED.
3. Implement `selfHealAcceptanceRed` orchestrating parse (T1) → guards (T2/T3) → exec → write (T4) →
   normalize (T5) → re-validate (reuse `validateAcceptanceRedEvidence` from artifacts.ts).
4. Verify GREEN.
5. Commit: "feat(acceptance-red): engine self-heal runner for the RED marker".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — selfHealAcceptanceRed
- src/conductor/src/engine/artifacts.ts — export validateAcceptanceRedEvidence if not already exported
- src/conductor/test/engine/acceptance-red-runner.test.ts — orchestration test

**Wired-into:** src/conductor/src/engine/conductor.ts#run (acceptance_specs step path — see Task 9)
**Dependencies:** 1, 2, 3, 4, 5

### Task 7: Negative — non-RED runs fail with real evidence (RED)
**Story:** T-4 (PASS / skipped / errors / executed==0)
**Type:** negative-path
**Steps:**
1. Write failing tests: injected exec producing (a) failed==0/passed>0, (b) skipped>0/executed==0,
   (c) errors>0, (d) executed==0 each yield `{healed:false, reason}` with a DISTINCT reason string,
   and NO fabricated passing marker.
2. Verify RED.
3. Implement: pass the runner's produced marker through `validateAcceptanceRedEvidence`; surface its
   reason verbatim; never coerce to done.
4. Verify GREEN.
5. Commit: "test(acceptance-red): non-RED runs fail with distinct real-evidence reasons".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — reason propagation
- src/conductor/test/engine/acceptance-red-runner.test.ts — four negative cases

**Wired-into:** same as Task 6
**Dependencies:** 6

### Task 8: Fallback — absent/malformed contract fails safe (RED)
**Story:** T-5 (contract missing / malformed / missing field)
**Type:** negative-path
**Steps:**
1. Write failing tests: no contract file → `{healed:false, reason:/run contract missing/}`; malformed
   JSON → `/invalid run contract JSON/`; missing `command` → field-level reason. Never `{healed:true}`.
2. Verify RED.
3. Implement the fallback branch in `selfHealAcceptanceRed` (decline, do not guess).
4. Verify GREEN.
5. Commit: "feat(acceptance-red): fail safe when the run contract is absent/malformed".

**Files likely touched:**
- src/conductor/src/engine/acceptance-red-runner.ts — fallback
- src/conductor/test/engine/acceptance-red-runner.test.ts — fallback tests

**Wired-into:** same as Task 6
**Dependencies:** 6

### Task 9: Wire self-heal into the acceptance_specs step path (RED)
**Story:** T-1 (integration), T-6 (end-to-end recovery)
**Type:** infrastructure
**Steps:**
1. Write failing engine test: in `Conductor.run`, an acceptance_specs completion miss naming the
   missing RED marker WITH spec files present invokes `selfHealAcceptanceRed` exactly once before the
   retry budget is decremented; a heal success advances the step with no `↻ retry` HALT.
2. Verify RED.
3. Implement the call site in the acceptance_specs step handling (alongside the existing
   deriveCompletion/self-heal seam), passing the real `execFile`-based exec.
4. Verify GREEN.
5. Commit: "feat(conductor): invoke acceptance-red self-heal on RED-marker miss".

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — self-heal call site in acceptance_specs step path
- src/conductor/test/engine/conductor.acceptance-red.test.ts — integration test

**Wired-into:** src/conductor/src/engine/conductor.ts#run
**Dependencies:** 6, 7, 8

### Task 10: Completion predicate stays a pure read (RED)
**Story:** T-1 ("no exec inside the predicate"), T-3 ("reads only root path")
**Type:** negative-path
**Steps:**
1. Write failing test: the `acceptance_specs` completion predicate in artifacts.ts performs NO
   subprocess exec (spy on exec) and reads only the worktree-root marker path.
2. Verify RED (if any drift) / assert current purity is pinned.
3. Implement: ensure predicate remains read-only; add the pinning test.
4. Verify GREEN.
5. Commit: "test(artifacts): pin acceptance_specs predicate as a pure root-only read".

**Files likely touched:**
- src/conductor/test/engine/artifacts.acceptance-specs.test.ts — purity test
- src/conductor/src/engine/artifacts.ts — (only if drift found)

**Wired-into:** none (no new production surface)
**Dependencies:** 9

### Task 11: Skill records the run contract at authoring time
**Story:** T-2 (skill writes acceptance-specs-run.json)
**Type:** infrastructure
**Steps:**
1. Add a §6 subsection to `skills/writing-system-tests/SKILL.md`: after authoring specs, write
   `.pipeline/acceptance-specs-run.json` = `{command, cwd, targetSpecs}` (documented shape + example),
   BEFORE reporting complete; note the engine consumes it as the deterministic RED backstop.
2. Update the SKILL.md checklist to include the run-contract write.
3. Commit: "docs(writing-system-tests): record the run contract before completion".

**Files likely touched:**
- skills/writing-system-tests/SKILL.md — run-contract subsection + checklist

**Wired-into:** none (skill instruction; the contract file is consumed by Task 6's runner)
**Dependencies:** none

### Task 12: End-to-end #733 regression (RED)
**Story:** T-6 (daemon self-recovers; self-heal never masks genuine non-RED)
**Type:** negative-path
**Steps:**
1. Write a failing acceptance/engine test reproducing #733: spec files committed, no RED marker, valid
   contract → the step passes deterministically with no HALT; AND a variant where specs genuinely
   don't go RED → the step still fails (self-heal fixes plumbing, not masking).
2. Verify RED.
3. Implement any glue needed so both variants pass/fail as specified.
4. Verify GREEN.
5. Commit: "test(acceptance-red): #733 regression — self-recover, never mask non-RED".

**Files likely touched:**
- src/conductor/test/engine/conductor.acceptance-red.test.ts — regression cases

**Wired-into:** none (no new production surface)
**Dependencies:** 9

### Task 13: Docs + CHANGELOG
**Story:** all (documentation upkeep)
**Type:** infrastructure
**Steps:**
1. Update `README.md` and `src/conductor/README.md` to describe engine-owned RED self-heal + the run
   contract; add a CHANGELOG `[Unreleased]` entry under Fixed/Changed referencing #741 and the #297
   supersession.
2. Commit: "docs(changelog): acceptance-red self-heal + run contract (#741)".

**Files likely touched:**
- README.md, src/conductor/README.md, CHANGELOG.md

**Wired-into:** none (no new production surface)
**Dependencies:** 11, 12

## Task Dependency Graph
```
1 ──┬─▶ 2 ─┐
    ├─▶ 3 ─┤
    └─▶ 4 ─┴─▶ 5 ─▶ 6 ─┬─▶ 7 ─┐
                        └─▶ 8 ─┴─▶ 9 ─┬─▶ 10
                                      ├─▶ 12 ─▶ 13
11 (independent) ───────────────────────────▶ 13
```

## Integration Points
- After Task 6: the runner is unit-complete and can self-heal in isolation (injected exec).
- After Task 9: end-to-end — a daemon build with a missing marker + valid contract recovers without HALT.
- After Task 11: the skill emits the contract the runner consumes (full loop closed).

## Verification
- [ ] All happy path criteria covered (T-1→T6/T9, T-2→T1/T11, T-3→T4/T5, T-6→T12)
- [ ] All negative path criteria covered (T-4→T7, T-5→T8, cwd/targetSpecs→T2/T3, purity→T10, mask→T12)
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic (see graph)
- [ ] Every new-surface task carries a Wired-into line
