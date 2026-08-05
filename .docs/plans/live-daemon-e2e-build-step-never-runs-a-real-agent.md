# Implementation Plan: Live daemon E2E build step never runs a real agent (#1311)

**Date:** 2026-08-04
**Stem:** live-daemon-e2e-build-step-never-runs-a-real-agent
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/live-daemon-e2e-build-step-never-runs-a-real-agent.md
**Conflict check:** Clean as of 2026-08-04 — 4 blocking found and resolved in DECIDE, 4 degrading resolved

## Summary

Give the live daemon E2E fixture its own provisioned provider home, copied from the checkout
under test, add a filesystem-only preflight that fails by name when a dispatchable step command
does not resolve, and stop the Claude provider from reporting an unresolved command as a
successful invocation. 25 tasks.

## Technical Approach

**Reuse, do not rebuild.** `provisionProviderHome`
(`src/conductor/src/engine/self-host/provider-home.ts:125-191`) already creates a throwaway
home, copies a root's `skills/` into it, prunes `OPERATOR_ONLY_SKILLS`, sets `CLAUDE_CONFIG_DIR`
(or `CODEX_HOME`), and fails closed on a missing asset. The fixture calls it; it adds no
provisioning of its own.

**Copy, never link — this is load-bearing on this repository.** The alternative primitive,
`provisionSandboxBuildEnv`, symlinks `<root>/skills`. `provider-home.ts:145-151` records why
that is unsafe: a live link lets provider warmup writes land back inside the source tree. Here
the source tree may be the operator's live checkout, where an untracked artifact halts any
concurrent self-host build (`CLAUDE.md`, Daemon Operations Safety §5). The sandbox also reads
the operator's `~/.claude.json` (`sandbox-build-env.ts:201-210`), which is the ambient-state
dependence the ADR rejects.

**The credential is composed on, not inherited.** `childEnv():100-108` deletes
`CLAUDE_CODE_OAUTH_TOKEN` by design (FR-8 of `codex-safety-and-self-host-parity-907`). The
fixture supplies its own token explicitly on top of `childEnv()`; the production stripping
contract is untouched, and a non-Claude leg gets its credential through `prepareSelfHostAuth`,
which `provisionProviderHome:172` already invokes.

**The env reaches the provider through an existing seam.** `ClaudeProvider.buildEnv:738-745`
merges `options.selfHost?.env` over `process.env`. Injection is therefore a provider-decorator
concern, and the smoke already contains the decorator pattern — `TokenMeter`
(`daemon-e2e-live.smoke.test.ts:33-64`) wraps both invoke methods and forwards the same options
object. Building a full `ProviderExecutionContext` to reach `prepareCandidateSelfHost` is the
fallback, not the plan: `provider-execution.ts:218-235` requires `configuredProviders`,
`runtimes`, and `sessions`, none of which this fixture needs.

**Ordering is a requirement, not an implementation detail.** The tier's skip predicate runs at
`describe.skipIf` (`:210`) over `shouldRun` (`:103-105`). Provisioning or preflighting at module
scope would execute first and turn every uncredentialed advisory run red — which #1259's gate
would read as a smoke regression. Task 6 pins the ordering before Task 7 spends anything.

**The preflight lives in test-land on purpose.** It reads `STEP_SKILL_INVOCATIONS`
(`skill-invocation.ts:11-54`) and `renderSkillInvocation:56-66` but exports nothing into
production — the smoke's own header (`:22-30`) records that an exported surface no production
code reaches is what the wiring-reachability gate's orphan backstop reports as a gap.

**Registry coverage has a stated boundary.** A step absent from `STEP_SKILL_INVOCATIONS`
dispatches as `` `/${step}` `` — the raw state key (`step-runners.ts:546-548`). This repository
declares two such custom steps (`.ai-conductor/config.yml:114-125`). The preflight covers
registry-rendered commands and records config-declared custom and parallel-branch steps as a
known non-covered surface, rather than claiming coverage it does not have.

