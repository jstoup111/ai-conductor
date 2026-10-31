**Status:** Accepted

# Stories: Restack resolver accepts an operator decision (#3478)

Technical track (no PRD). Sources:
- the scope boundary in `.docs/track/restack-resolver-asks-for-an-operator-decision-no-.md`;
- `adr-2026-10-31-operator-decision-for-stacked-restack-conflicts` decisions 1–6;
- `architecture-review-2026-10-31-restack-resolver-asks-for-an-operator-decision-no-`;
- the desired outcomes of #3478 and of #3460, which was merged into it.

Terms used below:
- **Stack:** a feature with slug `demo` whose sealed plan declares slices at positions `1`, `2` and
  `3`, with `stacked_prs.enabled` on.
  - `feat/c1/demo` and `feat/c2/demo` are closed at `refs/conductor/demo/closed/c1` and `closed/c2`.
  - The leaf is `feat/daemon-demo`.
  - Child 2's own commits edit `src/flag.ts`.
- **Repair conflict on child 2:** a routed `feature-repair` restack of the stack that halted
  needs-human on an unresolved conflict replaying child 2's commit `C` on `src/flag.ts`.
  - The resolver's reason names a missing decision.
  - Nothing has moved.
- **Base-refresh conflict on child 2:** a `base-refresh` restack of the stack onto a new default
  branch tip that halted the same way, on the same commit and path.
- **Fake resolver:** a test resolver injected at the production resolver seam. It records the
  context it receives. It returns resolved when that context carries an operator decision and
  unresolved otherwise, unless a scenario says it ignores the decision.
- **Recorded decision:** after a conflict halt on child 2,
  `ai-conductor stack restack-resolve --slug demo --child 2 --decision "keep upstream's resolveReviewScope seam"`
  has exited 0.

## Story 1: A base-refresh conflict halt records the conflict and offers both answers

**Requirement:** #3478 outcome 4 and #3460 outcome 2 (ADR decisions 1 and 6)

As an operator facing a base-refresh restack conflict, I want the same recorded conflict and recipes a repair conflict gets, so that a base-refresh conflict is no longer a dead end.

### Acceptance Criteria

#### Happy Path
- Given a base-refresh conflict on child 2, when the halt is written, then `refs/conductor/demo/restack/conflict/record` names child 2, the run's opId, child 2's old parent and old tip, the new parent with its tree id, the ordered replay-candidate subjects, commit `C` and `src/flag.ts`, and `restack/conflict/parent` pins the new parent.
- Given the same halt, when the operator reads `.pipeline/HALT`, then it contains `Restack-Conflict: 2 <opId>`, the scratch-branch rebase and `stack restack-resolve --tip` recipe with real shas, and the command `ai-conductor stack restack-resolve --slug demo --child 2 --decision "<answer>"`.
- Given a repair conflict on child 2, when the operator reads `.pipeline/HALT`, then it carries the `--decision` command in addition to the shipped `--tip` recipe.
- Given a base-refresh conflict on child 2 and a valid resolution tip recorded with `--tip`, when the next base-refresh restack builds on a parent with the recorded parent's tree, then it uses the recorded tip for child 2, emits `restack_resolution` with `action: consumed`, and the applied restack moves `feat/c2/demo` and `closed/c2` to the rebuilt commits with no hand edit to any ref.

#### Negative Paths
- Given the base-refresh conflict on child 2, when the halt is written, then no `feat/` branch, no `refs/conductor/demo/closed/*` ref and no default-branch ref has moved.
- Given a base-refresh conflict on child 2 whose range contains a merge commit, when the restack conflicts, then it halts with the shipped `flatten_refused` reason and text, and no `restack/conflict/*` ref is created.
- Given a recorded base-refresh tip, when the default branch advanced before the next base-refresh restack so that the parent being built has a different tree, then the restack moves no branch or closure ref, halts `restack-resolution-stale` naming the parent tree, and keeps the resolution and the record.
- Given a base-refresh conflict halt written by journal recovery resuming a planned journal, when the operator reads it, then it carries the same record and both recipes as an executor-written halt.

### Done When
- [ ] A real-git test drives a base-refresh restack into an unresolved conflict on child 2 and asserts the record fields, the parent pin, and that no branch or closure ref moved.
- [ ] A test asserts the HALT text of a base-refresh and a repair conflict both contain the `Restack-Conflict` line, the `--tip` recipe with concrete shas, and the `--decision` command.
- [ ] A real-git test records a tip for a base-refresh conflict and asserts the next restack applies it and emits `restack_resolution` `consumed`.
- [ ] A real-git test advances the default branch after a recorded base-refresh tip and asserts the `restack-resolution-stale` halt with nothing moved.

