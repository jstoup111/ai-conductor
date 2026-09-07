# Conflict Check: Coherence accepts plans that cannot deliver sealed outcomes (engine half, #2419)

**Date:** 2026-09-07
**Inventory:** all 423 story files, the 4 coherence-criterion story files compared semantically
(`a-coverage-claim-can-name-a-task-whose-done-when-d`, `coherence-rows-assert-story-task-coverage-that-not`,
`coherence-artifact-passes-engineer-land-then-block`, and the new file); prior conflict reports in
`.docs/conflicts/` scanned for the coherence family.
**ADR corpus:** `conflict_check.adr_corpus: repo_wide`. All 309 `adr-*.md` examined by Decision
section. Narrowed by subject overlap (coherence artifact shape, criterion layer, gap-id vocabulary,
ADR-decision citation, halt/routing ownership) to 13 examined in full:
`adr-2026-07-22-coherence-gate-placement-and-validation-split`,
`adr-2026-07-22-coherence-waiver-and-duplicate-claim`, `adr-2026-07-26-daemon-decide-preseed-ownership`,
`adr-2026-08-08-single-adr-approval-parser-three-rungs`, `adr-2026-08-09-adr-layer-gated-by-committed-adr-signal`,
`adr-2026-08-22-one-owner-per-review-question`, `adr-2026-08-23-criterion-layer-is-structural-at-land`,
`adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`, `adr-2026-08-23-diff-locality-is-an-authored-disposition`,
`adr-2026-08-24-evidentiary-defects-are-not-waivable`, `adr-2026-08-26-shared-coherence-parser-at-discovery`,
`adr-2026-08-30-shared-plan-task-reference-resolver`, `adr-2026-08-31-coverage-binding-judge-step`,
`adr-2026-09-02-adr-decision-citability-contract`. The remaining 296 were narrowed out as
subject-disjoint (build_review rubrics, daemon lifecycle, release gating, telemetry, self-host,
provider routing, wiring/reachability, retrospectives, etc.). Supersession parsing at this scope:
6 ADRs carry `Status: SUPERSEDED` and none of them touches this subject; 7 ADRs mention partial
supersession and were retained — none touches this subject either.
**Result:** **PASS — zero blocking conflicts.** One degrading conflict found; disposition below.

## Conflict: An earlier story pins the criterion-row cell count as exactly six

**Stories involved:** "A coherence rejection names the defect and its line" (Story 3) vs "The shared
parser accepts an optional correction cell on a failing criterion row" (Story 1)
**Files:** `.docs/stories/coherence-artifact-passes-engineer-land-then-block.md` vs
`.docs/stories/coherence-accepts-plans-that-cannot-deliver-sealed.md`
**Type:** overlap
**Severity:** degrading
**Confidence:** 90% — the earlier criterion is illustrative of the detail's *shape* (expected vs
actual), but its literal parenthetical `(6)` no longer describes the grammar once seven cells are
legal.

**Earlier story sentence (verbatim):** "Given an artifact whose row 12 is a five-cell `criterion`
row, when parsing fails, then the failure carries the line number and states the expected cell
count (6) versus the actual (5)"
**New story sentence (verbatim):** "`parseCoherenceArtifact` accepts `criterion` rows of six or
seven cells and rejects any other count with the existing cell-count detail"

**Description:** Both stories agree a five-cell criterion row fails with a line number and an
expected-versus-actual cell-count detail. They diverge only on what "expected" says: `6` in the
earlier story, `6 or 7` after this feature. Both directions checked: satisfying the new story keeps
the earlier story's line-number, reason-id, and expected-vs-actual assertions true and changes only
the literal number; satisfying the earlier story literally would forbid the seventh cell. One "no",
so this is an overlap, not an oscillation.

**Resolution Options:**
1. Accept as degrading: the detail message reads `criterion row expected 6 or 7 and actual 5`; the
   earlier story's parenthetical is treated as illustrative. No artifact edit.
2. Reword the earlier story's parenthetical to `(6 or 7)` in a companion main-based PR (the land
   stem gate rejects foreign-stem story edits on this branch).
3. Keep the detail message literally `expected 6` and mention 7 elsewhere — misleading; rejected.

**Recommendation:** Option 1 was recommended; the operator selected **Option 2** (2026-09-07).
**Resolution:** the earlier story's parenthetical is reworded to `(6 or 7)` in a companion
main-based PR (jstoup111/ai-conductor#2421, branch `spec-companion/2419-criterion-cell-count`), keeping the corpus of accepted stories
literally true once this feature ships. No story on this branch is edited.

## ADR-versus-story pairs examined (no conflict)

- `adr-2026-08-31-coverage-binding-judge-step` D1 ("6-cell `criterion` row (unchanged shape)") vs
  new Story 1 — resolved in the same change set by that ADR's additive D10/D11 amendment, which
  states D1 is widened, not replaced. Not recorded as a conflict: the amendment precedes the stories.
- `adr-2026-08-24-evidentiary-defects-are-not-waivable` vs new Story 4 — consistent: malformed
  correction cells reuse the non-waivable `unparseable-criterion-row`; the three new ids are coverage
  gaps and waivable.
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` / `adr-2026-08-26` gap-id stability vs new
  Story 2 — consistent: `criterion:verdict:<n>` is preserved for rows without the cell; new ids are
  additive.
- `adr-2026-08-22-one-owner-per-review-question` and `adr-2026-08-31` D6 vs new Story 5 — consistent:
  the correction is a label; nothing routes or appends.
- `adr-2026-09-02-adr-decision-citability-contract` D1 vs new Story 3 — consistent: decision ids
  come only from `parseAdrDecisions`.

## Story-versus-story pairs examined (no conflict)

- `a-coverage-claim…` Story 1 negative ("quote nowhere in cited task → `criterion:quote-ungrounded`,
  existing id unchanged") vs new Story 2 — consistent; a `fail`+correction row with an ungrounded
  quote reports both the cannot-deliver gap and the quote gap, as a `fail` row does today.
- `coherence-rows-assert…` Story 5 ("verdict outside closed vocabulary → malformed") vs new Story 1
  negatives — same rule extended to the seventh cell.
- `coherence-rows-assert…` Story 4 / `coherence-artifact-passes…` Story 2 (zero-criterion-row
  artifacts stay eligible) vs new Story 5 — new Story 5 restates the invariant.
- New Story 1 ("seventh cell on a `covered` row is unparseable") vs new Story 5
  (`coverage_binding` reads a seven-cell row) — no oscillation: a seven-cell row that reaches a
  merged artifact is by construction a `fail` row landed under a waiver.
