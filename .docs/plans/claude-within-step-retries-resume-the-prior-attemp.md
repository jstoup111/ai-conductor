# Implementation Plan: Cold-start within-step retries (#1071)

**Date:** 2026-07-27
**Stem:** claude-within-step-retries-resume-the-prior-attemp
**Track:** technical (no PRD)
**Tier:** M
**Stories:** `.docs/stories/claude-within-step-retries-resume-the-prior-attemp.md`
**Conflict check:** `.docs/conflicts/claude-within-step-retries-resume-the-prior-attemp.md` — PASSED
**ADR:** `.docs/decisions/adr-2026-07-27-cold-start-within-step-retries.md` — APPROVED
**Architecture review:** `.docs/decisions/architecture-review-claude-within-step-retries-resume-the-prior-attemp.md` — APPROVED, 3 conditions

## Summary

Make every autonomous provider dispatch a cold start with a freshly minted session
identifier, closing all **three** independent within-step resume authorities, and give the
operator-facing interactive recovery path explicit failure context so it can cold-start
without losing information. 18 tasks: 1 characterization, 3 core behavior changes (one per
authority), 1 interactive-context change, 3 invariant guards, 6 test inversions, 4
documentation.

## Technical Approach

**The seam.** `ProviderSessionScope.prepare()` (`engine/provider-session.ts:44-47`) returns
`{ id: session.id, resume: session.created }`. `created` flips on any non-skipped dispatch,
success or failure (`provider-execution.ts:401-409`), so attempt 2+ of a step resumes. The
change makes `prepare()` mint a new id every call and always return `resume: false`.

**Why the id must move with the flag.** `claude-provider.ts:649-653` selects
`--resume «id»` versus `--session-id «id»` on the flag alone. Suppressing the flag while
returning the scope-stable id would send `--session-id` against an id the CLI already
registered — the condition `SESSION_IN_USE_RE` (`claude-provider.ts:21-24`) exists to catch.
Codex is analogous (`codex-provider.ts:495-516`: `exec resume «id»` versus `exec`, and note
the resume form drops `--cd`, so cold start also restores the working-directory flag).

**Why three authorities, not one.** A fix confined to `provider-session.ts` leaves two live
resume paths:

| Authority | Location | Expression | Task |
|---|---|---|---|
| Provider session scope | `provider-session.ts:46` | `resume: session.created` | 3 |
| Concurrent-group branch | `group-core.ts:464-469` | `const resume = hasRun` | 5 |
| Legacy scalar | `step-runners.ts:529-530` | `resume = this.sessionStarted` | 7 |

**Why provider-neutral.** #903 has not landed (zero repo-wide hits for
`supportsSessionResume` / `coldStart`), and Codex resume is implemented and exercised today.
Claude and Codex currently behave identically; a Claude-only change would *create* the
divergence the issue asks to remove. No `supportsSessionResume` capability is introduced —
with no provider resuming it would have no reachable `true` case.

**What must survive.** `SESSION_IN_USE_RE`, `STALE_SESSION_RE`, `CODEX_SESSION_EXPIRED_RE`,
the `sessionExpired` signal, and the non-budget-consuming `session_reset` recovery all stay,
with meaning narrowed from "a resumed conversation went stale" to "the CLI rejected the id we
minted". `.pipeline/conduct-session-id` must not begin carrying per-invocation provider ids —
it is the step runner's run identity and backs `conductor.run.id`
(`otel/resource.ts:46-55`). Tasks 9-11 pin these as tests **before** Task 12 simplifies the
now-unused machinery, so a cleanup pass cannot delete a live recovery path unnoticed.

**Test inversions, not deletions.** Roughly a dozen assertions pin the removed behavior as
intended. Each is rewritten in place so the regression guard survives pointing the other way.

**Sequencing.** Task 1 characterizes today's behavior. Tasks 2-8 are RED/GREEN pairs, one per
authority. Tasks 9-11 add the survival guards. Task 12 is the optional cleanup, gated behind
those guards. Tasks 13-14 handle interactive recovery. Tasks 15-18 are documentation and the
mandatory validation suite.

## Prerequisites

