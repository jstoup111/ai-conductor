# Architecture Review: Stale manual_test discovered at FINISH is unroutable

**Date:** 2026-08-16
**Mode:** lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Input reviewed:** `.docs/track/`, `.docs/complexity/`, `.docs/architecture/` for this slug;
jstoup111/ai-conductor#1613 and its 2026-08-16 comment. Stories and plan follow this review.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Clean. No new package, service, or infrastructure. The primary change removes one disjunct from an existing guard clause. |
| Prerequisites | None external. The mechanism being restored is already written, already tested at the unit level, and was live in production until 2026-08-04. |
| Integration surface | Two modules — `conductor.ts` (the fence and its guard) and `finish-publication.ts` (the router's condition mapping). No new module, no new export. |
| Data implications | None. No schema, no migration, no config key, no change to `GateVerdict`'s shape. |
| Performance risk | The fence recomputes validator verdicts before each FINISH dispatch. That cost was accepted by the governing ADR and is bounded by the validation group's membership (at most three members). |
| Worktree isolation | Unaffected — all state is already worktree-local under `.pipeline/`. |

**Feasibility verdict: feasible, and materially smaller than the alternative.** The first draft of
this review proposed adding a FINISH→BUILD route for invalid SHIP evidence. The repo-wide ADR
sweep showed that design contradicted three APPROVED decisions and that the correct mechanism
already exists in the tree, disabled.

## Alignment

**The engine is out of conformance with an APPROVED decision, and this restores it.**
`adr-2026-07-26-rebase-tail-current-branch-before-publication` (APPROVED, operator-approved
2026-07-26) requires at decisions 3-5 that a current-HEAD validation fence run before *any* finish
dispatch or publication side effect, that a `stale` member be non-green "even when an older
artifact remains on disk", and that a non-green fence redirect to the earliest such member. That
fence is `nonGreenFinishValidators` (`conductor.ts:1602-1640`) and it returns `[]` on every
production path because of the `this.finishPublication ||` disjunct at `:1609`. `git log -L`
attributes both that disjunct and the placeholder halt to the same commit, `9a6005e61` (#1295,
2026-08-04).

- **Domain boundaries** — respected and improved. Prevention returns to the tail loop where the
  governing ADR places it, instead of being compensated for inside the publication coordinator.
- **Pattern consistency** — the strongest possible form: the code being restored is the pattern.
  `adr-2026-08-03-build-repair-member-reuse-validity` cites this very fence as live precedent for
  its own decision, so leaving it disabled also erodes a second APPROVED decision's stated basis.
- **State management** — improves. It removes a reachable state whose only exit is an operator.
- **Exhaustive matching** — the residual concern. The router still enumerates four condition codes
  in an `if` with a reason string that will be false once the fence is live. Condition 2.
- **Production DI defaults / security boundaries** — not applicable; no injected store, input,
  endpoint, or credential path changes.
- **Diagram accuracy** — `.docs/architecture/` for this slug was authored in this pass and renders
  (`conduct-ts render-diagrams --check`, 2 diagrams).

## Wiring Surface

No new production surface is introduced. Every changed primitive is already wired, which is the
point of the change:

| Changed primitive | Production caller it is reached from |
|---|---|
| `nonGreenFinishValidators` guard clause (`conductor.ts:1609`) | already called from the pre-finish fence site (`conductor.ts:5338-5361`) on the SHIP tail; removing the disjunct restores reachability rather than adding a caller |
| the fence's redirect (verdict write, stale marking, `kickback` emit) | already inside that same call site; unchanged |
| `routeFinishPublicationDisposition` condition mapping | already the sole route producer, consumed at `conductor.ts:6195` |

The as-built sweep should expect **zero** new exports from this feature. A new export appearing in
the diff is a signal the implementation drifted toward re-authoring the fence instead of enabling
it.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| The disjunct was added for a real, unrecorded reason and the fence genuinely breaks the coordinator | Technical | Medium | **High** | Condition 1 — discharge before any dependent task; halt for the operator rather than work around it |
| Restoring the fence redirects runs that previously dispatched FINISH, surfacing latent non-green validators as new kickbacks | Technical | Medium | Medium | This is the governing ADR's intent; bounded by the existing per-gate cap. Watch the first live features through the tail |
| A future change re-adds a coordinator exemption for the same convenience | Knowledge | Medium | High | Story 5 pins the fence active whenever the coordinator is wired |
| Oscillation — the tail's own commits re-stale validators every lap | Technical | Low | High | The fence recomputes rather than force-invalidates, so an unchanged surface stays green (`adr-2026-07-22`, `adr-2026-07-20`). Condition 3 makes this an explicit test |

**Early overlap scan (advisory).** `conduct-ts overlap-scan` over the candidate paths returned
**233 rows** — effectively every spec branch that has ever touched `conductor.ts` or
`finish-publication.ts`, including long-merged ones. It carries no usable signal at this file's
churn level and is recorded as run, not as evidence. The real overlaps, identified by hand:

- **jstoup111/ai-conductor#1487** (specced, parked, spec PR #1551 merged) — reshapes
  `finish-publication.ts`'s advance and transition-retry guards. Adjacent, same-file merge risk
  only, no design conflict.
- **jstoup111/ai-conductor#1587** (open, unspecced) — owns unifying the `stepDone` /
  `stepSatisfied` predicates. Restoring the fence means FINISH stops being reached over a `stale`
  validator, which reduces #1587's blast radius but does not resolve it. Explicitly out of scope.

## Domain Integrity

Not run — handled per-cycle by the TDD domain reviewer (lightweight mode skips §5).

## Complexity

Not re-run — Medium was set in `.docs/complexity/` for this slug (lightweight mode skips §3).

## ADRs Created

- `adr-2026-08-16-restore-the-current-head-publication-fence.md` — APPROVED. Conforms to decisions
  3-5 of `adr-2026-07-26-rebase-tail-current-branch-before-publication`; supersedes nothing.

Structural prerequisite applied: the decision revises a **durable state-transition design** — where
publication authorization is enforced, and what a non-green validator does to the walk. Governing-ADR
reuse check applied, and it is what redirected this review: `adr-2026-07-26` was found to already
own the decision, so the new ADR records conformance and the two reconciliations it forces
(`adr-2026-08-01` D5's SHIP clause, and `adr-2026-07-13`'s no-op prohibition) rather than deciding
the mechanism afresh.

A superseded first draft, `adr-2026-08-16-ship-evidence-invalid-routes-to-build-under-d5`, was
withdrawn before it was committed. It proposed the FINISH→BUILD route; the sweep showed
`adr-2026-07-13-kickback-build-no-op-escalation` forbids routing into an already-satisfied BUILD,
`adr-2026-07-22` and `adr-2026-07-20` forbid its unconditional verdict invalidation, and
`adr-2026-07-25-content-addressed-full-suite-proof` made its evidence-artifact deletion ineffective.
It is recorded here rather than committed so the rejected direction is not re-proposed.

## Conditions

1. **Discharge the disjunct's rationale first.** Before any task depends on the fence being live,
   establish why `9a6005e61` added `this.finishPublication ||` — the commit, its PR, and whether any
   test asserts the disabled behavior. If a genuine incompatibility exists, halt for the operator;
   do not work around it.
2. **Retire the placeholder and make the condition routing total.** No production string may still
   say a routing rule is missing, and a condition added without a declared route must fail to
   compile.
3. **Prove the fence does not oscillate.** A test must drive repeated docs-only tail laps and
   assert no validator is re-staled — the property that distinguishes recomputation from
   invalidation.
4. **Expect zero new exports.** The implementation enables existing machinery; a new export is a
   drift signal for the as-built sweep.
5. **Leave `adr-2026-08-01` D5's SHIP clause deliberately unimplemented**, with the reason recorded
   in the ADR so a later reader does not "fix" it into a BUILD route.

## Blocking Issues

None.
