**Status:** Accepted

# Stories: Attribution Abstain-or-Loud Hardening (#519)

Technical track — acceptance criteria derive from
`adr-2026-07-11-attribution-abstain-or-loud` (APPROVED). Scope: harden existing surfaces in
`session-hook-assets.ts` and `git-hook-assets.ts` only; no new hook, sentinel, marker, or
enforcement surface (semantic-lane ADR cap); hooks stay pure bash + inline `node -e`;
provisioning stays fail-open.

Terminology used by scenarios:
- "stamp" = `.pipeline/current-task`
- "status file" = `.pipeline/task-status.json`
- "the generated pre-dispatch hook" = the script emitted from `PRE_DISPATCH_HOOK`, executed
  against a fixture `.pipeline` as in `test/engine/session-hook-behavior.test.ts`
- "a hook-provisioned repo" = a temp git repo with the generated git hooks installed, as in
  `test/integration/git-hooks-attribution.test.ts`

## Story 1: Pre-dispatch uncertainty abstains loudly instead of leaving a stale stamp

As the build engine, I want every uncertainty path in the pre-dispatch stamping block to
remove the stamp and say so on stderr, so that a bookkeeping failure can never leave an
earlier task's id driving later commits.

### Acceptance Criteria

#### Happy Path
- Given a stamp containing `1` from an earlier dispatch and a MISSING status file, when the
  generated pre-dispatch hook processes a dispatch with line 1 `Task: 2`, then the hook exits
  0 (dispatch proceeds), the stamp file no longer exists, and stderr contains a diagnostic
  identifying the pre-dispatch hook, the failure kind (status file unreadable), and the
  dispatched id `2`.
- Given a stamp containing `1` and a status file containing invalid JSON (`{oops`), when the
  hook processes `Task: 2`, then exit 0, stamp removed, and stderr names the parse failure.
- Given a stamp containing `1` and a status file whose `tasks` key is an object (not an
  array), when the hook processes `Task: 2`, then exit 0, stamp removed, and stderr names the
  shape failure.
- Given a stamp containing `1` and a status file that is valid but whose directory is made
  read-only so the atomic temp-write/rename fails, when the hook processes `Task: 2`, then
  exit 0, the stamp is removed (or removal failure itself is reported on stderr), and stderr
  names the write failure.

#### Negative Paths
- Given NO stamp and a missing status file, when the hook processes `Task: 2`, then exit 0,
  no stamp file is created, and the stderr diagnostic still appears (abstention is loud even
  with nothing to remove).
- Given a healthy status file seeding ids `1..3` and no stamp, when the hook processes
  `Task: 2`, then the success path is unchanged: row `2` flips to `in_progress`, the stamp
  contains exactly `2`, exit 0, and NO uncertainty diagnostic is emitted.
- Given a healthy status file and a stamp containing `2`, when the hook processes `Task: 2`
  again (idempotent re-dispatch), then exit 0 and the stamp still contains `2` (no removal,
  no diagnostic).
- Given a healthy status file and a stamp containing `2`, when the hook processes `Task: 3`
  (overlap), then the overlap guard behavior is unchanged: row `3` flips `in_progress`, the
  stamp is removed, exit 0.
- Given a healthy status file seeding ids `1..3`, when the hook processes `Task: 99`
  (unknown id), then the hook exits 2 (dispatch blocked) with the existing unknown-id
  message — the uncertainty hardening does not soften the fail-closed unknown-id path.

### Done When
- [ ] `session-hook-behavior.test.ts` (or a sibling) executes the generated script against
      each of the four fixture corruptions and asserts: exit code 0, stamp absent afterward,
      and a stderr line matching a stable greppable prefix (e.g. `pre-dispatch-hook: abstain`)
      that names the failure kind and the dispatched id.
- [ ] Success, idempotent, overlap, and unknown-id fixtures assert byte-identical prior
      behavior (no new diagnostics on healthy paths).

## Story 2: The #519 cascade shape can never recur (regression pin)

