# ADR-017: Track marker is a dedicated `.docs/track/<slug>.md`

**Status:** APPROVED
**Date:** 2026-06-29
**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md (FR-2, FR-13, FR-15) — resolves OQ1

## Context

`explore` emits a product/technical track that the daemon and downstream steps must read. Options:
(A) a dedicated per-slug marker, or (B) folding a `Track:` line into the existing
`.docs/complexity/<slug>.md` marker.

## Decision

Use a **dedicated `.docs/track/<slug>.md`** marker containing a `Track: product|technical` line
(free-form rationale allowed below). Parse via a new `parseTrack(content): 'product'|'technical'|
undefined` in `artifacts.ts`, mirroring `parseComplexityTier` and `parseIntakeSourceRef`.

- **Default when absent → `product`.** Pre-existing specs (authored before this change) are product
  PRDs, so a missing marker must not make them technical and skip `prd-audit`.
- Committed alongside the other DECIDE artifacts by `land-spec`; read from the base-branch tree by
  `discoverBacklog` (same pattern as the complexity + intake markers).

## Rationale

- **Single responsibility / orthogonal axes:** complexity is S/M/L (how big); track is
  product/technical (what kind). Overloading the complexity marker couples two independent axes.
- **Consistency:** the harness already has the per-slug marker idiom (`.docs/complexity/`,
  `.docs/intake/`) with a dedicated parser each; this follows it.
- **Daemon symmetry:** `discoverBacklog` already reads marker files by plan stem; one more is trivial.

## Consequences

- New directory `.docs/track/` and parser; one extra base-branch read in `discoverBacklog`.
- `default = product` is the back-compat hinge for FR-15 and NFR (no spec regresses).
