# Implementation Plan: Independent build-review rubrics with exact-finding dispositions

**Date:** 2026-08-13
**Design:** `.docs/decisions/adr-2026-08-13-engine-managed-build-review-rubric-branches.md`,
`.docs/decisions/adr-2026-08-13-stable-build-review-finding-dispositions.md`
**Architecture review:** `.docs/decisions/architecture-review-2026-08-13-build-review-rubric-dispositions.md` (APPROVED)
**Stories:** `.docs/stories/build-review-rubric-dispositions-and-fan-out.md`
**Conflict check:** Clean recheck as of 2026-08-14 (6 resolved; 0 blocking; 0 degrading)
**Intake:** jstoup111/ai-conductor#1542

> **Amended 2026-08-14 by the operator after #1562 merged and #1563's post-BUILD
> assessment:** retain Tasks 1-40 as the implementation history and append the bounded
> `rem-build-review-*` tasks below. The amendment repairs production wiring that drifted from the
> already-approved PRD, stories, ADRs, and component diagram: default fan-out selection,
> provider-aware rubric-skill execution, branch/cache persistence, event emission, neutral skip
> reduction, and disposition-aware lifecycle completion. It adds no rubric, command, event schema,
> ledger, provider, or product behavior outside the accepted scope.

> **Amended 2026-08-14 after #1556 merged:** append `rem-build-review-9` so the landed
> operator-reseal evidence channel remains production-reachable when this plan retires the scalar
> grader. The task composes the two approved designs by carrying reseal records into the frozen
> Scope projection and nowhere else; a reseal remains judged evidence, never an exemption.

## Summary

Keep one public `build_review` gate while moving its five judgement concerns into independently
configured, engine-dispatched rubric skills. The engine freezes the evidence boundary, reuses the
preceding `test_suite` PASS, runs only Tautology's missing reverted-production RED preflight,
content-addressably short-circuits unchanged rubric judgements, joins raw findings once, and applies
operator dispositions afterward. Forty original TDD tasks cover configuration, skills, projection,
preflight, caching, capped execution, stable identities, CLI authorization, the event spine,
reporting, and publication. Nine post-BUILD remediation tasks repair the production composition
seams that the first implementation left disconnected while preserving the original task history.

## Technical Approach

### One source snapshot, five closed projections

`DefaultStepRunner.runBuildReview` remains the only lifecycle entry point. It asks a new
`BuildReviewCoordinator` to validate the current `test_suite` proof, resolve one fresh base, and
freeze a source snapshot containing the full diff, approved plan, repair/widening context, entry
points, and removal evidence. A closed registry derives a versioned projection for each rubric.
Skills receive only their projection; any field they may use is therefore present in the projection
digest and participates in conservative cache invalidation.

The operator-reseal records landed by #1556 join that frozen source after the normal seal reader has
filtered them to literal `operator-reseal` lineage. They enter only the Scope projection, including
their named paths, verbatim rationale, and commit range. The Scope digest therefore invalidates when
that evidence changes, while Tautology, Root Cause, Completeness, and Wiring remain byte-insulated
from it. The Scope skill judges whether the rationale authorizes the named amendment and treats
unmatched paths normally; no deterministic bypass or standing `.docs/` permission is introduced.

The five rubric IDs are domain values, never `StepName`s. A typed auxiliary executor reuses the
group core's capped scheduling, fresh provider sessions, rate-limit coordination, fallback ladders,
retry/escalation policy, and attribution without writing synthetic conduct-state entries.

### Reuse green proof; execute only the RED counterfactual

The immediately preceding `test_suite` gate is the authoritative, content-addressed proof that
current HEAD is green. Review does not run the changed tests on HEAD again. Before Tautology, an
injected preflight derives changed-test selectors and the complementary production patch, then
materializes a disposable Git worktree below the configured scoped-test working directory's ignored
`.pipeline/build-review-preflight/` path. That placement preserves ordinary upward dependency
discovery into the installed environment. It keeps changed tests while substituting merge-base
production files, invokes the existing engine-owned scoped runner, and returns a closed
`red | stayed-green | infrastructure-failure | approved-exception` result. Normal non-zero test exit
is RED evidence; checkout, launch, timeout, or cleanup failure is infrastructure failure. Tests use
fake checkout and command adapters and prove neither live checkout changes; no ordinary test starts
real tests, GitHub, or an LLM. A bounded exact-input preflight cache binds merge base, selector/test
content, reverted-production patch, scoped command, and current green proof; it reuses only completed
semantic evidence, never infrastructure failures.

### Cache semantic results, never current verdicts

Each rubric's registry descriptor declares content-addressed caching. A key combines rubric and
contract identity, projection version/digest, and the fully resolved provider/model/effort/fallback/
retry policy fingerprint. Valid `judged` results—PASS or findings—may cache; deterministic skips
bypass both cache and provider, and infrastructure failures never cache. A hit is stamped into a new
current-lap branch artifact with cache provenance and then follows normal validation, finding-ID
canonicalization, disposition reduction, aggregate write, and completion checks. Old branch or
aggregate artifacts never satisfy current-attempt freshness.

The bounded cache lives under `.pipeline/build-review/cache/` as durable control state. Cache-hit
occurrences extend `ConductorEvent` and use the existing event spine. Disposition-only recomputation
does not alter raw projections, so accepting one finding can converge without five repeated model
calls.

### Raw judgement, post-judgement resolution, and future claims

Rubric skills emit versioned concern kinds, typed logical anchors, summaries, and evidence
locations. The engine validates and hashes only rubric/version/kind/anchors; prose and line numbers
cannot change identity. The raw aggregate is complete before any resolution state is read.

V1's post-judgement reducer accepts only verified operator dispositions. It is a typed boundary over
stable finding identities so the operator-identified future Tautology/Scope claim-or-bypass spec can
add an approved resolution variant later. This plan does not define claim records, authorization,
matching, expiry, or effect, and no claim or disposition enters rubric projections or cache keys.

### One state transaction and one telemetry spine

The aggregate coordinator and `build-review accept` CLI share one bounded, feature-local lock.
Disposition writes use same-directory temporary files and atomic rename; exact feature/lap/finding
comparison happens under lock. The standalone CLI generalizes the existing
`.pipeline/pipeline-events.jsonl` writer/tail rather than adding a ledger, and standard readers merge
that file with `.pipeline/events.jsonl` by timestamp.

Accepted-risk publication uses one deterministic renderer. The retained PR and shipped record both
project finding ID, rubric, acceptance-time summary, rationale, operator, and time from the same
state. Raw rubric failure metrics remain distinct from effective pass and accepted risk.

## Constraints and Prerequisites

- The original task count is 40, the upper end of `/plan`'s warning band. The operator-directed
  amendments raise the retained history to 49 addressable tasks because already-landed Tasks 1-40
  cannot be rewritten or reused. The nine remediation tasks remain one bounded feature repair:
  fan-out, stable identity, caching, events, and disposition convergence share one aggregate and
  lifecycle gate contract.
- PR #1556 is merged on `origin/main` at `bdd239ac7`; its seal reader, optional input field, prompt
  compatibility path, and tests arrive through the normal engine-owned rebase. This feature must
  compose with those landed surfaces rather than duplicate or replace them.
- No `.docs/track/` file matches issue #1542 or this feature slug. The approved PRD's `Scope`
  section is therefore the binding scope boundary for this amendment; every remediation task maps
  to an existing FR and story.
- Every test follows `.agents/skills/write-tests/SKILL.md`: injected providers/runners/clocks,
  isolated temporary project roots, no real third-party calls, no cyclic `Conductor.run()`, and no
  polling sleeps.
- No task edits `bin/conduct`, `CHANGELOG.md`, or `VERSION`. The CLI additions are pre-boot
  `conduct-ts` commands and require no migration block.
