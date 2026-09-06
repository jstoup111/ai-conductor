# Implementation Plan: Accurate test-quality review scope

**Date:** 2026-09-06
**Design:** .docs/decisions/adr-2026-09-06-engine-owned-test-quality-scope.md
**Stories:** .docs/stories/testquality-admits-724-test-titles-for-eight-chang.md
**Conflict check:** Clean, .docs/conflicts/testquality-admits-724-test-titles-for-eight-chang.md
**Source-Ref:** jstoup111/ai-conductor#2231

## Summary

18 tasks implement precise routine test-quality scope, source-based resolution of concrete ambiguous candidates and refactor-safe empty scope. Accuracy precedes input size and execution speed; broader regression execution remains the configured suite/CI responsibility.

## Technical Approach

Freeze Git identities and approved behavior artifacts once, analyze supported JS/TS declarations and their local Covers associations, then project established targets plus compact concrete uncertain groups. Shared setup/local helper changes are candidate evidence, not a claim that all sibling tests changed. Plan test paths seed bounded evidence discovery but confer no authority. Existing source-based reviewer judgment resolves uncertainty within its normal call; typed validation owns source/id checks, not semantic inference from prose.

Preserve result contract v3 and existing finding title/content-region/occurrence identity. Advance only input projection to v3 and retain scopeResolutions evidence across provider stamping, persisted results and cache hits. A concrete indeterminate candidate is a bounded scope-incomplete fault; missing tests/markers or a production-only refactor without such evidence remains no-dispatch empty-scope PASS. Keep counterfactualSensitivity indeterminate separate: it is not scope-incomplete and continues to allow empty-findings PASS with resolved scope.

Use existing semantic ownership: assembleBuildReviewInputs reads immutable evidence, deriveBuildReviewRubricProjections shapes it, coordinateBuildReviewRubrics dispatches/settles, and current cache/disposition stores preserve gate evidence. Helpers may be decomposed but their production wiring must be demonstrated by their owning integration tasks. No source execution, second reviewer lane, new retry loop or extra telemetry channel. Exact-copy Pattern-source/Rename-map semantics are not invoked.

## Prerequisites

Approved technical track, architecture and stories are present. TypeScript is already installed as a development dependency; Task 9 makes its production availability explicit without requesting an upgrade. Resolve all named seams at BUILD HEAD rather than relying on line numbers. Test external adapters with faithful fakes; do not invoke the aggregate suite inside a test.

## Tasks

### Task 1: Freeze source reads and safe path identities
**Story:** Story 6, Story 7, Story 8; criteria S7.1, S8.2, S8.5, S6.4
**Type:** infrastructure

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Introduce a per-assembly source reader keyed by commit identity and repo-relative path; reuse the GitRunner injection seam. Capture the graded HEAD before diff/blob reads, retain the resolved merge-base, and read active plan/selected stories at HEAD rather than the mutable checkout. Do not change fresh-base or CURRENT-suite-proof ownership.
3. Use Git argv and NUL-delimited name-status output for path/change-kind inventory, including rename old/new paths. Reject absolute, traversal, NUL and escaping references; permit safe spaces. Never interpolate a source path into a shell command. A missing/deleted side is distinguished from a failed required read.
4. Unit tests inject Git reads; one local temporary-Git integration owns source identity, filename and post-snapshot worktree mutation proof through assembleBuildReviewInputs. No remote Git or provider calls.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The source-snapshot integration keeps the same frozen plan, stories and test bytes after live files change, and correctly pairs renamed paths containing spaces.
- The source-reader negative fixtures reject path escape and required missing blobs, never substitute live content or an empty file, and expose a bounded evidence-read failure.

**Files:** src/conductor/src/engine/build-review-inputs.ts, src/conductor/src/engine/build-review-scope-source.ts, src/conductor/test/engine/build-review-inputs.test.ts, src/conductor/test/engine/build-review-scope-source.test.ts
**Dependencies:** none

### Task 2: Compare supported test declarations without title-key collisions
**Story:** Story 1; criteria S1.1, S1.2, S1.3
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Implement an inert JavaScript/TypeScript syntax analyzer using TypeScript createSourceFile. Accept a source filename and bytes, return declaration/suite spans and declared titles with explicit supported/uncertain results. No typechecking Program, module execution or runtime test enumeration.
3. Recognize literal describe/context/suite and it/test/specify declarations and the supported literal member modifiers used in the retained Vitest fixture. Handle static aliases only when import/declaration syntax establishes identity. Parameterized declarations are declaration groups, not guessed runtime rows; unknown wrappers or diagnostics remain uncertainty.
4. Compare base and HEAD structural declarations including test arguments/body and enclosing declared title chain. Ignore formatting trivia when establishing pure unchanged syntax, but retain literal/comment-marker semantics. Do not key a map only by title; match duplicate occurrences conservatively and report uncertain correspondence rather than dropping one.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The declaration unit fixtures return exactly added/body-or-argument-modified declarations while leaving unrelated unchanged sibling titles out of the changed set.
- The duplicate-title fixture distinguishes the edited occurrence, and a same-title assertion edit is identified as changed.

**Files:** src/conductor/src/engine/build-review-test-declarations.ts, src/conductor/test/engine/build-review-test-declarations.test.ts
**Dependencies:** none

### Task 3: Handle movement, deletion and merge-base boundaries
**Story:** Story 1; criteria S1.4, S1.5, S1.6
**Type:** negative-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Extend declaration comparison with old/new path correspondence supplied by source inventory. Compare structural declarations across renamed files and exact moved blocks within changed files, preserving uncertainty for duplicate correspondences.
3. Classify deleted declarations as evidence only; never create a HEAD executable region. Body-identical movement without setup/binding change does not become a quality target. Leave setup/import changes available for the separate affected-group analysis.
4. Use injected Git for declaration cases and the Task 1 local-Git boundary pattern for a newer merge-base containing unrelated merged tests. No git fetch or rebase in the task workflow.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Movement/deletion fixtures report no executable target for pure relocation or a deleted declaration while retaining the source change as evidence.
- The merge-base input fixture excludes tests introduced solely by the base branch from feature-owned changed declarations.

**Files:** src/conductor/src/engine/build-review-test-declarations.ts, src/conductor/test/engine/build-review-test-declarations.test.ts, src/conductor/test/engine/build-review-inputs.test.ts
**Dependencies:** Task 1, Task 2

