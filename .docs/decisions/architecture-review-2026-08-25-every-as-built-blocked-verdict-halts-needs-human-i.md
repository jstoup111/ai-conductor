# Architecture Review: every-as-built-blocked-verdict-halts-needs-human-i
**Date:** 2026-08-25
**Stories reviewed:** none yet (pre-stories DECIDE review; input = issue #1874 + explore output)
**Verdict:** APPROVED WITH CONDITIONS

Scope boundary (binding, from `.docs/track/`): full convergence as filed — per-finding
classification plus bounded autonomous remediation through the single-appender seam; not the
classify-and-surface-only variant.

## Feasibility

All claims below verified this session against the worktree's source (confidence ~95%,
basis: direct reads by scoped exploration).

- The `blocked` completion arm already emits `routeClass: 'named-route'`
  (`src/conductor/src/engine/artifacts.ts`, blocked arm of the as-built completion predicate),
  so `classifyRetryDecision` already treats as-built as routable; today the route dead-ends at
  two halt writers (serial SHIP walk and validation-group join in
  `src/conductor/src/engine/conductor.ts`). Branching those two writers is the whole routing
  change.
- The growth ledger is already gate-keyed (`growth.byGate`,
  `src/conductor/src/engine/kickback-ledger.ts`) — an `architecture_review_as_built` key is
  additive, no schema change. `remediationLapCapForGate` already has a per-gate branch point.
- `requiresPlanGrowthAllowance` currently rejects the `architecture-review-as-built` hint
  source by name — the admission change is localized to that guard plus the gap-admission loop.
- The retired capture/check no-op escalation pair (`captureKickbackToBuildContext` /
  `checkKickbackToBuildEscalation`) survives with five live call sites; re-arming it for
  as-built follows the prd_audit call-site pattern.
- The parser precedent exists: `parsePrdAuditReport` (section-scoped table, closed grade set,
  binding requirement, mechanical-fault on malformed rows). The new `## Blocking Findings`
  parser mirrors it.
- The verdict-freshness, run-identity stamping (adr-2026-08-25-engine-stamped-ship-tail…), and
  refused-step machinery are unaffected: the report stays at
  `.pipeline/architecture-review-as-built.md` with the same `Verdict:` line; the table is
  additive.

## Complexity

High (tier L): one new parser + widened outcome union, two halt-writer branches, admission +
caps + ledger key in `planRemediation`, escalation re-arm, config keys + kill switch, skill
contract, docs, and two ADR amendments. No new step, no new artifact path, no new halt class,
no new event channel (recorded-findings projection reuses the existing renderer; any new event
member must declare its sink row per adr-2026-08-21 D6).

## Alignment

- **Supersedes deliberately:** adr-2026-08-22-as-built-review-runs-always-with-plan-gap
  decision 3 (amendment note added beside the original assertion) — the issue carries this ADR
  cost knowingly.
- **Amends:** adr-2026-08-22-one-owner-per-review-question's appender clause (note added);
  the one-appender principle is preserved in substance — no second appender exists.
- **Respects unchanged:** adr-2026-08-22-prd-audit-stories-authority D5/D6 (shared growth
  allowance, per-gate lap accounting), adr-2026-07-26-cross-dispatch-kickback-livelock-bound
  (tree-keyed bound; cap halts remain non-auto-cleared classes),
  adr-2026-07-28-total-halt-classification D1 (no new halt class; `kickback-cap` reused),
  adr-2026-08-23-committed-halt-record (all halts via `writeHaltMarker`),
  adr-2026-08-24-refused-step-status D4, adr-2026-08-12-execution-lifecycle-completeness D1
  (every new exit emits its terminal), adr-2026-08-07/-13 retry-classify (pure classifier; the
  LLM judgement lives in the report, the parser stays mechanical),
  adr-2026-07-10-validation-group-join (single consolidated `planRemediation` dispatch; the
  group path already builds multi-source hint evidence and discards the route — it now uses it).
- **Design principle:** classification is a judgement call → LLM verdict constrained by a
  closed schema; bookkeeping (parsing, caps, dedup-by-lap, halts) mechanical and fail-closed.
  This is the softened-machinery shape, not a rubric re-litigation loop: one lap, then human.

