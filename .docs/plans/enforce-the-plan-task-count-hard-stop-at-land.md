# Implementation Plan: Enforce the plan task-count hard stop at land

**Date:** 2026-09-06
**Stories:** .docs/stories/enforce-the-plan-task-count-hard-stop-at-land.md
**Track:** technical
**Complexity:** S
**Conflict check:** Small-tier formal check skipped; the scoped intent adds one more pure text predicate to the land gate's existing plan-validation block and conforms to that block's established contract: read the plan once, evaluate a pure predicate, render violations into the single land refusal path.

## Summary

Four bounded tasks deliver #1645. A new focused engine module owns the band boundaries, counts a
plan's addressable tasks through the shared task parser, and validates the one declaration that
authorizes an oversized plan; the land gate consumes that verdict beside its sibling plan gates; and
the plan skill's scope-band section is rewritten to describe the enforced rule and bound to the
exported constants by a contract test. Recalibrating the boundary values, warning-band authoring
behavior, tasks appended to an already-landed plan, and any new configuration key or CLI surface are
outside this slice.

## Technical Approach

Put the whole rule in one new module, `src/conductor/src/engine/plan-task-count.ts`, so the
boundaries have exactly one home. It exports the two band boundaries as named constants, a
`classifyPlanTaskCount(planText)` that returns the addressable task count plus its band, and a
`validatePlanTaskCount(planText)` that returns either no violation or one violation describing why
the plan may not land. Nothing else in the module reads a literal boundary number.

Derive the count from `parsePlanTaskBodies` in `src/conductor/src/engine/plan-task-parse.ts` rather
than a new heading regex. That parser already owns the shared `TASK_HEADER_PATTERN` grammar, already
skips fenced regions through its line/fence state walker, and already expands comma-listed ids into
separate entries, so the count is the size of the map it returns. Reusing it is what makes the
fenced-example and comma-list behavior true by construction instead of by a second, drifting regex.

Authorization is a single plan-header declaration, `**Scope-exception:**` followed by a non-empty
rationale on the same physical line. Follow the fail-closed grammar the paired Pattern-source and
Rename-map headers already established in this repository: exactly one declaration with a non-empty
rationale authorizes; an empty rationale is malformed; two or more declarations are ambiguous and
also malformed. A malformed declaration is never read as authorization. The declaration is consulted
only when the count reaches the hard-stop band, so a plan inside the normal band is untouched
whether or not it carries the line — this is what keeps the ordinary land path byte-identical.

Follow the shape of `src/conductor/src/engine/plan-done-when.ts` exactly: a pure text predicate with
no filesystem boundary, no I/O, and no state, whose caller renders its violations. The relevant
traits are that the validator takes plan text and returns data, that the diagnostic string is
composed at the call site in the land gate, and that the module is unit-testable without any git or
worktree fixture. Search hints for comparable code: the sibling validators next to it under the same
engine directory, and their unit tests under the mirrored test directory. Allowed variation: this
validator returns at most one violation rather than an array, because a plan has one task count.
Every implementation task below repeats the applicable part of this pattern in its own steps.

Wire the verdict into `src/conductor/src/engine/engineer/land-spec.ts` immediately after the
existing `validatePlanDoneWhen` block, using the same import style and the same
`throw new Error('landSpec: …')` refusal path. This is the one changed production boundary, so the
land test file owns the integration proof: an operator running the land composer sees the refusal,
not merely a helper returning a value. The message names the plan's task count, the boundary that
was crossed, and — for a malformed declaration — that the declaration was rejected rather than
absent, so the two failures are distinguishable without reading the code.

For the skill, rewrite the scope-band section so it states the enforced rule, names the declaration
form, and drops the instruction to record the decision in an uncommitted memory directory, which is
the half of the escape hatch the issue proves never happened. Keep the band table, because an author
needs a number to aim at, and add `parseDocumentedPlanTaskBands(skillText)` to the same engine
module so a contract test can assert the documented numbers equal the exported constants. The parser
is a first-class tested function, not test-local logic, so its drift detection is itself falsifiable
against a fixture.

