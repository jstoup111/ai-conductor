# Conflict Report: coverage claims bound to `Done when` (#2088)

**Date:** 2026-08-31
**Stories checked:** `.docs/stories/a-coverage-claim-can-name-a-task-whose-done-when-d.md` (8 stories)
against every file in `.docs/stories/` and the approved ADR corpus.
**ADR corpus:** `conflict_check.adr_corpus: repo_wide` (`.ai-conductor/config.yml:123`). 302 ADR
files enumerated; narrowed by subject overlap (plan/Done when/step/judge/halt/DECIDE/land/config/
gate/criterion/stories/rubric/dispatch/discovery/seal/waiver/coherence/audit/schema/verdict) to
~150 titles, of which 23 were read in full: 07-22 placement, 07-22 waiver, 07-26 preseed, 07-13
session-fresh, 07-05 retry ladder, 08-05 operator lever, 08-09 default-off flag, 08-11 halt spine,
08-13 rubric branches, 08-18 mechanical faults, 08-19 envelope, 08-19 tree-attesting, 08-19
unretryable, 08-21 Done when, 08-22 one-owner, 08-22 done-when evidence, 08-22 prd-audit authority,
08-23 quote, 08-23 criterion structural, 08-23 diff-locality, 08-24 evidentiary, 08-24 refused,
08-26 config registry, 08-26 shared parser, 08-30 resolver. Narrowed-out: every ADR whose subject
is provider auth, rebase, finish/PR publication, release gates, telemetry cost, parking, memory,
intake labels, migration, or daemon lifecycle — none addresses a coverage claim, the criterion
layer, step registration, or the halt shape this spec touches. Superseded exclusion: only
unambiguously fully superseded ADRs were dropped; amended ADRs stayed in.

## Blocking (resolved)

