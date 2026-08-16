---
title: Extending the harness
parent: Contributing
nav_order: 2
---

# Extending the harness

The exact files to change, the registration points, the validation that catches a mistake, and the tests
to add — for the six things contributors add most often: a skill, a visualizer plugin, an engine step, a
gate, a hook, and a CLI command.

Paths are relative to the repository root. Engine source lives under `src/conductor/src/`; see
[code organization](code-organization.md) for the layer map.

## Add a skill

### Skill files to change

1. `skills/<name>/SKILL.md` — YAML frontmatter carrying `name`, `description`, `enforcement`, and `phase`.
   `model:` is optional; add it only when the skill must pin a tier.
2. `src/conductor/src/engine/model-table-metadata.ts` — one of `SKILL_STEP_MAP` (`:72`) when the skill
   maps to a step, `PIN_EXEMPT_SKILLS` (`:87`) when it should never be pin-checked, or
   `EXTRA_MODEL_TABLE_ROWS` (`:126`) for a row with no step behind it.
3. `HARNESS.md` — regenerated, not hand-edited. Run `bin/generate-model-table` and commit the rewritten
   region between `<!-- BEGIN GENERATED: model-selection-table -->` and
   `<!-- END GENERATED: model-selection-table -->`.

### Skill registration

None beyond the above. `bin/install` auto-discovers skills: it walks `skills/*/` and picks up any
directory containing a `SKILL.md`, then symlinks each into the user-level skill directories for both
supported hosts. A hardcoded list used to live there and drifted; do not reintroduce one.

### What catches a skill mistake

| Mistake | Caught by |
| --- | --- |
| Missing frontmatter field | Integrity check 2 |
| A `/name` cross-reference to a nonexistent skill | Integrity check 4 — WARN only, will not fail |
| No model-table row | Integrity check 5 — WARN only, will not fail |
| Table drifted from the generator source | Integrity check 5a |
| A `model:` pin that disagrees with the generator | Integrity check 5b |
| A referenced `agents/*.md` or `templates/*.template` that does not exist | Integrity checks 3 and 6 |
| Duplicate `### N.` section identifiers | Integrity check 7 |
| Claude-specific commands, models, tools, or delegations left unscoped | Integrity check 14 |

See [validation](validation.md) for what each check does when it goes red.

### Skill tests

Integrity checks 2–7 and 14 cover the skill's structure with no new test file. Add a Vitest test only if
the skill introduces engine-side behavior — for example a new entry in `SKILL_STEP_MAP` that changes
generated-table output, which belongs in `src/conductor/test/generate-model-table.test.ts` or
`model-table-metadata.test.ts`.

### Breaking-surface consequence of a skill change

Adding a skill is additive. **Deleting or renaming one** touches `skill symlink targets`, a canonical
breaking surface, and requires a migration block or a waiver. See [releases](releases.md).

## Add a visualizer plugin

A visualizer observes the existing `ConductorEventEmitter` spine without rendering terminal output.
Install it in one of the two discovery directories:

1. `~/.ai-conductor/plugins/<name>/` for every project.
2. `<project>/.ai-conductor/plugins/<name>/` for one project. A project plugin shadows a global plugin
   with the same kind and name.

The directory needs a `plugin.yml` manifest and an entrypoint module:

```yaml
kind: visualizer
name: example-visualizer
entrypoint: index.mjs
harness_version: ">=0.101.0 <1.0.0"
```

`harness_version` is optional. When present, an incompatible range aborts startup before the plugin is
registered. An invalid manifest is warned and skipped; a missing or unloadable entrypoint aborts
startup. The entrypoint exports a default object implementing this lifecycle:

```ts
interface VisualizerPlugin {
  readonly name: string;
  start(emitter: ConductorEventEmitter): void;
  stop(): Promise<void>;
}
```

Register handlers synchronously with `emitter.on(type, handler)` inside `start()`. Do not add emission
sites or write a parallel event stream. `stop()` must unregister local resources and flush pending
exports. Both `conduct-ts inline` and `conduct-ts daemon` start every compatible registered visualizer;
there is no visualizer-selection config. Inline also starts the built-in OTel visualizer when OTel is
enabled. The daemon attaches plugins to its daemon-wide bus, which receives the existing events
forwarded from feature-scoped buses.

