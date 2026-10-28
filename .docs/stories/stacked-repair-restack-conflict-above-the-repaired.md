**Status:** Accepted

# Stories: Accept an operator-recorded resolution for a stacked restack conflict above the repaired child (#3421)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/stacked-repair-restack-conflict-above-the-repaired.md`;
- `adr-2026-10-25-operator-recorded-restack-conflict-resolution` decisions 1–9;
- the conditions of `architecture-review-2026-10-25-stacked-repair-restack-conflict-above-the-repaired`;
- the desired outcomes of #3421.

Terms used below:
- **Repaired stack:** a feature with slug `demo` whose sealed plan declares slices at positions
  `1`, `2` and `3`, with `stacked_prs.enabled` and `stacked_prs.route_whole_feature_fixes` on.
  - `feat/c1/demo` and `feat/c2/demo` are closed at `refs/conductor/demo/closed/c1` and `closed/c2`.
  - The leaf is `feat/daemon-demo`.
  - A routed repair round has host 1, and its region has passed. `feat/c1/demo` carries repair
    commits past `closed/c1` that rename `oldName` to `newName` in `src/flag.ts`.
  - Child 2's own commits use `oldName` in `src/flag.ts`, so replaying them over the repair conflicts.
- **Conflict halt on child 2:** the repaired stack after its routed exit restack has halted needs-human
  on an unresolved conflict replaying child 2. Nothing has moved.
- **Valid resolution:** a commit reached by running the halt's printed rebase on a scratch branch
  named `restack-resolve/demo/c2` and resolving the conflict so that child 2's commits use `newName`.
  It keeps every one of child 2's commit subjects and changes only paths child 2's range already
  touched.
- **Recorded resolution:** a valid resolution after
  `ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>` has exited 0.
- **Flat feature:** a feature with no child branch, closure ref or `.pipeline/children/` directory.

## Story 1: A repair restack conflict halt records the conflict and prints a recipe that works

**Requirement:** #3421 outcomes 4 and 5 (ADR decisions 1 and 2)

As an operator facing a restack conflict the engine could not resolve, I want the halt to tell me exactly how to produce an acceptable resolution, so that following it literally gets the feature moving again.

### Acceptance Criteria

#### Happy Path
- Given the repaired stack, when the routed exit restack cannot resolve the conflict on child 2, then `refs/conductor/demo/restack/conflict/record` holds a record naming child 2, the run's opId, child 2's journaled old parent and old tip, the parent the replay was building on with its tree id, child 2's ordered replay-candidate subjects, the conflicting commit and its paths.
- Given the same halt, when the operator reads `.pipeline/HALT` and the committed halt record, then both contain the line `Restack-Conflict: 2 <opId>`, the commit, the paths, and the commands `git switch -c restack-resolve/demo/c2 <old tip>`, `git rebase --onto <new parent> <old parent>` and `ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>` with the real shas filled in.
- Given the same halt, when its restack journal is cleaned after the HALT clears, then `restack/conflict/record` and `restack/conflict/parent` still exist and the parent pin still names the recorded parent commit.
- Given a conflict halt on child 2 written by journal recovery resuming a planned journal, when the operator reads it, then it carries the same record and recipe as an executor-written halt.

#### Negative Paths
- Given the same halt, when the operator reads its text, then it contains neither an instruction to rebase or commit on `feat/c2/demo` or `feat/daemon-demo` nor an instruction to move any `refs/conductor/demo/closed/*` ref.
- Given a base-refresh restack that halts on an unresolved conflict, when the halt is written, then no `restack/conflict/*` ref is created and the halt text is byte-identical to today's.
- Given the repaired stack whose child 2 range contains a merge commit, when the routed exit restack conflicts on child 2, then it halts with the shipped `flatten_refused` reason and text, and no `restack/conflict/*` ref is created.
- Given the repaired stack whose replay of child 2 halts on a `rem-*` block body mismatch, when the halt is written, then the conflict record is written as for any unresolved conflict, and no branch or closure ref has moved.
- Given a conflict record from an earlier halt, when a later conflict halt is written on child 3, then the record names child 3 and the earlier record is replaced in one compare-and-swap.
- Given the conflict record cannot be written because its ref changed concurrently, when the conflict halt is raised, then the needs-human HALT is still written, it names the record write failure, and no branch or closure ref has moved.

