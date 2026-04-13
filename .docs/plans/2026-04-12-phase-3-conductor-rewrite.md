# Implementation Plan: Phase 3 — Conductor Rewrite in TypeScript

**Date:** 2026-04-12
**Design:** .docs/specs/2026-04-12-pluggable-harness-architecture.md
**Stories:** .docs/stories/features/conduct/ST-001 through ST-011
**Conflict check:** Clean as of 2026-04-12 (no blocking conflicts for conductor stories)
**Tech stack:** .docs/specs/2026-04-12-phase-2-language-evaluation.md

## Summary

Rewrites the 3100-line bash conductor (`bin/conduct`) in TypeScript with a 3-layer architecture
(Engine/Execution/UI). 38 tasks across 13 batches, implementing all 11 conductor stories
(ST-001 through ST-011). Each batch is independently testable. TDD throughout: failing test
first, then implement to green.

## Prerequisites

- Node.js 20+ installed
- Working directory: `.worktrees/pluggable-harness` on branch `feature/phase-3-conductor-rewrite`
- All 11 conductor stories ACCEPTED (verified)

## Architecture Review Resolutions

**Blocking issue 1 — Canonical Small-tier skip list:**
Small skips exactly: `conflict_check`, `architecture_diagram`, `architecture_review`,
`acceptance_specs`, `retro`. The `pipeline`/`code-review` mentions in ST-005 refer to
sub-behaviors within the `build` step (not conductor-level steps) and are handled internally
by step runners.

**Blocking issue 2 — `--dangerously-skip-permissions`:**
All non-interactive Claude invocations include `--dangerously-skip-permissions`. Interactive
recovery sessions (ST-009 `i` option) omit it. Added to Task 12 (buildClaudeArgs) and Task 14.

**Blocking issue 3 — Live dashboard refresh:**
Task 33 (UI subscriber) owns periodic refresh: emits `dashboard_refresh` event every 10 seconds
during step execution via `setInterval`. Cleared when step completes or conductor exits.

**Non-blocking items deferred to implementation:**
- Signal handling (SIGINT saves state) — added to Task 20
- Step cooldown (10s default between Claude calls) — added to Task 14
- `--step`, `--reset` CLI flags — added to Task 34
- Elapsed time in dashboard — added to Task 28
- Session naming — added to Task 14
- Harness update/config checks — remain in bash wrapper (ADR-2)
- Desktop notifications, progress log — deferred to Phase 5

## Tasks

---

### Task 1: Project scaffolding — package.json and TypeScript config
**Story:** Infrastructure (enables all stories)
**Type:** infrastructure

**Steps:**
1. Create `src/conductor/package.json` with dependencies: typescript, vitest, tsup, ink, react,
   js-yaml, execa, commander, uuid. DevDeps: @types/node, @types/react, @types/js-yaml,
   ink-testing-library. Set `"type": "module"`.
2. Create `src/conductor/tsconfig.json` — strict mode, ES2022 target, NodeNext module resolution,
   JSX react-jsx, outDir dist/
3. Create `src/conductor/vitest.config.ts` — test directory, TypeScript transform
4. Create `src/conductor/tsup.config.ts` — entry src/index.ts, format esm, target node20
5. Run `npm install` — verify zero errors
6. Run `npx tsc --noEmit` — verify zero errors (no source files yet is OK)
7. Run `npx vitest run` — verify zero tests, zero errors

**Files likely touched:**
- `src/conductor/package.json` — new
- `src/conductor/tsconfig.json` — new
- `src/conductor/vitest.config.ts` — new
- `src/conductor/tsup.config.ts` — new

**Dependencies:** none

---

### Task 2: Type definitions — step registry types
**Story:** ST-001 (step progression), ST-005 (tier skipping)
**Type:** infrastructure

**Steps:**
1. Write type-check test in `test/types/steps.test.ts`: verify StepName union has 14 members,
   StepStatus has 6 values, Phase has 5 values, ComplexityTier has 3 values
2. Verify test fails (RED) — types don't exist
3. Create `src/types/steps.ts` with: StepName (14-member union), StepStatus ('pending' |
   'in_progress' | 'done' | 'failed' | 'skipped' | 'stale'), Phase ('SETUP' | 'UNDERSTAND' |
   'DECIDE' | 'BUILD' | 'SHIP'), ComplexityTier ('S' | 'M' | 'L'), EnforcementLevel,
   StepDefinition interface, RunMode, ViewMode
4. Verify test passes (GREEN)
5. Commit: "Add step registry type definitions"

**Files likely touched:**
- `src/types/steps.ts` — new
- `test/types/steps.test.ts` — new

**Dependencies:** Task 1

---

### Task 3: Type definitions — state file types
**Story:** ST-001 (state tracking), ST-011 (complexity in state)
**Type:** infrastructure

**Steps:**
1. Write type-check test: ConductState has all step name keys, plus metadata keys
   (feature_desc, complexity_tier, run_started_at, last_step, pr_url, worktree_dir,
   worktree_branch, feature_status)
2. Verify test fails (RED)
3. Create `src/types/state.ts` matching the existing conduct-state.json format from bash
4. Verify test passes (GREEN)
5. Commit: "Add state file type definitions"

**Files likely touched:**
- `src/types/state.ts` — new
- `test/types/state.test.ts` — new

**Dependencies:** Task 2

---

### Task 4: Type definitions — event and config types
**Story:** ST-002 (dashboard events), ST-003 (checkpoint events), ST-009 (recovery events)
**Type:** infrastructure

**Steps:**
1. Write type-check test: ConductorEvent discriminated union covers step_started, step_completed,
   step_failed, checkpoint_reached, recovery_needed, gate_blocked, tier_skip, navigation_back,
   rate_limit, session_reset, feature_complete, dashboard_refresh
2. Write type-check test: HarnessConfig has steps.disable, steps.add, skills.overrides,
   skills.hooks, complexity.default_tier
3. Verify tests fail (RED)
4. Create `src/types/events.ts` and `src/types/config.ts`
5. Verify tests pass (GREEN)
6. Commit: "Add event and config type definitions"

**Files likely touched:**
- `src/types/events.ts` — new
- `src/types/config.ts` — new
- `test/types/events.test.ts` — new

**Dependencies:** Task 2

---