## Story 2: The operator records a decision and clears only its own halt

**Requirement:** #3478 outcomes 1 and 2 (ADR decisions 2 and 5)

As an operator asked for a missing decision, I want to give the answer in one command, so that I do not have to rebase the child myself.

### Acceptance Criteria

#### Happy Path
- Given a repair conflict or a base-refresh conflict on child 2, when the operator records a decision, then the command exits 0, `refs/conductor/demo/restack/decision/c2` holds the answer with child 2, its old parent and old tip, commit `C`, `src/flag.ts` and the operator identity, and `.pipeline/HALT` and `.pipeline/HALT.class` are removed.
- Given the same command, when it succeeds, then `.pipeline/events.jsonl` gains one `restack_decision` event with `action: recorded`, child 2, commit `C`, paths `["src/flag.ts"]` and the operator, and the event does not contain the answer text.
- Given a decision already recorded for child 2 and a later conflict halt on child 2, when the operator records a different answer, then the decision ref holds the new answer, replaced with compare-and-swap.
- Given a resolution tip recorded for child 2 whose HALT clear failed so the conflict HALT is still live, when the operator records a decision, then `restack/resolution/c2` is deleted and `restack/decision/c2` is written in one compare-and-swap transaction, and the HALT is cleared.
- Given a decision recorded for child 2 whose HALT clear failed so the conflict HALT is still live, when the operator records a valid tip with `--tip`, then `restack/decision/c2` is deleted and `restack/resolution/c2` is written in one compare-and-swap transaction.

#### Negative Paths
- Given a conflict halt on child 2, when the operator passes both `--tip` and `--decision`, or neither, then the command exits 1 with `stack restack-resolve: refused — ` naming the flag conflict, and writes no ref, appends no event and leaves the HALT.
- Given a conflict halt on child 2, when the operator passes an empty answer or one longer than 4,000 characters, then the command exits 1 naming the answer length, and writes nothing.
- Given the conflict record names child 3, when the operator records a decision for child 2, then the command exits 1 naming the recorded child, and writes nothing.
- Given no live HALT carries `Restack-Conflict: 2 <opId>`, including after a `--tip` resolution already cleared it, when the operator records a decision, then the command exits 1 with `no matching restack-conflict halt is live`, and writes nothing.
- Given another process holds the feature dispatch lease, when the operator records a decision, then the command exits 1 with the lease refusal and writes nothing.
- Given the command runs inside a daemon session, when it is invoked, then it is refused as a non-sanctioned subcommand and writes nothing.
- Given the decision ref changed concurrently between its read and its write, when the operator records a decision, then the compare-and-swap fails, the command exits 1 with `could not record decision`, and the HALT stays in place.
- Given the decision ref was written but the event append fails or no operator identity is available, when the command finishes, then it exits 1 with `stack restack-resolve: recorded but could not` naming the step, the HALT stays in place, and rerunning the command completes it.

### Done When
- [ ] A test asserts a successful `--decision` writes the decision blob with every identity field, appends exactly one `restack_decision` `recorded` event without the answer text, and removes the HALT.
- [ ] Tests assert each refusal above exits 1 with its named cause and leaves refs, events and the HALT unchanged.
- [ ] A test asserts a failure after the ref write leaves the HALT in place and a rerun completes.

## Story 3: The next restack hands a matching decision to the resolver and completes

**Requirement:** #3478 outcomes 1 and 2; #3460 outcomes 1 and 2 (ADR decisions 3 and 4)

As an operator who answered the resolver, I want the next restack to apply my answer, so that the feature resumes with no manual edits to branches or `refs/conductor/*`.

### Acceptance Criteria

#### Happy Path
- Given a recorded decision for a repair conflict on child 2, when the next routed exit restack replays child 2, then the fake resolver receives a context carrying the answer, commit `C` and `src/flag.ts`, and `.pipeline/events.jsonl` gains `restack_decision` with `action: applied`, child 2 and the running opId before the resolver result.
- Given a recorded decision for a base-refresh conflict on child 2, when the next base-refresh restack replays child 2 onto a default branch that advanced since the halt, then the decision is still delivered to the fake resolver and `restack_decision` `applied` is emitted.
- Given the fake resolver settles child 2 with the decision, when the restack applies, then `feat/c2/demo` and `closed/c2` move to the resolved commits through the shipped transaction, closed child 2 is queued for re-validation before the leaf, and no `closed-child-rewritten` divergence is reported.
- Given the same applied restack, when its transaction commits, then `restack/decision/c2`, `restack/conflict/record` and `restack/conflict/parent` are deleted.
- Given a recorded tip for child 2 that the operator replaced with a recorded decision, when the next restack reaches child 2, then no resolution is consumed and the decision is delivered to the resolver.
- Given a decision delivered by the provider resolver prompt, when the prompt is built, then it states the operator's decision for commit `C` on `src/flag.ts` and instructs the resolver to apply it rather than escalate the same question.

