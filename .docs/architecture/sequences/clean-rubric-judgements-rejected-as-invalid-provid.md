# Sequence: One rubric's judged-result round trip

**Last updated:** 2026-08-19
**Scope:** A single build_review rubric from prompt assembly to settlement, contrasting the
observed 2026-08-19 `completeness` failure with the four-seam behavior.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant SR as dispatchBuildReviewRubric
    participant PR as Provider session
    participant DOM as build-review-domain
    participant CO as coordinateBuildReviewRubrics
    participant FS as .pipeline artifacts

    Note over SR,DOM: Seam C — the engine no longer asks for what it already holds
    SR->>SR: assemble prompt from projection, contract text, rendered shape
    SR->>PR: dispatch rubric «rubric» for lap «lapId»
    PR-->>SR: findings array only
    SR->>DOM: extractJudgedResultCandidate
    DOM-->>SR: candidate findings

    Note over SR: Seam B — canonical form applied before identity binding
    SR->>DOM: normalize anchor plan-task reference
    DOM-->>SR: bare canonical id

    Note over SR: Seam C — envelope stamped from engine-held facts
    SR->>SR: stamp kind, rubric, contractVersion, lapId, snapshotDigest
    SR->>DOM: validateBuildReviewDispatchedResult with projection

    alt Judgement satisfies the contract
        DOM-->>SR: judged result
        SR-->>CO: judged result
        CO->>FS: writeArtifact under current lap identity
        CO->>FS: writeCache under content-addressed identity
        CO-->>FS: aggregate verdict
    else Judgement rejected
        DOM-->>SR: rejected
        Note over SR,DOM: Seam A — diagnosis sees the same projection the check saw
        SR->>DOM: describeBuildReviewJudgedResultRejection with full reference context
        alt An enumerated check explains it
            DOM-->>SR: named requirement and the form it must take
        else No enumerated check explains it
            DOM-->>SR: reported as unexplained, no cause asserted
        end
        alt Repair unspent and previous output differs
            SR->>PR: one bounded repair turn carrying the tested diagnosis
            PR-->>SR: re-emitted findings
        else Repair spent, or output byte-identical
            Note over SR,CO: Seam A — a no-op repair does not consume the budget
            SR-->>CO: infrastructure failure, closed reason, tested detail
            CO-->>FS: aggregate records the named requirement
        end
    end
```

## Legend

**Observed failure this replaces.** On 2026-08-19 the `completeness` rubric emitted a fully
conformant v3 envelope whose `anchor.planTask` was `Task 7: The resolved channel and its source
are confirmed in the output`. That value is non-empty, so the diagnosis's presence check passed
and control reached a catch-all that asserted a `verdict`/`passed` contradiction the payload did
not contain. The repair turn therefore carried an instruction that could not change anything,
the re-emitted output was byte-identical three times over, and the retry budget drained into a
`needs-human` halt.

Under this sequence: seam B normalizes the reference so it binds; if it still failed, seam A
names `anchor.planTask` and the canonical form it requires; and seam A's byte-identical guard
stops the budget draining on a repair that cannot converge.

**Participants.** `SR` is `step-runners.ts`; `DOM` is `build-review-domain.ts`; `CO` is
`build-review-coordinator.ts`; `FS` is the per-lap branch artifact directory, the rubric cache,
and the aggregate.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-19 | Initial generation | DECIDE for `clean-rubric-judgements-rejected-as-invalid-provid` (#1683) |
