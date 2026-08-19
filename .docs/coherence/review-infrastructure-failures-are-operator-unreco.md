# Coherence: Recoverable build review when the blocker is mechanical, not judgement

**Plan stem:** review-infrastructure-failures-are-operator-unreco
**Tier:** M · **Track:** product · **Source-Ref:** jstoup111/ai-conductor#1629
**Date:** 2026-08-18

Every row below was confirmed against the counterpart artifact file, not inferred from a
plausible id. Fifty-two rows: 3 outcome, 15 fr, 13 story, 20 task, 1 adr. No `gap`, no `fail`.

| Row class | Cited id(s) | Counterpart id(s) | Verdict | Notes |
|---|---|---|---|---|
| outcome | outcome-1 | story-5, story-6, story-7, story-8, story-9, story-10, story-12 | covered | "An operator can resolve a review whose only blocker is a persistent infrastructure failure, through a first-class recorded decision (not by editing ledgers or rewriting git history), with the reduced coverage explicitly stamped on the lap/shipped evidence." story-7 records the decision durably, story-8 gates it to a verified human, story-9 refuses it outside an exhausted fault, story-10 makes the review pass, story-12 stamps lap and shipped evidence. story-10's end-to-end criterion explicitly requires no hand-edit of durable state, which is the bullet's parenthetical. |
| outcome | outcome-2 | story-3, story-4, story-5 | covered | "A rubric infrastructure failure never increments the semantic kickback budget; mechanical faults get their own bounded retry/park policy." story-3 asserts byte-identical semantic state across a mechanical lap; story-4 re-runs instead of routing rework; story-5 supplies the separate bounded policy. Deliberate deviation, recorded not silent: the bullet's "park" alternative was weighed and **halt** chosen (adr-2026-08-18 D5), because `daemon-rekick` clears and re-dispatches `mechanical` halts and parks on every sweep, so a self-clearing terminal state would not hold for the human decision the same bullet's sibling requires. The bullet's requirement — a separate bounded policy — is delivered; only its slash-alternative wording is not. |
| outcome | outcome-3 | story-11 | covered | "A genuine semantic FAIL still blocks exactly as today." story-11 asserts an unresolved finding blocks regardless of any reduced-coverage decision, that finding-acceptance still refuses mechanical faults, and that a full-coverage review is byte-identical to today. story-10's negatives add the uncovered-fault and zero-judged cases. |
| fr | fr-1 | story-1, story-2 | covered | Classification apart at every routing seam: story-1 routes on structured kind and never on prose; story-2 preserves the closed cause so "apart" is meaningful downstream. |
| fr | fr-2 | story-3, story-4 | covered | Re-attempt without spending the semantic allowance: story-3 owns the allowance invariant, story-4 owns the re-attempt. |
| fr | fr-3 | story-4, story-5 | covered | Bounded by a separate allowance, terminating for a human: story-5's happy path is the bound and the termination. |
| fr | fr-4 | story-2, story-5, story-6 | covered | The operator is shown the rubric and the reason: story-6 is the report; story-2 makes the reason a real class rather than a generic fold; story-5 puts it in the terminal state. |
| fr | fr-5 | story-7 | covered | Recording a durable decision with a rationale for a named exhausted rubric. |
| fr | fr-6 | story-8 | covered | Interactive terminal plus verified local operator, refusal observable — story-8's scenarios assert each half. |
| fr | fr-7 | story-7 | covered | Scope: story-7's negatives assert cross-rubric, cross-class and cross-feature isolation. |
| fr | fr-8 | story-10 | covered | PASS once every fault is covered and every finding resolved. |
| fr | fr-9 | story-11 | covered | A judged finding blocks regardless; the two decision kinds cannot substitute. |
| fr | fr-10 | story-12 | covered | Lap evidence records rubric, reason, operator, rationale, time. |
| fr | fr-11 | story-12 | covered | The same entry on the shipped record, from one renderer, fail-closed. |
| fr | fr-12 | story-11 | covered | A full-coverage review carries no reduced-coverage record and is reported as today. |
| fr | fr-13 | story-9 | covered | Refusal when the rubric is not currently exhausted-mechanical — judged, skipped, and allowance-remaining each asserted. |
| fr | fr-14 | story-9 | covered | Duplicate decision refused as already recorded, nothing changed. |
| fr | fr-15 | story-13 | covered | Pre-change state parses; unaffected reviews behave identically. |
| story | story-1 | task-3, task-4 | covered | Cites fr-1, which the PRD declares. task-3 replaces the detail-prefix match with the kind check; task-4 asserts judged, skipped and malformed stay out of the lane. |
| story | story-2 | task-1, task-2 | covered | Cites fr-1 and fr-4. task-1 is the total mapping; task-2 the defect surface and the no-free-text assertion. Both scenarios are delivered, not merely cited. |
| story | story-3 | task-9 | covered | Cites fr-2. task-9 asserts byte-identical durable state across mechanical laps and that a mixed lap IS charged — both directions of the story. |
| story | story-4 | task-7, task-8 | covered | Cites fr-2 and fr-3. task-7 is the no-publish and re-run; task-8 the no-rework and no-stale-authority negatives. |
| story | story-5 | task-6, task-10, task-11 | covered | Cites fr-3 and fr-4. task-6 the advance, the ceiling, and the rebase-credited reset rule, task-10 the terminal state, task-11 the rendered cause and both resumption steps. |
| story | story-6 | task-18 | covered | Cites fr-4. task-18 covers the report's happy and negative scenarios including the "FAIL with nothing unresolved" case the intake reported. |
| story | story-7 | task-12, task-13, task-20 | covered | Cites fr-5 and fr-7. task-12 the record and identity, task-13 the refusals and isolation, task-20 the emitted occurrence. |
| story | story-8 | task-14, task-20 | covered | Cites fr-6. task-14 the action and its authority gate; task-20 makes the refusal observable. The story also carries the PRD's no-unattended-weakening non-functional requirement, asserted in task-14. |
| story | story-9 | task-15 | covered | Cites fr-13 and fr-14. task-15 enumerates every refused state and the one accepted state. |
| story | story-10 | task-16, task-17 | covered | Cites fr-8. task-16 the reducer relaxation, task-17 the uncovered-fault, unresolved-finding, zero-judged and malformed-state negatives. The story's end-to-end resumption criterion is authored as a story-level acceptance spec at BUILD entry, by design — the plan's Technical Approach records that omission explicitly rather than leaving it implicit. |
| story | story-11 | task-17 | covered | Cites fr-9 and fr-12. task-17 carries a `**Preserves:**` declaration for finding primacy and asserts the full-coverage-unchanged case. |
| story | story-12 | task-19 | covered | Cites fr-10 and fr-11. task-19 delivers both surfaces from the shared renderer with the fail-closed rule. |
| story | story-13 | task-5 | covered | Cites fr-15. task-5 asserts legacy load, corrupt-counter handling, and reads the current entry shape before editing. |
| task | task-1 | story-2 | covered | Delivers the closed-cause mapping. Architecture-review Condition 1 orders it before task-12; the dependency graph enforces that. |
| task | task-2 | story-2 | covered | Negative half of the mapping — unmapped reason is a defect, no free text in the cause. |
| task | task-3 | story-1 | covered | Kind-based classification replacing the detail-prefix match. |
| task | task-4 | story-1 | covered | Judged, skipped and malformed results excluded from the lane. |
| task | task-5 | story-13 | covered | Ledger field with legacy tolerance. Its first step re-reads the current entry shape, per the conflict report's concurrent-work obligation. |
| task | task-6 | story-5 | covered | Advance, ceiling, and the reset rule: no PASS clear, credited by an invalidating rebase per `adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence` D6. |
| task | task-7 | story-4 | covered | No-publish with allowance remaining; the absent-verdict re-run. |
| task | task-8 | story-4 | covered | No rework dispatched; no stale verdict reused. |
| task | task-9 | story-3 | covered | Semantic budget invariance, and the mixed-lap exception. |
| task | task-10 | story-5 | covered | Exhaustion publishes and halts `needs-human`. |
| task | task-11 | story-5 | covered | Halt body: cause, allowance consumed, both resumption steps, rotating faults share the bound. |
| task | task-12 | story-7 | covered | The record kind and its closed identity. |
| task | task-13 | story-7 | covered | Store-level refusals and scope isolation. |
| task | task-14 | story-8 | covered | The operator action and its TTY-plus-identity gate. |
| task | task-15 | story-9 | covered | Every refused state and the single accepted state. |
| task | task-16 | story-10 | covered | The single reducer relaxation. |
| task | task-17 | story-10, story-11 | covered | Reducer negatives plus finding primacy and decision-kind separation. |
| task | task-18 | story-6 | covered | The findings report. |
| task | task-19 | story-12 | covered | Lap evidence and shipped record, fail-closed. |
| task | task-20 | story-7, story-8 | covered | Occurrences on the existing spine; no new ledger file. |
| adr | adr-2026-08-18-mechanical-rubric-faults-are-their-own-lane | story-1, story-2, story-3, story-4, story-5, story-6, story-7, story-8, story-9, story-10, story-11, story-12, story-13 | covered | Every decision has an implementing story: D1→story-1, D2→story-2, D3→story-3 and story-4, D4→story-5, D5→story-5, D6→story-7 and story-8, D7→story-7, D8→story-10 and story-11, D9→story-12, D10→story-7 and story-8. story-13 implements the ADR's legacy-tolerance and known-limitation clauses. No story contradicts a decision: story-11's assertion that finding-acceptance still refuses mechanical faults is D6's own conformance claim to adr-2026-08-13, not a departure from it. |

