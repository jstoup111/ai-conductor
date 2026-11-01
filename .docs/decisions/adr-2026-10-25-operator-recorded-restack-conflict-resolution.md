# ADR: An operator-recorded resolution settles a stacked repair restack conflict above the repaired child

**Date:** 2026-10-25
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #3421

## Context

A routed `feature-repair` on a stacked feature adopts every child through the highest originating
child unchanged. It replays each child above that point from its journaled range onto the rebuilt
chain (`adr-2026-10-10-stacked-restack-journaled-replay` decisions 2 and 6). When a replay conflicts
and the resolver cannot settle it, the journal aborts and the engine halts needs-human, naming the
child, the commit and the paths.

#3421 recorded what happens next on PR #3414 (children 1–2, repair of child 1). The recovery is
not followable:

- **The planner ignores a hand rebase (verified).** The runbook says to "settle the conflict on the
  named child's branch". The operator did so, rebasing child 2 onto child 1's new tip. The next
  dispatch re-planned child 2's range from child 1's old closure (`restack-plan.ts`,
  `planRestackRanges`), replayed child 1's repair commits on top of themselves, and conflicted
  again.
- **The adopt rule stops at the origin (verified).** Recovery and the executor adopt an existing
  branch only through the highest origin (`restack-recovery.ts` `resumePlanned`,
  `restack-executor.ts` `runRestack`). A child above it is always replayed.
- **The routed exit has no resolver (verified).** `requestRoutedExit` (`routing/routed-exit.ts`)
  calls `runRestack` without a resolver or cap, so every routed conflict reaches the
  `restack resolver unavailable` stub. Its `restackDetail` also reduces a halted result to the bare
  word `halted`, so the routed halt hides the restack's reason.
- **Moving the closure ref by hand wedges the executor (out of scope).** It left the repairing
  marker in place, and the executor exited without an outcome. This ADR does not address that
  path.
- **Correction to the issue.** The hand resolution was not discarded by the engine. The operator
  session's own `git update-ref` reset it at 12:16:06Z.

Two forces constrain the fix:

- **Replayed commit ids are not stable across runs (verified).** Replayed commits carry the
  journal's committer stamp, whose date is taken at journal creation (`committerStamp`). A child
  above another replayed child therefore sits on a different parent commit on every run, even
  though the parent's tree is identical.
- **The prerequisites shape the command (on main, unbuilt).** #3203
  (`adr-2026-10-24-operator-route-round-for-closed-stacked-children`) introduces the `stack`
  operator CLI family, the feature dispatch lease, and the rule that an operator halt is cleared
  only by the command that resolves it. #3365 (`adr-2026-10-23-slice-topology-from-sealed-plan`)
  reads slice topology through one loader. This spec builds on both.

## Options Considered

### Option A: Adopt a moved upper branch (filer hypothesis 1)
- **Pros:** No new command. The current runbook wording becomes true.
- **Cons:** For the leaf, the planner uses the live branch tip as the range's old tip, so an
  adopted change shows an empty post-restack delta and re-pends no gates. A moved closed child
  trips `closed-child-rewritten`. The fix would need core planner exemptions and a durable conflict
  record anyway. It would refuse late, at the next dispatch, and leave the HALT to manual removal.

### Option B: An operator command records a validated resolution, consumed as resolver output (chosen)
- **Pros:** Intent is explicit, and refusal happens at the moment of the mistake. No engine path
  moves a branch to adopt work. Validation is the same as the hand-off's (FR-8, FR-9, path
  ownership). The planner is unchanged. The command fits #3203's operator command family.
- **Cons:** A new CLI subcommand and two new ref families. The rewrite map is matched by subject,
  as the shipped resolver's map is also not exact by construction (restack ADR decision 6).

### Option C: An engine-prepared paused rebase finished by the operator
- **Pros:** An exact rewritten list. The engine chooses the base.
- **Cons:** About twice the work. It needs a resolution worktree that survives between dispatches,
  plus its own cleanup. Its one remaining advantage, the rewritten list, is not exact for the
  shipped resolver either.

## Decision

Option B.