As the operator, I want a regression test reproducing the #492 build's failure shape, so that
a later dispatch's bookkeeping failure can never silently attribute subsequent work to an
earlier task.

### Acceptance Criteria

#### Happy Path
- Given a hook-provisioned repo with a status file seeding ids `1..3`, when dispatch
  bookkeeping for `Task: 1` succeeds (stamp = `1`), a commit is made (trailer `Task: 1`), and
  then the status file is replaced with a wrong-shaped document before dispatch bookkeeping
  for `Task: 2` runs, then the task-2 dispatch exits 0 with the stderr diagnostic, the stamp
  is REMOVED, and a subsequent commit's message contains NO `Task:` trailer sourced from the
  stale stamp — under no circumstance does it carry `Task: 1`.

#### Negative Paths
- Given the same sequence but with the status file left healthy, when task 2's bookkeeping
  runs, then the stamp contains `2` and the subsequent commit carries `Task: 2` — proving the
  regression fixture fails for the right reason, not because attribution stopped working.
- Given the corrupted-at-task-2 sequence, when the status file is subsequently RESTORED and
  dispatch bookkeeping for `Task: 3` runs, then the stamp contains `3` and later commits
  carry `Task: 3` — a one-dispatch failure does not poison later healthy dispatches.

### Done When
- [ ] An integration test encodes the three-dispatch sequence above and asserts trailer
      content per commit; it FAILS against the pre-fix hook templates (stale `Task: 1`
      inherited) and PASSES against the hardened templates.

## Story 3: prepare-commit-msg stamps from the stamp file or abstains — never guesses

As the build engine, I want commit-time attribution to have exactly one source of truth, so
that stale pipeline state can never be converted into a plausible trailer.

### Acceptance Criteria

#### Happy Path
- Given a hook-provisioned repo with a stamp containing `2`, when a non-empty commit is made
  without a `Task:` trailer, then the resulting message carries `Task: 2`.
- Given NO stamp and a status file with EXACTLY ONE row `in_progress` (the old fallback's
  trigger), when a commit is made (no active build-step marker), then the resulting message
  carries NO `Task:` trailer — the fallback is gone, the hook abstains.

#### Negative Paths
- Given NO stamp and multiple rows `in_progress`, when a commit is made, then no trailer is
  added (abstention, as before).
- Given a stamp containing `2` and a message that ALREADY carries `Task: 5`, when the commit
  is made, then the existing trailer is preserved unchanged (no double-stamping, no
  overwrite).
- Given an amend (`COMMIT_SOURCE = commit`) or an in-progress rebase, when the hook runs,
  then it abstains exactly as today (exemptions unchanged).

### Done When
- [ ] `git-hooks-attribution.test.ts` (or a sibling) asserts the one-in_progress-row fixture
      now produces an UNSTAMPED commit, and the stamp-present fixture still stamps.
- [ ] No code path in the generated prepare-commit-msg reads `in_progress` rows any longer.

## Story 4: commit-msg validates trailer ids against real seeded ids (resolves #501)

As the build engine, I want the fail-closed gate to compare trailer ids to the ids the engine
actually seeded, so that stale-but-plausible ids are rejected and every legitimate id —
including the last task's — is accepted.

### Acceptance Criteria

