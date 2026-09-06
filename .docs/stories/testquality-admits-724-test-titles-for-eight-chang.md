**Status:** Accepted

# Stories: Accurate test-quality scope (#2231)

Technical track. Source: operator-approved comprehensive engine scope, including refactors with no test edits. Architecture: adr-2026-09-06-engine-owned-test-quality-scope. Priorities: accuracy, token usage, execution speed.

## Story 1: Accurate directly changed test selection

As an operator, I want changed tests distinguished from unchanged siblings so review attention follows the actual change.

### Acceptance Criteria

#### Happy Path
- Given a file containing many unchanged tests and one added or modified test, when scope is assembled, then the changed declaration is identified separately and unchanged sibling titles are absent from the directly changed target list
- Given a test declaration whose arguments or assertion body changed while its title stayed the same, when base and HEAD are compared, then the changed declaration is identified
- Given two tests with identical titles where only one body changed, when scope and finding references are produced, then the changed occurrence remains distinguishable from its unchanged sibling

#### Negative Paths
- Given a test is only moved or renamed without changing behavior or binding, when scope is assembled, then the move alone creates no quality target or finding
- Given a deleted test or deleted source path, when scope is assembled, then it is not represented as an executable HEAD test and the change remains available as evidence
- Given unrelated tests arrive through a newer merge-base, when the feature diff is reviewed, then those tests do not become feature-owned changed targets

### Done When
- [ ] The many-sibling fixture reports the exact changed declaration set, including same-title edits and duplicate occurrences.
- [ ] Pure movement and deletion fixtures produce no fictitious executable HEAD target.


## Story 2: Test-local behavior binding

As an operator, I want each reviewed test tied to its actual approved behavior so another test cannot lend it authority.

### Acceptance Criteria

#### Happy Path
- Given a changed test with an attached valid story-criterion or task Covers marker, when review scope is assembled, then that test carries the matching obligation and marker provenance
- Given a suite declares a valid Covers marker, when a descendant test changes, then the descendant may inherit that marker while tests outside the suite do not
- Given an otherwise unchanged declaration whose Covers marker changes or is removed, when scope is assembled, then the changed association is visible and previous binding authority is not silently reused

#### Negative Paths
- Given a marker occurs only on a sibling test, when another test changes, then the changed test cannot inherit that sibling marker
- Given an absent-feature obligation id or a test with no applicable marker, when scope is assembled, then it is explicitly out of scope with the appropriate note and no invented obligation or demand for a new test
- Given competing or file-header marker associations cannot be established, when a concrete changed candidate is reviewed, then the ambiguity remains explicit until source-based judgment resolves it

### Done When
- [ ] Target evidence identifies the approved obligation and actual marker source.
- [ ] Negative binding fixtures reject sibling and foreign-feature authority while preserving explicit notes.


## Story 3: Shared changes retain relevant evidence

As a reviewer, I want relevant shared setup and helper changes available without being told every descendant test body changed.

### Acceptance Criteria

#### Happy Path
- Given changed setup encloses opted-in tests whose bodies are unchanged, when scope is assembled, then a concrete affected group and its setup evidence are available separately from directly changed test declarations
- Given an existing opted-in test named by the active plan reaches a changed project-local helper, when scope is assembled, then the concrete dependency effect is presented for relevance judgment even when the test file is unchanged
- Given multiple candidates share setup or a helper, when the reviewer receives its input, then shared evidence is available once by pinned reference rather than repeated as every unchanged sibling title

#### Negative Paths
- Given a plan merely names a test file but no applicable marker or concrete changed dependency is established, when scope is assembled, then the path alone confers no review authority
- Given a local dependency cycle, when evidence is collected, then collection terminates without duplicate unbounded traversal
- Given only a hypothetical unknown dependency could connect a production refactor to tests, when scope is assembled, then that possibility alone creates no candidate or scope failure

### Done When
- [ ] Shared-setup and plan-seeded helper fixtures identify concrete affected groups and distinguish them from directly changed bodies.
- [ ] Cycle and shared-reference fixtures demonstrate termination and deduplicated source evidence.


## Story 4: Refactors remain a valid empty-scope pass

As an operator, I want refactors that need no test edits to complete without a fabricated coverage requirement.

### Acceptance Criteria

