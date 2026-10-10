Waives: outcome-3

Rationale: jstoup111/ai-conductor#2942's outcome 3 asks that `build_review` for child k grade only
child k's changes against its parent's tip, "bound to child k's tasks, stories and Done-when
criteria". The child-local part is delivered:
- Story 9 grades the diff against the parent child's closure tip, with `baseKind: child-parent`.
- Remediation cases are per child (Story 9).
- Security runs once, at the leaf (Story 10).

The binding clause is deliberately not delivered as written. The engine source has no Done-when
binding to scope: `boundTo` and `doneWhenContext` from
`adr-2026-08-21-review-bound-by-plan-done-when-criteria` D2 are not on any live path, and the
build_review rubric container holds only `testQuality` and `security`.

Today review scope comes from the review base: only tests changed since that base are graded. The
plan body stays whole so that a child-k test's `Covers:` can resolve to an earlier child's task.
Projecting the plan per child would silently drop such tests from scope and change the review
cache key.

This narrowing is recorded in `adr-2026-10-07-per-child-build-region` decision 9 and in the
architecture review. It was decided during DECIDE under the operator's delegation, and it is flagged
for operator review on the spec PR. Reintroducing Done-when binding per child needs the binding
machinery itself first, which is a separate intake.