### Task 5: State management — read/write conduct-state.json (happy paths)
**Story:** ST-001 happy paths: new feature starts at first step, step success updates state,
all steps complete sets feature_status
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/state.test.ts`:
   - `readState() returns default state when file does not exist`
   - `readState() loads existing conduct-state.json preserving all fields`
   - `saveStepStatus() writes step status and updates last_step`
   - `saveStepStatus() preserves all existing fields (no data loss)`
   - `getStepStatus() returns 'pending' for unknown steps`
   - `stepDone() returns true for 'done' and 'skipped'`
   - `stepDone() returns false for 'pending', 'in_progress', 'failed', 'stale'`
   - `stepSatisfied() returns true for 'done', 'skipped', and 'stale'`
   - `setComplexityTier() stores S/M/L under complexity_tier key`
   - `markFeatureComplete() sets feature_status to 'complete'`
2. Verify all tests fail (RED)
3. Implement `src/engine/state.ts`: readState, writeState, saveStepStatus, getStepStatus,
   stepDone, stepSatisfied, setComplexityTier, markFeatureComplete
4. Verify all tests pass (GREEN)
5. Commit: "Implement state management — read/write conduct-state.json"

**Files likely touched:**
- `src/engine/state.ts` — new
- `test/engine/state.test.ts` — new

**Dependencies:** Task 3

---

### Task 6: State management — error handling and backward compat (negative paths)
**Story:** ST-001 negative paths: corrupted JSON reports error, crash recovery via --resume
lands on in_progress step. Also backward compatibility with bash conductor.
**Type:** negative-path

**Steps:**
1. Write tests:
   - `readState() on corrupted JSON returns error object, not crash`
   - `readState() on empty file returns error object`
   - `Resume: state with step X as in_progress is correctly identified as resume point`
   - `Round-trip: bash-format state file is correctly read by TS`
   - `Round-trip: TS-written state is valid JSON readable by python3`
   - `markDownstreamStale() marks all done steps after target as stale`
   - `markDownstreamStale() leaves pending/failed/skipped steps unchanged`
2. Verify tests fail (RED)
3. Implement error handling in readState (try/catch JSON.parse, return Result type),
   add markDownstreamStale, ensure JSON output matches bash format exactly
4. Verify tests pass (GREEN)
5. Run bash round-trip verification: write state with TS, read with python3 -c
6. Commit: "Add state error handling and backward compatibility"

**Files likely touched:**
- `src/engine/state.ts` — modify
- `test/engine/state.test.ts` — add tests

**Dependencies:** Task 5

---

### Task 7: Step registry — ordered sequence and metadata
**Story:** ST-001 (14-step progression), ST-005 (tier metadata)
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/steps.test.ts`:
   - `ALL_STEPS has exactly 14 entries`
   - `ALL_STEPS is in correct order: worktree, memory, brainstorm, complexity, stories,
     conflict_check, plan, architecture_diagram, architecture_review, acceptance_specs,
     build, manual_test, retro, finish`
   - `getStepDefinition() returns correct label, phase, enforcement for each step`
   - `getStepIndex('brainstorm') returns correct index`
   - `getStepByIndex(0) returns worktree`
2. Verify tests fail (RED)
3. Implement `src/engine/steps.ts`: ALL_STEPS array with full StepDefinition metadata,
   getStepDefinition, getStepIndex, getStepByIndex
4. Verify tests pass (GREEN)
5. Commit: "Add step registry with ordered sequence and metadata"

**Files likely touched:**
- `src/engine/steps.ts` — new
- `test/engine/steps.test.ts` — new

**Dependencies:** Task 2

---

### Task 8: Tier-based step skipping
**Story:** ST-005 happy paths: Small skips specific steps, Medium runs all, Large runs all,
skipped steps show skip icon. ST-005 negative: user override changes tier.
**Type:** happy-path

**Steps:**
1. Write tests:
   - `shouldSkipForTier('conflict_check', 'S') returns true`
   - `shouldSkipForTier('conflict_check', 'M') returns false`
   - `shouldSkipForTier('conflict_check', 'L') returns false`
   - `shouldSkipForTier('build', 'S') returns false (build never skips)`
   - `Small tier skips exactly: conflict_check, architecture_diagram, architecture_review,
     acceptance_specs, retro` (canonical list per architecture review resolution)
   - `Medium and Large tier skip nothing`
   - `getSkippableSteps('S') returns correct list`
2. Verify tests fail (RED)
3. Implement shouldSkipForTier, getSkippableSteps in `src/engine/steps.ts`
4. Verify tests pass (GREEN)
5. Commit: "Add tier-based step skipping logic"

**Files likely touched:**
- `src/engine/steps.ts` — modify
- `test/engine/steps.test.ts` — add tests

**Dependencies:** Task 7

---

### Task 9: Gate enforcement — happy paths
**Story:** ST-006 happy paths: stories complete passes gate, clean conflict report passes gate,
plan covers criteria passes gate, tests pass and git clean passes gate, ADRs approved passes gate
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/gates.test.ts`:
   - `checkGate('conflict_check', state) passes when stories is done`
   - `checkGate('plan', state) passes when conflict_check is done`
   - `checkGate('plan', state) passes when conflict_check is skipped`
   - `checkGate('build', state) passes when plan is done`
   - `checkGate('finish', state) passes when retro is done`
   - `checkGate passes when prerequisite is stale (stale satisfies gates)`
   - `isGatingStep() returns true for stories, plan, build, finish`
   - `canSkipStep() returns false for gating steps`
2. Verify tests fail (RED)
3. Implement `src/engine/gates.ts`: checkGate (reads prerequisites from step registry,
   checks stepSatisfied), isGatingStep, canSkipStep
4. Verify tests pass (GREEN)
5. Commit: "Add gate enforcement — prerequisite checking"

**Files likely touched:**
- `src/engine/gates.ts` — new
- `test/engine/gates.test.ts` — new

**Dependencies:** Tasks 5, 7

---

### Task 10: Gate enforcement — blocking conditions (negative paths)
**Story:** ST-006 negative paths: stories missing negative paths blocks, blocking conflicts
remain blocks, plan has coverage gaps blocks, tests failing blocks, uncommitted changes blocks,
DRAFT ADRs remain blocks
**Type:** negative-path

**Steps:**
1. Write tests:
   - `checkGate('conflict_check') fails when stories is pending — message: "Stories incomplete"`
   - `checkGate('plan') fails when conflict_check is pending (not skipped) — message:
     "Blocking conflicts remain"`
   - `checkGate('build') fails when plan is pending — message: "Plan has coverage gaps"`
   - `checkGate returns specific, actionable error messages for each failure`
   - `checkGate fails when prerequisite is failed (failed does NOT satisfy gates)`
2. Verify tests fail (RED)
3. Implement specific error messages in checkGate for each gate failure
4. Verify tests pass (GREEN)
5. Commit: "Add gate enforcement — blocking condition messages"

**Files likely touched:**
- `src/engine/gates.ts` — modify
- `test/engine/gates.test.ts` — add tests

**Dependencies:** Task 9

---

### Task 11: Artifact checks
**Story:** ST-006 (gate enforcement depends on artifact existence)
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/artifacts.test.ts` using tmp directories:
   - `checkBrainstorm returns true when .docs/specs/*.md exists`
   - `checkBrainstorm returns false when .docs/specs/ is empty`
   - `checkStories returns true when stories have Status: ACCEPTED`
   - `checkStories returns false when all stories are Status: DRAFT`
   - `checkConflictCheck returns true when .docs/conflicts/*.md exists`
   - `checkPlan returns true when .docs/plans/*.md exists`
   - `checkBuild returns true when tests pass marker exists`
   - `getArtifactChecker returns correct function per step`
