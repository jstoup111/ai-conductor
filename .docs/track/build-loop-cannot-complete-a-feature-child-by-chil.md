# Track: build-loop-cannot-complete-a-feature-child-by-chil

Track: technical

Scope boundary: The full per-child BUILD region of the stacked child-plans chain
(jstoup111/ai-conductor#2942; chain design in #2940; foundation shipped via #3019, child-plan model
via #3039), plus every follow-up `adr-2026-10-03-stacked-child-plans-identity-and-state` assigns to
#2942. Children exist only when a plan has two or more slices, the plan passed stack eligibility, and
the target project sets `stacked_prs.enabled: true`. In every other case the build loop behaves
exactly as today, and #3019's N=1 golden suite stays green.

1. **Active child.** It is derived from git: closure is recorded as monotone engine refs
   (`refs/conductor/<slug>/closed/c<k>`), and positions come from the `coverage_binding` envelope.
   It survives daemon restarts, worktree recreation and resume. A restart never re-runs a closed
   child and never skips an open one. Once child refs or child state exist they decide the cursor
   whatever the flag says; the flag gates only the creation of children.
2. **Ordered children in one worktree.**
   - Child branches are created by compare-and-swap after the reserved-namespace and
     `max_slices` checks.
   - Switching refuses a dirty tree and never autostashes.
   - The leaf is moved to child N-1's tip under a guard.
   - No task of child k+1 starts until child k's `acceptance_specs`, `build`, `test_suite` and
     (when enabled) `build_review` have passed.
3. **Per-child region gates.**
   - **`acceptance_specs`:** only the child's owned stories, with dispositions, spec attribution,
     RED evidence and run contract all per child. A child that owns no story gets a no-criteria
     outcome.
   - **`build`:** completes on the child's tasks plus the remediation tasks recorded to that child.
   - **`test_suite`:** evidence per child. Under `full_suite: once` the aggregate runs at the leaf
     only.
   - **`build_review`:** grades the child's diff against its parent's tip, with Done-when binding
     limited to the child's tasks and remediation cases per child. Security runs once, at the leaf,
     over the whole-feature diff.
4. **Child-aware loop control.**
   - Overlay state reads and a mutation port that routes region keys to the active child.
   - Every flat reader the umbrella ADR lists, plus the FINISH fence, complete-verifier and the
     build-review verifier.
   - Per-child caps: the stuck-gate guard, recovery retries, every kickback-ledger caller including
     the `build_review` cumulative cap, and child receipts.
   - Stall detection per child.
   - Kickbacks and stale cascades from whole-feature gates land in the active (leaf) child.
5. **Commits stay in their child.** A blocking commit-hook membership check reads the checked-out
   ref.
6. **Operator surfaces.**
   - Recovery CLIs default to the active child, and `kickback-budget raise`/`reset` gain `--child`.
   - `rewind --child` is refused for a closed child (that needs #2943).
   - Daemon status and the dashboard show the active child.
   - Halt records commit to the active child with a `Child:` field, and a child branch is never
     pushed.
7. **Restack-free safety until #2943.**
   - The resume and base-advance rebase is skipped while a non-leaf child is active.
   - The leaf's post-FINISH-rebase base is translated through the rebase rewrite map, or fails
     closed.
   - The position-immutability guard sits in `coverage_binding`.
8. **Event spine.** `child_started`, `child_closed` and `child_switched` events are added, and
   region events carry `child`.
9. **ADR amendments** for every decision this changes.

Excluded:
- restack and RED re-validation after a restack (#2943);
- routing fixes to the owning child (#2944);
- publication, the child→PR map and child teardown (#2945);
- per-child telemetry breakdown (#2946);
- per-child custom steps (#2947);
- concurrent child builds (#2948);
- early child drafts (#2949).

Engine build-loop machinery with no end-user product requirement, the same classification as #2940
and #2941. Acceptance criteria therefore live in stories, and no PRD is authored.

**Selected approach:** an active-child cursor over the existing step registry (Approach B, revised
after three adversarial reviews). It was chosen over typed step instances `{kind, childId}` (the
filer's hypothesis) and a nested child runner.