**The provider change is a classification, not a new capability.** The observed envelope is
`{"subtype":"success","is_error":false,"num_turns":0,"result":"Unknown command: /pipeline"}`, so
neither `subtype` nor `is_error` is usable and the exit code is 0. The discriminator is the
conjunction of `num_turns === 0` and a `result` naming the exact command this dispatch sent.
`num_turns` must be read from the parsed envelope inside `parseJsonResult`, **not** from
`tokenUsage.numTurns`: `claude-provider.ts:438-458` populates `tokenUsage` only when input and
output tokens are both non-zero, and the failing envelope reported neither.

**Two tasks are gates, not milestones.** Task 7 is the first live dispatch and settles review
assumptions A-1 and A-2; everything after it depends on it. Task 18 settles review condition C-6
before the classification lands, so the change cannot redden this repository's own SHIP tail as
a side effect.

## Prerequisites

- `CLAUDE_CODE_OAUTH_TOKEN` — already provisioned and proven working (workflow run
  30965346463 made real API calls costing ~$0.365). No new credential.
- The `claude` CLI on the runner — already installed by `live-daemon-e2e.yml:48-49`.
- No new dependency, no schema, no migration block: nothing here touches `bin/conduct` CLI,
  hook wiring, `settings.json` schema, or skill symlink targets.

**Documentation note.** This repository routes human-facing documentation through its
`maintain-documentation` custom step, so review condition C-3
(`docs/contributing/testing.md:75-100,296`) carries no plan task here. It remains required
before the PR is complete.

**Scope guard (review condition C-5).** Do not add a `schedule` trigger, a `pull_request`
trigger, or a `ci-gate` entry.

## Tasks

### Task 1: Provision a provider home by copying skills from a given root
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting that the helper, given a root containing `skills/`, returns a
   home whose `childEnv()` sets `CLAUDE_CONFIG_DIR` to that home, whose
   `skills/pipeline/SKILL.md` resolves, and whose `skills/` entry is a real directory copy
   rather than a symlink.
2. Verify test fails (RED).
3. Add `src/conductor/test/fixtures/live-provider-home.ts` calling `provisionProviderHome`
   with the given root, and composing the dispatch env as `childEnv()` plus an explicitly
   supplied `CLAUDE_CODE_OAUTH_TOKEN` for the Claude leg.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): copy skills from the checkout under test into a throwaway home"

**Files:**
- `src/conductor/test/fixtures/live-provider-home.ts` — new helper
- `src/conductor/test/fixtures/live-provider-home.test.ts` — new test

**Wired-into:** `src/conductor/test/fixtures/live-provider-home.ts#provisionLiveProviderHome`
**Dependencies:** none

### Task 2: Provisioning fails closed on a root with no skills directory
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that provisioning against a root with no `skills/` rejects
   with `ProviderHomeProvisionError` naming the missing asset, and leaves no home on disk.
2. Verify test fails (RED).
3. Surface the underlying error (`provider-home.ts:140-144`) without swallowing the path it names.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): fail closed when the checkout has no skills directory"

**Files:** `src/conductor/test/fixtures/live-provider-home.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 3: The home is removed on both branches and the source checkout is untouched
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write failing tests asserting the home no longer exists after normal teardown and after the
   caller throws mid-use, that a double teardown is a no-op, and that `git status --porcelain`
   over the source root is byte-identical before and after — including untracked paths.
2. Verify tests fail (RED).
3. Wrap the helper's use in a `try`/`finally` contract so teardown runs on the crash branch.
4. Verify tests pass (GREEN).
5. Commit: "test(live-e2e): guarantee teardown and an untouched source checkout"

**Files:** `src/conductor/test/fixtures/live-provider-home.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 4: A non-Claude leg carries no Claude credential
**Story:** Story 1
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a home provisioned for a non-Claude provider sets
   `CODEX_HOME`, contains no `CLAUDE_CODE_OAUTH_TOKEN` in its dispatch env, and receives its
   credential through `prepareSelfHostAuth`.
