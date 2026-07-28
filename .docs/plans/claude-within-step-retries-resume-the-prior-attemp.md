# Implementation Plan: Claude declares no resume (#1071)

**Date:** 2026-07-27
**Stem:** claude-within-step-retries-resume-the-prior-attemp
**Track:** technical (no PRD)
**Tier:** M
**Stories:** `.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`
**Conflict check:** `.docs/conflicts/claude-within-step-retries-resume-the-prior-attemp.md` — PASSED
**ADR:** `.docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md` — APPROVED
**Architecture review:** `.docs/decisions/architecture-review-claude-within-step-retries-resume-the-prior-attemp.md` — APPROVED, 4 conditions
**Depends on:** spec PR **#1069** (issue #903) — **must be merged before this builds**

## Summary

Complete the operator's end state — a fresh session for both Claude and Codex on every
iteration — by flipping Claude's `supportsSessionResume` to `false`, deleting its `--resume`
argv branch, minting session identity per invocation, closing the two dispatch paths #1069's
capability gate cannot reach, and giving interactive recovery explicit failure context.
16 tasks: 1 prerequisite assertion, 6 behavior changes, 3 invariant guards, 3 test inversions,
3 documentation.

## Technical Approach

**What #1069 already did.** It added `supportsSessionResume: boolean` to `LLMProvider`
(fail-closed), set `CodexProvider` to `false`, deleted Codex's `['exec','resume',sessionId]`
argv branch, gated resume in `runProviderInvocation`
(`resume = provider.supportsSessionResume && !forceFreshSession && session.resume`), and added a
once-per-step `session_policy` diagnostic. `ClaudeProvider` declares `true` — deliberately
unchanged, deferred here.

**What this feature does.** Four changes, in this order of importance:

1. **Claude declares `false` and loses its resume argv.** Mirrors #1069's Codex treatment: the
   invariant becomes structural, so no gate needs to be reached for it to hold.
2. **Per-invocation id minting.** #1069's non-goal — *"Do not change `ProviderSessionStore` id
   minting or scoping"* — leaves `prepare()` returning the scope-stable id. Since
   `claude-provider.ts:649-653` sends `--session-id «id»` when `resume` is false, flipping the
   declaration alone would dispatch against an already-registered id and burn a
   `SESSION_IN_USE_RE` recovery cycle per retry. The flip and the minting ship together.
3. **The two ungated paths.** #1069 claims `runProviderInvocation` is "the single place resume
   is decided". True only when `providerRuntimes` is configured:

   | Path | Location | Resume expression | Reaches the gate? | Task |
   |---|---|---|---|---|
   | Provider-aware | `provider-execution.ts:397` | capability-gated by #1069 | Yes | 2 |
   | Concurrent-group branch (scalar) | `group-core.ts:464-469` | `const resume = hasRun` | No | 7 |
   | Legacy scalar | `step-runners.ts:529-530` | `resume = this.sessionStarted` | No | 9 |

   `step-runners.ts:613` returns to `runProviderAwareNormal` only when `providerRuntimes` is set
   and no `branchSessionId` was supplied; otherwise `:630` dispatches
   `provider.invokeInteractive` directly, never entering `provider-execution.ts`.
4. **`runInteractive` context.** It sends a 12-word stub with an empty system prompt and
   `resume: true`. Cold-starting it without threading `retryHint`'s content would regress the
   operator's recovery experience.

**What must survive.** `SESSION_IN_USE_RE`, `STALE_SESSION_RE`, `CODEX_SESSION_EXPIRED_RE`,
`sessionExpired`, the non-consuming `session_reset` recovery, and #1069's `session_policy`
diagnostic (whose once-per-step scoping now matters more, since it fires on every dispatch).
`.pipeline/conduct-session-id` must not begin carrying per-invocation provider ids — it backs
`conductor.run.id` (`otel/resource.ts:46-55`). Tasks 11-13 pin these **before** Task 14
simplifies the vestigial machinery.

**`supportsSessionResume` is retained** with no `true` case (ADR Decision 4): it is #1069's
fail-closed default for adapters added later, and with both argv branches deleted a `true`
declaration could not construct a resume anyway.

**Test inversions, not deletions.** #1069 amends the Codex half of several suites and instructs
"Amend, never delete — each test also carries the Claude invariant". This feature amends that
surviving Claude half, so the same files are touched in sequence by both features.

