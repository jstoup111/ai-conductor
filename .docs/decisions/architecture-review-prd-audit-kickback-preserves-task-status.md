# Architecture Review: prd-audit kickback preserves task-status.json

**Date:** 2026-07-05
**Reviewer:** design pressure-test performed under **Opus** (session model was Opus, not Fable, despite
the runtime context) + harness architecture-review. **Operator requires a Fable re-validation before
this is final** — see `.docs/PENDING-fable-pressure-test.md`.
**Feature:** jstoup111/ai-conductor#302 — the `prd_audit → build` kickback wipes
`.pipeline/task-status.json`, producing an infinite auto-re-kick HALT loop.
**Outcome:** PROPOSED, pending Fable re-validation — engine-owned, git-derived completion (decoupled
from `/pipeline`), with four mandatory hardening properties. Recorded as
`adr-2026-07-05-engine-owned-task-status.md` (Status: DRAFT until Fable validates).

## What was reviewed

Two candidate designs:

- **Two-mechanism patch (rejected as primary):** (A) engine appends remediation tasks to
  `task-status.json` at the kickback, (B) a build-gate safety net that parks on empty-with-evidence.
- **Ownership inversion (approved):** the engine becomes the **single writer** of `task-status.json`,
  seeding it from the plan and deriving per-task completion from task-ID-stamped git commits; the
  build agent only implements + commits; remediation extends the plan.

## Why the two-mechanism patch fails as the primary fix

1. **`/pipeline` is the sole writer and is plan-anchored, not row-anchored.** Appending pending rows
   defeats the vacuous entry-guard exit, but the agent can still rewrite `task-status.json` wholesale
   on the next entry — re-emptying it. Two uncoordinated writers to one file is the same bug class.
2. **No collision-free dedupe key exists** in the current `remediation.json` schema: `task.id`
   defaults to `''` (`artifacts.ts:1104`), `gap.id` to `'?'` (`artifacts.ts:1109`), and `/remediate`
   rewords titles between rounds — so append both **drops** id-less tasks and **double-appends**
   reworded ones.
3. **"Distinct park HALT" using `.pipeline/HALT` does not survive re-kick.** `rekickSweep`
   unconditionally clears `.pipeline/HALT` (`daemon-rekick.ts:90-190`); only `.daemon/parked/<slug>`
   survives (`park-marker.ts`), and that marker is human-cleared and stamped "parked by operator" —
   auto-writing it mislabels the park and **silently strands** the feature.
4. **The completion predicate has no slug/daemon-root** (it runs in the worktree with only `dir`), so
   a park cannot live there — it needs daemon-layer wiring.
5. **The true root cause is untouched:** the `/pipeline` Entry Guard treats an empty task list as
   *complete* (`all([]) === true`, `skills/pipeline/SKILL.md:45-57`), and `buildRetryHint`
   (`conductor.ts:2662-2674`) doesn't recognize `'no tasks'`/`'missing'`. Any path that empties the
   file re-triggers the identical loop.

The patch is two of ~five pieces and one of them (the marker) is wrong. It hides the coupling rather
than removing it.

## The approved design and its pressure-test

**Invert ownership.** `task-status.json` becomes engine-owned **derived** state:

- The engine **seeds** it from the plan at build entry (never empty).
- The build agent **implements + commits with a `Task: <id>` trailer**; it is no longer the
  authority on completion.
- The engine **derives** completion via `autoheal` commit-matching (promoted to authoritative).
- **Remediation extends the plan**; the engine re-seeds and re-derives.

Fable pressure-test — the design survives, conditioned on four hardening properties that are
**must-specify** (each became a story):

| # | Attack | Required property |
|---|---|---|
| H1 | Engine re-seed on a normal mid-build re-entry blows away `in_progress` + rework counts → engine-side wipe | **Seed is a merge/upsert by task id**, preserving existing status + rework counts; never a blind overwrite. Also the migration path for in-flight features. |
| H2 | Fragility just moves from "agent maintains JSON" to "agent stamps commit trailers"; a missing/malformed trailer strands a task | **Enforce the `Task: <id>` trailer in the `/pipeline` per-task template**, with a plan-path-match fallback, and **park (not loop)** when a task can't be evidenced after N attempts. |
| H3 | Re-running `/remediate` for the same gap duplicates remediation tasks in the plan | **Remediation tasks carry deterministic gap/FR-derived ids** → idempotent upsert into the plan. This is where the review's idempotency concern is finally solved (stable keys, the operator's task-ID choice). |
| H4 | Two authoritative writers during migration disagree | **Single-authority migration:** engine is the sole authority; `/pipeline` SKILL.md stops writing `task-status.json` authoritatively (advisory only). |

Additional confirmed properties folded into stories:

- **Empty/missing plan → park, not loop** (the empty-source risk moves from volatile run-state to a
  stable committed DECIDE artifact — strictly better, but the empty branch must park).
- **No false-positive on a fresh build:** completion is evidenced by **commits on the worktree branch
  since its merge-base** (0 commits = genuinely fresh, unchanged behavior) — not by `progress.log`,
  which the entry guard writes even on the vacuous exit.
- **`buildRetryHint` gains `'no tasks'`/`'missing'` cases** so the non-daemon / no-evidence paths get
  an actionable directive instead of the misleading "Finish the work now."
- **#115 retryReason retained** (additive context, no regression); **survivable park reconciled with
  #280** rather than adding a parallel park mechanism.

## Sequencing (feeds `/plan`)

1. **Slice 1 — loop-and-wipe elimination (self-contained, testable):** engine seed (merge/upsert) +
   authoritative git-derived completion (H1, H2 partial, task-ID trailer) + remove the empty-is-done
   entry-guard semantics + `buildRetryHint` cases. This alone breaks the loop and the wipe.
2. **Slice 2 — remediation-extends-plan** with deterministic ids (H3) + the single-authority migration
   cleanup (H4).
3. **Slice 3 — survivable auto-park** last-resort with distinct provenance + dashboard surface,
   reconciled with #280.

## Decision

**APPROVED.** Author `adr-2026-07-05-engine-owned-task-status.md` (Status: APPROVED) recording the
ownership inversion and H1–H4 as binding constraints. Proceed to `/stories`, `/conflict-check`, `/plan`.