2. Verify test fails (RED).
3. Scope the explicit token composition to the Claude leg only.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): keep the Claude credential off a non-Claude leg"

**Files:** `src/conductor/test/fixtures/live-provider-home.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 5: Inject the provisioned environment into dispatch via a provider decorator
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting the decorator sets `InvokeOptions.selfHost` — with the
   composed env — on both `invoke` and `invokeInteractive`, and forwards every other option
   unchanged to the wrapped provider.
2. Verify test fails (RED).
3. Add the decorator beside `TokenMeter`, following its transparent-wrapper shape
   (`daemon-e2e-live.smoke.test.ts:33-64`), preserving `supportsSessionResume`,
   `lifecycleCapability`, `readiness`, `prepareSelfHostAuth`, `resolveSelfHostExecutable`.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): route the provisioned home through InvokeOptions.selfHost"

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`
**Wired-into:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts#ProvisionedHome`
**Dependencies:** Task 1

### Task 6: Provisioning runs only inside a selected case, so an advisory run still skips
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test running the live file with `CLAUDE_CODE_OAUTH_TOKEN` unset, asserting
   the file reports a skip and that provisioning never executed (no throwaway home created).
2. Verify test fails (RED).
3. Move all provisioning and preflight work inside the `describe.skipIf` case; nothing at
   module scope.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): keep an uncredentialed advisory run a clean skip"

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 5

### Task 7: GATE — the live build step produces a real turn and the fixture task completes
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Wire the provisioning decorator into the smoke's provider chain so the real dispatch runs
   against the provisioned home.
2. Run the live smoke with credentials; confirm the build dispatch reports non-zero turns and
   non-zero token usage, and that `terminal`, `madeCommit`, `touchedFixture`, and `taskTrailer`
   are all true.
3. Record the observed turn count, token usage, and cost — the proof for review assumptions
   A-1 and A-2.
4. If the dispatch is blocked for lack of workspace trust (A-2 wrong), seed a minimal trust
   file in the fixture's OWN home; do not reach for the sandbox's ambient-state reader.
5. Commit: "test(live-e2e): dispatch the build step against a provisioned provider home"

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 6

### Task 8: Derive the dispatchable command set from the step registry
**Story:** Story 5
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting the derived set contains every `kind: 'skill'` entry of
   `STEP_SKILL_INVOCATIONS` and excludes every `kind: 'engine-native'` entry, naming
   `build_review`, `wiring_check`, `test_suite`, and `attribution_verify` as excluded.
2. Verify test fails (RED).
3. Add `src/conductor/test/fixtures/step-command-preflight.ts` deriving the set by iterating
   the registry — no literal skill names.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): derive dispatchable commands from the step registry"

**Files:**
- `src/conductor/test/fixtures/step-command-preflight.ts` — new helper
- `src/conductor/test/fixtures/step-command-preflight.test.ts` — new test

**Wired-into:** `src/conductor/test/fixtures/step-command-preflight.ts#dispatchableStepCommands`
**Dependencies:** Task 7

### Task 9: The preflight passes when every dispatchable command resolves
**Story:** Story 2
**Type:** happy-path

**Steps:**
1. Write a failing test asserting the preflight resolves cleanly against a home containing a
   `SKILL.md` for every derived command.
2. Verify test fails (RED).
3. Implement resolution as a filesystem check of `<home>/skills/<name>/SKILL.md`.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): pass the preflight when every step command resolves"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 10: A missing command names the command, its rendered string, and the directory
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a home missing `pipeline` produces a failure naming
   `pipeline`, the rendered command string, and the directory searched.
2. Verify test fails (RED).
3. Implement the failure message with those three facts.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): name the unresolved command, its string, and the search path"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 9

### Task 11: Every missing command is named, not only the first
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a home missing two commands names both, and that a home
   missing a command other than `pipeline` names that one — no build-step special case.
