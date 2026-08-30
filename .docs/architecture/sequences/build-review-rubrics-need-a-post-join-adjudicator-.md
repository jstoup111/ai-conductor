# Sequence: one build_review remediation fan-in across current and prior outcomes

**Last updated:** 2026-08-29
**Scope:** One failed multi-rubric lap, source-complete `remediate` synthesis, deterministic effects,
and a later lap that recognizes prior cases without re-litigating or double-charging them.

## Diagram

```mermaid
sequenceDiagram
  participant C as Conductor
  participant G as Rubric group
  participant J as Raw join
  participant O as Operator dispositions
  participant H as RemediationCaseStore
  participant R as Remediate
  participant V as Result validator
  participant X as Case effect executor
  participant I as Tracker and intake adapter
  participant B as Budget and routing
  participant E as Event spine

  C->>G: dispatch enabled rubrics over frozen lap L1
  par independent rubric sessions
    G->>G: rubric A judges its closed projection
    G->>G: rubric B judges its closed projection
    G->>G: rubric N judges its closed projection
  end
  G-->>J: validated write-disjoint branch outcomes
  J->>J: preserve all raw results and finding identities
  J->>O: resolve exact operator accepted-risk and reduced-coverage records
  O-->>J: unresolved content findings and infrastructure coverage status

  alt infrastructure-only failure with mechanical allowance remaining
    J->>E: emit mechanical failure occurrence
    J-->>C: publish no aggregate and fail closed without remediation or semantic charge
  else no unresolved content and uncovered exhausted infrastructure
    J-->>C: publish blocking aggregate for operator reduced-coverage decision
  else every content finding is already resolved and infrastructure permits PASS
    J->>E: emit raw FAIL and effective PASS
    J-->>C: publish PASS without remediation
  else one or more unresolved content findings, including a mixed infrastructure lap
    J->>H: read all bounded prior cases and effect status
    H-->>J: actionable, merged, deferred, rejected, and resolved cases
    J->>R: all current findings plus prior cases and plan evidence
    R-->>V: one prioritized source-complete disposition set

    alt dispatch fails or result is incomplete, contradictory, or malformed
      V->>E: emit adjudication failure occurrence
      V-->>C: fail closed without PASS or action-budget charge
    else result is valid
      V->>H: reserve new cases and pending effects under lease
      H-->>V: stable case ids and effect keys

      loop each reserved deterministic effect
        alt actionable case
          V->>X: publish or resume build-review-work-order.json
          X-->>H: record work-order effect id and status
        else deferred case
          V->>I: find existing issue by hidden effect marker
          alt matching issue exists
            I-->>H: record existing issue reference
          else no matching issue exists
            I->>I: sanitize and file Observed, Impact, Desired outcome
            I-->>H: record created issue reference
          end
        else merged or rejected case
          V->>H: finalize with rationale and source links, no external effect
        end
      end

      H->>B: finalized cases and newly actionable work
      B->>B: consume existing kickback once for the new work order
      B->>E: emit adjudication and effect outcomes
      alt actionable work exists
        B-->>C: one prioritized BUILD route
      else every finding handled and infrastructure permits PASS
        B-->>C: effective PASS with raw findings still traceable
      else every finding handled but infrastructure remains uncovered
        B-->>C: existing mechanical retry or exhaustion HALT
      end
    end
  end

  C->>G: dispatch later frozen lap L2
  G-->>J: current branch outcomes
  J->>H: read prior cases with task and issue status
  alt no content finding remains
    J->>H: mark unmatched open cases resolved
    J-->>C: publish PASS
  else semantically equivalent finding is reported again
    J->>R: current findings plus prior case C1 and resolution evidence
    R-->>V: bind finding to C1 rather than create a new case
    V->>H: append source trace to C1 and update status
    H->>B: no newly actionable case
    B->>B: do not consume a second kickback
    alt C1 effect was reserved but interrupted
      B-->>C: resume the same effect id and BUILD route
    else C1 was already attempted and remains unresolved
      B-->>C: needs-human HALT with current and prior evidence
    else C1 was deferred, rejected, or merged
      B-->>C: reuse the adjudicated outcome
    end
  end
```

## Invariants

- The group waits for every enabled rubric to settle before the raw join. One malformed or failed
  branch cannot erase valid sibling outcomes.
- Infrastructure inability is not a semantic finding and never reaches `remediate` as repairable
  content. Below its allowance it publishes no aggregate. At exhaustion it remains blocking until
  exact operator reduced coverage resolves it; only then may content siblings enter `remediate`.

> **Amended 2026-08-29 by #2033:** “publishes no aggregate” applies to an infrastructure-only lap.
> Valid content siblings on a mixed lap enter `remediate`; one admitted actionable route takes the
> semantic charge while infrastructure stays independently blocking. With no action route,
> infrastructure follows its existing retry/exhaustion path and only healing or exact operator
> reduced coverage can permit PASS.

- `remediate` sees current findings and bounded prior case history in one fresh session. It returns
  judgement only; the engine stamps identities and performs effects.
- Every current raw finding is traceable to exactly one case outcome. A merge retains all source
  identities rather than replacing them with one untraceable summary.
- Deferred issue publication is retry-safe: the engine reserves a stable effect marker before the
  call and searches for that marker before creating an issue after any retry or crash.
- A repeated equivalent case never consumes a second kickback. A crash-interrupted work-order effect
  resumes idempotently; a case already attempted by BUILD and still present halts instead of becoming
  either a newly charged lap or an unlimited free loop. The cumulative route bound remains intact
  because every actual first-time BUILD kickback still increments it.
- Raw rubric evidence, operator acceptance, autonomous adjudication, and the effective gate verdict
  remain separately inspectable.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-29 | Initial proposed sequence | DECIDE architecture input for issue #2033 |
| 2026-08-29 | Route mixed-lap content without clearing infrastructure | Conflict-check resolution preserves sibling findings and existing mechanical authority |
| 2026-08-29 | Bind sequence participants to planned state/effect seams | Plan-update pass |
