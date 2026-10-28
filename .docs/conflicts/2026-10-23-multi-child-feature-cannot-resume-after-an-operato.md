# Conflict Check: Stacked slice topology from the sealed plan; coverage_binding step removed (#3365)

**Date:** 2026-10-23
**New stories:** `.docs/stories/multi-child-feature-cannot-resume-after-an-operato.md` (6 stories)

**ADR corpus:** repo-wide. Every approved ADR was loaded and narrowed by subject to stacked
delivery, slice topology, `coverage_binding`, reseal and the protected-artifact seal, rebase
invalidation, configuration loading, and the event spine. The examined set is:
- the new `adr-2026-10-23-slice-topology-from-sealed-plan`;
- `adr-2026-08-31-coverage-binding-judge-step`, amended by the new ADR (its step decisions are
  retired) and examined because shipped stories cite it;
- the four amended ADRs: `adr-2026-10-07-per-child-build-region`,
  `adr-2026-10-03-stacked-child-plans-identity-and-state`,
  `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility`, and
  `adr-2026-09-29-plan-slice-manifest`;
- unamended neighbours: `adr-2026-09-11-selective-post-rebase-verification`,
  `adr-2026-07-20-post-rebase-delta-aware-invalidation`, `adr-2026-10-10-stacked-restack-journaled-replay`,
  `adr-2026-10-12-routed-whole-feature-repair`, `adr-2026-09-06-reopened-task-resolution`,
  `adr-2026-10-03-per-feature-step-applicability`, `adr-2026-08-22-one-owner-per-review-question`,
  the protected-artifact seal ADRs, and the retired-config precedent
  `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`.

The remaining ADRs were narrowed out by subject: providers, cost, memory, intake, release, review
rubrics, daemon process, and UI.

**Story corpus:** every file in `.docs/stories/`, narrowed by subject to the 18 files that name
`coverage_binding`, the envelope, `plan_slices_changed`, or `story_reowned`. Also checked: the
stacked-chain stories (#2941–#2945, #3203, #2944), and the reseal and seal stories. In-flight specs
outside main were also checked: open spec PRs #3131, #2878, and #3216, and every
`.worktrees/engineer-*` spec worktree.

Every pair sharing a behaviour, entity, or gate was checked in both directions.

**Result:** PASSED.
- No blocking conflicts.
- No oscillating conflicts. The reseal guard (Story 1) and the topology halt (Stories 2 and 4)
  refuse the same condition, positions that differ from the recorded ref, at two points. The
  recovery in Story 4 satisfies both, so neither re-breaks the other.
- Three degrading conflicts, accepted under the operator's 2026-10-23 delegation of DECIDE approvals.

## Degrading conflicts (accepted)

| # | Conflict | Type | Parties | Resolution |
|---|---|---|---|---|
| D1 | Shipped features' accepted stories assert `coverage_binding` behavior that this feature removes. Examples: its envelope records ownership, its void on reseal, its position guard, its retries and serialization, `plan_slices_changed`, and rewind to it. | contradiction | 18 story files of shipped features (every one has a `.docs/shipped/` record; for example `post-plan-decide-amendments-never-reconcile-with-t`, `coverage-binding-serializes-judgments-and-loses-pa`, `sliced-plans-can-be-landed-whose-stories-span-chil`, `build-loop-cannot-complete-a-feature-child-by-chil`) vs Stories 1, 3, 5, 6 | Left unedited. They are acceptance records of delivered features that no later gate grades. The new ADR and its amendment notes record the change, as #3164 did when it made the step a no-op without editing those stories. Option rejected: rewriting 18 shipped story files in place, a large historical diff with no behavioural effect. |
| D2 | Open spec PR #3131 (machine-readable plan task dependencies, not merged) plans to route `validatePlanSlices` through its compiler "at `coverage_binding`", and cites plan-slice-manifest D6 and sliced-plan D5/D6 as unchanged. | sequencing | PR #3131 plan and coherence vs Stories 3 and 6 and the amended ADRs | Whichever spec merges second reconciles. If #3131 merges first, this feature's loader consumes its compiled reader. If this one merges first, #3131's slice-validation task targets `slice-topology.ts`. Land's file-overlap dependency proposals surface the pairing. |
| D3 | The #2946 spec worktree (stacked feature cost by child, not landed) uses `coverage_binding` as its example of a feature-wide, non-region step in a story criterion and a test fixture. | overlap | `engineer-stacked-feature-cost-and-time-cannot-be-broken-dow` stories and plan vs Story 6 | Degrading only. Any other feature-wide step (for example `prd_audit`) satisfies the same criterion. Whichever lands second substitutes the example step. |
