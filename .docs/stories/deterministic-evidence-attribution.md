**Status:** Accepted

# Stories: Deterministic Build Evidence Attribution (#433)

Track: technical (no PRD — criteria derive from issue #433 + APPROVED ADR
adr-2026-07-09-deterministic-evidence-attribution-enforcement). Tier: M.

---

## Story 1: `conduct-ts task start <id>` marks the current task engine-side

As the pipeline orchestrator, I want a single CLI call that records which plan task is in
flight so that attribution no longer depends on me hand-editing JSON.

### Acceptance Criteria

#### Happy Path
- Given a build worktree whose `.pipeline/task-status.json` was seeded with plan tasks `1..N`,
  when `conduct-ts task start 7` runs in that worktree, then task 7's row becomes
  `in_progress`, `.pipeline/current-task` contains exactly `7`, and the command exits 0.
- Given task 7 was previously started, when `conduct-ts task start 8` runs, then
  `.pipeline/current-task` contains exactly `8` (overwrite, idempotent re-run safe) and task 8's
  row is `in_progress`.

#### Negative Paths
- Given the seeded id set is `1..12`, when `conduct-ts task start 99` runs, then the command
  exits non-zero, prints the valid id set in the error message, does NOT modify
  `task-status.json`, and does NOT write `.pipeline/current-task`.
- Given `.pipeline/task-status.json` is absent (build not seeded), when
  `conduct-ts task start 7` runs, then the command exits non-zero with a message naming the
  missing file and writes nothing.
- Given `.pipeline/task-status.json` contains invalid JSON, when `conduct-ts task start 7`
  runs, then the command exits non-zero without truncating or overwriting the corrupt file
  (operator can inspect it) and without writing `current-task`.
- Given two `task start` invocations race, when both complete, then `task-status.json` is a
  valid JSON document reflecting one of the two writes in full (atomic temp+rename — never a
  torn file).

### Done When
- [ ] `conduct-ts task start 7` in a seeded worktree exits 0, flips row 7 to `in_progress`,
      and `.pipeline/current-task` reads `7`.
- [ ] `conduct-ts task start 99` exits non-zero, output lists valid ids, and neither
      `task-status.json` mtime-content nor `current-task` changed.
- [ ] Unit tests cover: unknown id, missing file, corrupt JSON, overwrite, atomic write.

---

## Story 2: `conduct-ts task done <id>` clears the stamp without touching completion authority

As the pipeline orchestrator, I want to clear the in-flight stamp when a task's dispatch ends
so that later commits are never attributed to a finished task.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/current-task` contains `7`, when `conduct-ts task done 7` runs, then
  `current-task` is removed (or emptied) and the command exits 0.
- Given task 7's row is `in_progress`, when `conduct-ts task done 7` runs, then the row's
  status is NOT set to `completed` by this command — completion remains derived exclusively by
  the evidence gate (`deriveCompletion`), preserving #302's single completion authority.

#### Negative Paths
- Given `.pipeline/current-task` contains `8`, when `conduct-ts task done 7` runs, then the
  stamp for `8` is left intact, the command exits non-zero, and the mismatch is stated in the
  error (guards against a stale orchestrator clearing another dispatch's stamp).
- Given `current-task` does not exist, when `conduct-ts task done 7` runs, then the command
  exits 0 (idempotent no-op) — a double-clear must not fail a build.

### Done When
- [ ] `task done 7` after `task start 7` removes `current-task`, exits 0, and row 7 is still
      `in_progress` (not `completed`).
- [ ] `task done 7` while `current-task` is `8` exits non-zero and leaves the file intact.
- [ ] Unit tests cover: clear, mismatch, double-clear no-op, no completion stamping.

---

## Story 3: Engine clears a stale stamp at build entry

As the daemon, I want any leftover `current-task` from a crashed prior dispatch removed when a
build (re)starts so that the first commits of a resumed build are never mis-attributed.

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/current-task` contains `5` from a crashed run, when the build step enters
  (task-status seeding time), then `current-task` is removed before any dispatch occurs.

#### Negative Paths
- Given `current-task` is absent at build entry, when seeding runs, then seeding proceeds
  unchanged (no error, no file created).
- Given `current-task` cannot be removed (e.g. permission anomaly), when seeding runs, then the
  failure is logged and the build still proceeds — the commit-msg validation hook remains the
  unconditional backstop (fail-open, never blocks provisioning or build entry).

### Done When
- [ ] Seed-time clear covered by a unit test (stale file removed; absent file tolerated).
- [ ] Removal failure logs and does not throw.

---

## Story 4: `prepare-commit-msg` auto-stamps the `Task:` trailer

