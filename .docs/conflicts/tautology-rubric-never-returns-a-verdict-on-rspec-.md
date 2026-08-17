# Conflict Check: Framework-agnostic tautology scoped-run classification

**Date:** 2026-08-17
**Inventory:** all story files under `.docs/stories/`, all prior conflict reports, and the
`.docs/decisions/` ADR corpus; keyword and contract scan on `tautology`, `counterfactual`,
`collection-failure`, `no-tests`, `reverted`, `scoped`, and `preflight` narrowed semantic comparison
to the build_review rubric, preflight, exception, and evidence-retention family.
**Result:** **PASS — zero blocking conflicts remain.** Three blocking contradictions were found; all
three are resolved by the operator-approved architecture. No degrading conflict is accepted.

## Conflict: A control run would contradict the accepted single-execution contract

**Stories involved:** "Reuse green proof and measure Tautology's RED counterfactual" vs the
control-run design alternative considered for this feature
**Files:** `.docs/stories/build-review-rubric-dispositions-and-fan-out.md` (Story 24) vs
`.docs/decisions/adr-2026-08-17-framework-agnostic-tautology-scoped-run.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 98% — Story 24 requires that review "does not run the scoped tests against HEAD
again" and its Done-When pins "one upstream green execution and one isolated reverted-production RED
execution, with no second HEAD-green execution." A control run of the same selectors against the
HEAD-bytes checkout is exactly a second HEAD-green execution.

**Resolution Options:**

1. Reject the control run; classify from the single existing execution's exit code.
2. Adopt the control run and amend Story 24's single-execution contract, re-opening the cost decision
   that story settled.
3. Adopt the control run only when the counterfactual fails, leaving Story 24 satisfied on
   stayed-green laps and violated on the healthy path.

**Resolution:** Option 1, selected by the operator on cost grounds and independently required here by
Story 24. The chosen design invokes `runScoped` exactly once per materialization, so the accepted
contract is preserved unchanged. This conflict is recorded because it eliminates option 3 as well:
a conditional control run still violates Story 24 on precisely the laps where the counterfactual
fails, which is the common case.

## Conflict: Desired outcome 3 preserves a bucket the approved design deletes

**Stories involved:** intake `outcome-3` ("a scoped run that matched no executable test is still
classified as such — no regression in the no-tests path") vs "Process-level failures remain
infrastructure and the union carries no unfounded claim"
**Files:** `.pipeline/intake-outcomes.md` vs
`.docs/stories/tautology-rubric-never-returns-a-verdict-on-rspec-.md` (Story 2)
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — Story 2 requires that no `no-tests` result kind survive anywhere, while the
outcome asks for that classification to be retained.

**Resolution Options:**

1. Relocate the detection to the judging skill: the engine deletes the bucket, the rubric raises a
   finding when the excerpt shows no test executed.
2. Keep the `no-tests` regex branch alone and delete only the `collection-failure` fallback,
   retaining framework-specific parsing for one case.
3. Drop the detection entirely with no replacement.

**Resolution:** Option 1, recorded as D4 in the approved ADR and covered by Story 3. Option 2 fails
the operator's steer — it keeps Vitest and pytest phrasing hard-coded and leaves every other runner
undetected. Option 3 is a genuine regression against the outcome with nothing in its place; the
architecture review makes D4 a condition of approval for exactly this reason. Under option 1 the
outcome is met by a different mechanism and with a strictly better operator result: a routable
finding instead of an unroutable infrastructure stall.

## Conflict: Desired outcome 2 asks for a distinction #1593 deliberately removed

**Stories involved:** intake `outcome-2` ("a scoped run that genuinely fails to load its spec files
is still classified distinctly from one that ran and produced failing examples") vs the shipped
`#1593` decision that a reverted-tree collection failure is valid RED
**Files:** `.pipeline/intake-outcomes.md` vs
`src/conductor/src/engine/build-review-tautology-preflight.ts` (the exclusion at the scoped-run
branch and its rationale comment)
**Type:** contradiction
**Severity:** blocking
**Confidence:** 96% — restoring a mechanical distinction on the reverted tree requires re-introducing
the output parsing this feature removes, and would reverse a shipped decision.

**Resolution Options:**

1. Honor `#1593`: on the reverted tree both outcomes are RED, and the distinction survives in the
   bounded failure excerpt the judging skill reads.
2. Re-open `#1593` with its own ADR and restore a distinct non-RED class for reverted-tree load
   failures.
3. Distinguish the two by parsing runner output, scoped to a framework table.

**Resolution:** Option 1. `#1593`'s reasoning holds independently of this change: the preflight's
precondition is a current-HEAD green proof, so a changed test that cannot load once the diff's
production is reverted has demonstrably failed without the diff. Option 3 is the defect being
removed. Option 2 was surfaced to the operator and not selected; it remains available as a separate
feature if a case is ever observed where the two need different verdicts.

## Explicitly Compatible Overlaps

- **Launch/timeout/signal infrastructure path:** Story 24's negative path requires an infrastructure
  failure when "the scoped command cannot execute". Story 2 preserves `scoped-run-launch-failed`,
  `scoped-run-timeout`, and `scoped-run-signaled` exactly. No contradiction. Confidence 99%.
- **The four closed Tautology exceptions:** the removal-maintenance (`adr-2026-08-12`), verify-only
  (`adr-2026-08-15`), fixture-relocation, and rebase-repair exceptions are untouched. Story 3's
  negative path states explicitly that the no-executed-test rule never overrides a qualifying
  exception, so the exception set remains closed at four. Confidence 98%.
- **Preflight cache semantics:** the cache key's inputs are unchanged. `runKind`'s narrowed value set
  changes the projection's content digest, so entries computed before the change miss once; the cache
  is per-process and bounded at 32 entries, so there is nothing to migrate and no stale-hit path.
  Confidence 97%.
- **Rubric dispositions and convergence bounds:** `adr-2026-08-12-cumulative-build-review-convergence-bound`
  and the disposition store read verdicts and finding identities, neither of which this change
  touches. Removing a no-verdict path reduces cycling pressure rather than adding to it.
  Confidence 96%.
- **Event consumers:** the added event field is optional and additive, so the daemon CLI, UI
  renderer, report renderer, OTel visualizer, and `build-tail-rollup`'s infrastructure-failure
  counter all keep parsing unchanged. Confidence 98%.
- **Resource contention:** no new shared mutable resource. The disposable checkout, its cleanup path,
  and the single scoped invocation are unchanged in number and lifetime. Confidence 99%.

## Re-check

After applying the selected resolutions, all five conflict classes were evaluated:

- **Contradiction:** no accepted story now asserts both that the `no-tests` bucket exists and that it
  does not; the detection has exactly one home, in the judging skill.
- **Overlap:** the engine classifies, the skill judges, and neither re-derives the other's answer —
  `runKind` is produced once and consumed once.
- **State:** no ambiguous intermediate state is introduced; every scoped-run process outcome maps to
  exactly one member of the narrowed union.
- **Resource:** no new shared resource, no additional test-runner invocation, no change to checkout
  lifetime.
- **Oscillation:** the change removes an infrastructure-failure path and adds none, so it strictly
  reduces the no-verdict surface that produces kickback no-ops. The one detection that moves to
  judgement produces a finding, which is routable to `build` and can converge, rather than an
  infrastructure result, which cannot.

The conflict check passes with zero blocking and zero degrading conflicts.
