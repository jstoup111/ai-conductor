# Implementation Plan: judged-attribution-verdict-persistence

**Source:** jstoup111/ai-conductor#581 · **Track:** technical · **Tier:** M
**Stories:** `.docs/stories/judged-attribution-verdict-persistence.md`
**ADR:** `.docs/decisions/adr-2026-07-12-judged-attribution-verdict-persistence.md`

## Goal

When the attribution judge lane stamps satisfied residue tasks, the **current** build
attempt's completion gate must re-read those stamps and advance a fully-covered build —
with no whitewash of uncovered/abstained work. All work is TDD (RED before GREEN).

## Anchors (verified in worktree)

- Gate decision site: `src/conductor/src/engine/conductor.ts:2012` (`if (!completion.done)`),
  inside the build gate-miss branch `1863-2010`; lane call at `1953`, returns
  `AttributionLaneResult.stampedTaskIds`.
- Lane: `src/conductor/src/engine/attribution-lane.ts:354` (`runAttributionLane`).
- Judged-stamp writer + reconcile: `src/conductor/src/engine/task-evidence.ts:181`
  (`writeJudgedStamps` → `reconcileStatusFromStamps`).
- Completion derivation + precedence branch: `src/conductor/src/engine/autoheal.ts:573`
  (`deriveCompletionInternal`), path-corroboration miss at `709`, sidecar-stamp honor at
  `668`; `reconcileStatusFromStamps` at `1278`.
- Cutover guard: `src/conductor/src/engine/config.ts:721`
  (`isAttributionJudgeCutoverActive`).
- Build completion predicate + `checkStepCompletion`: `src/conductor/src/engine/artifacts.ts:1853`.

Test homes: `test/engine/attribution-conductor-wiring.test.ts` (conductor↔lane wiring),
`test/engine/autoheal.test.ts` (derivation precedence), `test/engine/attribution-lane.test.ts`,
`test/engine/task-evidence.test.ts`.

Run tests from `src/conductor` with `rtk proxy npx vitest run <file>` (per repo memory:
vitest must run with cwd `src/conductor`).

---

## Task Dependency Graph

```
T1(RED wiring) ─┐
                ├─▶ T2(GREEN in-cycle re-check) ─▶ T4(RED+GREEN guard) ─┐
T3(RED no-whitewash) ─────────────────────────────────────────────────┤
T5(RED precedence) ─▶ T6(GREEN precedence) ────────────────────────────┤
T7(RED stale-anchor assert) ───────────────────────────────────────────┤
                                                                        ├─▶ T8(docs) ─▶ T9(full suite + integrity)
```

---

### Task 1 — RED: in-cycle rescue wiring test (Story 1)
**Dependencies:** none
**Files:** `test/engine/attribution-conductor-wiring.test.ts`
Add a failing test: arm `attribution_judge_cutover`, drive a build-gate miss with residue,
inject a verifier verdict where all residue tasks are `satisfied` with valid citations +
passing test evidence (stub `dispatchVerifier` to write a satisfied `attribution-verdict.json`).
Assert the gate resolves `done` on the **same attempt** (no HALT, no reliance on a second
loop iteration). Expect RED (today the decision reads the pre-lane snapshot).

### Task 2 — GREEN: re-check completion after the lane stamps (Story 1)
**Dependencies:** T1
**Files:** `src/conductor/src/engine/conductor.ts` (build gate-miss branch, after lane call ~2008, before 2012)
After `runAttributionLane` returns, when `laneResult.stampedTaskIds.length > 0`, re-run
`checkStepCompletion(this.projectRoot, step.name, await this.completionCtx(state))` and
assign the result to `completion` before the `if (!completion.done)` decision. Emit an
`auto_heal`-style event (or reuse existing event) noting the judged re-check. Make T1 GREEN.
Keep the edit confined to the `step.name === 'build'` branch.

### Task 3 — RED: no-whitewash paths (Story 2)
**Dependencies:** none
**Files:** `test/engine/attribution-conductor-wiring.test.ts`
Failing tests for: (a) `no-verdict` residue task → no stamp → gate stays not-done → refuse;
(b) `satisfied` verdict whose citations fail `validateCitations` → refused → no advance;
(c) mixed satisfied+unsatisfied → gate not-done. These must pass *after* T2 without further
product code (they assert T2 did not over-advance). Initially RED against a naive T2 that
re-checks unconditionally.