- None. No new dependency, no config key, no schema migration, no step-topology change, no
  `bin/conduct-ts` flag change.

## Known adjacencies (informational)

- Issue **#903** (Codex fresh-session validation) overlaps this plan's remit but has landed
  no code. If it is dispatched to the daemon before this spec merges, the two will contend
  over `provider-session.ts` and `codex-provider.ts`. Recommendation recorded in the ADR:
  close #903 as resolved by this change.
- Issue **#999** supplies the retry-volume evidence only; no code surface.

## Task Dependency Graph

```
T1 ──┬─► T2 ─► T3 ─► T4 ──┐
     ├─► T5 ─► T6 ────────┤
     ├─► T7 ─► T8 ────────┤
     ├─► T9 ──────────────┤
     ├─► T10 ─────────────┼─► T12 ─► T15 ─► T16 ─► T17 ─► T18
     ├─► T11 ─────────────┤
     └─► T13 ─► T14 ──────┘
```

T2-T4, T5-T6, T7-T8, T9, T10, T11 and T13-T14 are independent chains after T1 and may run in
any order. T12 requires every guard (T9, T10, T11) and every behavior change (T4, T6, T8) to
be green first.

## Tasks

### Task 1: Characterize today's within-step resume behavior
**Story:** ST-1071-1
**Type:** characterization

**Steps:**
1. Write a characterization test asserting the *current* behavior at all three authorities:
   provider-scope retry resumes with a stable id; branch retry resumes; scalar retry resumes.
2. Verify it passes against unmodified `main` (it documents the baseline being replaced).
3. Implement: nothing.
4. n/a
5. Commit: "test(engine): characterize current within-step resume at all three authorities"

**Files likely touched:**
- `src/conductor/test/engine/provider-session.test.ts` — baseline describe block

**Wired-into:** none
**Dependencies:** none

### Task 2: RED — provider-scope retry must cold-start with a fresh id
**Story:** ST-1071-1
**Type:** happy-path

**Steps:**
1. Write failing test: a step dispatches to Claude, fails, retries; assert attempt 2 receives
   `resume === false` **and** `sessionId !== ` attempt 1's id.
2. Verify test fails (RED — today attempt 2 is `resume: true` with the same id).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for cold-start provider-scope retry"

**Files likely touched:**
- `src/conductor/test/engine/provider-session.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 3: GREEN — `prepare()` mints per invocation and never resumes
**Story:** ST-1071-1
**Type:** happy-path

**Steps:**
1. Confirm Task 2's test is RED.
2. Implement in `engine/provider-session.ts`: `prepare(providerKey)` mints a fresh id on every
   call and returns `{ id, resume: false }`. Keep the scope map entry so `current()` and the
   legacy mirror keep reporting the latest id; do not delete `created`/`markCreated` yet
   (Task 12 decides their fate behind the guards).
3. Verify Task 2's test passes (GREEN).
4. Run `src/conductor/test/engine/provider-session.test.ts` and
   `src/conductor/test/engine/provider-execution.test.ts`; expect the pinned old-behavior
   assertions to fail — they are inverted in Task 4.
5. Commit: "feat(engine): mint a fresh provider session per invocation, never resume"

**Files likely touched:**
- `src/conductor/src/engine/provider-session.ts` — `prepare()`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`
**Dependencies:** Task 2

### Task 4: Invert the provider-scope and provider-execution assertions
**Story:** ST-1071-1
**Type:** refactor

**Steps:**
1. Rewrite the expected tables to assert cold start with distinct ids:
   `provider-session.test.ts:178-195` (`retryClaude`, `codexAfterClaudeReplacement`,
   branch retry rows) and `provider-execution.test.ts:164`
   (`'still resumes within a step…'` → `'still cold-starts within a step…'`).
2. Verify `provider-execution.test.ts:116` (self-host never resumes) still passes **unchanged**
   — cold start is a superset of that guarantee.
3. Implement: no production change.
4. Verify the whole `test/engine/` suite is green.
5. Commit: "test(engine): invert within-step resume assertions to cold start"

**Files likely touched:**
- `src/conductor/test/engine/provider-session.test.ts`
- `src/conductor/test/engine/provider-execution.test.ts`

