**Status:** Accepted

# Stories: Validator output never leaves the product worktree dirty

Source: jstoup111/ai-conductor#3683. Technical track, Tier S. The validation steps are the SHIP-tail validation group: `manual_test`, `prd_audit` and `architecture_review_as_built`. Each runs either serially or fanned out in parallel within the group.

## Story 1: Untracked output from a validation dispatch is moved under .pipeline before its outcome is routed

**Requirement:** #3683 desired outcomes 1, 2 and 3

As the operator, I want untracked files that a validation step leaves in the feature worktree moved somewhere the harness ignores before the engine acts on that step's outcome, so that a stray report never halts the next routed host as `worktree is dirty`.

### Acceptance Criteria

#### Happy Path
- Given a feature worktree with no untracked files, when a serially dispatched `manual_test` attempt creates the untracked file `docs/reports/manual-test-step17/report.html` and records a FAIL row, then before the completion check reads that attempt the file is moved to `docs/reports/manual-test-step17/report.html` beneath a new per-dispatch directory under `.pipeline/validator-residue/`, `git status --porcelain` in the worktree prints nothing, and the routed host entry that follows proceeds without a `worktree is dirty` refusal.
- Given the validation group fans out `manual_test`, `prd_audit` and `architecture_review_as_built` in parallel, when any member creates an untracked file that is not ignored, then after every member of that dispatch round has settled and before the join recomputes any member verdict, the file is moved beneath a per-dispatch directory under `.pipeline/validator-residue/`, keeping its relative path.
- Given a validation dispatch that moved one or more files, when the move completes, then one `validator_residue_quarantined` event naming the validation step or group, every moved path, and the destination directory is persisted to `.pipeline/events.jsonl`.

#### Negative Paths
- Given a validation dispatch that edits a tracked file and does not commit it, when the dispatch settles, then the tracked edit stays in place, no event is emitted for it, and the next routed host entry is still refused with `worktree is dirty` naming that path.
- Given an untracked, non-ignored file that already existed before the validation dispatch began, when the dispatch settles, then that file is not moved and still makes the next routed host entry refuse with `worktree is dirty` naming it.
- Given a validation dispatch whose untracked output includes a path whose destination already exists under `.pipeline/validator-residue/`, or a path that can no longer be found, when the move is attempted, then no file is moved, the engine logs the refusal reason, and the existing dirty-tree refusal at routed host entry still applies.
- Given a `build` dispatch that leaves an untracked file, when it settles, then the file is not moved and build's existing uncommitted-paths completion check still reports it.
- Given a validation dispatch that creates no untracked, non-ignored files (for example only `.pipeline/` writes), when it settles, then nothing is moved and no `validator_residue_quarantined` event is emitted.

### Done When
- [ ] A test running a real git worktree shows that an untracked file created during a serial `manual_test` dispatch exists afterwards under `.pipeline/validator-residue/<dispatch>/<original relative path>` with unchanged bytes, and that `git status --porcelain` prints nothing.
- [ ] A test of the grouped validation fan-out shows that an untracked file created by one member is moved before the join's first `computeAndWriteVerdict` call, and that one `validator_residue_quarantined` event carries the moved path and directory.
- [ ] A test shows that a pre-existing untracked file and an uncommitted edit to a tracked file both survive a validation dispatch in place, and that `switchToChild` then still refuses with `worktree is dirty` naming both.
- [ ] A test shows that a destination collision moves nothing and leaves every source path in place.

## Story 2: The manual-test skill directs evidence into a harness-owned directory

**Requirement:** #3683 desired outcome 1

As the operator, I want the manual-test skill to name where screenshots and reports go, so that a well-behaved manual_test run writes no file into the product tree in the first place.

### Acceptance Criteria

#### Happy Path
- Given `skills/manual-test/SKILL.md`, when it instructs the agent to capture screenshots, HTML reports, logs or other manual-test evidence, then the skill directs every such file to `.pipeline/manual-test-evidence/` in the feature worktree, creating the directory if it is missing.
- Given the skill's Verification checklist, when an agent self-checks a run, then one item requires that all evidence files were written under `.pipeline/manual-test-evidence/` and that the run added no file outside `.pipeline/` to the product tree.

#### Negative Paths
- Given the skill, when it describes any evidence destination, then it names no path outside `.pipeline/` (for example `docs/`, `reports/` or `tmp/`) as a place to keep manual-test evidence.

### Done When
- [ ] `skills/manual-test/SKILL.md` names `.pipeline/manual-test-evidence/` as the destination for screenshots and reports in the section that tells the agent to capture evidence.
- [ ] The skill's Verification checklist contains the evidence-location item, and `test/test_harness_integrity.sh` passes.
