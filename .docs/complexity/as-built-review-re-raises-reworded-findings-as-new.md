# Complexity: As-built review re-raises reworded findings as new obligations

Tier: M

## Rationale

- **Extends existing machinery; adds no subsystem, step, or dispatch.** Reconciliation rides the
  existing remediate `gap-plan` dispatch. Its native output contract (`REMEDIATION_PLAN_SCHEMA`,
  `validateRemediationPlan`) gains reconciliation fields that apply only to `as-built-finding`
  references, so prd_audit references keep today's contract. The build_review case mode and the
  prd-widening-reconciliation mode are untouched.
- **New domain in an existing store.** The shared remediation case store already parses two
  domains (`RemediationCaseDomain = 'build_review' | 'prd_widening'`,
  `remediation-case-artifact.ts:20`). This adds `as_built` records through the same parse and
  migration path. It is not a new file or channel.
- **Fuller history in an existing projection.** The gap-plan projection already carries
  `pendingAsBuiltFindings` and `priorLaps`. It gains prior as-built cases with their dispositions,
  appended `rem-*` task ids, and repair evidence, all under the projection's existing byte limits.
- **Touches approved decisions, which needs a lightweight architecture review.**
  `adr-2026-08-25-as-built-remediable-findings-bounded-build-route` decision 3 currently makes
  each finding its own remediation gap. The `existing-task` owner-only binding
  (`adr-2026-08-22-prd-audit-stories-authority-and-bounded-kickback`, as amended) does not admit
  binding the prior finding's repair task. The shared store's domain set is governed by
  `adr-2026-09-07-durable-prd-widening-decision-reconciliation` decision 2.
- **Bounded recurrence.** A recurrence or a materially changed finding reopens with a reason. A
  per-lineage limit stops a reopen cycle, following the build_review lineage-limit precedent.
- **Not L.** No new durable subsystem, no new dispatch, and no change to as-built review's verdict
  contract or authority. The first #2464 spec, scoped L, did not converge (13/13 as-built laps), so
  keeping this one narrow is deliberate.
- **Not S.** It changes a provider-facing native contract, the shared case store, and
  remediation-append behavior, and it amends approved ADRs.