### Done When
- [ ] A real-git test drives a routed repair restack into an unresolved conflict on child 2 and asserts the record's fields and both conflict refs.
- [ ] A test asserts the halt text contains the reason line and the three commands with concrete shas, and contains no command touching `feat/` branches or closure refs.
- [ ] A test asserts both conflict refs survive `cleanJournal`.
- [ ] A test asserts a base-refresh conflict halt writes no conflict ref and keeps today's text.

## Story 2: The operator records a validated resolution and clears only its own halt

**Requirement:** #3421 outcome 1 (ADR decisions 3 and 8)

As an operator who has resolved the conflict, I want one command to check my resolution and release the halt, so that the next dispatch can use it.

### Acceptance Criteria

#### Happy Path
- Given the conflict halt on child 2 and a valid resolution, when the operator runs `ai-conductor stack restack-resolve --slug demo --child 2 --tip <sha>`, then the command exits 0, `refs/conductor/demo/restack/resolution/c2` names `<sha>`, `.pipeline/HALT` and `.pipeline/HALT.class` are gone, and a `restack_resolution` event with action `recorded`, child 2, the tip and the resolved machine operator identity is persisted before the HALT files were removed.
- Given the same successful command, when the daemon next dispatches `demo`, then the committed halt record `.docs/halted/demo.md` is superseded by the shipped resume path exactly as for any other cleared halt, and no `halt_clear_authorized` event is appended by the command.
- Given a resolution ref already written for child 2 by an earlier attempt that failed before clearing the still-live conflict HALT, when the operator re-runs the command with a different valid tip, then the command exits 0, `restack/resolution/c2` names the new sha, and the HALT is cleared.
- Given the conflict halt on child 2 and no live lease owner, when the command runs, then it holds the feature dispatch lease for its whole mutation and releases it before exiting.

#### Negative Paths
- Given the conflict halt on child 2 and a tip that does not descend from the recorded parent, when the operator runs the command, then it exits non-zero naming the recorded parent sha as the missing ancestor, no `restack/resolution/c2` ref exists, and the HALT is unchanged.
- Given the conflict halt on child 2 and a tip from which one of child 2's commit subjects is missing, when the operator runs the command, then it exits non-zero listing the missing subject, writes no resolution ref, and leaves the HALT in place.
- Given the conflict halt on child 2 and a tip that also changes `src/other.ts`, which child 2's range never touched, when the operator runs the command, then it exits non-zero naming `src/other.ts` as unowned, writes no resolution ref, and leaves the HALT in place.
- Given the conflict halt on child 2 and a tip whose range from the recorded parent contains a merge commit, when the operator runs the command, then it exits non-zero naming the merge commit, writes no resolution ref, and leaves the HALT in place.
- Given the conflict halt on child 2, when the operator runs the command with `--child 3`, then it exits non-zero stating the conflict record names child 2, and writes nothing.
- Given the repaired stack with no conflict record, when the operator runs the command, then it exits non-zero stating no restack conflict is recorded for `demo`, and writes nothing.
- Given the conflict record for child 2 but a live HALT for another reason with no `Restack-Conflict` line, when the operator runs the command with a valid resolution, then it exits non-zero stating no matching restack-conflict halt is live, writes no resolution ref, and leaves that HALT untouched.
- Given a live daemon dispatch holding the feature dispatch lease, when the operator runs the command, then it exits non-zero naming the lease owner's purpose and pid, and writes nothing.
- Given the command runs inside a daemon session, when it is invoked, then it is refused before any read of the feature, naming the daemon session.
- Given a flat feature, when the operator runs the command, then it exits non-zero stating the feature is not stacked, and writes nothing.
- Given `--tip` names something that does not resolve to a commit, when the operator runs the command, then it exits non-zero naming the unresolvable value, and writes nothing.
- Given validation passed and the resolution ref was written, when appending the `restack_resolution` event fails, then the command exits non-zero naming the event failure, `.pipeline/HALT` and `.pipeline/HALT.class` are still present, and the resolution ref stays recorded for the next attempt.
- Given validation passed and the resolution ref was written, when the atomic HALT clear fails, then the command exits non-zero naming the HALT failure, the HALT and its class file are still present, and the resolution ref stays recorded for the next attempt.

