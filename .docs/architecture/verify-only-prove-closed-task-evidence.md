# Components: Verify-Only (Prove-Closed) Task Evidence Closure (#677)

**Last updated:** 2026-07-17
**Scope:** The completion-evidence seam for tasks that legitimately produce no code delta —
plan-task marker parsing (autoheal.ts `parsePlanTaskPaths`), the gate-miss judged attribution
lane (attribution-lane.ts, conductor.ts:3030-3105), the evidence sidecar
(`.pipeline/task-evidence.json`), the generated commit-msg hook (git-hook-assets.ts), and the
/plan + /tdd skill contracts.

## Diagram

```mermaid
graph TD
    subgraph Authoring["DECIDE-time contract"]
        PLAN["/plan SKILL.md<br/>NEW: mark prove-closed tasks<br/>Verify-only: yes"]
        TDD["/tdd SKILL.md<br/>existing: empty commit with<br/>Evidence: satisfied-by or skipped"]
    end

    subgraph Parse["Deterministic parse"]
        PP["parsePlanTaskPaths<br/>autoheal.ts<br/>NEW: expose verifyOnly flag per task"]
    end

    subgraph GateMiss["Build gate-miss branch (conductor.ts:3030-3105)"]
        DERIVE["deriveCompletion<br/>autoheal.ts:606<br/>commit/trailer/stamp derivation"]
        RESIDUE["residueIds = tasks with<br/>no completion + not skipped"]
        ARM["NEW: class-scoped arming —<br/>verify-only residue dispatches the lane<br/>even when attribution_judge_cutover is dark"]
        LANE["runAttributionLane<br/>attribution-lane.ts:420<br/>verifier dispatch + citation validation"]
        STAMP["semantic-verified stamp<br/>ancestry-checked citation"]
        RECHECK["immediate completion re-check<br/>rows flip, progress count true"]
    end

    subgraph Hook["Commit-time enforcement"]
        CMSG["commit-msg hook<br/>git-hook-assets.ts:88<br/>NEW: accept Evidence: skipped parity"]
    end

    subgraph State["Durable engine state"]
        SIDE[("task-evidence.json<br/>evidenceStamps — only completion currency")]
        STATUS[("task-status.json<br/>row cache")]
    end

    PARK["daemon-auto-park.ts<br/>noEvidenceAttempts >= 3<br/>NEW: park reason names verify-only ids"]

    PLAN --> PP
    TDD --> CMSG
    PP --> ARM
    DERIVE --> RESIDUE
    RESIDUE --> ARM
    ARM --> LANE
    LANE -->|"valid citation"| STAMP
    LANE -->|"abstain (#519)"| PARK
    STAMP --> SIDE
    SIDE --> RECHECK
    RECHECK --> STATUS
    CMSG -->|"empty evidence commit"| DERIVE
```

## Component Notes

- **No new subsystem.** Every box marked NEW is an extension of an existing seam: the marker
  rides the existing plan-task grammar; the arming predicate wraps the existing lane gate;
  the hook change adds one accepted trailer form already accepted by autoheal.
- **Completion currency is unchanged** (#463): evidence stamps in `task-evidence.json` remain
  the only thing the gate accepts. The evaluator's batch APPROVE is still never trusted as
  completion; the judge's citation-validated stamp is the sanctioned semantic lane (#520).
- **Failure direction is unchanged**: a verify-only task the judge cannot substantiate abstains
  loudly (#519) into the retry hint and, at budget, the existing auto-park — now with the
  verify-only task ids named in the park reason.
