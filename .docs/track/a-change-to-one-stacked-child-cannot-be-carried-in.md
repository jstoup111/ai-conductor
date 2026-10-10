# Track: a-change-to-one-stacked-child-cannot-be-carried-in

Track: technical

Scope boundary: All eight desired outcomes of jstoup111/ai-conductor#2943, the multi-branch restack
in the stacked child-plans chain (chain design in #2940). It covers these follow-ups that
`adr-2026-10-07-per-child-build-region` assigns to #2943:
- the restack itself;
- the cascade cap;
- lifting decision 12, the rebase skip at a non-leaf child.

Children exist only under the conditions #2942 already enforces. In every other case the engine
behaves as today, apart from the N=1 differences listed in item 11, and #3019's N=1 golden suite
stays byte-identical. The design is `adr-2026-10-10-stacked-restack-journaled-replay`.

1. **Restack primitive.** When child k changes, every existing child above it is moved onto the new
   tip. Each child keeps only its own contribution, and no parent commits are replayed into it.
   - Children are replayed off the worktree, one first-parent commit at a time, with
     `merge-tree --write-tree` + `commit-tree`.
   - Authorship is kept, commits that start empty are kept, and commits that become empty or are
     patch-equivalent are dropped.
   - Child branches, closure refs and the journal move together in one compare-and-swap ref
     transaction.
   - `git replay` and `rebase --update-refs` are not used.
2. **Durable journal.** The journal is ref-backed under `refs/conductor/<slug>/restack/`. Its state
   changes are written in the same transaction as the refs they describe. Resume reads it before
   anything that judges the stack. An interrupted restack is therefore completed or rolled back
   idempotently, and never misread as divergence.
3. **Verified by result.**
   - Each replayed child must touch only paths it already owned, and the tips, ancestry and trees
     are checked after the move. A failure rolls back and halts.
   - Exit codes are never trusted.
   - Engine rebases and merges pin the rebase, merge and rename configuration against user git
     config.
4. **Conflicts.**
   - A conflict halts with nothing moved, naming the child and the conflicting commits. Both sides
     stay recoverable.
   - Only the conflicting child is handed to a narrow resolver, in a temporary detached worktree.
   - Halt-record commits are handled explicitly.
5. **Fresh-base refresh.** The FINISH `rebase` step moves child 1 onto the current default branch
   and restacks the existing children above it with the same guarantees.
6. **Restack cause and refunds.** Every stacked restack records its cause, `feature-repair` or
   `base-refresh`. `build_review` convergence refunds (`adr-2026-08-18` D2) apply only to
   `base-refresh`. N=1 records carry no cause field and keep today's behaviour.
7. **Per-child cascade cap.**
   - Applied feature-repair restacks are counted against their originating child.
   - The counts live in a ref-backed blob, not the child's `.pipeline/` ledger, so they survive
     worktree recreation.
   - Reaching the bound halts and names the child. Recovery is
     `kickback-budget raise|reset --child <k> --gate restack`, which needs a migration block.
8. **Triggers and recovery.** Restacks happen only where rebases happen today, plus one automatic
   repair. No new mid-build trigger is added.
   - **FINISH `rebase` step and daemon re-kick:** both base-refresh the whole stack, whichever child
     is active, as an N=1 re-kick rebases today. This replaces the decision-12 skip.
   - **Operator commits on a closed child:** commits appended past its closure are repaired
     automatically at resume with a `feature-repair` restack. A rewritten closed child still halts
     needs-human.
   - **Interrupted operations** are recovered from the journal.
   - None of these falls back to a single-branch rebase.
9. **Expected-SHA leases.**
   - Every successful engine push to a feature branch records its tip at the `executeRemoteGit`
     chokepoint.
   - Every force push fetches that branch, then leases against the remote tip. It proceeds only if
     the remote tip equals the recorded tip, or is an ancestor of what is being pushed.
   - Any other push that would overwrite an unrecorded remote tip is refused.
10. **Verdicts after a restack.**
    - A moved active child goes through today's transition with its own replay tuple. Whole-feature
      gates use the whole-stack tuple.
    - Closed children are not re-opened. Their would-invalidate result is emitted for #2944.
11. **Event spine and N=1.**
    - Restack events go through the existing `ConductorEvent` spine and carry `child`.
    - N=1 differs from today in only three ways:
      - pinned git config;
      - recorded pushed-tip refs;
      - `push_lease_refused`, emitted only on a refusal.

Excluded:
- **To #2944,** with its scope recorded in a comment on that issue:
  - re-validating closed children moved by a restack;
  - re-validating a repaired closed child's own commits;
  - lifting the closed-child rewind refusal;
  - routing fixes into their owning child, and the routed-fix producer of `feature-repair`
    restacks.
- **To #2945:** pushing child branches, publishing the stack, published-stack tip adoption,
  `stack-tip-diverged`, and the open-PR autoresolve replay on a stacked feature.
- **Others:** per-child telemetry (#2946), per-child custom steps (#2947), concurrent child builds
  (#2948) and early child drafts (#2949).

Engine machinery with no end-user product requirement, the same classification as #2940, #2941 and
#2942. Acceptance criteria therefore live in stories, and no PRD is authored.

**Selected approach:** a journaled off-worktree replay with one atomic compare-and-swap ref move
(Approach B). It was chosen after adversarial reviews of the git mechanics, engine state, diagrams
and ADR.

**Rejected alternatives:**
- **A, per-child worktree `rebase --onto` (the filer's hypothesis).** It checks out every child,
  which resets the live current-task. It moves one branch at a time, and it needs B's journal
  anyway.
- **C, one `rebase --update-refs` from the top branch.** In tests it exited 0 with branches unmoved
  (halt-record branches, branches checked out elsewhere, refs that changed concurrently). It is not
  atomic and never moves closure refs, and patch-ids shared across children make the rewrite map
  collide.
