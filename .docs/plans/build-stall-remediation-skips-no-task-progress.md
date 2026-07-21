# Implementation Plan: Build-stall auto-remediation must also fire for no_task_progress stalls (#569)

**Date:** 2026-07-20
**Design:** technical track (no PRD) — `.docs/track/build-stall-remediation-skips-no-task-progress.md`
**Stories:** `.docs/stories/build-stall-remediation-skips-no-task-progress.md`
**Complexity:** `.docs/complexity/build-stall-remediation-skips-no-task-progress.md` (Tier S)
**Conflict check:** Skipped (Small tier)
**Source:** `jstoup111/ai-conductor#569`

## Summary
Route `no_task_progress` (zero-work) build stalls through the same `/remediate` auto-remediation
dispatch that `halt_marker` stalls already get, instead of skipping remediation and falling straight
toward a terminal HALT. 7 tasks: 3 test-first behavior/pin tasks, 1 minimal production edit for the
routing fix, 1 production edit for the operator-legibility reason string, 1 invariant-guard test, and
1 docs/changelog task.

## Technical Approach
The build-step stall circuit breaker lives in `src/conductor/src/engine/conductor.ts` inside the
build retry loop. The stall verdict is set at `:3437-3441`: `halt_marker` when a marker exists, else
`no_task_progress` when `attempt >= 2 && resolvedTasksAfter <= resolvedTasksBefore`. The `if (stalled)`
block (`:3622-3855`) then does the remediation work — but every remediation lever is gated on
`effectiveQuestion`, which is **only populated for `stalled === 'halt_marker'`** (`:3632-3641`, via
`readHaltMarkerContent` + `writeStallQuestionEvidence`). For a `no_task_progress` stall
`effectiveQuestion` stays `null`, so the budget check (`:3655`) and the whole
`planRemediation` dispatch (`:3680-3811`) are skipped; control reaches the daemon+`no_task_progress`
fall-through guard (`:3832`) and continues the retry loop with no corrective `/remediate` dispatch
ever issued. The only terminal owner for this condition is the durable no-evidence counter /
`checkAndAutoPark` (`:3539-3620`), which halts/parks with no remediation attempt in between.

**Fix (Approach A):** populate `effectiveQuestion` for the `no_task_progress` branch by *synthesizing*
a remediation prompt from the run's own context, then let the existing dispatch run for both stall
kinds — with a `no_task_progress`-specific difference on the non-recovering outcomes so the durable
no-evidence counter keeps owning the terminal HALT decision.

1. **Synthesize the question** (`:3632-3641`). Keep the `halt_marker` branch as-is. Add an
   `else if (stalled === 'no_task_progress' && this.daemon && this.mode === 'auto')` branch that
   builds a prompt string from already-in-scope signals: `completion.reason` (the pending/not-completed
   task rows, e.g. `8/12 tasks pending/not completed: 2, 4, 5 (+5 more)`), the stall transition
   (`resolvedTasksBefore → resolvedTasksAfter`), and `this.taskEvidence?.noEvidenceReasons`
   (e.g. `zero_work_product`). Persist it via `writeStallQuestionEvidence(projectRoot, synthesized)`
   (its null/empty placeholder only triggers when passed null/empty, so a synthesized string flows
   through and reuses the `.pipeline/build-stall-question.md` evidence file) and assign
   `effectiveQuestion`. Introduce `const isZeroWorkStall = stalled === 'no_task_progress'` for the
   outcome branching below.
2. **Budget-exhaustion split** (`:3655-3678`). For `halt_marker`, keep the existing HALT-with-question
   fail-safe. For `isZeroWorkStall`, do NOT HALT on `remediationRounds >= MAX_KICKBACKS_PER_GATE` —
   skip dispatch and let control fall through to the retry/auto-park path (`:3856`+). Concretely: guard
   the budget-exhaustion HALT so it only fires for `!isZeroWorkStall`.
