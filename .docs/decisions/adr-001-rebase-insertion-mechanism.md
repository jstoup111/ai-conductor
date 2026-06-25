# ADR 001: Rebase-on-latest insertion mechanism

**Date:** 2026-06-25
**Status:** DRAFT
**Deciders:** James (solo dev) + harness architecture-review
**Feature:** Phase 9.0 — daemon rebase-on-latest + conflict→HALT

## Context

Phase 9.0 must rebase a daemon worktree branch onto the latest base **after** `build` +
`manual_test` are green and **before** `finish`, and on a code/test-changing rebase it must
re-verify through the existing kickback machinery (PRD FR-1, FR-5, FR-6). The question is how to
wire the rebase into the existing gate-loop tail.

Forces / constraints:
- Phase 8 (commit `ac056fe`, #79) made the gate-loop topology **derive from the step registry**:
  `StepDefinition` carries `loopGate?` and `kickbackTarget?` (`src/types/steps.ts:47,54`), and
  `buildStepRegistry` (`src/engine/steps.ts:218`) inserts steps by `after`/`gate`.
- The selector + `gate-verdicts` + anti-oscillation (`MAX_KICKBACKS_PER_GATE=2`,
  `MAX_GATE_SELECTIONS=6`, `conductor.ts:103,107`) already drive `loopGate` steps and route
  kickbacks.
- The rebase is **deterministic git work, not a Claude skill** — it must not dispatch a prompt.
- **Design constraint (conflict-check):** the rebase must be a no-op once the branch is current
  (FR-4), so re-entry after a kickback does not re-invalidate and trip `MAX_GATE_SELECTIONS`.

## Options Considered

### Option A: `rebase` as an engine-native `loopGate` step in the registry
A built-in step (`name: 'rebase'`, `loopGate: true`, prerequisite `manual_test`, ordered before
`finish`) whose runner is handled **natively by the engine** (like the existing `complexity`
step, which `step-runners.ts:253` explicitly does *not* dispatch to Claude). Its gate verdict is
**"satisfied = branch already current with base."**
- **Pros:** Composes with the Phase 8 registry topology, the selector, `gate-verdicts`, and
  anti-oscillation with no new control flow. The no-op self-satisfy (FR-4) *is* the gate verdict,
  so the anti-oscillation design constraint is resolved for free: after a kickback re-runs
  `build`, the selector re-enters `rebase`, which finds the branch current → satisfied → `finish`,
  with no re-invalidation. Visible in the dashboard/`--report` as a real step. Engine-native step
  pattern already exists (`complexity`).
- **Cons:** Requires extending the runner to handle one more engine-native (non-dispatched) step
  — small, but a touch to `step-runners.ts`/the dispatch switch.

### Option B: inline rebase logic in `advanceTail` before `finish`
A focused block in `advanceTail` (`conductor.ts`) that, when about to select `finish`, runs
fetch+rebase, classifies the diff, and writes invalidation verdicts or HALT inline.
- **Pros:** Smallest footprint; no registry/runner change.
- **Cons:** Bespoke control flow living beside the selector; re-implements the
  kickback/anti-oscillation interplay by hand inside `advanceTail`; the no-op-as-satisfied safety
  is an ad-hoc check rather than a natural verdict; not visible as a step in topology/report.
  Works against the Phase 8 direction of *deriving* topology from the registry.

## Decision

**Adopt Option A** — `rebase` as an engine-native `loopGate` step in the registry, with its gate
verdict defined as "branch is current with the base."

Rationale: Phase 8 was just merged specifically to make loop topology registry-derived; a new
`loopGate` step is the idiomatic composition point and inherits the selector, verdict, kickback,
and anti-oscillation machinery without re-implementation. The one new piece — an engine-native
(non-dispatched) runner — already has a working precedent in the `complexity` step, so it is an
extension of an existing pattern, not a new one. Critically, modelling the no-op (FR-4) as the
gate's *satisfied* condition makes the anti-oscillation design constraint a structural property
rather than a hand-maintained guard. Option B's smaller diff is outweighed by it forking bespoke
control flow away from the machinery the rest of the loop already uses.

## Consequences

### Positive
- Re-verification, kickback routing, and anti-oscillation come from existing, tested machinery.
- The FR-4 no-op self-satisfy is enforced by the verdict model, closing the oscillation risk.
- The rebase is observable as a first-class step (events/report), aiding the future 9.1 signal.

### Negative
- Adds one engine-native step to the runner dispatch path (mitigated by the `complexity`
  precedent).
- The `rebase` step's "satisfied" predicate (branch current with base) must be implemented
  carefully so a genuinely-stale branch is never reported satisfied.

### Follow-up Actions
- [ ] Add `rebase` to `ALL_STEPS` (`loopGate: true`, prereq `manual_test`, before `finish`).
- [ ] Extend the runner to handle `rebase` as engine-native (mirror the `complexity` skip-dispatch path).
- [ ] Implement the gate verdict: satisfied ⇔ branch is current with the discovered base.
- [ ] Implement fetch/discovery (FR-2/3), diff classifier for code-test paths (FR-5), CHANGELOG
      auto-resolver (FR-7), conflict→HALT-paused (FR-8), and outcome events (FR-10).
