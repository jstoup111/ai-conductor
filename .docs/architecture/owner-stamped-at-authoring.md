# Architecture: Owner stamped at authoring; no silent dead spec

**Stem:** `owner-stamped-at-authoring` · **Issue:** #721 · **Tier:** M (lightweight)

## The two chokepoints

The `Owner:` marker has exactly one write path and one read path in the deployed
`conduct-ts` runtime. Both ship to every consumer, so hardening them — not the
repo-local integrity test — is the harness-native guarantee.

```
                     WRITE boundary (born owned)                     READ boundary (no dead spec)
                     ───────────────────────────                     ───────────────────────────

 land-spec.ts ───┐                                    daemon-cli.ts (localWorkSource)
 (fail-closed)   │                                             │ resolveDaemonOwner (fresh/pass)
                 │                                             ▼
 conductor.ts ───┼──▶ writeIntakeMarker() ──▶ .docs/    daemon-backlog.ts discoverBacklog
 (fail-closed)   │    (intake-marker.ts)      intake/          │ readSpecOwnerStamp (provenance.ts)
                 │      stamps `Owner: <id>`   <slug>.md ──────▶│ decideSpecGate (gate.ts)
 authoring.ts ───┘      from machine identity                  ▼
 (GAP: silently                                         build │ skip
  omits when                                            ──────┼──────
  unresolved)                                    stamped+match│ → build
                                                  other-owner │ → SKIP (isolation kept)
                                                  un-owned ····│ → CHANGED: default-build
                                                               │   under daemon owner + LOUD log
                                                               │   (was: silent-forever-skip)
```

## Layer A — born owned (write boundary)

- **Chokepoint:** `writeIntakeMarker(repoPath, slug, sourceRef, ownerIdentity, guard)`
  (`engineer/intake-marker.ts`) is the ONLY writer of `.docs/intake/<slug>.md`; it
  already stamps `Owner: <id>` when handed an identity and omits it (the un-owned case)
  when not.
- **Callers today:** `land-spec.ts` and `conductor.ts` resolve identity **fail-closed**
  (throw if unresolved) → always born owned. `authoring.ts` (autonomous `runAuthoring`)
  resolves from `deps.ownerConfig ?? {}` + `deps.gh` only and **degrades to a null,
  omitted owner** — the single conduct-ts path that can emit an un-owned marker.
- **Change:** `authoring.ts` falls back to machine identity (`readMachineOwnerConfig`,
  as `conductor.ts` already does) before writing, so autonomous authoring is born owned
  from the operator's machine config even when no `ownerConfig` is injected. No
  conduct-ts write path emits an un-owned marker when machine identity is resolvable.

## Layer B — no silent dead spec (read boundary, the DECIDE)

- **Chokepoint:** `decideSpecGate` (`owner-gate/gate.ts`), a pure function, consumed by
  `daemon-backlog.ts discoverBacklog` (via `daemon-work-source.ts` wiring). Only reached
  when the daemon owner is **resolved**.
- **Change:** the two un-owned branches (`unowned-post-cutover`, `unowned-indeterminate`)
  no longer return `{ build: false }`. They return a **default-build** attributed to the
  daemon's own resolved owner, with a new reason `unowned-defaulted`. `daemon-backlog.ts`
  emits a LOUD, actionable escalation for the defaulted build (naming slug, defaulted
  owner, and how to make ownership explicit) — visible, not the deduped-forever silent
  skip.
- **Invariant preserved:** `stamp.present && stamp.id !== daemonOwner.id` → still
  `other-owner` **SKIP**. Explicit cross-operator ownership is untouched; only the
  ambiguous *un-owned* case changes. `grandfathered` (un-owned pre-cutover) is unchanged.

## Seam integrity

- The gate stays a **pure function** — no I/O, no base-branch write, no clock. The default
  is a build *decision*, never a self-heal write to the repo (which would race and mutate
  base-branch state from a read path).
- Forward-compat seams (`resolveDaemonOwner` platform-identity swap, `SignedProvenance`
  reader) are untouched — the change is confined to the decision, not the resolution or
  read seams.
