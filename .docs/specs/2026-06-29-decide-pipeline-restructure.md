# Design Doc: DECIDE pipeline restructure — explore / prd split, tracks, reordering

**Date:** 2026-06-29
**Status:** Approved
**Supersedes:** PR #142 (product-only PRD convention is absorbed here)

## Problem / Background

The `brainstorm` skill fuses two responsibilities — **divergent exploration** (explore context,
ask questions, propose approaches) and **convergent PRD authoring** (enumerate FRs, produce the
design doc) — against the harness's own "one skill, one responsibility, one enforcement level"
rule. `stories` and `plan` are each their own skill/step; `prd` is not, despite being the same kind
of artifact-producing transform. Three concrete problems follow:

1. **No product-only enforcement home.** PR #142 tried to bolt a hard product-only *gate* onto
   `brainstorm`, which is `enforcement: advisory` — an enforcement mismatch.
2. **PRDs are forced even when meaningless.** Technical-only work (refactors, infra, dependency
   bumps, internal tooling) has no product/user requirements; a PRD is hollow ceremony.
3. **Ordering misses architecture-induced behavior.** Stories are written *before* architecture, so
   failure modes that a design decision creates (timeouts from an external API, backpressure from a
   queue) aren't captured as negative-path stories — the design that produces them doesn't exist yet.

## Goals & Non-Goals

**Goals**
- Split `brainstorm` into `explore` (always-run, advisory) + `prd` (product-only, gating).
- Make the **PRD conditional** on a **track** (product vs technical) decided during `explore`.
- Reorder DECIDE so **architecture precedes stories**; stories derive from architecture (+ PRD when
  present); plan derives from architecture + stories (+ PRD).
- Keep **acceptance criteria always present as stories** (Model X) — technical features write
  technical stories.
- Make `conflict-check` route kickbacks to the **root cause** (prd | architecture | stories).
- Keep the flow **convergent** (no spinning) under the new kickback edges.
- Absorb #142's "PRDs are product-only" contract into the `prd` skill + HARNESS.

**Non-Goals**
- Changing the BUILD task loop, the daemon worker pool, or the complexity-tier axis.
- Dropping stories for any track (Model Y is explicitly rejected).
- Renaming `daemon`/`engineer` vocabulary (deferred to 1.0).

## Users / Personas

- **Operator (interactive `/conduct`)** — drives DECIDE; confirms the track in `explore`.
- **Engineer host agent (`/engineer`)** — authors the full DECIDE phase via the `decide(step)` seam.
- **Daemon** — consumes merged DECIDE artifacts to build autonomously; must know the track to know
  which artifacts to expect and which SHIP gates apply.

## Key concept: the track

`explore` classifies the work as **product** or **technical** and the operator confirms it (like the
complexity tier). The track is persisted as a committed marker the daemon can read:

- **product** → a PRD is required; `prd-audit` runs at SHIP.
- **technical** → no PRD; `prd` and `prd-audit` are skipped; technical stories carry acceptance
  criteria; architecture + plan still required (tier permitting).

Misclassification (product work mislabeled technical) ships without product requirements — a
correctness risk — so the track decision is an explicit, operator-confirmable gate, never silent.

## Functional Requirements

- **FR-1 (explore step).** `explore` always runs as a distinct **advisory** step. It explores
  context, asks questions one at a time, and presents 2–3 approaches with trade-offs. Its working
  notes are ephemeral (`.pipeline/`, gitignored); the **selected approach + rejected alternatives**
  are promoted durably to `.memory/decisions/`. It writes no `.docs/` artifact.
- **FR-2 (track decision).** `explore` emits a **track** (`product` | `technical`), operator-
  confirmable, persisted to a committed marker (`.docs/track/<slug>.md`, `Track: product|technical`)
  so the daemon and downstream steps can read it.
- **FR-3 (prd step, conditional).** When the track is `product`, `prd` runs as a **gating** step and
  writes the product-only design doc to `.docs/specs/`. When `technical`, `prd` is skipped.
