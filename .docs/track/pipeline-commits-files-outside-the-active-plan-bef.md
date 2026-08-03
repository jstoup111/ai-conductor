# Track: Pipeline commits files outside the active plan before scope review

**Date:** 2026-08-02
**Source:** `jstoup111/ai-conductor#1227`

Track: technical

## Why technical

This is harness-internal enforcement machinery. There is no end-user-facing product
surface, no new user workflow, and no product requirements to enumerate. The observable
contract is entirely between the engine, the plan artifact, and the git commit boundary.
Acceptance criteria live in the stories; no PRD is authored.

## Problem statement

A BUILD task's commit can change files that no task in the approved plan declares, and
nothing rejects it at the moment it happens. The out-of-scope work survives until the much
later semantic `build_review` Scope rubric, which is an LLM judgement running after the
whole build.

Verified evidence (re-confirmed directly against this repository's history, not taken on
the filer's word):

- `8b9f753e5 fix(finish): ignore inherited changelog PR tokens` — exists on the branch for
  PR #1074, whose approved plan scoped Tasks 1–8 to `src/conductor/src/engine/config.ts`
  plus config/resolver tests, and Task 9 to configuration docs + `CHANGELOG.md`.
- `0bf9d809b fix(build): remove out-of-scope finish changes` — the later repair,
  `6 files changed, 28 insertions(+), 249 deletions(-)`.

So roughly 250 lines of unrelated finish/finalizer behavior were authored, committed,
carried through the build, and only removed by a downstream reviewer.

## Desired outcomes

1. A BUILD commit whose changed files fall outside every declared plan-task path set is
   rejected at the commit boundary, naming the task id and the offending paths.
2. Rejection happens before subsequent tasks or SHIP run — not after the build.
3. Legitimate collateral edits proceed when the plan already declares them, or when an
   explicit, reviewable scope disposition records the widening.
4. A regression test reproduces the #1074 shape (config-only plan, then finish/finalizer
   edits) and observes deterministic rejection.

## Discovery findings

### The enforcement point already exists and is inert

`src/conductor/src/engine/git-hook-assets.ts` embeds `COMMIT_MSG_HOOK`, which already runs
a staged-diff-vs-task-files comparison (`git-hook-assets.ts:180-222`). It is non-functional
for two independent reasons:

- **Wrong data source, never populated.** It builds `tasksByFile` from
  `task-status.json`'s `t.files` array. No engine writer emits a `files` field on a task
  row, and `NormalizedTask` (`src/conductor/src/engine/task-progress.ts:125-129`) declares
  only `id`, `title`, and `status`. `tasksByFile` is therefore always empty.
- **Wrong question, and only a warning.** It fires only when the staged diff spans *more
  than one* plan task (`mappedTasks.size > 1`), and then merely prints
  `commit-msg: WARNING — staged diff spans files of multiple plan tasks`. Files belonging
  to *no* task — exactly the #1074 case — map to nothing, so `mappedTasks.size` is 0 and
  the check is silent. It never blocks under any input.

### The primitives for a real check are already built and in production use

- `parsePlanTaskPaths(text): Map<taskId, Set<path>>` —
  `src/conductor/src/engine/plan-task-parse.ts:70`, parsing the per-task `**Files:**` block.
  Already consumed by `wiring-probe.ts:1295`, `autoheal.ts:541`,
  `per-task-commit-floor.ts:35`, and `artifacts.ts:1858`.
- `fileMatchesPlanPath(file, planDeclaredPath): boolean` — `autoheal.ts:41`. Segment-anchored
  suffix matching, deliberately evidence-grade: plans write basenames or partial paths while
  git reports repo-relative paths, and `trail.ts` must never match `audit-trail.ts`.

Plans do reliably carry the metadata. A current example
(`.docs/plans/changelog-unreleased-is-a-shared-write-target-conf.md`) gives every task an
explicit `**Files:**` block with repo-relative paths.

### The existing floor checks the opposite direction

`runPerTaskCommitFloor` (`per-task-commit-floor.ts:28`) asks *"does every plan task have a
commit?"* — coverage. Invoked from `step-runners.ts:1697`. Nothing asks the converse,
*"does every commit stay inside some task's declared paths?"* — containment. That converse
is the entire gap.

### The semantic reviewer stays

`build-review-prompt.ts:33` carries rubric item 2: "Scope: diff scoped to the plan, no
unrelated files." This is what actually caught #1074. It is behavior-level judgement a path
comparison cannot replace, and it must remain as defense in depth.

`runPerTaskCommitFloor` is invoked at `step-runners.ts:1682-1717` and is explicitly
**advisory only** — it writes `.pipeline/per-task-floor.json`, never feeds the grader
prompt, never changes `success`, and never triggers a kickback.

### The repair the filer cites as the remedy is recorded in-engine as a harm

