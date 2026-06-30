# Implementation Plan: Gated rebase-conflict resolution skill

**Date:** 2026-06-29
**Design:** `.docs/specs/2026-06-29-rebase-resolution-skill.md`
**Stories:** `.docs/stories/rebase-resolution-skill.md`
**ADR:** `.docs/decisions/adr-2026-06-29-rebase-conflict-resolution-dispatch.md` (APPROVED)
**Architecture review:** `.docs/decisions/architecture-review-2026-06-29-rebase-resolution-skill.md`
**Conflict check:** Clean as of 2026-06-29

## Summary

Insert a bounded, skill-driven conflict-resolution sub-loop into the daemon's engine-native
`rebase` step, between `performRebase`'s `conflict_halt` outcome and `writeHalt`. ~19 tasks.

## Technical Approach

- **Pure helper, injected resolver (mirrors `performRebase`).** Add `resolveRebaseConflicts()` to
  `rebase.ts` that takes the `GitRunner`, `projectRoot`, the conflict outcome, an **injected
  resolver function** `(ctx) => Promise<ResolutionAttempt>`, and the cap N. It runs the attempt
  loop, applies the FR-8/FR-9 guards after each claimed success, re-classifies via the existing
  `classifyClean`/path logic, and returns a `RebaseOutcome` (the resolved `noop`/`changed`, or a
  terminal `conflict_halt`). Keeping the resolver injected makes the whole loop unit-testable with
  a fake resolver — no Claude, no real dispatch, the same testing style as the rest of `rebase.ts`.
- **Dispatch seam = a new optional `StepRunner` method.** Add `resolveRebaseConflict?(ctx)` to the
  `StepRunner` interface (mirrors `assessComplexity?()`). `runRebaseStep` passes
  `this.stepRunner.resolveRebaseConflict?.bind(...)` as the injected resolver. `DefaultStepRunner`
  implements it by dispatching `skills/rebase` (print mode) and parsing a structured result
  (`{ resolved: true } | { resolved: false, reason }`). Tests inject a fake `StepRunner`.
  **Do NOT** route through `DefaultStepRunner.run()` — it throws for `'rebase'`.
- **Guards (load-bearing).** After a claimed resolution: (FR-8) `isBranchCurrent` must hold;
  (FR-9) the feature's commits (base..HEAD by **patch-id + subject set**) must all survive. Either
  failing → the attempt is rejected (re-loop or, if exhausted, HALT). A resolution is *only*
  accepted when both hold.
- **Config.** New dedicated key resolving to the attempt cap (default 3, `0` disables); resolved via
  `resolved-config.ts`. Not `DEFAULT_STEP_RETRIES.rebase`.
- **Events.** Extend the rebase event family with `rebase_resolution_attempt`
  (`{index, cap}`), `rebase_resolution_succeeded`, `rebase_resolution_failed`,
  `rebase_resolution_exhausted`. Best-effort emission like `emitRebaseEvent`.
- **Skill.** `skills/rebase/SKILL.md` — the resolution playbook + frontmatter. Manually invokable
  (FR-10), operator-only (never by impl agents mid-build).

## Prerequisites

- All in the conductor TS package; run `npm ci` / build available under `src/conductor/`.
- Tests use `daemon: true` against an **isolated fixture git repo** (never the live checkout) —
  per the recurring real-repo rebase-corruption hazard.

## Tasks

### Task 1: Add the resolution attempt-cap config key
**Story:** Bound resolution attempts (FR-3, FR-7) — happy + default
**Type:** infrastructure
**Steps:**
1. Failing test: `resolved-config` resolves the rebase-resolution cap to `3` by default, honors an
   override, and clamps a negative/NaN value back to the default; `0` is preserved as a valid
   "disabled" value.
2. RED.
3. Implement a dedicated key (e.g. `rebase_resolution_attempts`) + resolver fn in
   `resolved-config.ts`; default `3`, `0` allowed, invalid → default.
4. GREEN.
5. Commit: "feat(rebase): configurable rebase-resolution attempt cap (default 3, 0=disabled)".
**Files:** `src/conductor/src/engine/resolved-config.ts`, test under `test/engine/`.
**Dependencies:** none.

### Task 2: Add resolution lifecycle event types
**Story:** Emit resolution lifecycle events (FR-11)
**Type:** infrastructure
**Steps:**
1. Failing test: the event union accepts `rebase_resolution_attempt {index,cap}`,
   `_succeeded`, `_failed`, `_exhausted`; a type-level/no-op emit test.
2. RED.
3. Add the four variants to `src/conductor/src/types/events.ts`.
4. GREEN.
5. Commit: "feat(rebase): rebase_resolution_* event types".
**Files:** `src/conductor/src/types/events.ts`, test.
**Dependencies:** none.

