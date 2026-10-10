# Implementation Plan: ATX-numbered ADR decision headings are citable

**Date:** 2026-10-09
**Design:** none (technical track, Tier S — see `.docs/track/atx-numbered-adr-decision-headings-are-uncitable-s.md`)
**Stories:** .docs/stories/atx-numbered-adr-decision-headings-are-uncitable-s.md
**Conflict check:** Not required (Tier S)

## Summary

Make an ADR decision headed `### <n>. <title>` a citable decision. Three tasks: widen the shared
decision parser and its corpus guard, prove the land citability rung and the coherence obligation
table accept such an ADR, and teach the as-built projection's decision-text lookup the same heading
form.

## Technical Approach

- **One additive regex in the single parsing authority.** `parseAdrDecisions` in
  `src/conductor/src/engine/artifacts.ts` matches a numbered decision start with
  `/^\s*\*{0,2}(\d+)\.\s+\S/`, which cannot step over a leading `###`. Change it to
  `/^\s*(?:#{1,6}\s+)?\*{0,2}(\d+)\.\s+\S/`. The ATX prefix is optional, so every line the old pattern
  matched still matches and no id is lost. The `\.\s+\S` tail is unchanged, so `### 2.1 Sub-point`
  does not match, and `### 12.` still answers only for 12. The rest of the function is unchanged:
  fenced-block stripping, the `## Decision` section bounds, blockquote stripping, and
  passage collection. Update the function's doc comment to name the ATX-numbered form among the
  accepted shapes.
- **Selected over two alternatives.** (a) Renaming the 16 affected ADRs' headings to `### D<n> —`
  form, or backfilling a `D<n>` index, rewrites APPROVED ADRs. It contradicts the issue's "without
  renaming its headings" outcome and the backwards-compatibility constraint in
  adr-2026-09-02-adr-decision-citability-contract. (b) A heading-precedence parser would ignore list
  items once ATX-numbered headings are present. That changes which passages and ids existing ADRs
  yield, so it fails the "already-accepted forms are unaffected" outcome. The additive regex
  delivers that ADR's decision 2, which already names ATX `###`-heading decisions as accepted.
- **Every consumer inherits the parser change.** The land citability rung
  (`engineer/land-spec.ts`), the coherence obligation-id set (`engineer/coherence-validator.ts`,
  `collectArchitectureDecisionIds`), coverage_binding's required decision ids (`step-runners.ts`),
  the conflict claims (`coverage-binding-conflict-inputs.ts`), and as-built reference resolution
  (`as-built-contract.ts`) all read `parseAdrDecisions(...).ids`. None needs a code change. Task 2
  proves the land boundary end to end through `landSpec`.
- **The one parallel grammar.** `decisionText` in `src/conductor/src/engine/as-built-projection.ts`
  has its own regexes: `declaration`, `nextDeclaration`, and the first-line prefix strip. Each
  gains the same optional `#{1,6}\s+` prefix ahead of the numbered alternative, so a cited
  ATX-numbered decision projects its own heading body. The body is bounded at the next decision
  start, and the projection no longer falls back to the `Decision <n>` placeholder. The first
  matching declaration still wins (`findIndex`), so an ATX heading takes precedence over a later
  #2140 `D<n>` index line for the same id. Moving `decisionText` onto the shared parser is out of
  scope (track scope boundary). `decisionText` predates this feature and extracts text only. The projected ids still come
  from `parseAdrDecisions`, so adr-2026-09-02-adr-decision-citability-contract's id authority
  (decision 1, D6.1) is unchanged; consolidating the two readers is separate follow-up work.
- **Measured blast radius.** A replay of both patterns over all 339 `.docs/decisions/adr-*.md` files
  changes 16 parses, each only by adding heading starts. The id set grows for three ADRs and is
  unchanged for the other thirteen, which already carry a #2140 `D<n>` index. Numbered list items nested inside an ATX-numbered decision
  still start their own passages, exactly as under every other accepted shape. Only
  `adr-2026-08-09-operator-only-scoped-artifact-reseal` decision 4 has such items, and they are
  excluded by the scope boundary.
- No CLI, hook, schema, settings, or skill surface changes, so no migration block or release waiver
  is needed.

## Prerequisites

- None.

## Tasks