The runtime isolates each plugin:

- A `start()` failure detaches any handlers registered before the throw, emits one `start() failure`
  warning, and does not stop later visualizers from starting.
- A synchronous or asynchronous handler failure detaches every handler owned by that visualizer and
  emits one `handler failure` warning. Visualizer promises are observed for rejection but never delay
  event delivery.
- Shutdown invokes every plugin's `stop()` concurrently. A throw, rejection, or stop taking longer
  than two seconds is warned and contained so another plugin cannot block process teardown.

Unit-test lifecycle behavior with a `PluginRegistry`, a real `ConductorEventEmitter`, and stub plugins;
do not launch agents or call the visualizer's third-party destination. Production wiring belongs in
both composition roots: `src/index.ts` and `src/daemon-cli.ts`.

## Add an engine step

Steps are keyed by an exhaustive `Record<StepName, …>` in several modules, so the compiler is your
checklist: add the name first, then fix every type error `npm run typecheck` reports.

### Step files to change

| Order | File | What to add |
| --- | --- | --- |
| 1 | `src/conductor/src/types/steps.ts:1` | The name, to the `StepName` union. |
| 2 | `src/conductor/src/engine/steps.ts:4` | A `StepDefinition` appended to `ALL_STEPS` — or to `OUT_OF_BAND_STEPS` (`:304`) if it is not part of the linear gate-loop sequence. |
| 3 | `src/conductor/src/engine/artifacts.ts:39` | An entry in `STEP_ARTIFACT_GLOBS`. |
| 4 | `src/conductor/src/engine/provider-model-policy.ts` | `CLAUDE_STEP_MODELS` (`:32`), `CODEX_STEP_MODELS` (`:61`), `STEP_EFFORTS` (`:90`). The composed policies at `:139` and `:155` are deep-frozen. |
| 5 | `src/conductor/src/engine/resolved-config.ts` | `DEFAULT_STEP_RETRIES` (`:24`), `DEFAULT_STEP_REVIEW` (`:58`), and the mapping in `phaseForStep` (`:397`). |
| 6 | `src/conductor/src/engine/model-table-metadata.ts` | `STEP_RATIONALE` (`:14`) and, if a skill drives the step, `SKILL_STEP_MAP` (`:72`). Then regenerate HARNESS.md. |
| 7 | `src/conductor/src/engine/skill-invocation.ts:11` | A `SkillInvocationDescriptor` in `STEP_SKILL_INVOCATIONS` — either `{ kind: 'skill', skillName, arguments }` or `{ kind: 'engine-native' }`. Path resolution happens in `engine/skill-resolver.ts:65`. |
| 8 (optional) | `src/conductor/src/engine/artifacts.ts` | `CUSTOM_COMPLETION_PREDICATES` (`:1306`) when file globs cannot express completion, and `GATE_ONLY_PREDICATES` (`:2394`) when the step is a gate-loop-only check. Both are `Partial`, so neither errors if you skip it. |
| 9 (optional) | `src/conductor/src/engine/step-runners.ts:322` | Dispatch behavior in `DefaultStepRunner`. The `StepRunner` interface is `engine/conductor.ts:527`, with `StepRunOptions` at `:477` and `StepRunResult` at `:363`. |

Skip helpers live alongside `ALL_STEPS`: `shouldSkipForTier` (`:420`), `shouldSkipForTrack` (`:431`),
`shouldSkipForBootstrapMode` (`:451`), `shouldSkipForUpstreamSkip` (`:465`).

### The no-code path

A step declared in project config needs none of the above. `engine/config.ts:1780` `customStepEntries()`
reads it, and `engine/gates.ts:15` `checkGate` accepts a `StepDefinition` directly so config-declared
steps work without an engine edit. This repo registers one that way:

```yaml
steps:
  maintain-documentation:
    after: rebase
    skill: .agents/skills/maintain-documentation/SKILL.md
    enforcement: gating
    completion_artifact: .pipeline/maintain-documentation-pass
```

Use this for a project-specific step. Use the engine path only for a step every consumer gets.

### What catches a step mistake

