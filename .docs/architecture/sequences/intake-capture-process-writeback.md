# Sequence: Capture → Process → Write-back — Phase 9.3b

**Last updated:** 2026-06-27
**Scope:** the async lifecycle of one github-issue idea from poll to spec PR + write-back,
including idempotent re-poll and auto-reopen.

## Diagram

```mermaid
sequenceDiagram
  actor Op as Operator
  participant CLI as conduct-ts engineer
  participant GHA as github-issues adapter
  participant GH as GitHub (gh)
  participant LED as ledger (.engineer/ledger.json)
  participant Q as IntakeQueue (.engineer/inbox)
  participant LOOP as engineer loop

  Note over Op,GH: Capture (poll-on-launch OR `engineer poll`)
  Op->>CLI: launch (or cron: engineer poll)
  CLI->>GHA: poll()
  GHA->>GH: issue list --assignee @me --state open (per registered repo)
  GH-->>GHA: open assigned issues
  GHA->>LED: known(sourceRef)? + handled-label?
  alt new (not in ledger, no label)
    GHA->>LED: record pending
    GHA->>Q: enqueue(Envelope)
  else already seen / labeled
    GHA-->>CLI: skip (idempotent pull — captured exactly once)
  end

  Note over CLI,LOOP: Process (interactive, one idea per session)
  CLI->>Q: claim() oldest
  Q-->>CLI: Envelope (claimed) -- or empty → fall back to chat
  CLI->>LOOP: route → DECIDE → open spec PR
  LOOP->>GHA: report(routed,{repo})
  GHA->>GH: comment "Routed to <repo>"
  LOOP->>GHA: report(done,{prUrl})
  GHA->>GH: comment "Spec PR opened: <url>" + apply engineer:handled
  LOOP->>Q: ack() → done
  LOOP->>LED: mark done {prUrl}

  Note over Op,LED: Re-eligibility (next poll)
  CLI->>GHA: poll() (later)
  GHA->>GH: pr view <prUrl> --json state,mergedAt
  alt spec PR CLOSED & not merged & attempts<2
    GHA->>GH: remove engineer:handled
    GHA->>LED: reset unseen, attempts++
    Note right of LED: re-enters inbox on this poll
  else MERGED, or attempts==2
    GHA-->>CLI: terminal (merged) / needs-manual (forget to re-enable)
  end
```

## Notes

- **Write-back is non-fatal (FR-37):** a failed `report()` is logged and swallowed — `ack`/ledger
  `done` still proceed (the spec PR is the real artifact).
- **Idempotent write-back (FR-38):** `report()` checks-before-write per `(sourceRef,status)`.
- **Claim isolation (FR-30):** `claim()`/`ack()`/`release()` use the queue's own atomic primitive,
  independent of the daemon `O_EXCL` lock.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-27 | Initial generation | Phase 9.3b lifecycle |
