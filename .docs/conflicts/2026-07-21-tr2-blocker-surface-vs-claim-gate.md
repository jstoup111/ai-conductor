# Conflict Check: DECIDE-time unmerged-overlap scan (#523, Scope A)

**Date:** 2026-07-21
**Stories checked:** `.docs/stories/spec-authoring-is-blind-to-unmerged-dependent-work.md`
(TR-1…TR-6) against all 157 files in `.docs/stories/`, with focused attention on the shipped
dependency machinery (`dependency-ordered-intake-and-dispatch.md`) and the engineer authoring
stories.
**Result:** PASS — zero blocking conflicts; one degrading overlap, resolved.

## Conflict: TR-2 blocker surfacing overlaps the shipped claim gate

**Stories involved:** TR-2 "Open blocker links surfaced at DECIDE time" (this feature) vs
"the engineer authors specs only for issues whose prerequisites have shipped"
(`dependency-ordered-intake-and-dispatch.md:165`).
**Files:** `.docs/stories/spec-authoring-is-blind-to-unmerged-dependent-work.md` vs
`.docs/stories/dependency-ordered-intake-and-dispatch.md`
**Type:** behavioral-overlap
**Severity:** degrading (both behaviors work; the overlap is partial redundancy, not a
contradiction)

**Description.** `claimUnblocked` (the shipped claim gate) dequeues only *unblocked* pending
intake ideas — any idea with an OPEN `blocked_by` blocker is deferred. So for a **claim-sourced**
idea reaching DECIDE, TR-2's blocker sweep will, correctly, find no open blockers. Taken naively,
TR-2 looked redundant with an already-shipped gate — the confidence that this is a real overlap
(not a contradiction) is ~90%, grounded in `dependency-claim.ts`'s claim semantics confirmed in
recon.

**Why it is not a contradiction.** The two never assert opposing behavior on the same input. The
claim gate acts at *claim time* on *claim-sourced* ideas; TR-2 acts at *plan-lock time* and its
value lives precisely where the claim gate does not reach.

**Resolution (chosen — Option 1, least disruptive):** Scope TR-2 in the story text to its
non-redundant coverage rather than dropping it:
1. **CLI-arg / chat-sourced ideas** bypass `claim` entirely and were never blocker-gated — TR-2
   is their only blocker surfacing.
2. **Blocker links added between claim and plan-lock** make the claim-time verdict stale; TR-2's
   `/plan`-hook re-check catches them.
TR-2 explicitly does **not** modify, re-implement, or override the shipped claim gate — it reuses
`blocker-resolver.resolve()` read-only. The TR-2 story now carries this relationship note and two
scenarios (CLI/chat-sourced; added-after-claim) that make the complementarity testable.

**Rejected options:**
- *Drop TR-2 (keep only TR-1 seam overlap).* Rejected — leaves intake desired-outcome (a)
  (surface open blockers) unmet for CLI/chat ideas and against post-claim graph drift.
- *Keep TR-2 unscoped.* Rejected — reads as redundant with the claim gate and invites a
  reviewer/builder to duplicate claim-time logic.

## Other pairs examined (clean)

- **TR-1 seam-overlap vs the dependency gate stories.** No conflict — TR-1 reasons over *branch
  diffs vs candidate files*, an axis no existing story covers; the issue-`blocked_by` graph and
  the file-seam graph are disjoint (confirmed in recon). This is the genuinely novel behavior.
- **TR-6 (adds steps to `/plan` and `/architecture-review`) vs `2026-07-12-wiring-reachability-gate`,
  `verify-only-prove-closed-task-evidence`, `fable-front-of-funnel-decide`.** No resource
  contention — those touch different sections/behaviors of the same skills; TR-6 adds a new,
  advisory invocation step and changes none of their existing gates.
- **TR-3/TR-4 (quiet path, advisory-not-blocking) vs any build/finish gate.** No state conflict —
  the scan writes nothing and never blocks; it cannot create an impossible state with the
  build-side WAITING/dispatch stories (`daemon-backlog` is untouched).
- **Sequencing.** No circular dependency — the scan consumes artifacts (`## Wiring Surface`,
  `**Files:**`) that already exist at its hook points; it produces only an advisory report.

## Verdict

**PASS.** Zero blocking conflicts. One degrading overlap (TR-2 vs the claim gate) resolved by
scoping TR-2 to its complementary coverage; the affected story was updated in place. No ADR change
required — the resolution refines a story, not an architectural decision.
