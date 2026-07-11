# Implementation Plan: Unified Build-Completion Evidence Derivation (#456 + #463)

**Date:** 2026-07-10
**Design:** `.docs/decisions/adr-2026-07-10-evidence-range-anchor-resolution.md`,
`.docs/decisions/adr-2026-07-10-retire-migration-grandfather.md` (both APPROVED)
**Stories:** `.docs/stories/unify-build-completion-evidence-derivation-fix-der.md`
**Conflict check:** Clean as of 2026-07-10 (1 blocking conflict resolved by H8 supersession)
**Refs:** jstoup111/ai-conductor#456, jstoup111/ai-conductor#463

## Summary

Fixes the evidence-range anchor (never the repo genesis; branch base via a deterministic
fail-closed ladder, derived default branch) and retires the H8 migration-grandfather path so a
git-derived evidence stamp is the only completion currency. 13 tasks.

## Technical Approach

- **Single-source the anchor in `getEvidenceRange`** (`src/conductor/src/engine/autoheal.ts`).
  New ladder: (1) reachable explicit `anchorArg`; (2) `merge-base --fork-point
  origin/«default» HEAD`; (3) plain `merge-base origin/«default» HEAD`; (4) fail-closed zero
  commits + anomaly. The `-n 100 HEAD` no-lower-bound window is deleted. The default branch comes
  from the existing `originDefaultBranch(git)` helper (`src/conductor/src/engine/rebase.ts:72`,
  takes a `GitRunner` from `makeGitRunner(projectRoot)`); when it returns null, fall back to
  probing `origin/main` then `origin/master` (preserves today's behavior for repos without
  `origin/HEAD`), else the existing fail-closed zero-commit path.
- **Delete the genesis fallback in `deriveCompletion`** (`autoheal.ts:704-724`): when no
  `anchorArg` is given, pass `''` and let `getEvidenceRange`'s ladder resolve. Explicit
  `anchorArg` callers are untouched.
- **`listCommits`** (`autoheal.ts:409-427`) switches its hardcoded `origin/main` to the same
  derived-default resolution; its no-remote degraded path (bounded local log) stays.
- **Retire grandfather:** remove the first-seed stamping block in
  `src/conductor/src/engine/task-seed.ts` (~151-166) and the
  `migrationGrandfather` + terminal-row acceptance clause in
  `src/conductor/src/engine/artifacts.ts` (~741-755). `task-evidence.ts` keeps parsing the field
  (legacy sidecars load clean; entries inert). Gate resolution = `evidenceStamps` only.
- **Sequencing:** anchor cluster first (it changes what derivation sees), then grandfather
  cluster, then cross-cutting integration tests, then docs/CHANGELOG. Tests run from
  `src/conductor` with vitest in isolated temp repos (per repo convention; never from worktree
  root).

## Prerequisites

None — no migrations, no new dependencies. All tests use isolated `mkdtemp` git repos with a
seeded `origin` remote (bare repo) so `refs/remotes/origin/HEAD` is settable per scenario.

## Tasks

### Task 1: getEvidenceRange derives the origin default branch
**Story:** "Evidence-range git refs derive the origin default branch" — happy path + no-derivable-default negative
**Type:** happy-path

**Steps:**
1. Write failing test: isolated repo whose origin default branch is `master`
   (set `refs/remotes/origin/HEAD` accordingly); `getEvidenceRange` resolves a range instead of
   the current fail-closed `origin/main does not exist` anomaly. Second case:
   `origin/HEAD` unset and neither `origin/main` nor `origin/master` exists → zero commits +
   anomaly naming the default-branch resolution failure (never a silent `main` guess).
2. Verify test fails (RED)
3. Implement: in `getEvidenceRange`, replace both hardcoded `origin/main` uses with a resolved
   `origin/«default»` ref: `originDefaultBranch(makeGitRunner(projectRoot))`, falling back to
   probing `origin/main` then `origin/master` via `rev-parse --verify`, else the existing
   fail-closed return.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): getEvidenceRange derives origin default branch"

