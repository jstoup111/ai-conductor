**Status:** Accepted

# Stories: finish force-with-lease after sanctioned rebase

Track: technical (no PRD). Source: jstoup111/ai-conductor#213. Tier: S.
Decision record: `.memory/decisions/finish-force-with-lease-after-sanctioned-rebase.md`.

These stories change **skill prose only** (`skills/finish/SKILL.md`,
`skills/pr/SKILL.md`). The observable "system" is the finish/pr session executing the
skill text, so acceptance is stated against the instructions the skill must contain and
the run outcomes they must produce; "Done When" is verified against the skill files and
the harness integrity suite.

## Story: Finish treats the local branch as canonical when diverged from origin

As the conductor daemon, I want the finish skill to update the stale remote to match the
just-rebased local branch so that a sanctioned finish-time rebase (ADR-001/9.0) never
triggers a pull of pre-rebase commits, a conflict, and a GATE 0 halt loop.

### Acceptance Criteria

#### Happy Path
- Given a feature branch that the conductor's rebase step has rebased onto latest main
  (so `git status` reports it has diverged from / is behind `origin/<branch>`, e.g.
  "ahead 16, behind 9"), when the finish skill reaches its push/ship step, then it runs
  `git push --force-with-lease` to make the remote match local and proceeds to PR
  creation/update without importing any commit from `origin/<branch>`.
- Given the same diverged state, when finish completes the force-with-lease push and the
  PR step, then `.pipeline/finish-choice` is written exactly as today (`pr` / `keep` /
  etc.) — the divergence handling adds no new marker states.

#### Negative Paths
- Given a feature branch diverged from `origin/<branch>` after a sanctioned rebase, when
  the finish session is deciding how to reconcile, then it MUST NOT run `git pull`,
  `git fetch` + `git rebase origin/<branch>`, `git merge origin/<branch>`, or any other
  sync-FROM-remote operation on the feature branch — the skill text explicitly prohibits
  it, and a session that followed the skill leaves `git log` free of any pre-rebase
  commit re-imported from the stale remote copy.

### Done When
- [ ] `skills/finish/SKILL.md` contains an explicit rule: at SHIP time the local branch
      is canonical; a branch diverged from `origin/<branch>` is reconciled with
      `git push --force-with-lease`, never by pulling/rebasing/merging from the remote.
- [ ] The rule states it applies to the sanctioned daemon finish-time rebase (ADR-001)
      divergence case by name, so the model recognizes the "behind the remote" state as
      expected rather than as newer remote work.
- [ ] `test/test_harness_integrity.sh` passes with the edited skill.

## Story: The pr skill's push step survives a non-fast-forward rejection without pulling

As the finish skill (which delegates push + PR creation to `/pr`), I want the pr skill's
push step to handle a non-fast-forward rejection by force-with-lease pushing so that the
push-direction rule holds on the actual command path that touches the remote.

### Acceptance Criteria

#### Happy Path
- Given a rebased feature branch whose `git push -u origin HEAD` would be rejected as
  non-fast-forward (stale remote copy), when the pr skill executes its push step, then it
  pushes with `git push --force-with-lease -u origin HEAD` (directly, or on first
  rejection) and continues to `gh pr create` / `gh pr edit` normally.

#### Negative Paths
- Given the push is rejected non-fast-forward, when the pr skill reacts, then it MUST NOT
  pull, fetch-and-rebase onto, or merge `origin/<branch>` to "get ahead" of the remote —
  the skill text explicitly names that reaction as wrong, and the branch history after
  the step contains no commits re-imported from the stale remote.

### Done When
- [ ] `skills/pr/SKILL.md`'s push step ("Create or Update the PR") documents the
      non-fast-forward case with `git push --force-with-lease` as the required response
      and an explicit prohibition on syncing from the remote branch.
- [ ] `test/test_harness_integrity.sh` passes with the edited skill.

## Story: A failed lease is a stop-and-surface, not a fallback pull

As the operator, I want a `--force-with-lease` rejection (the remote moved past what the
local repo last fetched — i.e., someone else really did push new work) to halt the finish
step visibly so that neither direction of destructive reconciliation happens without a
human decision.

### Acceptance Criteria

#### Happy Path
- Given `git push --force-with-lease` fails because `origin/<branch>` does not match the
  local remote-tracking ref, when the finish session handles the failure, then it stops
  GATE-0-style: it does NOT push `--force` (without lease), does NOT pull, does NOT
  create/update a PR, and does NOT write `.pipeline/finish-choice`, and it reports the
  divergence plainly (branch, what the lease expected vs. found) so the conductor
  re-evaluates and HALTs for human resolution.

#### Negative Paths
- Given the lease failure, when the session considers retry strategies, then escalating
  to a plain `git push --force` is explicitly prohibited by the skill text — the only
  exits are human resolution or abandoning the finish attempt with no `finish-choice`
  marker (the conductor's existing failed-step handling takes over).

### Done When
- [ ] `skills/finish/SKILL.md` (and the pr skill's push step) define the lease-failure
      path: stop, no plain `--force`, no pull, no `finish-choice`, report and end.
- [ ] The verification checklist in `skills/finish/SKILL.md` includes the new
      push-direction and lease-failure checks.
- [ ] `CHANGELOG.md` gains a `## [Unreleased]` **Fixed** entry describing the
      stale-remote pull fix, and `README.md`/skill docs are updated if they describe
      finish's ship behavior.