1. **A feature-repair conflict halt writes a durable conflict record.**
   - **When.** On every unresolved conflict of a `feature-repair` restack: the executor's
     `haltUnresolvedConflict` and recovery's `conflict-unresolved` branch. That includes the
     `rem-*` body-mismatch hand-off, because it uses the same halt.
   - **Contents.** A JSON blob at `refs/conductor/<slug>/restack/conflict/record`:
     - `opId`, `child`, the range's `oldParent` and `oldTip`;
     - `newParent`, the parent the replay was building on, and its tree id;
     - the ordered replay-candidate subjects;
     - the conflicting commit and its paths.
   - **Reachability.** `newParent` is pinned at `refs/conductor/<slug>/restack/conflict/parent`.
     `oldTip` stays reachable from the child's branch, which the aborted restack never moved.
   - **Writes.** One record per feature. It is written in a compare-and-swap transaction and
     replaced by the next conflict halt.
   - **Survival.** The record is outside `restack/staging/`, so `cleanJournal` leaves it in place.

> **Amended 2026-10-31 by #3478:** The record and the `Restack-Conflict` halt line are also written for an unresolved `base-refresh` conflict. Its candidate subjects are the resolver's replay candidates, which omit commits patch-equivalent to the new default (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decision 1).

2. **The conflict halt says how to resolve it.** The HALT and the committed halt record carry, in
   order:
   - the child, the commit, the paths and the resolver's reason;
   - a machine reason line, `Restack-Conflict: <child> <opId>`;
   - the exact recipe:
     - create a scratch branch outside the feature's branch namespace at `oldTip`;
     - run `git rebase --onto <newParent> <oldParent>` on it, resolve and test;
     - run `ai-conductor stack restack-resolve --slug <slug> --child <k> --tip <sha>`.

   The halt never tells the operator to rebase the child's own branch.

