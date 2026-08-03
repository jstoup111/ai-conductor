# ADR: Plan-scope containment enforced at the commit boundary

**Date:** 2026-08-02
**Status:** APPROVED
**Feature:** `pipeline-commits-files-outside-the-active-plan-bef`
**Issue:** #1227

## Context

A BUILD commit can change files that no task in the approved plan declares. Nothing rejects
it when it happens. The only detector is `build_review`'s LLM-judged Scope rubric
(`build-review-prompt.ts:33`), which runs after the whole build.

Observed on PR #1074: commits `8b9f753e5` and `6b0d7b755` authored unrelated finish/finalizer
behavior against a plan scoped to `src/conductor/src/engine/config.ts`, and survived until
`0bf9d809b` removed them (`6 files changed, 28 insertions(+), 249 deletions(-)`).

Two facts from discovery constrain the solution:

1. **The enforcement point exists and is inert.** `COMMIT_MSG_HOOK`
   (`git-hook-assets.ts:180-222`) already compares the staged diff against per-task file
   sets. It is dead: it sources `t.files` from `task-status.json`, which no engine writer
   populates (`NormalizedTask`, `task-progress.ts:125-129`, declares only `id`/`title`/
   `status`), and it only warns when a diff spans *more than one* task — so files belonging
   to *no* task, the actual #1074 case, produce no output at all.

