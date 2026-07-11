# Conflict Check: Attribution Abstain-or-Loud Hardening (#519)

**Date:** 2026-07-11
**New stories:** `.docs/stories/engine-invoked-task-attribution-494-freezes-curren.md`
**Result:** PASSED after 1 blocking conflict resolved (story supersession applied)

## Conflict 1 (RESOLVED): #452 stories mandate the fallback the new stories delete

**Stories involved:** #452 "prepare-commit-msg auto-stamps the Task: trailer" (Story 4, happy
path + Done When) vs new Story 3 "stamps from the stamp file or abstains — never guesses"
**Files:** `.docs/stories/deterministic-evidence-attribution.md` vs
`.docs/stories/engine-invoked-task-attribution-494-freezes-curren.md`
**Type:** contradiction
**Severity:** blocking (confidence 95% — the two Given/When/Then assert opposite outcomes for
the identical precondition "stamp absent + exactly one in_progress row": stamped vs abstain)

**Root cause routing:** the contradiction is rooted in the DESIGN change already resolved at
architecture level — `adr-2026-07-11-attribution-abstain-or-loud` (APPROVED) explicitly amends
`adr-2026-07-09`'s fallback clause. No kickback needed; the stories fix is mechanical.

**Resolution applied (option 1, least disruptive):** superseded the two fallback assertions
in place in `deterministic-evidence-attribution.md` (strikethrough + dated supersession note
citing the ADR and the new Story 3), following that file's existing scope-note precedent
(2026-07-10, #505). History preserved; behavioral contract now consistent corpus-wide.

## Pairs examined and CLEAN (reasoned, not assumed)

1. **In-flight #522 build** (`evidence-gate-validates-provenance-proxies-not-whe`): branch
   diff `origin/main...HEAD` contains NO changes to `session-hook-assets.ts` or
   `git-hook-assets.ts` (verified 2026-07-11 ~13:00Z; its ADR marks the commit-msg alias
   grammar a documented non-goal). Residual risk: the build is still running and its diff can
   grow — noted for the pre-build spec-branch refresh to re-verify at build time.
2. **#505 story "unattributed content commit rejected"**
   (`inline-build-work-commits-unattributed-session-hoo.md:93-98`): its precondition ("stamp
   absent AND no unique in_progress row") remains TRUE and its outcome (reject) unchanged.
   Post-#519 the rejection ALSO fires when a unique in_progress row exists — a strict widening
   the old story never contradicts (it asserts no complement behavior). Clean.
3. **#494 stories** (`engine-must-invoke-task-start-done-at-subagent-dis.md`): overlap-guard
   scenario (stamp removed on task switch, exit 0) and multi-in_progress abstention are
   asserted identically by new Story 1. The "chained #452 hook abstains" phrasing at line 189
   describes abstention, which survives. Clean.
4. **#452 corrupt-JSON scenario** (line ~126): asserts abstain-on-corrupt — post-change the
   hook abstains without consulting any fallback; outcome identical, mechanism wording
   ("fallback path is consulted") covered by the supersession note. Clean.
5. **Spec PR #500 (parallel-validation, HOLD):** spec-only artifacts, validation-phase
   concurrency; no story touches commit attribution or these hook files. Clean.
6. **State conflicts:** new Story 1 invariant ("stamp present ⇒ written by most recent
   successful bookkeeping") is compatible with #494's overlap guard (removal is a successful
   bookkeeping outcome) and #505's build-step-active semantics. No impossible states found.
7. **Resource contention:** all writers of `.pipeline/current-task` remain the same two hooks
   (pre-dispatch, post-dispatch); this feature adds no writer. Clean.
8. **Sequencing:** no story assumes ordering against #522's lane (different files) or #500.
   Clean.

## Deliberately untouched historical artifacts

- `.docs/architecture/engine-must-invoke-task-start-done-at-subagent-dis.md` legend mentions
  the fallback as the overlap guard's degradation path — dated snapshot of #494's design; the
  new architecture doc + ADR are the current authority. Stories (behavioral contracts) were
  corrected; dated architecture snapshots are append-only history.

## Accepted degrading conflicts

None.
