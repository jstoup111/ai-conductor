# Architecture: operator-audited reseal of a protected DECIDE artifact (#1281)

**Stem:** `no-operator-command-to-reseal-a-protected-decide-a`
**Tier:** M
**Track:** technical
**Last updated:** 2026-08-09

## Scope

Only the reseal slice. The seal's verification semantics (`inspectSeal`, base-inheritance
tolerance, self-amendment detection) are untouched, and no diagram of the wider daemon or pipeline
is restated here.

What changes:

1. `rotateProtectedArtifactSeal`'s writer tail is extracted into one shared writer, and the
   *seal-computation head* becomes a parameter. `rotate` keeps supplying the existing
   recompute-everything head, so its behavior is byte-identical.
2. A new **scoped** head re-fingerprints only an enumerated set of paths.
3. A new operator-only `conduct reseal` verb drives the scoped head, following the `decide-grant`
   precedent — dispatched before the pipeline boots, so no daemon step can reach it.
4. `--clear-halt` optionally retires the `.pipeline/HALT` that the seal produced.

## Current state — one head, one tail, fused

`rotateProtectedArtifactSeal` (`protected-artifact-seal.ts:911`) computes the next seal by calling
`createSeal()` (`:486`), which re-fingerprints **every** committed protected artifact at
`toCommit`. Its `paths` argument is recorded in the audit entry and constrains nothing. There is no
CLI surface at all: the only documented recovery is an `npx tsx` heredoc that imports this engine
function directly (`docs/runbooks/stalled-or-stuck-feature.md:694-733`).

```mermaid
flowchart TB
    subgraph today["Today — reachable only from inside the engine process"]
        REB["rebase.ts / conductor.ts<br/>engine-internal rotation call sites"]
        ROT["rotateProtectedArtifactSeal<br/>protected-artifact-seal.ts:911"]
        CS["createSeal :486<br/><b>recomputes ALL paths</b><br/>content read at toCommit"]
        TAIL["fused writer tail<br/>append rebaselines · tmp write<br/>rename · notify · cleanup"]
        SEAL[(".pipeline/protected-artifact-seal.json")]
        REB --> ROT
        ROT --> CS
        CS --> TAIL
        TAIL --> SEAL
    end

    subgraph gap["Gap #1281"]
        OP["operator"]
        HEREDOC["npx tsx heredoc<br/>runbook:694-733<br/><b>blanket reseal, no scoping</b>"]
        HAND["hand-delete HALT + HALT.class"]
        OP --> HEREDOC
        HEREDOC --> SEAL
        OP --> HAND
    end
```

## Target state — shared writer, two heads, one operator verb

```mermaid
flowchart TB
    OP["operator"]

    subgraph cli["CLI — pre-boot dispatch (decide-grant precedent)"]
        DET["detectResealCommand<br/>cli.ts — parse only, no I/O"]
        DISP["dispatchResealCommand<br/>index.ts, before the pipeline boots"]
    end

    subgraph engine["protected-artifact-seal.ts"]
        SCOPED["scoped head<br/><b>NEW</b> — replace fingerprints for<br/>enumerated paths only; all other<br/>entries keep their sealed value"]
        GUARD["unlisted-drift guard<br/><b>NEW</b> — refuse whole reseal and<br/>name the offender"]
        CS["createSeal :486<br/>recompute-all head<br/><i>unchanged</i>"]
        WRITER["shared writer<br/><b>EXTRACTED</b> — append rebaselines ·<br/>tmp write · rename · notify · cleanup"]
        ROT["rotateProtectedArtifactSeal<br/><i>same behavior, now a thin caller</i>"]
        VERIFY["verifyProtectedArtifactSeal :730<br/><i>unchanged — reads the new baseline<br/>on the next BUILD entry</i>"]
    end

    subgraph markers["worktree markers"]
        SEAL[(".pipeline/protected-artifact-seal.json<br/>+ rebaselines[] audit entry")]
        HALT[".pipeline/HALT<br/>.pipeline/HALT.class"]
        CLEARED[".pipeline/HALT.cleared<br/>reason preserved"]
    end

    EV["ConductorEvent variant<br/>protected_artifact_reseal<br/>alongside _rebaseline / _refused"]

    OP --> DET
    DET --> DISP
    DISP --> GUARD
    GUARD -- "drift outside «paths»" --> REFUSE["exit non-zero<br/>nothing written"]
    GUARD -- clean --> SCOPED
    SCOPED --> WRITER
    ROT --> CS
    CS --> WRITER
    WRITER --> SEAL
    WRITER --> EV
    DISP -. "--clear-halt, only when<br/>HALT.class = protected-artifact" .-> HALT
    HALT -. preserve then remove .-> CLEARED
    SEAL --> VERIFY

    DAEMON["any daemon step"]
    DAEMON -. "no reachable path" .-x DET
```

## Reseal sequence

```mermaid
sequenceDiagram
    actor Op as operator
    participant CLI as conduct reseal
    participant Seal as protected-artifact-seal.ts
    participant FS as worktree files
    participant Bus as event spine

    Op->>Op: review + commit the corrected artifact
    Note over Op: heads are read at a commit,<br/>never from the dirty workspace
    Op->>CLI: reseal --slug «slug» --path «p»... --reason «text» [--clear-halt]
    CLI->>CLI: reject when --reason is missing or empty
    CLI->>Seal: scoped reseal request
    Seal->>FS: read current seal + fingerprint «paths» at HEAD

    alt a protected artifact outside «paths» has drifted
        Seal-->>CLI: refuse, naming the offender
        CLI-->>Op: exit non-zero — seal untouched
    else only «paths» differ
        Seal->>FS: tmp write + atomic rename (shared writer)
        Note over FS: rebaselines[] gains who / paths /<br/>old→new fingerprint / rationale
        Seal->>Bus: emit protected_artifact_reseal
        opt --clear-halt and HALT.class = protected-artifact
            CLI->>FS: HALT → HALT.cleared, remove HALT + HALT.class
        end
        CLI-->>Op: exit 0 — feature re-eligible for dispatch
    end
```

## Legend

| Notation | Meaning |
|---|---|
| **NEW** | Code that does not exist today |
| **EXTRACTED** | Existing logic moved, not rewritten — single-sourced between both heads |
| *unchanged* | Touched by no edit in this feature |
| Dotted edge | Conditional / optional path |
| `.-x` | An edge that deliberately does **not** exist |
| `«name»` | Placeholder for a runtime value |

## Open question for `/architecture-review`

The audit ride-along is settled in principle — a new `ConductorEvent` union variant beside
`protected_artifact_rebaseline` / `_refused` (`types/events.ts:250`, `event-sinks.ts:35`,
`daemon-cli.ts:2301`), with the durable baseline continuing to ride the seal's own `rebaselines[]`
(state read by name, event-spine exception C). **No bespoke audit sidecar.**

Unsettled: the **write location**. `conduct reseal` is a standalone CLI process with no live
emitter, and appending to the worktree's `.pipeline/events.jsonl` makes it a second writer to that
ledger. Event-spine exceptions A (no bus access) and B (one writer per ledger) both point at a
single-writer sibling ledger in the **same** schema, merged by `ts` — the
`adr-2026-08-08-pipeline-owned-closeout-timestamps` pattern. An ADR must settle this before
implementation.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-09 | Initial generation | DECIDE for #1281 — scoped operator reseal (approach A′) |