2. **The repair the issue cites as the remedy is recorded in-engine as a harm.**
   `build-review-disposition.ts:255-274` (#989) names commit `0bf9d809b` as an incident where
   the scope repair removed "an engine repair the branch legitimately needed," and routes
   scope failures to `remediate` specifically so resolution is not handed to an unsupervised
   agent "whose only lever is to delete whatever was flagged."

## Decision

Add a deterministic **plan-scope containment check** that refuses a BUILD commit whose staged
paths fall outside the active task's plan-declared paths, and a non-LLM backstop at the
build-step boundary.

Specifically:

1. **Seed declared paths into task rows.** `seedTaskStatus()` already receives `planPath` and
   parses it to create rows; it additionally writes `files: string[]` per row from
   `parsePlanTaskPaths()`. `TaskStatusRecord` has an open index signature, so this is
   additive. This revives the hook's existing `t.files` read path rather than adding a
   parallel data source.

2. **Enforce containment in `commit-msg`.** Inside the existing guarded block, compare
   `git diff-index --cached --name-only HEAD` against the stamped task's `files`. A staged
   path matching none of them is a violation → **exit 1**, message naming the task id and
   every offending path.

3. **Reject; never delete.** The hook refuses the commit and leaves the working tree
   byte-for-byte untouched. It never stages a deletion and never names deletion as the
   remedy. The message offers exactly two forward paths: narrow the commit to the task's
   declared paths, or record a scope disposition.

4. **Explicit scope disposition as the widening path.** A committed, reviewable record widens
   the allowed set for a named task. It lives at
   `.docs/scope-dispositions/<plan-stem>.md`, modeled directly on the existing release-waiver
   mechanism:

   ```
   Task: <task id>

   Paths:
   - <repo-relative path>

   Rationale: <non-empty prose — why the planned behavior requires this file>
   ```

   `.docs/scope-dispositions/` is added to `DOCS_WRITE_ALWAYS_ALLOWED`
   (`phase-marker.ts:72`), which today holds exactly `.docs/release-waivers/` — the same
   shape of artifact: a committed, in-diff, reviewable record that widens a gate. This
   placement is deliberate on two counts:

   - It is **inside the reviewed diff.** `build_review` excludes only
     `MACHINERY_AUTHORED_PATHS` (`['.docs/shipped/', '.pipeline/']`), so a disposition under
     `.docs/` is visible to both the grader and the human reviewer. Putting it in
     `.pipeline/` would make it machinery-authored and invisible — an unreviewable rubber
     stamp, defeating desired outcome 3.
   - It is **writable during BUILD.** The docs-guard freezes `.docs/` while a build phase is
     active; the always-allowed prefix is what permits the disposition to be authored at the
     moment the refusal occurs.

   Amending the plan's own `Files:` block was rejected as the widening mechanism: `.docs/plans/`
   is frozen during BUILD and is explicitly a Scope failure for `build_review` when modified
   mid-build.

   A malformed disposition (unknown task id, empty `Paths:`, empty `Rationale:`) is treated as
   absent, never as blanket permission — fail-closed on malformed input, consistent with the
   release-waiver gate.

5. **Backstop at the build-step boundary.** A containment counterpart alongside
   `runPerTaskCommitFloor` reports violations that reached history through an unwired or
   stale hook.

6. **`build_review` is untouched.** Its Scope rubric and `remediate` routing remain exactly as
   they are, as defense in depth against correctly-pathed but behaviorally unrelated work.

### Matching and abstention rules

- Matching reuses `fileMatchesPlanPath` (`autoheal.ts:41`) — exact repo-relative match or
  `/`-boundary-anchored suffix match. The TypeScript function remains the single source of
  truth; the hook calls into the built engine rather than re-implementing the rule in shell.
- The standing allowlist is the existing `MACHINERY_AUTHORED_PATHS`
  (`build-review-inputs.ts:60`, `['.docs/shipped/', '.pipeline/']`), reused, not redefined.
- **Fail-open, always, on absence of evidence.** Abstain (exit 0) when: no task in the plan
  declares a `Files:` block (legacy, non-contract-bearing plan — the
  `wiring-probe.ts:578` precedent); `task-status.json` is missing, malformed, or has no row
  for the stamped id; the row's `files` is absent or empty; no `Task:` trailer is present; or
  any error is thrown. The check blocks only on positive evidence of a violation.
- Existing exemptions are inherited wholesale by sitting inside the current guarded block:
  merge commits, `--amend`, rebase replay, and `CONDUCT_ENGINE_COMMIT=1`.

## Alternatives considered

**Leave it to `build_review`.** Status quo; it is what produced #1074. The detection is late,
costs a full build lap, and lands the finding in front of a reviewer rather than the author.
Rejected.

**Engine-side check at task completion only.** Simpler — no hook asset change, so no breaking
surface. But the bad commit is already in history, making the remedy a revert rather than a
refusal, and it repeats the late-detection failure one step earlier. Kept as the backstop
(decision 5), rejected as the primary.

**Make the existing warning fatal without changing its data source.** Zero-cost-looking, but
the data source is never populated, so the check would remain inert. It also asks the wrong
question (multi-task bundling, not out-of-plan containment). Rejected.

**Re-implement plan parsing in the hook's shell.** Rejected — duplicates
`parsePlanTaskPaths`'s hard-won grammar (#548, #578, #620 incidents are encoded in it) in a
second language with no tests.

## Consequences

**Positive.** Out-of-plan work is refused at the moment of the mistake, token-free and
deterministic, satisfying the repository Design Principle that machinery rather than prompt
discipline enforces rules. The plan-vs-work reconciliation happens while the author still has
context. A long-dead code path becomes live and tested. No legitimate work is destroyed.

**Negative / risks.**

- *A false positive wedges a live build.* Mitigated by blanket fail-open on every absence-of-
  evidence condition, the inherited exemption ladder, and the machinery allowlist. A plan that
  under-declares paths produces a refusal — which is the intended signal, resolved by
  recording a disposition, not by deleting work.
- *The scope disposition becomes a rubber stamp.* Accepted. It is committed and reviewable,
  and `build_review`'s semantic rubric still judges whether the widened work belongs. A
  recorded, reviewable decision is strictly better than today's silent drift.
- *Breaking surface.* This edits `hook wiring` / the `commit-msg` asset, a canonical breaking
  surface for the release gate. The plan must resolve migration-versus-waiver explicitly.

**Neutral.** `task-status.json` grows a `files` array per task. Consumers tolerate unknown
fields (`normalizeTasks` ignores them), so no consumer changes.

## Assumptions requiring confirmation before build

| Assumption | Confidence | Basis | If wrong |
| --- | --- | --- | --- |
| No engine writer populates `t.files` today | 95% | verified — grepped all `task-status.json` writers; `NormalizedTask` lacks the field | Fix narrows to changing the question and severity only |
| Git hooks are live for daemon-authored build commits | 90% | inferred — `COMMIT_MSG_HOOK` already rejects malformed `Task:` trailers in production | Primary enforcement is inert in those worktrees; the backstop carries it |
| Reviving `t.files` breaks no existing consumer | 90% | inferred — `normalizeTasks` ignores unknown fields; the only `t.files` reader is the dead hook block | A consumer reading `files` with different semantics would need reconciliation |
