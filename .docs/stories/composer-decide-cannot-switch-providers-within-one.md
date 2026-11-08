**Status:** Accepted

# Stories: Composer runs checkpoint, resume, switch provider, and hand off (#2050, spec 1)

Source: PRD `.docs/specs/composer-decide-cannot-switch-providers-within-one.md` and APPROVED ADR
`adr-2026-11-07-composer-run-checkpoint-resume-handoff`. FR-16 to FR-20, and the review-comment half of
FR-26, belong to the follow-up specification (ADR D12) and have no stories here.

## Story 1: An accepted DECIDE step is saved to the shared remote

**Requirement:** FR-1, FR-2, FR-4

As an operator, I want each DECIDE step I accept saved to the shared repository so that the run survives the end of my session.

### Acceptance Criteria

#### Happy Path
- Given a Composer run in its per-idea worktree with a reachable remote, when the operator accepts the explore step and the step is checkpointed as accepted, then a commit containing the step's `.docs` artifacts and the run record exists on `spec/<slug>` both locally and on the remote before the next step begins.
- Given an accepted checkpoint, when the run record on the spec branch is read, then it lists the step as accepted with the accepting operator's owner id, the provider the session ran under, the acceptance time, every accepted artifact path with its SHA-256 digest, and the operator decisions and open questions supplied for that step.
- Given the first checkpoint of a run, when it is committed, then the branch also carries the intake owner marker keyed by the run's slug and naming the current machine owner, so the remote push is authorized by committed provenance and pushed with the same write credential handoff uses.

#### Negative Paths
- Given the remote is unreachable, when a step is checkpointed as accepted, then the local commit is kept, the command exits non-zero with a diagnostic naming the failed push and the retry command, and the run is not reported as saved remotely.
- Given a checkpoint whose push previously failed, when it is retried after the remote recovers, then the existing local commit is pushed, and no second commit, branch, or run-record step entry is created for the same acceptance.
- Given a step checkpointed as accepted, when the session supplied no provider identity, then the step is recorded with provider `unrecorded` rather than a guessed provider, and the checkpoint still succeeds.
- Given a checkpoint request whose worktree has uncommitted changes outside `.docs`, when it runs, then it refuses before committing, names the offending paths, and stages nothing.
- Given the machine owner identity cannot be resolved, when the first checkpoint runs, then it refuses before writing any owner marker, commit, or push, naming the unresolved identity.

### Done When
- [ ] `spec/<slug>` on the remote contains the accepted step's artifacts and an updated run record after one accepted checkpoint.
- [ ] The run record holds actor, provider, time, artifact digests, decisions and open questions for the step.
- [ ] A push failure leaves exactly one local checkpoint commit and a non-zero exit with a retry diagnostic.

## Story 2: A session that ends mid-step saves its work as an unaccepted draft

**Requirement:** FR-3

As an operator, I want unfinished work saved as a draft when a session ends so that another provider or person can critique, revise, or accept it.

### Acceptance Criteria

#### Happy Path
- Given a launcher-started session that drafted a PRD the operator did not accept, when the host session exits, then the launcher saves the uncommitted `.docs` changes as a draft checkpoint pushed to `spec/<slug>`, with the step recorded as draft.
- Given a run whose current step is a saved draft, when it is resumed, then the resuming session is told the step's artifacts are drafts awaiting critique, revision, or acceptance, not accepted.

#### Negative Paths
- Given a draft checkpoint, when the run record is read, then the step records no accepting actor and its artifact digests are not listed as accepted.
- Given a host session that exits with no uncommitted `.docs` changes, when the launcher runs its post-exit save, then no empty commit is created and no push is attempted.
- Given the post-exit draft push fails, when the launcher reports the boundary, then it states that the draft is saved locally only and gives the retry command, and it still offers the continue, switch, and hand-off choices.

### Done When
- [ ] After a mid-PRD exit, the remote branch carries the PRD file and a run record marking the PRD step as draft.
- [ ] A clean exit produces no new commit.

## Story 3: Unaccepted or edited artifacts cannot be delivered

**Requirement:** FR-3, FR-26

As an operator, I want delivery refused while any artifact is unaccepted so that a draft can never reach the daemon as an approved spec.

### Acceptance Criteria