Tests follow this repository's test-design rules: the module's cases are unit-level over plain
strings with no fixture beyond the text; the land cases extend the existing land test file, which
already builds a real local git repository and per-idea worktree and seeds artifacts through helper
functions, and they reuse those helpers rather than introducing a new harness. No test reaches a real
LLM, network, or third-party service, and no conductor run is started for any of this. No exact-copy
pattern declaration applies.

## Preconditions and claim ledger

- Operator approved Small scope, the technical track, the in-artifact declaration over an
  uncommitted memory record, unchanged boundary values, and all three stories on 2026-09-06
  (delegated).
- Verified: `src/conductor/src/engine/engineer/land-spec.ts` imports `validatePlanDoneWhen` at line
  66 and evaluates it at line 265, directly after the protected-target scan at line 254, rendering
  violations into a thrown `landSpec:` error — the insertion point and the refusal idiom both exist.
- Verified: `src/conductor/src/engine/plan-done-when.ts` is a single exported pure validator over
  plan text, documented in its own comment as a mechanical land-time shape rule with no filesystem
  boundary — the shape precedent this module copies.
- Verified: `src/conductor/src/engine/plan-task-parse.ts` exports `TASK_HEADER_PATTERN` at line 77
  and `parsePlanTaskBodies` at line 190; the latter walks lines with fence state, skips headers
  inside fences, and expands comma-listed ids, so its returned map size is the addressable task
  count.
- Verified: `skills/plan/SKILL.md` lines 375-385 carry the three-band table and the sentence
  directing the author to record a confirmed large plan in an uncommitted memory directory; nothing
  under `src/conductor` reads either.
- Verified: `src/conductor/test/engine/plan-done-when.test.ts` unit-tests its validator over inline
  plan strings, and `src/conductor/test/engine/engineer/land-spec.test.ts` seeds a real local git
  repository plus per-idea worktrees through helper functions and already asserts the Done-when
  refusal message — both are the existing homes this change extends.
- Verified: `src/conductor/test/engine/build-review-skill-contract.test.ts` reads a shipped skill
  file by URL-relative path and asserts its contract text, which is the precedent for the skill
  contract test added here.
- Scope check: consumer-facing engine gate and shipped skill text; no new skill; provider-agnostic.
  Event spine: no new event, metric, span, log line, or report — the refusal travels the existing
  land error path.
- Verify-claims verdict: CLEAR. Every path, symbol, and line number above was read in the worktree.
  No pending product or scope assumption remains.

## Tasks

### Task 1: Count and classify a plan's addressable tasks
**Story:** Story 1
**Story:** Story 3
**Type:** happy-path
**Files:** src/conductor/src/engine/plan-task-count.ts, src/conductor/test/engine/plan-task-count.test.ts
**Dependencies:** none

**Steps:**
1. Write failing unit tests over inline plan strings for: a plan one task below the warning boundary, one exactly at it, one exactly at the hard-stop boundary, one above it, a plan whose extra task headings sit inside a fenced block, and a plan with a comma-listed task heading. Assert both the returned count and the returned band.
2. Verify the tests fail (RED).
3. Implement the new module as a pure text predicate with no filesystem boundary, no I/O, and no state, mirroring the sibling plan validator in the same engine directory: export the two band boundaries as named constants and a `classifyPlanTaskCount(planText)` that returns the count and band. Derive the count from the shared plan-task parser's returned map size so fenced headings and comma-listed ids need no separate handling.
4. Verify the tests pass (GREEN), run the repository's typecheck target that covers test files, and commit the focused change.

**Done when:**
1. `classifyPlanTaskCount` returns the addressable task count and one of the normal, warning, or hard-stop bands for unit fixtures placed one below and exactly at each boundary.
2. Task headings inside fenced code blocks and comma-listed ids are counted through the shared plan-task parser, so a fenced example never raises a plan's band.
3. The two band boundaries are exported as named constants, and every band decision in the module reads them rather than a literal number.

### Task 2: Validate the scope-exception declaration
**Story:** Story 2
**Type:** negative-path
**Files:** src/conductor/src/engine/plan-task-count.ts, src/conductor/test/engine/plan-task-count.test.ts
**Dependencies:** 1

