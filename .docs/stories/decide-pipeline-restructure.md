# Stories: DECIDE pipeline restructure

**Status:** Accepted
**Spec:** .docs/specs/2026-06-29-decide-pipeline-restructure.md

> These are *technical* stories — Given/When/Then against the harness behavior — since this is a
> technical-track feature. Acceptance criteria live here (Model X).

## S1 — explore always runs and is ephemeral (FR-1)

- **Happy:** Given any new feature in `/conduct`, when DECIDE begins, then `explore` runs first as
  an advisory step, asks questions, and presents 2–3 approaches; its working notes are written under
  `.pipeline/` and are gitignored.
- **Negative (no .docs leak):** Given `explore` completes, when the repo is inspected, then NO file
  was created under `.docs/` by explore (notes are `.pipeline/` only).
- **Negative (durable decision survives):** Given the operator selects an approach and rejects
  others, when `explore` exits, then the selected approach + rejected-alternatives rationale is
  persisted to `.memory/decisions/`, so it survives even though the `.pipeline/` notes are ephemeral.

## S2 — explore emits an operator-confirmed track (FR-2)

- **Happy (product):** Given a user-facing feature, when `explore` classifies it, then it proposes
  `Track: product`, the operator confirms, and `.docs/track/<slug>.md` is written with
  `Track: product`.
- **Happy (technical):** Given a refactor/infra/dependency change, when `explore` classifies it, then
  it proposes `Track: technical`, the operator confirms, and the marker records `Track: technical`.
- **Negative (no silent classification):** Given `explore` proposes a track, when the operator has
  not confirmed it, then the track is not finalized and DECIDE does not advance past `explore`.
- **Negative (override honored):** Given `explore` proposes `technical` but the operator overrides to
  `product`, when the marker is written, then it records `product` (operator wins).

## S3 — PRD runs only on the product track (FR-3, FR-14)

- **Happy:** Given `Track: product`, when DECIDE advances, then `prd` runs (gating) and writes a
  design doc to `.docs/specs/`.
- **Happy (skip):** Given `Track: technical`, when DECIDE advances, then `prd` is skipped, no
  `.docs/specs/` doc is required, and the skip reason is logged.
- **Negative (product without PRD blocks):** Given `Track: product`, when no `.docs/specs/` doc
  exists, then DECIDE blocks at `prd` (cannot proceed to architecture without the product spec).
- **Negative (SHIP gate tracks):** Given `Track: technical`, when SHIP runs, then `prd-audit`
  auto-skips with a logged reason; given `Track: product`, `prd-audit` runs.

## S4 — PRD is product-only with the external-constraint carve-out (FR-4)

- **Happy:** Given a `product` PRD, when authored, then requirements are stated as
  capabilities/behaviors and no new internal mechanism (command/flag/file path/config key/
  function/type name/library/protocol/schema/port) appears.
- **Happy (carve-out):** Given the feature must use a pre-existing external dependency or constraint
  (e.g. an existing API, "must run offline"), when authored, then it MAY be named under Dependencies
  / Non-Functional Requirements as a requirement.
- **Negative (leak caught):** Given a PRD draft naming a new internal mechanism, when the product-
  only audit gate runs before approval, then it flags the leak and the PRD cannot be approved until
  the item is restated as a behavior or moved to Open Questions for architecture-review.

## S5 — architecture precedes stories (FR-5, FR-6)

- **Happy:** Given DECIDE proceeds, when steps run, then the order is
  `explore → [prd] → architecture-diagram → architecture-review → stories → conflict-check → plan`.
- **Happy (tier skip):** Given `complexity_tier: S`, when DECIDE runs, then architecture-* and
  conflict-check are skipped while explore/stories/plan still run.
- **Negative (stories before approved ADRs blocked):** Given any DRAFT ADR remains from
  architecture-review, when DECIDE reaches `stories`, then it blocks until all ADRs are APPROVED.

## S6 — stories always exist, both tracks, behavior-phrased (FR-7, FR-8)

- **Happy (product):** Given an approved PRD + architecture, when `stories` runs, then product
  stories with happy + negative paths are written to `.docs/stories/`, `Status: Accepted`.
- **Happy (technical):** Given a `technical` feature (no PRD) + architecture, when `stories` runs,
  then technical stories with happy + negative paths are written to `.docs/stories/`.
