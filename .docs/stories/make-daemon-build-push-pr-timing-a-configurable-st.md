**Status:** Accepted

# Stories: Configurable push/PR timing (`pr_timing`)

Technical track — acceptance criteria derived from jstoup111/ai-conductor#199 plus the
APPROVED ADRs: adr-2026-07-03-pr-timing-config-key,
adr-2026-07-03-post-rebase-force-with-lease,
adr-2026-07-03-engineer-checkpoint-commits-idempotent-land.

---

## Story: `pr_timing` config key — fail-closed validation, inert default

**Requirement:** TS-1 (adr-2026-07-03-pr-timing-config-key)

As an operator, I want a `pr_timing` key in `.ai-conductor/config.yml` so that each project
chooses when branches are pushed and PRs opened, with today's behavior as the untouched default.

### Acceptance Criteria

#### Happy Path
- Given a project config with no `pr_timing` key, when config loads and `resolvePrTiming()`
  runs, then it returns `finish` and both publish flows behave byte-identically to today.
- Given `pr_timing: finish`, when config loads, then validation passes and the resolver
  returns `finish`.
- Given `pr_timing: early-draft`, when config loads, then validation passes and the
  resolver returns `early-draft`.

#### Negative Paths
- Given `pr_timing: eary-draft` (typo), when `loadConfig()` runs, then it returns
  `{ ok: false }` with an error naming the key, the offending value, and the two valid
  values — the daemon refuses to start rather than silently picking a mode.
- Given `pr_timing: 3` (non-string), when `loadConfig()` runs, then config load is
  rejected with a type error naming the key.
- Given a config that omits `pr_timing` on a daemon already running merged specs, when a
  build executes, then no early push occurs, no draft PR is created, and the only
  push/PR-create happens in the finish step's `/finish` skill — verified by injected-runner
  call capture recording zero publish invocations before finish.
- Given `pr_timing: early-draft` and the SelfHostDetector identifies the build as a
  harness self-host build, when the build runs, then the effective mode is `finish`
  (zero early publishes) and exactly one loud log line states the configured value and
  the guardrail downgrade — the VersionApprovalGate's "no PR before semver approval"
  holds verbatim (adr-2026-07-03-pr-timing-self-host-precedence).

### Done When
- [ ] `pr_timing` accepted by `validateConfig` only as `finish` or `early-draft`; any other
      value fails config load with a named error (test asserts the error message)
- [ ] `resolvePrTiming(undefined | {} | { pr_timing: 'finish' })` === `'finish'`;
      `resolvePrTiming({ pr_timing: 'early-draft' })` === `'early-draft'`
- [ ] Key present in `HarnessConfig`, `knownTopLevelKeys`, and documented in
      `src/conductor/README.md` + root `README.md` + `CHANGELOG.md [Unreleased]`
- [ ] Self-host precedence test: self-host build + `early-draft` → zero early publishes +
      loud downgrade log (via the SelfHostDetector seam)
- [ ] Regression suite for both flows passes with the key absent (default-inert proof)

---

## Story: Daemon early-draft — build-start push and lazy draft PR

**Requirement:** TS-2 (adr-2026-07-03-pr-timing-config-key)

As an operator, I want the daemon to push the feature branch and open a draft PR as soon as
there is something to show so that I can watch an in-flight build remotely.

### Acceptance Criteria

#### Happy Path
- Given `pr_timing: early-draft` and a build whose feature branch has zero commits over
  base, when the build step is dispatched, then the branch is pushed (`git push -u origin`)
  and NO PR-create is attempted.
- Given the feature branch is ahead of base at a publish point, when the early publisher
  runs, then `findOrCreatePr` is called with `draft: true` exactly once across the build
  (subsequent publishes find the existing PR).

#### Negative Paths
- Given the branch has zero commits over base, when every publish point before the first
  commit fires, then zero `gh pr create` invocations occur (injected `GhRunner` capture) —
  the "no commits between" failure mode is structurally unreachable.
- Given `git push` fails (remote unreachable), when the build-start publish runs, then a
  loud log line (branch, mode, error) is emitted and the build proceeds normally — the
  step sequence and final finish publish are unaffected.
- Given `gh` is unauthenticated, when draft-PR creation fails, then the failure is logged
  loudly, no retry storm occurs (at most one attempt per publish point), and the build
  continues to finish where the load-bearing publish path applies.

### Done When
- [ ] Publish helper (`pushBranch` + lazy `findOrCreatePr({draft:true})`) lives in
      `pr-labels.ts` behind injected `GitRunner`/`GhRunner`
- [ ] Ahead-of-base gate implemented via `git rev-list --count <base>..HEAD`
- [ ] Tests: zero-commit build start → push yes / PR-create no; first ahead push → draft
      PR created once; publish failure → loud log + build continues (asserted on captured
      logger output)
- [ ] Real-binary smoke exists for the new publish argv (injected-runner tests alone
      insufficient per harness convention)

---

## Story: Daemon early-draft — step-boundary refresh pushes

