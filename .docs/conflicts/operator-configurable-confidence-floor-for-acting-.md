# Conflict Report: Operator-configurable confidence floor for acting on build_review findings

**Date:** 2026-09-06
**Spec:** jstoup111/ai-conductor#2383 (revised placement)
**Stories scanned:** `.docs/stories/operator-configurable-confidence-floor-for-acting-.md` (Stories 1-8)
**ADR corpus:** `repo_wide` (`.ai-conductor/config.yml:127`)
**Result:** PASSED CLEAN — 0 blocking conflicts, 0 degrading conflicts.

> **Amended 2026-09-06 by #2383:** The first pass of this report, against the adjudicator-placed
> design, found and resolved two blocking conflicts (a `cumulative`-unchanged assertion against the
> convergence ADR's reset-on-PASS rule, and an unconditional demotion against the inert-floor story).
> The operator then moved confidence to the rubric finding and the stories were rewritten. Neither
> earlier conflict exists in the rewritten stories: no story asserts anything about `cumulative`,
> and there is no tracker-dependent branch. This report reflects the current stories.

## ADR corpus accounting

All 309 approved ADRs in `.docs/decisions/` were examined. None was excluded on supersession
grounds: `adr-2026-08-29-build-review-remediate-case-adjudication` is only partially superseded and
was retained.

**Narrowed in — subject overlaps these stories (9):**

| ADR filename stem | Overlapping subject |
|---|---|
| adr-2026-08-29-mixed-build-review-laps-preserve-content-adjudication | lap classification, dispatch, case store, routing |
| adr-2026-08-29-build-review-remediate-case-adjudication | case schema, source-complete validator, deferral effect, kickback rule |
| adr-2026-08-13-stable-build-review-finding-dispositions | finding identity, operator accepted-risk store, effective reducer |
| adr-2026-08-16-closed-build-review-finding-vocabularies | finding contract fields |
| adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal | new config key obligations |
| adr-2026-08-12-cumulative-build-review-convergence-bound | kickback accounting on PASS |
| adr-2026-07-26-event-sink-registry-exhaustiveness | event members |
| adr-2026-08-11-halt-events-ride-the-persisted-spine | additive event field pattern |
| adr-2026-07-04-kickback-event-emission-and-log-prominence | kickback event rendering |

**Narrowed out (300):** no subject overlap with rubric findings, the effective verdict, adjudication
dispatch, config keys, or the event spine.

## ADR-versus-story pairs examined

| ADR | Story | Both directions hold | Grounding |
|---|---|---|---|
| adr-2026-08-13 decision 1 ("separate semantic identity from presentation evidence") | Story 2 | Yes | Story 2 keeps confidence out of the identity payload; the ADR's separation is honored, not changed |
| adr-2026-08-13 decision 2 (accepted risk in a feature-scoped operator store) | Story 3, Story 5 | Yes | Story 3 asserts the disposition store is byte-identical after a suppressed lap; Story 5 asserts suppression entries never appear there |
| adr-2026-08-16 (closed identity vocabularies) | Story 1 | Yes | Confidence is neither a vocabulary member nor an identity field; an engine-range-checked integer is an engine-verifiable value |
| Predecessor D4 (source-complete validator rejects a missing current-finding outcome) | Story 5 | Yes | Story 5 places suppression entries in a section distinct from current sources, so no outcome is demanded — the validator's rule is untouched |
| Predecessor D7 ("reuses that outcome after the current adjudication confirms the binding") | Story 6 | Yes, by amendment | D5.1 narrows the confirmation requirement to drifted ids only; Story 6 asserts a drifted id still dispatches. The ADR was amended in this pass; the story implements the amended text |
| adr-2026-08-12 D2 (PASS resets `cumulative`) | Story 3, Story 7 | Yes | No story asserts `cumulative` is unchanged; Story 7 asserts only that a *skipped dispatch* leaves the ledger unchanged, which involves no PASS-time reset because the reset fires on the gate verdict, not inside the coordinator |
| adr-2026-07-26 / adr-2026-07-07 (event registry exhaustiveness, audit completeness) | Story 4, Story 7 | Yes | No new event member: Story 4 adds a field to `build_review_outer_verdict`, Story 7 reuses `remediation_adjudication_completed` |
| adr-2026-07-04 (kickback event reserved for backward moves) | Story 4 | Yes | Story 4 asserts no kickback event is attributable to a suppression |

## Story-versus-story pairs examined

All 28 pairs tested in both directions. Pairs sharing a behavior, entity, field, or gate:

| Pair | Shared surface | Both directions hold |
|---|---|---|
| 1 vs 2 | the confidence field | Yes — Story 1 validates the value, Story 2 keeps it out of identity; neither constrains the other |
| 1 vs 3 | absent confidence | Yes — Story 1 accepts an absent field, Story 3 leaves it unresolved; the two describe parse and verdict of the same input consistently |
| 3 vs 4 | the suppressed set | Yes — Story 3 produces it, Story 4 reports it |
| 3 vs 5 | suppressed findings and the judge | Yes — Story 3 excludes them from current sources, Story 5 carries them as history; the two sections are disjoint by construction |
| 3 vs 6 | what reaches the coordinator | Yes — suppression removes findings before the coordinator, settlement removes them inside it; a finding cannot be in both sets on one lap |
| 5 vs 6 | the case store across laps | Yes — Story 5 writes suppression entries, Story 6's predicate is read-only; Story 6 asserts no prune, which Story 5 requires |
| 6 vs 7 | the skipped dispatch | Yes — Story 6 decides the skip, Story 7 records it |
| 3 vs 8 | the floor value | Yes — Story 8 validates and resolves it, Story 3 consumes the resolved value |

**Sequencing:** the only ordering constraint — suppression precedes lap classification, settlement
precedes dispatch — is asserted consistently by Stories 3 and 6 and is the same order the amended ADR
records.

**Resource contention:** none. One config key and one additive event field, neither reusing an
existing field for a second meaning; the store gains a new list rather than overloading `sources`.

**Oscillation:** none found. The closest candidate — Story 3 excluding suppressed findings from
sources while Story 5 requires the judge to see them — resolves because the context carries two
distinct sections; satisfying either fully leaves the other intact.

## Re-check

Zero blocking conflicts, zero degrading conflicts. No review marker written.
