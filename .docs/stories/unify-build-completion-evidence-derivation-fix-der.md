**Status:** Accepted

# Stories: Unified Build-Completion Evidence Derivation (#456 + #463)

Technical track — acceptance criteria derive from
`adr-2026-07-10-evidence-range-anchor-resolution` and
`adr-2026-07-10-retire-migration-grandfather` (both APPROVED). Refs
jstoup111/ai-conductor#456, jstoup111/ai-conductor#463.

## Story: No-anchor derivation anchors at the branch base, never the repo genesis

As the conductor engine, I want `deriveCompletion` with no explicit anchor to evaluate only the
feature branch's own commits so that foreign history can never corroborate or stamp this plan's
tasks.

### Acceptance Criteria

#### Happy Path
- Given a feature branch with N commits since its base on the origin default branch, when
  `deriveCompletion(root, planPath)` is called with no anchor, then the evidence range contains
  exactly those N commits and no commit reachable from the branch base.
- Given a branch commit carrying a valid `Task: 2` trailer whose paths corroborate the plan, when
  derivation runs with no anchor, then task 2 receives an `evidenceStamps` entry citing that SHA.

#### Negative Paths
- Given a commit on the default branch BEFORE the branch base that carries `Task: 2` with paths
  overlapping the plan's task-2 paths, when no-anchor derivation runs, then that commit is absent
  from the evidence range and task 2 gets no stamp from it (regression test for the #456 poisoned
  range — e.g. the `ce77676` scenario).
- Given any repository state, when no-anchor derivation resolves its range, then the repo's
  genesis commit is never selected as the anchor (the reversed-`git log` fallback is deleted, not
  merely bypassed).
- Given an explicit `anchorArg` that is reachable, when derivation runs, then that anchor is used
  verbatim (existing explicit-caller behavior unchanged).

### Done When
- [ ] The genesis-computing block in `deriveCompletion` (`autoheal.ts:704-724`) is removed;
      no-anchor calls delegate anchor resolution to `getEvidenceRange`.
- [ ] A test builds a repo with a pre-base commit carrying a coincidental matching `Task: N`
      trailer + overlapping paths and asserts it neither corroborates nor stamps.
- [ ] A test asserts the derived range for a no-anchor call equals `«merge-base»..HEAD`.

## Story: Anchor resolution ladder is deterministic and fail-closed

As the conductor engine, I want one anchor-resolution ladder inside `getEvidenceRange` so that
every completion verdict uses the same range under every git topology.

### Acceptance Criteria

#### Happy Path
- Given a reachable explicit anchor, when `getEvidenceRange` runs, then the range is
  `«anchor»..HEAD` (rung 1).
- Given no/unreachable anchor and a repo where `merge-base --fork-point` succeeds, when the range
  is resolved, then the fork-point result is the lower bound (rung 2).

#### Negative Paths
- Given a fresh worktree clone where `merge-base --fork-point origin/«default» HEAD` exits
  non-zero but plain `merge-base origin/«default» HEAD` succeeds, when the range is resolved,
  then the plain merge-base is the lower bound and no anomaly is raised (rung 3 fallthrough).
- Given a repo where the origin default branch exists but shares no merge-base with HEAD
  (unrelated histories), when the range is resolved, then zero commits are returned and an
  anomaly naming the failed resolution is logged — never an unanchored `-n 100 HEAD` window
  (rung 4 fail-closed).
- Given a repo with no origin default branch at all, when the range is resolved, then zero
  commits are returned with the existing fail-closed anomaly (behavior preserved).
- Given rung-4 zero-commit derivation feeding the build gate, when the gate evaluates a plan with
  pending tasks, then the gate fails with tasks pending (fail-closed: broken range can never
  produce false completion).

### Done When
- [ ] `getEvidenceRange` implements rungs 1-4 exactly; the `-n 100 HEAD` no-lower-bound path is
      removed.
- [ ] Tests cover each rung, including the fork-point-fails/plain-merge-base-succeeds case and
      the unrelated-histories case asserting zero commits + anomaly.

## Story: Evidence-range git refs derive the origin default branch

As an operator whose repos may not use `main`, I want the evidence machinery to derive origin's
default branch so that derivation works on any default-branch name.

### Acceptance Criteria

#### Happy Path
- Given a repo whose origin default branch is `master` (or any non-`main` name), when
  `getEvidenceRange` and `listCommits` resolve their base, then they use
  `origin/«derived-default»` and derivation succeeds.