### Task 4: Attach Covers markers to tests and suites
**Story:** Story 2; criteria S2.1, S2.2, S2.4, S2.5
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Reuse parseCoversMarkers for reference grammar and existing story-criteria/task resolution for feature membership. Association is a new source-location operation, not a replacement grammar parser.
3. Attach leading marker comments to the immediately associated declaration without crossing another statement/declaration; suite-title and suite-attached markers inherit only to descendants. Preserve marker span, reference kind/id and owning suite/test provenance.
4. Return bound, unbound, unresolved-reference or uncertain-association variants. A sibling marker never lends authority, and a malformed/absent-feature reference does not resolve because another marker in the same file is valid. Unit fixtures cover each state.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Binding fixtures identify the attached criterion/task marker and allow suite inheritance only within its descendant tests.
- The sibling-marker, absent-feature-id and unmarked-test fixtures produce no borrowed binding and no required-test failure.

**Files:** src/conductor/src/engine/build-review-test-bindings.ts, src/conductor/src/engine/covers-marker.ts, src/conductor/test/engine/build-review-test-bindings.test.ts
**Dependencies:** Task 2

### Task 5: Represent binding edits and concrete association uncertainty
**Story:** Story 2, Story 5; criteria S2.3, S2.6, S5.6
**Type:** negative-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Compare marker associations at both pinned sides; a removed/changed marker is review evidence even if the test body matches. Never carry a removed binding into final target authority.
3. Create uncertain candidates only when a changed declaration/group and actual potentially applicable marker evidence exist, or the later dependency analyzer supplies a concrete affected opted-in group. File headers, conflicting associations and unknown declaration forms are reasons, not automatic whole-file admission.
4. Keep unresolved ids/unmarked declarations as out-of-scope notes. Unsupported source with no concrete marker/change evidence does not create a candidate merely because parsing was unavailable. Test the distinction using small source fixtures.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Marker-only edit/removal fixtures expose the association change and invalidate the former binding without changing the test body.
- Competing/file-header association fixtures retain concrete candidates, while unsupported unmarked source yields no invented review candidate or halt.

**Files:** src/conductor/src/engine/build-review-test-bindings.ts, src/conductor/src/engine/build-review-test-scope.ts, src/conductor/test/engine/build-review-test-bindings.test.ts, src/conductor/test/engine/build-review-test-scope.test.ts
**Dependencies:** Task 3, Task 4

### Task 6: Group shared setup effects without inflating changed tests
**Story:** Story 3; criteria S3.1, S3.3
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Compare suite setup/hook/fixture declaration regions separately from test bodies. A changed enclosing setup region with opted-in descendants creates one affected group referencing the setup and suite; descendants remain unchanged-body evidence.
3. Deduplicate group and shared source references by source identity and region. Do not serialize every descendant title in the directly changed list. A parser-unresolved changed setup with concrete opted-in evidence remains a candidate for the same reviewer.
4. Unit fixtures contrast a setup-only edit, a sibling suite unaffected by that edit, and several candidates sharing one fixture.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The setup-only fixture yields an affected opted-in group with its setup reference and zero falsely directly changed descendant bodies.
- The shared-fixture fixture contains one deduplicated evidence reference and does not enumerate unrelated unchanged sibling titles.

**Files:** src/conductor/src/engine/build-review-test-scope.ts, src/conductor/test/engine/build-review-test-scope.test.ts
**Dependencies:** Task 3, Task 4, Task 5

### Task 7: Discover concrete helper effects from changed and planned test seeds
**Story:** Story 3; criteria S3.2, S3.4, S3.5, S3.6
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Seed discovery from changed test declarations and existing test paths in the active plan via parsePlanTaskPaths. Seed paths are evidence hints only; applicable markers are still required for opted-in authority.
3. Follow syntactically resolvable relative project-local import/require references with explicit extension/index resolution at pinned commits. Maintain a visited identity set and reuse the assembly blob cache. External packages, dynamic imports and unsupported alias resolution are not executed or guessed.
4. Compare reachable helper identities across base/HEAD. Emit a compact affected candidate with the dependency chain only when changed source and opted-in test evidence connect. Cycle termination and unresolved edges are explicit; missing plan paths or merely possible unknown consumers cannot turn every production refactor into a candidate.
5. Unit tests use injected source graphs for reachable helper-only changes, unused plan seeds, cycles, shared dependencies and dynamic unresolved edges.
6. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The plan-seeded helper fixture presents the concrete changed dependency chain for an unchanged opted-in test; a plan path alone creates no binding.
- Dependency-cycle and hypothetical-consumer fixtures terminate without duplicate traversal or a speculative scope failure.

**Files:** src/conductor/src/engine/build-review-scope-dependencies.ts, src/conductor/src/engine/build-review-test-scope.ts, src/conductor/test/engine/build-review-scope-dependencies.test.ts
**Dependencies:** Task 1, Task 4, Task 5

### Task 8: Wire typed scope analysis into frozen input assembly
**Story:** Story 1, Story 2, Story 3, Story 8; criteria S1.1, S2.1, S3.1, S8.3, S8.4, S8.6
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Replace the existing independent file-wide scope/title collection in assembleBuildReviewInputs with the typed analyzer using the same frozen sources. Preserve direct changed declarations separately from established targets, candidates and out-of-scope notes.
3. Integrate the Task 1 reader, declaration/binding analysis and shared dependency evidence without duplicating blob reads. Freeze the resulting scope data recursively at the existing snapshot boundary. Do not execute consumer modules to obtain declarations or graph edges.
4. This task owns the assembly integration proof for declaration selection, marker authority and affected groups: real assembly with small pinned-source fixtures must produce the expected precise target/candidate sets. Include a top-level side-effect source, repeated blob references and an injected parser failure for a concrete candidate.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- assembleBuildReviewInputs integration returns precise changed declarations, attached bindings and shared affected groups rather than admitting every title in a marked file.
- Assembly reads each commit/path blob once, never executes top-level consumer side effects, and preserves a concrete parser failure as uncertainty rather than a verified target or empty PASS.

**Files:** src/conductor/src/engine/build-review-inputs.ts, src/conductor/src/engine/build-review-test-scope.ts, src/conductor/test/engine/build-review-inputs.test.ts, src/conductor/test/engine/build-review-provenance-isolation.test.ts
**Dependencies:** Task 1, Task 2, Task 3, Task 4, Task 5, Task 6, Task 7

### Task 9: Ship the parser in the installed production dependency set
**Story:** Story 8; criteria S8.1
**Type:** infrastructure

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Move the already selected TypeScript version from development-only to runtime dependencies and update the lock consistently. Inspect the current published engine externalization/dependency staging seams before choosing the smallest packaging edit; no package upgrade is requested.
3. Load the parser only on the applicable analysis path. Keep source analysis process-free and do not change any external provider setup.
4. Add a local packaging integration using already installed dependency files and an isolated production-only resolution tree to import the actual published analysis entry point and analyze a small supported candidate. No npm install/registry access or aggregate invocation inside the test. The fixture must fail when the parser is only available through development dependencies.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The production-only packaging fixture imports actual scope analysis and identifies a supported JS/TS candidate without access to development-only dependencies.
- The runtime manifest and lock expose the selected parser version, and the packaging fixture performs no network or package-install command.

