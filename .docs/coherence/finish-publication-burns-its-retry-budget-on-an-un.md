# Coherence Mapping: FINISH publication burns its retry budget on an unreachable transition

**Date:** 2026-08-13
**Feature:** ai-conductor#1487 — technical track, Tier M
**Plan stem:** `finish-publication-burns-its-retry-budget-on-an-un`

Row classes present: `outcome` (5 bullets staged in `.pipeline/intake-outcomes.md`), `story` (6),
`task` (18), `adr` (1 non-deleted ADR file in this change set). The `fr` class is omitted: this is a
technical-track spec with no PRD, so no `FR-N` ids exist to trace.

Every `covered` verdict below was confirmed by reading the counterpart's own artifact file, not
inferred from the plan's prose coverage mapping. The consistency pass (§4d) found one cross-layer
contradiction — outcome-1 against the ADR's original advance-path-only decision — which was
adjudicated and amended during this DECIDE pass rather than deferred; the row is recorded as
`covered` against the amended artifacts, with the finding stated in Notes.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-6 | covered | "A retry that cannot advance is never issued: a publication retry either performs the transition it names, or resolves as human-required." Consistency pass initially found this **not** delivered: the ADR's guard sat in `advancedPublicationTransition`, which a `publication_retry` never reaches (`finish-publication.ts:1342-1344`), so Cycle A — the filed defect, a retry — bypassed it entirely while only Cycle B was caught. Operator-confirmed 2026-08-13; the ADR carries an additive amendment extending the fixed-point rule to the retry path, and tasks 10a/10b implement it. Now covered by construction on both dispositions. |
| outcome | outcome-2 | story-4 | covered | "A PR whose body carries the halt-boilerplate marker resolves as human-required at FINISH, without consuming retry attempts." story-4's criteria assert `human_required` with zero judgment dispatches and unchanged attempt and progress counters, for the label, marker, banner, and title-prefix shapes. |
| outcome | outcome-3 | story-3 | covered | "The halt reason … names the stage that actually ran and why it could not advance." story-3 requires the transition, the unmoved dimension, the observed value, and a concrete next action in the rendered text, and explicitly forbids reproducing the `authoring_required_after_judgment` shape that named a stage never dispatched. |
| outcome | outcome-4 | story-2 | covered | "Verdicts and observations that disagree … are surfaced as a defect rather than silently converted into a retry." story-2 asserts no `PUBLICATION_RETRY_REASONS` string is emitted for a non-advance and that the disposition is `human_required`. |
| outcome | outcome-5 | story-5 | covered | "Publication paths that legitimately converge … keep working with no extra attempts." story-5 requires an unchanged transition count, no `human_required` disposition, a progress counter that never reaches the allowance, and a legitimate-revisit criterion for every transition. |
| story | story-1 | task-1, task-2, task-3, task-4, task-5, task-6 | covered | Dimension map (2, 3), advance-path guard in the single choke point (4, 5), unmoved-dimension and foreign-churn negatives (6). task-1 is the condition-3 consumer sweep that gates the whole chain. |
| story | story-2 | task-7, task-8, task-10a, task-10b, task-11 | covered | Advance-path non-advance (7, 8), retry-path non-advance (10a, 10b), Cycle A/B regression at the coordinator seam (11). |
| story | story-3 | task-9, task-10 | covered | Halt text naming stage and dimension (9), the `HumanRequiredReason` member, guidance row, and `detail` carrier (10). |
| story | story-4 | task-15, task-16 | covered | Halt-state acceptance coverage including the residual-signal and negative shapes (15), `labels` observation plus routing through the existing `hasHaltSignal` predicate and pre-judgment resolution (16). |
| story | story-5 | task-12 | covered | Legitimate-revisit coverage for all seven transitions, with the `establish_pr`-after-`write_shipped_record` case from #1342 mandatory. task-16 step 4 additionally requires the two existing acceptance suites to pass without a weakened assertion. |
| story | story-6 | task-13, task-14 | covered | Indeterminate-post-effect retry, recovered-observation advance, and bounded termination (13); the three-way split on the post-effect value (14). |
| task | task-1 | story-1 | covered | Typed `infrastructure` and `**Verify-only:** yes`. Discharges architecture-review condition 3 — records every consumer of `progress_finish` / `publication_progress` before behavior changes, and stops the chain if another consumer reads `advanced` as "the effect ran". |
| task | task-2 | story-1 | covered | RED for the total dimension map, including the compile-time exhaustiveness assertion. |
| task | task-3 | story-1 | covered | GREEN — the `Record<PublicationTransition, …>` map and its snapshot reader. |
| task | task-4 | story-1 | covered | RED — three representative transitions that move their dimension still advance. |
| task | task-5 | story-1 | covered | GREEN — the guard evaluated in `advancedPublicationTransition`, the single choke point, with no per-arm logic. |
| task | task-6 | story-1 | covered | RED — unmoved dimension, foreign-dimension churn, and the paired `establish_pr` dimension. |
| task | task-7 | story-2 | covered | RED — conductor-level assertion that neither the attempt counter nor the progress counter moves, and no `step_retry` is emitted. |
| task | task-8 | story-2 | covered | GREEN — `human_required` for a determinately unmoved dimension. |
| task | task-9 | story-3 | covered | RED — the rendered halt names transition, dimension, observed value, and next action. |
| task | task-10 | story-3 | covered | GREEN — union member, guidance row, and the `detail` carrier. Per conflict-check Conflict 3 the `human_required` shape is not widened. |
| task | task-10a | story-2 | covered | RED — a retry naming a transition the fresh observation would not select must not retry; the converse case (a retry naming the transition the selector would choose) must still retry. Added 2026-08-13 from this artifact's consistency pass. |
| task | task-10b | story-2 | covered | GREEN — apply the existing pure selector `nextFinishPublicationTransition` to the post-effect observation before returning a retry. `mapPrProseJudgmentResult`'s placeholder arm is deliberately left unchanged so the rule stays general. |
| task | task-11 | story-2 | covered | RED — Cycle A and Cycle B pinned at the `advanceFinishPublication` seam with an injected snapshot. Per conflict-check Conflict 1 this is deliberately not end to end: task-16's short-circuit makes the production path unreachable, so an end-to-end test would be tautological. |
| task | task-12 | story-5 | covered | RED — legitimate revisit for each of the seven transitions; discharges architecture-review condition 2. |
| task | task-13 | story-6 | covered | RED — indeterminate retries, recovered observation advances, repeated indeterminate still terminates via `stepMaxRetries`. |
| task | task-14 | story-6 | covered | GREEN — the three-way split decided solely on the post-effect value. |
| task | task-15 | story-4 | covered | RED — label-only, marker-only, residual-signal, and four negative shapes, with unchanged counters. |
| task | task-16 | story-4 | covered | GREEN — `labels` added to the existing `gh pr view --json` call, halt classification routed through `hasHaltSignal`, pre-judgment resolution, and the two existing acceptance suites required to pass unweakened. |
| adr | adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns | story-1, story-2, story-3, story-6 | covered | The only non-deleted ADR file in this change set. story-1 implements the dimension map and the advance-path fixed-point rule; story-2 implements both non-advance dispositions, including the retry-path rule added by the ADR's 2026-08-13 amendment; story-3 implements the halt rendering the decision requires; story-6 implements the fail-open carve-out for an undeterminable dimension. The ADR's halt short-circuit paragraph is an application of `adr-2026-08-09-one-pr-per-branch-halt-is-a-state`, not a new decision, and is implemented by story-4. Verified APPROVED with no draft marker. |

