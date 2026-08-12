# Conflict Check: bounded build_review convergence and removal-anchored Tautology grading

**Date:** 2026-08-12
**Issue:** #1521
**Stories scanned:** `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md`
(Stories 1–7) plus every other file in `.docs/stories/`.
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:96`).

## Corpus selection

263 ADRs exist in `.docs/decisions/`. 88 mention `build_review`, `kickback`, `writeHaltMarker`,
halt classification, or re-kick. Of those, the following were **examined in full** because their
subject overlaps this spec's gates, counters, halt paths, or prompt text:

| ADR filename stem | Why examined |
|---|---|
| `adr-2026-07-26-cross-dispatch-kickback-livelock-bound` | Owns the per-tree bound this spec layers on |
| `adr-2026-07-13-kickback-build-no-op-escalation` | Owns D2 escalation and the `kickback_escalation.enabled` switch this spec's kill-switch mirrors |
| `adr-2026-07-07-build-review-judgement-gate` | Owns the rubric wording taken verbatim into the prompt |
| `adr-2026-07-21-completeness-as-build-review-rubric` | Added the fourth rubric item |
| `adr-2026-08-11-wiring-judged-in-build-review` | Adds a fifth rubric item — **source of the blocking conflict below** |
| `adr-2026-07-23-build-review-fresh-base-disposition` | Owns the existing rebase-repair Tautology exception |
| `adr-2026-08-09-recorded-red-exception-for-remediation` | Governing precedent for recorded exceptions |
| `adr-2026-07-28-total-halt-classification-legacy-boundary` | Defines which halt classes a new writer may select |
| `adr-2026-08-11-halt-events-ride-the-persisted-spine` | Makes `loop_halt` persist — the basis for outcome O4 |
| `adr-013-daemon-main-advance-rekick` | Owns the re-kick sweep that a halt class must survive |
| `adr-2026-07-04-kickback-event-emission-and-log-prominence` | Owns the `kickback` event this spec extends |
| `adr-2026-08-02-plan-scope-containment-at-commit-boundary` | Owns `acceptedWidenings`, a sibling evidence block |

**Narrowed out:** the remaining 251 ADRs, whose subjects (provider routing, parking, publication,
intake, worktree lifecycle, release gating, ownership, rebase mechanics, model policy) do not touch
this spec's counters, gates, halt paths, prompt text, or ledger. None was excluded on supersession
grounds; no examined ADR carries an ambiguous or partial supersession.

---

# BLOCKING

## Conflict 1: The rubric this spec edits has four items on main and five under an APPROVED ADR

**Stories involved:** Story 7 (grader receives removal evidence and applies a per-test exemption)
vs `adr-2026-08-11-wiring-judged-in-build-review`
**Files:** `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md` vs
`.docs/decisions/adr-2026-08-11-wiring-judged-in-build-review.md`
**Type:** sequencing (with resource contention on `build-review-prompt.ts`)
**Severity:** blocking

**ADR filename stem:** `adr-2026-08-11-wiring-judged-in-build-review`
**Story ID:** Story 7

**ADR opposing sentence (verbatim):** "The all-or-FAIL rule extends from four items to five, and the
`rubric` object in `.pipeline/build-review.json` gains a `wiring` boolean with a matching
`findings.wiring` key."

**Story opposing sentence (verbatim):** "Given the other three rubric items, when the prompt is
assembled, then their text is unchanged and the all-or-FAIL rule is unchanged."

**Description.**
`adr-2026-08-11-wiring-judged-in-build-review` is APPROVED, so it is authoritative. Its
implementation is **not on main**: `src/conductor/src/engine/build-review-prompt.ts` at this
worktree's base still enumerates exactly four rubric items and contains zero occurrences of
`wiring`. The implementation lives in PR **#1517**, which is **OPEN** and titled
`needs-remediation: feat/daemon-per-task-wired-into-contracts-cost-build-cycles-th`.

That is the same feature whose eight-lap churn produced issue #1521. So this spec's fix and the
feature whose failure motivated it edit the same rubric block in the same file, and neither has
landed.

Two independent problems follow:

1. **A story asserts something an APPROVED ADR falsifies.** Story 7's "the all-or-FAIL rule is
   unchanged" is true against main and false against `adr-2026-08-11`, which changes it to five
   items. A build agent implementing Story 7 after #1517 merges would write a test that fails, or
   would "fix" it by reverting the wiring item.
2. **Direct merge contention.** Both changes rewrite the rubric enumeration and both add a field to
   `BuildReviewInputs`. Whichever lands second rebases into a conflict in the exact block the other
   rewrote.

Confidence 95%, basis: verified — the ADR status line, the four-item enumeration and zero `wiring`
matches in main's prompt source, and PR #1517's open/needs-remediation state.

**Resolution Options:**

1. **Sequence this spec behind #1517** — declare a dependency so the daemon does not dispatch this
   feature until #1517 merges, and reword Story 7's unchanged-rubric criterion to name the other
   rubric items generically ("every rubric item other than Tautology") instead of counting them.
   Least disruptive to both designs; costs a wait on a feature that is currently blocked.
2. **Author this spec against the five-item rubric now** — write Story 7 as though `wiring` already
   exists, and accept that the build will not compile against main until #1517 lands. Removes the
   wait but guarantees a broken intermediate state and makes this spec untestable in isolation.
3. **Sequence #1517 behind this spec** — land the convergence bound and the removal exemption
   first, precisely so that #1517's remediation stops churning, then rebase #1517 onto it.
   Attractive because this fix is what unblocks the other feature, and because #1517's churn is the
   live cost. Costs a rebase of a large, already-remediated branch into a rewritten rubric block.

**Recommendation: Option 3, with Option 1's rewording applied regardless.**
The rewording is correct in every scenario — a criterion that counts rubric items is brittle by
construction and should name what it means. On ordering, Option 3 is the one that breaks the
deadlock rather than waiting on it: #1517 is blocked *because* of the defect this spec fixes, so
sequencing this spec behind it means waiting on the very loop this work terminates. This is an
operator decision, not a spec decision, because it trades a large branch rebase against a blocked
feature.

---

# DEGRADING

## Conflict 2: Two Tautology exceptions now coexist in one rubric item

**Stories involved:** Story 7 vs `adr-2026-07-23-build-review-fresh-base-disposition`
**Files:** `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md` vs
`.docs/decisions/adr-2026-07-23-build-review-fresh-base-disposition.md`
**Type:** overlap
**Severity:** degrading

**Description.**
The prompt already carries a Tautology exception for rebase repair: "For a changed test that
directly repairs recorded stale base-state expectations, skip the ordinary Tautology mutation check
and instead verify the pre-repair test fails against the rebased state while the repaired test
passes." This spec adds a second exception anchored on diff removals.

These do not contradict — they are anchored on different engine-recorded evidence
(`repairContext` versus `removalContext`) and a test may legitimately qualify under either. The
degradation is **readability at the point of judgement**: two adjacent exceptions to the same rubric
item invite a grader to read them as a general licence to skip mutation-sensitivity whenever any
engine evidence block is non-empty. That is precisely the blanket-exemption failure
`adr-2026-08-12-removal-anchored-tautology-exemption` D3 exists to prevent.

Applying the two-directional heuristic: fully satisfying the rebase-repair exception leaves the
removal exemption intact, and vice versa. One "yes" in each direction — an overlap, not an
oscillation.

Confidence 90%, basis: verified against the prompt text and both ADRs.

**Resolution Options:**
1. Render the two exceptions as an explicitly enumerated, closed list, each naming its own evidence
   block, with a sentence stating that a changed test qualifying under neither is measured normally.
2. Merge them into one generalized "engine-recorded evidence" exception.
3. Leave them adjacent and rely on the grader.

**Recommendation: Option 1.** It is a wording change with no design cost, and it converts an
open-ended pair into a closed list — which is what stops the general-licence reading. Option 2 is
the blanket exemption in disguise; Option 3 accepts a known risk for no benefit.

**Accepted:** Option 1, folded into Story 7's Done-When as an explicit closed-list assertion.

## Conflict 3: Clearing the cap HALT re-enters a feature that immediately re-halts

**Stories involved:** Story 3 (cap halt) vs `adr-013-daemon-main-advance-rekick` and the operator
recovery path documented for stalled features
**Files:** `.docs/stories/repeated-build-review-semantic-failures-can-churn-.md` vs
`.docs/decisions/adr-013-daemon-main-advance-rekick.md`
**Type:** oscillating (bounded)
**Severity:** degrading

**Description.**
`cumulative` is durable in `.pipeline/kickback-ledger.json` and is cleared only by a `build_review`
PASS. The documented operator recovery for a halted feature is to remove `.pipeline/HALT` and
`.pipeline/HALT.class` and let the daemon re-dispatch. An operator who does exactly that after a
cap halt gets a feature whose `cumulative` is still above the cap: `build_review` FAILs once and
re-halts immediately.

Applying the two-directional heuristic: satisfying "the cap terminates the run" makes "clearing the
HALT resumes the run" false; satisfying "clearing the HALT resumes the run" would require the cap
not to persist, making the first false. Two "no" answers — a genuine oscillation.

It is **degrading rather than blocking** because it is bounded and loud: it costs one review lap per
clear, not an unbounded loop, and the halt reason names the cause. It is also arguably the correct
behavior — the halt means "a human must look", and deleting the marker is not looking. The defect is
that the operator is not told what to do instead.

Confidence 85%, basis: inferred from the ledger lifecycle and the documented recovery procedure;
not observed, since the code does not exist yet.

**Resolution Options:**
1. Document the recovery explicitly in `docs/runbooks/stalled-or-stuck-feature.md`: clearing a
   cumulative-cap halt requires either resetting the gate's `cumulative` in the ledger or setting
   the kill-switch, and state that re-dispatching without either will re-halt on the next lap.
2. Reset `cumulative` automatically whenever the HALT marker is removed.
3. Grant a fixed extra allowance on re-entry after a cap halt.

**Recommendation: Option 1.** Option 2 makes the bound trivially defeatable by the documented
recovery gesture, which is the same failure as having no bound. Option 3 reintroduces an unbounded
ratchet — the operator can clear repeatedly, each time buying more laps. Documenting the correct
gesture keeps the bound meaningful and puts the decision where it belongs, with the human the halt
summoned.

**Accepted:** Option 1, carried as a documentation task in the plan.

---

# Checks that came back clean

Each was reasoned through rather than assumed compatible.

**(a) Two bounds on the same gate firing on the same lap.** The per-tree `count` bound and the
cumulative bound can both be satisfied on one lap. Not a conflict: they are consulted in a fixed
order at a single call site and Story 3 carries an explicit negative-path criterion requiring
exactly one halt with an unambiguous reason. Verified against the `build_review` FAIL branch, which
already sequences the D2 escalation check ahead of the budget consumption.

**(b) Halt class versus the re-kick sweep.** `adr-2026-07-28` D1 permits a new writer to select
`needs-human`, and requires it when retry safety is not mechanically provable — which is exactly the
cap's situation. `adr-013`'s sweep retains a `needs-human` halt. Consistent, and identical to the
choice `adr-2026-07-26` D4 already made for the peer cap halt.

**(c) The new Tautology exemption versus the existing rebase-repair exception.** Recorded above as
Conflict 2 (degrading), not clean.

**(d) Does the cumulative bound contradict `adr-2026-07-26`'s fail-open reset rule?** No. That ADR's
verbatim commitment is "a genuine tree change always earns a fresh budget (fail-open)" — a statement
about `count`, which this spec does not modify. The cumulative counter is a distinct field with a
distinct reset rule, and `adr-2026-08-12-cumulative-build-review-convergence-bound` tabulates the
distinction. No supersession is required. This was the most likely place for a real contradiction
and it is genuinely absent.

**(e) Resource contention on `.pipeline/kickback-ledger.json`.** None. The ledger is per-feature,
per-worktree, single-writer, and written through the existing unique-temp-file plus `rename(2)`
discipline. The new field adds no reader or writer outside that path. Story 1 carries the atomicity
negative path.

**(f) Story-versus-story oscillation within this spec.** All 21 pairs tested in both directions.
Story 3 (halt at cap) and Story 4 (switch disables the halt) are conditioned on disjoint config
states. Story 1 (always increment) and Story 2 (PASS resets) touch the same field under disjoint
triggers. Story 6 (derive evidence) and Story 7 (consume it) are a producer/consumer pair with no
mutual constraint. No oscillation found among the spec's own stories.

**Existing stories in `.docs/stories/`.** No other stories file asserts behavior about the kickback
ledger's counters, the Tautology rubric, or the cumulative halt path.

---

# Verdict

**Conflict check PASSED.** Zero blocking conflicts remain.

**Conflict 1 — resolved by the operator: Option 3.** This spec lands first; PR #1517 rebases onto
it. Rationale carried from the recommendation: #1517 is blocked by the very defect this spec fixes,
so sequencing behind it would mean waiting on the loop this work terminates. Option 1's rewording
was applied regardless, since a criterion that counts rubric items is brittle in every scenario —
Story 7's unchanged-rubric criterion and its matching Done-When item are now item-count agnostic,
recorded as an additive amendment note beside the original assertion.

**Conflict 2 — accepted, Option 1.** The Tautology exceptions render as an explicitly enumerated,
closed list with a closing statement that a test qualifying under neither is measured normally.
Carried into Story 7's Done-When.

**Conflict 3 — accepted, Option 1.** The runbook documents that clearing a cumulative-cap halt
requires resetting the gate's `cumulative` or setting the kill-switch, and that re-dispatching
without either re-halts on the next lap. Carried as a documentation task in the plan.

## Re-check after resolution

Re-ran the full scan against the amended stories. Story 7 no longer asserts a rubric item count, so
it is compatible with both the current four-item prompt and the five-item prompt
`adr-2026-08-11-wiring-judged-in-build-review` mandates. No new conflict was introduced by the
amendment. The merge contention on `build-review-prompt.ts` remains real but is now a sequenced,
acknowledged rebase rather than an unresolved collision.
