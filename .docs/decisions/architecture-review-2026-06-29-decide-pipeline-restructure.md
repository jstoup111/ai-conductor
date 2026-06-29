# Architecture Review: DECIDE pipeline restructure

**Date:** 2026-06-29
**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md
**Diagram:** .docs/architecture/decide-pipeline-restructure.md
**Verdict:** APPROVED (full pass)

## ADRs (all APPROVED)

- **ADR-015** — split `brainstorm` → `explore` (advisory, always) + `prd` (gating, conditional);
  track decided in `explore`; resolves OQ2 (explore always-runs).
- **ADR-016** — architecture-before-stories; conflict-check root routing; kickback targets extended
  to `{prd, architecture, stories, plan}`; convergence via amendment-mode arch-review + structural-
  gap bar + cap→HALT.
- **ADR-017** — track marker = dedicated `.docs/track/<slug>.md`, `parseTrack()`, default `product`;
  resolves OQ1.
- **ADR-018** — `brainstorm → {explore, prd}` migration; default-product back-compat; no retroactive
  reordering of in-flight features; resolves OQ3.

## Feasibility & alignment

- **Marker pattern is proven.** Track marker reuses the exact idiom shipped for complexity + intake
  (`.docs/<kind>/<slug>.md` + a `parseX` helper read by `discoverBacklog`). Low risk.
- **Gate machinery already supports kickback + cap + HALT.** We extend the *target set* and add an
  amendment mode; we do not invent a new loop. The cap→HALT backstop already exists.
- **Model X keeps BUILD/daemon stable.** Stories remain the always-present artifact, so
  `acceptance_specs`, `discoverBacklog` story checks, and `writing-system-tests` are untouched.
- **Back-compat hinge is the default-product rule** (ADR-017/018): no merged spec regresses and no
  in-flight feature re-runs completed DECIDE work.

## Risks & mitigations

- **Spin from new kickback edges** → amendment-mode + structural-gap bar + per-gate cap→HALT
  (ADR-016); covered by stories S8.
- **Misclassified track ships product work without requirements** → operator-confirmed track gate
  (S2) + default-product on absence.
- **Rename breakage** → boundary-only alias + state migration test (ADR-018, S11).

No DRAFT ADRs remain. Cleared for `plan`.
