# Implementation Plan: Release-time smoke and eval gate (#1259)

**Date:** 2026-08-04
**Stem:** no-release-time-smoke-or-eval-gate-releases-cut-wi
**Track:** technical (no PRD)
**Tier:** M
**Stories:** .docs/stories/no-release-time-smoke-or-eval-gate-releases-cut-wi.md
**Conflict check:** Clean as of 2026-08-04 — 0 blocking, 2 degrading resolved

## Summary

Give the smoke tier one auto-discovering entry point, replace nine bespoke env gates with a
declared capability per file, extract a zero-cost classification phase from the release publisher,
and wire `release.yml` so the tier runs once per release and blocks the tag when it fails. 20 tasks.

## Technical Approach

**Three independent seams, joined only at the end.** The smoke runner (Tasks 1-12) and the
publisher split (Tasks 13-15) have no dependency on each other; both are prerequisites of the
workflow wiring (Tasks 16-19). They can be built in either order or in parallel.

**Entry point by glob, not by list.** `src/conductor/vitest.smoke.config.ts` sets `include` to
exactly the globs the default config `exclude`s — `test/smoke/**` and `**/*.smoke.test.ts` — with
literal `exclude: []`. Vitest merges `exclude` arrays additively, so this config must *not* extend
the default config; `vitest.live-smoke.config.ts` already relies on that same property and is the
pattern to copy. `src/conductor/vitest.config.ts` is not edited at all:
`test/structural/test-execution-policy.test.ts:79-82` fails if either exclusion glob leaves it, and
`npm test`'s isolation depends on them staying.

**Capability replaces polarity.** The nine files currently mix three schemes — opt-in vars,
kill-switch vars, and no gate at all. The helper resolves a closed enum (`hermetic`, `toolchain`,
`credentialed`) once per run; the *mode* decides what an unmet capability means (advisory → skip,
gate → fail). Per the conflict resolution, the nine bespoke spellings retire but a single uniform
operator force-skip survives, because `DAEMON_E2E_LIVE_SMOKE=0` and `CODEX_CLI_SMOKE_TEST=1` are
relied upon by accepted specs (#1124, #927). In gate mode a forced skip of a `credentialed`
capability is a failure, so the override can never be why a release passes.

**Classify is an extraction, not a redesign.** Everything in
`src/conductor/src/engine/release-publisher-action.ts:61-92` is already a read or a return; the
first mutation is at line 94. Lifting lines 61-92 into `classifyReleasePublication` is
behavior-preserving by construction. Classify grants no authority — the publish job re-derives every
condition — so a stale classification can only waste a smoke run or yield `rejected`, never a bad tag.

**Cost is the reason for the job order.** `release.yml` fires on every push to `main`, and most are
ordinary feature merges. Classify (API reads, free) runs first and gates the smoke job's `if`, so
tokens are spent once per release rather than once per merge.

## Prerequisites

- **C-1 (operator, blocking merge):** provision `CLAUDE_CODE_OAUTH_TOKEN` as an Actions secret.
  Verified 2026-08-04: only `RELEASE_PR_APP_ID` and `RELEASE_PR_APP_PRIVATE_KEY` exist. Gate mode
  fails on a missing credential by design, so merging before this blocks the next release.
- Node toolchain per `src/conductor/.tool-versions`; no new dependency is introduced.

**Documentation note.** This repository routes human-facing documentation through its
`maintain-documentation` custom step, so review conditions C-4 (`docs/contributing/testing.md`,
`docs/contributing/releases.md`) carry no plan task here. They remain required before the PR is
complete.

## Tasks

### Task 1: Add the smoke vitest config and entry point
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Write failing test asserting a config file `vitest.smoke.config.ts` exists whose `include`
   contains both `test/smoke/**` and `**/*.smoke.test.ts` and whose `exclude` is an empty array.
2. Verify test fails (RED).
3. Add `src/conductor/vitest.smoke.config.ts`, copying `vitest.live-smoke.config.ts`'s structure
   (same `environment`, `setupFiles`, `globalSetup`, pool and timeouts), and add a `smoke` script to
   `package.json` running `vitest run --config vitest.smoke.config.ts`.
4. Verify test passes (GREEN).
5. Commit: "feat(test): add npm run smoke entry point with glob discovery"

**Files:**
- `src/conductor/vitest.smoke.config.ts` — new config
- `src/conductor/package.json` — new `smoke` script
- `src/conductor/test/structural/smoke-entry-point.test.ts` — new test

**Wired-into:** `src/conductor/package.json#scripts.smoke`
**Dependencies:** none

### Task 2: Prove discovery finds every known smoke file
**Story:** Story 1
**Type:** happy-path

**Steps:**
1. Write failing test resolving the smoke config's discovered file set and asserting it contains
   all nine known smoke files by path.
2. Verify test fails (RED).
3. Adjust globs if any file is missed.
4. Verify test passes (GREEN).
5. Commit: "test(smoke): assert glob discovery covers every smoke file"

**Files:** `src/conductor/test/structural/smoke-entry-point.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 3: Empty discovery exits non-zero
**Story:** Story 1, negative path
**Type:** negative-path

**Steps:**
1. Write failing test asserting that a smoke run discovering zero files exits non-zero rather than
   reporting a vacuous pass.
2. Verify test fails (RED).
3. Implement the non-empty-discovery assertion in the runner entry point.
4. Verify test passes (GREEN).
5. Commit: "fix(smoke): fail an empty discovery instead of passing vacuously"

**Files:**
- `src/conductor/test/structural/smoke-entry-point.test.ts`
- `src/conductor/test/smoke-capability.ts` — runner entry point

**Wired-into:** same as Task 1
**Dependencies:** Task 2

### Task 4: Guard the default run's exclusion globs
**Story:** Story 1, negative path
**Type:** negative-path

**Steps:**
1. Confirm `test/structural/test-execution-policy.test.ts` still fails when either exclusion glob
   is removed from `vitest.config.ts`, and that it passes unmodified against the new config.
2. Verify by temporarily removing a glob (RED), restoring it (GREEN).
3. Add an assertion that `npm test`'s discovered set contains no smoke file.
4. Verify test passes (GREEN).
5. Commit: "test(structural): assert the default run still excludes every smoke file"

**Files:** `src/conductor/test/structural/test-execution-policy.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 1

### Task 5: Capability enum and declaration helper
**Story:** Story 2
**Type:** infrastructure

**Steps:**
1. Write failing test asserting the helper exposes a closed capability set of exactly
   `hermetic`, `toolchain`, `credentialed`, and that a declaration records the file's capability.
2. Verify test fails (RED).
3. Implement the enum and declaration helper.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): add capability declaration helper"

