# ADR 2026-07-05: Engine-owned, git-derived task-status.json

**Date:** 2026-07-05
**Status:** APPROVED — Fable-validated 2026-07-05. First pressure-tested under Opus (2026-07-05),
then re-validated under **Fable 5** (session model confirmed) via three independent adversarial
lenses (evidence derivation; lifecycle/concurrency/migration; skill contracts). Verdict: the
ownership inversion **survives**, conditioned on five additional binding constraints (H5–H9 below)
that the Opus round missed. See the Fable findings table in
`architecture-review-prd-audit-kickback-preserves-task-status.md`.
**Deciders:** James (solo dev) + harness architecture-review + design pressure-test (Opus 2026-07-05, Fable 2026-07-05)
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

**Pros:** the wipe is **structurally harmless** (completion is recomputed from plan + git on every
gate evaluation, and durable engine state lives in an agent-untouchable sidecar — erasing the cache
erases nothing authoritative; see H6); completion is ground-truth (git), not agent bookkeeping;
decoupled from `/pipeline` (works for any build skill); subsumes the append mechanism; leverages
existing `autoheal`/`park-marker`/plan-snapshot machinery.
**Cons:** a coordinated contract change across the engine + `/pipeline` SKILL.md + `/remediate`
SKILL.md, with `autoheal` hardening and a careful in-flight-state migration — Large, not a localized
patch. Mitigated by sequencing (loop-and-wipe elimination first).

## Decision

Adopt **Option C**. `task-status.json` is engine-owned **derived** run-state: seeded from the plan
(merge/upsert), completion derived from **task-ID-stamped git commits** (the operator-chosen evidence
bar). The build agent implements + commits + stamps ids; it is never the authority on completion.

The following are **binding constraints** (each maps to a story):

- **H1 — Seed is merge/upsert by id**, preserving existing `status`/`in_progress`/rework counts;
  never a blind overwrite. This is also the in-flight migration path. *(Fable amendment: "preserve"
  applies only to engine-stamped rows — see H6/H8; a bare agent-written `completed` row is never
  preserved into authority.)*
- **H2 — The `Task: <id>` trailer is enforced at BOTH layers that touch commits:** the `/tdd`
  commit checklist gains the trailer as a gate (the TDD subagent is what actually runs `git commit`)
  AND the `/pipeline` per-task dispatch template injects the task id. A plan-path fallback applies;
  a task that cannot be evidenced after N attempts **parks, never loops**.
- **H3 — Remediation tasks carry deterministic gap/FR-derived ids** → idempotent upsert into the
  plan, under the H9 grammar rules.
- **H4 — Single-authority migration:** the engine is the sole authority on completion. The write
  partition is **field-level**, not file-level: the agent retains only advisory *scheduling* writes
  (`pending`/`in_progress` — the user-exit contract and dependency ordering genuinely consume
  them); `completed`/`skipped` are engine-only. The `post-commit-pipeline-sync.sh` PostToolUse hook
  (today: blindly completes the first pending task on any `git commit`, wired by `bin/install`) is
  **removed/no-oped** in the same change; `finish` SKILL.md drops its task-status write; the two
  writers never coexist authoritatively.

Fable-round additions (2026-07-05), equally binding:

- **H5 — Evidence contract is trailer-first:** canonical evidence is the `Task: <id>` git
  **trailer** in the commit *body*; derive reads trailers (`git log --format` with
  `%(trailers:key=Task,valueonly)` or `%B`) — the current subject-only scan
  (`listCommits` `%H%x09%s`) cannot see trailers and MUST be replaced. Legacy `T<id>`/`#<id>`
  subject heuristics are demoted to a migration-only fallback (never authoritative — `#<n>`
  collides with issue/PR refs). Multi-trailer commits evidence several ids; any one evidencing
  commit completes a multi-commit task; the trailer alone suffices for tasks with no plan files.
  Commit-less completions (`skipped`, pre-completed, side-effect-completed) get a **no-op evidence
  commit**: an empty commit carrying `Task: <id>` plus `Evidence: skipped <reason>` or
  `Evidence: satisfied-by <sha>`. Merge-base failure **fails closed** (empty evidence + logged
  anomaly — never the unbounded `HEAD -n 100` fallback); the commit range is anchored to the
  current plan (plan-ref commit) so stale same-id commits on a reused branch can't false-complete.
- **H6 — The gate never trusts file rows:** completion is **recomputed** from plan + git evidence
  (+ engine sidecar) on every gate evaluation; `task-status.json` is a derived cache for dashboards
  and agent scheduling. A `completed` counts only with an engine `evidencedBy` stamp or the H8
  migration grandfather. Durable engine state (evidence stamps, attempt counters, grandfather set)
  lives in an **engine-only sidecar** (e.g. `.pipeline/task-evidence.json`) the agent never writes —
  so an agent wholesale rewrite of `task-status.json` destroys nothing authoritative, closing both
  the wipe AND the agent-asserted false-complete. `buildRetryHint`'s current "update
  .pipeline/task-status.json yourself" instruction is **rewritten** to "commit with the
  `Task: <id>` trailer."
