# Implementation Plan: Configurable push/PR timing (`pr_timing`)

**Date:** 2026-07-03
**Design:** adr-2026-07-03-pr-timing-config-key, adr-2026-07-03-post-rebase-force-with-lease,
adr-2026-07-03-engineer-checkpoint-commits-idempotent-land,
adr-2026-07-03-pr-timing-self-host-precedence,
architecture-review-2026-07-03-configurable-pr-timing
**Stories:** .docs/stories/make-daemon-build-push-pr-timing-a-configurable-st.md (TS-1…TS-8)
**Conflict check:** Clean as of 2026-07-03 (.docs/conflicts/2026-07-03-configurable-pr-timing.md)
**Source:** jstoup111/ai-conductor#199

## Summary

One config key (`pr_timing: finish | early-draft`, default `finish`) governing publish
timing in the daemon build flow and the engineer spec flow. 22 tasks: config foundation
(3), publish-seam primitives (4), daemon wiring (8), engineer wiring (5), docs/integration (2).

## Technical Approach

- **Config:** add `pr_timing?: 'finish' | 'early-draft'` to `HarnessConfig`
  (`src/conductor/src/types/config.ts` ~:308-321), register in `knownTopLevelKeys`
  (`src/engine/config.ts:154-178`), add a fail-closed validation block modeled on
  `owner_gate_cutover` (`config.ts:480-490`), and a total resolver `resolvePrTiming()` +
  `DEFAULT_PR_TIMING = 'finish'` in `src/engine/resolved-config.ts` (mirror
  `resolveRebaseResolutionAttempts` :274-296).
- **Publish seam:** all new git/gh publish primitives live in `src/engine/pr-labels.ts`
  behind the existing injected `GhRunner`/`GitRunner` types (:26-76): `pushBranch(branch,
  {forceWithLease?})`, `isAheadOfBase(base)` (`git rev-list --count base..HEAD`), and a
  composite `publishEarlyDraft()` that pushes and lazily calls `findOrCreatePr({draft:
  true})` (:341) only when ahead of base. A thin `advisoryPublish()` wrapper catches, logs
  one loud line (branch, mode, error), and never throws — early publishes are advisory.
- **Daemon wiring (conductor.ts):** three engine-native hook points, each gated on
  resolved mode `early-draft` AND `!selfHost` (SelfHostDetector seam,
  adr-2026-06-30-self-host-detection-seam): (1) before build-step dispatch → push only /
  lazy draft PR; (2) after each loopGate step completes with commits ahead → plain refresh
  push; (3) after `runRebaseStep` (:2005-2075) returns success in early-draft with a prior
  push → the single `--force-with-lease` site. Finish step: engine-native pre-step —
  if an open draft PR exists for the branch, `markReadyForReview` (:517) then dispatch the
  unchanged `/finish` prompt (it already reuses via `gh pr view`); `Closes` injection
  (`issue-ref.ts:99-131`) is post-run and PR-number-based, verified mode-independent.
- **Engineer wiring:** new `conduct-ts engineer checkpoint --project <n> --worktree <p>`
  primitive (used by the engineer SKILL.md after each DECIDE skill): identity-gated,
  `.docs`-scoped commit + plain push + lazy draft spec PR via the same seam helpers.
  `land-spec.ts` commit step (:278-302) becomes commit-iff-staged-non-empty; every guard
  above it is untouched. `handoff.ts` `openSpecPr` (:154-170): detect an open draft PR for
  the head branch → push + mark-ready; else existing `gh pr create --head <branch> --fill`;
  no-remote local fallback unchanged.
- **Sequencing rationale:** config first (everything reads it), seam primitives second
  (both flows consume them), then daemon and engineer wiring in parallel-safe order,
  negative-path tasks immediately after each happy path, docs last.
- **Testing:** vitest in `src/conductor` (`rtk proxy npx vitest run`); injected runners +
  `AI_CONDUCTOR_NO_REAL_EXEC`; one real-binary smoke for new argv; rebase-adjacent tests
  use `daemon: true` + isolated repos; grep-level invariant test pins the force-push policy.

## Prerequisites

- `npm install` inside `src/conductor` for the worktree (per worktree convention).
- No migrations, no new dependencies.

## Tasks

