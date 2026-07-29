# Code organization

The module map of the engine — the TypeScript conductor under `src/conductor/` — plus what each layer
owns, where execution enters, and which direction imports flow. For contributors changing engine code.
For the operator-facing role model, see [architecture](../explanation/architecture.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `src/conductor/src/` | Engine source. Five directories plus seven entry-point files. |
| `src/conductor/test/` | Vitest suite. See [testing](testing.md). |
| `src/conductor/scripts/` | `publish-engine.mjs` (the build), `publish-guard.mjs`, `intake-label-sync-apply.mts`. |
| `src/conductor/bin/` | `intake-file` — a `tsx` shebang wrapper over `src/intake-file-cli.ts`. |
| `bin/` | Repo-root bash wrappers: `conduct-ts`, `install`, `setup`, `update`, `migrate`, `generate-model-table`, `generate-docs-guard-hook`, `intake-file`, `intake-backfill`, `quarantine-engineer-signals`. |
| `skills/` | Skill catalog. See [skills reference](../reference/skills.md). |
| `agents/`, `templates/`, `tech-context/` | Prompt templates, scaffolding, stack knowledge. |
| `hooks/claude/` | Hook scripts. See [settings and hooks](../reference/settings-and-hooks.md). |
| `test/` | Repo-level bash scripts, including the integrity suite and `lint_shell.sh`. See [validation](validation.md). |

Static-analysis configuration sits at two levels. Anything needing the TypeScript project lives inside
`src/conductor/`; anything spanning the whole repository lives at the root.

| Path | Configures |
| --- | --- |
| `src/conductor/eslint.config.mjs` | Type-aware ESLint over `src/**/*.ts`. Needs `tsconfig.json` and `node_modules`, so it lives with the package. |
| `src/conductor/tsconfig.json` | `npm run typecheck` — `src/` only; `test/` is excluded. |
| `src/conductor/tsconfig.test.json` | `npm run typecheck:test` — extends the above and adds `test/`. |
| `test/lint_shell.sh` | The ShellCheck file set and severity. Single source of truth for both CI's `shellcheck` job and integrity check 1b. |
| `lychee.toml` | Documentation link checking. At the root because its inputs span `docs/`, the root READMEs, and `src/conductor/README.md`. |

## Layers

`src/conductor/src/` has five directories. Counts are `.ts` files, including subdirectories.

| Layer | Files | Owns |
| --- | --- | --- |
| `engine/` | 238 | The state machine, step catalogue, gate loop, daemon, engineer loop, config resolution, self-host guardrails — essentially all domain logic. |
| `execution/` | 6 | The third-party process boundary: LLM provider adapters and subprocess/session management. |
| `types/` | 6 | The shared type surface: `StepName`, `ConductState`, `ConductorEvent`, `HarnessConfig`, plugin kinds. |
| `ui/` | 11 | Event emitter, subscribers, terminal renderers, dashboard snapshot/text, notifications, prompt host. |
| `tools/` | 3 | Build-time code generators invoked by `bin/` wrappers. Nothing in the runtime imports them. |

### engine/

164 files sit flat in `engine/`; the remaining 74 are grouped into six subpackages.

| Subpackage | Files | Owns |
| --- | --- | --- |
| `engine/engineer/` | 25 | The engineer loop: authoring, routing, handoff, land-time spec and coherence gates, lesson store. |
| `engine/engineer/intake/` | 16 | Intake queue, ledger, GitHub issue read/write-back, label sync, closed-issue reconciliation. |
| `engine/self-host/` | 16 | Guardrails for the harness building itself: detector, write fence, sandbox build env, build auth, version gate, release gate. |
| `engine/halt-issues/` | 6 | Halt-monitor issue reconciliation and its CLI. |
| `engine/otel/` | 6 | OpenTelemetry config, metrics, and the visualizer. |
| `engine/owner-gate/` | 5 | Multi-operator identity partitioning. |

Flat `engine/` files cluster by filename prefix. Use the prefix to find the subsystem:

| Prefix | Representative files |
| --- | --- |
| `daemon-*`, `daemon.ts` | `daemon.ts`, `daemon-runner.ts`, `daemon-backlog.ts`, `daemon-lock.ts`, `daemon-log.ts`, `daemon-tmux.ts`, `daemon-command.ts`, `daemon-fleet.ts`, `daemon-auto-park.ts` |
| step/pipeline core | `steps.ts`, `step-runners.ts`, `conductor.ts`, `selector.ts`, `state.ts`, `artifacts.ts`, `skill-invocation.ts`, `skill-resolver.ts`, `complete-verifier.ts` |
| `gate*` | `gates.ts`, `gate-verdicts.ts`, `gate-code-validity.ts`, `gate-invalidation.ts`, `gate-writeback.ts`, `gated-snapshot.ts` |
| `build-review-*` | `build-review-prompt.ts`, `build-review-inputs.ts`, `build-review-disposition.ts` |
| `shipment-*`, `shipped-*` | `shipment-evidence.ts`, `shipment-reconciliation.ts`, `shipped-record.ts`, `shipped-record-cli.ts` |
| `attribution-*` | `attribution-audit.ts`, `attribution-telemetry.ts`, `attribution-verdict.ts`, `task-attribution.ts` |
| `provider-*`, model policy | `provider-runtime.ts`, `provider-execution.ts`, `provider-selection.ts`, `provider-session.ts`, `provider-model-policy.ts`, `model-availability.ts`, `model-table-metadata.ts` |
| config | `config.ts`, `resolved-config.ts`, `user-config.ts` |
| `full-suite-*` | `full-suite-executor.ts`, `full-suite-verifier.ts`, `full-suite-evidence.ts`, `full-suite-fingerprint.ts` |
| markers | `halt-marker.ts`, `park-marker.ts`, `pause-marker.ts`, `phase-marker.ts`, `restart-marker.ts`, `restart-intent.ts` |
| plugins | `plugin-loader.ts`, `plugin-registry.ts`, `plugin-manifest.ts` |
| memory | `memory-store.ts`, `memory-cli.ts`, `memory-migrate.ts`, `local-memory-provider.ts` |
| worktree / git | `worktree.ts`, `worktree-prepare.ts`, `worktree-shared.ts`, `git-hook-assets.ts` |

Two lookups that are easy to get wrong:

- The `build_review` grader has no `build-review.ts`. The prompt and verdict shape live in
  `engine/build-review-prompt.ts`, the inputs in `engine/build-review-inputs.ts`, the routing decision in
  `engine/build-review-disposition.ts`, and verdict parsing plus the `completeness` rubric in
  `engine/artifacts.ts:1080-1177`.
- The daemon's ship-eligibility guard has no module of its own. It is inline in
  `engine/daemon-runner.ts` — `isVerifiedShip` at `:219` and `failureReasonForFalseShip` at `:228`.
- Backlog priority resolution is `createPriorityResolver` in `engine/backlog-priority.ts:123`.
- The daemon pidfile lock is `engine/daemon-lock.ts`, not under `engine/engineer/`.

### execution/

The only layer permitted to reach a third party in ordinary code paths.

| File | Owns |
| --- | --- |
| `llm-provider.ts` | The port. `LLMProvider` `:141`, `InvokeOptions` `:109`, `InvokeResult` `:56`. |
| `claude-provider.ts` | The `claude` host adapter plus its failure detectors. |
| `codex-provider.ts` | The `codex` host adapter and JSONL parsing. |
| `codex-self-host-auth.ts` | Codex credential handling for self-host builds. |
| `session.ts` | `SessionManager`. |
| `subprocess.ts` | `runCommand`. |

Tests must fake this seam rather than cross it. See [testing](testing.md).

### types/

`types/index.ts` is a barrel over five modules: `steps.ts` (the `StepName` union at `:1`, `Phase` at
`:37`, `EnforcementLevel` at `:44`, `StepDefinition` at `:50`), `state.ts`, `events.ts`, `config.ts`
(`HarnessConfig`, the config schema of record), and `plugin.ts` (`PluginKind` at `:8`).

### ui/

`events.ts` (`ConductorEventEmitter`), `types.ts` (`UIRenderer`, `UISubscriber`, `StepSnapshot`,
`DashboardSnapshot`, `ViewMode`, `UIPromptHost`), `create-renderer.ts`, `terminal-renderer.ts`,
`subscriber.ts`, `dispatch.ts`, `dashboard-snapshot.ts`, `dashboard-text.ts`, `live-region.ts`,
`notifications.ts`, and `terminal/prompt-host.ts` — the only file under `ui/terminal/`.

### tools/

Each generator splits into pure logic plus a CLI shell, so importing the logic from a test never
triggers `process.exit` or stdio side effects.

| File | Generates |
| --- | --- |
| `generate-model-table.ts` | The HARNESS.md model-selection table, from `engine/provider-model-policy.ts` and `engine/model-table-metadata.ts`. |
| `generate-docs-guard-hook.ts` | `hooks/claude/docs-guard.sh`, from `engine/session-hook-assets.ts`. |
| `generate-docs-guard-hook-main.ts` | The direct-execution shell for the above. |

Both are driven by `bin/generate-model-table` and `bin/generate-docs-guard-hook`, which run the source
through `src/conductor/node_modules/.bin/tsx` and never touch `dist/`. Both use the same exit-code
contract: `0` clean, `1` drift, `2` environment error.

## Entry points

Seven files sit at the top level of `src/conductor/src/`.

| File | Role |
| --- | --- |
| `index.ts` | The composition root and argv dispatcher. `bin/conduct-ts` execs `dist/index.js`, built from this file. |
| `cli.ts` | The commander declaration surface. Builds the help text; most subcommands declared here are help-only. |
| `daemon-cli.ts` | The daemon runtime. Registers zero commander commands; entered through `runDaemonMode` at `:491`, lazily imported from `index.ts` so non-daemon paths never load it. |
| `intake-loop-cli.ts` | `detectIntakeLoopCommand` `:49` / `dispatchIntakeLoop` `:106`, wired into `index.ts`. |
| `intake-file-cli.ts` | Standalone `main()`; invoked by `src/conductor/bin/intake-file`. |
| `intake-backfill-cli.ts` | Standalone `main()`; invoked by `bin/intake-backfill`. |
| `quarantine-engineer-signals-cli.ts` | Standalone `main()`; wraps `engine/engineer/quarantine.ts`. |

`main()` in `index.ts:390` dispatches in strict priority order, each branch calling `process.exit`.
Subcommand detection runs first; the `detectInline` check at `:670` is the last fallthrough, and a bare
invocation with no subcommand is rejected with guidance rather than silently starting a run.

The wiring-reachability gate walks the import graph from the roots declared in
`.ai-conductor/config.yml` under `wiring.entry_points`: `src/conductor/src/index.ts`,
`src/conductor/src/daemon-cli.ts`, `src/conductor/src/intake-loop-cli.ts`, and
`src/conductor/src/engine/engineer-cli.ts`. A new root that `index.ts` cannot reach must be added there
or the gate will not see files that only it reaches.

## Dependency direction

Intended layering is `types ← execution ← engine ← ui ← entry points`. Measured by import grep over
`src/conductor/src/`:

| Edge | Imports | Notes |
| --- | --- | --- |
| engine → types | 74 | The dominant edge. |
| engine → execution | 17 | Includes concrete `ClaudeProvider` / `CodexProvider` in `engine/plugin-loader.ts`. |
| ui → types | 11 | |
| engine → ui | 14 | 11 are `import type`. |
| ui → engine | 10 | 5 are `import type`. |
| types → execution | 1 | `types/events.ts:7`. |
| execution → anything internal | 0 | A clean leaf — `execution/` imports nothing from `engine/`, `types/`, or `ui/`. |
| anything → entry points | 0 | No layer file imports `index.js`, `cli.js`, or `daemon-cli.js`. |
| tools → engine, types | — | Generators read engine metadata; the reverse never happens. |

> **Known limitation.** `engine/` and `ui/` import each other, so the layering above is not enforceable
> as a one-way rule. Engine-side value imports: `engine/conductor.ts:61` and `engine/event-persister.ts:4`
> (`ConductorEventEmitter`), `engine/plugin-loader.ts:8-9` (`TerminalSubscriber`, `TerminalRenderer`).
> UI-side value imports: `ui/terminal-renderer.ts:8,10` and `ui/create-renderer.ts:8,10`
> (`getArtifactStatus`, `STEP_ARTIFACT_GLOBS`, `formatProgressDelta`), `ui/terminal/prompt-host.ts:14`
> (`getRecoveryOptions`). Moving a symbol between the two layers can therefore create a runtime
> initialization cycle that the type checker will not flag. Tracked in
> [#1017](https://github.com/jstoup111/ai-conductor/issues/1017).

> **Known limitation.** `types/events.ts:7` imports `AuthenticationReadinessState`,
> `AuthenticationSource`, and `TokenUsage` from `../execution/llm-provider.js` — the only outbound edge
> from `types/`, and it inverts `types ← execution`. It is a type-only import, so it has no runtime
> effect, but `types/` is not the dependency-free leaf the layering implies. Tracked in
> [#1017](https://github.com/jstoup111/ai-conductor/issues/1017).

## Build output

`npm run build` in `src/conductor` runs `scripts/publish-engine.mjs`, which stages the bundle, finalizes
it into an immutable `dist-versions/<id>/`, and atomically flips the `dist` symlink. Running `npx tsup`
directly is refused: `tsup.config.ts:8` calls `assertPublishWrapperEnv(process.env)`, because raw tsup
output would clobber the versioned layout. Node is pinned to `20.19.2` by `src/conductor/.tool-versions`.

## Extending any of this

Adding a step, gate, skill, hook, or CLI command touches a fixed set of registration points. See
[extending](extending.md).
