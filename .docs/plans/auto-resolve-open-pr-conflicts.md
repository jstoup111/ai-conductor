# Implementation Plan: Auto-Resolve Merge Conflicts on Open Watched PRs

**Date:** 2026-07-04
**Design:** `.docs/specs/2026-07-04-auto-resolve-open-pr-conflicts.md`
**Stories:** `.docs/stories/auto-resolve-open-pr-conflicts.md` (Status: Accepted, 11 stories)
**ADRs:** `adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep`,
`adr-2026-07-04-autoresolve-state-and-config`, `adr-2026-07-04-resolution-worktree-lifecycle`
**Conflict check:** Clean as of 2026-07-04 (zero blocking)
**Tier:** M (`.docs/complexity/auto-resolve-open-pr-conflicts.md`)

## Summary

Wire the existing bounded rebase-resolution machinery into the mergeable sweep so a watched
open PR that goes CONFLICTING is refreshed automatically (deterministic resolvers first, gated
`/rebase` second, hard guards + suite + lease push last) or escalated stickily. 22 tasks.

## Technical Approach

- **New module `src/conductor/src/engine/autoresolve.ts`** owns the flow: eligibility →
  worktree → rebase → Tier 1 → Tier 2 → guards → suite → push → cleanup/escalation. The sweep
  (`mergeable-sweep.ts`) only *detects and delegates*, keeping its label pass fast. All
  externals (git, gh, dispatch, suite spawn, clock) are injected — same DI style as
  `daemon-rekick.ts` — with an env kill-switch guarding every production spawn.
- **Schema:** `WatchEntry` gains optional `resolveAttempts?: number` and
  `lastResolveAt?: string` (ISO). Absent fields read as 0 / never. Persisted via the existing
  `rewriteWatch`.
- **Config:** `mergeable_autoresolve: { enabled: false, suite_command?, cooldown_minutes: 60 }`
  parsed in `config.ts` → `resolved-config.ts`; attempt cap reuses the existing
  rebase-resolution cap. Read at daemon startup (restart to apply), matching owner-gate
  precedent.
- **Tier 1** lives in `rebase.ts` beside the existing CHANGELOG resolver: a new
  `docsKeepBothResolver` (strictly `.docs/`-scoped add/add) plus a driver that applies both
  deterministic resolvers to a paused rebase and reports remaining conflicts. **Tier 2** calls
  the existing `resolveRebaseConflicts` unchanged (second sanctioned call site per ADR).
- **Guards/push:** reuse `featureCommitsPreserved` + `isBranchCurrent` + a mid-rebase-state
  check; push only `--force-with-lease`; escalation via `pr-labels.ts` REST helpers +
  marker-tagged `upsertComment`.
- **Sequencing:** schema/config first, then the pure eligibility gate, then the resolution
  pipeline inside-out (resolvers → guards → suite → push), then sweep integration, smokes,
  regression, docs.

## Prerequisites

- None beyond the repo as-is. No migrations. Worktree vitest runs need
  `npm install` in `src/conductor` (`rtk proxy npx vitest run`).

## Tasks

### Task 1: Extend WatchEntry schema with resolution state
**Story:** "Sticky escalation and cooldown gate every attempt" (legacy entry negative path)
**Type:** infrastructure
**Steps:**
1. Write failing tests: a legacy jsonl line (`{prUrl,slug,repoCwd}`) parses with
   `resolveAttempts === 0` and `lastResolveAt === undefined`; an extended entry round-trips
   through `readWatch`/`rewriteWatch` unchanged.
2. RED → implement optional fields on `WatchEntry` + zero-default normalization in
   `readWatch` → GREEN → commit "feat(sweep): watch-entry resolution state fields".
**Files:** `src/conductor/src/engine/mergeable-sweep.ts`, its test file.
**Dependencies:** none

### Task 2: Parse mergeable_autoresolve config block
**Story:** "Sweep detects…dispatches" (config happy path); "Full suite…fail-closed" (missing key)
**Type:** infrastructure
**Steps:**
1. Failing tests: absent block → `{enabled:false, cooldownMinutes:60, suiteCommand:undefined}`;
   full block parses; partial block gets defaults; non-boolean/garbage values fail loudly.
