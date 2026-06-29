# ADR-016: Architecture before stories; convergent root-routed kickbacks

**Status:** APPROVED
**Date:** 2026-06-29
**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md (FR-5, FR-6, FR-8, FR-9, FR-11, FR-12)

## Context

Stories are authored before architecture today, so architecture-induced failure modes aren't
captured as negative-path stories. We also want PRDs to stay product-pure (the *how* resolved in
architecture-review). Moving architecture before stories adds new kickback edges
(stories→architecture, conflict-check→architecture/prd) that could oscillate.

## Decision

- **Order:** `explore → [prd] → architecture-diagram → architecture-review → stories →
  conflict-check → plan`. Architecture-review runs on the PRD/FRs (product) or explore output
  (technical) and produces APPROVED ADRs before stories.
- **conflict-check root routing:** classify each conflict's root and kick back to `prd`
  (contradictory FRs), `architecture` (incompatible design/ADR), or `stories` (phrasing overlap).
- **Kickback target set** extended from `{stories, plan}` to `{prd, architecture, stories, plan}` in
  `gate-verdicts.ts` / `selector.ts`.
- **Convergence (anti-spin):**
  - architecture-review has two modes: **full** (pre-stories) and **targeted-amendment** (re-entry).
    A kickback carries the specific structural gap; the amendment addresses only that, never a
    from-scratch re-derivation.
  - Only a genuine **structural** gap (missing component/seam/boundary) may re-open architecture;
    story phrasing / coverage nits may not.
  - The existing per-gate kickback cap applies to the new targets; exceeding it **HALTs** for a human
    rather than looping.

## Consequences

- Behavior-first is preserved (PRD states behavior before architecture); stories become design-aware
  and capture architecture-induced negatives (FR-8).
- The gate loop gains two upstream targets but stays bounded by the cap→HALT backstop.
- `architecture-review` skill documents the full-vs-amendment modes and the structural-gap bar.
