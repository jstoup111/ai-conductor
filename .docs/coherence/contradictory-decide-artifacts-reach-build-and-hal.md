# Coherence: ADR contradiction detection across DECIDE

**Date:** 2026-08-09
**Source:** intake #1391
**Tier:** M · **Track:** technical
**Plan:** `.docs/plans/contradictory-decide-artifacts-reach-build-and-hal.md` (17 tasks)
**Stories:** `.docs/stories/contradictory-decide-artifacts-reach-build-and-hal.md` (7 stories)

Two row classes are **omitted entirely**, and in both cases omission is correct rather than a gap:

- **`fr`** — technical track, no PRD.
- **`outcome`** — no outcome bullets were staged for this idea. Verified: the staged file
  `.pipeline/intake-outcomes.md` carries `Source-Ref: jstoup111/ai-conductor#1391` and a
  `## Desired outcome` heading with **zero bullets** beneath it. The idea was dequeued as a
  *recovered stale claim* whose text was the placeholder
  `[recovered stale claim] jstoup111/ai-conductor#1391` rather than the issue body, so no bullets
  were ever staged. Per §4a an empty outcome layer is "not required", and `resolveRequiredLayers`
  only requires the layer when the staged outcome list is non-empty.

**The outcome traceability is not lost — it is recorded here in prose**, read directly from
`jstoup111/ai-conductor#1391`, so nothing this spec owes the issue is hidden by the omission:

- *Reported as a blocking conflict before the plan is approved* → story-1 (pre-plan sweep) and
  story-6 (adjudication provable at land). Delivered.
- *Report names both sides verbatim* → story-2, implemented by task-17. Delivered.
- *Spans artifact kinds* → the ADR axis via story-1 and story-3. The story-versus-PRD half was
  already delivered by #1401 (`coherence-check` §4e) and is not re-implemented. Delivered.
- *An agreeing feature still passes with no added operator prompt* → story-7. Delivered.
- *A BUILD-discovered contradiction leaves the governing artifact amended, without that amendment
  counting as unauthorized scope change* → **deliberately out of scope**, split to intake **#1411**
  at operator direction. Different mechanism, with adjacent open tickets #1366 and #1258 and
  partial prior coverage from #1303.

> **Note on this artifact's own row classes.** This spec *adds* a fifth `adr` row class, but the
> validator on the base branch rejects unknown row classes at `coherence-validator.ts:130`.
> Emitting an `adr` row here would break this spec's own land. This artifact therefore uses only
> the four existing classes — a concrete instance of the same-change-set sequencing constraint
> recorded in `adr-2026-08-09-adr-contradiction-detection-in-two-halves`. The ADR-versus-story pair
> class is exactly what this spec exists to make expressible, and exactly what this artifact
> structurally cannot yet express.

## Traceability mapping

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| story | story-1 | task-13, task-14, task-16 | covered | Confirmed against the plan: tasks 13, 14 and 16 each carry a Story line citing 1. |
| story | story-2 | task-17 | covered | Confirmed: task-17 cites story 2. Added during this pass — see Amendments below. |
| story | story-3 | task-15 | covered | Confirmed: task-15 cites story 3. |
| story | story-4 | task-1, task-2, task-3 | covered | Confirmed: all three cite story 4. |
| story | story-5 | task-4, task-5, task-7, task-8 | covered | Confirmed: all four cite story 5. Includes the amended deletion scenario, delivered by task-7 and task-8. |
| story | story-6 | task-9, task-10, task-11, task-12 | covered | Confirmed: all four cite story 6. |
| story | story-7 | task-6 | covered | Confirmed: task-6 cites story 7. |
| task | task-1 | story-4 | covered | Accept adr as a parseable row class. |
| task | task-2 | story-4 | covered | Keep rejecting every other unknown row class. |
| task | task-3 | story-4 | covered | Cross-check adr row citations against a real id pool. |
| task | task-4 | story-5 | covered | Derive the adr required layer from the committed signal. |
| task | task-5 | story-5 | covered | Exclude non-ADR files in the decisions directory from the signal. |
| task | task-6 | story-7 | covered | Preserve the tier-S and legacy-change-set exemptions. |
| task | task-7 | story-5 | covered | Derive the ADR pool, excluding deleted ADRs. |
| task | task-8 | story-5 | covered | Deletion-only change set passes over an empty pool. |
| task | task-9 | story-6 | covered | Block an unadjudicated or negative-verdict ADR. |
| task | task-10 | story-6 | covered | Render adr gaps in fixed layer order. |
| task | task-11 | story-6 | covered | Pin the affirmative-unknown-verdict behavior with a test. |
| task | task-12 | story-6 | covered | ADR gaps are waivable by exact id. |
| task | task-13 | story-1 | covered | Infrastructure type but carries a real story id — config read resolution is the mechanism story-1's corpus-scope rule depends on. |
| task | task-14 | story-1 | covered | Infrastructure type with a real story id — adds the conflict_check.adr_corpus key story-1 reads. |
| task | task-15 | story-3 | covered | Teach coherence-check to author adr rows. |
| task | task-16 | story-1 | covered | Add the ADR corpus to conflict-check, scoped by adr_corpus. |
| task | task-17 | story-2 | covered | Require both sides of an ADR conflict to be quoted verbatim. |

