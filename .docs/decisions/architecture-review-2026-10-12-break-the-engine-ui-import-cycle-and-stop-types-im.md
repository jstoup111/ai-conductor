# Architecture Review: Enforce the documented source layer directions (#1017)
**Date:** 2026-10-12
**Stories reviewed:** none yet. This is a pre-stories review whose input is the explore track
(`.docs/track/break-the-engine-ui-import-cycle-and-stop-types-im.md`) and the diagram
(`.docs/architecture/2026-10-12-break-the-engine-ui-import-cycle-and-stop-types-im.md`).
**Mode:** Lightweight (Tier M). Sections 2 and 4 only.
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

- **Stack compatibility.** No new dependency is needed. Enforcement extends the TypeScript-AST
  import-graph ratchet that #1988 builds, under `adr-2026-10-07-conductor-decomposition-target-architecture`
  D5. `typescript` 6.0.3 is already in `src/conductor/package.json`. Confidence 95%, verified.
- **Prerequisite.** #1988 (roadmap slice 2) must merge first. On 2026-10-12 it is open and has no
  spec. Its allowlist file layout is not yet known, so the plan cites it by behaviour: one file per
  allowed edge, shrink-only.
- **Emitter move.**
  - `ui/events.ts` imports only `types/`, so moving it into `engine/` creates no new edge.
    Verified, 98%.
  - All 54 `engine/` → `ui/` files import `events.js`, apart from `plugin-loader.ts` and
    `cli-builtins.ts` (`terminal-renderer.js`, `subscriber.js`, `types.js`). Verified.
- **UI wiring move.**
  - `registerBuiltins` is called from `daemon-cli.ts:1352` and from `engine/cli-builtins.ts`.
    `index.ts` reaches the latter through `registerCliBuiltins`.
  - Moving terminal construction to entry-level composition touches only those callers.
    Verified, 90%.
- **`execution/` → `engine/` edges.** There are 7 distinct engine modules:
  - **Move-down candidates:**
    - `provider-setup-failure.ts` has no internal imports.
    - `provider-model-policy-defaults.ts` imports only `types/`.
    - `isFeatureSlug` is in `worktree.ts`. That module imports `tracker-client.js`, so the
      function itself moves, not the module.
    - `assertRealExecAllowed` is an 8-line env guard inside the 1,234-line `tracker-client.ts`;
      only the function moves.
  - **Inversion candidates:**
    - `git-guard.ts` pulls `git-hook-assets.ts`, and through it `protected-artifact-seal.js` and
      `canonical-launcher.js`.
    - `self-host/provider-scratch.ts` is typed against `ConductorEventEmitter`.
    - `build-review-read-only-capability.ts` itself imports three `execution/` modules, so
      moving it down is also viable. The ADR's decision 4 rule settles it.
  - Overall feasibility confidence for this group: 85%, inferred from the import graph. The plan
    must confirm each classification.
- **`types/` symbols.**
  - Interface and alias symbols move directly (`TokenUsage`, `ProviderExitFacts`,
    `ObservedInterval`, the restack aliases, `ChildId`, the refusal-reason unions).
  - Three are derived from registries (`BuiltInProviderId`, `GithubOperationName`,
    `BUILD_REVIEW_RUBRIC_IDS`). `GITHUB_OPERATION_REGISTRY` already uses
    `as const satisfies Readonly<Record<string, GithubOperationDefinition>>`. Narrowing it to a
    record keyed by a `types/` union is a type-level change. Verified, 85%.
- **Data, performance, worktree isolation:** not applicable. There is no schema, no runtime path
  change, and no shared resource.
- **Integration surface:** all five layers plus the entry files. The changes are mechanical and
  behaviour-neutral, and the existing suite is the oracle.

## Alignment

- **Domain boundaries.** The change restores the documented boundary rather than introducing
  coupling. Moving the emitter to `engine/` matches `code-organization.md`, whose `ui/` row lists
  "event emitter" as owned by `ui/`. That row is the inaccuracy, and decision 7 corrects it.
- **Event spine.** The spine (`ConductorEventEmitter` → `ConductorEvent` → `EventPersister`) is
  unchanged in behaviour and only relocated. No parallel channel is added, which complies with
  `.agents/skills/event-spine/SKILL.md`.
