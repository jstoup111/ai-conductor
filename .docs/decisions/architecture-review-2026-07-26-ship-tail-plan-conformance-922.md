# Architecture Review: SHIP-tail plan conformance (#922)

**Date:** 2026-07-26
**Mode:** Post-plan conformance
**Plan reviewed:** `2026-07-26-ship-tail-parallel-validation-serial-publication-922`
**Verdict:** APPROVED

## Feasibility

The seven-task plan preserves the existing validation group, changes one registry dependency, and
adds one engine-owned pre-dispatch fence in the existing conductor loop. It requires no new
package, configuration key, service, persistent state, event type, verdict schema, or migration.

## Alignment

The plan implements the APPROVED comprehensive rebase-tail ADR through the existing registry,
group membership resolver, completion predicates, verdict writer, and conductor loop. The fence is
at the last common point before all finish side effects, so normal, resume, and explicit-target
paths cannot diverge. Changed-rebase and conflict paths retain their current handlers.

## Plan Coverage

- Concurrent validation join → serial tail: Tasks 1–2 and 5.
- Current-HEAD finish fence on every entry path: Tasks 1, 3–4.
- Validly skipped membership and selective parallel rerun: Task 5.
- Changed-rebase invalidation and conflict suppression: Task 6.
- Cross-suite compatibility: Task 7.

## Risks

The principal risk is test and caller compatibility: explicit finish targeting now navigates to
finish but can be redirected before dispatch. Task 7 updates fixtures intentionally rather than
adding a bypass seam. Selectively staling only non-green members prevents the fence from
serializing or needlessly rerunning the whole validation group.

## ADRs Created

None.