### Task 3: Add `resolveRebaseConflict?()` to the StepRunner interface + result type
**Story:** Dispatch resolver (FR-1) — seam
**Type:** infrastructure
**Steps:**
1. Failing test: a fake `StepRunner` implementing `resolveRebaseConflict` is accepted by the
   conductor type; define `ResolutionAttempt = { resolved: true } | { resolved: false; reason: string }`.
2. RED.
3. Add the optional method to `StepRunner` (`conductor.ts:189`) mirroring `assessComplexity?()`;
   export `ResolutionAttempt` + a `ResolutionContext` (conflicted files, projectRoot, base ref).
4. GREEN.
5. Commit: "feat(rebase): StepRunner.resolveRebaseConflict seam".
**Files:** `src/conductor/src/engine/conductor.ts` (interface), types.
**Dependencies:** none.

### Task 4: FR-9 commit-preservation helper (patch-id/subject set)
**Story:** Reject a resolution that drops feature commits (FR-9)
**Type:** infrastructure
**Steps:**
1. Failing test (fixture repo): `featureCommitsPreserved(git, baseRef, preTreeRef)` returns true
   when all pre-rebase feature commits (by patch-id + subject) are present in `base..HEAD` after;
   false when one was dropped; and correctly treats a legitimately-empty-after-rebase branch as
   "not a drop" (no false positive).
2. RED.
3. Implement the helper in `rebase.ts` using `git patch-id` / `git log --format` over `base..HEAD`.
4. GREEN.
5. Commit: "feat(rebase): commit-preservation check via patch-id/subject set".
**Files:** `src/conductor/src/engine/rebase.ts`, test.
**Dependencies:** none.

### Task 5: Resolution-loop helper — happy path (clean resolve → outcome)
**Story:** Resolver resolves & continues (FR-2); code-changing re-verify (FR-4)
**Type:** happy-path
**Steps:**
1. Failing test (fixture): `resolveRebaseConflicts(git, root, conflictOutcome, fakeResolver, cap)`
   with a fakeResolver that resolves + `--continue`s cleanly returns `{kind:'changed', ...}` when
   code changed (and `{kind:'noop'}` for docs-only), with `rebaseStateActive` false.
2. RED.
3. Implement the loop body: call resolver → on `resolved:true` check completion
   (`rebaseStateActive` false / no unmerged) → guards (Tasks 6,4) → re-classify via existing
   `classifyClean`/path filter → return outcome.
4. GREEN.
5. Commit: "feat(rebase): resolution loop happy path with re-classification".
**Files:** `rebase.ts`, test.
**Dependencies:** Task 4.

### Task 6: FR-8 guard — accept only if branch current
**Story:** Never report a non-current branch satisfied (FR-8)
**Type:** negative-path
**Steps:**
1. Failing test: a fakeResolver that claims `resolved:true` but leaves the branch NOT current
   (HEAD..base != 0) → the attempt is NOT accepted (loops or HALTs); indeterminate `rev-list`
   (unknown ref) is treated as not-current (fail closed).
2. RED.
3. In the loop, after completion check, require `isBranchCurrent(git, base.ref)` before acceptance.
4. GREEN.
5. Commit: "fix(rebase): resolution accepted only when branch is genuinely current".
**Files:** `rebase.ts`, test.
**Dependencies:** Task 5.

### Task 7: FR-9 guard wired into the loop
**Story:** Reject dropped-commit resolution (FR-9)
**Type:** negative-path
**Steps:**
1. Failing test: a fakeResolver that completes but drops a feature commit → rejected → (exhaust →)
   `conflict_halt`; preserved commits → accepted.
2. RED.
3. Wire `featureCommitsPreserved` (Task 4) into the acceptance check after FR-8.
4. GREEN.
5. Commit: "fix(rebase): reject resolution that drops feature commits".
**Files:** `rebase.ts`, test.
**Dependencies:** Tasks 4, 6.

### Task 8: Attempt bounding + exhaustion → conflict_halt
**Story:** Exhaust attempts then HALT (FR-5); exactly N (FR-3)
**Type:** negative-path
**Steps:**
1. Failing test: a fakeResolver that always fails → exactly N resolver calls, then the helper
   returns `{kind:'conflict_halt', reason includes attempt count}`; rebase left paused (not aborted).
2. RED.
3. Implement the `for attempt in 1..N` bound; on exhaustion return `conflict_halt` carrying the
   count in `reason`.
4. GREEN.
5. Commit: "feat(rebase): bound resolution attempts, halt on exhaustion".
**Files:** `rebase.ts`, test.
**Dependencies:** Task 5.

