# Sequence + Components: Accept an operator-recorded resolution for a stacked restack conflict above the repaired child (#3421)

**Last updated:** 2026-10-25
**Scope:** the conflict hand-off of `adr-2026-10-10-stacked-restack-journaled-replay` (decision 6)
when a `feature-repair` restack cannot replay a child above the repaired child. This spec adds:
- **A conflict record.** Every unresolved-conflict halt also writes a durable conflict record that
  survives the journal's cleanup. It holds the conflicted child, the child's journaled range
  (`oldParent`, `oldTip`), the parent the replay was building on (`newParent`), that parent's
  tree, and the ordered replay-candidate subjects. The halt text prints the exact rebase that
  produces a valid resolution, and the `stack restack-resolve` command that records it.
- **`ai-conductor stack restack-resolve --slug «slug» --child «k» --tip «sha»`.** It joins #3203's
  operator command family and runs under its feature dispatch lease. It validates the operator's
  tip against the conflict record. If the tip passes, it pins the tip at
  `refs/conductor/«slug»/restack/resolution/c«k»` and clears only the restack-conflict HALT it
  resolves.
- **Consuming the resolution.** At the next dispatch, before replaying child `«k»`'s range, the
  restack executor (and journal recovery's `resumePlanned`) checks for a pinned resolution. When
  the range matches the conflict record and the parent being built has the recorded parent's
  tree, it rebuilds the resolution onto that parent. This replay is mechanically clean because the
  base trees are identical. The result gets the shipped ownership check and is recorded with
  status `resolved`, exactly like a provider resolver's output. Any mismatch halts and names the
  mismatch.
- **Adjacent fixes in `routing/routed-exit.ts`.** The exit restack passes the provider resolver and
  its attempt cap. Its halt keeps the restack's own reason instead of the bare word `halted`.

No engine path moves a child branch to adopt an operator's work, and `planRestackRanges` is
unchanged. Tree equality, not commit identity, is required because replayed lower children are
re-stamped with the journal's committer date (`committerStamp` in `restack-executor.ts`), so the
same parent gets a different commit id on every run.

**Built on shipped code:**
- **Executor and recovery:** `runRestack`, `resumePlanned`, `haltUnresolvedConflict`,
  `haltRestackConflict`, `pinStagingRef`, `updateRestackChildStatus`, `cleanJournal`.
- **Replay and validation:** `replayChildRange`, `checkPathOwnership`, the replay-candidate
  selection in `restack-resolver.ts`, and a strict FR-9 subject-presence check over
  `newParent..tip`, with no supersession excuse.
- **Transition:** `applyRestackTransition` and `translateAfterRebase` with the child's rewrite map.
  The transition queues the resolved child and the children above it for re-validation, and the
  leaf gates re-run at `returnToLeaf`.
- **From #3203 (prerequisite):** the `stack` CLI family, the feature dispatch lease, and the
  atomic HALT clear used by rewind.

## Diagram: conflict, operator resolution, and consumption

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant Exit as routed exit
    participant Exec as restack executor
    participant Res as provider resolver
    participant Refs as conductor refs
    participant CLI as stack restack-resolve CLI
    participant Lease as feature dispatch lease
    participant Tr as restack transition

    Exit->>Exec: runRestack feature-repair, origin «h», with resolver and cap
    Exec->>Exec: adopt children through origin «h», replay child «k» onto new parent
    Exec->>Res: conflict on child «k»: resolve within cap
    Res-->>Exec: unresolved
    Exec->>Refs: pin original tip, abort journal
    Exec->>Refs: write conflict record: child «k», oldParent, oldTip, newParent, parent tree, candidate subjects
    Exec->>Exec: HALT restack conflict child «k», printing the rebase and the restack-resolve command
    Exit-->>Exit: halt detail keeps the restack reason
    Op->>Op: git rebase --onto newParent oldParent oldTip on a scratch branch, resolve, test
    Op->>CLI: stack restack-resolve --slug «slug» --child «k» --tip «sha»
    CLI->>Lease: acquire, refusing a live owner
    CLI->>Refs: read conflict record for «k», refuse if absent or for another child
    CLI->>CLI: tip descends from newParent, every candidate subject present, paths owned by «k»
    alt validation fails
        CLI-->>Op: refuse, naming the missing ancestor, subjects or paths, writing nothing
    else validation passes
        CLI->>Refs: pin tip at restack/resolution/c«k»
        CLI->>CLI: clear only the restack-conflict HALT for «k», release lease
    end
    Exit->>Exec: next dispatch: runRestack again
    Exec->>Exec: adopt through «h», reach child «k»
    Exec->>Refs: read resolution and conflict record for «k»
    alt range equals record and parent tree equals recorded tree
        Exec->>Exec: rebuild resolution commits onto the live parent, which is clean
        Exec->>Exec: ownership check, status resolved, rewrites from original commits by subject
        Exec->>Exec: replay children above «k» as today
        Exec->>Tr: apply: move refs, queue «k» and above for re-validation
        Tr->>Refs: delete resolution and conflict record in the applied transaction
    else mismatch
        Exec->>Exec: HALT restack-resolution-stale naming range or parent tree mismatch
    end
```

## Diagram: components touched

```mermaid
graph LR
    subgraph CLI["Operator CLI, extended from #3203"]
        RR["stack restack-resolve"]
    end
    subgraph Restack["engine/restack"]
        EX["restack-executor: runRestack"]
        RC["restack-recovery: resumePlanned"]
        CR["restack-conflict-record, new"]
        MV["restack-move: haltRestackConflict"]
        RP["restack-replay: replayChildRange"]
        OW["restack-ownership: checkPathOwnership"]
        RS["restack-resolver: candidate subjects"]
        TR["restack-transition"]
    end
    subgraph Routing["engine/routing"]
        RX["routed-exit: requestRoutedExit"]
    end
    subgraph Shared["shared engine"]
        FR9["strict candidate-subject presence check"]
        LEASE["feature dispatch lease, from #3203"]
        HALT["atomic HALT clear, from #3203"]
    end
    REFS[("refs/conductor/«slug»/restack/conflict and resolution/c«k»")]

    RX -->|resolver and cap| EX
    EX -->|unresolved conflict| MV
    EX --> CR
    RC --> CR
    CR --> REFS
    RR --> LEASE
    RR --> CR
    RR --> FR9
    RR --> OW
    RR --> RS
    RR --> HALT
    EX -->|consume resolution| RP
    RC -->|consume resolution| RP
    EX --> OW
    EX --> TR
    TR -->|delete on apply| REFS
```

## Legend

- **Conflict record:** durable state written at the conflict halt, kept outside `restack/staging/`
  so that `cleanJournal` does not delete it.
- **Resolution ref:** the operator's validated tip. It is written only by `stack restack-resolve`
  and deleted in the transaction that applies the restack.
- **Consumed:** used as child `«k»`'s resolver output instead of a replay of its range. Children
  above `«k»` still replay normally.
- «h» is the highest originating (repaired) child and «k» a child above it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-25 | Initial generation | #3421 DECIDE, approach B |
