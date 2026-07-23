# Architecture Review: DECIDE Artifact Coherence Check

**Date:** 2026-07-22
**Mode:** Lightweight (tier M) — feasibility + alignment full; complexity/domain-precheck skipped per tier
**Inputs reviewed:** PRD `.docs/specs/2026-07-22-decide-artifact-coherence-check.md` (FR-1..14); diagrams `decide-artifact-coherence-check.md` + `sequences/decide-artifact-coherence-check.md`; approach memory
**Verdict:** APPROVED

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TS engine code + one new Markdown skill; no new deps. Verified: all needed parsers exist (`splitStoryBlocks`, `collectPlanCoverage`, `plan-task-parse.ts` grammar, FR-N regexes in `artifacts.ts`). |
| Prerequisites | Early intake persistence (FR-13): the claim payload already carries the full intake body in-session; the engineer flow can write `.docs/intake/<slug>.md` with outcome bullets at worktree creation. `intake-marker.ts` already preserves pre-existing lines on rewrite (verified) — extend preservation to the outcomes body. ~90% confidence, inferred from existing preserve behavior. |
| Integration surface | Three seams: engineer skill flow (new step), `landSpec` ladder (new rungs), intake marker (earlier write + richer body). All are owned by this repo; no external APIs. |
| Data implications | New committed artifact classes: `.docs/coherence/`, `.docs/coherence-waivers/`, enriched `.docs/intake/`. Append-only docs; no migrations. |
| Performance | Validator is file parsing + set arithmetic — negligible. No model calls at land (ADR: placement-and-validation-split). |
| Worktree isolation | All reads/writes inside the per-idea worktree + local git reads of the default branch; no shared mutable state. |

## Alignment

- **"Deterministic where possible; LLM only where necessary"** (CLAUDE.md design
  principle): the split — semantic judging in the authoring step, pure-code enforcement
  at land — is the canonical application. Consistent with precedent #773/#426/#433
  (machinery over prompt discipline).
- **Existing gate idioms respected:** fail-closed parse (build_review verdict pattern),
  waiver = release-gate mirror (`Waives:`/`Rationale:`, fresh-in-diff,
  parse-don't-validate), per-gap HALT messages naming the remainder.
- **No boundary violations:** validator lives beside the existing land ladder in
  `engineer/`; no cross-domain reach into daemon/build code. prd-audit (SHIP) and
  conflict-check (cross-feature) remain untouched — this gate is complementary, not
  overlapping (PRD Non-Goals).
- **Diagram accuracy:** both feature diagrams reflect the decided architecture
  (checked post-ADR; no drift).
- **State management:** gap ids derive from artifact-stable keys; no new stateful
  store — the committed markers ARE the duplicate-claim record (aligns with
  adr-2026-07-03-committed-shipped-record-dispatch-dedup).

## Wiring Surface (design-time)

| New surface | Wired into (production caller) |
|---|---|
| `skills/coherence-check/SKILL.md` | Engineer DECIDE order: `skills/engineer/SKILL.md` step list + HARNESS.md phase table + model-selection table (integrity tests 5/5a/5b) |
| `CoherenceValidator` (+ waiver evaluator) | `landSpec` ladder, after tier/artifact + DRAFT-ADR checks (`land-spec.ts`) |
| Duplicate-claim scan | Same `landSpec` rung, reading default-branch `.docs/intake/` + `.docs/shipped/` markers |
| Early intake persistence | Engineer worktree/claim flow (`engineer-cli.ts` worktree or claim handler) writing `.docs/intake/<slug>.md`; `writeIntakeMarker` preserves it at land |
| `.docs/coherence/<plan-stem>.md` artifact | Authored by the new skill; consumed by `CoherenceValidator`; inspectable in spec PR |
| `.docs/coherence-waivers/<plan-stem>.md` | Consumed by the waiver evaluator inside `landSpec` |

**Early overlap scan (advisory):** `land-spec.ts` is touched by ~29 unmerged spec
branches (notably `spec-authoring-is-blind-to-unmerged-dependent-work`,
`engineer-land-validates-an-unrelated-legacy-spec-o`, `intake-criteria-enforcement-and-backfill`).
Advisory only — the plan should keep the validator in a new module with a single
call-site insertion in `landSpec` to minimize rebase surface.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Same-session semantic mislabel passes land | Technical | Medium | Medium | Mechanical id cross-check catches fabrication; operator reviews committed mapping in PR; prd-audit backstops at SHIP |
| `land-spec.ts` rebase contention (29 branches) | Integration | High | Low | New module + single-line ladder insertion; rebase skill handles conflicts |
| Gap-id scheme drift invalidates waivers | Technical | Low | Medium | Ids derive from artifact-stable keys; documented in skill; unknown id = malformed (fail-closed, never silent) |
| Legacy specs without coherence artifact | Integration | Medium | Medium | Gate applies to specs landed AFTER ship (PRD: no retroactive validation); validator keys off artifact presence for new lands only — plan must make the trigger explicit (condition C1 below → tracked as plan task) |
| In-flight duplicate (two unmerged sibling PRs) | Data | Low | Low | Advisory warn when network available; merged-marker check blocks before second build dispatch |

## ADRs Created

- `adr-2026-07-22-coherence-gate-placement-and-validation-split` — hybrid placement,
  semantic-at-authoring / mechanical-at-land, orphan-task rule, track/origin
  degradation. (APPROVED 2026-07-22)
- `adr-2026-07-22-coherence-waiver-and-duplicate-claim` — waiver mirrors release-gate
  pattern under `.docs/coherence-waivers/`; duplicate lookback = default-branch
  committed markers blocking, open-PR scan advisory. (APPROVED 2026-07-22)

## Conditions

None blocking. One planning directive from the risk table: the plan MUST include an
explicit no-retroactivity trigger (validator engages only when the land is producing a
new spec under the new flow — e.g. presence of the coherence artifact requirement is
derived from the spec's own change set, not from repo history), so already-merged specs
and legacy re-lands never fail the new gate.
