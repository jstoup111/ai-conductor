# Components: Shared credential-reference resolver, first consumer `otel.headers`

**Last updated:** 2026-10-28
**Scope:** A new engine module that turns a credential *reference* in configuration into a credential
*value* on demand, from a pluggable source (`env` or `command` in this slice), behind a TTL cache with
single-flight refresh. `otel.headers` is its only consumer in this change: the config resolver parses
references through it, and both OTLP/HTTP delivery paths (the spool drainer's per-POST headers and the
direct exporters' async headers factory) ask it for values at send time. Other credential consumers
(`github_bot.token_file`, the daemon build OAuth token, `tracker.credentials`) are shown as future
adopters only and are not changed.

## Diagram

```mermaid
graph TD
    subgraph cfgfile["Configuration (reference only, never a value)"]
        yaml["otel.headers.«name»<br/>{ env: «VAR» } (existing)<br/>NEW: { command: [argv…], prefix?: «text» }"]
    end

    subgraph cred["NEW: engine/credentials/ (shared resolver)"]
        parse["parseCredentialReference()<br/>shape validation only, never throws,<br/>no execution, no value read"]
        resolver["CredentialResolver<br/>resolve(): value or named, value-free failure<br/>TTL cache + single-flight refresh"]
        envsrc["env source<br/>reads process.env at resolve time"]
        cmdsrc["command source<br/>execFile argv (no shell), timeout,<br/>leading ~/ → $HOME, trimmed stdout + prefix"]
        resolver --> envsrc
        resolver --> cmdsrc
    end

    subgraph otel["engine/otel/ (CHANGED)"]
        ocfg["resolveOtelConfig() (CHANGED)<br/>parses each header via parseCredentialReference;<br/>env refs keep load-time unset/empty refusal"]
        hdrs["otel header provider (NEW)<br/>async headers(): one resolver per header"]
        drainer["SpoolDrainer.deliver() (CHANGED)<br/>awaits headers() per POST"]
        direct["OTLP HTTP exporters (CHANGED)<br/>headers: async HeadersFactory"]
    end

    collector["OTLP/HTTP endpoint<br/>(external)"]

    future["Future adopters (UNCHANGED here):<br/>github_bot.token_file, build OAuth token,<br/>tracker.credentials"]

    yaml --> ocfg
    ocfg --> parse
    ocfg --> hdrs
    hdrs --> resolver
    drainer --> hdrs
    direct --> hdrs
    drainer --> collector
    direct --> collector
    future -. may adopt later .-> resolver
```

```mermaid
sequenceDiagram
    participant D as Spool drainer / direct exporter
    participant H as otel header provider
    participant R as CredentialResolver («header»)
    participant S as command source
    participant C as OTLP endpoint

    D->>H: headers() before a send
    H->>R: resolve()
    alt cached value younger than TTL
        R-->>H: cached value
    else expired or never resolved
        R->>S: run argv once (concurrent callers share this run)
        alt exit 0 with non-empty stdout
            S-->>R: trimmed stdout
            R-->>H: prefix + value, cached
        else timeout, non-zero exit, or empty stdout
            S-->>R: failure
            R-->>H: named failure (header + command, never a value)
        end
    end
    alt every header resolved
        H-->>D: header map
        D->>C: POST with headers
    else a header failed
        H-->>D: failure
        Note over D: no POST — spool keeps the batch for its existing retry,<br/>direct path reports its existing bounded export warning
    end
```

## Legend

- **NEW** — added by this change. **CHANGED** — an existing component whose behavior changes.
- **UNCHANGED here** — named only to bound the resolver's interface; not edited in this change.
- Dashed arrow — possible future dependency, not built in this change.
- «name» — a variable part of a label.
- Credential values exist only inside the resolver cache and the outgoing request headers; they are
  never written to configuration, errors, events, or the spool.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-28 | Initial generation | Command-sourced OTLP header credentials via a shared resolver (approach B) |
