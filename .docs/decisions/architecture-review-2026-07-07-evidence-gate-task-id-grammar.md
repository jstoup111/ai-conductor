# Architecture Review: Evidence-Gate Task-Id Grammar Unification (#417)
**Date:** 2026-07-07
**Mode:** Lightweight (Medium tier) — Sections 2 (Feasibility) + 4 (Alignment) full
**Input reviewed:** explore output + approved approach B (technical track — no PRD; stories not yet written)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | Pure TypeScript (engine) + Markdown (skills). No new deps. ✅ |
| Prerequisites | None. The governing ADR (adr-2026-07-05-engine-owned-task-status) is APPROVED and its H5 empty-commit Evidence form is already implemented in `deriveCompletion`. ✅ |
| Integration surface | Two engine functions (`deriveCompletionInternal` trailer predicates in `src/conductor/src/engine/autoheal.ts`), two SKILL.md contracts, docs. `checkCommitEvidence` (advisory fast-feedback) needs no change — it never compares to plan ids. Verified `remediation-append.ts` only *generates* H9 ids; it does not match trailers. ✅ |
| Data implications | None — sidecar schema (`task-evidence.json`) unchanged; alias stamps use the existing `{sha, form}` shape. ✅ |
| Performance risk | One extra string comparison per trailer per task. Negligible. ✅ |
| Worktree isolation | No new services/ports/state. ✅ |

## Alignment

- **adr-2026-07-05-engine-owned-task-status (APPROVED, authoritative):** H2 (trailer
  enforced at both skill layers) and H5 (trailer-first, empty-commit Evidence form) are
  *implemented*, not altered, by items 1–2. Item 3 (alias) *extends* H5's matching
  semantics — captured in the new DRAFT ADR adr-2026-07-07-task-trailer-id-alias rather
  than a silent divergence. H4/H6 single-authority and sidecar-only trust are untouched.
- **Convention "fix the skill, not an engine workaround" (memory, #156→#161):** the root
  cause is fixed in the skills; the engine alias is a deliberate, ADR-recorded
  back-compat extension, not a workaround substituting for the skill fix.
- **Pattern consistency:** normalization lives in one helper used by both trailer
  predicates — no duplicated grammar logic (H9 lesson: one grammar, applied everywhere).
- **Diagram accuracy:** feature diagrams written and operator-approved
  (.docs/architecture/2026-07-07-evidence-gate-task-id-grammar.md + sequences/).

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Alias cross-matches when a plan declares a literal `task-N` id alongside bare `N` | Data | Low | High | Ambiguity guard: alias suppressed when `task-<id>` ∈ plan ids; pinned by adversarial test |
| Skill wording change doesn't reach already-dispatched agents (in-flight builds) | Integration | Medium | Low | Alias covers the legacy spelling; no in-flight build breaks |
| Recovery backfill mis-attributes an unverified task | Data | Low | High | Procedure is operator-gated per task; `satisfied-by` must cite a reachable SHA (engine already rejects dangling SHAs) |
| tdd COMMIT checklist growth degrades agent compliance | Knowledge | Low | Medium | Single crisp rule + example; fast-feedback hook already warns on unevidenced commits at commit time |

## ADRs Created

- `adr-2026-07-07-task-trailer-id-alias.md` — **DRAFT**, requires operator approval
  (this review's only new architectural decision; everything else implements the
  existing APPROVED engine-owned-task-status ADR).

## Conditions

1. adr-2026-07-07-task-trailer-id-alias must be APPROVED before stories are written
   (hard gate — no DRAFT ADR may land).
2. The alias implementation must be a single shared helper used by BOTH trailer
   predicates in `deriveCompletionInternal`; tests must pin the ambiguity guard and the
   unchanged negative paths (empty commit without Evidence:, dangling satisfied-by).
3. The pipeline SKILL.md progress-log example (`task-1`, `task-2`) must be corrected in
   the same change — a contract doc may not contradict its own grammar.
