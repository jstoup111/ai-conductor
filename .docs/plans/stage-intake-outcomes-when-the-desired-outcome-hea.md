# Implementation Plan: Stage intake outcomes when the Desired-outcome heading is plural

**Date:** 2026-09-06
**Stories:** .docs/stories/stage-intake-outcomes-when-the-desired-outcome-hea.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the contracts it touches — the staging module stays the only writer of the gitignored outcomes file, the written heading stays the canonical singular form every downstream reader parses, and no gate, event, or command surface changes.

## Summary

Three bounded tasks deliver the first of #1528's two independent causes: the intake staging extractor recognizes the Desired-outcome section heading in either the singular or the plural form, an empty or near-miss heading still stages zero bullets silently, and the file written from either form keeps its canonical shape. Resolving a body for a source ref with no usable claim record, the worktree-creation diagnostic for an unstaged outcome layer, and the coherence refusal wording are excluded — they are the delivered scope of the sibling spec for #1340, which changes different modules.

## Technical Approach

The defect lives in one pure function, `extractDesiredOutcomeSection`, in `src/conductor/src/engine/engineer/outcome-staging.ts`. It locates the section with a pattern whose literal final word is singular and anchored to a whole line, then strips that heading with a second pattern of the same literal shape. A body heading written in the plural matches neither, so the function returns null, the caller substitutes an empty canonical heading, and the staged file goes out with zero bullets — which is exactly the state that later fails the land-time outcome cross-check.

The correction is to make the final letter of the heading word optional in both patterns and nowhere else. Both keep their whole-line anchoring, so a heading that continues past the phrase still does not match, and both keep their existing trailing-whitespace tolerance, which is what lets a body delivered with carriage returns match today. Nothing else in the function moves: the scan that terminates the section at the next same-level heading, the bullet filter that keeps only lines opening with a dash, and the constant that writes the heading are all untouched.

That constant is the reason widening the input is safe. The writer emits the canonical singular heading regardless of what the body used, so the staged file's shape is unchanged for every consumer: the module's own staged-file reader, which only counts dash-opening lines and one reference line, and the committed-marker writer's extractor, which searches the staged content for the canonical singular heading and would silently drop the block if the plural form were carried through verbatim. Preserving normalization is therefore a load-bearing property of this fix, not a cosmetic one, and it gets its own criterion and its own test.

Tests follow this repository's test-design rules and stay at the narrowest level that proves the behavior. The subject is a pure function reached through the module's exported writer and reader, and the module's existing unit test file already drives exactly that pair over a temporary directory created per test. Extend that file rather than adding a harness: no process, network, tracker, or language model participates at any level here, so there is no third-party boundary to fake and no reason to reach for the command entry point. The committed-marker extractor's parsing of the canonical heading already has its own coverage in the marker module's test file and is not re-proved here. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- The operator's delegate approved Small scope, the technical track, tolerating the variant on read rather than rejecting it at file time, and both stories on 2026-09-06 (delegated).
- Verified: `extractDesiredOutcomeSection` in `outcome-staging.ts` locates the section with a whole-line-anchored pattern ending in the singular word, and strips the heading with a second pattern of the same literal shape.
- Verified: when that function returns null, `stageIntakeOutcomes` still writes the file, substituting a canonical heading with no bullets, so an unmatched heading is silent rather than an error.
- Verified: `stageIntakeOutcomes` writes the heading from a local constant holding the canonical singular form, so the staged file never carries the body's own heading text.
- Verified: `readStagedIntakeOutcomes` derives `required` purely from the count of dash-opening lines, so zero staged bullets makes the outcome layer not required.
- Verified: the committed-marker writer's extractor searches staged content for the canonical singular heading, so normalization on write is what keeps that consumer unchanged.
- Verified: the only production caller is the worktree-authoring path, which invokes the writer with the claim's reference and body and takes no other action on its result.
- Verified: the module's existing unit test file already exercises the writer and reader together over a per-test temporary directory, including singular-heading, empty-section, and nothing-staged cases.
- Verified: issue #1528's second cause and the coherence refusal wording are the delivered scope of the sibling spec for #1340, whose plan changes the engineer command module and the coherence validator and does not touch this module.
- Scope check: consumer-facing engine behavior; no new skill; provider-agnostic. Event spine: no channel added, no event, metric, span, or report shape changed.
- Verify-claims verdict: CLEAR. Every path, symbol, and behavior above was read in this worktree; no load-bearing assumption remains open.

## Tasks

### Task 1: Recognize the plural Desired-outcome heading when staging
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/outcome-staging.ts, src/conductor/test/engine/engineer/outcome-staging.test.ts
**Dependencies:** none

**Steps:**
1. Extend the module's existing unit test file with a case whose intake body writes the section heading in the plural and carries two bullets, asserting both the staged file's bullet block and the reader's required result with exactly those bullets.
2. Establish RED against current behavior, which recognizes no section and stages zero bullets.
3. Implement by making the final letter of the heading word optional in both the section-locating pattern and the heading-stripping pattern of the extractor, keeping each pattern's whole-line anchoring and its existing trailing-whitespace tolerance.
4. Confirm the pre-existing singular-heading cases in the same file still pass without edits to their expectations.
5. Run the focused test file through the repository's scoped runner, run the typecheck target that covers test files, and commit the focused change.

