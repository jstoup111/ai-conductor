# Sequence + Components: Route whole-feature audit fixes to the owning stacked child

**Last updated:** 2026-10-12
**Scope:** How work admitted by a leaf whole-feature gate is placed in the stacked child that owns
it, built and re-validated there, and carried up the stack (#2944). It also covers re-validating
every closed child a restack moved. The manual landing aid and the closed-child rewind are #3203,
which builds on this machinery.

Covered:
- classification-first admission (unchanged), owner derivation, residue judgement and the
  cannot-host checks;
- the ref-backed route record with its round receipt and event outbox, and marker-first admission
  that survives a crash;
- the `routedRepair` cursor field and the routed-repair entry and exit transitions;
- rem-* appends on the host child's checked-out branch and their deterministic merge on replay;
- the durable re-validation queue fed by every restack transition, and its bound;

Delivery is split across four specs: #2944 (foundation, dark), #3210, #3211 and #3212 (ADR decision
18). These diagrams show the whole design.

Out of scope:
- the manual landing CLI, its shipped skill and the closed-child rewind (#3203);
- publishing a routed fix to a child PR, including the PR comment (#2945);
- per-child custom steps (#2947).

Routing is entered only when the cursor reports durable child state. When the cursor says `no-child`
(N=1, an unsliced plan, or stacking never started), every path below collapses to today's leaf-only
remediation, byte for byte. A feature that already has children keeps stacked routing and recovery
even if `stacked_prs.enabled` is later turned off, matching `child-cursor.ts` today.

## Definitions used by every diagram

The terms are defined normatively in `adr-2026-10-12-routed-whole-feature-repair`. In short:
- **Admitted work.** Task work orders (FIXABLE, REMEDIABLE, refusal rework, merged `/remediate`
  gaps) and taskless obligations (`manual_test` FAIL, post-region custom-step kickbacks).
  Classification is unchanged and runs first.
- **Owner.** Mechanical for task-bound work (`taskSlices`, or a rem task's `Child:` line). For the
  residue it comes from one engine-owned routing call: ambiguous answers take the earliest
  candidate, and invalid answers halt.
- **Host.** The child that builds the fix. It defaults to the owner and moves upward only on
  prerequisite-input evidence. The host may be the leaf, which has no closure and is processed last.
- **Execution child.** The routed host, else the re-validating child, else the cursor child. Every
  consumer reads it. The restack planner keeps the leaf as the active range.
- **Durable homes.** Every item below lives under `refs/conductor/«slug»/` and is written only
  through `update-ref --stdin` compare-and-swap.
  - `routes/«roundId»`: frozen allocation, per-host state, round receipt and event outbox.
  - `rejected/«roundId»/«n»`: pins of rejected host tips. They live in a sibling namespace because git
    cannot nest refs under the `routes/«roundId»` ref.
  - `repairing`: the marker.
  - `revalidate`: the queue, with its own outbox.

  The ledger in `.pipeline/` is written after the receipt's commit point and reconciled by receipt
  id.

## Diagram: routing a leaf gate verdict

```mermaid
flowchart TD
    V["leaf whole-feature gate verdict (prd_audit, as-built, manual_test, custom step)"] --> CL{"classification and admission (unchanged)"}
    CL -- "PLAN_GAP, DESIGN, OVER_SCOPE, malformed, no-owner" --> HALT["halt or refuse exactly as today"]
    CL -- "admitted work" --> CH{"cursor: durable children?"}
    CH -- "no-child" --> N1["today's leaf remediation or kickback, byte for byte, no routing ref touched"]
    CH -- yes --> OW{"task-bound?"}
    OW -- "yes" --> OWN["owner = taskSlices or rem task Child line"]
    OW -- "FAIL rows in a mixed round" --> MIX["owner = earliest task-owned host, FAIL rows ride every hint"]
    OW -- "other residue" --> JUD["engine routing call {child, candidates, rationale}, one re-ask"]
    JUD -- "invalid after re-ask" --> HR["needs-human HALT naming the item"]
    JUD -- "ambiguous or several" --> DEF["owner = earliest candidate, residue-default"]
    JUD -- "one valid child" --> OWN2["owner = judged child"]
    OWN --> PRE{"every prerequisite input present at owner closure?"}
    MIX --> PRE
    DEF --> PRE
    OWN2 --> PRE
    PRE -- yes --> HOST["host = owner"]
    PRE -- no --> UP{"earliest later closure, else leaf tip, holding every input?"}
    UP -- found --> HOSTL["host = that child, reason prerequisite-paths"]
    UP -- none --> HR2["needs-human HALT naming missing paths"]
    HOST --> REC["CAS-create route record phase prepared: items, frozen allocation for all hosts, receipt, outbox"]
    HOSTL --> REC
    REC --> ORD["hosts ordered by position, leaf-hosted items last"]
    ORD --> RR["admit lowest host (next diagram)"]
```

## Diagram: admission, entry and exit of a routed repair on child «k»

```mermaid
sequenceDiagram
    participant Gate as gap loop + router
    participant Rt as route record
    participant Pre as stack preflight + resume
    participant Ck as child «k» region (execution child)
    participant Led as ledger
    participant Rs as restack (#2943)
    participant Spine as event spine

    Gate->>Rt: CAS-create, phase prepared
    Gate->>Rt: one update-ref transaction: create repairing marker {k, roundId}, host k admitted, outbox remediation_routed
    Rt->>Spine: drain outbox (persist, then CAS-remove)
    Gate->>Gate: navigate the leaf back to build (host region sentinel), leaf gates restaged stale
    Pre->>Pre: journal recovery first, then round reconciliation by phase table, then resolveActiveChild
    Pre->>Pre: host admitted or repairing, so skip the automatic feature-repair restack
    Ck->>Ck: region entry once per roundId: switch to feat/c«k», restage acceptance_specs, build, test_suite, build_review
    Ck->>Ck: append frozen blocks (Child k, Round stamp), seed task status with the execution projection, host repairing
    Ck->>Ck: obligation boundary {feat/c«k», head} and tree baseline taken here, existing-task restaged here
    Ck->>Rt: first host BUILD dispatch: settlement CAS (gate laps, declared growth, taskless charges), the commit point
    Rt->>Led: write ledger after the commit point, reconcile by receipt id on resume
    alt builder returns blocked-by-prerequisite {items, child j}
        Ck->>Ck: verify absent at closure(k), present at closure(j), j above k, no non-round commits, no open journal
        alt verified
            Ck->>Rt: one transaction: pin rejected tip, CAS feat/c«k» to closure(k), marker to j, fallback, obligation re-targeted
            Ck->>Ck: read-tree -m -u sync, same ids and bodies re-materialised on j, no new charge
            Rt->>Spine: remediation_rerouted {k to j}
        else not verified
            Ck->>Ck: ordinary failed attempt within k's caps
        end
    end
    Ck->>Ck: acceptance (retained RED), build, test_suite, build_review against closure(k) at entry, routedRepairCredit
    Ck->>Rt: CAS host k built
    Ck->>Rs: feature-repair restack, halt unless plan.originating equals [k]
    Rs->>Rs: replay k+1 upward, rem block union merge before the resolver
    Rs->>Rs: journal carries route, marker and queue old values
    Rs->>Rt: applied transaction: closure(k) cascade count, marker deleted, host k restacked, next queue generation
    Note over Rs,Rt: rollback or any non-applied terminal leaves marker and record untouched
    Rt->>Spine: routed_repair_phase {k, restacked}
    Pre->>Pre: crash while built: preflight runs this exit restack itself
```

## Diagram: per-host state, queue and the leaf

```mermaid
stateDiagram-v2
    [*] --> prepared: route record written
    prepared --> [*]: no marker on resume, abort, nothing mutated
    prepared --> admitted: marker CAS, leaf parked on build
    admitted --> repairing: region entry, restage and append
    repairing --> reroute_moved: verified reroute, rejected tip pinned under rejected/«roundId»/«n»
    reroute_moved --> rerouted: source host, terminal, never selected again
    reroute_moved --> admitted: destination host admitted after the tree sync, no new charge
    repairing --> built: host region passes
    built --> restacked: exit restack applied (marker deleted in that transaction)
    restacked --> admitted: next host in the round
    restacked --> revalidating: queue holds closed children
    restacked --> leaf_gates: round closed and queue empty
    revalidating --> revalidating: revalidate round on lowest child, PASS acked by generation, closure SHA, inputs
    revalidating --> repairing: child j fails, fix inside the revalidate round on j
    revalidating --> leaf_gates: queue drained
    leaf_gates --> [*]: leaf gates re-run under existing lap caps
    repairing --> halted: lap, growth, region or cascade cap exhausted
    revalidating --> halted: cap on child j
    halted --> [*]: needs-human HALT naming the child, record and marker kept
```

## Diagram: queue production by every restack

```mermaid
flowchart TD
    T["restack (routed exit, operator commit on a closed child, base refresh, recovery)"] --> W["transition computes closed children whose closure moved, carried in the journal"]
    W --> MV{"verdict readable?"}
    MV -- "missing or unreadable" --> E["enqueue {child, new closure SHA, input identity}"]
    MV -- readable --> S{"replay identity proven and own overlap paths empty (inherited rem blocks excluded)?"}
    S -- yes --> K["no entry"]
    S -- no --> E
    E --> M["merge with existing generation: dedup by child, newest closure SHA, position order"]
    M --> G["written in the restack's applied transaction"]
    K --> G
```

## Diagram: components touched

```mermaid
graph TD
    subgraph Existing["existing (#2940 to #2943)"]
        LIFE[child-lifecycle.ts: switchToChild, closeChild]
        CC[restack/cascade-cap.ts]
        ENV[coverage-binding envelope: taskSlices, storyOwnership]
        BRI[build-review-inputs.ts: base resolver]
    end
    subgraph New["new in #2944"]
        RTR[remediation-routing.ts: owner, residue validation, cannot-host]
        RREC[routed-repair-record.ts: route record, round receipt, outbox, marker, queue]
        RJ[residue routing judgement schema]
        BP[blocked-by-prerequisite schema and verifier]
        XC[execution-child resolver]
    end
    subgraph Amended["amended"]
        CUR[child-cursor.ts: routedRepair field]
        PRE[restack/stack-preflight.ts: reconcile admission, skip auto-repair]
        RS[restack executor and transition: queue generation in the transaction]
        RP[restack-replay.ts: rem block merge]
        CON[conductor.ts: gap loop, MT FAIL intercept, routed entry and exit, leaf sentinel]
        RA[remediation-append.ts: union ids, Child line, roundId, fail closed]
        KL[kickback-ledger.ts: cache rebuilt from the record, stored authored]
        OBL[repair-restage.ts + task-progress.ts + autoheal.ts: per-branch boundary, execution projection]
        MEM[task-membership-check-cli.ts + task-cli.ts: Child line authority, marker agreement]
        RW[rewind.ts, task-cli.ts, kickback-budget-cli.ts: default child from the execution-child resolver]
        EV[types/events.ts: remediation_routed, remediation_rerouted, routed_repair_phase, child_revalidated]
    end
    CON --> RTR
    RTR --> ENV
    RTR --> RJ
    RTR --> RREC
    CON --> RA
    RREC --> KL
    RREC --> CUR
    CUR --> PRE
    PRE --> RS
    RS --> RP
    RS --> RREC
    RS --> CC
    CON --> BP
    BP --> RREC
    CON --> LIFE
    CON --> BRI
    XC --> CUR
    RW --> XC
    CON --> XC
    MEM --> RREC
    CON --> OBL
    RREC --> EV
```

## Legend

- **closure(k)** is `refs/conductor/«slug»/closed/c«k»`. It moves only in a restack's journaled
  transactions (#2943). A routed repair keeps it fixed until the exit restack's `applied`
  transaction, so `resolveChildBase` for k+1 never breaks.
- **Budgets.**
  - A round charges each gate lap, its declared growth and its taskless charges once, at the first
    host's BUILD dispatch.
  - Each restack charges one cascade on its originating child.
  - Each host pass has one `routedRepairCredit` for `build_review`. It is separate from convergence
    refunds, which `feature-repair` never grants.
- **Bound.**
  - Restacks are bounded by `MAX_RESTACK_CASCADES_PER_CHILD` (3) per originating child.
  - Validation failures without a restack are bounded by each child's region caps.
  - The queue dedups by child.
  - Reroutes only move upward, so there are at most N−1 per round.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-12 | Initial generation | #2944 DECIDE |
