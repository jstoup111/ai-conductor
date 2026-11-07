# Sequence + Components: Land manual changes in the stacked child that owns them, and rewind closed children (#3203)

**Last updated:** 2026-10-24
**Scope:** the operator route round of `adr-2026-10-24-operator-route-round-for-closed-stacked-children`.
It is a third route kind on the routed-repair machinery of `adr-2026-10-12-routed-whole-feature-repair`,
with origin `land` or `rewind`:
- a durable feature dispatch lease excludes the daemon and every other writer while an operator
  command mutates the feature;
- `ai-conductor stack land --child «k» [--carry «j»…]` opens a round on a closed child. It checks
  mechanical preconditions first. It then parks the feature with an owned token, installs the commit
  guard, and switches the worktree to that child's branch;
- while any round is open, the commit guard refuses commits on every branch but the host;
- the preflight halts on three things: an undeclared round, a moved branch, and a closed-child
  commit no round carried. With routing on, automatic co-origins and the automatic `feature-repair`
  restack are retired;
- `stack land --done` records the declaration. The daemon then re-validates the child from
  `acceptance_specs` and leaves through the shipped routed exit, re-validation queue and leaf gates;
- `stack land --abandon` resets the host to its closure through recorded stages;
- `rewind --child «k»` on a closed child opens a declared round instead of refusing;
- `ai-conductor stack owners` reports which child introduced each path, so the shipped skill can
  judge the owner.

Published stacks are out of scope: every entry point refuses on an active publication record and
names #3268. Slice topology is read through the #3365 loader (`loadSliceTopology`).

**Built on shipped code:**
- **Route-record store and writer:** `writeRoutingTransaction`, `createRouteRecord`,
  `transitionHost`, `drainRoutingOutboxes`, `nextRoundId`, `routingFenceOpen`.
- **Admission and reconciliation:** the marker transaction of `admitRound`, `reconcileRounds`,
  `routedRoundOpen`.
- **Region entry and exit:** the pin and restage helpers of `enterHostRegion`, `requestRoutedExit`,
  `returnToLeaf`, `consumeLowestQueued`, `grantRoutedRepairCredit`.
- **Cursor and execution child:** `resolveActiveChild`, `resolveExecutionChild`,
  `resolveChildBase` (`routed-repair` base).
- **Guards and leases:** `park-marker.ts`, `publishedStackRefusal`, `createConductStateLease`,
  `isJournalOwnerAlive`, `writeGitHooksAndWire`.

## Diagram: landing a manual change

```mermaid
sequenceDiagram
    autonumber
    actor Op as Person landing the change
    participant CLI as stack land CLI
    participant Lease as feature dispatch lease
    participant Store as route-record store
    participant WT as feature worktree
    participant Hook as commit guard
    participant Pre as stack preflight
    participant Region as host region of child «k»
    participant Exit as routed exit and queue

    Op->>CLI: stack land --slug «slug» --child «k» --carry «j» --reason «why»
    CLI->>Lease: acquire, refusing a live owner
    CLI->>CLI: open predicate: stacked, routing on, unpublished, «k» closed below the leaf, verify-green contract or no owned criteria, every raw-commit child carried and above «k», no round, queue or open journal, clean tree
    CLI->>CLI: park with a fresh token, ownership recorded only if this call created it
    CLI->>Store: record prepared: operator section with entryStep, carried tips, other branch tips, prior region, park token
    CLI->>WT: refresh hooks so the guard is installed
    CLI->>Store: marker transaction: marker host «k», host admitted, round open, events in outbox
    CLI->>WT: pin entry at the closure, switch to feat/c«k»/«slug», restage from acceptance_specs, host repairing, credit
    CLI->>Lease: release, the park stays
    loop person edits
        Op->>WT: commit on feat/c«k»/«slug»
        WT->>Hook: accepted
        Op->>WT: commit on another branch of the feature
        WT->>Hook: refused unless halt-record-only
    end
    Note over Pre: if dispatched before --done, the preflight halts operator-round-undeclared
    Op->>CLI: stack land --done
    CLI->>Lease: acquire
    CLI->>CLI: declare predicate: on host branch, clean, tip past closure, other and carried branches unmoved, journal terminal
    CLI->>Store: declaration, reason into the host work order, event in outbox
    CLI->>CLI: clear an operator halt it resolves, release lease and owned park
    Pre->>Store: reconcile: declared operator round, navigate to entryStep
    Pre->>Region: region loop starts at acceptance_specs
    Region->>Region: verify-green, test_suite, build_review against the pinned closure with the operator work order
    alt a gate fails
        Region->>Region: kickback to build inside «k», under its caps and routed-repair credit
    end
    Region->>Exit: requestRoutedExit: host built, feature-repair restack from «k» with carried co-origins
    Exit->>Exit: applied: marker deleted, host restacked, queue generation written
    Exit->>Exit: re-validate every queued closed child above «k», bottom-up
    Exit->>WT: returnToLeaf, leaf whole-feature gates re-pended
```