- The implementation must not mutate the live root or feature checkout during Tautology preflight.
- Existing `build-review-disposition.ts` owns fresh-base failure disposition. New operator state uses
  the plural `build-review-dispositions.ts` name to prevent domain collision.
- Legacy `build_review.enabled` and `perTaskFloor` parsing stays tolerant; only the new subtree is
  strict.
- A later Tautology/Scope claim-or-bypass spec is a compatibility dependency only. No task here
  implements or simulates it.

## Documentation Note

Ordinary documentation is intentionally not a plan task. The repository's
`maintain-documentation` custom step must update `docs/reference/configuration.md`,
`docs/reference/cli.md`, `docs/reference/skills.md`, `docs/reference/steps.md`, and
`docs/explanation/gates.md` in the implementation PR. `README.md` remains unchanged unless its
landing-page contract changes. Release metadata is authored by the release-disposition/PR workflow;
implementation branches do not edit release artifacts.

## Tasks

### Task 1: Define the closed rubric configuration shape and defaults

**Story:** 1
**Story:** 2
**Story:** 3
**Story:** 5
**Story:** 22
**Type:** happy
**Files:** `src/conductor/src/types/config.ts`, `src/conductor/src/engine/config.ts`, `src/conductor/test/engine/config.test.ts`
**Dependencies:** none

1. Write failing fixtures for the five closed rubric keys, per-rubric enablement/policy fields, and
   absent-config defaults including `maxParallel: 5`.
2. Run `npm test -- test/engine/config.test.ts`; confirm RED and review the domain shape for optional
   booleans versus resolved values.
3. Add the raw config types and default-preserving parser entries without changing legacy keys.
4. Re-run the focused test; confirm GREEN and exhaustively inspect the five-key map.
5. Commit `feat(config): define build review rubric settings`.

### Task 2: Reject malformed new rubric configuration and zero enabled coverage

**Story:** 3
**Story:** 4
**Story:** 5
**Story:** 22
**Type:** negative
**Files:** `src/conductor/src/engine/config.ts`, `src/conductor/test/config-validation.test.ts`, `src/conductor/test/engine/config.test.ts`
**Dependencies:** Task 1

1. Write failing cases for unknown rubric IDs, malformed execution policies, invalid concurrency,
   and enabled gate with all five rubrics disabled; pin tolerant legacy-key behavior beside them.
2. Run the two focused tests and confirm each new malformed case is RED.
3. Implement fail-closed validation only for `maxParallel`/`rubrics` and the semantic empty-set guard.
4. Re-run both tests; confirm GREEN and no provider/runner fixture was invoked on refusal.
5. Commit `feat(config): validate build review rubric coverage`.

### Task 3: Resolve independent rubric execution policies

**Story:** 2
**Story:** 5
**Story:** 22
**Type:** happy
**Files:** `src/conductor/src/engine/resolved-config.ts`, `src/conductor/test/engine/resolved-config.test.ts`, `src/conductor/test/integration/config-flow.test.ts`
**Dependencies:** Task 2

1. Write failing cases for inherited outer policy, per-rubric provider/model/effort overrides,
   fallback order, retry budget/escalation, partial overrides, and max-parallel clamping.
2. Run the focused resolver/config-flow tests; confirm RED and inspect precedence against existing
   provider-native defaults.
3. Implement a closed resolved-rubric policy map using the existing policy resolver.
4. Re-run focused tests; confirm GREEN and that unspecified siblings retain defaults.
5. Commit `feat(config): resolve policy per build review rubric`.

### Task 4: Register versioned rubric descriptors and policy fingerprints

**Story:** 1
**Story:** 5
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-registry.ts`, `src/conductor/test/engine/build-review-registry.test.ts`
**Dependencies:** Task 3

1. Write failing tests for an exhaustive five-member registry carrying skill name, contract version,
   projection version, cache policy, prerequisite classification, and canonical policy fingerprint.
2. Run the new test; confirm RED and domain-review that no descriptor uses `StepName`.
3. Implement the immutable registry and stable canonical policy fingerprint.
4. Re-run the test; confirm GREEN, order independence, and exhaustive lookup.
5. Commit `feat(engine): register build review rubric descriptors`.

### Task 5: Author the Tautology rubric skill contract

**Story:** 1
**Story:** 8
**Story:** 9
**Story:** 24
**Type:** happy
**Files:** `skills/build-review-tautology/SKILL.md`, `src/conductor/test/engine/build-review-rubric-skills.test.ts`
**Dependencies:** Task 4

1. Write a failing contract test for required frontmatter, input projection fields, typed finding
   anchors, all-findings output, RED/stayed-green interpretation, and no disposition authority.
2. Run the new test; confirm RED and domain-review the Tautology vocabulary.
3. Add the provider-agnostic shipped skill with concise judgement-only instructions.
4. Re-run the test; confirm GREEN and no instruction asks the model to run tests or spawn subagents.
5. Commit `feat(skills): add build review tautology policy`.

### Task 6: Author the Scope rubric skill contract

**Story:** 1
**Story:** 8
**Story:** 9
**Type:** happy
**Files:** `skills/build-review-scope/SKILL.md`, `src/conductor/test/engine/build-review-rubric-skills.test.ts`
**Dependencies:** Task 5

1. Extend the contract test with failing Scope cases for plan relation, accepted widening context,
   typed path/surface anchors, and complete independent findings.
2. Run the focused test; confirm RED and review that future claim/bypass semantics are absent.
3. Add the Scope skill over its closed projection.
4. Re-run the test; confirm GREEN and that neither dispositions nor future claims are model input.
5. Commit `feat(skills): add build review scope policy`.

### Task 7: Author the Root Cause rubric skill contract

**Story:** 1
**Story:** 8
**Story:** 9
**Type:** happy
**Files:** `skills/build-review-root-cause/SKILL.md`, `src/conductor/test/engine/build-review-rubric-skills.test.ts`
**Dependencies:** Task 6

1. Extend the contract test with failing Root Cause cases for stated defect/outcome, implementation
   mechanism/locus anchors, symptom-only findings, and zero-findings PASS semantics.
2. Run the focused test; confirm RED and domain-review the anchor discriminants.
3. Add the Root Cause skill over its closed projection.
4. Re-run the test; confirm GREEN and no runtime/manual-test responsibility leaks in.
5. Commit `feat(skills): add build review root cause policy`.

### Task 8: Author the Completeness rubric skill contract

**Story:** 1
**Story:** 3
**Story:** 8
**Story:** 9
**Type:** happy
**Files:** `skills/build-review-completeness/SKILL.md`, `src/conductor/test/engine/build-review-rubric-skills.test.ts`
**Dependencies:** Task 7

1. Extend the contract test with failing Completeness cases for holistic plan/outcome/task anchors,
   missing deliverables, default-on policy, and explicit-disable ownership outside the skill.
2. Run the focused test; confirm RED and compare its meaning to the governing Completeness ADR.
3. Add the Completeness skill over its closed projection.
4. Re-run the test; confirm GREEN and preserve plan-vs-full-diff judgement.
5. Commit `feat(skills): add build review completeness policy`.

### Task 9: Author the Wiring rubric skill contract

**Story:** 1
**Story:** 3
**Story:** 8
**Story:** 9
**Type:** happy
**Files:** `skills/build-review-wiring/SKILL.md`, `src/conductor/test/engine/build-review-rubric-skills.test.ts`
**Dependencies:** Task 8

1. Extend the contract test with failing Wiring cases for production surface/entry-point/reachability
   anchors and the engine-owned `missing-entry-points` prerequisite skip.
2. Run the focused test; confirm RED and review that the skill cannot manufacture a skip or pass.
3. Add the Wiring skill over its closed projection.
4. Re-run the test; confirm GREEN and preserve removal/relocation and scaffolding exceptions.
5. Commit `feat(skills): add build review wiring policy`.

### Task 10: Register rubric skills in generated model and installation metadata

**Story:** 1
**Story:** 5
**Story:** 22
**Type:** happy
**Files:** `src/conductor/src/engine/model-table-metadata.ts`, `src/tools/generate-model-table.ts`, `src/conductor/test/generate-model-table.test.ts`, `src/conductor/test/model-table-metadata.test.ts`, `HARNESS.md`
**Dependencies:** Tasks 5-9

1. Write failing generated-table tests requiring five distinct auxiliary skill rows with inherited
   rubric policy and no fabricated lifecycle steps.
2. Run `npm test -- test/generate-model-table.test.ts test/model-table-metadata.test.ts` from
   `src/conductor`; confirm RED and inspect pin/step-map invariants.
3. Add auxiliary rows/metadata and regenerate only the generated HARNESS model-table section.
4. Re-run the focused test; confirm GREEN and byte-for-byte generator agreement.
5. Commit `feat(skills): register build review rubric policies`.

### Task 11: Define and validate exhaustive rubric result types

**Story:** 1
**Story:** 7
**Story:** 8
**Story:** 9
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-domain.ts`, `src/conductor/test/engine/build-review-domain.test.ts`
**Dependencies:** Task 4