#### Happy Path
- Given a production-only refactor with no test edits or concrete affected opted-in candidate, when enabled test-quality review runs, then it passes with an explicit empty-scope reason and invokes neither reviewer nor counterfactual preflight
- Given tests were moved without changing their behavior or binding and no other candidate exists, when enabled test-quality review runs, then it passes empty scope without demanding markers, new tests or a waiver
- Given the rubric is disabled, when review runs, then its analysis-driven reviewer/preflight work is not dispatched and existing disabled behavior is preserved

#### Negative Paths
- Given no test paths are named in the plan, when a production-only refactor is reviewed, then absence of planned tests alone does not produce incomplete scope
- Given a concretely identified candidate remains unresolved, when the engine considers empty-scope completion, then it does not substitute an empty-scope PASS for that candidate
- Given review scope is empty or narrower than the test suite, when configured regression verification runs, then review scope does not narrow or bypass that verification

### Done When
- [ ] A refactor integration fixture asserts PASS plus zero reviewer and zero preflight calls.
- [ ] The configured regression execution boundary receives its existing selection independent of empty review scope.


## Story 5: Ambiguous syntax uses the existing reviewer

As an operator, I want concrete uncertain candidates resolved from source without adding a routine model call or silently dropping them.

### Acceptance Criteria

#### Happy Path
- Given an opted-in changed candidate uses unsupported language or dynamic declaration syntax, when the existing reviewer reads its pinned evidence, then it can return a concrete in-scope resolution and quality judgment in that same call
- Given the reviewer establishes that a concrete candidate is unrelated or unchanged, when it returns an out-of-scope disposition with evidence, then that candidate is excluded and an otherwise empty result may pass with its reason recorded
- Given a routine fully established target set, when review runs successfully, then no separate scope-review provider session is required

#### Negative Paths
- Given a result omits or duplicates a required candidate resolution, when the engine validates it, then it rejects the result through bounded malformed-result handling rather than passing or creating a bad-test finding
- Given a proposed candidate resolution cites a foreign obligation, absent source region or unrelated sibling, when validated, then that proposed authority and any finding relying on it are rejected
- Given unsupported syntax exists without a concrete opted-in candidate, when scope is assessed, then unsupported syntax alone does not create a halt or review requirement

### Done When
- [ ] A fake-provider integration resolves an unsupported candidate and validates the quality result with one ordinary dispatch.
- [ ] Result-boundary negative fixtures reject missing/duplicate dispositions and invalid source or obligation authority.


## Story 6: Indeterminate candidates have cause-specific recovery

As an operator, I want a specific recoverable explanation when an actual candidate cannot be resolved, while refactors without candidates remain unaffected.

### Acceptance Criteria

#### Happy Path
- Given a reviewer remains indeterminate about a concrete candidate, when the result is settled, then it identifies that candidate, its marker/obligation evidence and what clarification is needed through the bounded scope-incomplete path
- Given the operator supplies an authorized binding or source-evidence correction, when review reruns against the corrected evidence, then scope is recomputed and the previous indeterminacy does not force a permanent halt
- Given the operator explicitly accepts reduced coverage for scope-incomplete with identity and rationale, when effective review status is computed, then the accepted limitation remains visibly attributed

#### Negative Paths
- Given a pinned source read or provider call fails, when existing bounded retries are exhausted, then the failure is reported as unavailable evidence rather than an empty file, new test requirement or insensitive-test finding
- Given unchanged indeterminacy is returned again, when recovery is evaluated, then it does not create an unbounded new retry loop or append speculative implementation tasks
- Given no authorized reduced-coverage decision exists, when an indeterminate candidate remains, then ordinary PASS is not emitted; absence of tests or markers alone never enters this path

### Done When
- [ ] The persisted result and event identify the specific unresolved candidate and recovery cause.
- [ ] Recovery tests show corrected evidence can clear the condition and an explicit waiver remains visibly attributed.


## Story 7: Frozen scope and compatible cache reuse

As an operator, I want cached and fresh judgments to use the same source-bound scope without invalidating unrelated accepted findings.

### Acceptance Criteria

#### Happy Path
- Given source assembly has pinned base, HEAD and approved feature artifacts, when mutable worktree content changes afterward, then the already frozen scope and binding evidence remain unchanged
- Given an identical current projection and policy are reviewed again, when a cache entry is reused, then its candidate resolutions and findings are validated against current reference authority
- Given a previous disposition has the same supported result-v3 finding identity, when storage is read after the input upgrade, then it remains readable without an automatic identity migration

