# Implementation Plan: Amendment notes in common header forms are invisible to coverage_binding

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/amendment-notes-in-common-header-forms-are-invisib.md`)
**Stories:** .docs/stories/amendment-notes-in-common-header-forms-are-invisib.md
**Conflict check:** Not required (Tier S)

## Summary

Widen the amendment-note recognizer behind `coverage_binding`'s D18 amendment claims, so every
amendment-note header form in use becomes a claim. Fenced examples and quotes that are not
amendment notes stay excluded. Three tasks: the widened header and note-extent rule, the
exclusions, and the step-level integration proof.

## Technical Approach

- **One function changes.** `amendmentBlocks(text)` in
  `src/conductor/src/engine/coverage-binding-inputs.ts` is the only amendment-note recognizer
  feeding D18. Its callers are `assembleAmendmentClaims` in the same file and the
  `coverage_binding` runner's amendment-artifact filter in `src/conductor/src/engine/step-runners.ts`
  (`.filter(({ text }) => amendmentBlocks(text).length > 0)`). Both keep their code unchanged. The
  claim shape, merge-base exclusion (exact block-string set difference), verdicts, events, cache,
  and envelope are untouched.
- **Header rule (ADR D18 as amended 2026-10-09 by #2982).** Replace
  `AMENDMENT_HEADER = /^> \*\*Amended \d{4}-\d{2}-\d{2} by #\d+:\*\*/` with
  `/^\s*(?:>\s*)?\*\*Amended\b/`. A line starts a note when, after optional indentation and an
  optional blockquote marker, it begins with bold `Amended`. `\b` rejects `**Amendment…`. The
  anchor rejects a mid-line `**Amended`. Date, reference, and closing-bold position are free.
- **Note extent.**
  - A quoted header (its match contains `>`) continues while the next line matches `^\s*>` and is
    not itself a header. This is today's `startsWith('>')` rule, widened to indented quotes.
  - An unquoted header continues while the next line is non-blank, not a header, not a quote line,
    and not a fence opener.
  - A following header always starts a new note.
  - The block text is the raw lines joined with `\n`, exactly as today, so a canonical note's claim
    text, and therefore its digest and merge-base identity, is unchanged.
- **Fences.** Track fenced code blocks with the same opener grammar `parseAdrDecisions` uses in
  `src/conductor/src/engine/artifacts.ts`: `^ {0,3}(\`{3,}|~{3,})`, closed by a line opening with
  the same fence run. A fence line ends any open note. Lines inside a fence never start or continue
  a note.
- **Not changed (scope boundary):** the D21 inherited-paragraph matcher `AMENDMENT_PARAGRAPH_RE`
  in `coverage-binding-conflict-inputs.ts`, any land gate, HARNESS.md's prescribed authoring form,
  and legacy notes on main. Widened forms that already sit at the merge base are inherited, so they
  never become claims for later features.
- **Test pattern.** Unit cases extend `src/conductor/test/engine/coverage-binding-inputs.test.ts`,
  calling `assembleAmendmentClaims` with `{ planText, decideArtifacts: [{ path, text, baseText? }] }`
  as the existing two cases do. The integration case reuses the `step-runners.test.ts` amendment
  fixture pattern: `initializeAmendmentGitFixture` plus an
  `architecture-review-review-<featureDesc>.md` artifact; see `writeAmendmentCoverageInputs` and
  the `refuses a not-carried amendment…` / `records every current criterion and amendment digest
  when the judge is disabled` tests. Allowed variation: a new fixture helper that takes the artifact
  text as a parameter.

## Prerequisites

- None. The D18 amendment to `adr-2026-08-31-coverage-binding-judge-step` is already committed on
  this spec branch.

## Tasks

