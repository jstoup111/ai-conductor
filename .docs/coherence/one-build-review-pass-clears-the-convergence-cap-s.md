# Coherence: One build_review PASS clears the convergence cap

**Date:** 2026-08-18
**Tier:** M — technical track (no PRD, so the `fr` row class is omitted as not applicable)
**Plan stem:** `one-build-review-pass-clears-the-convergence-cap-s`
**Outcome source:** `.pipeline/intake-outcomes.md` (`Source-Ref: jstoup111/ai-conductor#1694`)

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-4, story-5 | covered | "A feature that accumulates many `build_review` kickbacks reaches a bounded terminal state without operator intervention, even when some of those laps passed." story-1 is the mechanism: a PASS no longer clears the convergence counters, so laps accumulate across an oscillation and the approved cap becomes reachable as designed. story-4 removes the reset helper entirely so the defect cannot be reintroduced by a later caller. story-5 states the rule over the ledger entry rather than over one counter, so `adr-2026-08-17`'s per-rubric bound — the early trip, measured at 5 of 5 on spinning features — inherits it and cannot be zeroed either. The terminal state itself is the existing `needs-human` halt; this feature adds no new bound and no new threshold, which is deliberate and recorded in the ADR's Alternatives after two counter-shaped designs were withdrawn. |
| outcome | outcome-2 | story-2 | covered | "A feature whose `build_review` verdict is invalidated by a rebase and legitimately re-enters is still not halted for laps it did not earn — the property D2 was protecting is preserved." story-2 re-keys that exemption onto the occurrence that justifies it: the rebase-invalidation site credits the gate's laps back, conditional on `classifyGateInvalidation` having actually invalidated it, scoped to `build_review`'s entry, and one-shot per invalidation. Its negative paths pin the preserved-gate case, the no-second-credit case, the PASS-without-rebase case, and the fail-closed fallback, which credits deliberately so the budget fails open rather than toward a spurious halt. |
| outcome | outcome-3 | story-3 | covered | "When a convergence bound is cleared or not cleared, that decision is legible afterwards from persisted state, so 'why did the cap not fire?' is answerable without reconstructing it from event ledgers by hand." story-3 puts the credit on the persisted spine as an additive optional field on the existing `kickback` member, emitted one-to-one with it at the same site. Its negative paths assert that a preserved gate reports no credit, that an unaware consumer parses unchanged, and that no event type and no sink declaration were added — the last discharging `adr-2026-07-26-event-sink-registry-exhaustiveness`. Per the event-spine skill this emission is what keeps the durable counters legal under exception C, so it is not optional scope. |
| adr | adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence | story-1, story-2, story-3, story-4, story-5 | covered | D1 (no counter on the entry is cleared by a PASS; the reset leaves the step-completion path) to story-1 and story-4. D2 (the invalidating rebase credits the laps back, under its three conditions — inherited predicate, `build_review` only, one-shot) to story-2, whose negative paths carry each condition. D3 (the credit rides the existing `kickback` member as an additive optional field, not a new union member and not `rebase_gate_invalidated`, which is emitted from a different function and is absent on the fail-closed fallback) to story-3. D4 (no new config gate; `cumulative_kickback_bound` unchanged; legacy read tolerance unchanged) to story-1's negative path. D5 (`build_review` only) scopes all five. D6 (the operator decision widening the rule from named counters to the entry, with its recorded dissent about the mechanical-fault lane) to story-5. This ADR is created in this change set and supersedes `adr-2026-08-12` D2 only. |
| story | story-1 | task-2, task-3, task-11 | covered | task-2 is RED for retention across a PASS, accumulation from the retained value, cap reachability with PASSes interleaved, and `count` behaving exactly as before. task-3 is GREEN: the reset call and its import leave the step-completion path, and pre-existing assertions are amended rather than deleted. task-11 corrects `docs/reference/configuration.md`, which states the now-false "A passing `build_review` resets the counter". |
| story | story-2 | task-1, task-5, task-6 | covered | task-1 re-derives in-tree the ratio the ADR's approval rests on — 95 consumed kickbacks to 1 rebase-origin invalidation over 15 features — and is instructed to halt rather than proceed if it no longer holds. task-5 is RED for all five conditions including the preserved-gate and fail-closed cases. task-6 is GREEN and is explicitly forbidden from recomputing `adr-2026-07-20`'s partition at the credit site, discharging review condition 4.1. |
| story | story-3 | task-7, task-8 | covered | task-7 adds the additive optional field to the `kickback` member, populates it at the emission site co-located with the credit, and proves it round-trips through the persisted ledger. task-8 is the negative half: the `EVENT_SINKS` type set is unchanged and an unaware consumer parses a record without the field, which is what keeps the field-not-member choice enforced rather than merely intended. |
| story | story-4 | task-10 | covered | task-10 greps for remaining production callers, removes the helper and its export, and repoints or removes the coverage that exercised it directly — so the defect cannot return through a function that still exists. |
| story | story-5 | task-4, task-9 | covered | task-4 implements the credit generically over whichever lap-counting fields the entry carries, with a test that an unknown additional lap-counting field is credited too and that budget state is preserved. task-9 is the negative half: `count` is excluded by construction, and the no-PASS-reset assertion is expressed over the entry rather than over named fields so a later counter is covered without a further change. |
| task | task-1 | story-2 | covered | `infrastructure`, `Verify-only: yes` — counts consumed kickbacks and rebase-origin invalidations over the persisted corpus, records the ratio in the commit message, and halts for the operator if the ratio no longer supports the design. |
| task | task-2 | story-1 | covered | RED for retention, accumulation, cap reachability, and `count` isolation. |
| task | task-3 | story-1 | covered | GREEN: the PASS reset leaves the step-completion path; existing assertions amended to the new contract. |
| task | task-4 | story-5 | covered | The credit helper, generic over the entry's lap-counting fields, preserving every other field. |
| task | task-5 | story-2 | covered | RED for invalidated, preserved, gate-scoped, one-shot, and fail-closed cases. |
| task | task-6 | story-2 | covered | GREEN: the conditional one-shot credit inside the existing re-open loop, using that loop's own predicate. |
| task | task-7 | story-3 | covered | The additive optional field on the `kickback` member and its emission co-located with the credit. |
| task | task-8 | story-3 | covered | Negative: no new event type, no changed sink declaration, optional-field tolerance. |
| task | task-9 | story-5 | covered | Negative: `count` excluded from the credit; no PASS reset survives anywhere on the entry. |
| task | task-10 | story-4 | covered | Removes the unreachable reset helper from the ledger's exported surface. |
| task | task-11 | story-1 | covered | Documentation upkeep for the reset statement in `docs/reference/configuration.md`. |