As a build subagent, I want my commits trailered automatically from engine state so that a
correct commit no longer depends on me remembering trailer grammar (kills #433 Case 1).

### Acceptance Criteria

#### Happy Path
- Given `.pipeline/current-task` contains `7`, when a commit is made with message
  `feat: add waker retry` (no trailer), then the landed commit message carries trailer
  `Task: 7` appended via `git interpret-trailers`.
- Given the message already contains `Task: 9`, when the commit is made, then the message is
  unchanged (existing trailers are never overwritten).
- ~~Given `current-task` is absent but exactly one `task-status.json` row is `in_progress`, when
  an untrailered commit is made, then that row's id is stamped (fallback path).~~
  **SUPERSEDED (2026-07-11, #519):** the unique-in_progress fallback is removed by
  `adr-2026-07-11-attribution-abstain-or-loud` — with `current-task` absent the hook abstains
  unconditionally (the fallback proved to be a silent guesser that inherits stale state). See
  `engine-invoked-task-attribution-494-freezes-curren.md` Story 3.

#### Negative Paths
- Given `current-task` is absent and zero (or two or more) rows are `in_progress`, when an
  untrailered commit is made, then the hook abstains — message unchanged, commit not blocked
  (a wrong stamp is worse than no stamp; validation still applies).
- Given a rebase is in progress (`rebase-merge`/`rebase-apply` directory exists), when commits
  are replayed, then the hook abstains — replayed history is never restamped with the current
  task id.
- Given `git commit --amend` (hook source arg = `commit`), when the hook runs, then it abstains
  — amending an old commit must not re-attribute it.
- Given `task-status.json` is corrupt JSON, when the fallback path is consulted, then the hook
  abstains cleanly (exit 0, message unchanged) — a broken sidecar must never block commits.

> **Scope note (2026-07-10, #505):** the abstain scenarios above describe `prepare-commit-msg`
> (the STAMPING hook) and remain authoritative for it: it never blocks. Whether the resulting
> untrailered commit ultimately *lands* is now conditional — when attribution enforcement is
> active (`attribution_enforcement_cutover` passed AND `.pipeline/build-step-active` present),
> `commit-msg` rejects an untrailered non-empty commit per
> `adr-2026-07-10-inline-work-attribution-enforcement` (Surface A). With enforcement inactive
> (the default), behavior is exactly as written here.

### Done When
- [ ] In a hook-wired test worktree: untrailered commit gains `Task: 7`; pre-trailered commit
      unchanged; ~~fallback stamps unique `in_progress`~~ (superseded 2026-07-11, #519: absent
      stamp abstains regardless of `in_progress` rows); 0-and-2-in_progress abstains; amend and
      rebase abstain; corrupt JSON abstains.
- [ ] Hook is pure bash + node stdlib only — `grep -c` proves no invocation of the worktree's
      `src/conductor/dist` (#403 class).

---

## Story 5: `commit-msg` rejects bad attribution at commit time

As the harness operator, I want malformed attribution rejected the moment it is created so that
it surfaces to the agent immediately instead of as a gate HALT hours later (kills #433 Case 2
and the #417 unknown-id class).

### Acceptance Criteria

#### Happy Path
- Given the seeded id set `1..12`, when a commit with trailer `Task: 7` and a non-empty diff is
  made, then the commit lands (exit 0).
- Given an empty commit whose message carries `Task: 7` AND `Evidence: satisfied-by <sha>`
  where `<sha>` resolves to an existing commit, then the commit lands.

#### Negative Paths
- Given the seeded id set `1..12`, when a commit with trailer `Task: 99` (or `Task: task-7`) is
  attempted, then the hook exits non-zero and the error names the offending id and the valid id
  set — the commit does not land.
- Given an empty commit (`--allow-empty`) with only a bare `Task: 7` trailer, when it is
  attempted, then the hook rejects it with a message showing the required
  `Evidence: satisfied-by <sha>` form (the exact self-repair the agent in Case 2 attempted).
- Given an empty commit with `Evidence: satisfied-by deadbeef` where `deadbeef` is not an
  existing commit in the repository, when it is attempted, then the hook rejects it (an
  evidence pointer must point at real history).
- Given a staged diff that touches files mapped to two different plan tasks, when the commit is
  made, then the hook prints a bundling WARNING to stderr but exits 0 — bundling detection is
  advisory only, never blocking (#433 concedes this is not fully mechanical).
- Given a commit whose subject references `Task 5` (or `task-5`) while the `Task:` trailer id is
  `7`, when the commit is made, then the hook prints a subject-vs-trailer mismatch WARNING to
  stderr but exits 0 — keeps the #418 mismatch visible under auto-stamp without blocking
  (conflict-check resolution 2026-07-09).
- Given a commit with no `Task:` trailer at all and a non-empty diff, when it is attempted,
  then the hook does not reject it (absence stays a gate concern; the auto-stamp hook is the
  fix for absence) — no new failure mode is introduced for legacy flows.

### Done When
- [ ] In a hook-wired test worktree: valid trailer lands; unknown id rejected; bare-trailer
      empty commit rejected; valid `satisfied-by` empty commit lands; dangling
      `satisfied-by` sha rejected; bundling warns without blocking; untrailered non-empty
      commit passes.
- [ ] Every rejection message names the file/state that proves the violation and the exact
      corrective form.

---

## Story 6: `prepareWorktree` wires the hooks per-worktree, isolated and fail-open

As the daemon, I want hook wiring to happen mechanically at worktree provisioning so that every
daemon build — in this repo or any consumer repo — gets enforcement without any repo carrying
harness files, and the operator's primary checkout is never affected.

### Acceptance Criteria

#### Happy Path
- Given a fresh build worktree is provisioned, when `prepareWorktree` completes, then the two
  hook scripts exist executable under the worktree-local gitignored hooks dir
  (`.pipeline/git-hooks/`), `extensions.worktreeConfig` is `true`, and the **worktree-scoped**
  `core.hooksPath` points at that dir (absolute path).
- Given the wiring above, when `git config core.hooksPath` is read in the repository's primary
  checkout, then it is unset — operator commits outside build worktrees see no hooks.
- Given the consumer repo has its own `$GIT_COMMON_DIR/hooks/commit-msg` (e.g. husky), when a
  commit is made in the build worktree, then our hook runs AND the repo's own hook is chained
  with the same arguments, and a non-zero exit from the chained hook fails the commit.

#### Negative Paths
- Given the installed git predates worktree-scoped config (< 2.20) or `git config --worktree`
  fails, when `prepareWorktree` runs, then hook wiring is SKIPPED, a daemon-log line records
  the skip and its reason, and provisioning succeeds — enforcement is fail-open, never a
  provisioning blocker.
- Given the hook asset copy fails (e.g. missing asset in the engine package), when
  `prepareWorktree` runs, then the same fail-open + logged-skip behavior applies.
- Given hooks were wired, when `bin/setup` and the rest of provisioning run, then they complete
  unchanged — wiring must not disturb the existing namespace/setup contract.

### Done When
- [ ] Integration test: provisioned worktree has executable hooks, worktree-scoped
      `hooksPath`; primary checkout config unset; chained common hook runs and can veto.
- [ ] Fail-open paths (old git, copy failure) covered by tests asserting the logged skip and
      successful provisioning.
- [ ] Hook scripts ship as assets of the engine package (present in the published dist) and are
      copied — no reference into the harness checkout survives provisioning (#363 class).

---

## Story 7: Pipeline SKILL step 0 delegates to the CLI

> **SUPERSEDED (2026-07-10, #477):** the orchestrator-invokes-the-CLI contract below is
> superseded by `adr-2026-07-10-session-hook-task-stamping` — engine-installed session hooks
> now perform the stamp/flip mechanically at subagent dispatch, and SKILL.md step 0 becomes
> documentation of that machinery plus the line-1 `Task: <id>` / `Task: none` dispatch-prompt
> contract. The CLI itself remains (operator/recovery use). See
> `.docs/stories/engine-must-invoke-task-start-done-at-subagent-dis.md` Story 7.

As the harness maintainer, I want the pipeline orchestrator's task bookkeeping reduced to one
deterministic CLI call so that the last hand-edited attribution surface disappears.

### Acceptance Criteria

#### Happy Path
- Given `skills/pipeline/SKILL.md`, when step 0 is read, then it instructs
  `conduct-ts task start <id>` before dispatch and `conduct-ts task done <id>` after the task's
  commit lands, and no longer instructs hand-editing `task-status.json` for the in-flight flip.

#### Negative Paths
- Given the orchestrator forgets the `task start` call entirely, when the build proceeds, then
  the task never reaches `in_progress` and the existing forward-progress check trips — the
  omission is self-announcing, not silent (documented in the SKILL so the failure is
  understood).
- Given the SKILL text change, when `test/test_harness_integrity.sh` runs, then all checks pass
  (frontmatter, cross-references, model table unchanged).

### Done When
- [ ] SKILL.md step 0 names the CLI calls; no instruction to hand-edit `task-status.json`
      remains for the in-flight transition.
- [ ] Harness integrity suite passes.
- [ ] `src/conductor/README.md` + root `README.md` document the `conduct-ts task` subcommand
      (docs-track-features rule).
