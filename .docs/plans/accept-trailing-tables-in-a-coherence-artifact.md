# Implementation Plan: Accept trailing tables in a coherence artifact

**Date:** 2026-09-06
**Stories:** .docs/stories/accept-trailing-tables-in-a-coherence-artifact.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent stays inside the governing shared-parser decision, which already names this issue as where the trailing-table question is decided, and it changes no verdict vocabulary, cell grammar, row class, or failure reason id that another gate depends on.

## Summary

Four bounded tasks deliver jstoup111/ai-conductor#1979 by changing which pipe-delimited lines
`parseCoherenceArtifact` treats as mapping rows. One production module changes; the land gate,
daemon discovery, and the coverage-binding input assembler inherit the widening unchanged because
all three call that one function.

## Technical Approach

Today the parser has no notion of a table: it takes the first pipe-delimited line in the file as the
mapping header, requires the next one to be a separator, and then treats every remaining
pipe-delimited line in the file as a mapping row. A second markdown table therefore arrives as two
malformed data rows — its header and its separator — and the artifact is refused. Give the parser a
minimal segmentation instead. A pipe-delimited line whose next pipe-delimited line is a separator
row begins a new table; those two lines are consumed as header and separator, and every other
pipe-delimited line is a data row of whichever table is currently open. Non-table lines stay
ignored, exactly as today, so a blank line or a paragraph inside a table does not end it.

The first table keeps the current state machine verbatim — first pipe line is the header, the next
pipe line must be a separator or the existing message and line number are returned, and its rows are
always parsed strictly. That is deliberate backward compatibility: it preserves every existing
diagnostic, including the precise "unknown coherence row class" message for a typo in the very first
data row, which a uniform by-classification rule would have downgraded to a generic refusal.

Later tables are classified by their first data row. When its first cell is a known row class —
the five legacy classes or `criterion` — the table is mapping content and its rows are parsed
strictly and appended in file order, which is the shape `skills/coherence-check/SKILL.md:81` already
documents as "a Markdown table (or one table per row class)". Otherwise the table is trailing
commentary and is ignored — but never silently: if any of its rows carries a known row class in its
first cell, the parse is refused with a structural detail whose message states the rule and whose
line is that row's own line. That is the design's core trade: a widened parser must not convert a
loud failure into a dropped mapping row.

The widening cannot change any artifact that parses today. Any artifact that parses today contains
no separator row after its first one, because today's parser reaches such a row as a data row and
refuses it — its cells are neither five nor six valid cells with a known class. Segmentation only
ever triggers on a header/separator pair, so no line that is a mapping row today becomes a header or
a boundary tomorrow, and the extracted row list is identical.

No new failure reason id is introduced. The governing shared-parser decision makes reason ids a
stable API, so the stranded-row refusal reuses the existing structural reason and carries the new
rule text in its `detail.message`, which both the land rejection and the dispatch remedy already
print verbatim.

Tests follow the repository's test-design rules: the behavior is a pure exported function, so its
cases are unit-level against that function, and the cross-surface agreement is proven through the
existing shared regression corpus that the parser tests and the real discovery test both consume —
no conductor run, no network, no provider. The consumer-facing artifact reference page gains the
trailing-table rule in the same change through the documentation pass; documentation is deliberately
not a plan task, and the coherence skill needs no edit because its published contract already allows
the shape this change accepts.

## Preconditions and claim ledger

