# ADR: Split `brainstorm` into `explore` + `prd`; track decided in `explore`

**Status:** APPROVED
**Date:** 2026-06-29
**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md (FR-1, FR-2, FR-3)

## Context

`brainstorm` fuses divergent exploration with convergent PRD authoring, against "one skill, one
responsibility, one enforcement level". `stories` and `plan` are already separate skills/steps; the
PRD is the same kind of artifact transform but isn't. PRDs are also forced on technical-only work
where they're hollow.

## Decision

- Retire `brainstorm`; introduce two steps:
  - **`explore`** — `enforcement: advisory`, **always runs**. Explores context, asks questions,
    proposes 2–3 approaches. Working notes are ephemeral (`.pipeline/`); the selected approach +
    rejected alternatives are persisted to `.memory/decisions/`. Writes no `.docs/` artifact except
    the track marker (adr-2026-06-29-track-marker-location).
  - **`prd`** — `enforcement: gating`, **conditional on `Track: product`**. Writes the product-only
    design doc to `.docs/specs/` (HARNESS product-only PRD contract).
- **Track is an output of `explore`** (`product` | `technical`), operator-confirmed. There is no
  separate classification step — exploration is exactly where you learn what the work is.

## OQ2 resolution — explore skippability

`explore` **always runs** in the standard flow (it is where the track is decided; skipping it would
leave the track unset). It is advisory and may be *fast* for trivial changes, but it is not a
tier-skipped step. When no track marker exists at all (legacy / non-explore entry), downstream
defaults to `product` (adr-2026-06-29-track-marker-location) for back-compat.

## Consequences

- `StepName` and engineer `DecideStep` drop `brainstorm`, add `explore` + `prd`.
- Enforcement mismatch from PR #142 is resolved: the product-only gate lives in the **gating** `prd`
  skill, not an advisory one.
- Migration required for existing state (adr-2026-06-29-brainstorm-rename-migration).
