# Implementation Plan: ADR Decision Citability Contract

**Date:** 2026-09-02
**Stories:** .docs/stories/reaped-stale-claim-jstoup111-ai-conductor-2054.md
**Conflict check:** Clean as of 2026-09-02

## Summary
Extract one shared `parseAdrDecisions` authority, rewire the as-built governing-clause resolver
through it, add a diff-scoped citability rung to the engineer land gate, and document accepted
decision forms in the ADR template. 8 tasks.

## Technical Approach
- New export `parseAdrDecisions(content)` in `src/conductor/src/engine/artifacts.ts`, beside
  `adrApprovalStatus`, returning a typed result: `{ kind: 'decisions', ids: Set<string> }` or
  `{ kind: 'diagnostic', reason, detail }`. Hygiene per adr-2026-08-08: strip fenced code blocks
  before matching, line-anchored patterns, fail-closed on unreadable/unparseable input.
- Accepted shapes are a strict superset of the AB-R12 regex at `conductor.ts` (~646-660):
  numbered list items, bolded D-headings, ATX-heading decisions with optional emphasis, and
  decisions introduced inside additive amendment blockquotes. Word-bounded ids (1 never matches 10).
- `resolveAsBuiltGoverningClause` deletes its inline decision regex and consults the parser's id
  set (reference + id set → resolved | diagnostic, per adr-2026-08-30's resolver contract).
- Land gate: a new citability check inside `landSpec`'s existing 4e ADR loop
  (`src/conductor/src/engine/engineer/land-spec.ts` ~384-400), applied ONLY to `adr-*.md` files
  added or modified in the spec branch's own diff (computed the same way land's existing
  changed-file scoping works). Refuse-only, non-waivable, names the offending file.
- Local pattern: follow `adrApprovalStatus` + its tests in `test/engine/artifacts.test.ts` for
  parser style (pure function, fence stripping, tolerant grammar); follow the 4e unapproved-ADR
  accumulation-then-throw pattern in `land-spec.ts` for the gate rung. Variation allowed in
  result typing; do not re-derive shape validity anywhere outside the parser.
- Tests: Vitest; unit tests in `test/engine/artifacts.test.ts` and
  `test/engine/engineer/land-spec.test.ts`; resolver tests in `test/prd-audit-kickback.test.ts`
  stay green unchanged.

## Prerequisites
None — pure engine + template change.

## Tasks

### Task 1: parseAdrDecisions accepts the three AB-R12 shapes
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing tests in test/engine/artifacts.test.ts: numbered item `4. **Termination.**`, bolded `**D4 — Termination.**`, ATX `### D4 — Termination` and `### **D4** — X` each parse to an id set containing `4`.
2. Verify RED.
3. Implement `parseAdrDecisions` in src/conductor/src/engine/artifacts.ts (typed result, patterns ported from the AB-R12 regex, applied per-line over the `## Decision` section).
4. Verify GREEN; commit.

**Done when:**
- [ ] `parseAdrDecisions` is exported from artifacts.ts returning the typed decisions/diagnostic result
- [ ] The four shape fixtures above pass, each asserting id membership in the returned set

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — new export
- src/conductor/src/test/engine/artifacts.test.ts — new tests

**Dependencies:** none

### Task 2: Parser hygiene — fences, headingless, word bounds, fail-closed
**Story:** 1
**Type:** negative-path

**Steps:**
1. Write failing tests: decision-shaped lines inside a fenced code block yield no ids; no `## Decision` heading returns a diagnostic naming the missing heading; a section with only `D10` does not contain id `1`; empty/whitespace section returns a zero-decision result distinct from a parse failure.
2. Verify RED.
3. Implement fence stripping (reuse the approach `adrApprovalStatus` uses), heading detection, `\b`-bounded id capture.
4. Verify GREEN; commit.

**Done when:**
- [ ] All four negative fixtures pass with the exact diagnostic kinds asserted
- [ ] Fence stripping runs before any shape matching (asserted by the fenced fixture)

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — hygiene logic
- src/conductor/src/test/engine/artifacts.test.ts — negative tests

**Dependencies:** 1

### Task 3: Amendment-note decisions are citable
**Story:** 1
**Type:** happy-path

**Steps:**
1. Write failing test: a Decision section whose additive amendment blockquote (`> **Amended ... by #NNN:**` followed by a decision in an accepted shape) introduces decision 8 parses to a set containing `8`, alongside the section's original ids.
2. Verify RED.
3. Implement: blockquote markers are stripped for shape matching within the Decision section (quote-prefixed lines participate; fenced blocks still excluded).
4. Verify GREEN; commit.

**Done when:**
- [ ] The amendment fixture (modeled on a real corpus amendment) passes
- [ ] Original non-amended ids from the same section remain present in the result

**Files likely touched:**
- src/conductor/src/engine/artifacts.ts — blockquote handling
- src/conductor/src/test/engine/artifacts.test.ts — amendment fixture

