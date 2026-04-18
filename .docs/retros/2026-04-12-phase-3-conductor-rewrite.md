# Retro: Phase 3 — Conductor Rewrite (TypeScript)
**Date:** 2026-04-12 | **Stats:** 38 tasks, 0 rework cycles, 2 interventions, 310 tests passing, 47 commits, 12,660 lines added

## Part A: Harness

### A1. Correctness
- **H-1:** Subagents created separate task branches instead of committing to `feature/phase-3-conductor-rewrite`. Required manual fast-forward merge at the end. No code was lost but this is fragile — a crash between agent completion and merge would orphan work. **Severity:** medium. **Fix:** TDD skill should instruct subagents to commit on the current branch, not create new branches.

### A2. Gate Quality
- **H-2:** No `.pipeline/` directory was ever created — the harness had no conduct-state.json tracking which tasks were done. Progress was tracked informally by checking which files existed. **Severity:** low. **Fix:** When running outside the bash conductor (i.e., manually invoking skills), `/conduct` should still create and maintain `conduct-state.json` for state tracking.

### A3. Autonomy
- **H-3:** Computer restart lost all uncommitted work (~10K lines). The harness has no auto-commit or checkpoint-save mechanism during long BUILD phases. Required manual recovery at session start. **Severity:** high. **Fix:** Pipeline skill should commit after each completed task, not defer commits. The TDD skill already commits per cycle, but the pipeline wrapper should enforce this.
- **H-4:** `node_modules` was nearly committed (staged accidentally). No `.gitignore` existed for the new `src/conductor/` directory. **Severity:** low. **Fix:** Bootstrap or scaffold step should generate `.gitignore` when creating new sub-projects.

**Proposed changes:**
- [ ] H-1: Add `--no-new-branch` guidance to TDD subagent dispatch instructions in `skills/tdd/SKILL.md`
- [ ] H-3: Add "commit after each task" as a hard gate in `skills/pipeline/SKILL.md`
- [ ] H-4: Add `.gitignore` generation to bootstrap scaffolding for TypeScript projects

## Part B: Application

- **A-1:** `Conductor.run()` is 109 lines with 13 conditional branches. Exceeds the 15-line/3-branch thresholds. Contains state mgmt, step execution, SIGINT handling, checkpoints, navigation, and failure recovery. `conductor.ts:83-191`. **Severity:** medium. **Fix:** Extract checkpoint/navigation into a private method, extract SIGINT setup/teardown into a helper.
- **A-2:** Rate limit regex duplicated in 3 locations: `recovery.ts:54`, `claude-provider.ts:4`, `session.ts:87`. Stale session regex duplicated in 2 locations. **Severity:** low. **Fix:** Extract to a shared `patterns.ts` constants file.
- **A-3:** `writeState()` in `state.ts:45` has no error handling — disk-full or permission errors crash the process. Called 11 times from `conductor.ts` with no guards. **Severity:** medium. **Fix:** Return `StateResult<void>` instead of throwing, handle in conductor.
- **A-4:** `worktree.ts:52-59, 80-95` swallows exceptions silently in 3 catch blocks — no logging, no indication to caller that git operations failed. **Severity:** low. **Fix:** Add error field to return type or emit diagnostic events.
- **A-5:** `conductor.ts:84-85` silently falls back to empty state when `readState()` returns error. No test covers the corrupted-state-on-run path. **Severity:** low. **Fix:** Add test for conductor behavior when state file is corrupted.
- **A-6:** SIGINT handler cleanup duplicated in 4 locations (`conductor.ts:120, 151, 179, 185`). **Severity:** low. **Fix:** Use try/finally block wrapping the main loop.
- **A-7:** `state.ts:127` uses `as Record<string, unknown>` cast to bypass ConductState type safety in `markDownstreamStale`. **Severity:** low. **Fix:** Add an index signature or setter method to ConductState.

**Proposed changes:**
- [ ] A-1: Extract `handleCheckpoint()` and `setupSignalHandler()` from `Conductor.run()` → new story
- [ ] A-2: Create `src/engine/patterns.ts` with shared regex constants → new story
- [ ] A-3: Make `writeState()` return `StateResult<void>`, add error handling in conductor → new story
- [ ] A-6: Refactor SIGINT cleanup to try/finally → bundle with A-1

### B2. Test Quality
- **A-8:** No tests for `writeState()` I/O failures (disk full, permissions). **Severity:** low.
- **A-9:** No tests for `Conductor.run()` when `readState()` returns corrupted error. **Severity:** low.
- **A-10:** Worktree `create()` has no tests for git command failures or mkdir failures. **Severity:** low.

### B3. Security, Performance & Debt
No issues.

## Part C: Context Efficiency

- **C-1:** Each TDD task was dispatched as a fresh subagent with full context re-briefing (type signatures, module APIs, implementation guidance). Tasks 20-25 all modified the same file (`conductor.ts`) — using `SendMessage` to continue an existing agent would have avoided re-reading the same files 6 times. **Impact:** ~30K tokens wasted on redundant file reads. **Fix:** TDD skill guidance should prefer `SendMessage` for sequential tasks touching the same files.
- **C-2:** Tasks 34 and 35 were correctly parallelized (independent files). Tasks 37 and 38 were also parallelized. This was efficient. However, Tasks 20-25 were run sequentially with full agent teardown/setup — they could have been dispatched as a single agent with sequential instructions. **Impact:** ~50K tokens in agent setup overhead. **Fix:** Pipeline skill should batch sequential tasks on the same file into a single agent dispatch.
- **C-3:** The code quality review for this retro dispatched a single Explore agent that read all 22 source files and 17 test files. This was appropriate for the scope. No optimization needed.

**Proposed changes:**
- [ ] C-1: Add "reuse subagent via SendMessage for sequential tasks on same files" to `skills/tdd/SKILL.md` structural enforcement table
- [ ] C-2: Add task batching guidance to `skills/pipeline/SKILL.md` for sequential same-file tasks

## Trends
First retro for this project — no prior data for comparison. Baseline established:
- 0 rework cycles (clean TDD execution)
- 2 interventions (both infrastructure: restart recovery, branch consolidation)
- 310 tests for ~1,960 lines of implementation (~6.3 tests per function)