### Task 1: Parser accepts ATX-numbered decision headings; corpus guard sees them
**Story:** Story 1 (happy paths 1–3; negative paths 1–3)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/engine/artifacts.test.ts` `describe('parseAdrDecisions')`, add failing tests:
   (a) a `## Decision` section with `### 1. First`, `### 2. Second`, `### 3. Third` (each followed by a body line) returns `ids` equal to `{'1','2','3'}` and `passages.get('2')![0]` starts with `### 2. Second`;
   (b) add `['ATX-numbered heading', '### 4. Termination']` and `['emphasized ATX-numbered heading', '### **4. Termination.**']` rows to the existing `it.each` shape table that expects id `4`;
   (c) `### 12. Twelfth` alone returns `ids` equal to `{'12'}`;
   (d) `### 2.1 Sub-point` plus `### Step 1. Prepare` returns an empty `ids` set;
   (e) `### 5. Fifth` only inside a fenced code block in `## Decision`, and again only under a following `## Consequences` heading, returns `ids` without `'5'`.
2. In `src/conductor/test/engine/adr-decision-corpus.test.ts`, widen the "leaves no numbered decision in an APPROVED ADR uncitable" pattern from `/^\s*[*_]{0,2}(\d+)\.\s+\S/gm` to `/^\s*(?:#{1,6}\s+)?[*_]{0,2}(\d+)\.\s+\S/gm`. Leave the frozen `legacyResolvableDecisionIds` predicate and its test untouched.
3. Verify RED. Tests (a), (b), and the widened corpus guard fail, and the corpus guard names `adr-2026-08-13-stable-build-review-finding-dispositions.md`.
4. In `parseAdrDecisions` (`src/conductor/src/engine/artifacts.ts`), change `numberedItem` to `decisionLine.match(/^\s*(?:#{1,6}\s+)?\*{0,2}(\d+)\.\s+\S/)`. Extend the doc comment's accepted-forms sentence with ATX-numbered headings (`### 4. Termination`). Keep the existing `\*{0,2}`-before-the-digit comment.
5. Verify GREEN; commit "fix(artifacts): accept ATX-numbered ADR decision headings as citable ids".

**Done when:**
- [test] `artifacts.test.ts` asserts `parseAdrDecisions` returns ids `{'1','2','3'}` for `### 1.`–`### 3.` headings with `passages.get('2')[0]` starting `### 2. Second`, and id `4` for both `### 4. Termination` and `### **4. Termination.**`.
- [test] `artifacts.test.ts` asserts `parseAdrDecisions` returns exactly `{'12'}` for `### 12. Twelfth`, an empty id set for `### 2.1 Sub-point` plus `### Step 1. Prepare`, and no id `'5'` for `### 5. Fifth` inside a fenced block or under `## Consequences`.
- [test] `adr-decision-corpus.test.ts`'s numbered-decision guard matches ATX-numbered headings and passes over the real repository ADR corpus, so every ATX heading number in an APPROVED ADR's Decision section is a citable id of its ADR.
- [test] `adr-decision-corpus.test.ts`'s frozen-predicate test, unchanged, still passes, so every id the legacy predicate resolved for each ADR is still returned by `parseAdrDecisions`.
- Every pre-existing `parseAdrDecisions` test in `artifacts.test.ts` passes unchanged.

**Files likely touched:**
- `src/conductor/src/engine/artifacts.ts` — `numberedItem` regex and doc comment in `parseAdrDecisions`
- `src/conductor/test/engine/artifacts.test.ts` — ATX-numbered happy and negative cases
- `src/conductor/test/engine/adr-decision-corpus.test.ts` — widened numbered-decision guard pattern

**Dependencies:** none

### Task 2: Land accepts an amended ATX-numbered ADR and requires one obligation row per heading
**Story:** Story 2 (happy paths 1–2; negative paths 1–2)
**Type:** happy-path

This task owns the integration proof through the `landSpec` entry point (the `compose land` / engineer land boundary). The behavior is delivered by Task 1's parser; these tests exercise the land citability rung and the coherence obligation gate as wired today. If one fails after Task 1, fix the consumer wiring here.

