# Conductor (TypeScript)

The TypeScript rewrite of the bash `bin/conduct`. Same CLI surface, richer internals:
typed state machine, event-driven UI, completion-gate checks, engine-side auto-heal for
stale pipeline state, and 545+ tests.

## Layout

```
src/conductor/
├── src/
│   ├── engine/              # State machine, gates, completion checks, auto-heal
│   │   ├── conductor.ts     # The Conductor class — main run loop
│   │   ├── state.ts         # Reads/writes .pipeline/conduct-state.json
│   │   ├── steps.ts         # ALL_STEPS + skip helpers (tier + bootstrap mode)
│   │   ├── artifacts.ts     # Artifact globs + CUSTOM_COMPLETION_PREDICATES
│   │   ├── autoheal.ts      # task-status.json ↔ git log reconciliation
│   │   ├── gates.ts         # checkGate(step|def, state) prerequisites
│   │   ├── gate-verdicts.ts # Gate-loop verdicts → .pipeline/gates/<step>.json
│   │   ├── selector.ts      # selectNextGate — earliest unsatisfied gate
│   │   ├── daemon.ts        # runDaemon — parallel feature worker pool
│   │   ├── daemon-backlog.ts, daemon-runner.ts, daemon-deps.ts  # backlog + per-feature run
│   │   ├── hooks.ts         # Step-boundary hook dispatch
│   │   ├── step-runners.ts  # DefaultStepRunner (Claude provider integration)
│   │   ├── skill-resolver.ts, resolved-config.ts, config.ts, resume.ts, auto-resume.ts
│   ├── execution/
│   │   ├── claude-provider.ts   # execa-based Claude CLI invocation
│   │   ├── llm-provider.ts      # Provider interface
│   │   └── subprocess.ts        # Process management
│   ├── ui/
│   │   ├── events.ts            # ConductorEventEmitter
│   │   ├── subscriber.ts        # TerminalSubscriber (pluggable)
│   │   ├── live-region.ts       # Live dashboard renderer
│   │   ├── dashboard.ts, render.ts, prompt-host.ts
│   │   └── terminal/            # Terminal UI helpers
│   ├── types/
│   │   ├── steps.ts             # StepName, ComplexityTier, StepDefinition
│   │   ├── state.ts             # ConductState, BootstrapMode
│   │   ├── events.ts            # ConductorEvent union
│   │   └── config.ts            # HarnessConfig
│   ├── daemon-cli.ts            # --daemon entry: assembles per-worktree Conductors
│   └── index.ts                 # CLI entry (commander-based)
├── test/                        # vitest suites mirroring src/ layout
├── tsup.config.ts               # Bundle config (node20 target, ESM, dts)
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

## Build + test

```bash
cd src/conductor
npm install
npm run build      # tsup → dist/index.js (+ .d.ts + .map)
npm test           # vitest run
```

The bundle is committed-optional — the root `bin/install` gracefully skips the
`conduct-ts` symlink if `dist/` is missing.

## Key concepts

### State machine

`ALL_STEPS` in `engine/steps.ts` is the canonical ordered list (16 steps across four
phases: UNDERSTAND, DECIDE, SETUP, BUILD, SHIP). `Conductor.run()` resolves the
config-derived registry (`buildStepRegistry(config)` — so YAML **custom steps** run and
are indexed), then walks it: tier-skip → bootstrap-mode-skip → gate → run → verify
completion → recovery.

The **front half** (`worktree`…`acceptance_specs`) is a linear `i++` walk. At `build` it
hands off to the **gate-driven loop** (see below): the *selector*, not the index, chooses
the next step. When `verifyArtifacts` is off the conductor stays fully linear (the gate
loop never engages).

### Gate-driven loop

Once `build` engages, `advanceTail()` drives `build → manual_test → retro → rebase → finish`
by **gate verdicts** instead of a fixed order:

- **Verdicts** — after a gate step runs, its objective verdict is recomputed from on-disk
  evidence (`engine/gate-verdicts.ts`, wrapping `checkGateCompletion`) and persisted to
  `.pipeline/gates/<step>.json` as `{satisfied, reason, checkedAt, kickback?}`. The loop
  owns verdicts; it does not trust an agent's self-report.
- **Selector** (`engine/selector.ts`, `selectNextGate`) — returns the earliest unsatisfied
  gate. A verdict is authoritative over step state; a `stale` step is unsatisfied (must
  re-run).
- **Kickback** — a downstream step can re-open an upstream gate by writing
  `{satisfied:false, kickback.from}` for `plan`/`stories`. `advanceTail` detects it,
  `navigateBack`s (target → pending, downstream → stale), and the selector routes back.
  Capped per gate to prevent ping-pong.
- **Stop** — `.pipeline/DONE` on convergence; `.pipeline/HALT` on the kickback cap or a
  gate selected too many times without satisfying.
- **Hybrid session** — with `freshContextPerStep`, the LLM session is reset before each new
  tail step (Ralph-style; SHIP-phase context never bloats), while a step's own retries
  resume. The front half keeps the persistent session.

The new gate-grade predicates (`plan` = per-path-type story coverage; `stories` = happy +
negative path, no DRAFT) live in `GATE_ONLY_PREDICATES` (`engine/artifacts.ts`), separate
from the linear conductor's completion predicates. See `.docs/decisions/gate-audit-*.md`.

### Rebase-on-latest (before finish)

The `rebase` step is an **engine-native** loopGate (like `complexity` — no Claude dispatch;
the engine runs it in `Conductor.runRebaseStep`, helpers in `engine/rebase.ts`). It runs
after `build`+`manual_test` are satisfied and before `finish`, so a PR is never built on a
stale base:

- **Base discovery** — origin's default branch via `git symbolic-ref refs/remotes/origin/HEAD`
  (fetched), falling back to the **local** base when there's no origin or the fetch fails.
  No literal `main`/`master`.
- **Verdict = branch current with base** — *satisfied ⇔ zero commits in `HEAD..base`*. A
  no-op rebase is the satisfied state, so re-entry after a kickback finds the branch current
  and proceeds to `finish` without re-invalidating (no false `MAX_GATE_SELECTIONS` HALT). A
  genuinely stale branch is never satisfied.
- **Invalidation (code/test only)** — a clean rebase that changed **code/test paths** writes
  `{satisfied:false, kickback:{from:'rebase'}}` for `build` (+`manual_test` if it ran) via the
  existing kickback machinery → the selector routes back to `build`. A **docs-only /
  CHANGELOG-only** change does **not** invalidate.
- **CHANGELOG auto-resolve** — when `CHANGELOG.md` is the **sole** conflict and it's inside
  `## [Unreleased]`, the resolver takes the base's merged entries and re-appends this
  feature's `[Unreleased]` lines (captured `base..HEAD` pre-rebase) exactly once, then
  `git rebase --continue`s. CHANGELOG conflicting alongside any other file, or outside
  `[Unreleased]`, takes the HALT path instead.
