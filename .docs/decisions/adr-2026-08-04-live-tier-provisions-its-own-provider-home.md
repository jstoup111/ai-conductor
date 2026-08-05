# ADR: The live tier provisions its own provider home from the checkout under test

**Date:** 2026-08-04
**Status:** APPROVED
**Feature:** live-daemon-e2e-build-step-never-runs-a-real-agent (jstoup111/ai-conductor#1311)
**Related:** `adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate` (the tier's
trigger contract, preserved here), `adr-2026-06-30-sandbox-build-isolation` (the
isolated-home machinery this reuses), #363 (why a global install from a worktree is
unsafe), #1259 / PR #1310 (the fail-closed release gate this unblocks)

## Context

The live daemon E2E tier has never exercised the BUILD path. Verified from workflow
run 30965346463: the build dispatch returned
`{"num_turns":0,"result":"Unknown command: /pipeline","total_cost_usd":0}` in 43 ms.

The mechanism is fully traced and there is no ambiguity about the cause:

- `skill-invocation.ts:28` maps step `build` to `skillName: 'pipeline'`;
  `renderSkillInvocation:56-66` renders it as the literal prompt `/pipeline`.
- Claude Code resolves that command from its skill catalog. `bin/install:12,1207-1256`
  is the only thing in this repository that populates one — it symlinks every
  `skills/<name>/` into `$HOME/.claude/skills/<name>`. There is no
  `~/.claude/commands/` provisioning anywhere in the repo.
- `.github/workflows/live-daemon-e2e.yml:48-55` installs `@anthropic-ai/claude-code`
  and nothing else. No workflow in `.github/` runs `bin/install` or `bin/setup`.
- The fixture's temp repo (`daemon-e2e-live.smoke.test.ts:212-231`, over
  `initTestRepo`) creates `.docs/`, `test/fixtures/`, and `.pipeline/` — no `.claude/`
  of any kind. `worktree-prepare.ts:174-242` stages only `settings.local.json` on the
  ordinary build path, never skills.
- `ClaudeProvider.buildEnv:738-745` returns `undefined` unless `selfHost.env` is set,
  and the smoke constructs `new ClaudeProvider()` with no self-host wiring
  (`daemon-e2e-live.smoke.test.ts:217,252-258`). The child therefore inherits the bare
  runner environment.

The credential is not implicated: the same run's `build_review` step made a real
3-turn dispatch costing $0.3645. The CLI, the token, and `--dangerously-skip-permissions`
(always set for `build`, `step-runners.ts:733-741`) all work. Only skill resolution fails.

`install-freshness.ts:1-15` already documents this exact failure class — a dispatched
skill that does not resolve "returns empty output, and the conductor HALTs with a
cryptic 'no parseable result'". Its `bin/install --check` guard runs at
`daemon-cli.ts:704`, the daemon *entry point*. This fixture calls `runDaemon()` as a
library, so the guard never runs. That is a gap in coverage, not a regression against
a decided contract: no ADR or plan from #1124 ever modelled skill provisioning —
`.docs/plans/daemon-e2e-smoke-step-has-no-real-agent-live-llm-t.md:60` states "no
fixture installation is required", and the review's assumption ledger
(`architecture-review-2026-08-02-live-agent-daemon-e2e-tier.md:50-51`) covers only
installing the CLI *binary*.

## Decision

**The fixture provisions its own isolated provider home from the checkout under test,
using the same provider-keyed machinery the self-host build path already uses, and
tears it down under `finally`.**

Concretely: before dispatch the smoke provisions a throwaway provider home whose
`skills/` comes from the repository root being tested, and passes that home's
`childEnv()` through the existing `InvokeOptions.selfHost` seam
(`llm-provider.ts:113-118`), which `ClaudeProvider.buildEnv:742` already merges over
`process.env`. No new provider surface, no argv change.

**The primitive is `provisionProviderHome` (`provider-home.ts:125-191`) for every leg,
not the Claude-specific sandbox.** It creates a temp home, **copies** `<root>/skills`
into it, prunes `OPERATOR_ONLY_SKILLS` from the copy, sets `CLAUDE_CONFIG_DIR` (or
`CODEX_HOME`), and fails closed with `ProviderHomeProvisionError` when the root has no
`skills/` (`:140-144`). It is provider-neutral, which is what lets the reserved second
matrix leg (`adr-2026-08-02-live-smoke-manual-dispatch-and-reusable-gate`) arrive as one
entry plus a credential, as that ADR intends.

Three properties decide it over `provisionSandboxBuildEnv`, and each was verified:

