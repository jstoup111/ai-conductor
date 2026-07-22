# Complexity: flow-eval-harness

Tier: L

## Signals

| Signal | Assessment |
|---|---|
| New runtime code | Substantial: a scripted `LLMProvider` eval plugin, a sandbox-repo builder, per-flow drivers with completion oracles, a matrix runner + reporter, and an injected-break regression proof |
| New entities / abstractions | `ScriptedProvider` (canned per-step `LLMProvider`), `SandboxRepo` (throwaway git repo + isolated registry/state env), `FlowDriver` (one per flow), `FlowScenario` (flow × tier), `EvalReport` (per-combination pass/fail) |
| External integrations | Real `git` (init/worktree/branch/commit) in throwaway repos; injected `gh` runner stub; NO live LLM, NO real network |
| Flows covered | 5 (inline, interactive, daemon, engineer, intake-loop) × 3 tiers (S/M/L) = up to 15 scenario combinations, plus a deliberately-broken proof |
| State machines | Reuses the conductor gate loop + daemon drain loop + tier step-skipping (`selector.ts`); the eval drives these, it does not add new ones |
| Estimated stories | ~9 (framework + per-flow drivers + tier mapping + injected-break + runner/report + docs) |
| Cross-module surface | Touches execution (provider seam), engine (step-runners/daemon/engineer/intake injection points), test/fixtures, a new `evals/` (or `test/eval/`) tree, plus a `conduct-ts` npm script and docs |

Majority of signals sit at Large: multi-flow end-to-end drivers, a new scripted-execution
substrate, real git/worktree orchestration in sandboxes, and a standing regression suite that
must catch orchestration-level wedges (worktree exit-128, `no_task_progress`, engineer land
failure) the current unit/acceptance tests miss.

## Rationale

The issue carried BOTH `size: M` and `size: L` labels (unresolved). Independent assessment lands
**Large**: this is not one script but a reusable eval *framework* (scripted provider + sandbox +
matrix runner + reporter) plus five per-flow drivers across three tiers plus a break-detection
proof. It exercises the real orchestration/git/worktree layer — where the stated failures live —
so it cannot be a thin CLI smoke test. Full architecture-review with APPROVED ADRs required.

## Scope discipline (first coherent slice)

To stay a shippable first slice (plan target < 20 tasks), the **framework is the core deliverable**
and every flow gets at least S/M/L committed example prompts, but per-flow driver depth is
prioritized by regression risk:

- **Full end-to-end drivers:** daemon, engineer, inline — these carry the stated live-run
  failures and exercise the deepest orchestration/git surface.
- **Lighter coverage:** intake-loop (already zero-token by design → routed+notified oracle) and
  interactive (a live TTY REPL — not headlessly automatable end-to-end; covered at
  command-dispatch/wiring level, with the boundary documented).
- Adding remaining flow×tier fixtures is a documented one-file pattern, not new framework work.
