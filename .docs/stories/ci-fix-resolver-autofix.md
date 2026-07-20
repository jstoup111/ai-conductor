# Stories: ci-fix-resolver-autofix

**Status: Accepted**
**Track:** Technical
**Source:** intake jstoup111/ai-conductor#666

Acceptance is expressed at the daemon/resolver seam. "The resolver" = `runCiFix` +
`productionCiFixRunner` in `src/conductor/src/engine/ci-fix.ts`; "the dispatcher" =
`DefaultStepRunner.resolveCiFailure`. Tests inject fakes for the runner/provider — no real
`claude` spawn in the suite.

---

## CF-1 (happy): resolver dispatches a real fix through the StepRunner path

**Given** an eligible red shipped PR with a live branch and a computed CI-fix hint
**And** the fix-invocation preflight passed at startup
**When** `runCiFix` executes inside its isolated resolver worktree
**Then** it invokes the StepRunner-backed dispatcher (`resolveCiFailure`) — never
`claude --fix-session`
**And** the dispatch runs a one-shot headless session (`resume:false`,
`dangerouslySkipPermissions`, cwd = resolver worktree) carrying the CI-failure hint
**And** on a `changed` outcome the existing acceptance-guard → suite-gate → lease-push
pipeline runs unchanged before publishing.

## CF-2 (happy): no-op fix leaves the branch untouched, no false green

**Given** the dispatcher runs but produces no worktree changes
**When** `runCiFix` evaluates the outcome
**Then** it returns a non-`changed` outcome
**And** it does NOT run acceptance guards, the suite gate, or a push
**And** the daemon does not report `green-verified` for that PR.

## CF-3 (negative): the fictional `--fix-session` flag is gone

**Given** the production runner
**When** the resolver dispatches a fix
**Then** no code path constructs the argument `--fix-session`
**And** a repository search for `--fix-session` in `src/` returns no production reference
(guarding against regression to the crashing invocation).

## CF-4 (negative): resolver spawn failure surfaces a classified, diagnosable error

**Given** the fix dispatch fails at the spawn/exec layer
**When** the resolver handles the failure
**Then** the logged reason names a class — `flag-invalid`, `auth`, `spawn-env`, or `unknown` —
plus the underlying message
**And** it is NOT a bare `ExecaError: Command failed with exit code 1` with no classification
**And** the failure does not silently vanish (the outcome/log is observable to the operator).

## CF-5 (happy): startup preflight validates fix-invocation once and serves ci-fix

**Given** a daemon starting on a host where the `claude` fix-invocation surface is valid
**When** the ci-fix preflight runs at startup
**Then** it probes the invocation surface exactly once (a cheap capability/dry probe, no model
round-trip)
**And** on success the daemon serves ci-fix normally
**And** the probe is not repeated per-PR.

## CF-6 (negative): startup preflight fails loud once and disables ci-fix

**Given** a daemon starting where the fix-invocation surface is invalid (e.g. binary missing,
or the headless invocation is rejected at arg-parse)
**When** the ci-fix preflight runs
**Then** it logs a single classified failure reason
**And** ci-fix is disabled for the run (the daemon does not emit an identical per-PR crash)
**And** the rest of the daemon (build loop, mergeable sweep for non-ci-fix work) continues.

## CF-7 (guard): out-of-scope red-CI cause is not touched

**Given** the underlying `conductor` CI failure signatures (`Ambiguous plan discovery:
multiple plans found`, `remediate planner crashed`)
**When** this change ships
**Then** it makes the resolver run and report against such PRs
**And** it does NOT modify plan-discovery, task-seed, or remediate-planner logic (that cause is
deferred to separate triage per intake #666).

---

## Acceptance signals (observable)

- No production reference to `--fix-session` remains (CF-3).
- Resolver dispatches via `resolveCiFailure`; happy path still gates through
  guards/suite/lease-push (CF-1, CF-2).
- Spawn failures log a class + message, never a bare swallowed `ExecaError` (CF-4).
- Preflight runs once at startup: pass → serve, fail → loud + ci-fix disabled (CF-5, CF-6).
- No edits to plan-discovery / remediate-planner modules (CF-7).
