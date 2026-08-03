# Complexity: lock-474-s-breaking-surfaces-before-v1-enumerate-e (#552)

Tier: L

## What is being sized

Not #474 itself. This feature is the **interface lock**: enumerate every consumer-visible
surface that engine-orchestrated parallel task-stream dispatch (#474) will touch, pin a
v1-compatible shape for each, and ship in v1 whatever enforcement makes each pin real —
so the post-v1 implementation lands as MINOR with no migration block.

## Signal assessment

| Signal | Reading | Tier |
|--------|---------|------|
| Data models / persistence | **Four on-disk stores, none versioned.** `.pipeline/current-task` (bare scalar, no newline — `task-cli.ts:153`, pinned by `task-cli.test.ts:159-180`), `.pipeline/dispatch-count` (line-oriented `Task: <id>`), `.pipeline/task-status.json` (`{plan_ref, tasks:[{id,name?,status?,...}]}` — `task-seed.ts:13-24`), `.pipeline/task-evidence.json` (`SerializedEvidenceData` — `task-evidence.ts:61-67`). No `schemaVersion` on any of them, and every reader is a tolerant duck-type parse (`normalizeTasks` accepts three distinct shapes, `task-progress.ts:137-174`). Widening is therefore indistinguishable from corruption to an old reader **by construction** — that is what has to be decided before the tag, not after. | **L** |
| Integrations | Five independent consumer-visible surfaces, each with its own compatibility story: the on-disk pipeline stores; the `conduct-ts task start\|done` CLI; two *shipped* operator hooks that read pipeline state (`hooks/claude/lint-after-edit.sh:66-67` reads `current-task` as its batch-boundary token; `hooks/claude/docs-guard.sh` reads `.pipeline/phase-active`); the plan-file contract (`.docs/plans/<stem>.md`); and the config allow-list. | **L** |
| Auth / identity | None. | S |
| State machine | No new FSM, but the **lane-cardinality model** is the core decision: today every identity slot in the engine is keyed by step name alone — synthetic state keys `<group>__<member>` (`conductor.ts:3279`), gate files `.pipeline/gates/<step>.json` (`gate-verdicts.ts:88`), one `.pipeline/phase-active`, one step-heartbeat record. `StepGroup.members` is `StepName[]` (`types/steps.ts:117`) — a static set of *distinct* steps, whereas a task stream is N dynamic instances of *the same* step (`build`). Choosing where lane identity lives is a one-way door. | **L** |
| Concurrency | Central to the subject matter, and already partially present: `runWithConcurrency` semaphore (`group-core.ts:238-322`), detached per-branch provider sessions (`provider-session.ts:74-76`), a `.pipeline/.task-status.lock` mkdir mutex taken by the dispatch hook but **not** by `runTaskStart`, `seedTaskStatus`, or `applyMapToStores` — so a seed can already clobber a concurrent row flip. | **L** |
| Story count | ~11: one per pinned surface (current-task scalar, lane key grammar, task-status/telemetry plurality, evidence counters, plan dependency grammar, plan file-set veto rule, config key reservation, dispatch-count freeze, phase-active invariance) plus the two negative paths (unparseable dependency value degrades to sequential; a surface that cannot be made forward-compatible escalates and ships breaking in v1). | **L** |
| Correctness risk | **High, and asymmetric.** A pin that is wrong is not a bug that gets fixed next sprint — it is a MAJOR version bump after v1.0, which is the exact outcome #228 Wave B exists to prevent. A pin that is merely *documented* rather than test-enforced decays silently: this repository's own Design Principle names prompt-level rules as the failure mode machinery must replace. Two live as-built/as-designed divergences found during discovery (below) are direct evidence that prose pins do not hold here. | **L** |

## Verdict

**Tier: L (Large).** Five distinct consumer-visible surfaces, each needing an independent
and independently-justified decision; four unversioned on-disk schemas that must be widened
without a discriminator; a cardinality model that has no representation anywhere in the
engine today; and a one-way door — the cost of a wrong pin is a post-v1 MAJOR bump, not a
patch. Not M: the count of surfaces and the irreversibility both exceed the "one subsystem,
recoverable" bar that M implies, and the operator's `size: M` label on #552 sizes the
*coding effort*, which is indeed modest — the DECIDE surface is what is large here.

## DECIDE consequences (Large)

- PRD: **skipped** (technical track — see `.docs/track/`).
- architecture-diagram: **included** — the surface map (which producer writes which store,
  which consumer reads it, and where lane identity would have to enter).
- architecture-review: **full**, with APPROVED ADRs that enumerate every consumer-visible
  surface and pin its v1 shape. This is the feature's primary deliverable, not a side effect.
- conflict-check: **included**.
- stories + plan: **required**.
- coherence-check: **required** (M/L).

## Discovery findings that moved the tier up

Two divergences between the recorded design and the shipped code were found while mapping
the attribution surface. Both are load-bearing for #474 and both are evidence that a
prose-only pin does not survive here:

1. **The #494 overlap guard does not exist in HEAD.** `adr-2026-07-10-session-hook-task-stamping.md:47-56`
   specifies that a dispatch arriving while a different id is stamped CLEARS `.pipeline/current-task`
   so `prepare-commit-msg` abstains. That code was deleted by `ce1c1cf17`; the shipped
   `PRE_DISPATCH_HOOK` (`session-hook-assets.ts:17-140`) flips the `task-status.json` row and
   **never writes the stamp at all**. `POST_DISPATCH_HOOK` was then deleted by `e7af1ea4b`.
2. **Nothing in the automated build loop writes `current-task`.** Its only producer today is
   `runTaskStart` (`task-cli.ts:84-159`), an operator/recovery CLI. So the engine-stamped
   `Task:` trailer that #474's proposal assumes ("composes with the engine-stamped task ids
   (#452): concurrent commits stay attributable") is, in the ordinary daemon build, not
   produced by the engine at all — matching the misattribution evidence in #531.

`skills/pipeline/SKILL.md:52-66, 83, 103` still documents the removed behavior. That drift is
in scope for this feature only where it defines a pinned surface; the rest is noted for #531.
