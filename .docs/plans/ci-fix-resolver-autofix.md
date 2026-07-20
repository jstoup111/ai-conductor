# Implementation Plan: ci-fix-resolver-autofix

**Status: Accepted**
**Track:** Technical · **Tier:** Medium
**Source:** intake jstoup111/ai-conductor#666
**ADRs:** ADR-0001 (StepRunner dispatch), ADR-0002 (preflight + error classification)

Goal: the daemon's ci-fix resolver runs a real fix attempt through the proven StepRunner path,
surfaces classified/diagnosable errors, and validates its fix-invocation surface once at
startup — with the existing worktree/guard/suite/lease-push pipeline preserved and the
underlying red-CI cause explicitly out of scope.

## Key files (verified)

- `src/conductor/src/engine/ci-fix.ts` — `productionCiFixRunner` (264-268), `runCiFix` (306-415),
  error boundary (413).
- `src/conductor/src/engine/step-runners.ts` — `DefaultStepRunner` (285), `resolveSetupFailure`
  (697) [pattern to mirror].
- `src/conductor/src/daemon-cli.ts` — ci-fix dispatch (1469), error swallow (1486); startup wiring.
- `src/conductor/src/engine/preflight.ts` / `self-host/build-auth-preflight.ts` — preflight precedents.
- Tests: `src/conductor/test/engine/ci-fix.test.ts`, `test/daemon-cli-ci-fix-wiring.test.ts`,
  `test/integration/mergeable-sweep-ci-fix.test.ts`.

---

## Task Dependency Graph

```
T1 ─┬─> T2 ──> T3 ──> T4 ─┬─> T9 ──> T10
    │                     │
T5 ─┴─> T6 ──> T7 ────────┘
                    T8 ──> T9
T11 (docs) depends on T10
```

---

## Tasks

### T1 — RED: dispatcher unit test for `resolveCiFailure`
**Dependencies:** none
Add a failing test asserting `DefaultStepRunner.resolveCiFailure(ctx)` invokes
`modelAvailability.invokeWithLadder` once with `resume:false`, `dangerouslySkipPermissions:true`,
cwd = `ctx.worktreePath`, and a prompt containing the CI hint. (Mirror the `resolveSetupFailure`
test setup.)

### T2 — GREEN: implement `resolveCiFailure` on `DefaultStepRunner`
**Dependencies:** T1
Add `resolveCiFailure(ctx: { worktreePath; prUrl; hint; slug })` mirroring `resolveSetupFailure`
(step-runners.ts:697): fresh uuid, one-shot, `invokeWithLadder`, CI-failure system prompt +
hint prompt, cwd = worktree. Return an attempted/outcome marker.

### T3 — RED: production runner no longer references `--fix-session`
**Dependencies:** T2
Add a test (CF-3) asserting no production code path builds `--fix-session`, and a test (CF-1)
that `productionCiFixRunner.run` delegates to the StepRunner dispatcher seam (via a fake).

### T4 — GREEN: rewire `productionCiFixRunner` to the StepRunner dispatcher
**Dependencies:** T3
Replace the `execa('claude', ['--fix-session', …])` body (ci-fix.ts:264-268) with a call into
the injected StepRunner-backed dispatcher. Preserve the `CiFixRunner` interface and the
`AI_CONDUCTOR_NO_REAL_EXEC` short-circuit (CF-2 no-op still honored).

### T5 — RED: error-classification unit tests
**Dependencies:** none
Test (CF-4) that a spawn failure maps to `flag-invalid` / `auth` / `spawn-env` / `unknown` and
logs class + message — asserting the bare `ExecaError` string is not the sole output.

### T6 — GREEN: classify resolver errors
**Dependencies:** T5
Add a `classifyFixError(err)` helper; apply it at the resolver error boundary (ci-fix.ts:413)
and the dispatch catch (daemon-cli.ts:1486). Log the classified line; preserve rethrow/return
semantics the callers expect.

### T7 — GREEN: kill-switch + no-op regression coverage
**Dependencies:** T6
Ensure `AI_CONDUCTOR_NO_REAL_EXEC` short-circuits the new path (test), and CF-2 (non-`changed`
outcome skips guards/suite/push) holds against the rewired runner.

### T8 — RED: preflight tests (pass + fail-loud)
**Dependencies:** none
Test (CF-5/CF-6) a `ciFixPreflight()` that probes the fix-invocation surface once: valid →
`{ ok: true }`; invalid → `{ ok: false, reason }` with a classified reason; and that a false
result disables ci-fix without crashing the daemon.

### T9 — GREEN: implement + wire ci-fix startup preflight
**Dependencies:** T4, T7, T8
Add `ciFixPreflight` (alongside preflight.ts precedents): cheap capability/dry probe of the
`claude` fix-invocation surface (no model round-trip). Wire it into daemon startup; on failure
log once and set a disabled-ci-fix flag the sweep dispatch reads (single consistent read).

### T10 — Full suite + integrity
**Dependencies:** T9
Run `src/conductor` test suite (unit + `mergeable-sweep-ci-fix` integration) and
`test/test_harness_integrity.sh`. All green. Confirm CF-7: no diffs to plan-discovery /
task-seed / remediate-planner modules.

### T11 — Docs + changelog
**Dependencies:** T10
Update `src/conductor/README.md` (ci-fix resolver now dispatches via StepRunner + startup
preflight behavior) and add a `## [Unreleased] → Fixed` entry in `CHANGELOG.md`
("ci-fix resolver no longer invokes the nonexistent `claude --fix-session` flag; dispatches a
real fix via StepRunner, classifies spawn errors, and validates invocation at daemon startup").
Internal-daemon change with no consumer CLI/hook/schema surface → assess migration-gate:
if the self-host release gate flags a breaking surface, commit a `.docs/release-waivers/`
waiver (internal-only rationale) per CLAUDE.md; otherwise no migration block.

---

## Out of scope (do NOT touch)

- The underlying `conductor` CI red cause: `Ambiguous plan discovery: multiple plans found`,
  `remediate planner crashed`, possible #573 flakiness (CF-7 / ADR-0002 non-goals).
- Mergeable-sweep eligibility gates and the guard/suite/lease-push pipeline internals.

## Verification (maps to stories)

- CF-1/CF-2 → T1–T4, T7 · CF-3 → T3/T4 · CF-4 → T5/T6 · CF-5/CF-6 → T8/T9 · CF-7 → T10.
