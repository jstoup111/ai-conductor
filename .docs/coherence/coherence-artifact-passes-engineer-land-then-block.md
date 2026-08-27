# Coherence Mapping: coherence-artifact-passes-engineer-land-then-block

Technical track (no PRD — `fr` row class omitted). Intake outcomes staged from
jstoup111/ai-conductor#1881. Verdicts confirmed against the stories, plan, and ADR files.

| Row class | Cited id / criterion | Counterpart / cited task id(s) | Verdict | Notes / verbatim quote |
|---|---|---|---|---|
| outcome | outcome-1 | story-2 | covered | Land-accepted implies dispatch-parseable via the one shared parser |
| outcome | outcome-2 | story-2, story-3 | covered | Land rejects everything dispatch would reject, on the feature branch |
| outcome | outcome-3 | story-3 | covered | Rejections name the line and the disagreement |
| outcome | outcome-4 | story-2 | covered | Absent/empty/table-less still blocked at dispatch for non-S tiers |
| outcome | outcome-5 | story-2 | covered | Ragged five-cell/six-cell shape lands and dispatches |
| story | story-1 | task-1, task-2 | covered | Extraction plus import-isolation test |
| story | story-2 | task-5, task-6, task-7 | covered | Discovery swap, no-regression corpus, fail-closed negatives |
| story | story-3 | task-3, task-4, task-5 | covered | Detail in parser, land throw, dispatch remedy/log |
| task | task-1 | story-1 | covered | Move-only extraction with re-exports |
| task | task-2 | story-1 | covered | Isolation negative path |
| task | task-3 | story-3 | covered | Line-level detail in the shared parser |
| task | task-4 | story-3 | covered | Land rejection surfaces detail; waiver cannot bypass |
| task | task-5 | story-2 | covered | Deletes the triple-scan; discovery consumes the shared parser |
| task | task-6 | story-2 | covered | No-regression oracle corpus and zero-criterion pin |
| task | task-7 | story-2 | covered | Verify-only fail-closed dispatch negatives |
| adr | adr-2026-08-26-shared-coherence-parser-at-discovery | story-1, story-2, story-3 | covered | All three stories implement its four decisions |
| adr | adr-2026-08-23-criterion-layer-is-structural-at-land | story-2 | covered | Amended note's zero-criterion invariant pinned by story-2 and task-6 |
| criterion | Story 1 happy: Given the extracted shared parser module, when land's coherence gate parses an artifact, then it produces the same typed rows and failure reasons as before the extraction | task-1 | covered | move (verbatim, move-only) the types | diff-local |
| criterion | Story 1 happy: Given the extracted shared parser module, when its import graph is inspected, then it reaches no land-only modules (overlap-scan, rebase, owner-gate, blocker-resolver) and performs no filesystem or git access | task-1, task-2 | covered | none of: overlap-scan, rebase, owner-gate, blocker-resolver | diff-local |
| criterion | Story 1 happy: Given existing land callers importing from `coherence-validator.ts`, when the extraction lands, then those imports keep working via re-export without call-site changes | task-1 | covered | keeping every existing import path valid | diff-local |
| criterion | Story 1 negative: Given an artifact rejected by the pre-extraction parser (missing, empty, unparseable, bad criterion row), when the shared parser parses it, then it returns the identical failure reason id as before the extraction | task-1 | covered | Existing coherence-validator tests pass unchanged | diff-local |
| criterion | Story 1 negative: Given a test importing the shared module in isolation, when it is loaded without the rest of the engine, then loading succeeds with no side effects or transitive land-only imports | task-2 | covered | imports `coherence-parse.ts` directly | diff-local |
| criterion | Story 2 happy: Given a merged non-S spec whose coherence artifact declares a six-wide header over five-cell legacy rows (the #1881 shape), when discovery evaluates it, then the spec is eligible for dispatch | task-5 | covered | six-wide header over five-cell rows is in the eligible `items` set | diff-local |
| criterion | Story 2 happy: Given a merged non-S spec whose artifact has five-cell legacy rows beside six-cell criterion rows under a five-wide header (the documented ragged shape), when discovery evaluates it, then the spec is eligible for dispatch | task-5 | covered | the documented ragged shape (five-cell legacy + six-cell criterion rows) is eligible | diff-local |
| criterion | Story 2 happy: Given a merged non-S spec whose artifact contains zero criterion rows, when discovery evaluates it, then the spec is eligible for dispatch | task-6 | covered | discovery accepts an artifact with no criterion rows | diff-local |
| criterion | Story 2 happy: Given a discovery fixture corpus of artifacts the retired shallow check accepted, when discovery runs with the shared parser, then every one of those specs remains eligible (no old-accepted artifact becomes ineligible; the new predicate may accept strictly more) | task-6 | covered | every fixture the oracle accepts is accepted by `parseCoherenceArtifact` | diff-local |
| criterion | Story 2 negative: Given a merged non-S spec with no `.docs/coherence/<plan-stem>.md`, when discovery evaluates it, then it is blocked with reason `missing-coherence` and skipped with a once-per-slug log line | task-7 | covered | merged non-S spec with no coherence file | diff-local |
| criterion | Story 2 negative: Given a merged non-S spec whose coherence artifact is empty or contains no table, when discovery evaluates it, then it is blocked with reason `missing-coherence` and never dispatched | task-7 | covered | empty file → blocked | diff-local |
| criterion | Story 2 negative: Given a merged S-tier spec with no coherence artifact, when discovery evaluates it, then it is not blocked (tier-S exemption unchanged) | task-7 | covered | merged S-tier spec with no coherence file → not blocked | diff-local |
| criterion | Story 2 negative: Given an artifact land would reject as unparseable, when discovery evaluates the same bytes, then discovery also rejects it (no artifact is dispatch-acceptable but land-rejectable) | task-5 | covered | replace the call site with a `!parsed.ok` check | diff-local |
| criterion | Story 3 happy: Given an artifact whose row 12 is a five-cell `criterion` row, when parsing fails, then the failure carries the line number and states the expected cell count (6) versus the actual (5) | task-3 | covered | stating expected 6 vs actual N | diff-local |
| criterion | Story 3 happy: Given an artifact whose first table row is not followed by a separator row, when parsing fails, then the failure names the offending line and states that a separator row was expected | task-3 | covered | separator row expected | diff-local |
| criterion | Story 3 happy: Given a data row with an unknown row class, when parsing fails, then the failure names the line and the unrecognized class token | task-3 | covered | names the line and the token | diff-local |
| criterion | Story 3 happy: Given a parse failure at dispatch, when the spec is blocked, then the `remedy` string and the skip log line include the structural detail verbatim | task-5 | covered | appending `detail` to `remedy` and the `warnOnce` message | diff-local |
| criterion | Story 3 happy: Given a parse failure at land, when the spec is rejected, then the rejection message includes the same structural detail | task-4 | covered | append `parsed.detail` (line + message) when present | diff-local |
| criterion | Story 3 negative: Given any parse failure, when the failure reason id is compared to the pre-change vocabulary, then it is one of the existing `CoherenceParseFailureReason` ids — no id renamed or removed (condition C-C) | task-3 | covered | Reason id strings untouched | diff-local |
| criterion | Story 3 negative: Given an enriched parse failure at land, when a coherence waiver names it, then the refusal stands — parse failures remain non-waivable | task-4 | covered | parse failures stay non-waivable | diff-local |
| criterion | Story 3 negative: Given a missing or empty artifact (no line to cite), when parsing fails, then the failure carries no fabricated line detail and the message still names the file and reason | task-3 | covered | absence of `detail` for missing/empty | diff-local |