#### Happy Path
- Given every DECIDE artifact in the change set matches a digest recorded as accepted and no step needs reconfirmation, when land runs, then it passes its existing gates, removes the run record in its own commit, and succeeds.
- Given an accepted artifact is edited and its step is re-accepted, when the later accepted steps are reconfirmed by checkpointing them as accepted again, then land succeeds.

#### Negative Paths
- Given a change-set artifact whose current digest is not recorded as accepted, including a track or complexity file that has no status line, when land runs, then it refuses with an `unaccepted-draft` rejection naming the artifact, and commits nothing.
- Given an artifact accepted at the stories step is edited after the plan step was accepted, when land runs, then it refuses, naming the stories step as draft and the plan step as needing reconfirmation.
- Given land already removed the run record, when land is re-run after an artifact was edited, then it verifies against the record as of the removal commit's parent and refuses the edited artifact.
- Given a branch with no run record and no record-removal commit, as with a run authored before this feature, when land runs, then it behaves exactly as before this feature.

### Done When
- [ ] Land refuses an unaccepted artifact with `unaccepted-draft` and makes no commit.
- [ ] A successful land leaves no run record on the branch tip.
- [ ] A land re-run after the record was stripped still refuses a post-strip edit.

## Story 4: The first save opens exactly one draft spec pull request

**Requirement:** FR-5

As a teammate, I want an in-progress run to appear as a draft pull request so that I can find and pick it up.

### Acceptance Criteria

#### Happy Path
- Given an intake run with no spec PR, when its first checkpoint is pushed, then one draft spec PR for `spec/<slug>` is opened against the default base, and its body carries a non-closing `Refs <owner/repo#N>` line.
- Given a non-intake run, when its first checkpoint is pushed, then a draft spec PR is opened with no `Refs` line.
- Given the repository requires release metadata in PR bodies, when the draft spec PR is opened, then its body already carries the release-metadata section, so the required metadata check does not fail on the draft.

#### Negative Paths
- Given a draft spec PR already exists for `spec/<slug>`, when any later checkpoint is pushed, then no second PR is created and the existing PR is reused.
- Given the PR creation fails after the push succeeded, when the next checkpoint runs, then it detects that no PR exists for the branch and creates it once.
- Given the run's PR body is generated, when an intake run's source issue is referenced, then the reference never uses a closing keyword, so merging the spec PR does not close the issue.

### Done When
- [ ] Exactly one open draft PR exists for `spec/<slug>` after several checkpoints.
- [ ] The intake PR body contains `Refs <owner/repo#N>` and no closing keyword.

## Story 5: The pull request shows the run's state but is never its source

**Requirement:** FR-6, FR-7, FR-9

As a teammate or reviewer, I want the draft PR to show where the run stands and which provider is active so that I know what to do next without opening the branch.

### Acceptance Criteria

#### Happy Path
- Given a run with accepted and draft steps, when a checkpoint is pushed, then the PR body's Composer run block shows the current step, each accepted step with actor and provider, the active provider, the last actor and time, the open questions, and the next step.
- Given an operator is running a Composer session, when they look at the launcher's boundary prompt or the PR block, then the active provider is named.

#### Negative Paths
- Given the PR body also contains release metadata and the `Refs` line, when the Composer run block is refreshed, then only the marker-delimited block changes and every other line of the body is preserved byte for byte.
- Given someone hand-edits the Composer run block in the PR body, when the run is resumed, then the resumed run's step, decisions, and acceptance come from the run record on the branch and the edited text has no effect.
- Given the PR body refresh fails, when the checkpoint finishes, then the commit and push still count as saved, the command reports the refresh failure as a warning, and the next checkpoint refreshes the block again.

### Done When
- [ ] After a checkpoint, the PR body block matches the run record.
- [ ] A test proves resume ignores a hand-edited block.

## Story 6: The launcher guides the move between sessions

**Requirement:** FR-8, FR-9, FR-10

As an operator, I want the launcher to offer continue, switch provider, or hand off when a session ends so that I never rebuild context by hand.

### Acceptance Criteria

#### Happy Path
- Given a launcher-started session exits with its run unfinished, when the launcher regains control, then it shows the run's current step and active provider and offers continue with the same provider, switch to another provider that can host an interactive session, or hand off.
- Given the operator chooses switch and picks Codex, when the launcher relaunches, then the Codex interactive host starts the Composer skill in resume mode for the same worktree at the first unaccepted step.
- Given the operator chooses hand off, when the launcher finishes, then the run is saved, its PR stays draft, and the launcher prints the PR URL and the resume command that anyone can run, followed by the existing process-another-idea prompt.
- Given the operator switched the run to Codex in a launcher started with Claude, when they later accept processing another idea, then the new idea launches on Claude, the host selected when the launcher started.