- Operator approved Small scope, the widening approach over the diagnostic-only alternative, the technical track, and both stories on 2026-09-06 (delegated).
- Verified: `src/conductor/src/engine/coherence-parse.ts` lines 158-186 hold the header/separator state machine and the whole-file row sweep described above.
- Verified: three production call sites share the function — `engineer/coherence-validator.ts:1591`, `daemon-backlog.ts:998`, and `coverage-binding-inputs.ts:31` — so no call site edit is required for the two surfaces to keep agreeing.
- Verified: the land rejection interpolates `detail.line` and `detail.message`, and the discovery remedy does the same, so a rule-naming message reaches the operator through the existing plumbing.
- Verified: `src/conductor/test/engine/coherence-corpus.ts` carries the shipped second-table fixture recorded as accepted by the retired discovery predicate and rejected by the shared parser, and both `coherence-parse.test.ts` and `daemon-backlog.test.ts` assert over that corpus.
- Verified: the governing shared-parser decision's 2026-08-28 amendment names this issue as the place the trailing-table widening is decided, and its no-silent-loss obligation is strengthened by acceptance; no ADR is authored or amended.
- Verified: `skills/coherence-check/SKILL.md:81` already documents one table per row class, so the skill text needs no change.
- Verify-claims verdict: CLEAR. The one inference is that no landed artifact relies on a separator row appearing mid-table; it is grounded because such a row is rejected by today's parser, so no such artifact can be in the accepted set.

## Tasks

### Task 1: Segment the artifact into tables and ignore trailing commentary
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/coherence-parse.ts, src/conductor/test/engine/coherence-parse.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit cases: a well-formed mapping table followed by a blank line and a second table whose header, separator and single data row are ordinary prose returns ok with only the mapping table's rows; a mapping table whose rows are interrupted by a blank line and a paragraph, with no second header, still returns every row.
2. Verify the new cases fail (RED).
3. Implement segmentation in the parser: keep the first-table state machine and its two existing refusals byte-for-byte, then treat a pipe-delimited line whose next pipe-delimited line is a separator row as the header of a new table, consuming both; every other pipe-delimited line is a data row of the open table. Collect later tables per table and ignore them for now.
4. Verify the cases pass (GREEN), run the focused parser test file and the typecheck target that covers test files, and commit.

**Done when:**
1. A parser unit case returns ok for a mapping table followed by a second table and its row list contains only the mapping table's rows.
2. A parser unit case proves a blank line inside the mapping table does not end it and every row is still returned.
3. Every pre-existing case in the parser test file passes unedited, including each reason id, line number, and message.

### Task 2: Parse a later table as mapping content when it opens with a mapping row
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/coherence-parse.ts, src/conductor/test/engine/coherence-parse.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit cases: an artifact carrying a story-class table and then a task-class table returns both tables' rows as one list in file order; a later mapping table whose second row has the wrong cell count is refused with the existing reason id at that row's line.
2. Verify the new cases fail (RED).
3. Implement classification: a later table whose first data row's first cell is one of the five legacy row classes or `criterion` is parsed by the existing strict row reader and its rows appended in file order; classification reads the first data row only, and the header and separator are never classified.
4. Verify the cases pass (GREEN), run the focused parser test file, and commit.

**Done when:**
1. A parser unit case over an artifact carrying two mapping tables returns both tables' rows as one list in file order.
2. A parser unit case proves a malformed row inside a later mapping table is refused with the existing reason id and that row's line number.

### Task 3: Refuse a mapping row stranded in an ignored table
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/coherence-parse.ts, src/conductor/test/engine/coherence-parse.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit cases: a trailing table whose first data row is prose but whose later row begins with a known row class is refused; a trailing table of pure prose rows is accepted and contributes no rows.
2. Verify the new cases fail (RED).
3. Implement the refusal: while scanning an ignored table, a row whose first cell is a known row class returns the existing structural failure reason with a message stating that mapping rows must appear in a table whose first data row is a mapping row, and with that row's own line number.
4. Verify the cases pass (GREEN), run the focused parser test file, and commit.

**Done when:**
1. A parser unit case returns a structural failure whose message names the rule that mapping rows must appear in a table whose first data row is a mapping row.
2. That failure's line number is the stranded row's own line, and its reason id is one that already exists rather than a new one.
3. A parser unit case proves a trailing table of prose rows is ignored without failure and contributes no rows.

### Task 4: Pin no silent loss across the shared corpus and both consuming surfaces
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/coherence-corpus.ts, src/conductor/test/engine/coherence-parse.test.ts, src/conductor/test/engine/daemon-backlog.test.ts
**Dependencies:** 2, 3