## Consistency pass (§4d) — cross-layer pairs checked in both directions

- **outcome-2 ↔ task-10/task-11 (halt, not park).** Checked both ways. Satisfying the halt choice
  still satisfies the outcome's requirement of a separate bounded policy; satisfying the outcome does
  not require park, since park is offered as an alternative in the bullet's own wording. Recorded on
  the outcome-2 row rather than resolved silently, because the reader deserves to see that the
  filer's word was not taken literally and why.
- **outcome-1 ↔ task-11 (a decision that resolves nothing until the halt clears).** This was a real
  contradiction and was resolved during `/conflict-check` (Conflict 3), before this artifact: the halt
  body must name both resumption steps in order, and story-10 now asserts the end-to-end path with no
  hand-edited state. Re-checked here in both directions and it holds.
- **fr-9 ↔ task-16 (relaxing the reducer vs findings still blocking).** Satisfying task-16's single
  relaxation leaves `unresolvedFindingIds` untouched, so fr-9 still holds; satisfying fr-9 does not
  prevent the relaxation, since the two sets are disjoint. No oscillation.
- **fr-3 ↔ fr-8 (terminate for a human vs proceed once covered).** Sequential, not exclusive: the
  termination is the state in which the decision is made, and the decision is what makes fr-8's
  precondition true. Satisfying either leaves the other reachable.
