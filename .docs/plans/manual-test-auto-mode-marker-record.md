# Implementation Plan: manual_test auto-mode marker record

**Date:** 2026-07-21
**Design:** `.docs/decisions/adr-2026-07-21-manual-test-auto-mode-marker-record.md` (APPROVED)
**Stories:** `.docs/stories/manual-test-auto-mode-marker-record.md`
**Complexity:** `.docs/complexity/manual-test-auto-mode-marker-record.md` (Tier M)
**Conflict check:** Clean as of 2026-07-21 (`.docs/conflicts/2026-07-21-manual-test-auto-mode-marker-record.md`)

## Summary

Adds a fail-closed `conduct-ts manual-test-record` CLI (skip + results modes) that becomes the
sole writer of `.pipeline/manual-test-results.md`, teaches the `manual_test` completion predicate
to accept an auditable SKIP sentinel as `done`, points the retry hint at the command, rewrites
the manual-test skill to call the CLI on every exit path, and makes `manual_test` S-tier
skippable (D5). ~19 TDD tasks.

## Technical Approach

Mirror the #281 `finish-record` precedent exactly (the working template):

- **New module** `src/conductor/src/engine/manual-test-record-cli.ts` with the same trio finish
  uses: `detectManualTestRecordCommand(argv)` (matches `argv[2] === 'manual-test-record'`),
  `dispatchManualTestRecord(cmd, cwd, runners)`, and `makeProductionManualTestRecordRunners()`.
  Two mutually-exclusive modes: `--skip --reason <text> --pipeline-dir <dir>` and
  `--results <path|-> --pipeline-dir <dir>`. Both **append** an `## Attempt N` section and are
  **atomic + fail-closed** (write temp + rename; on any error leave the target untouched — the
  marker is the commit point).
- **SKIP sentinel** — a fixed, greppable token line inside the attempt section (e.g.
  `<!-- manual-test:skipped -->` plus a human `**Result:** SKIPPED — <reason>` line). A helper
  `isSkipAttempt(latestSection)` in `artifacts.ts` recognizes it. The sentinel carries no
  PASS/FAIL table rows, so the existing #367 FAIL-row parsing and the parallel-validation reader
  are unaffected (results-file shape preserved).
- **Predicate** — extend `CUSTOM_COMPLETION_PREDICATES.manual_test` (`artifacts.ts`): if the
  latest attempt `isSkipAttempt` AND is fresh (mtime > sessionStartedAt) AND has no FAIL rows →
  `{ done: true }`. FAIL-row handling, freshness, and the whitewash guard are otherwise unchanged.
- **Retry hint** — extend the `manual_test` case in `buildRetryHint` (`conductor.ts`) so a
  missing-marker miss cites `conduct-ts manual-test-record …`; a FAIL-reason miss does not.
- **Skill** — rewrite `skills/manual-test/SKILL.md` so every exit branch (Step 0 SKIP + real-run
  PASS/FAIL) ends by invoking the CLI against the absolute worktree `.pipeline` path from the
  step system prompt, before cleanup; add the refusal contract + a checklist line.
- **S-tier skip (D5)** — set `skippableForTiers: ['S']` on the `manual_test` step def
  (`steps.ts`), reusing the selector tier-skip path (`selector.ts:71`) already used by
  `conflict_check`/`acceptance_specs`. Enforcement is untouched (stays `gating`,
  `ENFORCEMENT_LOCKED_STEPS`).
- **Docs/release** — CHANGELOG `[Unreleased] > Fixed`; VERSION bump is **MINOR** (new subcommand +
  additive gate behavior + a tier-skip policy change). Evaluate migration-block-vs-waiver for the
  new `conduct-ts` subcommand, the SKILL.md contract change, and the `steps.ts` topology change
  (all additive/policy, so a `.docs/release-waivers/` waiver is the likely correct artifact, not
  an empty migration block).

Verified against `origin/main`: `finish-record-cli.ts` trio + `index.ts:350-352` wiring,
`STEP_ARTIFACT_GLOBS.manual_test` + `CUSTOM_COMPLETION_PREDICATES.manual_test` in `artifacts.ts`,
`buildRetryHint` at `conductor.ts:6059-6095`, `manual_test` step def `steps.ts:169-188`
(`skippableForTiers: []`, no feature-type auto-skip).