### Task 9: Short-circuit on cannot-resolve signal
**Story:** Resolver may short-circuit to HALT (FR-6)
**Type:** negative-path
**Steps:**
1. Failing test: a fakeResolver returning `{resolved:false, reason}` on attempt 1 of 3 →
   `conflict_halt` immediately, remaining attempts NOT run; a malformed/empty signal is treated as a
   failed attempt (never accepted).
2. RED.
3. Honor an explicit `resolved:false` as an early give-up (reason propagated); guard malformed shapes.
4. GREEN.
5. Commit: "feat(rebase): honor resolver short-circuit give-up".
**Files:** `rebase.ts`, test.
**Dependencies:** Task 8.

### Task 10: Wire the sub-loop into `runRebaseStep` (cap>0 path)
**Story:** Dispatch resolver instead of immediate HALT (FR-1)
**Type:** integration
**Steps:**
1. Failing test (Conductor, `daemon:true`, fixture, fake StepRunner): a `conflict_halt` with cap 3
   invokes `resolveRebaseConflict` and, on success, writes NO HALT and runs `applyRebaseVerdicts`;
   a non-`conflict_halt` outcome never invokes the resolver.
2. RED.
3. In `runRebaseStep` (conductor.ts ~1500-1525): when `outcome.kind==='conflict_halt'` and cap>0 and
   `this.stepRunner.resolveRebaseConflict` exists, call `resolveRebaseConflicts(...)` with the
   bound resolver; use its returned outcome for `applyRebaseVerdicts`/`emit`/HALT decision.
4. GREEN.
5. Commit: "feat(rebase): gate conflict_halt through resolution sub-loop".
**Files:** `conductor.ts` (`runRebaseStep`), test.
**Dependencies:** Tasks 1, 5, 8.

