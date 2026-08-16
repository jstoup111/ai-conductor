# Track: Stale manual_test discovered at FINISH is unroutable

Track: technical

Scope boundary: Balanced, family-scoped (operator-confirmed 2026-08-16). Stop FINISH halting an
otherwise-shippable feature when a SHIP validator has gone stale, covering the whole class rather
than the single observed variant — the 2026-08-15 stale `manual_test` and the 2026-08-16
evidence invalidated by ship-tail commits.

The operator's steer was to fix the family through one mechanism rather than per-validator special
cases. Exploration and the repo-wide ADR sweep then established that the mechanism already exists
and is APPROVED: the current-HEAD publication fence required by decisions 3-5 of
`adr-2026-07-26-rebase-tail-current-branch-before-publication`, disabled on every production path
since 2026-08-04. The work is therefore restoring conformance, not adding a routing rule.

Excluded: unifying the FINISH evidence observer's `stepDone` predicate with the loop's
`stepSatisfied`/`gateSatisfied` predicates (jstoup111/ai-conductor#1587's scope); the publication
advance fixed-point guard and halt-PR short-circuit (jstoup111/ai-conductor#1487, already specced);
`findResumeIndex`'s last-done-wins entry rule; implementing
`adr-2026-08-01-engine-owned-resumable-finish-publication` D5's "route to BUILD" clause for the SHIP
half, which three APPROVED decisions oppose and which the new ADR records as deliberately declined;
and the non-fast-forward ship push the operator noted as an adjacent annoyance, which belongs to its
own intake.

Engine-internal correctness fix to the SHIP-tail fence (`conductor.ts`) and the FINISH publication
router (`finish-publication.ts`); no user-facing product capability, so acceptance criteria live
directly in stories.
