# Sequence + Components: Place admitted whole-feature fixes in the owning stacked child (#3210)

**Last updated:** 2026-10-14
**Scope:** Spec B of the four-spec split of `adr-2026-10-12-routed-whole-feature-repair`
(decision 18). It covers routing an admitted leaf-gate round to its owning and hosting children,
recording that decision durably before any mutation, admitting the first host marker-first, and
reconciling a crashed round on resume. The whole design is drawn in
[`whole-feature-audit-fixes-cannot-land-in-the-stack.md`](whole-feature-audit-fixes-cannot-land-in-the-stack.md);
these diagrams show only what this spec builds.

Covered (ADR decisions 1–4, 7, and the writers of 6 and 16):
- routing entry after today's classification, only for a feature with durable child state;
- mechanical owner derivation, the residue routing call, mixed rounds and cannot-host selection;
- route-record creation, the marker transaction, host and round phase transitions, and their event
  outbox entries;
- reconciliation by the phase table, the automatic-restack skip while a marker exists, and
  base-refresh deferral while a round is open.

Built on #2944 (shipped in #3219): route types and parsers, ref names and teardown, the store's
read, compare-and-swap update and restack-journal fence, the outbox drain, the cursor fields, the
execution-child resolver and the default-off `stacked_prs.route_whole_feature_fixes` setting.

Out of scope, delivered by #3211: host region entry and the frozen-block append, the `Round:`
stamp and `Child:`-line membership, the execution projection in the hook and `task-cli`, round
receipt settlement and taskless admission charging, the routed post-region custom-step kickback,
leaf-host processing, and the verified prerequisite reroute. Delivered by #3212: the routed exit
restack, the re-validation queue and the leaf return.

With the setting off, or when the cursor reports `no-child`, every path below collapses to today's
leaf remediation, byte for byte.

## Diagram: routing an admitted round

```mermaid
flowchart TD
    V["leaf whole-feature gate verdict"] --> CL{"classification and admission (unchanged)"}
    CL -- "PLAN_GAP, DESIGN, OVER_SCOPE, malformed, no-owner" --> HALT["halt or refuse exactly as today, no routing ref"]
    CL -- "admitted" --> CH{"routingEligible: setting on and cursor has durable children?"}
    CH -- no --> N1["today's leaf append and navigateBack"]
    CH -- yes --> PRED{"today's mixed-plan halt, unresolved target, or target at or before coverage_binding?"}
    PRED -- yes --> N1
    PRED -- "no, region target" --> SPLIT["split admitted items into task-bound and residue"]
    SPLIT --> TB["deriveTaskBoundOwner: taskSlices, or committed rem Child line"]
    TB -- "missing slice entry or undeclared Child" --> HN1["needs-human HALT naming the task"]
    SPLIT --> MIXQ{"FAIL rows with task-bound gaps?"}
    MIXQ -- yes --> MIX["FAIL obligation to earliest task-owned host, rows ride every host hint"]
    MIXQ -- no --> RES["one residue routing call per round, own schema, one re-ask"]
    RES -- "invalid, malformed, timeout or unavailable twice" --> HN2["needs-human HALT naming the item, no lap charged"]
    RES -- "several candidates" --> DEF["earliest candidate, reason residue-default"]
    RES -- "one candidate" --> JUD["judged child, reason residue-judged"]
    TB --> SEL
    MIX --> SEL
    DEF --> SEL
    JUD --> SEL
    SEL["selectHost: cited paths present at leaf tip are inputs"] --> HQ{"every input in owner closure?"}
    HQ -- yes --> H1["host = owner"]
    HQ -- no --> HUP{"earliest closure above owner, else leaf tip, holding every input?"}
    HUP -- found --> H2["host = that child, reason prerequisite-paths"]
    HUP -- none --> HN3["needs-human HALT naming missing paths"]
    H1 --> ADM["admitRound (next diagram)"]
    H2 --> ADM
```

## Diagram: marker-first admission and resume reconciliation