#### Negative Paths
- Given the launcher's standard input is not a TTY, when a session exits with an unfinished run, then no relaunch happens, the run is handed off, and the PR URL and resume command are printed.
- Given the session touched no Composer run, when it exits, then the launcher shows only the existing process-another-idea prompt, unchanged.
- Given the operator picks a provider that cannot host an interactive session, when the switch is attempted, then it is refused, naming the missing capability, and the operator is offered the choices again with the run state unchanged.
- Given the switch choices are listed, when the launcher builds the list, then it reads the provider catalog only and runs no provider version probe before the chosen host is spawned.

### Done When
- [ ] The post-exit prompt lists the three choices with the current step and provider.
- [ ] A switch relaunch passes the resume prompt and worktree to the chosen provider.
- [ ] Non-TTY exit prints the PR URL and resume command without relaunching.

## Story 7: A run resumes by PR, branch, or source issue on any machine

**Requirement:** FR-11, FR-12

As a teammate on another machine, I want to resume a run from its PR, branch, or issue so that I continue where it stopped.

### Acceptance Criteria

#### Happy Path
- Given a run whose branch exists only on the remote, when an operator on another machine resumes it by PR number, then `spec/<slug>` is fetched, a local worktree is attached tracking the remote branch, and the chosen provider's interactive host is launched in resume mode.
- Given a run with accepted explore and PRD steps and a draft architecture diagram, when it is resumed, then the session is given the accepted artifacts, decisions, open questions, and the draft, and it starts at the architecture-diagram step without re-running explore or the PRD.
- Given an intake run, when it is resumed by `owner/repo#N`, then the run is found through the local ledger's branch or, when there is none, through the open spec PR that cross-references the issue.
- Given a resumed run, when its remaining steps run, then each still asks its required clarifying questions and waits for operator acceptance.

#### Negative Paths
- Given a resume target that matches no spec branch or open spec PR, when resume runs, then it exits non-zero, naming what was searched, and creates no worktree or branch.
- Given the target project is not in the resuming machine's registry, when resume runs, then it refuses before any fetch, naming the repository and how to register it.
- Given the remote is unreachable during resume, when the fetch fails, then resume exits non-zero with the fetch error and leaves any existing local worktree untouched.
- Given resume is run from inside an existing Claude or Codex host session, when it would launch a host, then it refuses to nest with the launcher's existing nested-host diagnostic and launches nothing.
- Given a run whose record shows every step accepted and the run landed, when it is resumed, then the session is directed to delivery rather than to any DECIDE step.

### Done When
- [ ] Resume by PR, by branch, and by issue each attach the same run's worktree.
- [ ] A resumed session starts at the first unaccepted step.
- [ ] An unregistered project or an unknown target exits non-zero with no filesystem change.

## Story 8: Anyone may resume, and concurrent saves never lose work

**Requirement:** FR-13, FR-14

As an operator, I want to pick up any run without asking its last operator, while never overwriting someone else's newer progress.

### Acceptance Criteria

#### Happy Path
- Given a run last saved by another operator, when a different operator with repository write access resumes it, then resume proceeds without any release or permission from the previous operator and shows who last worked on the run and when.
- Given two operators resumed the same run, when the first one's checkpoint is pushed, then it succeeds as a fast-forward.

#### Negative Paths
- Given the remote branch advanced after the second operator fetched, when the second operator's checkpoint is pushed, then the push is refused as non-fast-forward, nothing on the remote is overwritten, the local commit is kept, and the diagnostic names the resume command that loads the newer progress.
- Given a push is refused as non-fast-forward, when the checkpoint command finishes, then it never retries with a force push.

### Done When
- [ ] A concurrent second checkpoint is refused without changing the remote ref.
- [ ] No code path issues a forced push of a spec branch.

## Story 9: Local leftovers are never silently discarded or landed on resume

**Requirement:** FR-15

As an operator, I want to choose what happens to unsaved local work when I resume so that nothing I did is lost by accident.

### Acceptance Criteria

