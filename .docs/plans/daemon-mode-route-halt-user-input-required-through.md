# Implementation Plan: Daemon stall remediation (halt-user-input-required → /remediate)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-daemon-stall-remediation.md (APPROVED)
**Stories:** .docs/stories/daemon-mode-route-halt-user-input-required-through.md (TR-1..TR-7)
**Conflict check:** Clean as of 2026-07-10 (.docs/conflicts/2026-07-10-daemon-stall-remediation.md)
**Issue:** jstoup111/ai-conductor#459

## Summary

Route daemon-mode `halt_marker` build stalls through the existing `/remediate` machinery
before halting, preserving the agent's question on every exit path. 16 tasks: 3 helper,
5 engine wiring, 4 negative-path test, 4 docs/contract.

## Technical Approach

All engine work lands inside `Conductor.run()` (`src/conductor/src/engine/conductor.ts`,
one method scope 1077+ — verified): `remediationRounds` (:1174), the retry loop (:1439),
the stall branch (:1761-1802), and `planRemediation()` (:766) are mutually reachable
without new plumbing.

- **Capture before clear.** New `readHaltMarkerContent()` in
  `src/conductor/src/engine/task-progress.ts` (returns the marker body, `null` on
  ENOENT). In the `stalled === 'halt_marker'` branch, read content and persist
  `.pipeline/build-stall-question.md` (verbatim; placeholder
  `(agent wrote no reason into halt-user-input-required)` when empty/whitespace/ENOENT)
  BEFORE the existing `clearHaltMarker()` call at :1769. Capture is unconditional
  (gitignored evidence, harmless in interactive mode); dispatch is daemon-gated.
- **Dispatch.** In daemon/auto mode only (`this.mode === 'auto'` path where today the
  REPL is skipped), when `remediationRounds < MAX_KICKBACKS_PER_GATE`: increment
  `remediationRounds`, emit a `kickback`-shaped event mirroring the prd_audit trigger
  (:2023-2040 region), and call `this.planRemediation(state, steps, <context naming the
  question>, { source: 'build_stall', evidenceFile: '.pipeline/build-stall-question.md' })`.
  `planRemediation` itself is REUSED UNCHANGED.
- **Consume in-loop** (not `navigateBack`): `route` with target `build` → set the
  loop-local `retryHint` to `outcome.hint`, `attempt--`, `continue` (sessionExpired idiom
  :1497-1509 — escalation ladder derives from `attempt`, so it cannot advance). `route`
  with any other target is fail-closed → question-carrying HALT. `halt`/`none`/throw/budget
  exhausted → question-carrying HALT.
- **Question-carrying HALT.** Write `.pipeline/HALT` with the question as the first
  non-empty line + disposition detail, then `break`. The existing preserve-specific-reason
  seam (:2229-2236) guarantees the generic "retries exhausted" writer keeps it.
  Interactive mode and the `no_task_progress` stall are untouched.
- **Contracts/docs.** `skills/remediate/SKILL.md` gains the stall-question input mode;
  `skills/pipeline/SKILL.md` documents daemon marker routing; READMEs + CHANGELOG per repo
  rules.

Tests: vitest in `src/conductor` (`cd src/conductor && rtk proxy npx vitest run …`),
following the existing conductor.test.ts fake-step-runner + tmp-repo pattern (daemon-gated
paths need `daemon: true` fixtures; see existing stall tests near conductor.test.ts:5896).

## Prerequisites

- None beyond repo setup (`npm install` in `src/conductor` for a fresh worktree).

## Tasks

### Task 1: readHaltMarkerContent helper
**Story:** TR-1 (capture) — foundation
**Type:** infrastructure

**Steps:**
1. Write failing tests: `readHaltMarkerContent(root)` returns exact multi-line body;
   returns `null` on missing file; returns raw string (possibly empty) when file empty.
2. Verify RED.
3. Implement in `task-progress.ts` beside `haltMarkerExists` (same
   `HALT_MARKER_RELATIVE` path; `readFile` + catch → null). `clearHaltMarker` unchanged.
4. Verify GREEN.
5. Commit: "feat(engine): readHaltMarkerContent reads stall marker body"

