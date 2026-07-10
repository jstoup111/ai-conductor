# Architecture Review: Deterministic Build Evidence Attribution (#433)
**Date:** 2026-07-09
**Mode:** lightweight (tier M) — feasibility + alignment; pre-stories full pass
**Input reviewed:** explore decision (approach B, operator-confirmed), approved diagrams
(`.docs/architecture/deterministic-evidence-attribution.md`), issue #433
**Verdict:** APPROVED

## Feasibility

| Check | Finding |
|---|---|
| Stack compatibility | Pure bash + git ≥2.20 (`--worktree` config) + node stdlib (JSON parse). All present wherever the daemon runs; git 2.34.1 verified locally. No new packages. |
| Prerequisites | `task-status.json` seeding (#302, shipped) provides the valid id set; `prepareWorktree` (worktree-prepare.ts) is the existing provisioning seam. |
| Integration surface | Four coordinated surfaces (engine CLI, hook assets + publish, prepareWorktree wiring, pipeline SKILL step 0) — within tier M; evidence gate deliberately untouched. |
| Data implications | None (no schema; `.pipeline/` sidecar files only, gitignored). |
| Performance | Hooks are O(1) file reads per commit; negligible. |
| Worktree isolation | `extensions.worktreeConfig` + `--worktree core.hooksPath` verified worktree-scoped (primary checkout config unset). Hook copies + `.pipeline/` state are per-worktree; no cross-worktree resource. |

Empirical verification (scratch repo, 2026-07-09): hooksPath isolation; auto-stamp via
`interpret-trailers`; bare-trailer empty-commit rejection; `Evidence: satisfied-by` acceptance;
unknown-id rejection with instructive message. All passed.

## Alignment

- **Deterministic-first (CLAUDE.md design principle):** exactly the prescribed shape — stamps and
  validates at the moment of the mistake; LLM discipline is reduced (hand-edited JSON → one CLI
  call), not added. Approach C was rejected for adding a new prompt-discipline write.
- **#302 precedent:** extends engine-owned task status to the `in_progress` transition; the gate
  (`deriveCompletion`) remains the sole completion authority — no second gate introduced.
- **#418 grammar lockstep:** hooks validate against the engine-seeded id set in
  `task-status.json` rather than re-implementing `TASK_ID_PATTERN` parsing of the plan — single
  source of truth, no grammar fork.
- **#403 staleness class:** hooks call no engine dist; copies are frozen at provisioning; the
  `conduct-ts task` CLI runs from the global install (simple, stable surface).
- **Consumer repos:** hooks are copied from the installed engine package (consumer trees carry no
  harness files); chaining to `$GIT_COMMON_DIR/hooks/<name>` preserves consumer hooks (husky etc.).
- **Fail-open:** unsupported git / copy failure logs and skips wiring — provisioning never blocks;
  behavior degrades to today's.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Agent commits with `--no-verify` | Technical | Low | Medium | Gate unchanged as backstop; SKILLs forbid; hook adoption removes the *incentive* (stamping is automatic) |
| Wrong stamp during rebase/amend | Data | Low | Medium | Hook abstains on `$2 = commit` and when `rebase-merge` dir exists (verified pattern; uses `test -d`, honoring the rev-parse trap) |
| Hooks silently absent (fail-open path) | Technical | Low | Medium | prepareWorktree logs the skip; daemon log line makes it auditable |
| Stale `current-task` after crashed dispatch | Data | Low | Low | `task start` overwrites; engine clears at build entry; commit-msg validation unconditional |
| Release-gate `hook wiring` surface flag | Process | Medium | Low | PR carries a migration block or internal-only waiver per adr-2026-07-06-migration-gate-waiver |

No High-impact risks registered.

## ADRs Created

- `adr-2026-07-09-deterministic-evidence-attribution-enforcement.md` — APPROVED by the operator
  in this session (2026-07-09).

## Conditions

None. (Verdict is APPROVED; the ADR approval is a lifecycle gate, not a condition on the design.)
