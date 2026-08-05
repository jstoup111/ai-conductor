# Conflict Check: Inherited-revision tolerance in the protected-artifact seal

**Date:** 2026-08-05
**Inventory:** all `.docs/plans/`, `.docs/stories/`, and `.docs/decisions/` artifacts, narrowed by
keyword scan (`protected-artifact`, `matchesBaseTip`, `inheritedFromBase`, `plan-protected-targets`,
`cleanly mergeable`, `rebase skipped`, `stale base`) to the seal, halt-class, and rebase-staleness
families; each candidate then cross-checked against `.docs/shipped/` to separate live specs from
shipped history.
**Result:** **PASS — zero blocking conflicts.** One degrading overlap is accepted with a resolution.

## Overlap: #1293's DECIDE-owned amendment design asserts "no new tolerance"

**Stories involved:** This spec's Story 1 (inherited-revision tolerance) vs
`adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts` (#1293, APPROVED, no plan or stories
authored yet)
**Files:** `.docs/decisions/adr-2026-08-05-provenance-based-protected-artifact-inheritance.md` vs
`.docs/decisions/adr-2026-08-04-decide-owned-amendment-of-accepted-artifacts.md`
**Type:** overlap
**Severity:** degrading
**Confidence:** 90% — verified by reading #1293's ADR and its review report directly; the residual
uncertainty is only whether #1293's unwritten plan later chooses to touch `inspectSeal`, which its
current design says it does not need to.

#1293 states its design needs "no new tolerance, no new seal schema, no rotation, and no reseal
command," and reuses three primitives: `parsePlanTaskPaths` (`plan-task-parse.ts:70`), the sealed
directory list (`protected-artifact-seal.ts:17-22`), and `namesOwnFeature` (`:508-511`). This spec
adds a tolerance and touches none of those three.

The sentence reads like a contradiction and is not one. #1293 is describing what *its* feature
requires in order to work — its enforcement happens at plan-authoring and land time, upstream of
BUILD, and it is correct that it needs no seal change. It is not asserting a constraint that the
seal's tolerance must never widen for other reasons.

**Resolution Options:**

1. Land both. They edit the same file in non-overlapping regions (`inspectSeal`'s refusal branches
   here; a new plan-time gate reusing exported predicates there). Whichever lands second takes an
   ordinary rebase.
2. Sequence this spec behind #1293 to avoid any rebase.
3. Fold the two into one feature.

**Resolution: Option 1.** The regions are disjoint and the primitives #1293 depends on are
explicitly out of scope here (recorded in the ADR's consequences and the review's out-of-scope
list). Option 2 buys nothing — #1293 has no plan yet, so sequencing behind it would stall a
`priority: critical` defect indefinitely. Option 3 merges an operator-facing process change with an
engine correctness fix, which is worse for both.

## Non-conflict: the `mergeable_skip` stale-base family

The filer raised a possible shared root cause with "rebase skipped — cleanly mergeable with base".
That behavior is `adr-2026-07-30-finish-only-mergeability-gate` (shipped), where a cleanly-mergeable
branch skips the rebase *and* skips seal rotation and evidence translation. It is a deliberate,
approved decision, and `mergeability-first-finish.acceptance.test.ts:71` pins that `mergeable_skip`
leaves the seal byte-identical.

This is not a conflict: this spec changes what the seal *tolerates*, not whether a rebase runs, and
it never rotates a seal. The two are compatible today, and this spec makes them more so — the whole
point is that a branch which skipped its rebase, and is therefore behind, no longer halts for it.
Whether the mergeability gate should also validate against a moved base is a separate question,
recorded as out of scope in the architecture review rather than resolved here.

## Non-conflict: shipped seal history

`2026-07-26-...-976` (base-inheritance tolerance and rebaselining), `2026-07-27-...-1047`
(self-amendment reporting), `2026-07-28-...` (the `HALT.class` sidecar), `build-tasks-can-amend-
protected-docs-artifacts-ame` (`plan-protected-targets.ts`), and `daemon-build-start-base-refresh`
have all shipped. They are history this spec builds on, not live specs it can contradict. #976 is
the direct predecessor: this spec widens the tolerance it introduced and preserves its accepting
case intact.

## Non-conflict: incidental mentions

`inline-build-work-commits-unattributed-session-hoo` (open) names protected-artifact boundaries in
one framing sentence but changes commit attribution. `mergeable-watch-registry-size-cap`,
`daemon-false-ship-guard`, `auto-resolve-open-pr-conflicts`, and
`issues-close-on-first-production-observation-of-th` (all open) touch watch-registry and label
mechanics with no seal surface. None share a contract with this spec.

## State and resource contention

**None.** This spec introduces no new persisted state, no new file under `.pipeline/`, no new
configuration key, no new CLI verb, and no new daemon lock. It adds two read-only git invocations on
an existing refusal path.