**Sequencing.** Task 1 asserts #1069's capability is present and halts if not. Tasks 2-10 are
RED/GREEN pairs. Tasks 11-13 add survival guards. Task 14 is the cleanup, gated behind them.
Tasks 15-16 are documentation and the mandatory validation suite.

## Prerequisites

- **#1069 (issue #903) must be merged.** This feature consumes `supportsSessionResume`,
  `LLMProvider`'s declaration, the `runProviderInvocation` capability gate, and the
  `session_policy` diagnostic. Building against a `main` without them would require inventing a
  duplicate mechanism and would conflict at merge.
- No new dependency, no config key, no schema migration, no step-topology change, no
  `bin/conduct-ts` flag change.

## Known adjacencies

- **#1069 / #903** — the direct dependency, above. Test-file overlap is intentional and
  sequential (see the conflict check).
- **#1042** — owns the question of persisting isolated provider homes across invocations;
  referenced by #1069 but not touched here.
- **#999** — supplies retry-volume evidence only; no code surface.

## Task Dependency Graph

```
T1 ─┬─► T2 ─► T3 ─► T4 ─► T5 ──┐
    ├─► T6 ─► T7 ──────────────┤
    ├─► T8 ─► T9 ──────────────┤
    ├─► T10 ─► T11 ────────────┤
    ├─► T12 ───────────────────┼─► T14 ─► T15 ─► T16
    └─► T13 ───────────────────┘
```

T2-T5, T6-T7, T8-T9, T10-T11, T12 and T13 are independent chains after T1. T14 requires every
guard (T11, T12, T13) and every behavior change (T5, T7, T9) green first.

## Tasks

### Task 1: Assert the #1069 capability seam is present
**Story:** ST-1071-1
**Type:** verification

**Steps:**
1. Write a test asserting `LLMProvider` declares `supportsSessionResume`, that
   `CodexProvider.supportsSessionResume === false`, and that Codex's `buildArgs` cannot emit
   `exec resume`.
2. Verify it passes. If it fails, **halt** — #1069 has not merged and this feature must not
   proceed.
3. Implement: nothing.
4. n/a
5. Commit: "test(engine): assert the #1069 session-capability seam before building on it"

**Files likely touched:**
- `src/conductor/test/execution/llm-provider-contract.test.ts` — prerequisite assertion

**Wired-into:** none
**Dependencies:** none

### Task 2: RED — a Claude retry must cold-start
**Story:** ST-1071-1
**Type:** happy-path

**Steps:**
1. Write failing test: a Claude step fails and retries; assert attempt 2 receives
   `resume === false` and a `sessionId !==` attempt 1's.
2. Verify RED (today `resume: true` with the same id).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for cold-start Claude within-step retry"

**Files likely touched:**
- `src/conductor/test/engine/provider-session.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 3: GREEN — Claude declares no resume
**Story:** ST-1071-1
**Type:** happy-path

**Steps:**
1. Confirm Task 2 is RED.
2. Implement: `ClaudeProvider.supportsSessionResume = false` in
   `src/conductor/src/execution/claude-provider.ts`.
3. Verify the capability gate now suppresses Claude resume by the same path it suppresses Codex
   — no Claude-specific branch added.
4. Run `test/execution/claude-provider.test.ts` and `test/engine/provider-execution.test.ts`.
5. Commit: "feat(provider): Claude declares supportsSessionResume false"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — capability declaration

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`
**Dependencies:** Task 2

### Task 4: Delete Claude's `--resume` argv branch
**Story:** ST-1071-1
**Type:** happy-path

**Steps:**
1. Write failing test: calling `ClaudeProvider.buildArgs` with `resume: true` still emits
   `--session-id` and never `--resume`.
2. Verify RED.
3. Implement: in `claude-provider.ts:649-653` replace the conditional with an unconditional
   `args.push('--session-id', options.sessionId)`.
4. Verify GREEN — a Claude resume argv is now unconstructable, mirroring #1069's Codex
   treatment.
5. Commit: "feat(provider): make a Claude resume argv unconstructable"

**Files likely touched:**
- `src/conductor/src/execution/claude-provider.ts` — `buildArgs`
- `src/conductor/test/execution/claude-provider.test.ts`

**Wired-into:** `src/conductor/src/execution/claude-provider.ts#buildArgs`
**Dependencies:** Task 3

