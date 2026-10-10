# Components: Dependency Edge Reconciler (#536)

**Last updated:** 2026-10-09
**Scope:** The three callers that author and verify GitHub issue `blocked_by` edges, and the
shared reconciler they depend on. The consumer side (claim-time blocker filtering and the daemon's
waiting channel via `BlockerResolver`) is unchanged and is shown for context only. Structured
`--depends-on` linking at filing time has already shipped and is shown for context.

## Diagram

```mermaid
graph TD
  OP(["Operator"])
  GH[("GitHub Issues<br/>issue body · blocked_by<br/>issue state + state_reason")]
  SPINE[["Event spine<br/>ConductorEventEmitter → events.jsonl"]]

  subgraph Shared["Shared reconciler (new)"]
    REC["Dependency reconciler<br/>declared edges (structured field + 3 prose patterns)<br/>vs actual edges → proposals / drift findings"]
    PARSE["issue-dep-migration parser<br/>parseDependencyProse (existing)"]
    WRITE["createDependencyLinks<br/>GET-before-POST additive writer (existing)"]
    RES["BlockerResolver<br/>cycle detection (existing)"]
    TRK["TrackerClient<br/>blocked_by read incl. state_reason (existing)"]
  end

  subgraph Callers["Callers"]
    ACT["Intake label-sync Action<br/>issues: opened · edited<br/>now parses prose on every issue"]
    LAND["compose land<br/>intake ideas only: proposal gate<br/>accept / decline / skip-ack"]
    OVL["Overlap detection<br/>overlap-suggestions (existing)"]
    AUDIT["Drift report<br/>on-demand read-only verb"]
    POLL["Intake poll tick<br/>bounded-cadence drift pass"]
  end

  CLAIM["Claim + daemon dispatch gate<br/>(consumers, unchanged)"]

  GH -- "opened / edited event" --> ACT
  ACT --> REC
  OP --> LAND
  LAND --> REC
  LAND --> OVL
  OP --> AUDIT
  AUDIT --> REC
  POLL --> REC
  REC --> PARSE
  REC --> RES
  REC --> TRK
  ACT -- "unambiguous prose edges only" --> WRITE
  LAND -- "accepted proposals only" --> WRITE
  WRITE --> GH
  TRK --> GH
  RES --> GH
  LAND -- "land_dependency_decided (success) · land_gate_rejected (refusal)" --> SPINE
  POLL -- "dependency_drift_swept (status + lists), hourly" --> SPINE
  CLAIM --> RES
```

## Legend

- **Shared reconciler (new):** the one module that computes declared-vs-actual edges. Every caller
  goes through it, so the grammar and comparison rules cannot drift between paths.
- **Writes** reach GitHub only through the existing additive writer, and only from two paths:
  unambiguous prose edges from the Action, and operator-accepted proposals from land. The drift
  report and the poll pass are read-only.
- **Event spine:** land decisions and drift sweeps are new `ConductorEvent` variants. No sidecar
  report file is written.
- Double-bordered nodes are existing infrastructure; cylinder = external system.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-09 | Initial generation | DECIDE for #536 (dependency-edges-are-hand-maintained-intake-and-de) |
