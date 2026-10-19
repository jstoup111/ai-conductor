# Sequence + Components: Publish, review and ship a stacked feature as a GitHub native stack (#2945)

**Last updated:** 2026-10-17
**Scope:** The ship-path slice of #2945, the publication ticket of the stacked child-plans chain
(chain design in #2940). It covers:
- FINISH publishing a stacked feature as a native stack, one PR per child;
- the member bodies and the existing release and shipment contracts each member reuses (approach
  B);
- leaf-only ship detection and teardown after the leaf merges;
- non-leaf lifecycle events;
- the fail-closed published-stack tip guard.

Built on the shipped chain:
- #2940: branch grammar in `feature-branch-identity.ts`, per-child state, the optional event
  `child`.
- #2942: the per-child build region, closure refs and the positions ref.
- #2943: the journaled restack and `executeRemoteGit` pushed-tip records.
- #2944/#3210: routed repair, which runs before publication.

Out of scope, each filed separately: `bundled` and `Stack-Child:` contracts (#3267), `stack adopt`
and verified server-side rebase acceptance (#3268), routed-fix PR comments (#3269), and red
intermediate CI surfacing (#3270).

**Stacked** below means the sealed positions ref declares at least two positions, whatever
`stacked_prs.enabled` says now (ADR decision 1). Any other feature takes today's single-PR path
through every diagram, byte for byte; its stack observer answers `not-applicable` from local refs
before any GitHub read.

## Diagram: FINISH publication, stacked feature

The leaf draft still opens at SHIP entry (`adr-2026-07-29-ship-start-draft-pr`) with base
`«default»`. Child PRs open only during FINISH, after every leaf gate has passed.

```mermaid
sequenceDiagram
    participant FP as advanceFinishPublication
    participant Obs as observePublicationSnapshot
    participant RG as executeRemoteGit (pushed-tip records)
    participant GH as guarded GitHub operations
    participant Rec as publication record ref
    participant Spine as event spine

    FP->>Obs: observe
    Obs->>Rec: read refs/conductor/«slug»/publication (child map, stack number)
    Obs->>GH: per member: pr list --head feat/c«k»/«slug», stack read
    Obs-->>FP: snapshot with stack dimension
    Note over FP: establish_pr is unchanged, for the leaf only
    Note over FP: establish_child_prs, one effect, each sealed child position «p» in order
    FP->>GH: leaf ready? convert back to draft (stack_member_redrafted)
    FP->>RG: verify closure c«p», ls-remote feat/c«p»/«slug», if absent plain-push the closure SHA
    RG->>RG: record pushed tip, or diverged when present but unrecorded or different
    FP->>GH: find PR for head in any state, else create draft, base «default» or previous position
    GH-->>FP: PR url
    FP->>Rec: CAS-write member «p»
    FP->>Spine: stack_member_published
    Note over FP: verify_release_readiness, author and judge prose for the leaf only, as today
    FP->>FP: write_shipped_record, on the leaf only, as today
    FP->>Rec: assemble_stack: CAS-write retarget phase intended
    FP->>GH: pull-request.retarget leaf base to the last child branch
    FP->>Rec: CAS-write retarget phase observed
    FP->>GH: stack.read for member 1, then stack.create or stack.add for the missing members
    GH-->>FP: stack number and members with head SHAs
    FP->>FP: verify order equals the record and each head SHA equals its recorded pushed tip
    FP->>Rec: CAS-write stack number
    FP->>Spine: stack_assembled
    FP->>GH: ready_pr top-down: leaf by repairPresentation, then children highest to lowest by postconditions plus ensureShipReady, re-reading the stack before each flip
    FP->>FP: record_outcome, leaf pr_url as today
```

## Diagram: publication transitions (stacked additions)

```mermaid
stateDiagram-v2
    [*] --> establish_pr
    establish_pr --> establish_child_prs: leaf identity one and pushed
    establish_child_prs --> verify_release_readiness: every child pushed and has a draft PR
    establish_child_prs --> halted: member closed, merged, ready, or wrong base or head
    verify_release_readiness --> author_pr_prose
    author_pr_prose --> judge_pr_prose: leaf only, as today
    judge_pr_prose --> write_shipped_record
    write_shipped_record --> assemble_stack
    assemble_stack --> ready_pr: stack verified
    assemble_stack --> halted: tips or membership mismatch, stack-tip-diverged
    ready_pr --> halted: membership or head changed before a flip
    ready_pr --> record_outcome
    record_outcome --> [*]
    halted --> [*]
```

A single-PR feature's snapshot reports the stack dimension `not-applicable`. Its two stacked
transitions are never selected, so it walks today's seven transitions under today's 2 × 7
allowance. Each stacked transition processes every member in one effect, so a stacked feature's
allowance is 2 × 9 whatever its size.

## Diagram: member bodies and required checks

```mermaid
graph LR
    subgraph Child["child k PR, base default or feat/c«k-1»/«slug»"]
        CB["engine-rendered body: slice title, this child's stories, tasks and diffstat"]
        CN["stack navigation: members in order, this one marked"]
        CR["Release-Disposition: no-note"]
        CP["no Plan: declaration, no Closes, no Migration"]
    end
    subgraph Leaf["leaf PR, retained SHIP draft, base feat/c«N-1»/«slug» after retarget"]
        LB["leaf-scoped body plus feature summary"]
        LN["stack navigation"]
        LR["release-disposition region: the feature's one note"]
        LP["Plan: declaration, Closes, build-review blocks, Migration last"]
        LS[".docs/shipped/«slug».md in the leaf diff"]
    end
    CR --> RM["release-metadata check: valid no-note, passes unchanged"]
    CP --> SA["shipment association: head ref is a child branch, not-applicable stack-child, passes"]
    LR --> RM
    LP --> SA2["shipment association: implementation with record, passes"]
    Child --> CI["ci.yml on stacked bases, ci-gate"]
    Leaf --> CI
```

## Diagram: post-publication lifecycle and teardown

```mermaid
flowchart TD
    W["mergeable sweep: one watch entry, the leaf PR; the record names the members"] --> S{"leaf PR state"}
    S -- OPEN --> M["read stack: each non-leaf member's state"]
    M -- "member newly merged, closed, or reverted" --> EV["emit stack_member_lifecycle, then CAS lastSeen; no ship, intake open"]
    S -- OPEN --> FZ["frozen: ci-fix ineligible, every restack producer refuses published-stack, route admission refuses, autoresolve escalates"]
    FZ --> WR{"any engine push or retarget to a member?"}
    WR -- yes --> TG{"recover push intents, then every member remote tip equals recorded pushed tip?"}
    TG -- yes --> PUSH["write with explicit expected-SHA lease"]
    TG -- "no, FINISH publication" --> HALT["HALT stack-tip-diverged, sweep-skipped, runbook recovery"]
    TG -- "no, best-effort push" --> SKIP["skip and log"]
    S -- "MERGED or CLOSED" --> SR{"shipped record on origin/main?"}
    SR -- no --> KEEP["retain entry: record not yet on main, or closed unmerged"]
    SR -- present --> WT["remove worktree, as today"]
    WT --> RCH{"each member merged with its squash commit on origin/main?"}
    RCH -- indeterminate --> KEEP2["retain entry for the next sweep"]
    RCH -- "some member not" --> MISS["stack_members_unreachable naming each PR, keep its branch and the record"]
    RCH -- all --> TD["CAS-delete each sealed child branch whose tip equals its merged head, by explicit name"]
    MISS --> TD
    TD --> REFS["delete conductor refs by explicit name, then positions and publication in this path only; else mark record tornDown"]
```

The ship gate is unchanged: only `.docs/shipped/«slug».md` on `origin/main` authorizes teardown, and
only the leaf diff carries that file. A merged lower prefix therefore can never ship the feature
or close its intake. A leaf merged into a child branch after a human dissolves the stack also
fails that gate.

## Diagram: components touched

```mermaid
graph TD
    subgraph Shipped["shipped by #2940 to #3210"]
        FBI[feature-branch-identity.ts: leafBranchFor, childBranchFor]
        CUR[child-cursor.ts + child-lifecycle.ts: positions, closures]
        PL[push-lease.ts + remote-git-operations.ts: pushed-tip records, expected-SHA lease]
        RRC[restack-refs-cleanup.ts: explicit-name ref teardown]
        EVT[types/events.ts: optional child]
    end
    subgraph New["new in this spec"]
        SPA[stack-publication.ts: observer, child push, members, assemble, verify, refusals]
        BODY[stack-member-body.ts: rendered child bodies and postconditions]
        PREC[stack-publication-record.ts: refs/conductor/«slug»/publication]
        TIP[stack-tip-guard.ts: called from executeRemoteGit]
        TDN[stack-teardown.ts: child deletion under the stack-member proof]
    end
    subgraph Amended["amended in this spec"]
        FPUB[finish-publication.ts: stack dimension, two transitions]
        FPP[finish-publication-production.ts: child effects, retained-draft lookup re-keyed]
        SDP[ship-draft-pr.ts: non-HEAD child push, child placeholder body]
        GHO[github-operations.ts + tracker-client.ts + mutation-policy.ts: stack.read, stack.create, stack.add, pull-request.retarget]
        CON[conductor.ts: retained-draft and release-gate lookup by recorded base]
        MS[mergeable-sweep.ts: member lifecycle, reachability, child teardown, ci-fix freeze]
        SHP[shipment-association + evidence CLI + audit + reconcile: head-ref stack-child guard]
        RST[restack call sites + daemon-rekick: published-stack refusal]
        LKP[retained-draft, release-metadata, region and halt-clearing lookups: two journaled bases]
        HM[halt-marker.ts + daemon-rekick.ts: stack-tip-diverged class]
        EV2[types/events.ts: stack publication and member lifecycle events]
        CIY[.github/workflows/ci.yml: stacked-base trigger]
        RB[docs/runbooks/stalled-or-stuck-feature.md: tip-diverged recovery]
    end
    FPUB --> SPA
    FPP --> SPA
    SPA --> BODY
    SPA --> GHO
    SPA --> PREC
    SPA --> SDP
    SDP --> PL
    SPA --> FBI
    SPA --> CUR
    MS --> PREC
    MS --> TDN
    TDN --> PREC
    MS --> TIP
    TIP --> PL
    TIP --> HM
    MS --> RRC
    SPA --> EV2
    MS --> EV2
    EV2 --> EVT
    CON --> PREC
    LKP --> PREC
    RST --> PREC
    SHP --> FBI
```

## Legend

- **Leaf.** The leaf is `feat/daemon-«slug»`, the retained SHIP draft and the feature's `pr_url`.
  **Child k** is `feat/c«k»/«slug»` for k = 1..N-1.
- **Publication record.** A compare-and-swap ref blob holding the child-to-PR map and the stack
  number. It survives worktree recreation (#497) and is deleted by explicit name at teardown.
  GitHub stays the source of truth on resume: every member is found or created by head ref.
- **Recorded pushed tip.** `refs/conductor/«slug»/pushed/«branch»`, written by `executeRemoteGit`
  (`adr-2026-10-10-stacked-restack-journaled-replay` D11).
- **Freeze and tip guard.** Once any member is published, engine rewrites of the stack are refused.
  The guard runs inside `executeRemoteGit`, and on retarget, after push-intent recovery, and never
  on a read. A partial merge the operator follows with the rest of the stack therefore never
  halts.
- **Positions.** Child positions are sealed and need not be contiguous; each child's base is the
  previous sealed position, and the last position is the leaf.
- **Events.** New members of the existing `ConductorEvent` union, carrying `child` where a member
  is named. No new channel.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-17 | Initial generation | #2945 DECIDE |
| 2026-10-17 | Rendered child bodies, top-down ready, freeze, journaled retarget, positions, teardown order | Architecture review (Codex and Claude adversarial rounds) |
| 2026-10-17 | Plain closure-SHA child push, all restack producers frozen, worktree removed before reachability, tornDown record | Conflict check |
| 2026-10-17 | Components named after the plan's modules (body renderer, record store, tip guard, teardown); no separate stacks adapter | Plan update |
