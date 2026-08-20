# Conflict Check: Operator reseal as build_review Scope evidence

**Date:** 2026-08-12
**Feature:** `an-operator-s-protected-artifact-reseal-is-invisib`
**Stories checked:** `.docs/stories/an-operator-s-protected-artifact-reseal-is-invisib.md` (Stories 1-5)
**ADR corpus scope:** `repo_wide` (`.ai-conductor/config.yml:82`)
**Result:** 1 blocking conflict found and resolved; 2 examined pairs cleared with reasoning; 0 degrading conflicts accepted

## Corpus selection (repo_wide)

267 ADRs on disk, 231 carrying an APPROVED status. Narrowed to the ADRs whose subject overlaps
these stories — the `build_review` grader and its rubric, the protected-artifact seal, and the
reseal command:

**Examined:**
- `adr-2026-07-07-build-review-judgement-gate` — grader input isolation
- `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility` — **conflict, see C1**
- `adr-2026-08-09-operator-only-scoped-artifact-reseal` — the reseal command
- `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` — reseal's audit path
- `adr-2026-08-09-non-blocking-plan-scope-containment` — the accepted-widenings evidence channel
- `adr-2026-08-09-hook-owned-containment-event-ledger` — that channel's ledger
- `adr-2026-08-11-wiring-judged-in-build-review` — Wiring as a rubric item
- `adr-2026-08-12-cumulative-build-review-convergence-bound` — cumulative kickback bound
- `adr-2026-08-12-removal-anchored-tautology-exemption` — Tautology rubric exemption
- `adr-2026-07-26-protected-artifact-seal-rebaseline` — the rebaseline record this feature reads
- `adr-2026-08-05-provenance-based-protected-artifact-inheritance` — seal inheritance
- `adr-2026-08-07-provider-neutral-commit-gate-for-protected-artifacts` — the write-guard

**Narrowed out:** the remaining APPROVED ADRs address subjects these stories do not touch
(daemon lifecycle, intake//routing, releases, providers, finish/publication, test-suite
invocation, worktree and park mechanics). None asserts anything about the Scope rubric's
justification sources, the seal's `rebaselines` shape, or grader prompt assembly.

**Supersession handling:** no examined ADR is fully superseded. `adr-2026-07-27-...-self-amendment-visibility`
is *partially* amended by this feature's resolution (C1) and is therefore retained in the corpus,
per the `repo_wide` rule that partial or ambiguous supersessions stay comparable.

---

## C1 — Reseal as justification contradicts the plan-only justification rule

**Stories involved:** Story 3 / Story 4 (this feature) vs ADR: Protected-artifact seal hands
self-amendment to build_review instead of halting
**Files:** `.docs/stories/an-operator-s-protected-artifact-reseal-is-invisib.md` vs
`.docs/decisions/adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`
**Type:** contradiction
**Severity:** blocking
**ADR filename stem:** `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility`
**Story ID:** Story 3

**ADR opposing sentence (verbatim):** "The `build_review` grader prompt gains an explicit sub-rule
under its existing **Scope** rubric item: a diff that modifies an approved DECIDE artifact under
`.docs/architecture|plans|specs|stories/` must be justified by the approved plan; an unjustified
self-amendment is a Scope FAIL."

**Story opposing sentence (verbatim):** "As the build_review grader, I want the operator's
authorization and its stated rationale rendered in my prompt, so that I can judge an amendment I
would otherwise have no basis to accept."

**Description.** The ADR names exactly one admissible justification — the approved plan. This
feature exists precisely because that set is too narrow: a reseal authorizes an amendment *after*
BUILD entry, so no plan approved before BUILD can ever carry it. Both directions of the
oscillation heuristic fail. If this feature is fully satisfied, a resealed edit passes Scope
without plan justification, so the ADR's sub-rule no longer holds as written. If the ADR is fully
satisfied, the reseal channel cannot function and #1502's halt-forever behavior is permanent.

