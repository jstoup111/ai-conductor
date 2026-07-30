# Sequence: User-level configuration precedence

**Last updated:** 2026-07-30
**Scope:** Pure project validation followed by user-under-project merge and one effective-config normalization pass.

## Diagram

```mermaid
sequenceDiagram
    participant Project as Project config
    participant ProjectValidation as Project-source validation
    participant User as User config
    participant Merge as Project-over-user merge
    participant EffectiveValidation as Merged-source validation
    participant Runtime as Runtime consumers

    alt loadMergedConfig
        Project->>ProjectValidation: validate explicit project values on a clone
        ProjectValidation-->>Merge: valid project config without absent defaults
        User->>Merge: user-scoped values
        Merge->>Merge: deep merge with explicit project values winning
        Merge->>EffectiveValidation: validate effective config on a clone
        EffectiveValidation->>EffectiveValidation: normalize values and materialize defaults once
        EffectiveValidation-->>Runtime: effective HarnessConfig
    else ordinary loadConfig
        Project->>ProjectValidation: validate project config on a clone
        ProjectValidation->>ProjectValidation: normalize values and materialize defaults
        ProjectValidation-->>Runtime: runtime-ready project HarnessConfig
    end
    Note over Project,EffectiveValidation: Original input objects remain unchanged
```

## Legend

- Project-source validation retains source-specific guards while omitting defaults for absent keys.
- Explicit project values continue to override matching user values under the established deep-merge contract.
- Merged-source validation is the single point that normalizes values and materializes runtime defaults.
- Ordinary project-only loading retains its existing runtime-ready defaults; deferred defaults are exclusive to the merged-loading pre-pass.
- Validation operates on clones, so caller-owned project, user, and merged inputs are not mutated.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-30 | Added the plan's ordinary `loadConfig` compatibility branch. | Make the source-aware validation wiring and project-only safeguard explicit before implementation. |
| 2026-07-30 | Added effective-config normalization sequence. | Restore user-level precedence for issue #1000 without weakening project policy. |