1. Write failing tests for branded rubric/lap/contract identities, typed anchor unions, judged
   results, closed skip reasons, infrastructure failures, and invalid boolean combinations.
2. Run the new test; confirm RED and domain-review exhaustive union boundaries.
3. Implement boundary parsers returning trusted domain values and deriving judged PASS from zero
   findings only.
4. Re-run the test; confirm GREEN and unknown variants fail closed.
5. Commit `feat(engine): define build review rubric domain`.

### Task 12: Freeze source evidence and require current test-suite proof

**Story:** 6
**Story:** 23
**Story:** 24
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-inputs.ts`, `src/conductor/test/engine/build-review-inputs.test.ts`, `src/conductor/test/engine/build-review-isolation.test.ts`
**Dependencies:** Task 11

1. Write failing cases for a single frozen base/HEAD/diff/plan/context snapshot, injected CURRENT
   `test_suite` inspection, and refusal of missing/failed/stale proof before any rubric dispatch.
2. Run the two focused tests; confirm RED and check that maker narrative/dispositions remain absent.
3. Extend input assembly with the typed proof and immutable source-snapshot identity.
4. Re-run both tests; confirm GREEN and zero scoped/aggregate test runner calls during assembly.
5. Commit `feat(engine): bind build review to current suite proof`.

### Task 13: Derive closed rubric projections and canonical digests

**Story:** 6
**Story:** 12
**Story:** 13
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-projections.ts`, `src/conductor/test/engine/build-review-projections.test.ts`
**Dependencies:** Tasks 4, 11, 12

1. Write failing tests for every rubric's permitted fields, deterministic serialization, ordering
   independence, versioned digest, and rejection of an undeclared field.
2. Run the new test; confirm RED and domain-review that every skill dependency is represented.
3. Implement the five projection constructors and canonical digest function.
4. Re-run the test; confirm GREEN and prove two source snapshots differing only in forbidden prose
   yield identical projections.
5. Commit `feat(engine): derive cacheable rubric projections`.

### Task 14: Materialize a disposable reverted-production preflight checkout

**Story:** 24
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-tautology-preflight.ts`, `src/conductor/test/engine/build-review-tautology-preflight.test.ts`
**Dependencies:** Tasks 12, 13

1. Write a failing fake-filesystem/Git test that derives changed-test selectors and the complementary
   production patch, nests the disposable worktree below the scoped working directory, keeps HEAD
   tests, substitutes merge-base production files, and records source identities.
2. Run the new test; confirm RED and review path ownership/cleanup as explicit domain effects.
3. Implement the closed path classifier and injected nested-worktree materializer without touching
   either live checkout; unknown/empty selectors must not invoke an aggregate fallback.
4. Re-run the test; confirm GREEN and byte snapshots of root/feature inputs remain unchanged.
5. Commit `feat(engine): isolate tautology counterfactual checkout`.

### Task 15: Classify Tautology RED and stayed-green outcomes

**Story:** 24
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-tautology-preflight.ts`, `src/conductor/test/engine/build-review-tautology-preflight.test.ts`
**Dependencies:** Task 14

1. Write failing injected-runner/cache cases where normal non-zero test exit becomes `red`, zero exit
   becomes `stayed-green`, approved empty-set/removal exceptions remain distinct, and an exact-input
   hit reuses evidence without another checkout or command.
2. Run the focused test; confirm RED and domain-review test failure versus infrastructure failure.
3. Call the engine-owned scoped runner in the isolated checkout, persist only completed typed
   evidence under the bounded cache, and emit cache provenance.
4. Re-run the test; confirm GREEN and exactly one counterfactual command per cold preflight.
5. Commit `feat(engine): capture tautology red evidence`.

### Task 16: Fail closed and clean up every preflight infrastructure path

**Story:** 8
**Story:** 24
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-tautology-preflight.ts`, `src/conductor/test/engine/build-review-tautology-preflight.test.ts`
**Dependencies:** Task 15

1. Write failing cases for materialization error, missing scoped configuration, launch error, timeout,
   signal, cleanup error, and concurrent abort; assert bounded termination and live-byte invariance.
2. Run the focused test; confirm RED and inspect every resource owner for one cleanup path.
3. Implement exhaustive infrastructure classification and `finally` cleanup/verification.
4. Re-run the test; confirm GREEN, no leaked process/temporary path, and no false RED evidence.
5. Commit `fix(engine): fail closed on tautology preflight faults`.

### Task 17: Persist a bounded validated semantic-result cache

**Story:** 16
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-cache.ts`, `src/conductor/test/engine/build-review-cache.test.ts`
**Dependencies:** Tasks 11, 13

1. Write failing tests for one feature-scoped versioned entry per rubric, atomic replace, strict
   parsing, missing-cache miss, and bounded overwrite.
2. Run the new test; confirm RED and domain-review that cache state is not event telemetry.
3. Implement injected filesystem reads/writes under `.pipeline/build-review/cache/`.
4. Re-run the test; confirm GREEN and malformed/unsupported entries miss without mutation.
5. Commit `feat(engine): persist bounded rubric result cache`.

### Task 18: Resolve cache hits and rematerialize current-lap results

**Story:** 6
**Story:** 8
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-cache.ts`, `src/conductor/test/engine/build-review-cache.test.ts`
**Dependencies:** Tasks 4, 17

1. Write failing tests for exact rubric/contract/projection/policy matches, PASS and finding-result
   reuse, explicit provenance, current lap/snapshot restamping, and zero provider calls.
2. Run the focused test; confirm RED and verify only semantic payload crosses lap identity.
3. Implement lookup and trusted current-lap rematerialization.
4. Re-run the test; confirm GREEN and prove no old branch/aggregate path is returned.
5. Commit `feat(engine): rematerialize cached rubric judgements`.

### Task 19: Invalidate unsafe cache entries conservatively

**Story:** 8
**Story:** 13
**Story:** 25
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-cache.ts`, `src/conductor/test/engine/build-review-cache.test.ts`
**Dependencies:** Task 18

1. Write failing miss cases for changed permitted input, contract/projection version, provider/model/
   effort/fallback/retry policy, malformed identity, and cached infrastructure failure.
2. Run the focused test; confirm RED and review each invalidator against the cache key contract.
3. Implement exhaustive miss reasons and refuse non-judged entries at write/read boundaries.
4. Re-run the test; confirm GREEN and no invalid entry is rewritten as valid.
5. Commit `fix(engine): invalidate unsafe rubric cache entries`.

### Task 20: Add a typed auxiliary branch adapter to the group core