**Dependencies:** 1

### Task 4: No-silent-loss corpus test
**Story:** 2
**Type:** negative-path
**Verify-only:** no

**Steps:**
1. Write a test that walks every markdown file in the repository decisions corpus directory, extracts each `## Decision` section, and for every decision number the pre-change AB-R12 regex (inlined into the test as the frozen legacy predicate) accepts, asserts `parseAdrDecisions` also yields that id.
2. Verify it passes against the real corpus (this test is GREEN-by-construction once Tasks 1-3 are done; a failure names the file and id lost).
3. Commit.

**Done when:**
- [ ] The corpus test enumerates every corpus file (non-zero count asserted) and reports zero formerly-resolvable ids lost
- [ ] On mismatch the assertion message names the file and decision id

**Files likely touched:**
- src/conductor/src/test/engine/adr-decision-corpus.test.ts — new corpus test

**Dependencies:** 3

### Task 5: Rewire resolveAsBuiltGoverningClause through the parser
**Story:** 2
**Type:** refactor

**Steps:**
1. Confirm existing resolver tests in test/prd-audit-kickback.test.ts (AB-R12 shapes, emphasis stripping) are GREEN before the change.
2. Implement: in src/conductor/src/engine/conductor.ts, delete the inline decision-shape regex and AB-R12 comment; resolve the cited decision number against `parseAdrDecisions`' id set (unknown number, headingless, or diagnostic result → null, preserving current null semantics).
3. Verify the full existing resolver test set passes unchanged; add one test: a decision number absent from the set does not resolve.
4. Commit.

**Done when:**
- [ ] No decision-shape regex remains in conductor.ts (grep for `D\$\{decisionNumber\}` finds nothing)
- [ ] All pre-existing resolver tests pass without modification
- [ ] The absent-number negative test passes

**Files likely touched:**
- src/conductor/src/engine/conductor.ts — resolver rewire
- src/conductor/src/test/prd-audit-kickback.test.ts — one added negative test

**Dependencies:** 2

### Task 6: Land-gate citability rung, diff-scoped
**Story:** 3
**Type:** happy-path

**Steps:**
1. Write failing tests in test/engine/engineer/land-spec.test.ts: (a) a spec diff adding an APPROVED ADR with a numbered decision passes the rung; (b) adding an APPROVED ADR whose Decision section yields zero citable ids fails land with an error naming the file; (c) editing an existing ADR into an uncitable state fails naming the file.
2. Verify RED.
3. Implement: inside landSpec's existing 4e ADR loop in src/conductor/src/engine/engineer/land-spec.ts, for each `adr-*.md` in the spec's own changed-file set with approved status, call `parseAdrDecisions`; accumulate uncitable offenders and throw after the loop, mirroring the unapproved-ADR accumulation pattern.
4. Verify GREEN; commit.

**Done when:**
- [ ] Fixtures (a)-(c) pass; the rejection message contains the offending filename and states no citable decision was found
- [ ] The rung consults only files in the spec's changed-file set (asserted by fixture in Task 7)

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — citability rung
- src/conductor/src/test/engine/engineer/land-spec.test.ts — gate tests

**Dependencies:** 2

### Task 7: Gate negatives — legacy corpus untouched, refuse-only, non-waivable
**Story:** 3
**Type:** negative-path

**Steps:**
1. Write failing tests: (a) a spec diff touching no ADR files lands cleanly while the fixture repo contains a legacy APPROVED decision file with no Decision heading; (b) on citability failure, land mutates no artifacts and appends no tasks (worktree state identical before/after the throw); (c) the failure path offers no waiver hook — assert the throw is unconditional with no waiver lookup on this rung.
2. Verify RED (where the behavior does not yet hold).
3. Implement any scoping fix needed so the rung is keyed strictly to the changed-file set.
4. Verify GREEN; commit.

**Done when:**
- [ ] Fixtures (a)-(c) pass
- [ ] Diff-scoping is proven: the legacy uncitable fixture file is present and land still succeeds

**Files likely touched:**
- src/conductor/src/engine/engineer/land-spec.ts — scoping fixes if needed
- src/conductor/src/test/engine/engineer/land-spec.test.ts — negative tests

**Dependencies:** 6

### Task 8: Template names accepted decision forms
**Story:** 4
**Type:** happy-path

**Steps:**
1. Write failing test: a sample ADR authored exactly per the updated template's Decision guidance parses to a non-empty citable id set; and the template's own status-vocabulary line is byte-identical to the pre-change template (fixture the current line).
2. Verify RED (sample-conformance test fails until template text exists).
3. Implement: edit the Decision section guidance in templates/adr.md.template to name the accepted citable forms, recommending the numbered list; keep example forms inert (no line in the template may itself parse as a status declaration beyond the existing status line).
4. Run test/test_harness_integrity.sh to confirm no gate misreads the examples.
5. Verify GREEN; commit.

