---
title: Code organization
parent: Contributing
nav_order: 1
---

# Code organization

The module map of the engine — the TypeScript conductor under `src/conductor/` — plus what each layer
owns, where execution enters, and which direction imports flow. For contributors changing engine code.
For the operator-facing role model, see [architecture](../explanation/architecture.md).

## Contribution license

AI Conductor is licensed under the [Apache License, Version 2.0](../../LICENSE). Unless a contributor
explicitly states otherwise, intentionally submitted contributions use the same license without
additional terms. The root [contribution guide](../../CONTRIBUTING.md) records the complete submission
notice and links the required branch, validation, documentation, and release-metadata workflow.

## Repository layout

| Path | Contents |
| --- | --- |
| `src/conductor/src/` | Engine source. Five directories plus seven entry-point files. |
| `src/conductor/test/` | Vitest suite. See [testing](testing.md). |
| `src/conductor/scripts/` | `publish-engine.mjs` (the build), `publish-guard.mjs`, `intake-label-sync-apply.mts`. |
| `bin/` | Repo-root bash wrappers: `ai-conductor`, `install`, `setup`, `update`, `migrate`, `generate-model-table`, `generate-docs-guard-hook`, `intake-backfill`, `quarantine-engineer-signals`. |
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
| `engine/` | 238 | The state machine, step catalogue, gate loop, daemon, composer-loop implementation, config resolution, self-host guardrails — essentially all domain logic. |
| `execution/` | 6 | The third-party process boundary: LLM provider adapters and subprocess/session management. |
| `types/` | 6 | The shared type surface: `StepName`, `ConductState`, `ConductorEvent`, `HarnessConfig`, plugin kinds. |
| `ui/` | 10 | Subscriber fan-out, terminal renderer, dashboard snapshot/text, notifications, prompt host. |
| `tools/` | 3 | Build-time code generators invoked by `bin/` wrappers. Nothing in the runtime imports them. |

### engine/

164 files sit flat in `engine/`; the remaining 74 are grouped into six subpackages.

| Subpackage | Files | Owns |
| --- | --- | --- |
| `engine/engineer/` | 25 | The composer-loop implementation: authoring, routing, handoff, land-time spec and coherence gates, lesson store. |
| `engine/engineer/intake/` | 26 | Intake queue, ledger, GitHub issue read/write-back, label sync, closed-issue reconciliation, filing-time evidence-path overlap preflight. |
| `engine/self-host/` | 16 | Guardrails for the harness building itself: detector, write fence, sandbox build env, build auth, version gate, release gate. |
| `engine/halt-issues/` | 6 | Halt-monitor issue reconciliation and its CLI. |
| `engine/otel/` | 17 | OpenTelemetry config, metrics, visualizer, shared entry-point wiring, delivery-time OTLP header provider, and the durable export spool (store, lease, drainer, delivery classifier). |
| `engine/credentials/` | 3 | Credential references (`env`, `command`): parsing, environment and command resolution, and command-result caching. |
| `engine/owner-gate/` | 5 | Multi-operator identity partitioning. |

Flat `engine/` files cluster by filename prefix. Use the prefix to find the subsystem:

| Prefix | Representative files |
| --- | --- |
| `daemon-*`, `daemon.ts` | `daemon.ts`, `daemon-runner.ts`, `daemon-backlog.ts`, `daemon-lock.ts`, `daemon-log.ts`, `daemon-tmux.ts`, `daemon-command.ts`, `daemon-fleet.ts`, `daemon-auto-park.ts` |
| `executor-*`, engine pinning | `child-feature-executor.ts`, `executor-protocol.ts`, `executor-child.ts`, `executor-child-runtime.ts`, `executor-broker.ts`, `executor-proxies.ts`, `executor-records.ts`, `engine-pin.ts`, `supervisor-staleness.ts` |
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
| worktree / git | `worktree.ts`, `worktree-prepare.ts`, `worktree-shared.ts`, `git-blob-batch.ts`, `git-hook-assets.ts` |

Two lookups that are easy to get wrong:

- The `build_review` grader has no `build-review.ts`. The prompt and verdict shape live in
  `engine/build-review-prompt.ts`, the inputs in `engine/build-review-inputs.ts`, the routing decision in
  `engine/build-review-disposition.ts`, and verdict parsing plus the `completeness` rubric in
  `engine/artifacts.ts:1122-1219`.
- The daemon's ship-eligibility guard has no module of its own. It is inline in
  `engine/daemon-runner.ts` — `isVerifiedShip` at `:219` and `failureReasonForFalseShip` at `:228`.
- Backlog priority resolution is `createPriorityResolver` in `engine/backlog-priority.ts:114`.
- Priority, size, and blocker facts come from the backend-neutral `createOrderingSource` in
  `engine/ordering-source.ts`; the daemon shares one source per run via
  `engine/daemon-ordering-readers.ts`. Do not add direct `gh` priority or blocker reads elsewhere.
- The daemon pidfile lock is `engine/daemon-lock.ts`, not under `engine/engineer/`.

#### The `conductor.ts` facade