2. Verify tests fail (RED)
3. Implement `src/engine/artifacts.ts`: one check function per step using fs.promises + glob
4. Verify tests pass (GREEN)
5. Commit: "Add artifact existence checks for gate enforcement"

**Files likely touched:**
- `src/engine/artifacts.ts` — new
- `test/engine/artifacts.test.ts` — new

**Dependencies:** Task 2

---

### Task 12: Session management — session ID lifecycle
**Story:** ST-008 happy paths: new feature creates session ID, subsequent steps resume session,
--resume uses stored session ID
**Type:** happy-path

**Steps:**
1. Write tests in `test/execution/session.test.ts`:
   - `getSessionId() creates new UUID when no session file exists`
   - `getSessionId() returns existing UUID from session file`
   - `markSessionCreated() creates marker file`
   - `isSessionCreated() returns true when marker exists`
   - `isSessionCreated() returns false when no marker`
   - `buildClaudeArgs() returns --session-id for first call (no marker)`
   - `buildClaudeArgs() returns --resume for subsequent calls (marker exists)`
   - `buildClaudeArgs() includes --dangerously-skip-permissions for non-interactive mode`
   - `buildClaudeArgs() omits --dangerously-skip-permissions for interactive recovery`
2. Verify tests fail (RED)
3. Implement `src/execution/session.ts`: SessionManager class with getSessionId,
   resetSession, markSessionCreated, isSessionCreated, buildClaudeArgs (includes
   --dangerously-skip-permissions for automated calls, omits for interactive)
4. Verify tests pass (GREEN)
5. Commit: "Add session management — ID lifecycle and Claude args"

**Files likely touched:**
- `src/execution/session.ts` — new
- `test/execution/session.test.ts` — new

**Dependencies:** Task 1

---

### Task 13: Session management — stale session and rate limit recovery (negative paths)
**Story:** ST-008 negative paths: expired session creates fresh one, rate limit triggers
escalating cooldown, subagent isolation
**Type:** negative-path

**Steps:**
1. Write tests:
   - `detectStaleSession() returns true for "No conversation found" in output`
   - `detectStaleSession() returns false for normal output`
   - `resetSession() generates new UUID and clears marker`
   - `detectRateLimit() recognizes "rate limit", "429", "overloaded" patterns`
   - `getCooldownSeconds() returns base (60) for < 10 calls`
   - `getCooldownSeconds() returns 2x base for 10-19 calls`
   - `getCooldownSeconds() returns 3x base for 20+ calls`
2. Verify tests fail (RED)
3. Implement detection functions and escalating cooldown in session.ts
4. Verify tests pass (GREEN)
5. Commit: "Add stale session detection and rate limit handling"

**Files likely touched:**
- `src/execution/session.ts` — modify
- `test/execution/session.test.ts` — add tests

**Dependencies:** Task 12

---

### Task 14: LLM provider interface and Claude CLI adapter
**Story:** ST-008 (session management), supports all stories requiring Claude invocation
**Type:** infrastructure

**Steps:**
1. Write tests in `test/execution/claude-provider.test.ts` (mocked execa):
   - `invoke() calls claude with correct session args`
   - `invoke() appends system prompt context (step number, feature desc)`
   - `invoke() captures stdout to session log`
   - `invokeInteractive() passes TTY through`
   - `invoke() detects rate limit in output and returns rate_limit result`
   - `invoke() detects stale session and returns session_expired result`
   - `invoke() includes --dangerously-skip-permissions in args`
   - `invoke() applies step cooldown (configurable, default 10s) between calls`
   - `invoke() sets session name via --name when feature desc available`
2. Verify tests fail (RED)
3. Create `src/execution/llm-provider.ts` (interface: invoke, invokeInteractive)
4. Create `src/execution/claude-provider.ts` implementing the interface via execa.
   Include --dangerously-skip-permissions for all non-interactive calls, configurable
   step cooldown with escalation (10s base, 2x at 10+ calls, 3x at 20+), session naming.
5. Create `src/execution/subprocess.ts` as typed wrapper around execa
6. Verify tests pass (GREEN)
7. Commit: "Add LLM provider interface and Claude CLI adapter"

**Files likely touched:**
- `src/execution/llm-provider.ts` — new
- `src/execution/claude-provider.ts` — new
- `src/execution/subprocess.ts` — new
- `test/execution/claude-provider.test.ts` — new

**Dependencies:** Tasks 12, 13

---

