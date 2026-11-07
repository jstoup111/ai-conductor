# Components: Routed Host Exit on Every Settled Review, and No Whole-Feature Gate During an Open Round (#3597)

**Last updated:** 2026-11-07
**Scope:** How a routed host's BUILD region ends, and when whole-feature gates may run on a stacked
feature. Covers the build_review completion arms in `conductor.ts` (clean PASS fallthrough and
the adjudication `settled` arm), `continueRoutedHostExit` → `exitRoutedHostAndReconcile`, the
whole-feature gate entry in the conductor loop, `checkRoundAdmissionFence` in
`routing/round-admission.ts`, and refusal rework's HALT writer (`writeRefusalReworkHalt`).

## Diagram

```mermaid
graph TD
    subgraph Region["Routed host BUILD region (child «n»)"]
        BR["build_review on host «n»"]
        PASS["Clean PASS fallthrough"]
        SETTLED["Adjudication settled arm<br/>every finding rejected"]
        CLOSE["NEW: shared region closure<br/>one helper both arms call"]
    end

    subgraph Exit["Routed exit (existing)"]
        CRE["continueRoutedHostExit"]
        XR["exitRoutedHostAndReconcile<br/>host built, restack, next host or leaf"]
    end

    subgraph Gates["Whole-feature gates on the leaf"]
        GUARD["NEW: open-round guard<br/>before manual_test, prd_audit,<br/>architecture_review_as_built and later gates"]
        WFG["Whole-feature gate runs"]
        REFUSE["Refusal rework / audit remediation"]
    end

    subgraph Routing["Routing refs, CAS only"]
        REC["reconcileRounds"]
        FENCE["checkRoundAdmissionFence<br/>NEW detail: blocking round, open host,<br/>host state, recovery command"]
        REFS[("routes/«roundId» + repairing marker")]
    end

    STALL["Bounded mechanical routing stall<br/>needs-human on 3rd identical stop"]
    HALT["NEW: refusal-rework HALT keeps the<br/>fence's mechanical class;<br/>no revise-decision request"]

    BR --> PASS
    BR --> SETTLED
    PASS --> CLOSE
    SETTLED --> CLOSE
    SETTLED -.->|"OLD HOLE: marked done and continued;<br/>fell through to whole-feature gates<br/>with the round still open"| WFG
    CLOSE --> CRE
    CRE --> XR
    XR --> REFS
    GUARD -->|"no routed work outstanding"| WFG
    GUARD -->|"marker, queue entry or<br/>non-closed round"| REC
    REC -->|"navigate to host build or resume exit"| CRE
    REC -->|"nothing can progress"| STALL
    WFG --> REFUSE
    REFUSE --> FENCE
    FENCE -->|"admitted"| REFS
    FENCE -->|"refused"| HALT
```

## Sequence: a host whose build_review settles by adjudication

```mermaid
sequenceDiagram
    participant L as Conductor loop
    participant A as build_review adjudication
    participant H as Shared region closure
    participant X as Routed exit
    participant G as Whole-feature gate guard
    participant R as Routing refs
    L->>A: host 1 build_review FAIL
    A-->>L: settled, every finding rejected
    L->>H: close host 1 region
    H->>X: continueRoutedHostExit
    X->>R: host 1 built and restacked, admit host 2
    X-->>L: navigate host 2
    Note over L,R: host 2 builds and exits the same way, then the round closes and the leaf returns
    L->>G: enter prd_audit on the leaf
    G->>R: any open round or marker?
    R-->>G: none
    G-->>L: run prd_audit
    Note over L,R: a refusal raised now admits a fresh audit round, because no round is open
```

## Legend

- **NEW**: behavior this feature adds. **OLD HOLE**: the path observed on
  `path-policy-still-decides-feature-ownership-by-fol` (round r2, host 1) that this feature closes.
- **Shared region closure**: the existing child-region closure that today runs only on the clean
  PASS fallthrough, moved behind one helper so the adjudication `settled` arm reaches the same
  routed exit (adr-2026-10-12-routed-whole-feature-repair D13).
- **Open-round guard**: the enforcement point for D15 (leaf gates re-run only once no marker or
  queue entry remains). It also covers a resume that lands on a whole-feature gate while a round
  is open. A feature with no open round passes straight through, unchanged.
- **Refusal-rework HALT**: a fence refusal is an engine stop, not an operator decision. It keeps the
  fence's `mechanical` class (D7, #3445 amendment) and names the round, host, host state and an
  executable recovery, instead of re-asking the operator to revise an already-recorded refusal.
- No new module, dependency, ref, or persisted format is introduced.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-11-07 | Initial generation | #3597 DECIDE: settled build_review skipped the routed exit; refusal rework hit the open-round fence |
| 2026-11-07 | Plan update: the guard tests any outstanding routed work (marker, queue entry or non-closed route record) through one shared `routedWorkOutstanding`, and runs at the top of the step loop, so resume is covered | Conflict check and plan (D7 amendment by #3597) |