**Files:**
- src/conductor/src/engine/task-progress.ts
- src/conductor/test/engine/task-progress.test.ts

**Dependencies:** none

### Task 2: persist stall-question evidence file
**Story:** TR-1 happy (evidence file), TR-5 (source of HALT question)
**Type:** infrastructure

**Steps:**
1. Write failing tests for `writeStallQuestionEvidence(root, content)`: verbatim
   multi-line write to `.pipeline/build-stall-question.md`; placeholder line when content
   is null/empty/whitespace; returns the effective text written (so callers reuse it for
   the HALT).
2. Verify RED.
3. Implement in `task-progress.ts` (mkdir -p `.pipeline`, overwrite semantics).
4. Verify GREEN.
5. Commit: "feat(engine): persist build-stall question evidence"

**Files:**
- src/conductor/src/engine/task-progress.ts
- src/conductor/test/engine/task-progress.test.ts

**Dependencies:** Task 1

### Task 3: capture-before-clear in the stall branch
**Story:** TR-1 happy (content captured before clearHaltMarker; build_stall event still fires)
**Type:** happy-path

**Steps:**
1. Write failing engine test: daemon build gate miss with marker content → after the
   stall branch runs, `.pipeline/build-stall-question.md` holds the content AND the
   marker is gone; instrument ordering (e.g. capture runs before `clearHaltMarker` — spy
   or filesystem-state assertion at event emission time).
2. Verify RED.
3. Implement: in `conductor.ts` stall branch (:1761), before `clearHaltMarker(…)`:
   `const question = await readHaltMarkerContent(...)`;
   `const effectiveQuestion = await writeStallQuestionEvidence(...)`. Keep `build_stall`
   + `halt_cleared` emission unchanged.
4. Verify GREEN.
5. Commit: "feat(engine): capture stall question before clearing marker"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 2

### Task 4: daemon-gated build_stall remediation dispatch
**Story:** TR-2 happy (dispatch with context + hintSource; round recorded)
**Type:** happy-path

**Steps:**
1. Write failing test: daemon mode + marker stall + budget available → fake step runner
   records exactly one `run('remediate', …)` whose retryReason names the stall question;
   `remediationRounds` accounting observable via a second dispatch being budget-checked;
   kickback-shaped event emitted.
2. Verify RED.
3. Implement: in the stall branch, daemon/auto path (where the REPL is skipped today):
   budget check → `remediationRounds++` → emit event (mirror :2023-2040 shape, source
   `build_stall`) → `await this.planRemediation(state, steps, context, { source:
   'build_stall', evidenceFile: '.pipeline/build-stall-question.md' })` → hand outcome to
   Tasks 5-7 consumption (stub: fall through to existing break for now).
4. Verify GREEN.
5. Commit: "feat(engine): dispatch build_stall remediation in daemon mode"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 3

### Task 5: answerable stall resumes in-loop without burning a retry
**Story:** TR-3 happy (retryHint = answer, attempt unchanged, same-loop resume)
**Type:** happy-path

**Steps:**
1. Write failing test: remediation plan `{ dispositions: [{ id: 'stall:x', disposition:
   'build', tasks: [], rationale: '<answer>' }] }` → next `run('build', …)` in the SAME
   run receives the answer in `retryReason`; total build attempts allowed unchanged
   (assert a run with maxRetries N still gets N real attempts despite the stall);
   escalation ladder state (model/effort of resumed attempt) identical to pre-stall rung.
2. Verify RED.
3. Implement: on `outcome.kind === 'route' && outcome.target === 'build'`: `retryHint =
   outcome.hint; attempt--; continue;` (skip the REPL/recheck/break tail).
4. Verify GREEN.
5. Commit: "feat(engine): resume build from answered stall without burning a retry"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 4

### Task 6: question-carrying HALT writer for stall exits
**Story:** TR-4 happy (halt disposition → question first line + detail; survives generic writer)
**Type:** happy-path

**Steps:**
1. Write failing test: halt-disposition remediation plan → run exits halted;
   `.pipeline/HALT` first non-empty line equals the question's first line; detail
   (id/category/rationale) follows; after the full failure path completes the file does
   NOT contain "retries exhausted".