**Steps:**
1. In `src/conductor/test/engine/engineer/land-spec.test.ts` `describe('landSpec ADR citability gate (Task 6)')`, follow the existing "rejects an edited ADR made uncitable" pattern. Commit `adr-existing.md` to the base repo with headings `### 1. First`, `### 2. Second`, `### 3. Third`, each with a body line and `**Status:** Approved`. Then, in the seeded worktree, change only a body line (no heading renamed), commit, and assert `landSpec(...)` resolves to `{ slug: 'dep-bump' }`.
2. In the same describe, add a test where the worktree edit replaces `adr-existing.md`'s Decision section with an unnumbered `### Approach` heading over prose. Assert `landSpec(...)` rejects with `/no citable decision.*adr-existing\.md/i`.
3. In `src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts`, add an optional `adr` override to `seedWorktree` (default `APPROVED_ADR`) that is written to `decisions/adr-2026-09-08-coherence.md`. Add `ATX_APPROVED_ADR` with `**Status:** APPROVED` and decisions `### 1. Keep coherence validation at land time.` and `### 2. Refuse uncovered decisions.`. Build the plan by appending `| adr-2026-09-08-coherence#D2 | task | task-1 | Given an unmapped outcome, when land validates, then it is rejected. |` after the existing `#D1` row. Assert `landSpec(...)` resolves for that M-tier chain. Then remove the `#D2` row and assert it rejects with `/adr-2026-09-08-coherence#D2 \(missing\)/i`.
4. Run the three files; commit "test(land): ATX-numbered ADR lands and binds one obligation row per heading".

**Done when:**
- [test] `land-spec.test.ts` asserts `landSpec` resolves with slug `dep-bump` when the spec diff modifies the body of an APPROVED `adr-existing.md` headed `### 1.`–`### 3.` with no heading renamed, so the citability rung does not refuse it.
- [test] `land-spec.test.ts` asserts `landSpec` rejects with "no citable decision" naming `adr-existing.md` when the modified APPROVED ADR's Decision section has only prose under an unnumbered `### Approach` heading.
- [test] `decide-artifact-coherence-check.acceptance.test.ts` asserts `landSpec` resolves for an M-tier chain whose added APPROVED ADR is headed `### 1.` and `### 2.` and whose Architecture Obligation Coverage table has one valid row each for `adr-2026-09-08-coherence#D1` and `#D2`.
- [test] The same suite asserts `landSpec` rejects that chain with `adr-2026-09-08-coherence#D2 (missing)` when the `#D2` row is removed.

**Files likely touched:**
- `src/conductor/test/engine/engineer/land-spec.test.ts` — amended ATX-numbered ADR lands; unnumbered heading refused
- `src/conductor/test/acceptance/decide-artifact-coherence-check.acceptance.test.ts` — `adr` seed override; per-heading obligation rows

**Dependencies:** Task 1

### Task 3: As-built resolution and projection carry ATX-numbered decisions
**Story:** Story 3 (happy paths 1–2; negative paths 1–2)
**Type:** happy-path

**Steps:**
1. In `src/conductor/test/as-built-projection.test.ts`, add a test modeled on "projects a governing decision declaration, its full body, and additive amendments in document order". Write `adr-plan-one.md` as `Status: APPROVED` with `### 1. First decision.`, `### 2. Second decision.` with the body line `Its body stays with decision two.` on the very next line (no blank line between), `### 3. Third decision.`, and `### 4. Fourth decision.`. Assert the projected `governingAdrs` entry for `adr-plan-one` has decisions with ids `['1','2','3','4']`, and that decision `2`'s text equals `'Second decision.\nIts body stays with decision two.'`.
2. Add a second projection test: `adr-plan-one.md` with `### 1. First decision.`, `### 2. Second decision.`, then a decision-index line `**D1** — First summary.` Assert decisions equal `[{ id: '1', text: 'First decision.' }, { id: '2', text: 'Second decision.' }]`.
3. In `src/conductor/test/as-built-contract.test.ts`, extend `governingReferenceFixture` with `adr-atx.md` (`Status: APPROVED`, decisions `### 1. One.` through `### 4. Four.`). Assert `resolveAsBuiltReferences` returns `{ ok: true, verdict }` for a BLOCKED verdict whose REMEDIABLE finding cites `{ kind: 'adr-decision', stem: 'adr-atx', decision: 4 }`. Assert that a citation of decision `9` returns `{ ok: false, field: 'findings[0].reference.decision', requirement: 'one of ADR adr-atx declared decision ids 1, 2, 3, 4 is required' }`.
4. Verify RED for the projection tests.
5. In `decisionText` (`src/conductor/src/engine/as-built-projection.ts`), add the optional ATX prefix to the numbered alternative in three places. `declaration` becomes `^\s*(?:(?:#{1,6}\s+)?\*{0,2}${id}\.\s+|#{0,6}\s*\*{0,2}D${id}(?!\.)\b)`. `nextDeclaration` becomes `^\s*(?:(?:#{1,6}\s+)?\*{0,2}\d+\.\s+|#{0,6}\s*\*{0,2}D\d+(?!\.)\b)`. The first-line strip becomes `^\s*(?:(?:#{1,6}\s+)?\*{0,2}\d+\.\s+|#{0,6}\s*\*{0,2}D\d+\s*[—:-]?\s*)`. Leave the amendment and `Amended` boundaries unchanged.
6. Verify GREEN; commit "fix(as-built): project ATX-numbered ADR decision text".

