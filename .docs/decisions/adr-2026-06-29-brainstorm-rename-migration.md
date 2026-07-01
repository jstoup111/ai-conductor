# ADR: Migration for `brainstorm → {explore, prd}`

**Status:** APPROVED
**Date:** 2026-06-29
**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md (FR-15) — resolves OQ3

## Context

`brainstorm` is a wired `StepName`/`DecideStep` and appears in persisted `conduct-state.json`, the
daemon's `PRESEEDED_DONE`, and the engineer authoring order. Renaming it must not regress in-flight
features or already-merged specs.

## Decision

- **State key migration (on load).** When `conduct-state.json` has a `brainstorm` key and lacks
  `explore`/`prd`: set `explore = <brainstorm value>`; set `prd = done` if a `.docs/specs/` doc
  exists for the feature, else `prd = skipped`. Performed in the state loader so every entry point
  (conduct, daemon, engineer) inherits it.
- **Daemon.** `PRESEEDED_DONE` replaces `brainstorm` with `explore` + `prd`. `discoverBacklog`
  treats a **missing track marker as `product`** (adr-2026-06-29-track-marker-location), so already-merged specs remain buildable
  and keep `prd-audit`.
- **No retroactive reordering.** A feature already mid-DECIDE under the old order
  (stories-before-architecture) completes on its **existing recorded step states**; the new ordering
  (adr-2026-06-29-architecture-before-stories-convergent-kickback) applies only to features that begin `explore` after this change. Migration renames keys;
  it never reshuffles completed/in-progress steps.
- **Type alias only at the boundary.** `StepName`/`DecideStep` drop `brainstorm`; a `brainstorm →
  explore` mapping exists solely in the state-migration shim, not in the live unions.

## Consequences

- Deterministic, idempotent migration; safe to run on every load.
- In-flight features neither regress nor get force-reordered.
- A migration test (FR-15 / S11) asserts `brainstorm: done` resumes as `explore: done` + correct
  `prd` state.