#### Happy Path
- Given the resuming machine's worktree has uncommitted `.docs` changes for the run, when resume runs, then it shows the local changes beside the saved remote progress and asks the operator to keep local or discard local.
- Given the operator keeps local work that fast-forwards the remote, when resume continues, then the session starts with the local work in place, and it is saved at the next checkpoint.
- Given the operator discards local work, when resume continues, then a local backup branch `composer-backup/<slug>-<timestamp>` holding the discarded commits and a WIP commit of the dirty files exists, and the worktree matches the remote.

#### Negative Paths
- Given local commits that diverge from the remote, when the operator chooses keep local, then resume refuses, naming the divergent commits and the backup option, and changes nothing.
- Given resume is not on a TTY and local leftovers exist, when it runs, then it refuses without discarding, keeping, or landing anything, and names the leftovers.

### Done When
- [ ] Discarding always leaves a backup branch with every discarded change.
- [ ] Divergent keep-local and non-TTY leftovers exit non-zero with the worktree unchanged.

## Story 10: A deliberate provider switch is recorded distinctly, and an unavailable provider fails closed

**Requirement:** FR-21, FR-22

As an operator auditing a run, I want deliberate provider changes recorded separately from fallback so that provider comparisons are traceable.

### Acceptance Criteria

#### Happy Path
- Given an operator switches from Claude to Codex at the launcher boundary, when the switch happens, then one `composer_provider_switched` event with the run slug, current step, `fromProvider`, `toProvider`, and actor is written to the target's composer event ledger.
- Given a run is resumed, saved, started, or handed off, when each transition happens, then the matching `composer_run_resumed`, `composer_run_checkpointed`, `composer_run_started`, or `composer_run_handed_off` event is written to the same ledger and is accepted by the registered event sinks.

#### Negative Paths
- Given an availability fallback or a retry escalation in a pipeline step, when the events are read, then they remain `provider_fallback` or `step_retry`, and no `composer_provider_switched` event is produced for them.
- Given the chosen provider is not installed when the operator resumes or switches, when the launch is attempted, then it fails closed with a diagnostic naming the provider, the run record and branch are unchanged, and the operator can pick another provider.

### Done When
- [ ] Each new event kind is in the event union and registered in the event sinks.
- [ ] A switch writes exactly one `composer_provider_switched` event.
- [ ] An unavailable provider leaves the branch tip and run record unchanged.

## Story 11: No machine claims or restarts a run that is already in flight elsewhere

**Requirement:** FR-23, FR-24

As an operator with several machines and teammates, I want a run in progress anywhere to be treated as in flight everywhere so that no issue gets a second run.

### Acceptance Criteria

#### Happy Path
- Given an intake run's first checkpoint opened a draft spec PR, when the local ledger is read, then the entry is `deciding` with the branch and the draft PR URL recorded as the draft PR, not as delivery evidence, and stale-claim recovery never requeues it.
- Given a machine with no ledger history for an issue, when its pending candidate is cross-referenced by an open spec PR, then claim records the entry as `deciding` with that draft PR and does not hand the idea to a session.
- Given a pending candidate whose issue has no cross-referencing spec PR, when claim runs, then it is served exactly as before this feature.
- Given an operator resumes a run on a new machine, when resume completes, then that machine's ledger holds the entry as `deciding` with the run's branch and PR.

#### Negative Paths
- Given a `deciding` entry whose draft spec PR is still an open draft, when the delivery guard verifies it, then the entry is held as in flight, its duplicate envelopes are dropped, and it is not healed to `done`.
- Given the cross-reference lookup for a pending candidate fails, when claim runs, then the candidate is skipped and stays `pending`, and it is never served on uncertainty.
- Given a `deciding` entry whose draft spec PR became ready or merged, when the delivery guard verifies it, then the entry heals to `done` with that PR recorded as its delivery evidence.
- Given a `deciding` entry whose draft spec PR was closed unmerged, when the delivery guard verifies it, then the entry is reopened to `pending` under the existing re-eligibility cap.
- Given an entry with an open, non-draft spec PR recorded as delivery evidence, when the delivery guard verifies it, then it heals to `done` exactly as before this feature.
- Given any save, resume, switch, or hand-off, when the source issue is read afterwards, then its assignees are exactly as before.