**Done when:**
- [test] `as-built-contract.test.ts` asserts `resolveAsBuiltReferences` returns `{ ok: true, verdict }` unchanged for a REMEDIABLE finding citing decision 4 of an APPROVED ADR headed `### 1.`–`### 4.`.
- [test] `as-built-contract.test.ts` asserts that citing decision 9 of that ADR returns field `findings[0].reference.decision` with requirement `one of ADR adr-atx declared decision ids 1, 2, 3, 4 is required`.
- [test] `as-built-projection.test.ts` asserts `buildAsBuiltProjection` projects ids `1`–`4` for the ATX-numbered ADR and decision `2`'s text equals `'Second decision.\nIts body stays with decision two.'`, with no `### 2. ` prefix and no text of decision 3.
- [test] `as-built-projection.test.ts` asserts that when a `**D1** — First summary.` index line follows the `### 1.` heading, decision 1 is projected once with text `'First decision.'`, not the index summary.
- The existing `as-built-projection.test.ts` decision-text tests, covering numbered items, additive `D<n>.<m>` amendments, and blockquoted amendments, pass unchanged.

**Files likely touched:**
- `src/conductor/src/engine/as-built-projection.ts` — `decisionText` declaration, boundary, and prefix-strip regexes
- `src/conductor/test/as-built-projection.test.ts` — ATX-numbered projection cases
- `src/conductor/test/as-built-contract.test.ts` — ATX-numbered resolution cases

**Dependencies:** Task 1

## Task Dependency Graph

```
Task 1 ──┬──▶ Task 2
         └──▶ Task 3
```

## Integration Points

- After Task 1: every `parseAdrDecisions` consumer returns ATX-numbered ids, including land, coherence, coverage_binding, conflict claims, and as-built resolution.
- After Task 2: `landSpec` lands an amended ATX-numbered ADR and binds one obligation row per heading.
- After Task 3: `buildAsBuiltProjection` and `resolveAsBuiltReferences` carry and resolve ATX-numbered decisions.

## Coverage Check