**Files:** src/conductor/package.json, src/conductor/package-lock.json, src/conductor/tsup.config.ts, src/conductor/scripts/publish-engine.mjs, src/conductor/test/engine/build-review-parser-packaging.test.ts
**Dependencies:** Task 2

### Task 10: Project compact scope and content-bound evidence under input v3
**Story:** Story 7, Story 9; criteria S9.2, S7.5
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Advance the input projection to v3. Carry established targets, compact candidate groups, approved binding references and deduplicated pinned evidence; distinguish these from file selectors used by the configured runner. Keep full unrelated sibling titles out of changed targets.
3. Hash semantic scope, association and referenced source content in content/projection identity, preserving the existing exclusion of lap/time/commit provenance from semantic cache identity. No live-file content read is permitted while deriving the projection.
4. Projection tests compare identical changed tests surrounded by many extra unchanged siblings, and independently change a binding/helper/analysis schema identity. This task owns projection construction integration at deriveBuildReviewRubricProjections.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- deriveBuildReviewRubricProjections emits input v3 with unchanged directly changed target count and no extra unrelated sibling titles as the fixture grows.
- Projection identity changes when binding, helper/setup bytes or the analysis contract changes, while provenance-only changes do not alter semantic identity.

**Files:** src/conductor/src/engine/build-review-projections.ts, src/conductor/src/engine/build-review-registry.ts, src/conductor/src/engine/build-review-inputs.ts, src/conductor/test/engine/build-review-projections.test.ts, src/conductor/test/engine/build-review-registry.test.ts
**Dependencies:** Task 8

### Task 11: Validate candidate dispositions and scoped finding authority
**Story:** Story 5, Story 7; criteria S5.4, S5.5, S7.6
**Type:** negative-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Add a scopeResolutions evidence parser: exactly one per projected candidate, with candidateId plus resolved/out-of-scope/indeterminate disposition. Resolved entries carry concrete pinned source-region evidence, applicable marker/obligation references and grounded association reasoning; other variants carry grounded exclusion or missing-evidence reason.
3. Validate ids, exact candidate coverage, allowed obligation membership, source ranges/content evidence and containment before constructing the finding reference context. Source locators are evidence only, not canonical identity. Semantic relevance/association is the reviewer judgment; never derive it by matching free-text rationale.
4. Keep result contract v3 and current title/content-region/occurrence identity. Preserve legacy parsing and explicitly coarse fallback identities, but grant each fallback only the authority of its resolved concrete candidate. Permit safe repository-relative space-containing paths consistently with source access, without accepting absolute/traversal references.
5. Negative unit fixtures exercise omitted/duplicate/unknown resolutions, foreign criterion, absent source, out-of-candidate range and an unrelated sibling sharing a coarse file identity.
6. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Result validation rejects missing/duplicate candidate answers, foreign obligations and absent/out-of-candidate source regions with the named problem.
- Fresh reference validation rejects unrelated sibling findings even under a coarse fallback anchor, while preserving result-v3 title/occurrence identities for legitimate targets.

**Files:** src/conductor/src/engine/build-review-domain.ts, src/conductor/src/engine/build-review-finding-identity.ts, src/conductor/test/engine/build-review-domain.test.ts, src/conductor/test/engine/build-review-finding-identity.test.ts
**Dependencies:** Task 10

### Task 12: Carry fallback judgment through the existing provider and result paths
**Story:** Story 5; criteria S5.1, S5.2, S5.3
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Extend the existing dispatched result schema and skill contract with scopeResolutions and its complete allowed shape, while retaining findings and optional counterfactualSensitivity. The provider never supplies authoritative envelope identity. Update actual payload-to-envelope construction, CLI parsing and persisted branch readers, not only TypeScript interfaces.
3. Invoke candidate-resolution/anchor validation on normal provider settlement, retaining the schema-constrained resolutions with the branch evidence. Fully established scopes need no additional provider call; concrete unsupported candidates are resolved in the existing call. Malformed results follow existing bounded repair and rerun semantics.
4. This task owns the provider boundary integration: a deterministic fake returns a legitimate unsupported-candidate resolution with a finding, an out-of-scope-only result and an ordinary precise result. Assert one dispatch each, persisted resolutions and engine-stamped identity. No real LLM or complete Conductor.run loop.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity.
- An out-of-scope candidate result can leave no quality findings with its exclusion reason retained, and an established-target review makes no separate scope-review call.

**Files:** src/conductor/src/engine/step-runners.ts, src/conductor/src/engine/build-review-coordinator.ts, src/conductor/src/engine/build-review-artifacts.ts, src/conductor/src/engine/build-review-cli.ts, skills/build-review-test-quality/SKILL.md, src/conductor/test/engine/build-review-coordinator.test.ts, src/conductor/test/engine/build-review-artifacts.test.ts, src/conductor/test/engine/build-review-skill-contract.test.ts
**Dependencies:** Task 11

### Task 13: Separate counterfactual file execution from review target selection
**Story:** Story 4; criteria S4.6
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Wire the established-target plus concrete-candidate file union into the existing preflight seam. Keep executed file selectors and final quality targets as different named evidence, allowing conservative execution of affected group files.
3. Retain configured scoped-command argv and process classification; do not add title filtering, interpret runner output, or run an extra HEAD control suite. If candidates resolve out-of-scope after preflight, their execution is still truthful evidence and not a quality obligation.
4. This task owns counterfactual selection integration with a fake process boundary and a test-suite inspection seam. Assert broad regression configuration is unchanged; counterfactualSensitivity indeterminate alone continues to permit an empty-findings result when scope is resolved.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Counterfactual integration records the actual conservative file-selector union separately from final review targets and keeps the configured runner argument contract.
- The regression-verification seam retains its original selection, and an indeterminate counterfactual with resolved scope and no findings still passes.

**Files:** src/conductor/src/engine/build-review-coordinator.ts, src/conductor/src/engine/build-review-test-quality-preflight.ts, src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-test-quality-preflight.test.ts, src/conductor/test/engine/build-review-coordinator.test.ts
**Dependencies:** Task 10, Task 12

