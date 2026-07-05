# ADR 2026-07-05: Engine-owned, git-derived task-status.json

**Date:** 2026-07-05
**Status:** DRAFT — pending Fable validation. The design below was pressure-tested under **Opus**
(the session model was Opus despite the runtime context claiming Fable); the operator requires a
**Fable** re-validation of the ownership-inversion design before this ADR is flipped to APPROVED and
the spec lands. Do not land while this reads DRAFT (the `land` ADR gate enforces this). See
`.docs/PENDING-fable-pressure-test.md`.
**Deciders:** James (solo dev) + harness architecture-review + design pressure-test (Opus; awaiting Fable)
**Feature:** jstoup111/ai-conductor#302 — `prd_audit → build` kickback wipes `.pipeline/task-status.json`
**Related:** #115 (closed, retryReason handoff), #280 (open, forward-progress halt for partial completion)

## Context

The daemon's `build` completion gate (`CUSTOM_COMPLETION_PREDICATES.build`, `artifacts.ts:376-417`)
is "done" only when every task in `.pipeline/task-status.json` is `completed`/`skipped`. That file is
authored **by the build agent** running `/pipeline` (`step-runners.ts:35 build: '/pipeline'`), which
is the sole writer and can rewrite it wholesale. When a `prd_audit → build` kickback re-enters build,
the agent can empty the file; an empty `tasks: []` makes the gate return `'no tasks in task-status.json'`
permanently (`artifacts.ts:403-406`), `buildRetryHint` doesn't recognize that reason
(`conductor.ts:2662-2674`), and the daemon re-kick sweep (`daemon-rekick.ts:90-190`) re-dispatches the
identical failure — an infinite HALT loop. Observed on `daemon-lifecycle-controls`: 6 HALTs over ~4
hours with the work already 100% complete (96/96 tests), broken only by manual reconstruction.

Forces / constraints:
- **Two uncoordinated writers.** The completion truth lives in a file the *agent* maintains while the
  *engine* trusts it. Any agent rewrite (or crash mid-write) can desynchronize it from reality.
- **Coupling to `/pipeline`.** The gate depends on a `/pipeline`-private artifact. `/tdd` writes
  nothing to `task-status.json`; a build driven by any non-`/pipeline` skill would fail `'missing'`
  identically. The completion contract is skill-specific, not ground-truth.
- **The engine already has git-derived completion.** `attemptAutoHeal` (`autoheal.ts:58-104`) marks a
  task complete when a commit touches its plan files — but it is best-effort, no-ops on an empty list,
  and its path-only matching is ambiguous for tasks touching shared files.
- **Idempotency across re-kicks.** Remediation currently reaches build only as a prompt hint
  (`buildRemediationHint`, `conductor.ts:2633`); `remediation.json` has no collision-free task key
  (`task.id` defaults to `''`, `gap.id` to `'?'`, titles drift), so any append-based merge both drops
  and duplicates.
- **Re-kick survival.** `.pipeline/HALT` is unconditionally cleared by `rekickSweep`; only
  `.daemon/parked/<slug>` survives (`park-marker.ts`), and it is human-cleared + stamped "parked by
  operator."
- **In-flight migration.** Features mid-build already have agent-written `task-status.json` files that
  a new engine writer must reconcile, not clobber.

## Options Considered

### Option A — Two-mechanism patch (engine append + gate park). REJECTED
Engine appends remediation tasks to `task-status.json` at the kickback; the build gate parks on
empty-with-evidence.
- **Rejected because** the agent remains the sole wholesale writer and can re-empty the appended file
  (two uncoordinated writers — same bug class); no collision-free dedupe key exists, so the append
  both drops and double-appends; the "distinct park HALT" as a `.pipeline/HALT` variant does **not**
  survive `rekickSweep`; and it leaves the root cause (empty-is-done entry-guard semantics) untouched.
  See `architecture-review-prd-audit-kickback-preserves-task-status.md` for the full teardown.

### Option B — Heuristic reconstruction of task-status.json from progress.log. REJECTED
On empty/missing, rebuild completed entries by parsing `.pipeline/progress.log`.
- **Rejected because** `progress.log` is free-form prose written **even on the vacuous empty-exit**
  (`SKILL.md:54-55`), so it is non-empty precisely in the bug state; reconstructing an authoritative
  task list from prose is fragile and risks marking unfinished work `completed`.