### Done When
- [ ] A real-git CLI test records a valid resolution and asserts the resolution ref, the cleared HALT and class files, the persisted `restack_resolution recorded` event, and the lease acquire/release order.
- [ ] Real-git CLI tests cover each refusal and assert the exit code, the named cause, no resolution ref, and a byte-identical HALT.
- [ ] A test asserts the daemon-session refusal happens before any feature read.

## Story 3: The next dispatch applies the recorded resolution without replaying child 1's repair again

**Requirement:** #3421 outcome 1 (ADR decisions 4 and 8)

As an operator who recorded a resolution, I want the next dispatch to carry it into the stack, so that the restack applies instead of conflicting again.

### Acceptance Criteria

#### Happy Path
- Given a recorded resolution and the HALT cleared, when the daemon dispatches `demo`, then the routed exit restack applies, `feat/c2/demo` and `closed/c2` have the resolution's tree, child 1's repair commits appear exactly once in `feat/c2/demo`'s history, and child 2's journal entry is `resolved`.
- Given the same dispatch, when the restack replays the children above child 2, then the leaf `feat/daemon-demo` is replayed onto the new `closed/c2` as an ordinary replay, and contains child 1's repair commits exactly once.
- Given a four-position stack where children 2 and 3 are above repaired child 1, a conflict halt on child 3 and a recorded resolution for child 3, when the next dispatch rebuilds child 2 with a new commit id but the same tree, then the resolution for child 3 is consumed and the restack applies.
- Given the same dispatch, when the resolution is consumed, then a `restack_resolution` event with action `consumed` and child 2 is persisted.
- Given a recorded resolution, when the restack is driven by journal recovery resuming a planned journal instead of a fresh executor run, then the resolution is consumed with the same result.

#### Negative Paths
- Given a recorded resolution, when another change moved `closed/c1` before the next dispatch so that the parent being built has a different tree from the recorded one, then the restack moves no ref, halts needs-human with reason `restack-resolution-stale` naming the parent tree mismatch, emits `restack_refused` with that reason, and keeps both the resolution and the conflict record.
- Given a recorded resolution, when child 2's journaled range differs from the record's old parent or old tip at the next dispatch, then the restack halts `restack-resolution-stale` naming the range mismatch, and moves no ref.
- Given a recorded resolution, when the rebuilt result fails the path-ownership check at consumption, then the restack halts needs-human naming the unowned paths and moves no ref.
- Given a resolution ref for child 2 but no conflict record, when the next dispatch reaches child 2, then the restack halts `restack-resolution-stale` naming the missing record, and moves no ref.

### Done When
- [ ] A real-git test runs halt → `stack restack-resolve` → second restack and asserts the applied refs, child 2's tree, a single occurrence of each repair commit in the child 2 and leaf histories, and the `resolved` journal status.
- [ ] A real-git test with two replayed children above the origin proves tree-matched consumption when the lower child's commit id changes.
- [ ] Real-git tests for each stale and ownership case assert the halt reason, the named field, unmoved refs, and retained resolution refs.
- [ ] A recovery test asserts `resumePlanned` consumes the resolution the same way.

## Story 4: An operator-resolved restack keeps every post-restack guarantee

**Requirement:** #3421 outcome 2 (ADR decision 6)

As an operator, I want a restack I resolved by hand to be validated exactly like one the engine resolved, so that nothing I changed escapes the gates.

### Acceptance Criteria

#### Happy Path
- Given a recorded resolution consumed by the routed exit restack, when the restack applies, then the routed round's record gains its terminal `restacked` occurrence and the round closes as it does after an engine-resolved restack.
- Given the same applied restack, when the transition runs, then closed child 2 is queued for re-validation and is re-validated before the leaf, and the leaf's `prd_audit` and `manual_test` gates are pending after `returnToLeaf`.
- Given the same applied restack, when child 2's re-validation runs, then it completes without a `no_task_progress` stall caused by untranslated evidence for the resolved commits.

#### Negative Paths
- Given the same applied restack, when child 2's re-validation fails a gate, then the failure is handled exactly as for an engine-resolved restack, inside child 2's region under its caps, and the leaf gates do not run first.
- Given two of child 2's original commits share one subject, when the resolution is consumed, then the duplicate-subject commits are left to patch-id reconstruction, the restack still applies, and re-validation still runs.

### Done When
- [ ] An integration test drives a routed conflict halt, `stack restack-resolve` and a second dispatch through to the round's `restacked` occurrence, child 2's re-validation and pending leaf gates.
- [ ] A test asserts no `no_task_progress` halt across the resolve-then-revalidate path.
- [ ] A test with duplicate subjects asserts the restack applies and re-validation runs.