### Task 1: Widened header rule and note extent produce one claim per amendment note
**Story:** Story 1 (happy paths 1–6)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/coverage-binding-inputs.test.ts`, write failing `assembleAmendmentClaims` cases, each with an ADR artifact that has no `baseText`:
   (a) a quoted note headed `> **Amended 2026-07-06 (#353, adr-2026-07-06-example-fixture):** …` with one continuation line;
   (b) one artifact holding seven separate quoted notes, separated by blank lines, headed `by #12 (operator-approved):`, `` by `adr-2026-07-05-example-fixture.md` (APPROVED) and `` with the rest of the header on the next quoted line, `**Amended 2026-07-03** by adr-x (#174):`, `by operator decision (James Stoup):`, `during conflict-check:`, `by PR #1577:`, and `by owner/repo#2636 (spec x):`;
   (c) a list item whose quoted note is indented (`   > **Amended …` and `   > continuation`);
   (d) an unquoted `**Amended 2026-08-21 (operator).** …` line, an indented continuation line, a blank line, then an unrelated paragraph;
   (e) two quoted headers on consecutive lines of one quote;
   (f) the canonical `> **Amended 2026-09-24 by #100:** …` note with one `> ` continuation line.
2. Assert, by exact `toEqual` on `[artifactPath, amendment]` pairs: (a) one claim covering header through continuation; (b) seven claims, one per note, each with its full text; (c) one claim including the indented continuation; (d) one claim ending at the line before the blank line; (e) two claims each starting at its own header; (f) text equal to the header line joined to the continuation with `\n`, as before.
3. Verify RED: (a)–(e) fail against the current exact-form regex.
4. Implement in `coverage-binding-inputs.ts`: the `/^\s*(?:>\s*)?\*\*Amended\b/` header, the quoted and unquoted extent rules, and the new-header break, as in Technical Approach. Keep the raw-line `\n` join.
5. Verify GREEN, including the two existing `assembleAmendmentClaims` cases unchanged; commit "fix(coverage-binding): read every amendment-note header form".

**Done when:**
- [test] `coverage-binding-inputs.test.ts` asserts `assembleAmendmentClaims` returns exactly one claim with the ADR path and full note text for the `(#353, adr-…):` header and for each of the seven listed header forms, including the wrapped backticked-ADR header and the bold-closes-after-date header.
- [test] The same file asserts an indented list-nested quoted note yields one claim that includes its indented continuation line, and an unquoted `**Amended 2026-08-21 (operator).**` note yields one claim ending at the line before the blank line, excluding the following paragraph.
- [test] The same file asserts two amendment headers on consecutive lines of one quote yield two claims, each starting at its own header line.
- [test] The same file asserts the canonical `> **Amended 2026-09-24 by #100:**` note's claim text equals its header and continuation lines joined by `\n`, identical to the pre-change output, and the two pre-existing `assembleAmendmentClaims` cases pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/coverage-binding-inputs.ts` — header regex, note-extent rules in `amendmentBlocks`
- `src/conductor/test/engine/coverage-binding-inputs.test.ts` — header-form and extent cases

**Dependencies:** none

### Task 2: Fenced examples and non-amendment quotes never become claims
**Story:** Story 1 (negative paths 1–4)
**Type:** negative-path

**Steps:**
1. In `coverage-binding-inputs.test.ts`, write `assembleAmendmentClaims` cases:
   (a) an ADR containing `> **Amendment items 8 and 9 …**` and a quote line `> The rule — see **Amended 2026-09-01 by #5:** above`;
   (b) an ADR containing a backtick fence and a tilde fence, each holding `> **Amended 2026-10-01 (operator):** example` and an unquoted `**Amended 2026-10-01 by #7:** example`, plus one real quoted note after the fences;
   (c) an ADR whose `baseText` already contains `> **Amended 2026-07-06 (#353, adr-x):** inherited` and whose `text` adds `> **Amended 2026-10-09 (operator decision):** added` beside it;
   (d) a `planText` containing `> **Amended 2026-10-09 (operator decision):** …` beside an ADR artifact with no amendment note.
2. Assert: (a) no claims; (b) exactly one claim, the real note after the fences; (c) exactly one claim, the added note; (d) no claims.
3. Verify RED: (b) fails while fences are not tracked. If (a), (c), or (d) already pass after Task 1, commit them as regression guards.
4. Implement fence tracking in `amendmentBlocks` with the `parseAdrDecisions` opener grammar `^ {0,3}(\`{3,}|~{3,})`, closed by the same fence run. A fence line ends an open note, and fenced lines never start or continue a note.
5. Verify GREEN; commit "fix(coverage-binding): ignore fenced and non-amendment quotes".

**Done when:**
- [test] `coverage-binding-inputs.test.ts` asserts a quote led by `**Amendment items 8 and 9` and a quote line with `**Amended` after other text yield no claim from `assembleAmendmentClaims`.
- [test] The same file asserts amendment-shaped lines inside a backtick fence and inside a tilde fence yield no claim, while the real quoted note after the fences yields exactly one.
- [test] The same file asserts a non-canonical note byte-identical in `baseText` yields no claim, while the non-canonical note added beside it yields exactly one claim.
- [test] The same file asserts a non-canonical note in `planText` yields no claim.

**Files likely touched:**
- `src/conductor/src/engine/coverage-binding-inputs.ts` — fence tracking in `amendmentBlocks`
- `src/conductor/test/engine/coverage-binding-inputs.test.ts` — exclusion cases

**Dependencies:** Task 1

### Task 3: coverage_binding step judges a branch-added non-canonical amendment
**Story:** Story 2 (happy paths 1–2; negative path 1)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/step-runners.test.ts`, add a fixture helper modeled on `writeAmendmentCoverageInputs` that takes the artifact text. It uses `initializeAmendmentGitFixture`, so the architecture-review artifact is absent at the merge base, and the same one-task plan.
2. Case A: the artifact holds only `> **Amended 2026-10-09 (operator decision):** The service preserves the amended behavior.`, the judge is enabled, and the mock provider answers every issued amendment claim `not-carried` with `missingObligation: 'Add a preservation task.'`. Assert `runner.run('coverage_binding', …)` resolves `success: false` with `refusal.kind` `needs-human`, and its output contains the artifact path, `The service preserves the amended behavior.`, and `Add a preservation task.`.
3. Case B: same artifact, judge disabled. Assert success, `provider.invoke` not called, an envelope `entries` array with exactly one `kind: 'amendment'` entry with verdict `unjudged`, and exactly one `coverage_binding_amendment_judged` event with verdict `unjudged`.
4. Case C: the artifact holds the same note only inside a backtick fence, and the judge is enabled with a mock that answers any issued batch. Assert the envelope has no `kind: 'amendment'` entry and no `coverage_binding_amendment_judged` event is emitted.
5. Verify. Cases A and B fail against the pre-change recognizer. With Tasks 1–2 merged they may pass on first run, and this task then commits the integration proof only. Commit "test(coverage-binding): step judges non-canonical branch amendments".

**Done when:**
- [test] `step-runners.test.ts` asserts `coverage_binding` with the judge enabled refuses `needs-human` on a `not-carried` verdict for a branch-added `**Amended 2026-10-09 (operator decision):**` note, with output naming the artifact path, the note text, and `Add a preservation task.`.
- [test] The same file asserts that with the judge disabled the step succeeds without invoking the provider, records exactly one `amendment` envelope entry with verdict `unjudged`, and emits exactly one `coverage_binding_amendment_judged` event with verdict `unjudged`.
- [test] The same file asserts a note present only inside a fenced code block yields no `amendment` envelope entry and no `coverage_binding_amendment_judged` event with the judge enabled.

**Files likely touched:**
- `src/conductor/test/engine/step-runners.test.ts` — non-canonical amendment runner cases

**Dependencies:** Task 2

## Task Dependency Graph

```
Task 1 ──▶ Task 2 ──▶ Task 3
```

## Integration Points

- After Task 2: every DECIDE amendment-note form reaches `assembleAmendmentClaims`.
- After Task 3: the `coverage_binding` step, as the BUILD pipeline runs it through `DefaultStepRunner`, is proven to judge or record those notes. A plan that drops one is refused `needs-human` rather than skipped.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an ADR whose branch text adds a blockquoted note headed `**Amended 2026-07-06 (#353, adr-2026-07-06-example-fixture):**`, when amendment claims are assembled, then exactly one claim is produced carrying that ADR's path and the note's full text, header line through its last quoted line. | 1 | "returns exactly one claim with the ADR path and full note text for the `(#353, adr-…):` header" | diff-local |
| Story 1 happy: Given branch-added blockquoted notes headed with `by #N (qualifier):`, `by` followed by a backticked ADR stem and `(APPROVED) and` with the header wrapped onto the next quoted line, a bold span that closes right after the date (`**Amended 2026-07-03** by …`), `by operator decision (…)`, `during conflict-check:`, `by PR #N:`, and `by owner/repo#N (…)`, when amendment claims are assembled, then each note produces exactly one claim whose text is that whole note. | 1 | "for each of the seven listed header forms, including the wrapped backticked-ADR header and the bold-closes-after-date header" | diff-local |
| Story 1 happy: Given a branch-added amendment blockquote indented under a list item, whose header and continuation lines each begin with spaces before `>`, when amendment claims are assembled, then one claim is produced whose text includes every indented continuation line. | 1 | "an indented list-nested quoted note yields one claim that includes its indented continuation line" | diff-local |
| Story 1 happy: Given a branch-added unquoted line beginning `**Amended 2026-08-21 (operator).**` followed by continuation lines and then a blank line, when amendment claims are assembled, then one claim is produced whose text is that line through the last line before the blank line, and nothing after it. | 1 | "yields one claim ending at the line before the blank line, excluding the following paragraph" | diff-local |
| Story 1 happy: Given two branch-added amendment headers on consecutive lines of one blockquote, when amendment claims are assembled, then two claims are produced, each starting at its own header. | 1 | "two amendment headers on consecutive lines of one quote yield two claims, each starting at its own header line" | diff-local |
| Story 1 happy: Given a branch-added note in the canonical `**Amended 2026-09-24 by #100:**` form with a continuation line, when amendment claims are assembled, then its claim text is identical to the text produced before this change. | 1 | "identical to the pre-change output" | diff-local |
| Story 1 negative: Given a blockquote whose first line begins `**Amendment items 8 and 9`, or a quoted line where `**Amended` appears after other text on that line, when amendment claims are assembled, then neither produces a claim. | 2 | "a quote led by `**Amendment items 8 and 9` and a quote line with `**Amended` after other text yield no claim" | diff-local |
| Story 1 negative: Given an amendment-shaped line with a real date inside a fenced code block delimited by backticks or by tildes, when amendment claims are assembled, then it produces no claim. | 2 | "amendment-shaped lines inside a backtick fence and inside a tilde fence yield no claim" | diff-local |
| Story 1 negative: Given a non-canonical amendment note that is byte-identical in the artifact's merge-base text, when amendment claims are assembled, then it produces no claim, while a different non-canonical note added beside it on the branch still produces one. | 2 | "a non-canonical note byte-identical in `baseText` yields no claim, while the non-canonical note added beside it yields exactly one claim" | diff-local |
| Story 1 negative: Given a non-canonical amendment note in the plan itself, when amendment claims are assembled, then it produces no claim, because D18 excludes the plan's own amendments. | 2 | "a non-canonical note in `planText` yields no claim" | diff-local |
| Story 2 happy: Given a feature branch whose architecture-review artifact, absent at the merge base, contains only an amendment note headed `**Amended 2026-10-09 (operator decision):**`, with the judge enabled and returning `not-carried` with a missing obligation, when the `coverage_binding` step runs, then it refuses `needs-human` and its output names the artifact path, the note's text, and the missing obligation. | 3 | "refuses `needs-human` on a `not-carried` verdict for a branch-added `**Amended 2026-10-09 (operator decision):**` note, with output naming the artifact path, the note text, and `Add a preservation task.`" | diff-local |
| Story 2 happy: Given the same branch with the judge disabled, when the `coverage_binding` step runs, then it completes without invoking the provider, its envelope records one `amendment` entry with verdict `unjudged`, and one `coverage_binding_amendment_judged` event with verdict `unjudged` is emitted. | 3 | "succeeds without invoking the provider, records exactly one `amendment` envelope entry with verdict `unjudged`, and emits exactly one `coverage_binding_amendment_judged` event with verdict `unjudged`" | diff-local |
| Story 2 negative: Given a feature branch whose architecture-review artifact contains an amendment-shaped line only inside a fenced code block, with the judge enabled, when the `coverage_binding` step runs, then the envelope records no `amendment` entry and no `coverage_binding_amendment_judged` event is emitted. | 3 | "yields no `amendment` envelope entry and no `coverage_binding_amendment_judged` event with the judge enabled" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