## Prerequisites

- None. Reuses the existing `.pipeline` dir and the step system-prompt's absolute-pipeline-dir
  channel (same one finish uses).

## Tasks

### Task 1: SKIP sentinel constant + `isSkipAttempt` helper
**Story:** predicate accepts a fresh SKIP sentinel (infrastructure for D2)
**Type:** infrastructure
**Steps:**
1. Write failing test: `isSkipAttempt('<!-- manual-test:skipped -->\n**Result:** SKIPPED — no endpoint/UI stories')` → true; a PASS/FAIL table section → false.
2. Verify RED.
3. Implement `MANUAL_TEST_SKIP_SENTINEL` constant + `isSkipAttempt(section: string): boolean` in `artifacts.ts`, exported.
4. Verify GREEN.
5. Commit: "feat(artifacts): manual_test SKIP sentinel constant + isSkipAttempt helper"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — sentinel constant + helper
- `src/conductor/src/test/engine/artifacts.test.ts` — helper unit tests

**Wired-into:** `src/conductor/src/engine/artifacts.ts#manual_test` (consumed by the predicate, Task 7)
**Dependencies:** none

### Task 2: `detectManualTestRecordCommand` argv parser
**Story:** `--skip` sentinel / `--results` (D1) — parsing
**Type:** infrastructure
**Steps:**
1. Write failing test: `detectManualTestRecordCommand(['node','x','manual-test-record','--skip','--reason','r','--pipeline-dir','d'])` → `{kind:'skip',reason:'r',pipelineDir:'d'}`; `--results p --pipeline-dir d` → `{kind:'results',resultsPath:'p',pipelineDir:'d'}`; non-matching argv → null; malformed → `{kind:'guide'}`.
2. Verify RED.
3. Implement the parser in a new `src/conductor/src/engine/manual-test-record-cli.ts` (mirror `detectFinishRecordCommand`), incl. mutual-exclusion of `--skip`+`--results` → guide/error.
4. Verify GREEN.
5. Commit: "feat(conduct-ts): detect manual-test-record subcommand (skip|results)"

**Files likely touched:**
- `src/conductor/src/engine/manual-test-record-cli.ts` — parser + types
- `src/conductor/src/test/engine/manual-test-record-cli.test.ts` — parser tests

**Wired-into:** `src/conductor/src/index.ts#main` (dispatch wiring, Task 6)
**Dependencies:** none

### Task 3: `dispatchManualTestRecord` — skip mode (atomic, fail-closed append)
**Story:** `manual-test-record --skip` appends a recognized SKIP section (happy)
**Type:** happy-path
**Steps:**
1. Write failing test (fake runners): skip dispatch on empty file → file gets `## Attempt 1` with the sentinel + reason; exit 0.
2. Verify RED.
3. Implement `dispatchManualTestRecord` + `makeProductionManualTestRecordRunners` (atomic temp-write+rename append; compute next `Attempt N`).
4. Verify GREEN.
5. Commit: "feat(conduct-ts): manual-test-record --skip writes SKIP sentinel, fail-closed"

**Files likely touched:**
- `src/conductor/src/engine/manual-test-record-cli.ts` — dispatch + runners
- `src/conductor/src/test/engine/manual-test-record-cli.test.ts` — skip-mode tests

**Wired-into:** `src/conductor/src/index.ts#main` (Task 6)
**Dependencies:** Task 2

### Task 4: `dispatchManualTestRecord` — results mode (append attempt)
**Story:** `manual-test-record --results` appends a real PASS/FAIL attempt (happy)
**Type:** happy-path
**Steps:**
1. Write failing test: results dispatch (path + stdin `-`) appends `## Attempt N` with the supplied rows verbatim; prior attempt preserved.
2. Verify RED.
3. Implement results branch (read path or stdin; append section).
4. Verify GREEN.
5. Commit: "feat(conduct-ts): manual-test-record --results appends attempt section"

**Files likely touched:**
- `src/conductor/src/engine/manual-test-record-cli.ts` — results branch
- `src/conductor/src/test/engine/manual-test-record-cli.test.ts` — results-mode tests

**Wired-into:** same as Task 3
**Dependencies:** Task 3