This is the most consequential discovery and it reshapes the design. The intake issue
presents `0bf9d809b` ("remove out-of-scope finish changes", −249 lines) as the correcting
action. The engine's own routing rationale
(`src/conductor/src/engine/build-review-disposition.ts:255-274`, from #989) names that exact
commit as an incident of *damage*:

> A **scope** failure is the mirror image: the diff contains work the plan does not
> describe. That is equally plan-implicating — either the plan should be amended to cover
> the work, or the work does not belong — and it is NOT a judgement to hand an unsupervised
> builder, whose only lever is to delete whatever was flagged. That is exactly what happened
> on `build-review-ci-watch-partial-block-1002` (commit `0bf9d809b`, −249 lines, removing an
> engine repair the branch legitimately needed).

Consequently `buildReviewFailRoute` (`build-review-disposition.ts:275-286`) already routes a
scope failure to `remediate`, not back to `build`, precisely so the resolution is a recorded
plan-level decision rather than a silent deletion.

**Design consequence.** The mechanical check this feature adds MUST NOT be a
"reject so the builder deletes it" gate. Deleting flagged work is the failure mode the
harness has already been burned by. The check refuses the *commit* at the moment it is
attempted, leaving the working tree intact, and offers exactly two forward paths: narrow the
commit to the task's declared paths, or record an explicit scope disposition that widens the
plan. Neither path destroys work. This is strictly better than the status quo not because it
deletes sooner, but because it forces the plan-vs-work reconciliation to happen while the
author still has the context — instead of hours later, in front of a reviewer whose only
lever is deletion.

## Hypotheses from the filer — dispositions

Both were carried into discovery labeled as candidates, not the chosen approach.

1. *"Engine-stamped task id and plan `Files likely touched` metadata may be enough for a
   deterministic path check at the commit boundary."* — **Confirmed by inspection.** Both
   inputs exist, are parsed today, and the commit-msg hook already holds the task trailer
   and the staged file list. Nothing new needs to be invented to obtain the data.

2. *"The semantic `build_review` scope rubric should remain defense-in-depth."* —
 **Confirmed and adopted.** The mechanical check compares paths; it cannot see that a
  correctly-pathed edit implements unrelated behavior. The two are complementary and both
  are kept.

## Approaches considered

**A. Reject in the commit-msg hook (chosen).** Replace the inert bundling warning with a
containment check sourced from the plan. Fires at the exact moment of the mistake, is
token-free, and satisfies the repository Design Principle that machinery — not prompt
discipline — enforces rules. Git hooks fire regardless of how the agent invokes git, so it
is not subject to the Bash-mediated bypasses catalogued in #627, which concern the session
PreToolUse mutation gate rather than git's own hook path.

**B. Post-hoc engine check at the task boundary only.** A containment counterpart to
`runPerTaskCommitFloor`, run when a task is recorded complete. Weaker: the bad commit is
already in history, so the remedy is a revert rather than a refusal, and the operator sees
the failure one step late.

**C. Leave it to `build_review`.** Status quo. Rejected — it is what produced #1074.

**Chosen: A, with B as the backstop.** The hook refuses the commit; a task-completion
containment check catches anything that reached history through a bypassed or unwired hook
(a real scenario — #625 documents worktrees running stale engine assets). `build_review`'s
semantic rubric and its `remediate` routing are untouched.

Refusal semantics, per the #989 lesson above: the hook **rejects the commit and leaves the
working tree untouched**. It never stages a deletion, never suggests deletion as the remedy,
and its message offers both forward paths (narrow the commit / record a scope disposition).

## Open design questions carried into architecture-review

- Legacy plans that declare no `**Files:**` block anywhere must not hard-block. `wiring-probe.ts`
  already sets the precedent (`LEGACY_PLAN_ADVISORY_REASON`, `wiring-probe.ts:578`): a plan is
  contract-bearing the moment any task declares the contract; otherwise findings are demoted
  to advisory. The same fail-open-on-legacy rule should apply here.
- The shape and storage of the explicit scope disposition that lets a legitimate collateral
  edit through.
- Whether always-allowed infrastructure paths (`.pipeline/`, `.docs/` evidence sidecars,
  `CHANGELOG.md`) need a standing allowlist, and whether that allowlist is configurable.

## Assumption ledger

| Assumption | Confidence | Basis | Impact if wrong |
| --- | --- | --- | --- |
| No engine writer populates `task-status.json` `t.files`, so the existing bundling warning never fires | 95% | verified — grepped every `task-status.json` writer; `NormalizedTask` has no `files` field | If a writer exists, the fix is narrower: change the question and severity, not the data source |
| Git hooks fire for daemon-authored commits (hooks path is wired in build worktrees) | 90% | inferred — `COMMIT_MSG_HOOK` already rejects unstamped `Task:` trailers in production, which requires the hook to be live | If hooks are not wired in some worktrees, approach A is inert there and backstop B carries the enforcement |
| Recent plans reliably declare per-task `**Files:**` blocks | 95% | verified against current `.docs/plans/` artifacts, and three engine modules already depend on that parse | If sparse, the legacy-advisory demotion path absorbs it without false blocks |
