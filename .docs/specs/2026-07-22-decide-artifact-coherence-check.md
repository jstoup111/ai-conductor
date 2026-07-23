# PRD: DECIDE Artifact Coherence Check

**Date:** 2026-07-22
**Status:** Approved
**Intake:** jstoup111/ai-conductor#539
**Track:** product · **Tier:** M

## Problem / Background

Each DECIDE artifact (PRD, stories, plan, and the originating intake issue's Desired
outcomes) is validated individually for form — frontmatter, acceptance status, dependency
tree, no draft decisions — but nothing validates the chain as a whole: that the
requirements, the stories, the plan's tasks, and the intake's stated outcomes are all
solving the same problem.

Today's gaps:
- A plan's story→task coverage claims are self-reported by the plan author and never
  verified against the stories.
- Cross-feature conflict checking compares a feature's stories against *other* features'
  stories, not against its own requirements or plan.
- Implementation-vs-requirements auditing happens at SHIP, after a DECIDE-time drift has
  already burned build cycles.
- The intake issue's Desired-outcome bullets — the operator's actual acceptance signals —
  are not traced into any artifact; a spec can lock while quietly solving an adjacent
  problem.

Observed costs (week of 2026-07-11): duplicate specs for the same intake issue (#527 vs
#530) caught only by operator review; plan-vs-repo drift (#538) costing a halt cycle; a
decision promising "#467 subsumed" while the plan's corresponding wiring was later
stubbed, with no artifact-level check downstream of the decision.

DECIDE defects are the most expensive class: they lock into approved artifacts and
surface only as build residue, gate refusals, or shipped gaps. The BUILD phase now
validates against reality; DECIDE remains self-attested.

## Goals & Non-Goals

**Goals**
- Every spec's artifact chain (intake outcomes → requirements → stories → plan tasks) is
  verified coherent — mechanically, against the artifacts themselves — before the spec
  can land.
- The verification result is an auditable, committed record that travels with the spec —
  not self-reported prose.
- Incoherent specs (unmapped outcome, uncovered story, orphan task, duplicate intake
  claim) cannot land without an explicit operator-approved waiver naming each gap.
- Detection moves from SHIP (after the build) to end-of-DECIDE (before the build), where
  a defect costs minutes instead of dispatch cycles.

**Non-Goals**
- Replacing or changing SHIP-phase auditing (implementation-vs-requirements) — that
  remains the check against *built* reality.
- Replacing cross-feature conflict checking — story-vs-story comparison across features
  is unchanged.
- Retroactively validating specs already merged.
- Judging the *quality* of stories, requirements, or tasks — only their mutual coverage
  and consistency.

## Users / Personas

- **Operator** — merges spec PRs; needs confidence that a spec actually addresses the
  intake it claims, without hand-auditing four artifacts; approves waivers for
  intentional gaps.
- **DECIDE-phase authoring flow** — produces the artifact chain; needs the coherence
  verdict early enough to fix gaps while authoring context is still live.
- **Build daemon** (indirect) — consumes only specs whose chain has been verified,
  wasting no build cycles on adjacent-problem or self-contradictory specs.

## Functional Requirements

- **FR-1 — Auditable traceability record.** At the end of DECIDE, before a spec lands, a
  traceability record is produced covering the full chain — each intake Desired-outcome
  bullet, each enumerated requirement (product track), each story, each plan task — with
  a per-item mapping verdict. The record is committed as part of the spec's artifact set
  and is inspectable in the spec PR.

- **FR-2 — Outcome coverage.** Every Desired-outcome bullet from the originating intake
  maps to at least one story. An outcome bullet with no story (adjacent-problem drift)
  blocks landing.

- **FR-3 — Requirement coverage (product track).** Every enumerated functional
  requirement in the approved PRD maps to at least one story and, through its stories,
  to at least one plan task. An uncovered requirement blocks landing.

- **FR-4 — Story coverage.** Every accepted story maps to at least one plan task. An
  uncovered story blocks landing.

- **FR-5 — No orphan tasks.** Every plan task traces to at least one story or to an
  explicitly declared supporting purpose (e.g. infrastructure or refactoring in service
  of the feature). A task serving no story and declaring no purpose blocks landing.

- **FR-6 — Internal plan consistency.** The plan's own coverage claims must agree with
  its actual task tree. A coverage claim referencing a nonexistent task, or a task tree
  contradicting the claimed coverage, blocks landing.

- **FR-7 — Duplicate intake claim.** Landing a spec that claims an intake issue already
  claimed by a previously landed or shipped spec is refused, with the conflicting spec
  identified, unless the operator explicitly approves the duplicate.

- **FR-8 — Waiver.** A spec blocked on any coherence gap can land only with an explicit
  operator-approved waiver that names each specific gap being waived. A waiver covering
  only some of the gaps still blocks on the rest. A waiver must accompany the spec's own
  change set — a waiver from a previous spec never satisfies a later one.

- **FR-9 — Precise gap reporting.** When the check blocks, the report names each gap
  concretely — which outcome bullet is unmapped, which story is uncovered, which task is
  orphaned, which claim is contradicted — so the operator can route the fix to the right
  artifact without re-deriving the analysis.

- **FR-10 — Technical-track behavior.** A technical-track spec (which has no PRD) is
  checked on the outcomes ↔ stories ↔ tasks chain only. The absence of a PRD is not a
  gap; no phantom requirement layer is imposed.

- **FR-11 — No-intake behavior.** A spec whose idea did not originate from an intake
  issue (e.g. captured directly from the operator) is checked on the stories ↔ tasks
  chain only. The absence of intake outcomes is not a gap.

- **FR-12 — Small-tier exemption; silent pass elsewhere.** Small-tier specs are exempt
  from the coherence check entirely — no traceability record is required and landing
  imposes no coherence validation on them, exactly as other design-stage checks are
  already skipped for Small. For Medium and Large tiers, a fully coherent spec passes
  with zero added operator interaction: coherent means silent.

- **FR-13 — Outcomes travel with the spec.** The originating intake's Desired-outcome
  bullets are captured when the idea is claimed, are available to the coherence check
  throughout DECIDE, and are committed as part of the spec's artifact set when it
  lands — so the outcomes remain inspectable in the spec PR, not only in the external
  issue.

- **FR-14 — Fail-closed.** A missing, empty, or unparseable traceability record blocks
  landing exactly as an incoherent one does. Absence of evidence is never a pass.

## Non-Functional Requirements

- **Deterministic enforcement at the landing boundary.** The landing-time refusal must be
  mechanical and unbypassable by authoring-agent behavior — it must not depend on the
  authoring session's self-report.
- **Zero added ceremony for the coherent path.** A fully coherent spec incurs no new
  operator prompts, approvals, or interactions at landing.
- **Actionable failure output.** Block messages must be specific enough to fix from
  directly (per FR-9), matching the harness's existing gate-message conventions.

## Acceptance Criteria / Success Metrics

- The three observed defect shapes are caught before landing: an outcome bullet with no
  story (adjacent-problem drift), two specs claiming the same intake (duplicate-spec
  class), and a plan task tree contradicting its own coverage claims.
- A spec with a fully coherent chain lands with no new operator interaction.
- A Small-tier spec lands with no coherence artifact and no coherence validation.
- A technical-track spec without a PRD passes the check without a phantom-PRD gap.
- A spec with any unwaived gap cannot land by any non-waiver path.
- The traceability record is present and readable in the landed spec's PR.

## Scope

### In Scope
- The end-of-DECIDE coherence verification and its committed traceability record.
- Landing-time enforcement with the waiver escape hatch.
- Duplicate-intake-claim detection at landing.
- Early capture of intake Desired-outcome bullets into the spec's artifact set.
- Precise, per-gap block reporting.

### Out of Scope
- SHIP-phase implementation auditing (unchanged).
- Cross-feature story conflict checking (unchanged).
- Coherence checking of specs authored before this capability ships.
- Enforcement inside the build loop (the daemon builds only landed-and-merged specs;
  the landing boundary is the enforcement point).
- Judging artifact quality beyond mutual coverage and consistency.

## Key Decisions & Rationale

- **Verify at end-of-DECIDE, not at SHIP.** DECIDE-time drift caught at SHIP has already
  burned build cycles; the landing boundary is the last moment the fix is cheap and the
  authoring context is live.
- **Auditable record over self-reported prose.** Self-reported coverage claims are
  exactly the failure mode observed; the record must be verifiable against the artifacts
  it maps.
- **Waiver over hard wall.** Some gaps are intentional (deferred outcomes, consciously
  descoped stories); the operator can accept a named gap explicitly, but silence never
  passes.
- **Coherent path stays silent.** The check exists to catch the rare expensive defect,
  not to add ceremony to every spec; a clean chain must cost the operator nothing.

## Dependencies

- The originating intake issue's Desired-outcome section (existing intake convention) as
  the source of outcome bullets.
- Existing DECIDE artifact conventions: enumerated requirements in the PRD, story
  acceptance-criteria structure, plan task structure with per-task story references and
  coverage claims.
- The existing landing step as the enforcement boundary.

## Open Questions

- **Where the semantic mapping is authored** (a dedicated end-of-DECIDE step vs judged at
  landing time): an approach was selected during exploration (~90% confidence, recorded
  in the decision memory) — architecture review should ratify it as an ADR, weighing
  self-attestation risk against landing-time cost.
- **Orphan-task semantics** (FR-5): what counts as a validly "declared supporting
  purpose" for tasks that serve no single story (infrastructure, refactoring), and how
  strict the declaration must be — needs an architectural decision so the rule is
  mechanical.
- **Semantic vs lexical mapping strength** (FR-2): whether outcome→story correspondence
  requires judged semantic equivalence or accepts declared references, and who/what
  judges it (~70% confidence that judged equivalence is needed for the adjacent-drift
  case) — trade-off for architecture review.
- **Duplicate-claim lookback scope** (FR-7): whether "previously claimed" spans only
  landed/shipped specs in the target repo or also open spec PRs — affects how early a
  duplicate is caught.
