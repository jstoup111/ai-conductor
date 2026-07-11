# Sequence: Halt-PR presentation reliability

**Last updated:** 2026-07-05
**Scope:** The two flows that guarantee a halt PR carries the `needs-remediation` label + draft
status: (1) escalation with verify-after-write, and (2) the reconciliation sweep that heals PRs
which slipped through. Source: ai-conductor#274.

## Diagram — Flow 1: escalation with verify-after-write

```mermaid
sequenceDiagram
    participant C as Conductor (HALT)
    participant E as escalateBuildFailure
    participant P as pr-labels seam
    participant V as ensureHaltPresentation (verify+retry)
    participant GH as GitHub (gh CLI/REST)

    C->>E: surfaceRemediationPr(reason)
    E->>P: findOrCreatePr(branch, draft=true)
    P->>GH: gh pr create --draft  (or reuse OPEN PR)
    GH-->>P: prUrl
    Note over E,P: reuse of an existing OPEN ready PR<br/>returns non-draft, unlabeled — the #268/#269 gap
    E->>V: ensureHaltPresentation(prUrl)
    loop bounded attempts (backoff)
        V->>GH: assert body has «needs-remediation marker»
        V->>GH: assert draft (gh pr ready --undo if ready)
        V->>GH: REST add «needs-remediation» label
        V->>GH: re-read: isDraft + labels + body marker
        GH-->>V: observed state
        alt all three confirmed
            V-->>E: ok
        else missing any (e.g. rate-limited)
            Note over V: retry with backoff —<br/>on exhaustion leave for reconciliation sweep
        end
    end
    E->>GH: upsertComment(failure reason)
```

## Diagram — Flow 2: reconciliation sweep (startup + periodic tick)

```mermaid
sequenceDiagram
    participant D as runDaemon (startup / idle tick)
    participant R as reconcileHaltPrs (new sweep)
    participant GH as GitHub (gh CLI/REST)
    participant V as ensureHaltPresentation (verify+retry)

    D->>R: reconcileHaltPrs()
    R->>GH: enumerate OPEN PRs
    GH-->>R: PR list + bodies
    loop each PR whose body has «needs-remediation marker»
        R->>GH: read isDraft + labels
        alt missing label or not draft
            R->>V: ensureHaltPresentation(prUrl)
            V->>GH: re-assert draft + label (verify-after-write)
            Note over R,V: heals PRs broken before this code<br/>or by another checkout (#268/#269)
        else already draft + labeled
            Note over R: no-op (idempotent)
        end
    end
```

## Legend

- **ensureHaltPresentation** — new verify-after-write helper: writes desired state (body marker,
  draft, label) then re-reads to confirm, retrying bounded on failure. Idempotent — safe to call
  from both escalation and the sweep.
- **«needs-remediation marker»** — `conductor:needs-remediation` HTML comment written into the PR
  **body/description** (the durable, enumerable anchor). The existing same-named *comment* marker
  is retained for the human-facing failure reason.
- **reconcileHaltPrs** — new sweep hooked into `runDaemon` startup and the idle tick; the ultimate
  safety net when inline verify-after-write is exhausted (e.g. sustained rate-limit, #270).
- **Reuse gap** — `findOrCreatePr` reusing an OPEN ready PR is the likely root cause of #268/#269;
  escalation must force draft + label + body marker on the reuse path, not only on create.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-05 | Initial generation | Halt-PR reliability spec (ai-conductor#274) |
