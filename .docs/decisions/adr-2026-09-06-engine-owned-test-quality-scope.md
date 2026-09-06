# ADR: Engine-owned test-quality scope with explicit candidate judgment

**Date:** 2026-09-06
**Status:** APPROVED
**Deciders:** James Stoup; composer DECIDE for jstoup111/ai-conductor#2231. Engine approach and diagram approved, refactor recovery corrected by operator, then authorized to continue.
**Amends:** adr-2026-08-22-build-review-opt-in-rubric-container (decision 3); adr-2026-08-18-content-anchored-finding-reference-schema (scope of coarse fallback authority).
**Supersedes:** adr-2026-08-19-engine-stamped-rubric-judged-result-envelope D2 closed provider field set, as extended by adr-2026-08-30-counterfactual-sensitivity-judged-not-exit-coded decision 3, only to admit scopeResolutions. All envelope ownership, result identity/version and sensitivity judgments remain in force.

## Context

The retained #2231 replay projects 724 test titles from two changed files while its parser comparison identifies eight added/modified test bodies. The production scope implementation admits a whole file when any Covers marker resolves. This conflates test change, feature binding and contextual relevance.

The operator chose comprehensive correction, in order: accuracy, lower token usage, faster execution. Production-only refactors may legitimately touch no tests. The aggregate suite and CI remain responsible for broad regression execution; this opt-in reviewer is not a universal coverage or dependency-discovery gate.

This ADR establishes the analysis-to-projection boundary and structured fallback judgment evidence. Existing assembly, reviewer, counterfactual, event and disposition boundaries are reused.

## Options Considered

### Option A: Engine analysis with judgment for concrete uncertain candidates (chosen)
- **Pros:** precise routine scope, compact evidence, no extra routine reviewer session, explicit limits.
- **Cons:** parsing/packaging work; indirect relevance still needs judgment; some concrete candidates may remain unresolved.

### Option B: Reviewer-led scope selection for every review
- **Pros:** accommodates unusual source without a precision parser.
- **Cons:** adds model work and less predictable token/time costs on routine cases.

### Option C: Filter only directly edited test bodies
- **Pros:** smallest implementation and projection.
- **Cons:** misses shared setup effects and leaves marker authority ambiguous; does not satisfy comprehensive breadth.

## Decision

1. **One frozen source authority.** Resolve base and HEAD once, then read both sides and active plan-selected artifacts at those identities. Memoize blob reads within assembly. No live-worktree reads may change a frozen binding or reviewer reference. Include source availability failures explicitly; a failed read is not an empty file. Record renamed and deleted paths from structured Git output rather than assuming space-free diff headers.

2. **Engine scope analysis with explicit states.** Replace file-level admission plus title enumeration with a typed scope value containing established targets, uncertain candidates, unbound/unresolved-marker notes, and shared evidence references. A target carries a concrete test-region identity, source location, change reason and one or more approved behavior references with marker provenance. Separate the review region from file selectors used by the configured runner.

3. **Precise initial parser boundary.** Use the existing TypeScript parser dependency for JavaScript/TypeScript source forms, promote it to a runtime dependency and verify installed-engine packaging. Parse supported declarations and suite nesting, compare base/HEAD declarations, and distinguish additions, body/argument changes, deletions, pure movement and unchanged siblings. Titles alone are not unique keys; preserve duplicate occurrences. Parameterized and aliased forms are established only where syntax proves their declaration identity; otherwise retain an uncertain declaration/group rather than enumerating speculative runtime instances. Parser errors and unsupported languages for concretely identified opted-in candidates select the uncertainty path, never an invented empty-scope result. Unsupported syntax without such a candidate does not create a new obligation. No parser subprocess, dependency installation, typechecking program, or test execution is required for analysis.

4. **Local binding provenance.** Reuse the existing Covers grammar and feature-local criterion/task resolvers. Associate marker comments with their attached test or suite, and inherit a suite declaration's marker only through its descendants. Do not borrow sibling markers. File headers, competing associations, unsupported comment syntax and generated declarations are uncertain unless association is established. An id that does not resolve in the active feature remains an unresolved-marker note; it does not acquire authority because a different id resolves elsewhere. A parsed test with no applicable marker remains explicitly unbound and outside this opt-in quality review. Changing/removing a marker is visible even when the test body did not change.