**Steps:**
1. Update the shared regression corpus: record the shipped second-table fixture as parser-accepted, and add fixtures for the two-mapping-table shape and the stranded-mapping-row shape with their expected acceptance under both predicates.
2. Update the corpus assertions in the parser test and in the discovery test so the retired-accepted and parser-rejected set is empty and the new-acceptance enumeration lists the widened shapes.
3. Keep the discovery test's un-deduped run and assert the second-table fixture is now dispatch-eligible; keep its blocked-remedy assertions for every fixture still refused, and assert the land gate's own parse entry point accepts the same fixture text.
4. Add a parser case pinning the full extracted row list, in order, for an accepted multi-row artifact.
5. Run both focused test files and the typecheck target that covers test files, then commit.

**Done when:**
1. The corpus records no fixture that the retired discovery predicate accepted and the shared parser rejects.
2. An un-deduped discovery run reports the second-table fixture as dispatch-eligible, and the land gate's own parse entry point accepts the identical text.
3. A parser case pins the full extracted row list for an accepted multi-row artifact, including row order.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a coherence artifact whose first table is a complete, well-formed mapping table and which is followed by a second markdown table carrying no mapping rows, when the shared parser reads it, then it succeeds and returns exactly the mapping table's rows. | 1 | "A parser unit case returns ok for a mapping table followed by a second table and its row list contains only the mapping table's rows." | diff-local |
| Story 1 happy: Given that same artifact committed for a non-S tier spec, when daemon discovery and the land gate each read it, then both accept it, so the spec is dispatch-eligible rather than blocked as missing-coherence. | 4 | "An un-deduped discovery run reports the second-table fixture as dispatch-eligible, and the land gate's own parse entry point accepts the identical text." | diff-local |
| Story 1 happy: Given a coherence artifact that carries its mapping rows in more than one table, each of whose first data row is a mapping row, when the shared parser reads it, then every mapping row from every such table is returned, in file order. | 2 | "A parser unit case over an artifact carrying two mapping tables returns both tables' rows as one list in file order." | diff-local |
| Story 1 negative: Given a coherence artifact whose trailing table is not a mapping table but contains a row whose first cell is a known mapping row class, when the shared parser reads it, then it is rejected with a detail that names the rule about which table mapping rows must live in, alongside the offending line number. | 3 | "A parser unit case returns a structural failure whose message names the rule that mapping rows must appear in a table whose first data row is a mapping row." | diff-local |
| Story 2 happy: Given every fixture in the shared coherence regression corpus, when the shared parser reads each one, then each fixture accepted before the change is still accepted and yields an identical row list. | 4 | "The corpus records no fixture that the retired discovery predicate accepted and the shared parser rejects." | diff-local |
| Story 2 negative: Given a mapping table row with the wrong cell count, an unknown row class, an empty id, an empty verdict, an empty criterion, an unknown verdict, an unknown disposition, or no cited task id, when the shared parser reads it, then the failure reason id, line number, and message are the ones the parser emits today. | 1, 2 | "Every pre-existing case in the parser test file passes unedited, including each reason id, line number, and message." | diff-local |
| Story 2 negative: Given an artifact that is absent, is empty, contains no table at all, or whose first table's header is not followed by a separator row, when the shared parser reads it, then the existing failure reason and detail are returned unchanged. | 1 | "Every pre-existing case in the parser test file passes unedited, including each reason id, line number, and message." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: the subject is one pure exported function and its fixtures are
authored in the diff. Tasks 1-3 own the unit cases for the function's own behavior at the narrowest
credible level, which is the function itself. Task 4 owns the cross-surface proof: it is the single
integration-owning task, and it proves the changed behavior through the two production entry points
that consume the parser — a real un-deduped discovery pass, and the parse entry point the land-time
coherence gate calls — over one shared corpus, so the two acceptance sets cannot diverge silently.
No third-party service, provider, or network boundary is reached; the existing refusal cases supply
the unchanged-diagnostic permutations and are not duplicated. No terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
Task 2 -> Task 4
Task 3 -> Task 4