- **FR-4 (product-only PRD).** The PRD states goals + requirements (what/why) only. It MUST NOT name
  technical "hows" (commands/flags, file paths, config keys, function/class/type names,
  library/protocol/mechanism choices, schemas, ports). Pre-existing **external** constraints and
  dependencies MAY be named as requirements (Dependencies / NFR); what is prohibited is choosing the
  **new internal mechanism** by which *this* feature is built — that is resolved in
  architecture-review and recorded as ADRs. A product-only audit gate runs before approval. (This is
  #142's contract, corrected for the external-constraint carve-out, and lifted to HARNESS.)
- **FR-5 (ordering).** DECIDE runs in the order:
  `explore → [prd if product] → architecture-diagram → architecture-review → stories →
  conflict-check → plan`. (`architecture-*` and `conflict-check` remain tier-skipped for Small.)
- **FR-6 (architecture before stories).** Architecture-review runs on the PRD/FRs (product) or the
  explore output (technical), producing APPROVED ADRs, **before** stories. Stories are authored
  against the approved design.
- **FR-7 (stories always — Model X).** `stories` always runs and is the single acceptance-criteria
  artifact (`.docs/stories/`), with mandatory happy + negative paths. Product features write product
  stories from PRD FRs; technical features write technical stories from the technical intent +
  architecture. Stories stay phrased as observable behavior/acceptance — architecture informs *which*
  scenarios exist, it is not copied as mechanism into story text.
- **FR-8 (architecture-induced negatives).** Because stories follow architecture, failure modes a
  design decision introduces are captured as negative-path stories.
- **FR-9 (conflict-check root routing).** `conflict-check` runs after stories and classifies each
  conflict's root, kicking back to the right gate: contradictory FRs → `prd`; incompatible
  design/ADR → `architecture`; story-phrasing overlap → `stories`. A clean pass writes the existing
  clean-check marker.
- **FR-10 (plan always).** `plan` always runs and derives tasks from architecture + stories (+ PRD
  when present); tasks cross-reference stories where applicable.
- **FR-11 (kickback targets).** The gate-loop kickback target set is extended from `{stories, plan}`
  to `{prd, architecture, stories, plan}`.
- **FR-12 (anti-spin / convergence).** Architecture-review has two modes: a **full** pass (pre-
  stories) and a **targeted-amendment** pass when re-opened by a downstream kickback — the kickback
  carries the specific structural gap and the amendment addresses only that. Only a genuine
  **structural** gap (missing component/seam/boundary) may re-open architecture; story phrasing or
  coverage nits may not. The existing per-gate kickback cap applies to the new targets; on exceed the
  run HALTs for a human instead of looping.
- **FR-13 (track-aware landing).** `land-spec` requires a PRD only on the product track; stories +
  plan are required on both. The track marker is committed with the other DECIDE artifacts.
- **FR-14 (track-aware SHIP).** `prd-audit` runs only on the product track; on the technical track it
  auto-skips (no FRs to audit), logging the reason.
- **FR-15 (migration).** Existing `conduct-state.json` with `brainstorm: done` maps to
  `explore: done` + (`prd: done` if a `.docs/specs/` doc exists, else `prd: skipped`). The daemon's
  `PRESEEDED_DONE` and `discoverBacklog` treat a missing track marker as `product` (back-compat:
  pre-existing specs are product PRDs) so in-flight features don't regress.

## Non-Functional Requirements

- **Backward compatibility.** `discoverBacklog` keeps reading `.docs/plans/` + `.docs/stories/`
  unchanged (Model X). No existing committed spec becomes unbuildable.
- **No new spin risk.** The new kickback edges must be provably bounded (cap → HALT).

## Acceptance Criteria / Success Metrics

- A technical-only feature flows `explore → architecture → stories → plan` with **no PRD** and the
  daemon builds it; `prd-audit` is skipped at SHIP.
- A product feature flows `explore → prd → architecture → stories → conflict-check → plan`; the PRD
  passes the product-only audit; `prd-audit` runs at SHIP.
- Writing a story that needs a seam the design lacks re-opens architecture in **amendment** mode and
  converges (no oscillation); exceeding the cap HALTs.
- A conflict rooted in two FRs kicks back to `prd`, not `stories`.
- All existing conductor tests pass; a migration test proves `brainstorm: done` state resumes
  correctly.

## Scope

**In:** new `explore` + `prd` skills; retire/rename `brainstorm`; track marker + parser; DECIDE
reorder; `StepName`/`DecideStep` updates; conduct flow + skip table + model table; gate kickback
target extension + amendment-mode arch-review; `land-spec` + `discoverBacklog` + `PRESEEDED_DONE`
track-awareness; `prd-audit` track gate; state migration; HARNESS product-only convention; docs +
CHANGELOG; close/repurpose #142.

**Out:** BUILD task loop, daemon pool, complexity axis, daemon/engineer rename.

## Key Decisions & Rationale

- **Model X over Y** — stories are always the acceptance-criteria artifact (technical features get
  technical stories), so the BUILD/daemon path (`acceptance_specs`, `discoverBacklog`, `land-spec`
  story checks) is untouched. Y would spend risk in the fragile daemon for the sake of not writing a
  stories file on refactors.
- **Track decided in `explore`** — exploration is exactly where you learn whether the work is product
  or technical, so the PRD-needed decision is its natural output (vs a separate classification step).
- **Architecture before stories** — keeps the PRD product-pure (the *how* resolves in
  architecture-review), and lets stories capture architecture-induced failure modes as negative
  paths. Behavior-first is preserved because the PRD already states behavior before architecture.
- **Amendment-mode arch-review + capped kickbacks** — the convergence guarantee; without it the new
  stories→architecture and conflict→architecture edges could oscillate.

## Dependencies

- Existing conduct gate-loop machinery (`gate-verdicts.ts`, `selector.ts`, kickback cap/HALT).
- Existing intake/daemon marker pattern (`.docs/complexity/<slug>.md` → `parseComplexityTier`) as the
  template for the new track marker.

## Open Questions

- Marker location: `.docs/track/<slug>.md` (dedicated) vs folding `Track:` into the existing
  complexity marker. Leaning dedicated for single-responsibility; architecture-review to weigh.
- Whether `explore` should be skippable on the technical track for trivial changes, or always run.
- Exact migration semantics for an in-flight feature mid-DECIDE when the rename lands.
