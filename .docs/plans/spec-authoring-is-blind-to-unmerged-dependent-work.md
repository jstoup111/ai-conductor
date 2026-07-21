# Implementation Plan: DECIDE-time unmerged-overlap scan (#523, Scope A)

**Date:** 2026-07-21
**Source issue:** jstoup111/ai-conductor#523
**Track:** technical · Tier: M
**Design:** technical track — no PRD; ADR `.docs/decisions/adr-2026-07-21-decide-time-unmerged-overlap-scan.md`; decision record `.memory/decisions/decide-time-unmerged-overlap-scope.md`
**Stories:** `.docs/stories/spec-authoring-is-blind-to-unmerged-dependent-work.md`
**Conflict check:** Clean as of 2026-07-21 (`.docs/conflicts/2026-07-21-tr2-blocker-surface-vs-claim-gate.md` — one degrading overlap resolved)

## Summary

Add a read-only, advisory `conduct-ts overlap-scan` primitive that, given a set of candidate
files and an optional `Source-Ref`, names any unmerged sibling `spec/*`/PR branch whose diff
overlaps those files and lists the issue's open `blocked_by` blockers — then wire it into the
`/architecture-review` and `/plan` DECIDE steps. Build side untouched, nothing persisted. 10 tasks.

## Technical Approach

- **New engine module** `src/conductor/src/engine/overlap-scan.ts` with pure, injectable-runner
  functions: `enumerateUnmergedBranches(git, base)`, `intersectFiles(candidate, changed)`,
  `blockerSweep(sourceRef, resolver)`, the `runOverlapScan(...)` orchestrator, and
  `renderReport(report)`. Every function takes injected `GitRunner`/`BlockerResolver` deps so it
  is unit-testable with fakes (matches `blocker-resolver`/`rebase.ts` precedent).
- **Reuse, do not reinvent:** `rebase.ts#changedPathsBetween(git, base, branch)` for per-branch
  diffs, `rebase.ts#resolveBase` semantics for the base ref (`origin/«default»`, degrade to
  local — never hardcode `main`), and `blocker-resolver.createBlockerResolver({ run })` for the
  `blocked_by` lookup (constructed exactly as `engineer-cli.ts:1023` already does).
- **New `conduct-ts overlap-scan` subcommand:** a `.command('overlap-scan')` declaration in
  `src/conductor/src/cli.ts` (flags: `--files`, `--source-ref`, `--base`, `--cwd`) whose handler
  in `src/conductor/src/index.ts` builds the real `makeGitRunner(cwd)` + gh-backed resolver, runs
  `runOverlapScan`, prints `renderReport`, and always exits 0 (advisory — never blocks authoring).
- **Skill wiring:** `/plan` (authoritative `**Files:**` set) and `/architecture-review`
  (Medium/Large `## Wiring Surface` paths) each gain a step invoking the subcommand and surfacing
  its report before the artifact locks.
- **Degradation is structural:** every phase in `runOverlapScan` is wrapped so a git/gh failure
  degrades to an advisory-skip note in the report and never throws to the caller. Partial failure
  preserves the succeeding half.

## Prerequisites

- None. `git` and `gh` are already required by the engineer/daemon flow. No new dependency, no
  migration, no config key.

## Tasks

### Task 1: Unmerged sibling-branch enumerator
**Story:** TR-1 (seam-overlap detection — enumeration half)
**Type:** infrastructure
**Steps:**
1. Write failing test: a fake `GitRunner` reports local `spec/*` heads + open-PR heads and a base
   ref; `enumerateUnmergedBranches(git, base)` returns exactly the branches NOT merged into base
   (a branch whose `rev-list --count base..branch === 0`-equivalent-merged is excluded).
2. Verify RED.
3. Implement `enumerateUnmergedBranches(git, base)` in `overlap-scan.ts` — list candidate
   `spec/*` (and open-PR) branches, exclude those already merged into base.
4. Verify GREEN.
5. Commit: "feat(overlap-scan): enumerate unmerged sibling spec/PR branches".

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts` — new enumerator
- `src/conductor/test/engine/overlap-scan.test.ts` — new test

**Wired-into:** `src/conductor/src/engine/overlap-scan.ts#runOverlapScan` (Task 4)
**Dependencies:** none

### Task 2: File-overlap intersection (exact, no false match)
**Story:** TR-5 (file-accurate intersection); TR-1 (overlap naming)
**Type:** happy-path
**Steps:**
1. Write failing test: `intersectFiles(['a.ts'], ['a.ts','b.ts'])` → `['a.ts']`;
   `intersectFiles(['src/foo/helperx.ts'], ['src/foo/helper.ts'])` → `[]` (no prefix/substring
   match); empty candidate → `[]`. Matching is on normalized repo-relative path equality.
2. Verify RED.
3. Implement `intersectFiles(candidate, changed)` — normalize both to repo-relative, Set
   intersection on exact path equality.
4. Verify GREEN.
5. Commit: "feat(overlap-scan): exact repo-relative file-overlap intersection".

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts` — `intersectFiles`
- `src/conductor/test/engine/overlap-scan.test.ts` — cases

**Wired-into:** `src/conductor/src/engine/overlap-scan.ts#runOverlapScan` (Task 4)
**Dependencies:** none

