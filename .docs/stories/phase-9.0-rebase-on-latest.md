# Stories: Phase 9.0 — Daemon Rebase-on-Latest + Conflict→HALT

**Status:** Accepted
**Source PRD:** `.docs/specs/2026-06-25-phase-9.0-rebase-on-latest.md`
**Complexity tier:** M
**Persona note:** This is automated daemon-correctness behavior. "I" is the **daemon**; the
**operator** is the human who runs daemons and merges their PRs. Scenarios are expressed in
terms of git state, `.pipeline/` markers, gate verdicts, the event log, and HALT — there is no
HTTP/UI surface.

> **Targeted supersession (2026-07-30):** `mergeability-first-finish.md` supersedes the
> ancestry-freshness behavior in FR-1 through FR-4. In those stories, the engine-native `rebase`
> lifecycle step is now an automatic integration gate: a clean prospective merge satisfies it
> without history rewriting; conflict or indeterminate state enters the actual rebase flow.

---

## Story: Automatic integration runs after the applicable SHIP validation tail, before finish

**Requirement:** FR-1

As the daemon, I want to evaluate integration against the latest resolved base **after** the
applicable SHIP validation tail is green or validly skipped and **before** finish, so that the PR I
open is either already mergeable or has entered conflict recovery.

### Acceptance Criteria

#### Happy Path
- Given a worktree whose applicable SHIP validation tail is completed or validly skipped, when the
  loop reaches the point before `finish`, then the automatic integration gate runs exactly once
  before `finish` executes.
- Given integration returns already-current, mergeable-skip, clean-rebase, or auto-resolved, when
  no HALT is written, then `finish` runs and a PR is opened.

#### Negative Paths
- Given a worktree where the applicable SHIP validation tail is not yet satisfied, when the loop
  reaches the tail, then rebase does **not** run and finish remains blocked.
- Given the rebase writes `.pipeline/HALT`, when the loop continues, then `finish` does **not**
  run and **no PR** is opened.

### Done When
- [ ] Automatic integration is invoked from the loop tail only after the applicable SHIP validation tail is
      completed or validly skipped.
- [ ] When rebase HALTs, `finish` is not reached and `pr_url` is never set.
- [ ] Integration test: green front-half → rebase → finish ordering asserted via event log.

---

## Story: Resolve the origin default branch as the integration target

**Requirement:** FR-2

As the daemon, I want to fetch and evaluate integration against **origin's default branch discovered
at runtime** so that sibling PRs humans merged are considered without hardcoding `main`.

### Acceptance Criteria

#### Happy Path
- Given an `origin` remote whose default branch is `main`, when automatic integration runs, then it
  executes `git fetch origin main` (or the discovered default) and evaluates against `origin/main`.
- Given the default branch is named something other than `main` (e.g. `trunk`), when integration
  runs, then it evaluates against `origin/trunk` — the name is discovered via
  `git symbolic-ref refs/remotes/origin/HEAD`, never hardcoded.

#### Negative Paths
- Given the repo's local `main` is stale but `origin/main` has advanced by 3 merged PRs, when
  integration runs, then it uses the **fetched `origin/main`** tip, not the stale local ref.
- Given `git symbolic-ref refs/remotes/origin/HEAD` is unset, when integration runs, then the
  daemon resolves the default branch deterministically (e.g. via `git remote show origin` or the
  configured base) rather than assuming `main`.

### Done When
- [ ] Base branch name is obtained by discovery, with no literal `"main"`/`"master"` in the path.
- [ ] A `git fetch` of the default branch precedes prospective mergeability assessment.
- [ ] Test: advanced `origin/<default>` is the integration target, asserted against the decision.

---

## Story: Fall back to local base when there is no remote

**Requirement:** FR-3 *(edge)*

As the daemon, I want to fall back to the local base branch when there is no usable remote, so
that remote-less repos and test fixtures still complete instead of failing.

### Acceptance Criteria