## Consistency pass (§4d) — cross-layer

Every covered row was re-read for the question coverage cannot answer: does the counterpart
*deliver* the thing, or oppose it? Cross-layer pairs only. Same-layer story-versus-story pairs were
swept by `/conflict-check` (report:
`.docs/conflicts/2026-08-09-adr-contradiction-detection-across-decide.md`, which found and resolved
one blocking ADR-versus-Story-5 contradiction). That finding is not re-reported here.

Each pair was asked in both directions — "if I fully satisfy A, does B still hold?", then the
converse:

- **outcome-1 ↔ task-9** — does blocking at land satisfy "before the plan is approved"?
  **Consistent.** outcome-1 is delivered pre-plan by task-16's sweep; task-9's land gate is the
  enforcement half, not the timing half. Neither weakens the other.
- **outcome-4 ↔ task-9** — does "block unadjudicated ADRs" break "no added prompt for agreeing
  specs"? **Consistent.** task-9 blocks only when an ADR has no adjudicated row; an agreeing spec
  that ran the full DECIDE sequence has rows authored by task-15.
- **outcome-4 ↔ task-16** — does adding an ADR corpus add prompts to agreeing specs?
  **Consistent at the shipped default.** `adr_corpus` defaults to the change set, bounding the
  sweep to a handful of ADRs; the 177-ADR repo-wide scope is opt-in and enabled in this repository
  only, per `adr-2026-08-09-repo-wide-adr-sweep-staged-behind-default-off-flag`.
- **story-5 ↔ task-4** — story-5 forbids a signature change while task-4 must add the layer.
  **Consistent.** `resolveRequiredLayers` already receives the change set; the addition is two
  lines inside the existing signature. Verified against `coherence-validator.ts:1256-1292`.
- **story-5 ↔ task-7** — the amended deletion scenario versus pool derivation. **Consistent by
  construction.** This pair *was* the blocking contradiction conflict-check found, resolved by
  relocating the mechanism to pool derivation while preserving the observable outcome.
- **story-6 ↔ task-11** — story-6 requires blocking while task-11 pins unknown verdicts as
  affirmative. **Consistent, correctly layered.** task-11 documents existing engine behavior it
  does not change; the control against inventing a verdict is skill-side, in task-15.
- **story-7 ↔ task-14** — does setting the repo-wide scope here break "no new failure mode"?
  **Consistent.** story-7's scenarios are scoped to specs that never engage the layer; the corpus
  scope affects conflict_check's breadth, not the coherence layer's engagement.

No `fail` rows. No oscillation found — no pair returned "no" in both directions.

## Amendments made during this pass

> **Amended 2026-08-09 by #1391:** authoring this artifact surfaced that **story-2 had no task
> citing it**. The plan's own Coverage Check table claimed story 2 was covered by task-16, but
> task-16's Story line reads 1 — a coverage-table claim contradicting the parsed task tree, and a
> `story-2` gap. Story-2's requirement (verbatim quotation of both sides) had been folded into
> task-16's step 3 rather than given its own task. Resolved during DECIDE by splitting it out as
> **task-17** and narrowing task-16's step 3 accordingly; the dependency graph, the coverage table,
> and the task count were updated to match. Both plan gates — `validate-wired-into` and
> `plan-protected-targets` — were re-run green after the edit.

## Assumption surfaced, then resolved

**Surfaced:** the `outcome` row ids depended on how land resolves the intake body, and this idea
was dequeued as a *recovered stale claim* carrying a placeholder instead of the issue body.
Recorded at ~75% confidence, inferred, with the stated cheap confirmation being to run land and
read the reported ids.

**Resolved by doing exactly that.** The first land attempt returned
`fabricated-id "outcome-1" cited by outcome row "outcome-1"`, and inspecting
`.pipeline/intake-outcomes.md` showed a `## Desired outcome` heading with no bullets — an empty
outcome pool. The outcome row class was therefore removed and the traceability moved to prose
above. The assumption is closed, not carried into BUILD.

**Worth flagging beyond this spec:** the stale-claim recovery path stages a placeholder rather than
re-fetching the issue body, so a recovered claim silently loses its Desired-outcome bullets and the
coherence gate's outcome layer disengages for that spec. That is a harness behavior, not a defect in
this artifact, and it is not in this spec's scope.
