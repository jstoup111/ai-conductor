# ADR: the Tautology rubric exempts verify-only maintenance, anchored to engine-parsed plan markers

**Date:** 2026-08-15
**Status:** APPROVED
**Deciders:** Engineer (DECIDE phase, #1579, absorbs #1529), operator-confirmed
**Relates to:** `adr-2026-08-12-removal-anchored-tautology-exemption.md` (the structural model —
a closed, evidence-anchored exception), `adr-2026-07-07-build-review-judgement-gate.md` (the rubric
being narrowed), the verify-only completion machinery
(`.docs/architecture/verify-only-prove-closed-task-evidence.md`, #677)
**Supersedes:** nothing. **Does not change:** the Scope or Root cause rubric items, the all-or-FAIL
rule, the grader's input isolation (diff + plan only; task-status remains forbidden), or the
verdict schema.

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

## Consequences

- The dominant tautology lap-burner class converges: declared tasks pass under D3/D4 on the first
  lap; discovered ones converge on the first post-finding lap via D5 with no operator act.
- Genuinely tautological tests keep failing (D3 negative path).
- The exemption decision is auditable per test from an engine-parsed block, not grader free
  judgement.
- The closed list is now four; any fifth exception requires its own ADR.
