# Architecture Review: prd-audit kickback preserves task-status.json

**Date:** 2026-07-05
**Reviewer:** two-round design pressure-test — round 1 under **Opus** (2026-07-05), round 2 the
operator-required re-validation under **Fable 5** (2026-07-05, session model confirmed): three
independent adversarial forks (evidence derivation; lifecycle/concurrency/migration; skill
contracts), findings verified against the code before adoption.
**Feature:** jstoup111/ai-conductor#302 — the `prd_audit → build` kickback wipes
`.pipeline/task-status.json`, producing an infinite auto-re-kick HALT loop.
**Outcome:** **APPROVED** — engine-owned, git-derived completion (decoupled from `/pipeline`).
The ownership inversion survived both rounds; the Fable round found the Opus-round constraint set
(H1–H4) under-specified and added five further binding constraints (H5–H9). Recorded as
`adr-2026-07-05-engine-owned-task-status.md` (Status: APPROVED).

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

Round 1 (Opus) pressure-test — the design survives, conditioned on four hardening properties that
are **must-specify** (each became a story):

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

## Fable re-validation (round 2, 2026-07-05)

Three independent Fable forks attacked the design on distinct lenses; every load-bearing claim
below was verified against the code (file:line) before adoption. **Verdict: SURVIVES** — no finding
restores the wipe-or-loop bug class or invalidates the ownership inversion — but H1–H4 as written
had five concrete post-ship failure modes. Each became a binding constraint (H5–H9 in the ADR):

| # | Fable attack (verified evidence) | Required property → ADR |
|---|---|---|
| F1 | The `Task: <id>` **trailer is invisible to the matcher**: `listCommits` reads subjects only (`--format=%H%x09%s`, `autoheal.ts:179`) and `matchSubject`'s `idRe` accepts only `T<id>`/`#<id>` forms (`autoheal.ts:320`) — a fully compliant agent produces **zero evidence**, every task strands, the feature parks with 100% of the work done (#302's symptom reborn). Also: `#<n>` collides with issue/PR refs (8 of the last 30 main commits), and the merge-base fallback (`HEAD -n 100`, `autoheal.ts:171-175`) scans trunk history → cross-feature false-completes. | **H5** — trailer-first evidence read from commit bodies; legacy subject heuristics migration-only; fail-closed merge-base; plan-anchored range. |
| F2 | **Agent-asserted false-complete laundered by H1's preserve rule**: the gate reads `status` rows directly (`artifacts.ts:407`), derive never audits an existing `completed`, and `buildRetryHint` *instructs* the agent to self-mark tasks completed (`conductor.ts:2669`). Seed preserves the forged row → false-green ship. A third unlisted writer makes it worse: the `post-commit-pipeline-sync.sh` PostToolUse hook blindly completes the **first** pending task on any `git commit` (wired by `bin/install:328`). | **H6** — gate recomputes from evidence every evaluation; engine-only sidecar for durable state; field-level write partition (agent keeps `pending`/`in_progress` scheduling only — the user-exit contract at `pipeline/SKILL.md` §exit consumes it); hook removed; retry hint rewritten. |
| F3 | **Loop fix defeated by cadence + volatile counters**: derive-as-autoheal runs once per `conductor.run()` (`autoHealAttempted`, `conductor.ts:878,1306-1308`), and every attempt/park counter today is per-run in-memory — a daemon re-kick spawns a fresh run, the N-attempts counter resets, **the park never fires and the infinite loop survives** in exactly the re-kick scenario the ADR targets. The stall breaker (`countResolvedTasks`) also loses its signal once the agent stops writing completions. | **H7** — per-gate-evaluation derive (drop the once-guard); durable no-evidence counter in the sidecar, reset on progress (doubles as #280's forward-progress delta); derive before the stall-count read. |
| F4 | **Commit-less completions strand**: the gate accepts `completed` OR `skipped`, and `/pipeline`'s pre-completion scan routinely marks tasks done as side effects of siblings — under evidence-required derive these have no `Task: <id>` commit and park after N attempts despite genuine completion (routine path, not exotic). In-flight migration has the same shape: pre-cutover commits carry no trailers. | **H5** (no-op evidence commit: `Task: <id>` + `Evidence: skipped <reason>`/`satisfied-by <sha>`) + **H8** (migration-grandfather stamp; explicit never-demote). |
| F5 | **H3's ids don't parse**: the plan grammar accepts only numeric `Task <n>` headers — `taskHeader` regex + `expandTaskIds` digits-only (`autoheal.ts:242,269-284`, dotted ids silently dropped) — so gap-derived ids like `rem-fr10-1` are structurally unevidenceable: **every remediation round ends in a park**, i.e. the bug survives on its primary path. Plus id-stable/content-drift re-rounds and cross-gate id collisions. | **H9** — one id grammar agreed across parser + `/plan` + `/remediate`; upsert never mutates a completed row; gate-source-prefixed, validated non-empty ids. |
| F6 | **H2 named the wrong skill**: commits are made by the `/tdd` subagent (commit checklist, `tdd/SKILL.md:122-133` — zero trailer mentions), and `/pipeline`'s dispatch context is deliberately scoped; changing only `/pipeline` means the committing agent never sees the requirement. `finish/SKILL.md:291` also writes the file. | **H2 amended** — trailer gate lands in `/tdd`'s checklist AND `/pipeline`'s dispatch template; `finish` write dropped (folded into H4/H6). |

Confirmed sound under attack: interactive (non-daemon) wiring (gate + derive run un-gated by
`this.daemon`; park stays daemon-layer, interactive keeps the stall-REPL), #115 retryReason
retention (`pendingRetryHints` plumbing untouched, new hint cases additive), auto-park marker
mechanics vs `rekickSweep`/`unpark` (existence-based checks work; distinct provenance + logged
event required so the park is visible — an invisible auto-park is the silent-strand failure
Option A was rejected for), and the never-demote trade-off (evidence loss post-completion is a
stated non-goal for tests/finish to catch, not demotion).

## Sequencing (feeds `/plan`)

1. **Slice 1 — loop-and-wipe elimination (self-contained, testable):** engine seed (merge/upsert) +
   authoritative git-derived completion with the trailer-first evidence contract (H1, H2, H5) +
   per-gate derive cadence and durable counters (H7) + gate recompute/sidecar + hook removal (H6) +
   remove the empty-is-done entry-guard semantics + `buildRetryHint` cases + migration grandfather
   (H8). This alone breaks the loop, the wipe, and the false-complete.
2. **Slice 2 — remediation-extends-plan** with deterministic ids under the agreed id grammar
   (H3, H9) + the single-authority migration cleanup across `/pipeline`/`/tdd`/`finish` (H4).
3. **Slice 3 — survivable auto-park** last-resort with distinct auto provenance, dashboard surface,
   and logged event, reconciled with #280.

## Decision

**APPROVED — Fable-validated.** `adr-2026-07-05-engine-owned-task-status.md` (Status: APPROVED)
records the ownership inversion and H1–H9 as binding constraints. Proceed to `/stories`,
`/conflict-check`, `/plan`.