### Task 14: Preserve disabled and refactor empty-scope fast paths
**Story:** Story 4; criteria S4.1, S4.2, S4.3, S4.4, S4.5
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Replace the old inScopeTests.length shortcut with typed scope emptiness: no established targets and no concrete uncertain candidates. Unmarked/out-of-feature notes do not block. Check disabled configuration before review-related dispatch; no extra scope judge or preflight is introduced.
3. Concrete uncertain candidates continue to the ordinary reviewer path, including cases resolved out-of-scope. Preserve reasoned empty-scope event/result evidence at both the mechanical early return and the resolved-candidate return.
4. This task owns coordinator integration for production-only refactors, pure test moves, a plan without test paths, disabled rubric and a concrete unresolved candidate. Assert zero provider/preflight calls on empty/disabled cases and that no marker/new-test/waiver demand appears.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- coordinateBuildReviewRubrics returns explicit empty-scope PASS with zero reviewer/preflight calls for production-only refactors, pure moves and missing plan test paths when no concrete candidate exists.
- Disabled review makes no reviewer/preflight call, while a concrete uncertain candidate cannot take the no-dispatch empty-scope shortcut.

**Files:** src/conductor/src/engine/build-review-coordinator.ts, src/conductor/src/engine/step-runners.ts, src/conductor/test/engine/build-review-coordinator.test.ts, src/conductor/test/engine/build-review-provenance-isolation.test.ts
**Dependencies:** Task 12, Task 13

### Task 15: Route scope-incomplete with retained evidence and bounded recovery
**Story:** Story 6; criteria S6.1, S6.4, S6.5, S6.6
**Type:** negative-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Add scope-incomplete as a closed non-judgment cause in the existing bounded fault mechanism and total reason mappings. Preserve concrete candidate id, marker/obligation evidence and missing clarification in typed branch evidence plus bounded diagnostic detail. Route by kind/cause, never message text.
3. Keep the valid judged envelope and its findings/scopeResolutions intact. Add one pure scope-failure derivation from validated indeterminate resolutions, returning a typed scope-incomplete fault view consumed by coordinator routing, aggregate coverage/effective reduction and reduced-coverage rendering. Do not replace the judged result with an infrastructure-only result: that would lose findings from the same rubric. The aggregate independently evaluates the retained findings and derived scope fault; matching reduced coverage removes only the latter. Persisted aggregate validation re-derives these values from the validated result. A syntactically valid indeterminate answer is not a malformed result repair opportunity: do not add an inner retry. Reuse the existing durable fault allowance and needs-human terminal path; unchanged input must not gain another counter. Ensure independent valid findings on resolved targets are retained and cannot be suppressed by an incomplete candidate or future reduced-coverage decision.
4. Emit scope summaries and named scope-incomplete evidence through ConductorEvent and existing sinks; do not introduce a sidecar. Preserve existing source/provider failures as their actual causes. This task owns settlement/event integration and bounded nonsemantic routing assertions at the smallest owning seam, without a whole workflow run.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- A concrete indeterminate result records candidate/binding/missing-evidence detail on the existing result/event path and cannot emit ordinary PASS without an authorized reduced-coverage disposition.
- The routing fixtures retain valid independent findings, charge only the existing fault allowance for unresolved scope, append no tasks and introduce no new retry loop; missing source/provider evidence is never labeled test-insensitive.

**Files:** src/conductor/src/engine/build-review-domain.ts, src/conductor/src/engine/build-review-coordinator.ts, src/conductor/src/engine/build-review-aggregate.ts, src/conductor/src/engine/step-runners.ts, src/conductor/src/engine/kickback-ledger.ts, src/conductor/src/types/events.ts, src/conductor/src/engine/event-sinks.ts, src/conductor/test/engine/build-review-coordinator.test.ts, src/conductor/test/engine/build-review-aggregate.test.ts
**Dependencies:** Task 12, Task 14

### Task 16: Recover corrected scope and honor explicit reduced coverage
**Story:** Story 6; criteria S6.2, S6.3
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Extend existing reduced-coverage reason validation to scope-incomplete, preserving the existing operator identity, current lap, exhausted-allowance and rationale requirements. Reuse the existing action/store/lease; do not create a command or automatic waiver.
3. Preserve the distinct finding-acceptance and reduced-coverage objects. A waiver covers only its closed rubric/cause and cannot hide an independent finding. Known reduced coverage must render with operator/rationale/time through existing publication evidence; unreadable decision state remains blocking.
4. This task owns recovery integration: rerun the actual scope/coordination path with corrected binding evidence and observe resolution; exercise the existing CLI handler with injected authenticated operator/store and no network to record reduced coverage. Test absent/unauthorized/stale decision refusal and attributed effective completion.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Corrected pinned binding evidence recomputes candidate scope and can clear the previous scope-incomplete condition rather than retaining a permanent failure.
- The existing reduced-coverage action accepts only current authorized exhausted scope-incomplete state, renders attribution, and neither absent approval nor a waiver suppresses an independent finding.

**Files:** src/conductor/src/engine/build-review-dispositions.ts, src/conductor/src/engine/build-review-effective.ts, src/conductor/src/engine/build-review-cli.ts, src/conductor/src/engine/build-review-accepted-risk.ts, src/conductor/test/engine/build-review-dispositions.test.ts, src/conductor/test/engine/build-review-effective.test.ts, src/conductor/test/engine/build-review-cli.test.ts
**Dependencies:** Task 15

### Task 17: Validate current scope on cache and persisted result reuse
**Story:** Story 7; criteria S7.2, S7.3, S7.4, S7.5, S7.6
**Type:** negative-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Update staged cache parsing to read legacy projection versions as candidates and emit only current input-v3 entries. Preserve result-v3 and historical disposition readers. Add scopeResolutions to exact persisted evidence keys and validated cache state; missing required resolutions cannot be repaired by supplying an empty array.
3. Reuse existing engine/skill/policy/projection identity and the normal current-lap stamping seam. On a hit, validate the cached resolutions and findings against the same current-source reference authority used on fresh results. Do not read mutable files or use lap/coordinate provenance as semantic cache keys.
4. This task owns cache-to-coordinator integration: identical current scope hits; old projection misses; changed binding/helper/schema misses; stale candidate or coarse sibling authority is rejected; old supported disposition records remain readable.
5. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- Current cache hits and fresh results enforce the same candidate/anchor authority; changed binding/helper/analysis evidence and old projection-v2 entries cannot reuse stale judgment.
- Legacy result-v3 dispositions remain readable with their exact existing finding identities, and a cache-version miss does not corrupt or migrate disposition storage.

**Files:** src/conductor/src/engine/build-review-cache.ts, src/conductor/src/engine/build-review-artifacts.ts, src/conductor/src/engine/build-review-coordinator.ts, src/conductor/test/engine/build-review-cache.test.ts, src/conductor/test/engine/build-review-artifacts.test.ts, src/conductor/test/engine/build-review-coordinator.test.ts
**Dependencies:** Task 10, Task 11, Task 12, Task 15

### Task 18: Deliver portable regression and scope-efficiency comparison
**Story:** Story 9; criteria S9.1, S9.3, S9.4, S9.5, S9.6
**Type:** happy-path

