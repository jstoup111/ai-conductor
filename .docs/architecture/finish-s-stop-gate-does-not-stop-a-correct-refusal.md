# Architecture: FINISH refusal reaches the operator with its reason

**Last updated:** 2026-08-08
**Scope:** The FINISH `judge_pr_prose` verdict path and the rendering of `human_required`
dispositions into the needs-human HALT. Covers the provider verdict contract in
`skills/finish/SKILL.md`, the `PublicationDisposition.human_required` arm in
`src/conductor/src/engine/finish-publication.ts`, and the conductor's halt-marker write.

## Component View

```mermaid
flowchart TD
    subgraph Provider["Provider session (finish skill)"]
        Skill["skills/finish/SKILL.md<br/>the provider's ONLY instruction source<br/>skill-invocation.ts dispatches /finish with zero arguments"]
        Contract["PR-prose verdict contract<br/>accepted | refused | revision_required<br/>(NEW: published to the provider)"]
    end

    subgraph Decode["finish-pr-prose-judgment.ts"]
        Parse["parseFinishPrProseJudgment<br/>extracts the first «kind» JSON object"]
        Decode2["decodePrProseJudgment<br/>fails closed to malformed_response<br/>(routes to publication_retry, not a halt)"]
    end

    subgraph Publication["finish-publication.ts"]
        Map["mapPrProseJudgmentResult"]
        Disposition["PublicationDisposition<br/>human_required { reason, detail? }<br/>(NEW: optional detail)"]
        Guard["isExactDisposition<br/>(WIDENED: admits kind+reason+detail)"]
        Reasons["HUMAN_REQUIRED_REASONS<br/>reason token to { message, nextAction }<br/>(NEW: mirrors PUBLICATION_CONDITIONS)"]
        Render["renderHumanRequiredHalt<br/>message + nextAction + provider detail<br/>(NEW)"]
        Route["routeFinishPublicationDisposition"]
    end

    subgraph Conductor["conductor.ts FINISH route handling"]
        Halt["route.kind = halt"]
        Marker["writeHaltMarker(reason, 'needs-human')"]
    end

    subgraph Durable[".pipeline/ markers"]
        HaltFile[("HALT<br/>operator-facing prose")]
        ClassFile[("HALT.class = needs-human")]
    end

    Rekick["daemon-rekick.ts<br/>skips re-kick for needs-human"]
    Operator["Operator reads the blocker and its next action"]

    Skill --> Contract
    Contract --> Parse
    Parse --> Decode2
    Decode2 --> Map
    Map --> Disposition
    Disposition --> Guard
    Guard --> Route
    Reasons --> Render
    Disposition --> Render
    Render --> Route
    Route -->|"human_required"| Halt
    Halt --> Marker
    Marker --> HaltFile
    Marker --> ClassFile
    ClassFile --> Rekick
    HaltFile --> Operator
```

## Refusal Sequence

```mermaid
sequenceDiagram
    participant C as Conductor
    participant Co as Publication coordinator
    participant P as Provider (finish skill)
    participant D as decodePrProseJudgment
    participant R as HUMAN_REQUIRED_REASONS
    participant M as .pipeline/HALT + HALT.class
    participant O as Operator

    C->>Co: advance(state, mode, daemon)
    Co->>Co: next transition = judge_pr_prose
    Co->>P: dispatchJudgment(retained PR title/body)
    Note over P: SKILL.md now states the verdict contract,<br/>so a genuine blocker is expressible
    P-->>Co: {"kind":"refused","detail":"«blocker sentence»"}
    Co->>D: decodePrProseJudgment(output)
    D-->>Co: { kind: refused, detail }
    Co->>Co: mapPrProseJudgmentResult
    Co-->>C: human_required { reason: judgment_refused, detail }
    C->>R: look up judgment_refused
    R-->>C: { message, nextAction }
    C->>M: writeHaltMarker(message + nextAction + detail, 'needs-human')
    C-->>O: loop_halt with the rendered reason
    O->>M: reads the actual blocker, not an enum token
    Note over C: no retry — human_required has never been<br/>retry-eligible, so only the reason text changes
```

## Legend

- **NEW / WIDENED** annotations mark the surfaces this feature changes. Everything unannotated
  already exists and is unchanged.
- `«detail»` is guillemet placeholder notation for a provider-supplied blocker sentence.
- "needs-human" is the existing `HaltClass` from `halt-marker.ts`; `daemon-rekick.ts` already
  refuses to re-kick it. This feature does not change halt routing — only what the operator reads.

## Design Notes

**Why no new durable artifact.** The filer's hypothesis proposed a `.pipeline/finish-blocker.json`
carrying the refusal. It was rejected: `.pipeline/HALT` + `HALT.class` already carry both the prose
and the routing class, and a second artifact would need its own staleness and sweep semantics for a
machine-readable seam that nothing consumes today. See
`.memory/decisions/2026-08-08-finish-human-required-halt-reasons.md`.

**Why the guard has to move.** `isExactDisposition`'s `human_required` arm is an exact-key check
(`hasOnly('kind', 'reason')`). `detail` is therefore not additive-by-default — the guard, every
construction site, and the tests asserting the exact shape all change together. This is the single
largest reason the feature is tier M rather than S.

**Reachability, not just wording.** Today the `refused` verdict cannot be produced: the vocabulary
exists only in the engine and its tests, so a refusing provider writes prose, the parser finds no
JSON, and post-#1372 it fails closed to `malformed_response`, which routes to a judgment retry —
so the refusal is spent by the bounded progress allowance and the operator never sees it.
Publishing the contract in SKILL.md is what makes the refusal path live; the reason map is what
makes it legible.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-08 | Initial generation | DECIDE for intake jstoup111/ai-conductor#1107 |
