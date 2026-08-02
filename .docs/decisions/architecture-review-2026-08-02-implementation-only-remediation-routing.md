# Architecture Review: Implementation-only remediation routing

**Date:** 2026-08-02
**Stories reviewed:** technical intent for issue #1250 (stories not yet authored)
**Verdict:** APPROVED

## Feasibility

The existing remediation planner already judges each gap and emits a closed disposition. The correction is feasible within the current skill/agent contract: sharpen `architecture_review` to mean that approved architecture must change or be clarified, and classify implementation, test, or documentation drift that preserves approved architecture as `build`.

No schema, migration, external service, persistent state, or new dependency is required. The engine's existing phase-derived guard remains authoritative for genuine DECIDE targets.

## Alignment

The design preserves the approved daemon safety boundary established by `adr-2026-07-27-daemon-decide-kickback-halt`: autonomous daemon execution still cannot enter DECIDE. It corrects the upstream judgment so implementation-only work does not falsely select a protected DECIDE target.

The design also follows the repository principle of deterministic enforcement where possible without pretending semantic classification is mechanical. The engine continues to enforce the selected target's phase deterministically; the remediation planner retains responsibility for judging which authority the evidence requires.

## Wiring Surface

- `skills/remediate/SKILL.md` supplies the closed classification rule when the configured `remediate` step is invoked after a blocking SHIP gate.
- `agents/remediation-planner.md` applies the same rule when dispatched by the remediation skill.
- `.pipeline/remediation.json` retains its current schema and is consumed by `readRemediationPlan` in `src/conductor/src/engine/artifacts.ts`.
- `Conductor.planRemediation` in `src/conductor/src/engine/conductor.ts` continues deriving the earliest target and passing genuine DECIDE targets through `decideKickbackDisposition`.
- Contract and regression tests exercise the reported conforming-ADR/implementation-drift case and preserve genuine architecture-decision halts.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---:|---:|---|
| Planner confuses audit origin with required remediation authority again | Technical | Medium | Medium | Closed positive and negative rules plus a regression fixture using the #1250 contradiction |
| Rule over-corrects and sends genuine architecture uncertainty to BUILD | Technical | Low | High | Preserve explicit `architecture_review` and `halt: architectural-clarity` cases with negative-path tests |
| Skill and planner-agent instructions drift | Technical | Low | Medium | Update both contract surfaces together and validate them in repository integrity tests |

## ADRs Created

None. This refines an existing remediation classification contract and preserves the approved daemon DECIDE boundary; it introduces no new architectural category or runtime boundary.

## Verify-Claims Ledger

### Claims

- [verified] `skills/remediate/SKILL.md` currently defines clear, fixable ADR drift as `architecture_review`.
- [verified] `Conductor.planRemediation` routes non-halt dispositions by their target and the daemon guard halts targets whose configured phase is DECIDE.
- [verified] the existing phase guard is provider-agnostic and derived from step definitions rather than a hard-coded target list.

### Assumptions

- [load-bearing, approved by operator 2026-08-02] Preserve the existing disposition schema and correct the closed judgment rule.
- [load-bearing, approved by operator 2026-08-02] Implementation drift that preserves approved architecture requires BUILD authority, regardless of which audit reported it.

Verdict: CLEAR

## Verdict

**APPROVED.** The design is feasible, preserves the daemon's operator-only DECIDE safety boundary, and corrects the classification at the judgment seam without adding a redundant authority field.

## Plan Alignment Review

The five-task plan conforms to this review: it changes only the existing skill and planner-agent judgment surfaces, uses bounded deterministic tests at `planRemediation`, and leaves the remediation schema and phase-derived daemon guard intact. The final issue-aware overlap scan reported no open blockers or overlapping branches for the planned file set.
