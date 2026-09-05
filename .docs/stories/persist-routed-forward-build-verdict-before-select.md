**Status:** Accepted

# Stories: Persist routed-forward build verdict before selection

Source: jstoup111/ai-conductor#2178. Authorized by the operator's 2026-09-05 spec-batch request and expanded candidate scope.

## Story 1: A recorded forward decision is visible to the next selector

**Requirement:** #2178 desired outcomes 1–2.

As an operator, I want an eligible build's forward-routing decision to survive the gate read so that the same obsolete verdict cannot consume repeated retry budgets.

### Acceptance Criteria

#### Happy Path

- H1: Given a persisted unsatisfied build verdict from an earlier rebase, when the current build legitimately routes forward after budget exhaustion with committed progress and a clean worktree, then the build gate file contains a fresh satisfied verdict with that routing reason before the next selection.
- H2: Given that persisted forward verdict, when selection resumes, then it advances to the configured next unsatisfied gate and reaches subsequent validation without dispatching another build lap solely because of the old verdict.
- H3: Given no prior build gate file, when the same forward route occurs, then a satisfied verdict is created with the existing routing reason or its existing fallback reason.

#### Negative Paths

- N1: Given an ordinary unsatisfied build completion with no eligible route-forward decision, when its verdict is evaluated, then it remains unsatisfied; old route-reason text in state alone cannot create a successful verdict.
- N2: Given a genuinely stale build or a later real negative gate verdict, when the selector evaluates it, then it remains eligible for re-selection under existing precedence; a previous forward route is not a permanent exemption.
- N3: Given failure to persist the forward verdict, when the transition runs, then it does not emit a successful gate-verdict event or proceed to next-gate selection; existing transition-failure handling remains responsible for stopping the run.

### Done When

- [ ] A bounded real-loop regression begins with an obsolete negative build verdict, exhausts one progressing clean build budget, and observes the fresh satisfied file before subsequent validation, with no extra build lap.
- [ ] Targeted transition tests cover existing-file replacement, no-file creation, ordinary negative behavior, stale/negative selector precedence, and failure of the verdict write.
- [ ] The successful `gate_verdict` event reports the same satisfaction and reason that were durably written; no new event or state channel is introduced.

### Coverage disposition

All H1–H3 and N1–N3 belong to Task 1. H1–H2 have one bounded conductor-loop integration; direct transition tests cover storage variants and write failure, and existing selector tests cover stale/negative precedence where already sufficient. Each criterion is diff-local. New acceptance/system specs are unnecessary because the existing integration seam proves the entire changed transition.

Relevant negatives are state consistency, failed persistence, and inappropriate reuse of routing success. No new authentication, network, queue, schema, resource-exhaustion, or deletion behavior is introduced. Local Git fixtures and injected provider/verifier adapters isolate third parties and end at the first subsequent validation dispatch.

Status: Accepted