## Consistency pass

Every outcome resolves to at least one story and every story to at least one task, with no story or
task orphaned. The story-to-task mapping and the task-to-story mapping were derived independently
from the stories file and the plan's own `**Story:**` lines and agree on all eleven tasks.

The `fr` row class is absent because this is a technical-track feature with no PRD; acceptance
criteria live directly in the stories, as the track marker records.

## Deviations, stated rather than implied

The plan's Task 11 is documentation upkeep and is mapped to story-1. Documentation is deliberately
not its own story — it accompanies functional work rather than carrying acceptance criteria — so the
row records the task under the story whose behavior change makes the existing sentence false.

Outcome-1 asks for a bounded terminal state reached without operator intervention. What ships is the
removal of the mechanism that made the existing bounds unreachable, not a new bound. That is the
operator-confirmed scope: two counter-shaped designs were authored and withdrawn, one on the
principle that it answers the same question with a different reset rule, and one on a corpus
measurement showing a lifetime cap fires on 7 of 15 features at cap 5 and only after roughly nine
laps of spend at cap 8. The early trip is `adr-2026-08-17`'s per-rubric bound, and story-5 is what
guarantees this feature's rule reaches it.

## Assumptions

The design rests on rebase-origin invalidation of `build_review` being rare relative to consumed
kickbacks — 1 against 95 over 15 features, confidence 90%, basis verified over the persisted event
ledgers. If that ratio is materially different in populations this corpus cannot see, the refund's
trigger widens toward the PASS reset it replaces and the fix degrades toward today's behavior rather
than becoming incorrect. Task 1 re-derives it in-tree and halts rather than proceeding on a changed
basis.
