# Sequence + Components: Per-child BUILD region for stacked features

**Last updated:** 2026-10-07
**Scope:** How the build loop completes a stacked feature child by child (#2942). It covers the
active-child cursor, child branch creation, switching and closure, the per-child region
(`acceptance_specs` → `build` → `test_suite` → `build_review`), per-child caps, the commit-hook
membership check, halt records, and the rebase guards that hold until #2943. Restack (#2943), fix
routing (#2944), publication (#2945) and concurrency (#2948) are out of scope. With no child, every
path below collapses to today's flat loop.

## Diagram: child lifecycle in one worktree

```mermaid
sequenceDiagram
    participant Cond as conductor loop
    participant CB as coverage_binding
    participant Cur as child-cursor.ts
    participant Git as git refs
    participant Store as .pipeline/children/«k»/
    participant Region as region steps
    participant Spine as event spine

    Cond->>CB: run whole-feature, once plus existing triggers
    CB->>CB: eligibility and ownership from 2941, position-immutability guard
    CB-->>Cond: envelope sealed with positions and story ownership
    Cond->>Cur: resolve active child
    Cur->>Git: closure refs, child branch refs, checked-out ref
    alt no child refs, no closure refs, no children dir, and (flag off or N below 2)
        Cur-->>Cond: no child (today's flat paths)
    else children exist or are about to
        Cur-->>Cond: active = lowest position without a closure ref
        opt branch for active child missing
            Cond->>Git: probe reserved feat/c«k», check max_slices, CAS create branch at parent tip, child 1 at leaf tip
            Cond->>Spine: child_started {child}
        end
        opt checkout differs from active child's branch
            Cond->>Git: switch (refused on dirty tree, no autostash), reset current-task
            Cond->>Spine: child_switched {from, to}
        end
        loop region for active child k
            Cond->>Region: dispatch acceptance_specs, build, test_suite, build_review
            Region->>Store: verdicts, step status, evidence, ledger, remediation cases
            Note over Region,Store: caps, stall and stuck-gate guard are per child
        end
        Cond->>Git: CAS update-ref closed/c«k» to child tip
        Cond->>Spine: child_closed {child}
        alt next position is the leaf
            Cond->>Git: guarded move of feat/daemon-«slug» to child N-1 tip (leaf has no own commits)
        else next is an intermediate child
            Cond->>Git: CAS create feat/c«k+1»/«slug» at child k tip
        end
    end
    Note over Cond: after the leaf region: whole-feature gates on the leaf (manual_test, prd_audit, as-built, rebase, SHIP)
```

## Diagram: components touched

```mermaid
graph TD
    subgraph Identity["#3019 foundation (existing)"]
        FBI[feature-branch-identity.ts]
        CC[child-context.ts: ChildId, pipelinePathFor]
    end
    subgraph New["new in #2942"]
        CUR[child-cursor.ts: active child, closure refs]
        LIFE[child-lifecycle.ts: create, switch, close, leaf move]
        BASE[resolveChildBase: child-parent, parent-missing, parent-not-ancestor]
        OVL[conduct-state overlay + routed mutation port]
        MEM[conduct task-membership-check]
    end
    subgraph Loop["loop control (made child-aware)"]
        SEL[selector.ts / resume.ts / auto-resume.ts]
        CON[conductor.ts: stuck-gate guard, stall, kickbacks, FINISH fence]
        KL[kickback-ledger.ts + every caller]
        RK[daemon-rekick.ts: rebase-first guard, resume auth]
    end
    subgraph Gates["region gates (child-scoped)"]
        ACC[artifacts.ts acceptance + build predicates]
        FSV[full-suite-verifier / complete-verifier]
        BRI[build-review-inputs / projections: base, Done-when, security at leaf]
    end
    subgraph Ops["operator surfaces"]
        CLI[rewind / task / kickback-budget default child]
        HALT[halt-record: Child field, no child push]
        DASH[daemon status + dashboard]
        EV[types/events.ts + event-sinks: child events]
    end
    CUR --> FBI
    CUR --> CC
    LIFE --> CUR
    SEL --> OVL
    CON --> CUR
    CON --> LIFE
    OVL --> CC
    KL --> CC
    ACC --> BASE
    FSV --> BASE
    BRI --> BASE
    BASE --> CUR
    MEM --> FBI
    RK --> CUR
    CLI --> CUR
    HALT --> CUR
    DASH --> CUR
    LIFE --> EV
```

## Legend

- **Child cursor.** The cursor is derived from git, never from a state file:
  - **Closure** is a monotone engine ref, `refs/conductor/«slug»/closed/c«k»`. It is written by
    compare-and-swap, sits outside `refs/heads`, is never pushed, and survives worktree recreation.
  - **Ancestry** is only a divergence check. If a closed child's tip is not an ancestor of the next
    child, the engine halts needs-human, because the stack needs a restack (#2943).
- **Positions** come from the sealed `coverage_binding` envelope, never plan text (umbrella ADR D5).
- **"No child".** The flag gates only the creation of children. Once child refs or child state
  exist, they decide the cursor.
- **Leaf move.** The leaf is moved by a guarded `update-ref` only when it has no commits of its
  own. Otherwise the engine halts.
- **Region stores** live under `.pipeline/children/«k»/` (#3019 seam). Whole-feature state stays
  flat: `coverage_binding`, task-status, `current-task`, growth budgets, receipts for whole-feature
  gates, and HALT.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-07 | Initial generation | DECIDE for #2942 (Approach B, revised after adversarial review) |