2. Verify RED.
3. Implement helper (local to conductor.ts): `writeStallHalt(effectiveQuestion, detail)`
   → `writeFile(LOOP_HALT_MARKER, question + '\n\n' + detail)`; call it for
   `outcome.kind === 'halt'`, then `break` (preserve seam :2229-2236 keeps it).
4. Verify GREEN.
5. Commit: "feat(engine): stall HALT carries the agent question verbatim"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 4

### Task 7: fail-closed consumption of non-build route targets
**Story:** TR-3 negative (route target ≠ build → HALT with question)
**Type:** negative-path

**Steps:**
1. Write failing test: remediation plan routing the stall to `plan` → no navigateBack, no
   resume; HALT carries the question.
2. Verify RED.
3. Implement: `route` with `target !== 'build'` falls into the Task 6 HALT path with
   detail naming the misroute.
4. Verify GREEN.
5. Commit: "feat(engine): non-build stall route is fail-closed to HALT"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 6

### Task 8: fail-safe matrix — question survives every degraded exit
**Story:** TR-5 (dispatch throws / malformed remediation.json / stale file / all-dropped
dispositions / budget exhausted)
**Type:** negative-path

**Steps:**
1. Write failing test matrix (5 cases): (a) fake runner throws on 'remediate'; (b)
   `.pipeline/remediation.json` is malformed JSON; (c) file older than session start
   (freshness check → null); (d) dispositions all invalid (halt without category); (e)
   `remediationRounds` already at cap (no dispatch call recorded). Every case: run exits
   halted, HALT first line = question, never generic/empty.
2. Verify RED.
3. Implement: wrap the dispatch in try/catch; `none` outcome and catch both route to the
   Task 6 HALT writer; budget-exhausted short-circuits before dispatch to the same writer.
4. Verify GREEN.
5. Commit: "feat(engine): stall question survives all degraded remediation exits"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 6

### Task 9: repeat-stall budget accounting
**Story:** TR-6 (third stall halts; shared with prd_audit; per-run reset), TR-3 negative
(resume does not reset budget)
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) two answered stalls then a third → no third dispatch, HALT
   with third question; (b) one stall round + a prd_audit-triggered round exhaust the
   shared budget together (combined accounting); (c) a fresh `run()` starts with budget
   reset (existing per-run semantics).
2. Verify RED (b/c may pass already — keep as regression pins if so, note in test).
3. Implement any accounting fix needed (expected: none beyond Tasks 4/8 — budget already
   shared via `remediationRounds`).
4. Verify GREEN.
5. Commit: "test(engine): stall remediation budget shared and bounded"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 8

### Task 10: TR-1 negative paths — empty marker, ENOENT race, multi-line
**Story:** TR-1 negatives
**Type:** negative-path

**Steps:**
1. Write failing engine tests: (a) empty/whitespace marker → evidence file holds the
   placeholder line and the dispatch still happens; (b) marker unlinked between existence
   check and read → placeholder path, no unhandled rejection; (c) multi-line marker →
   evidence verbatim, HALT first line = first marker line.
2. Verify RED where behavior is missing.
3. Implement gaps (expected: covered by Tasks 1-3 helpers; fix any).
4. Verify GREEN.
5. Commit: "test(engine): stall capture negative paths (empty/race/multi-line)"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts
- src/conductor/test/engine/task-progress.test.ts

**Dependencies:** Task 3

### Task 11: mode/scope guards — interactive, no_task_progress, auto-park ordering
**Story:** TR-2 negatives, TR-1 negative (interactive unchanged)
**Type:** negative-path

**Steps:**
1. Write failing/pinning tests: (a) interactive mode with marker → `runInteractive`
   called, remediate NOT dispatched (existing test near conductor.test.ts:5896 extended);
   (b) `no_task_progress` stall → remediate NOT dispatched; (c) auto-park condition met →
   park HALT wins, stall remediation branch never runs.
2. Verify RED/pin.
3. Implement guard fixes if any (expected: gating from Task 4 suffices).
4. Verify GREEN.
5. Commit: "test(engine): stall remediation gated to daemon halt_marker only"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 4

### Task 12: HALT content robustness
**Story:** TR-4 negatives (hostile characters / long line; empty rationale)
**Type:** negative-path

