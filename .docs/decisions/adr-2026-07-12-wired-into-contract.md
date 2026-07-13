# ADR: Wired-into contract — architecture decides, plan carries, Small tier falls back

**Date:** 2026-07-12
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer session (intake jstoup111/ai-conductor#462)

## Context

Features repeatedly ship green-but-unwired: primitives exist, unit tests pass, every gate is
satisfied, but no production code calls them (#392 Task 20 dead `onHaltWritten` callback;
self-host guardrails shipped INERT with the wiring PR unenforced (#179/#180); priority bands
wired into 1 of 3 schedulers (#460/#461)). Today's guards are prompt-level (architecture-review
§12 as-built sweep, writing-system-tests real-entry-point rule) plus one narrow grep in
`/pipeline` — nothing deterministic, and nothing at plan time declares what "wired" means for a
feature. Per the deterministic-first principle, this needs a machine-checkable contract.

Two questions decided here: **where does the wiring decision originate**, and **where does the
machine-parsed contract live**.

## Options Considered

### Option A: Contract lives in architecture docs (ADR/review report)
- **Pros:** the wiring decision *is* architectural — "which consumers must adopt this
  capability" is design scoping (#460's gap was exactly this).
- **Cons:** ADRs/review reports are prose with no engine grammar — gating on them creates a new,
  fragile parsing surface; Small-tier features have no architecture artifacts at all, leaving the
  most escape-prone features uncovered.

### Option B: Contract lives only in the plan
- **Pros:** the plan is the engine's only parsed surface (`Files:`, `Dependencies:` — #424/#433
  precedent); per-task granularity matches the evidence gate.
- **Cons:** architecture-review runs BEFORE the plan exists, so the plan cannot originate the
  decision; consumer-scoping errors would never get design-time review.

### Option C (chosen): Architecture decides, plan carries
- **Pros:** each artifact does what it's for — the APPROVED architecture-review output enumerates
  the production entry points/consumers (the decision, human-reviewed); `/plan` derives per-task
  engine-parsed `Wired-into:` lines from it (the contract, machine-checked). Mirrors the
  PRD→stories FR derivation pattern.
- **Cons:** two artifacts can drift (plan contradicts approved architecture) — mitigated by
  making that drift an architecture-review kickback at plan review, and by the gate verifying the
  plan lines regardless.

## Decision

**Option C.**

1. **Architecture-review (M/L tiers)** must name, in its APPROVED output (review report and/or
   ADRs), the production entry points/consumers the feature hooks into — including *all* consumers
   when a capability has several (the #460 class). A review that approves a feature adding
   production behavior without naming its wiring surface is incomplete.
2. **`/plan` derives per-task `Wired-into:` lines** from the approved architecture, sitting
   beside `**Files:**` and `**Dependencies:**`. Grammar (parsed by the engine, same
   permissiveness class as `FILES_LINE`):
   - `**Wired-into:** <path>#<symbol>[, <path>#<symbol>...]` — declared production call sites;
   - `**Wired-into:** same as Task N` — inheritance, matching the `Files:` inheritance rule;
   - `**Wired-into:** none (no new production surface)` — for tasks that add no new exported
     primitives (tests, docs, refactors of existing wiring);
   - `**Wired-into:** none (inert until <ref>)` — deliberate staged rollout, see (4).
3. **Small tier** (architecture-review skipped): the plan authors the `Wired-into:` lines
   directly as the fallback origin. They get no design-time review; the `wiring_check` gate's
   orphan backstop (adr-2026-07-12-wiring-check-gate) is the only net there — accepted because
   Small features have small wiring surface.
4. **INERT waiver:** `none (inert until <ref>)` passes the gate only when `<ref>` resolves —
   either a repo-local spec/plan path that exists on disk, or an open GitHub issue/PR. This makes
   the follow-up wiring PR *enforced* (the #179/#180 gap): an unresolvable or closed ref is a
   named gap, not a pass.

## Consequences

### Positive
- The wiring decision is reviewed where scoping errors are cheap (design time), and verified
  where evasion is cheap (build time), by different mechanisms.
- The contract reuses the plan's existing parsed-line grammar family — one parsing surface,
  known round-trip behavior.
- Deliberate INERT rollouts remain possible but can no longer silently orphan their wiring PR.

### Negative
- Plan authoring gains a required field; plans for features with no new production surface must
  still say so explicitly (`none (no new production surface)`) — small ongoing authoring cost.
- Plan↔architecture drift is possible; the gate only verifies the plan's lines, so a plan that
  under-declares relative to the approved architecture relies on plan review to catch it (the
  orphan backstop still catches fully-undeclared new exports).
- One more grammar the engine must keep backward-compatible (#417 precedent shows grammar drift
  costs real debugging time).

### Follow-up Actions
- [ ] `skills/architecture-review/SKILL.md`: require the entry-point/consumer enumeration in
      APPROVED output (design-time mode).
- [ ] `skills/plan/SKILL.md`: add the `Wired-into:` field to the task grammar + derivation rule
      (arch output on M/L; self-authored on S) + waiver forms.
- [ ] Engine parser beside `FILES_LINE` in `src/engine/autoheal.ts` (see
      adr-2026-07-12-wiring-check-gate for the consuming gate).
