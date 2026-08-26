# Conflict Report: hard-delete-the-retired-wiring-check-step-name-fro

**Date:** 2026-08-26
**Scope:** 6 new stories in `.docs/stories/hard-delete-the-retired-wiring-check-step-name-fro.md`
vs all existing stories, active specs, and the repo-wide APPROVED ADR corpus
(`conflict_check.adr_corpus: repo_wide`).

**Result: PASSED — zero blocking conflicts, zero degrading conflicts accepted.**

## ADR corpus (repo_wide)

Examined: the full `.docs/decisions/` corpus (510 files) was swept during
`architecture-review-2026-08-26-hard-delete-the-retired-wiring-check-step-name-fro`; that sweep's
binding set (18 ADRs, Tiers 1–4 of the review) was compared against the 6 stories here.
Narrowed out: ADRs whose subject has no overlap with step registry, BUILD verification, group
fan-out/join, step-keyed config, event unions, kickback ledger, or rebase invalidation (the
remaining ~490), plus fully superseded ADRs (`adr-2026-07-12-wiring-check-gate` retained — only
partially superseded; verified its residual decisions concern deleted machinery, no story overlap).

The two ADRs whose text opposed these stories — `adr-2026-08-14-retire-build-review-wiring-rubric`
("removing the name would reintroduce the `Unknown step` hazard") and
`adr-2026-07-29-deterministic-build-verification-fanout` (two-member group, points 1–3) — were
amended 2026-08-26 by #1896 during architecture review, before stories were derived. No current
APPROVED ADR sentence opposes any story sentence. (Verified against the amended texts; 95%.)

## Historical shipped-feature stories (noted, not conflicts)

Stories of already-shipped features describe the system as built at their time and name
`wiring_check` as existing behavior; the highest-overlap files were pairwise checked in both
directions against the new stories:

- `deterministic-test-suite-step.md` — asserts `build → {wiring_check, test_suite}` fan-out and
  member ordering. Superseded at the design level by the 2026-08-26 amendment to
  `adr-2026-07-29`; its surviving semantics (deterministic gating of `build_review`, failure
  classification) are exactly what new Stories 2–3 preserve. Not an oscillation: satisfying the
  new stories removes, not re-breaks, the old fan-out — the old story's requirement no longer has
  a governing ADR. Historical record; not edited by this spec.
- `post-rebase-invalidation-re-runs-every-judged-gate.md` — requires rebase invalidation of
  `wiring_check`. The invalidation-set update is condition C4 of the architecture review and plan
  work; the surviving members' invalidation behavior is unchanged. Historical record; not edited.
- `rebase-invalidated-test-suite-proof-halts-build-re.md` — cites `wiring_check`'s
  unconditionally-satisfied predicate as an exclusion example; its actual requirement (test_suite
  proof invalidation halts build_review) is untouched and reinforced by new Story 2.
- Older wiring-gate feature stories (`2026-07-12-wiring-reachability-gate.md`,
  `wiring-gate-flags-…`, `build-agent-disputing-…`, `per-task-wired-into-…`) — describe machinery
  already deleted by #1496; doubly historical, no live requirement to oppose.

## Pairwise scan of the 6 new stories

All 15 pairs checked in both directions (contradiction, overlap, state, resource, sequencing,
oscillating). Notable examined pairs, all compatible:

- Story 1 (unknown step fails by name) vs Story 5 (stale state keys ignored): different surfaces —
  operator-supplied names fail closed; persisted historical state reads leniently. Both hold
  simultaneously; the intake outcome demands exactly this split.
- Story 3 (budget charged on failure) vs Story 4 (re-verification after repair): a re-run failure
  is charged per Story 3; a re-run pass proceeds — no pair of requirements re-breaks the other.
- Story 6 (config fails closed) vs Story 5 (ledgers load leniently): config is operator-authored
  input, ledgers are engine-written history; disjoint resources.

## Conclusion

Clean pass. No story updates required; no superseding ADRs created by this check. Proceed to
`/plan`.
