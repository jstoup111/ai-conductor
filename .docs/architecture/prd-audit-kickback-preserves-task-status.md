# Architecture: prd-audit kickback preserves task-status.json

**Last updated:** 2026-07-05
**Scope:** The daemon `prd_audit → build` kickback path and the `build` completion gate, plus the
`task-status.json` lifecycle they share. Modification to existing internal engine machinery — not a
new system. Consumed by `/architecture-review` to lock the fix mechanism.
**Source:** jstoup111/ai-conductor#302. Stories: `.docs/stories/prd-audit-kickback-preserves-task-status.md`.

---

## Today — the wipe-and-loop (bug)

```mermaid
graph TD
    subgraph engine["conductor engine (existing)"]
        prdaudit["prd_audit handler<br/>conductor.ts 1444-1538"]
        hint["buildRemediationHint()<br/>conductor.ts 2633-2649 (prompt-only)"]
        seed["pendingRetryHints.set('build', hint)<br/>conductor.ts 1472 / 1520-1529"]
        navback["navigateBack(state,'build')"]
        buildstep["build step run<br/>step-runners.ts (runs /pipeline)"]
        gate["build completion predicate<br/>artifacts.ts 376-417"]
        rekick["daemon re-kick sweep<br/>daemon-rekick.ts 90-190 (clears HALT)"]
    end

    subgraph files[".pipeline state"]
        tsj["task-status.json<br/>(sole writer today: /pipeline agent)"]
        plog["progress.log<br/>(read by no TS today)"]
        rem["remediation.json<br/>(informational only)"]
    end

    prdaudit --> hint --> seed --> navback --> buildstep
    buildstep -.->|"agent rewrites wholesale → emptied"| tsj
    buildstep --> gate
    gate -.->|"tasks length 0 → 'no tasks' → done:false FOREVER"| rekick
    rekick -->|"re-dispatch identical failure"| buildstep
    rem -.->|"never merged"| tsj
```

The remediation tasks reach the build agent only as **prompt text**; nothing in the engine writes
them into `task-status.json`. The agent is the sole writer and can rewrite the file wholesale
(emptying prior completed rows). An empty `tasks: []` makes the gate return `'no tasks'`
permanently, and the re-kick sweep re-dispatches the identical failure — the infinite loop.

## Fix — invert ownership: the engine owns task-status.json, derived from plan + git

The build agent stops being the authority on completion. The engine **seeds** `task-status.json`
from the plan (merge, never overwrite), the agent only **implements + commits with a task-ID
trailer**, and the engine **derives** completion by matching those commits (promoting `autoheal`).
A wipe is structurally impossible — the agent can't erase what it does not own — and it works for
any build skill, not just `/pipeline`.

```mermaid
graph TD
    subgraph engineNew["conductor engine (sole authority)"]
        seedstep["seedTaskStatus()<br/>at build entry: upsert plan tasks by ID,<br/>preserve status + rework counts (MERGE, never overwrite)"]
        buildstep2["build step run (/pipeline)<br/>agent implements + commits<br/>with 'Task: id' trailer; does NOT author status"]
        derive["deriveCompletion() (autoheal promoted)<br/>mark task completed when a commit<br/>trailers its id AND touches its plan files"]
        gate2["build completion predicate<br/>done = every plan task completed/skipped"]
        park["survivable park (last resort)<br/>plan has tasks but no evidence after N attempts,<br/>or empty/missing plan → .daemon/parked with<br/>auto provenance + dashboard surface (NOT looping)"]
        rekick2["daemon re-kick sweep<br/>skips parked slugs (isOperatorParked)"]
    end

    subgraph prdaudit2["prd_audit kickback"]
        remext["/remediate EXTENDS THE PLAN<br/>deterministic ids (gap/FR-derived) → idempotent upsert"]
        hint["retryReason hint retained (#115 unchanged)"]
    end

    subgraph files2[".pipeline state (engine-owned)"]
        plan["plan file (source of truth)<br/>via plan-ref.md"]
        tsj2["task-status.json (derived cache)"]
        git["git commits on worktree branch<br/>(Task: id trailers)"]
    end

    plan --> seedstep --> tsj2
    seedstep --> buildstep2 --> git
    git --> derive --> tsj2
    derive --> gate2
    gate2 -->|"all tasks evidenced → finish"| rekick2
    gate2 -.->|"no evidence after N / empty plan"| park
    park -.->|"survives re-kick"| rekick2
    remext -->|"append remediation tasks"| plan
    remext --> hint
    hint --> buildstep2
```

## Key seams

- **Seed (merge, never overwrite):** new engine step at build entry reads the plan via
  `readPlanPaths(projectRoot, planRef)` (`autoheal.ts:208`) and upserts one entry per plan task by
  **id**, preserving any existing `status`/`in_progress`/rework-count rows. This is the migration-safe
  path for in-flight features whose `task-status.json` the agent already wrote.
- **Derive (authoritative autoheal):** promote `attemptAutoHeal` (`autoheal.ts:58-104`) from a
  best-effort rescue to *the* completion source. The evidence read is **trailer-first** (ADR H5): the
  `Task: <id>` trailer lives in the commit *body*, so `listCommits` must read trailers/full messages,
  not subjects; legacy `T<id>`/`#<id>` subject forms are migration-only fallback. Runs at build entry
  and before **every** gate evaluation (once-per-run guard removed, ADR H7); range anchored to the
  current plan, fail-closed on merge-base failure. Completion is recomputed each evaluation — the
  gate never trusts file rows (ADR H6); durable engine state (evidence stamps, attempt counters)
  lives in an engine-only sidecar the agent never writes.
- **Agent contract change:** the trailer lands at BOTH layers (ADR H2): `/tdd`'s commit checklist
  (the subagent that actually commits) gains the `Task: <id>` trailer gate, and `/pipeline`'s
  dispatch template injects the id. The write partition is **field-level** (ADR H4/H6): the agent
  keeps advisory scheduling writes (`pending`/`in_progress` — the user-exit contract consumes them);
  `completed`/`skipped` are engine-only, and commit-less completions use a no-op evidence commit
  (`Evidence: skipped <reason>` / `satisfied-by <sha>`). The `post-commit-pipeline-sync.sh` hook and
  `finish`'s task-status write are removed. The Entry Guard's `all([]) === true` "empty = done"
  semantics is removed — an empty list is a seed-and-run state, never completion.
- **Remediation extends the plan:** `/remediate` SKILL.md — emit remediation tasks **into the plan**
  with deterministic, gap/FR-derived ids so re-runs upsert (idempotent) rather than duplicate. The
  engine re-seeds and re-derives; already-done tasks re-mark complete from their id-stamped commits.
- **Survivable park (last resort):** when the plan has tasks but no evidence accrues after N attempts,
  or the plan is empty/missing, write a park marker (`park-marker.ts` family) the re-kick sweep skips
  (`daemon-rekick.ts` `isOperatorParked`) — with a **distinct auto-park provenance** (not "parked by
  operator") and a dashboard/halt-monitor surface, reconciled with #280. This replaces the infinite
  auto-re-kick with a visible, actionable stop.