3. **Shared dispatch** (`:3680-3811`). The dispatch predicate already reads
   `this.daemon && this.mode === 'auto' && remediationRounds < MAX_KICKBACKS_PER_GATE && effectiveQuestion`
   — with `effectiveQuestion` now set for both kinds it runs for both. Use a distinguishing
   `hintSource` for the zero-work case (e.g. `{ source: 'build_stall_zero_work', evidenceFile:
   '.pipeline/build-stall-question.md' }`) so telemetry can tell the two apart. The `route → build`
   answerable path (`:3719-3735`: `retryHint = outcome.hint; attempt--; continue`) is correct for both
   and stays shared. For the non-recovering outcomes (`route`-misroute `:3737-3760`, `halt`
   `:3762-3784`, `none` `:3786-3810`, and the thrown-dispatch catch `:3695-3717`): keep the terminal
   HALT-and-`return` for `halt_marker`, but for `isZeroWorkStall` do NOT terminal-HALT — break out of
   the dispatch handling and fall through to the retry/auto-park path so the durable counter owns the
   terminal decision (invariant per the comment at `:3819-3831`).
4. **Fall-through guard unchanged** (`:3832`). The daemon+`no_task_progress` guard that skips the
   interactive REPL stays exactly as-is; after a non-routing zero-work remediation the code reaches
   `resolvedTasksBefore = resolvedTasksAfter` (`:3856`) and the retry loop continues.

**Guard/attempt-cap:** the zero-work remediation shares the existing `remediationRounds` counter and
`MAX_KICKBACKS_PER_GATE` (=2) cap — the same budget the `halt_marker` and other kickback lanes use —
so a stalling build cannot ping-pong `/remediate` indefinitely; once the shared budget is spent the
zero-work branch falls through to the durable no-evidence counter, which parks at
`DAEMON_NO_EVIDENCE_THRESHOLD`.

**Secondary (operator legibility, bundled per the issue thread).** When a build finally halts through
the generic terminal fallback (`:4557-4573`) after a `no_task_progress` stall history, the reason
reads the misleading `step 'build' failed in auto mode (retries exhausted)`. Set a step-scoped
`lastBuildStallReason` (mirroring the existing `unchangedInputNote` pattern, `:2765`/`:4571-4572`)
inside the `if (stalled)` block when `stalled === 'no_task_progress'`, and consult it at
`:4568-4573` so the generic fallback is replaced by a distinct `build stalled: no task progress …`
message. `existingHalt` still wins (a specific marker from auto-park/ceiling/remediation is never
overwritten); the new string only supplants the generic default. Precedence vs. `unchangedInputNote`
is made explicit in Task 5.

**Design-principle fit (CLAUDE.md).** Everything except the synthesized prompt text is deterministic
(the stall verdict, the shared budget, the routing, the counter accounting). Only the corrective
prompt synthesis and the `/remediate` reasoning are LLM work — the minimum judgement surface.

**Test strategy.** Drive behavior at the conductor level with the existing engine harness (a real
`Conductor` in `auto`/daemon mode with a stub `stepRunner`). Seed `.pipeline` task-status/derived
completion so the build gate misses with no forward progress across attempts (forcing
`stalled = 'no_task_progress'`), stub `stepRunner.run('remediate', …)` / `readRemediationPlan` to
return a chosen outcome (`route`/`halt`/`none`/throw), and assert: dispatch count, the synthesized
evidence-file contents, the `route→build` resume (`attempt--`), and the no-HALT fall-through for the
non-recovering outcomes. Locate/extend the existing build-stall remediation test file
(the tests covering `:3622-3855` today, e.g. the build-stall / remediation-dispatch engine spec).

## Prerequisites
- None. Single production file (`src/conductor/src/engine/conductor.ts`) plus tests within the
  existing `src/conductor` package. Run the engine test suite (`vitest`) from `src/conductor`.

## Tasks

### Task 1: RED — no_task_progress stall dispatches /remediate with a synthesized prompt
**Story:** "A no_task_progress stall gets an auto-remediation attempt before halting" — happy path.
**Type:** happy-path

**Steps:**
1. Write a failing test in the build-stall remediation engine spec: construct a `Conductor` in daemon
   `auto` mode; seed `.pipeline` so two build attempts both miss the completion gate with no forward
   progress (`resolvedTasksAfter <= resolvedTasksBefore`, `attempt >= 2`) and no halt marker, forcing
   `stalled = 'no_task_progress'`; stub `stepRunner.run` so a `remediate` dispatch is observable (spy)
   and `readRemediationPlan` returns a `route → build` plan. Assert the `remediate` dispatch was
   invoked exactly once and that `.pipeline/build-stall-question.md` contains the synthesized signals
   (completion reason + `resolvedBefore→resolvedAfter` + `zero_work_product` when the evidence tag is set).
