# Architecture: Auto-Resolve Merge Conflicts on Open Watched PRs

**Last updated:** 2026-07-04
**Scope:** The conflict-resolution flow wired from `sweepMergeableLabels`
(`mergeable-sweep.ts`) into the existing rebase engine (`rebase.ts`) for open PRs that
GitHub reports as CONFLICTING. Extends the finish-time resolution sub-loop
(`2026-06-29-rebase-resolution-subloop.md`) to already-open PRs. Reuses `resolveRebaseConflicts`,
the deterministic CHANGELOG resolver, the FR-8/FR-9 acceptance guards, and the gated `/rebase`
skill dispatch — all unchanged.
**Source PRD:** `.docs/specs/2026-07-04-auto-resolve-open-pr-conflicts.md`

---

## Control flow — sweep tick with auto-resolution

```mermaid
graph TD
    sweep["sweepMergeableLabels tick<br/>(existing, per watched PR)"] --> state{"PR merge state"}
    state -->|"MERGED / CLOSED"| prune["prune watch entry<br/>(existing FR-13)"]
    state -->|mergeable| addlbl["ensure mergeable label<br/>(existing)"]
    state -->|CONFLICTING| remed{"needs-remediation<br/>label present?"}

    remed -->|"yes (sticky escalation)"| skip["skip — operator owns it<br/>PRD FR-14"]
    remed -->|no| cool{"cooldown elapsed and<br/>attempts under cap?<br/>PRD FR-15"}
    cool -->|no| skip2["skip this tick<br/>(state in watch entry)"]
    cool -->|yes| wt["acquire resolution worktree<br/>.worktrees/resolve-«slug»<br/>fetch + checkout PR branch<br/>PRD NFR-2"]

    wt --> rb["git rebase origin/«default»"]
    rb -->|clean| verify
    rb -->|conflicts| tier1["Tier 1 — deterministic resolvers<br/>CHANGELOG keep-main+re-append (existing)<br/>.docs parallel artifacts keep-both (new)<br/>PRD FR-4 FR-5 FR-6"]
    tier1 -->|"all resolved"| verify
    tier1 -->|"conflicts remain"| tier2["Tier 2 — resolveRebaseConflicts<br/>gated /rebase skill dispatch<br/>cap from resolved-config, default 3<br/>PRD FR-7 (existing loop, reused)"]
    tier2 -->|resolved| verify
    tier2 -->|"gave up / cap exhausted"| abort["git rebase --abort<br/>worktree torn down<br/>PR branch untouched<br/>PRD FR-12"]

    verify{"acceptance guards"} --> g8{"isBranchCurrent<br/>PRD FR-9"}
    g8 -->|no| abort
    g8 -->|yes| g9{"featureCommitsPreserved<br/>PRD FR-8"}
    g9 -->|no| abort
    g9 -->|yes| suite{"full test suite green?<br/>PRD FR-10"}
    suite -->|no| abort
    suite -->|yes| push["git push --force-with-lease<br/>PRD FR-11"]
    push -->|"lease rejected"| abort
    push -->|ok| done["PR refreshed — mergeable again<br/>log outcome PRD FR-16<br/>reset attempt state, remove worktree"]

    abort --> esc["escalate — remove mergeable label,<br/>add needs-remediation (REST),<br/>comment concrete reason on PR<br/>PRD FR-13"]
    esc --> log2["log outcome PRD FR-16"]

    classDef new fill:#d4f4dd,stroke:#2a7,color:#000;
    classDef guard fill:#fde8c4,stroke:#c83,color:#000;
    classDef existing fill:#e8eef7,stroke:#47a,color:#000;
    class remed,cool,wt,rb,tier1,done,esc,log2,skip,skip2,abort new;
    class g8,g9,verify,suite,push guard;
    class sweep,state,prune,addlbl,tier2 existing;
```

## Legend

- **Green** — new in this feature: the CONFLICTING branch of the sweep, cooldown/attempt
  gating, the resolution worktree, the `.docs` keep-both deterministic resolver, escalation
  and cleanup.
- **Orange** — the hard gates. Nothing is published unless the branch is current, every
  pre-rebase feature commit survives, the full suite is green, and the lease push succeeds.
  Any failure funnels to `abort`, which leaves the PR branch byte-for-byte untouched — the
  lease push is the only externally visible mutation on the success path.
- **Blue** — existing, unchanged machinery: the sweep's label logic and pruning, and
  `resolveRebaseConflicts` + `/rebase` dispatch (reused verbatim from finish-time).
- **Termination:** every path ends at `done` (refreshed), `esc` (sticky human escalation),
  or a skip. Attempts are capped and cooled down (FR-15), so a pathological PR converges to
  `esc`, never loops.

## Component placement

| Concern | Module | New/Existing |
|---------|--------|--------------|
| CONFLICTING detection + dispatch decision | `mergeable-sweep.ts` | extended |
| Attempt count / cooldown persistence | watch entry in `.daemon/mergeable-watch.jsonl` | extended schema |
| Resolution worktree lifecycle | `worktree-shared.ts` helpers | reused |
| Rebase + deterministic CHANGELOG resolver | `rebase.ts` | reused |
| `.docs` keep-both deterministic resolver | `rebase.ts` | new |
| Bounded skill resolution + guards | `rebase.ts` `resolveRebaseConflicts` | reused |
| Suite runner | project verify convention (arch-review decides) | new wiring |
| Labels + comments (REST) | `pr-labels.ts` | extended |

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-04 | Initial generation | New auto-resolution flow for open watched PRs (intake #247) |
