# Components: removed-but-registered worktree reconciliation and durable creation-failure park (#1022)

**Last updated:** 2026-07-27
**Scope:** The worktree create/reconcile seam (`worktree-shared.ts`) shared by the daemon
(`daemon-deps.ts`) and the engineer (`worktree-authoring.ts`), and the daemon's
creation-failure recording path (`daemon-runner.ts` → `park-marker.ts`) that gates
re-dispatch in `daemon.ts:pickEligible`.

## Diagram

```mermaid
graph TD
    subgraph Callers["Two callers of the one worktree mechanism"]
        DD["daemon createWorktree<br/>daemon-deps.ts:97"]
        EW["engineer createEngineerWorktree<br/>worktree-authoring.ts:82"]
    end

    subgraph Shared["worktree-shared.ts — ensureWorktree"]
        REG["isRegisteredWorktree«root,path»<br/>CHANGED: parse porcelain into<br/>blank-line-separated RECORDS;<br/>a record carrying `prunable`<br/>is NOT usable"]
        PRUNE["NEW: reconcileStale«root»<br/>git worktree prune<br/>fires only when a prunable<br/>record for THIS path was seen"]
        ATT["attach: git worktree add «path» «branch»"]
        NEW["create: git worktree add -b «branch» «path» «base»"]
    end

    subgraph Durable["Durable state in the PRIMARY checkout"]
        PARK[(".daemon/parked/«slug»<br/>writeAutoPark — park-marker.ts:220<br/>body prefix `auto-parked:`")]
        HALT[(".pipeline/HALT<br/>INSIDE the worktree —<br/>UNAVAILABLE when creation failed")]
    end

    subgraph Dispatch["daemon.ts pickEligible"]
        ISP["isParked«slug» :136<br/>skip UNCONDITIONALLY"]
        ISH["isHalted«slug» :153<br/>exists«worktree/.pipeline/HALT»"]
        ELIG["dispatch feature"]
    end

    DD --> REG
    EW --> REG
    REG -->|"usable registration"| REUSE["reuse (resume)"]
    REG -->|"prunable record seen"| PRUNE
    PRUNE --> ATT
    REG -->|"absent + branch exists"| ATT
    REG -->|"absent + no branch"| NEW

    ATT -->|"throws 128"| FAIL
    NEW -->|"throws 128"| FAIL
    FAIL["createWorktree throws<br/>daemon-runner.ts:311<br/>worktree is still null"]

    FAIL -->|"NEW: catch branch when worktree === null<br/>daemon-runner.ts:535"| PARK
    FAIL -.->|"OLD HOLE: `if (worktree)` guard means<br/>nothing is written anywhere"| HALT

    PARK --> ISP
    ISP -->|"parked → skip, survives restart"| STOP["no re-dispatch"]
    ISH -->|"false: no worktree, no HALT file"| ELIG
    ELIG -.->|"OLD: immediate re-dispatch,<br/>no backoff = #681 hot spin"| DD
```

## The three seams and what changes at each

| Seam | Today | After |
|---|---|---|
| `isRegisteredWorktree` (`worktree-shared.ts:86-102`) | Line-wise filter on `worktree ` prefix; a prunable path reports registered → `ensureWorktree` returns `'reused'` for a directory that does not exist | Record-wise parse; a record carrying a `prunable` line reports **not registered**, and the caller learns a stale registration was observed |
| `ensureWorktree` (`worktree-shared.ts:51-68`) | Falls straight to attach/create, which exit 128 against the surviving stale registration | Runs `git worktree prune` in `root` first **when and only when** a prunable record for this path was observed, then attaches/creates normally |
| `daemon-runner.ts` catch (`:529-543`) | `if (worktree)` — a pre-worktree throw records nothing; slug re-enters `pickEligible` as eligible | When `worktree === null`, write `writeAutoPark(projectRoot, slug, reason)` carrying the 128 cause and the prune remedy; `isParked` then gates dispatch durably |

## Why the auto-park and not a HALT

`.pipeline/HALT` is inside the worktree, so it is structurally unavailable on the exact
failure being fixed. Among the durable `.daemon/` surfaces, only `.daemon/parked/<slug>`
both survives a daemon restart and is consulted by `pickEligible` — and it is consulted
*first* (`daemon.ts:136`), before the in-memory `parked`/`started` sets, so it is a hard
dispatch gate rather than a per-run hint. `writeAutoPark` already resolves to the main repo
root even when called from a worktree (`park-marker.ts:50`), which is what makes it writable
in a context where no feature worktree exists.

## Invariants this must preserve

- **Lazy base resolution.** `resolveBase` is still invoked only on the fresh-branch path;
  the reuse and attach paths issue no extra git call. The daemon-deps test asserts this
  exact call ordering and must stay green.
- **Prune is never unconditional.** It fires only after a prunable record for the requested
  path is observed, so a healthy repo's git call sequence is byte-identical to today.
- **Park provenance stays distinguishable.** The auto-park is written through
  `writeAutoPark`, so `getProvenanceType` (`park-marker.ts:265`) continues to separate it
  from an operator park and `conduct daemon unpark` behaves normally.
- **Both callers share one mechanism.** The engineer inherits the record-aware check with no
  engineer-specific branch; its FR-7 strict-abort message replaces the current bare `ENOENT`.
