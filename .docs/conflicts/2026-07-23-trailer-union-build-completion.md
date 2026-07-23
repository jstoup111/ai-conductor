# Conflict Check: Trailer-union build completion (#859)

**Date:** 2026-07-23
**New stories:** `.docs/stories/trailer-union-build-completion.md` (5 stories, Accepted)
**Scope:** all `.docs/stories/*.md` scanned by seam (`no_task_progress`, `countResolvedTasks`,
task-status.json completion semantics, build predicate, build_review authority, pipeline skill
contract); highest-risk pairs read in full and reasoned through individually.
**Result:** CLEAN — zero blocking, zero degrading conflicts.

## Pairs examined (verified, not assumed)

1. **vs #773 `demote-task-stamping-to-telemetry.md`** — ALIGNED (confidence ~95%). The new
   stories keep rows dead, add no stamping, and keep `build_review`'s completeness rubric as
   sole authority; the new ADR explicitly *extends* the #773 ADR pair and completes the demote
   ADR's own follow-up (trailer-sourced resolved-count applied to the exit gate the follow-up
   missed). No contradictory Given/When/Then found.

2. **vs #280 `daemon-halts-a-build-that-is-making-forward-progre.md` (build_progress_halt)** —
   COMPATIBLE (confidence ~90%). Its S1 contract — progress attempts bypass `max_retries` and
   the loop "eventually succeeds when all tasks are resolved" — is *made reachable* by the new
   predicate (previously "succeeds when all resolved" was unsatisfiable via rows alone). Story 4
   pins the bypass/ceiling behavior unchanged; the stall predicate itself is untouched.

3. **vs #569 `build-stall-remediation-skips-no-task-progress.md`** — COMPATIBLE (confidence
   ~90%). #569 routes *genuine* `no_task_progress` stalls through `/remediate` before terminal
   HALT. Genuine stalls (unresolved tasks, pinned count) still classify identically (Story 4).
   The at-ceiling false stall no longer *occurs* — nothing for remediation to lose; a
   fully-evidenced build exits before the stall classification is reached.

4. **vs #526 `evidence-stamps-sync-to-task-status-rows-so-progre.md`** — SUPERSEDED HISTORY,
   not a live conflict (confidence ~95%). Its mechanism (`evidenceStamps` authoritative,
   `applyDerivedCompletion` row-sync) was deleted wholesale by #773; the story file predates
   that and was superseded by the #773 ADR pair, not by this feature. Pre-existing doc drift
   (file still reads `Status: Accepted` with no supersession note) — noted for hygiene, NOT
   caused or worsened by this feature, and this feature's "rows stay dead" matches the
   post-#773 reality.

5. **vs `engine-must-invoke-task-start-done-at-subagent-dis.md` +
   adr-2026-07-05-engine-owned-task-status** — NO RESOURCE CONTENTION (confidence ~90%).
   task-status.json stays engine-owned; this feature adds zero writers (readers only widen
   with trailer union). `in_progress` flipping at dispatch is untouched.

6. **vs `prd-audit-kickback-preserves-task-status.md` / `post-rebase-build-invalidation…`** —
   COMPATIBLE (confidence ~85%). Kickback preserves rows (union only widens resolution, never
   narrows); post-rebase, trailers travel with rewritten commits and
   `listCommitsWithTrailers`' merge-base-relative range still sees them (fail-soft on any git
   error, degrading to rows-only — never a false `done`).

7. **vs `add-a-judgement-gate-at-the-build-manual-test-seam.md` (#324 build_review)** —
   ALIGNED. Routing-to-the-gate changes; the gate itself (verdict artifact, fail-closed
   predicate, kickback) is untouched by every new story.

## Conflict-type sweep

- **Contradiction:** none found.
- **Behavioral overlap:** stall-breaker surface shared with #280/#569 stories — pinned
  unchanged by Story 4 (see pairs 2–3).
- **State conflict:** none — no new states; resolution set is derived, not stored.
- **Resource contention:** none — no new task-status writers (pair 5).
- **Sequencing:** none — no ordering assumptions beyond the existing build → build_review seam.

## Notes (non-blocking)

- Hygiene follow-up (out of scope): mark `.docs/stories/evidence-stamps-sync-to-task-status-rows-so-progre.md`
  as superseded by the #773 ADR pair to stop future conflict-check noise.

**GATE: PASSED — proceed to /plan.**