**Done when:**
1. A staging case whose body uses the plural heading writes that section's bullets verbatim into the staged file and reads back as required with exactly those bullets.
2. Every pre-existing singular-heading case in that test file passes with its expectations unedited.
3. The diff changes only the two heading patterns inside the extractor, leaving the section-terminating scan, the bullet filter, and the written heading constant byte-for-byte unchanged.

### Task 2: Keep an empty or unrecognized section staging zero bullets silently
**Story:** Story 1 (negative path)
**Story:** Story 2 (negative path)
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/outcome-staging.ts, src/conductor/test/engine/engineer/outcome-staging.test.ts
**Dependencies:** 1

**Steps:**
1. Add three cases to the same test file: a plural heading whose section holds no bullets before the next heading, a body carrying no Desired-outcome section at all, and a body whose only candidate heading continues past the phrase with further words.
2. Establish RED for any case that throws, writes no file, or reports the outcome layer as required.
3. Keep the widened patterns anchored to the whole line so the near-miss heading is not swallowed; tighten the anchoring only if that case matches.
4. Assert in each case that the writer returns the staged path, the file exists, its bullet list is empty, and the reader reports the outcome layer not required.
5. Run the focused test file through the repository's scoped runner and commit the focused change.

**Done when:**
1. A plural heading whose section holds no bullets writes a staged file with zero bullets and reads back as not required.
2. A body with no Desired-outcome section writes a staged file with zero bullets, raises no error, and reads back as not required.
3. A heading that continues past the Desired-outcome phrase is not treated as the section, stages zero bullets, and reads back as not required.

### Task 3: Pin the canonical staged heading for both origin forms
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/test/engine/engineer/outcome-staging.test.ts
**Dependencies:** 1

**Steps:**
1. Add a case that stages the same two bullets twice, once from a body using the singular heading and once from a body using the plural heading, into two separate temporary worktree directories.
2. Assert the file staged from the plural-heading body contains the canonical singular heading line, and assert it contains no plural heading anywhere.
3. Assert the two staged files carry the same heading line and the same bullet block, so the origin form is invisible downstream.
4. Establish RED before Task 1's change is present, then confirm GREEN after it, and commit the focused change.
5. Run the focused test file through the repository's scoped runner and the typecheck target that covers test files.

**Done when:**
1. The file staged from a plural-heading body contains the canonical singular heading line.
2. The file staged from a plural-heading body contains no plural heading anywhere in its contents.
3. The files staged from the singular-heading and plural-heading bodies carry the same heading line and the same bullet block.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an intake body whose section heading is the plural form of the Desired-outcome heading, when the intake outcomes are staged into the worktree, then the staged file carries every bullet of that section verbatim and the reader reports the outcome layer required with exactly those bullets. | 1 | "A staging case whose body uses the plural heading writes that section's bullets verbatim into the staged file and reads back as required with exactly those bullets." | diff-local |
| Story 1 happy: Given an intake body whose section heading is the singular form, when the intake outcomes are staged into the worktree, then the staged file carries the same bullets it carries today and the reader still reports the outcome layer required. | 1 | "Every pre-existing singular-heading case in that test file passes with its expectations unedited." | diff-local |
| Story 1 negative: Given an intake body whose plural section heading is followed by no bullets before the next heading, when the intake outcomes are staged, then the staged file is written with zero bullets and the reader reports the outcome layer not required. | 2 | "A plural heading whose section holds no bullets writes a staged file with zero bullets and reads back as not required." | diff-local |
| Story 2 happy: Given an intake body written with either heading form, when the intake outcomes are staged, then the staged file's heading line is the canonical singular heading and no plural heading appears anywhere in the file. | 3 | "The file staged from a plural-heading body contains no plural heading anywhere in its contents." | diff-local |
| Story 2 negative: Given an intake body carrying no Desired-outcome section at all, when the intake outcomes are staged, then the staged file is written with the canonical empty heading, no error is raised, and the reader reports the outcome layer not required. | 2 | "A body with no Desired-outcome section writes a staged file with zero bullets, raises no error, and reads back as not required." | diff-local |
| Story 2 negative: Given an intake body whose only candidate heading continues past the Desired-outcome phrase with further words, when the intake outcomes are staged, then no section is recognized, zero bullets are staged, and the reader reports the outcome layer not required. | 2 | "A heading that continues past the Desired-outcome phrase is not treated as the section, stages zero bullets, and reads back as not required." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local: each is decided entirely by the changed extractor against controlled in-memory bodies and a per-test temporary directory, and no commit outside this feature's diff can change whether it holds. The subject is a pure string function with no third-party boundary, so the lowest sufficient level is the module's own unit test file, driving the exported writer and reader together — that pair is the observable contract the land path consumes. Task 1 owns the recognition criteria, Task 2 owns every zero-bullet and near-miss criterion, and Task 3 owns the canonical-shape criterion that keeps the committed-marker extractor and the staged-file reader working unchanged; the marker extractor's own parsing already has coverage in its module's test file and is not re-proved here. No ordinary test may reach a real tracker, a real network, or a real language model, and none in this plan needs to. No terminal catch-all validation task is added; the existing suite and gates validate the completed feature.

## Task Dependency Graph

Task 1 -> Task 2
Task 1 -> Task 3
