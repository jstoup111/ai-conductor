**Status:** Accepted

# Stories: Daemon auto-resolve gitignored build-artifact rebase conflicts

**Track:** technical (no PRD; requirements TR-1…TR-7 derive from
adr-2026-07-05-base-ignored-artifact-auto-resolution +
adr-2026-07-05-needs-remediation-redispatch +
architecture-review-2026-07-05-daemon-auto-resolve-gitignored-rebase-conflicts)
**Source:** jstoup111/ai-conductor#319

---

## Story: Auto-resolve a base-ignored build-artifact delete/modify conflict (composed with CHANGELOG, looping to completion)

**Requirement:** TR-1

As the daemon operator, I want a rebase that conflicts on a build artifact the base deleted and
gitignores (e.g. `src/conductor/dist`), possibly alongside a `CHANGELOG.md` conflict, and possibly
recurring across many feature commits, to auto-resolve by taking the base's deletion (and the
existing CHANGELOG resolution) at every pause until the rebase completes — so every pre-#303 branch
self-resolves with no manual `git rm --cached`.

### Acceptance Criteria

#### Happy Path
- Given a branch whose SOLE conflict is a path the base **deleted** and **gitignores** (unmerged
  stages = deleted-by-us: stage 2 absent, stage 3 present), when `performRebase` runs, then the
  resolver `git rm`s the path, `git rebase --continue`s, and — repeating at each subsequent pause
  where the same path re-conflicts (because the artifact is modified across many commits) — drives
  the rebase to completion with outcome `artifact_resolved`. No HALT.