`engine/conductor.ts` holds only imports, named re-exports, the `Conductor` class, and six tuning
constants (`MAX_RECOVERY_RETRIES`, `MAX_RATE_LIMIT_DEADLINE_MS`, `PUBLICATION_REDISPATCH_BUDGET`,
`MAX_GATE_SELECTIONS`, `DONE_MARKER`, `LOOP_HALT_MARKER`). Put every other declaration in a
purpose-named engine module:

| Module | Owns |
| --- | --- |
| `conductor-options.ts` | `ConductorOptions`, `OperatorParkedTermination`, `FinishPublicationCoordinator`, and the checkpoint/review result types the UI consumes. |
| `step-runner-types.ts` | The `StepRunner` interface, `StepRunOptions`, `StepRunResult`, and spot-audit dispatch types. |
| `resume-entry.ts` | Gate topology, back-navigation, and resume-index selection. |
| `step-completion.ts` | Step completion-contract predicates. |
| `remediation-caps.ts` | `MAX_KICKBACKS_PER_GATE`, remediation lap caps, and append budgets. |
| `remediation-hints.ts` | Remediation and retry hints, and remediation target selection. |
| `remediation-task-append.ts` | `appendConductorRemediationTasks`. |
| `prd-audit-routing.ts`, `as-built-routing.ts` | `prd_audit` and as-built finding routing. |
| `build-review-halt-render.ts` | Operator-facing `build_review` halt text. |
| `artifact-approvals.ts` | Artifact approval hashing and active-plan recording. |
| `finish-presentation-repair.ts`, `post-finish-shipped-record.ts` | Finish presentation repair and the post-finish shipped-record refresh and push. |

