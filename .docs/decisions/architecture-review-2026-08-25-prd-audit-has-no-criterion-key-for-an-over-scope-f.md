# Architecture Review: PRD-audit no-owner OVER_SCOPE findings
**Date:** 2026-08-25
**Stories reviewed:** none yet (pre-stories review; input = explore output + technical intent, issue #1848)
**Verdict:** APPROVED WITH CONDITIONS

Lightweight (Tier M) pass: feasibility + alignment. Repo-wide ADR sweep performed over all
288 `.docs/decisions/adr-*.md` (281 APPROVED, 6 SUPERSEDED, 0 draft).

## Feasibility

- Stack: pure TypeScript engine change in existing modules — `parsePrdAuditReport` and the
  prd_audit gate route (`src/conductor/src/engine/artifacts.ts`), `accepted-widenings.ts`,
  halt-body rendering — plus prd-audit SKILL.md and fixtures. No new dependencies,
  services, schema migrations, or infra. Verified against current source (95%, verified).
- Prerequisites: #1846's decision-block machinery is merged (#1873, `d0b6fb559`) and in this
  baseline — the feature extends it, no wait. Overlap scan run over the four wiring-surface
  files: only broad `artifacts.ts` co-touch noise; no unmerged branch owns this seam.
- Parse-result shape change: `parsePrdAuditReport` gains rejected-row diagnostics alongside
  findings. Callers (gate route, preserve-path recheck, `prdAuditCoverageGap`) must treat
  a non-empty rejection set as blocking — bounded, enumerable call sites in one file.
- Worktree isolation: all state is per-worktree `.pipeline/`; no shared resources.

## Alignment

- Extends the #1846/#1873 decision-block path rather than adding a channel; decision events
  ride the existing spine per adr-2026-08-24 D8 (event-spine principle respected — no new
  files, one schema widened).
- Two APPROVED ADRs amended additively in this pass (notes in place):
  `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` (key space + NC summary
  binding) and `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` (D3:
  no-owner findings legitimate, still never work).
- Recorded departures (operator-authorized 2026-08-25, bounded in the amendment notes): report-scoped
  ordinal + summary-bound identity departs from the build_review content-anchored reference
  family (adr-2026-08-18, adr-2026-08-16) — scope-limited to prd-audit no-owner findings;
  per-row duplicate rejection departs from adr-2026-08-13 §1's whole-result failure.
- Fail-closed posture preserved: rejected rows still block and are named (adr-2026-07-22
  waiver precedent; adr-2026-08-24 evidentiary-defects-are-not-waivable); mismatched
  decisions re-ask rather than apply (adr-2026-07-11 attribution-abstain-or-loud); machine
  clears still cannot mint decisions (adr-2026-08-24 D3 unchanged).
- Halt bodies keep flowing through `writeHaltMarker` with a class (adr-2026-07-28); the
  committed halt record (adr-2026-08-23) carries the rejection diagnostics verbatim for free.

## Wiring Surface

- Widened `parsePrdAuditReport` result (findings + rejected rows, NC section): consumed by
  the prd_audit gate route and preserve-path recheck in `artifacts.ts` (existing callers,
  same file) — invoked from the SHIP validation group dispatch.
- `NC.*`-aware `classifyOverScopeCriterion` / `overScopeRelations` / summary-bound decision
  matching in `accepted-widenings.ts`: called from the two conductor halt sites and
  `routePrdAuditOverScope` (existing #1873 call path).
- Rejected-row diagnostics rendering: composed into the halt body at the existing
  `renderOverScopeDecisionBlock` / halt-site seam.
- Decision-recorded spine event: existing `ConductorEvent` from #1873; any new event kind is
  declared in `EVENT_SINKS` (adr-2026-07-26).
- prd-audit SKILL.md: the `## Findings without an owning criterion` section it already
  teaches gains the `NC.<n>` key contract; the "engine cannot route (#1848)" caveat is
  removed in the same diff.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Re-audit renumbers/rewords NC findings → repeated operator re-asks | Technical | Medium | Low | Accepted by design (never-wrong bias); skill instructs stable ordering and verbatim summary reuse |
| A caller of parsePrdAuditReport ignores rejected rows → salvage becomes a silent pass | Technical | Low | High | Rejected-rows-block invariant is a named negative-path story; fixture asserts gate blocks |
| Legacy reports (no NC section) mis-parse | Integration | Low | Medium | NC section absent → identical behavior to today; fixture covers legacy shape |

## ADRs Created

None. The governing ADRs already exist; the decision is carried as operator-approved
amendment notes on `adr-2026-08-24-over-scope-decision-block-and-durable-refusals` (D4:
`NC.<n>` key form, key+summary decision binding, recorded departure from the build_review
identity family) and `adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback` (D3:
no-owner findings legitimate; per-row rejection with named diagnostics, rejected rows still
block). A separate ADR was drafted and deliberately withdrawn (2026-08-25) — no new
structural decision beyond what the amended ADRs govern.

## Conditions

1. Rejected rows must remain blocking in every parse-result consumer (High-impact risk above);
   stories must carry the negative path explicitly.
2. The skill edit and the parser change land in the same diff (shape parity), with fixtures
   covering: a no-owner finding parsing and routing; a duplicate key rejecting per-row; a
   salvaged report with named rejected rows still blocking; a legacy report without the
   section behaving as today.
