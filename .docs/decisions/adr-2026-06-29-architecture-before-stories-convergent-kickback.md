# ADR: Architecture before stories; convergent root-routed kickbacks

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

> **Decision index (backfilled 2026-10-03, #2140).** Additive citable ids over the approved text above;
> no change of substance. Each id names a decision exactly as already stated above.
>
> **D1** — The DECIDE order is `explore → [prd] → architecture-diagram → architecture-review → stories → conflict-check → plan`, with APPROVED ADRs produced before stories (above: "Order:")
> **D2** — conflict-check classifies each conflict's root and kicks back to `prd`, `architecture`, or `stories` (above: "conflict-check root routing")
> **D3** — The kickback target set is extended from `{stories, plan}` to `{prd, architecture, stories, plan}` (above: "Kickback target set")
> **D4** — architecture-review has a full (pre-stories) mode and a targeted-amendment (re-entry) mode that addresses only the kickback's specific structural gap, never a from-scratch re-derivation (above: "architecture-review has two modes")
> **D5** — Only a genuine structural gap (missing component/seam/boundary) may re-open architecture; story phrasing / coverage nits may not (above: "Only a genuine **structural** gap")
> **D6** — The existing per-gate kickback cap applies to the new targets, and exceeding it HALTs for a human rather than looping (above: "The existing per-gate kickback cap")

## Consequences

- Behavior-first is preserved (PRD states behavior before architecture); stories become design-aware
  and capture architecture-induced negatives (FR-8).
- The gate loop gains two upstream targets but stays bounded by the cap→HALT backstop.
- `architecture-review` skill documents the full-vs-amendment modes and the structural-gap bar.
