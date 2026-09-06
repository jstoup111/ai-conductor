# Implementation Plan: Render kickback and BUILD re-entry counts in the run report

**Date:** 2026-09-06
**Stories:** .docs/stories/render-kickback-and-build-re-entry-counts-in-condu.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds one pure section to an existing renderer and conforms to the repository's single-event-spine contract — no event variant, emitter, persister, sink registration, or consumer outside the report is touched.

## Summary

Four bounded tasks deliver #2252. The run report gains one kickback section derived from the events it already parses: a BUILD re-entry figure, per-source-gate attribution, an explicit statement when nothing kicked back, and no side effects. Halt tables, cumulative lap accounting across progress resets, the cost-rollup and kpi surfaces, and the engineer-loop signal path are outside this slice.

## Technical Approach

Add one exported pure helper and one section function to the report renderer, and compose the section into the existing five-entry section list immediately before the build-review metrics section, so lap economics read together. The helper takes the output of the existing `aggregateKickbacks` and folds it into an ordered summary: a total occurrence count, a BUILD re-entry count (records whose target step is `build`), and one row per distinct source-gate-to-target-step pair carrying that pair's occurrence count and its most recent recorded outcome discriminator. Rows sort descending by occurrence count, then ascending by source gate and target step, so identical input always renders identically.

Count occurrences, not the per-event `count` field. That field is the emitting gate's running ledger counter, which resets when a gate's progress is reset — the reason a separate cumulative field exists on the build-review emission alone. Occurrences are uniform across every emitting gate and are exactly the "how many times was this re-opened" figure the section must state. The cumulative field stays unread by this slice; whether other gates should carry it is left open, as the issue notes, and does not block the section.

Render with the module's existing `padRow` table style so the new section matches its neighbours. An empty result renders the heading plus one explicit sentence, following the established pattern of the operator-park-boundary and build-review sections, which is what makes "no kickbacks" distinguishable from "no reporting". Records whose source or target is absent or non-string already normalise to the empty string in `aggregateKickbacks`; render those cells as the module's existing em-dash placeholder rather than dropping the row, so a malformed line stays visible and never removes the section.

The section is a pure function of an in-memory event array. It opens no file, writes nothing, and reaches no emitter, so the report remains derived solely from the persisted ledger and adds no channel. The event union, the sink registration that already marks kickbacks persisted, and the CLI branch that calls the renderer are all unchanged.

Test at the narrowest credible seam. Pure aggregation and rendering cases are unit tests over fixture ledgers written to a temporary directory, matching how the file's existing sections are covered. One case drives the real event emitter and the real persister to prove the section reads what production actually writes — real internal collaboration, no third-party boundary, no conductor run. One case proves side-effect freedom by comparing a recursive listing and the file contents of the feature directory across a render. The file's existing rollup-isolation case, which today asserts that report output is byte-identical with and without a kickback record, is narrowed to the timing and cost rollups it was written to protect; its report assertion is the behaviour this change deliberately reverses, and dropping only that assertion preserves the rollup proof.

Documentation follows the change in the same diff: the CLI reference row for the report flag, the artifacts reference passage that records kickbacks as persisted-but-unrendered, and the stalled-feature runbook's known-limitation note, which currently names halts and kickbacks together and must be narrowed to halts.

## Preconditions and claim ledger

- Operator approved Small scope, technical track, occurrence counting over the running counter, and both stories on 2026-09-06 (delegated).
- Verified: `renderReport` in the report renderer composes exactly five sections (durations, retries, token spend, operator park boundaries, build-review metrics) and reads no kickback.
- Verified: `aggregateKickbacks` is defined in the same module above `renderReport` and returns `{from, to, count, evidence?, kickbackOutcome?}`, normalising a non-string source or target to the empty string.
- Verified: the only consumers of `aggregateKickbacks` outside its own module are the engineer-store signal assembly and its rate documentation; nothing renders it.
- Verified: the event-sink table registers the kickback type with persistence enabled, so the ledger the report reads already contains these records.
- Verified: the kickback event variant carries `from`, `to`, optional `evidence`, a required `count`, an optional `cumulativeCount` documented as build-review-only, and an optional outcome discriminator.
- Verified: emissions across the conductor pass a running per-gate `count`, and only the build-review emission passes `cumulativeCount`.
- Verified: the report CLI branch calls `renderReport` on the pipeline events log, prints it, and exits; it is the only reader-facing caller.
- Verified: `padRow` exists in the module and pads each cell to twenty characters, and the durations section is the pattern for a heading-plus-table section.
- Verified: the report test file already builds fixture ledgers in a temporary directory, and already drives the real emitter and persister for a halt case, so both test shapes exist in-file.
- Verified: the report test file contains a case asserting that report, timing, and cost results are equal with and without a persisted kickback record.
- Verified: the CLI reference table's report row, the artifacts reference passage on halt and kickback rendering, and the stalled-feature runbook's known-limitation block each state the gap this change closes.
- Scope check: repository-only engine surface; no skill addition; provider-agnostic.
- Event spine: no channel added — a reader over events already on the bus; the union, emitter, persister, and sink registration are untouched.
- Verify-claims verdict: CLEAR. Every path, symbol, and line claim above was read in the worktree; no pending product or scope assumption remains.

