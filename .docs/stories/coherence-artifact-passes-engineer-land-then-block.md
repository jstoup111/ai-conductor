**Status:** Accepted

# Stories: Coherence artifact passes engineer land, then blocks the merged spec as unparseable (#1881)

Technical track — acceptance derives from the technical intent and
`adr-2026-08-26-shared-coherence-parser-at-discovery`.

## Story 1: The coherence parser lives in one lean shared module

As the harness engine, I want a single pure coherence-artifact parser consumed by every reader so
that land and dispatch cannot disagree on what parses.

### Acceptance Criteria

#### Happy Path
- Given the extracted shared parser module, when land's coherence gate parses an artifact, then it produces the same typed rows and failure reasons as before the extraction
- Given the extracted shared parser module, when its import graph is inspected, then it reaches no land-only modules (overlap-scan, rebase, owner-gate, blocker-resolver) and performs no filesystem or git access
- Given existing land callers importing from `coherence-validator.ts`, when the extraction lands, then those imports keep working via re-export without call-site changes

#### Negative Paths
- Given an artifact rejected by the pre-extraction parser (missing, empty, unparseable, bad criterion row), when the shared parser parses it, then it returns the identical failure reason id as before the extraction
- Given a test importing the shared module in isolation, when it is loaded without the rest of the engine, then loading succeeds with no side effects or transitive land-only imports

### Done When
- [ ] The pure parsing core is in its own module; `coherence-validator.ts` re-exports it and contains no duplicate parsing logic
- [ ] Existing coherence-validator unit tests pass unchanged against the re-export
- [ ] An import-graph assertion (test or lint) proves the shared module pulls in no land-only modules

## Story 2: Dispatch discovery accepts exactly what land accepts

As an operator, I want a merged spec's coherence artifact judged by the same parser at dispatch as
at land so that no spec can land and then be unbuildable.

### Acceptance Criteria

#### Happy Path
- Given a merged non-S spec whose coherence artifact declares a six-wide header over five-cell legacy rows (the #1881 shape), when discovery evaluates it, then the spec is eligible for dispatch
- Given a merged non-S spec whose artifact has five-cell legacy rows beside six-cell criterion rows under a five-wide header (the documented ragged shape), when discovery evaluates it, then the spec is eligible for dispatch
- Given a merged non-S spec whose artifact contains zero criterion rows, when discovery evaluates it, then the spec is eligible for dispatch
- Given a discovery fixture corpus of artifacts the retired shallow check accepted, when discovery runs with the shared parser, then no such spec is ever silently dropped: each is either eligible, or blocked with reason `missing-coherence` carrying a remedy that names the failing line and the parser's message

#### Negative Paths
- Given a merged non-S spec with no `.docs/coherence/<plan-stem>.md`, when discovery evaluates it, then it is blocked with reason `missing-coherence` and skipped with a once-per-slug log line
- Given a merged non-S spec whose coherence artifact is empty or contains no table, when discovery evaluates it, then it is blocked with reason `missing-coherence` and never dispatched
- Given a merged S-tier spec with no coherence artifact, when discovery evaluates it, then it is not blocked (tier-S exemption unchanged)
- Given an artifact land would reject as unparseable, when discovery evaluates the same bytes, then discovery also rejects it (no artifact is dispatch-acceptable but land-rejectable)

### Done When
- [ ] `hasCoherenceTableDataRow` is gone and discovery's non-S coherence branch calls the shared parser
- [ ] A no-regression test runs discovery over fixtures under both predicates and asserts no old-accepted fixture is silently dropped: each is either eligible, or blocked with `missing-coherence` carrying a remedy that names the offending line and the parser's message
- [ ] The zero-criterion-rows discovery test from adr-2026-08-23 is updated to pin the same behavior through the shared parser, not deleted
- [ ] A regression fixture reproducing the #1881 artifact shape dispatches successfully

## Story 3: A coherence rejection names the defect and its line

As an operator reading a land rejection or a daemon skip, I want the message to name the offending
line and what disagrees with what so that I can fix the artifact without reading the parser.

### Acceptance Criteria

#### Happy Path
- Given an artifact whose row 12 is a five-cell `criterion` row, when parsing fails, then the failure carries the line number and states the expected cell count (6) versus the actual (5)
- Given an artifact whose first table row is not followed by a separator row, when parsing fails, then the failure names the offending line and states that a separator row was expected
- Given a data row with an unknown row class, when parsing fails, then the failure names the line and the unrecognized class token
- Given a parse failure at dispatch, when the spec is blocked, then the `remedy` string and the skip log line include the structural detail verbatim
- Given a parse failure at land, when the spec is rejected, then the rejection message includes the same structural detail

#### Negative Paths
- Given any parse failure, when the failure reason id is compared to the pre-change vocabulary, then it is one of the existing `CoherenceParseFailureReason` ids — no id renamed or removed (condition C-C)
- Given an enriched parse failure at land, when a coherence waiver names it, then the refusal stands — parse failures remain non-waivable
- Given a missing or empty artifact (no line to cite), when parsing fails, then the failure carries no fabricated line detail and the message still names the file and reason

### Done When
- [ ] The parser failure branch carries an optional structural `detail` (line number plus disagreement) populated for unparseable-artifact and unparseable-criterion-row failures
- [ ] Land rejection messages and discovery `remedy`/log lines include the detail when present
- [ ] `BlockedSpecItem.reason` union is byte-for-byte unchanged
- [ ] Tests assert the detail text for at least the wrong-cell-count, missing-separator, and unknown-row-class cases