2. Verify test fails (RED).
3. Collect all misses before reporting instead of failing on the first.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): report every unresolved command in one failure"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 10

### Task 12: The preflight makes no provider, subprocess, or network call
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test injecting throwing provider and subprocess seams and asserting the
   preflight completes without touching either.
2. Verify test fails (RED).
3. Remove any incidental subprocess or provider use; resolution is filesystem-only.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): prove the preflight spends nothing"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 13: No skill name is hardcoded in the preflight
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing structural test reading the preflight's source and asserting no
   `STEP_SKILL_INVOCATIONS` skill name appears as a literal.
2. Verify test fails (RED).
3. Remove any literal that survives.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): keep the registry the command enumeration source"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 14: The reported command string comes from the shared renderer
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing test asserting the preflight's reported command for provider key `codex`
   begins with `$` and for `claude` with `/`, produced by `renderSkillInvocation` rather than a
   hardcoded prefix.
2. Verify test fails (RED).
3. Route the reported string through `renderSkillInvocation` (`skill-invocation.ts:56-66`).
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): render preflight command strings per provider"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 15: State the coverage boundary the preflight does not cross
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write a failing test asserting the preflight declares its non-covered surface: steps
   declared only in project configuration (custom steps and `parallel[].skill` overrides),
   which dispatch as their raw state key via `step-runners.ts:546-548`.
2. Verify test fails (RED).
3. Record the boundary in the helper alongside the split with the daemon-entry
   install-freshness check — install-freshness owns the operator's global catalog, the
   preflight owns the run's own home, and neither covers the other.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): state the preflight's non-covered surface explicitly"

**Files:** `src/conductor/test/fixtures/step-command-preflight.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 8

### Task 16: Run the preflight before any dispatch, proven by a dispatch counter
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write a failing test asserting that when the preflight fails, the smoke reports that failure
   and the dispatch counter reads zero — asserted from the counter, never from a token total.
2. Verify test fails (RED).
3. Call the preflight in the smoke immediately after provisioning and before constructing the
   step runner, and add a dispatch counter to the provider decorator.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): preflight commands before spending anything"

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 11

### Task 17: The meter counts unmetered results rather than reading them as zero
**Story:** Story 2
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a result with absent `tokenUsage` increments an
   `unmetered` counter and does not add zero to the total, and that the cap assertion reports
   the unmetered count.
2. Verify test fails (RED).
3. Extend `TokenMeter` with the counter and include it in the cap assertion's report.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): count unmetered results instead of treating them as free"

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 16

### Task 18: GATE — establish whether this repo's custom steps currently resolve
**Story:** Story 3
**Type:** infrastructure

> **Amended 2026-08-05 by #1311:** Do not run this credentialed proof from the local BUILD
> agent. The daemon selected Codex for BUILD, and its isolated provider home correctly strips
> `CLAUDE_CODE_OAUTH_TOKEN`; exposing Claude's credential to that agent would violate the
> cross-provider isolation contract. Defer the empirical custom-step resolution proof to the
> credentialed `live-daemon-e2e.yml` GitHub Actions run, where the workflow injects the repository
> secret only into the isolated Claude smoke process. Local BUILD records this task as deferred to
> that workflow and proceeds to Task 19 using the already captured unresolved-command envelope.
> The workflow result is the authoritative C-6 evidence and remains a merge/release gate; a missing
> secret or failed probe blocks there rather than asking a local agent for the token.

**Steps:**
1. Determine empirically whether `maintain-documentation` and `release-disposition`
   (`.ai-conductor/config.yml:114-125`) resolve when dispatched as `/maintain-documentation`
   and `/release-disposition` in a real self-host build environment.
2. Record the finding as evidence — this is review condition C-6.
3. If they resolve, proceed to Task 19 unchanged.
4. If they do not, they are producing silent zero-turn successes today: either fix the
   dispatch or scope the classification to exclude config-declared steps, and say which in
   the PR body. Do not proceed to Task 20 until this is settled.
5. Commit: "test(provider): record custom-step command resolution evidence"

**Files:** `src/conductor/test/execution/claude-provider-unresolved-command.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 7