`npm run typecheck` catches every missed exhaustive record — that is the point of the design. Integrity
check 5a catches a stale HARNESS.md model table. Nothing catches a missing
`CUSTOM_COMPLETION_PREDICATES` entry, because that map is deliberately partial: the step will simply
complete on artifact globs alone.

### Step tests

- A unit test under `src/conductor/test/engine/` mirroring the module you changed.
- If the step gates progression, an acceptance test under `src/conductor/test/acceptance/` proving the
  observable gate behavior across the minimum real internal path.
- Bound any Conductor fixture: pre-resolve unrelated steps, use `fromStep` for a targeted transition, and
  create real evidence for every gate the fixture participates in. See [testing](testing.md).

Update [steps](../reference/steps.md) and [models](../reference/models.md) in the same PR.

## Add a gate

There is no single gate registry. "Gate" means three different mechanisms; pick the one that matches
what you are enforcing.

### Prerequisite gate

Set `enforcement: 'gating'` and a `prerequisites` list on the step in `engine/steps.ts`. Consumed by
`engine/gates.ts`: `checkGate` (`:15`), `isGatingStep` (`:38`), `canSkipStep` (`:45`).

### Objective verdict gate

The gate loop. Add the predicate to `GATE_ONLY_PREDICATES` in `engine/artifacts.ts:2394`; the loop
machinery is `engine/gate-verdicts.ts` — `checkGateCompletion` (`:17`), `computeAndWriteVerdict` (`:62`),
`writeVerdict` (`:78`), `readVerdict` (`:92`), `readAllVerdicts` (`:106`). Verdicts persist to
`.pipeline/gates/<step>.json` (`GATES_DIR`, `:51`).

Routing over verdicts is `engine/selector.ts`: `gateSatisfied` (`:53`), `selectNextGate` (`:111`),
`earliestUnsatisfiedGateIndex` (`:130`). Kickbacks are capped by `MAX_KICKBACKS_PER_GATE` in
`engine/conductor.ts:319`.

Supporting machinery, if your gate needs it: `engine/gate-invalidation.ts`, `engine/gate-writeback.ts`,
`engine/gate-code-validity.ts`, `engine/gated-snapshot.ts`.

### Structural repo gate

A check on repository shape rather than a feature's runtime state goes into
`test/test_harness_integrity.sh` as a new numbered section, using the existing `assert` (`:27`) helper.
Use `warn_check` (`:40`) only when you genuinely mean advisory — a `warn_check` can never fail the suite.

Self-host gates compose separately in `engine/self-host/release-gate.ts` and HALT through
`engine/self-host/gate-halt.ts`.

### What catches a gate mistake

A prerequisite gate with a typo in a step name is a type error. A verdict predicate that never returns
`false` is caught by nothing — write the negative test. An integrity section that always passes is caught
by nothing either; prove it can fail with a fixture sub-test, as checks 5a and 5c do.

### Gate tests

Unit-test the predicate directly rather than through `Conductor.run()`. Add an acceptance test for the
observable block-and-recover behavior. For an integrity-suite gate, add a fixture sub-test in the same
section that deliberately breaks the condition and asserts the failing exit code.

Update [gates](../explanation/gates.md) and, for an integrity check, [validation](validation.md).

## Add a hook

### Hand-written hooks

1. Author `hooks/claude/<name>.sh` in bash.
2. Wire it into `bin/install`'s `configure_hooks()` function, in the `harness_hooks` dictionary. Each
   entry names an event (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `StopFailure`), an optional
   `matcher`, the absolute command path under `${hooks_dir}`, and a `timeout`. `bin/install` merges these
   into `~/.claude/settings.json` without clobbering entries it did not add.

A hook script that is never added to `harness_hooks` sits inert on disk — it is syntax-checked and
nothing else.

### Generated hooks

`hooks/claude/docs-guard.sh` is generated, not authored. Edit `DOCS_GUARD_HOOK` in
`src/conductor/src/engine/session-hook-assets.ts`, run `bin/generate-docs-guard-hook`, and commit the
regenerated `.sh`. Editing the `.sh` directly is drift and check 5c will fail.

Hook assets must be plain bash plus inline `node -e` only, with zero references to `dist/` or
`conduct-ts` — a generated hook has to keep working while the engine is mid-rebuild.