### Task 15: Recovery flow — options and retry logic (happy paths)
**Story:** ST-009 happy paths: recovery menu offers r/i/b/s/q, retry doesn't increment count,
interactive session scoped to failed step, skip marks step skipped, quit shows resume instructions
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/recovery.test.ts`:
   - `getRecoveryOptions() returns ['retry','interactive','back','skip','quit'] for non-gating`
   - `handleRecoveryChoice('retry') returns { action: 'retry' }`
   - `handleRecoveryChoice('skip') returns { action: 'skip' }`
   - `handleRecoveryChoice('back') returns { action: 'back' }`
   - `handleRecoveryChoice('quit') returns { action: 'quit' }`
   - `handleRecoveryChoice('interactive') returns { action: 'interactive' }`
   - `shouldRetry(0, 3) returns true`
   - `shouldRetry(2, 3) returns true`
2. Verify tests fail (RED)
3. Implement `src/engine/recovery.ts`
4. Verify tests pass (GREEN)
5. Commit: "Add recovery flow — options and retry logic"

**Files likely touched:**
- `src/engine/recovery.ts` — new
- `test/engine/recovery.test.ts` — new

**Dependencies:** Task 7

---

### Task 16: Recovery flow — gating protection and retry limits (negative paths)
**Story:** ST-009 negative paths: 3 consecutive failures stops retrying, gating step blocks skip,
rate limit waits before offering menu, interactive session retry bounded by 3-retry limit
**Type:** negative-path

**Steps:**
1. Write tests:
   - `getRecoveryOptions() for gating step returns ['retry','interactive','back','quit'] (no skip)`
   - `handleRecoveryChoice('skip') for gating step returns { action: 'blocked', reason: ... }`
   - `shouldRetry(3, 3) returns false`
   - `shouldRetry(4, 3) returns false`
   - `isRateLimitError() detects rate limit markers`
   - `isRateLimitError() returns false for normal errors`
2. Verify tests fail (RED)
3. Implement gating protection and retry bounds in recovery.ts
4. Verify tests pass (GREEN)
5. Commit: "Add recovery flow — gating protection and retry limits"

**Files likely touched:**
- `src/engine/recovery.ts` — modify
- `test/engine/recovery.test.ts` — add tests

**Dependencies:** Task 15

---

### Task 17: Complexity assessment — signal classification
**Story:** ST-011 happy paths: evaluates 5 signals, proposes tier, user accepts, stored in state
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/complexity.test.ts`:
   - `classifySignal('models', 2) returns 'S'`
   - `classifySignal('models', 5) returns 'M'`
   - `classifySignal('models', 10) returns 'L'`
   - `classifySignal('integrations', 0) returns 'S'`
   - `classifySignal('integrations', 2) returns 'M'`
   - `classifySignal('integrations', 4) returns 'L'`
   - `assessTier with 3S 2M returns 'S'`
   - `assessTier with 3M 2S returns 'M'`
   - `assessTier with 5L returns 'L'`
2. Verify tests fail (RED)
3. Implement `src/engine/complexity.ts`: Signal type, classifySignal (threshold table
   matching bash), assessTier (majority vote)
4. Verify tests pass (GREEN)
5. Commit: "Add complexity assessment — signal classification and tier scoring"

**Files likely touched:**
- `src/engine/complexity.ts` — new
- `test/engine/complexity.test.ts` — new

**Dependencies:** Task 2

---

### Task 18: Complexity assessment — tie-breaking and edge cases (negative paths)
**Story:** ST-011 negative paths: tied signals break toward higher tier, insufficient info
asks clarifying questions
**Type:** negative-path

**Steps:**
1. Write tests:
   - `assessTier with 2S 2M 1L returns 'M' (tie between S and M breaks up)`
   - `assessTier with 2M 2L 1S returns 'L' (tie between M and L breaks up)`
   - `assessTier with equal 2S 2M returns 'M' (tie breaks toward higher)`
   - `hasInsufficientInfo returns true when signal count < 3`
   - `hasInsufficientInfo returns false when signal count >= 3`
2. Verify tests fail (RED)
3. Implement tie-breaking (on tie, choose higher tier) and insufficiency detection
4. Verify tests pass (GREEN)
5. Commit: "Add complexity tie-breaking and edge case handling"

**Files likely touched:**
- `src/engine/complexity.ts` — modify
- `test/engine/complexity.test.ts` — add tests

**Dependencies:** Task 17

---

### Task 19: Event emitter — typed events
**Story:** ST-002 (dashboard refresh), ST-003 (checkpoint), ST-009 (recovery needed)
**Type:** infrastructure

**Steps:**
1. Write tests in `test/ui/events.test.ts`:
   - `emit('step_started') triggers registered listener with correct payload`
   - `emit('checkpoint_reached') triggers listener`
   - `emit('recovery_needed') triggers listener with options array`
   - `off() removes listener`
   - `Events are typed — TypeScript compiler rejects invalid event payloads`
2. Verify tests fail (RED)
3. Implement `src/ui/events.ts`: typed EventEmitter wrapper that enforces ConductorEvent
   discriminated union
4. Verify tests pass (GREEN)
5. Commit: "Add typed event emitter for engine/UI decoupling"

**Files likely touched:**
- `src/ui/events.ts` — new
- `test/ui/events.test.ts` — new

**Dependencies:** Task 4

---