### Task 19: Pin a real unresolved-command envelope as a test fixture
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Capture the raw provider envelope from a live dispatch of a command that does not resolve.
2. Write it to a fixture file verbatim, alongside an ordinary successful envelope for contrast.
3. Write a failing test asserting the fixture parses and reports `num_turns: 0`,
   `subtype: "success"`, `is_error: false`, and zero input/output tokens.
4. Verify test passes (GREEN) — this pins observed reality, per review condition C-2.
5. Commit: "test(provider): pin a real unresolved-command envelope"

**Files:**
- `src/conductor/test/fixtures/claude-envelopes/unresolved-command.json` — new fixture
- `src/conductor/test/execution/claude-provider-unresolved-command.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 18

> **Amended 2026-08-05 by #1311:** Task 19 may proceed locally after Task 18 records its GitHub
> Actions deferral; it does not wait for a credentialed nested Claude invocation during BUILD.
> The deferred Task 18 workflow verdict still gates merge/release independently.

### Task 20: Classify an unresolved step command as an unsuccessful invocation
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write a failing test asserting that the pinned envelope, dispatched with prompt `/pipeline`,
   yields `success: false` and a result naming the unresolved command.
2. Verify test fails (RED).
3. Retain `num_turns` from the parsed envelope in `parseJsonResult`
   (`claude-provider.ts:429-467`), add `commandUnresolved` and `commandUnresolvedName` to
   `InvokeResult` (`llm-provider.ts:150-203`) beside the existing `providerUnavailable` family,
   and set them in `classifyCompletion` (`:685-700`) when `num_turns === 0` and the result
   names the dispatched command as unknown.
4. Verify test passes (GREEN).
5. Commit: "fix(provider): stop reporting an unresolved command as a success"

**Files:**
- `src/conductor/src/execution/claude-provider.ts`
- `src/conductor/src/execution/llm-provider.ts`
- `src/conductor/test/execution/claude-provider-unresolved-command.test.ts`

**Wired-into:** `src/conductor/src/execution/claude-provider.ts#classifyCompletion`
**Dependencies:** Task 19

### Task 21: Prose, bare zero-turn, and mismatched-command results stay successful
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: a multi-turn success whose output merely mentions "unknown
   command" stays `success: true` with no reason set; a zero-turn result that does not name the
   dispatched command sets no reason; a result naming a different command than the one
   dispatched sets no reason.
2. Verify tests fail (RED).
3. Narrow the matcher until all three hold — both halves of the conjunction are required.
4. Verify tests pass (GREEN).
5. Commit: "test(provider): keep prose and bare zero-turn results out of the new class"

**Files:** `src/conductor/test/execution/claude-provider-unresolved-command.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 20

### Task 22: Classification survives a zero-token envelope and an exit code of zero
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting classification still fires when the envelope reports zero
   input and output tokens (so `tokenUsage` is never populated), and when the process exits 0.
2. Verify tests fail (RED).
3. Confirm the turn count is read from the parsed envelope, not `tokenUsage.numTurns`, and that
   the classification does not gate on the exit code.
4. Verify tests pass (GREEN).
5. Commit: "test(provider): read turns from the envelope, not token usage"

**Files:** `src/conductor/test/execution/claude-provider-unresolved-command.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 20

### Task 23: The new class consumes no retry and carries a HALT class
**Story:** Story 3
**Type:** negative-path

**Steps:**
1. Write failing tests asserting an unresolved-command result consumes no retry attempt,
   triggers no effort or model escalation, walks no provider-candidate ladder, and that any
   HALT it produces carries the class `mechanical`.
2. Verify tests fail (RED).
3. Route the new reason as a deterministic environmental failure, following
   `build-auth-token-check-and-classify`'s zero-retry precedent; do not add it to
   `hasRecoveryPrecedence` (`provider-execution.ts:237-242`).
