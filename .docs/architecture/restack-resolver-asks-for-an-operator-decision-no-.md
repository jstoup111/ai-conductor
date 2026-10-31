# Sequence + Components: Deliver an operator decision to the stacked restack resolver (#3478)

**Last updated:** 2026-10-31
**Scope:** the stacked restack conflict hand-off that #3421 shipped as #3522
(`adr-2026-10-25-operator-recorded-restack-conflict-resolution`). This spec extends it in three
ways and fixes one adjacent defect:

- **A written decision instead of a tip.**
  - **Command.** `ai-conductor stack restack-resolve --slug «slug» --child «k» --decision «answer»`
    is the sibling of `--tip`. The two flags are mutually exclusive.
  - **Shared machinery.** It runs under the same feature dispatch lease and the same check that the
    conflict record matches the live HALT. It uses the same atomic HALT clear.
  - **Storage.** Instead of a resolved tip, it pins a decision blob at
    `refs/conductor/«slug»/restack/decision/c«k»`. The blob is bound to the conflict's identity:
    child, the range's `oldParent` and `oldTip`, the conflicting commit, and its paths. It is not
    bound to the per-run `opId`.
- **The resolver receives the decision.**
  - **When.** At the next restack, a decision whose identity matches the range being replayed is
    passed to the provider resolver: `ResolutionContext.operatorDecision`, then the
    `resolveRebaseConflict` prompt.
  - **Outcomes.** If the resolver then settles the replay, the shipped path applies it unchanged. If
    it still escalates, the new HALT states that the recorded decision was applied and did not
    settle the conflict.
  - **Stale decisions.** A decision whose range no longer matches is not delivered. The restack
    escalates as today and names the stale decision.
- **Base-refresh conflicts get the same hand-off.**
  - **Today.** The conflict record, the `Restack-Conflict` halt line and the recipe are written only
    for `feature-repair` journals.
  - **Change.** A `base-refresh` conflict writes them too, so `--tip` and `--decision` both work for
    either cause.
  - **Candidates.** A base-refresh record's candidate subjects are the resolver's replay
    candidates, which already omit patch-equivalent commits from the new default.
- **Out of scope: the stale `HALT.cleared` body.** It was split to jstoup111/ai-conductor#3551 on 2026-10-31.
  `HALT.cleared` is the prd_audit over-scope carrier, and the daemon clear-watcher reads whether it
  exists to tell a re-kick from an operator clear (`watchHaltCleared` in `daemon-deps.ts`). Neither
  belongs to restack. This spec's `--decision` clear uses the shipped `clearHaltAtomically`
  unchanged.

A decision is consumed by the same lifecycle as a tip. The ready→moved transaction verifies the
decision ref is unchanged. The applied transaction deletes it together with the conflict record
and parent pin. An aborted or halted restack keeps it. Feature teardown deletes it by name.

**Built on shipped code:**
- **Restack engine:** `runRestack`, `resumePlanned`, `haltRecordedRestackConflict`,
  `writeConflictRecord` / `readConflictRecord`, `consumeRecordedResolution`, `resolveRestackConflict`,
  `applyRestackMove`, and `appliedTransactionLines`.
- **CLI:** `dispatchStackRestackResolve`, `checkRestackResolution`, `acquireFeatureDispatchLease`,
  `clearHaltAtomically`, and `featureConductorRefNames`.
- **Events:** a new `restack_decision` member beside the shipped `restack_resolution`, whose required `tip` a decision does not have.

## Diagram: decision, delivery, and escalation

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant Exec as restack executor or recovery
    participant Res as provider resolver
    participant Refs as conductor refs
    participant CLI as stack restack-resolve CLI
    participant Spine as event spine

    Exec->>Res: replay child «k», feature-repair or base-refresh, resolve within cap
    Res-->>Exec: unresolved, missing decision «question»
    Exec->>Refs: write conflict record: child, range, newParent, tree, candidates, commit, paths
    Exec->>Exec: HALT restack conflict child «k» with Restack-Conflict line and both recipes
    Op->>CLI: stack restack-resolve --slug «slug» --child «k» --decision «answer»
    CLI->>CLI: acquire lease, record names «k», live HALT matches, decision non-empty
    alt refused
        CLI-->>Op: refuse naming the cause, write nothing
    else accepted
        CLI->>Refs: pin decision blob at restack/decision/c«k», compare-and-swap
        CLI->>Spine: restack_decision action recorded, child, conflict identity, operator
        CLI->>CLI: clear HALT atomically, release lease
    end
    Exec->>Refs: next restack reaches child «k»: read decision and record
    alt decision identity matches this range
        Exec->>Spine: restack_decision action applied
        Exec->>Res: resolve with operatorDecision in context and prompt
        alt resolver settles the replay
            Res-->>Exec: resolved, ownership check, status resolved
            Exec->>Refs: applied transaction deletes decision, record and parent pin
        else still unresolved
            Exec->>Exec: HALT naming the applied decision and the new reason, keep decision
        end
    else range differs
        Exec->>Res: resolve as today, no decision delivered
        Exec->>Exec: on escalation, HALT names the stale decision
    end
```

## Diagram: components touched

```mermaid
graph LR
    subgraph CLI["Operator CLI"]
        RR["stack restack-resolve: --tip or --decision"]
    end
    subgraph Restack["engine/restack"]
        EX["restack-executor: runRestack"]
        RC["restack-recovery: resumePlanned"]
        CH["restack-conflict-halt: both causes"]
        CR["restack-conflict-record: decision blob"]
        RS["restack-resolver: resolveRestackConflict"]
        MV["restack-move: verify and delete lines"]
    end
    subgraph Shared["shared engine"]
        CTX["rebase: ResolutionContext.operatorDecision"]
        SR["step-runners: resolveRebaseConflict prompt"]
        RW["rewind: clearHaltAtomically, unchanged"]
        EV["types/events: restack_decision, new member"]
    end
    REFS[("refs/conductor/«slug»/restack/conflict, resolution/c«k», decision/c«k»")]

    RR --> CR
    RR --> RW
    RR --> EV
    EX --> CH
    RC --> CH
    CH --> CR
    CR --> REFS
    EX -->|matching decision| RS
    RC -->|matching decision| RS
    RS --> CTX
    CTX --> SR
    EX --> EV
    MV --> REFS
```

## Legend

- **Restack executor or recovery:** `runRestack`, or journal recovery's `resumePlanned`. Both reach
  the same conflict halt and the same decision lookup.
- **Conflict identity:** child, range `oldParent` and `oldTip`, conflicting commit, and paths. The
  `opId` is excluded because every restack run mints a new one.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-31 | Initial generation | DECIDE for #3478 (merged with #3460), building on #3522 |
