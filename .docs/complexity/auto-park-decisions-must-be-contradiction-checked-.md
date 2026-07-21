# Complexity: Contradiction-check auto-park against completion evidence (#612)

Tier: S

## Root cause context (verified, file:line)

On 2026-07-13T03:28Z the feature `2026-07-12-rtk-hook-preservation` completed its
build (worktree `.pipeline/summary.json`: `tasks_total: 5, tasks_completed: 5`,
real commit SHAs f28e2d26..8485b161) and was then auto-parked with reason
`empty/missing plan`. The false "no tasks in plan" gate signal is a parser bug
tracked separately as #578 (fix in flight). THIS spec addresses the decision
point that accepted the signal unchecked:

- `src/conductor/src/engine/conductor.ts:2193-2225` — the daemon-gated
  `checkAndAutoPark` block derives `emptyPlan` purely from the gate reason
  string (`:2196-2200`: `!parkCtx.planPath || gateReason.includes('plan is
  empty' | 'no tasks in plan' | 'plan file not found')`) and passes it as an
  immediate-park `reason` with NO cross-check against completion evidence the
  engine already holds at that exact point:
  - `resolvedTasksAfter` (`conductor.ts:2147`, from `countResolvedTasks` /
    `task-status.json`) — already computed in scope;
  - `this.taskEvidence.evidenceStamps` (in memory, engine-owned sidecar,
    `task-evidence.ts:40`);
  - `.pipeline/summary.json` `tasks_completed` (session-authored by the
    pipeline skill; in the incident this was the ONLY non-empty signal — the
    sidecars were empty because the same #578 parser fed them).
- `src/conductor/src/engine/daemon-auto-park.ts:48-56` — an explicit `reason`
  bypasses the durable no-evidence counter entirely, so the park is immediate
  and terminal for the run.

Sibling precedent: #569 (stall auto-remediation only fires for `halt_marker`
stalls — other bail paths bypass remediation the same way).

## Why Tier S

- One decision point (`conductor.ts:2193-2225`) gains a deterministic
  contradiction guard; one small tolerant reader for `summary.json`
  `tasks_completed` (session-authored file — corrupt/missing parses to 0, never
  throws) lives beside `checkAndAutoPark` in `daemon-auto-park.ts`.
- On contradiction the guard only STRIPS the immediate `empty/missing plan`
  reason (falls back to the existing counter semantics at
  `daemon-auto-park.ts:51-55`) and emits one loud new event — no new state
  machine, no config knob, no schema/CLI/hook surface, no ADR-worthy decision.
- One additive member in the `ConductorEvent` union (`src/conductor/src/types/
  events.ts`, pattern: `auto_park` at `:205-210`) plus its log rendering.
- Test surface is local: `test/engine/daemon-auto-park` / the existing
  `conductor-auth-park.test.ts` integration seams. ~40-60 lines of production
  change + focused tests.

Not M: no multi-site coordination, no re-kick/rekickSweep changes, no config
validation, no interaction changes to the zero-progress counter park (that path
is explicitly preserved). Not a redesign of parking or remediation routing.

## Scope guard (STOP conditions — none triggered)

- NOT fixing the parser false signal itself — that is #578 (complementary,
  in flight). This guard makes the decision point safe against ANY false
  empty-plan signal, from #578's parser or a future one.
- NOT generalizing remediation routing for all bail paths — that is #569's
  scope. The minimal refusal here re-enters the existing retry/stall path.
- NOT touching the `no completion evidence after N attempts` counter park:
  zero-progress builds must keep parking exactly as today (negative-path
  story pins this).
- If review finds the guard needs a shared completion-evidence seam across
  gates, that is a larger decision — escalate rather than expand here.
