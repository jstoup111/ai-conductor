# Implementation Plan: Daemon auto-resolve gitignored build-artifact rebase conflicts

**Date:** 2026-07-05
**Source:** jstoup111/ai-conductor#319
**Stories:** `.docs/stories/daemon-auto-resolve-gitignored-rebase-conflicts.md` (TR-1…TR-7)
**Decisions:** adr-2026-07-05-base-ignored-artifact-auto-resolution,
adr-2026-07-05-needs-remediation-redispatch
**Complexity:** M (`.docs/complexity/daemon-auto-resolve-gitignored-rebase-conflicts.md`)
**Status:** PENDING

---

## Overview

Two phases. **Phase A** extends the engine-native rebase resolver (`src/conductor/src/engine/
rebase.ts`) with base-ignored artifact auto-resolution (composed with CHANGELOG, looping to
completion) and safe orphaned-index recovery — TR-1..TR-4, TR-7. **Phase B** adds the bounded
re-dispatch route for a `processed` slug whose only open PR is `needs-remediation` — TR-5, TR-6.
Phase A is self-contained and unblocks the motivating PRs; Phase B depends on Phase A's resolver
existing (it re-dispatches into it). Both extend the real-temp-repo test harness
(`test/engine/rebase-resolution.test.ts` pattern: real conflicting repo + injected runner, no
Claude). All tests are written test-first (RED → GREEN) per the harness TDD cycle.

Paths below are relative to `src/conductor/`.

---

## Phase A — rebase.ts auto-resolution + orphaned-index recovery (TR-1..TR-4, TR-7)

### A1. Base-anchored gitignore predicate (TR-2)

**Seam:** new helper beside `conflictedFiles`/`rebaseStateActive` in `src/engine/rebase.ts`.

1. **a1-1** — Add `branchModifiedGitignore(git, baseRef)`: returns true iff
   `git diff --name-only <baseRef>..HEAD` contains any path matching `(^|/)\.gitignore$`.
2. **a1-2** — Add `isBaseIgnored(git, path, baseRef)`: returns false if `branchModifiedGitignore`
   is true (fail-closed disqualifier); else `git check-ignore -q -- <path>` → exit 0 = ignored,
   exit 1 = not, any other exit = false (fail-closed).
3. **a1-3** — Unit tests (scripted `fakeGit`): ignored path → true; `.gitignore` touched → false;
   check-ignore error exit → false.
4. **a1-4** — Real-temp-repo test: nested `.gitignore` ignores a path → `isBaseIgnored` true
   (native engine honors nesting).

### A2. Deleted-by-us stage detection (TR-1, TR-7)

**Seam:** new helper in `src/engine/rebase.ts`.

5. **a2-1** — Add `isDeletedByUs(git, path)`: parse `git ls-files -u -- <path>`; qualify iff a
   **stage-2 entry is ABSENT and a stage-3 entry is PRESENT** (base deleted, feature modified).
   Explicitly return false for stage-3-absent (feature-deleted) and for modify/modify (both
   stages present).
6. **a2-2** — Unit tests: DU (stage2 absent, stage3 present) → true; stage3 absent → false;
   both stages present → false.

### A3. Composite artifact+CHANGELOG resolver, looping to completion (TR-1)

**Seam:** new branch in `performRebase` after the CHANGELOG-sole check (`rebase.ts:~419`), plus a
helper mirroring `tryResolveChangelogConflict` (`rebase.ts:478`).

7. **a3-1** — Add `RebaseOutcome` variant `{ kind: 'artifact_resolved' }` to the union
   (`rebase.ts:335`).
8. **a3-2** — Add `tryResolveArtifactConflicts(git, projectRoot, baseRef, featureAdditions, cap)`:
   loop up to `cap` iterations — each iteration: read `conflictedFiles`; classify every path as
   CHANGELOG, or base-ignored-DU (via A1+A2); if any path is neither → return false (HALT); else
   `git rm` each DU artifact path, write+`git add` the resolved CHANGELOG if present (reuse
   `buildResolvedChangelog`), `git -c core.editor=true rebase --continue`; if the rebase completed
   (no state dir, no unmerged) → return true; else re-loop. Exhausting `cap` → false.