**Story:** 1
**Story:** 2
**Story:** 5
**Type:** happy
**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/test/engine/group-core.test.ts`
**Dependencies:** Tasks 3, 11

1. Write a failing test dispatching string member IDs with typed policy/outcome callbacks and assert
   no `StepName` cast or conduct-state write is required.
2. Run the focused test; confirm RED and domain-review ownership of session/outcome state.
3. Add the auxiliary adapter over the existing semaphore/session/rate-limit core.
4. Re-run the test; confirm GREEN and existing lifecycle group tests remain unchanged.
5. Commit `feat(engine): support typed auxiliary group branches`.

### Task 21: Preserve concurrency, fallback, retries, and attribution for auxiliary branches

**Story:** 2
**Story:** 5
**Story:** 8
**Type:** negative
**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/test/engine/group-core.test.ts`
**Dependencies:** Task 20

1. Write failing tests for cap 5/lower caps, independent provider ladders, retry escalation,
   rate-limit coordination, actual-provider attribution, and exhausted infrastructure outcome.
2. Run the focused test; confirm RED and use deferred fakes rather than timers.
3. Route auxiliary members through the existing provider-aware recovery primitives.
4. Re-run the test; confirm GREEN, bounded concurrency, and fresh provider-local sessions.
5. Commit `feat(engine): preserve policy semantics for rubric branches`.

### Task 22: Classify disabled and missing-premise rubrics before dispatch

**Story:** 3
**Story:** 4
**Story:** 7
**Story:** 21
**Story:** 22
**Story:** 23
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-coordinator.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts`
**Dependencies:** Tasks 3, 4, 11

1. Write failing coordinator tests for `skipped: disabled`, Wiring-only
   `skipped: missing-entry-points`, all-disabled refusal, whole-gate disable, and zero model/cache calls.
2. Run the new test; confirm RED and domain-review skip versus pass/failure.
3. Implement registry selection and prerequisite classification before cache/provider layers.
4. Re-run the test; confirm GREEN and a lap with no valid judgement cannot pass.
5. Commit `feat(engine): classify rubric skips before dispatch`.

### Task 23: Orchestrate preflight, cache lookup, and capped rubric dispatch

**Story:** 1
**Story:** 2
**Story:** 5
**Story:** 6
**Story:** 8
**Story:** 24
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-coordinator.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Dependencies:** Tasks 16, 19, 21, 22

1. Write failing orchestration tests for one source snapshot, Tautology preflight, per-rubric cache
   hit/miss, capped misses, independent policies, and exhaustive settle before return.
2. Run the focused tests; confirm RED and inspect the engine/model trust boundary.
3. Replace the inline one-shot dispatch path with the coordinator while retaining one public step.
4. Re-run the tests; confirm GREEN, no rubric sees sibling/disposition inputs, and cached branches
   make no provider call.
5. Commit `feat(engine): coordinate independent build review rubrics`.

### Task 24: Validate write-disjoint current-lap branch artifacts

**Story:** 1
**Story:** 6
**Story:** 8
**Story:** 25
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-artifacts.ts`, `src/conductor/test/engine/build-review-artifacts.test.ts`
**Dependencies:** Tasks 11, 23

1. Write failing tests for rubric/lap-specific paths, engine-supplied output identity, malformed JSON,
   rubric/lap/snapshot mismatch, missing result, and current-lap cached provenance.
2. Run the new test; confirm RED and domain-review the single-writer boundary.
3. Implement strict per-branch writer/parser validation under `.pipeline/build-review/<lap>/`.
4. Re-run the test; confirm GREEN and concurrent branches cannot share a path.
5. Commit `feat(engine): validate build review branch artifacts`.

### Task 25: Canonicalize stable rubric finding identities

**Story:** 9
**Story:** 12
**Story:** 13
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-finding-identity.ts`, `src/conductor/test/engine/build-review-finding-identity.test.ts`
**Dependencies:** Task 11

1. Write failing tests for each rubric's typed anchors, stable sorted canonical payload, prose/line
   drift preserving identity, and materially different concern/anchor changing identity.
2. Run the new test; confirm RED and domain-review all five discriminated schemas.
3. Implement schema validation, canonical serialization, and version-bound finding IDs.
4. Re-run the test; confirm GREEN and full canonical payload accompanies every hash.
5. Commit `feat(engine): canonicalize build review finding identities`.

### Task 26: Fail closed on identity collisions and incomplete finding sets

**Story:** 8
**Story:** 9
**Story:** 13
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-finding-identity.ts`, `src/conductor/test/engine/build-review-finding-identity.test.ts`
**Dependencies:** Task 25

1. Write failing tests for duplicate same-lap IDs with different payloads, invalid anchors,
   unsupported versions, duplicate omission, and a grader returning only one of several findings.
2. Run the focused test; confirm RED and review collision as infrastructure-shaped failure.
3. Add complete-list and full-payload collision guards at the validated branch boundary.
4. Re-run the test; confirm GREEN and no collision can match a disposition.
5. Commit `fix(engine): reject ambiguous build review findings`.

### Task 27: Join raw rubric outcomes into a backward-compatible aggregate

**Story:** 1
**Story:** 7
**Story:** 8
**Story:** 9
**Story:** 21
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-aggregate.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/build-review-aggregate.test.ts`, `src/conductor/test/engine/build-review-verdict.test.ts`
**Dependencies:** Tasks 22, 24, 26

1. Write failing tests for all-branches settle, zero-findings judged PASS, complete findings,
   skips/coverage, infrastructure failure, and legacy top-level fields/codeStamp.
2. Run the focused tests; confirm RED and domain-review raw versus effective state.
3. Implement the single-writer raw join and strict aggregate parser while preserving legacy
   fail-closed reading.
4. Re-run tests; confirm GREEN and neither skip nor missing judgement manufactures PASS.
5. Commit `feat(engine): join build review rubric outcomes`.

### Task 28: Derive effective verdicts without weakening freshness

**Story:** 7
**Story:** 8
**Story:** 12
**Story:** 13
**Story:** 23
**Story:** 25
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-aggregate.ts`, `src/conductor/src/engine/artifacts.ts`, `src/conductor/test/engine/build-review-aggregate.test.ts`, `src/conductor/test/engine/build-review-verdict.test.ts`
**Dependencies:** Task 27

1. Write failing tests for the typed post-judgement reducer with no resolutions, unresolved findings,
   current-lap cache artifacts, stale aggregate/branch evidence, and legacy evidence that cannot gain
   a resolution.
2. Run focused tests; confirm RED and check compatibility with per-attempt/codeStamp validity.
3. Implement v1's disposition-capable reducer seam and current-attempt aggregate write/predicate.
4. Re-run tests; confirm GREEN and old aggregate freshness can never satisfy a cache-hit attempt.
5. Commit `feat(engine): derive fresh effective build review verdicts`.

### Task 29: Persist feature-scoped dispositions under one atomic lock

**Story:** 14
**Story:** 16
**Story:** 17
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-dispositions.ts`, `src/conductor/test/engine/build-review-dispositions.test.ts`
**Dependencies:** Tasks 25, 28

1. Write failing tests for versioned feature identity, full canonical finding payload, exact source
   lap, rationale/operator/time, atomic replace, concurrent lock, stale-owner reclamation, and
   unreadable state.
2. Run the new test; confirm RED and domain-review crash/lock ownership.
3. Implement injected-clock/filesystem store and shared bounded transaction.
4. Re-run the test; confirm GREEN, feature isolation, and fail-closed timeout/corruption.
5. Commit `feat(engine): persist atomic build review dispositions`.

### Task 30: Match accepted concerns across laps after raw grading

**Story:** 7
**Story:** 11
**Story:** 12
**Story:** 13
**Story:** 16
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-dispositions.ts`, `src/conductor/src/engine/build-review-aggregate.ts`, `src/conductor/test/engine/build-review-dispositions.test.ts`, `src/conductor/test/engine/build-review-aggregate.test.ts`
**Dependencies:** Task 29

1. Write failing tests for wording/line drift, exact payload verification, one accepted finding among
   siblings, materially new concern, infrastructure failure, and raw metrics remaining unchanged.
