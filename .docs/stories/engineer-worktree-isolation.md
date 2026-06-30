**Status:** Accepted

# Stories: Engineer Worktree Isolation

Source PRD: `.docs/specs/2026-06-30-engineer-worktree-isolation.md` (tier L).
Every story traces to an `FR-N`. Roles: **operator** (drives the engineer), **engineer** (the
host-agent skill + its deterministic primitives), **daemon** (concurrent non-human actor).

---

## Story: Author each idea in a dedicated per-idea worktree

**Requirement:** FR-1

As the engineer, I want to author an idea's full DECIDE artifact set inside a dedicated worktree
of the target repo so that the target's primary working tree is never used as the authoring
surface.

### Acceptance Criteria

#### Happy Path
- Given a routed target repo with at least one commit, when the engineer begins DECIDE for an
  idea with slug `<slug>`, then a worktree is created for that idea checked out on a fresh
  `spec/<slug>` branch based on the repo's default branch.
- Given the per-idea worktree exists, when the DECIDE skills run, then every `.docs/` artifact
  they write lands **inside that worktree**, and the working directory used for authoring is the
  worktree path (never the target's canonical/primary path).

#### Negative Paths
- Given the target repo's default branch cannot be derived (detached/unborn HEAD), when the
  engineer attempts worktree creation, then it does not guess a branch name and instead surfaces
  the failure (see FR-7 strict-abort), making no artifact writes anywhere.
- Given a `spec/<slug>` branch already exists from a prior run, when the engineer creates the
  worktree, then it resolves the collision deterministically (see FR-11) rather than failing
  opaquely or silently reusing stale artifacts.

### Done When
- [ ] A `git worktree list` for the target shows a per-idea worktree on `spec/<slug>` during DECIDE
- [ ] Authoring writes are observed under the worktree path, and zero writes occur under the
      target's primary working tree
- [ ] The branch base is the repo's derived default branch, not a hardcoded `main`/`master`

---

## Story: The target's primary working tree is left untouched

**Requirement:** FR-2

As the operator, I want the engineer to never disturb my target repo's primary checkout so that
whatever I (or a daemon) had checked out there is exactly as I left it.

### Acceptance Criteria

#### Happy Path
- Given the primary working tree is on branch `B` with working state `S` before the engineer
  runs, when a full author→land→handoff cycle completes, then the primary tree is still on branch
  `B` and is no dirtier than state `S`.
- Given the engineer runs, when it creates/uses/removes the per-idea worktree, then it never
  issues `git checkout`/`git switch` against the primary working tree.

#### Negative Paths
- Given the primary working tree is **dirty** (uncommitted changes) before the engineer runs,
  when a full cycle completes, then those uncommitted changes are still present and unmodified
  (the engineer's isolation does not depend on, or disturb, primary-tree cleanliness).
- Given `land` fails midway, when control returns, then the primary tree's branch and contents are
  still `B`/`S` (no checkout was left dangling on the primary tree).

### Done When
- [ ] A test captures primary-tree `HEAD` ref + `git status --porcelain` before and asserts byte
      equality after a successful cycle
- [ ] The same invariant holds after a deliberately-failed `land`
- [ ] No `checkout`/`switch` argv targeting the primary tree appears in the recorded git calls

---

## Story: Commit the full tier-appropriate DECIDE set from the worktree

**Requirement:** FR-3

As the engineer, I want `land` to commit the complete DECIDE set from inside the per-idea worktree
so that the `spec/<slug>` branch carries exactly the artifacts the daemon needs.

### Acceptance Criteria

#### Happy Path
- Given a non-Small idea authored in the worktree, when `land` runs, then the commit on
  `spec/<slug>` contains `.docs/specs`, `.docs/complexity`, `.docs/stories`, `.docs/plans`,
  `.docs/conflicts`, `.docs/architecture`, and `.docs/decisions` artifacts.
- Given an intake-sourced idea, when `land` runs, then `.docs/intake/<slug>.md` carrying
  `Source-Ref: <ref>` is included in the same commit.
- Given a Small idea, when `land` runs, then the commit contains specs/complexity/stories/plans
  and the architecture/conflicts artifacts are correctly absent (tier-aware), with no guard
  false-positive.

#### Negative Paths
- Given a non-Small idea missing its architecture artifacts, when `land` runs, then it rejects
  with a tier/artifact-mismatch error and creates no commit (existing guard preserved, now
  evaluated against the worktree contents).
- Given any artifact is a stub/empty/`Status: DRAFT`/DRAFT-ADR, when `land` runs, then it rejects
  per the existing AuthoringGuard rules — now enforced on the worktree's `.docs/` prefix.
- Given an artifact path resolves outside the worktree's `.docs/` prefix, when `land` runs, then
  AuthoringGuard rejects it (no out-of-tree writes).

### Done When
- [ ] The `spec/<slug>` commit's file list matches the tier's required set (asserted for S and L)
- [ ] Mismatch/stub/DRAFT/DRAFT-ADR inputs each produce a rejection and zero commit
- [ ] The intake marker is present and carries the correct `Source-Ref`

---

## Story: Spec PR (and no-remote fallback) output is unchanged

**Requirement:** FR-4

As the operator, I want the delivered result to look identical to today so that worktree isolation
is invisible to me except that it no longer conflicts.

### Acceptance Criteria

#### Happy Path
- Given a target with a remote, when `handoff` runs from the worktree, then a spec PR is opened
  for `spec/<slug>` and its URL is reported, the authored-ledger entry is recorded, and
  `ensureRunning(repoPath)` is nudged fire-and-forget — same as the pre-isolation flow.
- Given an intake-sourced idea, when `handoff` runs, then the originating issue gets the PR-URL
  comment, the `Refs <ref>` non-closing link, the `engineer:handled` label, and the ledger
  advances to `done`.

#### Negative Paths
- Given the target has **no remote**, when `handoff` runs, then the local-commit fallback applies:
  the spec is committed on `spec/<slug>` (work preserved) and the authored-ledger key is still
  recorded — the alternate (offline) branch must NOT bypass the ledger write (invariant
  side-effect on alternate branch).
- Given `gh pr create` returns no PR URL, when `handoff` parses output, then it errors clearly,
  preserves the branch/commit, and still records the authored key.
- Given the daemon nudge fails, when `handoff` completes, then the spec PR result is still reported
  (the nudge is fire-and-forget and never blocks delivery).

### Done When
- [ ] Recorded `gh pr create` argv + cwd point at the worktree and produce the same reported PR URL
- [ ] No-remote path leaves a reachable `spec/<slug>` commit AND a recorded authored-ledger entry
- [ ] Intake write-back (comment, Refs, label, ledger→done) matches the pre-isolation behavior

---

## Story: Remove the worktree on success

**Requirement:** FR-5

As the operator, I want a successful delivery to leave no leftover worktree so that my repo's tree
stays clean across many ideas.

### Acceptance Criteria

#### Happy Path
- Given a full author→land→handoff cycle succeeds, when handoff returns, then the per-idea
  worktree is removed and `git worktree list` no longer shows it.
- Given the worktree is removed on success, when I inspect the repo, then the `spec/<slug>` branch
  and its commit still exist and are reachable.

#### Negative Paths
- Given the target has no remote (local-commit fallback) and the cycle otherwise succeeds, when
  the worktree is removed, then the local-only `spec/<slug>` commit is still reachable (removing a
  worktree must not orphan its branch commit).
- Given worktree removal itself fails (e.g., filesystem lock), when handoff returns, then the
  failure is reported (not swallowed) and the delivered spec PR result is still surfaced.

### Done When
- [ ] After a successful remote cycle, the worktree dir is gone and `spec/<slug>` is reachable
- [ ] After a successful no-remote cycle, the local `spec/<slug>` commit is reachable post-removal
- [ ] A removal failure is reported rather than silently ignored

---

## Story: Keep the worktree on failure

**Requirement:** FR-6

As the operator, I want a failed authoring/land/handoff to leave its worktree behind so that I can
inspect the half-finished `.docs/`.

### Acceptance Criteria

#### Happy Path
- Given `land` fails (e.g., guard rejection), when control returns, then the per-idea worktree is
  still present with its in-progress `.docs/` contents intact.
- Given `handoff` fails after a successful `land`, when control returns, then the worktree is still
  present and the `spec/<slug>` commit is preserved.

#### Negative Paths
- Given authoring fails before `land`, when control returns, then the worktree is retained (not
  removed) and the primary tree remains untouched (FR-2 still holds).
- Given a failure occurs, when the worktree is retained, then the operator is told where it is
  (path reported) so retention is actionable, not silent clutter.

### Done When
- [ ] A forced `land` failure leaves the worktree on disk with its `.docs/` content
- [ ] A forced `handoff` failure leaves the worktree + `spec/<slug>` commit on disk
- [ ] The retained worktree path is reported to the operator

---

## Story: Strict abort when a worktree cannot be created

**Requirement:** FR-7

As the operator, I want the engineer to refuse the idea rather than fall back to the shared
checkout so that the isolation guarantee has no silent hole.

### Acceptance Criteria

#### Happy Path
- Given `git worktree add` fails for any reason, when the engineer detects it, then it aborts the
  idea with a clear message naming the failure and the target.

#### Negative Paths
- Given worktree creation fails, when the engineer aborts, then it makes **zero mutations** to the
  target's primary working tree — no branch created on it, no checkout, no `.docs/` written there,
  no commit.
- Given the target has **zero commits** (unborn HEAD) so a worktree cannot be based, when the
  engineer runs, then it aborts (it does NOT seed a commit and does NOT author in the primary
  tree) — matching the operator's strict-isolation decision.
- Given the abort occurs, when the operator inspects the target, then the repo is byte-for-byte
  unchanged (HEAD, refs, working tree, and `.docs/` all identical to pre-run).

### Done When
- [ ] A simulated `git worktree add` failure yields an abort with a descriptive error
- [ ] Post-abort, the target's `HEAD`, branch list, and `git status --porcelain` are identical to
      pre-run (asserted)
- [ ] The zero-commit case aborts without seeding a commit or writing to the primary tree

---

## Story: Concurrent actors on the same repo do not corrupt each other

**Requirement:** FR-8

As the operator, I want to run an engineer session while a daemon builds in the same target repo
so that the flywheel can route and build in parallel without collisions.

### Acceptance Criteria

#### Happy Path
- Given a daemon is mid-build in its own worktree of target `R`, when an engineer session authors
  and lands an idea for `R`, then both complete; neither the daemon's worktree/branch nor the
  primary tree is disturbed by the engineer.
- Given two engineer sessions author different ideas for the same repo `R` (sequentially relaunched
  per the one-idea-per-session model, but with overlapping on-disk worktrees), when both land,
  then each `spec/<slug>` commit contains only its own idea's artifacts.

#### Negative Paths
- Given two in-flight ideas exist as separate worktrees, when each `land` runs, then it commits
  **only the artifacts in its own worktree** — there is no "sweep all untracked `.docs/`" that
  could pull the other idea's files into the wrong commit (see FR-9).
- Given the primary tree is on the daemon-relevant branch, when the engineer runs end-to-end, then
  the primary tree's branch is never switched (so the daemon's assumptions about the primary tree,
  if any, hold).

### Done When
- [ ] A test with two concurrent per-idea worktrees proves each `spec/<slug>` commit is
      idea-scoped (no cross-bleed)
- [ ] A daemon-running scenario (real-git smoke or fixture) shows the engineer cycle leaves the
      daemon's worktree + the primary tree untouched

---

## Story: `land` commits only the current idea's artifacts

**Requirement:** FR-9

As the engineer, I want `land` to commit strictly the current idea's `.docs/` so that the old
sweep-all-untracked footgun is gone.

### Acceptance Criteria

#### Happy Path
- Given the per-idea worktree contains only this idea's `.docs/` artifacts, when `land` stages and
  commits, then the commit equals exactly that idea's set.

#### Negative Paths
- Given unrelated untracked files happen to exist in the worktree, when `land` stages, then it
  scopes staging to the idea's `.docs/` artifacts (it does not blindly `add -A` foreign files into
  the spec commit).
