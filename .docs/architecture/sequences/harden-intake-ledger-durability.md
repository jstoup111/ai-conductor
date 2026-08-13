# Sequence: Intake ledger mutation under lease, and the corrupt-read refusal

**Last updated:** 2026-08-12
**Scope:** One mutating ledger operation (`record` / `transition` / `forget` / `reopen` /
`requeueClaimed`) after intake #1476, covering the three outcomes that matter: the happy
path, a second concurrent process, and an unparseable ledger.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant P1 as Process A (e.g. engineer claim)
    participant P2 as Process B (e.g. engineer loop record)
    participant L as Ledger (intake/ledger.ts)
    participant LS as conduct-state-lease
    participant FS as .engineer/ filesystem
    participant OP as Operator (stderr / exit code)

    rect rgb(232, 245, 233)
    note over P1,FS: Happy path — lease serializes the read-modify-write
    P1->>L: transition(source, ref, "claimed")
    L->>LS: acquire()
    LS->>FS: mkdir ledger.json.lease/ (atomic)
    FS-->>LS: created
    LS->>FS: write owner.json (pid, token, acquiredAt)
    LS-->>L: ok, handle
    L->>FS: read ledger.json
    FS-->>L: bytes
    L->>L: JSON.parse — succeeds
    L->>L: apply mutation to in-memory store
    L->>FS: write ledger.json.tmp.«hex», rename over ledger.json
    L->>LS: handle.release()
    LS->>FS: rmdir ledger.json.lease/
    L-->>P1: resolved
    end

    rect rgb(255, 248, 225)
    note over P2,FS: Concurrent writer — waits rather than losing A's write
    P2->>L: record(source, ref)
    L->>LS: acquire()
    LS->>FS: mkdir ledger.json.lease/
    FS-->>LS: EEXIST — A holds it
    LS->>LS: retry every 10ms up to the acquire timeout
    note right of LS: If the owner pid is dead, the stale-owner<br/>recovery path quarantines the lease dir<br/>and takes ownership. A live owner is waited on.
    LS-->>L: ok, handle (after A releases)
    L->>FS: read ledger.json
    FS-->>L: bytes — now include A's mutation
    L->>FS: write both entries
    L-->>P2: resolved
    note over P2: Invariant — N processes each adding a<br/>distinct entry leave all N entries present.
    end

    rect rgb(255, 235, 238)
    note over P1,OP: Corrupt ledger — refuse, never overwrite
    P1->>L: transition(source, ref, "done")
    L->>LS: acquire()
    LS-->>L: ok, handle
    L->>FS: read ledger.json
    FS-->>L: truncated / malformed bytes
    L->>L: JSON.parse — throws
    L->>FS: copy bytes to ledger.json.corrupt-«timestamp»
    note right of FS: A COPY, not a rename — ledger.json keeps<br/>its original bytes, so the refusal is repeatable<br/>and no racing process sees an absent file.
    L->>OP: warn to stderr, naming both paths
    L->>LS: handle.release()
    L--xP1: reject — saveStore is never reached
    P1->>OP: non-zero exit, corrupt-ledger message
    note over OP: Operator learns at the moment of the corrupt read,<br/>not later by inferring it from duplicate spec PRs.
    end
```

## Legend

- **Green band:** the ordinary mutation. The only structural change versus today is that the
  load-mutate-save triple is bracketed by lease acquire and release.
- **Yellow band:** a second OS process attempting a mutation while the first holds the lease.
  The `mkdir` is the atomicity primitive — it either creates the directory or fails with
  `EEXIST`, with no window in between. Waiting is what makes concurrent writes additive
  instead of last-writer-wins.
- **Red band:** the corrupt read. Note that `write ledger.json` never appears in this band —
  that absence is the whole point of the change. Today this band ends with an empty store
  being written over the corrupt file.
- **`«timestamp»` / `«hex»`** are placeholders for the generated suffix values.

## Contrast with today's behavior

| Situation | Today | After #1476 |
|-----------|-------|-------------|
| File absent (first run) | Empty store, silent | Unchanged — empty store, silent |
| File unparseable | Empty store, silent, then persisted over the original | Bytes copied aside, operator warned, operation refused, original intact |
| Two processes mutating | Interleaved read-modify-write; one write is lost | Serialized by lease; both writes present |
| Lease holder crashes | n/a | Stale-owner recovery reclaims after a liveness probe |

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-12 | Initial generation | Intake #1476 — document the mutation path, the concurrent-writer path, and the corrupt-read refusal |
