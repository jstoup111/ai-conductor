**Status:** Accepted

# Stories: ci-fix-resolver-autofix
**Track:** Technical
**Source:** intake jstoup111/ai-conductor#666

Acceptance is expressed at the daemon/resolver seam. "The resolver" = `runCiFix` +
`productionCiFixRunner` in `src/conductor/src/engine/ci-fix.ts`; "the dispatcher" =
`DefaultStepRunner.resolveCiFailure`. Tests inject fakes for the runner/provider — no real
`claude` spawn in the suite.

---

## Story CF-1: (happy): resolver dispatches a real fix through the StepRunner path

**Given** an eligible red shipped PR with a live branch and a computed CI-fix hint
**And** the configured build provider policy permits the repair invocation
**When** `runCiFix` executes inside its isolated resolver worktree
**Then** it invokes the StepRunner-backed dispatcher (`resolveCiFailure`) — never
`claude --fix-session`
**And** the dispatch runs a one-shot headless session (`resume:false`,
`dangerouslySkipPermissions`, cwd = resolver worktree) carrying the CI-failure hint
**And** on a `changed` outcome the existing acceptance-guard → suite-gate → lease-push
pipeline runs unchanged before publishing.

## Story CF-2: (happy): no-op fix leaves the branch untouched, no false green

**Given** the dispatcher runs but produces no worktree changes
**When** `runCiFix` evaluates the outcome
**Then** it returns a non-`changed` outcome
**And** it does NOT run acceptance guards, the suite gate, or a push
**And** the daemon does not report `green-verified` for that PR.

## Story CF-3: (negative): the fictional `--fix-session` flag is gone

**Given** the production runner
**When** the resolver dispatches a fix
**Then** no code path constructs the argument `--fix-session`
**And** a repository search for `--fix-session` in `src/` returns no production reference
(guarding against regression to the crashing invocation).

## Story CF-4: (negative): resolver spawn failure surfaces a classified, diagnosable error

**Given** the fix dispatch fails at the spawn/exec layer
**When** the resolver handles the failure
**Then** the logged reason names a class — `flag-invalid`, `auth`, `spawn-env`, or `unknown` —
plus the underlying message
**And** it is NOT a bare `ExecaError: Command failed with exit code 1` with no classification
**And** the failure does not silently vanish (the outcome/log is observable to the operator).

## Story CF-5: (happy): repair follows the configured build provider policy

**Given** a daemon whose build provider configuration permits a repair invocation
**When** CI repair is dispatched
**Then** it follows the effective build provider, model, effort, and allowed fallback policy
**And** a Codex-only configuration does not require the Claude executable
**And** provider readiness retains the selected provider's established behavior, including
ordinary Codex dispatch on an inconclusive readiness probe.

## Story CF-6: (negative): prevented repair is explicit and does not consume an attempt

**Given** provider-owned readiness or execution preparation affirmatively prevents every
repair invocation without any repair having started
**When** the daemon receives the explicit no-start result
**Then** it reports the classified provider/reason and restores the previous repair attempt
count and cooldown timestamp
**And** authentication failure does not authorize provider fallback
**And** an ambiguous result or a prior real attempt cannot be treated as proof of no start
**And** unrelated daemon work continues under its existing policy.

## Story CF-7: (guard): out-of-scope red-CI cause is not touched

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
- Repair inherits build provider policy; proven no-start refusal is explicit and does not consume a repair attempt (CF-5, CF-6).
- No edits to plan-discovery / remediate-planner modules (CF-7).