- **Conflict → HALT (paused)** — any other / mixed conflict writes `.pipeline/HALT` listing
  the conflicted files and the resume steps, leaves the rebase **paused** (no `--abort`,
  conflict markers intact), does **not** mark the feature processed, and opens **no PR**.
- **Events** — each outcome emits a typed event: `rebase_noop`, `rebase_changed`,
  `rebase_changelog_resolved`, `rebase_conflict_halt` (best-effort; emission failure never
  affects the rebase result).

**Resume a parked rebase:** resolve the conflict in the listed file(s) → `git rebase --continue`
→ `rm .pipeline/HALT` → re-queue. The daemon reuses the existing worktree, finds the rebase a
no-op (branch now current), and converges to the PR. If you clear HALT without finishing the
rebase, the daemon detects the still-stale/in-progress state and re-parks rather than shipping
a half-rebased branch.

### Daemon mode

`conduct-ts --daemon` (`daemon-cli.ts`) drains a backlog of features that already have
human-authored stories **and** plans, running each in its own worktree via the gate loop
and opening a PR on finish:

- `engine/daemon.ts` (`runDaemon`) — parallel worker pool (`--concurrency N`), hard
  ceilings (`--max-items`, `--max-cost`, `--max-runtime`), `once` vs `--continuous`
  idle-poll, and per-feature failure isolation (a thrown feature becomes an `error`
  outcome; the pool survives).
