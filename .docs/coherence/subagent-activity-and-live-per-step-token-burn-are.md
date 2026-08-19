# Coherence: Live subagent activity and per-step token burn (#1441)

**Date:** 2026-08-19
**Tier:** M — technical track, so the `fr` row class is omitted (no PRD; acceptance criteria live
directly in the stories).
**Sources:** `.pipeline/intake-outcomes.md` (Source-Ref `jstoup111/ai-conductor#1441`),
`.docs/stories/subagent-activity-and-live-per-step-token-burn-are.md`,
`.docs/plans/subagent-activity-and-live-per-step-token-burn-are.md`, and the two
`.docs/decisions/adr-*.md` files in this spec's change set.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2, story-3 | covered | Story 2 produces a real active-child count from the Claude stream; story 3 scopes it — where a count cannot exist (Codex) or has not arrived yet, the row says `unknown`. Outcome-4 is the operator-approved boundary on this outcome, so the pair is complementary, not contradictory. |
| outcome | outcome-2 | story-2, story-3 | covered | The count reaching zero is the "children finished" half; the "waiting on a completion condition" half already ships from #1246 (`activityState: waiting` plus `completionCondition`, `daemon-dashboard.ts`). Story 3 keeps a real `0` visibly distinct from `unknown`, which is what makes the conjunction readable. |
| outcome | outcome-3 | story-4, story-6 | covered | Story 4 accumulates and renders uncached input/output tokens while the step runs; story 6's cadence and close-boundary flush are what make the number current rather than an interval stale. |
| outcome | outcome-4 | story-3 | covered | Confirmed against the stories file: story 3 requires `unknown` for Codex, for a step with no observation yet, and for an unrecognized observability value, and forbids `0` as a stand-in. Its Done When pins that no production path emits `activeChildren: 0` for an unobserved count. |
| adr | adr-2026-08-19-live-provider-stream-observation | story-1, story-2, story-3, story-4, story-5, story-6, story-7 | covered | Each of its eight decisions has an implementing story: d1→story-1, d2→story-1/story-5, d3→story-3, d4→story-4, d5→story-5, d6 (with its flush amendment)→story-6, d7→story-7, d8→story-1's interactive-path criterion. |
| adr | adr-2026-07-22-build-dispatch-json-usage-capture | story-1 | covered | Consistent **only as amended**. Its original text rejects `stream-json`, which story 1 requires; the additive 2026-08-19 amendment in this same change set overturns that clause and preserves every other decision (stdin prompt, `.result` output, `.usage.*` capture, per-invocation scope) — exactly what story 1 asserts. Without the amendment travelling in this diff this row would be `fail`. |
| story | story-1 | task-6, task-7, task-8 | covered | Confirmed against the plan: task 6 switches the format and selects the terminal result line, task 7 pins its field-set fixture, task 8 covers all three absent/partial-result negatives. |
| story | story-2 | task-10, task-11, task-15, task-21 | covered | Task 10 is the tracker and its four negatives, task 11 reports it, task 15 delivers the unclosed-child-at-close negative via the flush, task 21 confirms the attribution assumption with an opt-in live probe. |
| story | story-3 | task-12, task-17, task-18 | covered | Task 12 makes Codex report `unsupported`, task 17 tolerates an absent record, task 18 renders `unknown` in all four unobserved shapes and keeps a real `0` distinct. |
| story | story-4 | task-4, task-9, task-11, task-12, task-13, task-19 | covered | Task 9 is the uncached/cached accumulator and its two malformed-usage negatives, task 11/12 report per provider, task 13 covers the per-attempt reset, task 19 renders and covers the unavailable case, task 4 pins the no-double-count-with-`step_completed` negative. |
| story | story-5 | task-1, task-2, task-3, task-4, task-16 | covered | Contract, union variant, sink declaration and its compile-time totality, rollup/daemon-log inertness, and the emission that puts the record on the ledger. |
| story | story-6 | task-13, task-14, task-15 | covered | Throttle plus config defaults and rejection, change-driven emission plus slow heartbeat, and the throttle-exempt close-boundary flush with its three negatives. |
| story | story-7 | task-5, task-20 | covered | Task 5 owns the chunk-boundary reassembly happy path; task 20 owns the throwing handler, the no-parseable-record degradation, the unchanged heartbeat, the killed-mid-stream discard, and the unchanged time partition. |
| task | task-1 | story-5 | covered | Typed `infrastructure`; supporting purpose is the provider-neutral observation contract every later task reports through. |
| task | task-2 | story-5 | covered | Typed `infrastructure`; supporting purpose is the union variant story 5 requires. |
| task | task-3 | story-5 | covered | Typed `infrastructure`; supporting purpose is story 5's sink-declaration criterion and its compile-failure negative. |
| task | task-4 | story-5, story-4 | covered | Serves story 5's three inertness negatives and story 4's no-double-count negative. |
| task | task-5 | story-7 | covered | Typed `infrastructure`; supporting purpose is story 7's chunk-boundary reassembly criterion. |
| task | task-6 | story-1 | covered | |
| task | task-7 | story-1 | covered | Typed `infrastructure`; supporting purpose is story 1's Done When fixture and architecture-review condition 2. |
| task | task-8 | story-1 | covered | |
| task | task-9 | story-4 | covered | |
| task | task-10 | story-2 | covered | |
| task | task-11 | story-2, story-4 | covered | |
| task | task-12 | story-3, story-4 | covered | |
| task | task-13 | story-6, story-4 | covered | Typed `infrastructure`; also serves story 4's per-attempt reset negative. |
| task | task-14 | story-6 | covered | |
| task | task-15 | story-6, story-2 | covered | The conflict-check resolution row: satisfies story 6's close-boundary criterion and story 2's unclosed-child-at-close negative together. |
| task | task-16 | story-5 | covered | |
| task | task-17 | story-3 | covered | Typed `infrastructure`; supporting purpose is the ledger read story 3's third negative depends on. |
| task | task-18 | story-3 | covered | |
| task | task-19 | story-4 | covered | |
| task | task-20 | story-7 | covered | |
| task | task-21 | story-2 | covered | Typed `infrastructure`; supporting purpose is story 2's Done When live-probe item and architecture-review condition 4. |

