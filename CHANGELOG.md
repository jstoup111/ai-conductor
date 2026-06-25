# Changelog

All notable changes to this harness are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release cadence: tags `vX.Y.Z` are cut automatically by CI on merge to `main`
(see `.github/workflows/release.yml`). Every PR must add an entry under
`## [Unreleased]

## [0.99.17] - 2026-05-02

## [0.99.16] - 2026-05-02

## [0.99.15] - 2026-05-02

## [0.99.14] - 2026-05-01

## [0.99.13] - 2026-05-01`.

## [0.99.12] - 2026-04-30

## [0.99.11] - 2026-04-29

## [0.99.10] - 2026-04-28

## [0.99.9] - 2026-04-28

## [0.99.8] - 2026-04-28

## [0.99.7] - 2026-04-28

## [0.99.6] - 2026-04-28

## [0.99.5] - 2026-04-28

## [0.99.4] - 2026-04-28

## [Unreleased]

### Changed
- conduct-ts: DECIDE order now runs **architecture before plan** — `stories →
  conflict_check → architecture_diagram → architecture_review → plan →
  acceptance_specs`. Architecture (system-level HOW) grounds the technical plan
  (task-level HOW) instead of being reviewed after it. Prerequisites reordered in
  `engine/steps.ts`; skipped steps still satisfy gates so Small tier is unaffected;
  custom `.ai-conductor/config.yml` steps still resolve (inserted by name). Legacy
  bash `bin/conduct` keeps the prior plan→architecture order (its architecture-review
  gates on the plan); `conduct-ts` is canonical.
- DECIDE phase is now PRD-driven. `templates/design-doc.md.template` is a PRD with
  **enumerated functional requirements (`FR-N`)** plus goals/non-goals, users, NFRs,
  acceptance criteria, and dependencies. `skills/brainstorm` requires those sections;
  `skills/stories` extracts **one or more granular stories per `FR-N`** (behavioral WHAT,
  happy + negative) tagged with their `FR-N` for traceability; `skills/plan` is framed as
  the **technical implementation plan (HOW)** build ships from — it opens with a Technical
  Approach section and keeps the required Design-doc link. Traceability runs PRD `FR-N` →
  story → plan task.

### Fixed
- conduct-ts: the `plan` coverage gate no longer false-fails (and kicks the loop
  back to `plan` forever) on the real generator's output format. Stories use
  `## Story N:` headings (id `N`) and plan tasks reference `**Story:** Story 1
  (FR-1, FR-2)` with the path type on a separate `**Type:** happy-path` line. The
  old matcher captured the literal word "Story" as the id and read happy/negative
  only from the parens (which hold `FR-N` refs), so coverage never matched —
  verdict `plan does not cover: 1 happy, 1 negative, …`. The matcher is now
  task-block-aware: it strips an optional `Story `/`Epic ` prefix word from the
  id and reads the path type from the `**Type:**` line, the Story parens, or a
  path keyword — while still accepting the prior `**Story:** 3.2-1 (happy path)`
  and `## Coverage Check` table formats. Found in Phase 7 validation.
- conduct-ts: the `finish` step no longer stalls the loop in `--auto`. The finish
  skill normally asks the user to pick Merge/PR/Keep/Discard; in unattended mode
  print-mode Claude emitted prose and exited without writing
  `.pipeline/finish-choice`, leaving the gate permanently unsatisfied. In auto
  mode the step now gets an explicit directive to decide deterministically and
  act: open a PR (never merge) and record `pr_url` when a git remote + `gh` are
  available, else `keep` the branch — ending by writing the chosen value to
  `.pipeline/finish-choice`. `skills/finish/SKILL.md` documents the same fallback.
  Found in Phase 7 validation.
- conduct-ts: the `acceptance_specs` completion check no longer false-fails on
  non-Rails projects. Its artifact globs were Rails-only (`spec/acceptance/**/*`,
  `test/acceptance/**/*`), so a Node project — whose `writing-system-tests` skill
  correctly wrote `app.test.js` at the root — failed the gate with "no files
  matching …". Broadened to common conventions (`test/**/*`, `tests/**/*`,
  `__tests__/**/*`, root-level `*.test.{js,ts}` / `*.spec.{js,ts}`, plus Rails
  `spec/requests` and `spec/system`), scoped to avoid recursing `node_modules`.
  Found in Phase 7 validation.
