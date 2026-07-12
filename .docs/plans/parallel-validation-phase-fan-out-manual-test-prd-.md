# Implementation Plan: Parallel Validation Phase (ai-conductor#469)

**Date:** 2026-07-10
**Design:** .docs/decisions/adr-2026-07-10-concurrent-group-core.md, .docs/decisions/adr-2026-07-10-validation-group-join.md (both APPROVED; join ADR carries the auto-mode-only addendum)
**Stories:** .docs/stories/parallel-validation-phase-fan-out-manual-test-prd-.md (Status: Accepted)
**Conflict check:** Clean as of 2026-07-10 (.docs/conflicts/2026-07-10-parallel-validation-checkpoint-scoping.md)

## Summary

Builds the single concurrent group core, re-points the ADR-004 `parallel:` DSL onto it
(deleting `runParallelGroup`), adds the built-in auto-mode-only SHIP validation group
(manual_test / prd_audit / architecture_review_as_built after build_review), and the
verdicts-join/consolidated-kickback machinery. 30 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/group-core.ts`** hosts the concurrency
  machinery (semaphore, branch executor, outcome types, join collection) so the diff to
  the dense `conductor.ts` seam stays narrow: the loop keeps one "is this a group"
  branch (the existing `stepCfg?.parallel` branch at ~conductor.ts:1375 is the wiring
  point) plus the join-classification block in the auto-mode failure section.
- **Branch outcome is a discriminated union** — `{kind:'verdict', verdict: pass|fail|blocked, …}`
  vs `{kind:'no-verdict', reason}` vs `{kind:'skipped'}` — never boolean flags;
  exhaustive `switch` with no `default` (domain-integrity ruling in the architecture
  review).
- **Branch execution parity**: each branch mints its own `uuidv4()` session
  (`resume:false` first attempt, resume-own-session on retry — precedent
  step-runners.ts:625/678/741), runs the member's OWN step name through the injected
  `StepRunner`, honors the step's resolved `max_retries`, sweeps only its own stale
  markers (`STALE_SWEEP_STEPS`), and passes `rateLimited` results into the shared
  rate-limit episode (`enter(deadline)` / `await clear(signal)` — same contract as
  conductor.ts:1541-1567) without decrementing its retry budget. `authFailure` /
  `sessionExpired` results reuse the serial loop's handling classes.
- **Single-writer rule**: branches return outcomes; only the core (on the loop's thread
  of control, at join) writes `conduct-state.json` (synthetic `«group»__«member»` keys
  retained), `.pipeline/gates/*.json`, and emits group events.
- **Join classification (auto mode)**: all-green → group done. Any no-verdict branch →
  existing step-failure/halt path. Verdict failures → merge two streams: manual_test
  FAIL rows classified deterministically (reuse the existing MT kickback block's logic
  at ~conductor.ts:2011 — budget `manualTestSelfHeals`, whitewash guard untouched) +
  ONE `planRemediation` dispatch (~conductor.ts:782) whose dispatch context enumerates
  every present prd-audit/as-built evidence file; rewind once to the earliest target
  (`earliestRemediationTarget` ~conductor.ts:3424) with both evidence blocks in the hint.
- **Mode scoping**: the built-in group engages ONLY when `mode === 'auto'`; interactive
  runs keep the serial walk and manual_test's checkpoint (conductor.ts:2627) untouched.
- **Config**: top-level `validation_concurrency?: number` (default 2, clamp invalid → 2,
  floor 1) mirroring the `rebase_resolution_attempts` precedent (types/config.ts:~359,
  config.ts allow-list :170-192, a `resolveValidationConcurrency` helper).
- **Sequencing rationale**: config → core (pure, unit-testable) → DSL re-point (proves
  the core against the rewritten when-parallel suite) → built-in group + membership →
  join classification (hardest, lands on a proven core) → docs. Tests use the mock
  `StepRunner` seam (conductor.test.ts pattern); no real spawns
  (`AI_CONDUCTOR_NO_REAL_EXEC` guards hold).
- **Release surfaces**: additive config key + internal engine change — no
  consumer-visible CLI/hook/schema break expected, so no Migration block; if the
  self-host release gate's path classifier flags a surface, a waiver per
  adr-2026-07-06-migration-gate-waiver is the correct response, not an empty migration.

## Prerequisites

- PR #481 (unified evidence derivation) on main — satisfied (worktree branched after merge).
- Operator hold: spec PR merges only after #481 observed live (tracked in the join ADR).

## Tasks

### Task 1: validation_concurrency config key — type + allow-list + validation
**Story:** "validation_concurrency config key bounds the fan-out" (happy: default; negative: typo rejection)
**Type:** infrastructure

**Steps:**
1. Write failing tests: config with `validation_concurrency: 3` validates; unknown key `validation_concurency` rejected by the existing unknown-top-level-key rule; absent key → undefined passes.
2. Verify RED.
3. Implement: add `validation_concurrency?: number` to `HarnessConfig`; add the key to the `validateConfig` allow-list; numeric-type validation mirroring `rebase_resolution_attempts`.
4. Verify GREEN.
5. Commit: "feat(config): validation_concurrency key with allow-list validation"

**Files:**
- src/conductor/src/types/config.ts
- src/conductor/src/engine/config.ts
- src/conductor/test/config.test.ts

**Dependencies:** none

### Task 2: resolveValidationConcurrency clamp helper
**Story:** same story (negative: 0/negative/NaN clamp; happy: explicit 1/2/3)
**Type:** happy-path

**Steps:**
1. Write failing tests: undefined → 2; 3 → 3; 1 → 1; 0 → 2; -4 → 2; NaN/non-numeric → 2.
2. Verify RED.
3. Implement `resolveValidationConcurrency(config)` beside the other `resolve*` helpers.
4. Verify GREEN.
5. Commit: "feat(config): resolveValidationConcurrency default-2 clamp"

**Files:**
- src/conductor/src/engine/config.ts
- src/conductor/test/config.test.ts

**Dependencies:** 1

### Task 3: Branch-outcome discriminated union + group types
**Story:** review ruling (domain integrity); "Single-writer state…" (shape groundwork)
**Type:** infrastructure

**Steps:**
1. Write failing type-level/unit tests: outcome constructors; exhaustive classify helper rejects (compile-time) a missing variant; `skipped ≠ no-verdict`.
2. Verify RED.
3. Implement `src/conductor/src/engine/group-core.ts` types: `BranchOutcome` union (`verdict` | `no-verdict` | `skipped`), `GroupMember`, `GroupResult`; no `default:` branches.
4. Verify GREEN.
5. Commit: "feat(group-core): branch outcome union + group types"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** none

### Task 4: Capped semaphore scheduler
**Story:** "Validation group fans out concurrently" (cap enforcement); "validation_concurrency…" (cap 1 = serial)
**Type:** happy-path

**Steps:**
1. Write failing tests: 3 thunks, cap 2 → third starts only after a completion; cap 1 → strictly sequential; completion order independence.
2. Verify RED.
3. Implement a small promise semaphore in group-core (no new deps).
4. Verify GREEN.
5. Commit: "feat(group-core): capped fan-out semaphore"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 3

### Task 5: Branch executor — own skill, fresh session, retry-resume-own-session
**Story:** "Each branch runs its own skill in its own fresh session" (happy both; negative: retry resumes own session)
**Type:** happy-path

**Steps:**
1. Write failing runner-spy tests: two members → two invocations with member step names and two distinct fresh session ids; a branch retry reuses ITS session id; shared runner session id unchanged after group run.
2. Verify RED.
3. Implement branch executor: per-branch `uuidv4()`, first attempt `resume:false`, retries resume; dispatch member's own step name; per-branch retry ladder honoring resolved `max_retries`.
4. Verify GREEN.
5. Commit: "feat(group-core): per-branch skill dispatch + fresh sessions"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/src/engine/step-runners.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 4

### Task 6: Rate-limit pass-through into the shared episode
**Story:** "Rate-limited branch enters the shared episode…" (happy both)
**Type:** happy-path

**Steps:**
1. Write failing tests with a fake episode: branch 429 with deadline → `enter(deadline)` called, branch awaits `clear()`, retry budget NOT decremented; second branch later deadline → episode extended, both resume.
2. Verify RED.
3. Implement rateLimited handling in the branch executor (mirror conductor.ts:1541-1567 semantics).
4. Verify GREEN.
5. Commit: "feat(group-core): branch rate-limit wiring into shared episode"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 5

### Task 7: authFailure / sessionExpired parity in branches
**Story:** same story (negative: non-429 result classes)
**Type:** negative-path

**Steps:**
1. Write failing tests: branch returns `authFailure` → same handling class as serial loop (no budget burn, halt/park semantics surfaced to core); `sessionExpired` → session re-mint + retry without budget burn.
2. Verify RED.
3. Implement pass-through in branch executor.
4. Verify GREEN.
5. Commit: "feat(group-core): auth/session-expired branch parity"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 6

### Task 8: Abort/SIGINT persistence for in-flight branches
**Story:** "Validation group fans out…" (negative: SIGINT state); "Rate-limited branch…" (negative: abort during episode wait)
**Type:** negative-path

**Steps:**
1. Write failing tests: abort signal during episode wait → branch exits cleanly, outcome recorded; abort mid-group → outcomes-so-far returned so the caller persists synthetic keys; no orphaned timers (fake timers assert).
2. Verify RED.
3. Implement AbortSignal threading through semaphore + executor.
4. Verify GREEN.
5. Commit: "feat(group-core): abort-safe branch waits"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 6

### Task 9: Per-branch stale-sweep isolation
**Story:** "Single-writer state…" (negative: sweep isolation)
**Type:** negative-path

**Steps:**
1. Write failing test: member A re-dispatches with a stale marker present while member B's fresh marker exists → only A's marker swept.
2. Verify RED.
3. Implement per-member sweep call in the branch executor using the existing `STALE_SWEEP_STEPS` machinery scoped to one step.
4. Verify GREEN.
5. Commit: "feat(group-core): per-branch stale sweep isolation"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 5

### Task 10: Re-point the config DSL `parallel:` branch onto GroupCore
**Story:** "Each branch runs its own skill…" (DSL happy path)
**Type:** refactor

**Steps:**
1. Write failing test (when-parallel rewrite, part 1): a config group with branches naming different skills dispatches each branch's OWN skill through the core.
2. Verify RED.
3. Implement: the `stepCfg?.parallel` branch in `Conductor.run()` builds GroupMembers from the config branches and calls the core; synthetic `«group»__«branch»` keys written at join.
4. Verify GREEN.
5. Commit: "refactor(conductor): parallel DSL executes via GroupCore"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/when-parallel.test.ts

**Dependencies:** 5, 9

### Task 11: Delete runParallelGroup + rewrite remaining when-parallel suite
**Story:** ADR TS-CORE §Decision-7 (tests enshrine corrected semantics)
**Type:** refactor

**Steps:**
1. Rewrite remaining when-parallel tests to corrected semantics: advisory branch failure → group continues; gating failure → group fails; `when:` skip sets all synthetic keys `skipped`; `parallel_started`/`parallel_failure`/`parallel_completed` still emitted.
2. Verify the rewritten suite fails against any lingering old path (RED proves re-point is total).
3. Delete `runParallelGroup` from conductor.ts; fix references.
4. Verify GREEN (full when-parallel suite + typecheck: zero remaining callers).
5. Commit: "refactor(conductor): delete runParallelGroup — GroupCore is the only executor"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/when-parallel.test.ts

**Dependencies:** 10

### Task 12: DSL-level cap enforcement
**Story:** "validation_concurrency…" (happy: cap 3 all concurrent; cap from config reaches DSL groups)
**Type:** happy-path

**Steps:**
1. Write failing test: config group of 3 branches with `validation_concurrency: 2` → third branch starts after a slot frees (event order assertion).
2. Verify RED.
3. Implement: resolve cap once per run, pass to core for DSL groups too.
4. Verify GREEN.
5. Commit: "feat(conductor): concurrency cap applies to DSL groups"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/when-parallel.test.ts

**Dependencies:** 2, 11

### Task 13: Built-in validation group definition
**Story:** "Validation group fans out concurrently…" (structure); ADR TS-JOIN §Decision-1
**Type:** infrastructure

**Steps:**
1. Write failing tests: step registry exposes the validation group entry (members: manual_test, prd_audit, architecture_review_as_built) positioned after build_review; ordinary serial steps unaffected; `tryGetStepIndex`/state keys for members unchanged.
2. Verify RED.
3. Implement: group entry structure in steps.ts (+ `types/steps.ts` variant); registry build recognizes it; members keep their own StepDefinitions.
4. Verify GREEN.
5. Commit: "feat(steps): built-in SHIP validation group entry"

**Files:**
- src/conductor/src/engine/steps.ts
- src/conductor/src/types/steps.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 3

### Task 14: Auto-mode-only engagement
**Story:** "Validation group fans out…" (negative: interactive serial + checkpoint intact)
**Type:** negative-path

**Steps:**
1. Write failing tests: mode='auto' → group path taken; interactive mode → members run via the serial walk, checkpoint_reached emitted after manual_test exactly as the pre-change baseline (event-stream equivalence).
2. Verify RED.
3. Implement the mode guard at the loop's group branch.
4. Verify GREEN.
5. Commit: "feat(conductor): validation group engages only in auto mode"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 13

### Task 15: Membership resolution — width 3/2/1/0 matrices
**Story:** "Fan-out width respects existing skip rules" (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: technical track → prd_audit `skipped`; S tier / skipWhenSkipped → as-built `skipped`; all-skipped → group itself `skipped`, zero dispatches; skipped member contributes no verdict and cannot fail the group.
2. Verify RED.
3. Implement membership resolution reusing the existing skip cascade checks per member.
4. Verify GREEN.
5. Commit: "feat(conductor): validation group membership via existing skip rules"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 14

### Task 16: Width-1 serial-equivalence
**Story:** "Fan-out width…" (happy: width 1 identical to serial)
**Type:** negative-path

**Steps:**
1. Write failing test: width-1 group emits the same event types in the same order as the pre-change serial baseline for that member (recorded fixture).
2. Verify RED.
3. Implement degrade path (single member bypasses fan-out ceremony where observable).
4. Verify GREEN.
5. Commit: "feat(group-core): width-1 group degrades to serial semantics"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 15

### Task 17: All-green join — single-writer state + gate verdicts
**Story:** "Single-writer state and gate verdicts at the join" (happy both); "Validation group fans out…" (happy: all-green)
**Type:** happy-path

**Steps:**
1. Write failing tests: mixed-order completions → one consistent state snapshot at join with all member + group keys; `.pipeline/gates/«member».json` written serially by the core; write-spy proves zero state writes originate inside branch execution.
2. Verify RED.
3. Implement join state/gate writing.
4. Verify GREEN.
5. Commit: "feat(conductor): single-writer join state + gate verdicts"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 15

### Task 18: No-verdict branch fails the group (infra fails fast)
**Story:** "Validation group fans out…" (negative: crash → halt, no synthetic gaps); "A FAIL verdict waits…" (negative: no partial join)
**Type:** negative-path

**Steps:**
1. Write failing tests: branch exhausts retries without its completion marker → group takes step-failure path, halt marker written (auto), NO remediation.json synthesized; FAIL verdict + crashed sibling → halt, zero kickback events.
2. Verify RED.
3. Implement no-verdict classification in the join.
4. Verify GREEN.
5. Commit: "feat(conductor): no-verdict branch fails the validation group loudly"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 17

### Task 19: FAIL verdict waits for siblings
**Story:** "A FAIL verdict waits for its siblings…" (happy: no cancellation)
**Type:** happy-path

**Steps:**
1. Write failing test: manual_test FAILs early → siblings run to completion (both markers exist at join time), no cancellation.
2. Verify RED.
3. Implement (assert semaphore/executor never cancels on verdict-failure).
4. Verify GREEN.
5. Commit: "feat(group-core): verdict failures never cancel siblings"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 17

### Task 20: MT-only failure — deterministic kickback parity
**Story:** "manual_test FAIL classification stays deterministic" (happy 1; negative: budget)
**Type:** happy-path

**Steps:**
1. Write failing tests: MT FAIL + siblings PASS → kickback event manual_test→build, hint equals serial baseline format, ZERO remediate dispatches; exhausted `manualTestSelfHeals` → halt with the serial baseline's reason wording.
2. Verify RED.
3. Implement: join routes MT FAIL rows through the existing deterministic block (extract/reuse, do not duplicate).
4. Verify GREEN.
5. Commit: "feat(conductor): join preserves deterministic manual_test kickback"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 18

### Task 21: Mixed failure — single remediate dispatch over the gap union
**Story:** "One remediate dispatch plans the union…" (happy 1); "manual_test FAIL…" (happy 2)
**Type:** happy-path

**Steps:**
1. Write failing tests: prd gaps + as-built BLOCKED → exactly one `stepRunner.run('remediate', …)`; dispatch context enumerates BOTH evidence file paths and NOT manual-test paths; 3 heterogeneous dispositions consumed.
2. Verify RED.
3. Implement union hint construction + single planRemediation call at the join.
4. Verify GREEN.
5. Commit: "feat(conductor): consolidated remediate dispatch over validator gap union"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 18

### Task 22: Merged work order — earliest target + both evidence streams
**Story:** "A FAIL verdict waits…" (happy 2, negative: earliest target); "One remediate dispatch…" (happy 2)
**Type:** happy-path

**Steps:**
1. Write failing tests: MT FAIL (build) + plan-routed disposition → ONE navigateBack to build; retry hint contains both the FAIL rows and the remediation guidance; later-step dispositions preserved for their gates' next pass.
2. Verify RED.
3. Implement work-order merge (earliestRemediationTarget over the union + hint concatenation).
4. Verify GREEN.
5. Commit: "feat(conductor): one merged kickback work order per join round"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 20, 21

### Task 23: Halt dispositions and partial plans
**Story:** "One remediate dispatch…" (negatives: halt disposition; partial plan)
**Type:** negative-path

**Steps:**
1. Write failing tests: remediate returns `kind:'halt'` → loop_halt with remediation detail despite sibling PASSes; dispositions covering a subset → unaddressed gaps' gates remain unsatisfied on the next tail pass.
2. Verify RED.
3. Implement halt propagation + no-green-light-for-unplanned-gaps behavior.
4. Verify GREEN.
5. Commit: "feat(conductor): join honors halt dispositions; partial plans never clear gaps"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 21

### Task 24: Remediation fallback + budget parity
**Story:** "manual_test FAIL…" (negative: planner unusable → deterministic stream proceeds); "One remediate dispatch…" (negative: remediationRounds cap)
**Type:** negative-path

**Steps:**
1. Write failing tests: readRemediationPlan → null → MT deterministic kickback still proceeds (LLM stream independence); `remediationRounds` at `MAX_KICKBACKS_PER_GATE` → halt exactly as serial.
2. Verify RED.
3. Implement fallback ordering + budget checks at the join.
4. Verify GREEN.
5. Commit: "feat(conductor): join remediation fallback + budget parity"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 22, 23

### Task 25: Group events — attribution and phantom-member absence
**Story:** "Group progress is observable in the event stream" (all criteria)
**Type:** happy-path

**Steps:**
1. Write failing tests: `parallel_started` lists only dispatched members; member step events carry member identity in the payload; mixed outcome → `parallel_failure` names the member; skip events for skipped members unchanged.
2. Verify RED.
3. Implement event payload threading (extend event types if needed).
4. Verify GREEN.
5. Commit: "feat(events): branch-attributed validation group events"

**Files:**
- src/conductor/src/engine/group-core.ts
- src/conductor/src/types/events.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 15

### Task 26: Wall-clock concurrency proof
**Story:** "Validation group fans out…" (negative: 3t/2t/t under cap 2 < serial sum)
**Type:** negative-path

**Steps:**
1. Write failing test with fake-timer stub runners (durations 3t/2t/t, cap 2): group duration < 6t and ≥ max chain; start-event interleaving proves overlap.
2. Verify RED (against a serial stub).
3. Wire test to the real core.
4. Verify GREEN.
5. Commit: "test(group-core): wall-clock concurrency proof"

**Files:**
- src/conductor/test/engine/group-core.test.ts

**Dependencies:** 17

### Task 27: SIGINT persistence across the group (integration)
**Story:** "Validation group fans out…" (negative: SIGINT; resumed run skips done members)
**Type:** negative-path

**Steps:**
1. Write failing test: abort mid-group with one member done → state file carries `done` for it; resumed run re-dispatches only unfinished members.
2. Verify RED.
3. Implement resume-awareness in membership resolution (done members skip re-dispatch).
4. Verify GREEN.
5. Commit: "feat(conductor): group resume skips completed members"

**Files:**
- src/conductor/src/engine/conductor.ts
- src/conductor/src/engine/group-core.ts
- src/conductor/test/engine/conductor.test.ts

**Dependencies:** 8, 17

### Task 28: Engine docs — README + conductor README
**Story:** "validation_concurrency…" Done-When docs gate; TS-JOIN follow-ups
**Type:** infrastructure

**Steps:**
1. Update README.md (daemon section: validation group, auto-mode-only, `validation_concurrency` default/clamp) and src/conductor/README.md (gate-loop section: parallel validation phase, join semantics, consolidated remediation; Remediation section: union dispatch; ALL_STEPS/group entry).
2. Verify: doc lint none; cross-check every claim against implemented behavior.
3. Commit: "docs: parallel validation phase + validation_concurrency"

**Files:**
- README.md
- src/conductor/README.md

**Dependencies:** 24, 25

### Task 29: Harness docs — HARNESS.md SHIP line + three SKILL.md ordering lines
**Story:** TS-JOIN follow-up (SKILL prose "after X" lines); conflict-report note
**Type:** infrastructure

**Steps:**
1. Update HARNESS.md SHIP-phase sequence line (validators fan out in daemon mode after build_review); update skills/manual-test/SKILL.md, skills/prd-audit/SKILL.md, skills/architecture-review/SKILL.md prose ordering ("runs after/before") to group membership wording — no contract/marker changes.
2. Run test/test_harness_integrity.sh — all checks pass.
3. Commit: "docs(harness): SHIP validators run as a concurrent group in daemon mode"

**Files:**
- HARNESS.md
- skills/manual-test/SKILL.md
- skills/prd-audit/SKILL.md
- skills/architecture-review/SKILL.md

**Dependencies:** 28

### Task 30: CHANGELOG + full validation
**Story:** repo release gate (CLAUDE.md)
**Type:** infrastructure

**Steps:**
1. Add CHANGELOG `[Unreleased]` entries: Added (validation group, validation_concurrency), Changed (parallel: DSL executor corrected), Removed (runParallelGroup internal). No Migration block (additive config; internal engine) — if the release-gate classifier flags a surface, add a waiver per adr-2026-07-06-migration-gate-waiver instead.
2. Run full suite: cd src/conductor && npx vitest run (rtk proxy); run test/test_harness_integrity.sh.
3. Commit: "chore: changelog for parallel validation phase"

**Files:**
- CHANGELOG.md

**Dependencies:** 29

## Task Dependency Graph

```
1 → 2 ─────────────────────────┐
3 → 4 → 5 → 6 → 7              │
            6 → 8 ──────────┐  │
        5 → 9               │  │
   (5,9) → 10 → 11 → 12 ←───┼──┘   [12 also needs 2]
3 → 13 → 14 → 15 → 16       │
           15 → 17 → 18 → 20 ─┐
                17 → 19       ├→ 22 → 24
                18 → 21 ──────┘    23 → 24
           15 → 25            21 → 23
                17 → 26
        (8,17) → 27
(24,25) → 28 → 29 → 30
```

Acyclic; phases: config (1-2) ∥ core (3-9) → DSL re-point (10-12) → group (13-16) →
join (17-27) → docs (28-30).

## Integration Points

- After Task 12: the rewritten when-parallel suite proves GroupCore end-to-end via the
  config DSL (both consumers' shared core exercised).
- After Task 17: an all-green validation group runs end-to-end in an engine test.
- After Task 24: the full mixed-failure join (deterministic + LLM streams merged) is
  provable end-to-end; this is the #469 acceptance moment.
- After Task 27: resume/SIGINT semantics complete — daemon-restart-safe.

## Verification

- [ ] All happy path criteria covered by at least one task (mapping below)
- [ ] All negative path criteria covered by at least one task (mapping below)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic

## Coverage Mapping (story → tasks)

| Story | Tasks |
|---|---|
| Fans out concurrently after build_review | 4, 14, 17, 18, 26, 27 |
| Width respects skip rules (0–3) | 15, 16 |
| FAIL waits for siblings; union join | 18, 19, 22 |
| manual_test stays deterministic | 20, 21, 24 |
| One remediate dispatch over union | 21, 22, 23, 24 |
| Rate-limit episode under concurrency | 6, 7, 8 |
| Per-branch skill + fresh session | 5, 10, 11 |
| validation_concurrency config | 1, 2, 12 |
| Single-writer state/gates | 9, 17 |
| Observable group events | 25 |