#### Happy Path
- Given a repo with **no `origin` remote**, when the rebase step runs, then it skips the fetch
  and rebases onto the **local base branch**, and the feature proceeds to finish.

#### Negative Paths
- Given `git fetch origin <default>` fails (network error / unreachable remote), when the rebase
  step runs, then the daemon falls back to the local base branch and proceeds — it does **not**
  HALT and does **not** fail the feature for lack of a reachable remote.
- Given default-branch discovery fails entirely, when the rebase runs, then the daemon uses the
  configured base branch and proceeds rather than aborting.

### Done When
- [ ] No-remote repo completes the rebase step against the local base without error.
- [ ] A failed fetch is caught and degrades to local-base rebase (logged), not a HALT/failure.
- [ ] Test: fixture with no remote rebases onto local base and reaches finish.

---

## Story: Skip re-verification when already current or mergeable

**Requirement:** FR-4 *(edge)*

As the daemon, I want to skip re-verification when the branch is already current or can merge
cleanly without rewriting history, so that unchanged feature work goes straight to its PR.

### Acceptance Criteria

#### Happy Path
- Given the base has no new commits, or has advanced but the prospective merge is clean, when
  automatic integration runs, then the feature history stays unchanged and the loop proceeds
  **directly to finish** with **no** re-verification.

#### Negative Paths
- Given the prospective merge conflicts or is indeterminate and an actual rebase changes code/test
  paths, when it completes, then existing re-verification rules still apply.
- Given the branch is already current or mergeable, when integration runs twice, then both runs
  preserve history and neither invalidates any gate.

### Done When
- [ ] Already-current and mergeable-skip outcomes do not invalidate downstream verdicts.
- [ ] Loop proceeds to finish without re-running downstream gates on either safe-skip outcome.
- [ ] Test: mergeable skip → zero gate invalidations → finish with unchanged commit SHAs.

---

## Story: Invalidate downstream gates on a file-changing clean rebase

**Requirement:** FR-5