**Files:**
- src/conductor/src/engine/autoheal.ts
- src/conductor/test/engine/autoheal.test.ts

**Dependencies:** none

### Task 2: Anchor ladder rung 3 — plain merge-base when fork-point fails
**Story:** "Anchor resolution ladder is deterministic and fail-closed" — fork-point-fails negative path
**Type:** negative-path

**Steps:**
1. Write failing test: isolated repo arranged so `merge-base --fork-point origin/«default» HEAD`
   exits non-zero (fresh clone, no reflog for the ref) while plain `merge-base` succeeds; with an
   unreachable anchor, `getEvidenceRange` uses the plain merge-base as lower bound and returns
   exactly the branch's own commits, with no rung-4 anomaly.
2. Verify test fails (RED)
3. Implement: in the merge-base fallback of `getEvidenceRange`, try `--fork-point` first, then
   plain `merge-base`, taking the first success.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): evidence anchor falls through fork-point to plain merge-base"

**Files:** same

**Dependencies:** Task 1

### Task 3: Anchor ladder rung 4 — fail-closed zero commits, no -n 100 window
**Story:** "Anchor resolution ladder is deterministic and fail-closed" — unrelated-histories negative + fail-closed gate feed
**Type:** negative-path

**Steps:**
1. Write failing test: repo where the origin default ref exists but shares no merge-base with
   HEAD (unrelated histories); `getEvidenceRange` returns zero commits and logs an anomaly naming
   the failed resolution — assert the commit list is empty even though HEAD has >0 commits
   carrying valid `Task: N` trailers (the old code returned the last 100).
2. Verify test fails (RED)
3. Implement: delete the `range = 'HEAD'` / `-n 100` branch; when no lower bound resolves, push
   the anomaly and return the empty result.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): evidence range fails closed when no branch base resolves"

**Files:** same

**Dependencies:** Task 2

### Task 4: Delete deriveCompletion's genesis fallback
**Story:** "No-anchor derivation anchors at the branch base, never the repo genesis" — happy paths + genesis-never negative
**Type:** happy-path

**Steps:**
1. Write failing test: repo with base history on the origin default branch + a feature branch
   with 3 commits; `deriveCompletion(root, planPath)` (no anchor) evaluates a range equal to
   `«merge-base»..HEAD` — assert a pre-base commit is NOT in range and a branch commit with a
   corroborating `Task: 2` trailer IS stamped. Also assert (unit level) that no code path invokes
   `git log --reverse` for anchor resolution anymore.
2. Verify test fails (RED)
3. Implement: remove the genesis-computing block in `deriveCompletion` (autoheal.ts:704-724);
   when `anchorArg` is undefined pass `''` so `getEvidenceRange`'s ladder resolves the bound.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): deriveCompletion no-anchor path anchors at branch base (#456)"

**Files:** same

**Dependencies:** Task 3

### Task 5: Regression — foreign pre-base trailer can never corroborate or stamp
**Story:** "No-anchor derivation…" — the #456 `ce77676` negative path
**Type:** negative-path

**Steps:**
1. Write failing-or-passing regression test (must fail against pre-Task-4 code; keep as pinned
   regression): pre-base commit on the default branch carries `Task: 2` with paths that overlap
   the plan's task-2 `Files:` set; after no-anchor derivation, task 2 has no `evidenceStamps`
   entry and no corroboration warning references the foreign SHA.
2. Verify it fails when Task 4's change is reverted (RED against old code), passes now (GREEN).
3. Implement: none expected (covered by Tasks 1-4); fix anything the test exposes.
4. Verify test passes (GREEN)
5. Commit with message: "test(engine): foreign-history trailers cannot evidence the current plan (#456)"

**Files:** same

**Dependencies:** Task 4

### Task 6: Explicit anchorArg behavior pinned
**Story:** "No-anchor derivation…" — explicit-anchor negative path
**Type:** negative-path

**Steps:**
1. Write test (extend existing explicit-anchor specs if present): a reachable explicit
   `anchorArg` is used verbatim as the lower bound (rung 1), and an unreachable one falls into
   the ladder with the existing "unreachable; falling back" warning preserved.
