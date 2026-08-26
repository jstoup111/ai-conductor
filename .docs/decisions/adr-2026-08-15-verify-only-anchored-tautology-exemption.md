# ADR: the Tautology rubric exempts verify-only maintenance, anchored to engine-parsed plan markers

**Date:** 2026-08-15
**Status:** SUPERSEDED by adr-2026-08-22-one-owner-per-review-question
**Deciders:** Engineer (DECIDE phase, #1579, absorbs #1529), operator-confirmed
**Relates to:** `adr-2026-08-12-removal-anchored-tautology-exemption.md` (the structural model —
a closed, evidence-anchored exception), `adr-2026-07-07-build-review-judgement-gate.md` (the rubric
being narrowed), the verify-only completion machinery
(`.docs/architecture/verify-only-prove-closed-task-evidence.md`, #677)
**Supersedes:** nothing. **Does not change:** the Scope or Root cause rubric items, the all-or-FAIL
rule, the grader's input isolation (diff + plan only; task-status remains forbidden), or the
verdict schema.

> **Amended 2026-08-16 by #1579 (architecture-review, remediating
> `build_review:root-cause-symptom-displacement`):** the input-isolation clause above is narrowed,
> not withdrawn. The frozen grader source now admits a third **engine-derived** class alongside diff
> and plan — commit-trailer evidence read from the reviewed `mergeBase..HEAD` range (D6 below). What
> the clause forbids is unchanged and absolute: `.pipeline/task-status.json` and every other maker
> self-report state remain forbidden as a grader input at every seam. The boundary now reads
> "diff + plan + engine-read commit trailers from the reviewed range; maker self-report state
> remains forbidden."

## Context

Issue #1579. The Tautology rubric ("every new/changed test would fail without the diff") has a
closed exception list of three (`build-review-prompt.ts:92-113`). When a plan task requests
behavior that **already exists** on the merge base, a test documenting that behavior passes
pre-diff by definition. The finding is factually correct and has no code-side fix: the grader
correctly reports "None of the closed exceptions applies," and the identical finding recurs every
lap (~7 min, ~2.4M tokens each; 26 tautology findings in one night's daemon.log; two features
cycling on this class on 2026-08-14/15).

The sibling class — removals — was fixed by
`adr-2026-08-12-removal-anchored-tautology-exemption.md` after 8 wasted laps (#1521): a fourth
evidence block computed by the engine, plus a closed per-test predicate. This ADR applies the same
doctrine to the already-existed class, and absorbs #1529's maker-side half: the `tdd` cycle's
RED-first universal is what authors these doomed tests in the first place.

## Verified claims (confidence / basis)

- `parsePlanTaskVerifyOnly` exists and fail-closed parses `**Verify-only:** yes` and
  `**Type:** … verification` markers from plan task blocks — 100%, verified (`autoheal.ts:616-674`).
- `planBody` is already available at build_review input assembly, so a verify-only context can be
  derived with zero new inputs — 100%, verified (`build-review-inputs.ts:227,253-296`).
- `.docs/plans` is a sealed protected artifact during BUILD; a maker cannot amend the plan without
  an operator reseal — 100%, verified (`protected-artifact-seal.ts:17-26`, `reseal-cli.ts`).
- A task closes without a plan marker when `.pipeline/task-status.json` records
  `status: 'skipped'` — the commit floor accepts plan-marker OR skipped-status — 95%, verified
  (`per-task-commit-floor.ts:72-82,254-277`).

### The load-bearing correction

An earlier framing had the maker "mark the task verify-only" mid-build as its sanctioned exit.
That path is **operator-gated**: the plan is sealed, and a reseal is an operator act — so it cannot
satisfy the issue's "without operator intervention" outcome. The design therefore splits the two
cases below; recording this because it is the specific way this decision was nearly got wrong.

## Decision

**The Tautology rubric gains one narrow exemption — verify-only maintenance — anchored to
engine-parsed plan verify-only markers; the maker-side authoring rules stop producing the doomed
tests for the undeclared case.**

### D1 — The engine derives verify-only task evidence deterministically

At build_review input assembly, the engine derives from `planBody` (already an input) a
`verifyOnlyContext`: for each task where `parsePlanTaskVerifyOnly` returns `true`, its task id and
its plan-declared file paths (`parsePlanTaskPaths`). No LLM in the derivation path. The context
joins the source snapshot (and its digest) exactly as `removalContext` does.

> **Amended 2026-08-16 by #1579 (architecture-review, remediating
> `build_review:root-cause-overbroad-boundary`):** one derived context, **two separately computed
> memberships**. The derivation above is preserved verbatim as the *Tautology* evidence membership
> (D3). It gains one additional deterministic per-task classification, consumed by *Completeness*
> alone (D4):
>
> - `noImplementationPlanned(task)` is **true** iff either (i) the task block carries
>   `**Verify-only:** yes` under the existing exact-match, fail-closed parse, or (ii) the block
>   carries no `**Verify-only:** yes` and its `**Type:**` line's `+`-split, trimmed, lower-cased
>   token set is **exactly** `{verification}`.
> - It is **false** in every other case, including every mixed declaration —
>   `**Type:** implementation+verification`, `happy-path+verification`,
>   `infrastructure+verification` — unless clause (i) independently holds. Absent, empty, or
>   unparseable markers are false. Fail-closed in both directions.
>
> Rationale: `parsePlanTaskVerifyOnly` (`autoheal.ts:638-674`) returns `true` when *any* `+`-split
> token is `verification`, so a task that plans real implementation behavior alongside its
> verification half was being granted no-implementation-diff treatment by D4. A mixed task's
> implementation half must stay fully judged; only an explicit planner declaration that the task
> delivers no code delta — `**Verify-only:** yes`, the #677 marker's actual meaning — buys the
> Completeness relief for a mixed `**Type:**` line.
>
> This is a boundary split, not a second channel: `noImplementationPlanned` rides each existing
> `verifyOnlyContext` entry, so one evidence block still carries both memberships and every
> snapshot/projection/digest seam stays singular.

### D2 — It travels as a fifth evidence block, not a rule change

`build-review-prompt.ts` renders an "Engine-parsed verify-only tasks" block — evidence, not an
exemption, same doctrine as the removal block. `(none)` when no task is marked.

### D3 — Fourth closed exception, per-test predicate

The closed list grows to four. A changed test qualifies as verify-only maintenance only when all
three hold: (1) the engine block lists a verify-only task; (2) the changed test's lines reference
that task's plan-declared files or the behavior that task verifies; (3) the change adds no
assertion about behavior this diff introduces. Evaluated per changed test, never per diff. A
qualifying test must not receive a Tautology finding solely because it passes pre-diff; a
non-qualifying pre-diff-passing test is measured normally (negative path preserved — test-local
helper assertions and unanchored tests still FAIL).

### D4 — Completeness reads the same evidence

One guidance line: a task listed in the engine-parsed verify-only block legitimately contributes
no implementation diff; its absence from the diff is not a Completeness gap. (Holistic judgement
otherwise unchanged.)

> **Amended 2026-08-16 by #1579 (architecture-review, remediating
> `build_review:root-cause-overbroad-boundary`):** the guidance line is scoped to block entries
> whose `noImplementationPlanned` classification (D1 amendment) is `true` — not to every listed
> task. A listed task with `noImplementationPlanned: false` (a mixed `**Type:**` declaration
> without `**Verify-only:** yes`) is judged for its implementation half exactly as an unlisted task
> is: its absence from the diff is a Completeness gap. D3's Tautology membership is deliberately
> **not** narrowed — its conditions (2) and (3) are per-test and already prevent a mixed task from
> excusing a test that asserts behavior this diff introduces, so the wider membership costs nothing
> there while the narrower one is required here.