**Files:**
- `src/conductor/test/smoke-capability.ts` — helper module
- `src/conductor/test/smoke-capability.test.ts` — new test

**Wired-into:** `src/conductor/test/smoke-capability.ts#declareSmokeCapability`
**Dependencies:** none

### Task 6: Reject an undeclared smoke file
**Story:** Story 2, negative path
**Type:** negative-path

**Steps:**
1. Write failing test asserting a discovered smoke file with no capability declaration is rejected
   with an error naming the file — never defaulted to `hermetic`.
2. Verify test fails (RED).
3. Implement the undeclared-file rejection.
4. Verify test passes (GREEN).
5. Commit: "fix(smoke): reject a smoke file that declares no capability"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 7: Reject an out-of-set capability value
**Story:** Story 2, negative path
**Type:** negative-path

**Steps:**
1. Write failing test asserting a declaration outside the closed set fails with an error naming the
   file and the invalid value.
2. Verify test fails (RED).
3. Implement closed-set validation.
4. Verify test passes (GREEN).
5. Commit: "fix(smoke): reject an out-of-set capability declaration"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 5

### Task 8: Advisory mode skips and names the unmet capability
**Story:** Story 2, happy path
**Type:** happy-path

**Steps:**
1. Write failing test asserting that with no credential and no `codex` binary, `hermetic` files run
   while `toolchain` and `credentialed` files report skipped, each naming what was unmet.
2. Verify test fails (RED).
3. Implement advisory-mode resolution.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): skip on unmet capability in advisory mode"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 7

### Task 9: Gate mode fails on an unmet capability
**Story:** Story 2, negative path
**Type:** negative-path

**Steps:**
1. Write failing test asserting that in gate mode a missing provider credential fails the run and
   names `CLAUDE_CODE_OAUTH_TOKEN` — it does not skip and does not report success.
2. Verify test fails (RED).
3. Implement gate-mode resolution.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): fail on unmet capability in gate mode"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 8

### Task 10: Gate mode fails when every credentialed file skips
**Story:** Story 2, negative path
**Type:** negative-path

**Steps:**
1. Write failing test asserting a gate-mode run in which no `credentialed` file executed exits
   non-zero, so an empty credentialed set can never report a pass.
2. Verify test fails (RED).
3. Implement the executed-at-least-once assertion for gate mode.
4. Verify test passes (GREEN).
5. Commit: "fix(smoke): fail gate mode when no credentialed case executed"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 9

### Task 11: Uniform operator force-skip override
**Story:** Story 2, negative path
**Type:** negative-path

**Steps:**
1. Write failing tests asserting a force-skip by capability and by file reports
   `skipped (operator override)` in advisory mode, and that force-skipping a `credentialed`
   capability in gate mode **fails** the run.