- **H7 — Derive cadence + durable park counter:** seed+derive is one idempotent engine operation
  run at build entry AND before **every** completion-gate evaluation AND before the stall-breaker's
  resolved-count read (the `autoHealAttempted` once-per-run guard is removed for build — a
  once-per-run derive breaks both the loop fix and the stall/forward-progress signal). The
  no-evidence attempt counter persists in the engine sidecar and resets on any completed-count
  increase, so the park fires **across daemon re-kicks** (all current counters are per-run
  in-memory — without this the infinite loop survives). This counter is also #280's
  forward-progress delta.
- **H8 — Migration grandfather + engine plan resolution:** *(the migration-grandfather portion of
  this hypothesis is SUPERSEDED by `adr-2026-07-10-retire-migration-grandfather` — the first-seed
  stamp proved to be a forgery vector (#463) once the migration window closed; engine plan
  resolution and never-demote for evidence-stamped rows remain authoritative)* at first engine seed, existing terminal
  rows are stamped `evidencedBy: migration-grandfather` (their pre-cutover commits carry no
  trailers); thereafter only engine-stamped rows are preserved/counted. **Never-demote** is an
  explicit constraint: derive never flips an evidenced `completed` back to `pending`; post-completion
  evidence loss (e.g. a rebase dropping a commit) is a stated **non-goal** caught by tests/finish
  verification, not by demotion. The engine records the active plan path at plan-step completion
  (from the existing plan snapshot); agent-written plan refs (`plan_ref`, `.pipeline/plan-ref.md`)
  are never load-bearing.
- **H9 — Remediation id grammar:** the plan grammar, `parsePlanTaskPaths`/`expandTaskIds`, and the
  `/plan` + `/remediate` templates must **agree on one id form** — today the parser accepts only
  numeric `Task <n>` headers (and silently drops dotted ids), so H3's string ids (`rem-fr10-1`)
  would be structurally unevidenceable and every remediation round would park. Either extend the
  parser + matcher to `[A-Za-z0-9._-]+` ids or bind remediation determinism to an annotation on
  next-numeric ids — one choice, applied everywhere. Upsert never mutates a `completed` row
  (same-id/different-content gets an ordinal or content-hash suffix); derived ids carry their gate
  source; a non-empty deterministic id is a **validated** requirement of the plan-append, not a
  convention.

Operator-approved addition (2026-07-05, post-landing amendment):

- **Fast-feedback derive on commit (advisory):** the removed `post-commit-pipeline-sync.sh` hook's
  PostToolUse slot is reused for an **engine-invoking** hook: after each `git commit` it runs the
  engine derive and, when the new commit evidences no task (no `Task:` trailer match, no path
  fallback), emits a warning into the agent's feedback — so trailer mistakes surface at commit
  time, not at gate time. Strictly advisory and engine-executed: the hook never writes status
  itself (derive does, as engine code — no H4/H6 violation), a hook failure is non-fatal, and the
  per-gate derive (H7) remains the sole authority. This does not weaken the writer audit: the only
  writer the hook touches is the engine's own derive path.

Carried over from the Opus round:

- **Empty-is-done removed:** an empty/missing task list is a seed-and-run (or park) state, never a
  completion. `buildRetryHint` gains explicit `'no tasks'`/`'missing'` cases; the hint text directs
  at the *plan* ("no parseable tasks — fix `.docs/plans/…`"), never "create task-status entries."
- **No false-positive on a fresh build:** evidence = commits on the worktree branch since merge-base;
  0 commits = genuinely fresh, behavior unchanged (fail-closed per H5 when merge-base is unresolvable).
- **#115 retained** (retryReason context is additive); **park reconciled with #280**, not parallel.
  The auto-park marker carries **distinct auto provenance** (never "parked by operator"), is
  dashboard-surfaced, and emits a logged event so the halt-monitor sees it; the park is
  daemon-layer — interactive runs keep the existing stall-REPL/recovery path.

## Consequences

- The completion gate stops trusting an agent-maintained artifact; the daemon can no longer loop on an
  empty task list, completed work can no longer be silently destroyed, and an agent-asserted
  `completed` can no longer be laundered into a false-green ship (H6).
- `/pipeline`, `/tdd`, `/remediate`, and `finish` SKILL.md contracts change, and the
  `post-commit-pipeline-sync.sh` hook is removed; the harness integrity suite and `src/conductor`
  vitest specs must cover the new engine ownership, the trailer-first evidence contract (H5), the
  per-gate derive cadence + durable counters (H7), idempotent remediation under the id grammar (H9),
  the migration grandfather (H8), and the survivable park.
- Follow-up coordination with #280 is required for the shared park/forward-progress surface; this ADR
  scopes the park as the empty/no-evidence trigger of that mechanism, not a competing one.