### Task 5: CLI negative paths — fail-closed + usage errors
**Story:** `--skip`/`--results` negative paths (fail-closed, missing flags, empty payload, both modes)
**Type:** negative-path
**Steps:**
1. Write failing tests: missing `--reason` → non-zero, zero bytes written; missing `--pipeline-dir` → non-zero, nothing written; simulated write/rename failure → target file unchanged, no temp left; empty results payload → non-zero, nothing; `--skip`+`--results` together → non-zero usage error.
2. Verify RED.
3. Implement the guards (fail-closed ordering: validate args → build content → atomic write; on any throw, no partial state).
4. Verify GREEN.
5. Commit: "feat(conduct-ts): manual-test-record fail-closed guards + usage errors"

**Files likely touched:**
- `src/conductor/src/engine/manual-test-record-cli.ts` — guards
- `src/conductor/src/test/engine/manual-test-record-cli.test.ts` — negative tests

**Wired-into:** same as Task 3
**Dependencies:** Task 4

### Task 6: Wire `manual-test-record` into the conduct-ts CLI dispatch
**Story:** CLI reachable in production (D1 Wiring Surface)
**Type:** infrastructure
**Steps:**
1. Write failing test: a dispatch-level test (mirroring the finish-record dispatch test) asserts `argv[2]==='manual-test-record'` routes to `dispatchManualTestRecord` and exits with its code.
2. Verify RED.
3. Implement: in `src/conductor/src/index.ts`, immediately after the finish-record block (`index.ts:350-352`), add `const mtRecordCmd = detectManualTestRecordCommand(process.argv); if (mtRecordCmd) { const code = await dispatchManualTestRecord(...); process.exit(code); }`. Add the import.
4. Verify GREEN.
5. Commit: "feat(conduct-ts): wire manual-test-record into CLI dispatch"

**Files likely touched:**
- `src/conductor/src/index.ts` — import + dispatch guard
- `src/conductor/src/test/engine/*` — dispatch wiring test

**Wired-into:** `src/conductor/src/index.ts#main`
**Dependencies:** Task 5

### Task 7: Predicate accepts a fresh SKIP sentinel as done
**Story:** completion predicate accepts a fresh SKIP sentinel (happy)
**Type:** happy-path
**Steps:**
1. Write failing test: latest attempt = sentinel, mtime > sessionStartedAt → `checkStepCompletion(dir,'manual_test',ctx)` returns `{done:true}`; earlier PASS + later SKIP → done via latest.
2. Verify RED.
3. Implement: in `CUSTOM_COMPLETION_PREDICATES.manual_test`, after the missing-file check, branch on `isSkipAttempt(latestAttempt)` → apply freshness, then `done:true`.
4. Verify GREEN.
5. Commit: "feat(artifacts): manual_test predicate accepts fresh SKIP sentinel as done"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — predicate branch
- `src/conductor/src/test/engine/artifacts.test.ts` — skip-done tests

**Wired-into:** same as Task 1
**Dependencies:** Task 1

### Task 8: Predicate — stale SKIP is not done
**Story:** predicate negative — stale SKIP → done:false (`stale`)
**Type:** negative-path
**Steps:**
1. Write failing test: sentinel with mtime older than sessionStartedAt → `done:false`, reason matches `/stale/`.
2. Verify RED.
3. Implement: route SKIP through the same freshness check as PASS.
4. Verify GREEN.
5. Commit: "test(artifacts): stale manual_test SKIP sentinel fails freshness"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — freshness applies to skip
- `src/conductor/src/test/engine/artifacts.test.ts` — stale-skip test

**Wired-into:** same as Task 1
**Dependencies:** Task 7

### Task 9: Predicate — SKIP + FAIL in same attempt → FAIL wins
**Story:** predicate negative — SKIP+FAIL attempt → done:false
**Type:** negative-path
**Steps:**
1. Write failing test: latest attempt has the sentinel AND a FAIL row → `done:false` with a FAIL reason (FAIL takes precedence over the sentinel).
2. Verify RED.
3. Implement: evaluate FAIL rows before honoring the sentinel (ordering guard in the predicate).
4. Verify GREEN.
5. Commit: "feat(artifacts): FAIL rows override a SKIP sentinel in the same attempt"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — precedence ordering
- `src/conductor/src/test/engine/artifacts.test.ts` — skip+fail test