### Task 3: Blocker sweep over the reused resolver
**Story:** TR-2 (surface open blockers)
**Type:** happy-path
**Steps:**
1. Write failing test: a fake `BlockerResolver` returns `blocked`(open `#A`) / `unblocked` /
   `indeterminate`; `blockerSweep(sourceRef, resolver)` maps them to report entries — open
   blockers listed, `indeterminate` surfaced with detail, `unblocked`/empty → none; absent
   `sourceRef` → sweep skipped (no call).
2. Verify RED.
3. Implement `blockerSweep(sourceRef?, resolver)` calling `resolver.resolve(sourceRef)`; do NOT
   re-implement the `blocked_by` API or the closed-blocker filter (the resolver owns both).
4. Verify GREEN.
5. Commit: "feat(overlap-scan): blocker sweep reusing blocker-resolver".

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts` — `blockerSweep`
- `src/conductor/test/engine/overlap-scan.test.ts` — cases

**Wired-into:** `src/conductor/src/engine/overlap-scan.ts#runOverlapScan` (Task 4)
**Dependencies:** none

### Task 4: `runOverlapScan` orchestrator
**Story:** TR-1 + TR-2 + TR-3 (combined report, happy path)
**Type:** happy-path
**Steps:**
1. Write failing test: with fakes, `runOverlapScan({candidateFiles, sourceRef, git, resolver,
   base})` returns an `OverlapReport` combining per-branch seam overlaps (enumerate → diff via
   `changedPathsBetween` → `intersectFiles`) and blocker entries; a clean input yields a report
   with empty overlaps and empty blockers.
2. Verify RED.
3. Implement the orchestrator: resolve base (reuse `resolveBase` semantics), enumerate branches
   (Task 1), for each `changedPathsBetween(git, base, branch)` then `intersectFiles` (Task 2),
   run `blockerSweep` (Task 3), assemble `OverlapReport`.
4. Verify GREEN.
5. Commit: "feat(overlap-scan): runOverlapScan orchestrator".

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts` — orchestrator + `OverlapReport` type
- `src/conductor/test/engine/overlap-scan.test.ts` — orchestration cases

**Wired-into:** `src/conductor/src/index.ts#overlapScanCommand` (Task 7)
**Dependencies:** 1, 2, 3

### Task 5: Advisory degradation — never block, preserve partial results
**Story:** TR-4 (advisory, graceful degradation)
**Type:** negative-path
**Steps:**
1. Write failing test: enumeration throws → report carries an advisory-skip note and
   `runOverlapScan` does NOT throw; one branch's `changedPathsBetween` throws → the other
   branches are still diffed and reported; `blockerSweep` throws → seam overlaps still returned
   (partial-failure preserves the succeeding half).
2. Verify RED.
3. Implement per-phase try/catch in `runOverlapScan`; collect skip-notes into the report; never
   propagate.
4. Verify GREEN.
5. Commit: "feat(overlap-scan): advisory degradation, partial-failure resilience".

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts` — error wrapping
- `src/conductor/test/engine/overlap-scan.test.ts` — failure cases

**Wired-into:** same as Task 4
**Dependencies:** 4

### Task 6: Report rendering + quiet negative path
**Story:** TR-3 (zero ceremony); TR-1 (rename limit note)
**Type:** happy-path
**Steps:**
1. Write failing test: `renderReport(emptyReport)` → a single clean "no overlap, no open
   blockers" line and no prompt; `renderReport` with overlaps → each names branch + file; with
   blockers → lists open blockers; output includes the rename/name-only-diff limitation note.
2. Verify RED.
3. Implement `renderReport(report): string`.
4. Verify GREEN.
5. Commit: "feat(overlap-scan): render report with quiet clean path".

**Files likely touched:**
- `src/conductor/src/engine/overlap-scan.ts` — `renderReport`
- `src/conductor/test/engine/overlap-scan.test.ts` — render cases

**Wired-into:** `src/conductor/src/index.ts#overlapScanCommand` (Task 7)
**Dependencies:** 4

### Task 7: `conduct-ts overlap-scan` subcommand
**Story:** TR-6 (standalone primitive, dispatched via cli table)
**Type:** infrastructure
**Steps:**
1. Write failing test: driving the CLI dispatch for `overlap-scan --files a.ts,b.ts --source-ref
   owner/repo#B --cwd <repo>` parses the flags, invokes `runOverlapScan` with a real
   `makeGitRunner(cwd)` + `createBlockerResolver({ run: (a)=>gh(a,{cwd}) })`, prints
   `renderReport`, and exits 0 even when the report carries an advisory-skip note.
2. Verify RED.
3. Implement `.command('overlap-scan')` in `cli.ts` (flags `--files`, `--source-ref`, `--base`,
   `--cwd`) and the handler in `index.ts` wiring the real runners; exit 0 unconditionally.
4. Verify GREEN.
5. Commit: "feat(cli): conduct-ts overlap-scan subcommand".