> **Amended 2026-07-08** by `adr-2026-07-08-post-rebase-gate-first-mechanical-reverify`
> (issue #420): the `build` verdict write is now conditional — the gate's mechanical
> completion predicate is evaluated against the rebased tree first, and `satisfied:false`
> is written only when it fails. `build_review`/`manual_test` invalidation stays
> unconditional. The fail-closed re-verify *semantics* of this story are unchanged.

As the daemon, I want a clean rebase that **changed files** to invalidate the downstream gates
the same way a kickback does, so that I never open a PR that was verified against the old base.

### Acceptance Criteria

#### Happy Path
- Given a clean rebase whose post-rebase worktree tree differs from the pre-rebase tree **in
  code/test paths**, when the rebase completes, then the daemon writes `satisfied:false`
  (kickback-shaped) verdicts for `build` (and `manual_test` if it ran) via the existing verdict
  mechanism.
- Given those gates are invalidated, when the selector runs, then it routes back to `build`
  before `finish`.

#### Negative Paths
- Given a file-changing rebase, when invalidation is written, then it uses the **existing**
  verdict/kickback path (not a new bespoke flag) — the selector treats it identically to any
  other external invalidation.
- Given `manual_test` was auto-skipped for this feature, when a file-changing rebase occurs, then
  only the gates that actually ran are invalidated; the skipped gate is not spuriously required.
- Given a rebase that changed **only docs/non-code paths** (e.g. a `CHANGELOG.md`-only change,
  including the FR-7 auto-resolution), when the rebase completes, then build/manual_test are
  **not** invalidated — the invalidation trigger is a change to **code/test paths**, not any
  file change. (Resolves the FR-5 × FR-7 overlap: auto-resolving CHANGELOG must not force a
  full re-verify.)

### Done When
- [ ] Pre/post-rebase tree comparison drives invalidation (changed → invalidate, unchanged → not).
- [ ] Invalidation is recorded through the existing gate-verdict kickback mechanism.
- [ ] Test: file-changing rebase → build verdict becomes unsatisfied → selector returns to build.

---

## Story: Re-verify through the normal loop; HALT only if stuck

**Requirement:** FR-6

As the daemon, I want post-rebase re-verification to run through the normal retry/autoheal loop,
so that a simple post-rebase break can self-heal and only a genuinely stuck loop parks a human.

### Acceptance Criteria

#### Happy Path
- Given a file-changing rebase invalidated `build`, when re-verification runs and build passes on
  the new base, then the loop proceeds to `finish` and opens the PR.
- Given a post-rebase break that autoheal/retry can fix, when the loop re-runs build, then it
  self-heals within the existing retry budget and proceeds — no HALT.

#### Negative Paths
- Given build keeps failing on the new base, when the loop re-selects the same gate up to the
  existing `MAX_GATE_SELECTIONS` threshold, then `.pipeline/HALT` is written via the **existing**
  stuck-loop path — there is **no** special-case immediate-HALT for post-rebase failure.
- Given a post-rebase failure, when it occurs, then it is **not** parked on the first failure;
  the normal retry/anti-oscillation machinery governs when HALT happens.

### Done When
- [ ] Post-rebase failure flows through the existing kickback re-verify path, not a new branch.
- [ ] HALT on post-rebase failure occurs only via the existing anti-oscillation threshold.
- [ ] Test: post-rebase build fails N times → existing stuck-loop HALT (not first-failure HALT).

---

## Story: Auto-resolve a CHANGELOG.md conflict safely

**Requirement:** FR-7

As the daemon, I want to auto-resolve the known CHANGELOG `[Unreleased]` conflict by keeping the
base's merged entries and re-appending **only this feature's** lines, so that the expected
parallel-worktree collision never parks a human or loses entries.

### Acceptance Criteria

#### Happy Path
- Given a rebase conflict **only** in `CHANGELOG.md`, when the daemon resolves it, then the
  resolved file = the base/upstream version (containing other features' merged `[Unreleased]`
  entries) **plus** this feature's own `[Unreleased]` additions (captured from `base..HEAD`
  before rebase), and the rebase continues.
- Given resolution completes, when finish runs, then the PR's CHANGELOG contains both the
  sibling features' entries **and** this feature's entries, each exactly once.

#### Negative Paths (dedup / data-integrity analysis)
- Given this feature's `[Unreleased]` lines, when re-appended, then they appear **exactly once**
  (no duplicated block — false negative) and are **not dropped** (false positive).
- Given other features already merged their `[Unreleased]` lines to the base, when this feature's
  CHANGELOG is resolved, then **no sibling entry is lost or overwritten**.
- Given the conflict spans `CHANGELOG.md` **and** another file, when the daemon evaluates it, then
  it does **not** auto-resolve — the presence of any non-CHANGELOG conflict forces the HALT path
  (FR-8); the CHANGELOG auto-resolver applies only when CHANGELOG is the sole conflict.
- Given the CHANGELOG conflict is structurally outside the `[Unreleased]` block (e.g. a released
  section diverged), when the safe append cannot be applied, then the daemon HALTs rather than
  guessing.
- Given a successful CHANGELOG auto-resolution (a docs-only change), when the rebase completes,
  then it does **not** trigger FR-5 build re-verification (see FR-5 docs-only exclusion).

### Done When
- [ ] CHANGELOG-only conflict resolves to base-entries + this-feature-entries, no dup, no loss.
- [ ] Auto-resolution is skipped when any non-CHANGELOG file also conflicts.
- [ ] A CHANGELOG-only auto-resolution does not invalidate build/manual_test.
- [ ] Test: concurrent-feature CHANGELOG collision → both entries present exactly once → rebase
      continues to finish.

---

## Story: HALT (worktree kept, rebase paused) on any non-CHANGELOG conflict

**Requirement:** FR-8 *(edge)*

