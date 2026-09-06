# Implementation Plan: Report the PRD-input gate surface accurately in rebase events

**Date:** 2026-09-06
**Stories:** .docs/stories/report-the-prd-input-gate-surface-accurately-in-re.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the governing post-rebase delta-aware invalidation decision and its 2026-08-22 amendment, which already declare the stories and PRD inputs as part of this gate's dependency surface and require every gate to emit its decision with the delta that justified it.

## Summary

Four bounded tasks deliver #2211 by making one shared per-kind projection the source of both the preserve/invalidate decision and the payload that explains it, then reporting the corrected surface and delta from the rebase gate events. Gate decisions, event field names, the event union, and the delta the engine feeds the classifier are unchanged.

## Technical Approach

The classifier already decides the kind that combines the feature's own runtime source with declared stories and PRD inputs, but the emitter's payload projection does not name that kind: its two conditional chains enumerate three kinds and let everything else fall through to the whole-delta matched set and the broad all-runtime declaration. Rather than adding a fourth branch beside them, move the projection next to the classification it must agree with. Add one exported function in the classifier module that takes the delta and the feature surface and returns, for every gate surface kind, the kind's declared surface and the delta paths that actually hit it. Type its return as a mapped record over the kind union so the compiler rejects a future kind that has no projection; that is the named mechanism behind "cannot silently fall through", not a reviewer's vigilance.

Each kind's projection is the computation the classifier already performs. Feature-runtime matches the feature's own changed runtime paths and declares the feature's runtime surface. Feature-codetest matches those plus the feature's own changed test paths and declares the feature's runtime and test surface. The combined runtime-or-document-input kind matches the feature's own changed runtime paths plus the changed declared document inputs, and declares the feature's runtime surface followed by one declaration entry built from the exported document-input prefix constant, so the declaration text cannot drift from the prefixes the classifier filters on. All-runtime matches the feature's and foreign changed runtime paths; any-code-or-test matches the whole delta. The two whole-tree kinds keep a descriptive declaration because their surface is not a finite path list derivable from this rebase.

With the projection in place, the preserve rule for every existing kind is exactly "this kind's matched path set is empty", so the classifier is re-expressed as that single test and the decisions it produces are unchanged. The emitter then reads both payload fields out of the same projection and keeps its remaining behavior — the uncomputable-surface early return, the pre-verified drift-budget basis, and the ordering of emissions — untouched.

Test design follows the repository's test-authoring rules: the projection and the classification are pure functions tested at unit level with literal path lists, the emitter is tested through its exported function with a real in-process event emitter and no provider, and the resume path keeps its existing local-Git integration as the entry-point proof. No third-party service, network call, or full conductor run is introduced. Comparable fixtures already exist in the classifier unit tests, the emitter unit tests, and the resume integration test; follow their shape — literal deltas and feature surfaces, assertions on collected event objects — and vary only the fixture data. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved the Small scope, the technical track, the shared-projection approach, and both stories on 2026-09-06 (delegated).
- Verified: the classifier module assigns the combined runtime-or-document-input kind to both the PRD audit gate and the coverage-binding gate, and its document-input prefix list and predicate are module-private today.
- Verified: the emitter's matched-path and declared-surface helpers name only the feature-runtime, feature-codetest and all-runtime kinds; every other kind reaches the whole-delta matched set and the broad all-runtime declaration.
- Verified: the classifier's preserve rule for each of the five kinds is exactly "that kind's matched path set is empty", so deriving the decision from the projection changes no decision.
- Verified: the emitter unit test file and the resume-path integration test file each currently assert the broad all-runtime declaration for both PRD-input gates, so both must be corrected with the fix.
- Verified: the classifier module already imports its code-or-test predicate from the rebase module, so adding the projection to the classifier keeps the existing import direction and adds no cycle.
- Verified: the engine hands the classifier the code-or-test-filtered delta, which strips documentation paths, so declared document inputs reach the classifier only from a caller supplying an unfiltered delta, exactly as the existing classifier unit tests do. Widening the production delta is a separate concern and is deliberately not changed here.
- Verified: the engine's TypeScript configuration is strict without unchecked-index access, so a mapped record over the kind union is total and needs no non-null assertion.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: not a channel — two existing event variants keep their names and fields and only carry correct values.
- Verify-claims verdict: CLEAR. No unconfirmed assumption changes the approach or the task breakdown.

## Tasks