### Task 1: `pr_timing` validation — fail-closed
**Story:** TS-1 (validation criteria + typo/non-string negatives) · **Type:** happy-path + negative-path
**Steps:**
1. Failing tests in `test/engine/config.test.ts`: `finish`/`early-draft` pass; `eary-draft` → `{ok:false}` error naming key, value, valid values; `3` → type error; key accepted in `knownTopLevelKeys`.
2. RED → implement: `HarnessConfig.pr_timing`, `knownTopLevelKeys` entry, validation block per `owner_gate_cutover` precedent.
3. GREEN → commit "feat(config): fail-closed pr_timing key".
**Files:** `src/conductor/src/types/config.ts`, `src/engine/config.ts`, `test/engine/config.test.ts`
**Dependencies:** none

### Task 2: `resolvePrTiming()` resolver
**Story:** TS-1 (resolver criteria; absent → finish) · **Type:** happy-path
**Steps:** failing tests (`undefined`/`{}`/`finish`→`'finish'`; `early-draft`→`'early-draft'`); implement `DEFAULT_PR_TIMING` + total resolver in `resolved-config.ts`; commit.
**Files:** `src/engine/resolved-config.ts`, `test/engine/resolved-config.test.ts`
**Dependencies:** Task 1

### Task 3: Default-inert regression harness
**Story:** TS-1 (absent key → zero publish invocations before finish) · **Type:** negative-path
**Steps:** failing test: simulated daemon build with key absent, captured runners record zero push/PR calls before finish step; wire nothing (test pins the invariant for later tasks); commit once green against current code.
**Files:** `test/engine/conductor-pr-timing.test.ts` (new)
**Dependencies:** Task 2

### Task 4: `pushBranch` + `isAheadOfBase` primitives
**Story:** TS-2/TS-3 (push mechanics) · **Type:** infrastructure
**Steps:** failing tests: `pushBranch` argv `['push','-u','origin',branch]`, with `{forceWithLease:true}` → `['push','--force-with-lease','origin',branch]`; `isAheadOfBase` parses rev-list count; implement in `pr-labels.ts` behind `GitRunner`; commit.
**Files:** `src/engine/pr-labels.ts`, `test/engine/pr-labels.test.ts`
**Dependencies:** none

### Task 5: `publishEarlyDraft()` — lazy draft PR + advisory wrapper
**Story:** TS-2 (lazy creation; single draft PR; advisory failures) · **Type:** happy-path + negative-path
**Steps:** failing tests: not-ahead → push only, zero `pr create`; ahead → `findOrCreatePr({draft:true})` once, reuse on second call; push failure → loud log captured, no throw; gh unauth → one attempt, loud log, no retry storm; implement composite + `advisoryPublish` wrapper; commit.
**Files:** `src/engine/pr-labels.ts`, `test/engine/pr-labels.test.ts`
**Dependencies:** Task 4

### Task 6: Real-binary smoke for new argv
**Story:** TS-2 Done When (smoke convention) · **Type:** infrastructure
**Steps:** smoke test executing real `git push`/`rev-list` argv against a local file-remote fixture repo (no network); assert lazy-PR gh argv shape via `gh --version` guard-skip pattern; commit.
**Files:** `test/smoke/pr-timing-argv.smoke.test.ts` (new)
**Dependencies:** Task 5

### Task 7: Build-start publish hook
**Story:** TS-2 (build-start push; no PR on empty branch) · **Type:** happy-path
**Steps:** failing conductor test (early-draft, zero commits over base): build dispatch preceded by push, zero PR-create; implement hook before build-step dispatch gated on mode + `!selfHost`; commit.
**Files:** `src/engine/conductor.ts`, `test/engine/conductor-pr-timing.test.ts`
**Dependencies:** Tasks 3, 5

### Task 8: Self-host downgrade
**Story:** TS-1 (self-host precedence) · **Type:** negative-path
**Steps:** failing test: self-host detection + `early-draft` → zero early publishes, exactly one loud downgrade log naming configured value; implement `!selfHost` gate via SelfHostDetector seam; commit.
**Files:** `src/engine/conductor.ts`, `test/engine/conductor-pr-timing.test.ts`
**Dependencies:** Task 7