- conduct-ts: `--auto` no longer drops into an interactive session. Two paths
  opened a REPL / recovery menu without checking the mode: the build-stall
  circuit breaker (`runInteractive`) and the post-retry recovery menu
  (`onRecovery`, which the CLI wires even in auto). Auto mode is unattended, so
  on an exhausted-retry failure it now: auto-skips **advisory** steps (so an
  advisory failure can't block the run) and stops on **gating/structural**
  failures (e.g. plan, build) for a human to inspect — never prompting. Found in
  Phase 7 validation.
- conduct-ts: collaborative steps (`brainstorm`, `stories`, `plan`, `manual_test`,
  `finish`) now skip permissions in `--auto` mode. They were dispatched with
  `dangerouslySkipPermissions: false` even when unattended, so the spawned
  `claude` launched in the user's default permission mode — if that's **plan
  mode, every write is blocked**, so brainstorm could never save its
  `.docs/specs/` PRD and the step looped (`no files matching .docs/specs/*.md`)
  with no human and no ExitPlanMode tool to recover. In auto mode there is no one
  to approve permissions, so these steps now skip them like autonomous steps do;
  interactive REPL mode (non-auto) still prompts. Found in Phase 7 validation.
- conduct-ts: the `worktree` step is now engine-managed (deterministic
  `WorktreeManager.create` → `git worktree add -b`) instead of dispatching
  `/conduct worktree` to Claude. The skill path let Claude run a broad
  self-directed orchestration — skipping `brainstorm` ("Feature defined in
  spec"), so **no PRD was persisted**, and botching git so the main repo ended
  up on the feature branch with an empty detached worktree. The engine now
  creates the worktree (main untouched) and drives `brainstorm` etc. normally,
  so the PRD chain holds. Worktree-creation failure degrades gracefully (warn +
  continue in-place) rather than blocking the run. Found in Phase 7 validation.
- conduct-ts: interactive steps (`brainstorm`, `stories`, `plan`, `manual_test`,
  `finish`) no longer hang silently in `--auto`. `invokeInteractive` ran every
  step with `stdio: 'inherit'`, but in print mode (`claude -p`, used for all
  interactive steps under `--auto`) an inherited TTY stdin never reaches EOF, so
  the process blocked forever with no error. Print mode now uses
  `['ignore', 'inherit', 'inherit']` (stdin ignored, output still live), matching
  the autonomous path; REPL mode (`interactive: true`) still inherits all stdio.
- conduct-ts: a "session in use" lock now self-recovers. `ClaudeProvider` detects
  the session-id lock message (`already in use` / `session … in use by another
  process`) and routes it through the existing stale-session path — the conductor
  resets to a fresh session id and retries without burning the retry budget,
  instead of failing the step. The `session_reset` event reason is now generic
  ("session unavailable (expired or in use)").
- conduct-ts: fixed `Fatal: __dirname is not defined` crash on startup. `src/conductor/src/index.ts` referenced the CommonJS-only `__dirname` global inside `readHarnessVersion()`, but the bundle is ESM (`tsup` `format: ['esm']`, `shims: false`), so the binary aborted before the CLI could parse args. Derived `__dirname` from `import.meta.url` using the same pattern already in `src/conductor/src/engine/plugin-manifest.ts`.
- conduct-ts: SHIP-phase steps no longer silently mark a feature complete when pipeline exits mid-implementation. The conductor now stamps each invocation with `state.session_started_at` and the `manual_test`, `retro`, and `finish` completion predicates require fresh, feature-scoped evidence:
  - `manual_test` requires `.docs/manual-test-results.md` with no `| FAIL` rows AND mtime >= `session_started_at` (previously had no completion gate at all — any clean REPL exit marked it `done`)
  - `retro` requires a `.docs/retros/*-<slug>.md` file matching the current `feature_desc` slug AND fresh mtime; falls back to "any retro fresh in this session" when slug is unavailable (previously matched any file under `.docs/retros/`, including stale prior-feature retros)
  - `finish` requires a fresh `.pipeline/finish-choice` marker (mtime >= `session_started_at`); for `choice="pr"`, additionally requires `state.pr_url` to be set; the conductor sweeps stale `.pipeline/finish-choice` from prior sessions on `Conductor.run()` entry (previously the marker could survive across sessions and `state.pr_url` alone could pass the gate)
- conduct-ts: `build` completion predicate now fails when `.pipeline/halt-user-input-required` is present, even with all-complete `task-status.json`. A halt marker that survives to gate-check time means a true halt that bypassed the conductor's stall handler — the predicate now treats it as a build failure so the cascade through SHIP-phase steps doesn't fire.
- conduct-ts: when auto-resume detects an "already complete" feature, the conductor now re-verifies the SHIP-phase predicates and offers a recovery prompt (roll back `feature_status` and resume at the first failing step, or keep state as-is). Self-heals worktrees that hit the prior false-completion bug.
- skills/pipeline/SKILL.md: documents the "User-requested exit during a run" contract — when the user asks to "exit to harness", "stop and continue later", etc., the skill MUST write `.pipeline/halt-user-input-required` before exiting and MUST NOT mark unfinished tasks as `completed`/`skipped`. Without the marker the conductor reads `task-status.json`, sees nothing in flight, and concludes the build step is done — silently cascading through SHIP to mark the feature complete while the user's actual blocker is still open.
- skills/manual-test/SKILL.md: instructs the skill to save results to `.docs/manual-test-results.md` (in addition to displaying in chat) so the conductor's completion gate can verify them. The previous "do NOT write to a file" wording contradicted what the bash conductor was already injecting at dispatch time.
- CHANGELOG.md: fixed unclosed backtick in the preamble that the release workflow had to step around.
- conduct-ts: `src/conductor/src/index.ts` no longer runs the CLI `main()` as an import side-effect. The unguarded top-level `main().catch(... process.exit(1))` fired whenever a test imported the module (e.g. `deriveMode`), so `process.exit(1)` surfaced as an unhandled rejection that flakily failed the parallel `vitest` run and forced a non-zero exit. Guarded with the standard ESM entry-point check (`import.meta.url === pathToFileURL(process.argv[1]).href`). The full suite now exits 0 deterministically.
- conduct-ts test: the `saves state on SIGINT` test in `test/engine/conductor.test.ts` now stubs `process.exit`; it previously invoked the real SIGINT handler's `process.exit(130)`, leaking an unhandled rejection into the run.

### Added
- conduct-ts: gate-loop daemon foundation (Phase 6) — `engine/daemon.ts`
  (`runDaemon`) is the parallel worker-pool orchestration core: pulls features
  from a backlog, runs up to N concurrently (each isolated behind the injected
  `runFeature`), enforces hard ceilings (max items, global token cost), honors
  `once` vs idle-poll, and isolates a thrown feature as an `error` outcome so the
  pool survives. `engine/daemon-backlog.ts` (`discoverBacklog`) finds
  daemon-eligible features — those with both stories AND plan present (the daemon
  consumes specs, never authors them) — skipping already-processed slugs.
  `engine/daemon-runner.ts` (`makeRunFeature`) is the per-feature orchestration
  (done → mark+remove worktree+PR; halted/error → keep worktree for the human; a
  thrown primitive is caught). `engine/daemon-deps.ts` provides the concrete
  git/fs primitives (worktree add/remove, spec materialization with commit,
  `.pipeline/DONE`/`HALT` outcome read, processed markers). New `--daemon`
  (+`--concurrency`, `--max-items`) CLI flag and `daemon-cli.ts` assemble a
  per-worktree Conductor (`verifyArtifacts`+`freshContextPerStep`, `fromStep:
  acceptance_specs`) and run the pool. 22 tests cover the orchestration,
  ceilings, isolation, eligibility, and outcome-reading; the live git/provider/PR
  path is exercised by end-to-end validation (Phase 7).
- conduct-ts: gate-loop observability — new `ConductorEvent` types `gate_verdict`
  (step, satisfied, reason), `kickback` (from, to, evidence, count), `loop_halt`
  (reason), and `loop_converged`, emitted from the conductor's gate-driven tail.
  `TerminalRenderer` surfaces unsatisfied verdicts, kickbacks (with reason + count),
  HALTs, and convergence; the json-stdout subscriber serializes them as-is. (The
  kickback now emits a dedicated `kickback` event instead of reusing
  `navigation_back`, which stays reserved for user-driven back-navigation.)
- conduct-ts: hybrid session model — new `freshContextPerStep` option. When on,
  the conductor resets the LLM session before each new step in the looped region
  (`build`…`finish`), so each runs on fresh context (Ralph-style — context never
  bloats across the SHIP phase) while a step's own retries still resume. The
  front half keeps the persistent session. Default off (persistent everywhere).
- conduct-ts: the conductor now drives the **resolved step registry**
  (`buildStepRegistry(config)`) instead of the static `ALL_STEPS`, so **custom
  steps** defined in `.ai-conductor/config.yml` (via `after:` + `skill:`) are
  dispatched, indexed, and participate in the gate loop. All index math, the
  selector, `navigateBack`/`getNavigableSteps`, and `findResumeIndex` key off the
  resolved list; loop-body checks use the registry def directly (so custom steps,
  absent from the static map, no longer throw `Unknown step`). `checkGate` accepts
  a `StepDefinition`. (Previously `buildStepRegistry` was built and tested but
  never wired into the runtime — custom steps never ran.)
- conduct-ts: gate-driven loop — selector + tail conversion. New
  `src/conductor/src/engine/selector.ts` (`selectNextGate` — earliest unsatisfied
  gate, config-agnostic). `conductor.ts` now drives the back half (`build`→`finish`)
  via the selector instead of a linear `i++`: after `build` engages, the next step
  is the earliest unsatisfied gate; a step that re-opens an upstream gate (kickback
  verdict `{satisfied:false, kickback.from}`) routes the loop back to plan/stories
  via `navigateBack` + downstream-stale cascade. Convergence writes `.pipeline/DONE`;
  an anti-ping-pong cap and a per-gate selection cap write `.pipeline/HALT`. The tail
  engages only with `verifyArtifacts` on — otherwise the conductor stays fully linear
  (unchanged). The front half (`worktree`…`acceptance_specs`) is untouched.
- conduct-ts: gate-driven loop foundation (verdict layer) — new `src/conductor/src/engine/gate-verdicts.ts` with `computeAndWriteVerdict`/`writeVerdict`/`readVerdict`/`readAllVerdicts`/`checkGateCompletion`, persisting per-feature gate verdicts (`{satisfied, reason, checkedAt, kickback?}`) to `.pipeline/gates/<step>.json`. Adds `GATE_ONLY_PREDICATES` in `engine/artifacts.ts` with machine-checkable `stories` (happy + negative path, no DRAFT) and `plan` (per-path-type story coverage) predicates — kept separate from `CUSTOM_COMPLETION_PREDICATES` so the existing linear conductor is unchanged. Blueprint in `.docs/decisions/gate-audit-2026-06-23.md`. (Selector + loop conversion land in a later change.)
- conduct-ts: new `--diagnose` CLI flag — non-mutating diagnostic that loads state for the named (or current) feature, re-verifies the SHIP-phase predicates, and prints any inconsistencies. Exits 0 when state is consistent, 1 when state is marked complete but evidence is missing.
- conduct-ts: new `feature_complete` event payload fields (`featureDesc`, `sessionStartedAt`) and a multi-line bg-green completion banner in `TerminalRenderer` so a finished run is impossible to read as "stopped processing without error" — the previous single-line green render could be missed in a long pipeline run.
- conduct-ts: new `state.session_started_at?: number` (epoch ms) — set on every `Conductor.run()` entry, used by SHIP-phase freshness checks. Purely additive; old state files deserialize fine.
- conduct-ts: new `complete-verifier.ts` module with `verifyCompleteState(worktreePath)` and `formatGapReport(...)` helpers, shared between auto-resume's recovery path and the `--diagnose` flag.
- `UIRenderer` interface (`handle(event): Promise<void>` + `stop()`) in `src/conductor/src/ui/types.ts` — new plugin contract for UI renderers
- `TerminalRenderer` class in `src/conductor/src/ui/terminal-renderer.ts` implementing `UIRenderer` (replaces the `createRenderer` factory function; backward-compat factory retained in `create-renderer.ts`)
- `dispatchRenderers(renderers, event)` in `src/conductor/src/ui/dispatch.ts` — fan-out via `Promise.allSettled`, renderer degradation (one throw doesn't kill others), re-emits `renderer_error` event to survivors
- `renderer_error` event type in `src/conductor/src/types/events.ts` — carries `rendererName` and `error` string
- `RecordingRenderer` test double in `test/ui/recording-renderer.ts` — records events, supports `delayMs` and `throwError` injection
- `registerBuiltins()` now accepts optional `TerminalRendererOptions` and registers `TerminalRenderer` as `ui_renderer:terminal_renderer` alongside the existing `TerminalSubscriber`
- New test files: `test/ui/terminal-renderer.test.ts` (TerminalRenderer class), `test/ui/dispatch.test.ts` (dispatch + degradation + slow-renderer + dup-renderer scenarios)
- `RecorderProvider` reference LLM provider plugin at `plugins/recorder-provider/` — logs every `invoke()` and `invokeInteractive()` call as a JSONL line to a configurable path, returns a canned response, creates parent directories on first write, and throws `RecorderProviderError` on write failure
- Unit tests for RecorderProvider (11 tests) covering JSONL format, canned response, parent-dir creation, error handling, concurrent writes, and invokeInteractive
- Integration tests for RecorderProvider flow (7 tests) covering happy path, misspelled kind rejection, missing plugin dir, version-incompatible manifest, and empty prompt
- RecorderProvider installs through the plugin loader with zero edits to `src/conductor/src/index.ts`
- `when?: string` field on `StepConfig` — conditional step skip evaluated before dispatch
- `parallel?: ParallelBranch[]` field on `StepConfig` — concurrent step groups via `Promise.all`
- `ParallelBranch` type: `{ name, skill?, model?, effort?, advisory? }` — discriminated from skill steps (mutual exclusion)
- `evaluateWhen(expression, state)` in `src/engine/when-expression.ts` — five grammar forms: `tier == L`, `tier in [M, L]`, `phase == BUILD`, `${key} == value`, `A && B`
- `validateWhenSyntax(expression)` — config-load-time syntax check, returns error string or null
- Four new `ConductorEvent` variants: `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure`
- Conductor evaluates `when:` before dispatching each step; emits `when_skip` when false
- Conductor fans out `parallel:` branches via `Promise.all`; writes synthetic state keys `<group>__<branch>` to `conduct-state.json`
- Gating branch failure (`advisory: false`, the default) → group fails → downstream blocked
- Advisory branch failure (`advisory: true`) → logged via `parallel_failure` event, group continues to success
- `when:` on a parallel group → all synthetic keys set to `"skipped"` when expression is false
- Terminal renderer handles `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure` events in `create-renderer.ts`
- Config validator (`engine/config.ts`) validates `when:` syntax and `parallel:` structure at config-load time
- 59 new tests across `when-expression.test.ts`, `when-parallel.test.ts`, `when-parallel-renderer.test.ts`
- Feature 3.2: json-stdout-subscriber plugin — emits ConductorEvents as newline-delimited JSON to stdout; selectable via `ui_renderer: json-stdout` in config. Each line includes all original event fields plus a `ts` ISO timestamp. handle() before start() is a no-op (no crash). Plugin discovered automatically by the plugin loader — no changes to `src/conductor/src/index.ts` required.
- Feature 4.1: EventPersister — every ConductorEvent persisted with timestamp to `.pipeline/events.jsonl` (newline-delimited JSON, replayable). Subscribes to event bus as a listener; zero changes to emission sites in `conductor.ts` or `step-runners.ts`.
- Feature 4.1: `conduct --report` subcommand — reads `.pipeline/events.jsonl` and renders step durations (sorted descending), retry hotspots (with failed-step annotation), and token spend tables. Read-only; does not start a Claude session.
- Feature 4.1: Optional `tokenUsage` field on `InvokeResult` — backwards-compatible; `ClaudeProvider` parses from Claude CLI `stream-json` output; `RecorderProvider` synthesizes deterministic counts (`{ input: 10, output: 5 }`) for stable test fixtures. Report gracefully omits token rows when field is absent.
- Plugin manifest schema (`plugin.yml`) with `kind`, `name`, `entrypoint`, `harness_version`, `capabilities?` fields
- `PluginKind` enum: `llm_provider | ui_renderer | step | hook | visualizer`
- Five typed error classes: `PluginManifestError`, `PluginVersionError`, `PluginLoadError`, `PluginNotFoundError`, `PluginRegistryError`
- `validateManifest()` with required-field, kind-enum, name-format (`/^[a-z0-9-]+$/`), and semver compatibility checks
- `loadManifestFromFile()` wrapping YAML parse and I/O errors with file path context
- `PluginRegistry` class: `register<K>()`, `get<T>()`, `list()`, `markInitialized()` with initialization guard
- `discoverPlugins()`: scans global (`~/.ai-conductor/plugins/`) and project-local (`.ai-conductor/plugins/`) directories; project-local shadows global with debug log
- `registerBuiltins()`: `ClaudeProvider` → `llm_provider:claude`, `TerminalSubscriber` → `ui_renderer:terminal`
- `src/index.ts` refactored: no longer hardcodes `new ClaudeProvider()` or `new TerminalSubscriber()` — both retrieved from registry
- Integration tests: default-fallback (blank config → claude provider), EchoProvider E2E (external plugin discovery and invocation), version-mismatch and missing-entrypoint negative paths

### Migration

New optional `when:` and `parallel:` stanzas in `.ai-conductor/config.yml` (Feature 3.1):

```bash
# Conditionally skip a step — skip 'brainstorm' on small features:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  brainstorm:
    when: "tier in [M, L]"
EOF

# Skip a step based on bootstrap mode:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  assess:
    when: "${bootstrap_mode} == fresh"
EOF

# Run two skills concurrently in a parallel group:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  build:
    parallel:
      - name: frontend
        skill: skills/build-frontend/SKILL.md
      - name: backend
        skill: skills/build-backend/SKILL.md
        advisory: false   # failure blocks the group (default)
EOF

# Combine when: with parallel: to skip the entire group on S-tier:
cat >> .ai-conductor/config.yml << 'EOF'
steps:
  build:
    when: "tier in [M, L]"
    parallel:
      - name: unit-tests
      - name: integration-tests
        advisory: true    # failure is logged but group succeeds
EOF
```

Existing projects require no changes — both `when:` and `parallel:` are opt-in.

New optional config stanzas in `.ai-conductor/config.yml` to select non-default plugins:

```bash
# Select a custom LLM provider (must be discoverable via plugin.yml in plugin dirs)
# Default is 'claude' (ClaudeProvider built-in); omit to keep using ClaudeProvider
echo "llm_provider: my-custom-provider" >> .ai-conductor/config.yml

# Select a custom UI renderer (default is 'terminal'; omit to keep using TerminalSubscriber)
echo "ui_renderer: my-custom-renderer" >> .ai-conductor/config.yml

# Install a plugin by placing plugin.yml + entrypoint in either:
#   ~/.ai-conductor/plugins/<plugin-name>/   (global — all projects)
#   .ai-conductor/plugins/<plugin-name>/     (project-local — overrides global)
```

Existing projects require no changes — built-in defaults are preserved.

## [0.99.2] - 2026-04-19

## [0.99.1] - 2026-04-19

## [0.99.0] - 2026-04-18

## [0.4.1] - 2026-04-17

## [0.4.0] - 2026-04-12

## [0.3.0] - 2026-04-11` before merge — CI fails the release workflow if the block is
empty.

Categories:

- **Added** — new skills, hooks, gates, or capabilities.
- **Changed** — behavioral changes to existing skills, hooks, or CLI.
- **Fixed** — bug fixes, typo corrections, non-behavioral cleanup.
- **Removed** — skills, hooks, or flags that no longer exist.
- **Migration** — runnable steps needed when upgrading. Use a
  ` ```bash migration ` fenced block for commands `bin/migrate` should execute.

---

## [Unreleased]

### Added

- `finish` step now has a custom completion predicate
  (`src/conductor/src/engine/artifacts.ts`) that requires either
  `state.pr_url` to be set or `.pipeline/finish-choice` to contain one of
  `pr | merge-local | keep | discard`. Without one, the conductor refuses
  to mark the step done — closing the silent-no-PR failure mode where
  print-mode finish exited with prose instead of acting.
- `auto-resume.ts` learns a new `kind: 'orphaned-state'` result, returned
  when project-root state is past the worktree step but no worktree exists
  at any conventional location (`.worktrees/<slug>` or
  `.claude/worktrees/<slug>`). `index.ts` surfaces a clear error with
  recovery instructions instead of silently resuming on main and landing
  artifacts on the wrong branch.
- `auto-resume` and the worktree scan now find worktrees under
  `.claude/worktrees/<slug>` in addition to `.worktrees/<slug>`, matching
  the convention used by Claude Code's IDE Conductor feature.
- TypeScript conductor rewrite (`src/conductor/`) — 3-layer architecture (Engine/Execution/UI) replacing the 3,100-line bash `bin/conduct`.
- `bin/conduct-ts` shell wrapper for the TypeScript conductor.
- 14-step state machine with typed events, gate enforcement, tier-based skipping, checkpoint handling, backward navigation, and recovery flow.
- LLM provider abstraction with Claude CLI adapter, session management, and rate limit handling.
- ink-based terminal UI: dashboard, checkpoint prompts, recovery menus, navigation menus.
- CLI entry point with commander: `--resume`, `--auto`, `--status`, `--from`, `--step`, `--reset`, `--cleanup`, `--output` flags.
- Worktree management: slugify, create, scan, cleanup with collision handling.
- 310 tests across 21 test files + 4 integration tests.
- Architecture diagrams (C4 levels 1-3) and architecture review for conductor rewrite.
- Phase 2 language evaluation choosing TypeScript over Python/Rust/Go.
- User validation checkpoints after build and manual-test steps in conductor.
- Backward navigation (`b = go back`) from checkpoints and recovery menu with numbered step menu.
- `stale` state marking (⚠) for downstream steps when revisiting earlier phases.
- `step_satisfied()` gate function — stale steps pass prerequisite checks but re-run when reached.
- Story catalog: 5 product epics and 36 feature stories specifying all harness behavior as Given/When/Then acceptance criteria.
- Design doc for pluggable harness architecture (phased rewrite: stories -> language eval -> conductor rewrite -> skill overrides -> UI abstraction).
- Implementation plan for Phase 1 (story catalog review and acceptance).
- Semver tagging system with CI-driven releases on merge to `main`.

### Changed

- `finish` step is now dispatched as an interactive Claude REPL in default
  mode (added to `INTERACTIVE_STEPS` in
  `src/conductor/src/engine/step-runners.ts`), not print mode. The skill
  asks the user to choose between Merge/PR/Keep/Discard; print mode
  silently swallowed that prompt and the conductor wrote `done` against
  no actual outcome. Auto mode still uses print mode and now relies on
  the new completion gate to enforce the result.
- `skills/finish/SKILL.md` requires the chosen option to be recorded:
  `.pipeline/finish-choice` for every outcome, plus `pr_url` written to
  `.pipeline/conduct-state.json` when the choice is "Push & PR". In
  unattended (print/auto) mode, the skill defaults to "Push & PR" rather
  than enumerating options to no-one.
- `README.md` reorganized around a "Choosing a Conductor" section: side-by-side
  comparison of `conduct` (stable bash, default) and `conduct-ts` (TypeScript
  rewrite, opt-in) covering install, CLI parity, dashboard, gates, auto-heal,
  and test coverage. Install section no longer implies the TS build is
  required.
- `bin/conduct` prints a one-time "conduct-ts is installed" heads-up the
  first time it runs on a machine where `conduct-ts` is on PATH, with a
  marker at `~/.ai-conductor/conduct-ts-notice-shown` so it never spams.
  `conduct --help` also now mentions `conduct-ts` at the bottom of its
  examples block. Neither changes default behavior — bash conduct stays
  the default.
- `VERSION` pinned to `0.99.0` to signal the harness is pre-1.0 while the
  TypeScript conductor rewrite stabilizes feature parity (notably the
  `--interactive` flag is still bash-only). CI-cut releases will continue
  on the 0.x line until conductor parity is declared complete.
- `run_manual_test()` now runs in print mode (automated) instead of interactive mode; harness checkpoint provides user review.
- `run_acceptance_specs()` now runs in print mode (automated) instead of interactive mode.
- Recovery menu expanded from `r/i/s/q` to `r/i/b/s/q` with backward navigation option.
- CLAUDE.md now requires Claude to present VERSION bump for user approval before creating a PR.
- `VERSION` and `CHANGELOG.md` as the source of truth for release cadence.
- `.github/workflows/release.yml` — auto-tag, rewrite changelog, bump version,
  create GitHub Release on every merge to `main`.
- `.github/pull_request_template.md` — scaffolds the Changelog + Migration
  sections for PRs against this repo. Does not affect consumer projects.
- `templates/claude-settings.json.template` and new `bootstrap` step 3d —
  bootstrap now emits a `.claude/settings.json` scoped to the project root
  (`Read`/`Edit`/`Write` under the bootstrapped directory, including
  dotfiles) so downstream skills don't block on permission prompts when
  they touch harness artifacts.
- `bin/install` now symlinks `conduct-ts` into `~/.local/bin` alongside
  the bash `conduct` when `src/conductor/dist/index.js` is present.
  `bin/conduct-ts` resolves its own path via `readlink -f` so the
  symlink works, and it honors the conductor-pinned Node version via
  `ASDF_NODEJS_VERSION` (reading `src/conductor/.tool-versions`) so
  users with an older default Node don't hit the `addAbortListener`
  import error from execa.
- Build-step stall circuit breaker + auto-interactive handoff. After a
  completion-gate miss, the conductor compares the resolved-task count
  (`completed` + `skipped` in `.pipeline/task-status.json`) before and
  after the attempt. If two consecutive retries produce zero new
  completions, or if the pipeline skill wrote
  `.pipeline/halt-user-input-required`, the conductor stops retrying,
  emits a `build_stall` event, clears the halt marker, and dispatches
  an interactive Claude REPL for the build step so the user can unblock
  whatever autonomous retry couldn't decide. Re-checks the completion
  predicate once the REPL exits — if passing, step succeeds; if still
  failing, falls into the existing recovery menu.
  Closes the failure mode where Claude's build output contains a
  rhetorical "here are three options, what would you prefer?" question
  that no amount of automated retry could resolve. 14 new tests
  (10 unit in task-progress, 4 integration in conductor).
- `skills/pipeline/SKILL.md` — new "Halt-and-Escalate" section
  documenting the `.pipeline/halt-user-input-required` marker contract.
  Pipeline writes it when it knows it needs user judgement (scope
  mismatch, ambiguous requirement, etc.) rather than guessing via a
  rhetorical output question.
- Additive `build_stall` event on `ConductorEvent` (step, reason:
  `no_task_progress | halt_marker`, resolvedBefore, resolvedAfter).
  `TerminalSubscriber` forwards it.
- Conductor skips already-resolved steps on every run. Steps marked
  `done` or `skipped` in `.pipeline/conduct-state.json` are no longer
  re-dispatched when `conduct-ts` is invoked against a project with
  existing progress (e.g. after a terminal close, a crash, or a fresh
  invocation that skipped `--resume`). Previously the main loop
  iterated ALL_STEPS unconditionally, so a re-invocation without
  `--resume` re-ran `worktree`, `memory`, `brainstorm`, etc. from the
  top even though those steps were already `done`. `failed` steps are
  still re-entered so the recovery flow can continue; `--from <step>`
  still forces a re-run of the targeted step regardless of status.
  Observed in the focus-timer-api test: build failed at 7/21 tasks,
  user re-invoked, conductor restarted at `worktree` — now it skips
  everything and lands back on `build`.
- Pre-flight `ensureClaudeSettings(projectRoot)` at conductor startup.
  Before any Claude dispatch, `conduct-ts` checks for
  `$PROJECT_ROOT/.claude/settings.json`; if absent, it writes one with
  project-scoped Read/Edit/Write rules plus a baseline Bash allow-list
  for harness tooling (`git`, `gh`, `rtk`, `npm`, `npx`, `node`, `mkdir`,
  `touch`, `chmod`, `ln`, `glow`). Solves the chicken-and-egg where
  bootstrap is supposed to write its own permission file (step 3d-i)
  but can't do so without permission to write. Stack-specific tooling
  (bundle, rails, pytest, cargo, go…) is intentionally NOT in the
  baseline — bootstrap adds those per detected stack so dead rules
  don't accumulate. Idempotent — existing files are preserved, so user
  customizations and bootstrap's own generation on a later run remain
  authoritative. 10 unit tests cover create-if-missing /
  never-overwrite / scope-correctness / baseline-Bash-allows /
  no-stack-specific-pollution.
- `INTERACTIVE_STEPS` — conversational steps (`brainstorm`, `stories`,
  `plan`, `architecture_review`, `manual_test`) now open a real Claude
  REPL (positional prompt, no `-p`) instead of one-shot print mode,
  unless the conductor was invoked with `--auto`. The design of these
  skills depends on back-and-forth with the user — one-shot print
  closed the session after a single Claude response, so the user
  couldn't refine scope or iterate. One-shot steps (`complexity`,
  `conflict_check`, `architecture_diagram`, `retro`, `finish`) stay
  print-mode — they generate artifacts from existing context without
  user input. `--auto` still forces print mode for everything so
  unattended runs don't block waiting for `/quit`. New `mode: RunMode`
  option on `StepRunnerOptions`; threaded from `src/index.ts` based on
  `--auto` flag. 12 unit tests covering the REPL dispatch matrix.
- `bootstrap_mode` state field + `mode_skip` event. Bootstrap now persists
  the detected mode (`new` / `fresh` / `partial` / `re-bootstrap`) into
  `.pipeline/conduct-state.json`. When mode is `new` the conductor
  skips `assess` with a `mode_skip` event (the 9 CTO specialists have
  no codebase to evaluate on an empty-directory scaffold). Other modes
  run `assess` normally. Closes the "assess silently loops and fails"
  failure mode observed in the focus-timer-api test run.
- `src/conductor/README.md` — new architectural overview for the
  TypeScript conductor (layout, state machine, events,
  bootstrap-mode-skip, auto-heal, pinned Node, testing pattern).
- `README.md` updated: TypeScript Conductor section, project structure
  includes `src/conductor/`, "What Your Project Gets" includes
  `.claude/settings.json`, lint hook explanation, step count corrected
  from 14 to 16.
- `bootstrap` step 3d-ii — pre-PR lint hook. Bootstrap now detects the
  project's lint command (stack-specific table: npm + tsc, rubocop +
  sorbet, ruff + mypy, clippy, go vet) and writes a `PreToolUse` hook in
  `.claude/settings.json` that runs the command before any
  `gh pr create` invocation. Non-zero exit blocks the PR. Linting is
  now deterministic harness machinery — TDD, pipeline, and code-review
  skills no longer invoke the linter themselves. Users can edit the
  hook command in `.claude/settings.json` at any time; re-running
  bootstrap is idempotent.
- `bin/migrate` — self-configuring migration runner that reads the current
  version from `~/.claude/ai-conductor.config.json`, re-runs
  `bin/install --update`, and executes any `## Migration` bash blocks from the
  changelog entries between the old and new version.
- `bin/install --update` — idempotent refresh path that skips the first-run
  dependency bootstrap and the channel-selection prompt.
- `~/.claude/ai-conductor.config.json` — user-facing config for the update
  channel (`tagged` vs `main`), current version, and auto-check preference.
- `conduct --set-channel {tagged|main}` — switch update channels without
  re-running install.
- Conductor-TS UI abstractions: `UISubscriber`, `UIEventHandler`,
  `DashboardSnapshot`, `RenderPayload`, and `UIPromptHost` in
  `src/conductor/src/ui/types.ts`; `TerminalPromptHost` reference
  implementation in `src/ui/terminal/prompt-host.ts`.
- `buildDashboardSnapshot(...)` pure builder split out from
  `renderDashboardLines`, enabling future non-terminal renderers to
  consume structured data instead of parsing strings.
- `chalk` + `ora` dependencies in `src/conductor/package.json`; colored
  dashboard output and an `ora` countdown spinner on `rate_limit` events.
- Current-step banner (step label + HH:MM:SS start time) on the dashboard
  and a post-step `lastStepTail` pane showing the last N lines of the
  previous step's captured stdout.
- `--view full|focus|log` and `--tail-lines <n>` flags on `bin/conduct-ts`.
- Optional `tail?: string[]` field on `step_completed` events (last 200
  lines of captured output; backwards-compatible additive).

### Changed

- `check_harness_update()` in `bin/conduct` is channel-aware: on the `tagged`
  channel it checks for the latest `vX.Y.Z` git tag, renders the changelog
  block via `glow` before prompting, and calls `bin/migrate` on approval.
- `HARNESS.md` now documents the update flow in a new "Harness Updates" section.
- `CLAUDE.md` (harness-repo-level) documents the new release and update gates.
- Conductor-TS readline prompts (checkpoint, recovery, artifact review,
  complexity, navigation) consolidated behind `TerminalPromptHost` instead
  of being scattered top-level functions in `src/conductor/src/index.ts`.
  `ConductorOptions` shape is unchanged — the engine contract is stable.
- `renderDashboardLines` now delegates through the snapshot builder +
  `formatDashboardSnapshot` formatter. Public signature preserved; string
  output is identical apart from additive color on TTY.
- Dashboard step-started transient line shows the step's display label
  (e.g. `Brainstorm`) instead of the raw step name (`brainstorm`).

### Migration

No migration steps required when upgrading from 0.3.0 — the new update flow
takes effect on the next `conduct` run after this release is installed.

### Fixed

- Conductor-spawned Claude sessions no longer inherit the user's global
  `permissions.defaultMode`. `SessionManager.buildClaudeArgs()` in
  `src/conductor/src/execution/session.ts` now explicitly passes
  `--permission-mode default` for interactive step invocations (which
  previously passed nothing and fell through to whatever the user had
  globally). This was silently breaking interactive steps like
  `/brainstorm`, `/stories`, `/plan` for users whose global
  `~/.claude/settings.json` had `"defaultMode": "plan"` — those sessions
  booted into plan mode and the skill could not write its required
  `.docs/specs/`, `.docs/stories/`, or `.docs/plans/` artifacts. Non-
  interactive invocations are unaffected (they already pass
  `--dangerously-skip-permissions`).
- Feature-level state (manual-test, retro, etc.) no longer bleeds across features in root state file; project-level steps (bootstrap, assess) persist correctly.
- Task progress counter shows correct total from the start (0/10, 1/10) instead of growing denominator (1/1, 2/2).
- `bin/conduct-ts` autonomous Claude invocations no longer print
  `Warning: no stdin data received in 3s, proceeding without it.` — the
  provider now passes `stdin: 'ignore'` to execa on the print-mode path.
- Conductor auto-heals `.pipeline/task-status.json` drift before
  re-invoking the build step. When the completion gate fails with
  "tasks not completed", the engine reconciles each pending task against
  the current branch's git log (commit-message + touched-file match); any
  task with unambiguous prior-run evidence is flipped to "completed"
  in-place and the gate re-checks without a Claude retry. Audit trail
  under `.pipeline/audit-trail/autoheal-*.json`. Runs once per session
  per step; scoped to `build`; silently skips when git is absent.
  Additive `auto_heal` event on `ConductorEvent` for UI visibility.
- `skills/pipeline/SKILL.md` — orchestrator-writes-review.json gate tightened:
  after each batch evaluator returns, the orchestrator must atomically
  `mkdir -p`, write `.pipeline/audit-trail/batch-N/review.json`, and
  stat-check the file before advancing. Missing or empty file is a hard
  halt. Closes the "silently bypassed 4 evaluator gates" failure mode.
- `skills/pipeline/SKILL.md` — Pipeline Entry Guard added: if every task
  is already `completed`/`skipped`, the skill early-exits with a one-line
  progress.log note instead of loading the plan and dispatching work.
  Prevents token burn on crashed-then-resumed sessions that already
  finished.
- `skills/pipeline/SKILL.md` — `.pipeline/summary.json` is now required
  at final-task completion (fields: plan_ref, complexity_tier, autonomy,
  task counts, batch counts, rework cycles, interventions, timestamps,
  first/last commit SHAs). Retro consumes this file instead of
  recomputing stats via an Explore agent.
- `skills/pipeline/SKILL.md` — Evaluator model table added: Medium-tier
  intermediate batch evaluators run on Sonnet (not Opus); only the final
  batch evaluator runs on Opus. Small stays Sonnet-only. Large keeps
  Opus throughout.

### Removed

- Dead Ink/React terminal components and their tests
  (`src/conductor/src/ui/terminal/*.tsx`,
  `src/conductor/test/ui/terminal/*.test.tsx`) — superseded by the
  text-based live-region renderer.
- `ink`, `react`, `ink-testing-library` dependencies from
  `src/conductor/package.json` (`react` peerDeps removed too); the
  `"jsx": "react-jsx"` compiler option is dropped from
  `src/conductor/tsconfig.json`.

---

## [0.3.0] - 2026-04-11

Retroactive entry capturing the state of the harness at the point the
versioned release flow was introduced.

### Added

- Full SDLC skill suite: bootstrap, brainstorm, stories, plan,
  architecture-diagram, architecture-review, writing-system-tests, tdd,
  pipeline, code-review, simplify, debugging, manual-test, finish, pr, retro,
  conduct, assess, conflict-check, memory.
- `bin/conduct` orchestrator with phase detection and gate enforcement.
- `bin/install` with symlink-based skill installation, settings.json
  permission/hook wiring, and dependency bootstrap (glow, rtk, puppeteer MCP).
- Hook suite under `hooks/claude/` for destructive-git blocking, TDD commit
  gating, lint-after-edit, spec/diagram coverage, rate-limit handling, session
  start context loading, and stop-memory reminders.
- `test/test_harness_integrity.sh` validation suite covering bash syntax,
  SKILL.md frontmatter, agent references, cross-skill references, HARNESS.md
  model table, template references, and section numbering.
- `HARNESS.md` as the single source of truth for project-facing behavioral
  rules, consumed by every project using the harness.