### Option C — Engine-owned, git-derived task-status.json (ownership inversion). APPROVED
The engine is the **single writer** of `task-status.json`; the build agent only implements + commits.
- **Seed:** at build entry the engine upserts one entry per plan task **by id** from the plan
  (`readPlanPaths(projectRoot, planRef)`), preserving any existing status/rework rows (merge, never
  overwrite) — never empty when the plan has tasks.
- **Derive:** the engine marks a task `completed` when a commit on the worktree branch (since its
  merge-base) **references the task id** (message/trailer) **and** touches the task's plan files —
  `autoheal` promoted to authoritative, `findMatchingCommit` tightened to require the id (removing
  shared-path ambiguity).
- **Agent contract:** `/pipeline` per-task template commits with a `Task: <id>` trailer and stops
  writing `task-status.json` authoritatively; the Entry Guard's `all([]) === true` empty-is-done
  semantics is removed (empty = seed-and-run).
- **Remediation:** `/remediate` extends the **plan** with deterministic, gap/FR-derived task ids
  (idempotent upsert); the engine re-seeds and re-derives, re-marking already-done tasks from their
  id-stamped commits.
- **Last resort:** when the plan has tasks but no evidence accrues after N attempts (or the plan is
  empty/missing), write a survivable auto-park marker (`park-marker.ts` family, distinct auto
  provenance, dashboard surface) that `rekickSweep` skips — a visible, actionable stop instead of an
  infinite loop; reconciled with #280.

**Pros:** the wipe is **structurally impossible** (the agent can't erase what it doesn't own);
completion is ground-truth (git), not agent bookkeeping; decoupled from `/pipeline` (works for any
build skill); subsumes the append mechanism; leverages existing `autoheal`/`park-marker`/`plan-ref`
machinery.
**Cons:** a coordinated contract change across the engine + `/pipeline` SKILL.md + `/remediate`
SKILL.md, with `autoheal` hardening and a careful in-flight-state migration — Large, not a localized
patch. Mitigated by sequencing (loop-and-wipe elimination first).

## Decision

Adopt **Option C**. `task-status.json` is engine-owned **derived** run-state: seeded from the plan
(merge/upsert), completion derived from **task-ID-stamped git commits** (the operator-chosen evidence
bar). The build agent implements + commits + stamps ids; it is never the authority on completion.

The following are **binding constraints** (each maps to a story):

- **H1 — Seed is merge/upsert by id**, preserving existing `status`/`in_progress`/rework counts;
  never a blind overwrite. This is also the in-flight migration path.
- **H2 — The `Task: <id>` trailer is enforced** by the `/pipeline` per-task template; a plan-path
  fallback applies; a task that cannot be evidenced after N attempts **parks, never loops**.
- **H3 — Remediation tasks carry deterministic gap/FR-derived ids** → idempotent upsert into the plan.
- **H4 — Single-authority migration:** the engine is the sole authority; `/pipeline` stops writing
  `task-status.json` authoritatively (advisory only). The two writers never coexist authoritatively.
- **Empty-is-done removed:** an empty/missing task list is a seed-and-run (or park) state, never a
  completion. `buildRetryHint` gains explicit `'no tasks'`/`'missing'` cases.
- **No false-positive on a fresh build:** evidence = commits on the worktree branch since merge-base;
  0 commits = genuinely fresh, behavior unchanged.
- **#115 retained** (retryReason context is additive); **park reconciled with #280**, not parallel.

## Consequences

- The completion gate stops trusting an agent-maintained artifact; the daemon can no longer loop on an
  empty task list, and completed work can no longer be silently destroyed.
- `/pipeline` and `/remediate` SKILL.md contracts change; the harness integrity suite and
  `src/conductor` vitest specs must cover the new engine ownership, the trailer contract, idempotent
  remediation, the migration merge, and the survivable park.
- Follow-up coordination with #280 is required for the shared park/forward-progress surface; this ADR
  scopes the park as the empty/no-evidence trigger of that mechanism, not a competing one.
