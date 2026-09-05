# Sequence: an under-floor `gh`, today and after

**Last updated:** 2026-09-05
**Scope:** The two flows that change for jstoup111/ai-conductor#2139 — the current path, in which
an old `gh` is discovered only at FINISH and burns the full retry budget, and the target path, in
which the same CLI is refused at startup. Anchors are at `main` `e54f1ba4e`.

## Diagram: today (the defect)

```mermaid
sequenceDiagram
    autonumber
    actor OP as Operator
    participant D as daemon start
    participant B as build + gates
    participant F as FINISH publication
    participant SE as shipment-evidence.ts:93
    participant GH as gh CLI v2.14.1

    OP->>D: conduct daemon start
    D-->>OP: starts, no gh version check
    D->>B: dispatch feature
    B-->>D: built, tested, gated, rebased, PR open
    D->>F: record_outcome
    loop 6 attempts, full retry budget
        F->>SE: resolveImplementationPrBinding
        SE->>GH: gh pr view «pr» --json url,headRefOid
        GH-->>SE: error, Unknown JSON field headRefOid
        SE-->>F: throws
        Note over F: fail-closed block finish-record-cli.ts:206-208<br/>cannot tell field-unsupported<br/>from PR-does-not-exist
        F-->>D: outcome_record_write_failed
    end
    D-->>OP: loop halted, FINISH publication retry exhausted
    Note over OP: no line names the CLI or the field —<br/>feature re-dispatches on this path forever
```

## Diagram: target

```mermaid
sequenceDiagram
    autonumber
    actor OP as Operator
    participant D as daemon dispatch cycle
    participant G as gh environment gate
    participant P as injectable version probe
    participant GH as gh CLI v2.14.1
    participant F as feature backlog
    participant SEAM as tracker-client makeProductionGh

    OP->>D: conduct daemon start
    D->>G: check environment before dispatch
    G->>P: probe
    P->>GH: gh --version
    GH-->>P: gh version 2.14.1
    P-->>G: parsed 2.14.1
    G-->>D: below-floor, floor v2.73.0
    Note over D,F: dispatch is PREVENTED.<br/>No feature is claimed, no retry budget spent,<br/>no per-feature HALT marker written.
    D-->>OP: one waiting condition — gh 2.14.1 is below the v2.73.0 floor, upgrade gh

    OP->>OP: upgrade gh
    D->>G: next cycle re-checks
    G->>P: probe
    P->>GH: gh --version
    GH-->>P: gh version at or above floor
    P-->>G: ok
    G-->>D: clear
    D->>F: dispatch resumes, nothing was lost

    Note over SEAM: residual case — gh downgraded mid-run.<br/>The seam produces a typed GhCapabilityError<br/>naming the CLI and the field. Each caller keeps<br/>its own disposition: finish-record stays fail-closed,<br/>the finish completion gate stays fail-open.<br/>Downstream routes on the class, never the text.
```

## Legend

- Guillemets `«…»` mark variable text.
- The first diagram is current behavior at `e54f1ba4e`, reproduced in the intake issue against a
  real `gh` 2.14.1. It is drawn to be deleted, not maintained.
- The decisive difference is not the wording of the failure but *who owns it*: today a machine-wide
  environment defect is recorded against one feature and re-dispatched forever; in the target it
  never reaches a feature at all.
- The seam translation is a second line of defence for a `gh` that changes under a running daemon.
  The floor gate is what keeps a retry budget from being spent.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-05 | Initial generation | DECIDE for jstoup111/ai-conductor#2139 |
| 2026-09-05 | Target reshaped from refuse-to-start to a dispatch-preventing environment gate | Repo-wide ADR sweep + operator's infrastructure-failure framing |