2. Verify the test fails (RED) — on current code `effectiveQuestion` is null for `no_task_progress`,
   so the dispatch is never issued (spy call count 0).
3. (No implementation in this task — GREEN lands in Task 4.)
4. Leave the test failing; commit the RED test.
5. Commit with message: "test(#569): RED — no_task_progress stall must dispatch /remediate with synthesized prompt"

**Files likely touched:**
- `src/conductor/test/engine/*build-stall*` (existing build-stall/remediation engine spec) — new failing test

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 2: RED/pin — halt_marker stall path unchanged
**Story:** "The halt_marker stall path is unchanged by the fix" — invariant pin.
**Type:** negative-path

**Steps:**
1. Write/confirm tests pinning the `halt_marker` path: with a halt marker present, `effectiveQuestion`
   is read from the marker (`readHaltMarkerContent`), the dispatch fires with the marker question, and
   with `remediationRounds >= MAX_KICKBACKS_PER_GATE` the run writes the "Remediation budget exhausted"
   HALT and returns. (These pass on current code — regression pins that must STILL hold after Task 4.)
2. Verify the pins pass now (baseline), to be re-run after Task 4.
3. (No implementation — pins only.)
4. Confirm the halt_marker budget-exhaustion still HALTs (this is exactly the behavior that MUST
   differ for no_task_progress in Task 3).
5. Commit with message: "test(#569): pin halt_marker stall dispatch + budget-exhaustion HALT unchanged"

**Files likely touched:**
- `src/conductor/test/engine/*build-stall*` — halt_marker regression pins

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 3: RED — un-remediable no_task_progress falls through to retry/auto-park, not HALT
**Story:** "A no_task_progress stall that cannot be auto-remediated falls through to retry/auto-park,
not an immediate HALT" — negative path.
**Type:** negative-path

**Steps:**
1. Write failing tests for the zero-work non-recovery outcomes: (a) budget exhausted
   (`remediationRounds >= MAX_KICKBACKS_PER_GATE`) → no dispatch, no HALT marker, no early `return`,
   retry loop continues; (b) `planRemediation` returns `halt` / `none` / throws → no terminal HALT,
   fall through to retry; and assert the durable no-evidence counter still increments and
   `checkAndAutoPark` still parks at `DAEMON_NO_EVIDENCE_THRESHOLD`. Assert via absence of a written
   `.pipeline/HALT` from the stall block and presence of a subsequent retry/park.
2. Verify RED for the outcomes that require the new branch (a fresh dispatch for no_task_progress does
   not yet exist, so the `halt`/`none`/throw fall-through cannot be exercised until Task 4).
3. (No implementation — Task 4 supplies GREEN.)
4. Confirm the tests encode "durable counter owns the terminal decision" (invariant `:3819-3831`).
5. Commit with message: "test(#569): RED — un-remediable no_task_progress stall falls through to retry/auto-park"

**Files likely touched:**
- `src/conductor/test/engine/*build-stall*` — zero-work non-recovery fall-through tests

**Wired-into:** none (no new production surface)
**Dependencies:** none

### Task 4: GREEN — synthesize effectiveQuestion for no_task_progress and share the /remediate dispatch
**Story:** "A no_task_progress stall gets an auto-remediation attempt…" + "…falls through to
retry/auto-park…" — implementation; keeps Task 2 pins green.
**Type:** happy-path

**Steps:**
1. (REDs already exist from Tasks 1 & 3.)
2. Confirm Task 1 & Task 3 tests are RED.
3. Implement in `conductor.ts` inside the `if (stalled)` block (`:3622-3855`):
   (a) at `:3632-3641`, add the `no_task_progress` synthesis branch (from `completion.reason`,
   `resolvedTasksBefore→resolvedTasksAfter`, `taskEvidence.noEvidenceReasons`) writing via
   `writeStallQuestionEvidence` and setting `effectiveQuestion`; add `const isZeroWorkStall =
   stalled === 'no_task_progress'`.
   (b) at `:3655-3678`, guard the budget-exhaustion HALT with `!isZeroWorkStall`.
   (c) in the dispatch block (`:3680-3811`), pass a distinguishing `hintSource.source`
   (`'build_stall_zero_work'`) for the zero-work case; keep the shared `route → build` resume; and for
   `isZeroWorkStall` replace each terminal HALT-and-`return` on the non-recovering outcomes
   (throw/misroute/halt/none) with a fall-through (no HALT marker, no `return`) so control reaches
   `:3856` and the retry loop continues.
   Leave the `halt_marker` behavior and the `:3832` fall-through guard byte-for-byte.
