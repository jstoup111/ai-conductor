# ADR: Selective verification after a completed rebase

**Date:** 2026-09-11
**Status:** APPROVED
**Deciders:** James Stoup, composer architecture review
**Source-Ref:** jstoup111/ai-conductor#2253
**Amends:** adr-2026-07-20-post-rebase-delta-aware-invalidation; adr-2026-07-08-post-rebase-gate-first-mechanical-reverify; adr-2026-07-22-gate-evidence-code-validity-on-redispatch

## Context

A rebase can reopen coverage_binding and trigger positional downstream staleness through acceptance_specs and BUILD, even after BUILD's mechanical completion check passed. The current classifier uses changed-path overlap: unrelated upstream edits in a shared feature-owned file can reopen feature-scoped reviews. Completion checks at finish/resume independently use path-based validity, so fixing only the rebase selector would not preserve a verdict all the way to publication.

The operator approved the whole #2253 flow, approach A, the technical track, the sequence diagram, and the five architecture decisions presented in this composer session. The operator explicitly requires respecting in-flight work.

This is a structural state-transition and evidence-ownership refinement. Existing ADRs govern the underlying mutation port, gate surfaces, review validity, suite evidence, and rebase entry. They do not provide one replay-bound preservation decision consumed consistently by state, verdict readers, and events. This ADR adds that missing ownership contract rather than replacing those systems.

## Options Considered

### Option A: Expected replay tree plus one selective revalidation decision — chosen

- **Pros:** deterministic byte-level check; recognizes disjoint upstream changes in the same file; reuses Git and existing gate/evidence/state seams; keeps uncertain cases conservative.
- **Cons:** some valid but nontrivial replays remain unproven and pay for reviews; gate preservation must be enforced at both rebase handling and later validity checks.

### Option B: Normalize patches or compare patch ids

- **Pros:** compact comparison.
- **Cons:** dropping whitespace, hunk locations, blob identities, or context can hide a meaningful edit; retaining them all can reject harmless shared-file upstream edits. Not selected as a preservation authority.

### Option C: Fingerprint every judged gate's inputs at every pass

- **Pros:** broader freshness infrastructure.
- **Cons:** expands into independently owned resume/review work and changes all judge writers. Rejected for this feature's bounded rebase scope.

## Decision

1. **Preserve entry and prerequisite ownership.** Apply this policy after a successful actual rebase, from both normal finish and mandatory re-kick. Keep #1207/#2515 entry policy, current code/test skip safeguards, protected-seal checks, evidence translation, conflict-resolution guards, and caller distinctions. Consume #2211 / PR #2453's active-document resolution, gate projections, and document-aware invalidation; do not implement a competing resolver. Sequence implementation after #415 / PR #2495 on the shared rebase driver and preserve its pre-rebase collision handling. The spec's implementation must not dispatch before these dependencies have landed. #2462 repair-boundary recovery and #2488 general resume freshness remain separate owners.

2. **Prove expected replay by exact tree identity.** Capture immutable pre-rebase head P, its merge base B with the chosen target, immutable target O, and final successful head H. Through the existing injected Git runner, compute the expected merge of P and O with explicit merge base B using Git's merge-tree write-tree capability. A clean result whose tree equals H's tree is evidence that the actual result contains the expected replay, including disjoint upstream changes within a feature-owned file. Require the existing actual-rebase success, history, protected-artifact, and working-tree checks as well; this comparison replaces none of them. Do not use whitespace-insensitive patch ids, provider claims, filenames alone, or equality of unrelated snapshots as proof. A conflict, nonzero exit, unsupported Git capability, invalid/missing object, unavailable baseline, or unequal result yields no unchanged-replay proof. Keep P/B/O available across resolver attempts from the same operation; do not reconstruct trusted identities later from a moved branch name or unrelated ORIG_HEAD. Recovery lacking those identities uses the conservative path.