2. Run focused tests; confirm RED and review accepted versus grader-PASS vocabulary.
3. Apply verified matches only after raw join and expose accepted/unresolved collections.
4. Re-run tests; confirm GREEN and only the matching concern loses blocking effect.
5. Commit `feat(engine): apply exact finding dispositions after grading`.

### Task 31: Add a read-only current-findings CLI

**Story:** 10
**Story:** 14
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-cli.ts`, `src/conductor/src/cli.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/build-review-cli.test.ts`, `src/conductor/test/cli/index.test.ts`
**Dependencies:** Tasks 27, 29

1. Write failing command/parser tests for `build-review findings --feature <slug>`, canonical worktree
   resolution, current lap, raw/accepted/unresolved findings, skips, and infrastructure failures.
2. Run focused tests; confirm RED and verify the command performs no write or pipeline boot.
3. Implement pre-boot detection/dispatch and deterministic human/JSON rendering.
4. Re-run tests; confirm GREEN for valid, absent, malformed, and mismatched feature state.
5. Commit `feat(cli): inspect current build review findings`.

### Task 32: Accept one exact current finding as a verified operator

**Story:** 11
**Story:** 15
**Story:** 16
**Story:** 17
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-cli.ts`, `src/conductor/src/cli.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/build-review-cli.test.ts`, `src/conductor/test/cli/index.test.ts`
**Dependencies:** Tasks 29-31

1. Write failing tests for exact feature/lap/finding/rationale input, interactive TTY, machine-scoped
   identity resolution, one-record atomic mutation, and unchanged siblings.
2. Run focused tests; confirm RED and domain-review the human-versus-autonomous boundary.
3. Implement `build-review accept` through the shared state transaction.
4. Re-run tests; confirm GREEN and provider/daemon piped-stdin attempts cannot cross the guard.
5. Commit `feat(cli): accept one build review finding`.

### Task 33: Refuse stale, malformed, or raced acceptance atomically

**Story:** 14
**Story:** 15
**Story:** 17
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-cli.ts`, `src/conductor/test/engine/build-review-cli.test.ts`
**Dependencies:** Task 32

1. Write failing cases for blank rationale, unresolved identity, non-TTY, wrong feature, stale lap,
   unknown/already accepted finding, skip/infrastructure target, lock timeout, and lap replacement
   while waiting for the lock.
2. Run the focused test; confirm RED and assert byte-identical disposition state for every refusal.
3. Implement the exhaustive refusal union and under-lock exact-current comparison.
4. Re-run the test; confirm GREEN and the command never clears a general HALT.
5. Commit `fix(cli): refuse unsafe build review dispositions`.

### Task 34: Add rubric, cache, disposition, and outer-verdict event variants

**Story:** 18
**Story:** 20
**Story:** 21
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/types/events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/ui/events.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/ui/events.test.ts`
**Dependencies:** Tasks 18, 22, 30, 33

1. Write failing exhaustive cases for rubric start/result/skip/cache-hit/infrastructure-failure,
   disposition accepted/refused, and raw/effective outer verdict events.
2. Run focused tests; confirm RED and apply the event-spine schema-not-file test.
3. Extend `ConductorEvent` and sink/UI declarations; wire coordinator callbacks without a new ledger.
4. Re-run tests; confirm GREEN and unknown future variants remain compile-time/exhaustive failures.
5. Commit `feat(events): observe build review rubric outcomes`.

### Task 35: Generalize the external event writer and merged reader

**Story:** 18
**Story:** 20
**Type:** happy
**Files:** `src/conductor/src/engine/closeout-events.ts`, `src/conductor/src/engine/closeout-tail.ts`, `src/conductor/src/engine/build-tail-rollup.ts`, `src/conductor/test/closeout-events.test.ts`, `src/conductor/test/closeout-event.test.ts`, `src/conductor/test/engine/build-tail-cli.test.ts`
**Dependencies:** Task 34

1. Write failing tests that allowlist disposition events in the existing external ledger, serialize
   concurrent writers, tail without re-persisting, and merge both ledgers by timestamp.
2. Run focused tests; confirm RED and verify malformed lines fail closed.
3. Generalize closeout-only helpers into the shared feature-event contract while retaining the
   `.pipeline/pipeline-events.jsonl` path.
4. Re-run tests; confirm GREEN and no third JSONL file is created.
5. Commit `feat(events): merge standalone build review events`.

### Task 36: Calculate laps-to-pass, rubric failure rates, skip coverage, and cache usage

**Story:** 18
**Story:** 20
**Story:** 21
**Story:** 25
**Type:** happy
**Files:** `src/conductor/src/engine/build-tail-rollup.ts`, `src/conductor/src/engine/timing-rollup.ts`, `src/conductor/src/engine/kpi-report.ts`, `src/conductor/test/engine/kpi-report.test.ts`, `src/conductor/test/build-tail-cli.test.ts`
**Dependencies:** Task 35

1. Write failing event-stream fixtures for multi-lap effective pass, per-rubric raw findings,
   infrastructure outcomes, excluded skips, enabled-judgement denominators, and cache-hit counts.
2. Run focused tests; confirm RED and manually verify denominator arithmetic.
3. Implement deterministic rollups over the merged feature-event reader.
4. Re-run tests; confirm GREEN and accepted findings remain raw failures, not grader passes.
5. Commit `feat(reporting): measure build review convergence`.

### Task 37: Render review metrics and reduced coverage on standard surfaces

**Story:** 18
**Story:** 20
**Story:** 21
**Type:** happy
**Files:** `src/conductor/src/engine/report-renderer.ts`, `src/conductor/src/engine/daemon-dashboard.ts`, `src/conductor/test/engine/report-renderer.test.ts`, `src/conductor/test/engine/daemon-observe-cli.test.ts`
**Dependencies:** Task 36

1. Write failing snapshots for laps-to-pass, rubric failure rates, skip reasons/coverage, cache use,
   infrastructure failures, and absent-data behavior.
2. Run focused tests; confirm RED and review wording so skip is never rendered as pass.
3. Add the computed fields to report/dashboard renderers.
4. Re-run tests; confirm GREEN and legacy event histories render safely.
5. Commit `feat(reporting): render build review rubric metrics`.

### Task 38: Project accepted risk into the retained implementation PR

**Story:** 19
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-accepted-risk.ts`, `src/conductor/src/engine/finish-publication-production.ts`, `src/conductor/test/engine/build-review-accepted-risk.test.ts`, `src/conductor/test/engine/finish-publication-production.test.ts`
**Dependencies:** Tasks 29, 30

1. Write failing tests for deterministic accepted-risk rendering, full attribution fields,
   idempotent section upsert, multiple findings, no findings, and known-unrenderable state.
2. Run focused tests; confirm RED and domain-review one authoritative renderer.
3. Implement the renderer and retained-PR publication effect integration.
4. Re-run tests; confirm GREEN and unrenderable accepted risk blocks instead of disappearing.
5. Commit `feat(finish): publish accepted build review risk`.

### Task 39: Append the same accepted-risk evidence to shipped records

**Story:** 19
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-accepted-risk.ts`, `src/conductor/src/engine/shipped-record.ts`, `src/conductor/src/engine/shipped-record-cli.ts`, `src/conductor/test/engine/shipped-record.test.ts`, `src/conductor/test/engine/finish-record-cli.test.ts`
**Dependencies:** Task 38

1. Write failing tests that reuse the PR renderer/data contract in shipped output, preserve existing
   frontmatter/cost/time blocks, and reject known accepted records that cannot render.
2. Run focused tests; confirm RED and compare PR/shipped section bytes.
3. Wire the deterministic accepted-risk projection into shipped-record construction.
4. Re-run tests; confirm GREEN, idempotence, and backward-compatible records with no dispositions.
5. Commit `feat(shipping): retain accepted build review risk`.

### Task 40: Prove fan-out, RED preflight, caching, and exact disposition end to end