### Done When
- [ ] A first checkpoint moves the ledger entry to `deciding` with the draft PR URL and no delivery-evidence PR URL.
- [ ] An open draft PR holds the entry, and a ready or merged PR heals it to `done`.
- [ ] No new code path issues an assignee change.

## Story 12: Delivery readies the existing draft pull request and is retry-safe

**Requirement:** FR-25, FR-27

As an operator, I want handoff to finish the run's own draft PR so that delivery never fails because a PR already exists.

### Acceptance Criteria

#### Happy Path
- Given a landed run with an open draft spec PR, when handoff runs, then it pushes the branch, updates the PR title and body to the landed spec format with the release metadata and the `Refs` line, marks the PR ready for review, prints the same `pr-opened` result with the PR URL that a created PR produces, records the ledger entry as `done`, applies `engineer:handled`, and wakes the daemon once.
- Given a landed run whose draft PR was never created, when handoff runs, then it creates the spec PR as before.

#### Negative Paths
- Given marking the PR ready fails after the push, when handoff exits, then it exits non-zero, keeps the worktree, and does not record the ledger entry as `done`.
- Given a handoff is re-run after that failure, when it succeeds, then exactly one spec PR exists for the branch, the issue has one delivery comment, and the daemon was woken once for the delivered spec.
- Given handoff is re-run after a fully successful delivery, when it runs, then it creates no second PR, posts no second delivery comment, and records no second ledger transition.

### Done When
- [ ] Handoff over an existing draft PR leaves one ready PR and no new PR.
- [ ] A re-run after any partial failure produces no duplicate PR, comment, ledger transition, or daemon wake.

## Story 13: Single-session runs, projects with no remote, and standalone primitives keep working

**Requirement:** FR-28, FR-29, FR-30

As an existing Composer user, I want my usual one-sitting flow to keep working so that resume and hand-off add capability without new chores.

### Acceptance Criteria

#### Happy Path
- Given a run completed in one session with one provider, when it is delivered, then the operator never had to run a switch, resume, or hand-off action, and the only visible differences from before are per-step saves and the spec PR starting as a draft.
- Given a project with no remote, when steps are accepted, then each checkpoint commits locally with no push and no PR, and resume on the same machine continues the run.
- Given an operator runs `compose land` or `compose handoff` directly on a worktree without using the launcher, when the run record is absent or present, then each primitive works on its own.

#### Negative Paths
- Given a project with no remote, when an operator asks to hand off to another machine or person, then it is refused with an explanation that the run exists only locally.
- Given a project with no remote, when the run record's local commit history is read, then every accepted step still has its record entry, even though no push happened.

### Done When
- [ ] A one-session run delivers with no new operator action.
- [ ] A no-remote run checkpoints locally, resumes locally, and refuses remote hand-off.

## Story 14: Resuming another operator's run asks about build ownership

**Requirement:** FR-31

As a teammate resuming a run, I want to decide whether I take over building the delivered spec so that the right person's daemon builds it.

### Acceptance Criteria

#### Happy Path
- Given a run whose committed owner is operator A, when operator B resumes it interactively and accepts the take-over, then the owner marker is re-stamped to B in a commit pushed under one interactive approval for that exact branch push, the run record's owner history gains an A-to-B entry, and B's later checkpoints push without an extra approval.
- Given B declined the take-over, when B checkpoints, then the commit is made locally, no push or PR write to A's branch is attempted, the owner remains A, and the output says the run stays local until B takes over.
- Given B took over, when the spec is merged, then B's daemon owns the build of the merged spec and A's daemon does not.

#### Negative Paths
- Given B resumes without a TTY, when the run's owner is A, then no take-over prompt or re-stamp happens and the run continues local-only, naming the owner and the interactive take-over option.
- Given an engine-dispatched or daemon session, when it resumes or checkpoints a run owned by another operator, then it never re-stamps the owner and makes no remote write to that branch.
- Given B is asked to approve the take-over push and refuses, when resume continues, then the re-stamp commit is not pushed, the owner remains A, and the run continues local-only.
- Given a take-over, when it is performed, then no consent from A is requested and the source issue's assignees are unchanged.
- Given the resuming machine's owner cannot be resolved, when resume runs, then it refuses before asking about ownership or writing anything, naming the unresolved identity.

### Done When
- [ ] An accepted take-over commits a re-stamped owner marker and an owner-history entry.
- [ ] A declined take-over keeps the owner and makes no remote write to the owner's branch.
