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
   declared paths, or justify the widening in the commit message itself. It prints the exact
   trailer line to add, per offending path, so the remedy is a copy-paste and a re-run of
   `git commit`.

4. **`Scope:` commit trailer as the widening path.** The justification rides on the commit it
   authorizes:

   ```
   Scope: <repo-relative path> — <non-empty rationale>
   ```

   The trailer is repeatable: one line per path being widened. The hook already reads trailers
   via `git interpret-trailers` (`git-hook-assets.ts:100`), so this adds no new file I/O, no
   parser, and no read-ordering question.

   A malformed trailer is treated as absent, never as blanket permission — fail-closed,
   consistent with the release-waiver gate. Malformed means: a path that is not in the staged
   set, an empty or missing rationale, or a bare `Scope:` with no path.

   **Why the commit message and not a committed file.** An earlier revision of this ADR put the
   record at `.docs/scope-dispositions/<plan-stem>.md`, added to `DOCS_WRITE_ALWAYS_ALLOWED`
   (`phase-marker.ts:72`) alongside `.docs/release-waivers/`. That design is rejected on three
   counts:

   - **It deadlocks.** The disposition file is itself a staged path that no task's `Files:`
     block declares and that the machinery allowlist does not cover. Committing the record
     that authorizes a widening is itself an out-of-scope commit. The escape hatch cannot be
     used without a second, ad-hoc self-exemption.
   - **It grants standing permission.** A committed file widens the allowed set for its task
     for the rest of the build. A trailer authorizes exactly one commit — least privilege, and
     it cannot silently keep applying after the reason for it has passed.
   - **It costs machinery on the critical path.** The file design requires a markdown parser, a
     docs-guard allowlist change, and a decision about whether to read the record from `HEAD`
     or the working tree. The trailer requires none of them.

   Amending the plan's own `Files:` block was rejected on separate grounds: `.docs/plans/` is
   frozen during BUILD and is explicitly a Scope failure for `build_review` when modified
   mid-build.

   **Restoring reviewability.** The file design's one genuine advantage was landing inside the
   graded diff. `build_review`'s grader receives a diff, not the commit log, so a trailer is
   invisible to it; and this repository allows squash merge, so per-commit trailers survive
   into `main` only via GitHub's auto-concatenated squash body. That gap is closed
   deterministically by the backstop rather than by the author: `runContainmentFloor`
   (decision 5) already walks branch commits, so it records every accepted `Scope:` widening —
   path, rationale, task id, sha — into `.pipeline/containment-floor.json`, and that record is
   supplied as a `build_review` input. Machinery-authored placement is correct here precisely
   because it is engine-observed evidence rather than a self-granted permission.

5. **Backstop at the build-step boundary.** A containment counterpart alongside
   `runPerTaskCommitFloor` reports violations that reached history through an unwired or
   stale hook, and — per decision 4 — records every accepted `Scope:` widening so the
   widenings are reviewable even though the grader never sees a commit message.

6. **`build_review` is untouched.** Its Scope rubric and `remediate` routing remain exactly as
   they are, as defense in depth against correctly-pathed but behaviorally unrelated work.

### Matching and abstention rules

- Matching reuses `fileMatchesPlanPath` (`autoheal.ts:41`) — exact repo-relative match or
  `/`-boundary-anchored suffix match. The TypeScript function remains the single source of
  truth; the hook calls into the built engine rather than re-implementing the rule in shell.
- The standing allowlist is the existing `MACHINERY_AUTHORED_PATHS`
  (`build-review-inputs.ts:60`, `['.docs/shipped/', '.pipeline/']`), reused, not redefined.
- **Only an explicit `**Files:**` line is a declaration.** `parsePlanTaskPaths` falls back to
  harvesting backticked path tokens from bullet items when a task section has no `**Files:**`
  line (`plan-task-parse.ts:224`). Those paths are incidental, not declared — the exact
  phantom-path class recorded in #548 — and a section relying on the fallback yields a
  NON-empty set, so an "abstain when `files` is empty" rule would not catch it. `seedTaskStatus`
  therefore writes `files` only for sections carrying a literal `**Files:**` line; a
  fallback-derived set seeds no `files` at all and the check abstains. This requires
  `parsePlanTaskPaths` to expose per-section declaration provenance (it currently discards
  `hasFilesLine`), or a declared-only variant beside it.
- **Exit codes are three-valued.** `0` = allowed, `2` = violation, **any other code** =
  abstain. `COMMIT_MSG_HOOK` runs under `set -e` (`git-hook-assets.ts:92`), so the hook must
  capture the status (`|| rc=$?`) rather than let a non-zero propagate, and must block only on
  `2`. A two-valued "non-zero means violation" contract would make a stale `dist`, an
  unregistered subcommand, or a node crash indistinguishable from a real violation — turning
  the intended fail-open into a fail-closed wedge of every commit in the worktree. This is the
  concrete form of the #625 stale-`dist` risk that architecture-review F3 flags.
- **Fail-open, always, on absence of evidence.** Abstain when: no task in the plan declares a
  `Files:` block (legacy, non-contract-bearing plan — the `wiring-probe.ts:578` precedent);
  `task-status.json` is missing, malformed, or has no row for the stamped id; the row's `files`
  is absent or empty; no `Task:` trailer is present; the stamped row's status is not
  `in_progress` (a stale `.pipeline/current-task` yields a well-formed but wrong trailer, which
  would otherwise judge correct work against a previous task's declared set); or any error is
  thrown. The check blocks only on positive evidence of a violation.
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

- *A false positive wedges a live build.* Mitigated by the three-valued exit contract, blanket
  fail-open on every absence-of-evidence condition, the inherited exemption ladder, and the
  machinery allowlist. A plan that under-declares paths produces a refusal — which is the
  intended signal, resolved by adding a `Scope:` trailer, not by deleting work.
- *Routine under-declaration produces routine refusals.* Real commits touch incidentals plans
  rarely enumerate — command registration in `src/conductor/src/index.ts`, `CHANGELOG.md`, a
  regenerated HARNESS.md model table (integrity check 5a). Each is a refusal. This is the
  highest-frequency failure mode, not the "low" friction the risk framing implies, and the
  `Scope:` trailer is what makes it a five-second fix rather than a stall. The plan must ship
  the hook in report-only mode behind a flag first — printing the refusal, exiting 0, with the
  backstop recording what it would have blocked across real builds — and flip to blocking in a
  follow-up once that data shows the refusal rate is what this ADR assumes. Enforcing on the
  daemon's critical path with only untested-in-production fail-open logic is not a risk this
  ADR is entitled to take on the strength of reasoning alone.
- *The `Scope:` trailer becomes a rubber stamp.* Accepted. It is recorded by the backstop and
  supplied to `build_review`, whose semantic rubric still judges whether the widened work
  belongs. A recorded, reviewable decision is strictly better than today's silent drift.
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
| `build_review`'s grader receives a diff, not commit messages | 90% | verified — no `git log`/message plumbing in `build-review-inputs.ts` or `build-review-prompt.ts` | The backstop's widening record is redundant; decision 4 simplifies but stays correct |
| This repository squash- or rebase-merges (no merge commits) | 95% | verified — `allow_merge_commit: false`, squash and rebase both enabled | Per-commit `Scope:` trailers would survive to `main` directly, making the backstop record belt-and-braces |
