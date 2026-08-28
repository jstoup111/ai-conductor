# Conflict Check: finish-deadlocks-when-the-prose-judge-asks-for-rev

**Date:** 2026-08-28
**Stories scanned:** .docs/stories/finish-deadlocks-when-the-prose-judge-asks-for-rev.md
(Stories 1–5) against each other and against the existing `.docs/stories/` corpus.
**ADR corpus:** `conflict_check.adr_corpus` unset → `change_set` — the two ADRs amended by this
spec: adr-2026-08-13-a-publication-transition-advances-only-when-it-moves-the-dimension-it-owns,
adr-2026-08-01-engine-owned-resumable-finish-publication.

**Result: PASSED — zero blocking, zero degrading conflicts.**

## Pairs examined (both directions)

- **Story 3 vs Story 4 (the near-oscillation, examined explicitly):** Story 4 requires
  author→judge laps to repeat until the allowance is exhausted; Story 3 requires a byte-identical
  authoring result to halt immediately via the advance-path dimension guard. Satisfying 4 does not
  break 3: laps continue only when each authoring pass produces a *new* revision digest; an
  identical digest is not a lap, it is a non-advancing transition, and it halts. Satisfying 3 does
  not break 4: the dimension guard only fires on an unmoved `pr.prose`; a moved revision proceeds
  to judgment and charges the allowance. Two "yes" answers — not an oscillation.
- **Story 2's guard-preservation negative vs Story 2's retry-proceeds happy path:** compatible by
  construction — the retry proceeds exactly when the fresh observation selects the retry's
  transition, and the guard still halts when it does not. Same predicate, two outcomes on two
  different observations.
- **Story 1 precedence rules vs Story 2 halt routing:** aligned — both assert halt-signal
  classification precedes any prose-lap routing.
- **Story 1 store-degradation negative vs Story 3 re-judgment happy path:** aligned — an absent
  verdict yields `stale`, which is precisely the state Story 3 requires after a successful rewrite.
- **Story 4 detail-in-halt vs Story 5 detail-optional decoding:** compatible — detail is rendered
  when carried, requested by the contract, never required by the decoder.
- Remaining story pairs share no behavior, entity, field, or gate; verified no interaction to
  reason through.
- **Existing corpus:** no existing story file governs FINISH prose classification or the
  publication selector; nearest neighbors (finish-step engine completion, halt-PR rehabilitation,
  mergeability-first finish) address different dimensions and assert nothing about prose routing.

## ADR-versus-story

- **adr-2026-08-13 (as amended 2026-08-28):** Story 2's "retry proceeds" is the amended ADR's own
  stated consequence (the retry-path rule stops firing by construction because the fresh
  observation selects `author_pr_prose`); Story 3's identical-revision halt is the ADR's
  advance-path rule applied to `author_pr_prose`'s owned dimension. No opposing sentences exist.
- **adr-2026-08-01 (as amended 2026-08-28):** D1's observation-derived routing holds in every
  story — the judge's detail travels as authoring guidance read from the persisted store at
  dispatch time; no story routes on a disposition's named transition.

No blocking conflicts, no degrading conflicts, no resolutions, no superseding ADRs.
