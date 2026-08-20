# Architecture: FINISH publication non-advancing retries

**Last updated:** 2026-08-13
**Scope:** The FINISH publication coordinator's observe → select → advance loop
(`src/conductor/src/engine/finish-publication.ts`, `finish-publication-production.ts`) and its
disposition routing in `src/conductor/src/engine/conductor.ts`. Covers the two non-convergent
cycles filed as jstoup111/ai-conductor#1487 and the target architecture under the
operator-confirmed approach (fixed-point guard + deterministic halt-PR short-circuit).
All line references are at worktree HEAD `92734d3e7`.

## Diagram: components (L3)

```mermaid
graph TD
  subgraph CONDUCTOR["Conductor step loop — conductor.ts"]
    LOOP["FINISH attempt loop<br/>attempt / stepMaxRetries = 6<br/>resolved-config.ts:55"]
    ROUTE["routeFinishPublicationDisposition<br/>finish-publication.ts:641-683"]
    PROG["progress_finish arm<br/>publicationProgressAttempts++ :6105<br/>attempt-- refund :6120<br/>allowance 14 :6107"]
    RETRY["retry_finish arm<br/>non-retryable fail-fast :6134<br/>else retry, then halt :6160"]
    HALT["writeHaltMarker needs-human"]
  end

  subgraph COORD["Pure coordinator — finish-publication.ts"]
    OBS["observePublicationSnapshot :175-209<br/>7 ports, safelyObserve :211"]
    SEL["nextFinishPublicationTransition :357-400<br/>pure, first-match-wins"]
    ADV["advanceFinishPublication :1216-1516<br/>preflight, then one effect"]
    MAP["mapPrProseJudgmentResult :1136-1189"]
  end

  subgraph PROD["Production adapter — finish-publication-production.ts"]
    PROSE["prProse classifier :120-133<br/>placeholder / halt / accepted"]
    VIEW["observePullRequest :233<br/>gh pr view --json url,title,body,isDraft"]
    MEMO["judgmentByRevision memo :154-155, :288-296<br/>key: url + JSON title,body"]
  end

  subgraph EXT["Third-party boundaries"]
    GH["GitHub — gh CLI"]
    LLM["Provider session — judge_pr_prose"]
  end

  LOOP --> ADV
  ADV --> OBS
  OBS --> SEL
  SEL --> ADV
  ADV --> MAP
  ADV --> ROUTE
  ROUTE --> PROG
  ROUTE --> RETRY
  PROG --> LOOP
  RETRY --> LOOP
  PROG --> HALT
  RETRY --> HALT
  OBS --> VIEW
  VIEW --> GH
  VIEW --> PROSE
  ADV --> MEMO
  MEMO --> LLM

  classDef defect fill:#fde2e2,stroke:#b60205,color:#3d0000;
  class PROSE,MEMO,SEL defect;
```

## Diagram: current selection and the two defect cycles

`prProse` classifies an auto-opened halt PR as `halt` from a `needs-remediation:` title prefix
or the `HALT_PR_BANNER_SENTINEL` in the body (`finish-publication-production.ts:125-128`).
`halt` is neither `placeholder` nor `accepted`, so the selector routes it to judgment forever:
nothing in the judgment path writes the PR, so the observation that selected the stage is
identical on the next pass.

```mermaid
graph TD
  START["FINISH entry — observe snapshot"] --> KEEP{"intent.outcome is keep? :363"}
  KEEP -- yes --> RECORD["record_outcome"]
  KEEP -- no --> IDENT{"pr.identity is one AND branch pushed? :367"}
  IDENT -- no --> EST["establish_pr"]
  IDENT -- yes --> REL{"releaseReadiness valid? :371"}
  REL -- no --> VRR["verify_release_readiness :371<br/>unreachable — preflight already blocks"]
  REL -- yes --> PH{"pr.prose is placeholder? :379"}
  PH -- yes --> AUTH["author_pr_prose<br/>gated by isPrProseAuthoringNeeded :996-1000"]
  PH -- no --> ACC{"pr.prose is accepted? :383"}
  ACC -- no --> JUDGE["judge_pr_prose<br/>gated by isPrProseJudgmentNeeded :989-993"]
  ACC -- yes --> SHIP["write_shipped_record :391"]
  SHIP --> READY["ready_pr :395"]
  READY --> RECORD

  JUDGE --> VERDICT{"verdict — mapPrProseJudgmentResult :1136-1189"}
  VERDICT -- "revision_required/halt :1169" --> HR["human_required judgment_halt_prose<br/>CORRECT terminal state"]
  VERDICT -- "refused :1154" --> HR2["human_required judgment_refused"]
  VERDICT -- "revision_required/placeholder<br/>or structurally_incomplete :1176-1186" --> CYCA["publication_retry<br/>transition author_pr_prose<br/>reason authoring_required_after_judgment"]
  VERDICT -- "accepted :1141" --> CYCB["advanced judge_pr_prose"]

  CYCA --> DISCARD["routeFinishPublicationDisposition :671-674<br/>DISCARDS the named transition,<br/>forwards only the reason"]
  DISCARD --> REOBS_A["re-enter FINISH, re-observe<br/>prose is still halt, never placeholder"]
  REOBS_A --> JUDGE

  CYCB --> PROGRESS["progress_finish :655<br/>attempt refunded conductor.ts:6120"]
  PROGRESS --> REOBS_B["re-enter FINISH, re-observe<br/>judgment wrote nothing, prose still halt"]
  REOBS_B --> JUDGE

  CYCA -.-> EXITA["exit: 6 attempts then<br/>retry exhausted: authoring_required_after_judgment"]
  CYCB -.-> EXITB["exit: 14 laps then<br/>progress allowance exhausted"]

  classDef bad fill:#fde2e2,stroke:#b60205,color:#3d0000;
  classDef dead fill:#f0f0f0,stroke:#999,color:#333;
  class CYCA,CYCB,DISCARD,REOBS_A,REOBS_B,EXITA,EXITB bad;
  class VRR dead;
```