### Task 5: GREEN — mint session identity per invocation
**Story:** ST-1071-2
**Type:** happy-path

**Steps:**
1. Write failing test: `prepare()` returns a distinct id on consecutive calls for the same
   provider key within one step scope, always `resume: false`.
2. Verify RED (today the id is scope-stable).
3. Implement in `engine/provider-session.ts`: `prepare()` mints a fresh id every call and
   returns `{ id, resume: false }`. Keep the scope map entry so `current()` and the legacy
   mirror report the latest id. Do not delete `created`/`markCreated` yet (Task 14).
4. Verify GREEN and that no `--session-id` collision is possible on a retry.
5. Commit: "feat(engine): mint a provider session id per invocation"

**Files likely touched:**
- `src/conductor/src/engine/provider-session.ts` — `prepare()`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`
**Dependencies:** Task 4

### Task 6: RED — concurrent-group branch retry must cold-start
**Story:** ST-1071-3
**Type:** happy-path

**Steps:**
1. Write failing tests for both branch paths (`providerSessions` and scalar `mintSessionId`):
   a branch member's retry gets `resume === false` and a new id, and cross-branch isolation
   still holds.
2. Verify RED (`const resume = hasRun` yields `true`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for cold-start branch-member retry"

**Files likely touched:**
- `src/conductor/test/engine/group-core.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 7: GREEN — the branch executor never requests a resume
**Story:** ST-1071-3
**Type:** happy-path

**Steps:**
1. Confirm Task 6 is RED.
2. Implement in `engine/group-core.ts:444-495`: dispatch `resume: false` unconditionally and
   mint a new `sessionId` per dispatch in the scalar path. Remove `hasRun`'s resume role; keep
   it only if it still serves retry accounting.
3. Verify the `sessionExpired` non-consuming re-run (`group-core.ts:525-537`) still does not
   decrement retry budget.
4. Run `test/engine/group-core.test.ts` plus concurrent-group acceptance tests.
5. Commit: "feat(engine): cold-start concurrent-group branch retries"

**Files likely touched:**
- `src/conductor/src/engine/group-core.ts` — branch dispatch loop

**Wired-into:** `src/conductor/src/engine/group-core.ts#branch executor dispatch`
**Dependencies:** Task 6

### Task 8: RED — legacy scalar path retry must cold-start
**Story:** ST-1071-3
**Type:** happy-path

**Steps:**
1. Write failing tests: a single-provider run with no session store retries and gets
   `resume === false` with a fresh id; an inherited `.pipeline/session-created` marker does not
   produce a resume.
