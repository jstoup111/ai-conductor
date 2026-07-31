# Components: Browsable documentation site

**Last updated:** 2026-07-30
**Scope:** Repository-owned documentation, pull-request validation, default-branch publication, and the public reader experience.

## Diagram

```mermaid
graph LR
  reader["Documentation reader"]
  contributor["Documentation contributor"]

  subgraph repository["AI Conductor repository"]
    pr["Feature pull request"]
    main["Default branch"]
    markdown["Documentation Markdown<br/>docs/index.md · section indexes · 29 topics"]
    siteconfig["docs/_config.yml<br/>pinned theme · URL · navigation settings"]
    linkcheck["Internal-link check"]
    navcheck["Offline navigation contract<br/>test/check_docs_navigation.sh<br/>fixtures + real tree"]
    smoketest["Opt-in publication smoke<br/>fake adapters in default tests"]
    integrity["Harness integrity suite<br/>navigation/site-contract gate"]
    readme["Root project overview<br/>hosted-docs entry point"]
  end

  subgraph github["GitHub-hosted services"]
    pages["Branch-based Pages publisher<br/>default branch documentation source"]
    jekyll["Jekyll build<br/>remote-theme support"]
    theme["Just the Docs v0.12.0<br/>responsive sidebar navigation"]
    site["Public documentation site<br/>stable HTTPS URL"]
  end

  contributor -->|"edits source"| pr
  pr --> linkcheck
  pr --> navcheck
  navcheck --> integrity
  smoketest --> integrity
  linkcheck -->|"required repository check"| main
  integrity -->|"required repository check"| main
  main --> markdown
  main --> siteconfig
  main --> readme
  markdown --> pages
  siteconfig --> pages
  pages --> jekyll
  theme --> jekyll
  jekyll -->|"successful build"| site
  site -->|"opt-in HTTP evidence"| smoketest
  pages -->|"opt-in API evidence"| smoketest
  readme -->|"hosted docs link"| site
  reader --> site

  classDef source fill:#d5f5e3,stroke:#1e8449,stroke-width:2px;
  classDef check fill:#fdebd0,stroke:#b9770e;
  classDef external fill:#d6eaf8,stroke:#2874a6;
  class markdown,siteconfig,readme source;
  class linkcheck,navcheck,smoketest,integrity check;
  class pages,jekyll,theme,site external;
```

## Legend

- Green nodes are repository-owned sources; the Markdown remains the only documentation content authority.
- Orange nodes are deterministic pull-request checks. Internal links remain covered by the existing checker; the navigation contract additionally rejects missing site metadata and orphaned topics.
- Blue nodes are GitHub-hosted publication and presentation components. The existing branch publisher remains authoritative and publishes only default-branch content.
- A failed build does not replace the last successfully published site and remains visible in the repository's Pages deployment status.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-30 | Initial design | Complete the existing Pages publication path with a landing page, durable navigation, and deterministic coverage checks |
| 2026-07-30 | Plan update | Name the concrete source, validation, integrity, and opt-in smoke boundaries selected by the implementation plan |
