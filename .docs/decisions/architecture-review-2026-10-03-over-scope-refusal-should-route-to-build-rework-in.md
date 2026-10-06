# Architecture Review: Over-scope refusal routes to BUILD rework
**Date:** 2026-10-03
**Mode:** Lightweight (Tier M): Technical Feasibility + Architectural Alignment
**Input:** explore decision (Approach B), `.docs/track/over-scope-refusal-should-route-to-build-rework-in.md`, intake jstoup111/ai-conductor#2931
**Stories reviewed:** none yet (pre-stories review)
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

| Check | Assessment |
|---|---|
| Stack compatibility | No new dependencies. TypeScript engine change only. |
| Prerequisites | None. Decision and case stores, `planRemediation`, the append seam and the kickback ledger all exist (verified in `conductor.ts`, `remediation-append.ts`, `kickback-ledger.ts`). |
| Integration surface | `routePrdAuditOverScopeV2` and `routeCurrentPrdAuditOverScope` (route), `CurrentPrdAuditRoute` (shared result), the serial SHIP site and the validation-group join site (both currently write the over-scope HALT), the `planRemediation` evidence input, and the `/remediate` skill evidence contract. One module boundary (engine ↔ remediate skill). |
| Data implications | No schema change. The decision/case stores are read only. Remediation tasks use the existing plan append and ledger records. |
| Performance risk | One extra planner dispatch per refusal lap, bounded by `prd_audit.max_remediation_laps` (default 1). |
| Worktree isolation | All state is per-worktree `.pipeline/`, as before. |

Verified facts (verified, ~95%):
- `routePrdAuditOverScopeV2` projects refusals as `blocking-refused` into the same `kind: 'halt'` as undecided findings.
- `routeCurrentPrdAudit` returns `over-scope-halt`, which both SHIP shapes turn into `writeHaltMarker`.
- The existing daemon `prd_audit` remediation path calls `planRemediation(..., { source: 'prd-audit', evidence })`, gated by `remediationRounds < prdAuditRemediationLapCap`, and emits a `kickback` event.
- `buildRemediationDoneWhenChecks` already accepts a `governingClause`, so a refusal-bound task can be rendered without changing the append grammar.

## Alignment

- **Approved decisions:** the change directly reverses an approved clause stated four times (adr-2026-08-24 D6 and its #2429 amendment; adr-2026-08-22 D4 #2429 note; adr-2026-09-07 D8). That is a structural change to the durable-refusal state transition, so a new ADR is required. It is created and APPROVED by the operator, and the three older ADRs carry additive amendment notes.
- **One owner per question:** preserved. The operator owns the scope decision (refuse). The engine owns identity, admission and bounds. The `/remediate` planner owns only "how to remove", and its output is bound to the refusal decision id.
- **Single appender (adr-2026-08-22 D5):** preserved. No new `rem-` writer.
- **Event spine:** preserved. The lap reuses the existing `kickback` event; no new channel.
- **Identity (adr-2026-08-22 D3 #2521, adr-2026-09-07 D8):** remediation task ids derive from the durable decision/case id, never the report-local NC ordinal.
- **Anti-laundering (adr-2026-08-24 D3):** untouched. Only an explicit recorded `refuse` admits rework; pending stays inert.
- **Diagram:** `.docs/architecture/over-scope-refusal-should-route-to-build-rework-in.md` (operator-approved) matches this design. No component/container change.

**Local pattern basis.** Role: SHIP gate → BUILD remediation admission. Traits to keep: the route result is computed once and shared by both SHIP shapes; dispatch goes through `planRemediation` with typed evidence; laps are charged through the `gates.prd_audit` ledger at BUILD dispatch (#2753); exhaustion halts with a named class. Why it applies: refusal rework is the same "gate finding → bounded BUILD repair" question as FIXABLE repair. Allowed variation: a new evidence kind and the removal-only output constraint. Rediscovery hints: `routeCurrentPrdAudit`, `CurrentPrdAuditRoute`, `planRemediation`, `prdAuditRemediationLapCap`, `appendCriterionBoundRemediationTasks`, `checkKickbackToBuildEscalation('prd_audit')`.

## Wiring Surface

| New / changed surface | Production caller (design-time) |
|---|---|
| Refusal-remediation variant of `PrdAuditOverScopeRoute` / `CurrentPrdAuditRoute` | Returned by `routeCurrentPrdAudit`, consumed by the existing serial SHIP prd_audit branch and the validation-group join branch in `Conductor` |
| Refusal evidence entries on the `planRemediation` evidence input | Built by the conductor's prd_audit route handling and dispatched through the existing `planRemediation` call |
| Refusal-bound `rem-prd-audit-*` task rendering (decision id as governing clause) | The existing append seam that `planRemediation`'s route outcome already invokes |
| `/remediate` skill: refusal evidence kind + removal-only rule | Read by the `/remediate` dispatch that `planRemediation` already launches |

Early overlap scan (advisory, 2026-10-03): `conductor.ts` overlaps open branches `spec/daemon-self-host-guardrails` and `spec/self-host-phase6-wiring`. `remediation-append.ts` and `skills/remediate/SKILL.md` have no overlap. Non-blocking.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Planner returns new-capability tasks for a refusal | Technical | Medium | Medium | Removal-only contract plus decision-id binding; the next prd_audit re-flags any residual behavior; lap cap bounds it |
| Serial and group-join shapes diverge | Technical | Low | Medium | Single route variant on `CurrentPrdAuditRoute`; stories cover both shapes |
| Shared lap exhausted by FIXABLE before refusal rework | Technical | Medium | Low | Accepted by operator (ADR D4); existing `kickback-budget raise` lever |
| Interactive runs still halt on refusal | Knowledge | High | Low | Explicit in ADR D6; documented in the runbook |

## ADRs Created

- `adr-2026-10-03-over-scope-refusal-routes-to-bounded-build-rework` (**APPROVED** by operator 2026-10-03)
- Additive amendments: adr-2026-08-24 D6, adr-2026-08-22 D4, adr-2026-09-07 D8.

## Conditions

1. Pending, or any projection defect, keeps the existing over-scope HALT unchanged (ADR D1).
2. Refusal tasks bind the durable decision id, never the NC ordinal (ADR D2/D4).
3. No new store, ledger, config key, appender or event type (ADR D4).
4. Both SHIP shapes consume one shared route result (ADR D6).
5. Lap exhaustion, or a refusal still flagged after its lap, re-halts with the existing refused block (ADR D5).