### Task 20: Conductor state machine — step progression (happy path)
**Story:** ST-001 happy paths: starts at first step, advances on success, marks complete
when all done
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/conductor.test.ts` (mock step runners):
   - `Conductor starts at step index 0 for new feature`
   - `Conductor marks step in_progress before running`
   - `Conductor marks step done after success`
   - `Conductor advances to next step after success`
   - `Conductor sets feature_status=complete when all steps done`
   - `Conductor emits step_started and step_completed events`
   - `Conductor saves state on SIGINT before exit (signal handling)`
2. Verify tests fail (RED)
3. Implement `src/engine/conductor.ts`: Conductor class with run() main loop. Constructor
   takes stateFilePath, llmProvider, eventEmitter. Uses StepRunner abstraction. Registers
   process.on('SIGINT') to save state before exit.
4. Verify tests pass (GREEN)
5. Commit: "Add conductor state machine — step progression"

**Files likely touched:**
- `src/engine/conductor.ts` — new
- `test/engine/conductor.test.ts` — new

**Dependencies:** Tasks 5, 7, 9, 19

---

### Task 21: Conductor — failure handling and resume (negative paths)
**Story:** ST-001 negative paths: step failure enters recovery, crash recovery via --resume,
corrupted state reports error
**Type:** negative-path

**Steps:**
1. Write tests:
   - `Conductor enters recovery flow when step returns failure`
   - `Conductor does NOT advance to next step on failure`
   - `Conductor with --resume starts at last in_progress step`
   - `Conductor with --from starts at specified step`
   - `Conductor emits step_failed event on failure`
2. Verify tests fail (RED)
3. Implement failure handling: detect step failure, emit event, enter recovery, respect
   --resume and --from flags
4. Verify tests pass (GREEN)
5. Commit: "Add conductor failure handling and resume support"

**Files likely touched:**
- `src/engine/conductor.ts` — modify
- `test/engine/conductor.test.ts` — add tests

**Dependencies:** Tasks 15, 20

---

### Task 22: Conductor — tier skipping integration
**Story:** ST-005 happy paths: Small skips specific steps, skipped steps marked 'skipped'
in state. ST-005 negative: missing tier blocks and requests assessment.
**Type:** happy-path

**Steps:**
1. Write tests:
   - `Conductor skips conflict_check when tier is S`
   - `Conductor skips architecture_diagram when tier is S`
   - `Conductor runs all steps when tier is M`
   - `Conductor marks skipped steps as 'skipped' in state`
   - `Conductor emits tier_skip event for skipped steps`
   - `Conductor blocks when tier is not set (negative path)`
2. Verify tests fail (RED)
3. Integrate shouldSkipForTier into conductor main loop
4. Verify tests pass (GREEN)
5. Commit: "Integrate tier-based step skipping into conductor"

**Files likely touched:**
- `src/engine/conductor.ts` — modify
- `test/engine/conductor.test.ts` — add tests

**Dependencies:** Tasks 8, 20

---

### Task 23: Conductor — gate checking integration
**Story:** ST-006 (gates block progression when prerequisites not met)
**Type:** happy-path

**Steps:**
1. Write tests:
   - `Conductor checks gate before running each step`
   - `Conductor blocks and emits gate_blocked event when gate fails`
   - `Conductor passes gate when prerequisite is stale`
2. Verify tests fail (RED)
3. Integrate checkGate into conductor main loop before each step
4. Verify tests pass (GREEN)
5. Commit: "Integrate gate enforcement into conductor"

**Files likely touched:**
- `src/engine/conductor.ts` — modify
- `test/engine/conductor.test.ts` — add tests

**Dependencies:** Tasks 9, 20

---

### Task 24: Conductor — checkpoint handling
**Story:** ST-003 happy paths: pauses after build and manual_test, c=continue advances.
ST-003 negative: auto mode skips checkpoints, no TTY skips, invalid input re-prompts.
**Type:** happy-path

**Steps:**
1. Write tests:
   - `Conductor fires checkpoint_reached event after build step`
   - `Conductor fires checkpoint_reached event after manual_test step`
   - `Conductor does NOT fire checkpoint for non-checkpoint steps`
   - `Conductor skips checkpoint when mode is 'auto'`
   - `Conductor advances when checkpoint response is 'continue'`
2. Verify tests fail (RED)
3. Add checkpoint logic to conductor: after step completes, check isCheckpointStep, emit
   event, wait for UI response (continue/back/quit)
4. Verify tests pass (GREEN)
5. Commit: "Add checkpoint handling to conductor"

**Files likely touched:**
- `src/engine/conductor.ts` — modify
- `test/engine/conductor.test.ts` — add tests

**Dependencies:** Task 20

---

### Task 25: Conductor — backward navigation
**Story:** ST-004 happy paths: navigation menu lists done/stale steps, target set to pending,
downstream marked stale, conductor re-runs from target. ST-004 negative: cancel returns to
prompt, no completed steps shows message.
**Type:** happy-path

**Steps:**
1. Write tests:
   - `getNavigableSteps() returns only done and stale steps`
   - `getNavigableSteps() returns empty array when no steps completed`
   - `navigateBack() sets target step to pending`
   - `navigateBack() marks all downstream done steps as stale`
   - `navigateBack() returns new loop index at target step`
   - `Conductor jumps to target index after navigation`
   - `Stale steps re-run when conductor reaches them`
   - `Cancel navigation (index 0) returns to checkpoint without state changes`
2. Verify tests fail (RED)
3. Implement getNavigableSteps, navigateBack in conductor. Wire into checkpoint and
   recovery 'back' handler.
4. Verify tests pass (GREEN)
5. Commit: "Add backward navigation with stale state propagation"

**Files likely touched:**
- `src/engine/conductor.ts` — modify
- `test/engine/conductor.test.ts` — add tests

**Dependencies:** Tasks 6, 24

---

### Task 26: Worktree management — creation and reuse (happy paths)
**Story:** ST-007 happy paths: new feature gets worktree in .worktrees/<slug>, branch
feature/<slug>, commits isolated, multi-feature resume menu
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/worktree.test.ts` (using temp git repos):
   - `slugify('URL shortener service') returns 'url-shortener-service'`
   - `slugify truncates at 50 characters`
   - `slugify removes special characters`
   - `createWorktree() creates .worktrees/<slug> directory`
   - `createWorktree() creates branch feature/<slug>`
   - `scanWorktrees() returns list of active worktrees`
   - `scanWorktrees() excludes completed features (feature_status=complete)`
2. Verify tests fail (RED)
3. Implement `src/engine/worktree.ts`: WorktreeManager class with slugify, create, scan
4. Verify tests pass (GREEN)
5. Commit: "Add worktree management — creation, branching, scanning"

**Files likely touched:**
- `src/engine/worktree.ts` — new
- `test/engine/worktree.test.ts` — new

**Dependencies:** Task 5

---

### Task 27: Worktree management — edge cases (negative paths)
**Story:** ST-007 negative paths: existing worktree reused, .worktrees/ created if missing,
deleted branch reports error, slug collision appends suffix
**Type:** negative-path

**Steps:**
1. Write tests:
   - `createWorktree() reuses existing worktree for same branch`
   - `createWorktree() creates .worktrees/ directory if it doesn't exist`
   - `createWorktree() appends -2 suffix on slug collision`
   - `scanWorktrees() handles deleted branch gracefully — reports error, offers cleanup`
   - `cleanupWorktree() removes worktree and deletes branch`
2. Verify tests fail (RED)
3. Implement edge case handling in WorktreeManager
4. Verify tests pass (GREEN)
5. Commit: "Add worktree edge case handling — reuse, collision, cleanup"

**Files likely touched:**
- `src/engine/worktree.ts` — modify
- `test/engine/worktree.test.ts` — add tests

