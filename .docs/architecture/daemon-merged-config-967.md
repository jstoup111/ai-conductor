# Sequence: Daemon merged configuration (#967)

**Last updated:** 2026-07-26
**Scope:** Effective user-under-project configuration resolution at daemon runtime startup.

## Diagram

```mermaid
sequenceDiagram
    actor Operator
    participant Entry as conduct-ts entry
    participant Daemon as runDaemonMode
    participant Loader as loadMergedConfig
    participant Project as Project config
    participant User as User config
    participant Runtime as Provider and conductor runtime

    Operator->>Entry: daemon or daemon start
    Entry->>Daemon: launch foreground daemon command
    Daemon->>Loader: resolve effective runtime config
    Loader->>Project: read and validate raw project config
    alt Project config invalid
        Project-->>Loader: source-specific error
        Loader-->>Daemon: failure
        Daemon-->>Operator: actionable startup error
    else Project config valid
        Loader->>User: read user config
        alt User config malformed
            User-->>Loader: user parse error
            Loader-->>Daemon: scope-qualified failure
            Daemon-->>Operator: actionable startup error
        else User config valid or absent
            User-->>Loader: user defaults or empty mapping
            Loader->>Loader: merge project over user and validate
            Loader-->>Daemon: effective HarnessConfig
            Daemon->>Runtime: validate providers and construct execution
            Runtime-->>Operator: daemon runs with effective policy
        end
    end
```

## Legend

- Both supervised and bare launches converge on the foreground daemon command and `runDaemonMode`.
- Project configuration is validated before merging, then overrides matching user values.
- The effective config is resolved once and threaded through existing runtime consumers.
- Machine identity and project-owned full-suite evidence retain their dedicated source boundaries and are outside this sequence.

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-07-26 | Added daemon effective-config startup sequence. | Document issue #967's bounded composition-root correction. |
