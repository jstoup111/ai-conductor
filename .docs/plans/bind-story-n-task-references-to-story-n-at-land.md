# Implementation Plan: Bind story-N task references to Story N at land

**Date:** 2026-09-06
**Stories:** .docs/stories/bind-story-n-task-references-to-story-n-at-land.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent conforms to the existing coherence-gate contract — the orphan-task rule, the gap id grammar, and the layer ordering are unchanged, and only the resolution of a task's cited story id and the wording of an existing finding move.

## Summary

Five bounded tasks deliver #2174: one shared story-reference parser in the module that already declares itself the stable home for plan-task grammar, three readers routed through it, and an orphan-task finding that names a reference it could not bind. Multi-id reference lines, the stories-file heading grammar, and the orphan-task rule itself are outside this small slice.

## Technical Approach

The defect is one regex, copied three times. Its optional literal group is written `(?:story|epic)?` with only whitespace allowed after it, so on the value `story-3` the group greedily eats `story`, the whitespace run matches nothing, and the id capture starts at the hyphen and yields `-3`. Every downstream consumer then looks up a story id that no heading can produce. The same trap fires on `epic-2` and on `Story-1`.

The correction is to make the prefix word and the separator that follows it one optional unit, guarded by a word boundary: an optional group of the literal `story` or `epic`, then a boundary, then a run of hyphens and horizontal whitespace, then the existing id capture. The boundary is what keeps `stories-3` whole — without it the group still matches the leading `story` of a longer word and the capture starts mid-token. This was checked by executing both the current and the corrected expression over the accepted and rejected spellings before authoring.

Scope the match to a line whose leading content is the bold story-reference marker, using the anchored form the orphan-task reader already uses for its raw-line lookup, rather than the unanchored form the other two copies use. Two consequences are deliberate: a marker written mid-sentence in task prose no longer registers a phantom id, and a marker with its value on the following line no longer reaches across the newline. Neither shape is an authored form, and the plan corpus contains no instance of the second.

House the parser as one exported function in the existing shared plan-task parsing module, whose header already names it the stable home for the shared grammar and which both call sites already import — so no module and no import edge is added. It takes a task block's text and returns the cited ids in first-seen order, deduplicated, with the existing sentinel values filtered by the same test the three copies apply today. The three readers then hold no expression of their own.

For the diagnostic half, the orphan-task finding gains one optional detail field carrying either the cited ids that resolved to nothing, together with the accepted spellings, or a statement that the reference line is absent. The aggregation that builds the reported item appends the detail when present. The gap id stays `task-<id>` and the task title stays, so existing findings keep their identity and only gain text.

Follow the existing table-driven unit style in the plan-task parsing test file for the parser cases, and the existing seeded-worktree land style in the coherence acceptance file for the land-boundary proof: real parsing, real landing primitive, faithful fake for the identity runner, no external service. No exact-copy pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the shared-parser approach, and both stories on 2026-09-06 (delegated).
- Verified: the identical value expression appears at `src/conductor/src/engine/artifacts.ts:5308`, `src/conductor/src/engine/engineer/coherence-validator.ts:580`, and `coherence-validator.ts:824`, the third differing only in using horizontal-whitespace classes.
- Verified by execution: the current expression captures `-3` from `story-3`, `-2` from `epic-2`, and `-1` from `Story-1`, while `Story 3`, `3`, and `3.2-1` capture correctly; the corrected expression binds all four accepted spellings, preserves `3.2-1`, and leaves `stories-3` whole.
- Verified: story ids are produced by `splitStoryBlocks` in `src/conductor/src/engine/story-criteria.ts` from `## Story <id>` headings, so a captured `-3` can match no story.
- Verified: `collectPlanCoverage` feeds the plan-coverage step gate at `artifacts.ts:4017`; `extractCitedStoryIdsFromBlock` feeds `checkOrphanTasks` at `coherence-validator.ts:857`; `extractTaskStoryIds` feeds the requirement-coverage and coverage-table layers.
- Verified: `src/conductor/src/engine/plan-task-parse.ts` declares itself the stable home for the shared plan grammar and is already imported by `artifacts.ts` and by `coherence-validator.ts`.
- Verified: the orphan-task finding shape carries only a gap id and a title today, and its aggregation sets the reported item from the title alone; existing tests assert gap ids, not that item text.
- Verified: `src/conductor/test/engine/plan-task-parse.test.ts` and `src/conductor/test/engine/engineer/coherence-validator.test.ts` exist, and `src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts` already drives the real landing primitive against a seeded worktree.
- Scope check: the land gate ships with the engine to every installing repository, so the change is consumer-facing; it lands no rule, documentation, or skill artifact, so no placement follows. No new skill. Provider-agnostic: pure text parsing with no host path, variable, or capability.
- Event spine: no channel is added — an existing land gap's text changes, not how that gap is carried.
- Verify-claims verdict: CLEAR. Every load-bearing claim above was verified by reading the worktree or executing the expression; no assumption remains pending.

