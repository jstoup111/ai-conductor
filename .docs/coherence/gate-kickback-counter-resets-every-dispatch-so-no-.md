# Coherence Mapping: cross-dispatch kickback livelock bound

**Date:** 2026-07-26 · Tier M · technical track · intake jstoup111/ai-conductor#984
**Stories:** `.docs/stories/gate-kickback-counter-resets-every-dispatch-so-no-.md`
**Plan:** `.docs/plans/gate-kickback-counter-resets-every-dispatch-so-no-.md`
**ADR:** `.docs/decisions/adr-2026-07-26-cross-dispatch-kickback-livelock-bound.md` (APPROVED)

Technical track — no PRD, therefore no `fr` rows. Acceptance criteria live in the stories, so the
chain is Outcome to Story to Task.

## Traceability

| Class | Id | Cites | Verdict | Evidence |
|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-3 | covered | "A gate that fails twice with the same reason, over the same source state, stops the feature — and that limit holds across daemon re-dispatches" |
| outcome | outcome-2 | story-2 | covered | "Same source state is judged by something a no-op commit cannot falsify" |
| outcome | outcome-3 | story-4 | covered | "A run that genuinely changes the source between attempts still gets a fresh budget and is not penalized" |
| outcome | outcome-4 | story-5 | covered | "the resulting HALT names the repeated gate and its recurring failure reason" |
| outcome | outcome-5 | story-4 | covered | "a step that is legitimately nondeterministic still gets its bounded retries — the limit must not collapse to zero" |
| outcome | outcome-6 | story-3 | covered | "replaying tonight's scenario halts within two laps instead of looping until killed" |
| story | story-1 | task-1, task-2, task-7, task-8, task-9, task-10 | covered | "The kickback bound survives daemon re-dispatch" |
| story | story-2 | task-3, task-4 | covered | "An empty commit does not count as progress" |
| story | story-3 | task-12, task-13 | covered | "wiring_check is guarded by D2 like every other kickback gate" |
| story | story-4 | task-5, task-6, task-11 | covered | "Real progress earns a fresh budget; nondeterministic steps keep bounded retries" |
| story | story-5 | task-14, task-15, task-16 | covered | "The livelock HALT names the gate and its recurring reason, and is classified" |
| task | task-1 | story-1 | mapped | "RED — ledger read/write contract" |
| task | task-2 | story-1 | mapped | "GREEN — kickback-ledger.ts" |
| task | task-3 | story-2 | mapped | "RED — tree hash is the progress witness" |
| task | task-4 | story-2 | mapped | "GREEN — currentTreeHash plus tree-keyed classifier" |
| task | task-5 | story-4 | mapped | "RED — bump/reset semantics" |
| task | task-6 | story-4 | mapped | "GREEN — bumpKickbackGate" |
| task | task-7 | story-1 | mapped | "RED — a fresh feature session clears the ledger" |
| task | task-8 | story-1 | mapped | "GREEN — clear on fresh feature session" |
| task | task-9 | story-1 | mapped | "RED — the bound survives re-dispatch" |
| task | task-10 | story-1 | mapped | "GREEN — migrate both run-local maps onto the ledger" |
| task | task-11 | story-4 | mapped | "RED — unstable reason text must still terminate" |
| task | task-12 | story-3 | mapped | "RED — wiring_check D2 wiring plus incident replay" |
| task | task-13 | story-3 | mapped | "GREEN — wire wiring_check into the D2 pair" |
| task | task-14 | story-5 | mapped | "RED — HALT names the gate and is classified" |
| task | task-15 | story-5 | mapped | "GREEN — classified, informative cap HALTs" |
| task | task-16 | story-5 | mapped | "Docs, changelog, and full validation" |

## Reframed outcome, with rationale

outcome-1's phrase "fails twice with the **same reason**" is deliberately **not** implemented as
reason-text equality. Measured stability (ADR D3): only `wiring_check` emits a deterministic
reason. `build_review` reasons are LLM grader prose (`artifacts.ts:1115-1124`), `manual_test`
reasons are agent-authored markdown rows (`artifacts.ts:715-740`), and `test_suite` reasons embed
raw runner output with durations and temp paths. A reason-keyed bound would reset every lap on
three of the four gates and leave the filed defect open.

The bound is therefore keyed on the HEAD tree hash (plus resolved-task count), and the reason is
carried only for the operator-facing HALT text. Story 4's negative path and task-11 exist
specifically to hold this line against a future refactor that reintroduces reason equality as the
key.

## ADR decision coverage

D1 (durable `.pipeline/kickback-ledger.json`) is implemented by task-1, task-2, task-5, task-6,
task-7, task-8, and task-10. D2 (tree-hash progress witness) by task-3 and task-4. D3 (keyed on
tree alone, never reason text) by task-5, task-6, and task-11. D4 (cap HALT classified
`needs-human`, naming gate and reason) by task-14 and task-15. D5 (`wiring_check` joins the
capture/check pair) by task-12 and task-13. D6 (`kickback_escalation.enabled` gates the new witness
only) by task-12's negative-path case.

## Conflict-resolution coverage

Conflict 1 — the ledger and the daemon's resolved-count re-kick could disagree about whether a lap
made progress. Resolved by widening the reset condition to "tree changed OR resolved count
increased"; implemented by task-5 and task-6.

Conflict 2 — an unclassified cap HALT is recycled by the re-kick sweep (`daemon-rekick.ts:184-192`
skips only `needs-human`). Resolved by routing both cap paths through
`writeHaltMarker(..., 'needs-human')`; implemented by task-14 and task-15.

## Declared non-goals, deliberately unmapped

These appear in no story or task **by decision**, recorded so a reviewer can distinguish them from
coverage gaps: migrating `stuckGate`, `prdAuditSelfHeals`, `remediationRounds`, and
`manualTestSelfHeals` (same run-local defect, none on the incident path); changing
`MAX_KICKBACKS_PER_GATE`'s value or making it configurable; any change to a gate's PASS/FAIL
judgment, to completion derivation, or to #983's `isEngineComputedStep` retry budget; a generic
`.pipeline/` backfill on worktree recreation (#497 class, fails open and is accepted in the ADR);
and blocking or discouraging empty commits, since this spec stops one from counting as progress
rather than policing whether one may be made.

**Verdict: COHERENT.** Every desired outcome maps to at least one story, every story to at least
one task, every task back to a story, and every ADR decision and conflict resolution has
implementing tasks. The one reframed outcome is documented above with its evidence rather than
silently satisfied.