**Dependencies:** Task 26

---

### Task 28: Dashboard component — step rendering (happy paths)
**Story:** ST-002 happy paths: each step shows label, phase, status icon. Icons: green
checkmark (done), yellow arrow (in_progress), empty box (pending), skip arrow (skipped),
yellow warning (stale)
**Type:** happy-path

**Steps:**
1. Write tests in `test/ui/terminal/dashboard.test.tsx` (ink-testing-library):
   - `Dashboard renders all 14 steps`
   - `Dashboard shows checkmark for done steps`
   - `Dashboard shows arrow for in_progress steps`
   - `Dashboard shows empty box for pending steps`
   - `Dashboard shows skip arrow for skipped steps`
   - `Dashboard shows warning for stale steps`
   - `Dashboard shows X for failed steps`
   - `Dashboard shows phase label for each step`
   - `Dashboard shows feature name, project name, branch, and run mode in header`
   - `Dashboard shows elapsed time for in_progress step`
2. Verify tests fail (RED)
3. Implement `src/ui/terminal/dashboard.tsx`: ink component that receives ConductState
   as props, renders step table with status icons, header with project/feature/branch/mode,
   elapsed timer for active step
4. Verify tests pass (GREEN)
5. Commit: "Add ink dashboard component — step rendering with status icons"

**Files likely touched:**
- `src/ui/terminal/dashboard.tsx` — new
- `test/ui/terminal/dashboard.test.tsx` — new

**Dependencies:** Tasks 4, 19

---

### Task 29: Dashboard component — narrow terminal and corrupted state (negative paths)
**Story:** ST-002 negative paths: narrow terminal truncates gracefully, unrecognized state
shows as pending
**Type:** negative-path

**Steps:**
1. Write tests:
   - `Dashboard with COLUMNS=40 renders without garbled output`
   - `Dashboard with unknown step status renders as pending`
   - `Dashboard with missing steps still renders all 14 entries`