2. Verify RED (`resume = this.sessionStarted`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for cold-start legacy scalar retry"

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 9: GREEN — scalar path cold-starts; the marker loses its resume role
**Story:** ST-1071-3
**Type:** happy-path

**Steps:**
1. Confirm Task 8 is RED.
2. Implement in `engine/step-runners.ts:525-531`: the no-store branch resolves `resume = false`
   and mints a fresh `this.sessionId` per dispatch. In `execution/session.ts:83-90`, stop
   returning `--resume` on the created marker.
3. Verify the marker is still **persisted** — the `.pipeline` durability specs assert
   persistence, not resume.
4. Run `test/engine/step-runners.test.ts`, `test/execution/session.test.ts`,
   `test/acceptance/pipeline-durability.test.ts`.
5. Commit: "feat(engine): cold-start legacy scalar within-step retries"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — `run()` resume derivation
- `src/conductor/src/execution/session.ts` — argv selection

**Wired-into:** `src/conductor/src/engine/step-runners.ts#run`
**Dependencies:** Task 8

### Task 10: RED — interactive recovery carries the failure context
**Story:** ST-1071-4
**Type:** happy-path

**Steps:**
1. Write failing tests: the prompt handed to the provider by `runInteractive` names the failed
   step and carries the failure reason, for the stall-breaker (`conductor.ts:4785`) and the
   recovery menu (`conductor.ts:5808`); and the dispatch is `resume: false` on both the
   provider-aware and legacy paths.
2. Verify RED (a 12-word stub, empty system prompt, `resume: true`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for context-carrying interactive recovery"

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts`
- `src/conductor/test/engine/conductor-recovery.test.ts` (or nearest existing)

**Wired-into:** none
**Dependencies:** Task 1

### Task 11: GREEN — thread failure context into `runInteractive`
**Story:** ST-1071-4
**Type:** happy-path

**Steps:**
1. Confirm Task 10 is RED.
2. Implement: add a failure-context parameter to `runInteractive` on the runner interface
   (`conductor.ts:539`) and its implementation (`step-runners.ts:1141-1166`); render it into the
   prompt; pass the content that feeds `retryHint` (`conductor.ts:4076`) from both call sites;
   drop `resume: true` on both paths.
3. Verify the missing-reason case produces an explicit "no reason captured" statement rather
   than a silent stub.
4. Verify the recheck-and-break flow after the interactive session is unchanged.
5. Commit: "feat(engine): interactive recovery cold-starts with explicit failure context"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — `runInteractive`
- `src/conductor/src/engine/conductor.ts` — interface + two call sites

**Wired-into:** `src/conductor/src/engine/conductor.ts#stall-breaker`, `#recovery menu`
**Dependencies:** Task 10

### Task 12: Guard — recovery and diagnostics survive for both providers
**Story:** ST-1071-5
**Type:** negative-path

**Steps:**
1. Write tests asserting that after the change: Claude "already in use" / "No conversation
   found" and Codex `no rollout found` / `thread/resume failed` each still set `sessionExpired`,
   still emit `session_reset`, and still do **not** consume retry budget.
2. Assert #1069's `session_policy` diagnostic fires **once per step**, not per invocation, now
   that it fires on every dispatch.
3. Implement: no production change expected; fix if a regression is exposed.
4. Verify green.
5. Commit: "test(engine): guard recovery + session_policy under universal cold start"

**Files likely touched:**
- `src/conductor/test/engine/provider-execution.test.ts`
- `src/conductor/test/execution/claude-provider.test.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 13: Guard — `conductor.run.id` stability and artifact-sourced retries
**Story:** ST-1071-5
**Type:** negative-path

**Steps:**
1. Write a test asserting `conductor.run.id` is identical across multiple cold-started attempts
   in one feature run, across a process restart, and that `.pipeline/conduct-session-id` is not
   rewritten per provider invocation.
2. Write the ADR Decision 4 acceptance test: a step whose first attempt commits partial work and
   fails, whose cold-started retry receives only the `RETRY: «reason»` system prompt and the
   committed artifacts, still completes.
3. Verify honestly — if step 2 fails, that failure is the real risk this change carries and must
   be surfaced, never worked around by restoring resume.
4. Verify green.
5. Commit: "test(acceptance): run-id stability + cold retry from committed artifacts"

**Files likely touched:**
- `src/conductor/test/engine/otel/resource.test.ts` (or nearest existing)
- `src/conductor/test/acceptance/retry-cold-start-1071.acceptance.test.ts` — new
- `src/conductor/src/engine/daemon-dispatch-preparation.ts`
- `src/conductor/src/daemon-cli.ts`

**Wired-into:** `src/conductor/src/daemon-cli.ts#preparePipelineForDaemonDispatch`
**Dependencies:** Task 1

### Task 14: Retire the vestigial resume bookkeeping
**Story:** ST-1071-2
**Type:** refactor

**Steps:**
1. With Tasks 5, 7, 9, 11, 12 and 13 green, evaluate `ProviderSession.created`, `markCreated`,
   and `forceFreshSession` (`provider-execution.ts:376, 386, 397, 546`). Delete what has no
   remaining consumer; retain anything still serving scope bookkeeping or the legacy mirror.
2. **Retain `supportsSessionResume`** (ADR Decision 4) — it is #1069's fail-closed default for
   adapters added later.
3. Verify no deletion touches `SESSION_IN_USE_RE`, `STALE_SESSION_RE`,
   `CODEX_SESSION_EXPIRED_RE`, `sessionExpired`, `session_reset`, or `session_policy`.
4. Verify the full `src/conductor` suite is green, including `provider-execution.test.ts:116`,
   which must still pass unchanged.
5. Commit: "refactor(engine): drop resume bookkeeping with no remaining consumer"

**Files likely touched:**
- `src/conductor/src/engine/provider-session.ts`
- `src/conductor/src/engine/provider-execution.ts`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`
**Dependencies:** Task 5, Task 7, Task 9, Task 11, Task 12, Task 13

### Task 15: Invert the Claude half of the pinned assertions
**Story:** ST-1071-1
**Type:** refactor

**Steps:**
1. Invert `per-step-provider-routing-927.acceptance.test.ts:962-964` (the Claude half #1069
   explicitly preserved) and `:365-368`; update the test name at `:922`.
2. Amend `conductor.test.ts:9082-9245` — #1069 changed the Codex expectation and kept the
   Claude one; invert that Claude expectation now.
3. Rewrite the `resume` column of `retry-as-escalation.acceptance.test.ts:325-377` to `false`
   throughout, leaving the ordered model/effort ladder assertions untouched; confirm the S10
   non-consuming stale-session case (`:413-444`) still holds.
4. Invert `provider-session.test.ts:178-195`, `provider-execution.test.ts:164`,
   `step-runners.test.ts:791/843-844, 1472/1481-1482, 1671-1698, 2333/2351-2353`, and
   `session.test.ts:89`. Verify `provider-execution.test.ts:116` still passes unchanged.
5. Commit: "test: invert the Claude resume assertions to universal cold start"

**Files likely touched:**
- `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
- `src/conductor/test/acceptance/retry-as-escalation.acceptance.test.ts`
- `src/conductor/test/engine/conductor.test.ts`
- `src/conductor/test/engine/provider-session.test.ts`
- `src/conductor/test/engine/provider-execution.test.ts`
- `src/conductor/test/engine/step-runners.test.ts`
- `src/conductor/test/execution/session.test.ts`

**Wired-into:** none
**Dependencies:** Task 14

### Task 16: Close the documented divergence, then validate
**Story:** ST-1071-6
**Type:** docs

> **Operator amendment (2026-07-28): steps 1 and 2's shared-artifact edits are DONE — do not
> redo them.** The four DECIDE artifacts below belong to #1069 and #927, not to this feature.
> Editing them in-branch tripped the protected-artifact seal, which halts on third-party
> amendments by design (`adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
> §Decision, §Consequences — only own-feature self-amendment is tolerated). They were therefore
> landed on `main` as a standalone docs PR (**#1111**, merged 2026-07-28T18:14Z):
>
> - `adr-2026-07-24-...-fresh-session-scope.md` §2 → unconditional
> - `adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md` → divergence-closed pointer
> - `.docs/stories/fresh-session-per-step.md`
> - `.docs/stories/per-step-provider-routing-927.md` ST-927-7
>
> This branch now carries those files byte-identical to `origin/main`, so the seal tolerates them
> via the #976 base-inheritance path (`protected-artifact-seal.ts:390,398`) rather than halting.
> **Re-editing any of the four re-breaks the seal.** Only the non-sealed items remain: `HARNESS.md`,
> `docs/explanation/architecture.md`, and steps 3-5.

**Steps:**
1. ~~Amend the two fresh-session ADRs~~ — **done in #1111**. Still do: update `HARNESS.md:237-241`
   to state that every dispatch, including every retry, starts a fresh session — no provider
   qualifier, no within-step exception. (`HARNESS.md` is not a protected artifact.)
2. ~~Amend `.docs/stories/fresh-session-per-step.md:100-126` and
   `.docs/stories/per-step-provider-routing-927.md` ST-927-7~~ — **done in #1111**. Still do:
   update `docs/explanation/architecture.md` near `:143`.
3. Add a `CHANGELOG.md` `[Unreleased]` entry. Confirm no `bin/conduct-ts` flag, hook wiring,
   skill symlink target, or `settings.json` schema change occurred, so no migration block is
   required; if the release gate's path classifier flags a surface anyway, commit
   `.docs/release-waivers/claude-within-step-retries-resume-the-prior-attemp.md` naming every
   flagged canonical surface with a non-empty rationale — never an empty migration block.
4. Run `test/test_harness_integrity.sh` and the full `src/conductor` suite; fix any failure.
5. Commit: "docs: one fresh-session contract for every provider"

**Files likely touched:**
- `HARNESS.md`
- `CHANGELOG.md`
- `docs/explanation/architecture.md`

**Landed in #1111 — do NOT touch from this branch (protected artifacts of #1069 / #927):**
- `.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`
- `.docs/decisions/adr-2026-07-27-codex-never-resumes-a-harness-minted-session.md`
- `.docs/stories/fresh-session-per-step.md`
- `.docs/stories/per-step-provider-routing-927.md`

**Wired-into:** none
**Dependencies:** Task 15