4. Verify tests pass (GREEN).
5. Commit: "fix(conductor): spend no retries on an unresolvable command"

**Files:**
- `src/conductor/src/engine/conductor.ts`
- `src/conductor/test/execution/claude-provider-unresolved-command.test.ts`

**Wired-into:** `src/conductor/src/engine/conductor.ts#Conductor`
**Dependencies:** Task 20

### Task 24: A genuine build regression remains distinguishable
**Story:** Story 4
**Type:** negative-path

**Steps:**
1. Write a failing test asserting that a run whose commands all resolve and whose dispatch is
   real, but which does not carry the fixture task to a finish, fails on the outcome assertions
   with no unresolved-command reason present.
2. Verify test fails (RED).
3. Confirm the two failure classes produce distinct output, and that `dumpPipelineDiagnostics`
   is still emitted for both.
4. Verify test passes (GREEN).
5. Commit: "test(live-e2e): keep build regressions distinct from environment failures"

**Files:** `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 20

### Task 25: Update the live-tier acceptance test's static source contract
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Re-read `src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts:42-109`
   and run it; do not assume it still passes (review assumption A-5).
2. Update its source-text assertions to cover the provisioning decorator, the dispatch counter,
   and the preflight call, while keeping the existing guarantees: `new ClaudeProvider()` is
   still constructed, the outcome-only assertions are unchanged, and no `providerCalls`, exact
   commit subject, or retry counter is asserted as an outcome.
3. Verify the ordinary suite passes (GREEN).
4. Commit: "test(live-e2e): extend the tier's source contract to provisioning and preflight"

**Files:** `src/conductor/test/acceptance/daemon-e2e-live-agent-tier.acceptance.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 17, Task 24

## Task Dependency Graph

```
Provisioning seam (Story 1)
───────────────────────────
Task 1 ─┬─ Task 2
        ├─ Task 3
        ├─ Task 4
        └─ Task 5 ── Task 6 ── Task 7  ◀── GATE: settles A-1 and A-2
                                  │
        ┌─────────────────────────┴─────────────────────────┐
        ▼                                                   ▼
Preflight seam (Stories 2, 5)              Provider seam (Stories 3, 4)
─────────────────────────────              ────────────────────────────
Task 8 ─┬─ Task 9 ── Task 10 ── Task 11    Task 18  ◀── GATE: settles C-6
        ├─ Task 12                   │        │
        ├─ Task 13                   │     Task 19 ── Task 20 ─┬─ Task 21
        ├─ Task 14                   │                         ├─ Task 22
        └─ Task 15                   │                         ├─ Task 23
                                     ▼                         └─ Task 24
                         Task 16 ── Task 17                          │
                                        │                            │
                                        └─────────┬──────────────────┘
                                                  ▼
                                               Task 25
```

Tasks 8-17 and 18-24 are independent of each other; both converge at Task 25. Nothing after
Task 7 starts until the live dispatch has proven the mechanism, and nothing after Task 18
touches classification until the custom-step question is settled.

## Integration Points

- **After Task 7:** the live tier passes end to end for the first time. This alone satisfies
  desired outcomes 1 and 2 and unblocks #1259's release gate.
- **After Task 17:** an unavailable command is reported before any spend, for every
  registry-rendered command, with spend proven by a dispatch counter rather than a token total.
- **After Task 24:** the two failure classes are distinguishable from the run output alone.

## Verification

- [ ] All happy-path criteria covered: Story 1 → Tasks 1, 5, 7; Story 2 → Tasks 9, 16;
      Story 3 → Tasks 19, 20; Story 4 → Task 24; Story 5 → Tasks 8, 14
- [ ] All negative-path criteria covered: Story 1 → Tasks 2, 3, 4, 6; Story 2 → Tasks 6, 10,
      11, 12, 17; Story 3 → Tasks 21, 22, 23; Story 4 → Tasks 24, 25; Story 5 → Tasks 13, 15
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] Every task carries a `Wired-into:` line