4. Verify Tasks 1 & 3 pass (GREEN) and Task 2 pins remain green. Run the full build-stall / remediation
   engine test suite to confirm no regressions.
5. Commit with message: "fix(#569): route no_task_progress build stalls through /remediate before halting"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — synthesize `effectiveQuestion` for no_task_progress; share the dispatch; zero-work non-recovery falls through instead of terminal-HALT

**Wired-into:** the build-stall block at `src/conductor/src/engine/conductor.ts:3622-3855` is already
wired into the build-step retry loop; this task extends its existing `planRemediation` dispatch to the
no_task_progress branch — no new production surface, only a relaxed/duplicated predicate + a distinct
non-recovery fall-through.
**Dependencies:** Tasks 1, 3

### Task 5: GREEN — distinct terminal HALT reason for an exhausted no_task_progress build
**Story:** "An exhausted no_task_progress build halts with a distinct reason, not the generic
'retries exhausted'" — implementation.
**Type:** happy-path

**Steps:**
1. Write a failing test: a daemon-auto build that exhausts after a `no_task_progress` stall history
   (no more-specific HALT marker on disk) writes a HALT reason naming no-task-progress, not
   `step 'build' failed in auto mode (retries exhausted)`; plus a pin that an existing specific HALT
   marker (e.g. auto-park) is preserved, and a pin that a non-no_task_progress exhaustion keeps the
   pre-fix string.
2. Verify RED for the no_task_progress case.
3. Implement: set a step-scoped `lastBuildStallReason` when `stalled === 'no_task_progress'` inside the
   `if (stalled)` block (mirroring `unchangedInputNote`, `:2765`); at the terminal fallback
   (`:4568-4573`), when `existingHalt` is empty and `lastBuildStallReason` is set, use the distinct
   message (e.g. `build stalled: no task progress (<unresolved> tasks unresolved after <attempts>
   attempt(s))`). Define precedence explicitly relative to `unchangedInputNote` (document which wins).
4. Verify GREEN and both pins hold; confirm `existingHalt` still takes precedence.
5. Commit with message: "fix(#569): distinct HALT reason for no_task_progress build exhaustion (not 'retries exhausted')"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — step-scoped `lastBuildStallReason`; consult it at the terminal fallback (`:4568-4573`)
- `src/conductor/test/engine/*build-stall*` — terminal-reason tests

**Wired-into:** none (reason-string only; no new production surface)
**Dependencies:** Task 4

### Task 6: Guard — auto-park counter accounting and interactive mode unchanged
**Story:** "…falls through to retry/auto-park…" (invariant) + "halt_marker path unchanged".
**Type:** negative-path

**Steps:**
1. Write/extend a test asserting the surgical scope: the durable no-evidence counter still increments
   per no-progress attempt and resets on progress (`:3448-3465`), `checkAndAutoPark` still parks at
   `DAEMON_NO_EVIDENCE_THRESHOLD` with its existing reason (`:3603-3618`), and interactive
   (`this.mode !== 'auto'`) mode still reaches the REPL handoff (`:3833`) — none of these are altered
   by the fix.
2. Verify the test passes against the Task-4/5 tree (RED only if the edit over-reached into the
   counter/auto-park/interactive paths).
3. Implementation: none expected — this task proves the edit was surgical. If it fails, narrow the fix
   to the stall-dispatch branch only.
4. Verify GREEN; confirm `git show` for Tasks 4 & 5 touches only the stall block (`:3622-3855`) and the
   terminal fallback (`:4568-4573`), not `:3539-3620` (auto-park) or the interactive branch.
5. Commit with message: "test(#569): assert auto-park counter + interactive REPL paths unchanged by fix"

