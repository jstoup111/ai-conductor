# Sequence + Components: Daemon Owner-Gating

**Last updated:** 2026-06-30
**Scope:** Where the owner gate sits inside the daemon's autonomous discovery path
(`discoverBacklog`), how the daemon owner is resolved, and the swappable identity/provenance seam
that keeps the design forward-compatible with a platform-provided (EKS) identity.

## Component View (the seam)

```mermaid
graph TD
  DB["discoverBacklog - daemon discovery"]
  CF["Existing content filters - plan, stories, dep-tree, processed"]
  GATE["OwnerGate - build / skip decision"]

  subgraph SEAM["Swappable identity + provenance seam"]
    IR["IdentityResolver - who is this daemon"]
    PR["ProvenanceReader - who owns this spec"]
  end

  subgraph IDIMPL["IdentityResolver implementations"]
    CFG["ConfiguredOwner - from daemon config"]
    GH["GhLoginOwner - gh authed user fallback"]
    PLAT["PlatformIdentity - EKS OIDC, FUTURE"]
  end

  subgraph PRIMPL["ProvenanceReader implementations"]
    STAMP["CommittedStampReader - reads owner stamp on base branch"]
    SIGN["SignedProvenance - verified, FUTURE"]
  end

  DB --> CF
  CF --> GATE
  GATE --> IR
  GATE --> PR
  IR --> CFG
  IR --> GH
  IR -.future.-> PLAT
  PR --> STAMP
  PR -.future.-> SIGN

  classDef future stroke-dasharray: 5 5
  class PLAT,SIGN future
```

The dashed nodes are **not built this iteration**. The point of the seam is that `OwnerGate`
depends only on the `IdentityResolver` and `ProvenanceReader` abstractions — so a stronger,
platform-provided identity (EKS OIDC) and a verified provenance source can replace the cooperative
config/gh + committed-text implementations **without changing the gate's build/skip behavior**.

## Sequence: gating one content-eligible spec

```mermaid
sequenceDiagram
  participant D as discoverBacklog
  participant IR as IdentityResolver
  participant CFG as Config
  participant GH as gh CLI
  participant G as OwnerGate
  participant T as Base-branch spec tree
  participant L as Daemon log

  Note over D,IR: Owner resolved once per pass
  D->>IR: resolve daemon owner
  IR->>CFG: read configured owner
  alt configured owner present
    CFG-->>IR: configured identity
  else not configured
    IR->>GH: query authenticated login
    alt gh ok
      GH-->>IR: gh login
    else gh error or absent
      GH-->>IR: no result
      Note over IR: owner unresolved
    end
  end
  IR-->>D: daemon owner or unresolved

  Note over D,G: Per content-eligible spec
  D->>G: decide spec, daemon owner
  alt daemon owner unresolved
    G->>L: warn once - gate inactive
    G-->>D: build - fail open, today behavior
  else owner resolved
    G->>T: read committed owner stamp
    alt stamp matches daemon owner
      G-->>D: build
    else stamp is a different owner
      G->>L: skip - owned by other, not you
      G-->>D: skip
    else no stamp - un-owned
      G->>T: read spec merge time
      alt merged before cutover
        G-->>D: build - grandfathered
      else merged on or after cutover
        G->>L: skip - un-owned, post cutover
        G-->>D: skip
      end
    end
  end
```

## Legend

- **discoverBacklog** — the existing daemon discovery entry point; the owner gate runs **after**
  the existing content filters, never replacing them.
- **OwnerGate** — the new decision unit. Pure function of `spec`, resolved `daemonOwner`, the
  committed stamp, and (for un-owned specs) merge time vs. cutover.
- **Seam** — `IdentityResolver` + `ProvenanceReader` are the abstractions architecture-review must
  ratify; today's implementations are config/gh and committed-stamp, future ones are EKS-platform
  identity and signed provenance.
- **fail open** — an unresolved owner reproduces today's behavior (build all) plus a warn-once line,
  by deliberate choice (PRD FR-3 / Open Question).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-06-30 | Initial feature diagram | Created during DECIDE for daemon owner-gating |
