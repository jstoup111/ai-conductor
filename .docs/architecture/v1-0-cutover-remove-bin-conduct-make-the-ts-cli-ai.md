# Containers: v1.0 CLI cutover — entrypoint topology

**Last updated:** 2026-08-29
**Scope:** The operator-facing CLI entrypoints and installer symlink topology, before and after
removing the legacy bash `bin/conduct`.

## Diagram

### Before (two parallel CLIs)

```mermaid
graph LR
    subgraph LOCALBIN["~/.local/bin (installer-managed symlinks)"]
        conduct[conduct]
        conductts[conduct-ts]
        aiconductor[ai-conductor]
    end

    subgraph HARNESS["harness checkout bin/"]
        bashcli["bin/conduct<br/>(legacy bash, 3,237 lines)"]
        launcher["bin/ai-conductor<br/>(canonical TS launcher)"]
        tsalias["bin/conduct-ts<br/>(symlink → ai-conductor)"]
        update["bin/update<br/>(self-update / channel CLI)"]
    end

    dist["src/conductor/dist/index.js<br/>(tsup bundle — the engine)"]

    conduct --> bashcli
    conductts --> tsalias
    aiconductor --> launcher
    tsalias --> launcher
    launcher --> dist
    bashcli -. "duplicated SDLC loop,<br/>own state files" .-> dist
    installer["bin/install"] -- "creates/updates<br/>all three symlinks" --> LOCALBIN
    installer -- "npm ci + build (hard requirement)" --> dist
    update -- "update / --set-channel" --> HARNESS
```

### After (single CLI, alias window)

```mermaid
graph LR
    subgraph LOCALBIN2["~/.local/bin (installer-managed symlinks)"]
        conduct2["conduct (deprecation-window alias)"]
        conductts2["conduct-ts (deprecation-window alias)"]
        aiconductor2[ai-conductor]
    end

    subgraph HARNESS2["harness checkout bin/"]
        launcher2["bin/ai-conductor<br/>(canonical TS launcher)"]
        tsalias2["bin/conduct-ts<br/>(symlink → ai-conductor)"]
        update2["bin/update"]
    end

    dist2["src/conductor/dist/index.js"]

    conduct2 --> launcher2
    conductts2 --> tsalias2
    aiconductor2 --> launcher2
    tsalias2 --> launcher2
    launcher2 --> dist2
    installer2["bin/install"] -- "swaps conduct symlink;<br/>build stays hard requirement" --> LOCALBIN2
    guard["test/test_no_legacy_cli_references.sh<br/>(extended: polices bin/conduct mentions)"] -.-> HARNESS2
    update2 -- "update / --set-channel" --> HARNESS2
```

## Legend

- Solid arrows: symlink resolution or invocation path.
- Dashed arrows: relationships being removed (legacy duplication) or enforcement (guard test).
- `bin/conduct` and `test/test_conduct_worktree.sh` are deleted; `~/.local/bin/conduct` survives
  as an alias into the TS launcher, mirroring the `conduct-ts` deprecation window from PR #2023.
- Deliberately dropped flags (no TS equivalent, operator-approved): `--auto`, `--step`, `--log`,
  `--output`. `--update`/`--set-channel` live on in `bin/update` (#220).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-29 | Initial generation | DECIDE for issue #226 (v1.0 CLI cutover) |