## Domain Integrity

- Closed unions throughout: finding class `REMEDIABLE | DESIGN`; outcome widens to
  `blocked-remediable | blocked-design`; no boolean flags, no catch-all defaults (unknown
  class ⇒ invalid ⇒ human).
- Invalid states unrepresentable at the gate: a REMEDIABLE row without a governing clause is
  malformed, never a permissive default.

## Wiring Surface

| New surface | Production wiring (design-time commitment) |
|---|---|
| `## Blocking Findings` table contract | authored by `skills/architecture-review/SKILL.md` §12; consumed by the new parser in `src/conductor/src/engine/artifacts.ts` |
| `parseAsBuiltBlockedFindings` + widened `AsBuiltReviewOutcome` | called from `classifyAsBuiltReviewOutcome` consumers: the as-built completion predicate and both halt writers in `conductor.ts` |
| Halt-writer branches (serial + group) | existing serial SHIP walk and validation-group join sites in `conductor.ts` |
| As-built gap admission | `planRemediation` gap-admission loop + `requiresPlanGrowthAllowance` in `conductor.ts`; tasks appended via `remediation-append.ts` with a governing-clause line |
| `gates.architecture_review_as_built` laps + `growth.byGate` key | read/written by `planRemediation` cap block; surfaced by `conduct-ts` daemon status (existing PLAN GROWTH rendering) |
| Config: lap cap + `remediation.enabled` kill switch | validated in `src/conductor/src/engine/config.ts`; documented in `docs/reference/configuration.md` |
| Escalation re-arm for as-built | `captureKickbackToBuildContext` / `checkKickbackToBuildEscalation` call sites beside the new route |
| Per-finding projection | existing recorded-findings renderer → verdict artifact + shipped record (`shipment-association.ts` reader) |

Early overlap scan run (advisory): `conductor.ts`/`artifacts.ts` overlap ~19 unmerged spec
branches — expected for these hub files; no same-seam collision identified with in-flight work.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| LLM misclassifies DESIGN as REMEDIABLE; lap burned before human | Technical | Medium | Medium | lap cap 1; halt lists findings + classes; kill switch reverts to halt-always |
| Remediation lap loops (fix doesn't clear the finding) | Technical | Medium | High | second lap = halt; no-op escalation re-armed; tree-keyed livelock bound unchanged |
| Malformed table silently passes | Data | Low | High | fail-closed parser: any defect ⇒ invalid ⇒ needs-human |
| Shared growth allowance starved between prd_audit and as-built | Integration | Low | Medium | byGate breakdown visible in status; caps operator-configurable |
| New exits miss lifecycle terminals (poisons timing rollup) | Data | Medium | High | condition 4 below; adr-2026-08-12 D1 pinned by negative-path stories |

## ADRs Created

- `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` — APPROVED (operator, this
  session). Amendment notes added to `adr-2026-08-22-as-built-review-runs-always-with-plan-gap`
  (decision 3) and `adr-2026-08-22-one-owner-per-review-question` (appender clause).

## Conditions

1. Every REMEDIABLE-classified appended task carries its governing approved clause (ADR stem +
   decision, or plan task id) the way prd_audit tasks carry `Criterion:`; a task without one is
   never appended.
2. The parser is fail-closed: missing table on BLOCKED, unknown class, or clause-less
   REMEDIABLE row ⇒ whole report invalid ⇒ needs-human halt naming the defect. Negative-path
   stories must pin each of these.
3. Cap/exhaustion halts use existing classes (`kickback-cap`; design/invalid use `needs-human`)
   and list every finding with class + clause; no new halt class.
4. Every new exit (route, cap halt, design halt, invalid halt) emits its lifecycle terminal
   and, where a validation-group commit is involved, its refusal stamp — pinned by stories.
5. The kill switch reverts exactly to current halt-always behavior; a test proves the revert.
6. Laps ride `gates.architecture_review_as_built`; a test proves build_review's cumulative
   counter and prd_audit's lap counter are untouched by an as-built lap.