- `engine/daemon-backlog.ts` — eligibility: stories **approved** (`Status: Accepted`,
  not DRAFT) + plan declares a **dependency tree** (`## Task Dependency Graph` or
  per-task `**Dependencies:**`), not yet processed. Ineligible features are skipped with
  a logged reason — the daemon pre-seeds the front half, so eligibility is the only place
  specs are vetted before autonomous build.
- `engine/daemon-runner.ts` — per-feature discipline: done → mark + remove worktree + PR;
  halted/error → keep the worktree for the human. On completion it also emits a engineer
  signal (see below).
- `engine/daemon-deps.ts` — concrete git/fs primitives (worktree add/remove, spec
  materialization into the worktree, `.pipeline/DONE`/`HALT` outcome read).

The daemon consumes specs — it never authors them. `--continuous` idle-polls for new
eligible features, bounded by the ceilings.

### Engineer memory store (Phase 9.1)

On **daemon** feature completion (`done`/`halted`), the runner emits a structured learning
signal + a narrative to a cross-project store at `~/.ai-conductor/engineer/` (override with
`$AI_CONDUCTOR_ENGINEER_DIR`; the dir is auto-created). The store lives outside any repo so
daemon-built repos stay free of retro clutter. `engine/engineer-store.ts` owns it:

- `signals.jsonl` — append-only, **one JSON line per feature-run**. Each line is a
  `EngineerSignal`:
  `{schemaVersion, ts, project, feature, runId, outcome, kickbacks[], halts[],
  retryHotspots[], tokens{input,output,cacheRead,cacheCreation}, durationByStep{},
  narrativeRef?}`. Empty signal categories serialize as `[]`; `narrativeRef` is optional
  (absent when a complexity tier skipped the retro). Fields are assembled from the
  feature's `.pipeline/events.jsonl` (reusing `report-renderer` aggregation) + the
  `FeatureOutcome` — no new loop instrumentation.
- `narratives/<project>/<feature>-<runId>.md` — the narrative, keyed by `runId` so re-runs
  never overwrite a prior one. `done` → a full retro via the LLM provider; `halted` → a
  short halt note (gate + reason, no LLM call).

**Daemon retro redirect (ADR-002 Option A):** under the daemon the in-loop `retro` step is
**skipped** — the emission step owns narrative production into the engineer store instead of
writing `.docs/retros/` into the feature repo. Manual `/conduct` runs are unaffected and
still write repo retros. Emission is **best-effort**: every store error is logged and
swallowed, and the append is a single atomic `O_APPEND` write so concurrent worker
emissions never tear the log. A write failure can never break a ship.

### Events

`ConductorEvent` in `types/events.ts` is a discriminated union of all events the engine
emits. UIs subscribe via `ConductorEventEmitter`. Events include `step_started`,
`step_completed`, `step_failed`, `step_retry`, `checkpoint_reached`, `recovery_needed`,
`rate_limit`, `session_reset`, `auto_heal`, `mode_skip`, `feature_complete`, etc.

Gate-loop events: `gate_verdict` (a gate's verdict was (re)computed), `kickback` (a step
re-opened an upstream gate, with reason + count), `loop_halt` (the loop stopped without
converging), and `loop_converged`. `TerminalRenderer` surfaces them; the json-stdout
subscriber serializes them generically.

