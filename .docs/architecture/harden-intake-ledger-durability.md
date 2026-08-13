# Components (L3): Intake Ledger Durability Hardening

**Last updated:** 2026-08-12
**Scope:** `src/conductor/src/engine/engineer/intake/ledger.ts` and its mutating callers,
after the corrupt-read fail-closed + lease-guarded read-modify-write change (intake #1476).
Extends [components-engineer-intake.md](components-engineer-intake.md), which shows the
ledger as a single opaque node.

## Diagram

```mermaid
graph TD
  subgraph writers["Mutating processes (concurrent, separate OS processes)"]
    CLI["engineer-cli verbs<br/>claim / unclaim / forget /<br/>reopen / writeback / handoff<br/>(7 createLedger sites)"]:::existing
    LOOP["engineer/loop.ts<br/>long-running intake capture<br/>(record on every polled envelope)"]:::existing
  end

  subgraph ledger["engineer/intake/ledger.ts"]
    API["Ledger (interface)<br/>known / record / transition / get /<br/>forget / list / reopen / requeueClaimed"]:::iface
    GUARD["withLedgerLease(mutate)<br/>NEW — acquire → load → mutate → save → release"]:::new
    LOAD["loadStore<br/>CHANGED — absent vs unparseable<br/>are now distinct outcomes"]:::changed
    SAVE["saveStore<br/>unchanged — tmp write + rename"]:::existing
  end

  subgraph shared["Shared primitive (reused, generalized)"]
    LEASE["conduct-state-lease.ts<br/>mkdir-atomic lease at «path».lease<br/>owner metadata + liveness probe<br/>+ stale-owner recovery"]:::changed
  end

  subgraph disk["Filesystem — resolved engineer dir<br/>($AI_CONDUCTOR_ENGINEER_DIR,<br/>default ~/.ai-conductor/engineer/)"]
    JSON[("ledger.json")]:::store
    LOCKDIR[("ledger.json.lease/<br/>owner.json")]:::store
    QUAR[("ledger.json.corrupt-«timestamp»<br/>NEW — preserved original bytes")]:::new
  end

  subgraph precedent["Precedent — reused shape, not imported"]
    STORE["filesystem-conduct-state-store.ts<br/>whileHoldingLease(read → mutate → write)"]:::existing
    HALT["halt-issues/ledger.ts<br/>quarantine-and-warn on corrupt"]:::existing
  end

  CLI --> API
  LOOP --> API
  API --> GUARD
  GUARD -- "acquire / release" --> LEASE
  LEASE -- "mkdir / rmdir" --> LOCKDIR
  GUARD -- "1. load" --> LOAD
  GUARD -- "3. save (only if load succeeded)" --> SAVE
  LOAD -- "read" --> JSON
  LOAD -- "on parse failure:<br/>copy bytes, then REFUSE" --> QUAR
  SAVE -- "tmp + rename" --> JSON
  STORE -. "shape borrowed by" .-> GUARD
  HALT -. "quarantine step borrowed by;<br/>its return-empty ending REJECTED" .-> LOAD

  classDef new fill:#cce5ff,stroke:#004085,stroke-width:2px;
  classDef changed fill:#ffe0b2,stroke:#8a4b00,stroke-width:2px;
  classDef iface fill:#e2e3ff,stroke:#383d7c,stroke-dasharray:4 2;
  classDef existing fill:#d4edda,stroke:#155724;
  classDef store fill:#eeeeee,stroke:#555;
```

## Legend

- **Blue (new):** the lease wrapper `withLedgerLease`, and the quarantine copy
  `ledger.json.corrupt-«timestamp»` that preserves the original bytes.
- **Orange (changed):** `loadStore`, which today collapses *absent* and *unparseable* into
  one empty-store outcome and after this change must separate them; and
  `conduct-state-lease.ts`, which is generalized from its single conduct-state consumer so
  its diagnostics are not misleading when it guards the intake ledger.
- **Green (existing, unchanged):** the CLI verbs, the intake loop, `saveStore`'s atomic
  tmp+rename, and the two in-repo precedents.
- **Dashed lilac (interface):** the public `Ledger` seam — its method signatures are
  unchanged by this work; only their failure behavior changes.
- **Dotted edges into the precedent box** are *design provenance*, not runtime calls.
  Nothing in `intake/ledger.ts` imports `filesystem-conduct-state-store.ts` or
  `halt-issues/ledger.ts`.

## Key invariants encoded

1. **`saveStore` is unreachable when `loadStore` did not succeed.** The `3. save` edge is
   conditional on step 1. This is the structural expression of "a corrupt ledger is never
   overwritten by the next mutation".
2. **Every mutating path passes through `withLedgerLease`.** There is no edge from `API`
   to `LOAD` or `SAVE` that bypasses `GUARD`, so no caller can perform an unguarded
   read-modify-write — including the read-only `known` / `get` / `list` verbs, which must
   still not observe a torn intermediate state.
3. **The lease lives beside the ledger, not in `.daemon/`.** `ledger.json.lease/` is created in
   whatever directory `resolveEngineerDir` returns — `$AI_CONDUCTOR_ENGINEER_DIR`, defaulting to
   `~/.ai-conductor/engineer/` (`engineer-store.ts:185-193`). Note that this is a **user-global
   path outside every repository**, despite the `.engineer/` shorthand used in ADR-011 and
   `components-engineer-intake.md`: the ledger is one cross-repo singleton shared by every
   project's engineer verbs and loops, which is precisely why invariant 2's no-bypass rule
   matters. The daemon's `.daemon/` state is untouched either way.
4. **The quarantine artifact is a copy, not a rename.** Unlike `halt-issues/ledger.ts`,
   the original `ledger.json` stays in place so that the refusal is repeatable and the
   operator's recovery is not racing a second process that would then see an absent file
   and start empty.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-12 | Initial generation | Intake #1476 — corrupt-read wipe + unguarded concurrent read-modify-write |
