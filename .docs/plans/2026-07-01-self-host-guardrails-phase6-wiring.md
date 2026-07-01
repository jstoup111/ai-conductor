# Implementation Plan / Build Prompt: Self-Host Guardrails — Phase 6 (daemon-loop wiring)

**Date:** 2026-07-01
**Tier:** L (touches the daemon core — `conductor.run()`)
**Track:** Technical
**Depends on:** the Phase 0–5 guardrail primitives (PR #179 / branch
`spec/daemon-self-host-guardrails`). This branch is **stacked on** that one — merge #179 first,
then rebase this onto `main`.
**Design:** `.docs/specs/2026-06-30-harness-self-host-guardrails.md`
**Stories:** `.docs/stories/harness-self-host-guardrails.md` (TR-1..TR-13 — this PR closes the *wiring*
half of TR-1/4/5/7/8 and all of TR-12/TR-13).
**ADRs:** adr-2026-06-30-{self-host-detection-seam, sandbox-build-isolation, halt-based-release-gates}.

---

## Goal

Wire the six already-built, already-tested `src/conductor/src/engine/self-host/` modules into the
live daemon path so the guardrail bundle activates **as one unit** for a harness self-build — and for
**no other repo**. Every change is additive and gated behind a single `isSelfHost` boolean; the
normal-repo path must stay byte-for-byte unchanged (TR-13), proven by the full suite.

**Non-negotiable invariants:**
- The daemon never merges (ADR-005/ADR-010): the self-build finish path reaches a HALT, never a merge.
- No behavior change for any non-harness repo beyond one detector boolean on the hot path.
- Guaranteed sandbox teardown + daemon-env restore on every exit path (pass/fail/crash).

## Seam map (verified against the code — file:line at authoring time)

| Seam | Location | Use |
|------|----------|-----|
| Owner-gate classify precedent | `engine/daemon-backlog.ts:339` (`decideSpecGate` call) | Compute `isSelfHost` at the SAME discovery layer. |
| Owner resolve wiring | `engine/daemon-work-source.ts:81` + `daemon-cli.ts:381` | Inject a `resolveSelfHost` thunk the same way `resolveDaemonOwner` is injected. |
| Conductor daemon flag | `engine/conductor.ts` — `this.daemon` (ctor ~347), `this.mode` (~341) | Gate activation: `this.daemon && isSelfHost`. |
| Step dispatch (build) | `engine/conductor.ts:695` (`step.name === 'build'`) … `:702-709` dispatch | Provision sandbox + relink BEFORE the build step; teardown after. |
| Child env inheritance | `execution/claude-provider.ts:172` `buildEnv` returns `undefined` → child inherits `process.env` | Scope `CLAUDE_CONFIG_DIR` via `process.env` save/restore around the self-build (do NOT thread through InvokeOptions). |
| Finish PR opens INSIDE finish step | `step-runners.ts:610-639` (auto-mode finish prompt runs `gh pr create`) | Gates MUST run BEFORE dispatching the `finish` step, not after `conductor.ts:1199`. |
| HALT respected | `engine/conductor.ts:135` marker + `:1320` finally guard; `daemon-runner.ts:165-220` reads outcome | Writing `.pipeline/HALT` before finish → no PR, feature parks. |
| Merge audit | none — grep confirmed zero `gh pr merge` / merge-API calls | Keep it that way; add a structural test at the conductor seam. |

## Conventions
Test-first (RED → GREEN → refactor), 2–5 min tasks. New wiring code stays thin — the logic already
lives in the primitives; this PR only *calls* them behind the detector. `rtk proxy npx vitest run`.

---

## Phase 6.1 — Compute `isSelfHost` at discovery (TR-1/TR-2 live path)
- [ ] RED: a discovery-layer test drives `daemon-backlog`/`daemon-work-source` with a stub
      `resolveSelfHost` and asserts the resulting per-feature classification carries `isSelfHost`.
- [ ] GREEN: inject a `resolveSelfHost: () => classifySelfHost(detector, config, buildRepoRoot)` thunk
      at `daemon-cli.ts` (beside `resolveDaemonOwner`); thread the boolean to the Conductor via a new
      additive `ConductorOptions.selfHost?: boolean` (default `false`).