**Steps:**
1. Write failing tests: question with backticks/quotes/500-char line → `readHaltReason`
   (daemon-rekick.ts) returns the full first line; halt disposition with empty rationale
   → question line still present.
2. Verify RED where missing.
3. Implement (expected: plain writeFile already satisfies; fix detail-formatting edge).
4. Verify GREEN.
5. Commit: "test(engine): stall HALT content robust to hostile question text"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** Task 6

### Task 13: /remediate stall-question contract
**Story:** TR-7 happy (SKILL.md input mode) + TR-7 negative (gap modes unchanged)
**Type:** infrastructure

**Steps:**
1. Edit `skills/remediate/SKILL.md`: add the `build_stall` input class — evidence =
   `.pipeline/build-stall-question.md` (a question, not a gap list); disposition id
   `stall:<slug>`; answerable → `disposition: "build"`, `tasks: []`, answer in
   `rationale`; unanswerable → `disposition: "halt"` + existing category taxonomy;
   verify-claims/halt-on-uncertain unchanged; note tasks MAY be emitted and are appended
   normally. Keep gap-mode sections (tasks non-empty for build gaps) intact.
2. Run `test/test_harness_integrity.sh` (frontmatter/cross-refs).
3. Commit: "docs(remediate): stall-question input mode for build_stall trigger"

**Files:**
- skills/remediate/SKILL.md

**Dependencies:** none (parallel with engine tasks)

### Task 14: /pipeline marker semantics doc
**Story:** TR-7 happy (pipeline SKILL daemon semantics)
**Type:** infrastructure

**Steps:**
1. Edit `skills/pipeline/SKILL.md` "Halt-and-Escalate" section: document daemon-mode
   routing (engine captures the question, attempts one bounded /remediate pass, resumes
   with the answer or HALTs carrying the question verbatim); interactive REPL semantics
   unchanged.
2. Run `test/test_harness_integrity.sh`.
3. Commit: "docs(pipeline): daemon-mode halt-user-input-required routing"

**Files:**
- skills/pipeline/SKILL.md

**Dependencies:** Task 13 (consistent wording)

### Task 15: README documentation
**Story:** TR-7 Done When (docs-track-features rule)
**Type:** infrastructure

**Steps:**
1. Update `README.md` (daemon behavior section) + `src/conductor/README.md` (engine
   internals): stall→remediate routing, no-burn resume, question-carrying HALT,
   shared budget.
2. Commit: "docs: daemon stall remediation behavior"

**Files:**
- README.md
- src/conductor/README.md

**Dependencies:** Task 14

### Task 16: CHANGELOG + full validation
**Story:** repo release gates (CLAUDE.md)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → Added: daemon routes halt-user-input-required
   through /remediate before halting (#459); question preserved in HALT. (No Migration
   block: no settings schema / hook wiring / symlink / bin-conduct CLI change.)
2. Run full validation: `test/test_harness_integrity.sh` + `cd src/conductor && rtk proxy
   npx vitest run` (full suite; use TMUX_TMPDIR pattern if tmux-dependent tests need it).
3. Commit: "chore: changelog for #459 daemon stall remediation"

**Files:**
- CHANGELOG.md

**Dependencies:** Tasks 1-15

## Task Dependency Graph

```
1 → 2 → 3 → 4 → 5
            4 → 6 → 7
                6 → 8 → 9
            3 → 10
            4 → 11
            6 → 12
13 → 14 → 15          (docs chain, parallel to engine chain)
1-15 → 16
```

## Integration Points

- After Task 5: happy path demo-able end-to-end in a test repo (stall → answer → resume).
- After Task 8: every exit path verified question-preserving; safe to run under a real daemon.
- After Task 16: full suite green + harness integrity + changelog — ready for PR.

## Verification

- [ ] All happy path criteria covered: TR-1 (T3), TR-2 (T4), TR-3 (T5), TR-4 (T6), TR-5 (T8 happy via matrix), TR-6 (T9), TR-7 (T13-15)
- [ ] All negative path criteria covered: TR-1 (T10), TR-2 (T11), TR-3 (T7, T9a), TR-4 (T12), TR-5 (T8), TR-6 (T9), TR-7 (T13 gap-mode intact)
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
