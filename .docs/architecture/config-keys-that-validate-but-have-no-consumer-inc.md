# Components: Config keys that validate but have no consumer (#1025)

**Last updated:** 2026-08-26
**Scope:** The config load→validate→resolve→consume pipeline touched by this feature — which keys
are removed, which validator sets change, and where the new coverage test sits.

## Diagram

```mermaid
graph TD
    subgraph Sources
        UserCfg["~/.ai-conductor/config.yml (user)"]
        ProjCfg[".ai-conductor/config.yml (project)"]
        Templates["templates/*.yml.template"]
    end

    subgraph Load["engine/config.ts"]
        Merge["mergeConfigs (project wins)"]
        Validate["validateConfig<br/>knownTopLevelKeys / knownStepKeys<br/>per-block allowed sets"]
        Guard["source guard (spec_owner today,<br/>+ conductor block after this change)"]
    end

    subgraph Resolve["engine/resolved-config.ts"]
        Resolvers["resolvers (self-host, steps, defaults)"]
        DeadResolvers["REMOVED: resolveMergeableAutoresolve,<br/>resolveAuthParkTimeoutMinutes (top-level)"]
    end

    subgraph Consumers
        StepRegistry["engine/steps.ts buildStepRegistry<br/>(reads steps.«custom».gate / kickback_target)"]
        Conductor["engine/conductor.ts<br/>(nested auth_park_timeout_minutes)"]
        Autoresolve["engine/autoresolve.ts + daemon-cli.ts<br/>(read mergeable_autoresolve raw)"]
    end

    CoverageTest["NEW test: every accepted key carries<br/>a declaration; non-none paths resolve"]

    UserCfg --> Merge
    ProjCfg --> Merge
    Merge --> Validate --> Guard --> Resolvers
    Resolvers --> StepRegistry
    Resolvers --> Conductor
    Resolvers --> Autoresolve
    CoverageTest -.asserts.-> Validate
    CoverageTest -.asserts.-> Consumers
    Templates -.seed.-> UserCfg
    Templates -.seed.-> ProjCfg
```

## Legend

- **REMOVED** — dead surface deleted by this change: `defaults.by_tier` validator acceptance,
  `complexity.default_tier` (type + validator + template comments), `harness_self_host.skill_relink_preflight`
  (type + validator + resolver field), `resolveMergeableAutoresolve`, top-level
  `auth_park_timeout_minutes` (type + resolver; nested variant survives).
- **NEW** — `gate`/`kickback_target` added to `knownStepKeys`; `conductor` project-path guard;
  a registry coverage test proving every accepted key carries a declaration and every non-`none`
  declaration names a production module path that resolves on disk. It does not prove runtime reachability.
- «custom» — any operator-defined step name.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #1025 |
