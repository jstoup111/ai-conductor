# Architecture Review: Accurate test-quality review scope

**Date:** 2026-09-06
**Tier:** L — full pre-stories review
**Inputs reviewed:** .docs/track/testquality-admits-724-test-titles-for-eight-chang.md; operator-approved component diagram and technical intent. Stories and plan are not yet accepted inputs.
**Verdict:** APPROVED

## Feasibility

The chosen design extends verified production seams: frozen input assembly, projection construction, provider result validation, cache reuse, reduced-coverage dispositions and event persistence. The TypeScript parser exists as a development dependency and must ship as a runtime dependency for production analysis. No new network service, database, process runner or deployment unit is needed. An installed-engine test must establish packaging correctness rather than assume developer setup is production setup.

Precision parsing is initially JavaScript/TypeScript; concrete candidates in other languages use source-based judgment through the same reviewer. No source is imported or executed for analysis. Each source blob is read once per assembly and dependency traversal is cycle-safe. Source paths and Git object identities are validated before reading; missing reads remain failures rather than empty bodies. All state is per-feature worktree, with existing persistent gate/cache storage rather than production fake stores.

## Complexity

Large: source identity, declaration comparison, binding attribution, group evidence, provider-result validation and compatibility interact. Splitting out title filtering would leave the authority defect unresolved, so these boundaries form one coherent feature. The precise declaration parser is not a general language-service or whole-repository dependency platform.

## Alignment

Apply adr-2026-09-06-engine-owned-test-quality-scope decisions 1–12. Reuse one-owner-per-review-question for gate ownership and the opt-in rubric-container ADR for empty scope/default-off. Preserve title/content-region/occurrence identity and v3 result contract under the content-anchor and closed-vocabulary ADRs. Projection v3 and scopeResolutions evidence change scope validity, not finding identity; there is no unnecessary disposition-version migration. Existing counterfactual-sensitivity judgment remains untouched and runner output is never parsed to infer a verdict.

Local pattern basis: assembleBuildReviewInputs owns immutable source evidence; deriveBuildReviewRubricProjections owns closed by-reference inputs; coordinateBuildReviewRubrics owns dispatch, cache and outer results. Preserve these ownership traits and source-bound validation, while allowing the analyzer to become a separate module. No parallel review lane or telemetry schema is introduced. Existing scope fallback hashes must never authorize unrelated siblings.

The new accepted stories supersede the prior story claim that only test bodies/files appearing in the diff matter: concrete shared setup/helper effects are candidates, while body-identical refactors without such evidence remain empty. The governing opt-in ADR receives an additive clarification beside decision 3. The envelope ADR receives the narrowly scoped field-set supersession reference; no unrelated historical decision is rewritten.

## Domain Integrity

Scope entries distinguish established targets, concrete uncertain candidates and out-of-scope notes. Candidate resolution is resolved/out-of-scope/indeterminate, not a boolean. Validated current-source references and approved-obligation ids are required before candidate findings gain authority. Engine validation handles source existence and schema; the reviewer judges relevance and association. The parser cannot demand new tests merely because no candidates were found.

An indeterminate candidate is not a test-insensitive finding. Evidence failures use existing bounded fault handling; unresolved semantic evidence stops for a cause-specific operator action without speculative plan tasks. Explicit reduced coverage preserves attribution and visibility. No automatic waiver, broad refactor halt or new retry loop.

## Wiring Surface

| Surface | Production caller/consumer |
|---|---|
| Scope-analysis module and JS/TS parsing | assembleBuildReviewInputs in build-review-inputs.ts |
| Marker association and obligation evidence | Scope analyzer using covers-marker.ts and existing story/task parsers |
| Projection v3 | deriveBuildReviewRubricProjections called by coordinateBuildReviewRubrics |
| Candidate resolution validation and current anchor authority | build-review-domain.ts, provider result stamping and CLI adapters invoked by existing review dispatch |
| Candidate selectors and empty-scope decision | Existing coordinator/preflight boundary; configured runner contract retained |
| Cached resolution evidence and legacy projection miss | build-review-cache.ts and build-review artifact readers |
| scope-incomplete outcome and reduced coverage | Existing coordinator result path, dispositions store/CLI, outer effective-verdict checks |
| Diagnostic scope summaries | ConductorEvent union through existing emitter and EventPersister |
| Runtime parser package | Normal published scope-analysis import, exercised without development dependencies |

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Missed indirect effect | Technical | High | High | Concrete shared candidates, explicit discovery boundary, unchanged aggregate suite/CI |
| Incorrect reviewer binding association | Knowledge | Medium | High | Pinned marker/criterion provenance and negative validation fixtures; no invented authority |
| Unknown syntax causes halt inflation | Integration | Medium | Medium | Same-call reviewer fallback; no candidate from mere absence; refactor zero-dispatch fixture |
| Parser startup/package cost | Performance | Medium | Medium | Applicable-path loading, memoized reads, installed-engine proof and measurements |
| Stale scope or coarse fallback authorizes a sibling | Data | Medium | High | Projection-version miss, current candidate validation and negative anchor/cache fixtures |

## ADRs Created

adr-2026-09-06-engine-owned-test-quality-scope.md — APPROVED by operator continuation after refactor recovery correction. The original proposal's coupled result/projection version bump was corrected to conform to the existing identity-only version rule; identity semantics remain unchanged.

## Overlap Scan

Advisory scan ran over inputs, projections, domain, coordinator, cache and Covers source paths. It reported overlaps with existing spec branches, including a-coverage-claim-can-name-a-task-whose-done-when-d, build-review-repeats-aggregate-verification-despit and build-review-rubrics-need-a-post-join-adjudicator-. These are name-only overlap signals, not verified semantic conflicts. GitHub blocked_by lookup was unavailable due to network access. Re-resolve production seams against BUILD HEAD; do not rebase during BUILD. No overlap signal blocks this review.

## Verification Ledger

Source-level mechanisms above are verified by reading their defining modules. Feasibility is 90% inferred, not a production experiment. All scope choices reflect operator confirmation; no guaranteed savings or complete dependency-discovery assumption remains. Diagram rendered successfully with the installed Mermaid renderer and operator approved its component boundary. No code or tests were implemented.