2. Verify tests fail (RED)
3. Implement graceful truncation (ink's Box/Text handle most of this) and default-to-pending
   for unknown states
4. Verify tests pass (GREEN)
5. Commit: "Add dashboard graceful degradation for narrow terminal and bad state"

**Files likely touched:**
- `src/ui/terminal/dashboard.tsx` — modify
- `test/ui/terminal/dashboard.test.tsx` — add tests

**Dependencies:** Task 28

---

### Task 30: Checkpoint component
**Story:** ST-003 (c/b/q prompt)
**Type:** happy-path

**Steps:**
1. Write tests in `test/ui/terminal/checkpoint.test.tsx`:
   - `Checkpoint renders c/b/q options with labels`
   - `Checkpoint calls onChoice with 'continue' for c`
   - `Checkpoint calls onChoice with 'back' for b`
   - `Checkpoint calls onChoice with 'quit' for q`
2. Verify tests fail (RED)
3. Implement `src/ui/terminal/checkpoint.tsx`: ink component with useInput hook
4. Verify tests pass (GREEN)
5. Commit: "Add ink checkpoint component — c/b/q prompt"

**Files likely touched:**
- `src/ui/terminal/checkpoint.tsx` — new
- `test/ui/terminal/checkpoint.test.tsx` — new

**Dependencies:** Task 19

---

### Task 31: Recovery menu component
**Story:** ST-009 (r/i/b/s/q menu, gating steps omit skip)
**Type:** happy-path

**Steps:**
1. Write tests in `test/ui/terminal/recovery.test.tsx`:
   - `Recovery renders r/i/b/s/q options for non-gating step`
   - `Recovery renders r/i/b/q (no skip) for gating step`
   - `Recovery calls onChoice with correct action`
   - `Recovery shows step name and failure context`
2. Verify tests fail (RED)
3. Implement `src/ui/terminal/recovery.tsx`: ink component receiving options array
4. Verify tests pass (GREEN)
5. Commit: "Add ink recovery menu component"

**Files likely touched:**
- `src/ui/terminal/recovery.tsx` — new
- `test/ui/terminal/recovery.test.tsx` — new

**Dependencies:** Task 15

---

### Task 32: Navigation menu component
**Story:** ST-004 (numbered step list for backward navigation)
**Type:** happy-path

**Steps:**
1. Write tests in `test/ui/terminal/navigation.test.tsx`:
   - `Navigation renders numbered list of navigable steps`
   - `Navigation shows step label, state, and phase`
   - `Navigation includes cancel option (0)`
   - `Navigation calls onSelect with step index`
   - `Navigation calls onSelect with -1 for cancel`
2. Verify tests fail (RED)
3. Implement `src/ui/terminal/navigation.tsx`: ink component
4. Verify tests pass (GREEN)
5. Commit: "Add ink navigation menu component"

**Files likely touched:**
- `src/ui/terminal/navigation.tsx` — new
- `test/ui/terminal/navigation.test.tsx` — new

**Dependencies:** Task 19

---

### Task 33: UI subscriber — wire events to components
**Story:** ST-002, ST-003, ST-009 (UI responds to engine events)
**Type:** infrastructure

**Steps:**
1. Write tests in `test/ui/subscriber.test.ts`:
   - `TerminalSubscriber renders dashboard on dashboard_refresh event`
   - `TerminalSubscriber shows checkpoint prompt on checkpoint_reached event`
   - `TerminalSubscriber shows recovery menu on recovery_needed event`
   - `TerminalSubscriber shows navigation on navigation_back event`
   - `TerminalSubscriber emits dashboard_refresh every 10s during step execution`
   - `TerminalSubscriber clears refresh interval when step completes or conductor exits`
2. Verify tests fail (RED)
3. Implement `src/ui/subscriber.ts`: UISubscriber interface and TerminalSubscriber class
   that listens to events and renders appropriate ink components. Owns periodic dashboard
   refresh via setInterval (10s) during step execution, cleared on step_completed/exit.
4. Verify tests pass (GREEN)
5. Commit: "Add terminal UI subscriber — event-to-component wiring with live refresh"

**Files likely touched:**
- `src/ui/subscriber.ts` — new
- `test/ui/subscriber.test.ts` — new

**Dependencies:** Tasks 19, 28, 30, 31, 32

---

### Task 34: CLI entry point — flag parsing
**Story:** Supports ST-001 (--resume), ST-007 (--cleanup), all stories via mode flags
**Type:** infrastructure

**Steps:**
1. Write tests in `test/cli/index.test.ts`:
   - `CLI parses feature description as positional arg`
   - `CLI parses --resume flag`
   - `CLI parses --auto flag and sets mode`
   - `CLI parses --status flag (dashboard only, no execution)`
   - `CLI parses --from <step> flag`
   - `CLI parses --cleanup flag`
   - `CLI parses --step <step> flag (single step execution)`
   - `CLI parses --reset flag (clear state, session, log)`
   - `CLI parses --output flag (raw output mode, no dashboard)`
   - `CLI requires feature description when no state exists`
   - `CLI shows help with --help`
2. Verify tests fail (RED)
3. Implement `src/index.ts` using commander: parse flags, validate, construct Conductor
   with appropriate options
4. Verify tests pass (GREEN)
5. Commit: "Add CLI entry point — flag parsing via commander"

**Files likely touched:**
- `src/index.ts` — new
- `test/cli/index.test.ts` — new

**Dependencies:** Task 20

---

### Task 35: Step runners — Claude invocation per step
**Story:** All stories (each step requires specific Claude prompts and artifact validation)
**Type:** happy-path

**Steps:**
1. Write tests in `test/engine/step-runners.test.ts` (mocked LLM provider):
   - `runBrainstorm() invokes Claude with brainstorm prompt and validates .docs/specs/ output`
   - `runStories() invokes Claude with stories prompt and validates .docs/stories/ output`
   - `runPlan() invokes Claude with plan prompt and validates .docs/plans/ output`
   - `runBuild() invokes Claude with pipeline/tdd prompt`
   - `Step runners check artifacts after Claude invocation`
   - `Step runners return success when artifacts exist`
   - `Step runners return failure when artifacts missing after invocation`
2. Verify tests fail (RED)
3. Implement `src/engine/step-runners.ts`: one function per step, ported from bash `run_*()`
   functions. Each: checks gate -> invokes Claude -> validates artifacts -> returns result.
4. Verify tests pass (GREEN)
5. Commit: "Add step runner functions — per-step Claude invocation"

**Files likely touched:**
- `src/engine/step-runners.ts` — new
- `test/engine/step-runners.test.ts` — new

**Dependencies:** Tasks 11, 14

---

### Task 36: Feature completion — final artifacts and cleanup
**Story:** ST-010 happy paths: commits SHIP artifacts, PR URL stored, feature excluded from
resume, cleanup offered. ST-010 negative: empty commit skipped, PR failure doesn't mark complete,
declined cleanup reappears.
**Type:** happy-path

**Steps:**
1. Write tests:
   - `commitFinalArtifacts() commits .docs/retros/ and manual-test results`
   - `commitFinalArtifacts() does not create empty commit when nothing to commit`
   - `storePrUrl() saves URL to state`
   - `Feature with feature_status=complete is excluded from resume menu`
   - `markComplete() fails if PR creation failed — feature stays incomplete`
   - `offerCleanup() re-offers on next resume if declined`
2. Verify tests fail (RED)
3. Implement completion logic in conductor: final commit, PR URL storage, feature_status
4. Verify tests pass (GREEN)
5. Commit: "Add feature completion — final artifacts, PR storage, cleanup"

**Files likely touched:**
- `src/engine/conductor.ts` — modify
- `test/engine/conductor.test.ts` — add tests

**Dependencies:** Tasks 20, 26

---

### Task 37: Shell wrapper — bin/conduct-ts
**Story:** Infrastructure (migration path, bin/ convention)
**Type:** infrastructure

**Steps:**
1. Create `bin/conduct-ts` shell wrapper:
   ```bash
   #!/bin/bash
   exec node "$(dirname "$0")/../src/conductor/dist/index.js" "$@"
   ```
2. Run `bash -n bin/conduct-ts` — verify valid bash syntax
3. Run `test/test_harness_integrity.sh` — verify integrity tests still pass
4. Commit: "Add bin/conduct-ts shell wrapper for TypeScript conductor"

**Files likely touched:**
- `bin/conduct-ts` — new

**Dependencies:** Task 34

---

### Task 38: Integration test — full conductor flow
**Story:** All stories — end-to-end orchestration
**Type:** happy-path

**Steps:**
1. Write tests in `test/integration/conductor-flow.test.ts` (mocked ClaudeProvider):
   - `New feature: creates state, advances through all steps with mock success`
   - `Resume: picks up from last in_progress step`
   - `Tier skip: Small tier skips correct steps`
   - `Gate block: pending prerequisite blocks step`
   - `Recovery: step failure triggers recovery flow`
   - `Backward: navigation sets target pending, marks downstream stale`
   - `Completion: all steps done sets feature_status=complete`
   - `Backward compat: bash-written state file resumes correctly in TS`
2. Verify tests fail (RED)
3. Wire all components together: Conductor + StepRunners + SessionManager + TerminalSubscriber
4. Verify tests pass (GREEN)
5. Run `npx tsup` — verify build produces dist/index.js
6. Run `node dist/index.js --help` — verify CLI works
7. Commit: "Add integration tests — full conductor flow"

**Files likely touched:**
- `test/integration/conductor-flow.test.ts` — new

**Dependencies:** Tasks 20-37

---

## Task Dependency Graph

```
Task 1 (scaffolding)
  │
  ├── Task 2 (step types)
  │     ├── Task 3 (state types) ── Task 4 (event/config types)
  │     │     │                           │
  │     │     ├── Task 5 (state mgmt) ────┤
  │     │     │     │                     │
  │     │     │     ├── Task 6 (state errors/compat)
  │     │     │     ├── Task 26 (worktree) ── Task 27 (worktree edge cases)
  │     │     │     └── Task 36 (completion)
  │     │     │
  │     │     └── Task 19 (typed events)
  │     │           ├── Task 28 (dashboard) ── Task 29 (dashboard edge cases)
  │     │           ├── Task 30 (checkpoint)
  │     │           ├── Task 32 (navigation)
  │     │           └── Task 33 (UI subscriber)
  │     │
  │     ├── Task 7 (step registry) ── Task 8 (tier skipping)
  │     │     │
  │     │     ├── Task 9 (gates happy) ── Task 10 (gates negative)
  │     │     └── Task 15 (recovery happy) ── Task 16 (recovery negative)
  │     │                                       │
  │     │                                       └── Task 31 (recovery component)
  │     │
  │     ├── Task 11 (artifact checks)
  │     └── Task 17 (complexity) ── Task 18 (complexity edge cases)
  │
  ├── Task 12 (session mgmt) ── Task 13 (session negative)
  │     │
  │     └── Task 14 (LLM provider + Claude adapter)
  │           │
  │           └── Task 35 (step runners)
  │
  ├── Tasks 5,7,9,19 → Task 20 (conductor state machine)
  │     ├── Task 21 (conductor failure/resume)
  │     ├── Task 22 (conductor tier skipping)
  │     ├── Task 23 (conductor gate integration)
  │     ├── Task 24 (conductor checkpoints) ── Task 25 (backward navigation)
  │     └── Task 34 (CLI entry point)
  │           └── Task 37 (shell wrapper)
  │
  └── All tasks → Task 38 (integration test)
```

## Integration Points

- **After Task 6:** State management fully tested including bash backward compat
- **After Task 14:** Can invoke Claude CLI (mocked in tests, real in integration)
- **After Task 25:** Full conductor loop works with all navigation/recovery
- **After Task 33:** UI renders from engine events end-to-end
- **After Task 38:** Complete system integration — ready for manual testing

## Coverage Mapping

| Story | Criteria | Tasks |
|-------|----------|-------|
| ST-001 | New feature starts at first step | 5, 20 |
| ST-001 | Step success updates state | 5, 20 |
| ST-001 | All complete sets feature_status | 5, 20, 36 |
| ST-001 | Step failure enters recovery | 21 |
| ST-001 | Crash resume at in_progress step | 6, 21 |
| ST-001 | Corrupted JSON reports error | 6 |
| ST-002 | Steps show label, phase, icon | 28 |
| ST-002 | Green checkmark for done | 28 |
| ST-002 | Yellow arrow for in_progress | 28 |
| ST-002 | Empty box for pending | 28 |
| ST-002 | Skip arrow for skipped | 28 |
| ST-002 | Warning for stale | 28 |
| ST-002 | Narrow terminal truncates | 29 |
| ST-002 | Unknown state shows pending | 29 |
| ST-003 | Pause after build | 24 |
| ST-003 | Pause after manual-test | 24 |
| ST-003 | c=continue advances | 24 |
| ST-003 | Auto mode skips checkpoints | 24 |
| ST-003 | No TTY skips checkpoints | 24 |
| ST-003 | Invalid input re-prompts | 30 |
| ST-004 | Navigation lists done/stale steps | 25, 32 |
| ST-004 | Target set to pending | 25 |
| ST-004 | Downstream marked stale | 6, 25 |
| ST-004 | Re-runs from target forward | 25 |
| ST-004 | Back from recovery menu | 25 |
| ST-004 | Cancel returns to prompt | 25, 32 |
| ST-004 | No completed steps message | 25 |
| ST-004 | Stale satisfies gates | 9 |
| ST-005 | Small skips specific steps | 8, 22 |
| ST-005 | Medium runs all | 8, 22 |
| ST-005 | Large runs all | 8, 22 |
| ST-005 | Skipped shows skip icon | 28 |
| ST-005 | User override changes tier | 8 |
| ST-005 | Missing tier blocks | 22 |
| ST-006 | Stories complete passes gate | 9 |
| ST-006 | Clean conflicts passes gate | 9 |
| ST-006 | Plan covers criteria passes gate | 9 |
| ST-006 | Tests pass and clean passes gate | 9 |
| ST-006 | ADRs approved passes gate | 9 |
| ST-006 | Stories missing negative paths blocks | 10 |
| ST-006 | Blocking conflicts blocks | 10 |
| ST-006 | Plan coverage gaps blocks | 10 |
| ST-006 | Tests failing blocks | 10 |
| ST-006 | Uncommitted changes blocks | 10 |
| ST-006 | DRAFT ADRs blocks | 10 |
| ST-007 | Worktree in .worktrees/<slug> | 26 |
| ST-007 | Branch feature/<slug> | 26 |
| ST-007 | Commits in worktree only | 26 |
| ST-007 | Multi-feature resume menu | 26 |
| ST-007 | Reuses existing worktree | 27 |
| ST-007 | Creates .worktrees/ if missing | 27 |
| ST-007 | Deleted branch reports error | 27 |
| ST-007 | Slug collision appends suffix | 27 |
| ST-008 | New session ID created | 12 |
| ST-008 | Subsequent steps resume session | 12 |
| ST-008 | Subagent context discarded | 14 |
| ST-008 | --resume uses stored session | 12 |
| ST-008 | Expired session creates fresh | 13 |
| ST-008 | Rate limit escalating cooldown | 13 |
| ST-008 | Context bounded by subagent isolation | 14 |
| ST-009 | Recovery menu r/i/b/s/q | 15, 31 |
| ST-009 | Retry doesn't increment count | 15 |
| ST-009 | Interactive scoped to step | 15 |
| ST-009 | Skip marks skipped | 15 |
| ST-009 | Quit shows resume instructions | 15 |
| ST-009 | 3 failures stops retrying | 16 |
| ST-009 | Gating step blocks skip | 16 |
| ST-009 | Rate limit waits before menu | 16 |
| ST-009 | Interactive retry bounded | 16 |
| ST-010 | Commits SHIP artifacts | 36 |
| ST-010 | PR URL stored | 36 |
| ST-010 | Complete excluded from resume | 36 |
| ST-010 | Cleanup offered | 27, 36 |
| ST-010 | Empty commit skipped | 36 |
| ST-010 | PR failure doesn't mark complete | 36 |
| ST-010 | Declined cleanup reappears | 36 |
| ST-011 | Evaluates 5 signals | 17 |
| ST-011 | Proposes tier | 17 |
| ST-011 | User accepts, stored in state | 17 |
| ST-011 | Override stored | 17 |
| ST-011 | Tie breaks toward higher | 18 |
| ST-011 | Insufficient info asks questions | 18 |

## Verification

- [x] All happy path criteria covered by at least one task
- [x] All negative path criteria covered by at least one task
- [x] No task exceeds 5 minutes of work
- [x] Dependencies are explicit and acyclic
