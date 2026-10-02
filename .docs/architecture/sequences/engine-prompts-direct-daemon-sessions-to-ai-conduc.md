# Sequences: Daemon session command compatibility and visibility

**Last updated:** 2026-10-02
**Scope:** Three primary flows for #2709. These describe proposed observable behavior and ownership; the architecture review owns concrete interception and transport decisions.

## Pre-merge instruction compatibility

```mermaid
sequenceDiagram
  participant CI as Repository validation
  participant A as Instruction audit
  participant S as Prompt and skill sources
  participant P as Production session policy
  CI->>A: Check managed command instructions
  A->>S: Discover commands and execution contexts
  A->>P: Evaluate managed command invocations
  alt Managed instruction is blocked
    A-->>CI: Fail with source location and subcommand
  else Commands are compatible
    A-->>CI: Pass
  end
  Note over A,S: Interactive-only commands remain valid outside managed sessions
```

## Runtime command refusal

```mermaid
sequenceDiagram
  participant S as Managed session for «slug»
  participant G as CLI entry guard
  participant P as Producer-owned occurrence file
  participant T as Existing external-event tail
  participant B as Canonical event spine
  participant L as Feature ledger and daemon log
  S->>G: Invoke blocked subcommand
  G->>G: Refuse before command dispatch
  G->>P: Append bounded refusal with stable identity
  T->>P: Read and validate complete occurrence
  T->>B: Project with persistence acknowledgement
  B->>L: Persist and render occurrence
  G-->>S: Nonzero result and refusal diagnostic
  Note over G,B: Reporting failure never permits the refused command
```

## GitHub bypass visibility

```mermaid
sequenceDiagram
  participant S as Managed session for «slug»
  participant O as Managed PATH gh wrapper
  participant X as Resolved real gh transport
  participant P as Producer-owned occurrence file
  participant T as Existing external-event tail
  participant B as Canonical event spine
  participant L as Feature ledger and daemon log
  S->>O: Ordinary PATH-resolved gh invocation
  O->>O: Classify guarded invocation, read, or unguarded mutation
  alt Unguarded mutation
    O->>P: Append attempt before execution
    O->>X: Forward original command once
    X-->>O: Result or termination if observed
    O->>P: Append correlated terminal result if observed
    T->>P: Read and validate complete records
    T->>B: Project with persistence acknowledgement
    B->>L: Persist once by id and render
  else Read or guarded operation
    O->>X: Forward known read without bypass observation
  end
  Note over O,L: Guarded operations use private transport outside the wrapper
  Note over O,L: Storage failure reports degradation and still forwards once
  Note over T,L: Feature owner awaits final drain before sinks detach
```

## Legend

Participants are responsibility boundaries, not additional services. Ledger and log are existing consumers of the shared event schema. Cross-process delivery uses separate producer files carrying the existing event schema, projected through the existing tail; canonical persistence acknowledges durable delivery and deduplicates replay. The visibility flow does not itself grant authorization or require a new blocking policy.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-01 | Initial three-flow view | DECIDE for #2709 |

| 2026-10-02 | Plan update: producer files, acknowledged projection, private transport and drain | Make approved ownership concrete for Tasks 10–19 |
