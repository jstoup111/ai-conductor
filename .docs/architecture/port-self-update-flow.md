# Architecture: port-self-update-flow

Standalone `bin/update` bash script that owns the consumer self-update / channel
flow, extracted verbatim (behavior-preserving) from `bin/conduct` 327–470. Zero
engine dependency so it runs even when the `conduct-ts` bundle is stale or broken —
the exact situation in which a consumer needs to update.

## Component / flow (C4 component level)

```mermaid
flowchart TD
    subgraph entry[Entry points]
        A1[bin/update --auto]
        A2[bin/update force check]
        A3[bin/update --set-channel c]
    end

    subgraph script[bin/update self-contained bash]
        D[dispatch on args + autoCheck]
        SC[set_update_channel writes updateChannel]
        CH[check_harness_update reads channel]
        T[check tagged latest vX.Y.Z tag]
        M[check main branch ahead of HEAD]
        R[render_changelog_range via markdown viewer]
        AP[apply_harness_update]
        MIG[run bin/migrate]
        RB[rollback git checkout prev ref]
    end

    subgraph state[Durable state]
        CFG[(ai-conductor.config.json)]
        REPO[(HARNESS_DIR git repo)]
    end

    A1 --> D
    A2 --> D
    A3 --> SC
    SC --> CFG
    D --> CH
    CH -->|channel tagged| T
    CH -->|channel main| M
    T --> R
    M --> R
    R -->|user approves| AP
    AP --> MIG
    MIG -->|success| CFG
    MIG -->|failure| RB
    AP --> REPO
    RB --> REPO
    CH -.reads.-> CFG
    T -.reads writes.-> CFG

    subgraph consumers[Callers]
        CT[conduct-ts startup]
        HUM[operator shell]
    end
    CT -->|spawn honoring autoCheck| A1
    HUM --> A2
    HUM --> A3
```

## Notes on the diagram

- **`bin/update --auto`** is the replacement for the current line-2894 auto-check.
  `conduct-ts` (the v1.0 entry point) spawns it at startup; it honors `autoCheck`
  and is a silent no-op when disabled or when no update is available. This keeps
  the git/file plumbing in engine-independent bash while preserving the
  "check on every run" behavior.
- **`bin/update`** (no flag) forces a check now — the replacement for `--update`.
- **`bin/update --set-channel <tagged|main>`** replaces `--set-channel`.
- The internal functions (`check_harness_update`, `check_harness_update_tagged`,
  `check_harness_update_main`, `set_update_channel`, `render_changelog_range`,
  `semver_lt`, `apply_harness_update`) move over **unchanged** except for the
  helper dependencies they share with the rest of `bin/conduct`
  (`conductor_cfg_get/set`, `render_md`, `log/warn/ok/fail`, `HARNESS_DIR`,
  `ORIGINAL_ARGS`), which are copied into or sourced by the new script.
- `apply_harness_update`'s `exec "$0" "${ORIGINAL_ARGS[@]}"` re-launch semantics
  change: `bin/update` is not the pipeline entry, so on success it returns 0 and
  lets the caller (`conduct-ts`) proceed on the freshly-checked-out harness rather
  than re-exec'ing itself. See ADR for the resolution.