**Steps:**
1. Write focused failing tests for the named behavior and negative cases below; establish RED through the scoped test interface.
2. Add a focused local comparison entry point for old/new scope data over pinned portable fixture sources. It reports source-read counts, declaration/target/candidate counts, projection bytes, dispatch counts and analysis elapsed time; timing is an observation, never a brittle unit threshold.
3. Preserve the retained #2231 base e1226a981ab52c513e9da4a3ee5716db9b9b3d9f and HEAD c188c0cb6cef8aeaf020272dcb55297e24d688f0 provenance with a portable fixture that retains the relevant declarations, marker context and feature criteria. Use the local retained changed-tests.json/count-changed-tests.mts only as extraction evidence during BUILD; CI must not need daemon paths or those Git objects. Independently derive binding dispositions; do not assume eight opted-in targets.
4. This task owns the comparison entry point and its regression: run actual assembly/projection with fake providers/processes, identify the eight directly changed bodies versus 724 old projected titles, and include shared/ambiguous contrast fixtures so savings cannot be obtained by dropping necessary evidence.
5. Ordinary tests never call an LLM, GitHub or registry. Report projection bytes as bytes; actual total-token/end-to-end latency comparison remains opt-in smoke work, not a required paid task or an implied verified claim.
6. Implement the scoped change, establish GREEN, and commit the behavior plus its tests using the required repository checks.

**Done when:**
- The portable comparison identifies eight directly changed bodies from the 724-title regression and separately reports each actual binding disposition without local daemon files or GitHub downloads.
- The comparison output records bytes, counts and elapsed analysis time, retains shared/ambiguous evidence, and makes no total-token or end-to-end savings claim without opt-in measured provider evidence.

**Files:** src/conductor/test/engine/build-review-scope-regression.test.ts, src/conductor/test/fixtures/build-review-scope/, src/conductor/scripts/compare-build-review-scope.mts
**Dependencies:** Task 8, Task 10, Task 12

## Integration Ownership

| Production boundary | Owning task | Proof |
|---|---|---|
| Pinned Git/artifact reads | 1 | Local-Git assembly identity/path fixture |
| Scope analyzer to frozen assembly | 8 | Real assembly of declaration/binding/shared fixtures |
| Published dependency resolution | 9 | Production-only parser import fixture |
| Frozen snapshot to input projection | 10 | Real projection and semantic identity fixtures |
| Provider payload to persisted judgment | 12 | Same-call fake-provider resolution and stamped evidence |
| Counterfactual selector execution | 13 | Configured runner adapter arguments and separate final targets |
| Empty scope/disabled routing | 14 | Coordinator PASS with zero provider/preflight calls |
| Indeterminate settlement and events | 15 | Bounded fault/result/event seam |
| Operator reduced-coverage/correction | 16 | Existing CLI/effective-state integration |
| Cache hit to current judgment | 17 | Current source-authority revalidation |
| Portable scope comparison | 18 | Comparison entry point counts and retained context |

## Coverage Check

Every criterion is diff-local: its behavior is evaluated with pinned fixture sources and injected boundary outcomes; no external deployment or later independent commit is required to make the assertion true. Real-provider savings are not an acceptance claim. RED/GREEN dispositions below use unit tests for syntax/binding/reducers and the owning integration seams above for boundary behavior.