- **Governing ADRs.**
  - `003-ui-renderer-plugin-point` (APPROVED) is cited and its contracts are preserved;
    registration moves, the interfaces do not.
  - `002-plugin-manifest-and-discovery` is unaffected.
  - `adr-2026-10-07-conductor-decomposition-target-architecture` (APPROVED) governs import direction
    (D5) and roadmap order (D7). This feature is its slice 3, #3042 together with #1017, and is
    sequenced after slice 2 (#1988).
  - The first pass of this review missed that ADR and drafted a competing checker. Conflict-check
    caught it, and the operator chose to reuse the ADR. The new ADR now carries only slice 3's
    design, plus the type-only extension to D5's upward-edge rule.
- **Pattern consistency.** Enforcement reuses the D5 ratchet instead of adding a test. Pure values
  in `types/` follow the precedent of `types/plugin.ts` (`VALID_PLUGIN_KINDS`, plugin error
  classes).
- **Diagram accuracy.** The new diagram matches the measured edges. No existing C4 diagram claims
  a layering that contradicts the target.
- **Production DI defaults.** The ports injected under decision 4 are wired by the engine to the
  existing real implementations; no in-memory default is introduced.
- **Focused local pattern basis.** The precedent is the #1988 import-graph ratchet, once merged.
  - **Role:** the single layering checker.
  - **Traits to preserve:** one allowlist file per edge, and shrink-only failure on an allowlisted
    edge that no longer exists.
  - **Variation allowed:** this feature adds type-only, re-export and dynamic-import edges to the
    upward rule.
  - **Rediscovery hint:** the ratchet's allowlist directory and its test under
    `src/conductor/test/`.

## Wiring Surface

- **Relocated emitter module in `engine/`.** Consumed by the existing 54 `engine/` importers,
  rewritten to the new path, and by `ui/events.ts` through its re-export. It is constructed in
  `index.ts` and `daemon-cli.ts` as today.
- **Entry-level terminal composition.** Called from the two existing registration sites,
  `daemon-cli.ts`'s daemon start-up and `index.ts` through the CLI built-ins path, in place of
  `engine/plugin-loader.ts` constructing `TerminalRenderer` and `TerminalSubscriber`.
- **`execution/` ports, decision 4.** Supplied by the engine where providers are constructed today
  (the `engine/provider-execution.ts` and `plugin-loader.ts` built-in provider registration).
  They are invoked inside the existing `invoke` paths of `claude-provider.ts`, `codex-provider.ts`
  and `pi-provider.ts`.
- **Moved `types/` declarations.** Imported by `types/events.ts` and `types/config.ts`, and back by
  their former modules.
- **Extended import-graph ratchet (#1988).** Run wherever #1988 wires it (the default test tier).
  It is not a production surface.
- **Overlap scan.** Run before `/plan`. Advisory only.

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| A relocation creates a module-initialization cycle that the type checker misses | Technical | Low | High | The structural test forbids upward edges, so a value cycle across layers cannot exist once it passes. The existing suite must stay green after each move. |
| Inverting `git-guard` or `provider-scratch` changes when the guard or scratch work runs | Technical | Medium | Medium | Engine-side injection reuses the exact existing call. Existing provider tests assert dispatch behaviour. |
| Registry-derived unions drift from their registries | Technical | Low | Medium | The paired `satisfies` constraint makes drift a compile error in both directions (decision 5). |
| High churn on parallel lanes (54 engine files plus the providers) causes rebase conflicts | Integration | Medium | Low | Changes are import-path rewrites. The task order should land the emitter move first and as one task. |
| The type-only extension mis-classifies edges or passes vacuously | Technical | Low | High | Story 1 requires fixture proof that type-only, re-export and dynamic-import upward edges are each rejected. |
| #1988's ratchet shape differs from what the plan assumes, or #1988 stalls | Integration | Medium | Medium | The plan cites the ratchet by behaviour, not by file layout. Land records `--depends-on jstoup111/ai-conductor#1988`, so the daemon builds it first. |

## ADRs Created

- `adr-2026-10-12-enforced-source-layer-directions`. It records slice 3's design under
  `adr-2026-10-07-conductor-decomposition-target-architecture`:
  - the type-only extension to the upward rule;
  - the emitter's location;
  - UI composition at the entry level;
  - the move-down-or-invert rule;
  - `types/` ownership;
  - emptying the ratchet's upward-edge allowlist;
  - the documentation rewrite.

## Conditions

1. The plan classifies each of the 7 `execution/` → `engine/` dependencies as moved or inverted
   under ADR decision 4, citing the transitive-import evidence for each.
2. The emitter relocation lands as one task, before the tasks that depend on the new path.
3. The #1988 ratchet passes against the final tree with no upward-edge allowlist entries. Its
   type-only extension carries fixture proof for each edge kind. The spec lands with
   `--depends-on jstoup111/ai-conductor#1988`.
4. No behaviour change: the existing Vitest suite and `test/test_harness_integrity.sh` pass
   unchanged, apart from import-path updates.