- Given a prior idea's artifacts would have been swept in under the old shared-checkout behavior,
  when `land` runs in the isolated worktree, then those foreign artifacts are absent from the
  commit (regression assertion against the documented footgun).

### Done When
- [ ] The `spec/<slug>` commit file list equals the idea's `.docs/` set exactly
- [ ] An unrelated untracked file in the worktree is not committed into the spec
- [ ] A regression test encodes the no-cross-idea-bleed guarantee

---

## Story: Sibling repos remain byte-for-byte unchanged

**Requirement:** FR-10

As the operator, I want authoring for repo `A` to never touch sibling repo `B` so that cross-repo
isolation (already a hard invariant) survives the worktree change.

### Acceptance Criteria

#### Happy Path
- Given target `A` is resolved, when a full cycle runs (including worktree create/remove), then
  every registered sibling repo `B` is byte-for-byte unchanged.

#### Negative Paths
- Given worktree paths are derived, when the engineer creates/removes a worktree, then the path is
  always inside `A`'s tree and never resolves into a sibling repo's directory.
- Given an abort (FR-7) or failure (FR-6), when control returns, then sibling repos are still
  byte-for-byte unchanged.

### Done When
- [ ] A multi-repo fixture asserts sibling `B` is unchanged after success, failure, and abort
- [ ] Worktree path resolution is asserted to stay within target `A`