| Criterion | Task id(s) | Done when quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given an ADR whose `## Decision` section heads its decisions `### 1. First`, `### 2. Second`, and `### 3. Third`, when the decision parser reads it, then it returns the decision ids 1, 2, and 3, and the passage recorded for id 2 begins with the `### 2. Second` heading line. | 1 | "asserts `parseAdrDecisions` returns ids `{'1','2','3'}` for `### 1.`–`### 3.` headings with `passages.get('2')[0]` starting `### 2. Second`" | diff-local |
| Story 1 happy: Given an ADR whose `## Decision` section contains the heading `### **4. Termination.**`, when the decision parser reads it, then it returns decision id 4. | 1 | "id `4` for both `### 4. Termination` and `### **4. Termination.**`" | diff-local |
| Story 1 happy: Given the APPROVED ADRs in the repository's ADR corpus, when the corpus compatibility guard runs, then every number that opens an ATX heading in an ADR's `## Decision` section is one of that ADR's citable decision ids, and every id the pre-change parser returned for each ADR is still returned. | 1 | "so every ATX heading number in an APPROVED ADR's Decision section is a citable id of its ADR" | diff-local |
| Story 1 negative: Given an ADR whose `## Decision` section contains only the heading `### 12. Twelfth`, when the decision parser reads it, then the returned ids are exactly 12, never 1 or 2. | 1 | "returns exactly `{'12'}` for `### 12. Twelfth`" | diff-local |
| Story 1 negative: Given an ADR whose `## Decision` section contains only the headings `### 2.1 Sub-point` and `### Step 1. Prepare`, when the decision parser reads it, then it returns no decision id. | 1 | "an empty id set for `### 2.1 Sub-point` plus `### Step 1. Prepare`" | diff-local |
| Story 1 negative: Given an ADR whose only `### 5. Fifth` headings sit inside a fenced code block in the `## Decision` section or under a later `## Consequences` section, when the decision parser reads it, then it returns no decision id 5. | 1 | "no id `'5'` for `### 5. Fifth` inside a fenced block or under `## Consequences`" | diff-local |
| Story 2 happy: Given a spec worktree whose diff modifies an existing APPROVED ADR whose decisions are headed `### 1. First` through `### 3. Third`, with no heading renamed, when the spec is landed, then the land gate does not refuse the ADR as uncitable and the land completes, returning the spec's slug. | 2 | "asserts `landSpec` resolves with slug `dep-bump` when the spec diff modifies the body of an APPROVED `adr-existing.md` headed `### 1.`–`### 3.` with no heading renamed, so the citability rung does not refuse it" | diff-local |
| Story 2 happy: Given a Medium-tier spec whose diff adds an APPROVED ADR whose decisions are headed `### 1. First` and `### 2. Second`, and whose plan's Architecture Obligation Coverage table has one valid row each for `<adr-stem>#D1` and `<adr-stem>#D2`, when the spec is landed, then the coherence gate accepts the obligation coverage and the land completes. | 2 | "asserts `landSpec` resolves for an M-tier chain whose added APPROVED ADR is headed `### 1.` and `### 2.` and whose Architecture Obligation Coverage table has one valid row each for `adr-2026-09-08-coherence#D1` and `#D2`" | diff-local |
| Story 2 negative: Given the same Medium-tier spec with the `<adr-stem>#D2` row removed from the Architecture Obligation Coverage table, when the spec is landed, then the land is refused with an error naming `<adr-stem>#D2 (missing)`. | 2 | "asserts `landSpec` rejects that chain with `adr-2026-09-08-coherence#D2 (missing)` when the `#D2` row is removed" | diff-local |
| Story 2 negative: Given a spec worktree whose diff modifies an APPROVED ADR whose `## Decision` section has only prose under an unnumbered `### Approach` heading, when the spec is landed, then the land is refused with the "no citable decision" error naming that ADR file. | 2 | "naming `adr-existing.md` when the modified APPROVED ADR's Decision section has only prose under an unnumbered `### Approach` heading" | diff-local |
| Story 3 happy: Given an APPROVED ADR whose decisions are headed `### 1.` through `### 4.`, when an as-built BLOCKED verdict carries a REMEDIABLE finding whose governing reference is that ADR's decision 4, then as-built reference resolution accepts the verdict unchanged. | 3 | "asserts `resolveAsBuiltReferences` returns `{ ok: true, verdict }` unchanged for a REMEDIABLE finding citing decision 4 of an APPROVED ADR headed `### 1.`–`### 4.`" | diff-local |
| Story 3 happy: Given a plan that cites that ADR, when the as-built projection is built, then the ADR's projected governing decisions are ids 1, 2, 3, and 4, and decision 2's text is its heading title and body without the `### 2. ` prefix and without any text of decision 3. | 3 | "asserts `buildAsBuiltProjection` projects ids `1`–`4` for the ATX-numbered ADR and decision `2`'s text equals `'Second decision.\nIts body stays with decision two.'`, with no `### 2. ` prefix and no text of decision 3" | diff-local |
| Story 3 negative: Given the same ADR, when an as-built finding cites its decision 9, then resolution rejects the verdict at field `findings[0].reference.decision` with the requirement naming declared decision ids `1, 2, 3, 4`. | 3 | "asserts that citing decision 9 of that ADR returns field `findings[0].reference.decision` with requirement `one of ADR adr-atx declared decision ids 1, 2, 3, 4 is required`" | diff-local |
| Story 3 negative: Given an APPROVED ADR that heads decision 1 `### 1. First` and later carries a decision index line `**D1** — First summary.`, when the as-built projection is built, then decision 1 is projected once and its text is the `### 1.` heading's title and body, not the index summary. | 3 | "decision 1 is projected once with text `'First decision.'`, not the index summary" | diff-local |

## Verification

- [ ] All happy path criteria covered by at least one task
- [ ] All negative path criteria covered by at least one task
- [ ] No task exceeds 5 minutes of work
- [ ] Every task has a `Done when:` block of falsifiable checks; no unbounded quality word is left without its closed enumeration or named mechanism (3c)
- [ ] Dependencies are explicit and acyclic
