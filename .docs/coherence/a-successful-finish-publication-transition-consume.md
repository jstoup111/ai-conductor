# Coherence: FINISH publication progress is not a retry (#1342)

**Date:** 2026-08-06
**Tier:** M
**Scope revision:** 2026-08-06 — reduced from 12 tasks to 8 (no event-schema/renderer change, one termination bound instead of two, consolidated negative paths). No outcome row lost coverage; see the plan's scope note.
**Track:** technical — the `fr` row class is omitted (no PRD; technical intents TI-1..TI-6 in the
stories file carry the requirement layer).
**Outcome source:** the Desired-outcomes bullets of jstoup111/ai-conductor#1342, carried into the
spec by the `.docs/intake/` marker landed with this branch.

| Row class | Cited id | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-2 | covered | "A publication transition that succeeds does not consume `finish`'s retry budget." Story 2 asserts the attempt counter is unchanged across a `progress_finish` route and that a full publication completes with zero retries consumed. |
| outcome | outcome-2 | story-2, story-4 | covered | "The budget is spent only on genuine failures, and a full allowance remains to absorb a real transient after any number of successful transitions." Story 2 asserts the surviving allowance; Story 4 asserts genuine failures still charge exactly one attempt each. |
| outcome | outcome-3 | story-3 | covered | "A machine that stops advancing still terminates, bounded, halting with a reason naming the stuck transition." Story 3 asserts the allowance bound and the named-transition halt reason. |
| outcome | outcome-4 | story-5 | covered | "A fully-successful publication reports no retry consumption in the daemon log — no `↻ finish retry` line follows a `✓`." Story 5 asserts exactly that log property, achieved by emitting nothing for progress rather than by adding an event value. |
| outcome | outcome-5 | story-2 | covered | "Regression coverage pins a 5-transition successful publication completing with its retry budget intact." Story 2's third and fourth happy-path criteria; realized by task-5, which is written as that regression by name. |
| story | story-1 | task-1, task-2, task-3, task-7 | covered | Boundary kind + route arm, adapter mapping, the genuine-failure pass-through with the five-reason validity table, and the fail-closed rejection rows of the consolidated negative table. |
| story | story-2 | task-4, task-5 | covered | Non-charging re-entry with no `step_retry` emit, and the five-transition budget-intact regression including the follow-on transient. |
| story | story-3 | task-6, task-7 | covered | The allowance bound halting and naming the transition the run stopped on, plus the revisit / per-step-reset rows of the consolidated negative table. |
| story | story-4 | task-7 | covered | The routing non-regression rows over all five pre-existing route kinds, including the non-retryable path's deliberately-unspent budget. |
| story | story-5 | task-4, task-5 | covered | Progress emits no retry event, and the full-publication regression asserts zero `step_retry` events over the run. No event-schema or renderer change is required for this story — see the plan's scope note. |
| story | story-2 | task-8 | covered | The `HARNESS.md:307` non-budget-consuming contract Story 2 relies on is stated in the same change, per the documentation-upkeep rule. |
| task | task-1 | story-1 | covered | `publication_progress` disposition, `progress_finish` route, validator enrollment — union and validator in one task per architecture-review condition 1. |
| task | task-2 | story-1 | covered | Adapter maps `advanced` to progress and emits no reason string. |
| task | task-3 | story-1 | covered | Real `*_not_verified_after_*` failures pass through as retries; all five reasons stay valid in `PUBLICATION_RETRY_REASONS`. |
| task | task-4 | story-2, story-5 | covered | `progress_finish` arm re-enters without charging and emits no event at all. |
| task | task-5 | story-2, story-5 | covered | Five-transition success with zero `step_retry` events, then a genuine transient receiving the full allowance. |
| task | task-6 | story-3 | covered | Total progress allowance halts a never-completing publication with a `needs-human` marker naming the transition it stopped on. |
| task | task-7 | story-1, story-3, story-4 | covered | Consolidated negative table: malformed progress dispositions halt; PR #1337's `establish_pr`-twice replay succeeds; the counter resets on a fresh step entry; charged-attempt counts and terminal outcomes pinned for retry, exhaustion, non-retryable, BUILD kickback, human-required and fail-closed. |
| task | task-8 | story-2 | covered | `HARNESS.md` non-budget-consuming enumeration and the affected `docs/` page. |

No `gap` rows. Every `covered` verdict was checked against the cited artifact file in this
worktree (`.docs/stories/a-successful-finish-publication-transition-consume.md` and
`.docs/plans/a-successful-finish-publication-transition-consume.md`).

## Assumptions surfaced

- **The five reason strings the adapter synthesises are also emitted by
  `advanceFinishPublication` for genuine failures** — ~95% confidence, `verified` by reading
  `finish-publication.ts:1085`, `:1132`, `:1201`, `:1230`, `:1269`. This is the load-bearing
  claim: it is why the filed issue's reason-string exemption was rejected in favor of a
  shape-based discrimination. Impact if wrong: the simpler filed approach would have been
  viable, and this spec is more machinery than necessary — but no outcome is missed either way.
  Confirmed with the operator on 2026-08-06 before authoring.
- **`routeFinishPublicationDisposition` has exactly one production caller
  (`conductor.ts:5488`)** — ~90% confidence, `verified` by grep over `src/conductor/src`.
  Impact if wrong: a second consumer would need its own `progress_finish` arm. Mitigated by
  design — the route union is closed, so TypeScript exhaustiveness surfaces any missed arm at
  compile time.
- **Twelve is a sufficient total progress allowance, and is sufficient on its own** — ~85%
  confidence, `inferred` from the six-transition machine and the observed five-to-six-advance
  healthy runs. Impact if wrong: a legitimate long publication halts, or a tightly-repeating
  transition halts later than a dedicated cap would. Mitigated: the halt names the transition,
  so the condition is diagnosable rather than silent; the 2× derivation and the dropped
  per-transition cap are both recorded in
  `adr-2026-08-06-bounded-progress-allowance-for-finish-publication` as follow-up obligations.
- **No other in-flight branch changes the FINISH publication routing block** — ~90% confidence,
  `verified` by diffing every local `spec/*` branch against `main` for the affected files. Impact
  if wrong: a textual merge collision at `conductor.ts:5486-5540`, resolvable at rebase.
