# Architecture: inherited base deletion of sealed protected artifacts (#1752, absorbs #1676)

**Stem:** `base-inherited-artifact-deletion-deadlocks-both-se`
**Tier:** M — lightweight architecture pass
**Builds on:** `.docs/architecture/manual-rebase-strands-protected-artifact-seal.md` (#1229 provenance
probe), `.docs/architecture/no-operator-command-to-reseal-a-protected-decide-a.md` (operator reseal)

## Scope

No component moves and no module gains a dependency. Changes stay inside
`src/conductor/src/engine/protected-artifact-seal.ts`:

1. The deletion loop in `inspectSeal` consults the existing base-inheritance probe
   (`inheritedFromBase` → `matchesBaseTip` / `branchUntouchedInheritance`), the same one the
   "added" and "changed" checks already use.
2. Each sealed path confirmed as an inherited deletion is pruned from the seal through the existing
   atomic seal persistence. That write appends a `rebaselines` entry (trigger
   `inherited-base-deletion`) recording the pruned paths and the base commit that deleted each one.
   It then emits the existing `protected_artifact_rebaseline` event, so no new channel is added.
3. `resealProtectedArtifactSeal` goes through the same inspection, so an operator reseal no longer
   refuses because an inherited deletion exists somewhere else in the seal.
4. Every refusal reason names the artifact and its attribution: `feature-authored`,
   `base-inherited`, or `provenance undeterminable`.

Out of scope: rotation's exactly-append-only test for a feature's own plan. `conduct reseal` stays
the documented recovery for that shape. The step topology, the seal file version, and the event
union's variants are unchanged. The only addition is an optional per-path deleting-commit field on
the rebaseline record.

## Component view (C4 level 3, seal boundary only)

```mermaid
flowchart TB
    subgraph engine["src/conductor/src/engine"]
        COND["conductor.ts<br/>BUILD/SHIP step guard"]
        RESEAL_CLI["conduct reseal<br/>operator command"]
        subgraph seal["protected-artifact-seal.ts"]
            INSPECT["inspectSeal<br/>CHANGED: deletion loop<br/>consults inheritance"]
            PROV["inheritedFromBase<br/>matchesBaseTip ·<br/>branchUntouchedInheritance"]
            PRUNE["NEW: prune inherited deletions<br/>trigger inherited-base-deletion"]
            PERSIST["persistProtectedArtifactSealRotation<br/>atomic write + rebaselines entry"]
            RESEAL["resealProtectedArtifactSeal<br/>CHANGED: shares pruning inspection"]
            VERD["rotationRefusalVerdict /<br/>refusal reasons<br/>CHANGED: attribution"]
        end
        TEL["ConductorEventEmitter<br/>protected_artifact_rebaseline"]
    end

    STATE[".pipeline/protected-artifact-seal.json<br/>gitignored, per-worktree"]
    GIT["git<br/>merge-base · diff · ls-tree · log"]

    COND -->|"verify before every<br/>BUILD/SHIP attempt"| INSPECT
    RESEAL_CLI --> RESEAL
    RESEAL --> INSPECT
    INSPECT -->|"sealed path absent"| PROV
    PROV --> GIT
    INSPECT -->|"inherited deletions"| PRUNE
    PRUNE -->|"deleting base commit"| GIT
    PRUNE --> PERSIST
    PERSIST --> STATE
    PERSIST --> TEL
    INSPECT --> VERD

    classDef changed stroke-width:3px;
    class INSPECT,PRUNE,RESEAL,VERD changed;
```

## Per-path deletion classification

```mermaid
flowchart TD
    START["sealed path absent<br/>from workspace"] --> EXCL{"excluded by<br/>operator reseal scope"}
    EXCL -->|yes| SKIP["skip"]
    EXCL -->|no| REF{"base ref resolves<br/>and merge-base exists"}
    REF -->|no| UNDET["REFUSE<br/>provenance undeterminable: «path»<br/>names missing ref or failed probe"]
    REF -->|yes| TOUCH{"HEAD changed this path<br/>since merge-base"}
    TOUCH -->|yes| AUTH["REFUSE<br/>Protected artifact deleted: «path»<br/>feature-authored"]
    TOUCH -->|no| HEADHAS{"HEAD tree<br/>contains path"}
    HEADHAS -->|yes| WS["REFUSE<br/>Protected artifact deleted: «path»<br/>uncommitted workspace change"]
    HEADHAS -->|no| INH["base-inherited deletion<br/>tolerated"]
    INH --> PR["prune from seal<br/>rebaselines entry: paths + deleting base commit"]

    classDef added stroke-width:3px;
    class INH,PR added;
```

## Verification flow after a rebase across a base deletion

```mermaid
sequenceDiagram
    participant C as conductor step guard
    participant S as inspectSeal
    participant P as inheritedFromBase
    participant G as git
    participant W as seal persistence
    participant E as event spine

    C->>S: verify seal (featureDesc, baseBranch)
    S->>S: sealed path «path» absent from workspace
    S->>P: classify «path»
    P->>G: merge-base, diff base...HEAD, ls-tree HEAD
    G-->>P: untouched by feature, absent at HEAD
    P-->>S: inherited
    S->>G: log deleting commit of «path» on base
    S->>W: prune «path», append rebaselines entry
    W->>E: protected_artifact_rebaseline (trigger inherited-base-deletion)
    S-->>C: ok, seal without «path»
```

## Legend

- **CHANGED / NEW** nodes (thick border) are the only behavioral changes.
- `«path»` is any sealed protected `.docs/` artifact path.
- "Feature-authored" means the feature branch changed the path after its merge-base with the base
  branch. "Base-inherited" means the base branch alone removed it.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-07 | Initial generation | #1752 / #1676 DECIDE, Approach C (tolerate + prune with audit) |
| 2026-10-07 | Plan update: prune persists only on an `ok` composed verdict and is folded into the rotation write when rotation is permitted (ADR D4 as revised); refusal labels use the closed attribution set | /plan |