## Assumptions surfaced

One row rested on an assumption worth stating rather than resolving silently.

**The `adr` row's counterpart set excludes story-4** even though story-4 implements a paragraph of
the same ADR. That paragraph explicitly records itself as an application of
`adr-2026-08-09-one-pr-per-branch-halt-is-a-state` rather than a new decision, so story-4 is
constrained by the *governing* ADR, which is not in this change set and therefore has no row.
Confidence 85%, basis inferred from the ADR's own framing. Impact if wrong: none on the gate — the
row is affirmative either way — but a reader tracing halt-short-circuit provenance should follow it
to the 2026-08-09 ADR, not this one. Confirmable by reading the ADR's Decision section, which names
the reuse explicitly.

## Consistency pass findings

The cross-layer sweep compared each outcome against the tasks claiming to deliver it, and the ADR
against the stories implementing it — the pairs `/conflict-check` does not see, since it sweeps
story against story.

The one finding was outcome-1 against the ADR: the outcome demands that a retry "either performs
the transition it names, or resolves as human-required", and the ADR as first approved governed only
the `advanced` path. Both directions of the heuristic failed — satisfying the ADR as written left
outcome-1's first clause undelivered, and satisfying outcome-1 required a rule the ADR did not
contain. This is the shape that would have surfaced in BUILD as a regression test that could not be
made to pass without redesign, or worse, as a passing test against a defect that was never fixed.
It was adjudicated with the operator on 2026-08-13 and amended into the ADR and the plan during this
DECIDE pass, additively, with the original decision text preserved.

No other contradiction was found. The pair most likely to oscillate — outcome-5's "no extra
attempts" against story-6's indeterminate retry — does not, because conflict-check Conflict 2
already removed the case where a recovered observation spent an attempt on genuine progress: the
three-way split now decides on the post-effect value alone, so only a still-degraded observation
retries, and a degraded observation is not a legitimately converging path.
