# Conflict Report: Background Auto-Intake on the Conduct Loop

**Date:** 2026-06-30
**Stories:** `.docs/stories/background-intake-conduct-loop.md`
**Checked against:** existing intake/engineer/daemon stories + ADRs 007, 008, 009, 011, 012, and
the `intake-issue-pr-link-autoclose` story.

Scan covered all five conflict types (contradiction, overlap, state, resource, sequencing), both
internally and against the existing system. Two **degrading** conflicts found (both resolve into
the architecture-review step); zero blocking. Plus consistency notes confirming the design honors
existing keystone ADRs.

---

## Conflict 1: Shared ledger/inbox — concurrent writers

**Stories involved:** "Loop polls all registered repos on an interval" / "Each new issue is
captured exactly once" (FR-1/FR-2) vs the **existing launcher pre-poll** and any **per-repo daemon**
that might host the poll.
**Type:** resource-contention
**Severity:** degrading

**Description:**
The durable ledger (`~/.ai-conductor/engineer/ledger.json`) and inbox are shared, single-file
state. ADR-012 makes the ledger the *sole dedup authority*, so two pollers cannot logically
double-route the same idea — but ADR-012 does not by itself make a concurrent `known()`→`record()`
read-modify-write atomic. If the new background loop polls while the existing `conduct-ts engineer`
launcher pre-poll also runs (or if intake is hosted per-repo and multiple daemons poll at once),
two writers can interleave on the JSON file: a TOCTOU double-enqueue or a clobbered write. The
stories assert idempotent capture (FR-2/FR-4/FR-12) but do not specify how concurrent pollers are
serialized.

**Resolution Options:**
1. **Single-writer poller (least disruptive to correctness).** Exactly one process owns intake
   polling (a dedicated supervisor/"brain" loop). The existing launcher pre-poll becomes a no-op
   (or a thin "ensure the poller is running") when the background poller owns intake. No two
   processes write the ledger concurrently.
2. **Atomic, locked ledger writes.** Keep multiple potential pollers but make
   `known()`→`record()` atomic via a file lock (reuse the pidfile-lock pattern from ADR-010) and
   temp-file-rename writes. Allows per-repo-daemon hosting at the cost of a lock dependency.
3. **Accept eventual dedup, atomic single writes only.** Make each write atomic (temp+rename) and
   tolerate a rare duplicate enqueue, relying on the operator to ignore the dup. Cheapest, weakest.

**Recommendation:** Defer the choice to **architecture-review**, which already owns the open
"single brain loop vs per-repo daemon" question — that decision *determines* whether more than one
writer can exist. If the answer is a single supervisor loop (Option 1), the contention disappears
by construction; if per-repo daemons host it, Option 2 is required. Produce an APPROVED ADR.

---

## Conflict 2: Auto-route-by-origin vs the interactive routing-confirmation gate (ADR-007)

**Stories involved:** "Captured ideas are auto-routed to their originating repo" (FR-3) vs
ADR-007's interactive loop, where the operator **confirms the routing target** before the idea
proceeds.
**Type:** behavioral-overlap
**Severity:** degrading

**Description:**
ADR-007 establishes operator-confirmed routing as a gate in the interactive loop. FR-3 routes
origin-bearing intake ideas to their originating repo with **no confirmation** at capture time.
These are not mutually exclusive — the human gate moves from "confirm before routing" to "accept or
redirect when the operator picks the idea up for DECIDE" — but the contract in ADR-007 must be
amended so the engineer skill accepts a *pre-routed* target (with redirect still possible) rather
than always prompting from scratch.

**Resolution Options:**
1. **Amend the routing gate (recommended).** The engineer's routing step accepts an idea that
   already carries a target (auto-routed by origin); it presents the pre-resolved target and still
   allows redirect/no-fit. A new ADR supersedes/amends ADR-007 narrowly for origin-bearing intake.
2. **Keep ADR-007 unchanged; "route" only sets a hint.** FR-3 stores origin as a non-binding hint;
   the operator still confirms routing from scratch each time. Less automation benefit; closer to
   today.

**Recommendation:** Option 1, via an amending ADR authored in **architecture-review**. Origin
routing for GitHub-issue intake is unambiguous, and the human still gates DECIDE — so a pre-resolved
target with redirect preserves the ADR-007 safety intent without re-asking the obvious.

---

## Consistency notes (checked — NOT conflicts)

- **ADR-008 (agent-hosted, interactive-only loop) is honored.** FR-9/FR-11 keep polling mechanical
  and DECIDE human-gated; the loop never spawns a headless authoring subprocess. The design is
  consistent with ADR-008 rather than in tension with it — confirm this explicitly in
  architecture-review so the as-built review doesn't re-litigate it.
- **ADR-012 (ledger sole dedup authority) is relied upon, not contradicted.** FR-2/FR-4/FR-12
  delegate all dedup to the ledger. The only gap is concurrency (Conflict 1), not the dedup model.
- **FR-8 depends on, does not conflict with, `intake-issue-pr-link-autoclose`.** FR-8 reuses that
  story's marker→`Refs`→`Closes` chain end-to-end; it adds the requirement that *auto-captured*
  ideas feed it a source reference. Overlap is a dependency, not a contradiction.

---

## Internal conflicts

None. Polling (FR-1) and DECIDE (FR-11) are disjoint phases; notification (FR-5) and notification
dedup (FR-12) are complementary; no two stories assert contradictory behavior over the same state.

---

## Disposition

No blocking conflicts. Two degrading conflicts, both deliberately routed into **architecture-review**
(the next DECIDE step), which must: (a) decide single-loop vs per-repo-daemon hosting and resolve
the ledger-concurrency contention accordingly, and (b) author an amending ADR for origin-routing vs
ADR-007. Stories may proceed to architecture-review unchanged.