- **Happy (architecture-induced negative):** Given the architecture introduces a failure mode (e.g.
  an external call that can time out), when stories are written, then a negative-path story for that
  failure mode exists.
- **Negative (no mechanism in story text):** Given stories are authored against a known design, when
  reviewed, then story text describes observable behavior, not internal mechanism copied from the
  ADRs.
- **Negative (missing negative path blocks):** Given a story with only happy paths, when the stories
  gate runs, then it blocks (negative paths mandatory).

## S7 — conflict-check root-routes kickbacks (FR-9, FR-11)

- **Happy (clean):** Given no conflicts among stories, when `conflict-check` runs, then it writes the
  clean-check marker and DECIDE proceeds to `plan`.
- **Happy (FR root):** Given two stories conflict because two FRs contradict, when `conflict-check`
  classifies the root, then it kicks back to `prd` (not `stories`).
- **Happy (design root):** Given a conflict rooted in an ADR/design choice, when classified, then it
  kicks back to `architecture`.
- **Happy (story root):** Given a pure story-phrasing overlap, when classified, then it kicks back to
  `stories`.
- **Negative (unresolved blocks plan):** Given a blocking conflict, when unresolved, then DECIDE does
  not advance to `plan`.

## S8 — architecture-review is convergent under kickback (FR-12)

- **Happy (full pass):** Given the pre-stories run, when `architecture-review` executes, then it does
  a full feasibility/alignment pass and produces APPROVED ADRs.
- **Happy (amendment):** Given a story or conflict re-opens architecture with a specific structural
  gap, when `architecture-review` re-runs, then it performs a targeted amendment addressing only that
  gap (not a from-scratch re-derivation) and converges.
- **Negative (only structural gaps re-open):** Given a story-phrasing nit (no structural gap), when a
  kickback to architecture is attempted, then it is rejected — architecture is not re-opened.
- **Negative (cap → HALT, no spin):** Given architecture is re-opened more than the kickback cap, when
  the cap is exceeded, then the run HALTs for a human instead of looping.

## S9 — plan always derives from architecture + stories (+ PRD) (FR-10)

- **Happy:** Given approved architecture + stories (+ PRD if product), when `plan` runs, then a task
  plan with a dependency graph is produced; tasks cross-reference stories where applicable.
- **Negative (coverage gap blocks):** Given a story acceptance criterion with no corresponding task,
  when the plan gate runs, then it blocks until coverage is complete.

## S10 — track-aware landing (FR-13)

- **Happy (product):** Given `Track: product`, when `land-spec` runs, then it requires spec + stories
  + plan and commits them plus the track marker on the spec branch.
- **Happy (technical):** Given `Track: technical`, when `land-spec` runs, then it requires stories +
  plan (NOT a `.docs/specs/` PRD) and commits them plus the track marker.
- **Negative (product missing PRD):** Given `Track: product` with no `.docs/specs/` doc, when
  `land-spec` runs, then it rejects with a clear error.

## S11 — daemon + back-compat (FR-15, NFR)

- **Happy (unchanged discovery):** Given merged stories + plan on the base branch, when
  `discoverBacklog` runs, then the feature is eligible exactly as before (stories still required —
  Model X).
- **Happy (track read):** Given a committed track marker, when the daemon builds, then it knows the
  track and applies the track-aware SHIP gates (e.g. skips `prd-audit` for technical).
- **Negative (missing marker = product):** Given a pre-existing spec with no track marker, when the
  daemon reads it, then it defaults to `product` so no previously-buildable spec regresses.
- **Negative (state migration):** Given `conduct-state.json` with `brainstorm: done` and no
  `explore`/`prd` keys, when conduct resumes, then `explore` is treated done and `prd` is
  done-if-spec-exists-else-skipped — the feature does not re-run completed DECIDE work.

## S12 — #142 absorbed / HARNESS convention (FR-4)

- **Happy:** Given the restructure ships, when HARNESS.md is read, then the "PRDs are product-only"
  convention (with the external-constraint carve-out) is present as the single source, and #142 is
  closed/repurposed.
- **Negative (no duplicate gate):** Given the product-only gate lives in `prd`, when `brainstorm` is
  searched, then it no longer exists as a skill (split into `explore` + `prd`) — no orphaned gate.
