# Components + Sequence: batched coverage-binding judge with per-batch checkpoints (#2493)

**Last updated:** 2026-09-18
**Scope:** how `coverage_binding` dispatches its judge after this change. Claims are chunked into
bounded batches; one fresh provider session judges a batch and returns verdicts keyed by the
engine-stamped claim digest; the engine validates cardinality and identity, then atomically
rewrites `.pipeline/coverage-binding.json` after every batch so an interrupted run resumes from
the last checkpoint and re-dispatches only unjudged or invalid digests. Amends
`adr-2026-08-31-coverage-binding-judge-step` D5 (one session per claim → one session per batch).

## Diagram

```mermaid
graph TD
    subgraph INPUT["claim assembly (unchanged)"]
        CL["coverage-binding-inputs.ts<br/>assembleCoverageBindingClaims<br/>(criterion, task ids, Done when)"]
        DG["coverage-binding-envelope.ts<br/>claimDigest per claim"]
        PREV["previous envelope<br/>.pipeline/coverage-binding.json<br/>(any status)"]
    end

    subgraph PLANNER["batch planner (engine, deterministic)"]
        CACHE["cache hit: digest present<br/>with asserts | does-not-assert"]
        NA["not-applicable:<br/>no Done when block"]
        PEND["pending digests<br/>(not cached, judgeable)"]
        CHUNK["chunk pending into batches<br/>size = coverage_binding.judge.batch_size"]
    end

    subgraph DISPATCH["per-batch dispatch (fresh session each)"]
        PROMPT["batch prompt:<br/>[ {digest, criterion, taskIds, doneWhen} … ]"]
        JUDGE["fresh one-shot judge session<br/>(model ladder, executeAuxiliaryProviderCandidates)<br/>skills/coverage-binding/SKILL.md"]
        PAY["payload: {verdicts:[{digest, verdict, missingAssertion?}…]}"]
        VAL["engine validator:<br/>exactly the batch's digests, once each;<br/>foreign / duplicate / missing / malformed → batch fails"]
    end

    subgraph PERSIST["checkpoint + gate (unchanged spine)"]
        ENV["writeCoverageBindingEnvelope (atomic rename)<br/>status: partial → done | failed | refused"]
        EV["coverage_binding_judged per claim<br/>(existing event, existing sinks)"]
        GATE["all asserts → done<br/>any does-not-assert → refused needs-human<br/>batch failure → failed (other batches kept)"]
    end

    CL --> DG --> PREV
    PREV --> CACHE
    DG --> NA
    DG --> PEND
    CACHE --> ENV
    NA --> ENV
    PEND --> CHUNK --> PROMPT --> JUDGE --> PAY --> VAL
    VAL -->|"valid batch"| ENV
    VAL -->|"invalid batch"| GATE
    ENV --> EV
    ENV -->|"after last batch"| GATE
```

```mermaid
sequenceDiagram
    participant RN as runCoverageBinding
    participant PL as batch planner
    participant JG as judge session (per batch)
    participant VL as payload validator
    participant EN as envelope writer
    participant SP as event spine

    RN->>PL: claims + previous envelope entries
    PL-->>RN: cached entries, not-applicable entries, pending batches
    RN->>EN: checkpoint (status partial, cached + not-applicable)
    loop each pending batch (sequential)
        RN->>JG: batch prompt with N digest-keyed claims
        JG-->>VL: {verdicts: [...]}
        alt exactly N known digests, each once, closed vocabulary
            VL-->>RN: N entries
            RN->>EN: checkpoint (status partial, all entries so far)
            RN->>SP: coverage_binding_judged × N
        else foreign / duplicate / missing / malformed
            VL-->>RN: CoverageBindingPayloadError
            RN->>EN: write status failed (entries so far kept)
            RN-->>RN: return typed infrastructure failure (retry ladder)
        end
    end
    alt any does-not-assert
        RN->>EN: write status refused
        RN-->>RN: refusal needs-human
    else all asserts / not-applicable
        RN->>EN: write status done
    end
    Note over RN,EN: interrupted mid-loop → next run reads partial envelope,<br/>cache-hits every judged digest, re-dispatches only the rest
```

## Legend

- **batch planner** — pure function over `(claims, previous envelope)`. It partitions claims into
  cached (digest already carries a judge verdict, whatever the envelope's status), not-applicable
  (D8 legacy tolerance), and pending, then chunks pending into batches of at most
  `coverage_binding.judge.batch_size`. Cache hits are honored from `partial` and `failed`
  envelopes as well as `done`; identity is still the D5 digest of `(criterion, Done when)`.
- **batch prompt / payload** — the judge receives an array of claims each carrying its engine
  stamped digest and must return one verdict per digest. The digest is the only key the engine
  accepts; verdict vocabulary stays `asserts | does-not-assert` + `missingAssertion`.
- **validator** — machinery, not judgement: the returned digest set must equal the batch's digest
  set exactly (no missing, no extra, no repeats) and every verdict must parse. Any deviation is
  the existing `CoverageBindingPayloadError` infrastructure-failure lane (retry ladder, never a
  verdict, never `needs-human`). Valid verdicts for unrelated claims in earlier batches are never
  discarded by a later batch's failure.
- **checkpoint** — `writeCoverageBindingEnvelope` already writes atomically via sibling temp file
  + rename. The change is *when*: after every batch, with a new `partial` status that is not in
  `COVERAGE_BINDING_COMPLETION_STATUSES` (so a killed run never counts as done). `done`, `failed`,
  `refused`, `disabled` keep their meaning.
- **spine** — no new event types. `coverage_binding_judged` is still emitted per claim; batches
  are an execution shape, not a new observable concern.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-18 | Initial generation | DECIDE for #2493 (approach B, bounded batches + per-batch checkpoint) |
| 2026-09-18 | Plan-update pass: planner extracted to `coverage-binding-batches.ts`, batch parser `parseJudgeBatchPayload` in the envelope module; no diagram node change | /plan §8b for #2493 |
