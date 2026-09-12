# Track: Selective verification after a completed rebase

Track: technical

Source-Ref: jstoup111/ai-conductor#2253

Scope boundary: The operator approved the whole post-rebase flow in #2253 and approach A on 2026-09-11: preserve completed work when the feature contribution and relevant review inputs are unchanged, selectively revalidate affected gates, route actual suite failures into ordinary BUILD repair, and prevent positional downstream reopening. The operator additionally requires respecting in-flight work: consume its delivered seams and explicitly sequence overlapping implementation rather than duplicate or replace it.

This corrects internal engine state, verification, and recovery behavior; acceptance criteria belong in technical stories, without a PRD.

## Accepted approach

Extend the existing rebase classification and recovery flow. Distinguish evidence refresh from implementation repair. A successful completed rebase does not by itself require acceptance-spec authoring or a BUILD task walk. Relevant input changes still invalidate reviews; suite execution failures still return to BUILD, while unavailable verification remains an infrastructure failure. This is an approach approval, not approval of an algorithm or architecture.

## In-flight ownership discovered during exploration

- #2211 / PR #2453 owns active stories/PRD/plan/coherence input resolution, per-gate surface projection, accurate invalidation event payloads, and document-aware finish/rebase recovery. Reuse that implementation after it lands. Inspected branch head: f9bc6198a10da6f21fbcde8a72578e32176f47f5.
- #415 / PR #2495 owns pre-rebase untracked collision recovery and failure classification. Preserve that behavior; this feature starts its new policy after a successful rebase. PR head observed: 65ab8c273273f231602e3204b8874e0ba643dd4e.
- #2462 concerns stale repair boundaries after history rewriting; #2488 concerns valid SHIP verdict reuse across pre-finish halt/resume. Both are open adjacent issues, not verified implementation dependencies yet. Do not silently absorb their deliverables.
- #947 concerns aggregate-proof reuse; retain the existing content-based proof and explicitly configured drift-budget contract.

These observations are not mechanical dispatch blockers. Before landing a build-ready spec, resolve implementation dependencies and their enforcement using the repository's existing dependency machinery.

> **Amended 2026-09-11 by #2253:** The operator confirmed that the existing finish/re-kick integration policy remains authoritative. Reuse the finish policy from #1207 as superseded by #2515 and implemented by #2453; this feature changes what reopens after an actual rebase, not when normal finish or re-kick must rebase. Current main additionally refuses mergeable-skip for base-side code/test changes; do not remove that behavior under this feature. #2453 is the confirmed in-flight overlap. Preserve its active-input classification and shared projection rather than duplicate them.

## Verify-Claims Ledger

- [verified] Current rebase verdict application adds BUILD to the invalidation candidates, subject to mechanical preverification: src/conductor/src/engine/rebase.ts, applyRebaseVerdicts.
- [verified] Rebase tail handling calls navigateStateBack for invalidated gates including coverage_binding and BUILD: src/conductor/src/engine/conductor.ts, advanceTail.
- [verified] markDownstreamStale stales completed later steps except an explicit preservation list: src/conductor/src/engine/state.ts.
- [verified] The current classifier compares path overlap; the inspected #2453 implementation additionally shares gate projection and resolves active documents.
- [verified] Suite nonzero exits enter bounded BUILD repair; other typed suite infrastructure failures halt: src/conductor/src/engine/conductor.ts.
- [approved] Whole-flow scope, approach A, and technical track: operator responses in this composer session on 2026-09-11.
- [pending architecture] Exact contribution-equivalence algorithm, handling of unavailable completion evidence, dependency ordering, and integration with finish-time freshness remain to be designed and verified. No implementation assumption is approved by this marker.

> **Amended 2026-09-11 by #2253:** The architecture questions listed as pending above were resolved in the operator-approved selective-post-rebase ADR. The plan implements that approved policy; prerequisite dependency enforcement remains required before handoff.
