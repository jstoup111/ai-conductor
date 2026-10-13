# Track: whole-feature-audit-fixes-cannot-land-in-the-stack

Track: technical

Scope boundary: The foundation spec of a four-spec delivery of desired outcomes 1–5 and 7 of
jstoup111/ai-conductor#2944. By operator decision (2026-10-12), this spec ships the foundation dark
behind `stacked_prs.route_whole_feature_fixes` (default `false`): types, refs and teardown, the
route-record store and journal fence, the four events with persister dedup and the outbox drain,
the cursor fields and execution-child resolver with every consumer, and the N=1 golden guard
(ADR decision 18). jstoup111/ai-conductor#3210, #3211 and #3212 deliver the rest of the design, in
that order, and #3212 turns the setting on. The full design covers the leaf-gates and
fix-routing ticket of the stacked child-plans chain (chain design in #2940), plus every follow-up
earlier chain ADRs hand to #2944:
- `adr-2026-10-07-per-child-build-region` decision 4 (route kickbacks to the owning child);
- `adr-2026-10-10-stacked-restack-journaled-replay` follow-ups: re-validate closed children a restack
  moved, re-validate a repaired child's own new commits, make routed fixes a third `feature-repair`
  producer under the D10 cascade cap, and consume `parentOverlapPaths`;
- `adr-2026-10-07-sliced-plan-story-ownership-and-stack-eligibility` D3 (route whole-feature
  kickbacks to a child).

Approach (operator-approved): owner routing is mechanical. A FIXABLE or task-bound REMEDIABLE
finding goes to the child that owns the cited task, through slice membership. Judgement is limited to
the residue, constrained by schema and validated by machinery:
- findings that cite only an ADR decision;
- refusal rework;
- findings with no owner from `manual_test` and custom steps;
- a builder's `blocked-by-prerequisite` claim, which the engine verifies before re-routing.

Test failure alone is never treated as "cannot host". Required machinery:
- a ref-backed routed-repair cursor state that keeps closure refs and defers the auto-restack;
- rem-* id allocation across the whole stack, plus a deterministic merge of rem blocks;
- a committed `Child:` line on routed rem tasks;
- a ref-backed route record, with an event emitted before mutation;
- a pending-repair receipt bound to its child, charged once per budget;
- a bounded upward re-validation queue for closed children;
- repair-obligation boundaries per branch.

Excluded:
- outcome 6, the landing aid for manual and reviewer-requested changes, and lifting the closed-child
  rewind refusal. Both moved to jstoup111/ai-conductor#3203 by operator decision on 2026-10-12, after
  adversarial ADR review showed the combined design was #2943-sized. #3203 is blocked by #2944 and
  blocks #2945 and #784, mirroring #2944's edges;
- #2945 publication and lifecycle, including the PR comment on a published child; children are
  unpublished during routing in this scope;
- #2946 per-child telemetry;
- #2947 per-child custom steps;
- #2948 concurrent child builds;
- #2949 early per-child drafts.

A feature with no durable child state (N=1, an unsliced plan, or stacking never started) behaves
exactly as today. A feature that already has children keeps routing even if `stacked_prs.enabled`
is later turned off (ADR decision 1).

Known concurrent work: open implementation PRs #3136 and #3133 touch `land-spec.ts`,
`remediation-projection.ts`, `events.ts` and `event-sinks.ts`. Expect rebase conflicts.

Rationale: this is internal engine machinery with no end-user product surface. It uses the same
track as #2942 and #2943, and its acceptance criteria live in stories.
