**Status:** Accepted

# Stories: tautology-rubric-grades-diff-required-fixture-relo

Source: jstoup111/ai-conductor#1545. Technical track, Tier S.
Scope boundary (binding, operator-confirmed): prompt-only. The grader prompt's closed
Tautology exception list in `src/conductor/src/engine/build-review-prompt.ts` gains a
third entry for fixture relocations required by the same diff. No new engine evidence
channel — the deterministic relocation-evidence deriver is a separate follow-up intake.

## Story 1: Third closed-list Tautology exception for diff-required fixture relocations

**Requirement:** #1545 outcomes 1 and 4

As the build_review gate, I want the grader prompt to carry a third closed-list
Tautology exception for fixture relocations required by the same diff, so that a
feature whose only Tautology findings are diff-required relocations reaches PASS
without an operator override.

### Acceptance Criteria

#### Happy Path
- Given any `BuildReviewInputs`, when `buildGraderPrompt` assembles the prompt, then
  the Tautology exceptions section enumerates exactly three closed-list entries and
  the third is fixture relocation, defined by a per-test predicate requiring all of:
  (a) the changed test's diff shows a rename/relocation of a fixture path, including
  the observed fixture-construction form where a removed `writeFile(oldPath, content)`
  is replaced by directory creation plus `writeFile(newPath, content)` with the same
  content even though Git emits no rename headers, as well as tracked-fixture
  `rename from`/`rename to`/`similarity index` headers or equivalent delete-plus-create
  evidence, (b) the same
  diff's production hunks change path-classification or path-handling behavior that
  forces the old fixture path to lose its pre-diff meaning, and (c) the changed test
  adds no new behavioral assertion beyond the path move.
- Given the concrete `c.md` → `docs/c.md` fixture-construction hunk from #1545 and
  the same diff's root-markdown classifier inversion, when the grader applies entry 3,
  then it is explicitly instructed that the absence of Git rename headers does not
  disqualify the relocation and that this test must not receive a Tautology finding
  solely because its relocated form also passes pre-diff.
- Given the assembled prompt, when the exceptions section is read, then the closed-list
  framing sentence ("A changed test qualifying under neither exception is measured
  normally" or its updated three-entry equivalent) still declares the list closed and
  still ends with the measured-normally fallback.

#### Negative Paths
- Given a prompt assembled with empty/absent `removalContext`, `repairContext`, and
  `acceptedWidenings`, when the exceptions section is rendered, then the relocation
  exception text is still present and identical — it derives from the diff itself, not
  from any evidence block, so no input combination suppresses or alters it.
- Given the assembled prompt, when the relocation exception text is inspected, then it
  contains no wording that exempts a whole diff ("per changed test, never per diff"
  scoping is stated for the relocation entry just as it is for removal maintenance).

### Done When
- [ ] `buildGraderPrompt` output contains a three-entry closed Tautology exception list;
      entry 3 states the relocation predicate with all three conditions (a)-(c), including
      the observed in-code fixture-construction relocation form.
- [ ] A unit test in `src/conductor/test/engine/build-review-prompt.test.ts` asserts the
      third entry's presence, its three conditions, the no-rename-header fixture form,
      and the retained closed-list + measured-normally framing.
- [ ] Existing build-review-prompt tests still pass unchanged except where they assert
      the exception list is exactly two entries.

## Story 2: Non-required relocations still fail Tautology

**Requirement:** #1545 outcome 2

As the build_review gate, I want the relocation exception to be inapplicable when the
diff does not force the move or the test adds behavioral assertions, so that gratuitous
fixture moves keep failing Tautology exactly as today.

### Acceptance Criteria

#### Happy Path
- Given the assembled prompt, when the relocation entry is read, then it explicitly
  instructs that a relocation whose old path retains its pre-diff meaning (no
  production hunk in the same diff changes how that path is classified or handled) does
  NOT qualify and is measured normally.

#### Negative Paths
- Given the assembled prompt, when the relocation entry is read, then it explicitly
  instructs that a relocated test which also adds a new behavioral assertion is still
  measured normally on that assertion — mirroring the removal-maintenance condition
  (3) wording, so the exception can never launder new untested assertions.
- Given the assembled prompt, when the full Tautology rubric item is read, then rubric
  item 1's universal rule ("every new/changed test would fail without the diff")
  is unchanged — the exception narrows findings, never the rubric definition.

### Done When
- [ ] Prompt text states the non-qualifying conditions (unforced move; added behavioral
      assertion) inside the relocation entry.
- [ ] A unit test asserts both non-qualifying conditions appear in the rendered prompt.
- [ ] Rubric item 1 wording is byte-identical to the current text.

## Story 3: Distinguishing evidence cited in the persisted verdict

**Requirement:** #1545 outcome 3

As an operator reading `.pipeline/build-review.json`, I want any relocation the grader
exempted or failed to carry the diff evidence it used, so that I can tell a
diff-required relocation from a gratuitous one from the persisted verdict alone.

### Acceptance Criteria

#### Happy Path
- Given the assembled prompt, when the relocation entry is read, then it instructs the
  grader: for every changed test evaluated under the relocation exception (whether
  exempted or not), append one `[relocation-audit]` entry to `reasons` naming the
  disposition (`EXEMPTED` or `MEASURED`), old path → new path, and the production
  hunk(s) that do or do not force the move. This audit entry is required on PASS and
  FAIL and is explicitly evidence rather than a failing-rubric summary.
- Given a PASS verdict containing one or more evaluated relocations, when the verdict
  contract is read, then `reasons` is required to contain the corresponding audit
  entries even though it may remain empty for a PASS with no evaluated relocations.

#### Negative Paths
- Given the assembled prompt, when the verdict schema block is read, then the JSON
  schema in the prompt is unchanged — no new keys — so downstream verdict parsing
  (`artifacts.ts` findings handling) is untouched; audit evidence is prose inside the
  existing `reasons` strings, while `findings` remains reserved for actual failures
  and remains omitted/empty on PASS.
- Given the full verdict-writing instructions, when their `reasons` semantics are read,
  then they do not also state that every `reasons` entry must summarize a failing rubric;
  the general failure-summary rule explicitly permits the relocation-audit addition.

### Done When
- [ ] Prompt instructs per-relocation audit citation (disposition, old path, new path,
      forcing hunk or its absence) inside `reasons` on PASS and FAIL.
- [ ] A unit test asserts the citation instruction, the non-conflicting `reasons`
      semantics, failure-only `findings`, and the unchanged schema line.