9. **a3-3** — Wire into `performRebase`: after the CHANGELOG-sole branch, if the conflict set is
   non-empty and NOT the CHANGELOG-sole case, attempt `tryResolveArtifactConflicts`; on success
   return `artifact_resolved`; on false fall through to the existing `conflict_halt`.
10. **a3-4** — Real-temp-repo test: base deletes+gitignores `dist` modified across 2 commits →
    completes, `artifact_resolved`, tree clean, `isBranchCurrent` true.
11. **a3-5** — Real-temp-repo test: {CHANGELOG + dist} combined conflict → both resolved, one run.
12. **a3-6** — Real-temp-repo test: mixed set (dist + real `src/x.ts` the base deleted) → HALT,
    nothing staged. Real-temp-repo test: feature-deleted (stage-3-absent) gitignored path → HALT,
    no `git rm` (TR-7).

### A4. `artifact_resolved` verdict + event wiring (TR-3)

**Seam:** `applyRebaseVerdicts` (`rebase.ts:725`), `emitRebaseEvent` (`rebase.ts:777`), and any
outcome switch (e.g. `conductor.ts` `advanceTail` `:2103-2112`).

13. **a4-1** — `applyRebaseVerdicts`: add explicit `artifact_resolved` arm → SATISFIED verdict
    ("base-ignored artifact conflict auto-resolved; branch current"), `kickedBack: []`.
14. **a4-2** — `emitRebaseEvent`: add a distinct `rebase_artifact_resolved` event; add the event
    type to the UI event union.
15. **a4-3** — Audit every `switch (outcome.kind)` / `outcome.kind ===` site (grep) for exhaustive
    handling; add explicit arms so nothing defaults through as a HALT.
16. **a4-4** — Unit test: `artifact_resolved` → SATISFIED verdict + empty kickback. Wiring test:
    both `runRebaseStep` (daemon) and `resumeRebaseFirst` proceed on `artifact_resolved`, still
    HALT on `conflict_halt`.

### A5. Orphaned unmerged-index recovery → feature tip (TR-4)

**Seam:** the preexisting-conflict guard in `performRebase` (`rebase.ts:369-378`).

17. **a5-1** — Split the guard: compute `active = await rebaseStateActive(...)` and
    `unmerged = preexistingConflicts.length > 0`. If `active` → `conflict_halt` (unchanged). Else
    if `unmerged` → recovery (a5-2).
18. **a5-2** — Recovery: restore the feature tip — `git rebase --abort` is inapplicable (no active
    rebase), so reset to `ORIG_HEAD` if present else the current branch ref (NOT `HEAD`, which may
    be detached at base); `git reset --hard <feature-tip>` clears the stale unmerged entries; then
    fall through into the normal `resolveBase`/`isBranchCurrent`/rebase flow.
19. **a5-3** — If neither `ORIG_HEAD` nor a branch ref resolves (cannot restore the feature tip),
    `conflict_halt` — never proceed as "current" on a base-only tree.
20. **a5-4** — Real-temp-repo test: seed unmerged entries with HEAD detached at base, no rebase
    dir → recovered to feature tip, rebased, final tree has feature commits + current.
21. **a5-5** — Real-temp-repo test: active rebase state dir present + unmerged → still
    `conflict_halt`, no reset issued (assert via a spy/injected runner that no `reset --hard` ran).

---

## Phase B — bounded re-dispatch route (TR-5, TR-6)

### B1. Re-dispatch marker (TR-6)

**Seam:** new module `src/engine/daemon-remediation-redispatch.ts`; marker dir
`.daemon/remediation-redispatch/<slug>` (add to `.gitignore` alongside `.daemon/`).

22. **b1-1** — `readRedispatchMarker(projectRoot, slug)` → `{ prNumbers: number[], attempts: number }`
    or null (ENOENT); non-ENOENT read error throws → callers treat as fail-closed.
