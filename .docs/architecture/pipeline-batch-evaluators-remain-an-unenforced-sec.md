# Sequence: /pipeline batch boundary after batch-evaluator retirement

**Last updated:** 2026-10-12
**Scope:** What changes at a `/pipeline` batch boundary and in the closeout-obligation vocabulary when the
batch evaluator is retired (#3056). `build_review` becomes the single post-build review authority; its
default-on `implementationQuality` rubric shipped in #3086. The diagram adds no new step, event kind,
store, or gate. It removes the evaluator dispatch and the doc claims built on it, and it flips the `security` rubric's
default to enabled so that a default build still gets a security review. It also retires the whole closeout-obligation
telemetry channel, which had no producer except the evaluator. The sibling ledger survives for build-review and
kickback-budget events, and its tail now re-emits only admitted kinds
(adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry).
`agents/evaluator.md` stays, because standalone `/code-review` still dispatches it.

## Diagram: one batch boundary, before and after

```mermaid
sequenceDiagram
    participant Orch as /pipeline orchestrator (skill text)
    participant Simp as /simplify
    participant Tests as lint + affected tests
    participant CLI as ai-conductor closeout-event (retired)
    participant Eval as evaluator subagent
    participant Trail as .pipeline/audit-trail
    participant Spine as events.jsonl

    Orch->>Simp: batch-boundary /simplify
    Simp-->>Orch: done
    Orch->>Tests: lint + BATCH_AFFECTED_TESTS
    Tests-->>Orch: results
    rect rgb(255, 230, 230)
        Note over Orch,Spine: BEFORE (removed): tier table decides 0..N evaluators
        Orch->>CLI: closeout-event start evaluator
        Orch->>Eval: dispatch (Task: none, batch diff)
        Eval-->>Orch: verdict
        Orch->>Trail: review.json + code-review-satisfied.md
        Orch->>CLI: closeout-event end evaluator
        CLI->>Spine: pipeline_closeout obligation=evaluator
        Orch->>Orch: HARD GATE: block batch until evaluator event recorded
    end
    Orch->>Orch: AFTER: advance to next batch (no evaluator gate)
    Note over Orch,Spine: whole-branch review happens once in build_review (testQuality, security, implementationQuality)
```

## Diagram: surfaces touched

```mermaid
graph LR
    subgraph removed["Removed"]
        G["pipeline SKILL: evaluator dispatch, tier table, hard gate, audit-trail writes"]
        C["doc claims: evaluator satisfies code-review gate"]
        CE["closeout-event CLI + closeout-trust"]
        EK["pipeline_closeout* event kinds + sink rows"]
        OT["OTel closeout histogram + span event"]
        LG["renderer + daemon-log closeout lines"]
        RC["build-tail rollup closeout segment"]
    end
    subgraph rescoped["Re-scoped"]
        M["model-table row evaluator: /code-review only"]
        A[agent + template references to evaluator]
    end
    subgraph flipped["Default flipped"]
        SEC["build_review security rubric: enabled by default"]
    end
    subgraph kept["Kept"]
        S["batch /simplify, lint, affected tests"]
        CR["/code-review + agents/evaluator.md"]
        BR[build_review rubrics]
        LED["pipeline-events.jsonl sibling ledger"]
        TAIL["CloseoutEventTail: admitted kinds only"]
        RT["build-tail rollup: task execution + ticks"]
        BRC["build-review-cli + kickback-budget-cli writers"]
    end
    G --> BR
    G -.->|"per-batch security check moves to"| SEC
    M --> CR
    BRC --> LED
    LED --> TAIL
    TAIL -->|"unadmitted kind"| DIAG["pipeline_tail_diagnostic unadmitted-type"]
    LED --> RT
```

## Legend

- Red block (sequence): behavior that exists today and is deleted by this feature, including the only producer of
  closeout events.
- `CLI (retired)`: `bin/ai-conductor` resolves `src/conductor/dist` on every invocation. A session that started under
  the old skill text and calls `closeout-event` after a rebuild gets the CLI's unknown-command exit 1. The operator
  accepted that window.
- `TAIL`: the sibling-ledger tail re-emits only `ExternalPipelineEvent` kinds. Leftover closeout lines become one
  `unadmitted-type` diagnostic each.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-12 | Initial generation | DECIDE for #3056 (retire /pipeline batch evaluators) |