**Story:** 1
**Story:** 2
**Story:** 3
**Story:** 4
**Story:** 5
**Story:** 6
**Story:** 7
**Story:** 8
**Story:** 9
**Story:** 10
**Story:** 11
**Story:** 12
**Story:** 13
**Story:** 14
**Story:** 15
**Story:** 16
**Story:** 17
**Story:** 18
**Story:** 19
**Story:** 20
**Story:** 21
**Story:** 22
**Story:** 23
**Story:** 24
**Story:** 25
**Type:** integration
**Files:** `src/conductor/test/acceptance/build-review-rubric-fanout-and-dispositions.acceptance.test.ts`, `src/conductor/test/acceptance/build-review-repeats-aggregate-verification-despit.acceptance.test.ts`, `src/conductor/test/acceptance/repeated-build-review-semantic-failures-can-churn-.acceptance.test.ts`, `src/conductor/test/acceptance/build-review-completeness.acceptance.test.ts`, `src/conductor/test/acceptance/wiring-judged-in-build-review.acceptance.test.ts`
**Dependencies:** Tasks 1-39

1. Write acceptance scenarios with faithful fake providers/runners for default-five fan-out, lower
   cap, per-rubric policies, disabled/missing-premise skips, upstream green-proof reuse, isolated RED,
   cache-cold and cache-hit laps, one exact acceptance, wording drift, new finding, stale refusal,
   infrastructure failure, legacy evidence, and whole-gate disablement.
2. Run only the five named acceptance files; confirm new scenarios are RED and no real provider,
   aggregate suite, GitHub call, or live-checkout mutation occurs.
3. Complete only the missing composition wiring exposed by the acceptance tests; do not widen scope
   or add behavior absent from Tasks 1-39.
4. Re-run the five files; confirm GREEN, cache/skip provider call counts, current-lap aggregate
   freshness, and unchanged legacy scenarios.
5. Commit `test(acceptance): prove build review disposition convergence`.

### Task rem-build-review-1: Make resolved default configuration select rubric fan-out

**Story:** 22
**Story:** 23
**Type:** negative
**Files:** `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Dependencies:** Tasks 22, 23, 40

1. Write failing runner cases for an absent `build_review` block, a partial rubric override, and
   explicit whole-gate disablement; prove the first two enter the five-rubric coordinator while the
   disabled gate dispatches no rubric or scalar grader.
2. Run the focused runner cases; confirm RED because production currently keys fan-out on raw config
   presence rather than `ResolvedBuildReviewConfig`.
3. Route every enabled production `build_review` through the rubric coordinator after the existing
   deterministic preconditions, retaining the injectable coordinator only as a test seam and the
   legacy scalar parser only for reading old evidence.
4. Re-run the focused tests; confirm GREEN and no configuration shape can manufacture an empty
   successful review.
5. Commit `fix(engine): make build review fan-out the resolved default` with trailer
   `Task: rem-build-review-1`.

### Task rem-build-review-2: Execute registered rubric skills through provider-aware branch policy

**Story:** 1
**Story:** 2
**Story:** 5
**Story:** 6
**Type:** happy
**Files:** `src/conductor/src/engine/group-core.ts`, `src/conductor/src/engine/provider-execution.ts`, `src/conductor/src/engine/skill-invocation.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/group-core.test.ts`, `src/conductor/test/engine/provider-execution.test.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/integration/provider-model-policy-wiring.integration.test.ts`, `src/conductor/test/engine/attribution-conductor-wiring.test.ts`
**Dependencies:** Task rem-build-review-1

1. Write failing pure and integration cases with two rubrics selecting different providers, models,
   fallback ladders, retry budgets, and escalation flags; assert candidate-local host syntax invokes
   each registry `skillName`, every session is fresh, and provider attribution names the rubric's
   actual candidate.
2. Run only the named provider/group/runner tests; confirm RED at the current direct
   `this.provider.invoke` boundary and domain-review rubric IDs remain auxiliary values, never
   fabricated `StepName`s or conduct-state keys.
3. Complete the typed auxiliary branch adapter over the shared group semaphore and provider
   candidate executor. Translate each fully resolved rubric policy exactly once, render the
   registered provider-agnostic skill for the selected host, and retain existing safety,
   rate-limit, session, fallback, retry, and attribution hooks.
4. Re-run the focused tests; confirm GREEN for mixed providers, fallback/retry exhaustion as
   infrastructure failure, capped concurrency, and zero cross-branch session reuse.
5. Commit `fix(engine): honor build review rubric execution policy` with trailer
   `Task: rem-build-review-2`.

### Task rem-build-review-3: Materialize branch evidence and bounded semantic cache writes

**Story:** 6
**Story:** 8
**Story:** 23
**Story:** 25
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-coordinator.ts`, `src/conductor/src/engine/build-review-artifacts.ts`, `src/conductor/src/engine/build-review-cache.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts`, `src/conductor/test/engine/build-review-artifacts.test.ts`, `src/conductor/test/engine/build-review-cache.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Dependencies:** Task rem-build-review-2

1. Write failing tests that a fresh judged result atomically writes its semantic cache entry and
   current-lap branch artifact, a valid hit writes only a rematerialized current-lap artifact with
   explicit cache provenance, skips never write cache, and infrastructure/write failures block the
   owning rubric without publishing a partial aggregate.
2. Run the four focused suites; confirm RED because production currently reads cache but writes only
   `.pipeline/build-review.json`.
3. Add injected coordinator write effects for validated branch artifacts and cacheable judged
   results, then wire production filesystem adapters from the runner. Preserve one owner per
   rubric/lap path, atomic replace, bounded one-entry-per-rubric cache, and strict identity checks.
4. Re-run the focused suites; confirm GREEN for cold/hit/invalidation/write-failure paths and prove
   every aggregate input came from a validated current-lap branch artifact.
5. Commit `fix(engine): persist build review branch and cache evidence` with trailer
   `Task: rem-build-review-3`.

### Task rem-build-review-4: Emit rubric and disposition occurrences on the existing event spine

**Story:** 18
**Story:** 20
**Story:** 21
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-coordinator.ts`, `src/conductor/src/engine/build-review-cli.ts`, `src/conductor/src/engine/closeout-events.ts`, `src/conductor/src/engine/event-sinks.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/src/index.ts`, `src/conductor/test/engine/build-review-coordinator.test.ts`, `src/conductor/test/engine/build-review-cli.test.ts`, `src/conductor/test/engine/event-sinks.test.ts`, `src/conductor/test/engine/step-runners.test.ts`, `src/conductor/test/cli/index.test.ts`
**Dependencies:** Task rem-build-review-3

1. Write failing occurrence-order tests for rubric start, judged result, skip, cache hit,
   infrastructure failure, raw/effective outer verdict, and CLI acceptance/refusal; assert engine
   events reach `EventPersister` and CLI events use the existing same-schema external writer.
2. Run only the named suites; confirm RED because the union has declarations and consumers but no
   production emitter, while its engine sink declarations currently disable persistence.
3. Inject the existing `ConductorEventEmitter` boundary into the production runner/coordinator,
   persist engine-owned variants through `.pipeline/events.jsonl`, and append standalone CLI
   variants through the already-approved `.pipeline/pipeline-events.jsonl` writer. Add no event
   type, timestamp sidecar, poller, ledger, or reader.
4. Re-run the focused suites; confirm GREEN, exactly-once occurrence counts, timestamp-merged reader
   visibility, and no duplicate persistence of external-process events.
5. Commit `fix(events): connect build review occurrences to the event spine` with trailer
   `Task: rem-build-review-4`.

### Task rem-build-review-5: Treat skips as neutral coverage with a judged-work floor

**Story:** 3
**Story:** 7
**Story:** 8
**Story:** 21
**Type:** negative
**Files:** `src/conductor/src/engine/build-review-aggregate.ts`, `src/conductor/test/engine/build-review-aggregate.test.ts`
**Dependencies:** Tasks 27, 28

