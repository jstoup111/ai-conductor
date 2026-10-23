# Sequence: `[test]` citation close, BUILD-boundary judgement, and operator acceptance

**Last updated:** 2026-10-21
**Scope:** Runtime flow for #3200, from `conduct task start` through close, the BUILD-boundary judgement, reopen, and the operator lever. Components are in [the component view](../done-when-closes-as-verified-citing-tests-that-don.md).

## Diagram

```mermaid
sequenceDiagram
    participant A as BUILD agent
    participant C as conduct task CLI
    participant S as task-status.json
    participant P as BUILD completion predicate
    participant E as conductor
    participant J as citation judge
    participant O as Operator
    A->>C: task start «id» (CLI or session hook)
    C->>S: in_progress, startHead = HEAD
    A->>C: task done «id» --done-when «n»=test:«path»::«title»
    C->>C: text checks (file at HEAD, title, Covers marker)
    alt title on a line added in startHead..HEAD
        C->>S: completed, source verified
    else untouched test or no startHead
        C->>S: completed, citation pending judgement
    end
    E->>E: settle checks refused last pass (re-closed, demoted, or dropped)
    E->>J: one native-schema judgement over all pending citations
    alt judgement unavailable (no schema provider or two failed dispatches)
        J->>S: every pending check unverified, cause recorded
    else asserts
        J->>S: source judged, verdict reason
    else does-not-assert, first refusal, attempt left
        J->>S: one citation obligation per task, task reopened, refusal count +1
        E-->>A: re-enter BUILD with the judge's reason (not a no-progress attempt)
    else does-not-assert, second refusal or last attempt
        J->>S: check unverified with the judge's reason (D8 path)
    end
    P->>S: read close records and obligations
    opt operator overturns a refusal
        O->>C: ai-conductor done-when accept --task «id» --check «n» --reason
        C->>S: source operator-accepted, check settled in its obligation
    end
    E->>E: emit citation events on the spine
```

## Legend

`startHead` is the commit recorded when the task started. A judgement dispatch that fails (provider failure or schema-invalid output) is a failed dispatch, not a refusal, and never consumes the bound. A task reopened by a refusal is not counted as resolved through its `Task:` trailers.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-21 | Initial sequence | #3200 |