## Diagram: abandoning a landing

```mermaid
sequenceDiagram
    autonumber
    actor Op as Person landing the change
    participant CLI as stack land CLI
    participant Lease as feature dispatch lease
    participant Store as route-record store
    participant WT as feature worktree

    Op->>CLI: stack land --abandon
    CLI->>Lease: acquire, then take an owned park
    CLI->>CLI: abandon predicate: operator round open, host admitted, repairing or abandoning (resumes its recorded stage), clean against the recorded tip
    CLI->>Store: stage moved: pin tip at rejected/«roundId»/«k», CAS host branch to its closure, host abandoning
    CLI->>WT: stage synced: read-tree from the rejected tip to the closure, restore prior region statuses and verdicts
    CLI->>Store: host abandoned, marker deleted, event in outbox
    CLI->>WT: returnToLeaf in abandon mode: switch and close the round, no leaf-gate restage
    CLI->>Lease: release lease and owned park
    Note over Store: carried children keep their commits and halt again until landed
```

## Diagram: rewinding a closed child

```mermaid
sequenceDiagram
    autonumber
    actor Op as Operator
    participant RW as rewind CLI
    participant Lease as feature dispatch lease
    participant Store as route-record store
    participant WT as feature worktree
    participant Pre as stack preflight

    Op->>RW: rewind --child «k» --to «step» --reason «why»
    RW->>RW: existing preflight: HALT present
    RW->>Lease: acquire
    RW->>RW: open predicate for «k»
    RW->>Store: record kind operator, origin rewind, entryStep «step», declared at creation, marker, host admitted
    RW->>WT: pin entry, switch to feat/c«k»/«slug», restage «k» from «step», host repairing
    RW->>RW: clear HALT as today, release lease
    Pre->>WT: next dispatch navigates to «step» in the host region
    Note over Pre: exit, queue and leaf return as in the landing diagram, children above are not demoted
```

## Diagram: operator host phases

```mermaid
stateDiagram-v2
    [*] --> prepared: stack land or rewind
    prepared --> admitted: marker transaction
    prepared --> [*]: crash before marker, record deleted
    admitted --> repairing: entry pinned, worktree on host
    repairing --> repairing: stack land --done records the declaration
    repairing --> built: region passes, exit requested
    repairing --> done: no-commit exit, rewind only
    built --> restacked: restack applied
    admitted --> abandoning: stack land --abandon
    repairing --> abandoning: stack land --abandon
    abandoning --> abandoned: sync and restore recorded
    restacked --> [*]: queue, leaf return
    done --> [*]: leaf return
    abandoned --> [*]: leaf return without restage
```

## Diagram: preflight decision