## Tasks

### Task 1: Summarise and render kickbacks per source gate
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/report-renderer.ts, src/conductor/test/engine/report-renderer.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit cases over fixture ledgers: one gate re-opening BUILD several times, three different gates each re-opening BUILD once, and a mixture of BUILD and non-BUILD targets. Assert the rendered BUILD re-entry figure, the total, and one row per distinct source-gate-to-target-step pair with its occurrence count.
2. Establish RED, then add the exported pure summary helper over the existing kickback aggregate: total occurrences, BUILD re-entry count, and ordered per-pair rows carrying the most recent outcome discriminator when one was recorded.
3. Add the section function using the module's existing row-padding helper and heading style, and compose it into the section list immediately before the build-review metrics section.
4. Add a case asserting deterministic ordering: rows descend by occurrence count and tie-break by source gate then target step.
5. Run the focused report-renderer tests through scoped-run, then the repository typecheck target that covers test files, and commit.

**Done when:**
1. A single-gate fixture renders a BUILD re-entry figure equal to the number of kickback records targeting build, and one row naming that source gate with the same count.
2. A three-gate fixture renders three rows, one per source gate, each with its own count, and a BUILD re-entry figure equal to their sum.
3. A mixed-target fixture renders rows for both targets while the BUILD re-entry figure counts only records whose target is build.
4. Two fixtures differing only in record order render byte-identical sections.
5. The rendered section appears in report output ahead of the build-review metrics section.

### Task 2: Report absence and malformed records explicitly
**Story:** Story 1 (negative path)
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/report-renderer.ts, src/conductor/test/engine/report-renderer.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing cases for an empty ledger, a ledger with events but no kickback record, and a kickback record whose source and target fields are absent or non-string.
2. Establish RED, then render the heading plus one explicit no-kickbacks sentence when the summary is empty, matching the wording pattern the neighbouring empty sections already use.
3. Render an absent or non-string source or target as the module's existing em-dash placeholder, keeping the row and the rest of the section intact.
4. Add a case proving a malformed record does not suppress a well-formed record rendered from the same ledger.
5. Run the focused report-renderer tests through scoped-run, then the typecheck target that covers test files, and commit.

**Done when:**
1. An empty ledger renders the kickback heading followed by an explicit sentence stating that no kickbacks were recorded.
2. A ledger of non-kickback events renders that same explicit sentence rather than omitting the section.
3. A record missing its source and target renders a placeholder row and does not throw.
4. A ledger holding one malformed and one well-formed record renders both rows and a total of two occurrences.

### Task 3: Prove the section reads production writes and writes nothing
**Story:** Story 1
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/test/engine/report-renderer.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case that starts the real event persister on a real event emitter over a temporary feature directory, emits kickbacks from two different source gates into BUILD, stops the persister, and renders the report over the written ledger.
2. Assert the rendered section names both source gates with the counts that were emitted, proving the section reads the shape production persists rather than a hand-built fixture shape.
3. Add a case that records a recursive listing of the feature directory and the bytes of every file in it before rendering, renders, and asserts the listing and every file's bytes are unchanged.
4. Narrow the existing rollup-isolation case to timing and cost equality, removing only its report-output assertion, and state in its title that the report now reports kickbacks.
5. Run the focused report-renderer tests through scoped-run, then the typecheck target that covers test files, and commit.