2. Verify tests fail (RED).
3. Implement the single override mechanism replacing the nine bespoke spellings.
4. Verify tests pass (GREEN).
5. Commit: "feat(smoke): add one uniform operator force-skip override"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 10

### Task 12: Emit the per-file ledger
**Story:** Story 2, happy path
**Type:** happy-path

**Steps:**
1. Write failing test asserting the run emits, per discovered file, its capability and an outcome of
   ran / skipped / failed, with the unmet capability on a skip and an evidence path on a failure —
   and that `failed` is distinguishable from `skipped`.
2. Verify test fails (RED).
3. Implement ledger emission.
4. Verify test passes (GREEN).
5. Commit: "feat(smoke): emit an attributable per-file outcome ledger"

**Files:** `src/conductor/test/smoke-capability.ts`; `src/conductor/test/smoke-capability.test.ts`
**Wired-into:** same as Task 5
**Dependencies:** Task 11

### Task 13: Migrate the nine smoke files to declarations
**Story:** Story 2
**Type:** refactor

**Steps:**
1. Write failing test asserting every discovered smoke file declares a capability and that none of
   the seven retired variables gates execution.
2. Verify test fails (RED).
3. Replace each file's gate with a declaration; `publish-interrupted` is `toolchain` (it execs
   `bin/setup`, which runs `npm install`), not `hermetic`.
4. Verify test passes (GREEN).
5. Commit: "refactor(smoke): declare capabilities across the smoke tier"

**Files:**
- `src/conductor/test/smoke/autoresolve-smoke.test.ts`
- `src/conductor/test/smoke/finish-record.smoke.test.ts`
- `src/conductor/test/smoke/publish-interrupted.smoke.test.ts`
- `src/conductor/test/smoke/surgical-finish-retry.smoke.test.ts`
- `src/conductor/test/execution/claude-provider.smoke.test.ts`
- `src/conductor/test/execution/codex-provider.smoke.test.ts`
- `src/conductor/test/backlog-priority.smoke.test.ts`
- `src/conductor/test/engine/build-token-auth.smoke.test.ts`
- `src/conductor/test/engine/daemon-e2e-live.smoke.test.ts`

**Wired-into:** same as Task 5
**Dependencies:** Task 12

### Task 14: Resolve the three never-run smoke files (C-2)
**Story:** Story 1
**Type:** infrastructure

**Steps:**
1. Run the full tier locally in advisory mode and record the outcome of `finish-record`,
   `publish-interrupted`, and `surgical-finish-retry`, which have never executed in CI.
2. Fix any failure, or force-skip it with a recorded reason if it is a genuine environment
   limitation rather than a defect.
3. Re-run and confirm a clean advisory run.
4. Commit: "fix(smoke): resolve the previously-unrun smoke files"

**Files:**
- `src/conductor/test/smoke/finish-record.smoke.test.ts`
- `src/conductor/test/smoke/publish-interrupted.smoke.test.ts`
- `src/conductor/test/smoke/surgical-finish-retry.smoke.test.ts`

**Wired-into:** none (no new production surface)
**Dependencies:** Task 13

### Task 15: Extract classifyReleasePublication
**Story:** Story 3
**Type:** infrastructure

**Steps:**
1. Write failing tests asserting `classifyReleasePublication` returns `publishable` with the
   resolved version for a designated release-PR merge, and `ignored` for an ordinary feature merge
   and for a non-`main` branch.
2. Verify tests fail (RED).
3. Lift `release-publisher-action.ts:61-92` into the new exported function; have
   `runReleasePublisherAction` consume it while keeping the mutations behind itself.
4. Verify tests pass (GREEN), including the publisher's existing tests unmodified.
5. Commit: "refactor(release): extract classifyReleasePublication from the publisher prefix"

**Files:**
- `src/conductor/src/engine/release-publisher-action.ts`
- `src/conductor/test/engine/release-publisher-action.test.ts`

**Wired-into:** `src/conductor/src/index.ts#exports, .github/workflows/release.yml#classify`
**Dependencies:** none

### Task 16: Classify performs no mutation, and rejects bad evidence
**Story:** Story 3, negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: zero mutating seam calls across every classification outcome;
   `rejected` on missing audit evidence, on an audit bound to a different head, on absent or
   non-semver `VERSION`, and on a missing or empty `CHANGELOG.md` section; `ignored` on a
   non-app author or a non-`automation/release-pr` head branch.
2. Verify tests fail (RED).
3. Implement whatever the extraction missed.
4. Verify tests pass (GREEN).
5. Commit: "test(release): prove classify mutates nothing and fails closed"

**Files:** `src/conductor/test/engine/release-publisher-action.test.ts`
**Wired-into:** same as Task 15
**Dependencies:** Task 15

### Task 17: Export classify and prove publish re-derives authority
**Story:** Story 3
**Type:** happy-path