### What catches a hook mistake

| Mistake | Caught by |
| --- | --- |
| Bash syntax error | Integrity check 1 |
| Hand-edited generated hook | Integrity check 5c |
| A hook that writes `.pipeline/task-status.json` | Integrity check 10 |
| Wiring never added to `bin/install` | Nothing — verify by hand |

### Hook tests

Add a bash script under `test/` following the existing `test_*.sh` pattern, and add unit coverage under
`src/conductor/test/engine/` for any generator change. Note that the bash script will only be
syntax-checked unless you also invoke it from the integrity suite, as checks 13 and 14 do for their
scripts.

### Breaking-surface consequence of a hook change

Anything under `hooks/` classifies as `hook wiring`, a canonical breaking surface. The change needs a
runnable migration block, or a waiver when the edit is genuinely internal-only. See
[releases](releases.md).

Document the new hook in [settings and hooks](../reference/settings-and-hooks.md).

## Add a CLI command

A strict three-file pattern.

### 1. Declare it for `--help`

Add the subcommand to `createProgram()` in `src/conductor/src/cli.ts:100`. Declarations here build the
help surface; most of them do no dispatching.

### 2. Implement detect and dispatch

Create `src/conductor/src/engine/<name>-cli.ts` exporting a pair:

- `detectXCommand(argv: string[]): XDispatch | null` — a pure argv parser returning a discriminated union
  keyed on `kind`, or `null` when this is not your command.
- `dispatchX(d: XDispatch): Promise<number>` — the side-effecting half, returning an exit code.

Twenty-plus modules follow this shape; `engine/registry-cli.ts` (`detectRegistryCommand` `:184`,
`dispatchRegistry` `:214`) and `engine/task-cli.ts` (`:20`, `:47`) are the cleanest references. Do not
copy `detectOverlapScanCommand`, which is defined inline in `index.ts:318` — it is an inconsistency, not
the pattern.

### 3. Wire it into main()

Add the branch to `main()` in `src/conductor/src/index.ts:390`, **before** the `detectInline` fallthrough
at `:670`. Each branch calls `process.exit`. Use the lazy `await import()` form for a heavy runtime, the
way the daemon branch does — that is what keeps `daemon-cli.ts` off the hot path for every other command.

### Daemon sub-verbs

A new `daemon <verb>` must also be added to `src/conductor/src/engine/daemon-command.ts`. Management
verbs go in `MANAGEMENT_VERBS` (`:76`); every known sub-verb must appear in `DAEMON_SUBVERBS` (`:120`),
or `detectUnknownDaemonSubcommand` (`:131`) rejects it as a typo — which is deliberate, since the
alternative is silently launching a daemon run.

### Static wiring review

If your command's entry file is a *root* that `index.ts` cannot reach, add it to `wiring.entry_points` in
`.ai-conductor/config.yml`. `build_review` receives those roots for its static reachability rubric; an
unlisted root leaves the reviewer without the configured production context to assess that path.

### What catches a CLI mistake

| Mistake | Caught by |
| --- | --- |
| Declared in `cli.ts` but never dispatched | Nothing — the command silently falls through to the inline rejection. Add a CLI test. |
| Dispatched but not declared | Nothing — it works but is undiscoverable in `--help`. |
| A daemon sub-verb missing from `DAEMON_SUBVERBS` | `detectUnknownDaemonSubcommand` at runtime |
| Unreachable new entry root | `build_review`'s static wiring rubric; add the root to `wiring.entry_points` and cover the command with a CLI test. |

### CLI tests

- A unit test for `detectXCommand` covering the null case and each `kind` — argv parsing is pure and
  cheap to test exhaustively.
- A test for `dispatchX` with its collaborators injected.
- A `src/conductor/test/cli/` test if the command changes top-level dispatch or help output.

Document the command, its flags, and its exit codes in [cli](../reference/cli.md).

## Before you open the PR

- `bash test/test_harness_integrity.sh` from the repo root.
- `cd src/conductor && npm run typecheck && npm test`.
- Update the canonical affected documentation in the same PR — a PR is not complete while its
  documentation is stale.
- Add a CHANGELOG entry only for a notable reader-visible implementation change; see
  [releases](releases.md).