2. Implement in `config.ts` + surface on `resolved-config.ts` → GREEN → commit.
**Files:** `src/conductor/src/engine/config.ts`, `resolved-config.ts`, tests.
**Dependencies:** none

### Task 3: Pure eligibility gate
**Story:** "Sweep detects…" + "Sticky escalation and cooldown" (all gating negatives)
**Type:** happy-path + negative-path (pure function, exhaustively tested)
**Steps:**
1. Failing tests for `isEligibleForResolve(entry, prState, cfg, now, fs)`: eligible case;
   disabled→no; needs-remediation label→no (sticky); cooldown not elapsed→no (and no attempt
   increment); attempts ≥ cap→no; merged/closed→no; UNKNOWN state→no; build worktree
   `.worktrees/<slug>` exists→no (logged reason each).
2. Implement as a pure function in new `autoresolve.ts` → GREEN → commit.
**Files:** `src/conductor/src/engine/autoresolve.ts` (new), tests.
**Dependencies:** Task 1, Task 2

### Task 4: Resolution worktree provision + teardown
**Story:** "Resolution runs in a dedicated transient worktree"
**Type:** infrastructure
**Steps:**
1. Failing tests (injected git): fetch then `worktree add` at PR branch tip under
   `.worktrees/resolve-<slug>`; stale leftover (dir exists) is force-removed and recreated;
   teardown removes the worktree; worktree-add failure → clean abort, primary untouched,
   counts as an attempt.
2. Implement `withResolveWorktree(slug, branch, fn)` (create → run → always teardown) reusing
   `worktree-shared.ts` helpers → GREEN → commit.
**Files:** `autoresolve.ts`, `worktree-shared.ts` (only if a helper needs exporting), tests.
**Dependencies:** Task 3

### Task 5: Namespace preparation before any suite run
**Story:** "Resolution runs in a dedicated transient worktree" (namespace prep)
**Type:** infrastructure
**Steps:**
1. Failing test: after provision, the worktree's `.env` carries `WORKTREE_NAMESPACE` (reuse
   the daemon's `prepareWorktree` seam, injected).
2. Wire prep into `withResolveWorktree` → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 4

### Task 6: .docs keep-both deterministic resolver
**Story:** "Parallel-feature .docs artifacts resolve keep-both"
**Type:** happy-path
**Steps:**
1. Failing tests over fixture conflict states: add/add of distinct files inside `.docs/` →
   both kept, staged; rename-collision inside `.docs/` → both kept.
2. Implement `docsKeepBothResolver` in `rebase.ts` (git `ls-files -u` / status parse →
   `git add` both sides) → GREEN → commit.
**Files:** `src/conductor/src/engine/rebase.ts`, tests.
**Dependencies:** none

### Task 7: keep-both strict scope negatives
**Story:** same story, negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: same-`.docs/`-file divergent content edits → NOT resolved (falls through);
   conflicted path outside `.docs/` → never touched; mixed set (`.docs/` add/add + `src/`
   edit) → `.docs/` may resolve but result reports `src/` conflict remaining (Tier 1 must not
   mark the rebase resolved).
2. Implement scope checks → GREEN → commit.
**Files:** `rebase.ts`, tests.
**Dependencies:** Task 6

