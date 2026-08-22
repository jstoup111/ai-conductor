# ADR: prd_audit judges stories as authority, runs always, and owns the only bounded kickback
**Date:** 2026-08-22
**Status:** APPROVED
**Deciders:** operator (James Stoup), engineer session for jstoup111/ai-conductor#1805
**Amends:** adr-2026-07-10-validation-group-join, adr-2026-07-20-post-rebase-delta-aware-invalidation, adr-2026-08-13-markdown-default-inversion, adr-2026-06-29-track-marker-location, adr-2026-06-29-explore-prd-split-track-in-explore, adr-2026-07-13-retry-classify-rerun-vs-route, adr-2026-08-12-cumulative-build-review-convergence-bound, adr-2026-07-26-cross-dispatch-kickback-livelock-bound, adr-2026-07-27-protected-artifact-seal-self-amendment-visibility, adr-2026-08-12-operator-reseal-as-second-scope-justification, adr-2026-08-09-non-blocking-plan-scope-containment

## Context

`prd_audit` is skipped on the technical track (`steps.ts:228`) and most features are classified
technical, so the delivered-requirements question is usually never asked. Its kickback appends
`rem-*` tasks through `appendRemediationTasks` (`conductor.ts:2756`) with no per-feature bound.
`.docs/` is excluded from every gate surface (adr-2026-08-13-markdown-default-inversion), so no
gate can currently react to an acceptance-criteria change. Daemon-mode kickbacks to DECIDE must
halt (adr-2026-07-27-daemon-decide-kickback-halt, adr-2026-08-03-fail-closed-decide-entry).

## Options Considered

### Option A: Two gates — prd_audit on FRs plus a new stories audit
- **Cons:** re-creates the one-question-two-judges pattern this feature removes.

### Option B: Rename prd_audit to a stories audit
- **Cons:** a rename touches step names, config, `rem-prd-audit-*` ids in merged plans, telemetry,
  the eval corpus, and needs a consumer migration — for no behavior change.

### Option C: Keep the name; re-key the contract; run always; bound the kickback (chosen)

## Decision

1. **Authority.** The stories' acceptance criteria are the contract. PRD FRs (when a PRD exists) and
   the plan's stated outcome are intent context. Coverage is read through the committed coherence
   mapping where present (adr-2026-07-22-coherence-gate-placement-and-validation-split) and the plan's
   `**Stories:**` resolver (adr-2026-08-05-token-first-stories-reference-normalization).
2. **Run rule.** `prd_audit` runs on every feature, every tier, every track. `skippableForTracks`
   is removed; `configDisableAllowed` stays the only skip. The technical-track default of
   adr-2026-06-29-track-marker-location becomes inert for this step. `GATE_SURFACE.prd_audit`
   adds `.docs/stories/**` and `.docs/specs/**` as declared inputs so a criteria edit invalidates a
   prior PASS (a scoped carve-out to the markdown inversion; the partition itself is unchanged).
3. **Grades.** Each finding carries exactly one of `PASS | FIXABLE | PLAN_GAP | OVER_SCOPE`, schema-
   constrained; the engine derives the gate outcome. `FIXABLE` must name an owning plan task id and
   a story criterion id; a finding naming neither is rejected as malformed by the same parser that
   validates the verdict table, and never becomes work. The existing `ALIGNED|PARTIAL|DIVERGED|MISSING`
   per-FR table remains as evidence rows; the grade is what routes.
4. **Scope-as-intent.** `OVER_SCOPE` judges shipped behavior against the plan and intent (PRD
   Goals/Non-Goals and In/Out Scope, else stories + plan outcome). Within intent → self-accepted and
   recorded as a widening; outside intent, not user-visible → recorded, ships; outside intent,
   user-visible → HALT. Operator-reseal rationale justification (formerly a Scope sub-rule) is judged
   here; seal detection stays mechanical at commit.
5. **Bounded kickback.** `FIXABLE` findings route to BUILD through the existing remediation append
   seam — the only plan appender — under engine-enforced caps: **one lap per feature**, at most
   **5** added tasks and at most **25% of the authored task count**, whichever is lower; all three
   operator-configurable. Each appended task carries `Criterion:` and its parent task. Exceeding a
   cap, or a second lap, converts to a needs-human HALT listing every finding. The lap rides the
   durable per-gate kickback ledger (`gates.prd_audit`), never the build_review cumulative counter.
6. **Growth ledger.** The kickback ledger gains a per-feature `growth` record:
   `{authored, added, byGate, remaining}`; pre-existing `rem-*` tasks found in a plan at first read
   count toward `authored`. Surfaced by `conduct-ts` status output and emitted on the spine.
   (Extending the ledger was chosen over a new spine record because the ledger already owns
   per-feature kickback state and the removal guard reads appended ids from it.)
7. **PLAN_GAP.** Happy-path criterion unmet with no owning task → HALT (class `plan-gap`); negative/
   edge criterion → recorded in the verdict and the shipped record, ships, unless configuration
   requires a halt. Never a kickback; the daemon DECIDE-halt rule is unchanged.
8. **Recorded findings** are persisted in the verdict artifact and copied into the shipped record
   in a shape #1810 can consume without re-review. Every halt carries a class and a clearable lever.

## Consequences

### Positive
- One gate answers "built as expected", on every feature; growth is bounded and visible.

### Negative
- Every feature now pays a prd_audit dispatch at SHIP, including S-tier refactors (empty criteria → fast PASS).
- The validation group's single `planRemediation` dispatch now receives graded input; the try-1
  short-circuit classifier must map the new grades.

### Follow-up Actions
- [ ] Remove `skippableForTracks`; extend `GATE_SURFACE.prd_audit`.
- [ ] Grade schema + parser rejection; cap enforcement around `appendRemediationTasks`; growth record.
- [ ] Verdict/shipped-record recorded-findings shape.
