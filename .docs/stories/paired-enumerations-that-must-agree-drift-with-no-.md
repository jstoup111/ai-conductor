**Status:** Accepted

# Stories: paired-enumerations-that-must-agree-drift-with-no-

Source: jstoup111/ai-conductor#1833. Technical track, Tier S. Scope boundary (binding, from
`.docs/track/`): mechanism + seed pairs only — no repo-wide sweep of every "keep in sync" site.

## Story 1: Declared matched-pair registry

**Requirement:** A reader can enumerate every registered matched pair in one place, and each pair's
verification mode is a first-class, reviewable declaration.

As a maintainer, I want every matched pair declared in one typed registry so that I can register a
new pair, retire an obsolete one, and see at a glance which pairs are checked and which are
collapsed into a single source.

### Acceptance Criteria

#### Happy Path
- Given the registry module, when a maintainer reads it, then every registered pair appears as one entry naming both sides (file plus enumeration identity for each side) and its verification mode
- Given a pair collapsed into a single source, when it is declared with mode `satisfied-by-derivation`, then the declaration carries a non-empty reason and a tracked reference, mirroring the config-key registry's negative-declaration grammar (adr-2026-08-26, adr-2026-07-12)
- Given the registry's pair-id key space, when an entry is removed without removing the id from the key space (or vice versa), then TypeScript compilation fails — totality is type-level, not runtime (adr-2026-07-26)

#### Negative Paths
- Given a registry entry with mode `satisfied-by-derivation` and an empty or missing reason or reference, when the checks run, then that entry fails with a message naming the pair id and the missing declaration field
- Given a registry placed anywhere under `.docs/` or `docs/`, when this feature lands, then that placement does not exist — the registry lives under `src/conductor/` so BUILD-phase edits are not blocked by the docs write-guard (adr-2026-07-22) and edits invalidate gates as runtime source (adr-2026-08-13)

### Done When
- [ ] A registry module exists under `src/conductor/src/` exporting the pair declarations as a total typed `Record` keyed by pair id
- [ ] Each entry declares both sides and a mode of `checked` or `satisfied-by-derivation`; the derivation mode's type requires a non-empty `reason` and a tracked `ref`
- [ ] Removing an entry from the record without shrinking the key union fails `tsc` for the conductor package

## Story 2: Agreement check fails one-sided edits at the moment they are made

**Requirement:** A change that edits one side of a registered pair fails a default-suite check
naming both sides, before any audit lap.

As a maintainer, I want an edit to one side of a registered pair to fail a hermetic default-suite
test immediately so that paired-enumeration drift cannot reach a green build.

### Acceptance Criteria

#### Happy Path
- Given a registered `checked` pair whose two sides agree, when the structural test suite runs, then the pair reports pass
- Given a registered `satisfied-by-derivation` pair, when the structural test suite runs, then the test verifies the derivation link actually resolves (the deriving side reaches the source side) and reports the pair satisfied without comparing member lists
- Given the check, when it runs in the default suite, then it needs no network, credential, or spend, and TS sources are analyzed via the TypeScript compiler API in `src/conductor/test/structural/`, not by grep over source text (adr-2026-08-07)

#### Negative Paths
- Given a registered `checked` pair, when a value is added to one side only, then the test fails with a message naming the pair id and both sides' locations and the differing members, distinctly per pair (adr-2026-06-30)
- Given a registered pair, when extraction of either side yields zero members, then the test FAILS naming the empty side — an empty extraction is never a pass (adr-2026-08-01)
- Given a registered `satisfied-by-derivation` pair, when the derivation link no longer resolves (the import or reference from deriving side to source side is gone), then the test fails naming the pair id and the broken link

### Done When
- [ ] A structural test under `src/conductor/test/structural/` iterates every registry entry and verifies `checked` pairs agree and `satisfied-by-derivation` links resolve
- [ ] The test runs in the conductor package's default test suite with no external service, matching the existing structural-guard harness
- [ ] A deliberate one-sided fixture mutation (test-local) produces a failure message containing the pair id and both side locations
- [ ] Zero-member extraction on either side is asserted to fail via a test-local fixture
- [ ] Check 25 (`test/check_build_review_rubric_skill_vocabularies.sh`) is left as the owner of the SKILL.md↔engine vocabulary pair; the registry references it rather than duplicating that comparison (adr-2026-08-16 D5)

## Story 3: Seed pairs registered and green

**Requirement:** The mechanism ships exercising both modes on real pairs, including the
already-drifted live pair from the source issue's subsystem, and one-sided additions to those pairs
cannot reach a green build.

As a maintainer, I want the known pairs registered at landing so that the #1833 regression class is
closed for them from the first green build.

### Acceptance Criteria

#### Happy Path
- Given the rubric-retirement pair (`DEPRECATED_BUILD_REVIEW_RUBRIC_IDS` in `src/conductor/src/engine/config.ts` and the derived retired set in `src/conductor/src/engine/build-review-dispositions.ts`), when it is registered as `satisfied-by-derivation` citing the import edge, then the structural test verifies the derivation and reports it satisfied
- Given the retired-rubric reason-prefix filter in `src/conductor/src/engine/build-review-aggregate.ts`, when its alternation is derived from `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS` and the pair is registered as `satisfied-by-derivation`, then the structural test verifies the derivation and reports it satisfied — closing by construction the currently drifted state where the hand-written alternation lacks `tautology`
- Given the retired-id enumeration in `docs/reference/configuration.md`'s build_review section and `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS`, when that pair is registered as `checked`, then the docs enumeration and the engine set agree and the test passes

#### Negative Paths
- Given the derived reason-prefix filter, when the derivation link from the aggregate module to the config constant is removed, then the default suite fails naming that pair and the broken link
- Given the registered docs pair, when an id is added to the engine set without updating the `docs/reference/configuration.md` enumeration, then the default suite fails naming that pair and the missing member

### Done When
- [ ] All three seed pairs above are entries in the registry with the stated modes
- [ ] The full conductor default test suite and `test/test_harness_integrity.sh` pass with the seed pairs registered
- [ ] The `build-review-aggregate.ts` reason-prefix alternation is derived from `DEPRECATED_BUILD_REVIEW_RUBRIC_IDS`, so `tautology`-prefixed legacy reasons are filtered and the drift is closed by construction
- [ ] Locally removing one member from one side of the docs `checked` pair makes the structural test fail before any commit could go green
