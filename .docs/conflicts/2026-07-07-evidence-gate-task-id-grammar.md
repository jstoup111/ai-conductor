# Conflict Check: Evidence-Gate Task-Id Grammar Unification (#417)

**Date:** 2026-07-07
**New stories:** .docs/stories/2026-07-07-evidence-gate-task-id-grammar.md (5 stories)
**Result:** CLEAN — zero blocking, zero degrading conflicts

## Pairs Examined (reasoned, not assumed)

1. **vs `prd-audit-kickback-preserves-task-status.md` (engine-owned task-status
   stories, H5 derivation)** — those stories assert bare `Task: 3` trailers complete
   tasks and subject-only references do NOT. The alias is strictly additive: every
   existing assertion (bare-trailer completion, multi-trailer commits, trailer-only for
   path-less tasks, subject-heuristics demotion) remains true verbatim. No story
   asserts a prefixed trailer must fail — the current failure is the bug being fixed.
   Confidence: verified against story text lines 63–90. NOT a conflict.
2. **vs `add-a-judgement-gate-at-the-build-manual-test-seam.md` (build_review gate,
   same-day spec on main, intake #324)** — its grader reads git diff + plan only and
   its kickback re-entry story requires completion re-derivation to keep previously
   completed tasks completed. The alias only *increases* the resolved set
   monotonically; derive output shape and sidecar semantics are unchanged. Its engine
   surface (step registry/config in conductor.ts) is disjoint from ours (autoheal.ts
   trailer predicates + two SKILL.md files). NOT a conflict; no resource contention.
3. **vs `ST-020-factory-orchestration.md`** — mandates trailer-based engine derivation
   (ADR H4/H5/H6); our stories implement/extend the same contract. NOT a conflict.
4. **Internal pair: Story 1 (gate accepts `task-N`) vs Stories 2–3 (skills ban
   `task-N`)** — deliberate layering per the APPROVED ADR: the contract is stricter
   than the gate so new work converges on one spelling while unambiguous legacy
   evidence still counts. Contract-stricter-than-enforcement is not an impossible
   state. NOT a conflict.
5. **Sequencing vs the two parked features** (`audit-trail-…`, `fix-400-…`) — Story 4's
   runbook runs only after this fix merges; the parked branches are consumers, not
   concurrent editors of the same files (their diffs touch retro/audit and daemon
   respawn surfaces, not autoheal trailer matching or the two SKILL.mds). NOT a
   conflict.
6. **Open spec/* branches sweep** — none of the 12 open `origin/spec/*` branches
   target autoheal.ts, skills/tdd/SKILL.md, or skills/pipeline/SKILL.md scope
   (checked by name + known scope; the two parked implementation branches covered in
   pair 5). NOT a conflict.

## Notes

- Engine-owned task-status (#302/#384) is already implemented on main (verified:
  deriveCompletion/sidecar present in autoheal.ts; build-review-gate review cites it as
  a satisfied dependency) — no sequencing dependency remains.

Conflict check passed. Proceed to /plan.
