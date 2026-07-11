**Status:** Accepted

# Stories: Inline Build-Work Attribution Enforcement (#505)

Technical track — acceptance criteria derive from intake jstoup111/ai-conductor#505 and
the APPROVED ADR `adr-2026-07-10-inline-work-attribution-enforcement`. Requirement tags
TS-N trace to the ADR's decision sections: TS-0 activation predicate, TS-1 surface A
(commit gate), TS-2 surface B (mutation/dispatch-shape gate), TS-3 zero-work kickback,
TS-4 provisioning/config, TS-5 verification harness.

## Story: Engine scopes enforcement with a build-step marker

**Requirement:** TS-0

As the engine, I want a `.pipeline/build-step-active` marker that exists exactly for the
duration of the build step's session, so enforcement hooks can tell "a build is active"
deterministically from inside git hooks and session hooks.

### Acceptance Criteria

#### Happy Path
- Given a daemon build reaches the build step, when the engine spawns the build session,
  then `.pipeline/build-step-active` exists in the worktree before the session's first
  tool call can run.
- Given the build step's session ends (success, failure, or thrown error), when control
  returns to the engine, then the marker is removed (removal runs in a `finally`).

#### Negative Paths
- Given a prior build crashed leaving a stale marker, when a NON-build step (plan,
  stories, finish, rebase, remediation) starts in that worktree, then the engine removes
  the stale marker at step entry before spawning the session, and the step's session can
  mutate files and commit without attribution enforcement.
- Given the engine process is killed mid-build (no `finally` ran), when the daemon
  re-enters the feature and the next step is again `build`, then the defensive
  entry-clear plus fresh write yield a correct marker state (no double-write error, no
  missing marker).
- Given an engineer worktree (`.worktrees/engineer-<slug>`), when any session runs there,
  then no build-step marker is ever written (only the daemon's build-step spawn path
  writes it) and no enforcement fires.

### Done When
- [ ] Engine test: marker exists during a (stubbed) build-step session and is absent
      immediately after, including on a session that throws.
- [ ] Engine test: stale marker present at non-build step entry is removed before spawn.
- [ ] Grep-level check: exactly one production call site writes the marker, and it is
      inside the `step.name === 'build'` spawn path.

## Story: Cutover flag gates all three surfaces off by default

**Requirement:** TS-0, TS-4

As an operator, I want enforcement gated behind `attribution_enforcement_cutover`
(ISO-8601 instant, validated like `owner_gate_cutover`), so existing repos and in-flight
builds keep today's behavior until I opt in.

### Acceptance Criteria

#### Happy Path
- Given `.ai-conductor/config.yml` sets `attribution_enforcement_cutover` to a past
  instant, when a build step runs, then surfaces A, B, and the zero-work kickback are
  active.
- Given the key is absent, when a build step runs, then all three surfaces behave
  exactly as today (prepare-commit-msg stamps/abstains; commit-msg validates present
  trailers only; no mutation gate blocking; no kickback event).

#### Negative Paths
- Given the key is set to a future instant, when a build step runs, then enforcement is
  inactive (grandfathered), and no hook emits a rejection.
- Given the key holds an unparseable value, when the engine loads config, then it is a
  hard config error at startup (identical semantics to `owner_gate_cutover`), not a
  silent default to enabled or disabled.
- Given the key is valid and past, when config is read, then it is read once at startup
  (restart to apply), matching the documented `owner_gate_cutover` operational pattern.

### Done When
- [ ] Config test: absent / past / future / malformed values produce
      disabled / enabled / disabled / hard-error respectively.
- [ ] Hook scripts receive the enforcement decision via a deterministic worktree-local
      artifact (e.g. content or presence of the marker/an enforcement sentinel written by
      the engine), never by parsing YAML in bash.
- [ ] `src/conductor/README.md` documents the key, its default, and the restart-to-apply
      rule (docs-track-features).

## Story: commit-msg rejects unattributed content commits during a build (Surface A)

**Requirement:** TS-1

As the harness, I want a content-bearing commit with no `Task:` trailer to be rejected at
creation while enforcement is active, so an unattributed task commit is impossible to
create silently.

### Acceptance Criteria

#### Happy Path
- Given enforcement is active and `.pipeline/current-task` is absent and no unique
  `in_progress` row exists, when any session runs `git commit` on a non-empty staged
  diff and no `Task:` trailer is present after prepare-commit-msg, then `commit-msg`
  exits non-zero and the commit does not land.