### Task 9: Step-boundary refresh
**Story:** TS-3 (refresh with commits; no-op without) · **Type:** happy-path
**Steps:** failing tests: loopGate step completes with new commits → one plain push; without commits → zero pushes; implement post-step hook; commit.
**Files:** `src/engine/conductor.ts`, `test/engine/conductor-pr-timing.test.ts`
**Dependencies:** Task 7

### Task 10: Refresh rejection stays plain + finish-mode zero-refresh
**Story:** TS-3 negatives · **Type:** negative-path
**Steps:** failing tests: remote rejects plain push at boundary → loud log, captured argv contains no force flag, build proceeds; full simulated build in finish mode → zero refresh invocations; implement (advisory wrapper already handles); commit.
**Files:** `test/engine/conductor-pr-timing.test.ts`
**Dependencies:** Task 9

### Task 11: Post-rebase force-with-lease site
**Story:** TS-4 happy (single force-with-lease after successful rewrite; plain/no-op when rebase was no-op) · **Type:** happy-path
**Steps:** failing tests (daemon:true, isolated repo): successful history-rewriting rebase in early-draft with prior push → exactly one `--force-with-lease`; rebase satisfied-as-no-op → no force flag; implement after `runRebaseStep` success; commit.
**Files:** `src/engine/conductor.ts`, `test/engine/rebase-pr-timing.test.ts` (new)
**Dependencies:** Tasks 4, 7

### Task 12: Rebase-HALT and lease-rejection negatives
**Story:** TS-4 negatives · **Type:** negative-path
**Steps:** failing tests: rebase-conflict HALT → zero push argv of any kind while paused; lease rejection → loud log, NO bare `--force` retry, build continues to finish; finish mode → zero pushes at site; commit.
**Files:** `test/engine/rebase-pr-timing.test.ts`
**Dependencies:** Task 11

### Task 13: Force-push policy invariant test
**Story:** TS-4 Done When (grep-level) · **Type:** negative-path
**Steps:** test scans `src/conductor/src/` sources: `--force-with-lease` at exactly one call site; `push` + bare `--force` at zero; commit.
**Files:** `test/engine/force-push-policy.test.ts` (new)
**Dependencies:** Task 11

### Task 14: Finish-step mark-ready
**Story:** TS-5 happy (reuse + mark ready + pr_url parity) · **Type:** happy-path
**Steps:** failing test: open draft PR exists → engine-native pre-step calls `markReadyForReview` before dispatching unchanged `/finish` prompt; `pr_url` equals draft PR URL; single PR total; implement; commit.
**Files:** `src/engine/conductor.ts` (or `step-runners.ts` pre-step), `test/engine/conductor-pr-timing.test.ts`
**Dependencies:** Task 7

### Task 15: Finish fallbacks + Closes-ref parity
**Story:** TS-5 negatives + Closes Done When · **Type:** negative-path
**Steps:** failing tests: no PR exists → finish prompt byte-identical to today (create path); `markReadyForReview` fails → error surfaced, `pr_url` recorded, build completes, PR left draft; `injectIssueRef` runs against reused draft PR URL (mode-independent auto-close); commit.
**Files:** `test/engine/conductor-pr-timing.test.ts`, `test/engine/engineer/issue-ref.test.ts`
**Dependencies:** Task 14

### Task 16: `engineer checkpoint` primitive — identity-gated, `.docs`-scoped
**Story:** TS-6 happy · **Type:** happy-path
**Steps:** failing tests: with resolved identity + new `.docs` artifacts → commit contains exactly the `.docs` paths, plain push of `spec/<slug>`, lazy draft spec PR on first ahead push (shared Task 5 helper); implement `checkpointSpec()` in `src/engine/engineer/` + CLI subcommand; commit.
**Files:** `src/engine/engineer/checkpoint.ts` (new), CLI registration, `test/engine/engineer/checkpoint.test.ts` (new)
**Dependencies:** Task 5

### Task 17: Checkpoint negatives — scope, failure, mode, identity
**Story:** TS-6 negatives · **Type:** negative-path
**Steps:** failing tests: non-`.docs` dirt excluded from checkpoint commit file list; push failure → loud + exit 0 (non-blocking); finish mode → zero activity; unresolved identity → zero commits/pushes (fail-fast precedes); commit.
**Files:** `test/engine/engineer/checkpoint.test.ts`
**Dependencies:** Task 16

