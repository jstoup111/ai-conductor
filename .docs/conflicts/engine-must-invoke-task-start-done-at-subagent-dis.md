# Conflict Report: Engine-Invoked Task Start/Done at Subagent Dispatch (#477)

**Date:** 2026-07-10
**Stories checked:** `.docs/stories/engine-must-invoke-task-start-done-at-subagent-dis.md` (8
stories) against the full `.docs/stories/` corpus (100 files incl. `epics/`, `features/`) and
`.docs/decisions/`.
**Result:** PASSED after resolutions — zero blocking conflicts remain.

## Conflicts found and resolved

### 1. Marker-grammar collision with the #417/#302 dispatch-prompt contract
**Stories involved:** new Story 3/4 vs `2026-07-07-evidence-gate-task-id-grammar.md` Story 3 +
`adr-2026-07-05-engine-owned-task-status.md` H2
**Type:** behavioral overlap → would have been blocking at runtime
**Description:** dispatch prompts already carry `Task:` tokens in their body (the injected
commit-trailer instruction, e.g. "include trailer `Task: 7`"). The original Story 4 treated two
`Task:` tokens as an exit-2 ambiguity — which would have blocked every implementation dispatch.
**Resolution (applied):** marker grammar tightened to **line 1 of the dispatch prompt only**;
the hook never scans the body. ADR §Decision-2 amended; Stories 3/4 updated with explicit
body-token scenarios. The existing trailer-instruction contract is untouched.

### 2. Deliberate supersession of the orchestrator-runs-the-CLI contract
**Stories involved:** new Story 7 vs `deterministic-evidence-attribution.md` Story 7,
`adr-2026-07-09-deterministic-evidence-attribution-enforcement.md` item 1, and
`features/pipeline/ST-020-factory-orchestration.md` (2026-07-09 amendment)
**Type:** contradiction (intended supersession) — degrading until documented
**Resolution (applied):** superseded-by notes added to all three artifacts pointing at
`adr-2026-07-10-session-hook-task-stamping`; the new ADR gained a §Supersession section. The
task CLI itself is retained (operator/recovery use); #433's other decisions stay authoritative.

### 3. Worktree-global hook scope vs unmarked dispatch templates
**Stories involved:** new Story 7 vs `/pipeline`'s non-implementation dispatch sites
(evaluator, `/simplify`, micro-retro, memory-checkpoint)
**Type:** behavioral overlap — degrading (fail-closed self-corrects at one retry per site)
**Resolution (applied):** Story 7 now enumerates ALL in-session dispatch templates; every one
carries a line-1 marker (`Task: none` for non-implementation).

### 4. Advisory in_progress re-seed race
**Stories involved:** new Story 3 vs `adr-2026-07-05-engine-owned-task-status.md` H7 (per-gate
re-seed, merge-never-overwrite)
**Type:** state race — none-after-analysis
**Description:** a re-seed racing the hook's `in_progress` flip could drop the flip; benign
because `in_progress` is advisory (completion is evidence-derived, H6) and both writers use
atomic temp+rename (no torn file). Noted; no change required.

## Cross-reference (not a conflict): issue #485
Body-embedded `Task:` lines in **commit messages** (blank-line-split from the trailer block) are
a different surface — the git commit-msg hook — and stay a separate spec. #477 closes the
no-stamp case (and would have prevented #485's observed incident); #485 remains the net for the
stamp-absent windows this spec deliberately keeps (amend paths, overlap-guard abstention).
Story 5 carries the pairing note so the daemon/planner never dedups the two as redundant.

## Pairs examined and judged CLEAN (verified, not assumed)
#452 git hooks + abstain chaining (overlap by design, Story 5 tests it) · task CLI verbs
retained · completion authority #302/H4/H6 + #456 evidence unification (hook never writes
`completed`) · `worktree-prepare.ts` co-edit with #433 (additive: hooksPath vs
settings.local.json) · #380 write-fence (different file, different matcher) · self-host sandbox
`CLAUDE_CONFIG_DIR` (project settings independent; test assertion added to Story 2) ·
build_review grader + scoped VERIFY (Bash, not Agent dispatches — no marker needed) ·
fresh-session-per-step (file-based hooks survive session resets) · decide-pipeline-restructure ·
engineer-worktree-isolation (hooks install on the daemon build path only) · intra-step progress
poller (tolerates both schemas) · post-rebase invalidation · migration-block enforcement
(Story 8 supplies the required block, no waiver).