**Done when:**
- [ ] The template-conforming sample parses to a non-empty id set
- [ ] The template's status vocabulary is unchanged (byte-identical assertion passes)
- [ ] test/test_harness_integrity.sh passes

**Files likely touched:**
- templates/adr.md.template — Decision-section guidance
- src/conductor/src/test/engine/artifacts.test.ts — template-conformance test

**Dependencies:** 1

## Task Dependency Graph
```
1 ─┬─ 2 ─┬─ 5
   │     └─ 6 ── 7
   ├─ 3 ── 4
   └─ 8
```

## Integration Points
- After Task 5: as-built clause resolution runs end-to-end on the shared parser.
- After Task 7: land gate enforces citability for new/edited ADRs, diff-scoped.

## Verification
- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a falsifiable Done when block
- [ ] Dependencies are explicit and acyclic

### Task rem-as-built-rem-ab1-1: src/conductor/src/engine/artifacts.ts:4102 — widen the D-heading matcher to the complete pre-change AB-R12 language: replace /^\s*(?:\*{2}|#{1,6}\s+\*{0,2})D(\d+)\b/ with /^\s*#{0,6}\s*\*{0,2}D(\d+)\b/, which is character-for-character the frozen legacy oracle at src/conductor/test/engine/adr-decision-corpus.test.ts:27 (its matched counterpart — do NOT edit that oracle; the two agree by the parser being derived from it, and the corpus test exists to detect divergence). Then extend the existing shape table at src/conductor/test/engine/artifacts.test.ts:4232-4236 with three added rows proving the previously narrowed forms parse to id 4 — ['bare D-line', 'D4 bare'], ['single-emphasis D-heading', '*D4 - Termination'], ['ATX D-heading without space', '###D4 - Termination'] — leaving the four existing rows and all Task 2 hygiene negatives (:4245 fences, :4256 missing heading, :4263 D10 word bound, :4273 empty section) byte-identical so completed Task 1-3 coverage survives; verify the D10 word-bound negative still passes under the widened pattern. Run test/engine/artifacts.test.ts and test/engine/adr-decision-corpus.test.ts.
**Gate:** as-built
**Rationale:** Conforming implementation drift under an approved, still-applicable ADR, so it routes to build, not architecture_review: adr-2026-09-02-adr-decision-citability-contract decision 2 requires parseAdrDecisions to accept a superset of the pre-change AB-R12 grammar, and Task 1's step 3 already commits to patterns 'ported from the AB-R12 regex' while the track's operator constraint (.docs/track/reaped-stale-claim-jstoup111-ai-conductor-2054.md:9) and the plan (.docs/plans/reaped-stale-claim-jstoup111-ai-conductor-2054.md:17-18) both bind the parser to a strict superset — so no architectural decision is open and an existing plan task admits the fix. The shipped D-heading matcher at src/conductor/src/engine/artifacts.ts:4102 requires either '**' or '#{1,6}' followed by whitespace, narrowing three forms the frozen predicate at src/conductor/test/engine/adr-decision-corpus.test.ts:27 accepts; a direct regex probe confirms frozen=true / shipped=false for a bare 'D4 bare', a single-asterisk '*D4 - X', and a no-space '###D4 - X', while '### D4', '**D4**', '### **D4**' and '### *D4' already agree. Class sweep: grep over src/conductor/src found exactly one production site of this grammar (artifacts.ts:4102) — the pre-change copy in conductor.ts is already deleted by Task 5, whose resolver now calls the parser at conductor.ts:643-644 — and the only other copy in the repository is the corpus test's deliberately frozen legacy oracle, which is the matched counterpart and must stay byte-identical because it is the compatibility reference, not a duplicate to be kept in sync. Nothing is removed, replaced, or relaxed: the four existing shape fixtures at src/conductor/test/engine/artifacts.test.ts:4232-4236 and every hygiene negative from Task 2 (fences :4245, missing heading :4256, word bounds :4263, empty section :4273) stay unchanged, preserving the coverage completed Tasks 1-3 deliver, and the widening is additive acceptance only. Found and deliberately excluded: templates/adr.md.template:29-31 names the preferred numbered form and the two canonical D-heading alternatives, and is left as authored — it prescribes how to write a decision, not the full tolerance of the reader, and Task 8's Done-when covers exactly those three forms, so documenting the degenerate bare/no-space/single-asterisk shapes as 'accepted' would contradict Task 8 and is not admitted by any plan task. The as-built report's diagram-direction note at .docs/architecture/2026-09-02-adr-decision-shape-contract.md:27 is a non-blocking Drift Note the report itself excludes from the violation, so no disposition is emitted for it.
**Governing clause:** adr-2026-09-02-adr-decision-citability-contract decision 2
**Done when:**
- adr-2026-09-02-adr-decision-citability-contract decision 2 is satisfied by this task.