3. **Keep combined-tree and review-input changes distinct.** Feed the combined-tree delta and #2453's active document inputs into its shared gate projection. Valid unchanged-replay evidence permits preservation of already-passing feature-contribution reviews despite upstream path overlap. It does not preserve a review whose relevant requirements, plan, coherence, or other declared authority inputs changed. It does not prove runtime compatibility: test_suite still uses its actual verification inputs and manual_test retains its whole-runtime surface and participation policy. Without unchanged-replay evidence, use conservative affected-gate revalidation, widening when the necessary input surface cannot be established. Preserve only gates already valid before the operation; outstanding FAIL/refused/pending repair obligations remain outstanding.

4. **Use one explicit post-rebase decision for state, verdicts, and events.** Compute the actual preserve/refresh/invalidate result once, including successful mechanical preverification, and pass that result to its consumers. Apply only the authorized step-field mutations through ConductStateStore's existing intent-bearing atomic batch. Do not call a generic positional downstream sweep for rebase-origin refresh. A completed acceptance_specs or BUILD is not reopened because it lies after an invalidated gate. Keep skipped/disabled steps skipped and preserve unrelated fields and obligations. The normal selected continuation after a code-changing rebase starts no earlier than test_suite; publication resumes only after all required checks pass. Refresh an invalidated coverage_binding through its existing runner, digest cache, envelope, retries, and lifecycle events in place, without selecting the intervening acceptance/BUILD steps. A does-not-assert result retains its existing needs-human route; unavailable coverage evidence retains the existing retry/refusal behavior. This does not make coverage_binding tree-attesting or grant it new repair authority.

5. **Persist bounded preservation in existing gate evidence and enforce it at readers.** An engine-produced preservation record identifies the gate and original passing verdict/attempt, P/B/O/H, the exact replay comparison, and the relevant review-input identities used in the decision. This is additive durable evidence in the existing gate evidence/stamp contract, not a new log, second verdict store, or replacement judge result. Share its validation through gate-code-validity and the existing completion/sweep/finish readers so they cannot discard a valid preserved verdict by applying an older independent path-only rule. Check provenance, gate binding, object availability, and relevant inputs at consumption; do not rewrite the original judge's attempt identity or claim that a new judge ran. A later relevant change, unresolved ordinary kickback, missing/malformed binding, or unverifiable replay invalidates that preservation authority. Existing legacy/opt-out and fresh-dispatch requirements remain fail-closed. Refreshes or failures must not resurrect a superseded passing verdict. Existing state/verdict storage is not one transaction: an interrupted application must remain non-publishable until reconciled from valid durable evidence, and retry must not duplicate invalidations or erase newer failures.

6. **Repair only on concrete failure evidence.** Retain mechanical BUILD evidence derivation. If completed work cannot be established after rebase, stop with the existing evidence/recovery diagnostics rather than blindly reopening the completed task list; genuinely outstanding repair obligations retain their owner. A completed test_suite command with a failing exit enters the existing bounded BUILD repair route, then reopens test_suite and ordinary downstream validation. A suite infrastructure failure cannot establish a code defect and retains its current bounded retry/halt route without charging code repair as if tests failed. Preserve configured content-based suite reuse and drift tolerance. Review implementation defects, specification gaps, architecture gaps, and unavailable judge evidence retain their established distinct routes and budgets.

7. **Use the existing event spine.** Reuse gate-preserved, gate-invalidated, reverified, kickback, coverage lifecycle, and halt events. If explanation needs additive typed fields, extend the existing ConductorEvent variant and existing consumers. Events must describe the applied decision, not a separately recomputed candidate set that contradicts mechanical preverification. No watcher, poller, bespoke log, or parallel event schema is introduced.