This is the root of #1502, not a symptom of it. The three dispatches on
`interrupted-self-host-runs-leak-provider-homes-unt` failed because the grader was faithfully
applying this rule.

**Resolution Options:**
1. **Extend decision 3 with a second admissible justification source, additively.** A new ADR adds
   "or by an operator reseal covering that path, judged against its recorded rationale" alongside
   the plan. The old ADR keeps `Status: APPROVED` — its decisions 1 and 2 (the `inspectSeal`
   tolerance and the non-fatal advisory) are untouched and still live — and gains an additive
   amendment note pointing at the new ADR.
2. **Fully supersede `adr-2026-07-27-...`.** Mark it `SUPERSEDED`, restate all three decisions in a
   new ADR with decision 3 widened.
3. **Narrow this feature to `.docs/stories/` only**, leaving the plan-only rule intact for the
   other three protected directories.

**Recommendation: Option 1.** Option 2 discards two decisions that are still correct and in force,
and rewriting them verbatim into a new ADR invites drift for no gain. Option 3 is arbitrary — a
reseal can name any protected path (`reseal --path` accepts them all), so restricting the evidence
channel to one directory would leave the same halt-forever behavior for the other three and split
the rule for no principled reason.

**Resolution applied.** Option 1. Authored
`adr-2026-08-12-operator-reseal-as-second-scope-justification.md` (APPROVED), and added an additive
amendment note beside decision 3 in `adr-2026-07-27-protected-artifact-seal-self-amendment-visibility.md`
and beside the corresponding assertion in Story 3 of
`.docs/stories/2026-07-27-protected-artifact-seal-self-amendment-1047.md`. Both originals are
preserved verbatim; nothing was rewritten or deleted.

---

## Examined and cleared

### E1 — Gate-instruction evidence channel vs reseal evidence channel

**Stories involved:** Story 4 (this feature) vs
`.docs/stories/build-review-flags-gate-mandated-wired-into-rewrit.md`
**Type:** behavioral overlap — **not a conflict**

That story asserts: "Given a diff that modifies `.docs/specs/` or `.docs/stories/` while an
instruction is recorded, when the grader evaluates Scope, then those edits still fail Scope — the
recorded [instruction grants no permission beyond plans]."

Both directions hold. Its scenario has a recorded *wiring instruction* and no reseal; this
feature's channel requires an `operator-reseal` rebaseline, which is absent there, so its edits
still fail Scope exactly as asserted. Conversely, this feature's scenarios carry a reseal, which
its scenario does not, so satisfying this feature does not weaken that assertion.

**Recorded for the implementer:** the two channels feed the same rubric item under different
preconditions. Neither may be widened into a general `.docs/` permission — that is precisely the
failure mode both were designed to avoid. Story 4's Done-When pins the Scope rubric sentence as
present and unmodified, which guards this.

### E2 — Cumulative convergence bound

**Stories involved:** Stories 1-5 vs `adr-2026-08-12-cumulative-build-review-convergence-bound`
(merged spec #1523, PR #1526 open)
**Type:** sequencing — **not a conflict**

That ADR caps cumulative `build_review` kickbacks at 5 and halts `needs-human` beyond it; this
feature removes a systematic cause of non-convergence. Both directions hold: the bound still fires
for features that fail to converge for other reasons, and this feature's effect is to stop
producing laps rather than to evade counting them. They are complementary and independently
landable. Different seams — that ADR changes the kickback ledger and the conductor's halt path;
this changes prompt assembly — so merge contention is limited to none.

One ordering note, not a conflict: with the bound live, a feature already at 4 cumulative laps from
this defect could halt before a shipped reseal channel gets a chance to help it. The follow-up to
re-dispatch `interrupted-self-host-runs-leak-provider-homes-unt` (#1223) should clear its kickback
ledger, which a fresh feature session already does.

---

## Re-check

Re-ran the full scan after applying C1's resolution. **Zero blocking conflicts remain.** No
degrading conflicts were accepted.