### Task 1: Project every gate surface kind once and classify from it
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/gate-invalidation.ts, src/conductor/test/engine/gate-invalidation.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests for a new exported projection function over the delta and the feature surface: one case per gate surface kind asserting its matched paths, and cases asserting the combined runtime-or-document-input kind's declared surface holds the feature's own runtime paths plus a declaration entry derived from the document-input prefixes.
2. Verify RED, then export the document-input prefix constant and a selector returning the delta's declared document inputs, and implement the projection as a mapped record over the kind union so a kind with no entry cannot compile.
3. Re-express the classifier so each gate is preserved exactly when its kind's projected matched paths are empty, leaving the gate map, the delta partition, the feature-test selector, and the manual-test participation rule untouched.
4. Run the narrowest test invocation for this file and the typecheck target that covers test files, then commit the focused change.

**Done when:**
1. The projection returns one entry per gate surface kind, keyed by the kind union, so a future kind without an entry fails the typecheck rather than borrowing another kind's payload.
2. The combined runtime-or-document-input kind projects matched paths equal to the feature's own changed runtime paths plus the changed declared document inputs, and nothing else.
3. That kind's declared surface is the feature's own runtime paths followed by one declaration entry built from the exported document-input prefix constant.
4. Every existing classification expectation across the delta matrix passes unchanged, and each gate is preserved exactly when its kind's projected matched paths are empty.

### Task 2: Emit the projected surface and delta from the rebase gate events
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/rebase.ts, src/conductor/test/engine/rebase.test.ts
**Dependencies:** 1

**Steps:**
1. Correct the existing emitter unit expectations for the foreign-only runtime fixture so both PRD-input gates expect a declared surface of the feature's own runtime path plus the document-input declaration and an empty considered delta, and verify RED.
2. Add an emitter fixture whose delta changes a declared stories input and a PRD input alongside a foreign runtime path, expecting both PRD-input gates invalidated with matched paths limited to the changed document inputs and the feature's own changed runtime paths.
3. Implement by replacing the emitter's two conditional projections with lookups into the shared projection, removing the now-unused local partition and surface computations and their imports, and correcting the function's contract comment, which still lists the PRD audit gate under the feature-runtime kind.
4. Run the narrowest test invocation for the emitter file and the typecheck target that covers test files, then commit.

**Done when:**
1. Both payload fields are read from the shared projection and no conditional chain enumerating gate surface kinds remains in the emitter.
2. For a foreign-only runtime delta both PRD-input gates emit a declared surface holding the feature's own runtime path and the document-input declaration, with an empty considered delta.
3. For a delta changing a declared stories or PRD input both PRD-input gates emit invalidated with matched paths limited to those changed inputs and the feature's own changed runtime paths.
4. The emitter's contract comment describes each gate surface kind's projection as implemented, and lists no gate under a kind it no longer carries.

### Task 3: Prove no kind borrows another kind's explanation
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/gate-invalidation.test.ts, src/conductor/test/engine/rebase.test.ts
**Dependencies:** 2

**Steps:**
1. Add a unit test that derives the kind set from the gate surface map itself and asserts the projection's key set equals it, so a kind reachable from the map can never lack its own entry.
2. Add an emitter test over a five-fixture delta matrix — feature runtime only, foreign runtime only, feature test only, declared document input, and an empty delta — asserting every preserved event carries an empty considered delta and every invalidated event carries non-empty matched paths.
3. Add the negative fixture combining a foreign runtime path with a document path outside the declared input prefixes, asserting that neither path appears in a PRD-input gate's considered delta or matched paths and that both gates stay preserved.
4. Run both focused test files together with the typecheck target that covers test files, then commit.

**Done when:**
1. The projection's key set is asserted equal to the kind set derived from the gate surface map, not to a hand-written list.
2. Across the five-fixture delta matrix every preserved event carries an empty considered delta and every invalidated event carries non-empty matched paths.
3. A document path outside the declared input prefixes appears in no PRD-input gate's considered delta or matched paths, and leaves both gates preserved.

### Task 4: Keep resume-path and drift-budget preservation payloads correct
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/test/engine/daemon-rekick.test.ts, src/conductor/test/engine/rebase.test.ts
**Dependencies:** 2

**Steps:**
1. Correct the resume-path integration expectations so both PRD-input gates observe the feature's own runtime paths plus the document-input declaration and an empty considered delta for that fixture's foreign sibling runtime change, keeping the existing invalidated-gate expectations as they are.
2. Re-run the drift-budget preservation case and the uncomputable-feature-surface case, and assert explicitly that the drift-budget preserved event still carries its basis while an ordinary delta-based preservation carries none.
3. Run both focused test files and the typecheck target that covers test files, then commit.