The contract is additive — new event types may be introduced without breaking existing
subscribers. Subscribers receive only events they register for via `emitter.on(type, ...)`.

### Bootstrap-mode skip

`state.bootstrap_mode` is set by the `bootstrap` skill to one of `new`, `fresh`,
`partial`, `re-bootstrap`. When `new`, the conductor skips `assess` via
`shouldSkipForBootstrapMode()` — the 9 CTO specialists have nothing to review on a
freshly-scaffolded directory. All other modes run `assess` normally.

### Auto-heal

`engine/autoheal.ts` handles drift between `.pipeline/task-status.json` and the git log
that can accumulate after a crashed pipeline run. Before re-invoking the build step on
a completion-gate retry, the conductor runs auto-heal once per session:

1. Read task-status.json (shape-preserving — either array or id-keyed map).
2. Compute commit range: `git merge-base origin/main HEAD..HEAD` (fallback `HEAD~100`).
3. For each pending task, require both a commit-message match (`T<id>`, `#<id>`, or
   case-insensitive name substring — word-boundary for names <12 chars) AND a file-path
   overlap with the plan's per-task file list.
4. Healed tasks are flipped to `completed` in place; an audit record is written to
   `.pipeline/audit-trail/autoheal-<ISO>.json`.
5. Conductor re-runs `checkStepCompletion`; if passing, proceeds without invoking Claude.

See `engine/autoheal.ts` for the heuristic and `test/engine/conductor.test.ts` for the
six auto-heal test scenarios.

### Pinned Node

`.tool-versions` pins `nodejs 20.19.0`. The bundle targets `node20` — older Node throws
on execa's `addAbortListener` import. `bin/conduct-ts` reads this file and exports
`ASDF_NODEJS_VERSION` so the conductor runs on its required Node even if the user's
shell default is older.

### Project registry (`register` / `create`)

`engine/registry.ts` is the **single writer** for the harness project registry at
`~/.ai-conductor/registry.json` (override with `$AI_CONDUCTOR_REGISTRY`; `resolveRegistryPath`
is injectable, mirroring `engine/user-config.ts`). Per ADR-003 all three entry points
(`conduct register`, `conduct create`, `/bootstrap`) funnel through it so correctness lives in
one place:

- **Atomic writes** — serialize the whole registry to a unique temp sibling, then `rename` over
  the target (POSIX-atomic; readers never see a partial file, concurrency-safe).
- **Canonical-path dedup** — `upsertProject` keys records by `realpath`-canonicalized absolute
  path, so symlinked/relative aliases of the same repo collapse to one record. For a not-yet-
  existing `create` target it canonicalizes the parent then rejoins the leaf.
- **Status provenance** — an upsert never downgrades a `created` record to `registered`.
- **Credential redaction** — `redactRemote` strips `user:token@` from `https://`/`ssh://` URLs
  (scp-form `git@host:path` is left intact — it carries no secret) before any write.