### Task 4 — RED+GREEN: guard the re-check on real stamps (Story 4)
**Dependencies:** T2, T3
**Files:** `test/engine/attribution-conductor-wiring.test.ts`, `src/conductor/src/engine/conductor.ts`
Test: lane runs but `stampedTaskIds` empty → NO extra `checkStepCompletion` call and gate
decision uses prior `completion` (spy on completion-check invocation count). Test: cutover
absent → lane skipped, no re-check, byte-identical flow. Tighten the T2 condition to
`stampedTaskIds.length > 0` so both pass.

### Task 5 — RED: semantic-verified precedence over failed trailer (Story 3)
**Dependencies:** none
**Files:** `test/engine/autoheal.test.ts`
Failing test: sidecar has a `form:'semantic-verified'` stamp for task N AND git has a
`Task: N` commit whose files do NOT overlap N's declared paths. Assert `deriveCompletion`
returns `N.completed === true` (stamp wins). Second case: no stamp + failing trailer →
`N.completed === false` (no invented coverage). Expect RED (today line 709 path-mismatch
ignores the stamp because `matchingCommit` is truthy so line 668 is skipped).

### Task 6 — GREEN: honor semantic-verified stamp in derivation (Story 3)
**Dependencies:** T5
**Files:** `src/conductor/src/engine/autoheal.ts` (`deriveCompletionInternal`, path-mismatch branch ~709)
When a matching trailer commit fails path corroboration, before leaving the task
incomplete, check `evidence.evidenceStamps.get(taskId)?.form === 'semantic-verified'`; if
present, mark completed/evidencedBy from the stamp (do not overwrite the stamp). Leave all
other branches unchanged. Make T5 GREEN. Verify no existing `autoheal.test.ts` case
regresses (a failing trailer with no stamp must still be incomplete).

### Task 7 — RED→GREEN: stale-anchor stays fail-closed (Story 5)
**Dependencies:** none
**Files:** `test/engine/attribution-lane.test.ts`
Assert (or add) a test: verdict `anchor.head` != current HEAD → all verdicts coerce to
`no-verdict`, `writeJudgedStamps` receives empty `validated`, gate does not advance. If
already covered by existing lane tests, add the explicit in-cycle assertion and mark
covered; no product change expected (guard already exists at attribution-lane.ts:419-429).

### Task 8 — Docs (ADR consequence)
**Dependencies:** T2, T4, T6
**Files:** `src/conductor/README.md`, `CHANGELOG.md`
README attribution/evidence section: state that a satisfied judged verdict advances the
current build's gate in-cycle (not "next cycle"). Add `CHANGELOG.md` `[Unreleased]` →
**Fixed** entry referencing #581. No `settings.json`/hook/CLI/skill-symlink change →
no migration block required (internal engine fix).

### Task 9 — Full suite + harness integrity
**Dependencies:** T8
**Files:** — (verification only)
From `src/conductor`: `rtk proxy npx vitest run` (full engine suite) green. From repo root:
`test/test_harness_integrity.sh` passes. Confirm no leaked processes and default
(cutover-absent) behavior unchanged.

---

## Out of scope

- Arming `attribution_judge_cutover` (separate operator rollout decision).
- Changing the advisory post-green spot-audit (`runSpotAudit`) — it stays observational.
- Fixing wrong-`Task:`-trailer emission (#576) — this spec only makes the judge's
  validated verdict win despite bad trailers.

## Risk / no-whitewash checklist

- [ ] Re-check fires only when `stampedTaskIds.length > 0` (T4).
- [ ] Only `satisfied` + validated-citation + passing-test verdicts stamp (unchanged lane).
- [ ] `no-verdict`/`unsatisfied`/refused never advance the gate (T3).
- [ ] Precedence rule elevates only a real `semantic-verified` stamp (T5/T6).
- [ ] Stale-anchor coercion preserved (T7).
- [ ] Cutover-absent flow byte-identical (T4).