- Given a conflict set of **{`CHANGELOG.md`} ∪ {base-ignored deleted artifact paths}** (the
  #268/#269 case), when `performRebase` runs, then it resolves the CHANGELOG via the existing
  take-base-and-re-append and `git rm`s the artifact paths in the SAME pass, and completes as
  `artifact_resolved`.
- Given the `artifact_resolved` outcome, when `applyRebaseVerdicts` runs, then the `rebase` gate is
  SATISFIED and NO downstream gate is invalidated.

#### Negative Paths
- Given a delete/modify where the unmerged stages are **feature-deleted** (stage 3 absent, stage 2
  present — the branch deleted a path the base still modifies), when evaluated, then the path does
  NOT qualify (no `git rm`), and the outcome is `conflict_halt` — base's real modification is never
  dropped. (Guards against the rebase stage inversion, `rebase.ts:478-484`.)
- Given a delete/modify on a path the base deleted but that is **NOT gitignored on the base** (real
  source), when evaluated, then it does NOT qualify → `conflict_halt`.
- Given the loop exceeds a sane max-iteration cap (a rebase that keeps re-pausing), when reached,
  then the outcome is `conflict_halt` rather than an unbounded loop.

### Done When
- [ ] A resolver in `performRebase` proper (after the CHANGELOG-sole branch, `rebase.ts:~419`) loops
      over rebase pauses, resolving {CHANGELOG} ∪ {base-ignored DU artifact} sets until complete;
      returns `artifact_resolved`. Runs unconditionally (independent of the resolution cap).
- [ ] Qualification uses `git ls-files -u -- <path>`: **stage 2 absent AND stage 3 present** = DU.
- [ ] Real-temp-repo test: base deletes+gitignores `dist` modified across ≥2 commits → completes,
      `artifact_resolved`, tree clean, branch current.
- [ ] Real-temp-repo test: {CHANGELOG + dist} combined conflict → both resolved in one run.
- [ ] Real-temp-repo test: feature-deleted (stage-3-absent) path → `conflict_halt`, no `git rm`.

---

## Story: Base-anchored gitignore predicate via native check-ignore behind a .gitignore-untouched guard

**Requirement:** TR-2

As the daemon operator, I want the ignore boundary computed with git's own ignore engine but only
when the branch has not altered ignore rules relative to the base, so the auto-resolution can never
be tricked into dropping a real source file the branch laundered into "ignored".

### Acceptance Criteria

#### Happy Path
- Given a base whose root or nested `.gitignore` ignores the conflicted path and a branch that did
  NOT modify any `.gitignore` relative to base, when the predicate runs, then `git check-ignore -q
  -- <path>` decides membership (honoring nested `.gitignore`, negation, precedence natively) and
  the path qualifies.

#### Negative Paths
- Given the branch **modified any `**/.gitignore`** between base and HEAD (`git diff --name-only
  <base>..HEAD` contains a `.gitignore`), when the predicate runs, then the ENTIRE conflict set is
  disqualified → `conflict_halt`, even if `check-ignore` would say ignored — the branch cannot move
  the boundary.
- Given `git check-ignore` exits with an error (neither 0 nor 1), when the predicate runs, then the
  path is treated as NOT ignored (fail-closed) → `conflict_halt`.
- Given a **mixed** conflict set — one base-ignored artifact plus one non-ignored real source path —
  when evaluated, then NOTHING is resolved, nothing is staged, and the outcome is `conflict_halt`
  naming the unresolved path.

### Done When
- [ ] A `GitRunner` helper: (a) returns disqualified if `<base>..HEAD` touched any `.gitignore`;
      (b) otherwise uses `git check-ignore -q -- <path>` for membership; (c) fail-closed on error.
- [ ] The resolver disqualifies the ENTIRE set if any single path fails either predicate — no
      partial resolution path exists.
- [ ] Test: nested `.gitignore` ignores the path → qualifies (native engine).
- [ ] Test: branch edited `.gitignore` → whole set HALTs. Test: mixed set → HALT, zero staged.

---

## Story: `artifact_resolved` outcome classified satisfied on both call sites

**Requirement:** TR-3

As the daemon operator, I want the new `artifact_resolved` outcome wired into the verdict/event
model identically on the finish-time and re-kick paths, so an auto-resolved artifact conflict never
strands or mis-invalidates downstream gates on either path.

### Acceptance Criteria

#### Happy Path
- Given an `artifact_resolved` outcome, when `applyRebaseVerdicts` runs, then it writes a SATISFIED
  `rebase` verdict and returns `kickedBack: []`.
- Given an `artifact_resolved` outcome, when `emitRebaseEvent` runs, then it emits a distinct
  structured event (not `conflict_halt`).
- Given the finish-time `runRebaseStep` AND the re-kick `resumeRebaseFirst`, when each consumes an
  `artifact_resolved` outcome, then both proceed (no `writeHalt`, no `'halted'` return).

#### Negative Paths
- Given a `conflict_halt` outcome, when either path consumes it, then it still writes the HALT and
  does not proceed — behavior unchanged.
- Given the `RebaseOutcome` switches in `applyRebaseVerdicts`/`emitRebaseEvent`, when the new variant
  is added, then every switch handles it EXPLICITLY (no silent default-through as a HALT).

### Done When
- [ ] `RebaseOutcome` gains `{ kind: 'artifact_resolved' }`; `applyRebaseVerdicts`,
      `emitRebaseEvent`, and any outcome switch add an explicit arm.
- [ ] Test asserts SATISFIED verdict + empty kickback for `artifact_resolved`.
- [ ] Test asserts both `runRebaseStep` (daemon) and `resumeRebaseFirst` proceed on
      `artifact_resolved` and still HALT on `conflict_halt`.

---

## Story: Recover an orphaned unmerged index by restoring the feature tip (never the detached base)

**Requirement:** TR-4

As the daemon operator, I want a worktree left with unmerged index entries but NO active rebase to
be auto-recovered on the next re-kick by restoring the FEATURE commits, so a `dist` conflict
interrupted mid-resolution stops dead-locking — without ever silently shipping a feature-less tree.

### Acceptance Criteria

#### Happy Path
- Given a worktree with unmerged index entries present but `rebaseStateActive()` false, when
  `performRebase` runs, then it restores the **feature branch tip** (re-checkout the feature branch /
  reset `--hard` to `ORIG_HEAD` or the branch ref — NOT `HEAD`, which may be detached at the base),
  clears the stale unmerged entries, and falls through into the normal flow so `isBranchCurrent`
  evaluates against the FEATURE branch and a genuinely-behind branch rebases.

#### Negative Paths
- Given the recovery could not restore the feature tip (e.g. the branch ref / `ORIG_HEAD` is
  missing), when `performRebase` runs, then it does NOT proceed as "current" — it `conflict_halt`s
  rather than risk a base-only tree reporting SATISFIED.
- Given a **genuinely active** rebase (`rebaseStateActive()` true, unmerged paths present), when
  `performRebase` runs, then it does NOT reset — `conflict_halt` ("rebase already in progress"),
  exactly as today.
- Given a clean worktree, when `performRebase` runs, then the recovery path is not taken.

### Done When
- [ ] The guard (`rebase.ts:369-378`) is split on `rebaseStateActive()`: active → `conflict_halt`;
      inactive-but-unmerged → restore feature tip (NOT `HEAD`) then continue.
- [ ] The post-recovery flow keeps the standard `isBranchCurrent` (+ `featureCommitsPreserved` in
      the resolver loop) guards so a recovery that lost commits can never report SATISFIED.
- [ ] Real-temp-repo test: unmerged entries + HEAD detached at base, no rebase dir → recovered to
      feature tip, then rebased; final tree contains the feature commits and is current.
- [ ] Test: active rebase state dir present → still `conflict_halt`, no reset issued.

---

## Story: HALT on a branch-deleted / base-modified gitignored path (inverse delete/modify)

**Requirement:** TR-7

As the daemon operator, I want a delete/modify where the BRANCH deleted the path and the BASE still
modifies it — even if the path is gitignored on the base — to HALT and issue no `git rm`, so a
mis-staged predicate can never silently drop the base's real modification.

### Acceptance Criteria

#### Happy Path (safety-negative by nature)
- Given a conflict where `git ls-files -u -- <path>` shows **stage 3 absent, stage 2 present**
  (feature-deleted / base-modified), and the path is gitignored on the base, when `performRebase`
  evaluates it, then the path does NOT qualify, the resolver issues NO `git rm`, and the outcome is
  `conflict_halt`.

#### Negative Paths
- Given the same shape but the path is NOT gitignored, when evaluated, then likewise `conflict_halt`
  (unchanged).

### Done When
- [ ] Qualification explicitly requires stage-2-absent AND stage-3-present; the inverse
      (stage-3-absent) never qualifies regardless of ignore status.
- [ ] Real-temp-repo test: feature-deleted, base-modified, gitignored path → `conflict_halt`, no
      `git rm` executed.

---

## Story: Re-dispatch a processed feature whose only open PR is needs-remediation

**Requirement:** TR-5

As the daemon operator, I want a processed slug whose worktree was torn down and whose only open PR
carries `needs-remediation` to get one autonomous re-dispatch — recreated from the PR's head branch
— so a mechanically-resolvable finish halt self-resolves once the auto-resolver exists.

### Acceptance Criteria

#### Happy Path
- Given a slug with `.daemon/processed/<slug>` present, an OPEN PR carrying `needs-remediation`, no
  merged PR, no open non-remediation PR, and the attempt guards (TR-6) permitting it, when the
  daemon evaluates re-dispatch eligibility, then it recreates the worktree **from the remediation
  PR's head branch on origin**, writes the `.pipeline/REKICK` sentinel, and re-enters the
  build/finish flow so the ADR-1 resolver runs.

#### Negative Paths
- Given a slug with a **merged** PR, when evaluated, then it is NOT re-dispatched, regardless of any
  label.
- Given a slug with an open **non-remediation** PR (healthy in-flight work), when evaluated, then it
  is NOT re-dispatched.
- Given the PR list cannot be read, the PR state is ambiguous, OR the branch cannot be fetched /
  worktree cannot be recreated, when evaluated, then the slug is NOT re-dispatched and NO attempt is
  recorded (fail-closed) — the PR is left for a human.

### Done When
- [ ] Eligibility requires: processed marker AND open needs-remediation PR AND no merged/healthy PR.
- [ ] Worktree is recreated from the PR head branch; a fetch/recreate failure → no dispatch, no
      attempt recorded.
- [ ] Re-dispatch reuses `.pipeline/REKICK` → `resumeRebaseFirst`; no parallel builder is added.
- [ ] Test: eligible + guards permit → re-dispatched once. Test: merged PR / PR-read failure /
      fetch failure → never re-dispatched.

---

## Story: Bound re-dispatch with a per-PR one-shot AND a monotonic per-slug cap

**Requirement:** TR-6

As the daemon operator, I want re-dispatch bounded by BOTH a per-(slug, PR-number) one-shot AND a
monotonic per-slug attempt cap, so that neither a same-PR re-tick nor a new-PR-number churn (a
failed re-dispatch that spawns a fresh remediation PR) can ever loop.

### Acceptance Criteria

#### Happy Path
- Given an eligible slug whose `.daemon/remediation-redispatch/<slug>` marker does NOT list the
  current remediation PR number AND whose recorded attempt count is below the cap (default 1), when
  re-dispatch fires, then it records the PR number and increments the attempt count before/at
  dispatch.

#### Negative Paths
- Given the current open needs-remediation PR number is ALREADY recorded, when evaluated on any
  later tick, then the slug is NOT re-dispatched (per-PR one-shot).
- Given a genuinely NEW remediation PR number but the recorded attempt count has reached the cap,
  when evaluated, then the slug is NOT re-dispatched (monotonic cap stops new-PR churn) — this is the
  guard that holds even if escalation mints a fresh PR after a failed re-dispatch.
- Given a daemon **restart** with the marker present, when evaluated, then it re-reads the marker
  and no-ops (restart never re-fires).
- Given the marker read fails on a non-ENOENT fault, when evaluated, then the slug is NOT
  re-dispatched (fail-closed).

### Done When
- [ ] `.daemon/remediation-redispatch/<slug>` (gitignored, repo-root) records BOTH the attempted PR
      number(s) AND a monotonic attempt count; re-dispatch requires PR-number-unseen AND count < cap.
- [ ] Cap default is 1, configurable; both guards are independently sufficient to stop a loop.
- [ ] Test: two ticks, same open PR → exactly ONE dispatch. Test: restart, same PR → no dispatch.
- [ ] Test: failed re-dispatch spawns a NEW PR number with count == cap → NO further dispatch.
