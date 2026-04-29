# ADR 002: Plugin Manifest Schema and Discovery Paths

**Date:** 2026-04-19
**Status:** APPROVED
**Supersedes:** —

## Context

The TypeScript conductor has interfaces shaped like a plugin system (`LLMProvider`, `UISubscriber`) but no actual mechanism for third-party code to register against them. `src/conductor/src/index.ts:294` hardcodes `new ClaudeProvider()`. To honor the v1.0 "pluggable architecture" claim, we need a real loader.

Three loader designs were considered:

1. **npm-package convention** (auto-discover `node_modules/ai-conductor-plugin-*`). Industry-standard but couples plugin authoring to npm packaging and complicates project-local plugins.
2. **Code-registered plugins** (plugin authors call `conductor.register(...)` from a config file). Requires consumers to write JS — defeats the goal of declarative composition.
3. **Filesystem manifest discovery** (each plugin is a directory with `plugin.yml` + entrypoint). Declarative, supports both global and project-local installs, language-agnostic for the manifest, no npm-publish requirement.

## Decision

Plugins are filesystem directories declaring a `plugin.yml` manifest:

```yaml
kind: llm_provider           # llm_provider | ui_renderer | step | hook | visualizer
name: my-provider            # [a-z0-9-]+
entrypoint: ./dist/index.js  # MUST be a built .js file (see below)
harness_version: ">=0.99.0"  # semver range; checked against current VERSION
capabilities:                # optional; kind-specific
  recording: true
```

### Discovery paths (precedence order)

1. `./.ai-conductor/plugins/*/plugin.yml` (project-local — wins on collision)
2. `~/.ai-conductor/plugins/*/plugin.yml` (global — shadowed by project-local)

A debug log notes overrides. Missing directories are silently skipped (not all users have any plugins).

### Entrypoint format: built `.js` only

Plugins MUST ship a built `.js` entrypoint. The conductor uses dynamic `import(absolutePath)`; Node's ESM loader does not handle `.ts` without a runtime transformer (tsx/ts-node), and bundling such a transformer would balloon dependencies and runtime cost. Reference plugins (e.g., `plugins/recorder-provider/`) ship with a tsup build step.

### Built-ins use the same loader

`ClaudeProvider` and `TerminalRenderer` self-register through `registry.register('llm_provider', 'claude', ...)` and `registry.register('ui_renderer', 'terminal', ...)` during their module init. `src/index.ts` consults the registry — no `new ClaudeProvider()` call remains. Default selection (no config stanza) falls back to `claude` / `terminal`.

### Partial-failure behavior

Discovery is per-directory and best-effort:
- Invalid `plugin.yml` (missing field, bad kind, version mismatch): warning to stderr, plugin skipped, other plugins still load.
- Config explicitly selects an unloadable plugin: `PluginLoadError` thrown at startup (fail-fast).

### Reserved kinds

The kind enum reserves `step | hook | visualizer` for future implementation. Manifest validator accepts them; no loader code exists yet. This avoids a breaking enum change later.

## Consequences

- **Pro:** Plugins are drop-in directories, no npm publish required.
- **Pro:** Project-local plugins enable per-feature experiments without polluting `~`.
- **Pro:** Built-ins and third-party plugins use one mechanism — no special-case wiring drift.
- **Con:** Plugin authors must run a build step (tsup) before their plugin is loadable. Documented in `plugins/README.md`.
- **Con:** A misbehaving global plugin warns on every project's startup. Mitigated by per-plugin error isolation.
- **Future:** npm-package discovery and hot-reload remain out of scope; can be added without changing the manifest schema.

## Evidence

- Node ESM `import()` of `.ts` files: rejected by Node 20+ unless a custom loader hook is installed (see Node ESM docs).
- `js-yaml` already a dependency (`src/conductor/package.json:14`). `semver` is a 6KB pure-JS package; addition is low-cost.
- `~/.ai-conductor/` precedent: existing `~/.ai-conductor/state/` directory used by the conductor for cross-project state.