#### Happy Path
- Given a hook-provisioned repo seeding string ids `1..16`, when a non-empty commit carries
  `Task: 16` (id == task count — the #501 false rejection), then the commit is ACCEPTED.
- Given the same repo, when a non-empty commit carries `Task: 7`, then it is ACCEPTED.
- Given a status file whose ids are NUMERIC (`"id": 3`), when a commit carries `Task: 3`,
  then it is ACCEPTED (id comparison tolerates the numeric/string drift class from #501).

#### Negative Paths
- Given ids `1..16`, when a commit carries `Task: 17` (outside the seeded set), then the
  commit is REJECTED with the existing instructive `not found in task-status.json` message.
- Given ids `A.1`, `A.2` (non-numeric grammar), when a commit carries `Task: 0` (an array
  INDEX that the old `Object.keys` check would have accepted), then the commit is REJECTED —
  pinning that indices no longer masquerade as ids.
- Given a commit carrying `Task: task-3`, then the existing task-N naming-drift rejection is
  unchanged.
- Given a MISSING status file, when a commit carries any `Task:` trailer, then the hook's
  existing tolerance is unchanged (no false rejection from the validation block).
- Given a merge commit, an amend, a rebase replay, or `CONDUCT_ENGINE_COMMIT=1`, then each
  existing exemption still exits 0 before validation.

### Done When
- [ ] Tests assert acceptance of the full seeded range including id == N, and rejection of
      out-of-set and index-shaped ids, for both string and numeric seeded ids.
- [ ] The generated commit-msg no longer contains `Object.keys` over the tasks collection;
      validation iterates real row ids.

## Story 5: Abstention composes with the #509 gate into a loud, fixable rejection

As a build subagent, I want an unattributed commit during an active build step to fail with
an instruction I can act on, so that attribution failures cost one recommit instead of a
poisoned build.

### Acceptance Criteria

#### Happy Path
- Given a hook-provisioned repo with `.pipeline/build-step-active` present, NO stamp, and no
  fallback source, when a non-empty commit is made without a trailer, then the commit is
  REJECTED and stderr contains the existing instructive message (add a `Task: <id>` trailer
  or commit from a dispatched task).
- Given the same state, when the commit is retried with an explicit valid `Task: 2` trailer,
  then it is ACCEPTED (real-id validation passes) — the end-to-end loud path: abstain →
  reject → self-stamp → accept.

#### Negative Paths
- Given `build-step-active` present and a stamp containing `2`, when a non-empty commit is
  made without a trailer, then prepare-commit-msg stamps `Task: 2` and the gate accepts —
  the loud path only engages when attribution is genuinely unavailable.
- Given NO `build-step-active` (outside a build step), when an unstamped commit is made, then
  it is ACCEPTED (enforcement scope unchanged).
- Given `build-step-active` present, when the retry carries an INVALID id (`Task: 99`), then
  the commit is REJECTED by real-id validation — self-stamping cannot smuggle a wrong id.

### Done When
- [ ] An integration test walks the reject-then-fix sequence and asserts both the rejection
      message and the subsequent acceptance.

## Story 6: Provisioning delivers the hardened hooks to new AND kept worktrees

As the daemon, I want every dispatch to run against the current hook templates, so that a
worktree kept from a pre-fix halt (e.g. #492's) is healed on its next dispatch rather than
re-running the buggy copies.

### Acceptance Criteria

#### Happy Path
- Given a fresh worktree, when `prepareWorktree` provisions it, then the written
  `pre-dispatch.sh`, `prepare-commit-msg`, and `commit-msg` contain the hardened behavior
  (greppable markers: the abstain diagnostic prefix; absence of the in_progress fallback;
  real-id validation).
- Given a worktree already carrying the OLD generated hooks (fixture copies of the pre-fix
  scripts), when `prepareWorktree` runs again, then all three files are overwritten with the
  hardened versions and the settings wiring remains exactly one entry per hook (idempotent
  re-provisioning, no duplicates).

#### Negative Paths
- Given a worktree where writing the session-hook assets fails (permissions), when
  `prepareWorktree` runs, then provisioning stays fail-open exactly as today: the error is
  logged and worktree setup is not blocked (no new provisioning-time enforcement surface).
- Given a worktree with unrelated user entries in `.claude/settings.local.json`, when
  re-provisioning runs, then those entries survive byte-for-byte (merge-preserve semantics
  unchanged).

### Done When
- [ ] `worktree-prepare.test.ts` (or a sibling) asserts stale fixture hooks are replaced on
      re-provisioning and settings dedup holds.
- [ ] No new files, markers, or settings entries are introduced relative to today's
      provisioning output (asset set is identical, contents hardened).
