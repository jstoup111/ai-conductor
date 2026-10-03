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

> **Decision index (backfilled 2026-10-03, #2140).** Additive citable ids over the approved text above;
> no change of substance. Each id names a decision exactly as already stated above.
>
> **D1** — Retire `brainstorm` and introduce two steps, `explore` and `prd`. (above: "Retire `brainstorm`; introduce two steps")
> **D2** — `explore` is `enforcement: advisory` and always runs; it explores context, asks questions, and proposes 2–3 approaches, keeps working notes ephemeral in `.pipeline/`, persists the selected approach and rejected alternatives to `.memory/decisions/`, and writes no `.docs/` artifact except the track marker. (above: "**`explore`** — `enforcement: advisory`, **always runs**")
> **D3** — `prd` is `enforcement: gating`, conditional on `Track: product`, and writes the product-only design doc to `.docs/specs/`. (above: "**`prd`** — `enforcement: gating`")
> **D4** — Track (`product` | `technical`) is an operator-confirmed output of `explore`; there is no separate classification step. (above: "**Track is an output of `explore`**")

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

> **Amended 2026-08-22 by #1805:** prd_audit now runs on every feature/tier/track, judges stories' acceptance criteria as authority, declares .docs/stories and .docs/specs in its gate surface, grades findings PASS/FIXABLE/PLAN_GAP/OVER_SCOPE, and owns the only bounded plan-task kickback; reseal-rationale and scope-containment judgement move to its OVER_SCOPE grade (adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback).
