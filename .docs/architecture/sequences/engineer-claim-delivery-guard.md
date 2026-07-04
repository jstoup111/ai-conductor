# Sequence: Guarded claim walk + delivery-evidence recording (#243)

**Last updated:** 2026-07-04
**Scope:** The `engineer claim` walk with the delivery guard, and the `engineer handoff`
delivery paths that record evidence. Shows the exact #200/#234 strand scenario being
neutralized.

## Diagram

```mermaid
sequenceDiagram
  participant S as /engineer session
  participant C as claim CLI
  participant Q as file queue
  participant L as ledger
  participant G as GitHub - gh

  S->>C: conduct-ts engineer claim
  loop oldest-first walk
    C->>Q: claim()
    Q-->>C: candidate envelope «ref»
    C->>L: get(source, «ref»)
    alt entry has prUrl evidence
      C->>G: gh pr view «prUrl» - state
      alt PR open or merged
        C->>L: transition «ref» to done - auto-heal
        C->>Q: ack - drop duplicate envelope
        Note over C: continue walk - never served
      else PR closed unmerged
        Note over C,L: FR-39/40 reopen + churn cap path
      else lookup failed
        C->>Q: release - keep pending
        Note over C: fail safe - skip, never serve on uncertainty
      end
    else no delivery evidence
      C->>Q: ack
      C->>L: transition «ref» to claimed
      C-->>S: serve idea «ref»
    end
  end

  Note over S: session authors spec, then hands off

  S->>C: conduct-ts engineer handoff --source-ref «ref»
  alt PR opened
    C->>G: comment PR URL + handled label
    C->>L: transition done + prUrl + branch
  else local-commit fallback - PR open failed
    C->>L: record branch evidence - NEW, no longer strands claimed
    Note over S: operator finishes PR manually then runs engineer resolve
    S->>C: conduct-ts engineer resolve «ref» --pr-url «url»
    C->>L: transition done + prUrl - no JSON surgery
  end
```

## Legend

- `«ref»` = the intake sourceRef (e.g. `owner/repo#N`); `«prUrl»`/`«url»` = the spec PR URL.
- The **auto-heal** branch is the #200/#234 fix: an entry stranded at `claimed` with a
  recorded `prUrl` is healed to `done` and its duplicate envelope dropped, instead of being
  served to a fresh session.
- The **local-commit** branch closes the strand source: delivery evidence is recorded even
  when `gh pr create` fails (#290 gh ENOENT family).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | #243 claim delivery guard spec (engineer DECIDE) |
