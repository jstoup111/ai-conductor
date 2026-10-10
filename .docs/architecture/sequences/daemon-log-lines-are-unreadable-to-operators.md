# Sequence: build_review provisional FAIL to final verdict line (#2867)

**Last updated:** 2026-10-09
**Scope:** The log lines an operator sees when build_review's effective verdict is FAIL and adjudication then decides the route.

## Diagram

```mermaid
sequenceDiagram
  participant C as Conductor
  participant A as build_review adjudication
  participant E as Event spine
  participant P as Per-dispatch presenter
  participant L as Daemon logger
  C->>C: completion check fails (effective FAIL, reason names finding titles)
  C->>C: shared predicate: this FAIL enters adjudication?
  C->>E: step_failed (provisional = pending-adjudication)
  E->>P: step_failed
  P->>L: depth 1 "✗ build_review provisional FAIL (try «n») — pending adjudication … no action needed"
  C->>A: applyBuildReviewOutcome(aggregate)
  A-->>C: outcome kind + settled cases
  C->>E: build_review_adjudicated (outcome, overturned, findings by title)
  E->>P: build_review_adjudicated
  P->>L: depth 1 "build_review final verdict: «PASS|FAIL → build|HALT» … next action"
  Note over P,L: per-case detail (case ids, dispositions) renders only when daemon_verbose is true
```

## Legend

- `«n»` is the step try number. The provisional line appears only when the shared predicate says the conductor will adjudicate this FAIL; a FAIL on the legacy raw lane keeps the ordinary failed line and gets no final-verdict line.
- Exactly one final-verdict line is rendered per adjudicated lap, whatever the outcome kind (pass, repair to BUILD, decision stop, halt, mechanical retry).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-09 | Initial generation | Daemon log readability (#2867) |