- [ ] RED: owner-gate eligibility is evaluated FIRST, then self-host classification (per conflict-check).

## Phase 6.2 — Relink + sandbox around the build step (TR-4/TR-5 live path)
- [ ] RED: for a self-build Conductor, `relinkSkillsForSelfBuild` is invoked before the `build` step;
      a relink `InstallStaleError` aborts the run before dispatch (no build).
- [ ] RED: for a self-build, `process.env.CLAUDE_CONFIG_DIR` is set to the sandbox dir DURING the build
      step and restored to its prior value (or unset) AFTER — assert no bleed on pass AND on throw.
- [ ] RED: non-self-build → no relink, no sandbox, `process.env` untouched (regression guard).
- [ ] GREEN: wrap the build-step region with `withSandboxBuildEnv` (provision → set env → run → finally
      teardown+restore). Provision once for the self-build run; teardown in the run's `finally`.
- [ ] RED: forced throw mid-build → teardown ran, env restored, `.pipeline/HALT` or failure surfaced.

## Phase 6.3 — Finish gates before the PR opens (TR-7/TR-8/9/10 live path)
- [ ] RED: for a self-build, BEFORE dispatching the `finish` step, `runVersionApprovalGate` then
      `runReleaseArtifactGate` run; any `!ok` → `.pipeline/HALT` written and the `finish` step is NOT
      dispatched (PR never opens). Use `this.daemon && this.selfHost` as the guard.
- [ ] RED: gates pass → finish proceeds normally.
- [ ] RED: non-self-build finish → gates never run (regression).
- [ ] GREEN: insert the pre-finish gate block in `conductor.run()` (guard region, before the
      `step.name === 'finish'` dispatch). Feed `changedFiles` from `git diff --name-status <base>...HEAD`.

## Phase 6.4 — Bundle-as-one-unit + non-autonomy structural (TR-12/TR-13)
- [ ] RED (structural): no `gh pr merge` / merge-API call is reachable from the self-build finish path
      at the conductor seam (extend the existing `test/engine/self-host/non-autonomy.test.ts` idea to
      the wired path).
- [ ] RED: an integration test drives a self-build Conductor end-to-end with a stub step runner and
      asserts the WHOLE bundle activates together (relink called, sandbox env set, gates run) — and
      that a stub detector returning `false` activates NONE of it.
- [ ] GREEN: final wiring; confirm activation is a single `isSelfHost` decision.

## Phase 6.5 — Regression sweep
- [ ] Run the FULL conductor suite; assert zero regression (2632+ green at authoring time).
- [ ] Confirm `test/test_harness_integrity.sh` stays 0-failed and `tsc --noEmit` is clean.
- [ ] [[feedback_orphaned_primitives]]: grep that the live path actually calls each primitive (no
      superseded/dead call sites) — the primitives must be WIRED, not merely present.

## Docs (same PR)
- [ ] Flip the "not yet wired" notes in `README.md` + `src/conductor/README.md` to "active for
      self-builds"; document the `process.env.CLAUDE_CONFIG_DIR` scoping + the pre-finish gate order.
- [ ] `CHANGELOG.md` `[Unreleased]`: entry for the wiring; `## Migration` only if a breaking surface
      changed (this is additive → likely none).
- [ ] VERSION: present the bump for approval (stays on 0.99.x per the pre-1.0 pin; CI auto-patches).

## Ready-to-run prompt (paste to drive this PR)
> Build Phase 6 of the harness self-host guardrails on branch `spec/self-host-phase6-wiring` (stacked
> on the Phase 0–5 primitives). Follow `.docs/plans/2026-07-01-self-host-guardrails-phase6-wiring.md`
> test-first, phase by phase, committing per phase and running the full conductor suite + integrity
> suite at each boundary. Keep every change additive and gated behind `isSelfHost` so the normal-repo
> path is byte-for-byte unchanged. Do NOT let the daemon merge. Pause at the safety-critical sandbox
> env-lifecycle wiring (6.2) for review before proceeding.