```mermaid
sequenceDiagram
    participant Gap as planRemediation (stacked branch)
    participant Store as route-record-store
    participant Git as git update-ref --stdin
    participant Spine as event spine
    participant Pre as stack preflight + resume

    Gap->>Store: nextRoundId over existing routes refs, halt at MAX_ROUTE_ROUNDS
    Gap->>Store: createRouteRecord phase prepared, every host pending, frozen allocation, empty outbox
    Store->>Git: create routes/«roundId» with all-zero old value, verify restack/journal in the same transaction
    Gap->>Store: marker transaction
    Store->>Git: one transaction: verify restack/journal, create repairing {host, roundId} from zero, routes/«roundId» prepared to open with lowest host admitted, outbox remediation_routed and routed_repair_phase
    Note over Store,Git: concurrent marker or moved record fails the CAS, halt needs-human naming both rounds
    Store->>Spine: drain outbox, persist then CAS-remove
    Gap->>Gap: emit one kickback for the round, navigateBack leaf to build
    Note over Gap: region entry, append and settlement are #3211
    Pre->>Pre: journal recovery twice, then drain outboxes
    Pre->>Store: reconcileRounds by phase table
    alt prepared and no marker names it
        Store->>Git: CAS-delete routes/«roundId», round aborted, re-admitted next gate pass
    else host admitted
        Pre->>Gap: return re-navigate action, conductor resume moves the leaf to build, no ref written
    else later phases
        Pre->>Pre: hand to #3211 and #3212 handlers
    end
    Pre->>Pre: resolveActiveChild
    Pre->>Pre: marker present, skip automatic feature-repair restack for every closed child
    Pre->>Pre: any round not closed and base refresh due, emit restack_refused deferred-base-refresh, move no ref
```

## Diagram: phases written by this spec

```mermaid
stateDiagram-v2
    [*] --> prepared: createRouteRecord, every host pending
    prepared --> aborted: resume finds no marker naming it, CAS-delete record
    aborted --> [*]: next gate pass admits a fresh round
    prepared --> open: marker transaction, lowest host pending to admitted
    open --> open: later host transitions (#3211, #3212)
    open --> closed: last host terminal (#3212)
    closed --> [*]
```

## Diagram: components touched

```mermaid
graph TD
    subgraph Shipped["shipped in #3219"]
        TYPES[routing/route-types.ts]
        REFS[routing/routing-refs.ts]
        STORE[routing/route-record-store.ts: read, CAS update, fence, drain]
        XC[routing/execution-child.ts]
        CUR[child-cursor.ts: routedRepair, revalidating]
        EVT[types/events.ts: four routing members]
    end
    subgraph New["new in this spec"]
        OWN[routing/owner-derivation.ts]
        HOST[routing/cannot-host.ts]
        RES[routing/residue-routing-call.ts]
        RTR[routing/round-router.ts]
        ADM[routing/round-admission.ts: admitRound, reconcileRounds, routedRoundOpen]
        REV[routing/routing-events.ts: the only event constructors]
    end
    subgraph Amended["amended in this spec"]
        STOREW[route-record-store.ts: createRouteRecord, transitionHost, fenced multi-ref transactions]
        CON[conductor.ts: planRemediation stacked branch, FINISH base-refresh deferral]
        SR[step-runner-types.ts + step-runners.ts: dispatchResidueRoutingJudgement]
        PRE[restack/stack-preflight.ts: reconcile, restack skip, deferral]
        RK[daemon-rekick.ts + daemon-cli.ts: deferral, shared reconciler]
        RA[remediation-append.ts: allocateFrozenBlocks dry-run renderer]
        ART[artifacts.ts: readAppendedRemediationTaskChildren]
        RREFS[routing-refs.ts: closureRefFor]
    end
    CON --> RTR
    RTR --> OWN
    RTR --> HOST
    RTR --> RES
    RES --> SR
    CON --> ADM
    ADM --> STOREW
    STOREW --> STORE
    STOREW --> REV
    REV --> EVT
    STORE --> TYPES
    STORE --> REFS
    PRE --> ADM
    RK --> ADM
    PRE --> CUR
    CUR --> XC
    RTR --> RA
    OWN --> ART
    HOST --> RREFS
```

## Legend

- **closure(k)** is `refs/conductor/«slug»/closed/c«k»`. This spec reads closure trees for
  cannot-host and never moves a closure.
- **Fenced write.** Every route-record write, including a multi-ref transaction that also creates
  the marker, passes the restack-journal fence in `route-record-store.ts`, and carries a `verify`
  line for `refs/conductor/«slug»/restack/journal` in the same transaction. An `applied` journal
  with a pending follow-on counts as open. The single exempt
  writer is the restack `applied` transaction, built in #3212.
- **open.** The marker transaction is the writer of round phase `open`, so reconciliation aborts
  only a `prepared` round with no marker, never an open round between hosts.
- **Events.** Each state change carries its event in the same blob's outbox; drains are
  at-least-once and deduplicated by `eventId`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-14 | Initial generation | #3210 DECIDE |
| 2026-10-14 | Halt and target predicates first, atomic journal verify, recovery follow-on deferral | Architecture review round 2 (Codex) |
| 2026-10-14 | Routed event written at the marker; follow-on handled by the fence | Conflict check |
| 2026-10-14 | Components gain the frozen-block renderer, membership reader and closure-ref helper | Plan update |
