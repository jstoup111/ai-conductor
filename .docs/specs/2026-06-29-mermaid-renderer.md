# Spec: Mermaid Diagram Renderer

**Date:** 2026-06-29
**Status:** Draft
**Author:** James Stoup (via conduct)
**Complexity:** SMALL

---

## Context

The harness generates architecture diagrams as Mermaid embedded in Markdown
(`.docs/architecture/*.md`, produced by the `architecture-diagram` skill) and
proposes DRAFT ADRs during `architecture-review`. Today these are reviewed as
**raw Markdown** — the Mermaid blocks appear as code, not pictures.

During a prior field test (best-stock-picker), this was a real pain point: on a
WSL2 + phone-remote-control setup there was no convenient way to *see* a rendered
diagram, so the human approval gate operated on text alone. Approving an
architecture you can't actually visualize undercuts the value of the gate.

This feature makes generated diagrams **visible** at the moments the human is
asked to approve them, using a rendering choice the user controls — exactly the
way the existing Markdown-viewer preference already works.

## Problem Statement

When the harness asks the operator to approve architecture diagrams or ADRs, the
operator cannot see the diagrams as visuals. They must mentally parse Mermaid
source or leave the harness to render it elsewhere. This is slow, error-prone,
and especially bad when driving remotely.

## Users

- **Primary:** The harness operator (James) reviewing/approving architecture
  artifacts at a gate — often remotely, on WSL2.
- **Secondary:** Any harness user on macOS/Linux who wants rendered diagrams
  during architecture approval.

## Goals

1. The operator can **see rendered diagrams** (not raw Mermaid) when approving
   architecture artifacts.
2. **How** diagrams are rendered is the **user's choice**, configured once and
   reused — consistent with how the Markdown viewer is already chosen.
3. The renderer is set up **as part of installation**, with the same
   "offer a choice, install it for you, degrade gracefully" experience as the
   existing Markdown-viewer setup.
4. Rendering appears at the **gated architecture approval steps**, where it adds
   the most value, without changing the artifacts themselves.

## Non-Goals

- Editing or generating diagrams (that remains `architecture-diagram`'s job).
- Rendering every Markdown file the harness shows — scope is diagram review.
- Replacing the existing Markdown viewer.
- A persistent GUI/dashboard or live-reloading preview server.
- Mandating any single rendering technology — the user picks.

## Functional Requirements

- **FR-1 — Render choice at install.** Installation offers the operator a choice
  of how Mermaid diagrams should be rendered for review, installs the selected
  option where it can, and records the choice for reuse. If the choice cannot be
  installed, installation continues with a clear warning (no hard failure).

- **FR-2 — Persisted, reusable preference.** The render choice is stored in the
  operator's harness configuration and reused on every subsequent run, the same
  way the Markdown-viewer preference is. The operator can change it later.

- **FR-3 — Render at architecture-diagram approval.** When `architecture-diagram`
  presents diagrams to the operator for validation, the diagrams are rendered via
  the configured renderer so the operator reviews visuals, not Mermaid source.

- **FR-4 — Render at architecture-review ADR approval.** When `architecture-review`
  presents DRAFT ADRs (which may contain Mermaid) for approval, any diagrams they
  contain are rendered via the configured renderer before approval.

- **FR-5 — Graceful fallback.** If no renderer is configured or available at
  review time, the harness falls back to showing the raw Markdown (current
  behavior) with a clear notice — the approval gate is never blocked by a missing
  renderer.

- **FR-6 — Installation status visibility.** The installation status check reports
  whether the diagram renderer is configured/available, alongside the other
  dependency checks.

- **FR-7 — Documentation.** The renderer (install step, configuration, and where
  it appears in the flow) is documented for users.

## Success Criteria

- During `architecture-diagram` and `architecture-review` approval on a WSL2
  setup, the operator sees rendered diagram visuals via their chosen renderer.
- A fresh `install` offers, sets up, and records a render choice; `install --check`
  reports its status.
- With no renderer available, both approval steps still complete by showing raw
  Markdown plus a notice — nothing hangs or hard-fails.
- The operator can change the render choice and have it take effect on the next run.

## Open Questions

_None blocking._ Specific rendering technology, config keys, and wiring mechanism
are deliberately deferred to the implementation plan (this is a product spec).

## Decisions Captured (from intake)

- Render target is a **user choice via presets**, mirroring the existing
  Markdown-viewer configuration model.
- Rendering is wired into the **gated architecture approval steps**
  (`architecture-diagram` validation and `architecture-review` ADR approval).
- Build process: **SMALL** tier.