### Task 18: Idempotent `land` commit step
**Story:** TS-7 happy · **Type:** happy-path
**Steps:** failing tests: all artifacts checkpoint-committed + guards pass → land succeeds, no new commit, same JSON; partial → commits exactly the remainder; implement commit-iff-`git diff --cached`-non-empty in `land-spec.ts:278-302`; commit.
**Files:** `src/engine/engineer/land-spec.ts`, `test/engine/engineer/land-spec.test.ts`
**Dependencies:** Task 16

### Task 19: Land guards unaffected by checkpoint commits
**Story:** TS-7 negatives · **Type:** negative-path
**Steps:** failing tests: DRAFT ADR + fully-committed artifacts → fails with DRAFT-ADR error; committed-but-unaccepted stories → acceptance error; dirty non-`.docs` → existing rejection (regression); full existing land suite green in finish mode; commit.
**Files:** `test/engine/engineer/land-spec.test.ts`
**Dependencies:** Task 18

### Task 20: Handoff mark-ready + fallbacks
**Story:** TS-8 (all criteria) · **Type:** happy-path + negative-path
**Steps:** failing tests: open draft spec PR → push + `markReadyForReview`, zero `pr create`, write-back invocations identical; no draft PR → create fallback verbatim (`--head <branch> --fill`); no-remote → local fallback unchanged; mark-ready failure → error reported, URL still written back; worktree remove/keep semantics asserted unchanged; implement in `handoff.ts` `openSpecPr`; commit.
**Files:** `src/engine/engineer/handoff.ts`, `test/engine/engineer/handoff.test.ts`
**Dependencies:** Tasks 5, 18

### Task 21: Engineer SKILL.md checkpoint wiring
**Story:** TS-6 (boundary trigger) · **Type:** infrastructure
**Steps:** amend `skills/engineer/SKILL.md` step 3: after each DECIDE skill completes, run `conduct-ts engineer checkpoint …` (early-draft repos only; advisory); run `test/test_harness_integrity.sh`; commit.
**Files:** `skills/engineer/SKILL.md`
**Dependencies:** Task 16

### Task 22: Docs + CHANGELOG
**Story:** TS-1 Done When (docs) · **Type:** infrastructure
**Steps:** config-key block in `src/conductor/README.md` (mirror :261-265 pattern) + root `README.md` daemon options; note self-host precedence + advisory semantics; `CHANGELOG.md [Unreleased] → Added`; integrity suite; commit.
**Files:** `README.md`, `src/conductor/README.md`, `CHANGELOG.md`
**Dependencies:** all prior

## Task Dependency Graph

```
T1 → T2 → T3 ─┬→ T7 → T8
              │   T7 → T9 → T10
T4 → T5 ──────┤   T7 → T14 → T15
      T5 → T6 │   T4,T7 → T11 → T12
              │            T11 → T13
              └→ T16 → T17
                 T16 → T18 → T19
                 T5,T18 → T20
                 T16 → T21
all → T22
```

Acyclic; T4-T6 parallel to T1-T3; daemon (T7-T15) and engineer (T16-T21) chains independent after T5.

## Integration Points

- After T8: daemon early-draft happy path end-to-end vs a file-remote fixture.
- After T15: full daemon build simulation in both modes (mode parity gate).
- After T20: engineer flow end-to-end (checkpoint → land → handoff) in both modes.

## Verification

- [ ] All happy-path criteria covered: TS-1→T1/T2, TS-2→T5/T6/T7, TS-3→T9, TS-4→T11, TS-5→T14, TS-6→T16, TS-7→T18, TS-8→T20
- [ ] All negative-path criteria covered: TS-1→T1/T3/T8, TS-2→T5, TS-3→T10, TS-4→T12/T13, TS-5→T15, TS-6→T17, TS-7→T19, TS-8→T20
- [ ] No task exceeds 5 minutes
- [ ] Dependencies explicit and acyclic
- [ ] 22 tasks (within the 21-40 warning band — accepted as a single tier-M feature; the two
      flow chains are independent but share the config+seam foundation, so splitting would
      duplicate the foundation and the mode-parity gates)
