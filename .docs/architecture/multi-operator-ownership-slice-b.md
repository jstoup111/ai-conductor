# Architecture: Multi-operator ownership — Slice B (authoring-side)

**Last updated:** 2026-07-02
**Scope:** Component view of the authoring-side identity flow after Slice B, anchored to
the post-#185 (worktree-isolation) module layout. Companion sequence:
`sequences/slice-b-fail-closed-land.md`. Parent end-state view:
`multi-operator-ownership-hardening.md` (PR #183).

## Diagram

```mermaid
flowchart TD
  userCfg["user config -- ~/.ai-conductor/config.yml (machine-scoped)"]
  machineId["owner-gate/machine-identity.ts -- readMachineOwnerConfig + resolveDaemonOwner"]
  userCfg --> machineId
  machineId -->|"configured spec_owner"| resolved["resolved author id"]
  machineId -->|"absent -> gh login"| resolved
  machineId -->|"gh unauth"| unresolved["UNRESOLVED"]

  subgraph entries["Authoring entry points (all three converge on landSpec)"]
    cli["engineer-cli.ts land -- interim: loadConfig(target) project config"]
    loop["engineer/loop.ts run -- interim: loadConfig(target) project config"]
    conduct["plain /conduct DECIDE authoring -- B1: currently stamps nothing"]
  end

  cli -.->|"Slice B rewires"| machineId
  loop -.->|"Slice B rewires"| machineId
  conduct -.->|"B1 adds"| machineId

  land["engineer/land-spec.ts landSpec -- runs inside per-idea worktree"]
  entries --> land

  resolved --> gate{"identity gate (B2) -- BEFORE any write"}
  unresolved --> gate
  land --> gate
  gate -->|"resolved"| stamp["intake-marker.ts writeIntakeMarker -- Owner: id in .docs/intake/«slug».md"]
  gate -->|"unresolved -> REFUSE loud"| refuse["no branch, no marker, no artifact commit"]
  stamp --> commit["spec commit on spec/«slug» branch"]
```

## Legend

- Solid arrows: data/control flow after Slice B.
- Dashed arrows: the rewiring Slice B performs (replacing the interim
  `loadConfig(target)` project-config read that swallows the D2 guard failure to `{}`).
- The identity gate sits **ahead of every write** in `landSpec` — fail-closed means
  refusal happens before branch creation, marker write, or artifact commit.
- `machine-identity.ts` is the only identity source; the project config is never
  consulted for `spec_owner` (anti-leak, D2 — enforced by `validateConfig` since
  Slice A).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-02 | Initial generation | Slice B spec (issue #184), post-#185 anchoring |