```mermaid
graph TD
    A[stack preflight, conductor resume or daemon re-kick, after journal recovery] --> L{routing eligible?}
    L -- no --> Z[shipped behaviour, automatic restack unchanged]
    L -- yes --> B{operator round open?}
    B -- no --> P{closed child has non-halt commits past its closure?}
    P -- yes --> V{published stack?}
    V -- yes --> W[shipped published-stack HALT naming the child and #3268]
    V -- no --> Q[HALT unlanded-closed-child-commits, prints stack land --slug --child --carry]
    P -- no --> S[shipped routing and cursor path]
    B -- yes --> T{host admitted or repairing and a recorded branch moved?}
    T -- yes --> U[HALT operator-round-branch-moved]
    T -- no --> C{declared?}
    C -- no --> H[HALT operator-round-undeclared]
    C -- yes --> N[reconcile: navigate to entryStep, or exit, queue, leaf return]
    N --> X{exit finds a co-origin the round did not carry?}
    X -- yes --> Q
    X -- no --> R[routed exit restack]
```

## Diagram: components touched

```mermaid
graph LR
    subgraph CLI
        SL[stack-land-cli.ts: open, resume, done, abandon]
        SO[stack-owners-cli.ts: path to child]
        RWC[rewind.ts: closed-child arm]
        CAT[cli.ts and cli-pre-dispatch.ts: stack group, rewind --child --reason]
    end
    subgraph Routing
        RT[route-types.ts: kind operator, operator section, abandoning and abandoned]
        OR[operator-round.ts: predicates, openOperatorRound, declare, abandon stages]
        RA[round-admission.ts: operator reconcile and entryStep navigation]
        HE[host-region-entry.ts: shared pin and restage, undeclared refusal]
        RX[routed-exit.ts: uncarried co-origin halt, abandon-mode leaf return]
        RR[round-receipt.ts and prerequisite-claim gate: exhaustive kind switches]
    end
    subgraph Guards
        FL[feature-dispatch-lease.ts]
        CG[stack-commit-guard CLI]
        GH[git-hook-assets.ts: pre-commit wiring]
        SP[stack-preflight.ts: operator halts, raw-commit halt]
        PK[park-marker.ts: owned park token]
    end
    subgraph Shipped
        ST[slice-topology.ts from #3365]
        PB[stack-publication.ts]
        CC[child-cursor.ts and execution-child.ts]
        DD[daemon dispatch and re-kick]
    end
    SK[skills/stack-land] --> SO
    SK --> SL
    SL --> OR
    RWC --> OR
    OR --> FL
    OR --> PK
    OR --> PB
    OR --> ST
    OR --> RT
    OR --> HE
    DD --> FL
    SP --> RA
    RA --> RT
    GH --> CG
    CG --> RT
    CG --> CC
    HE --> RX
    RX --> RR
    SO --> ST
```

## Legend

- **Operator round:** a route record of kind `operator`. Origin `land` opens undeclared and waits for
  `--done`; origin `rewind` is declared at creation.
- **Host:** the closed child the round re-opens. The leaf is never an operator host.
- **Carried child:** a closed child above the host whose existing post-closure commits the round
  carries as a co-origin of its exit restack.
- **Declaration:** the person's statement that the change is complete, recorded with the host tip.
  The host stays `repairing`; the declaration is a record field, not a host state.
- **Feature dispatch lease:** a durable per-feature lease with process liveness. Daemon dispatch
  and re-kick hold it for the unit and re-check the park; an interactive conductor run holds it
  without consulting the park; the four new operator commands hold it for their mutation.
- **Commit guard:** a pre-commit step. While any marker exists, it refuses a commit on any branch of
  the feature other than the host, unless every staged path is the halt record. After an operator
  declaration it also refuses host commits outside a daemon session.
- `«k»`, `«j»`, `«slug»`, `«roundId»`, `«step»`: placeholders.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | #3203 DECIDE |
| 2026-10-24 | Owned park, carrying of raw closed-child commits, recorded branch tips, region entry at acceptance_specs | Operator decisions during architecture review |
| 2026-10-24 | Coherence-judge fixes: tip check before the undeclared check, abandon resumes an `abandoning` host | Coherence check |
| 2026-10-24 | Conflict-check resolutions: publication checked before the unlanded halt, interactive runs take the lease without the park re-check, no cascade check at open, `--adopt` renamed `--carry` | Conflict check |
| 2026-10-24 | Feature dispatch lease, token park, carried co-origins and the uncarried co-origin halt, guard in every round kind, staged abandon, rewind without demoting children above | Adversarial review findings and operator lease decision |
