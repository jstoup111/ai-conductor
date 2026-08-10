# Coherence: Acceptance-specs RED evidence visibility and completion-wait discrimination (#1246)

**Date:** 2026-08-09
**Tier:** M — technical track, so the `fr` row class is omitted (no PRD; acceptance criteria live
directly in the stories).
**Sources:** `.pipeline/intake-outcomes.md` (Source-Ref `jstoup111/ai-conductor#1246`),
`.docs/stories/acceptance-specs-hide-missing-red-evidence-and-com.md`,
`.docs/plans/acceptance-specs-hide-missing-red-evidence-and-com.md`.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-3 | covered | Live RED state on the spine as required/pending/satisfied/rejected. |
| outcome | outcome-2 | story-1, story-2, story-7, story-8 | covered | Provenance required by the validator, produced on both the skill and self-heal paths, and recoverable for legacy markers. |
| outcome | outcome-3 | story-4 | covered | A green run stays refused with its existing text and emits no satisfied state. |
| outcome | outcome-4 | story-6 | gap | outcome-4 — partially delivered by operator-approved, ADR-recorded scope. Elapsed step time, heartbeat age, last meaningful action and last test outcome are covered by story-6; active child count and the uncached input/output token split are NOT delivered. Deferred to `jstoup111/ai-conductor#1441`. See the waiver note below. |
| outcome | outcome-5 | story-6 | covered | The waiting state prints the completion predicate's own reason as the unresolved condition. |
| outcome | outcome-6 | story-5, story-8 | covered | The remediation waiver is recorded, attributable, reported as waived, and survives re-execution. |
| story | story-1 | task-2, task-3, task-4, task-5 | covered | Confirmed against the plan: each task's `**Story:** 1` line is present. |
| story | story-2 | task-15, task-17 | covered | Self-heal produces provenance; unextractable identity reports rather than fabricates. |
| story | story-3 | task-9, task-10, task-11, task-12 | covered | Union variant, both emit points, verdict states, and best-effort emission. |
| story | story-4 | task-6 | covered | Task 6 pins the exact `0 failed — RED not established` text and the three sibling counter refusals. |
| story | story-5 | task-7, task-8, task-21 | covered | Waiver acceptance, every malformed shape refused, and the shipped contract obligations. |
| story | story-6 | task-18, task-19, task-20 | covered | working/waiting classification, unmet condition, unknown child count and ledger degradation. |
| story | story-7 | task-22 | covered | Legacy-marker recovery end to end, including the honest no-contract degradation. |
| story | story-8 | task-1, task-13, task-14, task-16 | covered | Refusal classification, the widened guard, its outcome-class restraint, and exception preservation. |
| task | task-1 | story-8 | covered | Typed `infrastructure`; serves story-8's requirement that the guard consume a class rather than prose. |
| task | task-2 | story-1 | covered | |
| task | task-3 | story-1 | covered | |
| task | task-4 | story-1 | covered | |
| task | task-5 | story-1 | covered | |
| task | task-6 | story-4 | covered | |
| task | task-7 | story-5 | covered | |
| task | task-8 | story-5 | covered | |
| task | task-9 | story-3 | covered | Typed `infrastructure`; the union variant story-3's emissions require. |
| task | task-10 | story-3 | covered | |
| task | task-11 | story-3 | covered | |
| task | task-12 | story-3 | covered | |
| task | task-13 | story-8 | covered | |
| task | task-14 | story-8 | covered | |
| task | task-15 | story-2 | covered | |
| task | task-16 | story-8 | covered | |
| task | task-17 | story-2 | covered | |
| task | task-18 | story-6 | covered | |
| task | task-19 | story-6 | covered | |
| task | task-20 | story-6 | covered | |
| task | task-21 | story-5 | covered | Typed `infrastructure`; records story-5's declaration obligation in the shipped contracts. |
| task | task-22 | story-7 | covered | |

## Notes

**outcome-4 is the one gap, and it is deliberate.** The intake's fourth desired outcome enumerates
six signals. Four — elapsed step time, heartbeat age, last meaningful action, last test outcome —
are delivered by story-6 and tasks 18-20, together with the RED-evidence state from outcome-1. Two
are not: **active child count** and **uncached input/output token consumption**.

This is a capability boundary, not a convenient narrowing. The provider layer *configures*
subagents but never *observes* them (`src/conductor/src/execution/claude-provider.ts:749-750`,
`src/conductor/src/execution/llm-provider.ts:226`), and the only token fields on the event union are
the end-of-feature `feature_usage_total` aggregate (`src/conductor/src/types/events.ts:183-184`),
with no cached-versus-uncached split anywhere. Delivering either signal means parsing the provider
stream — a different subsystem, and the reason the tier would have moved to Large. The remainder is
filed as `jstoup111/ai-conductor#1441`, linked to this feature, and recorded as an explicit non-goal
in `adr-2026-08-09-acceptance-red-lifecycle-and-evidence-provenance`. Task 20 requires the
child-count field to render the literal `unknown` and forbids any code path rendering `0`, so the
absence is reported rather than disguised.

The verdict is recorded as `gap` rather than an invented "partial" because the validator treats every
unrecognized verdict string as affirmative — a word that reads more precisely would silently pass the
gate. `gap` is blocking by design, and it is the vocabulary a `.docs/coherence-waivers/` entry can
cite. The accompanying waiver names `outcome-4`.

**Documentation carries no task on purpose.** `docs/explanation/gates.md`,
`docs/guides/running-the-daemon.md` and `docs/reference/steps.md` are owned by this repository's
gating `maintain-documentation` custom step (`.ai-conductor/config.yml:114-119`, which runs after
`rebase`), so plan tasks for them would duplicate a step that already gates the build. `HARNESS.md`
is different in kind — it is a behavioral contract consumed by the engine and by every dispatched
agent, not ordinary documentation — so task-21 carries it explicitly.

**story-8 and the amendments it carries came from conflict-check.** The sweep in
`.docs/conflicts/acceptance-specs-hide-missing-red-evidence-and-com.md` found two blocking
structural gaps that no earlier step could see: the self-heal guard decides reachability by
substring-matching the completion reason, so it never reaches a semantically refused marker
(`conductor.ts:5326-5333` against `artifacts.ts:2042`); and the self-heal's wholesale marker write
erases a recorded exception (`acceptance-red-runner.ts:249-258`). Both resolutions were
operator-approved and amended additively into the two ADRs and into `#741`'s accepted story.

**Consistency pass (§4d).** Every covered row was re-read for contradiction against its counterpart.
The one pair worth naming is story-4 against story-5: story-4 requires the `0 failed — RED not
established` refusal text to remain unchanged, while story-5 makes `failed == 0` passable. They do
not oscillate — they are disjoint on the presence of a well-formed exception, and task-6 and task-7
implement the two halves of that single branch. Satisfying either leaves the other intact in both
directions. No `fail` rows.
