# Architecture: project teardown hook before worktree removal

**Last updated:** 2026-08-07
**Scope:** The acquire/release symmetry between the existing project setup entrypoint and the
new project teardown entrypoint; the three in-scope removal paths that invite it; the
containment boundary that keeps project-supplied code out of harness control flow; and where
the FR-10 coverage guard sits relative to the runtime path.

## Diagram 1 — Component view: acquire and release symmetry

```mermaid
graph TD
    subgraph prep["worktree-prepare.ts — preparation (existing)"]
        PREP["prepareWorktree(worktreePath, log, opts)"]
        NS["sanitizeNamespace(basename(worktreePath))<br/>pure function of the path"]
        SETUP["runProjectSetup(...)<br/>execa bin/setup<br/>env: CI=true, WORKTREE_NAMESPACE<br/>absent ⇒ log + return<br/>non-zero ⇒ throw SetupFailureError (50-line tail)"]
        PREP --> NS
        NS --> SETUP
    end

    subgraph tear["teardown runner — NEW (placement is an Open Question)"]
        TEAR["runProjectTeardown(worktreePath, log, opts)"]
        NS2["same sanitizeNamespace(basename(...))<br/>no marker, no ledger, no persisted state"]
        RUN["execa bin/teardown<br/>env: CI=true, WORKTREE_NAMESPACE<br/>absent ⇒ silent no-op (FR-4)<br/>bounded by timeout (FR-7)"]
        TEAR --> NS2
        NS2 --> RUN
    end

    subgraph proj["project-supplied (consumer repo)"]
        BS["bin/setup — acquires namespaced resources"]
        BT["bin/teardown — releases them (NEW)"]
    end

    subgraph inscope["IN SCOPE — removal paths that invite teardown (FR-5)"]
        DD["daemon-deps.ts:128 teardownWorktree<br/>keep=true ⇒ early return, no removal<br/>only keep=false caller: mergeable-sweep.ts:347 post-ship reap"]
        PC["daemon-park-cli.ts:220 reclaim-worktree<br/>→ worktree-shared.ts:71 removeWorktree"]
        PR["park-reconciliation.ts:639<br/>git worktree remove --force<br/>(+ rm -rf fallback for unregistered leftovers)"]
    end

    subgraph exempt["EXEMPT — recorded in the FR-10/FR-11 exemption list"]
        AR["autoresolve.ts:338 — DOES prepare, DOES leak<br/>deliberately deferred by operator"]
        EN["engineer/worktree-authoring.ts:145<br/>never calls prepareWorktree ⇒ nothing to release"]
        WM["worktree.ts:81 WorktreeManager.cleanup<br/>never calls prepareWorktree ⇒ nothing to release"]
    end

    SETUP -.invokes.-> BS
    RUN -.invokes.-> BT
    BS == "acquires under «namespace»" ==> RES[("namespaced project resources<br/>db / schema / queue prefix / port")]
    BT == "releases the same «namespace»" ==> RES

    DD --> TEAR
    PC --> TEAR
    PR --> TEAR

    GUARD["test/structural/ coverage guard (FR-10)<br/>every module issuing 'git worktree remove'<br/>routes through the runner OR is listed here"]
    GUARD -. "asserts at validation time, not runtime" .-> inscope
    GUARD -. "asserts the list is accurate (FR-11)" .-> exempt

    style tear fill:#e8f4ea,stroke:#2f7d4f
    style GUARD fill:#fdf3e0,stroke:#b8860b
    style exempt fill:#f6f6f6,stroke:#999,stroke-dasharray: 4 3
```

## Diagram 2 — Sequence: containment boundary on the post-ship reap

The reap path is drawn because it is the highest-frequency in-scope removal; the reclaim and
reconciliation paths differ only in who triggers them, not in the containment behavior.

```mermaid
sequenceDiagram
    participant Sweep as mergeable-sweep (shipped-record gate)
    participant Dep as daemon-deps teardownWorktree
    participant Runner as runProjectTeardown
    participant Script as bin/teardown (project code)
    participant Res as namespaced resources
    participant Git as git worktree remove --force
    participant Log as daemon log

    Sweep->>Dep: teardownWorktree(worktree, keep=false)
    Note over Dep: keep=true returns early — no removal, no teardown

    Dep->>Runner: run teardown BEFORE removal (FR-1)
    Runner->>Runner: namespace = sanitizeNamespace(basename(path)) (FR-3)

    alt no bin/teardown present
        Runner-->>Dep: silent no-op — no log, no output (FR-4)
    else bin/teardown present
        Runner->>Script: execa, cwd=worktree, env CI + WORKTREE_NAMESPACE (FR-2)
        Note over Runner,Script: bounded by timeout (FR-7)

        alt exits 0
            Script->>Res: release resources for «namespace»
            Script-->>Runner: success
            Runner->>Log: one-line summary — full output only when verbose (FR-9)
        else exits non-zero
            Script-->>Runner: failure + output
            Runner->>Log: worktree + outcome + output tail (FR-8)
            Note over Runner: swallowed — never rethrown (FR-6)
        else exceeds the time bound
            Runner-->>Runner: abandon the child process
            Runner->>Log: timeout entry naming the worktree (FR-7, FR-8)
        end
    end

    Dep->>Git: remove the worktree — reached on EVERY branch above
    Git-->>Dep: removed (existing best-effort .catch stays)
    Dep-->>Sweep: reap outcome unchanged from today (FR-6)
```

## Legend

- **Acquire/release symmetry** is the load-bearing structure. The namespace is a pure
  function of the worktree path (`sanitizeNamespace(basename(worktreePath))`), so the
  teardown runner recomputes exactly what the setup run used. No marker file, ledger, or
  persisted state is introduced — which is why a worktree recreated from its branch, having
  lost its transient `.pipeline/` state, still tears down correctly (FR-3).
- **The containment boundary** is the `runProjectTeardown` box. Every failure mode of
  project-supplied code — non-zero exit, timeout, spawn error — terminates there and becomes
  a log entry. The `git worktree remove` step is reached on every branch of the sequence,
  which is what makes FR-6 and FR-7 true by construction rather than by discipline.
- **Solid arrows into the runner** are the three in-scope invocation points (FR-5). Note
  that `daemon-deps.ts:128` covers two product paths at one code point: the post-ship reap
  is its only `keep=false` caller, while `daemon-runner`'s two calls pass `keep=true` and
  return before any removal.
- **The dashed exempt box** is not dead space — FR-11 requires its contents to be recorded
  accurately. `autoresolve.ts:338` is materially different from the other two: it *does* call
  `prepareWorktree` and *does* leak. It is exempt by operator decision, not because it is
  harmless, and the exemption list must say so.
- **The guard sits off the runtime path.** It executes in the validation suite, never during
  a build. Its arrows are assertions about the shape of the code, not calls. This is the
  distinction that makes it machinery under this repository's design principle: a newly added
  removal path fails validation at authoring time rather than leaking silently in production.
- **Guillemets** `«namespace»` / `«slug»` denote a variable part of a label.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-07 | Initial generation | Feature DECIDE — teardown hook before worktree removal (M tier) |
| 2026-08-07 | Reviewed against the implementation plan; no structural change | Plan-update pass. The plan's 18 tasks introduce no component, seam, or boundary the diagrams do not already show — the reconciliation single-invitation placement and the `keep === true` ordering were both settled during architecture review and are already drawn. |
