# Sequence + Components: Build, charge and review a routed fix on the child that hosts it (#3211)

**Last updated:** 2026-10-15
**Scope:** Spec C of the four-spec split of `adr-2026-10-12-routed-whole-feature-repair`
(decision 18). It covers the routed-repair pass: entering the host's region, writing the frozen
rem blocks on the host's branch, charging the round once, binding repair obligations to the host's
branch, grading the repair against a pinned base under a per-round credit, and moving the round
upward only on a verified builder claim. The whole design is drawn in
[`whole-feature-audit-fixes-cannot-land-in-the-stack.md`](whole-feature-audit-fixes-cannot-land-in-the-stack.md),
and admission (spec B) in
[`admitted-whole-feature-fixes-in-a-stacked-feature-.md`](admitted-whole-feature-fixes-in-a-stacked-feature-.md).
These diagrams show only what this spec builds.

Covered (ADR decisions 5 and 9–12, plus the items spec B moved here):
- host region entry once per `(roundId, host)` for the round's current host: the entry pin, the switch, the `audit` restage, the verbatim frozen-block write and `admitted`→`repairing`;
- `Round:` stamping, membership from the `Child:` line, seal rotation over frozen ids, `closeChild`'s `red/c«k»` ref and verify-green acceptance in a routed pass;
- the typed round receipt settled at the first host's BUILD dispatch, taskless admission charging, the stored growth denominator, ledger reconciliation and rebuild;
- repair obligations keyed by round and bound to a branch;
- the `routed-repair` review base shared with testQuality, and `routedRepairCredit`;
- the verified prerequisite reroute, `reroute-moved` recovery and `remediation_rerouted`.