**Requirement:** TS-3 (adr-2026-07-03-pr-timing-config-key, adr-2026-07-03-post-rebase-force-with-lease)

As an operator, I want the remote branch refreshed as the build progresses so that the draft
PR and CI reflect the latest committed work.

### Acceptance Criteria

#### Happy Path
- Given `pr_timing: early-draft` and a loopGate step completes with new commits, when the
  conductor advances to the next step, then a plain (non-force) push runs and the draft PR
  updates.
- Given a loopGate step completes with no new commits, when the refresh point fires, then
  no push runs (no-op detection — no redundant network calls).

#### Negative Paths
- Given the remote rejects a plain push (non-fast-forward) at a step boundary, when the
  refresh runs, then the failure is logged loudly and NO force flag of any kind is added —
  the captured `GitRunner` argv contains no `--force` or `--force-with-lease`, and the
  build continues.
- Given `pr_timing: finish`, when every step boundary fires, then zero pushes occur
  (mode gate asserted, not just absence of side effects).

### Done When
- [ ] Refresh hook wired at loopGate step completion in the conductor, gated on
      `early-draft` AND commits-ahead
- [ ] Test: rejected plain push at boundary → loud log, argv force-free, build proceeds
- [ ] Test: finish mode → zero refresh invocations across a full simulated build

---

## Story: Post-rebase remote refresh — the only force-with-lease

**Requirement:** TS-4 (adr-2026-07-03-post-rebase-force-with-lease)

As an operator, I want an early-pushed branch to survive the finish-time rebase so that the
draft PR keeps its identity and history continuity.

### Acceptance Criteria

#### Happy Path
- Given `pr_timing: early-draft`, the branch was pushed earlier, and the native rebase step
  completes successfully having rewritten history, when the post-rebase refresh runs, then
  exactly one `git push --force-with-lease` executes and the draft PR remains open with the
  rebased history.
- Given the rebase step was satisfied as a no-op (branch already current), when the
  post-rebase refresh point fires, then a plain push (or no-op) runs — no force flag.

#### Negative Paths
- Given the rebase step hits conflicts and enters a rebase-conflict HALT, when the HALT is
  taken, then zero pushes of any kind occur while the rebase is paused (captured runner
  argv asserted empty for push).