**Done when:**
1. A persister-backed case renders a section naming both emitted source gates with their emitted occurrence counts.
2. The directory listing and every file's bytes are identical before and after rendering a ledger containing kickbacks.
3. The narrowed rollup case still asserts timing and cost results are equal with and without a persisted kickback record.
4. The narrowed rollup case no longer asserts report output equality, and its title no longer claims the report ignores kickbacks.

### Task 4: Update the reference and runbook pages that record the gap
**Story:** Story 2
**Type:** happy-path
**Files:** docs/reference/cli.md, docs/reference/artifacts.md, docs/runbooks/stalled-or-stuck-feature.md
**Dependencies:** 1, 2

**Steps:**
1. Update the report flag's row in the CLI reference table so its rendered-sections list includes the kickback section alongside the sections it already names.
2. Update the artifacts reference passage that states the report renders neither halt nor kickback tables, so it records kickbacks as rendered and halts as still unrendered, in both places that sentence appears.
3. Update the stalled-feature runbook step that reads the run timeline: correct its section list and narrow its known-limitation block to halts, keeping the halt-consumer guidance and the halt tracking-issue reference intact.
4. Run the repository validation suite and commit.

**Done when:**
1. The CLI reference row for the report flag names the kickback section among the sections the report renders.
2. Neither artifacts reference passage claims the report renders no kickback table, and both still record halts as unrendered.
3. The runbook's known-limitation block names halts only, and its surrounding step describes the kickback section as available.
4. The repository validation suite passes.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a ledger records kickbacks that re-opened BUILD, when the report is rendered, then it states how many times BUILD was re-entered without the reader inspecting the ledger. | 1 | "A single-gate fixture renders a BUILD re-entry figure equal to the number of kickback records targeting build, and one row naming that source gate with the same count." | diff-local |
| Story 1 happy: Given a ledger records kickbacks from several source gates, when the report is rendered, then each source gate appears with its own occurrence count so one re-opening by three gates is distinguishable from three by one gate. | 1 | "A three-gate fixture renders three rows, one per source gate, each with its own count, and a BUILD re-entry figure equal to their sum." | diff-local |
| Story 1 happy: Given kickbacks are emitted through the real emitter and persisted by the real persister, when the report is rendered over that ledger, then the section reports the same gates and counts that were emitted. | 3 | "A persister-backed case renders a section naming both emitted source gates with their emitted occurrence counts." | diff-local |
| Story 1 negative: Given a kickback record carries no recognisable source or target step, when the report is rendered, then the section renders that record under a stable placeholder instead of failing or omitting the whole section. | 2 | "A record missing its source and target renders a placeholder row and does not throw." | diff-local |
| Story 1 negative: Given a ledger contains kickbacks that re-opened a step other than BUILD, when the report is rendered, then the BUILD re-entry figure counts only the records that re-opened BUILD. | 1 | "A mixed-target fixture renders rows for both targets while the BUILD re-entry figure counts only records whose target is build." | diff-local |
| Story 2 happy: Given a ledger records no kickback at all, when the report is rendered, then the section is present and states explicitly that none were recorded. | 2 | "An empty ledger renders the kickback heading followed by an explicit sentence stating that no kickbacks were recorded." | diff-local |
| Story 2 negative: Given the report is rendered over a ledger containing kickbacks, when rendering completes, then no file is created, modified, or deleted anywhere under the feature directory. | 3 | "The directory listing and every file's bytes are identical before and after rendering a ledger containing kickbacks." | diff-local |
| Story 2 negative: Given a ledger contains kickbacks, when the timing and cost rollups are computed over it, then those rollups are unchanged by the presence of kickback records. | 3 | "The narrowed rollup case still asserts timing and cost results are equal with and without a persisted kickback record." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures. Task 1 owns unit coverage for summarisation, attribution, ordering, and composition into the section list. Task 2 owns the empty and malformed input cases at the same unit seam. Task 3 owns the only integration in this slice — real emitter plus real persister plus real renderer, with no third-party boundary and no conductor run — and owns the side-effect and rollup-isolation proofs. Task 4 is documentation and carries no test. No new smoke, acceptance, or external-service test is required, and no terminal validation task is added: the repository validation suite in Task 4 is the existing aggregate check, not new coverage.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 4
Task 1 -> Task 3
