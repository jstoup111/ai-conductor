# Stories: Mermaid Diagram Renderer

**Spec:** `.docs/specs/2026-06-29-mermaid-renderer.md`
**Date:** 2026-06-29
**Status:** DRAFT

Every story has at least one concrete negative path. Maps to FR-1…FR-7.

---

## Story 1 — Choose and install a diagram renderer during install (FR-1, FR-6)

As the harness operator, when I run install, I want to be offered a choice of
diagram renderer and have it set up for me, so that diagrams will render visually
during architecture review.

**Happy path**
- **Given** I run `bin/install` (interactive)
- **When** I reach the diagram-renderer step
- **Then** I am shown a menu of renderer presets (mirroring the Markdown-viewer
  menu), I pick one, the harness attempts to install it, and on success records my
  choice and reports it as available.

**Acceptance**
- The menu lists multiple preset options plus a "none/skip" option.
- A successful pick is persisted to harness config and shown by `install --check`.

**Negative path — selected renderer cannot be installed**
- **Given** I select a renderer preset whose tool is not installed and cannot be
  installed (no available package manager, or the download fails)
- **When** the install step runs
- **Then** install prints a specific warning naming the renderer and the manual
  install hint, **continues without aborting**, and `install --check` reports the
  renderer as "configured but not available."

**Negative path — operator skips**
- **Given** I select "none/skip" at the menu
- **When** install continues
- **Then** no renderer is configured, install completes normally, and review steps
  later fall back to raw Markdown (Story 5).

---

## Story 2 — Persist and reuse the render preference (FR-2)

As the operator, I want my renderer choice remembered and reused, so I don't
re-choose every run and can change it when I want.

**Happy path**
- **Given** I chose a renderer during install
- **When** a later harness run reaches a diagram-render point
- **Then** it uses my saved choice without re-prompting.

**Acceptance**
- The preference lives in the same harness config used for the Markdown viewer.
- Re-running install (or editing config) can change the choice; the next run uses
  the new value.

**Negative path — missing or malformed render config entry**
- **Given** the harness config has no renderer entry, or the entry is malformed
- **When** a diagram-render point is reached
- **Then** the harness does not crash; it falls back to the default behavior
  (raw Markdown) and emits a notice (ties into Story 5), rather than erroring.

---

## Story 3 — See rendered diagrams at architecture-diagram approval (FR-3)

As the operator approving generated diagrams, I want them rendered as visuals, so
I can actually evaluate the architecture instead of reading Mermaid source.

**Happy path**
- **Given** `architecture-diagram` has produced one or more `.docs/architecture/*.md`
  files and is presenting them for my validation
- **When** the presentation step runs with a renderer configured and available
- **Then** each diagram is rendered via my configured renderer and the rendered
  output is what I review.

**Acceptance**
- All standard diagram files (system-context, containers, components, erd,
  sequences/*) are rendered, not just one.

**Negative path — a diagram file has invalid Mermaid**
- **Given** one diagram file contains Mermaid that the renderer cannot parse
- **When** the presentation step renders the set
- **Then** the harness shows the raw Markdown for that one file with a notice that
  it could not be rendered, **still renders the remaining valid files**, and does
  not abort the approval step.

---

## Story 4 — See rendered diagrams at architecture-review ADR approval (FR-4)

As the operator approving DRAFT ADRs, I want any diagrams inside them rendered, so
I review the proposed design visually before approving.

**Happy path**
- **Given** `architecture-review` is presenting a DRAFT ADR that contains a Mermaid
  diagram
- **When** the ADR is shown for approval with a renderer configured and available
- **Then** the diagram in the ADR is rendered for me before I approve/reject.

**Acceptance**
- Renders ADRs one at a time (consistent with the existing ADR approval flow).

**Negative path — ADR contains no diagram**
- **Given** a DRAFT ADR with no Mermaid content
- **When** it is presented for approval
- **Then** no render is attempted, the ADR is presented as normal text, and no
  error or empty-render artifact is produced.

---

## Story 5 — Graceful fallback when no renderer is available (FR-5)

As the operator, I want approval gates to keep working even when rendering isn't
available, so a missing renderer never blocks my workflow.

**Happy path (degraded)**
- **Given** no renderer is configured, or the configured renderer's tool is missing
  at review time
- **When** an architecture approval step (Story 3 or Story 4) runs
- **Then** the harness shows the raw Markdown (current behavior) with a clear,
  one-line notice explaining rendering was skipped, and the approval gate proceeds
  normally.

**Acceptance**
- The notice names why (not configured vs. tool missing) and how to enable it.

**Negative path — renderer configured but binary disappeared**
- **Given** my config names a renderer whose binary is no longer on PATH
- **When** a render point is reached
- **Then** the harness detects the missing binary, falls back to raw Markdown with
  the notice, and **does not hang, retry indefinitely, or crash**.

---

## Non-story requirement

- **FR-7 — Documentation.** Update `README.md` (install + the renderer choice) and
  the relevant skill/architecture docs to describe the renderer, its configuration,
  and where it appears in the flow. Tracked as an implementation task, not a
  user-facing behavior story.