**Wired-into:** same as Task 1
**Dependencies:** Task 7

### Task 10: #367 whitewash guard is not launderable by a SKIP
**Story:** the #367 whitewash guard cannot be laundered by a SKIP
**Type:** negative-path
**Steps:**
1. Write failing test: FAIL rows recorded at sha A (fail-evidence marker written), then a later SKIP attempt with HEAD still = A → `done:false`; also assert the FAIL rows remain readable by `readManualTestFailRows` so the manual_test→build kickback still fires.
2. Verify RED.
3. Implement: ensure the whitewash guard runs against the recorded fail-evidence regardless of a later sentinel; a sentinel does not clear the marker or the FAIL rows.
4. Verify GREEN.
5. Commit: "feat(artifacts): SKIP sentinel cannot launder a recorded FAIL (#367 preserved)"

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — guard ordering vs sentinel
- `src/conductor/src/test/engine/artifacts.test.ts` — anti-launder test

**Wired-into:** same as Task 1
**Dependencies:** Task 9

### Task 11: Retry hint cites the record command for a missing marker
**Story:** the missing-marker retry hint points at the record command (D4)
**Type:** happy-path + negative-path
**Steps:**
1. Write failing tests: `buildRetryHint('manual_test', {reason:'<missing marker>'} )` → string names `conduct-ts manual-test-record`; a FAIL-reason → does NOT contain `--skip`; `buildRetryHint('finish'|'build'|other, …)` output byte-for-byte unchanged.
2. Verify RED.
3. Implement: add a `manual_test` branch to `buildRetryHint` (`conductor.ts:6059-6095`) distinguishing missing-marker vs FAIL reasons.
4. Verify GREEN.
5. Commit: "feat(conductor): manual_test retry hint points at manual-test-record"

**Files likely touched:**
- `src/conductor/src/engine/conductor.ts` — buildRetryHint manual_test branch
- `src/conductor/src/test/engine/*` — retry-hint unit tests

**Wired-into:** `src/conductor/src/engine/conductor.ts#buildRetryHint` (already called at `conductor.ts:4079`)
**Dependencies:** Task 1

### Task 12: Rewrite manual-test SKILL.md exit paths + refusal contract
**Story:** the manual-test skill records via the CLI on every exit path (D3)
**Type:** infrastructure
**Steps:**
1. Write failing check: a test/grep asserting `skills/manual-test/SKILL.md` contains a `manual-test-record --skip` directive in Step 0 and a `manual-test-record --results` directive on the real-run exit, plus a "refusal contract" paragraph; and that the old "so conduct can mark the step as done" SKIP language is gone.
2. Verify RED.
3. Implement: rewrite Step 0 SKIP + the results/exit sections to end with the CLI call against the absolute worktree `.pipeline` path (before cleanup); add refusal-contract paragraph + verification-checklist line.
4. Verify GREEN.
5. Commit: "feat(skills): manual-test records via manual-test-record on every exit path"

**Files likely touched:**
- `skills/manual-test/SKILL.md` — exit-path rewrite + refusal contract + checklist

**Wired-into:** none (skill prompt; the CLI it calls is wired by Task 6)
**Dependencies:** Task 6

### Task 13: Harness integrity passes on the edited SKILL.md
**Story:** the manual-test skill records… (negative — integrity)
**Type:** negative-path
**Steps:**
1. Run `test/test_harness_integrity.sh`; assert it passes (frontmatter fields, cross-skill refs, no duplicate section numbers) after the Task 12 edit.
2. If any check fails, fix the SKILL.md and re-run.
3. Commit only if a fix was needed.

**Files likely touched:**
- `skills/manual-test/SKILL.md` — fixes if integrity flags anything

**Wired-into:** none (no new production surface)
**Verify-only:** yes
**Dependencies:** Task 12

