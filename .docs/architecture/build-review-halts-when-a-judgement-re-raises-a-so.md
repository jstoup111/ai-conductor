# Components: open-scoped source ownership for build_review remediation cases

**Last updated:** 2026-10-19
**Scope:** Proposed component boundaries for jstoup111/ai-conductor#3292, which also delivers the
core outcome of #2464. The case store refuses a source only when two OPEN cases link it. A single
shared selector makes a source's open link, or else its most recent link, authoritative for every build_review
source-to-case reader. An unbound re-raise of a source that only resolved cases own is admitted as a
new case. Decision-stop persistence propagates rejected-transition violations and converges on a
replay. No new module, store version or schema field is added.

## Diagram

```mermaid
graph TD
  subgraph Judge["Existing remediate judgement"]
    RESULT["case-v2 judgement<br/>.pipeline/remediation.json<br/>unbound act / merged / escalate row<br/>on a source a resolved case owns"]
  end

  subgraph Admit["Engine-owned admission"]
    COORD["build-review-adjudication-coordinator.ts<br/>explicit existingCaseId rebind of a<br/>resolved act still halts regression;<br/>unbound re-raise proceeds"]
    RECONCILE["remediation-case-reconciler.ts<br/>mints a new case; resolved row<br/>untouched; new act reserves a<br/>fresh charged effect"]
    STOPS["remediation-case-effects.ts<br/>persistBuildReviewDecisionStop<br/>propagates violation;<br/>converges on own open stop"]
  end

  subgraph State["Feature-scoped durable state"]
    STORE["remediation-case-store.ts<br/>parseBuildReviewCases:<br/>source-linked-by-multiple-cases<br/>counts OPEN owners only"]
    SELECT["currentBuildReviewSourceLinks<br/>(new shared selector in store module)<br/>open link, else most recent,<br/>per source"]
    BUDGET["kickback-ledger.ts<br/>new act charged as today"]
  end

  subgraph Readers["Source-to-case readers"]
    REDUCE["build-review-adjudication.ts<br/>coverage consistency, decision owners,<br/>consistency stop, build route"]
    ROUTE["coordinator buildRouteRepairCaseIds<br/>and decisionStops projection"]
  end

  subgraph Halt["Operator surface"]
    FAILSTORE["coordinator failStore<br/>names invariant, case ids, source ids<br/>for every rejected transition"]
    RUNBOOK["docs/runbooks/stalled-or-stuck-feature.md<br/>rejected-transition section"]
  end

  RESULT --> COORD
  COORD --> RECONCILE
  COORD --> STOPS
  RECONCILE -->|mutate| STORE
  STOPS -->|mutate| STORE
  RECONCILE -->|new act effect| BUDGET
  STORE --> SELECT
  SELECT --> REDUCE
  SELECT --> ROUTE
  STORE -->|rejected-transition + violation| RECONCILE
  STORE -->|rejected-transition + violation| STOPS
  RECONCILE -->|storeReason + violation| FAILSTORE
  STOPS -->|reason + violation| FAILSTORE
  FAILSTORE -.documents.-> RUNBOOK
```

## Legend

- **Judge**: provider-authored input. The engine never infers sameness or distinctness from its prose.
- **Admit**: existing engine seams. Only their admission rules change.
- **State**: the one durable case store. `currentBuildReviewSourceLinks` is a pure selector in the
  existing store module, not a new module.
- **Readers**: every build_review consumer that maps a source back to one case reads through the
  selector instead of scanning all links.
- **Halt**: the rejected-transition diagnostic now reaches the operator on every path.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-19 | Initial generation | #3292 DECIDE (Medium) |