### D5 — Maker-side authoring boundary (absorbs #1529)

`tdd` and `writing-system-tests` gain a "no legitimate RED" boundary with two cases:

- **Declared (plan-marked verify-only/verification task):** author at most a documenting test if
  the plan asks for one; the D3 exception covers it at review.
- **Discovered mid-build (task's behavior already exists, plan unmarked):** do NOT author a test
  that cannot fail; delete any redundant test already authored this lap; close the task as
  `skipped` in `.pipeline/task-status.json` with the reason (existing commit-floor machinery
  accepts this) — never invent unrelated assertions, never amend the sealed plan.

> **Amended 2026-08-15 by #1579 (conflict-check):** the discovered-case closure routes through
> the existing #677 mechanism — an empty commit carrying `Task: <id>` and
> `Evidence: skipped <reason>` trailers, from which the engine derives `status: 'skipped'` —
> rather than a direct `.pipeline/task-status.json` write. The commit form is durable across
> worktree recreation (`.pipeline/` is disposable) and avoids a second channel for the same
> concern. The no-operator, no-plan-edit property is unchanged.

`plan` authoring guidance is strengthened: a task that verifies or documents possibly-pre-existing
behavior is marked `**Verify-only:** yes` (or `**Type:** verification`) at DECIDE time — the
existing #677 marker, now also review-load-bearing.

## Stated limit (accepted residual risk)

A mid-build-discovered case closes by test deletion + skipped status, which the input-starved
grader never sees; its task simply contributes nothing to the diff. Holistic Completeness may
still flag a diff-absent unmarked task. Accepted because: per-task SHA-chasing is already
forbidden in the Completeness rubric, the operator reseal path remains the explicit fallback, and
the deferred Approach B follow-up (engine-run pre-diff pass/fail evidence per changed test) is the
durable anchor upgrade for this residue. Anchoring any exemption to `task-status.json` is rejected
outright — that is maker self-report, and the gate exists because self-reports are not evidence
(#773 doctrine).

> **Amended 2026-08-16 by #1579 (architecture-review, remediating
> `build_review:root-cause-symptom-displacement`):** this residue is **withdrawn**, not merely
> narrowed. Accepting it left the discovered case's closure invisible to Completeness, so the
> design treated the recurring finding's symptom (the Tautology lap-burner) while leaving the same
> root cause — a legitimately diff-absent task the grader cannot account for — live on the
> Completeness rubric. The rejection of `task-status.json` as an anchor stands verbatim and is what
> D6 below is built to respect; what is withdrawn is the conclusion that no admissible signal
> exists.
>
> ### D6 — The discovered case emits engine-authenticated skipped-task evidence
>
> - **Source.** At build_review input assembly the engine reads the reviewed commit range
>   (`mergeBase..HEAD`, already resolved for the diff at `build-review-inputs.ts:245-266`) and
>   derives `skippedTaskContext: readonly { taskId, reason, commit }[]` — one entry per commit in
>   that range carrying **both** a `Task: <id>` trailer and an `Evidence: skipped <reason>`
>   trailer, which is exactly the D5 closure form. No LLM in the derivation path.
> - **Authentication — why this is evidence and `task-status.json` is not.** The trailers live in
>   immutable commits inside the same reviewed range the diff is cut from, so they are part of the
>   history under review rather than a mutable sidecar a maker can rewrite after the fact. The
>   generated `commit-msg` hook rejects `Task:` naming drift and ids absent from the task ledger at
>   commit time (`git-hook-assets.ts:224-246`), which is an early filter, not the authority. The
>   authority is assembly-side: each parsed id is re-resolved against the **sealed** `planBody`
>   using the existing canonical-id folding, and any id that does not resolve to a plan task, or
>   any commit missing either trailer, is dropped fail-closed. The `<reason>` string is rendered as
>   evidence text and carries no decision authority.
> - **Isolation.** `.pipeline/task-status.json` is read at no seam in this derivation. The engine
>   never consults task status to decide membership, and no task-status value reaches the grader.
> - **Snapshot / projection contract.** `skippedTaskContext` is frozen into
>   `BuildReviewSourceSnapshot`, participates in **both** `snapshotDigest` and
>   `contentSnapshotDigest`, and rides `CommonProjection` beside `verifyOnlyContext`. One evidence
>   seam; no new event, ledger, sidecar, or observation channel.
> - **Completeness contract.** A task listed in the engine-parsed skipped block accounts for its
>   own absence from the diff: that absence alone is not a Completeness gap. It is **not** an
>   automatic pass — Completeness still judges whether the approved plan's outcomes were delivered,
>   and an outcome left unmet is a gap however its task closed. Per-task SHA-chasing remains
>   forbidden; the block is read as context for holistic judgement, exactly as `verifyOnlyContext`
>   is.
> - **Tautology contract.** Unchanged. A discovered-case task authors no test, so it never reaches
>   the per-test predicate. The closed exception list stays at four.
> - **D5 is unchanged in behavior.** The discovered case still closes with no operator act and no
>   plan amendment. Only its visibility to the grader changes.
> - **Approach B remains the deferred durable upgrade** for per-test pre-diff pass/fail evidence;
>   D6 closes the Completeness half of the residue without waiting for it.

## Required plan realignment (2026-08-16 amendments) — DEFERRED (operator ruling, 2026-08-16)

> **Operator ruling (2026-08-16):** the two amendments above are approved as design direction but
> are **deferred out of this feature's scope** to issue #1622. They do NOT bind this feature's
> stories, plan, acceptance specs, or build: the original 11-task plan stands as the delivery
> contract, and BUILD proceeds without a `stories` → `plan` → `coherence_check` re-run (autonomous
> re-plan is prohibited by design, and the operator declines an interactive re-plan for this
> feature). The realignment below is retained verbatim as the implementation sketch for #1622.

The two amendments above are structural; when #1622 is taken up, its plan must land these:

- **Task 1 (derivation)** — emit `noImplementationPlanned` per `verifyOnlyContext` entry under the
  D1-amendment predicate, with fail-closed coverage of every mixed `**Type:**` form and of the
  `**Verify-only:** yes` override.
- **Task 2 (snapshot/digest)** and **Task 3 (projections)** — carry the new per-entry field, and
  add `skippedTaskContext` to the snapshot, both digests, and `CommonProjection`.
- **New task — D6 derivation** — read `Task:`/`Evidence: skipped` trailer pairs from
  `mergeBase..HEAD`, resolve ids against `planBody`, drop unresolvable entries fail-closed.
- **Task 6 (monolithic Completeness line)** and **Task 8 (fan-out Completeness skill)** — scope the
  no-implementation-diff relief to `noImplementationPlanned: true` entries, and add the
  skipped-block guidance with its explicit "accounts for absence, is not an automatic pass" limit.
- **New task — D6 prompt/skill parity** — render the skipped-task evidence block in
  `buildGraderPrompt` and mirror it in `skills/build-review-completeness/SKILL.md`, `(none)` when
  empty.
- **Task 11 (plan skill guidance)** — state that a mixed `**Type:** implementation+verification`
  declaration does **not** buy Completeness relief; only `**Verify-only:** yes` declares a task
  with no code delta.
- **Tasks 4, 5, 7, 9, 10** — unaffected; D3 and D5 are unchanged.

## Consequences

- The dominant tautology lap-burner class converges: declared tasks pass under D3/D4 on the first
  lap; discovered ones converge on the first post-finding lap via D5 with no operator act.
- Genuinely tautological tests keep failing (D3 negative path).
- The exemption decision is auditable per test from an engine-parsed block, not grader free
  judgement.
- The closed list is now four; any fifth exception requires its own ADR.

> **Amended 2026-08-22 by #1805:** superseded by adr-2026-08-22-one-owner-per-review-question — the rubric this ADR governs is retired; prd_audit is the completion authority.
