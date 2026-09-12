# Architecture Review: Selective post-rebase verification

**Date:** 2026-09-11
**Mode:** Lightweight — Medium
**Track:** technical
**Source-Ref:** jstoup111/ai-conductor#2253
**Verdict:** APPROVED

## Inputs

Operator-approved whole-flow scope and approach A; approved sequence diagram at .docs/architecture/file-changing-rebase-rewinds-past-test-suite-and-r.md; current rebase, state, and verdict-validity source; #2453/#2495 open implementations; the governing decisions cited by adr-2026-09-11-selective-post-rebase-verification.

## Feasibility

Pure TypeScript and injected Git calls within the existing engine. Git's expected merge-tree comparison was exercised in an isolated scratch repository: a disjoint upstream edit in the feature's file preserved the expected result, and an extra feature edit did not. This does not prove all replay shapes; unsupported/conflicted/unavailable comparisons remain conservative.

No new service, provider capability, dependency package, network test, or configuration surface is required. The runtime cost is one bounded local merge-tree computation plus existing input/evidence reads per actual rebase. Existing resolution and Git capability errors must not become false preservation.

The important integration boundary is durable authority: rebase state, gate verdicts, completion readers, and event explanation currently have separate paths. Merely changing the rewind target would leave path-based finish invalidation active. The approved design centralizes the decision and lets existing readers validate its bounded evidence.

## Alignment

- Entry policy and pre-rebase collision recovery retain #2515 and #2495 ownership.
- #2453 owns active-document resolution and gate projections; #2253 extends that delivered seam.
- Coverage remains an LLM judgement using its existing digest cache and runner, never a fabricated mechanical pass.
- State uses ConductStateStore and expected-value batches. Verdict/state interruptions remain fail-closed until reconciled; no claim of cross-file atomicity.
- Native suite proof, configured drift tolerance, ordinary repair budgets, disabled gates, and pending failures remain authoritative.
- The ADR adds replay-bound preservation evidence to existing gate authority. It does not create a generalized review-fingerprint platform or take over #2462/#2488.

## Structural Prerequisite and ADR Reuse

A new ADR is warranted because the change assigns shared ownership of a durable post-rebase transition and its preservation evidence across writers and readers. Existing ADRs cover the mutation port, tree attestation, gate surfaces, and redispatch validity but not that joint replay-bound result. The new ADR amends only those rebase/validity clauses; it reuses all other governing decisions.

## Wiring Surface

Production paths are performRebase/resolveRebaseConflicts → shared gate projection/decision → runRebaseStep/advanceTail or resumeRebaseFirst → ConductStateStore plus existing verdict evidence. Required coverage refresh reaches the current step runner. Completion/sweep/finish reach shared gate-code-validity. Rebase and coverage occurrences reach the current ConductorEventEmitter/EventPersister spine. The ADR identifies the owning files; the plan must name the actual landed #2453 entry points.

## Overlap and Ordering

Directly inspected open PR #2453: active input resolution, gate projection, rebase outcome classification, and related engine/local-Git tests overlap. Consume after merge; do not reimplement.

Directly inspected open PR #2495: pre-rebase collision handling and shared rebase driver overlap. Sequence after merge while leaving its policy intact.

The advisory overlap scan on candidate engine paths also named old origin/spec/daemon-self-host-guardrails and origin/spec/self-host-phase6-wiring branches. Its GitHub blocker lookup initially failed due to sandbox networking; a subsequent direct read succeeded and found no existing blocked_by links for #2253. Direct open-PR inspection is therefore required alongside that advisory output; the scan's limited branch inventory is not proof of no overlap.

Mechanical dependency links still need to be established before spec handoff; this review does not claim they already exist. The operator's no-overlap constraint remains binding.

## Failure Boundaries

- Missing replay identities or Git failure: no unchanged-replay authority.
- Changed active review inputs: no preservation based on implementation equivalence alone.
- Coverage does-not-assert: existing refusal and human correction, without unrelated BUILD replay.
- Missing or forged gate binding: existing fail-closed evidence handling.
- Concurrent step mutation or partial state/verdict application: no publication based on partial success.
- Actual suite failure: ordinary bounded BUILD repair and downstream revalidation.
- Unavailable verifier or judge: existing infrastructure recovery, without inventing a code defect.

## Event-Spine Check

Channel: no new channel. Occurrences use existing ConductorEvent variants and readers; additive explanatory fields remain on that spine. Replay preservation is durable gate evidence, exception C, stored with existing gate authority. No sidecar log, timestamp-based occurrence reconstruction, or watcher is introduced.

## Approval

The operator approved the diagram and then the architecture decisions in this composer session on 2026-09-11. ADR adr-2026-09-11-selective-post-rebase-verification is APPROVED. Medium-mode feasibility and alignment are complete. Stories may now be authored; no implementation has been performed.