- **It copies rather than symlinks** (`:145-151`). A live link "lets provider-owned
  warmup/init writes … land back inside the git-tracked worktree through the link,
  defeating the throwaway home's isolation" — the module's own words. On *this*
  repository that is not hypothetical: an untracked artifact appearing in the live
  checkout halts any concurrent self-host build
  (`live-boundary-halts-self-host-builds-when-the-oper.md:58-62`, and the incident class
  recorded in `CLAUDE.md`'s Daemon Operations Safety §5). A test that provisions from the
  operator's checkout must not open a write-through path back into it.
- **It reads no ambient operator state.** `provisionSandboxBuildEnv` calls
  `provisionTrustState` (`sandbox-build-env.ts:201-210,260-297`), which reads the
  operator's live `~/.claude.json` to propagate workspace trust. That directly
  contradicts this ADR's own reason for rejecting "point the fixture at the real
  `~/.claude`", and in CI — where no such file exists — it would provision an untrusted
  home, a second failure mode indistinguishable in the output from the one being fixed.
- **It installs no settings and no hooks**, so the tier does not inherit a write fence
  or a hook set it has no use for.

**The credential is supplied explicitly by the fixture, not inherited.**
`childEnv():100-108` deliberately deletes `CLAUDE_CODE_OAUTH_TOKEN` — "never inherit … 
Claude's ambient credential token", the guarantee
`codex-safety-and-self-host-parity-907.md:252-268` (FR-8) requires. That contract is about
*inheriting* an ambient credential; a caller that deliberately passes its own is a
different act. The fixture therefore composes its dispatch env as the home's `childEnv()`
plus the credential it supplies on purpose, leaving FR-8's guarantee about the home
untouched. For a non-Claude leg the credential arrives through `prepareSelfHostAuth`,
which `provisionProviderHome:172` already invokes.

## Alternatives considered

- **Run `bin/install` in the workflow (the issue's first hypothesis).** Rejected as
  the primary mechanism. It fixes CI and nothing else: locally the smoke would keep
  dispatching against whatever checkout the operator's global catalog points at, so a
  run from a worktree with edited skills verifies the *main* checkout's skills. That is
  the same verification gap `sandbox-build-env.ts:1-14` was built to close for
  self-host builds, and this tier exists precisely to be a trustworthy regression
  signal. It also mutates runner globals and leaves two provisioning paths to keep in
  sync — and #363 is the recorded incident where a global relink rooted at the wrong
  checkout bricked an environment. Nothing here forbids adding it later as a
  convenience; it is simply not what makes the tier correct.
- **Copy a `.claude/skills` tree into the fixture's temp repo.** Rejected: a
  project-local catalog is a second discovery surface the harness does not otherwise
  use, and the fixture repo is meant to model a consumer project, which never carries
  the harness's own skills.
- **Assert the precondition and stop, provisioning nothing (the issue's second
  hypothesis).** Rejected as a complete answer — it makes the failure attributable but
  leaves the tier permanently red, so desired outcomes 1 and 2 stay unmet. It is
  retained as a *component*, decided separately in
  `adr-2026-08-04-unresolved-step-command-fails-by-name`.
- **Point the fixture at the operator's real `~/.claude`.** Rejected: it makes the
  test's result depend on ambient machine state, and in CI there is nothing to point at.
- **`provisionSandboxBuildEnv`, the Claude self-host sandbox.** Rejected for the three
  reasons given under Decision — symlink write-through into the checkout, an ambient
  `~/.claude.json` read that reintroduces exactly the machine-state dependence this ADR
  rejects, and settings/hook installation the tier does not want. It remains the right
  primitive for a genuine self-host build, where the worktree is disposable and the
  operator's trust state is the thing being propagated; a test fixture is neither of
  those.

## Consequences

**Positive.** The tier verifies the skills in the checkout under test, identically in
CI and on a developer machine, with no global mutation anywhere. The generality
desired outcome falls out for free: the home carries the whole `skills/` tree, so every
command in `STEP_SKILL_INVOCATIONS` resolves, not just `/pipeline`. #1259's fail-closed
release gate becomes safe to merge.

**Negative.** The fixture now owns a provider environment, which is more setup than a
bare `new ClaudeProvider()` and one more thing that can fail before any assertion runs.
That cost is bounded by the fail-closed provisioning error, which names the missing
directory rather than surfacing downstream.

**Negative.** Copying `skills/` per run costs a directory copy instead of a symlink. The
asset is small and markdown-only (`provider-home.ts:145-151` makes the same trade for
the same reason), so the cost is accepted in exchange for closing the write-through path.

**Ordering constraint this creates.** Provisioning must run *inside* the tier's existing
`describe.skipIf` case, never at module scope. An uncredentialed advisory dispatch has to
stay a clean skip (`ST-1124-5`), and module-scope provisioning would execute before the
skip predicate and turn that run red.

**Consequence for the reserved Codex leg.** Because provisioning is selected by
provider key rather than hardcoded, adding the second matrix entry does not require
revisiting this decision.