**Done when:**
1. The resume integration observes both PRD-input gates preserved through the real event emitter with the feature's own runtime paths and the document-input declaration, and an empty considered delta.
2. The drift-budget preserved event still carries its basis while ordinary delta-based preservation carries none, and the uncomputable-feature-surface path still emits only the pre-verified preservation with its uncomputable declaration.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a delta that touches only foreign runtime source while the feature owns other runtime source, when the preserved events are emitted, then each PRD-input gate's declared surface names the feature's own runtime paths together with a single declaration of the stories and PRD document inputs, and never the broad all-runtime declaration. | 2 | "For a foreign-only runtime delta both PRD-input gates emit a declared surface holding the feature's own runtime path and the document-input declaration, with an empty considered delta." | diff-local |
| Story 1 happy: Given that same foreign-only delta, when the preserved events are emitted, then each PRD-input gate's considered delta is empty. | 2 | "For a foreign-only runtime delta both PRD-input gates emit a declared surface holding the feature's own runtime path and the document-input declaration, with an empty considered delta." | diff-local |
| Story 1 happy: Given a delta that changes a declared stories or PRD document input, when the invalidated events are emitted, then that PRD-input gate's matched paths are exactly the changed document inputs and the feature's own changed runtime paths. | 2 | "For a delta changing a declared stories or PRD input both PRD-input gates emit invalidated with matched paths limited to those changed inputs and the feature's own changed runtime paths." | diff-local |
| Story 1 negative: Given a delta carrying a foreign runtime path and a document path outside the declared stories and PRD input prefixes, when the preserved events are emitted, then neither path appears in a PRD-input gate's considered delta. | 3 | "A document path outside the declared input prefixes appears in no PRD-input gate's considered delta or matched paths, and leaves both gates preserved." | diff-local |
| Story 2 happy: Given the gate surface map assigns a kind to each judged gate, when payloads are projected, then every kind the map uses has its own declared surface and matched paths rather than a shared fallback. | 1, 3 | "The projection's key set is asserted equal to the kind set derived from the gate surface map, not to a hand-written list." | diff-local |
| Story 2 happy: Given a test-suite verdict preserved within its drift budget, when its preserved event is emitted, then the event still carries the drift-budget basis and stays distinguishable from an ordinary delta-based preservation. | 4 | "The drift-budget preserved event still carries its basis while ordinary delta-based preservation carries none, and the uncomputable-feature-surface path still emits only the pre-verified preservation with its uncomputable declaration." | diff-local |
| Story 2 negative: Given a delta matrix covering feature runtime, foreign runtime, feature test, document input, and empty deltas, when gates are classified and their payloads projected, then every preserved gate reports an empty considered delta, every invalidated gate reports non-empty matched paths, and each gate's preserve or invalidate decision is the one the classifier produced before this change. | 1, 3 | "Across the five-fixture delta matrix every preserved event carries an empty considered delta and every invalidated event carries non-empty matched paths." | diff-local |
| Story 2 negative: Given a rebase outcome whose feature surface is uncomputable, when the emitter runs, then it still emits only the pre-verified preservation with its uncomputable declaration and invents no classification-derived payload. | 4 | "The drift-budget preserved event still carries its basis while ordinary delta-based preservation carries none, and the uncomputable-feature-surface path still emits only the pre-verified preservation with its uncomputable declaration." | diff-local |

## Test dispositions and integration ownership

All criteria are diff-local against literal in-memory fixtures. Task 1 owns unit coverage of the shared projection and of the classification derived from it, including the unchanged-decision matrix. Task 2 owns the emitter's payload coverage for both PRD-input gates on the preserved and invalidated sides. Task 3 owns the drift-proofing assertions and the out-of-prefix negative case, grouped with the matrix because one focused emitter test can carry several compatible criteria. Task 4 owns the cross-boundary integration proof: the resume path exercises the real rebase, classification, projection, and emitter through the engine's own entry point with a local Git fixture and a real in-process event emitter, so it proves the corrected payloads actually reach the spine rather than only the helper. No third-party service is contacted at any level, no full conductor run is added, and no terminal validation task exists.

## Task Dependency Graph

Task 1 -> Task 2
Task 2 -> Task 3
Task 2 -> Task 4

Small tier: architecture, conflict-check, and coherence artifacts are skipped. No new architecture decision record or amendment is required: the governing decision already declares this gate's stories and PRD inputs and already requires each gate to emit its decision with the justifying delta, which is precisely what this change makes true.
