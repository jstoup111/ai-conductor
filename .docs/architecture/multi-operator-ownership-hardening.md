# Architecture: Multi-operator ownership hardening

Component view of operator-identity resolution after the hardening. The key structural
change: `spec_owner` is read only from **user** (machine) config, never from project
(repo) config, and unresolved identity is **fail-closed**.

## Identity resolution + gating flow

```mermaid
flowchart TD
  userCfg["user config -- home/.ai-conductor/config.yml -- per machine, NOT committed"]
  projCfg["project config -- repo/.ai-conductor/config.yml -- committed, shared"]

  subgraph validation["Config validation"]
    guard["anti-leak guard -- reject spec_owner in project config"]
  end

  subgraph identity["Identity resolution seam -- resolveDaemonOwner"]
    readUser["read spec_owner from USER config only"]
    ghFallback["gh login fallback"]
    unresolved["unresolved"]
  end

  projCfg --> guard
  guard -->|"spec_owner present -> REJECT loud"| failCfg["config load fails -- daemon refuses start"]
  userCfg --> readUser
  readUser -->|"absent"| ghFallback
  ghFallback -->|"gh unauth or no login"| unresolved

  readUser -->|"resolved id"| owner["daemonOwner id"]
  ghFallback -->|"resolved login"| owner

  unresolved -->|"FAIL-CLOSED"| skipAll["build nothing -- loud distinct log"]

  owner --> gate["decideSpecGate -- per merged spec"]
  stamp["spec Owner stamp -- repo/.docs/intake/slug.md"] --> gate
  gate -->|"stamp id == owner id"| build["BUILD"]
  gate -->|"stamp id != owner id"| skipOther["skip -- other-owner"]
  gate -->|"no stamp -- un-owned"| skipUnowned["skip -- un-owned -- LOUD log, no silent stall"]
```

## Authoring (write) side

```mermaid
flowchart TD
  decide["DECIDE authoring -- engineer land AND plain conduct DECIDE"]
  resolveAuthor["resolve author identity -- USER config spec_owner -> gh"]
  decide --> resolveAuthor
  resolveAuthor -->|"resolved"| writeStamp["writeIntakeMarker -- Owner: id in .docs/intake/slug.md"]
  resolveAuthor -->|"unresolved"| refuse["REFUSE to land -- loud error, no un-owned spec created"]
  writeStamp --> committed["Owner stamp committed with the spec"]
```

## Structural invariants

1. **Identity is machine-sourced.** `spec_owner` is read only from user config; the
   project-over-user merge is never consulted for it. Leak is impossible by construction.
2. **Anti-leak guard is fail-closed.** A `spec_owner` in a committed project config is a
   hard config-load rejection, not a warning.
3. **Unresolved identity is fail-closed** on both sides: the daemon builds nothing and
   logs loudly; authoring refuses to create an un-owned spec.
4. **Un-owned merged specs are surfaced loudly**, never silently skipped.
5. **Seam preserved.** All identity resolution stays behind `resolveDaemonOwner`, so a
   future `PlatformIdentity` (EKS/OIDC) resolver slots in ahead of the user-config read
   without touching the gate.
