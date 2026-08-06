# Conflict Check: a-successful-finish-publication-transition-consume

Feature: a-successful-finish-publication-transition-consume
Issue: jstoup111/ai-conductor#1342
Date: 2026-08-06
Verdict: **PASS with three coordination notes** — no contradictions, no state conflicts, no
resource contention. Two adjacent in-flight specs and one live interaction with already-shipped
retry machinery are recorded below.

## Checked against

- Committed `.docs/stories/`, `.docs/plans/`, `.docs/decisions/` on this branch's base (`main`).
- All local `spec/*` branches, filtered to those whose diff touches
  `src/conductor/src/engine/finish-publication.ts`,
  `src/conductor/src/engine/finish-publication-production.ts`,
  `src/conductor/src/engine/conductor.ts`, `src/conductor/src/types/events.ts`, or
  `src/conductor/src/engine/resolved-config.ts`.
- Open PRs #1339, #1324, #1319, #1286, #1262, #1239, #1190, #1168, #890.
- The two related issues #1342 names explicitly: #1006 and #1107.

**No branch other than this one carries a code change to `finish-publication.ts` or
`finish-publication-production.ts`.** Three branches touch `conductor.ts`
(`spec/codex-auth-sandbox-readiness-905`, `spec/daemon-self-host-guardrails`,
`spec/self-host-phase6-wiring`); none of them touches the FINISH publication routing block
(`conductor.ts:5486-5540`). No textual collision is expected at that block.

## C1 — #1006 and #1107 are the same conflation elsewhere (adjacent, not overlapping)

`spec/daemon-api-rate-limit-episode-cascades-into-mass-h` (docs-only, unmerged) specs the
rate-limit half of #1006: a non-failure condition consuming a step's retry budget. #1107 is
the same shape again for FINISH's STOP refusal.

This is not a contradiction — it is the same defect class in three places. #1342's own scope
note is explicit that the smallest fix is deliberately finish-publication-only and that the
others are *related, not required*.

**Action:** this spec introduces no shared retry taxonomy and changes no step's accounting
other than the FINISH publication arm. If #1006's episode coordinator later generalises
"non-budget-consuming outcome" across steps, `progress_finish` is a clean candidate to fold
in; nothing here blocks or pre-empts that.

## C2 — Escalation deliberately does not climb on progress (live interaction, by design)

`adr-2026-07-05-retry-as-escalation-ladder` is already implemented: `escalateAttempt(model,
effort, attempt + 1, ...)` derives the next attempt's (model, effort) from the attempt
counter. Because `progress_finish` leaves the attempt counter unchanged, a publication that
advances five times does **not** climb the escalation ladder.

That is the correct outcome — escalating model/effort because a transition *succeeded* would
be nonsense, and it matches the precedent exactly: the build step's T4 progress bypass
(`conductor.ts:6296-6303`) also declines to climb. It is recorded here because the
interaction is non-obvious and a future reader could mistake it for a missed wiring.

**Action:** the plan asserts, as a negative-path test, that a `progress_finish` route emits no
`step_retry` event — which is also what keeps escalation telemetry off that path.

## C3 — `finish` retry budget is shared with the FINISH step's non-publication failures

`resolved-config`'s `finish: 6` is one budget for the whole FINISH step, not a
publication-specific one. Publication progress is being removed from it; publication
failures and any other FINISH step failure continue to share it unchanged.

No conflict — this is the intended restoration of the budget's purpose. Noted so a reader
does not expect a new, separate publication failure budget to appear.

**Action:** none. The plan changes no budget value and adds no configuration key.

## Ordering constraint (intra-feature)

The disposition union widening and the fail-closed validator (`isExactDisposition`) must land
in the same task. Widening `PublicationDisposition` without enrolling the new kind in the
validator routes a correct adapter result to
`'Unknown or contradictory FINISH publication disposition'` — a worse halt than the bug being
fixed. This is carried as condition 1 of the architecture review and as an explicit
single-task requirement in the plan.

The adapter change (Task 3) must follow the type + route change (Tasks 1-2), and the
conductor accounting (Tasks 5+) must follow the adapter change, or intermediate commits leave
the machine routing progress to a halt.
