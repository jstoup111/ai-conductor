# Conflict Check: Multi-branch restack for stacked child plans (#2943)

**Date:** 2026-10-10
**New stories:** `.docs/stories/a-change-to-one-stacked-child-cannot-be-carried-in.md` (15 stories)

**ADR corpus:** `repo_wide` (`conflict_check.adr_corpus`).
- 342 ADRs were loaded.
- 8 fully superseded ADRs were excluded.
- 3 partially superseded ADRs were retained.
- 68 were examined: the 15 already amended by this change set, the new ADR, and 52 unamended ADRs
  on halt classes, caps, commits, pushes, worktrees, rebase, evidence and events.
- About 266 were narrowed out by subject: memory and intake, providers and cost, build_review
  rubric, DECIDE tooling, daemon process, release, and step mechanics.

**Story corpus:** 575 files, narrowed by subject to roughly 60 (stacked chain, rebase, push and lease,
refunds and kickback budget, halt classes and re-kick, evidence translation, commits and hooks).
Every pair sharing a behaviour was checked in both directions.

**Result:** PASSED.
- No blocking conflicts remain.
- No oscillating conflicts were found.
- Two degrading conflicts were accepted by the operator.

## Resolved conflicts

### Blocking

| Conflict | Type | Parties | Resolution |
|---|---|---|---|
| Re-kick skips the rebase at a non-leaf child | contradiction | `build-loop-cannot-complete-a-feature-child-by-chil.md` S14 vs new S10 | Old S14 rewritten: a whole-stack `base-refresh` restack at any active child |
| A commit on a closed child halts "restack required" | contradiction | `build-loop-cannot-complete-a-feature-child-by-chil.md` S1 vs new S9 | Old S1 rewritten: appended commits repair automatically; rewritten or reset children halt `closed-child-rewritten` |
| Halt-record push argv and the stale-lease outcome | contradiction | `halt-records-never-reach-origin-after-daemon-auto-.md` vs new S14 | The old story uses the explicit-SHA lease; a refusal emits `push_lease_refused` plus `halt_record_push_failed` and stays best-effort |
| A pre-region halt record is rewritten in child 1 while the unentered leaf keeps the old commit, so the leaf move is refused | state conflict | `build-loop-cannot-complete-a-feature-child-by-chil.md` S2 vs new S10 and ADR decision 2 | Operator decision: such a leaf moves to the commit's rewrite in the same transaction (ADR decision 2; per-child decision 3 amended) |
| New halt class `restack-cascade-cap` | contradiction | `adr-2026-07-28-total-halt-classification-legacy-boundary` D1, `adr-2026-08-29-kickback-budget-recovery-uses-needs-human-halt-class` vs new S13 | Operator decision: class `needs-human` with typed evidence (allowance `restacks`); no new class |
| The unentered-leaf move would write `leaf-moved` (found on re-check) | contradiction | ADR decisions 2 and 8, new S1 and S11 | `leaf-moved` is written only when the leaf is the active child |

### Degrading, resolved

| Conflict | Resolution |
|---|---|
| The rewind refusal names #2943 (`build-loop…` S12, `adr-2026-08-19-operator-step-rewind-through-the-mutation-port`) | Story and ADR now name #2944 |
| Who moves the leaf (`build-loop…` S3) | The guarded leaf move or a restack move transaction; per-child decision 3 amended |
| The leaf's parent tip is translated through the rewrite map (`build-loop…` S9) | It is read from the restacked closure ref |
| Every rebase refunds review laps (`one-build-review-pass…` S2, `repeated-build-review…` S2) | Refunds are scoped to rebases and `base-refresh` restacks |
| A single force-push site (`make-daemon-build-push-pr…`, `adr-2026-07-29-ship-start-draft-pr` D3) | Every force push uses an explicit-SHA lease; ship-start D3 is scoped by an amendment note |
| Bare-lease argv fixtures (`ref-moving-destructive-git…` S5, `auto-resolve-open-pr-conflicts.md`) | Explicit-SHA form, with refusal "by the engine or git" |
| The N=1 rebase argv test vs pinned config (`automatic-rebase…` S1) | Config is pinned through `GIT_CONFIG_*` environment variables, so argv is unchanged |
| The `flatten_refused` recipe and a paused-rebase conflict (`automatic-rebase…` S4, `2026-07-05-rekick-gated-rebase-resolution.md`) | Scoped to features without children; stacked features leave every ref unmoved |
| `--child` validated against the child directory (`engine-cannot-represent…` S9) | `--gate restack` validates against the `cascades` ref |
| The cap evidence allowance enum (`offer-ship-or-continue…`) | Adds `restacks` |
| The setup-triage commit vs the guarded commit's pathspec | The pathspec is the captured repair's paths (new S8) |
| Restacks not writing the base-advance record (`adr-2026-08-13-durable-base-advance-attribution`) | A `base-refresh` restack persists `rebase_changed` (new S10) |
| Halt-record push failure: step failure or best-effort (`adr-2026-08-23-committed-halt-record` D5/D6) | Each push site keeps its existing failure handling (new S14) |
| Refs surviving reclaim outside the mergeable sweep (`adr-2026-07-29-defer-feature-worktree-reap-to-shipped-record-on-main` D8) | The reclaim helper also deletes them, by explicit name |
| Autoresolve on a stacked leaf PR (`auto-resolve-open-pr-conflicts.md`, `mergeable-autoresolve-tier-2…`) | Operator decision: escalate with `published-stack`, no replay; the older stories are scoped to features without children |
| Assumptions folded in | Preflight runs after park checks; an unreadable `cascades` blob counts as exhausted; reuse of the shared co-author helper; no glob ref deletes |

## Accepted degrading conflicts (operator, 2026-10-10)

1. **No push during a rebase-conflict halt vs halt-record publication.**
   `adr-2026-07-03-post-rebase-force-with-lease` item 3 bars any push during a rebase-conflict
   halt, but halt-record publication (`adr-2026-08-23-committed-halt-record` D5, new S14) pushes
   during halts. This tension already exists between those two ADRs, and #2943 does not widen it.
2. **Seal rotation on a `feature-repair`.** An operator commit on a closed child that edits a
   protected artifact may make the seal's authorship check (`adr-2026-08-09` seal rotation) refuse
   rotation. The run then halts; it never passes silently. Low likelihood.

## Plan obligations carried forward

- The resolver's temporary-worktree removal must be classified in the worktree-removal coverage
  guard's structural test (`adr-2026-08-07`).
- The autoresolve escalation for `published-stack` must state whether it uses up the
  rebase-resolution attempt cap.