- **Reported failures** — register/create surface a registry write failure as a non-zero exit,
  never swallowed (contrast the engineer store's best-effort emission).
- **Malformed registry** — `readRegistry` returns `[]` for an absent file but **throws** on
  invalid JSON; a corrupt registry is surfaced, not masked as empty.

`engine/registry-cli.ts` holds the two non-interactive handlers, dispatched from `index.ts`
(`detectRegistryCommand`) **before** the interactive pipeline boots:

- `conduct register [path]` (default cwd) — validate the path is an existing git repo (else
  non-zero exit + clear stderr, registry byte-unchanged), derive the record (name=basename,
  absolute path, redacted `git remote get-url origin` if present), upsert with `status: registered`.
- `conduct create <name> [--remote <url>]` — no-clobber guard (a non-empty target writes nothing),
  else `git init` + skeleton `CLAUDE.md` (references HARNESS.md) + `.gitignore` (`.pipeline/`,
  `.daemon/`, `.worktrees/`) + `git remote add origin` when `--remote` is given (add-only, no
  push), upsert with `status: created`.

`ProjectRecord` and the registry **read-side** (`createRegistryReader`) are now consumed by the
engineer supervisor (Phase 9.3, below). See `test/engine/registry.test.ts` and
`test/integration/registry-cli.test.ts`.

### Engineer supervisor mode (`conduct engineer`)

`conduct engineer` (dispatched by `engine/engineer-cli.ts` via `detectEngineerCommand`, **before** the
interactive pipeline boots) is a **non-autonomous** REPL that turns an idea into a routed,
lesson-informed spec PR. It **never builds and never merges** — the structural guarantee is
enforced by `test/engine/engineer/non-autonomy.test.ts` (the engineer source tree imports no
build/pipeline entry point and issues no `gh pr merge`) and by `summary.buildsRun` staying `0`.
The loop body lives in `engine/engineer/loop.ts` (`runEngineerMode(deps)`); `deps` injects the LLM
`provider`, an `io` surface, and a `gh` runner, so the whole flow is testable headless.

Per non-blank idea (each isolated by a per-idea `try/catch`):

1. **Route** — `routeIdea` (`engine/engineer/routing.ts`) ranks registry projects against the idea
   via the provider and returns candidates (or `createSuggested` when nothing fits).
2. **Confirmation gate** (human-in-the-loop, mandatory before any write) — `y`/`yes` confirms the
   current target; `n`/`no`/blank declines with **zero writes** (no branch, no PR, no gh call);
   `redirect <name>` retargets to another registered project (unknown name → re-prompted, no
   invented path); `create <path>` (offered on no-fit) scaffolds + registers a new repo through
   the 9.2 `create` path, then commits the scaffold so it is authorable.
3. **Select lessons** — `selectLessons` (`engine/engineer/lesson-store.ts`) pulls the prior lessons
   relevant to the target from the engineer store and `buildAuthoringPrompt` injects the digest into
   the authoring prompt (no relevant lessons → an explicit empty digest, not unrelated padding).
4. **Author** — `authorSpec` (`engine/engineer/authoring.ts`) creates a `spec/<slug>` branch off the
   **derived** default branch (never hardcoded `main`), writes artifacts under `.docs/` only, and
   commits; a provider failure rolls back HEAD + deletes the dangling branch.
5. **Handoff** — `openSpecPr` (`engine/engineer/handoff.ts`) opens a spec **PR** (`gh pr create`,
   never `merge`) and records the authored-keys ledger. A target with **no remote** is non-fatal:
   the spec stays committed on the branch and the ledger is still recorded so the FR-12 flywheel
   trend counts the feature.

Read-only reporting over the engineer store ships as library functions: `governorReport`
(`engine/engineer/governor.ts`) aggregates spend + kickback/halt/retry rates; `computeFlywheelTrend`
(`engine/engineer/flywheel-trend.ts`) reports `improving` / `insufficient_data` across
engineer-planned features (store ∩ authored-keys ledger). Registry/store paths come from
`$AI_CONDUCTOR_REGISTRY` / `$AI_CONDUCTOR_ENGINEER_DIR`. Acceptance scenarios live in
`test/acceptance/engineer.test.ts`.

## Testing pattern

- **Unit tests** live next to the module under test (e.g. `test/engine/autoheal.test.ts`
  mirrors `src/engine/autoheal.ts`).
- **Integration tests** live under `test/integration/` and drive the Conductor end-to-end
  with mocked runners.
- `execa` is mocked globally per test file via `vi.mock('execa', () => ({ execa: vi.fn() }))`
  where the tested code invokes git or other subprocesses.
- Temp directories: `mkdtemp(join(tmpdir(), 'conductor-<name>-'))` + `rm({ recursive,
  force })` in `afterEach`.

## Baseline

504 passing / 41 failing at the start of the Fix A/B/C + phase-5 UI work. Each commit
preserves or raises the passing count without adding to the failure set (see CHANGELOG
under `[Unreleased]`).