**Files likely touched:**
- `src/conductor/test/engine/*build-stall*` — invariant guard for counter/auto-park/interactive

**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 4, 5

### Task 7: Docs — CHANGELOG + behavior note
**Story:** all — documentation upkeep (harness convention: docs track features).
**Type:** infrastructure

**Steps:**
1. Add a `## [Unreleased]` → `### Fixed` entry to `CHANGELOG.md` describing #569: `no_task_progress`
   (zero-work) build stalls now route through the same `/remediate` auto-remediation dispatch as
   `halt_marker` stalls (synthesized prompt from the run's context), bounded by the shared
   `MAX_KICKBACKS_PER_GATE` budget, with the durable no-evidence counter still owning the terminal
   HALT/park decision; and note the distinct terminal HALT reason replacing the generic
   "retries exhausted" for no_task_progress exhaustion.
2. Verify the `[Unreleased]` block is non-empty (release CI gate) and that no `settings.json`/hook/CLI
   surface changed → no `## Migration` block required (internal engine behavior only; no CLI/hook/schema
   change, so no waiver either).
3. Confirm no README/`src/conductor/README.md` change is needed (no new `conduct`/`conduct-ts` flag or
   daemon option). If the daemon build-stall / auto-remediation behavior is documented in
   `src/conductor/README.md`, refine that note to state no_task_progress stalls are auto-remediated.
4. Re-read the CHANGELOG entry for accuracy.
5. Commit with message: "docs(#569): changelog + note for no_task_progress build-stall remediation"

**Files likely touched:**
- `CHANGELOG.md` — `[Unreleased] / Fixed` entry for #569
- `src/conductor/README.md` — refine build-stall/auto-remediation note if one exists

**Wired-into:** none (no new production surface)
**Dependencies:** Tasks 4, 5

## Task Dependency Graph
```
Task 1 (RED: no_task_progress dispatch) ──┐
Task 2 (pin: halt_marker unchanged) ──────┤
Task 3 (RED: non-recovery fall-through) ──┤
                                          ▼
             Task 4 (GREEN: synthesize + share dispatch)
                                          │
                                          ▼
             Task 5 (GREEN: distinct terminal reason)
                                          │
                          ┌───────────────┴───────────────┐
                          ▼                               ▼
        Task 6 (guard: counter/interactive)   Task 7 (docs / changelog)
```
Tasks 1, 2, 3 are independent and may run in any order (all before Task 4). Task 4 depends on Tasks 1
& 3. Task 5 depends on Task 4. Tasks 6 and 7 depend on Tasks 4 & 5 and are independent of each other.

## Integration Points
- After Task 4: a `no_task_progress` stall in daemon auto mode issues a real `/remediate` dispatch —
  Task 1's test observes a dispatch where none occurred before; Task 3's tests confirm the
  non-recovering outcomes fall through to the durable counter rather than HALTing; Task 2's pins
  confirm the halt_marker path is untouched.
- After Task 5: an exhausted no_task_progress build halts with an operator-legible reason.
- After Task 6: the fix is proven surgical — the auto-park counter, `checkAndAutoPark`, and the
  interactive REPL handoff are untouched.

## Verification
- [ ] All happy path criteria covered — no_task_progress dispatch (Task 1 RED → Task 4 GREEN);
      route→build resume without burning a retry (Task 1/4); distinct terminal reason (Task 5)
- [ ] All negative path criteria covered — halt_marker unchanged incl. budget-exhaustion HALT (Task 2);
      zero-work non-recovery falls through to retry/auto-park (Task 3); counter/auto-park/interactive
      unchanged (Task 6); non-no_task_progress exhaustion keeps pre-fix reason (Task 5)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] Only the stall block (`conductor.ts:3622-3855`) and terminal fallback (`:4568-4573`) are edited
      in production; the auto-park path (`:3539-3620`) and interactive handoff are untouched (Task 6)
- [ ] Zero-work remediation shares the existing `remediationRounds`/`MAX_KICKBACKS_PER_GATE` budget —
      no unbounded /remediate loop; durable no-evidence counter remains the terminal owner
- [ ] CHANGELOG `[Unreleased]` updated; no migration block required (internal-only, no CLI/hook/schema change)