**Files likely touched:**
- `src/conductor/src/cli.ts` — `.command('overlap-scan')` declaration
- `src/conductor/src/index.ts` — `overlapScanCommand` handler + dispatch
- `src/conductor/test/engine/overlap-scan-cli.test.ts` — dispatch test

**Wired-into:** `src/conductor/src/cli.ts#program (command table), src/conductor/src/index.ts#dispatch`
**Dependencies:** 4, 6

### Task 8: Wire the scan into the `/plan` step
**Story:** TR-6 (plan hook over authoritative `**Files:**`)
**Type:** infrastructure
**Steps:**
1. Write failing check: a harness-integrity/grep assertion that `skills/plan/SKILL.md` contains a
   step invoking `conduct-ts overlap-scan` over the plan's `**Files:**` set before the plan is
   committed, and states the result is advisory.
2. Verify RED (step absent).
3. Implement: add the step to `skills/plan/SKILL.md` (invoke the Task 7 subcommand; surface the
   report; never block). Runs regardless of whether arch-review ran.
4. Verify GREEN (`test/test_harness_integrity.sh` passes; assertion matches).
5. Commit: "docs(plan): invoke overlap-scan over authoritative Files set".

**Files likely touched:**
- `skills/plan/SKILL.md` — new advisory scan step
- `test/test_harness_integrity.sh` or a skill-step assertion — RED anchor

**Wired-into:** none (no new production surface) — references the Task 7 subcommand
**Dependencies:** 7

### Task 9: Wire the scan into the `/architecture-review` step
**Story:** TR-6 (arch-review hook over `## Wiring Surface`)
**Type:** infrastructure
**Steps:**
1. Write failing check: assertion that `skills/architecture-review/SKILL.md` (Medium/Large)
   contains a step invoking `conduct-ts overlap-scan` over the `## Wiring Surface` candidate
   paths, surfaced to the author before `/plan`, advisory.
2. Verify RED.
3. Implement: add the step to `skills/architecture-review/SKILL.md`.
4. Verify GREEN.
5. Commit: "docs(architecture-review): early overlap-scan over Wiring Surface".

**Files likely touched:**
- `skills/architecture-review/SKILL.md` — new advisory scan step
- `test/test_harness_integrity.sh` or a skill-step assertion — RED anchor

**Wired-into:** none (no new production surface) — references the Task 7 subcommand
**Dependencies:** 7

### Task 10: Documentation — README + CHANGELOG
**Story:** TR-6 (user-facing subcommand); repo Documentation Upkeep rule
**Type:** infrastructure
**Steps:**
1. Add the `conduct-ts overlap-scan` subcommand to `README.md` and `src/conductor/README.md`
   (flags, advisory semantics, when it runs in DECIDE).
2. Add a `## [Unreleased]` → `Added` entry in `CHANGELOG.md` for the new advisory scan.
3. Verify `test/test_harness_integrity.sh` passes (VERSION/CHANGELOG integrity).
4. Commit: "docs: document conduct-ts overlap-scan".

**Files likely touched:**
- `README.md`, `src/conductor/README.md` — subcommand docs
- `CHANGELOG.md` — Unreleased/Added entry

**Wired-into:** none (no new production surface)
**Dependencies:** 7

## Task Dependency Graph

```
T1 (enumerate) ─┐
T2 (intersect) ─┼─▶ T4 (orchestrator) ─┬─▶ T5 (degradation)
T3 (blocker)  ─┘                       ├─▶ T6 (render) ─┐
                                       └───────────────┴─▶ T7 (subcommand) ─┬─▶ T8 (/plan step)
                                                                            ├─▶ T9 (/arch-review step)
                                                                            └─▶ T10 (docs)
```

## Integration Points

- **After Task 7:** the scan is runnable end-to-end as `conduct-ts overlap-scan` against a real
  repo — the point where the primitive can be exercised on this very feature's own worktree
  (dogfood: it should name the sibling `spec/*` branches overlapping `cli.ts`/`index.ts`).
- **After Tasks 8–9:** the DECIDE chain surfaces the report automatically at both hook points.

## Verification

- [ ] TR-1 seam overlap: Tasks 1, 2, 4, 6 (enumerate + intersect + orchestrate + render)
- [ ] TR-2 blocker surfacing: Task 3 (+ 4); complementary-scope + added-after-claim covered by
      Task 3 verdict mapping and Task 4 orchestration
- [ ] TR-3 zero ceremony: Task 6 (clean render, no prompt)
- [ ] TR-4 advisory/degradation: Task 5 (partial-failure, never-block)
- [ ] TR-5 file-accurate intersection: Task 2 (exact match, no false positives)
- [ ] TR-6 dual-hook + standalone primitive: Tasks 7, 8, 9
- [ ] Negative paths are explicit tasks (Task 5 degradation; Task 2 false-match; Task 3
      indeterminate/absent-ref; Task 6 quiet path)
- [ ] No task exceeds ~5 min of focused work
- [ ] Dependencies explicit and acyclic (see graph)
- [ ] Every new-surface task carries a `**Wired-into:**` line
