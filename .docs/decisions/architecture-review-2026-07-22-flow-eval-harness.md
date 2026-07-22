# Architecture Review: Flow-Level Eval Harness (#786)

**Date:** 2026-07-22
**Tier:** L (full review)
**Stories reviewed:** flow-eval-harness (framework, scripted provider, sandbox, per-flow drivers, tier mapping, matrix runner + report, injected-break proof, docs)
**Verdict:** APPROVED

## Feasibility

All required seams already exist and are proven by existing tests — this is composition, not new
runtime plumbing:

- **Provider injection is a registry lookup by name.** `index.ts` and `daemon-cli.ts:746` both
  resolve the provider via `registry.get('llm_provider', config?.llm_provider ?? 'claude')`, and
  `plugin-loader.ts` registers providers by name. A `ScriptedProvider` registered as
  `llm_provider:scripted` and selected via config is a supported, existing extension point.
  Confidence: **95%** (verified: registration + selection sites read directly).
- **Real StepRunner over a canned provider is proven.** `test/integration/recorder-provider-flow.test.ts`
  already runs the real step runner over a canned `LLMProvider` (`RecorderProvider`). Confidence: **90%**.
- **Sandbox recipe exists.** `test/integration/daemon-ship.integration.test.ts` builds a throwaway
  `git init` repo with `writeSpec(slug)` (stories+plan, `Status: Accepted`) and drives shipped-record;
  `test/acceptance/engineer.test.ts`'s `initRepo` adds a fake origin for PR/default-branch machinery.
  State/registry isolation is env-based (`AI_CONDUCTOR_REGISTRY`, `AI_CONDUCTOR_ENGINEER_DIR`,
  `AI_CONDUCTOR_NO_REAL_EXEC`). Confidence: **95%**.
- **Tier skipping is real and observable.** `selector.ts` treats a step as skipped when
  `state.complexity_tier` is in `step.skippableForTiers`; `full-flow.test.ts` already asserts S vs L
  changes the executed step set. Confidence: **95%**.

**Assumption surfaced (load-bearing):** a `ScriptedProvider` must produce enough *real side effects*
per step (write the expected `.docs/` artifact, commit with a `Task:`/evidence trailer) for the
downstream deterministic gates (evidence gate, stories-approved, tier-vs-artifact, shipped-record)
to pass — a bare canned string is insufficient for flows that gate on artifacts. This is the core
engineering risk and is addressed by ADR-flow-eval-scripted-provider (scenario scripts carry the
artifact/commit actions, not just text). Verified against gate expectations in `land-spec.ts`
(stories `Status: Accepted`, tier parse) and the daemon `isVerifiedShip()` path.

**Interactive-flow boundary (surfaced, not blocking):** the interactive flow is a live TTY REPL
(`claude` without `-p`, `invokeInteractive`). It cannot be driven headlessly to a full completion
oracle the way the `-p`/autonomous flows can. Scoped to command-dispatch/wiring-level coverage with
the boundary documented (see ADR-flow-eval-scope-tiers and the plan). This is an explicit, accepted
scope limit, not an infeasibility.

## Complexity

High but bounded. No new state machine — the eval *drives* existing loops. The novelty is the
scripted-execution substrate and the sandbox lifecycle, both templated on existing tests.

## Alignment

- **Repo Design Principle ("deterministic where possible; LLM only where necessary").** The eval
  removes the LLM from the loop entirely and asserts orchestration deterministically — directly on
  principle. A live-LLM eval would violate it (non-deterministic, token-burning, CI-flaky).
- **Operator-safety rules (CLAUDE.md #497/#681/#438).** The eval must NEVER touch the real registry,
  real worktrees, or the real daemon. Enforced by per-scenario `mkdtemp` sandboxes + env isolation +
  `AI_CONDUCTOR_NO_REAL_EXEC`; the sandbox never registers a real project and never launches the real
  tmux daemon (`AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH` posture, as the engineer suite already uses).
- **Worktree isolation.** Each scenario is a disjoint tmpdir; two scenarios cannot contend on port,
  DB, branch, or path. Matches the review checklist's worktree-isolation requirement.

## Domain Integrity

- Represent a scenario as a `flow × tier` value object, not loose strings — `FlowName` and reuse of
  the existing `ComplexityTier` union (no re-inventing S/M/L). Pass/fail is a discriminated result
  (`{ status: 'pass' } | { status: 'fail'; reason }`), not a boolean, so the captured reason is
  unrepresentable-away.
- No catch-all `default` on flow dispatch — exhaustive over the enumerated flow set.

## Wiring Surface (Medium/Large tier — where each new production surface is called from)

- **`ScriptedProvider` (`llm_provider:scripted`)** — registered in the plugin registry alongside the
  built-in `claude` provider; wired via `src/conductor/src/engine/plugin-loader.ts#registerBuiltins`
  (behind an eval/config guard so it never registers in normal operation) OR discovered as an eval-only
  plugin under `evals/`. Selected only when a sandbox config sets `llm_provider: scripted`.
- **`conduct-ts eval` subcommand** — wired into the CLI command detection chain in
  `src/conductor/src/index.ts` (a `detectEvalCommand` guard alongside the other `detect*` guards) and
  declared in `src/conductor/src/cli.ts`. Dispatches to the eval runner.
- **`npm run eval` script** — added to `src/conductor/package.json` `scripts`, invoking the runner
  (the CI/nightly and local entry point).
- **Per-flow `FlowDriver`s + `SandboxRepo` + matrix runner** — internal to the `evals/` (or
  `test/eval/`) tree; consumed by the runner and by vitest-visible eval specs. Not production runtime
  surface (test/eval-only), so their reachability is the runner + vitest, not a production caller.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| ScriptedProvider under-produces side effects → downstream gate fails for the wrong reason (false negative) | Technical | Medium | High | Model per-step responses as *actions* (write artifact + commit with trailer); pin each flow's happy scenario to a known-green baseline first, then derive breaks from it |
| Eval couples to internal step/gate details and rots as they change | Knowledge | Medium | Medium | Drive flows through their public entry points (`Conductor.run`, `runDaemonMode`, `runEngineerMode`, `runIntakeLoop`) and assert public oracles, not internal step order |
| Real git/worktree in sandbox makes the suite slow → tempts skipping | Performance | Medium | Medium | Keep it out of the default `vitest run` PR gate; expose as `npm run eval` + `conduct-ts eval`, run on-demand/nightly (ADR-flow-eval-scope-tiers) |
| Sandbox leaks a real daemon/tmux or writes to the real registry | Data/Integration | Low | High | `AI_CONDUCTOR_NO_REAL_EXEC` + `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH` + env-scoped registry; `global-setup.ts`-style leak guard fails the suite on stray `.pipeline` |
| Interactive flow cannot reach a real completion oracle | Knowledge | High | Low | Explicitly scope interactive to wiring-level coverage; document the boundary (accepted) |

## ADRs Created

- `adr-2026-07-22-flow-eval-scripted-provider.md` — **APPROVED** — deterministic scripted-`LLMProvider`
  eval over the real orchestration (rejecting live-LLM and MockStepRunner-only).
- `adr-2026-07-22-flow-eval-tier-mapping-and-surface.md` — **APPROVED** — S/M/L map to
  `ComplexityTier`; eval lives in an `evals/` tree with a `conduct-ts eval` + `npm run eval` surface,
  run on-demand/nightly (not a per-PR blocking gate).

## Conditions

None blocking. One accepted scope limit: interactive flow is covered at wiring level only.