### Task 14: Acceptance — no-endpoint feature completes manual_test without HALT (daemon)
**Story:** a no-endpoint/UI feature completes manual_test in daemon mode without a HALT (happy)
**Type:** happy-path
**Steps:**
1. Write failing acceptance test: an auto-mode run of a feature with no HTTP/UI stories where the skill records `--skip` → `checkStepCompletion` done on attempt 1, no `.pipeline/halt-user-input-required` written, run advances past manual_test.
2. Verify RED.
3. Implement: rely on Tasks 3/6/7; adjust as needed so the end-to-end path passes.
4. Verify GREEN.
5. Commit: "test(acceptance): no-endpoint feature clears manual_test via SKIP, no HALT (#385)"

**Files likely touched:**
- `src/conductor/src/test/acceptance/manual-test-auto-mode-marker-record.acceptance.test.ts` — new
**Wired-into:** none (test)
**Dependencies:** Task 7, Task 6

### Task 15: Acceptance — genuine FAIL / true omission still HALT (no laundering)
**Story:** #385 integration negatives (endpoint FAIL still routes; genuine no-record still HALTs)
**Type:** negative-path
**Steps:**
1. Write failing acceptance tests: (a) endpoint feature with real FAIL rows → manual_test→build kickback then HALT per existing budget (unchanged); (b) a run that records neither results nor skip → gate unsatisfied → HALT (absent-marker signal survives).
2. Verify RED.
3. Implement: rely on Tasks 9/10; adjust so both negatives hold.
4. Verify GREEN.
5. Commit: "test(acceptance): FAIL and true-omission still HALT — SKIP path launders nothing"

**Files likely touched:**
- `src/conductor/src/test/acceptance/manual-test-auto-mode-marker-record.acceptance.test.ts` — negatives
**Wired-into:** same as Task 14
**Dependencies:** Task 14, Task 10

### Task 17: manual_test becomes S-tier skippable
**Story:** manual_test is skipped for S-tier features (happy)
**Type:** infrastructure
**Steps:**
1. Write failing test: with `state.complexity_tier === 'S'`, the selector skips `manual_test`
   (`getStepStatus === 'skipped'`); with `'M'`/`'L'`, it does not.
2. Verify RED.
3. Implement: change `skippableForTiers: []` → `['S']` on the `manual_test` step def in
   `steps.ts` (mirroring `conflict_check`/`acceptance_specs`).
4. Verify GREEN.
5. Commit: "feat(steps): manual_test is skippable for S-tier features (ADR D5)"

**Files likely touched:**
- `src/conductor/src/engine/steps.ts` — `skippableForTiers: ['S']`
- `src/conductor/src/test/engine/selector.test.ts` (or steps test) — tier-skip unit tests

**Wired-into:** `src/conductor/src/engine/selector.ts#71` (existing tier-skip check; no new call site)
**Dependencies:** none

### Task 18: S-tier skipped manual_test satisfies prd_audit prerequisite
**Story:** manual_test is skipped for S-tier features (happy — prereq)
**Type:** happy-path
**Steps:**
1. Write failing test: an S-tier state where `manual_test` is `skipped` → `prd_audit`'s
   `prerequisites: ['manual_test']` is satisfied and the tail chain proceeds (a `skipped` step
   counts as resolved for prereqs/selector — `state.ts:101`).
2. Verify RED (or confirm existing helper already covers it and make the assertion explicit).
3. Implement: no code change expected beyond Task 17 if the skipped-satisfies-prereq semantics
   already hold; otherwise adjust the prereq check.
4. Verify GREEN.
5. Commit: "test(steps): S-tier skipped manual_test satisfies prd_audit prerequisite"

**Files likely touched:**
- `src/conductor/src/test/engine/*` — prereq-satisfaction test
- `src/conductor/src/engine/selector.ts` — only if a fix is needed

**Wired-into:** none (test; behavior from Task 17)
**Verify-only:** yes
**Dependencies:** Task 17

### Task 19: D5 does not leak to M/L or downgrade enforcement
**Story:** manual_test is skipped for S-tier features (negatives)
**Type:** negative-path
**Steps:**
1. Write failing tests: (a) M/L tier → `manual_test` NOT skipped (runs + gates); (b) a local
   skill override declaring `enforcement: advisory` for manual-test still resolves to `gating`
   (still in `ENFORCEMENT_LOCKED_STEPS`); (c) an M/L feature with a genuine manual_test FAIL still
   kicks back to build / HALTs per #367 (regression).