5. **Shared changes and plan evidence.** Changed hooks, fixtures and suite-level setup create an affected group reference to the enclosing suite; do not emit every unchanged descendant as a directly changed test. For local helpers/imports, follow syntactically resolvable project-local references from changed tests and existing test paths named by the active plan. A changed reachable dependency produces an affected candidate/evidence reference. Memoize visited blobs and stop cycles. Dynamic imports, unsupported resolution and ambiguous reachability stay uncertain only when concrete changed-source/marker evidence establishes a candidate under decision 7; they never turn every production-only refactor into review work. Plan paths seed evidence discovery; neither a plan path nor a task id alone proves that a particular test covers an obligation. This feature does not scan every repository test or promise discovery of all consumers of an arbitrary changed helper. Broader regression execution remains with the configured suite and CI.

6. **Compact evidence with fallback judgment in the existing call.** Project established targets and one compact record per uncertain group, plus deduplicated pinned references for setup, helpers and approved criteria. Unchanged sibling titles stay out of the changed-target list. The existing reviewer resolves uncertain groups while judging assertions, without a new scope-review session or mandatory additional model call. Each candidate receives exactly one structured disposition: resolved (concrete test regions and valid binding references), out-of-scope (grounded reason), or indeterminate (what evidence is missing). These are judgment records, not string-matched prose verdicts. The engine validates candidate identity, source range/hash, approved-reference membership and disposition completeness; semantic relevance and marker-association reasoning remain reviewer judgments. It must not mechanically re-derive that judgment from an exact-match rationale.

7. **Refactors, empty scope and recovery.** This rubric judges opted-in test quality; it does not require a feature to add or modify tests. Production-only refactors, moves and renames with no directly changed tests or concrete evidence of affected opted-in test behavior remain a valid empty-scope PASS, with no reviewer or counterfactual dispatch. Missing markers, missing plan test paths, or the abstract possibility of an unknown dependency do not create uncertain candidates or a coverage failure. Existing full-suite, CI and completion authorities retain their responsibilities.

A candidate requires concrete evidence: a changed declaration with an ambiguous association to an actual Covers marker, or an identified changed setup/helper dependency affecting an opted-in test/group. Unmarked tests and markers that refer to absent feature obligations remain explicit out-of-scope notes, not requests to add tests or fabricate bindings. A test path appearing in a plan is evidence-discovery input, never authority by itself. Pure movements/renames must not manufacture behavioral changes. Where structural comparison cannot establish whether a concretely identified opted-in test is unchanged, the existing reviewer may resolve that uncertainty; there is no blanket repository-wide completeness requirement.

For concrete candidates, the existing reviewer may resolve them as in-scope or out-of-scope from pinned source in the same review call. Out-of-scope resolution with no remaining targets yields a reasoned empty-scope PASS; unsupported syntax/language alone is not a reason to halt. Candidate-bearing review may conservatively execute candidate file selectors for counterfactual evidence, labeled separately from final review targets; no changed-body-only runner filter is introduced. A malformed candidate answer follows existing bounded malformed-result handling.

Recovery is cause-specific. Unavailable pinned evidence follows the existing bounded source-read/provider failure handling, without changing the source identity. An ambiguous association should first be judged from source; it is not automatically a malformed test or a demand for a marker edit. A valid judgment that remains indeterminate records the exact candidate, available marker/obligation evidence and what could resolve it. It produces scope-incomplete through the existing bounded fault/needs-human path, without automatic plan growth or a test-insensitive finding. The operator can supply a scope clarification, authorize a binding/evidence correction within approved work and rerun, authorize separately scoped analyzer work, or explicitly accept reduced coverage through the existing attributed mechanism. Do not create speculative repair tasks or retry unchanged indeterminacy indefinitely. Broader regression execution remains the safety net for production-only refactors; passing that suite does not itself prove an opted-in test assertion is sensitive.

> **Amended 2026-09-06 by #2231:** one rubric can return valid findings for resolved targets while another candidate remains indeterminate. Preserve the valid judged result and its scopeResolutions; derive a typed scope-incomplete fault view for existing bounded routing, aggregate coverage/effective verdict and reduced-coverage rendering. Do not replace the result with an infrastructure-only envelope or discard its findings. A coverage waiver suppresses only the derived scope fault, never the retained findings. This specifies the preservation required by the approved recovery decision without adding a provider field or identity version.