**Steps:**
1. Write failing test asserting `classifyReleasePublication` is re-exported from `src/index.ts`,
   and that when a candidate changes after a `publishable` classification, publish returns
   `rejected` rather than tagging on the stale result.
2. Verify test fails (RED).
3. Add the re-export; confirm publish derives authority itself rather than from a classify result.
4. Verify test passes (GREEN).
5. Commit: "feat(release): export classify; keep publish authority self-derived"

**Files:**
- `src/conductor/src/index.ts`
- `src/conductor/test/engine/release-publisher-action.test.ts`

**Wired-into:** same as Task 15
**Dependencies:** Task 16

### Task 18: Restructure release.yml into classify → smoke → publish
**Story:** Story 4
**Type:** infrastructure

**Steps:**
1. Write failing test asserting `release.yml` declares three ordered jobs, that smoke and publish
   both carry `needs` plus an `if` predicate on classify's `publishable` output, and that neither
   runs when classify reports `ignored`.
2. Verify test fails (RED).
3. Restructure the workflow: classify emits the output, smoke and publish gate on it, publish keeps
   the existing `runReleasePublisherAction` script unchanged.
4. Verify test passes (GREEN).
5. Commit: "feat(release): gate the tag on a post-merge smoke run"

**Files:**
- `.github/workflows/release.yml`
- `src/conductor/test/structural/release-workflow.test.ts` — new test

**Wired-into:** `.github/workflows/release.yml#classify`
**Dependencies:** Task 14, Task 17

### Task 19: Call the live tier in gate mode, fail-closed on any non-success
**Story:** Story 4, negative paths
**Type:** negative-path

**Steps:**
1. Write failing tests asserting the smoke job calls `./.github/workflows/live-daemon-e2e.yml` with
   `require_credentials: true` and `secrets: inherit`, runs the tier in gate mode, and that the
   publish job's gating admits only a successful smoke conclusion — cancelled and timed-out both
   block.
2. Verify tests fail (RED).
3. Implement the reusable-workflow call and the fail-closed predicate.
4. Verify tests pass (GREEN).
5. Commit: "fix(release): fail closed on any non-success smoke conclusion"

**Files:**
- `.github/workflows/release.yml`
- `src/conductor/test/structural/release-workflow.test.ts`

**Wired-into:** same as Task 18
**Dependencies:** Task 18

### Task 20: Prove a blocked release leaves no state and re-runs cleanly
**Story:** Story 5
**Type:** negative-path

**Steps:**
1. Write failing tests asserting: publish is idempotent on a completed release (no duplicate tag,
   no second Release); a tag pointing at a different commit yields `rejected` without moving it; a
   Release whose body or target differs yields `rejected` without overwriting; and no tag or
   Release exists after a smoke-blocked run.
2. Verify tests fail (RED).
3. Implement any missing guard.
4. Verify tests pass (GREEN).
5. Commit: "test(release): prove smoke-blocked releases are recoverable by re-run"

**Files:** `src/conductor/test/engine/release-publisher-action.test.ts`
**Wired-into:** none (no new production surface)
**Dependencies:** Task 19

## Task Dependency Graph

```
Smoke runner seam                    Publisher seam
─────────────────                    ──────────────
Task 1 ─┬─ Task 2 ── Task 3          Task 15 ── Task 16 ── Task 17
        └─ Task 4                                   │
                                                    │
Task 5 ─┬─ Task 6                                   │
        └─ Task 7 ── Task 8 ── Task 9 ── Task 10 ── Task 11 ── Task 12 ── Task 13 ── Task 14
                                                    │                                  │
                                                    └──────────────┬───────────────────┘
                                                                   ▼
                                                     Task 18 ── Task 19 ── Task 20
```

Tasks 1-4 and 5-14 are independent of 15-17; all three converge at Task 18.

## Integration Points

- **After Task 14:** `npm run smoke` runs the whole tier locally end-to-end, in both advisory and
  gate mode, with an attributable ledger. Testable without touching CI.
- **After Task 17:** classification is callable from a workflow and proven side-effect-free.
- **After Task 19:** the full gate is live — a release cannot be tagged while smoke is failing.

## Verification

- [ ] All happy-path criteria covered: Story 1 → Tasks 1-2; Story 2 → Tasks 5, 8, 12-13;
      Story 3 → Tasks 15, 17; Story 4 → Tasks 18-19; Story 5 → Task 20
- [ ] All negative-path criteria covered: Story 1 → Tasks 3-4; Story 2 → Tasks 6-7, 9-11;
      Story 3 → Task 16; Story 4 → Task 19; Story 5 → Task 20
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
- [ ] No terminal catch-all validation task
- [ ] Every task carries a `Wired-into:` line