| Criterion | Task id(s) | Done when quote | Disposition |
|---|---|---|---|
| Story 1 happy: Given a file containing many unchanged tests and one added or modified test, when scope is assembled, then the changed declaration is identified separately and unchanged sibling titles are absent from the directly changed target list | 2, 8 | The declaration unit fixtures return exactly added/body-or-argument-modified declarations while leaving unrelated unchanged sibling titles out of the changed set. | diff-local |
| Story 1 happy: Given a test declaration whose arguments or assertion body changed while its title stayed the same, when base and HEAD are compared, then the changed declaration is identified | 2 | The duplicate-title fixture distinguishes the edited occurrence, and a same-title assertion edit is identified as changed. | diff-local |
| Story 1 happy: Given two tests with identical titles where only one body changed, when scope and finding references are produced, then the changed occurrence remains distinguishable from its unchanged sibling | 2 | The duplicate-title fixture distinguishes the edited occurrence, and a same-title assertion edit is identified as changed. | diff-local |
| Story 1 negative: Given a test is only moved or renamed without changing behavior or binding, when scope is assembled, then the move alone creates no quality target or finding | 3 | Movement/deletion fixtures report no executable target for pure relocation or a deleted declaration while retaining the source change as evidence. | diff-local |
| Story 1 negative: Given a deleted test or deleted source path, when scope is assembled, then it is not represented as an executable HEAD test and the change remains available as evidence | 3 | Movement/deletion fixtures report no executable target for pure relocation or a deleted declaration while retaining the source change as evidence. | diff-local |
| Story 1 negative: Given unrelated tests arrive through a newer merge-base, when the feature diff is reviewed, then those tests do not become feature-owned changed targets | 3 | The merge-base input fixture excludes tests introduced solely by the base branch from feature-owned changed declarations. | diff-local |
| Story 2 happy: Given a changed test with an attached valid story-criterion or task Covers marker, when review scope is assembled, then that test carries the matching obligation and marker provenance | 4, 8 | Binding fixtures identify the attached criterion/task marker and allow suite inheritance only within its descendant tests. | diff-local |
| Story 2 happy: Given a suite declares a valid Covers marker, when a descendant test changes, then the descendant may inherit that marker while tests outside the suite do not | 4 | Binding fixtures identify the attached criterion/task marker and allow suite inheritance only within its descendant tests. | diff-local |
| Story 2 happy: Given an otherwise unchanged declaration whose Covers marker changes or is removed, when scope is assembled, then the changed association is visible and previous binding authority is not silently reused | 5 | Marker-only edit/removal fixtures expose the association change and invalidate the former binding without changing the test body. | diff-local |
| Story 2 negative: Given a marker occurs only on a sibling test, when another test changes, then the changed test cannot inherit that sibling marker | 4 | The sibling-marker, absent-feature-id and unmarked-test fixtures produce no borrowed binding and no required-test failure. | diff-local |
| Story 2 negative: Given an absent-feature obligation id or a test with no applicable marker, when scope is assembled, then it is explicitly out of scope with the appropriate note and no invented obligation or demand for a new test | 4 | The sibling-marker, absent-feature-id and unmarked-test fixtures produce no borrowed binding and no required-test failure. | diff-local |
| Story 2 negative: Given competing or file-header marker associations cannot be established, when a concrete changed candidate is reviewed, then the ambiguity remains explicit until source-based judgment resolves it | 5 | Competing/file-header association fixtures retain concrete candidates, while unsupported unmarked source yields no invented review candidate or halt. | diff-local |
| Story 3 happy: Given changed setup encloses opted-in tests whose bodies are unchanged, when scope is assembled, then a concrete affected group and its setup evidence are available separately from directly changed test declarations | 6, 8 | The setup-only fixture yields an affected opted-in group with its setup reference and zero falsely directly changed descendant bodies. | diff-local |
| Story 3 happy: Given an existing opted-in test named by the active plan reaches a changed project-local helper, when scope is assembled, then the concrete dependency effect is presented for relevance judgment even when the test file is unchanged | 7 | The plan-seeded helper fixture presents the concrete changed dependency chain for an unchanged opted-in test; a plan path alone creates no binding. | diff-local |
| Story 3 happy: Given multiple candidates share setup or a helper, when the reviewer receives its input, then shared evidence is available once by pinned reference rather than repeated as every unchanged sibling title | 6 | The shared-fixture fixture contains one deduplicated evidence reference and does not enumerate unrelated unchanged sibling titles. | diff-local |
| Story 3 negative: Given a plan merely names a test file but no applicable marker or concrete changed dependency is established, when scope is assembled, then the path alone confers no review authority | 7 | The plan-seeded helper fixture presents the concrete changed dependency chain for an unchanged opted-in test; a plan path alone creates no binding. | diff-local |
| Story 3 negative: Given a local dependency cycle, when evidence is collected, then collection terminates without duplicate unbounded traversal | 7 | Dependency-cycle and hypothetical-consumer fixtures terminate without duplicate traversal or a speculative scope failure. | diff-local |
| Story 3 negative: Given only a hypothetical unknown dependency could connect a production refactor to tests, when scope is assembled, then that possibility alone creates no candidate or scope failure | 7 | Dependency-cycle and hypothetical-consumer fixtures terminate without duplicate traversal or a speculative scope failure. | diff-local |
| Story 4 happy: Given a production-only refactor with no test edits or concrete affected opted-in candidate, when enabled test-quality review runs, then it passes with an explicit empty-scope reason and invokes neither reviewer nor counterfactual preflight | 14 | coordinateBuildReviewRubrics returns explicit empty-scope PASS with zero reviewer/preflight calls for production-only refactors, pure moves and missing plan test paths when no concrete candidate exists. | diff-local |
| Story 4 happy: Given tests were moved without changing their behavior or binding and no other candidate exists, when enabled test-quality review runs, then it passes empty scope without demanding markers, new tests or a waiver | 14 | coordinateBuildReviewRubrics returns explicit empty-scope PASS with zero reviewer/preflight calls for production-only refactors, pure moves and missing plan test paths when no concrete candidate exists. | diff-local |
| Story 4 happy: Given the rubric is disabled, when review runs, then its analysis-driven reviewer/preflight work is not dispatched and existing disabled behavior is preserved | 14 | Disabled review makes no reviewer/preflight call, while a concrete uncertain candidate cannot take the no-dispatch empty-scope shortcut. | diff-local |
| Story 4 negative: Given no test paths are named in the plan, when a production-only refactor is reviewed, then absence of planned tests alone does not produce incomplete scope | 14 | coordinateBuildReviewRubrics returns explicit empty-scope PASS with zero reviewer/preflight calls for production-only refactors, pure moves and missing plan test paths when no concrete candidate exists. | diff-local |
| Story 4 negative: Given a concretely identified candidate remains unresolved, when the engine considers empty-scope completion, then it does not substitute an empty-scope PASS for that candidate | 14 | Disabled review makes no reviewer/preflight call, while a concrete uncertain candidate cannot take the no-dispatch empty-scope shortcut. | diff-local |
| Story 4 negative: Given review scope is empty or narrower than the test suite, when configured regression verification runs, then review scope does not narrow or bypass that verification | 13 | The regression-verification seam retains its original selection, and an indeterminate counterfactual with resolved scope and no findings still passes. | diff-local |
| Story 5 happy: Given an opted-in changed candidate uses unsupported language or dynamic declaration syntax, when the existing reviewer reads its pinned evidence, then it can return a concrete in-scope resolution and quality judgment in that same call | 12 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. | diff-local |
| Story 5 happy: Given the reviewer establishes that a concrete candidate is unrelated or unchanged, when it returns an out-of-scope disposition with evidence, then that candidate is excluded and an otherwise empty result may pass with its reason recorded | 12 | An out-of-scope candidate result can leave no quality findings with its exclusion reason retained, and an established-target review makes no separate scope-review call. | diff-local |
| Story 5 happy: Given a routine fully established target set, when review runs successfully, then no separate scope-review provider session is required | 12 | An out-of-scope candidate result can leave no quality findings with its exclusion reason retained, and an established-target review makes no separate scope-review call. | diff-local |
| Story 5 negative: Given a result omits or duplicates a required candidate resolution, when the engine validates it, then it rejects the result through bounded malformed-result handling rather than passing or creating a bad-test finding | 11 | Result validation rejects missing/duplicate candidate answers, foreign obligations and absent/out-of-candidate source regions with the named problem. | diff-local |
| Story 5 negative: Given a proposed candidate resolution cites a foreign obligation, absent source region or unrelated sibling, when validated, then that proposed authority and any finding relying on it are rejected | 11 | Result validation rejects missing/duplicate candidate answers, foreign obligations and absent/out-of-candidate source regions with the named problem. | diff-local |
| Story 5 negative: Given unsupported syntax exists without a concrete opted-in candidate, when scope is assessed, then unsupported syntax alone does not create a halt or review requirement | 5 | Competing/file-header association fixtures retain concrete candidates, while unsupported unmarked source yields no invented review candidate or halt. | diff-local |
| Story 6 happy: Given a reviewer remains indeterminate about a concrete candidate, when the result is settled, then it identifies that candidate, its marker/obligation evidence and what clarification is needed through the bounded scope-incomplete path | 15 | A concrete indeterminate result records candidate/binding/missing-evidence detail on the existing result/event path and cannot emit ordinary PASS without an authorized reduced-coverage disposition. | diff-local |
| Story 6 happy: Given the operator supplies an authorized binding or source-evidence correction, when review reruns against the corrected evidence, then scope is recomputed and the previous indeterminacy does not force a permanent halt | 16 | Corrected pinned binding evidence recomputes candidate scope and can clear the previous scope-incomplete condition rather than retaining a permanent failure. | diff-local |
| Story 6 happy: Given the operator explicitly accepts reduced coverage for scope-incomplete with identity and rationale, when effective review status is computed, then the accepted limitation remains visibly attributed | 16 | The existing reduced-coverage action accepts only current authorized exhausted scope-incomplete state, renders attribution, and neither absent approval nor a waiver suppresses an independent finding. | diff-local |
| Story 6 negative: Given a pinned source read or provider call fails, when existing bounded retries are exhausted, then the failure is reported as unavailable evidence rather than an empty file, new test requirement or insensitive-test finding | 1, 15 | The source-reader negative fixtures reject path escape and required missing blobs, never substitute live content or an empty file, and expose a bounded evidence-read failure. | diff-local |
| Story 6 negative: Given unchanged indeterminacy is returned again, when recovery is evaluated, then it does not create an unbounded new retry loop or append speculative implementation tasks | 15 | The routing fixtures retain valid independent findings, charge only the existing fault allowance for unresolved scope, append no tasks and introduce no new retry loop; missing source/provider evidence is never labeled test-insensitive. | diff-local |
| Story 6 negative: Given no authorized reduced-coverage decision exists, when an indeterminate candidate remains, then ordinary PASS is not emitted; absence of tests or markers alone never enters this path | 15 | A concrete indeterminate result records candidate/binding/missing-evidence detail on the existing result/event path and cannot emit ordinary PASS without an authorized reduced-coverage disposition. | diff-local |
| Story 7 happy: Given source assembly has pinned base, HEAD and approved feature artifacts, when mutable worktree content changes afterward, then the already frozen scope and binding evidence remain unchanged | 1 | The source-snapshot integration keeps the same frozen plan, stories and test bytes after live files change, and correctly pairs renamed paths containing spaces. | diff-local |
| Story 7 happy: Given an identical current projection and policy are reviewed again, when a cache entry is reused, then its candidate resolutions and findings are validated against current reference authority | 17 | Current cache hits and fresh results enforce the same candidate/anchor authority; changed binding/helper/analysis evidence and old projection-v2 entries cannot reuse stale judgment. | diff-local |
| Story 7 happy: Given a previous disposition has the same supported result-v3 finding identity, when storage is read after the input upgrade, then it remains readable without an automatic identity migration | 17 | Legacy result-v3 dispositions remain readable with their exact existing finding identities, and a cache-version miss does not corrupt or migrate disposition storage. | diff-local |
| Story 7 negative: Given a projection-v2 cache entry, when the projection-v3 engine looks it up, then it misses safely and is not treated as malformed disposition storage | 17 | Current cache hits and fresh results enforce the same candidate/anchor authority; changed binding/helper/analysis evidence and old projection-v2 entries cannot reuse stale judgment. | diff-local |
| Story 7 negative: Given a binding, referenced helper/setup source or analysis contract changes, when cache lookup occurs, then stale scope judgment cannot be reused | 10, 17 | Projection identity changes when binding, helper/setup bytes or the analysis contract changes, while provenance-only changes do not alter semantic identity. | diff-local |
| Story 7 negative: Given a cached or fresh result uses a coarse fallback anchor to claim an unrelated sibling, when current scope authority is validated, then it is rejected despite matching a file-level identity | 11, 17 | Fresh reference validation rejects unrelated sibling findings even under a coarse fallback anchor, while preserving result-v3 title/occurrence identities for legitimate targets. | diff-local |
| Story 8 happy: Given an installed production engine without development dependencies, when a supported JavaScript/TypeScript candidate is analyzed, then precision analysis is available | 9 | The production-only packaging fixture imports actual scope analysis and identifies a supported JS/TS candidate without access to development-only dependencies. | diff-local |
| Story 8 happy: Given a supported source path was renamed or contains spaces, when source identities and changes are read, then the correct pinned sources are associated without splitting the path | 1 | The source-snapshot integration keeps the same frozen plan, stories and test bytes after live files change, and correctly pairs renamed paths containing spaces. | diff-local |
| Story 8 happy: Given several candidates reference the same source blob, when scope is assembled, then that blob is retrieved at most once per identity in that assembly | 8 | Assembly reads each commit/path blob once, never executes top-level consumer side effects, and preserves a concrete parser failure as uncertainty rather than a verified target or empty PASS. | diff-local |
| Story 8 negative: Given consumer source contains executable top-level side effects, when analysis reads it, then those side effects are never executed | 8 | Assembly reads each commit/path blob once, never executes top-level consumer side effects, and preserves a concrete parser failure as uncertainty rather than a verified target or empty PASS. | diff-local |
| Story 8 negative: Given a source reference escapes the repository boundary or names unavailable pinned content, when resolved, then it is rejected or reported unavailable rather than reading unrelated host files or substituting live content | 1 | The source-reader negative fixtures reject path escape and required missing blobs, never substitute live content or an empty file, and expose a bounded evidence-read failure. | diff-local |
| Story 8 negative: Given an applicable parser cannot load or source cannot be safely parsed for a concrete candidate, when analysis handles it, then the limitation remains explicit and cannot manufacture verified targets or an empty pass | 8 | Assembly reads each commit/path blob once, never executes top-level consumer side effects, and preserves a concrete parser failure as uncertainty rather than a verified target or empty PASS. | diff-local |
| Story 9 happy: Given the frozen 724-title case, when the new analysis runs, then it identifies eight directly added/modified test bodies and separately explains their actual binding dispositions rather than claiming eight authorized targets | 18 | The portable comparison identifies eight directly changed bodies from the 724-title regression and separately reports each actual binding disposition without local daemon files or GitHub downloads. | diff-local |
| Story 9 happy: Given increasingly many unrelated unchanged sibling declarations around the same changed tests, when projections are compared, then the changed-target list stays fixed and unrelated sibling titles do not inflate reviewer input | 10 | deriveBuildReviewRubricProjections emits input v3 with unchanged directly changed target count and no extra unrelated sibling titles as the fixture grows. | diff-local |
| Story 9 happy: Given old and new analysis run against the same portable fixtures, when comparison results are reported, then they identify source-read counts, projection bytes, target/candidate counts, model-call counts and analysis elapsed time | 18 | The comparison output records bytes, counts and elapsed analysis time, retains shared/ambiguous evidence, and makes no total-token or end-to-end savings claim without opt-in measured provider evidence. | diff-local |
| Story 9 negative: Given retained local daemon artifacts or the original feature commits are absent in CI, when ordinary verification runs, then portable fixtures still prove scope selection and no GitHub download is needed | 18 | The portable comparison identifies eight directly changed bodies from the 724-title regression and separately reports each actual binding disposition without local daemon files or GitHub downloads. | diff-local |
| Story 9 negative: Given difficult shared or ambiguous candidates require more context, when optimization is assessed, then they are not dropped merely to improve input size or elapsed time | 18 | The comparison output records bytes, counts and elapsed analysis time, retains shared/ambiguous evidence, and makes no total-token or end-to-end savings claim without opt-in measured provider evidence. | diff-local |
| Story 9 negative: Given no real-provider comparison was run, when results are reported, then projection bytes are not claimed as measured total tokens or end-to-end latency savings and ordinary tests call no third-party service | 18 | The comparison output records bytes, counts and elapsed analysis time, retains shared/ambiguous evidence, and makes no total-token or end-to-end savings claim without opt-in measured provider evidence. | diff-local |