8. **Prove the real flow with isolated boundaries.** Verification covers clean replay with disjoint same-file edits, changed resolution, unavailable reconstruction, document-only changes, disabled gates, suite pass/fail/infrastructure failure, coverage refresh/refusal, restart and finish-time evidence consumption, repeated application, and interrupted/same-field state writes. Exercise production entry points with isolated local Git and faithful fake provider/process boundaries. No default test calls GitHub or an LLM. Acceptance-spec generation, whole-task BUILD walks, and preserved-review dispatch counts must be asserted through the actual conductor paths, not inferred from a pure classifier test.

## Consequences

### Positive

- Clean replay can retain feature reviews despite unrelated upstream changes to the same files.
- Rebase refresh does not manufacture unfinished implementation by positional navigation.
- Finish and resume can consume the same preservation authority the rebase handler established.
- Existing suite and runtime verification still detect combined-tree breakage.

### Negative

- Clean expected-merge equivalence is deliberately conservative; an unprovable but correct replay may still rerun reviews.
- Preservation adds bounded evidence to an existing durable contract and requires reader integration, not merely a selector edit.
- Pending prerequisite PRs determine the implementation baseline; the plan must be checked against their landed versions before dispatch.

## Wiring Surface

- rebase.ts: performRebase and resolveRebaseConflicts capture immutable replay identities; successful outcome classification produces comparison evidence.
- gate-invalidation.ts: extend #2453's projection/decision seam with replay evidence while retaining separate active-document and combined-runtime inputs.
- conductor.ts: runRebaseStep/advanceTail apply the shared result, invoke required coverage refresh through the existing runner, and use the mutation port rather than positional navigation.
- daemon-rekick.ts: resumeRebaseFirst consumes the same result before conductor resume; mandatory base play-forward remains unchanged.
- gate-verdicts.ts and the existing gate stamp/artifact contracts: persist bounded preservation alongside current authority.
- gate-code-validity.ts and artifacts.ts consumers: completion, sweep, and finish validate that authority consistently.
- Existing event emitter and event type/sink seams: consume the applied result and retain the single event spine.

## Governing Decisions Reused

- adr-2026-09-11-finish-mergeability-respects-active-review-inputs: entry/re-kick and active-document policy.
- adr-2026-08-01-conduct-state-mutation-port: explicit field mutations, expected-value conflicts, atomic state batches.
- adr-2026-08-31-coverage-binding-judge-step: judge ownership, digest cache, disabled behavior, needs-human refusal.
- adr-2026-07-25-content-addressed-full-suite-proof and adr-2026-08-28-test-suite-drift-budget-and-verification-mode: suite evidence/reuse.
- adr-2026-07-22-gate-evidence-code-validity-on-redispatch, including #2381/#2382 amendment: existing validity and translated-history seam.

## Verify-Claims Ledger

- [verified] Current rebase verdict application can mechanically confirm BUILD, while advanceTail still reopens coverage_binding and invokes positional navigateStateBack; inspected rebase.ts, conductor.ts, and state.ts.
- [verified] ConductStateStore already supports expected-value atomic batches and rejects persistence conflicts; inspected conductor.ts and its governing ADR.
- [verified] Coverage binding uses criterion/Done-when digest caching and is not tree-attesting; read its APPROVED D4-D7 and #2515 D7.
- [verified] Installed Git advertises explicit --merge-base with merge-tree --write-tree. An isolated local-Git probe retained same-file disjoint feature/upstream changes and rejected an additional feature edit by exact expected/actual tree comparison. This is feasibility evidence, not production validation.
- [verified] #2453 head f9bc6198a10da6f21fbcde8a72578e32176f47f5 and #2495 head 65ab8c273273f231602e3204b8874e0ba643dd4e remain open at this review.
- [approved] Whole-flow scope, existing entry-policy boundary, conservative exact-tree comparison, one selective decision, existing evidence integration, and existing recovery ownership: operator approvals in this session.

Verdict: CLEAR. No unconfirmed assumption is used as implementation authority. Unsupported or incomplete replay evidence takes the explicit conservative branch.