**Steps:**
1. Write failing unit tests for `validatePlanTaskCount(planText)`: a hard-stop plan with no declaration, one with a single non-empty rationale, one whose rationale is empty or only whitespace, one carrying two declarations, and a below-boundary plan both with and without a declaration.
2. Verify the tests fail (RED).
3. Implement the declaration grammar in the same module, keeping it a pure predicate with no I/O: recognize a single `**Scope-exception:**` header line and treat the remainder of that physical line as the rationale. Return no violation below the hard-stop band; above it, return an unauthorized violation when no declaration is present, a malformed violation when the sole rationale is empty, and a malformed violation when two or more declarations appear. Fail closed — a malformed declaration is never read as authorization.
4. Verify the tests pass (GREEN), run the typecheck target that covers test files, and commit.

**Done when:**
1. A single scope-exception declaration carrying a non-empty rationale yields an authorized result and returns that rationale for the caller to report.
2. An absent declaration on an at-or-above-boundary plan yields an unauthorized violation, while an empty rationale and two or more declarations each yield a malformed violation distinguishable from it.
3. A plan below the hard-stop boundary yields no violation at all, whether or not it carries a declaration.

### Task 3: Refuse an unauthorized over-threshold plan at land
**Story:** Story 1
**Story:** Story 2
**Type:** happy-path
**Files:** src/conductor/src/engine/engineer/land-spec.ts, src/conductor/test/engine/engineer/land-spec.test.ts
**Dependencies:** 2

**Steps:**
1. Extend the existing land test file, reusing its local-git repository and per-idea worktree helpers rather than adding a harness: seed plans at the hard-stop boundary with no declaration, with one valid declaration, with an empty rationale, and with two declarations, plus a plan one task below the boundary, a below-boundary plan whose extra headings sit inside a fenced block, and a below-boundary plan carrying an inert declaration.
2. Verify the new land cases fail (RED).
3. Import the validator into the land gate and evaluate it immediately after the existing Done-when block, composing the diagnostic at the call site and refusing through the same thrown `landSpec:` error the sibling plan gates use. The message names the plan's task count and the crossed boundary, and states when a declaration was rejected as malformed rather than absent.
4. For the authorized case, read the plan back out of the landed commit in the test and assert the rationale text survives the land byte-for-byte.
5. Verify the tests pass (GREEN), run the repository's typecheck target that covers test files, and commit.

**Done when:**
1. A land fixture whose plan carries task ids at the hard-stop boundary and no declaration is refused, and the refusal text contains both the count and the boundary.
2. A land fixture at the boundary with one non-empty declaration lands, and reading the committed plan back from the branch shows the rationale text unchanged.
3. Empty-rationale and duplicate-declaration land fixtures are each refused with a message that distinguishes a malformed declaration from an absent one.
4. A land fixture one task below the boundary lands unchanged, as do a below-boundary plan whose extra task headings sit inside a fenced block and a below-boundary plan carrying an inert declaration.

### Task 4: Bind the documented bands to the enforced constants
**Story:** Story 3
**Type:** happy-path
**Files:** skills/plan/SKILL.md, src/conductor/src/engine/plan-task-count.ts, src/conductor/test/engine/plan-task-count-skill-contract.test.ts
**Dependencies:** 1

**Steps:**
1. Write a failing contract test that reads the plan skill by URL-relative path, following the existing shipped-skill contract test in the same test directory, and asserts the boundary numbers its scope-band section declares equal the exported constants. Add unit cases for `parseDocumentedPlanTaskBands(skillText)` over inline fixtures: a well-formed band table, one whose numbers are drifted, and one with no recognizable table.
2. Verify the tests fail (RED).
3. Add `parseDocumentedPlanTaskBands` to the same engine module as a pure text function returning the documented boundaries or nothing when the section is unrecognizable.
4. Rewrite the skill's scope-band section: keep the band table, state that the top band is refused when the spec is landed, name the `**Scope-exception:**` declaration form and its one-declaration non-empty-rationale grammar as the only way an oversized plan proceeds, and remove the instruction to record a confirmed large plan in an uncommitted memory directory.
5. Verify the tests pass (GREEN), run the repository's typecheck target that covers test files and the harness integrity suite, and commit.

