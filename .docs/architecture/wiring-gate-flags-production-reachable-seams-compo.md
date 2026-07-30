# Components: Contract-aware same-file wiring verification

**Last updated:** 2026-07-30
**Scope:** Refinement of the wiring-reachability gate for exported helpers called inside their defining module.

## Diagram

```mermaid
graph TD
    subgraph INPUTS["Feature evidence inputs"]
        DIFF["Feature diff<br/>new exported symbols"]
        PLAN["Accepted implementation plan<br/>Wired-into caller contracts"]
        ROOTS["Configured TS or JS<br/>wiring entry points"]
        SOURCE["Production source tree"]
    end

    subgraph PROBE["wiring-probe.ts deterministic verification"]
        DECLARED["Declared-site verifier<br/>site exists in production source"]
        REFS["Layer 1 reference search<br/>classifies cross-file, same-file,<br/>test-only, or absent references"]
        CALL["Same-file composition verifier<br/>declared caller references<br/>the new export"]
        GRAPH["Layer 2 import graph<br/>module reachable from a root"]
        POLICY{"Same-file exception<br/>has all required proof?"}
    end

    subgraph VERDICTS["Evidence and gate verdict"]
        PASS["Pass with named evidence<br/>caller plus root-reachability chain"]
        GAP["orphan-export gap<br/>missing contract, call edge,<br/>or reachability proof"]
        TESTGAP["orphan-export gap<br/>test-only or absent caller"]
        EVIDENCE[("WiringEvidence<br/>per-export disposition")]
        GATE["wiring_check completion predicate"]
        SHIP["SHIP as-built review<br/>independently traces root<br/>to caller to export"]
        SHIPOK["SHIP approved"]
        SHIPBLOCK["SHIP blocked<br/>missing proof"]
    end

    DIFF --> REFS
    PLAN --> DECLARED
    SOURCE --> DECLARED
    SOURCE --> CALL
    ROOTS --> GRAPH
    SOURCE --> GRAPH

    REFS -- "cross-file production reference" --> PASS
    REFS -- "same-file production reference" --> CALL
    REFS -- "test-only or absent" --> TESTGAP
    DECLARED --> CALL
    CALL --> POLICY
    GRAPH --> POLICY
    POLICY -- "yes" --> PASS
    POLICY -- "no, including Layer 2 unavailable" --> GAP

    PASS --> EVIDENCE
    GAP --> EVIDENCE
    TESTGAP --> EVIDENCE
    EVIDENCE --> GATE
    PASS -. "corroborating BUILD evidence" .-> SHIP
    SOURCE --> SHIP
    ROOTS --> SHIP
    SHIP -- "complete production chain" --> SHIPOK
    SHIP -- "own-module reference alone" --> SHIPBLOCK
```

## Legend

- The existing cross-file Layer 1 success path remains unchanged.
- A same-file-only export receives a narrow exception only when the accepted plan declares its caller, production source proves that caller references the new export, and configured Layer 2 proves the defining module is reachable from a production root.
- Missing or inapplicable Layer 2 proof fails closed for the exception. Non-TypeScript/JavaScript projects retain the current same-file gap until a language-specific reachability adapter exists.
- Test-only and genuinely absent references remain gaps. Evidence names the export, declared caller, and reachability result so a failed build is actionable.
- The SHIP-time as-built review independently traces the same production-root-to-caller-to-export chain. An own-module caller counts only inside that complete chain; an own-module reference by itself remains blocking.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-30 | Initial generation | DECIDE phase for issue #880 |
| 2026-07-30 | Plan update | Sequenced typed proof validation, shared TypeScript analysis, exact symbol identity, boundary acceptance, and SHIP contract alignment |