**Why the laps are free.** `judgmentByRevision` is keyed on the PR's title/body revision
(`finish-publication-production.ts:154-155`, `:288-296`) and caches terminal verdicts, so an
unchanged revision re-returns the identical verdict with **no provider call**. That is why
attempts 2-6 in the filed evidence settled in about 1 ms with no `provider preparing` line —
the memo makes the loop cheap, not finite.

## Diagram: target — fixed-point guard and halt short-circuit

```mermaid
sequenceDiagram
  autonumber
  participant C as Conductor loop
  participant A as advanceFinishPublication
  participant O as observe ports
  participant P as prProse + labels
  participant J as Judge session

  C->>A: enter FINISH
  A->>O: observe snapshot
  O->>P: gh pr view --json url,title,body,isDraft,labels
  Note over P: C — deterministic halt detection<br/>title prefix OR banner sentinel<br/>OR conductor:needs-remediation marker<br/>OR needs-remediation label
  P-->>O: prose = halt
  alt halt detected — approach C
    A-->>C: human_required, halt PR needs an operator
    Note over C: no judgment dispatched,<br/>no attempt spent, no progress tick
  else prose needs judgment
    A->>A: fingerprint the dimension this stage owns
    A->>J: dispatch judge_pr_prose
    J-->>A: verdict
    A->>O: re-observe
    A->>A: fingerprint again, compare — approach A
    alt dimension changed
      A-->>C: advanced, progress_finish
    else dimension unchanged
      A-->>C: human_required, stage did not advance
      Note over C: FIRST occurrence, not the 6th or 14th —<br/>reason names the stage that ran<br/>and the dimension that did not move
    end
  end
```

## Legend

- **Red nodes** — the current defect surface: the classifier value that has no consuming stage
  (`halt`), the memo that makes repeat laps free, and the routing arm that discards the named
  transition.
- **Grey node** — `verify_release_readiness`, selected only when `releaseReadiness !== 'valid'`,
  which preflight (`finish-publication.ts:886-915`) already blocks. It is unreachable as real
  work and its `PUBLICATION_RETRY_REASONS` entry is empty (`:527`).
- **Dimension** — the slice of `PublicationSnapshot` a transition is responsible for moving
  (`author_pr_prose` and `judge_pr_prose` both own `pr.prose`; `establish_pr` owns
  `pr.identity` and `branchPushed`; `write_shipped_record` owns `shippedRecord`; `ready_pr`
  owns `pr.ready`; `record_outcome` owns `outcomeRecord`). The guard compares only that slice,
  so unrelated churn elsewhere in the snapshot cannot mask a stalled stage.
- **Fingerprint** — a stable value derived from the owned dimension, compared before and after
  the effect. It is held for the duration of one `advanceFinishPublication` call; no
  cross-process state is introduced and no new ledger or sidecar file is written.

## Architectural notes

- The existing re-observation rule from `adr-2026-08-01-engine-owned-resumable-finish-publication`
  is **preserved**: the fresh observation remains the sole authority for stage selection. The
  guard adds a comparison over observations the coordinator already makes; it does not make a
  previously-returned transition authoritative.
- Approach C adds one field (`labels`) to an existing `gh pr view --json` call
  (`finish-publication-production.ts:233`). No new third-party boundary, no new port.
- `halt-pr-rehabilitation.ts:500-505` (`hasHaltSignal`) already implements the four-signal halt
  test (title prefix, label, banner, body marker). Approach C reuses that predicate rather than
  writing a second one; today it is unreachable from the coordinator because it runs inside
  `repairPresentation`, which is gated behind `ready_pr` and therefore behind prose already
  being `accepted`.
- No new telemetry channel: the guard's outcome travels on the existing
  `finish_publication_transition` / `finish_publication_disposition` events and the existing
  `loop_halt` reason string.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-13 | Initial generation | DECIDE for jstoup111/ai-conductor#1487 |