8. **Validated anchors and versioned evidence.** Generate final finding authority from established targets plus validated resolved-candidate regions. Reject sibling, absent, out-of-scope and indeterminate regions. Preserve content-region/occurrence semantics rather than authorizing whole files. Advance the input projection from v2 to v3 across its readers, cache parsing and skill contract. Preserve result contract v3 and existing content-region title/occurrence identity: new scope-resolution evidence is not an identity input. Extend the closed provider field set by scopeResolutions, required once per projected candidate and empty or absent when no candidates exist; the engine still stamps the envelope. Preserve current optional counterfactualSensitivity evidence. Update provider result stamping, persisted result validation and cache revalidation to retain and validate scopeResolutions. Old projection caches miss closed; old disposition records remain readable and binding only to their existing exact identity. A resolved dynamic/unsupported candidate uses the existing declared-title reference where recoverable, otherwise its explicitly coarse fallback identity; only the concretely resolved candidate may use that reference, never unrelated siblings. Old caches miss closed; replayed results must be validated against the current candidate dispositions and targets. Scope, binding, referenced context and analysis-version changes invalidate affected cached judgments. Identity changes alone do not grant a previous disposition authority over a new target.

9. **Existing spine and state storage.** Frozen projection and judged disposition data are gate evidence (durable state, event-spine exception C). Publish scope counts, unresolved reasons and scope-incomplete outcomes via the existing ConductorEvent emitter/persister path. No bespoke telemetry sidecar or parallel poller. Keep occurrence timing on events; retain existing provider token/time accounting.

10. **Accuracy proof before savings claims.** Add focused parser/binding fixtures and an integration through real assembly, projection, reviewer-result validation and outer gate with fake provider/process boundaries. Cover production-only refactors and pure moves/renames with no test edits (empty scope, zero reviewer/preflight dispatch), unmarked tests without fabricated obligations, direct changes, unchanged siblings, hooks/shared setup, helper-only changes reachable from plan tests, dynamic/unsupported cases, duplicate titles, renames/deletions, marker changes, missing source, malicious/out-of-scope result anchors, and cache invalidation. The frozen 724-title case must identify the eight directly changed bodies while separately explaining their actual binding dispositions; eight is not a required authorized-target count. Retain a portable fixture without depending on local daemon files or GitHub history being present in CI.

11. **Performance evidence without new service calls.** Compare old/new serialized projection size, target counts, distinct source reads, model-call count and analysis elapsed time over the same fixtures. Adding unrelated unchanged sibling declarations must not linearly add reviewer target records. Record actual total tokens and end-to-end elapsed time only in an explicitly opt-in smoke comparison with the same model/settings; no paid run is required or authorized during this spec session. Bytes are a proxy, not claimed token savings. Shared/ambiguous cases may need more context; accuracy wins over savings.

12. **Documentation and delivery.** Update the existing test-quality skill, canonical build-review/gate reference and relevant recovery runbook in the implementation PR. Runtime parser packaging is part of delivery, not an assumption about developer dependencies. No new CLI, config setting, skill, service, production-directory deletion, CHANGELOG edit or VERSION edit is planned.


## Consequences

### Positive
- Unchanged siblings no longer become changed review targets solely from file-level admission.
- Test-quality selection and broader regression execution have distinct responsibilities.
- Source/binding uncertainty is attributed instead of silently normalized to verified scope.
- Production-only refactors retain empty-scope no-dispatch behavior.

### Negative
- Precise initial parsing favors JavaScript/TypeScript; other forms retain reviewer judgment.
- Runtime parser packaging and input-schema compatibility require verification.
- Shared dependencies outside changed-test/plan-test seeds are not exhaustively discovered.
- Concrete indeterminate candidates may require operator clarification or explicit reduced coverage.
- Token and end-to-end latency improvements are unmeasured; accuracy may require more context in difficult cases.

### Follow-up Actions
- Implement the analysis/projection/result-validation boundary and test it through production entry points.
- Exercise the installed parser dependency, generic fallback, refactor no-dispatch case and cache compatibility.
- Update canonical gate/recovery documentation alongside implementation.

## Verify-Claims Ledger

Verified: build-review-inputs.ts snapshotTestQualityScope parses full-file markers; snapshotChangedTestTitles enumerates HEAD titles. build-review-coordinator.ts filters by file and short-circuits empty scope. build-review-domain.ts validates content-region anchors. build-review-cache.ts checks projection, engine and skill identities. src/conductor/package.json currently lists TypeScript as a devDependency. The retained changed-tests.json and count-changed-tests.mts support the eight-body versus 724-title observation, not an eight-authorized-target assertion.

Confirmed inputs: operator priority order, comprehensive engine-led approach, technical track, diagram and refactor-safe recovery. Feasibility is 90% inferred from these existing seams and the local parser experiment. No assumption of exhaustive static discovery or guaranteed savings is adopted. Verdict: CLEAR for spec authoring; behavior remains subject to BUILD verification.