#### Negative Paths
- Given a projection-v2 cache entry, when the projection-v3 engine looks it up, then it misses safely and is not treated as malformed disposition storage
- Given a binding, referenced helper/setup source or analysis contract changes, when cache lookup occurs, then stale scope judgment cannot be reused
- Given a cached or fresh result uses a coarse fallback anchor to claim an unrelated sibling, when current scope authority is validated, then it is rejected despite matching a file-level identity

### Done When
- [ ] Fresh and cache-hit integration paths reject the same out-of-scope anchors.
- [ ] Legacy-cache and disposition fixtures distinguish a safe cache miss from readable existing acceptance records.


## Story 8: Installed precision analysis and safe source handling

As a harness consumer, I want the scope analyzer to work in the installed engine without executing my project during analysis.

### Acceptance Criteria

#### Happy Path
- Given an installed production engine without development dependencies, when a supported JavaScript/TypeScript candidate is analyzed, then precision analysis is available
- Given a supported source path was renamed or contains spaces, when source identities and changes are read, then the correct pinned sources are associated without splitting the path
- Given several candidates reference the same source blob, when scope is assembled, then that blob is retrieved at most once per identity in that assembly

#### Negative Paths
- Given consumer source contains executable top-level side effects, when analysis reads it, then those side effects are never executed
- Given a source reference escapes the repository boundary or names unavailable pinned content, when resolved, then it is rejected or reported unavailable rather than reading unrelated host files or substituting live content
- Given an applicable parser cannot load or source cannot be safely parsed for a concrete candidate, when analysis handles it, then the limitation remains explicit and cannot manufacture verified targets or an empty pass

### Done When
- [ ] A production-packaging check imports and exercises supported analysis without relying on a development-only parser.
- [ ] Source-access tests demonstrate exact path handling, memoized identities and no consumer-code execution.


## Story 9: Reproducible scope and honest efficiency evidence

As an operator, I want the reported defect reproduced and improvements measured without sacrificing accuracy or calling paid services in normal tests.

### Acceptance Criteria

#### Happy Path
- Given the frozen 724-title case, when the new analysis runs, then it identifies eight directly added/modified test bodies and separately explains their actual binding dispositions rather than claiming eight authorized targets
- Given increasingly many unrelated unchanged sibling declarations around the same changed tests, when projections are compared, then the changed-target list stays fixed and unrelated sibling titles do not inflate reviewer input
- Given old and new analysis run against the same portable fixtures, when comparison results are reported, then they identify source-read counts, projection bytes, target/candidate counts, model-call counts and analysis elapsed time

#### Negative Paths
- Given retained local daemon artifacts or the original feature commits are absent in CI, when ordinary verification runs, then portable fixtures still prove scope selection and no GitHub download is needed
- Given difficult shared or ambiguous candidates require more context, when optimization is assessed, then they are not dropped merely to improve input size or elapsed time
- Given no real-provider comparison was run, when results are reported, then projection bytes are not claimed as measured total tokens or end-to-end latency savings and ordinary tests call no third-party service

### Done When
- [ ] The portable regression fixture has an explicit directly changed set and binding-disposition expectation.
- [ ] The comparison records deterministic counts/bytes separately from measured timing and any optional real-provider smoke evidence.


## Negative-category assessment

Invalid input, source permissions/boundaries, dependency unavailability, partial failures, source immutability, duplicate identity and alternate early-return evidence are covered above. Provider timeout and process outcomes retain existing bounded handling with fake adapters at the affected review boundary. Resource risks are covered by dependency-cycle termination and deduplicated reads; no new concurrent writer or retry loop is introduced. No database entity, cascade delete, payment/authentication endpoint or exception hierarchy is introduced. Test runtime is not increased through real waits or live third-party calls.

## Verify-Claims Ledger

Story expectations derive from the approved architecture and the operator's explicit refactor correction. The retained replay demonstrates eight changed bodies, not eight approved bindings; expected binding dispositions must be derived from its actual feature artifacts. Source selection/identity behaviors are verified in the current assembly/coordinator/cache seams. No assertion assumes complete static discovery or measured savings. Verdict: CLEAR for operator acceptance review.