## Architecture Obligation Coverage

| Decision | Disposition | Task(s) | Evidence |
|---|---|---|---|
| adr-2026-09-06-engine-owned-test-quality-scope#D1 | task | task-1 | The source-snapshot integration keeps the same frozen plan, stories and test bytes after live files change, and correctly pairs renamed paths containing spaces. |
| adr-2026-09-06-engine-owned-test-quality-scope#D2 | task | task-8, task-10, task-11 | assembleBuildReviewInputs integration returns precise changed declarations, attached bindings and shared affected groups rather than admitting every title in a marked file. |
| adr-2026-09-06-engine-owned-test-quality-scope#D3 | task | task-2, task-3, task-5, task-9 | The declaration unit fixtures return exactly added/body-or-argument-modified declarations while leaving unrelated unchanged sibling titles out of the changed set. |
| adr-2026-09-06-engine-owned-test-quality-scope#D4 | task | task-4, task-5 | Binding fixtures identify the attached criterion/task marker and allow suite inheritance only within its descendant tests. |
| adr-2026-09-06-engine-owned-test-quality-scope#D5 | task | task-7, task-6 | The plan-seeded helper fixture presents the concrete changed dependency chain for an unchanged opted-in test; a plan path alone creates no binding. |
| adr-2026-09-06-engine-owned-test-quality-scope#D6 | task | task-12, task-10, task-11 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-09-06-engine-owned-test-quality-scope#D7 | task | task-14, task-13, task-15, task-16 | coordinateBuildReviewRubrics returns explicit empty-scope PASS with zero reviewer/preflight calls for production-only refactors, pure moves and missing plan test paths when no concrete candidate exists. |
| adr-2026-09-06-engine-owned-test-quality-scope#D8 | task | task-17, task-10, task-11, task-12 | Current cache hits and fresh results enforce the same candidate/anchor authority; changed binding/helper/analysis evidence and old projection-v2 entries cannot reuse stale judgment. |
| adr-2026-09-06-engine-owned-test-quality-scope#D9 | task | task-15, task-16 | A concrete indeterminate result records candidate/binding/missing-evidence detail on the existing result/event path and cannot emit ordinary PASS without an authorized reduced-coverage disposition. |
| adr-2026-09-06-engine-owned-test-quality-scope#D10 | task | task-18, task-1, task-2, task-3, task-4, task-5, task-6, task-7, task-8, task-9, task-11, task-12, task-13, task-14, task-15, task-16, task-17 | The portable comparison identifies eight directly changed bodies from the 724-title regression and separately reports each actual binding disposition without local daemon files or GitHub downloads. |
| adr-2026-09-06-engine-owned-test-quality-scope#D11 | task | task-18, task-10 | The comparison output records bytes, counts and elapsed analysis time, retains shared/ambiguous evidence, and makes no total-token or end-to-end savings claim without opt-in measured provider evidence. |
| adr-2026-09-06-engine-owned-test-quality-scope#D12 | no-change | none | Delivery constraints create no separate functional task: no new CLI/config/skill/service or directory deletion; parser packaging is implemented under D3/Task 9. Canonical documentation accompanies implementation under repository upkeep and is checked at SHIP, not a standalone plan task. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D1 | existing | none | build-review-registry.ts registers only testQuality; resolved-config.ts retains its default-off policy and coordinator preserves the empty-enabled-set path. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D2 | existing | none | config.ts and build-review-dispositions.ts retain deprecated rubric-key compatibility; no retired key is reactivated by this feature. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D3 | task | task-14, task-8, task-12, task-13, task-15, task-16 | coordinateBuildReviewRubrics returns explicit empty-scope PASS with zero reviewer/preflight calls for production-only refactors, pure moves and missing plan test paths when no concrete candidate exists. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D4 | task | task-17, task-11, task-12 | Legacy result-v3 dispositions remain readable with their exact existing finding identities, and a cache-version miss does not corrupt or migrate disposition storage. |
| adr-2026-08-22-build-review-opt-in-rubric-container#D5 | no-change | none | This feature has no complexity-tier skip change; existing S-tier gate scheduling remains the owner. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D1 | task | task-12, task-11, task-17 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D2 | task | task-12, task-11, task-17 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D3 | task | task-12, task-11, task-17 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D4 | task | task-12, task-11, task-17 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D5 | task | task-12, task-11, task-17 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D6 | task | task-11, task-12 | Result validation rejects missing/duplicate candidate answers, foreign obligations and absent/out-of-candidate source regions with the named problem. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D7 | existing | none | step-runners.ts existing bounded repair handling detects a byte-identical repair; candidate payload rejection reuses that path rather than adding a loop. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D8 | task | task-15, task-12 | The routing fixtures retain valid independent findings, charge only the existing fault allowance for unresolved scope, append no tasks and introduce no new retry loop; missing source/provider evidence is never labeled test-insensitive. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D9 | no-change | none | No new plan-task reference kind is introduced; existing shared task reference normalization remains unchanged. |
| adr-2026-08-19-engine-stamped-rubric-judged-result-envelope#D10 | task | task-12, task-11 | The existing review dispatch accepts and persists a source-grounded unsupported-candidate resolution and quality finding in one provider call with engine-stamped result-v3 identity. |
| adr-2026-08-18-content-anchored-finding-reference-schema#D1 | task | task-1, task-11 | The source-snapshot integration keeps the same frozen plan, stories and test bytes after live files change, and correctly pairs renamed paths containing spaces. |
| adr-2026-08-18-content-anchored-finding-reference-schema#D2 | no-change | none | The shared plan-task reference kind is unchanged; active task membership remains with existing plan parsers. |
| adr-2026-08-18-content-anchored-finding-reference-schema#D3 | task | task-11, task-17 | Fresh reference validation rejects unrelated sibling findings even under a coarse fallback anchor, while preserving result-v3 title/occurrence identities for legitimate targets. |


## Verification ownership

All 54 happy/negative criteria have scoped test dispositions above. Behavioral tests use the lowest sufficient layer; BUILD entry acceptance specifications cover only distinct flows not sufficiently proved there. Each task owns its own RED/GREEN and boundary proof where assigned. The configured test_suite and SHIP gates own aggregate verification and completed-feature judgment; there is no terminal catch-all validation task.

## Verify-Claims Ledger

Verified source seams: frozen assembly, current file-wide marker/title behavior, shared plan path parser, provider payload construction, exact persisted evidence keys, cache staged parsing and reason/disposition unions. New module names are proposed implementation seams, not claims that files already exist. TypeScript production-only packaging is explicitly tested. No universal dependency-discovery or measured-token-savings assumption is adopted. Verdict: CLEAR.