#### Negative Paths
- Given a repo where `refs/remotes/origin/HEAD` is unset and the helper's fallbacks cannot
  determine a default branch, when the range is resolved, then the fail-closed zero-commit path
  is taken with a logged anomaly (never a silent guess of `main`).
- Given a repo with no remote at all, when `listCommits` runs, then it degrades exactly as today
  (bounded local log) and `getEvidenceRange` returns zero commits — no crash, no throw.

### Done When
- [ ] Hardcoded `origin/main` is gone from `getEvidenceRange` (both occurrences) and
      `listCommits`; both use the shared default-branch helper.
- [ ] A test with a `master`-defaulted origin passes derivation end-to-end.

## Story: First seed never grandfathers terminal rows

As the build gate, I want `seedTaskStatus` to stop stamping `migrationGrandfather` so that a
terminal row present before the sidecar exists is never converted into evidence.

### Acceptance Criteria

#### Happy Path
- Given a worktree with `task-status.json` rows marked `completed` and NO
  `.pipeline/task-evidence.json`, when `seedTaskStatus` runs its first seed, then the resulting
  sidecar contains an empty `migrationGrandfather` and those rows are demoted-or-pending unless
  commit-derived evidence stamps them.

#### Negative Paths
- Given an agent forges `completed` rows for tasks 2,4-7,11-13,16 with zero commits and deletes
  the sidecar, when seed + gate evaluation run, then all forged ids remain unresolved and the
  build gate fails listing them as pending (regression test for the #463 incident shape).
- Given a legitimate task whose commit evidence exists on the branch, when the sidecar is deleted
  and re-seeded, then derivation re-stamps it from git and the gate still counts it (no
  legitimate-work regression from retiring grandfather).

### Done When
- [ ] `task-seed.ts` first-seed grandfather stamping (lines ~151-166) is removed.
- [ ] The two scenarios above exist as tests and pass.

## Story: The gate resolves tasks by evidence stamps only

As the build gate, I want `migrationGrandfather` acceptance removed from task resolution so that
a git-derived evidence stamp is the only way a task counts.

### Acceptance Criteria

#### Happy Path
- Given a plan task with an `evidenceStamps` entry, when the build gate evaluates, then the task
  counts as resolved regardless of the row's on-disk status (existing behavior preserved).

#### Negative Paths
- Given a sidecar whose `migrationGrandfather` contains task ids (legacy file) and rows marked
  `completed` for those ids with no stamps, when the gate evaluates, then those tasks are
  UNRESOLVED and the gate fails — legacy grandfather entries are inert on read.
- Given a legacy sidecar containing the `migrationGrandfather` field, when `createTaskEvidence`
  loads it, then loading succeeds without error (parse tolerance — no crash on old files).

### Done When
- [ ] Grandfather acceptance is removed from the gate resolution in `artifacts.ts`
      (the `migrationGrandfather` + terminal-row clause).
- [ ] A test with a hand-written legacy sidecar (stamps empty, grandfather populated, rows
      completed) asserts gate failure and clean load.

## Story: Build gate and post-rebase pre-verify can never disagree

As the daemon, I want the build gate, the auto-heal hook, and the post-rebase pre-verify to share
one predicate, one anchor rule, and one evidence currency so that the #463 halt/rekick loop
cannot form.

### Acceptance Criteria

#### Happy Path
- Given a feature whose plan tasks all carry commit-derived evidence, when the build gate passes
  and a file-changing rebase then triggers `preVerify('build')`, then the pre-verify also passes
  and the build verdict is re-written as `re-verified` (no kickback).

#### Negative Paths
- Given evidence-less `completed` rows that would previously ride grandfather or a poisoned
  range, when the build gate evaluates, then it FAILS — the divergence is removed at the first
  gate, not first exposed post-rebase.
- Given the build gate failed for evidence-less tasks, when retries exhaust and the daemon
  halts, then a subsequent identical evidence-less flip cycle produces the identical failing
  verdict (deterministic: same inputs → same verdict → no oscillation between pass and reset).
- Given a rebase that pulls new default-branch commits carrying coincidental `Task: N` trailers
  with overlapping paths, when `preVerify('build')` re-derives, then those new commits are
  outside `«merge-base»..HEAD` and do not alter any task's resolution.

### Done When
- [ ] An integration test drives build-gate-pass → file-changing rebase → pre-verify and asserts
      verdict agreement in both the all-evidence and no-evidence cases.
- [ ] An integration test reproduces the #463 shape (forged flips, zero commits) and asserts the
      build gate fails at the FIRST evaluation — the halt/rekick loop cannot start.
