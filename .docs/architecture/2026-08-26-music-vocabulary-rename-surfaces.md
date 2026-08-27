# Components: Music-Vocabulary Rename Surfaces (daemon→Player, engineer→Composer)

**Last updated:** 2026-08-26
**Scope:** The naming surfaces the 1.0 rename touches, and the alias/deprecation transition
layer that keeps old names working through the major. Decision + scoping feature for #227;
implementation ships with cutover PR #226's major. Verdict vocabulary is out of scope (#1918).

## Diagram

```mermaid
graph TD
  subgraph Operator["Operator surfaces (renamed at 1.0)"]
    CLI["conduct daemon «sub» CLI subtree<br/>→ conduct player «sub»"]
    ENGCLI["conduct-ts engineer «sub»<br/>→ conduct-ts composer «sub»"]
    SKILLS["/engineer skill + agent personas<br/>→ /composer"]
    DOCS["Docs / HARNESS.md / runbooks<br/>daemon+engineer wording"]
  end

  subgraph Machine["Machine-read surfaces (renamed + migrated)"]
    CONFIG["Config keys<br/>e.g. auto_restart_on_stale_engine"]
    STATE[".daemon/ runtime state dir<br/>→ .player/ (pid, logs, grants, parked)"]
    EVENTS["ConductorEvent names / telemetry<br/>daemon-* identifiers"]
  end

  subgraph Alias["Transition layer (new, temporary)"]
    SHIM["Command alias shim<br/>daemon/engineer accepted,<br/>prints deprecation warning"]
    MIG["Migration block (#226 major)<br/>config-key + state-dir migration"]
  end

  OP(["Operator / scripts"]) --> SHIM
  SHIM -->|"forwards old → new"| CLI
  SHIM -->|"forwards old → new"| ENGCLI
  MIG --> CONFIG
  MIG --> STATE
  CLI --> STATE
  ENGCLI --> STATE
  CLI --> EVENTS
  DOCS -.->|"docs sweep in same PR"| CLI
  SKILLS -.-> ENGCLI
```

## Legend

- **Operator surfaces** — human-facing names; renamed with alias/deprecation cover.
- **Machine-read surfaces** — parsed by code; rename requires migration, not just wording.
- **Transition layer** — new machinery this decision scopes: the alias shim (old subcommand
  names forward to the new ones with a deprecation warning) and the `## Migration` block that
  travels with the #226 major. Dashed edges are documentation relationships, not calls.
- `« »` marks variable parts.
- Repo name `ai-conductor`, the `conduct`/`conduct-ts` entrypoints, and event-spine internals
  keep their names; `EVENTS` identifiers do not rename (resolved by
  adr-2026-08-26-music-vocabulary-player-composer-rename — the `ConductorEvent` union carries no
  daemon-named identifiers).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-08-26 | Initial generation | DECIDE for #227 (music-vocabulary rename scoping) |
| 2026-08-26 | EVENTS open question resolved: no rename | ADR approved; plan authored |