#### Negative Paths
- Given a delivered decision, when `restack/decision/c2` is changed by another process after delivery and before the move, then the move fails its compare-and-swap with no branch or closure ref moved and the restack halts `stack-ref-changed` naming the decision ref.
- Given a delivered decision, when the restack aborts or halts for any other reason, then `restack/decision/c2` is kept.
- Given the feature is torn down, when its conductor refs are deleted, then `restack/decision/c<k>` is deleted by name for every child id, and refs of other features are untouched.
- Given `restack/decision/c2` holds a malformed blob, when the next restack replays child 2, then no decision is delivered, the resolver runs as today, and an escalation halt names the unreadable decision.

### Done When
- [ ] A real-git test with the fake resolver records a decision on a repair conflict, re-runs the routed exit restack, and asserts delivery, the `applied` event, the moved branch and closure ref, re-validation queueing, and the deleted decision and conflict refs.
- [ ] A real-git test does the same for a base-refresh conflict after advancing the default branch.
- [ ] A test asserts the production resolver wiring passes the decision into the `resolveRebaseConflict` prompt.
- [ ] Tests assert that recording either answer deletes the other kind for the same child in one transaction, and that the next restack uses only the latest answer.
- [ ] Tests assert the decision ref is verified in the move, kept on abort, and deleted by feature teardown.

## Story 4: A decision that does not settle the conflict, or no longer matches, escalates visibly

**Requirement:** #3478 outcomes 1, 2 and 5 (ADR decision 3)

As an operator, I want a failed or stale decision to be named in the next halt, so that I can tell an ignored answer from a missing one.

### Acceptance Criteria

#### Happy Path
- Given a recorded decision for child 2 and a fake resolver that ignores it, when the next restack replays child 2, then it halts needs-human with a conflict halt whose detail names the applied decision and the resolver's new reason, rewrites the conflict record, and keeps `restack/decision/c2`.
- Given a recorded decision for child 2 whose old tip no longer equals child 2's range, when the next restack replays child 2, then the decision is not delivered, `restack_decision` with `action: stale` and child 2 is emitted, and the resolver runs with no decision.
- Given the stale decision and an escalating resolver, when the halt is written, then it names the stale decision and carries both recipes.

#### Negative Paths
- Given a recorded decision for child 2 that the resolver ignores, when the halt is written, then no branch or closure ref has moved.
- Given a decision recorded for child 2, when child 3's replay conflicts, then the decision is not delivered to child 3's resolver.

### Done When
- [ ] A real-git test asserts the escalation halt text names the applied decision and keeps the decision ref, with nothing moved.
- [ ] A real-git test asserts a stale decision emits `restack_decision` `stale`, is not delivered, and is named by the escalation halt.

## Story 5: Restacks with no operator decision behave as before

**Requirement:** #3478 outcome 5 (ADR decision 6)

As an operator, I want conflicts I have not answered to escalate exactly as they do today, so that the decision channel never changes unanswered work.

### Acceptance Criteria

#### Happy Path
- Given a repair conflict on child 2 and no decision or resolution ref, when the next restack replays child 2, then the resolver context carries no operator decision, no `restack_decision` event is emitted, and the halt text matches the shipped repair conflict halt plus the `--decision` command.
- Given a flat feature whose plain rebase conflicts, when the rebase resolver prompt is built, then it is byte-identical to the prompt before this change.

#### Negative Paths
- Given a restack the resolver settles without a decision, when it applies, then its events, refs and moved branches are identical to the shipped behavior.
- Given an N=1 feature or a feature with `stacked_prs.enabled` off, when `stack restack-resolve --decision` is run for it, then the command exits 1 with `feature is not stacked` and writes nothing.

### Done When
- [ ] A test asserts the resolver context and events for an unanswered conflict carry no decision.
- [ ] A test asserts the plain rebase resolver prompt is unchanged when no decision is present.
- [ ] A test asserts `--decision` on a flat feature is refused with nothing written.
