# Sequence: Mechanical rubric fault — bounded retry, operator decision, reduced-coverage evidence

**Last updated:** 2026-08-18
**Scope:** How one `build_review` lap whose rubric outcome is a mechanical fault is routed
differently from a judged FAIL: which allowance it consumes, when it terminates, what the
operator can decide, and where reduced coverage is stamped. Covers the rubric fan-out, the
aggregate, the effective-verdict reducer, the durable accepted-risk record, the kickback
ledger, the conductor's routing at the raw-FAIL branch, and the operator-facing surfaces.

Boundaries only. Names of concrete functions and files appear where they are **existing**
seams the design must live within; the mechanisms this feature adds are drawn as
capabilities, and their placement is `/architecture-review`'s call (see OQ-1..OQ-5 in the
PRD).

## Diagram

```mermaid
sequenceDiagram
    participant Cond as conductor (build_review step)
    participant Runner as build_review step runner
    participant Coord as rubric coordinator (fan-out)
    participant Agg as aggregate («.pipeline/build-review.json»)
    participant Red as effective-verdict reducer
    participant Disp as accepted-risk record (existing store)
    participant Ledger as kickback ledger («.pipeline/kickback-ledger.json»)
    participant Op as operator (interactive TTY)
    participant Ship as shipped evidence

    Cond->>Runner: run build_review for lap «lapId»
    Runner->>Coord: fan out four rubrics over one frozen snapshot
    Coord-->>Runner: per-rubric branch: judged / skipped / mechanical fault

    alt every rubric judged or skipped
        Runner->>Agg: publish aggregate
        Runner->>Red: derive effective verdict (with accepted-risk record)
        Red-->>Runner: PASS or FAIL on unresolved findings only
    else at least one rubric is a mechanical fault
        Note over Runner,Ledger: NEW — the fault is classified apart from judgement (FR-1)
        Runner->>Ledger: consult the mechanical allowance for this rubric
        alt mechanical retries remain (FR-2, FR-3)
            Runner->>Ledger: spend mechanical allowance only — semantic allowance untouched
            Runner-->>Cond: no review outcome published for this lap
            Cond->>Cond: verdict absent — re-dispatch build_review
            Note over Cond: today's absent-verdict path, generalised from the one<br/>narrow precedent to every mechanical fault
        else mechanical allowance exhausted (FR-3, FR-4)
            Runner->>Agg: publish aggregate carrying the exhausted mechanical fault
            Runner->>Red: derive effective verdict
            Red-->>Runner: FAIL — a mechanical fault with no decision still blocks
            Cond->>Cond: terminate for a human, naming rubric + mechanical cause
        end
    end

    Note over Op,Disp: Recovery is a recorded decision, never a hand-edited ledger

    Op->>Red: inspect findings report
    Red-->>Op: raw + effective verdict, unresolved findings,<br/>exhausted mechanical faults and their reasons (FR-4)
    Op->>Disp: record reduced-coverage decision for «rubric» + rationale (FR-5)
    Disp->>Disp: refuse unless interactive TTY + verified local operator (FR-6)
    Disp->>Disp: refuse if that rubric is not currently exhausted-mechanical (FR-13)
    Disp->>Disp: refuse if already recorded for this rubric on this review (FR-14)
    Disp-->>Op: decision durably recorded, scoped to «rubric» on this review (FR-7)

    Cond->>Red: next lap — derive effective verdict again
    Red->>Disp: read accepted-risk record
    alt every mechanical fault covered AND every finding resolved or accepted
        Red-->>Cond: PASS (FR-8)
        Cond->>Ship: stamp reduced coverage: rubric, reason, operator, rationale (FR-10, FR-11)
    else any unresolved judged finding remains
        Red-->>Cond: FAIL — reduced-coverage decisions never resolve findings (FR-9)
    end
```

## Legend

- **Mechanical fault** — the PRD's term for a rubric branch that could not be evaluated at
  all (existing `infrastructure-failure` result kind). It is not an opinion about the diff.
- **Semantic allowance** — the existing cumulative `build_review` kickback budget that bounds
  reviewer/builder churn. This feature's core invariant is that a mechanical fault never
  decrements it.
- **Mechanical allowance** — the new, separate bound on re-attempts after a mechanical fault.
  Whether it is per rubric or per review, and whether exhaustion halts or parks, are open
  (PRD OQ-3, OQ-4).
- **No review outcome published** — the existing behavior in which the step returns failure
  without writing an aggregate, so completion sees an absent verdict and re-dispatches. It is
  reachable today only for one narrowly-matched fault; generalising it is PRD OQ-2.
- **Accepted-risk record** — the existing durable per-feature store that already holds
  operator finding acceptances. This feature extends it rather than adding a channel, per the
  repository's event-spine and no-parallel-channel rules.
- **Decision scope** — a reduced-coverage decision covers exactly one rubric on the review it
  was recorded against. What "the same review" means across laps whose inputs change is the
  central open question (PRD OQ-1); whether the decision expires on a materially changed diff
  is PRD OQ-5.

## Existing seams this design must live within

| Seam | Today | Why it matters here |
|---|---|---|
| `deriveEffectiveBuildReviewVerdict` | blocks on mechanical faults; does **not** block on `skipped` | the only place a decision can unblock a mechanical fault (FR-8) |
| conductor raw-FAIL branch | bumps the cumulative counter on any published FAIL, cause-blind | the site that must stop charging mechanical faults (FR-2) |
| build_review step runner | already returns failure without publishing for one narrow fault class | the precedent the retry lane generalises (PRD OQ-2) |
| accepted-risk record + its authority gate | interactive TTY + verified local operator | reused unchanged for the new decision (FR-6, NFR-3) |
| shipped evidence | records what shipped and under what review | must carry reduced coverage (FR-11) |

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-18 | Initial generation | DECIDE for intake jstoup111/ai-conductor#1629 |
