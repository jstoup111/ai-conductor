# Complexity: config-validation gaps (#1026)

Tier: M

## Rationale

- Seven independent validator fixes in one engine module (`src/conductor/src/engine/config.ts`)
  plus matching type edits in `src/conductor/src/types/config.ts` and the configuration reference.
- One of them — the `harness_version` gate — changes what config a consumer project may declare
  (an invalid range becomes a `validation_error`), so it is an observable, load-bearing behaviour
  change on the config surface, not a pure refactor.
- Several fixes touch shared shapes (`MarkdownViewerConfig`, `MermaidRendererConfig`, step
  `when`/`parallel`) that other stories could interact with, so conflict-check earns its place.
- No new modules, persistence, external integrations, auth, or state machines; the `semver`
  dependency already exists and is already used by `plugin-manifest.ts`.
- Roughly 7-8 stories — above the Small ceiling, well under Large.

Per tier rules: architecture-diagram, lightweight architecture-review, conflict-check and
coherence-check run; no PRD (technical track).