**Wired-into:** none
**Dependencies:** Task 3

### Task 5: RED — concurrent-group branch retry must cold-start
**Story:** ST-1071-2
**Type:** happy-path

**Steps:**
1. Write failing tests for both branch paths: with `providerSessions`, and with the scalar
   `mintSessionId` path. Assert a branch member's retry gets `resume === false` and a new id,
   and that cross-branch isolation still holds (branch A never sees branch B's id).
2. Verify tests fail (RED — `const resume = hasRun` yields `true`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for cold-start branch-member retry"

**Files likely touched:**
- `src/conductor/test/engine/group-core.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 6: GREEN — branch executor never resumes on retry
**Story:** ST-1071-2
**Type:** happy-path

**Steps:**
1. Confirm Task 5 is RED.
2. Implement in `engine/group-core.ts:444-495`: dispatch with `resume: false` unconditionally,
   and mint a new `sessionId` per dispatch in the scalar path rather than only on
   `sessionExpired`. Remove `hasRun`'s resume role; keep it if it still serves retry
   accounting, otherwise delete it.
3. Verify Task 5's tests pass and the `sessionExpired` non-consuming re-run
   (`group-core.ts:525-537`) still does not decrement retry budget.
4. Run `test/engine/group-core.test.ts` and any concurrent-group acceptance tests.
5. Commit: "feat(engine): cold-start concurrent-group branch retries"

**Files likely touched:**
- `src/conductor/src/engine/group-core.ts` — branch dispatch loop

**Wired-into:** `src/conductor/src/engine/group-core.ts#branch executor dispatch`
**Dependencies:** Task 5

### Task 7: RED — legacy scalar path retry must cold-start
**Story:** ST-1071-3
**Type:** happy-path

**Steps:**
1. Write failing tests: a single-provider run with no session store retries a step and gets
   `resume === false` with a fresh id; and an inherited `.pipeline/session-created` marker
   does not produce a resume.
2. Verify tests fail (RED — `resume = this.sessionStarted`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for cold-start legacy scalar retry"

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 8: GREEN — scalar path cold-starts; `session-created` loses its resume role
**Story:** ST-1071-3
**Type:** happy-path

**Steps:**
1. Confirm Task 7 is RED.
2. Implement in `engine/step-runners.ts:525-531`: the no-store branch resolves `resume = false`
   and mints a fresh `this.sessionId` per dispatch. In `execution/session.ts:83-90`, stop
   returning `--resume` on the created marker.
3. Verify the marker is still **persisted** (the `.pipeline` durability specs assert
   persistence, not resume) and that Task 7's tests pass.
4. Run `test/engine/step-runners.test.ts`, `test/execution/session.test.ts`,
   `test/acceptance/pipeline-durability.test.ts`.
5. Commit: "feat(engine): cold-start legacy scalar within-step retries"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — `run()` resume derivation
- `src/conductor/src/execution/session.ts` — argv selection

**Wired-into:** `src/conductor/src/engine/step-runners.ts#StepRunner.run`
**Dependencies:** Task 7

### Task 9: Guard — stale/in-use recovery survives for both providers
**Story:** ST-1071-5
**Type:** negative-path

**Steps:**
1. Write tests asserting that after the change, an "already in use" / "No conversation found"
   Claude output and a `no rollout found` / `thread/resume failed` Codex output each still set
   `sessionExpired`, still emit `session_reset`, and still do **not** consume retry budget.
2. Verify they pass against the current implementation (they are survival guards, not RED).
3. Implement: no production change expected; fix if a regression is exposed.
4. Verify green.
5. Commit: "test(engine): guard sessionExpired recovery survives cold-start default"

**Files likely touched:**
- `src/conductor/test/engine/provider-execution.test.ts`
- `src/conductor/test/execution/claude-provider.test.ts`
- `src/conductor/test/execution/codex-provider.test.ts`

**Wired-into:** none
**Dependencies:** Task 1

### Task 10: Guard — `conductor.run.id` is stable across cold-started attempts
**Story:** ST-1071-5
**Type:** negative-path

**Steps:**
1. Write a test asserting `conductor.run.id` is identical across multiple cold-started attempts
   in one feature run, and that `.pipeline/conduct-session-id` is **not** rewritten per provider
   invocation.
2. Verify it passes (`ProviderSessionScope` never writes that file today).
3. Implement: no production change expected.
4. Verify green.
5. Commit: "test(otel): guard run-id stability across cold-started attempts"

**Files likely touched:**
- `src/conductor/test/engine/otel/resource.test.ts` (or the nearest existing OTel test)

**Wired-into:** none
**Dependencies:** Task 1

### Task 11: Guard — a retry completes from committed artifacts alone
**Story:** ST-1071-1
**Type:** negative-path

**Steps:**
1. Write an acceptance test for the ADR Decision 4 contract: a step whose first attempt
   commits partial work and fails, whose cold-started retry receives only the
   `RETRY: «reason»` system prompt and the committed artifacts, still completes.
2. Verify RED-or-green honestly; if it fails, the failure is the real risk this change carries
   and must be surfaced, not worked around by restoring resume.
3. Implement: only artifact/prompt-sourced fixes if needed — never a resume.
4. Verify green.
5. Commit: "test(acceptance): a cold-started retry completes from committed artifacts"

**Files likely touched:**
- `src/conductor/test/acceptance/retry-cold-start-1071.acceptance.test.ts` — new

**Wired-into:** none
**Dependencies:** Task 1

### Task 12: Simplify the now-unused resume machinery
**Story:** ST-1071-1
**Type:** refactor

**Steps:**
1. With Tasks 4, 6, 8, 9, 10 and 11 green, evaluate `ProviderSession.created`, `markCreated`,
   and `forceFreshSession` (`provider-execution.ts:376, 386, 397, 546`). Delete what has no
   remaining consumer; retain anything still serving scope bookkeeping or the legacy mirror.
2. Verify no deletion touches `SESSION_IN_USE_RE`, `STALE_SESSION_RE`,
   `CODEX_SESSION_EXPIRED_RE`, `sessionExpired`, or `session_reset` (ADR Decision 6).
3. Implement the deletions.
4. Verify the full `src/conductor` suite is green, including
   `provider-execution.test.ts:116`, which must still pass.
5. Commit: "refactor(engine): drop resume bookkeeping with no remaining consumer"

**Files likely touched:**
- `src/conductor/src/engine/provider-session.ts`
- `src/conductor/src/engine/provider-execution.ts`

**Wired-into:** `src/conductor/src/engine/provider-execution.ts#invokeProviderCandidate`
**Dependencies:** Task 4, Task 6, Task 8, Task 9, Task 10, Task 11

### Task 13: RED — interactive recovery carries the failure context
**Story:** ST-1071-4
**Type:** happy-path

**Steps:**
1. Write failing tests: the prompt handed to the provider by `runInteractive` names the failed
   step and carries the failure reason, for the stall-breaker (`conductor.ts:4785`) and the
   recovery-menu (`conductor.ts:5808`) call sites; and the dispatch is `resume: false` on both
   the provider-aware and legacy paths.
2. Verify RED (today: a 12-word stub, empty system prompt, `resume: true`).
3. Implement: nothing yet.
4. n/a
5. Commit: "test(engine): RED for context-carrying interactive recovery"

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts`
- `src/conductor/test/engine/conductor-recovery.test.ts` (or nearest existing)

**Wired-into:** none
**Dependencies:** Task 1

### Task 14: GREEN — thread failure context into `runInteractive`
**Story:** ST-1071-4
**Type:** happy-path

**Steps:**
1. Confirm Task 13 is RED.
2. Implement: add a failure-context parameter to `runInteractive` on the runner interface
   (`conductor.ts:539`) and its implementation (`step-runners.ts:1141-1166`); render it into
   the prompt; pass the same content that feeds `retryHint` (`conductor.ts:4076`) from both
   call sites; drop `resume: true` on both paths.
3. Verify Task 13's tests pass, including the missing-reason case producing an explicit
   "no reason captured" statement rather than a silent stub.
4. Verify the recheck-and-break flow after the interactive session is unchanged.
5. Commit: "feat(engine): interactive recovery cold-starts with explicit failure context"

**Files likely touched:**
- `src/conductor/src/engine/step-runners.ts` — `runInteractive`
- `src/conductor/src/engine/conductor.ts` — interface + two call sites

**Wired-into:** `src/conductor/src/engine/conductor.ts#stall-breaker`, `#recovery menu`
**Dependencies:** Task 13

### Task 15: Invert the acceptance-level resume assertions
**Story:** ST-1071-1
**Type:** refactor

**Steps:**
1. Rewrite `per-step-provider-routing-927.acceptance.test.ts:962-964` and `:365-368` to assert
   cold start with distinct ids; update the test name at `:922`.
2. Rewrite the `resume` column of `retry-as-escalation.acceptance.test.ts:325-377` to `false`
   throughout, leaving the ordered model/effort ladder assertions untouched, and confirm the
   S10 non-consuming stale-session case (`:413-444`) still holds.
3. Invert `step-runners.test.ts:791/843-844, 1472/1481-1482, 1671-1698, 2333/2351-2353` and
   `session.test.ts:89`.
4. Verify the full test suite is green.
5. Commit: "test: invert acceptance assertions to the cold-start retry contract"

**Files likely touched:**
- `src/conductor/test/acceptance/per-step-provider-routing-927.acceptance.test.ts`
- `src/conductor/test/acceptance/retry-as-escalation.acceptance.test.ts`
- `src/conductor/test/engine/step-runners.test.ts`
- `src/conductor/test/execution/session.test.ts`

**Wired-into:** none
**Dependencies:** Task 12, Task 14

### Task 16: Amend the superseded contract documents
**Story:** ST-1071-6
**Type:** docs

**Steps:**
1. Mark `adr-2026-07-24-provider-aware-step-execution-fresh-session-scope` §2 superseded with a
   forward pointer to `adr-2026-07-27-cold-start-within-step-retries`; leave §1, §3 and §5
   unchanged.
2. Amend `.docs/stories/fresh-session-per-step.md:100-126` in place — rewrite the criteria to
   assert cold start, keep the step-boundary guarantee, add a supersession note.
3. Amend `.docs/stories/per-step-provider-routing-927.md` ST-927-7 `:309-311` and its Done-When
   `:337-341`.
4. Verify no document still asserts that a within-step retry resumes.
5. Commit: "docs: supersede the within-step resume contract"

**Files likely touched:**
- `.docs/decisions/adr-2026-07-24-provider-aware-step-execution-fresh-session-scope.md`
- `.docs/stories/fresh-session-per-step.md`
- `.docs/stories/per-step-provider-routing-927.md`

**Wired-into:** none
**Dependencies:** Task 15

### Task 17: Update HARNESS.md and CHANGELOG
**Story:** ST-1071-6
**Type:** docs

**Steps:**
1. Rewrite `HARNESS.md:237-241` to state that every dispatch, including every retry, starts a
   fresh session, with no provider qualifier and no within-step exception.
2. Add a `CHANGELOG.md` `[Unreleased]` entry describing the new retry semantics (notable,
   reader-visible implementation change).
3. Confirm no `bin/conduct-ts` flag, hook wiring, skill symlink target, or `settings.json`
   schema change occurred, so no migration block is required.
4. If the release gate's path classifier flags a breaking surface anyway, commit a
   `.docs/release-waivers/claude-within-step-retries-resume-the-prior-attemp.md` naming every
   flagged canonical surface with a non-empty rationale — never an empty migration block.
5. Commit: "docs: one retry-session contract for every provider"

**Files likely touched:**
- `HARNESS.md`
- `CHANGELOG.md`
- `.docs/release-waivers/claude-within-step-retries-resume-the-prior-attemp.md` (only if flagged)

**Wired-into:** none
**Dependencies:** Task 16

### Task 18: Run the mandatory validation suite
**Story:** ST-1071-6
**Type:** verification

**Steps:**
1. Run `test/test_harness_integrity.sh`.
2. Run the full `src/conductor` test suite.
3. Fix any failure before committing.
4. Verify green.
5. Commit: "chore: validation suite green for cold-start retries"

**Files likely touched:**
- any file a validation failure identifies

**Wired-into:** none
**Dependencies:** Task 17