## Tasks

### Task 1: Add the shared story-reference parser
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/plan-task-parse.ts, src/conductor/test/engine/plan-task-parse.test.ts
**Dependencies:** none

**Steps:**
1. Write table-driven unit tests for a new exported parser that takes a task block's text and returns cited story ids: the values `story-3`, `Story 3`, `3`, and `epic-3` each yield `3`; `3.2-1` yields `3.2-1`; an uppercase prefix word and a repeated reference line in one block yield one deduplicated result in first-seen order.
2. Establish RED, then implement the parser: match only a line whose leading content is the bold story-reference marker, consume an optional `story` or `epic` literal that ends on a word boundary together with the run of hyphens and horizontal whitespace after it, then capture the existing id character class.
3. Apply the existing sentinel filter to each captured id so the recognized "no story" values are dropped rather than returned.
4. Run the focused parser tests through the repository's scoped test invocation and commit the focused change.

**Done when:**
1. The values `story-3`, `Story 3`, `3`, and `epic-3` each yield the single id `3`, and `3.2-1` yields `3.2-1` unchanged.
2. Two reference lines citing the same id in one block yield one id, and two lines citing different ids yield both in first-seen order.
3. The parser is exported from the shared plan-task parsing module and adds no new module and no new import edge.

### Task 2: Reject non-prefix tokens and sentinel values
**Story:** Story 1
**Type:** negative-path
**Files:** src/conductor/src/engine/plan-task-parse.ts, src/conductor/test/engine/plan-task-parse.test.ts
**Dependencies:** 1

**Steps:**
1. Add RED unit cases for the rejected shapes: the value `stories-3`, an empty value, the sentinel values, and a bold story-reference marker written mid-sentence inside surrounding task prose.
2. Confirm the word boundary is what keeps `stories-3` whole by asserting the returned id is the entire token, not the trailing digits.
3. Adjust the expression only if a case fails, keeping the accepted-spelling cases from Task 1 green.
4. Run the focused parser tests through the repository's scoped test invocation and commit.

**Done when:**
1. The value `stories-3` yields the single id `stories-3`, never `3`.
2. An empty value and the values `none`, `n/a`, `prerequisite`, and `all` each yield no id.
3. A bold story-reference marker appearing mid-sentence in surrounding prose yields no id.

### Task 3: Route the three readers through the shared parser
**Story:** Story 1
**Type:** happy-path
**Files:** src/conductor/src/engine/artifacts.ts, src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts
**Dependencies:** 2

**Steps:**
1. Add a RED land-boundary acceptance case in the existing coherence acceptance file: seed a worktree whose plan tasks cite their stories with the `story-N` spelling and assert the land resolves silently, using the existing seeding helper and the existing resolving identity runner.
2. Replace the story-reference expression inside the plan-coverage collector with a call to the shared parser, keeping the surrounding path-type detection, the parenthesised qualifier match, and the coverage-table row scan untouched.
3. Replace both coherence readers' expressions with calls to the same parser, keeping each caller's existing return shape and its existing sentinel-free contract.
4. Run the focused acceptance file and both affected engine test files through the repository's scoped test invocation and commit.

**Done when:**
1. The plan-coverage collector and both coherence readers each call the shared parser and hold no story-reference expression of their own.
2. A land-boundary acceptance case lands a seeded spec whose task story references use the `story-N` spelling with no orphan-task gap and no plan-coverage gap.
3. The existing land acceptance case that refuses a task citing a nonexistent story id still fails with its unchanged task gap id.

### Task 4: Name the unbindable reference in the orphan-task finding
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** 3