As the daemon, I want any non-trivial conflict to park for a human with full context, so that I
never auto-resolve a merge that needs human judgment and never hand over a corrupted branch.

### Acceptance Criteria

#### Happy Path (of the failure mode)
- Given a rebase conflict in a non-CHANGELOG file, when the daemon detects it, then it writes
  `.pipeline/HALT` with a note that lists the conflicted files and the resume procedure (resolve
  → `git rebase --continue` → clear HALT → re-queue).
- Given the HALT is written, when the daemon parks the feature, then the worktree is **kept** and
  the rebase is **left paused in its conflicted state** (conflict markers intact in the files).

#### Negative Paths
- Given a non-CHANGELOG conflict, when the daemon parks, then it does **not** run
  `git rebase --abort`, does **not** auto-resolve, does **not** mark the feature processed, and
  does **not** open a PR.
- Given a conflict in both CHANGELOG and a source file, when evaluated, then the daemon takes the
  HALT path (no partial auto-resolution of CHANGELOG that would mask the real conflict).

### Done When
- [ ] Non-CHANGELOG conflict → `.pipeline/HALT` exists with conflicted-file list + resume steps.
- [ ] Worktree remains on disk with the rebase paused (`git status` shows rebase-in-progress).
- [ ] Feature is not marked processed and no `pr_url` is set.
- [ ] Test: source-file conflict → HALT + worktree kept + rebase paused + no PR.

---

## Story: A parked feature resumes to a clean PR after the human resolves

**Requirement:** FR-9 *(edge)*

As the operator, I want to resolve a parked conflict and re-queue, so that the daemon converges
the feature to a clean, rebased PR without redoing the whole feature.

### Acceptance Criteria

#### Happy Path
- Given a HALTed worktree where I have resolved the conflict, run `git rebase --continue`, and
  cleared `.pipeline/HALT`, when I re-queue and the daemon runs, then it reuses the existing
  worktree, finds the rebase a **no-op** (already on the new base), re-verifies only if needed,
  and opens the PR.

#### Negative Paths
- Given I cleared `.pipeline/HALT` but did **not** finish the rebase (rebase still in progress),
  when the daemon re-runs, then it does **not** open a PR on a half-rebased branch — it detects
  the in-progress/unsatisfied state and re-parks (HALT) rather than shipping a broken branch.
- Given I re-queue a still-HALTed worktree (HALT not cleared), when the daemon scans, then it
  leaves the feature parked and does not pick it up.

### Done When
- [ ] Re-invocation on a resolved+continued+HALT-cleared worktree converges to a PR.
- [ ] Re-invocation on an un-resolved or still-HALTed worktree does not open a PR.
- [ ] Test: simulate resolve→continue→clear-HALT→re-queue → daemon reaches finish/PR.

---

## Story: Emit structured rebase-outcome events

**Requirement:** FR-10

As the operator, I want rebase outcomes recorded in the event log, so that `conduct --report`
and the future 9.1 retro signal can observe how often rebases are clean, changed files,
auto-resolved, or HALTed.

### Acceptance Criteria

#### Happy Path
- Given the rebase step runs, when it completes, then it appends a structured outcome event to
  `.pipeline/events.jsonl` distinguishing at least: `no-op/clean`, `changed-files`,
  `changelog-auto-resolved`, and `conflict-halt`.
- Given a conflict HALT, when the event is written, then it includes the HALT reason and the
  conflicted-file context.

#### Negative Paths
- Given event emission, when it occurs, then it uses the **existing** `ConductorEvent`/event-log
  mechanism (consistent shape with current events) — not an ad-hoc separate log file.
- Given the event log is unavailable/unwritable, when the rebase runs, then the rebase outcome
  (clean/HALT) is unaffected — event emission is best-effort and never blocks correctness.

### Done When
- [ ] Each rebase outcome appends a typed event consumable by the existing report renderer.
- [ ] Conflict-HALT event carries reason + conflicted files.
- [ ] Test: each outcome path emits its corresponding event line.