1. Replace the current skip-as-failure expectations with a failing exhaustive truth table: one or
   more clean judged rubrics plus disabled/missing-entry skips passes; skips increment neither
   legacy failed-rubric flags nor judged failure counts; zero judged results cannot pass; any
   infrastructure failure or unresolved finding still fails.
2. Run the aggregate suite; confirm RED at `legacyFailure` and the effective reducer's
   `skipped.length === 0` condition.
3. Derive raw/effective verdicts from judged count, unresolved findings, and infrastructure state
   while retaining explicit `coverage`, skip reasons, raw findings, strict parsing, and legacy
   fail-closed compatibility.
4. Re-run the suite; confirm GREEN and raw/effective/coverage fields remain independently
   inspectable without representing a skip as grader PASS.
5. Commit `fix(engine): make build review skips verdict-neutral` with trailer
   `Task: rem-build-review-5`.

### Task rem-build-review-6: Resolve feature dispositions at the live runner boundary

**Story:** 7
**Story:** 11
**Story:** 12
**Story:** 13
**Story:** 16
**Type:** happy
**Files:** `src/conductor/src/engine/build-review-effective.ts`, `src/conductor/src/engine/build-review-aggregate.ts`, `src/conductor/src/engine/build-review-dispositions.ts`, `src/conductor/src/engine/step-runners.ts`, `src/conductor/test/engine/build-review-effective.test.ts`, `src/conductor/test/engine/build-review-aggregate.test.ts`, `src/conductor/test/engine/step-runners.test.ts`
**Dependencies:** Tasks 29, 30; Task rem-build-review-5

1. Write failing tests for a shared engine-owned resolver that canonicalizes the main-repository and
   feature identity, reads only that feature's disposition records under the existing bounded lock,
   applies exact full-payload matches after raw join, and fails closed on missing identity,
   unreadable/foreign state, or invalid aggregates.
2. Run the focused resolver/runner suites; confirm RED because only the CLI currently joins the
   disposition store and the live runner returns `aggregate.verdict`.
3. Implement the shared feature-state resolver and make `runRubricBuildReview` write the unchanged
   raw aggregate but stamp/return success from its effective verdict. Keep accepted findings raw,
   preserve unresolved siblings, and never expose disposition state to rubric prompts or cache keys.
4. Re-run the focused suites; confirm GREEN for wording drift, sibling/new concerns, re-dispatch,
   cross-feature isolation, and state-read failure.
5. Commit `fix(engine): apply dispositions to live build review results` with trailer
   `Task: rem-build-review-6`.

### Task rem-build-review-7: Make completion use the same effective verdict without weakening freshness

**Story:** 7
**Story:** 8
**Story:** 11
**Story:** 13
**Story:** 23
**Type:** negative
**Files:** `src/conductor/src/engine/artifacts.ts`, `src/conductor/src/engine/build-review-effective.ts`, `src/conductor/test/engine/build-review-verdict.test.ts`, `src/conductor/test/engine/gate-code-validity.test.ts`
**Dependencies:** Task rem-build-review-6

1. Write failing completion-predicate cases where a fresh raw FAIL with one exactly accepted finding
   completes, an unresolved sibling or infrastructure failure remains a named-route failure, a
   clean judged-plus-skip aggregate completes, and missing/malformed/stale/legacy evidence cannot
   gain disposition-aware PASS.
2. Run the two focused gate suites; confirm RED because validation and completion currently branch
   on the aggregate's raw top-level verdict.
3. Join the shared feature-state resolver only for strict current fan-out aggregates after existing
   mtime/code-stamp checks. Derive failure text from unresolved/infrastructure state so accepted
   findings are inspectable but no longer reported as blockers; leave scalar legacy behavior intact.
4. Re-run the focused suites; confirm GREEN and prove runner success, completion satisfaction, and
   emitted effective outer verdict agree for the same artifact/state pair.
5. Commit `fix(engine): complete build review from effective verdict` with trailer
   `Task: rem-build-review-7`.

### Task rem-build-review-8: Prove the repaired production composition through faithful fakes

**Story:** 1
**Story:** 2
**Story:** 3
**Story:** 5
**Story:** 7
**Story:** 8
**Story:** 11
**Story:** 12
**Story:** 13
**Story:** 16
**Story:** 18
**Story:** 20
**Story:** 21
**Story:** 22
**Story:** 23
**Story:** 25
**Type:** integration
**Files:** `src/conductor/test/acceptance/build-review-rubric-fanout-and-dispositions.acceptance.test.ts`, `src/conductor/test/acceptance/build-review-repeats-aggregate-verification-despit.acceptance.test.ts`
**Dependencies:** Tasks rem-build-review-1 through rem-build-review-7

1. Add request-level acceptance scenarios that use the real `DefaultStepRunner`, real coordinator,
   real artifact/cache/disposition stores, real completion predicate, and real event persister with
   fake provider runtimes and isolated temporary repositories.
2. Prove RED for absent-config default-five dispatch, mixed provider/skill policy, cold-to-hit cache
   rematerialization, neutral skips, one accepted finding converging on the next recomputation,
   unresolved/infrastructure blocking, persisted events/metrics, and legacy scalar evidence.
3. Complete only composition wiring missed by Tasks rem-build-review-1 through rem-build-review-7;
   do not add a provider call, event schema, state file, or behavior outside the approved stories.
4. Re-run the two named acceptance files; confirm GREEN, zero real LLM/GitHub/network calls, no live
   checkout mutation, bounded workers, and byte-valid current-lap artifacts.
5. Commit `test(acceptance): prove repaired build review production wiring` with trailer
   `Task: rem-build-review-8`.

### Task rem-build-review-9: Carry landed operator-reseal evidence into the Scope branch

**Story:** 1
**Story:** 6
**Type:** integration
**Files:** `src/conductor/src/engine/build-review-inputs.ts`, `src/conductor/src/engine/build-review-projections.ts`, `skills/build-review-scope/SKILL.md`, `src/conductor/test/engine/build-review-inputs.test.ts`, `src/conductor/test/engine/build-review-projections.test.ts`, `src/conductor/test/engine/build-review-rubric-skills.test.ts`, `src/conductor/test/acceptance/an-operator-s-protected-artifact-reseal-is-invisib.acceptance.test.ts`, `src/conductor/test/acceptance/build-review-rubric-fanout-and-dispositions.acceptance.test.ts`
**Dependencies:** Tasks 12, 13; Tasks rem-build-review-1, rem-build-review-2

1. After the engine-owned rebase supplies #1556, write failing tests that assemble current-proof
   inputs with and without operator reseals; assert the immutable snapshot and Scope projection
   carry the exact filtered paths, verbatim rationale, and commit range while the other four
   projections contain none of that authority.
2. Add failing digest/parser and skill-contract cases: any Scope-visible reseal change invalidates
   the projection, absent or unusable seals remain an empty channel, unknown/machinery triggers
   never enter it, and the Scope instructions require judging the rationale without exempting
   unmatched paths or weakening another rubric.
3. Run the named unit and acceptance suites; confirm RED because #1556 currently terminates at
   `BuildReviewInputs`/`buildGraderPrompt`, while the fan-out snapshot, closed Scope projection, and
   Scope skill omit its evidence and #1556's assembly fixtures do not supply the new current-suite
   proof precondition.
4. Freeze the landed `operatorReseals` field into the source snapshot, add it only to the exact-key
   Scope projection/digest/parser, update the registered Scope skill contract, and adapt #1556's
   fixtures to the existing proof boundary. Keep the legacy prompt contract green without using it
   as the production fan-out route.
5. Re-run the focused suites; confirm GREEN for populated/empty/instruction-shaped rationales,
   named-path isolation, changed-evidence cache invalidation, and real `DefaultStepRunner` fan-out
   with faithful provider fakes. Commit `fix(build-review): preserve reseal evidence in scope fan-out`
   with trailer `Task: rem-build-review-9`.