## Consistency pass (§4d)

Every covered row was re-read for contradiction and for oscillation, checking cross-layer pairs in
both directions. No `fail` row was recorded. Three pairs were adjudicated rather than waved through:

- **outcome-1 × story-3.** "Status reports how many child units of work are active" versus "Codex
  rows render `unknown`". Not a contradiction: outcome-4 is the operator's own stated boundary on
  outcome-1, so the two outcomes scope each other. Satisfying story 3 fully leaves outcome-1
  satisfied wherever a count can exist; satisfying outcome-1 fully leaves story 3 satisfied because
  it never demands a number where none is observable.
- **adr-2026-08-19 decision 6 × story-2.** As originally written, the throttle's
  no-emission-after-close rule and story 2's final-child-state guarantee were mutually exclusive in
  practice — the oscillation `/conflict-check` found. Resolved before this artifact was authored by
  the throttle-exempt close-boundary flush, recorded as an additive amendment on decision 6 and as
  task 15. Both directions now hold.
- **adr-2026-07-22 × story-1.** A genuine static contradiction in the original ADR text, resolved by
  the additive amendment travelling in this same change set. Recorded as `covered` rather than
  `fail` only because the amendment is part of this diff; if it were removed, this row becomes
  `fail` and the spec must not land.

## Assumptions surfaced

- **The subagent-attribution assumption is not resolved at DECIDE (confidence ~85%, basis:
  inferred).** Story 2's counts rest on children being attributable by a `Task` tool_use / matching
  tool_result pair and a non-null `parent_tool_use_id`. The probe confirmed the field exists and is
  null on the main chain but did not exercise a run that spawns a subagent. This is recorded as
  `covered` rather than `gap` because task 21 confirms it explicitly during BUILD and because every
  wrong-answer branch lands on `childObservability: 'unsupported'` — a value story 3 and the ADR
  already model — rather than on a fabricated count. Impact if wrong: the child-count half of
  outcome-1 degrades to `unknown`; the token half and every other row are unaffected.