- **fr-6 ↔ fr-3 (operator-only authority vs unattended termination).** The loop terminates and waits;
  it never needs the authority it is denied. Both directions hold.
- **adr D3 (no publish) ↔ fr-4 (the operator is shown the fault).** Checked, and it is the one pair
  that could have oscillated: if no lap ever published, nothing would be left for the report to show.
  It does not, because D3's no-publish is scoped to laps with allowance remaining and the exhausting
  lap publishes — which is exactly what story-6 reads. Recorded here because the scoping is what makes
  it safe, and a later edit that widened no-publish to every mechanical lap would silently break fr-4.

## Assumptions surfaced (verify-claims)

- **The three staged outcome bullets belong to this claim, not a stale one.** Confidence 95%, basis:
  verified — `.pipeline/intake-outcomes.md` carries `Source-Ref: jstoup111/ai-conductor#1629`, which
  matches this session's claim. If wrong, every `outcome-N` row above would be rejected as a
  fabricated id at land. Confirm by re-reading the staged file immediately before land.
- **The change set's only `.docs/decisions/adr-*.md` file is the one ADR authored here.** Confidence
  90%, basis: verified — the architecture-review report is not an `adr-*` file, and no other ADR was
  created or deleted on this branch. If wrong, the missing `adr` row is a gap the land gate catches.
  Confirm with `git status .docs/decisions` before land.