> **Amended 2026-10-31 by #3478:** The halt also prints the `stack restack-resolve --decision` recipe beside the `--tip` recipe, for either restack cause (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decision 1).
3. **`ai-conductor stack restack-resolve --slug <slug> --child <k> --tip <sha>` validates and
   records the resolution.**
   - **Refused up front, each refusal naming its cause:**
     - inside a daemon session (not in `SESSION_SANCTIONED_SUBCOMMANDS`);
     - when the feature has no durable child state;
     - when the feature dispatch lease (#3203 decision 2) cannot be acquired;
     - when there is no conflict record, or the record names another child;
     - when no live HALT carries the matching `Restack-Conflict` line;
     - when the tip does not resolve to a commit.
   - **Validated, the same guards as the resolver hand-off (restack ADR decision 6):**
     - FR-8: the tip descends from the recorded `newParent`;
     - FR-9, strictly: every recorded candidate subject is present in `newParent..tip`. This is
       checked by an exact subject-presence test over `git log newParent..tip`, with no
       supersession exception. `featureCommitsPreserved`'s legacy `supersededByBase` excuse and its
       `ORIG_HEAD` read do not apply to an operator-supplied tip;
     - no merge commit in `newParent..tip`;
     - path ownership: `checkPathOwnership` for the child's range, from `newParent` to the tip.
   - **Refusal.** A failure is refused, naming the missing ancestor, the missing subjects or the
     unowned paths. It writes nothing.
   - **Success.** The command does two things, in order:
     - writes `refs/conductor/<slug>/restack/resolution/c<k>` to the tip with compare-and-swap
       (it creates the ref, or replaces a stale one for the same child);
     - clears the HALT with rewind's `clearHaltAtomically`. Any other HALT is left in place and
       reported.

     It then releases the lease. The committed halt record is superseded by the shipped resume
     path.

> **Amended 2026-10-31 by #3478:** The command also accepts `--decision "<answer>"` instead of `--tip`; the two are mutually exclusive. With the same refusals, it pins the answer and the conflict identity at `refs/conductor/<slug>/restack/decision/c<k>`, appends `restack_decision` `recorded`, and clears the HALT. The next restack hands that decision to the resolver. Recording either answer deletes the other kind's ref for the same child in the same compare-and-swap transaction, so the latest answer wins (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decisions 2 and 3).
4. **The next restack consumes a matching resolution as the child's resolver output.**
   - **Where.** In `runRestack` and in recovery's `resumePlanned`, for a `feature-repair` journal,
     before a replayed range of child `k` is replayed.
   - **When it is used.** A resolution ref for `k` is used only if all three hold:
     - the record names `k`;
     - the record's `oldParent` and `oldTip` equal this range's;
     - the tree of the parent being built equals the recorded `newParent` tree.
   - **How it is used.** The commits `newParent..tip` are rebuilt onto the live parent with the
     plumbing replay and the journal's committer stamp. Because the base trees are identical, this
     replay cannot conflict. The result is then:
     - checked by path ownership, as decision 3 does;
     - recorded `resolved`, with a rewrite map from each original candidate to its rebuilt commit,
       matched by unique subject. A subject that appears more than once is omitted from the map
       and left to the shipped patch-id reconstruction.

     Children above `k` replay as today.
   - **On a mismatch.** The restack aborts with nothing moved and halts needs-human with the new
     reason `restack-resolution-stale`, naming the field that differs. The resolution and the record
     are kept.
   - **With no resolution ref,** the replay runs exactly as today.

> **Amended 2026-10-31 by #3478:** Consumption is no longer limited to `feature-repair` journals. A matching resolution is consumed for a `base-refresh` range too. When no resolution matches, a decision whose child, `oldParent` and `oldTip` match is delivered to the resolver (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decision 3).
5. **A resolution lives until the restack that consumed it applies.**
   - The ready→moved transaction (`applyRestackMove`) carries `verify` lines asserting that the
     consumed resolution ref, the record and the parent pin are unchanged. If one changed after
     consumption, the move fails its compare-and-swap with no branch or closure ref moved, and the
     restack halts `stack-ref-changed` naming that ref.
   - The applied transaction (`appliedTransactionLines`) then deletes the resolution ref, the record
     and the parent pin, with compare-and-swap.
   - An aborted or halted restack never deletes them.
   - Feature teardown deletes them by name: `featureConductorRefNames` gains the conflict refs and
     `restack/resolution/c<k>` for every child id. Cleanup never discovers refs by prefix.

> **Amended 2026-10-31 by #3478:** The ready→moved `verify` lines and the applied transaction's deletions also cover a delivered `restack/decision/c<k>` ref. `featureConductorRefNames` gains it for every child (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decision 4).
6. **Post-restack guarantees come from the shipped machinery.** A consumed resolution enters the
   journal as `resolved`, so the shipped path then runs unchanged:
   - the move;
   - `applyRestackTransition`, including re-validation queueing of every moved closed child;
   - the routed round's terminal `restacked` record;
   - `returnToLeaf`, which re-pends the leaf gates.

   No new re-validation logic is added.
7. **The routed exit uses the provider resolver and reports the restack's reason.**
   - `requestRoutedExit` passes the conductor's restack resolver and
     `resolveRebaseResolutionAttempts(config)` to `runRestack`, as every other restack entry point
     already does. This conforms to restack ADR decision 6.
   - A `halted` restack result carries its halt detail. The routed exit's halt includes it, instead
     of the bare word `halted`.
8. **Events ride the spine.**
   - One new `ConductorEvent` member: `restack_resolution {opId, child, action, tip, operator?}`.
     - `action` is `recorded` (emitted by the CLI) or `consumed` (emitted by the executor or
       recovery).
     - `operator` is set on `recorded`, from `resolveMachineOperatorIdentity`, so the audit trail
       names who released the halt, as #3203's operator commands do.
     - The CLI writes the resolution ref, then appends the event, then clears the HALT. A failure
       at either later step leaves the HALT in place and the ref recorded, so re-running the
       command completes it.
   - **This is not `halt clear`.** The command needs no TTY and no rationale, following #3203
     decision 4's departure for operator commands an interactive agent may run. It is not
     `ai-conductor halt clear` and emits no `halt_clear_authorized`. The committed halt record is
     superseded by the shipped resume path, as for any other cleared halt.
   - A stale resolution is a refusal: `restack_refused` gains the reason value
     `restack-resolution-stale`, extending restack ADR decision 12's closed reason list.
   - **"Nothing moved" in the restack ADR and its stories means no branch or closure ref moved.**
     Writing the conflict refs at a halt, including the `rem-*` body-mismatch halt, moves neither.
   - **Merge-bearing children are out of scope.** A merge-bearing child keeps the shipped
     `flatten_refused` halt, its text and its recovery, and writes no conflict ref.

> **Amended 2026-11-01 by #3438:** A merge-bearing child now writes the conflict refs and takes this ADR's halt. Its `--tip` recipe starts from `refs/conductor/<slug>/restack/conflict/flattened-tip`, the pinned tip of the linear flattened chain, because a plain rebase of the merge-bearing `oldTip` drops the merge's hand edits and subject. That ref has the same lifecycle as the parent pin under decision 5, and it is written only for a merge-bearing child (adr-2026-10-10-stacked-restack-journaled-replay decision 6).

> **Amended 2026-10-31 by #3478:** A sibling member, `restack_decision {child, action, commit, paths, operator?, opId?}`, records a decision being `recorded`, `applied` or `stale`. `restack_resolution` is unchanged (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decision 5).
9. **Parity.** All of these are byte-for-byte unchanged:
   - a feature-repair restack with no resolution ref;
   - base-refresh restacks;
   - restacks the resolver settles;
   - N=1 features;
   - routing-off behavior.

   The N=1 golden guard still holds. The restack ADR decision 13 obligations are unaffected.

> **Amended 2026-10-31 by #3478:** Base-refresh conflict halts are no longer byte-identical. They write the conflict refs and print the `Restack-Conflict` line and both recipes. They still move no branch or closure ref (adr-2026-10-31-operator-decision-for-stacked-restack-conflicts decisions 1 and 6).
10. **The guidance changes with the mechanism.**
    - In `docs/runbooks/stalled-or-stuck-feature.md`, "A stacked restack halted" stops telling the
      operator to settle the conflict on the child's branch and documents decision 2's recipe and
      the command.
    - It warns against moving closure refs by hand.
    - `docs/reference/cli.md` documents the command.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | Rebuilding `newParent..tip` onto a parent whose tree equals `newParent`'s tree is conflict-free, with each rebuilt commit keeping its tree | verified | 95% | yes | A consumed resolution could conflict or change content; the plan proves it with a real-git test across two replayed children | — |
| A2 | After the conflict HALT is cleared, the next dispatch re-runs the routed exit restack for the still-open round (as #3414's 12:11Z and 12:23Z dispatches did) | inferred | 85% | yes | A consumed resolution would never be reached through the routed path; the plan proves re-entry with an integration test | APPROVED by operator 2026-10-25 |
| A3 | A subject-matched rewrite map, falling back to patch-id reconstruction for duplicate subjects, translates the resolved child's evidence well enough that its re-validation and the leaf gates run without a false `no_task_progress` stall | unverified | 60% | yes | A resolved restack could stall the feature on evidence; the plan carries a real-git test of the whole resolve-then-revalidate path | APPROVED by operator 2026-10-25 |
| A4 | With a feature-repair journal's comparison set empty, the next run's replay candidates for an unchanged range equal the recorded candidate subjects | verified | 90% | yes | FR-9 would compare against a stale subject list | — |
| A5 | A scratch branch outside `feat/` is not a branch of the feature for #3203's commit guard, and `git rebase --continue` runs no pre-commit hook (tested with git 2.53) | verified | 90% | no | The operator's recipe would be refused by the guard; the halt would need a different branch name | — |

## Consequences

### Positive
- A conflict the resolver cannot settle has a literal, mechanical recovery. A wrong resolution is
  refused at the command, before the HALT clears.
- No engine path moves a branch to adopt an operator's work, so engine-owned branches stay
  engine-written and nothing an operator does is silently discarded.
- Routed conflicts reach the provider resolver at all, so fewer of them need a human.

### Negative
- Two more engine-owned ref families under `refs/conductor/<slug>/restack/`, plus teardown entries
  for each child id.
- A new `stack` subcommand and one new event member.
- The rewrite map for a consumed resolution is subject-matched (assumption A3).

### Follow-up Actions
- [ ] Out of scope, file as intake: a hand-moved closure ref with a live repairing marker should
      halt loudly instead of ending the loop without DONE or HALT.
- [ ] Out of scope, file as intake: the `flatten_refused` halt text also tells the operator to
      "resolve the conflict on child branch … and resume", which has the same non-followable shape.

## Amendments made by this decision
- `adr-2026-10-10-stacked-restack-journaled-replay` decision 6: an unresolved `feature-repair`
  conflict also writes a durable conflict record, and an operator-recorded resolution is consumed
  as the resolver's output on a later run.
- `adr-2026-10-10-stacked-restack-journaled-replay` decision 12: `restack_refused` gains the reason
  `restack-resolution-stale`, and the spine gains the `restack_resolution` variant.
