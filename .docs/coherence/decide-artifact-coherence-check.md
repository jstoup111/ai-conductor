# Coherence Mapping: DECIDE artifact coherence check

**Date:** 2026-07-22 · Tier M · product track · intake jstoup111/ai-conductor#539
**Stories:** `.docs/stories/decide-artifact-coherence-check.md` · **Plan:** `.docs/plans/decide-artifact-coherence-check.md`

> Authored as the worked example of the artifact this spec introduces (the validating
> gate ships with this feature; this file is the format reference and the spec's own
> traceability record).

## Outcome → Story

| # | Intake Desired-outcome bullet (condensed) | Stories | Verdict |
|---|---|---|---|
| outcome-1 | Coherence check before land verifies outcome→story→task chain, auditable artifact | 2, 3, 4, 5 | covered |
| outcome-2 | Unmapped outcome / orphan task / uncovered story cannot land without operator waiver | 6, 9 | covered |
| outcome-3 | Catches adjacent-drift, duplicate-spec, coverage-table contradiction shapes | 3, 8, 7 | covered |
| outcome-4 | Negative paths: technical track no phantom PRD; trivial specs zero ceremony | 11, 12, 13 | covered (S exemption strengthened by operator ruling) |

## FR → Story

| FR | Stories | Verdict |
|---|---|---|
| FR-1 | 2 | covered |
| FR-2 | 3 | covered |
| FR-3 | 4 | covered |
| FR-4 | 5 | covered |
| FR-5 | 6 | covered |
| FR-6 | 7 | covered |
| FR-7 | 8 | covered |
| FR-8 | 9 | covered |
| FR-9 | 10 | covered |
| FR-10 | 11 | covered |
| FR-11 | 12 | covered |
| FR-12 | 13 | covered |
| FR-13 | 1 | covered |
| FR-14 | 14 | covered |

## Story → Task

| Story | Tasks | Verdict |
|---|---|---|
| 1 | 1, 2, 3, 4 | covered |
| 2 | 5, 6, 16, 17, 20 | covered |
| 3 | 7 | covered |
| 4 | 8 | covered |
| 5 | 9 | covered |
| 6 | 10 | covered |
| 7 | 11 | covered |
| 8 | 14 | covered |
| 9 | 13 | covered |
| 10 | 12 | covered |
| 11 | 15 | covered |
| 12 | 15 | covered |
| 13 | 15, 16, 18, 19 | covered |
| 14 | 5, 15, 16 | covered |

## Task → Purpose

| Task | Serves | Verdict |
|---|---|---|
| 1–16 | Story-cited (see plan `**Story:**` lines) | covered |
| 17–20 | infrastructure (skill/registration/order/docs per Stories 2, 13 + repo gates) | covered (declared purpose) |

**Result:** 0 unmapped outcomes · 0 uncovered FRs · 0 uncovered stories · 0 orphan tasks · 0 table contradictions.