**Done when:**
1. A contract test reads the plan skill's scope-band section and asserts its boundary numbers equal the exported constants.
2. A drifted band-text fixture makes the comparison report a mismatch, proving the check can fail rather than passing vacuously.
3. The skill's scope-band section states that the top band is refused at land, names the declaration form that admits an authorized large plan, and no longer directs the author to record the decision in an uncommitted memory directory.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a plan whose addressable task count is at or above the hard-stop boundary and which declares no scope exception, when the spec is landed, then land fails and the message names the plan's task count and the hard-stop boundary. | 1, 3 | "A land fixture whose plan carries task ids at the hard-stop boundary and no declaration is refused, and the refusal text contains both the count and the boundary." | diff-local |
| Story 1 happy: Given a plan whose addressable task count is below the hard-stop boundary, when the spec is landed, then land succeeds exactly as it does today with no additional artifact, prompt, or declaration required. | 3 | "A land fixture one task below the boundary lands unchanged, as do a below-boundary plan whose extra task headings sit inside a fenced block and a below-boundary plan carrying an inert declaration." | diff-local |
| Story 1 negative: Given a plan below the hard-stop boundary whose fenced code examples contain further task headings that would carry it over that boundary, when the spec is landed, then those fenced headings are not counted and land succeeds. | 1, 3 | "Task headings inside fenced code blocks and comma-listed ids are counted through the shared plan-task parser, so a fenced example never raises a plan's band." | diff-local |
| Story 2 happy: Given a plan at or above the hard-stop boundary that declares exactly one scope exception with a non-empty rationale, when the spec is landed, then land succeeds and the committed plan artifact still carries that rationale verbatim. | 2, 3 | "A land fixture at the boundary with one non-empty declaration lands, and reading the committed plan back from the branch shows the rationale text unchanged." | diff-local |
| Story 2 negative: Given a plan at or above the hard-stop boundary whose scope-exception declaration has an empty rationale, when the spec is landed, then land fails naming the declaration as malformed rather than treating it as authorization. | 2, 3 | "Empty-rationale and duplicate-declaration land fixtures are each refused with a message that distinguishes a malformed declaration from an absent one." | diff-local |
| Story 2 negative: Given a plan at or above the hard-stop boundary carrying two or more scope-exception declarations, when the spec is landed, then land fails as ambiguous rather than accepting either declaration. | 2, 3 | "An absent declaration on an at-or-above-boundary plan yields an unauthorized violation, while an empty rationale and two or more declarations each yield a malformed violation distinguishable from it." | diff-local |
| Story 3 happy: Given the engine exports the band boundaries as named constants, when the gate refuses a plan and when the plan skill documents its scope bands, then both render the same boundary values from those constants. | 1, 4 | "A contract test reads the plan skill's scope-band section and asserts its boundary numbers equal the exported constants." | diff-local |
| Story 3 negative: Given documented band text whose boundary numbers differ from the exported constants, when the boundaries are compared, then the comparison reports the drift instead of passing. | 4 | "A drifted band-text fixture makes the comparison report a mismatch, proving the check can fail rather than passing vacuously." | diff-local |

## Test dispositions and integration ownership

Every criterion is diff-local against controlled fixtures. Task 1 and Task 2 own unit-level coverage
of counting, banding, and declaration grammar over inline plan strings, which is the lowest
sufficient layer because both are pure functions with no boundary. Task 3 owns the single changed
production boundary — the land gate — and therefore owns the integration proof for Story 1 and Story
2: it exercises the real land path against a real local git repository with the artifact set an
operator would actually land, so the refusal and the survival of the rationale are observed through
the composer's own entry point rather than through a helper's return value. Task 4 owns the skill
contract, asserting the shipped text against the exported constants and proving the drift check is
falsifiable. Several compatible criteria share a single land case where they observe the same
boundary, so no criterion gets a ceremonial test of its own. No new aggregate, network, or
third-party test is introduced, and no terminal validation task is added.

## Task Dependency Graph

Task 1 -> Task 2 -> Task 3
Task 1 -> Task 4
