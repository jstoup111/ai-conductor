# Components: Enforce the documented source layer directions (#1017)

**Last updated:** 2026-10-12
**Scope:** Import directions between the five layers of `src/conductor/src/` and the entry-point files,
and the relocations that make the documented one-way chain `types ← execution ← engine ← ui ← entry points`
true. Plan stem: `break-the-engine-ui-import-cycle-and-stop-types-im`.

## Diagram

### Current state — upward edges that violate the chain

```mermaid
graph LR
  entry["Entry points<br/>index.ts, daemon-cli.ts, *-cli.ts"]
  ui["ui/<br/>events.ts holds ConductorEventEmitter,<br/>subscriber, terminal-renderer, prompt-host"]
  engine["engine/<br/>domain logic, plugin-loader"]
  execution["execution/<br/>provider adapters, subprocess, sessions"]
  types["types/<br/>ConductorEvent, HarnessConfig, StepName"]

  entry --> ui
  entry --> engine
  ui --> engine
  ui --> types
  engine --> execution
  engine --> types

  engine -. "VIOLATION: 54 files, 13 value imports<br/>(11 x ConductorEventEmitter,<br/>2 x plugin-loader terminal wiring)" .-> ui
  execution -. "VIOLATION: 10 files, 13 value imports<br/>(isFeatureSlug, git-guard, provider-scratch,<br/>provider-setup-failure, assertRealExecAllowed, ...)" .-> engine
  types -. "VIOLATION: about 25 type-only symbols" .-> engine
  types -. "VIOLATION: type-only symbols" .-> execution
```

### Target state — enforced one-way chain

```mermaid
graph LR
  entry["Entry points<br/>composition root registers built-in<br/>TerminalRenderer and TerminalSubscriber"]
  ui["ui/<br/>subscriber, terminal-renderer, prompt-host,<br/>events.ts re-export of the moved emitter"]
  engine["engine/<br/>domain logic, ConductorEventEmitter,<br/>plugin-loader without ui imports"]
  execution["execution/<br/>provider adapters plus the leaf helpers<br/>they need, or ports the engine fills"]
  types["types/<br/>owns every type symbol it exposes"]
  test(["#1988 import-graph ratchet<br/>upward-edge allowlist emptied,<br/>type-only imports counted"])

  entry --> ui
  entry --> engine
  entry --> execution
  ui --> engine
  ui --> execution
  ui --> types
  engine --> execution
  engine --> types
  execution --> types

  test -. "fails on any import pointing up the chain" .-> engine
```

### Relocation map

```mermaid
graph TD
  emitter["ConductorEventEmitter<br/>ui/events.ts"] -->|moves down| emitterNew["engine/ event emitter module"]
  wiring["registerBuiltins terminal wiring<br/>engine/plugin-loader.ts"] -->|moves up| wiringNew["entry-level composition"]
  helpers["execution's engine helpers<br/>isFeatureSlug, provider-setup-failure,<br/>assertRealExecAllowed, provider-scratch, git-guard"] -->|"move down, or invert as an injected port"| helpersNew["execution/"]
  typeSyms["type symbols types/ borrows<br/>from engine/ and execution/"] -->|move down| typeNew["types/"]
```

## Legend

- Solid arrow: a permitted import, pointing from the importer to the imported layer. Every layer may
  import any layer below it in the chain.
- Dotted arrow labelled VIOLATION: an existing import that points up the chain. Counts were measured by
  import grep on 2026-10-12.
- `ui/events.ts` keeps re-exporting the moved emitter, which is a permitted `ui → engine` edge, so about
  400 test importers stay unchanged.
- An `execution/` helper that pulls in substantial engine code, such as `engine/git-guard.ts` via
  `git-hook-assets.ts`, is inverted instead of moved: `execution/` declares the port and the engine
  supplies the implementation. The ADR records this per-edge rule.
- `tools/` is omitted. It keeps its current permitted edges to `engine/` and `types/`.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-12 | Initial generation | Spec for #1017: break the engine/ui cycle and enforce layer directions |
| 2026-10-12 | Plan update: the plan places terminal composition in entry-level `terminal-builtins.ts`/`cli-builtins.ts`, inverts git-guard as the required `DispatchGitGuard` port, and keeps provider ids opaque (`ProviderId`) in `types/`; diagrams unchanged in structure | /plan step 8b |
| 2026-10-12 | Enforcement node now names the #1988 ratchet | Conflict-check: reuse adr-2026-10-07 D5 instead of a second checker |