- Given the lease check fails (remote moved since the daemon's last push), when the
  force-with-lease push is rejected, then the failure is logged loudly, NO bare `--force`
  retry occurs, and the build continues to finish (terminal publish remains load-bearing).
- Given `pr_timing: finish`, when a successful rebase completes, then no push occurs at the
  post-rebase site.

### Done When
- [ ] Grep-level invariant test: `--force-with-lease` appears at exactly one call site in
      `src/conductor/src/`, and `push --force` (bare) at zero
- [ ] Tests: successful rewrite → single force-with-lease; conflict HALT → zero pushes;
      lease rejection → loud log, no bare-force, build continues
- [ ] Rebase-step tests run with `daemon: true` + isolated repo per existing convention

---

## Story: Finish-time publish in early-draft mode — mark ready, reuse PR

**Requirement:** TS-5 (adr-2026-07-03-pr-timing-config-key)

As an operator, I want the finish step to convert the draft PR to ready-for-review so that
the terminal artifact is the same reviewable PR regardless of mode.

### Acceptance Criteria

#### Happy Path
- Given an open draft implementation PR from early publishing, when the finish step runs in
  auto mode, then the existing PR is reused (no second PR), `markReadyForReview` is called,
  and `pr_url` recorded in `conduct-state.json` equals the draft PR's URL.

#### Negative Paths
- Given early publishes all failed (no PR exists), when the finish step runs, then the
  current `/finish` path creates the PR exactly as today and the build completes — the
  mode never leaves a build PR-less.
- Given `markReadyForReview` fails (gh error), when finish runs, then the failure is
  surfaced in the finish output (not swallowed), `pr_url` is still recorded, and the PR is
  left draft for the operator to flip manually — the build still completes.

### Done When
- [ ] Finish-step auto-mode prompt (or engine-native pre-step) handles mark-ready when an
      open draft PR exists for the branch
- [ ] `Closes <sourceRef>` injection (issue-ref.ts) verified to run against the REUSED
      draft PR after finish — auto-close-on-merge works identically in both modes
- [ ] Test: draft PR present → reused + marked ready, single PR total
- [ ] Test: no PR present → today's create path, byte-identical prompt in finish mode

---

## Story: Engineer early-draft — checkpoint commits and pushed authoring progress

**Requirement:** TS-6 (adr-2026-07-03-engineer-checkpoint-commits-idempotent-land)

As an operator, I want DECIDE authoring progress committed and pushed at skill boundaries so
that I can follow spec authoring from my phone and a crashed session loses nothing.

### Acceptance Criteria

#### Happy Path
- Given `pr_timing: early-draft` in the target repo AND operator identity resolved by the
  pre-DECIDE fail-fast (multi-operator slice-b Story 1), when a DECIDE skill has written
  new `.docs` artifacts in the per-idea worktree and the checkpoint helper runs, then
  exactly the new `.docs` paths are committed (scope `git add .docs`, nothing else) and
  `spec/<slug>` is plain-pushed.
- Given the first checkpoint push puts the branch ahead of base, when it completes, then a
  draft spec PR is created lazily (same lazy rule as TS-2).

#### Negative Paths
- Given a checkpoint push fails (no remote / network error), when the boundary fires, then
  a loud log is emitted and authoring continues uninterrupted — the operator is not
  prompted, the session does not abort.
- Given files outside `.docs/` are dirty in the worktree at a checkpoint, when the
  checkpoint commit runs, then those files are NOT committed (scope guard asserted on the
  resulting commit's file list).
- Given `pr_timing: finish` (or key absent) in the target repo, when every skill boundary
  passes, then zero commits and zero pushes occur before `land` — authoring is
  byte-identical to today.
- Given operator identity is UNRESOLVED in early-draft mode, when any DECIDE boundary
  fires, then zero checkpoint commits and zero pushes occur — the pre-DECIDE identity
  fail-fast has already refused the session, so no un-owned `spec/<slug>` branch, commit,
  or draft PR can ever exist (preserves multi-operator hardening Story 4's refusal
  postcondition).

### Done When
- [ ] Checkpoint helper implemented behind the `pr-labels.ts` seam, `.docs`-scoped, and
      gated behind resolved operator identity (runs strictly after the pre-DECIDE fail-fast)
- [ ] Tests: commit scope excludes non-.docs dirt; push failure → loud + non-blocking;
      finish mode → zero checkpoint activity; unresolved identity → zero checkpoint activity
- [ ] Draft spec PR lazy-creation covered by the TS-2 helper tests (shared code path)

---

## Story: Idempotent `land` — guards authoritative, commit only when needed

**Requirement:** TS-7 (adr-2026-07-03-engineer-checkpoint-commits-idempotent-land)

As an operator, I want `engineer land` to succeed when checkpoint commits already committed
the artifact set so that early-draft authoring and the land gate compose.

### Acceptance Criteria

#### Happy Path
- Given all `.docs` artifacts are already checkpoint-committed and every land guard passes,
  when `engineer land` runs, then it succeeds without creating a new commit and prints the
  same `{ slug, branch, repoPath }` JSON.
- Given some artifacts are committed and newer ones are not, when `land` runs, then it
  stages `.docs`, commits exactly the uncommitted remainder, and succeeds.

#### Negative Paths
- Given a DRAFT ADR exists in `.docs/decisions/` and all artifacts are checkpoint-committed,
  when `land` runs, then it FAILS with the DRAFT-ADR error — a checkpoint commit never
  exempts an artifact from guards.
- Given stories lack `Status: Accepted` but are checkpoint-committed, when `land` runs,
  then it fails with the acceptance error (guards read worktree state, not commit history).
- Given tracked non-.docs files are dirty, when `land` runs, then the existing
  dirty-worktree rejection fires unchanged.

### Done When
- [ ] `land-spec.ts` commit step: commit iff `git diff --cached` non-empty after
      `git add .docs`; success path defined for the nothing-to-stage case
- [ ] Negative-path tests: DRAFT ADR + fully-committed artifacts → fail; unaccepted
      stories + committed → fail; dirty non-.docs → fail (all three assert the error text)
- [ ] Existing land test suite passes unmodified in finish mode

---

## Story: Handoff — mark-ready with create fallback

**Requirement:** TS-8 (adr-2026-07-03-engineer-checkpoint-commits-idempotent-land)

As an operator, I want `engineer handoff` to finalize whatever PR state early-draft left so
that the delivered spec PR is always ready for review with write-back intact.

### Acceptance Criteria

#### Happy Path
- Given an open draft spec PR for `spec/<slug>`, when `handoff` runs, then the branch is
  pushed, `markReadyForReview` is called on that PR (no `gh pr create`), and source-ref
  write-back (issue comment, `Refs`, `engineer:handled` label, ledger advance) behaves
  exactly as today.
- Given `pr_timing: finish` (or key absent), when `handoff` runs, then behavior is
  byte-identical to today (`gh pr create --head <branch> --fill`).

#### Negative Paths
- Given early-draft mode but no draft PR exists (early pushes failed advisorily), when
  `handoff` runs, then it falls back to today's create path and succeeds — a missing draft
  never fails the handoff.
- Given `markReadyForReview` fails, when `handoff` runs, then the error is reported (not
  swallowed), the PR URL is still returned/written back, and the worktree is KEPT for
  inspection only if handoff's overall result is failure per existing keep-on-failure rule.
- Given the repo has no remote, when `handoff` runs in early-draft mode, then the existing
  local-commit fallback fires unchanged (no draft-PR machinery invoked).

### Done When
- [ ] `handoff.ts` publish path: detect open draft PR for head branch → push +
      mark-ready; else existing create path
- [ ] Tests: draft present → mark-ready + no create; draft absent → create fallback;
      no-remote → local fallback unchanged; write-back invocations identical in both modes
- [ ] Worktree remove-on-success / keep-on-failure semantics unchanged (asserted)
