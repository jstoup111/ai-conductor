# ADR: Over-scope refusal routes to bounded BUILD rework

**Date:** 2026-10-03
**Status:** APPROVED
**Deciders:** operator (James Stoup), composer session for #2931

## Context

adr-2026-08-24-over-scope-decision-block-and-durable-refusals D6 made an operator `refuse` on an
outside-visible `OVER_SCOPE` finding a durable blocker that "never routes to DECIDE, never appends
plan tasks, and never becomes off-plan work". #2429 confirmed this: a refused finding "remains
blocking and creates no repair task" (adr-2026-08-24 D6 amendment; adr-2026-08-22 D4 amendment:
"No NC case becomes a BUILD task"; adr-2026-09-07 D8: "cannot be silently converted into a repair
task by this slice").

In practice nothing ever removes refused behavior. On 2026-10-03 `engine-prompts` and
`build-step-completes` were both refused and cleared. About 9 minutes later `prd_audit` re-ran on
the unchanged code and re-halted with "Refused — rework required" (verified, intake #2931). The
refusal machinery in `routePrdAuditOverScopeV2` (`src/conductor/src/engine/conductor.ts`) projects
a refused finding as `blocking-refused` into the shared `over-scope-halt`, and the serial SHIP
site and the validation-group join site both write that HALT. A refusal can only end in another
halt, hand surgery, or the operator accepting behavior they rejected.

The original prohibition protected one thing: a finding with no owning criterion must never grow
the plan with autonomous, off-plan work (adr-2026-08-22 one-owner-per-review-question; an
operator-only scope decision must not become autonomous act — adr-2026-09-07 Options §3). Removing
or reworking behavior the operator refused does not grow scope; it brings the shipped code back
within the plan's intent. The operator, not the engine, has already made the scope decision.

The engine already owns a bounded route from `prd_audit` to BUILD. `planRemediation` dispatches
the `/remediate` planner, appends `rem-prd-audit-*` plan tasks through the single append seam
(`remediation-append.ts`), and charges the `gates.prd_audit` kickback ledger under
`prd_audit.max_remediation_laps` (default 1) with the 5-task / 25% growth caps
(adr-2026-08-22 D5, as amended by #2119 and #2753).

## Options Considered

### Option A: Engine-templated removal task
- **Pros:** Fully mechanical and costs no tokens. The task id is fixed.
- **Cons:** "Which code removes this behavior" is a judgement call, and a template carries only
  the snapshot text. It adds a second `rem-` writer, against the single-appender rule.

### Option B: Refusal as evidence to the existing remediation planner (chosen)
- **Pros:** Machinery owns identity, provenance, admission and lap bounds; the planner owns the
  removal judgement (CLAUDE.md design principle). One appender, one ledger, and the existing
  spine `kickback` event.
- **Cons:** One planning dispatch per lap. The planner's output must be constrained to
  removal/rework.

### Option C: Mechanically revert the commits that introduced the refused behavior
- **Pros:** No BUILD lap.
- **Cons:** Commits rarely line up one-to-one with a single behavior. The revert can remove wanted
  work and bypasses the gates. Rejected.

## Decision

1. **A refusal admits bounded rework.** When a SHIP `prd_audit` lap's over-scope route finds
   blocking findings and *every* one of them is classified `refused`, by the existing shared
   projection (adr-2026-09-07 D8) and with no projection defect, the engine routes to remediation
   instead of halting. If any blocking finding is undecided (pending), or the projection reports
   a defect, the route is the existing over-scope HALT, unchanged. Pending always wins, so an
   operator decision is never skipped and pending still keeps the prior decision.
   Acceptance is unchanged.

2. **Refusal evidence is engine-supplied, not report-derived.** The remediation dispatch carries
   one refusal evidence entry per refused finding. Each entry gives the current presentation key
   (story criterion id or `NC.<n>`), the durable decision id and revision, the operator's
   rationale, and (for NC findings) the persisted original-source snapshot and case id from the
   `RemediationCaseStore`. Identity comes from the decision/case records, never from report prose
   or the report-local NC ordinal (adr-2026-08-22 D3 amendment #2521).

3. **One planner, removal-only output.** The existing `planRemediation` / `/remediate` planner
   decides how to remove or rework each refused behavior. For refusal evidence its admissible
   output is limited to tasks that remove or rework the refused behavior back within plan intent.
   Each such task binds the refusal's decision id as its governing clause and cites the
   presentation key. New capability is not admissible. If the planner cannot produce such tasks,
   or returns a human disposition, the route is the existing refused HALT.

4. **Same seam, same ids, same bounds.** Admitted refusal tasks go through the existing append
   seam as `rem-prd-audit-*` tasks. Their deterministic id segment derives from the durable
   decision/case id, so recurrence upserts rather than duplicates. They share the `gates.prd_audit`
   lap and growth allowance with `FIXABLE` repair (adr-2026-08-22 D5 as amended, including
   dispatch-time charging per #2753). The kickback-to-build no-op escalation keeps applying.
   No new ledger, counter, config key or store is introduced.

5. **Exhaustion halts with the existing refusal block.** A refusal still flagged after a rework
   lap re-enters this route. If the `gates.prd_audit` lap allowance is spent at admission, the
   feature HALTs exactly as today (`over-scope` class, "refused — rework required") and the
   operator keeps the existing levers (revise decision, `kickback-budget raise`). With the default
   one-lap cap, a refusal still flagged after its lap therefore halts. A growth overflow found when
   the round reaches BUILD dispatch keeps the existing #2753 `kickback-cap` halt, which lists every
   refused key. Once the audit stops flagging the criterion, the refusal is moot as before; this
   route never deletes or rewrites the decision record.

6. **Parity across SHIP shapes.** The serial SHIP tail and the validation-group join consume the
   same route result (`CurrentPrdAuditRoute`). A new variant carries the refusal evidence, so the
   two shapes cannot diverge. This applies wherever `prd_audit` remediation already applies;
   where it does not, a refusal halts as today.

## Consequences

### Positive
- A durable refusal now ends: either the behavior is removed, or a bounded, named HALT follows.
- No new store, ledger, config key, appender or spine channel. The existing `kickback` event
  reports the lap.
- Pending/accept semantics and anti-laundering (adr-2026-08-24 D3) are untouched.

### Negative
- A planning dispatch per refusal lap (bounded by the lap cap).
- A refusal lap shares the single `prd_audit` lap with `FIXABLE` repair. A feature with both may
  exhaust it sooner, which is accepted: the bound is deliberately per gate.
- The planner's removal-only constraint is enforced as a contract on its output (decision-id
  binding, schema-constrained), not by inspecting the diff. The following `prd_audit` is the
  check.

### Follow-up Actions
- [ ] Amend adr-2026-08-24 D6, adr-2026-08-22 D4 (#2429 note) and adr-2026-09-07 D8 additively to
      point here (done in this DECIDE pass).
- [ ] Extend the `/remediate` skill's evidence contract with the refusal evidence kind and the
      removal-only rule.
- [ ] Update `docs/runbooks/stalled-or-stuck-feature.md` and `docs/explanation/gates.md` for the
      refuse → rework path.
