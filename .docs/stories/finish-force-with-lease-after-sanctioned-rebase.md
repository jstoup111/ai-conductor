**Status:** Accepted

# Stories: finish force-with-lease after sanctioned rebase

Track: technical (no PRD). Source: jstoup111/ai-conductor#213. Tier: S.
Decision record: `.memory/decisions/finish-force-with-lease-after-sanctioned-rebase.md`.

These stories change **skill prose only** (`skills/finish/SKILL.md`,
`skills/pr/SKILL.md`). The observable "system" is the finish/pr session executing the
skill text, so acceptance is stated against the instructions the skill must contain and
the run outcomes they must produce; "Done When" is verified against the skill files and
the harness integrity suite.

## Story: Finish proves the remote is stale before force-pushing when diverged from origin

As the conductor daemon, I want the finish skill to prove that `origin/<branch>` is a
stale pre-rebase copy of the local branch's own history — and only then update the remote
to match local — so that a sanctioned finish-time rebase (ADR-001/9.0) never triggers a
pull of pre-rebase commits, and no force-push ever assumes locality implies canonicality
(multi-operator / isolated-remote safe).

### Acceptance Criteria

#### Happy Path
- Given a feature branch that the conductor's rebase step has rebased onto latest main
  (so `git status` reports it has diverged from / is behind `origin/<branch>`, e.g.
  "ahead 16, behind 9"), when the finish skill reaches its push/ship step, then it first
  proves the remote tip is our own pre-rebase history — fast path
  `git merge-base --is-ancestor origin/<branch> ORIG_HEAD` (ORIG_HEAD set by the
  sanctioned rebase), fallback: the `origin/<branch>` tip SHA appears in the local
  branch's reflog as a former head (covers multi-rebase retries where ORIG_HEAD points
  at an intermediate state) — and only on proof runs `git push --force-with-lease`,
  proceeding to PR creation/update without importing any commit from `origin/<branch>`.
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
- Given a diverged branch where neither the ORIG_HEAD ancestry check nor the reflog
  membership check proves the remote tip is our own former history, when finish evaluates
  the push, then it does NOT force-push (see the foreign-commits story below) — an
  unprovable staleness claim is treated as foreign work, never as "probably fine".

### Done When
- [ ] `skills/finish/SKILL.md` contains an explicit rule: canonical is PROVEN, not
      assumed — a branch diverged from `origin/<branch>` is reconciled with
      `git push --force-with-lease` only after the remote tip is proven to be our own
      pre-rebase history (ORIG_HEAD ancestry, or former-head reflog membership), and
      never by pulling/rebasing/merging from the remote.
- [ ] The rule states it applies to the sanctioned daemon finish-time rebase (ADR-001)
      divergence case by name, so the model recognizes the "behind the remote" state as
      expected rather than as newer remote work.
- [ ] `test/test_harness_integrity.sh` passes with the edited skill.

## Story: Foreign commits on the remote branch halt the ship — a passing lease is not trusted

As an operator in a multi-operator / multi-checkout deployment, I want finish to refuse
to force-push when `origin/<branch>` carries commits that are not part of the local
branch's own pre-rebase history so that another writer's fetched work is never wiped —
`--force-with-lease` alone cannot protect it, because the lease passes once the foreign
commits have been fetched into the remote-tracking ref (e.g. by the rebase step's fetch).

### Acceptance Criteria

#### Happy Path
- Given `origin/<branch>` contains one or more commits that fail both staleness proofs
  (not an ancestor of ORIG_HEAD, tip never a former local head in the reflog), when
  finish evaluates the diverged branch, then it stops GATE-0-style: no
  `git push --force-with-lease` (even though the lease would pass), no plain `--force`,
  no pull/merge/rebase from the remote, no PR create/update, and no
  `.pipeline/finish-choice` — and it reports the foreign commits plainly (e.g.
  `git log HEAD..origin/<branch> --oneline`) so a human reconciles.

#### Negative Paths
- Given the foreign-commit state, when the session considers "the lease passed after the
  last fetch, so forcing is safe", then the skill text explicitly names this reasoning as
  wrong — lease success proves nothing about authorship of already-fetched commits — and
  the only exits are human resolution or ending with no `finish-choice` marker (the
  conductor's existing failed-step handling takes over).

### Done When
- [ ] `skills/finish/SKILL.md` defines the unproven-staleness / foreign-commit path:
      stop, no force of any kind, no pull, no `finish-choice`, report the foreign
      commits and end.
- [ ] The skill text explicitly warns that a passing lease does not authorize a force
      when staleness is unproven (fetched-but-foreign commits).
- [ ] `test/test_harness_integrity.sh` passes with the edited skill.

## Story: The pr skill's push step survives a non-fast-forward rejection without pulling

As the finish skill (which delegates push + PR creation to `/pr`), I want the pr skill's
push step to handle a non-fast-forward rejection by force-with-lease pushing so that the
push-direction rule holds on the actual command path that touches the remote.

### Acceptance Criteria

#### Happy Path
- Given a rebased feature branch whose `git push -u origin HEAD` is rejected as
  non-fast-forward (stale remote copy), when the pr skill executes its push step, then it
  applies the same staleness proof as finish (ORIG_HEAD ancestry or former-head reflog
  membership of the `origin/<branch>` tip), and on proof pushes with
  `git push --force-with-lease -u origin HEAD`, continuing to `gh pr create` /
  `gh pr edit` normally.

#### Negative Paths
- Given the push is rejected non-fast-forward, when the pr skill reacts, then it MUST NOT
  pull, fetch-and-rebase onto, or merge `origin/<branch>` to "get ahead" of the remote —
  the skill text explicitly names that reaction as wrong, and the branch history after
  the step contains no commits re-imported from the stale remote.
- Given the rejection and a failed staleness proof (foreign commits on the remote), when
  the pr skill reacts, then it stops and reports the foreign commits — no force of any
  kind — mirroring finish's foreign-commit halt.

### Done When
- [ ] `skills/pr/SKILL.md`'s push step ("Create or Update the PR") documents the
      non-fast-forward case with the staleness proof + `git push --force-with-lease` as
      the required response, an explicit prohibition on syncing from the remote branch,
      and the stop-and-report path when the proof fails.
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