**Steps:**
1. Write a RED unit case asserting that an orphan task citing a story id absent from the stories text produces a finding whose reported item names that cited id and lists the accepted spellings.
2. Add one optional detail field to the orphan-task finding shape and populate it, when the task cited ids that resolved to nothing, with those ids and the accepted spellings.
3. Append the detail to the reported item where orphan findings are aggregated into the gap list, leaving the gap id and the title untouched.
4. Run the focused coherence unit tests through the repository's scoped test invocation and commit.

**Done when:**
1. An orphan task citing a story id absent from the stories text produces a finding whose reported item contains that cited id text and the four accepted spellings.
2. The finding keeps its existing task gap id and still carries the task title.
3. A task that binds to a real story produces no finding, so the detail never appears on a covered task.

### Task 5: Report an absent reference line without inventing an id
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/engineer/coherence-validator.ts, src/conductor/test/engine/engineer/coherence-validator.test.ts
**Dependencies:** 4

**Steps:**
1. Write RED unit cases for the two absent-reference shapes: a task with no story-reference line and a non-supporting type, and a task whose story-reference value is empty.
2. Populate the detail for those shapes with a statement that the reference line is absent, rather than an empty cited-id fragment.
3. Re-run every existing orphan-task unit case and confirm each keeps its current gap id.
4. Run the focused coherence unit tests through the repository's scoped test invocation and commit.

**Done when:**
1. An orphan task with no story-reference line produces a finding whose reported item states the line is absent and contains no cited id text.
2. An orphan task whose story-reference value is empty produces the same absent-reference item rather than an empty cited-id fragment.
3. Every pre-existing orphan-task unit case keeps its current task gap id.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a plan task whose story-reference value reads `story-3` and a stories artifact declaring Story 3, when land parses the plan, then the task binds to story id `3` and raises neither an orphan-task gap nor a plan-coverage gap for it. | 3 | "A land-boundary acceptance case lands a seeded spec whose task story references use the `story-N` spelling with no orphan-task gap and no plan-coverage gap." | diff-local |
| Story 1 happy: Given plan tasks whose story-reference values read `Story 3`, `3`, `epic-3`, and `3.2-1`, when land parses the plan, then they bind to story ids `3`, `3`, `3`, and `3.2-1` respectively. | 1 | "The values `story-3`, `Story 3`, `3`, and `epic-3` each yield the single id `3`, and `3.2-1` yields `3.2-1` unchanged." | diff-local |
| Story 1 negative: Given a plan task whose story-reference value reads `stories-3`, when land parses the plan, then the cited id stays the whole token `stories-3` and is never silently reduced to `3`. | 2 | "The value `stories-3` yields the single id `stories-3`, never `3`." | diff-local |
| Story 1 negative: Given a plan task whose story-reference value is empty, reads `none`, or reads `n/a`, when land parses the plan, then the task cites no story id and the existing supporting-purpose and orphan rules decide its fate unchanged. | 2 | "An empty value and the values `none`, `n/a`, `prerequisite`, and `all` each yield no id." | diff-local |
| Story 2 happy: Given a plan task cites a story id absent from the stories artifact, when the orphan-task check reports that task, then the reported item carries the cited id text alongside the accepted story-reference spellings. | 4 | "An orphan task citing a story id absent from the stories text produces a finding whose reported item contains that cited id text and the four accepted spellings." | diff-local |
| Story 2 negative: Given a plan task carries no story-reference line at all and a type that is neither infrastructure nor refactor, when the orphan-task check reports that task, then the reported item names the absent reference line and carries no invented cited id. | 5 | "An orphan task with no story-reference line produces a finding whose reported item states the line is absent and contains no cited id text." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled in-memory fixtures. Tasks 1 and 2 own the parser unit cases for the accepted and rejected spellings. Task 3 owns the cross-module integration proof at the real landing primitive: the seeded-worktree acceptance case is the single owner of the boundary, because a unit test of the parser alone would pass while the live land still orphaned the task. Tasks 4 and 5 own the orphan-finding diagnostic at the coherence unit boundary, where the finding shape is produced. No third-party service is contacted anywhere: the acceptance case uses the existing faithful fake for the identity runner and a real local temporary worktree. No aggregate suite run and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3 -> Task 4 -> Task 5