Built on spec B (#3243): `writeRoutingTransaction`, `createRouteRecord`, `transitionHost`,
`admitRound`, `reconcileRounds`, `allocateFrozenBlocks`, `selectHost`, `resolveExecutionChild` and
`routedRepairPhaseEvent`.

Out of scope, delivered by #3212: the `revalidate` round kind's restage arm, its verify-green pass
and its review bases; host exit (`built`, `done`), the no-commit exit and marker deletion; the
exit restack, the re-validation queue, host progression (`selectNextHost`) and the leaf return. After this spec a host builds in
`repairing` and stops there, which is unreachable while the routing setting stays off.

With the setting off, or when the cursor reports `no-child`, every path below collapses to today's
leaf remediation, byte for byte.

## Diagram: host region entry

```mermaid
flowchart TD
    R["loop reaches build, resolveExecutionChild returns routed-host (round's current host, may be the leaf)"] --> J{"restack journal terminal?"}
    J -- no --> HJ["needs-human HALT, no ref moves"]
    J -- yes --> PIN{"entry pin recorded for this host?"}
    PIN -- no --> P1["CAS entry pinnedBase and tree: closed/c«h», or leaf tip for the leaf host"]
    PIN -- yes --> SW
    P1 --> SW["verify or switchToChild to childBranchFor / leafBranchFor"]
    SW -- dirty tree --> HD["refuse naming the path, host stays admitted"]
    SW --> Q{"host already repairing for roundId?"}
    Q -- "yes (resume)" --> RC["reconcile engine-state obligations and task-status seed from the record, no restage, no append"]
    Q -- "no, host admitted" --> RS["restage acceptance_specs, build, test_suite, build_review in the host overlay (audit arm)"]
    RS --> WB["writeFrozenBlocks in remediation-append: frozen ids only, verbatim"]
    WB -- "same id, different body" --> HB["needs-human HALT naming the id"]
    WB -- "same id, identical body" --> SKIP["accepted, nothing appended"]
    WB --> CM["commitEngineChangeWhenStacked with Round trailer"]
    CM -- refused --> HC["HALT, host stays admitted"]
    CM --> OB["admit obligations keyed by roundId, findingId, taskIds; restage bound rows unless restage false"]
    SKIP --> OB
    OB --> SEED["seed task status with the execution projection (idempotent)"]
    SEED --> NOOP{"audit round: every task already complete on host tree?"}
    NOOP -- yes --> HN["HALT derived-already-complete"]
    NOOP -- no --> TX["one fenced transaction: host admitted to repairing, obligation bindings, outbox routed_repair_phase credit true"]
    TX -- cas failed --> HX["needs-human HALT naming the round"]
    TX --> CR["write routedRepairCredit to the host child ledger (reconciled from the record on resume)"]
    CR --> BD["BUILD dispatch (next diagram)"]
    RC --> BD
```

## Diagram: settlement at BUILD dispatch

```mermaid
sequenceDiagram
    participant C as conductor build closure
    participant RR as round-receipt
    participant L as kickback ledger (flat, leased)
    participant S as route-record store
    participant P as provider
    C->>RR: settleRoundAtDispatch(slug, roundId, dispatchingChild)
    RR->>L: acquire lease
    RR->>L: reconcile settled receipts by id (unlocked variant)
    RR->>S: read record
    alt record or receipt malformed
        RR-->>C: exhausted (HALT kickback-cap)
    else dispatchingChild is not current host
        RR-->>C: refused not-current-host
    else receipt already settled
        RR->>S: CAS add acks[child]
        RR-->>C: acknowledged
    else unsettled
        RR->>RR: check every effective lap cap and growth cap
        alt any cap exhausted
            RR-->>C: exhausted (receipt unsettled, allocation pending)
        else caps ok
            RR->>S: CAS receipt settled (laps, growth, settlementId)
            Note over RR,S: commit point
            alt cas failed
                RR->>S: re-read, ack only if receipt parses settled
                RR->>RR: journal open halts, other change retries up to 3 then halts
            end
            RR->>L: apply charges, settlementReceipts[settlementId]
            RR-->>C: settled
        end
    end
    RR->>L: release lease
    C->>P: dispatch builder
```

## Diagram: verified prerequisite reroute

```mermaid
sequenceDiagram
    participant B as builder on host «h»
    participant C as conductor routed build result
    participant V as verifyPrerequisiteClaim
    participant X as rerouteRound
    participant S as fenced routing transaction
    participant W as worktree
    B-->>C: structured result blocked-by-prerequisite, paths or symbols, child «j»
    C->>V: verify against closed/c«h» and closed/c«j» or leaf tip
    alt refused-not-above, unverified or malformed
        V-->>C: failed build attempt on host region caps
    else verified
        C->>X: rerouteRound
        X->>X: refuse if journal open, unstamped non-halt commit past closure, or destination not pending
        X->>S: pin rejected/«roundId»/«n», CAS host branch to closure, CAS marker to «j», merge allocation into «j», record fallback and phase reroute-moved, retarget obligation bindings, outbox remediation_rerouted
        alt cas failed
            S-->>C: needs-human HALT naming the round
        else committed
            X->>W: completeRerouteSync read-tree -m -u rejected tip to reset tip
            X->>S: CAS source rerouted, destination admitted
            X->>W: reconcile engine-state obligations from the record
            Note over X,W: resume finding reroute-moved finishes the sync first
            C->>C: region entry on «j» writes the same ids with Child «j», no charge
        end
    end
```

## Diagram: host phases written by this spec

```mermaid
stateDiagram-v2
    [*] --> pending: createRouteRecord (spec B)
    pending --> admitted: admitRound (spec B) or completeRerouteSync
    admitted --> repairing: enterHostRegion
    repairing --> reroute_moved: rerouteRound
    reroute_moved --> rerouted: completeRerouteSync
    repairing --> built: region exit (#3212)
    repairing --> done: no-commit exit (#3212)
```

## Diagram: components touched

```mermaid
flowchart LR
    subgraph routing["engine/routing"]
        HRE["host-region-entry.ts (new)"]
        RCPT["round-receipt.ts (new)"]
        PC["prerequisite-claim.ts (new)"]
        RT["route-types.ts: typed RoundReceipt, pinned base, fallback"]
        RS["route-record-store.ts: repairing and reroute ops"]
        RA["round-admission.ts: repairing and reroute-moved arms, taskless charge"]
        RE["routing-events.ts: remediationReroutedEvent"]
    end
    subgraph engine["engine"]
        CON["conductor.ts"]
        APP["remediation-append.ts: writeFrozenBlocks"]
        OBL["repair-obligations.ts / repair-restage.ts"]
        TP["task-progress.ts / autoheal.ts / task-seed.ts"]
        KL["kickback-ledger.ts / kickback-budget-cli.ts"]
        BRI["build-review-inputs.ts / child-cursor.ts / testQuality"]
        CLF["child-lifecycle.ts: red ref"]
        HK["git-hook-assets.ts + round-stamp-cli.ts"]
        SR["step-runners.ts: routed build requests the claim schema"]
        MEM["task-membership-check-cli.ts / task-cli.ts"]
        SEAL["protected-artifact-seal.ts"]
        ABP["as-built-projection.ts"]
    end
    CON --> HRE
    CON --> RCPT
    CON --> PC
    HRE --> APP
    HRE --> OBL
    HRE --> RS
    HRE --> CLF
    RCPT --> KL
    RCPT --> RS
    PC --> RS
    PC --> OBL
    PC --> RE
    SR --> PC
    RA --> RCPT
    RA --> PC
    BRI --> RT
    HK --> RT
    MEM --> APP
    SEAL --> RT
    ABP --> RT
    TP --> OBL
```

## Legend

- **host «h» / child «j»**: a closed child of the stack at position h or j; the leaf is the last host.
- **closure**: `refs/conductor/«slug»/closed/c«k»`, written by `closeChild`.
- **fenced routing transaction**: `writeRoutingTransaction`, one `update-ref --stdin` carrying a
  `verify` of the restack journal ref.
- **frozen allocation**: per-host rem ids and complete block bodies stored in the route record at
  admission (spec B). This spec only writes them, verbatim.
- Diamond outcomes ending in HALT write a needs-human halt unless labelled `kickback-cap`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-15 | Initial generation | Spec C DECIDE (#3211) |
| 2026-10-15 | Entry pin first, seed before repairing, resume verifies branch and reconciles obligations, settlement always reconciles under the lease, reroute merges into a pending destination; selectNextHost moved to #3212 | Codex review folded into the architecture review (F9–F17) |
| 2026-10-15 | Plan update: `writeFrozenBlocks` lives in `remediation-append.ts`; the routed build's structured claim is requested from `step-runners.ts`; custom-step kickbacks keep the ledger bump with a receipt echo | `/plan` (32 tasks) |
