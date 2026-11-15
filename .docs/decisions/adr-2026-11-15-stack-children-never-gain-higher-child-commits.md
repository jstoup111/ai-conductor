# ADR: A lower stack child never gains a higher child's commits

**Date:** 2026-11-15
**Status:** APPROVED
**Deciders:** operator (James Stoup)

## Context

#3676. In gem_miner (PR jstoup111/gem_miner#4, a five-child stack), routed round r7 sent an as-built repair to host 2. The repair's prerequisite code (bosses, chase, projectiles) exists only from child 4 upward.

**What happened.**

- **The claim failed.** The host-2 Codex BUILD session's prerequisite claim was refused as malformed.
- **The builder merged child 4 instead.** It ran `git merge --no-ff --no-commit feat/c4/…` on child 2, then `git commit -m 'chore(stack): advance C4 gameplay layer'` (617600d, parents c2 tip and c4 tip, 125 files).
- **Nothing refused it.**
- **The gates passed on the wrong tree.** Host 2 committed 14 more fixes, then its `test_suite` and `build_review` passed on a tree that held children 3 and 4.
- **The failure surfaced three hours later.** Child 3's exit restack found its whole range already in its base and halted. Recovery needed a manual `git reset --keep` and re-hosting the 14 fixes by hand.

**Why nothing caught it.** Measured on main:

- **The commit hooks have gaps.**
  - `commit-msg` exits 0 whenever `MERGE_HEAD` exists.
  - `stack-commit-guard` checks only which branch is checked out.
  - `prepare-commit-msg` stamps a `Round:` trailer on a merge commit.
  - Pre-commit never fires on a fast-forward merge, `reset`, `cherry-pick` or `update-ref`.
- **The guards check other things.**
  - The agent-path git wrapper (`adr-2026-09-23-engine-git-guard-on-agent-path` D5) classifies only destructive forms. `merge`, `cherry-pick`, `rebase`, `reset --keep`/`--soft`/`--mixed` and `update-ref` all pass.
  - The `reference-transaction` backstop (D12 of that ADR) vetoes only deletions of a branch tip that would become unreachable.
- **The ancestry checks look one way.** Every existing check (restack plan, child cursor, `verifyChildChain`, `build_review` inputs, routed exit) proves that a lower child is contained in a higher one. None proves that a higher child's commits are absent from a lower one. `build_review` grades `pinnedBase..HEAD`, so it graded the merged diff.

`adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` (#3653, which blocks this ADR) changes routing for audit rounds: each audit host executes on the leaf branch, where every prerequisite exists. That removes the trigger for audit rounds. It does not remove the trigger for `operator` and `revalidate` rounds, for `fold_routed_fixes: false`, or for any other way a builder reaches a higher child. This ADR adds the missing invariant and enforces it. Routing and prerequisite-claim ergonomics are out of scope; #3674 tracks those.

## Options Considered

### Option A: Extend the pre-commit stack-commit guard (the filer's hypothesis)
- **Pros:** one existing hook, small diff.
- **Cons:** pre-commit does not fire on a fast-forward merge, `reset`, `update-ref` or `cherry-pick`, so most ways a branch tip moves stay open. It also gives the gates no backstop.

### Option B: One containment predicate, enforced by the wrapper, `reference-transaction` and the gates (chosen)
- **Pros:**
  - One definition serves every layer.
  - The wrapper refuses before git touches the index.
  - `reference-transaction` sees every ref move the wrapper misses.
  - The gates catch anything that bypassed both.
- **Cons:**
  - Each update to a child branch now costs one engine CLI process.
  - The patch-id check at the gates depends on stack shape.

### Option C: Gates only, with an automatic revert to the closure
- **Pros:** no hook work.
- **Cons:** the build effort spent between the mistake and the gate is lost, and nothing is refused at commit time.

## Decision

Option B. The invariant belongs in machinery, because a builder that cannot finish a routed task will improvise. Codex's approval reviewer classed the merge as "a reversible local integration step", so a prompt rule would not hold.

1. **The invariant.**
   - **Where it applies.** The rule applies to a feature with durable child state, on a stacked child branch `feat/c«k»/«slug»`. The top position is built on the leaf branch, so every `feat/c«k»` branch is below it, and the leaf branch is never checked. Under that rule, child `k`'s branch never gains a commit from an **entered** higher child's own range. The predicate passes vacuously:
     - on the leaf branch;
     - on any other branch;
     - for an N=1 feature;
     - when no higher child has been entered.
   - **Positions and predecessors.** Positions are read from the sealed positions record (`refs/conductor/«slug»/positions`). Positions may have gaps (`adr-2026-10-03-stacked-child-plans-identity-and-state`), so "the child below `j`" means `j`'s predecessor position `p(j)`, never `j-1`.
   - **Entered.** Child `j` is entered once `refs/conductor/«slug»/closed/c«p(j)»` exists, which is when its predecessor position closed. The top position counts as a higher child too, with the leaf branch as its branch.
   - **Own range.** An entered child's own range is `feat/c«j» ^closed/c«p(j)» ^origin/«default»`: its region's own commits. Default-branch commits it merged are excluded, as in the leaf-move rule of `adr-2026-10-07-per-child-build-region` decision 3. The default branch is discovered the way the rebase path does it. An unentered child contributes nothing. This means:
     - a halt record or base commit on the leaf before the top position is entered is never foreign;
     - creating `feat/c«k»` at the leaf tip or at its predecessor's closure gains nothing foreign;
     - a lower child that merges or base-refreshes onto the default branch gains nothing foreign, even when an entered higher child already merged the same default-branch commits.
   - **Identity mode.**
     - **At a ref move**, the gained commits (`rev-list «new» ^«old»`, or every commit of `«new»` for a creation) intersect no entered higher child's own range.
     - **At a gate**, `HEAD` reaches no commit of an entered higher child's own range.
   - **Patch mode (gates only).** No commit in `closed/c«k»..HEAD` has a patch-id equal to a commit in an entered higher child's own range.
   - **A missing reference fails closed.** The verdict is `unavailable` in three cases:
     - a higher child whose predecessor position is above `k` is entered, but `closed/c«k»` is missing;
     - the positions record cannot be read;
     - the default branch cannot be discovered.

     The verdict names the missing input. An entered child whose predecessor position is `k` implies that `closed/c«k»` exists.
   - **One module.** A single engine module computes the verdict as a discriminated union:
     - `contained`;
     - `foreign`, with the higher child and the offending commits, each tagged with its mode;
     - `unavailable`, with the cause.

     Each layer calls the module; no layer re-implements it.

2. **The agent-path wrapper refuses before mutation.**
   - **Scope.** The guard of `adr-2026-09-23-engine-git-guard-on-agent-path` gains a containment class: `merge`, `cherry-pick`, `reset` and `rebase` (its upstream or `--onto`) when the checked-out branch is a `feat/c«k»/«slug»` branch of a feature with durable child state. Everywhere else these commands keep today's behavior.
   - **Proposed commits.** The wrapper resolves the commits the command would bring in:
     - for `merge`, `reset` and `rebase`: `rev-list «target» ^HEAD`;
     - for `cherry-pick`: the named commits and ranges.
   - **The check.** It passes them to the predicate through a new internal launcher subcommand, invoked the same way pre-commit invokes `stack-commit-guard`.
   - **On a foreign verdict** it exits non-zero without running the command. Its stderr follows the explanation shape of D6 of that ADR: the higher child, the commit count, and why. The way forward is to build the work on its own child, or to stop and report the missing prerequisite. The refusal never suggests moving code down.
   - **Unparseable options.** These subcommands become guarded subcommands of the shared option spec (`adr-2026-10-03-fail-closed-git-option-normalization`, amended for this decision), which gains `merge`, `cherry-pick` and `rebase` grammars. On a child branch, an option the wrapper cannot resolve is refused.

3. **`reference-transaction` is the backstop for every ref move.**
   - **Trigger.** At the `prepared` stage, a non-deletion line whose ref is `refs/heads/feat/c«k»/«slug»` runs the predicate in identity mode, with the old and new values as the reference and the proposed tip.
   - **Refusal.** On a foreign verdict the hook exits non-zero, so git aborts the whole transaction and the ref does not move.
   - **Every other line stays as it is.** Those pass with no git call and no CLI process, as today; only child-branch lines pay for the CLI.
   - **Recovery text.** Git has already updated the index and worktree before the `prepared` stage. Verified on git 2.53: a refused fast-forward merge and a refused `reset --keep` both leave the target's changes staged. So the refusal names the recovery the guard allows: `git merge --abort` when `MERGE_HEAD` exists, otherwise `git reset --merge HEAD`. Both were verified to restore the pre-command state.

4. **There is no bypass variable.**
   - **No escape hatch.** Neither layer reads `CONDUCT_ENGINE_COMMIT` or any new escape variable. This keeps `adr-2026-09-23-engine-git-guard-on-agent-path` D7 and D14.
   - **Why the engine still passes.** No engine ref move gains a higher-unique commit:
     - the journaled restack replay writes new commits onto a lower base;
     - the `#3653` fold places new `Folded-from` commits and moves every branch in one transaction;
     - the prerequisite reroute resets a host to its closure;
     - a child-cursor advance creates the higher branch;
     - base refresh brings in the default branch, which holds no unpublished child work.
   - **Proof.** This is proven by real-git tests over those engine operations, not by an exemption.

5. **The gates refuse to pass a foreign tree.**
   - **Where it runs.** The conductor runs the predicate in both modes, identity and patch, against `HEAD` at three points, whenever the checked-out branch is a `feat/c«k»/«slug»` branch. The check keys on the checked-out branch, never on the region. A leaf-executed audit host (`adr-2026-11-08-routed-audit-fixes-fold-onto-owners-before-publish` decision 3) runs its host region with the leaf checked out, so it is not checked. The three points are:
     - before it dispatches `test_suite` or `build_review` in that child's region;
     - in `requestRoutedExit`, before a host settles.
   - **On an `unavailable` verdict** it writes a needs-human HALT naming the cause and runs neither the step nor the exit.
   - **On a foreign verdict** it writes a needs-human HALT with reason `stack-containment-violated` and runs neither the step nor the exit. The HALT names:
     - the host child;
     - the higher child;
     - the offending commits, each tagged ancestry or patch;
     - the recovery: move the host back to its closure, or to the last contained commit, and rebuild the work on the child that owns its prerequisite.
   - **Events.** The HALT reaches the event spine through the existing `halt_record_written` path. No event variant and no sidecar are added.
   - **No automatic revert.** The engine does not revert by itself, because later commits may be legitimate work that only a human can separate.

6. **Hook-layer refusals stay on stderr.** As with every other worktree hook (`adr-2026-09-23-engine-git-guard-on-agent-path` D14), a wrapper or `reference-transaction` refusal runs in a separate git process that has no access to the event bus. It surfaces as the builder's failed command. The occurrence that matters to consumers, a gate refusing a foreign tree, rides the spine through decision 5.

7. **Coverage is proven by real-git tests.** The tests run real git in worktrees provisioned by `prepareWorktree`, with git called by absolute path for the hook proofs. They prove each refusal and each pass below.
   - **Refused:**
     - `merge` with and without `--no-commit` and fast-forward;
     - `reset --keep`, `--soft` and `--mixed` onto a higher child;
     - `cherry-pick` of a single higher commit and of a range;
     - `rebase` onto a higher child;
     - `update-ref` of the child branch to a higher tip.
   - **Passes, so ordinary work is unaffected:**
     - ordinary host commits;
     - the restack replay;
     - the fold transaction;
     - the reroute reset;
     - a child-cursor advance, and the creation of `feat/c«k»` at the leaf tip or at `closed/c«k-1»`;
     - an N=1 feature.
   - **Gate backstop:** a host tree carrying a merge of a higher child, and a host tree carrying a copied commit, each halt with the named cause.

## Assumptions

| # | Assumption | Basis | Confidence | Load-bearing | Impact if wrong | Approval |
|---|---|---|---|---|---|---|
| A1 | A `reference-transaction` veto at the `prepared` stage aborts a fast-forward merge, `reset --keep`, and the commit after `merge --no-commit`; `git reset --merge HEAD` and `git merge --abort` then restore the pre-command state (probed on git 2.53, 2026-11-15) | verified | 95% | yes | The backstop would not stop these moves, or its recovery text would be wrong | n/a |
| A2 | No engine ref move inside a feature worktree gains a commit unique to a higher child: restack replay, the #3653 fold, prerequisite reroute, child-cursor advance, base refresh, post-finish `update-ref HEAD` | inferred | 80% | yes | Engine operations would be refused by the hook, and decision 4's no-bypass rule would need an engine-only mechanism | APPROVED by operator 2026-11-15 |
| A3 | After a fold or feature-repair restack transaction, no higher child keeps pre-transaction copies of commits that now sit on a lower child, so the gate's patch check raises no false positive (fold ADR decision 8 moves every branch in one transaction) | inferred | 80% | yes | Re-validation gates after a fold would halt falsely; the patch mode would need an owner-trailer exclusion | APPROVED by operator 2026-11-15 |
| A4 | Child `j` is entered exactly when `refs/conductor/«slug»/closed/c«p(j)»` exists for its predecessor position `p(j)`, and closure refs are created in position order, so an entered higher child implies `closed/c«k»` exists for every lower child `k` | inferred | 85% | yes | The own-range definition would mis-scope higher work, or an ordinary gate would halt as `unavailable` | APPROVED by operator 2026-11-15 |
| A6 | The top position is built on the leaf branch, so every `feat/c«k»/«slug»` branch sits below it (`engine/stack-commit-guard-cli.ts`, `hostIsLeaf` comment) | verified | 90% | yes | The leaf exclusion would need a topology lookup | n/a |
| A5 | One engine CLI process per child-branch ref update costs under one second, which is acceptable for commit latency | inferred | 70% | no | Slower commits on child branches only; the check would move into shell | n/a |

## Consequences

### Positive
- A lower child's branch can no longer absorb a higher child's work by any git path, and a bypass is caught before the gates can pass on the wrong tree.
- A refusal comes with a named cause at the moment of the mistake, not three hours later as a confusing restack halt.
- One predicate, so the wrapper, the hook and the gates cannot drift apart.

### Negative
- Each child-branch ref update starts one engine CLI process.
- Builders lose `merge`, `cherry-pick`, `rebase` and `reset` toward higher children on child branches. That is intended, but a builder with a missing prerequisite now fails its attempt instead of improvising. #3653 and #3674 own the routing side.
- A legitimate move-down of an exact patch (for example, an operator copying a commit to a lower child by hand) halts at the gate until the higher children are restacked.
- Patch mode cannot tell which way a copy went. An operator who copies a lower child's fix up into a higher child, then lands it with `stack land … --carry`, gets a `stack-containment-violated` HALT on the lower host naming both commits. Restacking the higher children clears it. This was accepted as degrading by the operator on 2026-11-15, because no automated flow copies upward.

### Follow-up Actions
- [ ] Implement decisions 1–7 (#3676).
- [ ] #3674: claims that point down; prerequisite-claim ergonomics.
- [ ] Record the new wrapper class and hook check in the control inventory (`docs/reference/settings-and-hooks.md`).