2. Verify RED.
3. Implement: assertions only (Task 17 provides the behavior; the enforcement lock and #367 paths
   are unchanged) — add a fix only if a leak is found.
4. Verify GREEN.
5. Commit: "test(steps): S-tier manual_test skip does not leak to M/L or downgrade enforcement"

**Files likely touched:**
- `src/conductor/src/test/engine/*` — leak + enforcement-lock + #367 regression tests

**Wired-into:** none (tests)
**Dependencies:** Task 17

### Task 16: Docs, CHANGELOG, VERSION, migration/waiver
**Story:** release-gate compliance (harness convention)
**Type:** infrastructure
**Steps:**
1. Add a `CHANGELOG.md` `[Unreleased]` entry — `Fixed` for intake #385 (auto-mode HALT, new `manual-test-record` CLI, SKIP-sentinel gate) and `Changed` for the D5 S-tier skip of `manual_test`.
2. Bump `VERSION` (MINOR — new subcommand + additive gate behavior + tier-skip policy change); document the semver rationale in the PR body.
3. Evaluate the self-host release gate: the new `conduct-ts` subcommand, the SKILL.md contract change, and the `steps.ts` S-tier-skip topology change are additive/policy (no breaking CLI/hook/schema behavior change). If the path classifier flags a breaking surface, add a `.docs/release-waivers/manual-test-auto-mode-marker-record.md` waiver (listing the flagged canonical surfaces + internal-only rationale) rather than an empty migration block. If any edit genuinely changes CLI/hook/schema behavior, author a real `## Migration` block instead.
4. Update `README.md` and `src/conductor/README.md` to document the `manual-test-record` subcommand, the SKIP-sentinel completion behavior, and that `manual_test` is now S-tier skippable.
5. Run `test/test_harness_integrity.sh` (VERSION semver, CHANGELOG sections).
6. Commit: "docs(changelog): manual_test auto-mode marker record (#385)"

**Files likely touched:**
- `CHANGELOG.md`, `VERSION`, `README.md`, `src/conductor/README.md`
- `.docs/release-waivers/manual-test-auto-mode-marker-record.md` — if the gate flags additive surfaces

**Wired-into:** none (docs/release)
**Dependencies:** Task 12, Task 6, Task 17

## Task Dependency Graph

```
Task 1 ─┬─ Task 7 ─┬─ Task 8
        │          ├─ Task 9 ─ Task 10 ─┐
        │          └─ (Task 14)          │
        └─ Task 11                       │
Task 2 ─ Task 3 ─ Task 4 ─ Task 5 ─ Task 6 ─┬─ Task 12 ─┬─ Task 13
                                            │           └─ Task 16
                                            ├─ Task 14 ─ Task 15
                                            └─ (Task 16)
Task 14 ─ Task 15   (also needs Task 10)
Task 17 ─┬─ Task 18
         ├─ Task 19
         └─ (Task 16)
Task 12, Task 6, Task 17 ─ Task 16
```

The D5 chain (Tasks 17–19) is independent of the CLI/predicate chain and can run in parallel;
only the docs task (16) joins them.

## Integration Points

- **After Task 6:** `conduct-ts manual-test-record` is invocable end-to-end (parser → dispatch → wired).
- **After Task 7:** a recorded SKIP clears the completion gate.
- **After Task 12:** the skill emits the record call on every exit; the loop no longer depends on free-hand marker writes.
- **After Task 15:** the full #385 outcome is proven — no-endpoint completes, FAIL/omission still HALT.
- **After Task 17:** S-tier features skip manual_test deterministically (D5).

## Verification

- [ ] All happy-path criteria covered (Tasks 3,4,7,11,12,14,17,18)
- [ ] All negative-path criteria covered (Tasks 5,8,9,10,11,13,15,19)
- [ ] No task exceeds ~5 minutes
- [ ] Dependencies explicit and acyclic (graph above)
- [ ] Every new-surface task carries a `**Wired-into:**` line (CLI → `index.ts#main`; predicate/hint → their engine call sites; S-tier skip → existing `selector.ts:71`; skill/docs → none)
- [ ] Coverage mapping: 8 stories → Tasks 1–19 (each story's Done-When maps to ≥1 task)
- [ ] Plan saved to `.docs/plans/manual-test-auto-mode-marker-record.md`