---

## Story: Leftover worktree/branch from a prior failed run is handled

**Requirement:** FR-11

As the engineer, I want a retry for the same slug to proceed deterministically so that a kept
(failed-run) worktree does not block the operator.

### Acceptance Criteria

#### Happy Path
- Given a per-idea worktree and/or `spec/<slug>` branch already exist from a prior failed run, when
  the engineer retries the same idea, then it resolves the collision deterministically (reuse the
  existing worktree, or remove-and-recreate) and the chosen behavior is reported to the operator.

#### Negative Paths
- Given a leftover branch `spec/<slug>` exists but its worktree was manually deleted, when the
  engineer retries, then it reconciles the dangling branch (no opaque `git worktree add` failure)
  and proceeds or aborts with a clear message.
- Given a leftover worktree is **dirty** with prior partial artifacts, when the engineer retries,
  then it does not silently commit stale content — it either cleanly recreates or surfaces the
  state for the operator (no silent stale-artifact land).
- Given resolution requires removing a leftover worktree, when removal fails, then the engineer
  aborts with a clear message rather than proceeding on an inconsistent state.

### Done When
- [ ] A retry over an existing same-slug worktree/branch proceeds deterministically with a reported
      decision
- [ ] A dangling-branch-no-worktree case is reconciled, not failed opaquely
- [ ] A dirty leftover worktree never results in a silent stale-artifact commit