### Conflict 1: Shipped story asserts the criterion layer never engages at tier S
**Stories involved:** Story 3 (this spec) vs Story 1 of `coherence-rows-assert-story-task-coverage-that-not.md`
**Files:** `.docs/stories/a-coverage-claim-can-name-a-task-whose-done-when-d.md` vs `.docs/stories/coherence-rows-assert-story-task-coverage-that-not.md`
**Type:** contradiction — **Severity:** blocking
**Shipped opposing sentence (verbatim):** "Given a Small-tier spec, when the operator runs engineer land, then the criterion layer does not engage and the land is unaffected" and Done When "`resolveRequiredLayers` returns a layer set containing `criterion` for tier M and tier L, and omits it for tier S"
**New opposing sentence (verbatim):** "Given a tier-S spec, when the coherence gate runs, then only the `criterion` layer is evaluated — no coherence artifact is required and no outcome, fr, story, orphan-task, or adr check runs"
**Resolution:** the approved `adr-2026-08-31-coverage-binding-judge-step` D3 (operator ruling 2026-08-31) supersedes the shipped assertion. Replace it in place: the criterion layer engages at S over the plan-carried rows; `resolveRequiredLayers` returns `{criterion}` at S. **Delivery:** the land stem gate rejects foreign-stem story edits on a spec branch, so the replacement ships as a companion main-based PR opened alongside the spec PR (precedent PR #1928 / #1927).

### Conflict 2: Shipped story accepts a quote from anywhere in the cited task's text
**Stories involved:** Story 1 (this spec) vs Story 2 of `coherence-rows-assert-story-task-coverage-that-not.md`
**Type:** contradiction — **Severity:** blocking
**Shipped opposing sentence (verbatim):** "Given a criterion row citing task 10 and quoting a span that appears verbatim in task 10's committed text, when the operator runs engineer land, then the row is accepted"
**New opposing sentence (verbatim):** "Given a criterion row citing `task-14` whose quote appears in task 14's Steps prose but in none of its `Done when` checks, when the spec lands, then land rejects with gap id `criterion:quote-not-done-when:<n>` […]"
**Resolution:** superseded by D2 (and the 2026-08-31 amendment note on `adr-2026-08-23-coverage-claims-grounded-by-verbatim-quote`). Replace in place: "quoting a span that appears verbatim in one of task 10's `Done when` checks". Same companion PR as Conflict 1. The whitespace-normalization and multi-task-citation assertions in that story stand.

### Conflict 3: Shipped story asserts no coherence validation runs at S
**Stories involved:** Story 3 (this spec) vs Story 13 of `decide-artifact-coherence-check.md`
**Type:** contradiction — **Severity:** blocking
**Shipped opposing sentence (verbatim):** "Given an S-tier spec (per its `.docs/complexity/` tier), when the DECIDE flow runs, then the coherence-check step is skipped, and when land validates, then no coherence artifact is required and no coherence validation runs." and Done When "Land validator engages only when tier ≠ S"
**New opposing sentence (verbatim):** as Conflict 1.
**Resolution:** superseded by D3. Replace in place: the step stays skipped and no artifact is required; land runs only the plan-carried criterion layer at S. Story 14's "the missing-artifact rejection never fires" at S stands. Same companion PR.

### Conflict 4: ADR requires a diff-locality disposition on every criterion row
**Stories involved:** Story 2 / Story 3 (this spec) vs `adr-2026-08-23-diff-locality-is-an-authored-disposition`
**Type:** contradiction — **Severity:** blocking
**ADR filename stem:** adr-2026-08-23-diff-locality-is-an-authored-disposition
**Story ID:** Story 3
**ADR opposing sentence (verbatim):** "Every `criterion` row carries a diff-locality disposition. At land, `runCoherenceGate` requires the disposition to be present and non-negative on every row; an absent or negative disposition is rejected, naming the criterion."
**Story opposing sentence (verbatim, before resolution):** "Given a tier-S spec, when the coherence gate runs, then only the `criterion` layer is evaluated — no coherence artifact is required and no outcome, fr, story, orphan-task, adr, or diff-locality check runs"
**Resolution (operator-selected 2026-08-31, option 1):** S plan-table criterion rows carry a fourth disposition cell and the disposition checks run at S. `adr-2026-08-31` D1/D3, the 07-22 amendment note, the diagram, and Stories 2–3 updated in this pass. No amendment to the diff-locality ADR.

## Degrading (resolved in this pass)

### Conflict 5: New halt/start events duplicate the spine's existing step events
**Stories involved:** Story 8 (this spec) vs the event-spine principle, `adr-2026-08-24-refused-step-status` D3 (`step_refused`), `adr-2026-08-11-halt-events-ride-the-persisted-spine`
**Type:** resource-contention — **Severity:** degrading
**Resolution:** dropped `coverage_binding_started`/`_halted`; kept `coverage_binding_judged` and added `coverage_binding_disabled`. ADR D9 and Story 8 rewritten.

### Conflict 6: Story 5 cited the build_review mechanical-fault lane
**Stories involved:** Story 5 vs `adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane` (keyed on `BuildReviewRubricResult.kind`)
**Type:** overlap — **Severity:** degrading
**Resolution:** malformed judge payloads are a typed infrastructure failure of the step under the ordinary retry ladder (07-05). ADR D5 and Story 5 rewritten.

## Notes (no conflict)
- `adr-2026-07-13-session-fresh-verdict-artifacts`: the envelope is rewritten on every run even on full cache hit (added to D5 and Story 5).
- `contradictory-decide-artifacts-reach-build-and-hal.md:358` ("coherence-check remain skipped" at S) and `coherence-artifact-passes-engineer-land-then-block.md:45` (discovery unaffected at S) are compatible with Story 3 and stand.
- Oscillation check: Story 3 (required table at S) ↔ Story 4 (no tier skip) and Story 6 (halt) ↔ Story 7 (not-applicable) were tested in both directions; each pair holds.

## Re-check
Zero blocking conflicts remain after the above. Conflicts 1–3 are resolved by decision now and by
story text in the companion PR.
