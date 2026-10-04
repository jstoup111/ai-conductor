# Components: Stack-aware feature identity and per-child state foundation (#2940)

**Last updated:** 2026-10-03
**Scope:** The foundation every stacked-delivery ticket (#2941–#2945) builds on. Four seams are
added beside existing engine machinery: one shared feature-branch identity parser, an optional
child context with a per-child `.pipeline/` storage namespace, an optional per-site base
override, and an optional `child` field on the event spine. The `--child` argument on the
recovery CLIs is added too. None of these seams has a live producer of a child yet. This ticket
builds the identity parser, the per-child path seam and its step-status, gate-verdict and ledger
stores, the event field, and the `--child` CLIs. The base override and active-child resolution are
fixed as contracts here and implemented by #2942. Without `--child` naming an existing child,
everything resolves to "no child", so at N=1 every persisted byte stays as it is today. Out of scope: the active-child cursor and halt-to-leaf (#2942), restack
(#2943), fix routing (#2944), the child-to-PR map, publication and child-branch teardown (#2945).

## Diagram — component seams

```mermaid
graph TD
    subgraph Identity["Branch identity — one parser"]
        FBI["feature-branch-identity.ts (new)<br/>parseFeatureBranch: ref → slug + leaf or child k, or null<br/>leafBranchFor: feat/daemon-«slug»<br/>childBranchFor: feat/c«k»/«slug»"]
    end

    subgraph BranchConsumers["Branch consumers (today: four private parsers + hardcoded names)"]
        FR["finish-record-cli.ts"]
        HPR["halt-pr-reconciliation.ts"]
        DHPO["daemon-halt-pr-operations.ts"]
        GHO["github-operations-cli.ts<br/>(feature-scope check)"]
        OVL["engineer/intake/overlap-sources.ts"]
        PARK["park-reconciliation.ts"]
        LEAK["leak-triage.ts"]
        SWEEP["mergeable-sweep.ts"]
        DDEPS["daemon-deps.ts / daemon-cli.ts"]
    end

    subgraph ChildCtx["Child context — optional, beside StepName"]
        ACT["active child<br/>this ticket: no child unless --child names an existing child<br/>resolveActiveChild from git branch state: #2942"]
        PATH["pipelinePathFor (new)<br/>no child → .pipeline/«file»<br/>child k → .pipeline/children/«k»/«file»"]
    end

    subgraph Stores["Per-child-capable state stores"]
        CS["conduct-state store<br/>(region step status)"]
        GV["gate-verdicts.ts<br/>(gates/«step».json)"]
        TSE["full-suite-evidence.ts<br/>(test-suite-evidence.json)<br/>child-capable in #2942"]
        KL["kickback-ledger.ts"]
        RC["remediation-case-store.ts<br/>child-capable in #2942"]
    end

    subgraph Base["Graded / tested base — contract fixed here, implemented by #2942"]
        BRI["build-review-inputs.ts"]
        BRD["build-review-disposition.ts"]
        FSV["full-suite-verifier.ts"]
        AH["autoheal.ts"]
        TS["task-seed.ts"]
    end

    subgraph Recovery["Recovery CLIs"]
        RW["rewind --child"]
        TK["task --child"]
        KB["kickback-budget inspect --child"]
    end

    EV["types/events.ts → event-persister.ts<br/>optional child field, omitted when absent"]
    GOLD["N=1 golden byte-identity suite (new)<br/>state files, verdict paths, events,<br/>status, dashboard, PR body, shipped-record Cost"]

    BranchConsumers -->|"replace private prefix parsing"| FBI
    Stores -->|"resolve file path"| PATH
    PATH --> ACT
    Recovery -->|"default child"| ACT
    Recovery --> Stores
    Base -.->|"optional baseRef checked before each site's existing ladder"| BaseNote["existing per-site fetch and failure policy unchanged"]
    Stores -.->|"child-scoped writes tag events"| EV
    GOLD -.->|"asserts unchanged at N=1"| Stores
    GOLD -.-> EV
    GOLD -.-> BranchConsumers
```

## Diagram — state access at N=1 and with a child

```mermaid
sequenceDiagram
    participant Caller as step runner or recovery CLI
    participant Act as resolveActiveChild
    participant Path as pipelinePathFor
    participant Store as state store (e.g. gate-verdicts)
    participant FS as worktree .pipeline/
    participant Spine as ConductorEventEmitter

    Caller->>Act: active child for this worktree?
    alt N=1 (flag off, unsliced plan, or no cursor yet)
        Act-->>Caller: no child
        Caller->>Store: write verdict for «step», no child
        Store->>Path: path for gates/«step».json, no child
        Path-->>Store: .pipeline/gates/«step».json (today's path)
        Store->>FS: write (bytes identical to today)
        Caller->>Spine: emit event, child field left undefined
        Note over Spine: JSON.stringify drops undefined, so events.jsonl is unchanged
    else child k supplied (--child k with existing children/«k»/, or the #2942 active child)
        Act-->>Caller: child k
        Caller->>Store: write verdict for «step», child k
        Store->>Path: path for gates/«step».json, child k
        Path-->>Store: .pipeline/children/«k»/gates/«step».json
        Store->>FS: write (never touches another child's or the feature's file)
        Caller->>Spine: emit event with child k
    end
```

## Legend

- **`feature-branch-identity.ts`** becomes the single owner of "which feature does this branch
  belong to, and is it the leaf or child k". Today four modules parse slugs privately
  (`finish-record-cli.ts`, `halt-pr-reconciliation.ts`, `daemon-halt-pr-operations.ts`,
  `github-operations-cli.ts`, with `DAEMON_BRANCH_PREFIX` defined twice), and several more
  hardcode `feat/daemon-${slug}` or glob `feat/daemon-*`. The leaf keeps `feat/daemon-«slug»`.
  Children are `feat/c«k»/«slug»` (operator decision). A slug never contains `/`, so the parse
  is unambiguous, and the name has no git directory/file conflict with the leaf.
- **Child context** is orthogonal to `StepName`. No step-name type changes. `StepName` appears
  at more than 300 sites, so a typed `{kind, childId}` identity was rejected. A store asked for
  "no child" resolves today's path, so N=1 byte-identity is structural, not something asserted
  after the fact. The golden suite proves it anyway.
- **`pipelinePathFor`** is the one place a per-child path is formed. Directory sweeps over
  `.pipeline/gates/` (for example `gate-verdicts.ts` readdir) must not descend into
  `children/`.
- **Base override** is an optional input consumed *before* each site's existing ladder. The four
  graded/tested-base sites share a primitive but differ deliberately in fetch policy and failure
  semantics (throw, fall back to the fresh base, run the aggregate suite, or widen to `HEAD`). A
  single unified resolver would change three of them at N=1, so they stay separate.
- **Events** gain an optional `child` that is left `undefined` (never `null`) at N=1. The
  persister spreads the event into `JSON.stringify` with no key sorting or hashing, so an absent
  field leaves `events.jsonl` byte-identical.
- **Recovery CLIs** accept `--child «k»` and otherwise default to `resolveActiveChild`. Until
  #2942 that means "no child", so today's invocations and runbook recipes behave exactly as now.
- Dashed edges are constraints or assertions, not runtime calls.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-10-03 | Initial diagram. | Make the identity, child-context, base-override and event seams explicit before implementation (#2940). This ticket builds the identity, the per-child storage reached by the recovery CLIs, and the event field. The base override and active-child resolution are #2942's. |
