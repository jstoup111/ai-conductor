# Conflict Check: Manual-test failure routed to a child that can't hold the fix, no way out (#3605)

**Date:** 2026-11-07
**New stories:** `.docs/stories/manual-test-failure-routed-to-a-child-that-can-t-h.md` (Stories 1–4)
**Result:** PASSED after resolution. Two blocking conflicts were rooted in story phrasing and were resolved in place, with zero remaining.

## Corpus

Every file in `.docs/stories/` was scanned for the behaviors these stories touch: the audit no-op guard and `derived-already-complete`, residue routing placement and its reasons, `stack rounds --close`, `routing_round_superseded`, the stack-commit-guard refusal, and taskless obligations. Pairs found to share a behavior were checked in both directions.

**ADRs examined:** `adr-2026-10-12-routed-whole-feature-repair` (decisions 1, 3, 4, 6, 7, 16, as amended by #3605), `adr-2026-07-13-kickback-build-no-op-escalation` (D1, as amended by #3605), `adr-2026-10-24-operator-route-round-for-closed-stacked-children` (decision 1: the guard does not run for operator rounds), `adr-2026-07-06-manual-test-fail-routing` (decisions 2 and 3: flat kickback with retry hint), `adr-2026-07-10-validation-group-join` (decision 3: consolidated work order).
**ADRs narrowed out:** every other approved ADR. None addresses routing placement, routed host entry, round closure, or the commit guard.

## Conflict: A host with zero routed tasks reads as "already evidence-complete" and halts

**Stories involved:** #3605 Story 1 (a taskless host dispatches BUILD) vs the no-op guard criterion in `a-routed-fix-cannot-be-built-charged-and-reviewed-.md`, and #3590 Story 2 (negatives 1–2) and Story 3 (negative 1)
**Files:** `.docs/stories/manual-test-failure-routed-to-a-child-that-can-t-h.md` vs `.docs/stories/a-routed-fix-cannot-be-built-charged-and-reviewed-.md`, `.docs/stories/routed-residue-finding-lands-on-a-taskless-host-an.md`
**Type:** contradiction
**Severity:** blocking

**Description:** The existing criteria halt `derived-already-complete` when "every routed task for host 1 … is already evidence-complete" or "host 1 is already evidence-complete after region entry". For a host whose only work is a taskless obligation, that holds vacuously. #3605 Story 1 requires such a host to dispatch BUILD. The two cannot both hold for the gem_miner r2 shape (confidence 90%, from the criteria text and the verified guard implementation).

**Resolution Options:**
1. Scope the four existing criteria to hosts that have at least one routed task and no taskless obligation. The behavior they protect is unchanged.
2. Restate Story 1 as an exception list inside each existing story.
3. Reopen architecture.

**Recommendation and operator decision:** Option 1. The root is phrasing that predates taskless routing, and the governing ADR text is already amended by #3605.

## Overlaps checked and found compatible

- **Placement owner vs host.** `admitted-whole-feature-fixes-in-a-stacked-feature-.md` and #3590 Story 1 assert that an ambiguous answer's *owner* is the earliest candidate with `residue-default`. #3605 Story 2 asserts the taskless obligation's *host* is raised or set to the leaf. The owner is unchanged, so both hold.
- **Routing-call contract.** "The routing call has its own schema, its own contract version and a two-attempt budget" still holds with `v2`.
- **`routing_round_superseded`.** #3459 Story 2's survivor event (`supersededBy` r5) holds; #3605 adds `disposition`, which is `superseded` in that case.
- **Sole-round close.** #3459 Story 3's sole-round, admitted-host and marker-holds-round refusals were scoped during `/stories` to the case where another round is non-closed. The scoped forms and #3605 Story 3 hold together.
- **Commit guard.** `manual-reviewer-edits-cannot-be-landed-safely-in-t.md` names `stack land --abandon` for an operator landing round, which matches #3605 Story 4.
- **In-flight #3597** (not on main). Its whole-feature gate fence requires no open round, marker or queue entry. A sole-round close leaves no open round or marker, so the leaf gates in #3605 Story 3 may run. No oscillation.
- **Anti-whitewash.** #3605 Story 1's no-commit path relies on the existing refusal of a `manual_test` PASS with no new commits. No contradiction.