### Task 8: Tier 1 driver over a paused rebase
**Story:** "CHANGELOG conflicts resolve deterministically" (all paths)
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests against scratch repos with real conflict fixtures: additive
   `[Unreleased]` conflict → resolved by the EXISTING changelog resolver, rebase continues,
   zero dispatch calls; non-additive (feature deletes main's lines) → falls through;
   feature lines already on main → no duplicate block; conflict outside `[Unreleased]` →
   falls through.
2. Implement `runTier1(git, projectRoot)` composing changelog resolver + keep-both, returning
   `{resolved: string[], remaining: string[]}` → GREEN → commit.
**Files:** `rebase.ts` (driver), tests with fixture repos.
**Dependencies:** Task 6, Task 7

### Task 9: Tier 2 — second call site for resolveRebaseConflicts
**Story:** "Remaining conflicts go to the gated /rebase session, bounded"
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests (injected resolver): remaining conflicts → `resolveRebaseConflicts` invoked
   with cap read from resolved-config; cannot-resolve on attempt 1 → short-circuit, abort;
   cap exhausted → `git rebase --abort`, branch untouched; cap=0 → no dispatch, straight to
   escalation.
2. Wire into `autoresolve.ts` → GREEN → commit "feat(autoresolve): tier-2 gated dispatch
   (adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep)".
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 8

### Task 10: Acceptance guards at the new call site
**Story:** "Work-preservation guards reject lossy resolutions"
**Type:** negative-path (adversarial fixtures)
**Steps:**
1. Failing tests on scratch repos: a rebase that really `--skip`ped a commit →
   `featureCommitsPreserved` false → abort, nothing pushed, guard named in escalation reason;
   base advanced again mid-resolution → `isBranchCurrent` false → abort; resolver "success"
   with `rebase-merge` dir still present → treated failed.
2. Wire guard sequence (subjects captured BEFORE rebase) → GREEN → commit.
**Files:** `autoresolve.ts`, tests (reuse guard helpers from `rebase.ts` — no reimplementation).
**Dependencies:** Task 9

### Task 11: Suite gate — green path
**Story:** "Full suite must pass before anything publishes" (happy)
**Type:** happy-path
**Steps:**
1. Failing test (injected suite runner): configured `suite_command` runs in the
   namespace-prepared worktree cwd; exit 0 → proceeds to push stage; exit code + duration
   logged.
2. Implement `runSuiteGate` → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 5, Task 10

### Task 12: Suite gate — fail-closed negatives
**Story:** same story, negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: non-zero exit → abort + escalation reason includes suite failure; missing
   `suite_command` with `enabled:true` → abort BEFORE push, reason "no suite command
   configured"; spawn ENOENT → treated as red; timeout elapsed → kill + treated as red.
2. Implement (timeout via injected clock/AbortSignal) → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 11

### Task 13: Lease push + success finalization
**Story:** "The refresh publishes with a lease…" (happy)
**Type:** happy-path
**Steps:**
1. Failing tests (injected git): push argv is exactly `push --force-with-lease` (assert
   absence of bare `--force`); on success → attempts reset to 0 via `rewriteWatch`, worktree
   removed, outcome logged `refreshed`.
2. Implement → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 12

### Task 14: Lease rejection + remote-untouched invariant
**Story:** same story, negative paths
**Type:** negative-path
**Steps:**
1. Failing tests: lease rejection → local result discarded, escalation with lease reason, NO
   retry and NO `--force`; any earlier-stage failure → injected git records zero push calls;
   post-push label-restore gh failure → push not rolled back, failure logged (best-effort).
2. Implement → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 13

### Task 15: Escalation — REST labels + upsert comment
**Story:** "Escalation marks the PR for a human with a concrete reason"
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests (injected gh): escalation removes `mergeable` + adds `needs-remediation` via
   REST helpers (`pr-labels.ts`), posts stage+reason through the marker-tagged
   `upsertComment` (same comment updated on a later occurrence, never a second comment);
   label call failure → comment still attempted, no throw; comment failure with label success
   → retries still suppressed (label is the gate).
2. Implement `escalate(prUrl, stage, reason)` → GREEN → commit.
**Files:** `autoresolve.ts`, `pr-labels.ts` (export upsert if needed), tests.
**Dependencies:** Task 3

### Task 16: Outcome logging
**Story:** FR-16 lines in both escalation and success stories
**Type:** happy-path
**Steps:**
1. Failing snapshot tests: one log line per concluded attempt — PR identifier, stage reached,
   `refreshed` | `escalated` | `skipped(<reason>)`.
2. Implement structured log lines → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 13, Task 15

### Task 17: Sweep integration — serial, label-pass-first
**Story:** "Sweep detects a conflicting watched PR and dispatches resolution"
**Type:** happy-path + negative-path
**Steps:**
1. Failing tests: after the label pass over ALL entries completes, the first eligible
   CONFLICTING PR gets one resolution; a second eligible PR the same tick is deferred with a
   log line; attempt counter bumps + `lastResolveAt` set BEFORE git work begins; disabled
   config → sweep byte-identical to today (existing sweep tests unmodified).
2. Wire `autoresolve` into `sweepMergeableLabels` (or its caller in the daemon loop) behind
   the config flag → GREEN → commit.
**Files:** `mergeable-sweep.ts`, `daemon-runner.ts`/`daemon.ts` (dep injection), tests.
**Dependencies:** Task 3, Task 16

### Task 18: In-flight serial guard across ticks
**Story:** worktree story negative path (no second resolution while one runs)
**Type:** negative-path
**Steps:**
1. Failing test: with a resolution in flight (long suite), the next tick starts no second
   resolution for any PR and logs the skip.
2. Implement an in-process in-flight flag → GREEN → commit.
**Files:** `autoresolve.ts`, tests.
**Dependencies:** Task 17

### Task 19: Real-binary smoke — worktree + lease push
**Story:** worktree story + lease story "Done When" smokes
**Type:** infrastructure (smoke)
**Steps:**
1. Smoke test against a scratch origin (temp bare repo): full happy path with a real
   CHANGELOG conflict → branch refreshed on the origin, commits preserved; then simulate a
   concurrent push → lease rejected, origin branch intact. Guard with the env kill-switch
   convention so CI/unit runs stay hermetic.
2. GREEN → commit.
**Files:** `src/conductor/test/` smoke file.
**Dependencies:** Task 17

### Task 20: Regression — finish-time path unchanged
**Story:** "Finish-time resolution behavior is unchanged"
**Type:** refactor guard
**Steps:**
1. Run the FULL existing suite (`rtk proxy npx vitest run` in `src/conductor`). Existing
   `rebase`/step-runner/sweep test files must pass **unmodified** (additive-only edits
   justified in review).
2. Fix any breakage on the new-code side only → commit.
**Files:** none intended.
**Dependencies:** Tasks 1–19

### Task 21: Docs upkeep (same PR)
**Story:** repo convention (CLAUDE.md "Docs track features")
**Type:** infrastructure
**Steps:**
1. Document `mergeable_autoresolve` config block + behavior (detection, tiers, guards,
   escalation, fail-closed suite) in `README.md` and `src/conductor/README.md`.
2. Commit.
**Files:** `README.md`, `src/conductor/README.md`.
**Dependencies:** Task 17

### Task 22: CHANGELOG entry
**Story:** repo release gate
**Type:** infrastructure
**Steps:**
1. Add under `## [Unreleased]` / Added: "daemon auto-resolves merge conflicts on open watched
   PRs (deterministic-first, gated /rebase fallback, fail-closed suite gate, lease-protected
   push; opt-in via `mergeable_autoresolve`)".
2. Commit.
**Files:** `CHANGELOG.md`.
**Dependencies:** Task 21

## Task Dependency Graph

```
T1 ─┬─▶ T3 ─┬────────────────▶ T15 ─┐
T2 ─┘       │                       ├─▶ T16 ─▶ T17 ─▶ T18
            └─▶ T4 ─▶ T5 ─┐         │            │
T6 ─▶ T7 ─▶ T8 ─▶ T9 ─▶ T10 ─▶ T11 ─▶ T12 ─▶ T13 ─▶ T14
                                                 (T13,T15 ─▶ T16)
T17 ─▶ T19, T21 ; T21 ─▶ T22 ; T1..T19 ─▶ T20
```

## Integration Points

- After Task 8: Tier 1 resolution testable end-to-end on scratch repos (no daemon).
- After Task 14: full resolution pipeline testable with injected runners.
- After Task 17: daemon tick → resolution flow works end-to-end (injected).
- After Task 19: real-git/real-origin behavior proven.

## Coverage Map (story → tasks)

| Story | Tasks |
|---|---|
| Sweep detects + dispatches | 2, 3, 17 |
| Sticky escalation + cooldown | 1, 3, 15, 17 |
| Dedicated transient worktree | 4, 5, 18, 19 |
| CHANGELOG deterministic | 8 |
| .docs keep-both | 6, 7 |
| Gated Tier 2 bounded | 9 |
| Work-preservation guards | 10 |
| Suite gate fail-closed | 11, 12 |
| Lease publish / never overwrite | 13, 14, 19 |
| Escalation labels + comment + log | 15, 16 |
| Finish-time unchanged | 20 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by explicit tasks (3, 7, 10, 12, 14, 18)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
