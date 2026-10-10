# Sequences: Dependency Edge Authoring and Verification (#536)

**Last updated:** 2026-10-09
**Scope:** The three runtime flows: prose linking on issue events, the land-time proposal gate,
and the read-only drift pass.

## Flow 1: Prose declaration becomes a link

```mermaid
sequenceDiagram
  participant GH as GitHub
  participant ACT as label-sync Action
  participant REC as Reconciler
  participant W as Additive writer
  GH->>ACT: issues opened / edited (body)
  ACT->>REC: declared edges for «issue»
  REC-->>ACT: unambiguous forward same-repo edges (ambiguous, reverse, cross-repo, self → none)
  loop each edge
    ACT->>W: link «issue» blocked_by «N»
    W->>GH: GET existing, POST if absent
    W-->>ACT: created / already-present / failed (non-fatal)
  end
  ACT-->>GH: run output lists failures, never removes links
```

## Flow 2: Land-time proposal gate (intake ideas only)

```mermaid
sequenceDiagram
  actor OP as Operator
  participant LAND as compose land
  participant REC as Reconciler
  participant OVL as Overlap detection
  participant W as Additive writer
  participant SP as Event spine
  OP->>LAND: land --source-ref «owner/repo#N» [accept / decline / skip-ack]
  alt no source-ref
    LAND-->>OP: no proposals, no gate
  else source-ref present
    LAND->>REC: declared-but-unlinked edges for «N»
    LAND->>OVL: overlapping open issues / unmerged work for planned files
    alt tracker unreachable and no skip-ack
      LAND-->>OP: refuse, naming cause (land_gate_rejected)
    else proposals computed
      LAND->>LAND: drop proposals whose link already exists
      alt any proposal undecided
        LAND-->>OP: refuse, listing each undecided proposal + how to decide (land_gate_rejected)
      else all decided
        LAND->>W: write accepted edges only
        LAND->>SP: land_dependency_decided (shown, accepted, declined, skip, write results)
        LAND-->>OP: commit spec
      end
    end
  end
```

## Flow 3: Drift pass (on-demand and on-poll)

```mermaid
sequenceDiagram
  participant TRIG as Drift report verb / poll tick
  participant REC as Reconciler
  participant GH as GitHub
  participant SP as Event spine
  TRIG->>REC: sweep open issues of «repo»
  REC->>GH: body, blocked_by (incl. blocker state_reason)
  REC-->>TRIG: unlinked declarations · stale links (closed not-completed) · cycles · direction contradictions · indeterminate
  alt poll tick (bounded cadence)
    TRIG->>SP: one drift summary event, status swept or repository-indeterminate (empty lists when clean)
  else on-demand
    TRIG-->>TRIG: print report
  end
  Note over TRIG,GH: never creates, removes, or alters links, labels, or issues
```

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-09 | Initial generation | DECIDE for #536 |