2. Verify coverage (RED if gap exposed)
3. Implement: none expected.
4. Verify test passes (GREEN)
5. Commit with message: "test(engine): explicit evidence anchor is rung 1 of the ladder"

**Files:** same

**Dependencies:** Task 3

### Task 7: listCommits uses the derived default branch
**Story:** "Evidence-range git refs derive the origin default branch" — listCommits criterion + no-remote negative
**Type:** happy-path

**Steps:**
1. Write failing test: `master`-defaulted repo — `listCommits` returns only post-merge-base
   commits (today it silently takes the no-merge-base degraded path when `origin/main` is
   absent); no-remote repo — bounded local log behavior unchanged.
2. Verify test fails (RED)
3. Implement: swap hardcoded `origin/main` in `listCommits` for the same derived-default
   resolution used in Task 1 (share the small resolver helper).
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): listCommits derives origin default branch"

**Files:** same

**Dependencies:** Task 1

### Task 8: First seed stops grandfathering terminal rows
**Story:** "First seed never grandfathers terminal rows" — happy path
**Type:** happy-path

**Steps:**
1. Write failing test: worktree with `task-status.json` rows `completed` (plan-known ids) and no
   sidecar; after `seedTaskStatus`, the sidecar's `migrationGrandfather` is empty. Update the
   existing first-seed grandfather specs in `task-seed.test.ts` that pin the OLD behavior
   (they assert stamping — invert them per the superseded H8).
2. Verify test fails (RED)
3. Implement: delete the first-seed stamping block (`task-seed.ts` ~151-166) and the now-unused
   `isFirstSeed` plumbing if nothing else reads it.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): retire first-seed migration-grandfather stamping (#463)"

**Files:**
- src/conductor/src/engine/task-seed.ts
- src/conductor/test/engine/task-seed.test.ts

**Dependencies:** Task 4

### Task 9: Gate resolves by evidence stamps only; legacy sidecars inert
**Story:** "The gate resolves tasks by evidence stamps only" — all criteria
**Type:** happy-path

**Steps:**
1. Write failing test: hand-written legacy sidecar (`evidenceStamps: {}`,
   `migrationGrandfather: ["2","4"]`) + rows `completed` for 2 and 4; build-gate completion check
   reports 2 and 4 pending (gate fails). Companion assertions: `createTaskEvidence` loads the
   legacy file without error; a task WITH a stamp still counts regardless of row status.
   Update existing `artifacts.test.ts` specs pinning grandfather acceptance.
2. Verify test fails (RED)
3. Implement: remove the `migrationGrandfather` acceptance clause from the unresolved-filter in
   `artifacts.ts` (~741-755) and the now-dead grandfather re-read plumbing around it.
4. Verify test passes (GREEN)
5. Commit with message: "fix(engine): build gate accepts evidence stamps as the only completion currency (#463)"

**Files:**
- src/conductor/src/engine/artifacts.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** Task 8

### Task 10: Legitimate completions survive sidecar deletion
**Story:** "First seed never grandfathers…" — legitimate-work negative path
**Type:** negative-path

**Steps:**
1. Write failing-if-gap test: task completed via a real commit (`Task: N` trailer + corroborating
   paths); delete `.pipeline/task-evidence.json`; re-run seed + derivation + gate — the task is
   re-stamped from git and still counts.
2. Verify (RED if gap)
3. Implement: none expected (derivation re-stamps by design); fix anything exposed.
4. Verify test passes (GREEN)
5. Commit with message: "test(engine): sidecar loss never demotes commit-evidenced tasks"

**Files:**
- src/conductor/test/engine/task-seed.test.ts
- src/conductor/test/engine/artifacts.test.ts

**Dependencies:** Task 9

### Task 11: Integration — the #463 forged-flip shape fails at the first gate
**Story:** "Build gate and post-rebase pre-verify can never disagree" — forged-flip negatives + determinism
**Type:** negative-path

**Steps:**
1. Write failing test (integration, isolated repo): plan with 17 tasks, 5 completed via real
   commits; agent-style forgery flips 9 rows to `completed` with zero new commits and no/deleted
   sidecar; the FIRST build-gate evaluation fails naming the 9 ids; run the identical evaluation
   twice and assert byte-identical verdict reasons (determinism — no pass/reset oscillation).
2. Verify test fails (RED) against pre-change code (it passed via grandfather).
3. Implement: none expected; fix anything exposed.
4. Verify test passes (GREEN)
5. Commit with message: "test(integration): evidence-less status flips fail the build gate immediately (#463)"

**Files:**
- src/conductor/test/integration/task-status-gate-recompute.test.ts

**Dependencies:** Task 9

### Task 12: Integration — gate and post-rebase pre-verify verdicts agree
**Story:** "Build gate and post-rebase pre-verify can never disagree" — happy path + rebase-pulls-trailers negative
**Type:** happy-path

**Steps:**
1. Write failing-if-gap test (integration, isolated repo, daemon-gated rebase context per repo
   convention): (a) all tasks commit-evidenced → build gate passes → file-changing rebase →
   `preVerify('build')` passes and writes the `re-verified` verdict (no kickback of build); (b)
   the rebase pulls default-branch commits carrying coincidental `Task: N` trailers with
   overlapping paths → pre-verify verdict unchanged (new commits are outside `«merge-base»..HEAD`).
2. Verify (RED if gap)
3. Implement: none expected; fix anything exposed.
4. Verify test passes (GREEN)
5. Commit with message: "test(integration): build gate and post-rebase pre-verify share one verdict basis"

**Files:**
- src/conductor/test/integration/gate-loop.test.ts

**Dependencies:** Task 11

### Task 13: Docs + CHANGELOG
**Story:** all (release gate requirement)
**Type:** infrastructure

**Steps:**
1. Add `CHANGELOG.md` `[Unreleased]` → Fixed entries for #456 and #463 (engine-internal; no
   consumer CLI/hook/schema surface → no migration block; if the release gate's path classifier
   flags a breaking surface anyway, commit a waiver per adr-2026-07-06-migration-gate-waiver).