### Task 11: cap=0 and no-resolver → immediate HALT (unchanged behavior)
**Story:** attempts=0 reproduces immediate HALT (FR-7); dispatch-error fallback (FR-1 neg)
**Type:** negative-path
**Steps:**
1. Failing test: cap 0 → resolver NOT called, `.pipeline/HALT` written immediately (byte-for-byte
   today's path); a resolver that throws → degrade to HALT (never a satisfied gate).
2. RED.
3. Short-circuit before dispatch when cap===0 or no `resolveRebaseConflict`; wrap dispatch in
   try/catch → `conflict_halt`.
4. GREEN.
5. Commit: "feat(rebase): cap=0 disables resolution; dispatch errors fall back to HALT".
**Files:** `conductor.ts`, test.
**Dependencies:** Task 10.

### Task 12: Emit resolution lifecycle events
**Story:** Emit lifecycle events (FR-11)
**Type:** happy-path
**Steps:**
1. Failing test: an attempt emits `rebase_resolution_attempt {index,cap}` then `_succeeded`/`_failed`;
   exhaustion emits `_exhausted`; a throwing emitter does not change the result; cap 0 emits no
   attempt events.
2. RED.
3. Emit at the loop boundaries (best-effort, try/catch like `emitRebaseEvent`).
4. GREEN.
5. Commit: "feat(rebase): emit rebase_resolution_* lifecycle events".
**Files:** `rebase.ts` (or a small emit helper) + `conductor.ts`, test.
**Dependencies:** Tasks 2, 10.

### Task 13: HALT note records attempt count
**Story:** HALT note records N attempts (FR-5)
**Type:** happy-path
**Steps:**
1. Failing test: after exhaustion, the `.pipeline/HALT` body states N resolution attempts were made.
2. RED.
3. Pass the attempt count through to `writeHalt`'s `extraReason` (or extend the reason string).
4. GREEN.
5. Commit: "feat(rebase): record resolution attempt count in HALT note".
**Files:** `conductor.ts` / `rebase.ts` `writeHalt` call, test.
**Dependencies:** Tasks 8, 10.

### Task 14: `DefaultStepRunner.resolveRebaseConflict` implementation
**Story:** Dispatch the rebase skill (FR-1/FR-2 live path)
**Type:** integration
**Steps:**
1. Failing test: `DefaultStepRunner.resolveRebaseConflict(ctx)` dispatches the `rebase` skill in
   print mode and maps stdout to `ResolutionAttempt` — a structured "resolved" marker → `{resolved:true}`,
   a "cannot resolve: <reason>" marker → `{resolved:false, reason}`, unparseable → `{resolved:false}`.
2. RED.
3. Implement using the existing print-mode dispatch path (same machinery as other dispatched steps),
   targeting `skills/rebase`, with a fixed result contract the SKILL.md is told to emit.
4. GREEN.
5. Commit: "feat(rebase): DefaultStepRunner dispatches the rebase resolution skill".
**Files:** `src/conductor/src/engine/step-runners.ts`, test.
**Dependencies:** Tasks 3, 15.

### Task 15: Author `skills/rebase/SKILL.md`
**Story:** Author the rebase skill so integrity passes (FR-12); manual invoke (FR-10)
**Type:** infrastructure
**Steps:**
1. Write `skills/rebase/SKILL.md` with YAML frontmatter (`name: rebase`, `description`,
   `enforcement`, `phase`), the resolution playbook (inspect conflicted files, resolve, stage,
   `git rebase --continue`, drive further hunks; the structured result contract from Task 14;
   the explicit "operator-only, never mid-build" note; the cannot-resolve give-up path).
2. Decide agent persona: inline playbook (no `agents/` file) unless one is warranted — if a persona
   is referenced, create `agents/<name>.md`.
3. Verify: `bash -n` n/a; ensure frontmatter fields present.
4. Commit: "feat(rebase): add rebase resolution skill".
**Files:** `skills/rebase/SKILL.md` (+ optional `agents/*.md`).
**Dependencies:** none.

### Task 16: HARNESS.md model-selection table row for `rebase`
**Story:** Integrity suite passes (FR-12)
**Type:** infrastructure
**Steps:**
1. Failing check: `test/test_harness_integrity.sh` model-table check requires a `rebase` row.
2. Add the `rebase` row (model/effort appropriate for conflict resolution — e.g. a capable model).
3. Re-run the model-table portion → pass.
4. Commit: "docs(harness): model-table row for rebase skill".
**Files:** `HARNESS.md`.
**Dependencies:** Task 15.

### Task 17: Docs — README + conductor README
**Story:** Docs track features (CLAUDE.md upkeep)
**Type:** infrastructure
**Steps:**
1. Document the gated rebase-resolution behavior + the attempt-cap config (default 3, `0` disables)
   in `README.md` and the daemon section of `src/conductor/README.md` (incl. the as-built/kickback
   interaction and operator-only manual `/rebase`).
2. Commit: "docs: gated rebase-conflict resolution + attempt-cap config".
**Files:** `README.md`, `src/conductor/README.md`.
**Dependencies:** Tasks 10, 15.

### Task 18: CHANGELOG [Unreleased]
**Story:** Release gate (CLAUDE.md)
**Type:** infrastructure
**Steps:**
1. Add entries under `## [Unreleased]` → Added (rebase resolution skill + gated sub-loop, config
   key, events). Append only this feature's lines.
2. Commit: "docs(changelog): rebase resolution skill".
**Files:** `CHANGELOG.md`.
**Dependencies:** none.

### Task 19: Run the harness integrity suite (final gate)
**Story:** Integrity passes (FR-12)
**Type:** infrastructure
**Steps:**
1. Run `test/test_harness_integrity.sh`; run the conductor test suite (`npm test` under
   `src/conductor`). Fix any failures (frontmatter, cross-skill refs, model table, section numbers).
2. Commit any fixes: "test: harness integrity + conductor suite green".
**Files:** as needed.
**Dependencies:** all prior.

## Task Dependency Graph

```
1 ─┐
2 ─┼─────────────► 10 ─► 11
3 ─┘               │└──► 12 (needs 2)
4 ─► 5 ─► 6 ─► 7   │     13 (needs 8)
        5 ─► 8 ─► 9┘
15 ─► 16
15 ─► 14 (needs 3)
10,15 ─► 17
18 (independent)
all ─► 19
```

## Integration Points

- After Task 10: end-to-end gated sub-loop works in-engine with a fake resolver (no Claude).
- After Task 14: the live `skills/rebase` dispatch path is wired.
- After Task 19: full harness integrity + conductor suite green — ready for SHIP.

## Verification

- [ ] Every story acceptance criterion (happy + negative) maps to a task (see coverage below)
- [ ] Negative paths are explicit tasks (FR-5/6/7/8/9 each have dedicated tasks 6–9, 11)
- [ ] No task exceeds ~5 min
- [ ] Dependencies explicit and acyclic
- [ ] The 4 architecture-review conditions are concrete tasks (1→cond3, 3+14→cond1, 4+7→cond2,
      residual-risk note carried in ADR/docs→cond4)

## Coverage Map (FR → tasks)

- FR-1 → 10, 11 · FR-2 → 5, 14 · FR-3 → 1, 8 · FR-4 → 5, 10 · FR-5 → 8, 13 · FR-6 → 9 ·
  FR-7 → 1, 11 · FR-8 → 6 · FR-9 → 4, 7 · FR-10 → 15 (+11 interactive no-op already exists) ·
  FR-11 → 2, 12 · FR-12 → 15, 16, 19