- Given the same conditions, when the rejection fires, then stderr names the failure and
  the fix ("dispatch via the Agent tool with `Task: <id>` as line 1, or commit with an
  explicit `Task:` trailer") — actionable, not generic.
- Given a dispatched implementer (stamp present), when it commits a non-empty diff, then
  prepare-commit-msg stamps the trailer and commit-msg passes — first-try, no behavior
  change from today.

#### Negative Paths (exemption matrix — every row must land unimpeded)
- Given a merge commit (`MERGE_HEAD` present), when it is created during an active
  build with no `Task:` trailer, then it lands unimpeded.
- Given an amend (`COMMIT_SOURCE == commit`), when it runs during an active build, then
  the existing abstain behavior is preserved and the amend is not rejected for lacking a
  trailer.
- Given a rebase in progress (rebase-merge/rebase-apply dir present), when commits are
  replayed during the finish-time rebase or `/rebase` resolution, then none are rejected.
- Given an empty commit carrying `Evidence: satisfied-by <sha>` with a resolvable sha,
  when committed during an active build, then it lands (existing rule unchanged).
- Given an engine bookkeeping commit (`CONDUCT_ENGINE_COMMIT=1` in the environment),
  when the engine commits during an active build, then it lands with no trailer and no
  rejection.
- Given enforcement is INACTIVE (marker absent or cutover unmet), when a trailer-less
  content commit is created, then it lands exactly as today (fail-open compatibility).
- Given a commit whose trailer is present but carries an unknown id, when committed,
  then the EXISTING rejection fires (unchanged) — the new branch does not weaken or
  duplicate it.

### Done When
- [ ] Bash-level hook tests cover the rejection and all seven negative rows above.
- [ ] The rejection path is exercised by a real `git commit` in a test repo (not only a
      sourced-function unit test).
- [ ] Existing #452 hook tests still pass unmodified (no regression to stamping/abstain).

## Story: File-mutation tools are refused outside a stamped dispatch (Surface B)

**Requirement:** TS-2

As the harness, I want Edit/Write/NotebookEdit tool calls refused (exit 2) in a
build-step session when no `.pipeline/current-task` stamp is active, so inline
implementation is redirected at attempt time — dispatch-shaped execution becomes
machinery, not SKILL prose.

### Acceptance Criteria

#### Happy Path
- Given enforcement is active and no stamp exists, when the orchestrator session
  attempts Edit, Write, or NotebookEdit, then the PreToolUse hook exits 2, the mutation
  does not happen, and the surfaced message tells the agent to dispatch with
  `Task: <id>` line 1 (or `Task: none` for non-implementation work).
- Given a dispatched implementer is running (stamp present), when it uses Edit/Write,
  then the hook passes through with no block and no added latency beyond a file-existence
  check.

#### Negative Paths
- Given enforcement is inactive (marker absent — e.g. plan/stories authoring session,
  /rebase resolution, remediation session, engineer worktree), when Edit/Write runs
  unstamped, then it is NOT blocked.
- Given an unparseable hook payload, when the hook cannot determine the tool or context,
  then it passes through (fail-open, mirroring the #494 degradation rule) — a CLI
  payload-format change degrades to today's behavior instead of bricking builds.
- Given a `Task: none` dispatch (review/grader), when that subagent attempts a file
  mutation, then it is blocked with the same redirect (reviewers must not mutate; stamp
  is deliberately absent) — and this is documented in the pipeline SKILL as engine
  behavior.
- Given the stamp file exists but is empty/corrupt, when a mutation is attempted, then
  the hook treats it as absent (blocks) rather than passing on garbage.

### Done When
- [ ] Hook script unit tests (payload → exit code) for all rows above.
- [ ] The block message text matches the ADR's redirect wording.
- [ ] skills/pipeline/SKILL.md documents the gate as engine behavior (documentation of
      machinery, not a new prose rule).

## Story: Unstamped `git commit` via Bash is blocked at the session layer

**Requirement:** TS-2

As the harness, I want the session hook to also match Bash and refuse commands invoking
`git commit` when no stamp is active during an active build, so `git commit --no-verify`
cannot bypass Surface A.

### Acceptance Criteria

#### Happy Path
- Given enforcement is active and no stamp exists, when the session runs a Bash command
  containing a `git commit` invocation (including `--no-verify`), then the hook exits 2
  with the same redirect message and the command never executes.
- Given a stamped implementer, when it runs `git commit`, then the Bash matcher passes
  through.

#### Negative Paths
- Given any other Bash command (git status, test runs, `conduct-ts` queries, greps),
  when executed unstamped during an active build, then it is never blocked.
- Given a command that merely MENTIONS git commit in a string argument (e.g.
  `grep 'git commit' file`, an echo of documentation text), when executed, then it is
  not blocked — detection must target invocation, not substring presence (reuse the
  block-destructive-git.sh scannable-copy approach and its tests as precedent).
- Given enforcement is inactive, when `git commit --no-verify` runs, then it is not
  blocked (today's behavior; the merged #433 ADR's accepted bypass stands outside
  active builds).
- Given exotic quoting defeats the matcher, when such a commit lands trailer-less, then
  Surface A (for hook-honoring commits) or the evidence gate (final authority) still
  prevents silent completion — this residual is documented, not silently assumed away.

### Done When
- [ ] Matcher tests: positive invocation forms (plain, `--no-verify`, `&&`-chained) are
      blocked; mention-only and unrelated commands pass.
- [ ] Bash-hook test asserts the redirect message and exit 2.

## Story: Zero-work-product build sessions are kicked back with a recorded cause

**Requirement:** TS-3

As the daemon, I want a build-step session that ends with zero dispatches, zero new
commits, and no halt marker to produce a deterministic kickback event with a corrective
preamble on the next attempt, so prose-victory sessions surface immediately instead of
burning silent no-evidence retries.

### Acceptance Criteria

#### Happy Path
- Given enforcement is active and a build-step session ends, when the dispatch-count
  sentinel is unchanged AND `HEAD` equals the step-entry `HEAD` AND no halt marker
  exists, then the engine records a `zero_work_product` event (with feature slug and
  attempt number), increments the existing `noEvidenceAttempts` ledger with reason
  `zero_work_product`, and re-dispatches with a corrective preamble naming the
  requirement (dispatch implementation subagents; work must produce commits).
- Given the next attempt dispatches subagents that commit, when the step completes, then
  the kickback leaves no residue (sentinel reset per attempt) and the evidence gate
  proceeds normally.

#### Negative Paths
- Given a session that made zero commits but DID write `halt-user-input-required` (or
  any HALT marker), when the step ends, then the #459/#476 remediation path handles it
  and NO zero-work kickback fires (no double-processing).
- Given a session that dispatched subagents but produced zero commits (e.g. all
  dispatches were `Task: none` reviews), when the step ends, then the zero-work check
  still fires on the zero-commit condition — dispatch count alone must not mask the
  absence of work products.
- Given a legitimate no-op outcome (session committed nothing because the gate shows all
  tasks already complete), when the step ends, then the completion check runs FIRST and
  a fully-complete step never emits a kickback.
- Given `noEvidenceAttempts` reaches the existing threshold via zero-work kickbacks,
  when the next kickback would fire, then auto-park proceeds exactly as today — the net
  bounds loops, it does not create a new infinite retry class.
- Given enforcement is inactive, when a zero-work session ends, then behavior is
  today's (silent no-evidence retry) — the net is cutover-gated with the other surfaces.

### Done When
- [ ] Engine tests for the four gating conditions (dispatches, commits, halt marker,
      completion-first) individually and combined.
- [ ] The recorded event carries reason + attempt and is observable in the daemon event
      stream (same channel as #482 progress events).
- [ ] The corrective preamble text is asserted in the re-dispatch prompt.

## Story: Provisioning stays fail-open and hooks never run stale engine code

**Requirement:** TS-4

As the daemon, I want new-hook installation to follow the #452/#494 provisioning rules,
so a provisioning failure degrades to today's behavior instead of blocking builds.

### Acceptance Criteria

#### Happy Path
- Given `prepareWorktree` runs on a repo where hook wiring succeeds, when the build
  starts, then the new mutation-gate script exists under `.pipeline/session-hooks/`,
  the extended commit-msg is under `.pipeline/git-hooks/`, and the settings merge
  preserved any pre-existing consumer hooks.

#### Negative Paths
- Given `git config --worktree` is unsupported or hook copy fails, when provisioning
  runs, then the worktree is still provisioned, the build proceeds with today's
  behavior, and the failure is reported (not swallowed, not blocking).
- Given a consumer's `.claude/settings.local.json` already contains unrelated hooks,
  when wiring runs twice (idempotency), then unrelated entries survive and no duplicate
  engine entries accumulate.
- Given the new scripts, when validated, then they are embedded engine assets (pure
  bash + inline node) that never invoke `conduct-ts` (the #403 stale-dist class), and
  `bash -n` passes in the harness integrity suite.

### Done When
- [ ] Provisioning tests extend the existing wire/merge/idempotency suites to the new
      assets.
- [ ] CHANGELOG `[Unreleased]` entry includes a `## Migration` block for the hook-wiring
      surface.

## Story: Real-session probe proves the mutation gate end-to-end

**Requirement:** TS-5

As the operator, I want a real-binary smoke test that exercises the mutation gate in an
actual `claude -p` session (per the #477 probe recipe), because injected-runner argv
tests alone have shipped false-green hook features before.

### Acceptance Criteria

#### Happy Path
- Given a disposable directory provisioned with the production `settings.local.json`
  wiring and an active enforcement state, when a headless session is instructed to
  Write a file, then the write is blocked, the block message is observed in the session
  output, and the file does not exist afterward.
- Given the same setup with a stamp present, when the session writes, then the file
  exists afterward (pass-through proven, not just block proven).

#### Negative Paths
- Given the probe cannot run (no `claude` binary or no auth in the environment), when
  the suite executes, then the probe test skips explicitly with a visible reason —
  never silently passes.

### Done When
- [ ] A guarded smoke test (env-gated like other real-binary tests) exists and both
      block and pass-through assertions run when the binary is available.
- [ ] The probe recipe (setup + expected output) is documented in the test file header
      for operator manual verification.
