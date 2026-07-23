# Conflict Check — Per-feature token accounting (#537)

Checked the 6 stories against each other and against the existing system for contradictions,
overlaps, shared-state conflicts, and resource contention.

## Inter-story: clean

Stories form a linear producer→consumer chain (1 capture → 2 emit → 3 rollup → {4 kpi, 5 retro, 6
otel}). No two stories write the same field with different semantics. `unmetered` is defined once
(Story 1/2 produce it, Story 3 aggregates it, Story 4/5 surface it) — consistent throughout.

## System conflicts & how each is resolved

1. **Output-format change vs. existing text consumers (real, managed).**
   `invoke()` today returns raw stdout as `InvokeResult.output`; several callers consume it as text
   (`step-runners.ts` tail, report tails). Switching to `--output-format json` changes stdout shape.
   *Resolution:* source `output` from `.result` so callers see unchanged text (Story 1 negative path
   pins this). Scope the change to the autonomous `invoke()` only; leave `invokeInteractive()` as-is.
   **Not a blocker** — bounded, with an acceptance spec guarding it.

2. **Shipped-record schema vs. daemon dedup (real, managed).**
   `daemon-backlog.ts` dedups shipped features by the record's frontmatter (`slug`, `spec_hash`,
   `pr`, `shipped`). Adding cost data must not perturb those keys.
   *Resolution:* add the Cost data as a **new, additive** block that leaves existing frontmatter keys
   byte-stable; `writeShippedRecord` appends, never rewrites, the dedup keys. Plan includes a
   regression check that dedup still matches after the Cost block exists.

3. **Concurrent workers & the shared event bus (considered, no conflict).**
   The daemon's in-memory event bus carries no feature slug (daemon-cli.ts:738-740), so under
   concurrency>1 the *log* stream interleaves. This feature deliberately reads the **per-worktree**
   `.pipeline/events.jsonl` (one per feature), which does not interleave. *No shared-state contention*
   — the rollup never reads the shared stream.

4. **`conduct kpi` command name (verify at plan/RED).**
   New read-only subcommand. Must not collide with an existing subcommand. *Resolution:* plan Task 0
   greps `cli.ts` for an existing `kpi`/`cost` command before registering; pick a free name if taken.

5. **OTel counter double-count (considered, no conflict).**
   Feeding `conductor.step.tokens` from the same event that drives the rollup does not double-count:
   OTel and the committed rollup are independent consumers of one event, not two emit sites.

## Verdict

No contradictions between stories. Three managed system conflicts (1, 2, 4), each with a concrete
resolution and a guarding check in the plan. Clear to plan.

Status: Accepted