23. **b1-2** — `recordRedispatch(projectRoot, slug, prNumber)`: append `prNumber`, increment
    `attempts`, write atomically.
24. **b1-3** — `shouldRedispatch(marker, prNumber, cap)`: true iff `marker == null` OR
    (`!prNumbers.includes(prNumber)` AND `attempts < cap`).
25. **b1-4** — Unit tests: unseen PR + under cap → true; same PR → false; new PR at cap → false;
    read error → propagates (fail-closed at call site).

### B2. Eligibility evaluation (TR-5)

**Seam:** new function consulted from the daemon dispatch pass; reuses the `gh` runner and the
`needs-remediation` label constants (`build-failure-escalation.ts`, `halt-pr-rehabilitation.ts`),
`isProcessed` (`daemon-deps.ts:143`), and `mergeable-sweep`-style PR listing.

26. **b2-1** — `findRedispatchCandidate(deps, slug)`: return the open PR for the slug iff
    `isProcessed(slug)` AND that PR carries `needs-remediation` AND there is no merged PR and no open
    non-remediation PR for the slug; else null. Any gh-read failure → null (fail-closed).
27. **b2-2** — Unit tests (injected gh): processed + needs-remediation + no healthy PR → candidate;
    merged PR present → null; open non-remediation PR → null; gh error → null.

### B3. Re-dispatch execution (TR-5)

**Seam:** wire into the daemon dispatch pass (`daemon-cli.ts` pre-boot, near the existing
`resumeRebaseFirst` wiring `:513-565`), reusing worktree recreation + the `.pipeline/REKICK`
sentinel writer (`daemon-rekick.ts:268`).

28. **b3-1** — On an eligible candidate passing `shouldRedispatch`: recreate the worktree from the
    PR head branch on origin (fetch + worktree add on `spec/<slug>`); on fetch/recreate failure →
    do NOT dispatch, do NOT record an attempt (fail-closed), log the skip.
29. **b3-2** — On successful recreation: `recordRedispatch(...)` BEFORE writing the REKICK sentinel
    (so a crash between the two cannot un-count the attempt), write `.pipeline/REKICK`, let the
    existing `resumeRebaseFirst` path run the Phase-A resolver.
30. **b3-3** — Integration-ish test (injected git + gh): eligible + guards permit → exactly one
    worktree recreate + one sentinel write + attempt recorded. Merged PR / gh-read fail / fetch
    fail → zero dispatch, zero attempt recorded.
31. **b3-4** — Loop-safety test: two consecutive dispatch passes, same open needs-remediation PR →
    exactly ONE dispatch. Restart (re-read marker) same PR → none. New PR number at cap → none.

---

## Cross-cutting

32. **x-1** — Add `.daemon/remediation-redispatch/` to `.gitignore` (repo root and/or
    `src/conductor/.gitignore` as consistent with existing `.daemon/` ignores).
33. **x-2** — CHANGELOG `[Unreleased]` entry (Added: base-ignored artifact rebase auto-resolution
    + orphaned-index recovery + needs-remediation re-dispatch route). Repo rule.
34. **x-3** — Docs: note the new auto-resolution class + re-dispatch route in
    `src/conductor/README.md` / the daemon rebase-mechanism docs (HARNESS "Docs track features").
35. **x-4** — Run `test/test_harness_integrity.sh` + the conductor vitest suite
    (`rtk proxy npx vitest run` in `src/conductor/`); all green before finish.

---

## Sequencing notes

- Phase A tasks are ordered by dependency: A1+A2 (predicates) → A3 (resolver) → A4 (wiring) → A5
  (recovery, independent of A3 but shares the guard region — do after A3 to avoid churn).
- Phase B depends only on the Phase-A resolver existing (B re-dispatches into it); B1→B2→B3 in
  order.
- Keep the two `performRebase` call sites (finish-time `runRebaseStep`, re-kick `resumeRebaseFirst`)
  behaviorally identical — all new logic lives in `performRebase`/helpers, exercised by both.