## Story Coverage

| Story | Primary tasks |
|---:|---|
| 1 | 4-11, 20, 23, 27, 40, rem-build-review-2, rem-build-review-8, rem-build-review-9 |
| 2 | 1, 3, 20, 21, 23, 40, rem-build-review-2, rem-build-review-8 |
| 3 | 1, 2, 8, 9, 22, 40, rem-build-review-5, rem-build-review-8 |
| 4 | 2, 22, 40 |
| 5 | 1-4, 10, 21, 23, 40, rem-build-review-2, rem-build-review-8 |
| 6 | 12, 13, 18, 23, 24, 40, rem-build-review-2, rem-build-review-3, rem-build-review-9 |
| 7 | 11, 22, 27, 28, 30, 40, rem-build-review-5 through rem-build-review-8 |
| 8 | 11, 16, 19, 21, 24, 26-28, 40, rem-build-review-3, rem-build-review-5, rem-build-review-7, rem-build-review-8 |
| 9 | 5-9, 11, 25, 26, 40 |
| 10 | 31, 40 |
| 11 | 30, 32, 40, rem-build-review-6 through rem-build-review-8 |
| 12 | 13, 25, 30, 40, rem-build-review-6, rem-build-review-8 |
| 13 | 13, 19, 25, 26, 30, 40, rem-build-review-6 through rem-build-review-8 |
| 14 | 29, 31, 33, 40 |
| 15 | 32, 33, 40 |
| 16 | 17, 29, 30, 32, 40, rem-build-review-6, rem-build-review-8 |
| 17 | 29, 32, 33, 40 |
| 18 | 34-37, 40, rem-build-review-4, rem-build-review-8 |
| 19 | 38, 39, 40 |
| 20 | 34-37, 40, rem-build-review-4, rem-build-review-8 |
| 21 | 22, 27, 34, 36, 37, 40, rem-build-review-4, rem-build-review-5, rem-build-review-8 |
| 22 | 1-3, 10, 22, 40, rem-build-review-1, rem-build-review-8 |
| 23 | 12, 22, 28, 40, rem-build-review-1, rem-build-review-7, rem-build-review-8 |
| 24 | 5, 12, 14-16, 23, 40 |
| 25 | 4, 13, 17-19, 22, 23, 28, 34, 36, 40, rem-build-review-3, rem-build-review-8 |

## Dependency and Batch Boundaries

- **Batch 1 — contracts:** Tasks 1-13. Review config compatibility, skill placement, domain types,
  and projection completeness before execution work.
- **Batch 2 — deterministic execution:** Tasks 14-24. Review checkout isolation, resource cleanup,
  cache soundness, group-core reuse, and write-disjoint artifacts before state mutation.
- **Batch 3 — identity and operator state:** Tasks 25-33. Review collision safety, raw/effective
  separation, lock atomicity, TTY/machine identity, and stale-lap races before observability.
- **Batch 4 — observability and publication:** Tasks 34-40. Review event-spine reuse, metric
  denominators, accepted-risk parity, and full fake-boundary acceptance evidence.
- **Batch 5 — post-BUILD production repair:** Tasks rem-build-review-1 through
  rem-build-review-9. Review resolved-default routing, auxiliary provider/skill policy, durable
  branch/cache effects, one-spine emission, skip truth table, disposition-aware runner/completion
  parity, Scope-only operator-reseal evidence, and faithful production-path acceptance evidence
  before resuming BUILD.
- Re-run the advisory overlap scan before BUILD and at each batch boundary because active branches
  overlap shared config, group, event, and finish surfaces.
- Run the repository-required `test/test_harness_integrity.sh` before every implementation commit as
  an external commit gate, not as a terminal catch-all plan task.

## Post-Amendment Architecture Re-review

**Date:** 2026-08-14
**Verdict:** APPROVED

The remediation remains inside the approved architecture. It connects the already-resolved rubric
policy to the existing provider-aware auxiliary boundary, makes the existing branch/cache state
writers and `ConductorEvent` variants production-reachable, and makes the existing post-judgement
reducer authoritative at both lifecycle consumers. The component diagram already shows these exact
dependencies and its outer-verdict label already states the neutral-skip/judged-floor rule, so this
implementation repair requires no diagram change, new ADR, supersession, or architecture-review
marker. The event-spine verdict remains one schema and reader path: engine occurrences use the
normal emitter/persister; the standalone CLI retains the already-approved same-schema sibling
ledger under exceptions A/B.

The post-#1556 composition check is also APPROVED. It adds one field to an already-approved frozen
projection boundary and follows `adr-2026-08-12-operator-reseal-as-second-scope-justification`'s
existing evidence semantics. No component, persistence surface, event, provider seam, or lifecycle
edge changes, so the current diagrams and ADR set remain accurate.

## Remediation Verify-Claims Ledger

- **99% verified:** an absent raw `build_review` block resolves five enabled rubrics but currently
  falls through to the scalar grader; source basis is the resolver and production runner branch at
  amendment time.
- **98% verified:** production dispatch receives registry skill names and full rubric policies but
  currently invokes one shared provider with a generic prompt; source basis is the registry,
  coordinator, provider executor, and runner.
- **97% verified:** branch/cache writers exist but the live coordinator only reads cache and the
  runner writes only the aggregate; source basis is the coordinator, cache/artifact modules, and
  runner.
- **100% verified:** build-review event variants and consumers exist without a production emitter,
  and engine sink declarations disable their persistence; source basis is the event union, sink
  table, runner/CLI, and rollup readers.
- **99% verified:** skips are currently classified as legacy failures and block the effective
  reducer even when valid judged work is clean; source basis is the aggregate reducer and its truth
  table tests.
- **99% verified:** only CLI inspection applies accepted dispositions; live runner success and the
  completion predicate branch on the raw aggregate verdict; source basis is the aggregate, CLI,
  runner, and artifact predicate.
- **100% verified:** merged #1556 reads operator reseals into `BuildReviewInputs` and renders them in
  `buildGraderPrompt`, while #1563's production fan-out Scope projection and registered Scope skill
  have no reseal field or rationale rule; source basis is merge `bdd239ac7`, the projection exact-key
  parser, the Scope skill contract, and the runner's scalar/fan-out branch.
- **Assumptions:** none. Every remediation claim is directly reproducible from the feature head, and
  the accepted PRD/stories/ADRs already decide the intended behavior.

## Post-Plan Overlap Scan

`conduct-ts overlap-scan` completed on 2026-08-13 over the exact union of the original 40 task `**Files:**`
entries. It reported advisory overlap with 30 unmerged spec branches. The first reported branches
were `spec/647-kickback-evidence-invalidation`, `spec/651-park-all-dispatch-paths`,
`spec/7b-adr-approved-before-writing-system-tests-is-onl`,
`spec/a-successful-finish-publication-transition-consume`, and the active acceptance-specs family.
The overlap is concentrated in intentionally narrow integration surfaces—config, `group-core`,
events, CLI, finish/shipped publication, and existing build-review acceptance tests—while the
rubric domain, projection, preflight, cache, identity, and disposition modules are new isolated
paths. The scan is advisory; batch-boundary rescans and narrow shared-file commits are binding.

The 2026-08-14 advisory rescan completed over the exact union of all 49 retained and remediation
tasks (93 unique paths) with source ref `jstoup111/ai-conductor#1542`. It again reported broad overlap on the
shared engine/CLI/event/test surfaces; the first reported branches were
`spec/647-kickback-evidence-invalidation`, `spec/651-park-all-dispatch-paths`,
`spec/7b-adr-approved-before-writing-system-tests-is-onl`, and
`spec/a-successful-finish-publication-transition-consume`. The result is advisory and introduces no
new requirement conflict; merged #1556 is no longer an active overlap entry. Batch 5 keeps the
shared-file changes dependency-ordered and requires the normal finish-time rebase rather than
widening or deferring the repair.
