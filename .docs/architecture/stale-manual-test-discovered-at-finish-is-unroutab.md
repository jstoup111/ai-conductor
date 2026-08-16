# Architecture: The current-HEAD publication fence

**Last updated:** 2026-08-16
**Scope:** The SHIP-tail validation fence (`nonGreenFinishValidators`, `conductor.ts:1602-1640`),
its guard clause at `:1609`, and the FINISH publication observer and router it protects
(`finish-publication-production.ts`, `finish-publication.ts`). Covers the halt filed as
jstoup111/ai-conductor#1613 and the restoration under the operator-confirmed scope.
All line references are at worktree base `b30e6c943`.

## Diagram: components (L3)

```mermaid
graph TD
  subgraph TAIL["SHIP tail — conductor.ts"]
    VG["VALIDATION_GROUP<br/>steps.ts:358-370<br/>manual_test, prd_audit,<br/>architecture_review_as_built"]
    REBASE["rebase + maintain_documentation<br/>commit — tree moves"]
    FENCE["nonGreenFinishValidators :1602-1640<br/>computeAndWriteVerdict per member<br/>non-green ⇒ stale + kickback"]
    GUARD["guard :1609<br/>if finishPublication OR mocked ⇒ return []"]
  end

  subgraph FINISH["FINISH — coordinator + router"]
    OBS["observeShipEvidence :261-264<br/>stepDone(manual_test)<br/>&amp;&amp; stepDone(arch_review_as_built)"]
    PRE["preflightFinishPublication :821-915"]
    ROUTE["routeFinishPublicationDisposition :641-683"]
    HALT["halt — needs-human<br/>placeholder reason<br/>not re-kickable"]
  end

  subgraph PRED["Predicates — state.ts"]
    SD["stepDone :192-198<br/>done | skipped"]
    SS["stepSatisfied :200-205<br/>done | skipped | stale"]
  end

  VG --> REBASE
  REBASE --> FENCE
  GUARD -.->|disables in production| FENCE
  FENCE -->|when enabled: redirect| VG
  REBASE --> OBS
  OBS --> SD
  OBS --> PRE
  PRE --> ROUTE
  ROUTE --> HALT
  FENCE -.->|bypassed| OBS
  VG --> SS

  classDef defect fill:#fde2e2,stroke:#b60205,color:#3d0000;
  classDef target fill:#e2f0d9,stroke:#2e7d32,color:#0b2e13;
  class GUARD,HALT,OBS defect;
  class FENCE target;
```

## Legend

- **Red** — the regression. The guard at `:1609` disables the fence on every production path, so
  the run reaches an observer that reads `stale` as absent and a router that has only a
  placeholder.
- **Green** — the fence itself, already written and already correct; it needs enabling, not
  authoring.
- **Dotted edges** — paths that exist but are inert in the configuration where the defect occurs.

## Diagram: how one commit produced the halt

```mermaid
sequenceDiagram
  participant T as SHIP tail
  participant F as fence (nonGreenFinishValidators)
  participant O as observeShipEvidence
  participant R as router
  participant H as HALT

  Note over T: manual_test goes stale — review-lap commits, or a tail rebase
  T->>F: reach finish
  rect rgb(253,226,226)
    F-->>T: guard :1609 — finishPublication wired ⇒ return []
    Note over F: commit 9a6005e61 added this disjunct
    T->>O: finish dispatches anyway
    O->>O: stepDone("manual_test") = false (stale ∉ {done, skipped})
    O-->>R: publication_retry { ship_evidence_invalid }
    R-->>H: "requires its dedicated BUILD routing rule"
    Note over H: same commit 9a6005e61 added this placeholder
  end
  rect rgb(226,240,217)
    Note over F: TARGET — remove the disjunct, the fence already does the rest
    F->>F: computeAndWriteVerdict per applicable member
    F-->>T: mark only non-green members stale,<br/>kickback finish → earliest, redirect
    T->>T: validator re-runs at current HEAD
    T->>O: re-enter finish with fresh evidence
  end
```

## The single-commit root cause

`git log -L` on both lines resolves to the same commit —
`9a6005e6104c8dc0ce6a61206f021e2bb01b7138` (2026-08-04, #1295). It removed the **prevention** and
left the **cure** unwritten in one change:

| Line | Change | Effect |
|---|---|---|
| `conductor.ts:1609` | `if (!this.verifyArtifacts && !this.daemon)` → `if (this.finishPublication \|\| (!this.verifyArtifacts && !this.daemon))` | the APPROVED fence stops running in production |
| `finish-publication.ts:657-670` | placeholder halt added | invalid evidence has no route |

## Design decisions this raises (for `/architecture-review`)

1. **The fence is mandated, not optional.** `adr-2026-07-26-rebase-tail-current-branch-before-publication`
   is APPROVED and its decisions 3-5 require it before *any* finish dispatch or publication side
   effect. The engine has violated that decision since 2026-08-04. Restoring it is conformance
   work, not new design.
2. **Redirect to the earliest non-green validator, not to BUILD.**
   `adr-2026-07-13-kickback-build-no-op-escalation` forbids routing into a BUILD that is already
   evidence-complete ("never re-kick"), which is exactly the shape of a stale SHIP validator over a
   complete BUILD. The governing ADR's decision 5 already names the correct target.
3. **Recompute verdicts; never force-invalidate them.** The fence calls `computeAndWriteVerdict`
   and stales only what comes back non-green — the preserve-when-surface-unchanged behavior
   `adr-2026-07-22` and `adr-2026-07-20` require, and the reason a docs-only tail lap cannot
   oscillate the loop.
4. **Bounding is inherited.** The redirect is an ordinary `finish` kickback, already bounded by
   `MAX_KICKBACKS_PER_GATE` through the durable ledger. No new counter is warranted.
5. **The one open question is why the disjunct was added.** It carries no comment and no ADR, but
   #1295 added it deliberately. If a real incompatibility exists between the fence and the
   coordinator, this is a design fork for the operator rather than something to work around.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-16 | Initial generation | DECIDE for jstoup111/ai-conductor#1613 |
| 2026-08-16 | Redesigned around restoring the disabled fence rather than adding a FINISH→BUILD route | The repo-wide ADR sweep found `adr-2026-07-26` mandates the fence and `adr-2026-07-13` forbids the BUILD route |