Only `src/index.ts` and `src/daemon-cli.ts` may import `engine/conductor.js`, and only the `Conductor`
value. Every other module imports a moved declaration from its defining module. See
[Conductor facade guards](testing.md#conductor-facade-guards) for the enforcing tests.

### execution/

The only layer permitted to reach a third party in ordinary code paths.

| File | Owns |
| --- | --- |
| `llm-provider.ts` | The port. `LLMProvider` exposes one `invoke` entry point; `InvokeOptions.interactive` selects operator-facing behavior and `streamConsumer` carries optional observation. |
| `claude-provider.ts` | The `claude` host adapter plus its failure detectors. |
| `codex-provider.ts` | The `codex` host adapter and JSONL parsing. |
| `codex-self-host-auth.ts` | Codex credential handling for self-host builds. |
| `pi-self-host-auth.ts` | Pi credential resolution into the isolated self-host home. |
| `session.ts` | `SessionManager`. |
| `subprocess.ts` | `runCommand`. |
| `feature-slug.ts`, `real-exec-guard.ts`, `scratch-schema.ts`, `provider-model-policy-defaults.ts`, `build-review-read-only-capability.ts`, `transcript-format.ts` | Leaf helpers moved down from `engine/` so adapters need no engine import. Their former engine modules re-export them. |
| `provider-setup-failure.ts` | Provider setup failure classification, moved whole from `engine/`. |

Tests must fake this seam rather than cross it. See [testing](testing.md).

Adapters reach engine behavior only through injected ports. `llm-provider.ts` declares
`DispatchGitGuard`; `ClaudeProvider`, `CodexProvider`, `PiProvider`, and the catalog's
`createAdapter` require it, and engine code passes `ensureGitGuardForDispatch` from
`engine/git-guard.ts`.

### types/

`types/index.ts` is a barrel over `steps.ts` (`StepName`, `Phase`, `EnforcementLevel`,
`StepDefinition`), `state.ts`, `events.ts`, `config.ts` (`HarnessConfig`, the config schema of
record), `plugin.ts` (`PluginKind`), and the contract modules `provider.ts`, `github.ts`,
`restack.ts`, `build-review.ts`, `routing.ts`, and `scheduling-unit.ts`.

`types/` imports nothing outside `types/`, including through `import type` and inline
`import('…')` types:

- A type a module here used to borrow from `execution/` or `engine/` is declared here, and its old
  module imports it back.
- A union derived from an implementation registry is written as a literal union here. The
  registry `satisfies` a record keyed by that union, so drift either way fails `tsc`.
- Built-in provider ids are the exception: the provider catalog stays their only literal source,
  so `provider.ts` declares the opaque `ProviderId` brand and the catalog converts into it.
- `plugin.ts` types plugin emitters against `ConductorEventBus`, which `ConductorEventEmitter`
  implements.

### ui/

`events.ts` (a re-export of `ConductorEventEmitter` and `EventHandler`, which live in
`engine/conductor-event-emitter.ts`; no `src/` file below `ui/` imports through it), `types.ts` (`UIRenderer`, `UISubscriber`, `StepSnapshot`,
`DashboardSnapshot`, `ViewMode`, `UIPromptHost`), `terminal-renderer.ts`,
`subscriber.ts`, `dispatch.ts`, `dashboard-snapshot.ts`, `dashboard-text.ts`, `live-region.ts`,
`notifications.ts`, and `terminal/prompt-host.ts` — the only file under `ui/terminal/`.

### tools/

Each generator splits into pure logic plus a CLI shell, so importing the logic from a test never
triggers `process.exit` or stdio side effects.

| File | Generates |
| --- | --- |
| `generate-model-table.ts` | The ARCHITECTURE.md model-selection table, from `engine/provider-model-policy.ts` and `engine/model-table-metadata.ts`. |
| `generate-docs-guard-hook.ts` | `hooks/claude/docs-guard.sh`, from `engine/session-hook-assets.ts`. |
| `generate-docs-guard-hook-main.ts` | The direct-execution shell for the above. |

Both are driven by `bin/generate-model-table` and `bin/generate-docs-guard-hook`, which run the source
through `src/conductor/node_modules/.bin/tsx` and never touch `dist/`. Both use the same exit-code
contract: `0` clean, `1` drift, `2` environment error.

## Entry points

Eleven files sit at the top level of `src/conductor/src/`.

| File | Role |
| --- | --- |
| `index.ts` | The composition root and argv dispatcher. `bin/ai-conductor` execs `dist/index.js`, built from this file. |
| `cli.ts` | The commander declaration surface. Builds the help text; most subcommands declared here are help-only. |
| `daemon-cli.ts` | The daemon runtime. Registers zero commander commands; entered through `runDaemonMode` at `:1006`, lazily imported from `index.ts` so non-daemon paths never load it. |
| `intake-loop-cli.ts` | `detectIntakeLoopCommand` `:49` / `dispatchIntakeLoop` `:106`, wired into `index.ts`. |
| `intake-file-cli.ts` | Standalone `main()`; invoked by `skills/intake/scripts/intake-file`. |
| `intake-backfill-cli.ts` | Standalone `main()`; invoked by `bin/intake-backfill`. |
| `quarantine-engineer-signals-cli.ts` | Standalone `main()`; wraps `engine/engineer/quarantine.ts`. |
| `cli-defaults.ts`, `cli-pre-dispatch.ts` | Shared CLI defaults, and the command detectors reached before the foreground pipeline starts. |
| `terminal-builtins.ts` | `registerTerminalBuiltins`: constructs and registers `TerminalRenderer` and `TerminalSubscriber`. Called by `daemon-cli.ts`. |
| `cli-builtins.ts` | `registerCliBuiltins`: registers built-in providers through `registerBuiltins` in `engine/plugin-loader.ts`, then the terminal UI. Called by `index.ts`. |

The engine never constructs UI. `registerBuiltins` registers only built-in providers; terminal
rendering is composed at these entry points, through the same plugin registry.

`main()` in `index.ts:1933` dispatches in strict priority order, each branch calling `process.exit`.
Subcommand detection runs first; the `detectInline` check at `:670` is the last fallthrough, and a bare
invocation with no subcommand is rejected with guidance rather than silently starting a run.

Static wiring reachability review is retired. Cover every independently invoked entry point with an
appropriate CLI or integration test instead of adding a `wiring.entry_points` configuration block.

## Dependency direction

Layering is `types ← execution ← engine ← ui ← entry points`, and it is enforced: a file may
import its own layer or any layer to its left. `tools/` may import only `tools/`, `engine/`, and
`types/`, and nothing outside `tools/` may import `tools/`. Only an entry point may import another
entry point.

Every module reference is an edge for this rule: value imports, `import type`, `export … from`
re-exports, inline `import('…')` types, and dynamic `import()`. To use something from a higher
layer, move it down or have the higher layer inject it through a port; see
[execution/](#execution) for the `DispatchGitGuard` example.

`test/structural/layer-ratchet.test.ts` enforces this in the default tier (see
[layer ratchet](testing.md#layer-ratchet)). It fails on any upward edge, any value-import cycle
inside a layer, and any such edge missing from the allowlist. Cycle detection counts value imports
and value re-exports only.

`test/structural/layer-allowlist.txt` holds no upward edge, and the same test fails if one is
added. Its remaining entries are grandfathered same-layer value cycles, one sorted
`<from> -> <to>` line per (importing file, imported file) pair. The allowlist can only shrink: an
entry whose edge disappears or stops violating fails the test as stale.

| Allowlisted edge | Entries | Example |
| --- | --- | --- |
| engine → engine (cycle) | 225 | `engine/slice-topology.ts` → `engine/plan-slices.ts` |
| execution → execution (cycle) | 9 | `execution/provider-catalog.ts` ↔ provider adapters |

## Build output

`npm run build` in `src/conductor` runs `scripts/publish-engine.mjs`, which stages the bundle, finalizes
it into an immutable `dist-versions/<id>/`, and atomically flips the `dist` symlink. Running `npx tsup`
directly is refused: `tsup.config.ts:8` calls `assertPublishWrapperEnv(process.env)`, because raw tsup
output would clobber the versioned layout. Node is pinned to `26.7.0` by `src/conductor/.tool-versions`.

## Extending any of this

Adding a step, gate, skill, hook, or CLI command touches a fixed set of registration points. See
[extending](extending.md).