## Story 5: A recorded resolution lives exactly until the restack that uses it applies

**Requirement:** #3421 outcomes 3 and 5 (ADR decision 5)

As an operator, I want my recorded resolution kept until it is used and then cleaned up, so that I never lose work and stale state never lingers.

### Acceptance Criteria

#### Happy Path
- Given a recorded resolution consumed by a restack, when that restack's applied transaction commits, then `restack/resolution/c2`, `restack/conflict/record` and `restack/conflict/parent` are deleted in the same transaction.
- Given a feature carrying a recorded resolution and a conflict record, when the feature is torn down by the single-slug reclaim, then all of those refs are deleted by name.

#### Negative Paths
- Given a recorded resolution, when the next restack aborts for any reason before applying, then the resolution ref and both conflict refs are unchanged and still name the same objects.
- Given a recorded resolution consumed by a restack, when one of the resolution or conflict refs changes before the ref move, then the move's compare-and-swap fails, the restack does not apply, it halts `stack-ref-changed` naming the changed ref, and no branch or closure ref has moved.
- Given a teardown of another feature whose slug is a prefix of `demo`, when it runs, then none of `demo`'s resolution or conflict refs is deleted.

### Done When
- [ ] A real-git test asserts the refs are deleted atomically with the applied transaction.
- [ ] A real-git test asserts an aborted restack leaves them unchanged.
- [ ] A test asserts `featureConductorRefNames` lists the conflict refs and `restack/resolution/c<k>` for every child id, and that teardown of a prefix slug leaves `demo`'s refs intact.

## Story 6: Routed exit restacks use the provider resolver and report the restack's own reason

**Requirement:** #3421 adjacent defects (ADR decision 7)

As an operator, I want a routed repair conflict to reach the engine's resolver first and any halt to say why it stopped, so that fewer conflicts need me and the ones that do are diagnosable.

### Acceptance Criteria

#### Happy Path
- Given the repaired stack and a configured restack resolver, when the routed exit restack conflicts on child 2, then the resolver is invoked for child 2 with the configured resolution-attempt cap before any halt is written.
- Given a resolver that resolves the conflict, when the routed exit restack runs, then the restack applies and no HALT is written.
- Given a resolver that gives up with reason `could not reconcile renamed symbol`, when the routed exit halts, then the loop halt reason and the committed halt record both contain `restack conflict child 2` and `could not reconcile renamed symbol`, not only the word `halted`.

#### Negative Paths
- Given a resolver that is unavailable because every provider fails setup, when the routed exit restack conflicts, then the halt reason names the resolver failure instead of `restack resolver unavailable`, and no ref moves.
- Given a routed exit restack that halts for a non-conflict reason such as `cascade-cap`, when the routed exit reports it, then its halt detail contains the restack's `cascade-cap` reason.

### Done When
- [ ] A test asserts `requestRoutedExit` passes the conductor's restack resolver and `resolveRebaseResolutionAttempts(config)` to `runRestack`.
- [ ] A test asserts a resolver success applies the routed restack with no HALT.
- [ ] Tests assert the routed halt detail carries the restack's conflict or refusal reason for both a conflict and a cascade-cap halt.

## Story 7: Restacks with no operator resolution behave exactly as today

**Requirement:** #3421 outcome 6 (ADR decision 9)

As an operator of features that never need a hand resolution, I want nothing to change for them.

### Acceptance Criteria

#### Happy Path
- Given the repaired stack with no resolution ref, when the routed exit restack replays child 2 cleanly, then the applied refs, the journal statuses and the emitted events are identical to today's for the same input.
- Given a flat feature, when it rebases onto a new default, then no `restack/conflict/*` or `restack/resolution/*` ref is read or written and the N=1 golden suite is unchanged.

#### Negative Paths
- Given the repaired stack with no resolution ref, when child 2's replay conflicts and the resolver gives up, then the restack halts as Story 1 describes and the engine itself creates no `restack/resolution/*` ref.
- Given routing is off, when a raw commit on `feat/c1/demo` triggers today's automatic feature-repair restack and it replays cleanly, then the behavior is identical to today's and no conflict ref is written.

### Done When
- [ ] A parity test asserts today's replay path and outputs with no resolution ref present.
- [ ] The N=1 golden guard passes unchanged.
