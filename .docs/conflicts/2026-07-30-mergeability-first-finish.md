# Conflict Check: Mergeability-first daemon finish

**Date:** 2026-07-30
**Verdict:** CLEAN
**Inventory:** 270 story files, 43 product specs, 143 prior conflict reports, and authoritative
rebase/re-kick ADRs.

## Conflict 1: Ancestry freshness versus mergeability-first finish

**Stories involved:** `mergeability-first-finish` vs `phase-9.0-rebase-on-latest` and
`ship-tail-parallel-validation-serial-publication-922`
**Type:** contradiction
**Severity:** blocking

### Description

The older requirements required the feature branch to be rebased/current before finish. The new
approved requirements allow a behind feature to finish without history rewriting when a prospective
merge is clean. Both predicates cannot simultaneously govern normal finish.

**Grounded confidence:** 100% — both requirements stated their finish predicate directly.

### Resolution Options

1. Targetedly supersede only the older ancestry-freshness language while retaining ordering, base
   resolution, actual-rebase invalidation, conflict recovery, validation fence, and HALT behavior.
2. Supersede the entire Phase 9.0 contract.
3. Retain contradictory authorities.

**Resolved:** Option 1, operator-approved 2026-07-30. The new PRD declares the targeted
supersession; the older PRD and accepted stories now reflect the revised normal-finish predicate.

## Conflict 2: Mergeable skip versus re-kick play-forward

**Stories involved:** `mergeability-first-finish` FR-6 vs `daemon-halt-reconciliation` FR-12
**Type:** behavioral overlap / sequencing
**Severity:** blocking

### Description

Re-kick runs after base advancement specifically so a newly merged commit can enter the feature
before a previously halted gate retries. A shared mergeable-skip policy could leave feature content
unchanged, omit the potentially unblocking commit, and repeat the same HALT.

**Grounded confidence:** 100% — the approved re-kick requirement explicitly requires the pending
gate to run against the advanced base’s content.

### Resolution Options

1. Limit mergeability skipping to normal finish; preserve mandatory re-kick play-forward rebase.
2. Retain one shared mergeability policy and accept stale-content gate retry.
3. Add gate-specific base-impact analysis before re-kick.

**Resolved:** Option 1, operator-approved 2026-07-30. The PRD, stories, and architecture diagram
now distinguish finish readiness from re-kick recovery. The operator approved
`adr-2026-07-30-finish-only-mergeability-gate`; the earlier shared-policy ADR is SUPERSEDED.

## Compatibility Re-check

- Actual rebase conflict-resolution stories remain compatible: conflict and indeterminate finish
  results still enter the existing resolver; re-kick continues to do so unconditionally.
- Post-rebase invalidation and gate-first re-verification remain compatible because they apply only
  when an actual rebase changes history/code.
- Evidence translation and protected-seal rebaseline stories remain compatible because a
  mergeable skip does not move history; actual rebase retains their behavior.
- Force-with-lease stories remain compatible because they apply only after a sanctioned history
  rewrite.
- Active/paused rebase recovery remains compatible and outranks finish mergeability assessment.
- No resource contention, state conflict, or circular sequencing conflict remains.

## Verify-Claims Ledger

### Claims

- [verified] Both conflicts were grounded in explicit accepted requirements.
- [verified] Targeted supersession removed the normal-finish contradiction.
- [verified] Finish-only scope preserves re-kick’s advanced-base-content invariant.

### Assumptions

- No unconfirmed load-bearing assumptions remain; the operator selected and approved both
  resolutions and the replacement ADR.

### Verdict

CLEAR
