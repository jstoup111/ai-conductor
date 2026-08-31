# Sequence: existing-task disposition through the as-built remediation gate (#2119)

**Last updated:** 2026-08-31
**Scope:** The false-halt path from #2119 and its replacement — a REMEDIABLE finding whose remedy
existing plan tasks already own, routed without drawing plan-growth allowance.

## Diagram

```mermaid
sequenceDiagram
  participant AR as architecture_review_as_built
  participant RM as /remediate planner
  participant CO as conductor (remediation routing)
  participant BG as budgets (growth + laps)
  participant PL as plan .docs/plans/«stem».md
  participant BD as build

  AR->>RM: BLOCKED report (AB-1 REMEDIABLE)
  RM->>RM: judgement: plan Task 3 + Task 6 own the remedy
  RM->>CO: remediation.json gap disposition=existing-task, planTasks=[3,6]
  CO->>PL: resolvePlanTaskReference(3), (6)
  PL-->>CO: both members of active plan
  CO->>BG: consume as-built lap (laps+1) — growth untouched
  alt lap allowance remains
    CO->>BD: route → build (finish Tasks 3 and 6)
  else lap cap reached
    CO-->>AR: HALT kickback-cap — "lap cap reached (n/n)" naming the exhausted budget
  end
  Note over CO,PL: no appendRemediationTasks call — sealed plan never amended
  Note over BG: old path: 3 tasks > growth cap 2 → false<br/>"plan-growth allowance exhausted (0/2)" halt
```

## Legend

- «…» — variable segment placeholder.
- An unresolvable cited task id (not in the active plan) is a validation failure of the
  disposition, handled like other malformed gaps — never a silent append.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-31 | Initial generation | DECIDE for #2119 |
