# Track: Accept an operator-recorded resolution for a stacked restack conflict above the repaired child

Track: technical

Scope boundary: when a `feature-repair` restack halts on an unresolved conflict in a child above
the repaired child, the halt text prints the exact rebase the operator must perform (new parent,
old parent, original tip). The operator resolves it on any scratch branch, and a guarded
`ai-conductor stack restack-resolve --slug <slug> --child <k> --tip <sha>` validates the tip before
recording it. Validation checks that the tip descends from the parent the restack builds on, that
every original replay-candidate subject survives, and that the changed paths are owned. The
command pins the tip as a durable resolution ref and clears only the restack-conflict HALT it
resolves. At the next dispatch the restack executor (and journal recovery) consumes the pinned tip
as that child's resolver output, re-validating it against the live range, instead of replaying the
range again. The routed round then completes with the same post-restack guarantees as an
engine-resolved conflict: the resolved child and every child above it are re-validated before the
leaf gates re-run. A stale or invalid resolution is refused with a HALT naming what is missing.
No engine path moves a child branch to adopt it, and the planner's range rules are unchanged.
Included adjacent defects (operator decision 2026-10-25): the routed-exit restack passes the
provider resolver and its attempt cap (`routed-exit.ts` calls `runRestack` without one, so every
routed conflict hits the `restack resolver unavailable` stub), and the routed-exit halt keeps the
restack's own reason instead of the bare `halted`. The runbook and halt text describe a procedure
that works when followed literally. Excluded: making a hand-moved closure ref with a live repairing
marker fail loudly (operator decision 2026-10-25), and implicit adoption of moved upper branches
(approach A, rejected). Builds on #3365 and #3203 (operator command family, dispatch lease, halts
cleared only by their resolving command); lands with depends-on edges on both. Stacked features
whose repair restacks resolve automatically, flat N=1 features, and routing-off behaviour stay as
they are today.

Engine-internal stacked-restack machinery plus one operator CLI subcommand; no product requirements
worth a PRD. Acceptance criteria live in stories.