2. Sweep docs for grandfather/anchor mentions: `src/conductor/README.md` and any skill docs
   describing the evidence gate; update the H6/H7/H8 comment block in `artifacts.ts` and the
   `getEvidenceRange` doc comment to the new ladder.
3. Run `test/test_harness_integrity.sh`; fix failures.
4. Commit with message: "docs: evidence derivation unification (#456 #463) — changelog + doc sweep"

**Files:**
- CHANGELOG.md
- src/conductor/README.md
- src/conductor/src/engine/artifacts.ts
- src/conductor/src/engine/autoheal.ts

**Dependencies:** Task 12

## Task Dependency Graph

```
Task 1 ─┬─ Task 2 ── Task 3 ─┬─ Task 4 ── Task 5
        │                    └─ Task 6
        └─ Task 7
Task 4 ── Task 8 ── Task 9 ─┬─ Task 10
                            └─ Task 11 ── Task 12 ── Task 13
```

## Integration Points

- After Task 4: no-anchor derivation is branch-scoped end-to-end — the #456 halt shape is
  reproducible-and-fixed in isolation.
- After Task 9: the gate's single-currency resolution is complete — the #463 forgery vector is
  closed.
- After Task 12: full build→rebase→pre-verify loop provably convergent.

## Coverage Mapping

| Story | Tasks |
|---|---|
| No-anchor derivation anchors at branch base | 4, 5, 6 |
| Anchor resolution ladder deterministic + fail-closed | 2, 3 (fail-closed gate feed: 3.1) |
| Derived origin default branch | 1, 7 |
| First seed never grandfathers | 8, 10 |
| Gate resolves by stamps only | 9 |
| Gate and pre-verify never disagree | 11, 12 |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task (each is an explicit task)
- [ ] No task exceeds 5 minutes of work
- [ ] Dependencies are explicit and acyclic
