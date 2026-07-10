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
│   ├── daemon-cli.ts            # `daemon` subcommand entry: assembles per-worktree Conductors
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

The root `bin/install` runs these `npm install && npm run build` steps for you
(in both first-run and `--update` mode) and then symlinks `conduct-ts`. The
commands above are for building by hand. If Node < 20.5 is active or `npm` is
missing, `bin/install` skips the build with a warning and leaves the
`conduct-ts` symlink off until `dist/` exists.

## Daemon Integration (Self-Hosting)

This repository (the harness) is daemon-registered for build-to-PR on self-hosted instances.
When this repo is deployed via the daemon:

- The daemon runs full integration tests in feature-branch worktrees
- `bin/setup` prepares these worktrees: runs `npm install` and `npm run build` in `src/conductor`
- **Important**: `bin/setup` is worktree-local only—it does NOT rebuild the primary checkout.
  If you manually run `bin/setup` in your primary checkout, you will trigger a rebuild.
  For more details, see #215.

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

The `acceptance_specs` gate verifies RED specs exist on disk by matching
`STEP_ARTIFACT_GLOBS.acceptance_specs` (`engine/artifacts.ts`). The built-ins cover Rails,
Node, and `backend/` layouts rooted at the repo root. A repo whose specs live elsewhere —
most often a **monorepo** with specs one package deep (`api/spec/…`,
`frontend/__tests__/…`) — declares extra globs via the project-level
`acceptance_spec_globs` config key; they're *appended* to (never replace) the built-ins, so
the gate can only loosen. A leading `*/` in a glob expands to each immediate subdirectory
(skipping `node_modules`/dot-dirs), so package names need not be hard-coded. Config flows to
the check via `CompletionContext.config`.

### Gate-driven loop

Once `build` engages, `advanceTail()` drives
`build → manual_test → prd_audit → architecture_review_as_built → retro → rebase → finish`
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
- **Stop** — `.pipeline/DONE` on convergence; `.pipeline/HALT` on the kickback cap, a
  gate selected too many times without satisfying, or **any unexpected throw inside the
  loop** (the error is flushed to state and converted to a HALT so a supervising daemon
  classifies it as `halted` — worktree kept, retryable — never `error` with lost state).
  **Terminal-marker guarantee (daemon only):** the daemon classifies a run *solely* by
  these two markers (`daemon-deps.readWorktreeOutcome`), so every daemon exit must leave
  exactly one. A few early `return`s in the loop — a blocked gate (prerequisites
  unsatisfied), a parallel-group gating failure — used to exit with neither, which the
  daemon reported as a bare `error` with a stranded worktree ("loop ended without DONE or
  HALT marker"). `run()` now enforces the invariant structurally rather than per-return:
  the success path writes `DONE` if convergence didn't (e.g. a resume that ran no tail
  step), and a `finally` backstop writes a diagnostic `HALT` if a daemon run reaches it
  with neither marker. Interactive runs (`daemon:false`) are untouched — they legitimately
  exit markerless and the daemon never reads their markers.
- **Fresh session per step** — unconditionally, in all modes and all phases (interactive
  `/conduct` included; each step reads its inputs from committed `.docs/` artifacts, not
  conversational memory), the LLM session is reset before **every** executed step
  (Ralph-style; context never bloats across the loop), while a step's own retries resume
  the same session. The reset also fires before the **first** step, which discards any
  stale session inherited from a **reused worktree** — a kept worktree carries the prior
  run's `session-created`/`conduct-session-id`, and without the reset the first step would
  `--resume` a brand-new id that was never created → "session unavailable (expired or in
  use)". `daemon-cli` additionally sweeps those markers on (re)entry as belt-and-suspenders.

The new gate-grade predicates (`plan` = per-path-type story coverage; `stories` = happy +
negative path, no DRAFT) live in `GATE_ONLY_PREDICATES` (`engine/artifacts.ts`), separate
from the linear conductor's completion predicates. See `.docs/decisions/gate-audit-*.md`.

The two SHIP compliance gates — **`prd_audit`** (shipped impl vs the PRD's `FR-N` requirements)
and **`architecture_review_as_built`** (shipped code vs APPROVED ADRs) — sit between
`manual_test` and `retro`. Both are `loopGate: true`, so they inherit the verdict/selector/
kickback machinery above for free. Their objective verdicts come from
`CUSTOM_COMPLETION_PREDICATES`: `prd_audit` stays unsatisfied while any audit-table row carries a
non-`ALIGNED`, un-`ACCEPTED` `FR-N`; `architecture_review_as_built` is **fail-closed** — it is
satisfied only by an explicit clean `Verdict:` of `APPROVED` or `APPROVED WITH DRIFT NOTES`, and
stays unsatisfied for `BLOCKED`, a missing `Verdict:` line, or any unrecognized verdict (so a
no-ADR / garbled review can't slip through marked `done`). An unsatisfied gate keeps the selector
from reaching `finish`; the skill guidance drives where the rework lands (BUILD vs DECIDE for
prd-audit; human fix vs superseding ADR for as-built).

`architecture_review_as_built` also **skips when `architecture_review` was skipped** — for the
Small tier (both share `skippableForTiers: ['S']`) and, via `skipWhenSkipped: 'architecture_review'`,
whenever the DECIDE-phase review was skipped for any reason (config-disable / `when:`). With no
APPROVED ADRs there is nothing to audit, so running it would only produce a non-clean verdict the
loop could neither pass cleanly nor halt on.

**Agentic remediation (`/remediate`) — all three SHIP gates.** In a **daemon** run
(`mode: 'auto'`, `daemon: true`) a blocking SHIP gate first dispatches the `/remediate`
planner (`Conductor.planRemediation`), which reasons over the gate's gap artifact and writes
`.pipeline/remediation.json` (one disposition per blocking gap). The conductor routes the
autonomous dispositions to the earliest target step (`navigateBack` + a per-gap task hint in
the step's `retryReason`) and HALTs only for `halt` dispositions (`architectural-clarity` /
`product-scope` — the two genuinely-human categories). Rounds are bounded by
`MAX_KICKBACKS_PER_GATE`; an unusable/absent plan falls through to the gate's deterministic
fallback (prd_audit) or the generic HALT. The three entry points and their gap artifacts:

- **`prd_audit`** — `.pipeline/prd-audit.md` (falls back to the gap-class routing below).
- **`finish` verification failure** — `.pipeline/test-failures.md`, written by the finish
  skill when a fresh suite has real (flake-checked) failures; the planner distinguishes
  tests lagging an intentional contract change (update the tests) from real impl bugs.
- **`architecture_review_as_built` BLOCKED** — `.pipeline/architecture-review-as-built.md`.

The finish/as-built hooks matter most on the **technical track**, which skips `prd_audit`
entirely — before them, those gates dead-ended in a `failed in auto mode` HALT even when the
gap was routable.

**Daemon prd-audit fallback routing (gap-class aware).** In an interactive run a blocking
`prd_audit` escalates to the recovery menu, where the human picks where to route. In a daemon
run with no usable `/remediate` plan (or an exhausted remediation budget), the conductor
routes by the audit's `Gap-class` column (`classifyPrdAuditGaps`, `engine/artifacts.ts`):

- **Every blocking row is `impl-gap`** → the daemon owns BUILD, so it *self-heals*: emits a
  `kickback` (`prd_audit → build`), `navigateBack`s to `build`, rebuilds, and re-audits. This is
  bounded by `prdAuditSelfHeals` (cap `MAX_KICKBACKS_PER_GATE`); if the gap still isn't closed it
  writes `.pipeline/HALT` (`impl-gap unresolved after N build attempts`).
- **Any blocking row is a product/plan gap** (`intended-drift`, or an unclassifiable row)
  → closing it needs a human DECIDE amendment the daemon can't run (DECIDE steps are pre-seeded
  `done`), so it HALTs immediately (`product/plan gap needs human DECIDE`).

Re-auditing unchanged code yields the same verdict, so the daemon skips the default per-step
retries for a blocking `prd_audit` and routes straight away.

**Daemon manual-test routing + whitewash guard (#367).** `manual_test` is a **gating** step
(locked — neither a project-local skill override nor a config `disabled` can soften it; both
are rejected). Its completion gate (`engine/artifacts.ts`) requires
`.pipeline/manual-test-results.md` to be fresh for the session and FAIL-free **in its latest
`## Attempt N` section** (sectionless files are scanned whole, back-compat), and enforces
fix evidence: when the gate observes FAIL rows it records the worktree's HEAD sha in
`.pipeline/manual-test-fail-evidence.json` (via the injectable
`CompletionContext.getHeadSha` seam; fail-open when there is no repo), and a later FAIL-free
file is accepted only once HEAD has moved — a PASS rewrite with no new commits is refused
(the "whitewash" that shipped incident PR #364). In a daemon run, a manual_test that
exhausts its retries with recorded FAIL rows is routed deterministically back to `build`
(kickback `manual_test → build`, FAIL rows as the retry hint) — no `/remediate` dispatch,
because a manual FAIL is an implementation gap by definition — bounded by
`manualTestSelfHeals` (cap `MAX_KICKBACKS_PER_GATE`), then HALTs
(`manual-test FAIL unresolved after N build kickback(s)`). A non-FAIL gate miss (missing or
stale results — the skill never recorded properly) carries no bug evidence and HALTs
directly.

### Mermaid diagram rendering (approval gates)

Generated architecture diagrams and DRAFT ADRs are Mermaid-in-Markdown. So the human approves
a *visual* (not raw Mermaid), the artifact-review path renders them:

- **Engine** (`engine/mermaid-renderer.ts`) — `renderDiagramsForFile(file, content, config, deps)`
  extracts the ```mermaid blocks and dispatches on the configured **preset name**: `html`
  (build a self-contained mermaid.js page), `mmdc-png`/`mmdc-svg` (shell out to
  `@mermaid-js/mermaid-cli`), `none`/unknown/unconfigured (skip). Best-effort by contract: it
  never throws, isolates per-diagram failures, HTML-escapes diagram source, and returns a
  `notice` on any skip/failure. Presets + valid modes live in `engine/mermaid-renderer-presets.ts`
  (parallel to `md-viewer-presets.ts`); the config block is `mermaid_renderer.{preset,command,
  args,mode}`, validated in `engine/config.ts` like `markdown_viewer`. For `mmdc-*`, production
  `runMmdc` resolves a Puppeteer config (`mmdcArgs`/`needsNoSandbox` are pure + unit-tested): an
  operator-managed `~/.ai-conductor/puppeteer.json` wins, else in sandbox-hostile environments
  (WSL/root/containers) it writes a transient `--no-sandbox` config (with a discovered Chrome
  `executablePath`), else the default sandboxed launch — without this, Chromium fails to start on
  WSL/containers and diagrams silently degrade to raw Markdown.
- **Gate** — `TerminalPromptHost.reviewArtifacts` shows the raw Markdown first (always-present
  fallback), then, for a file containing a mermaid fence, calls an injected `renderDiagrams`
  hook and logs any returned notice on the host's own channel (TUI-safe). `index.ts` wires the
  hook from the **merged** config (the preset is set user-level by `bin/install`).
- **CLI** — `conduct render-diagrams <file>...` (`engine/render-cli.ts`) renders on demand.
- **Syntax check** — `conduct render-diagrams --check <file>...` parse-checks every Mermaid block
  (via `checkDiagramsForFile`, without opening anything) and **exits non-zero on a syntax error**,
  printing the file/block/parse-error line. Unlike the render path's never-fail approval-gate
  contract, the check DISTINGUISHES an author error (`errors` → fail) from a missing tool
  (`tool-missing` → skip, exit 0), so it's a real authoring-time gate that still no-ops on a
  browser-less CI box. The `architecture-diagram` skill runs it before the approval gate.
- **Opener** — `detectOpenerCommand` resolves per platform (macOS `open`, Linux `xdg-open`,
  WSL `wslview`/`explorer.exe`); `defaultRenderDeps` runs it with a bounded timeout so the
  never-block contract rests on code, not opener behavior.

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
- **Conflict → gated resolution → HALT (paused)** — any other / mixed conflict first triggers
  the **gated conflict-resolution loop** (see below); if the loop is exhausted or disabled,
  the engine writes `.pipeline/HALT` listing the conflicted files and the resume steps, leaves
  the rebase **paused** (no `--abort`, conflict markers intact), does **not** mark the feature
  processed, and opens **no PR**.
- **Events** — each outcome emits a typed event: `rebase_noop`, `rebase_changed`,
  `rebase_changelog_resolved`, `rebase_conflict_halt` (best-effort; emission failure never
  affects the rebase result).

#### Gated conflict resolution

Before HALTing on a non-CHANGELOG conflict, the daemon dispatches the `/rebase` resolution
skill up to `rebase_resolution_attempts` times (config key; default **3**; set to **0** to
disable and restore the previous immediate-HALT behavior). Each attempt lets the skill resolve
the conflicted files and then runs `git rebase --continue`. A resolution is accepted only when
**both** acceptance guards pass:

- **FR-8 (current with base)** — the branch must be genuinely current with the base after the
  rebase (zero commits in `HEAD..base`).
- **FR-9 (commit preservation)** — no feature commits may have been dropped; the pre-rebase
  feature commit list must be present in full after the rebase.

If the resolved rebase **changed code or test paths**, the existing kickback machinery fires —
the verdict is `{satisfied:false, kickback:{from:'rebase'}}` for `build` (and `manual_test` if
it ran) and the selector routes back to `build`, exactly as a clean rebase would. A docs-only
change does not invalidate.

If all attempts are exhausted without an accepted resolution, the engine falls through to the
existing HALT path: `.pipeline/HALT` is written, the rebase is left paused (conflict markers
intact), and no PR is opened.

The **same** gated loop backs the main-advance re-kick *play-forward* rebase
(`resumeRebaseFirst`, FR-12): when a re-kicked feature re-conflicts while rebasing onto the
advanced base, the daemon runs the bounded `/rebase` attempts before parking for a human —
identical to the finish-time step. Previously this path took a single bare rebase attempt and
hard-HALTed on the first conflict (#300).

**Daemon-only.** The gated resolution loop runs only in daemon (`mode: 'auto'`, `daemon: true`)
mode. Interactive `/conduct` runs are unchanged — humans resolve conflicts by hand. The `/rebase`
skill is also manually invokable by an operator (`/rebase`) for conflict resolution outside the
automated loop.

**Config key** (`pipeline.yml` / `.ai-conductor/config.yml`):

```yaml
rebase_resolution_attempts: 3   # default; 0 = disable (immediate HALT on any conflict)
```

**Resume a parked rebase:** resolve the conflict in the listed file(s) → `git rebase --continue`
→ `rm .pipeline/HALT` → re-queue. The daemon reuses the existing worktree, finds the rebase a
no-op (branch now current), and converges to the PR. If you clear HALT without finishing the
rebase, the daemon detects the still-stale/in-progress state and re-parks rather than shipping
a half-rebased branch.

### Rate-Limit Episode Coordinator

The `RateLimitEpisode` coordinator (`engine/rate-limit-episode.ts`) manages coordinated backoff
when the API provider signals rate-limiting. It runs as a **shared singleton** across all N
concurrent feature workers in the daemon, ensuring they wake up together at the provider's
deadline instead of retreating into independent, competing waits.

#### Motivation

When a provider enforces a rate limit:
- **Uncoordinated behavior:** each of N workers waits independently (e.g. 300s fixed), then
  all retry at once → thundering herd → cascading failures.
- **Coordinated behavior:** all workers wait until a shared deadline (parsed from the provider
  message, e.g., "reset at 3:20pm America/New_York"), then resume with staggered jitter so
  they spread out instead of colliding.

#### How it works

**Episode detection and deadline capture** (`engine/recovery.ts`, `engine/conductor.ts`):

- When a step's output signals rate-limiting (HTTP 429, `"rate limit"` / `"usage limit"` /
  `"overloaded"` keywords, or session-limit classification), the provider marks the response
  `rateLimited: true`.
- The conductor extracts the deadline from the provider's message (e.g., Anthropic's
  `retry-reset-at: 3:20pm America/New_York`). The parser is timezone-aware, computing an
  absolute wall-clock deadline in milliseconds since epoch.
- If a `RateLimitEpisode` coordinator is supplied, the deadline is registered: `episode.registerDeadline(deadline)`.

**Dispatch gate** (`engine/daemon-backlog.ts`):

- Before discovery and per-feature dispatch, the daemon checks `episode.isActive()`.
- While active (`now() < deadline`), new dispatch is paused (in-flight work continues).
- Dispatch resumes when `now() >= deadline`.

**Conductor rate-limit wait** (`engine/conductor.ts`):

- When a rate-limited step is detected, the conductor does not retry immediately. Instead,
  if an episode is active, it calls `episode.waitUntilReady()` — an **abortable** async wait.
- The wait computes `delayMs = episode.deadline - now()` and sleeps, but:
  - Respects SIGTERM: the AbortController can be signaled, and the wait resolves with
    `{aborted: true}` (conductor escalates to HALT).
  - Coordinates with jitter: `episode.waitUntilReady()` internally staggers wake-up times so
    all N workers don't resume at exactly the same instant.
  - Deadline-first: if the deadline has already passed by the time the wait is called, it
    returns immediately (no spurious delay).

**Pre-step rate-limit handling** (`engine/conductor.ts`):

- Task 15: When a step is about to run, the conductor checks if a rate-limit episode is
  active AND the deadline has not yet passed.
- If so, the step is skipped and escalated as `rateLimited: true` (prevents a redundant wait
  inside the step).

**HALT recovery from episodes** (`daemon-rekick.ts`):

- When a base-SHA advance triggers a re-kick, the conductor checks whether the halted feature
  was marked by an episode-caused HALT (via `.pipeline/conduct-state.json` or a sentinel).
- If the episode has now cleared (deadline passed), the HALT is cleared and the feature is
  re-kicked — allowing automatic recovery without manual intervention.

**Autonomous restart preservation** (`daemon-cli.ts`):

- The daemon creates `rateLimitEpisode` at startup and threads it through all workers.
- On auto-restart (stale engine detected), the coordinator is re-created fresh, but any
  in-flight `waitUntilReady()` calls in the old workers are already aborted (via
  `onSignal` before the restart fires).

#### Session-limit classification

**Task 12 addition:** The conductor now detects session-limit and usage-limit messages
(beyond the standard HTTP 429) as rate-limited, implementing the PRIMARY fix for the
2026-07-03 incident:

- `isRateLimitError(output)` in `engine/recovery.ts` matches `/(rate limit|429|overloaded|usage limit)/i`.
- This catches subtle responses where the API does not set HTTP 429 but clearly signals
  exhaustion in the message body (e.g., "session limit exceeded").

#### Configuration & lifecycle

- **Coordinator creation:** `create()` in `rate-limit-episode.ts` returns a new episode
  manager (no config needed; deadline and state are runtime-populated).
- **Sharing:** daemon-cli.ts creates one, passes it to all workers via `ConductorOptions.rateLimitEpisode`.
- **Graceful degredation:** if `rateLimitEpisode` is undefined, the conductor behaves as if
  no episode is active (pure fallback to independent waits).
- **Thread-safety:** `registerDeadline`, `isActive`, and `waitUntilReady` are safe for
  concurrent calls from N workers; they use atomic-friendly flag + deadline updates.

#### SIGTERM responsiveness

When the daemon receives SIGTERM:

1. The signal handler calls `episode.abort()`, which signals all registered in-flight
   `waitUntilReady()` AbortControllers (via `conductor.registerRateLimitWait()`).
2. Each worker's wait immediately resolves with `{aborted: true}`.
3. The conductor catches the abort, escalates the current step as a HALT.
4. The daemon drains all in-flight workers, then exits cleanly.

#### Jitter and staggering

`waitUntilReady()` does **not** sleep for the full deadline duration at once. Instead:

- It divides the wait into small windows (e.g., 100ms ticks).
- Each worker adds a small random jitter to its wake-up time (e.g., ±50ms).
- On each tick, it checks `now() >= (deadline + jitter)` and returns when true.
- This ensures that when multiple workers wake up after the deadline, they do so at
  slightly offset times, spreading out the retry load.

#### Modules

- **`engine/rate-limit-episode.ts`** — `RateLimitEpisode` interface + `create()` factory
- **`engine/recovery.ts`** — `isRateLimitError()` classification + output parsing
- **`engine/conductor.ts`** — episode registration, wait integration, pre-step check
- **`daemon-cli.ts`** — episode creation and threading to workers
- **`daemon-rekick.ts`** — episode-caused HALT recovery
- **Test coverage** (`test/engine/rate-limit-episode.test.ts`, etc.)

### Daemon mode

`conduct-ts daemon` (`daemon-cli.ts`) drains a backlog of features that already have
human-authored stories **and** plans, running each in its own worktree via the gate loop
and opening a PR on finish:

- `engine/daemon.ts` (`runDaemon`) — parallel worker pool (`--concurrency N`), hard
  ceilings (`--max-items`, `--max-cost`, `--max-runtime`), `once` vs `--continuous`
  idle-poll, and per-feature failure isolation (a thrown feature becomes an `error`
  outcome; the pool survives).
- `engine/daemon-backlog.ts` — eligibility, sourced from the **local default branch kept
  current with origin between work**. Discovery is local-first: the pool calls `discoverBacklog`
  with `refresh:false` (no fetch) while features are in flight or local queued work remains,
  and only when it is **fully idle with nothing left locally** does it pass `refresh:true` —
  "drained → find more". On that idle refresh, `fastForwardRoot` does a **safe**
  `git merge --ff-only origin/<default>` of the daemon's root checkout (default branch discovered
  via `git symbolic-ref refs/remotes/origin/HEAD`, never hardcoded) — only when the root is on
  the default branch with a clean working tree; otherwise it logs a warning and **skips** (never
  clobbering operator state). Because the fast-forward happens only between work, an in-flight
  build is never advanced onto specs that merged on origin mid-run, and worktree checkouts (separate
  working trees) are never touched. `discoverBacklog` then reads `.docs/plans` + `.docs/stories`
  from `git show <default>:…` on that now-current local branch. This is what makes **merging the
  spec PR the build-ready trigger** (FR-24): a spec the engineer authored but has not landed, or
  one committed only on an unmerged `spec/<slug>` branch, is invisible until it reaches the
  default branch. Each worktree is cut from **`origin/<default>`** (the remote-tracking tip; it
  falls back to the local default branch only when `origin/<default>` is unresolvable — a
  local-only repo never fetched), so a build always starts from the latest *fetched* origin even
  when another process has left the root checkout on a different branch or a detached `HEAD` and
  local `<default>` has gone stale. Because discovery reads the (ancestor-or-equal) local default
  branch, every discovered spec is also present on `origin/<default>`, so the vetted stories+plan
  already physically exist in the worktree — there is **no separate spec-copy/materialization
  step**. `fastForwardRoot`
  degrades gracefully and never throws: no origin, unset `origin/HEAD`, a dirty tree, a failed
  fetch (offline), or a non-fast-forward (divergence) all leave the local branch as-is and the
  poll loop continues. On top of
  feature must have stories **approved** (`Status: Accepted`, not DRAFT — a stories file with
  no status line counts as **not approved**) + a plan that declares a **dependency tree**
  (`## Task Dependency Graph` or per-task `**Dependencies:**`), and not yet be processed.
  The approval token is the single shared `isStoriesApproved` (`engine/artifacts.ts`), also
  enforced at land time by the engineer (`land-spec.ts` / `authoring.ts` reject stories
  lacking `Status: Accepted`) — so a spec can never land in a state the daemon then skips.
  Ineligible features are skipped with a logged reason; because every skip here is for a
  **merged** spec that can never build, the reason is surfaced **once per slug**
  (`.daemon/warned/<slug>` markers) rather than re-logged on every poll tick — the daemon
  pre-seeds the front half, so eligibility is the only place specs are vetted before
  autonomous build.
- `engine/daemon-runner.ts` — per-feature discipline: done → mark + remove worktree + PR;
  halted/error → keep the worktree for the human. On completion it also emits a engineer
  signal (see below).
- `engine/daemon-deps.ts` — concrete git/fs primitives (worktree add/remove off the
  fast-forwarded default branch, `.pipeline/DONE`/`HALT` outcome read).
- `engine/worktree-prepare.ts` — writes `WORKTREE_NAMESPACE` + runs the project's `bin/setup` (see below).
- `engine/daemon-dashboard.ts`, `engine/daemon-sha.ts`, `engine/daemon-rekick.ts` —
  halt-reconciliation: startup dashboard, base-SHA tracking, main-advance re-kick (below).

The daemon consumes specs — it never authors them. `--continuous` idle-polls for new
eligible features, bounded by the ceilings.

#### Owner gate: multi-operator identity partition (`adr-2026-07-01-machine-scoped-operator-identity`)

When multiple operators run daemons on separate machines against **one** repo, each daemon
must build only **its own** specs. The gate (`owner-gate/gate.ts`, `decideSpecGate`) decides
build-vs-skip per merged spec by comparing the spec's committed `Owner:` stamp
(`owner-gate/provenance.ts`) against the resolving daemon's identity. Identity resolution
lives behind the `resolveDaemonOwner` seam (`owner-gate/identity.ts`); a future
`PlatformIdentity` (EKS/OIDC) resolver slots in ahead of it without touching the gate.

- **Machine-scoped identity (D1).** `daemon-cli.ts` resolves the owner via
  `owner-gate/machine-identity.ts` (`makeMachineOwnerResolver`), which reads `spec_owner`
  **only** from the user config (`~/.ai-conductor/config.yml`) → `gh` login → unresolved.
  Project config is never consulted for identity, so a committed `spec_owner` cannot leak one
  operator's identity onto everyone who pulls. Resolved **fresh each pass** (no caching) so a
  reconfigured identity takes effect on the next poll.
- **Anti-leak guard (D2).** `validateConfig(raw, projectRoot, { source: 'project' })`
  **rejects** a `spec_owner` key present in a committed project config (blank or not) — a hard
  config-load error naming the file and the fix. `loadConfig` passes `source: 'project'`;
  `loadMergedConfig` passes `source: 'merged'` so a user-sourced `spec_owner` in the merged
  view is allowed.
- **Fail-closed on unresolved identity (D3).** In `daemon-backlog.ts`, a supplied-but-
  unresolved `daemonOwner` short-circuits discovery: the daemon builds **nothing** and emits a
  single loud, deduped "identity unresolved" notice (reversing the prior fail-open build-all).
  An **absent** `daemonOwner` (gate unwired) still runs legacy discovery unchanged.
- **Loud un-owned skips (D5).** An un-owned merged spec is skipped with a distinct, deduped
  line (`.daemon/warned/<slug>`) that states it is un-owned **and** how to fix it — add an
  `Owner:` marker on the default branch, or grandfather via `owner_gate_cutover`.
- **Grandfather cutover (D6).** `owner_gate_cutover` (project config) builds un-owned specs
  merged before the instant. It is a per-repo policy for repos with an unbuilt backlog and
  **must not** be set on the harness self-host repo (all plans there are already merged, so the
  window would rebuild everything). See the main README → "Operator identity & owner gate".

> The **authoring** side (universal `Owner:` stamping across every DECIDE path and refusing to
> land un-owned specs) is sequenced separately (gated on the engineer-worktree-isolation work);
> this section documents the identity/config/daemon partition only.

#### Gate write-back: owner-gated PR/issue announcement (Tasks 17-21)

An owner-gate skip (D5 above) is loud in the daemon log and the GATED dashboard group, but
neither surfaces on GitHub itself — an operator (or the reporter of an intake issue) who only
watches the PR/issue never learns their spec is gated. `gate-writeback.ts` closes that gap:
every `discover()` pass, for each `kind: 'spec'` `GatedItem`, the daemon (via the single
`onGatedDiscovered` call site in `daemon-cli.ts`) attempts two independent, best-effort
announcements:

- **`announceGatedPr(spec, prUrl, deps)`** — when the spec already has an implementation PR
  open (a prior build attempt that halted before ownership changed underneath it; a spec
  never yet dispatched has no PR and this is a silent no-op), applies the `owner-gated` label
  (creating it repo-wide on first use) and upserts a single marker comment carrying the
  reason, remedy, and other-owner name (when known). The marker comment is located purely by
  the stable `OWNER_GATED_MARKER` string (never by body content), so repeated passes PATCH the
  same comment in place — including across reason transitions (e.g.
  `unowned-indeterminate` → `other-owner`) — rather than ever posting a duplicate. A terminal
  PR state (`MERGED`/`CLOSED`/not found) skips the write-back entirely.
- **`announceGatedIssue(spec, sourceRef, deps)`** — when the spec carries a
  `Source-Ref: owner/repo#N` intake marker, applies the same `owner-gated` label + upserted
  marker comment to the **originating issue**, independent of the PR path (a failure/success
  on one has no bearing on the other). A missing or unparseable `sourceRef` (hand-authored
  spec, or a malformed marker) is a silent no-op — no `gh` call is made.

Both functions are dependency-injected (`runGh` defaults to the production `gh` wrapper) and
never throw: every `gh` failure is caught, optionally logged via `deps.log`, and swallowed —
a write-back failure never blocks or aborts the discovery pass that produced the gated list,
mirroring the `pr-labels.ts`/`build-failure-escalation.ts` seam contract. See
`src/engine/gate-writeback.ts`, `test/engine/gate-writeback.test.ts`, and
`test/acceptance/owner-gate-{pr,issue}-writeback.acceptance.test.ts`.

#### Halt-reconciliation: startup dashboard + main-advance re-kick (ADR-013)

PR #109 made the durable `.pipeline/HALT` marker authoritative at discovery, so a parked
feature stays parked across restarts until a human clears it. Halt-reconciliation adds two
things on top of that, without a parallel dispatch path:

- **Startup inherited-state dashboard (`daemon-dashboard.ts`).** Before any dispatch, the
  daemon scans `.worktrees/*/` (`.pipeline/HALT`, `conduct-state.json`) and the
  `.daemon/processed/` ledger and prints one grouped dashboard to **both** stdout and
  `daemon.log` — five groups with precedence
  **HALTED > PROCESSED > IN-PROGRESS > WAITING > ELIGIBLE** (WAITING lists build-ready specs
  held back by an unresolved dependency — see "Dependency-ordered intake and dispatch" below).
  Each row carries the bits an operator triages on, mined best-effort from the worktree's
  `conduct-state.json` (and the ledger): HALTED (slug + complexity tier + the step it reached
  + first line of the HALT reason + any open PR link), IN-PROGRESS (slug + tier + last
  meaningful step + any open PR link), ELIGIBLE (build-ready slug + tier this scan, neither
  halted nor processed), PROCESSED (count + each shipped slug with its PR link when one was
  persisted). The ledger is JSON (`{ status, prUrl }`); legacy plain-text `shipped` entries
  still parse (no PR). Best-effort: an empty HALT → reason `unknown`, a malformed
  `conduct-state` → step `unknown` (no tier/PR enrichment), a per-worktree fs error is
  skipped — the scan never aborts startup.

- **Base-SHA tracking + re-kick (`daemon-sha.ts`, `daemon-rekick.ts`).** The daemon
  `git rev-parse`s the local default branch (fast-forwarded to origin on idle refresh by
  `fastForwardRoot`, never a hardcoded branch) and persists the last-seen value to **`.daemon/last-base-sha`**
  (empty / garbage / non-40-hex / unreadable → treated as **absent**, never a spurious
  advance). On a **genuine base-SHA advance** — observed live on an idle refresh, or at
  startup versus the persisted value (a base that moved while the daemon was **down**) — it
  runs a **re-kick sweep** over every halted worktree: log the reason → if a 9.0 rebase is
  paused, `git rebase --abort` (a **failed** abort leaves the marker intact, no half-clear) →
  rename `.pipeline/HALT` → **`.pipeline/HALT.cleared`** (reason preserved) → remove
  `.pipeline/HALT` → drop a **`.pipeline/REKICK`** sentinel. The sweep issues **no dispatch**;
  clearing the marker lets PR #109's un-park path re-dispatch the feature on the next poll. A
  per-feature **last-rekick SHA** bounds it (a same-SHA re-halt is not re-kicked again; only a
  further advance re-kicks). **First run** (no persisted SHA) initializes without re-kicking,
  and a plain **restart with no advance** honors every marker exactly as PR #109 does.

- **Resume rebase-first (FR-12).** On re-dispatch, `runConductorInWorktree` sees the
  `.pipeline/REKICK` sentinel and runs 9.0's **rebase-onto-latest first** (reusing
  `engine/rebase.ts`), then deletes the sentinel (one-shot), so the pending gate (e.g.
  `prd_audit`) re-verifies against the **advanced base** rather than the stale one. If the
  rebase re-conflicts on the new base, the feature re-parks via 9.0's existing HALT path
  (bounded by the same last-rekick SHA); residual gaps route through the normal gate loop /
  `/remediate`, not the re-kick code.

#### Content-aware shipped-work dedup (`.docs/shipped/<stem>.md`, #204, #205)

Two bug reports (#204, #205) traced back to the same root cause: `.daemon/processed/` is a
**local, uncommitted** ledger. A fresh clone, a wiped `.daemon/` cache, or a second machine
building the same repo has no memory of what already shipped — so the daemon replayed
already-merged specs (re-dispatching them at discovery, or re-kicking their halted worktrees
on every base-SHA advance).

- **`.docs/shipped/<stem>.md` — the durable dedup authority.** A committed, plain
  frontmatter-only record written to the **base branch**, one per shipped spec:

  ```
  ---
  slug: billing-export
  spec_hash: 9f2c...  # sha256 of the plan (+ stories, if present)
  pr: https://github.com/acme/repo/pull/152
  shipped: 2026-07-01
  ---
  ```

  It is written by the **finish flow**, on the **impl branch**, before merge — `/finish`
  runs `conduct shipped-record --slug <stem> --pr <url|local>` (a non-interactive
  subcommand) on the feature branch before its final push, so the record lands in the same
  PR/merge as the shipped code, not as a separate follow-up (and never as a daemon-side
  commit on the main checkout, which would sit un-pushed on local base and wedge the
  `--ff-only` fast-forward). Because it's committed, it survives clones, resets, and cache
  wipes exactly like the code it documents. A record-write failure degrades gracefully
  (single warn, exit 0) and never blocks shipping; `discard`/`keep` finishes never write one.

- **Discovery dedup (`discoverBacklog`, `daemon-backlog.ts`).** Every poll lists
  `.docs/shipped/*.md` off the **base-branch tree** (one listing per poll, not one per
  candidate) and skips any candidate whose stem matches a committed record. A candidate is
  also skipped when its **content hash** (`specHash` — sha256 of the plan, and stories if
  present, with only a trailing-newline run trimmed) matches a shipped record under a
  **different** stem, catching specs that were renamed after shipping. A record that exists
  only in the working tree (uncommitted) is ignored — only the base branch is authoritative,
  matching the existing FR-24 plan/stories convention. A malformed record (unparseable
  frontmatter) still dedups by stem and logs a warning rather than crashing discovery. A spec
  that is both renamed **and** content-edited after shipping is not caught (documented
  residual — neither stem nor hash matches) and is dispatched normally.

- **Cache demotion: `.daemon/processed/` is now a cache, not the source of truth.** The
  local ledger remains the **fast path** — a marker hit there short-circuits before ever
  touching the shipped-record lookup — but it is no longer required for correctness. When a
  shipped-record match resolves a candidate that has no local marker, the resolver opportunistically
  **repairs** the cache (writes the marker) so the fast path is populated going forward. This
  is what makes the fix survive a fresh clone: **zero** local ledger entries plus **any**
  number of committed shipped records still yields zero re-dispatch.

- **Rekick guard (`rekickSweep`, #205).** The main-advance re-kick sweep now checks the
  same shared `isProcessed` resolver (ledger **or** shipped record) before re-kicking a
  halted worktree. A feature whose spec already shipped is skipped — it no longer goes
  through the abort-rebase / clear-marker / re-dispatch cycle on every subsequent base-SHA
  advance, eliminating the spurious re-kicks #205 reported.

#### Worktree preparation (`WORKTREE_NAMESPACE` + `bin/setup`)

The daemon is **stack-agnostic**: it knows nothing about Docker, Postgres, or Redis. But an
autonomous worktree build still needs its dependencies installed and a database it won't
collide with when two worktrees run concurrently. Worktree creation is the daemon's job, so
the per-worktree *identity* that flows from it is too — and the daemon establishes it in one
place, then defers everything stack-specific to the project's standard setup script:

> After cutting the worktree and **before** building, the runner (1) writes
> `WORKTREE_NAMESPACE=<worktree>` into the worktree's `.env`, then (2) runs the project's
> conventional `bin/setup` with `CI=true` and `WORKTREE_NAMESPACE` exported, if one exists.
> No `bin/setup` → the namespace is still written, then no-op.

`makeRunFeature` calls `deps.prepareWorktree` between `createWorktree` and `runConductor`;
the concrete dep (`worktree-prepare.ts`) runs `bin/setup` with the **worktree as cwd**. The
project's normal config consumes `WORKTREE_NAMESPACE` — e.g. a Rails `database.yml` builds
`app_<env>_<namespace>` and `bin/setup`'s `db:prepare` creates it; there is no second,
daemon-only setup path to drift. `CI=true` lets setup scripts skip interactive steps such as
starting a dev server (`bin/dev` belongs to the later manual-test phase, not the build).

Why reuse `bin/setup` rather than a bespoke daemon script: the daemon runs exactly what a
human / CI runs, so dependency install + DB prepare stay in one idempotent place. A project
that translates the namespace differently (Python, etc.) just does so inside its own
`bin/setup`.

Failure discipline: a non-zero exit from `bin/setup` (or a present-but-non-executable script)
**throws**, which `makeRunFeature` treats like any primitive throw — worktree kept, feature
reported `error` — so the daemon never builds against a half-prepared environment. Projects
that need no setup (a static site, a pure library) simply ship no `bin/setup` and are
untouched. This is what lets one daemon serve **any** project setup, including consumer
projects that use the harness.

#### Daemon mode: false-ship guard (#337)

When running in daemon mode, the engine enforces additional constraints at the finish and done-outcome boundaries to prevent recording false ships (issues #337):

**1. Finish gate push-evidence check** — For PR-choice ships, the finish predicate verifies `HEAD` is an ancestor of `refs/remotes/origin/<branch>` before recording the PR URL. If push evidence is missing or indeterminate, convergence halts.

**2. Daemon finish non-convergence** — Daemon mode rejects `keep`, `merge-local`, and `discard` finish choices (operator decisions) and only proceeds with autonomous `pr` choices.

**3. Done-outcome verification** — A done-outcome is eligible for ship only if `finishChoice === 'pr'` AND `prUrl != null`. Ineligible outcomes (false ships) trigger:
   - Delete any `.pipeline/DONE` marker (conflict resolution: DONE and HALT stay disjoint)
   - Write `.pipeline/HALT` with the contradiction reason
   - Keep the worktree for operator inspection and remediation
   - Best-effort escalation: push the branch and create a draft "needs-remediation" PR

**4. Escalation degradation (FR-7)** — If the escalation push fails (network, auth), the HALT is still written and the worktree still kept; surfacing degrades but protection does not.

**Implementation:** `engine/done-outcome-validation.ts` (`validateDoneOutcome`), wired into the daemon runner (`daemon-runner.ts`) at the point where a feature reaches the `done` state, before any shipped-record write or worktree cleanup. The validation runs independently of the existing PR-labeling mechanism (`needs-remediation` is still written when applicable for debugging, but does not interfere with the core validation). See `.docs/decisions/adr-2026-07-06-daemon-false-ship-guard.md` for design details and requirements.

#### `finish-record` subcommand — fail-closed finish-choice recording

`conduct-ts finish-record --choice <pr|keep> [--pr-url <url>] --pipeline-dir <abs-path>`
is the only supported way to record a finish outcome (the `.pipeline/finish-choice`
marker and, for `pr`, the `pr_url` field in `conduct-state.json`). It replaces
hand-written marker files with a command that verifies its own preconditions and
refuses (exit 1, **no writes**) rather than recording anything it cannot prove:

- `--choice pr` (requires `--pr-url <url>`): verifies the PR named by `--pr-url`
  actually exists (`gh pr view --json url -q .url`) and that `HEAD` has been pushed
  to its upstream tracking branch (the shared push-evidence gate, local git only —
  see the false-ship guard above). Only if **both** checks pass does it
  read-modify-write `conduct-state.json` (adding `pr_url`, preserving unknown
  fields) and then write the `finish-choice` marker — state write is always
  ordered before the marker, which is the commit point.
- `--choice keep` (must **not** be paired with `--pr-url`): writes the
  `finish-choice` marker only; no state file touched, no `gh`/`git` calls.
- `--pipeline-dir <abs-path>` is **required** and must be an absolute path to an
  existing directory — a relative path, or a missing/non-directory path, is
  refused before any `gh`/`git` spawn or filesystem write.
- **Fail-closed refusal semantics:** any gate failure (bad flags, non-absolute or
  missing `--pipeline-dir`, PR-existence check fails, push-evidence check returns
  `false`/`null`/indeterminate, corrupt existing state JSON, or a failed state
  write) exits 1 and performs **zero writes** — never a partial marker with no
  matching state, and never a corrupted state file left half-written.

**Who invokes it:**
- **Daemon auto-mode finish step** — `engine/step-runners.ts` instructs the
  unattended finish dispatch to run `finish-record` (with the worktree's absolute
  `.pipeline` dir) instead of writing the marker by hand; this is the fix for the
  bug where the finish step exited without ever writing
  `.pipeline/finish-choice` in auto mode, permanently stalling the gate.
- **Manual/interactive use** — an operator or the `/finish` skill can run
  `conduct-ts finish-record --choice pr --pr-url <url> --pipeline-dir <abs-path>`
  (or `--choice keep`) directly from the CLI in place of hand-editing the marker.

Implementation: `engine/finish-record-cli.ts` (`detectFinishRecordCommand`,
`dispatchFinishRecord`); wired into the `conduct-ts` entrypoint in `src/index.ts`.

#### Judgement gate at the build → manual_test seam (`build_review`)

`build_review` is an opt-in, objective non-human reviewer verdict that sits strictly between
`build` and `manual_test` in the SHIP-phase gate loop (`build → build_review → manual_test →
retro → rebase → finish`). It exists to catch build-quality issues (regressions, obviously
wrong diffs, missed acceptance criteria) *before* they reach the more expensive manual-test
step, cheaply short-circuiting a bad build rather than letting it burn a manual-test cycle.

**Enabling.** Absent config (or `build_review.enabled: false`) preserves the legacy topology —
`build` feeds `manual_test` directly, and the step does not run. Set `build_review.enabled:
true` in `pipeline.yml` / `.ai-conductor/config.yml` to insert the gate:

```yaml
build_review:
  enabled: true
```

Once opted in, `build_review` is a gating built-in (`ALL_STEPS`): `steps.build_review.disable:
true` is rejected by `validateConfig()` — you cannot silently disable a gate you've already
turned on.

**What it grades.** The grader is a fresh, input-starved one-shot session: it sees only the
diff since the merge-base and the plan being graded against (`build-review-inputs.ts`,
`build-review-prompt.ts`) — no chat history, no prior reasoning to rubber-stamp. It records a
PASS/FAIL verdict to `.pipeline/build-review.json` (`artifacts.ts` →
`BUILD_REVIEW_VERDICT`), validated fail-closed: missing, stale (mtime predates the session),
malformed JSON, or a non-exact-shape verdict are all treated as "gate not satisfied, must
re-run."

**Cap / HALT behavior.** A FAIL verdict kicks back to `build` with the FAIL reasons as evidence
(daemon only), the same anti-ping-pong mechanism used elsewhere in the gate loop. Kickbacks are
capped by the shared `MAX_KICKBACKS_PER_GATE` constant (`conductor.ts`, currently 2) — once
exhausted, the loop HALTs with the unresolved FAIL reasons rather than looping forever or
silently passing the build through. Separately, each `build_review` dispatch attempt itself
gets up to `DEFAULT_STEP_RETRIES.build_review` (3) retries before being reported failed, same
as any other step.

**Cost note.** Because it must be an objective outside opinion rather than the same session
grading its own work, `build_review` always dispatches on the Opus model tier (see the model
selection table in `HARNESS.md`) in a fresh session — it is deliberately not cheap, and enabling
it adds one additional model dispatch per build attempt. Leave it disabled for low-stakes or
cost-sensitive projects; the legacy `build → manual_test` topology is unaffected either way.

#### PR labeling (`needs-remediation` + `mergeable`, daemon-only)

Two GitHub labels give a human operator an at-a-glance signal on the daemon's PRs without
reading logs or opening worktrees.

**`needs-remediation` draft PR (irrecoverable daemon HALT)**

When the gate loop (`conductor.ts`, auto mode) writes `.pipeline/HALT` at **any non-rebase HALT
site** that strands committed work — a build/gating-step failure (retries exhausted), a prd-audit
product/plan gap needing human DECIDE, the kickback-ping-pong or stuck-gate caps, or an unexpected
conductor error — *and* the feature branch has at least one commit, the conductor surfaces a
**draft** PR labeled `needs-remediation` with a comment that includes the HALT reason (which names
the failing step) and the relevant error. The **rebase-conflict HALT is excluded** (rebase is left
paused mid-state). The PR is draft so it cannot be merged accidentally.
If an open PR already exists for the branch it is reused (label + comment applied, no
duplicate opened). The failure comment is **upserted, not appended**: it carries a hidden
marker (`<!-- conductor:needs-remediation -->`) so a feature that HALTs repeatedly edits the
**single** existing remediation comment in place (latest reason replaces the prior one)
rather than piling up duplicates. When the branch has **zero commits** no PR, comment, or label is
produced — the existing local HALT marker is the only surface, unchanged. All GitHub
side-effects are **best-effort and non-blocking**: a push, PR-create, comment, or label
failure is logged and swallowed; the HALT is still written regardless. This behavior is
**distinct** from the engineer intake `needs-manual` ledger state, which tracks intake-issue
re-eligibility and is unrelated to build-failure PR labeling.

When a feature that previously produced a `needs-remediation` PR is later re-dispatched and
reaches `done`, the daemon clears the stale signal: it removes the `needs-remediation` label
and un-drafts the PR (best-effort) before enrolling it in the `mergeable` sweep (FR-16), so
the now-clean PR is not permanently barred from `mergeable` and the label does not lie.

**`mergeable` label sweep (fully-shipped PRs)**

When a feature reaches `done`, its PR is enrolled in a per-repo watch registry
(`.daemon/mergeable-watch.jsonl`). A best-effort sweep — run on daemon startup, after each
feature completes, and on each idle poll tick — evaluates every enrolled PR and keeps the
`mergeable` label in sync with reality:

- **Added** when: the PR is open, has no merge conflicts, and CI is passing (a PR with no
  required checks counts as passing).
- **Removed** when: the PR becomes non-mergeable (new conflicts, CI breaks, or no longer open).
- **Pruned** when: the PR is merged or closed (dropped from the registry, no further activity).

A PR carrying `needs-remediation` is **never** labeled `mergeable`. The sweep is best-effort
and non-blocking: a label-read or apply/remove failure is logged and does not disrupt feature
processing. Because CI typically finishes after the PR is opened, the sweep re-checks over
time rather than making a one-shot determination at PR creation.

#### Auto-resolve conflicts on open watched PRs (`mergeable_autoresolve`)

The `mergeable` sweep (above) only ever *labels* a PR — it never touches its branch. Once a
watched PR drifts from `mergeable` to `CONFLICTING` (the base advanced underneath it), a human
still has to rebase it by hand. `mergeable_autoresolve` closes that gap: it extends the
gated rebase-resolution machinery (`engine/rebase.ts`, used at finish-time — see
"Rebase-on-latest" above) to run against already-shipped, still-open PRs during the same
sweep tick, entirely opt-in and fail-closed at every stage.

**Config** (`MergeableAutoresolveConfig`, `types/config.ts`, validated in `engine/config.ts` →
`validateMergeableAutoresolveBlock`):

```yaml
# pipeline.yml / .ai-conductor/config.yml
mergeable_autoresolve:
  enabled: false          # default: false — opt-in, safe by default
  cooldownMinutes: 60     # default: 60 — minimum gap between resolve attempts per PR
  suiteCommand: ""        # default: unset — no command means the suite gate is a no-op pass
```

Every key is optional; an absent `mergeable_autoresolve` block leaves the feature fully
disabled with zero behavior change to the existing `mergeable` sweep.

**Pipeline** — `sweepMergeableLabels` (`engine/mergeable-sweep.ts`) already re-checks
`mergeable` state (`prMergeState`, `engine/pr-labels.ts`, via `gh pr view --json
state,mergeable,statusCheckRollup,labels`) on daemon startup, after every feature completes,
and on each idle-poll tick. When `mergeable_autoresolve.enabled` is true and a watched PR is
`CONFLICTING`, the sweep dispatches a resolution attempt (`autoresolve.ts`) instead of merely
flipping the label, gated by `cooldownMinutes` so a PR is never re-attempted more often than
configured:

1. **Tier 1 — deterministic resolvers** (`engine/rebase.ts`): narrow, purpose-built resolvers
   for conflict shapes that are safe to resolve mechanically — the CHANGELOG
   `[Unreleased]`-section resolver and a `.docs` keep-both resolver (add/add and rename/rename
   conflicts confined to `.docs/`). These run first because they need no LLM dispatch.
2. **Tier 2 — gated `/rebase` dispatch**: unresolved conflicts fall through to the same
   `/rebase` resolution skill the finish-time gate uses, capped by
   `rebase_resolution_attempts` (default 3, shared with the finish-time gate — see
   "Gated conflict resolution" above). This reuses one resolution engine and one attempt cap
   for both entry points rather than maintaining a second implementation
   (`.docs/decisions/adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep.md`).
3. **Acceptance guards** — before any resolution is accepted, it must pass, in order: the
   rebase state is inactive (no conflict markers / paused rebase left behind), the branch is
   current with its base (zero commits in `HEAD..base`), and every pre-resolution feature
   commit is still present (no dropped commits). Any guard failure escalates immediately —
   no partial or unverified resolution is ever pushed.
4. **Suite gate (fail-closed)** — if `suiteCommand` is configured, it runs via `sh -c` against
   the resolved worktree; a nonzero exit, timeout, or spawn error fails the resolution
   (fail-closed). An unset `suiteCommand` is a no-op pass — the gate never blocks a repo that
   hasn't opted into a verification command.
5. **Lease-protected push + finalization** — only after guards and the suite gate pass does
   the sweep push, using a single `git push --force-with-lease` (no fallback to a plain
   `--force`), so a resolution can never silently clobber someone else's concurrent push to
   the same branch. On a successful push the resolve-attempt counter resets, the last-resolved
   timestamp updates, and the watch registry is rewritten. A process-wide in-flight guard
   serializes resolutions so two ticks can never race the same worktree.

**Escalation.** If any stage fails — guards, the suite gate, or the lease push itself — the
sweep escalates rather than retrying silently: it removes the `mergeable` label, applies a
sticky `needs-remediation` label, and upserts a marker-tagged PR comment naming the stage and
reason. `needs-remediation` blocks further autoresolve attempts on that PR until a human
clears it, mirroring the existing HALT-escalation contract used elsewhere in the daemon (see
"PR labeling" above).

**Safety guarantees:** disabled by default; deterministic resolvers before any LLM dispatch;
capped Tier-2 attempts; three independent acceptance guards; a fail-closed suite gate with no
silent pass-through on error; a lease-protected push that cannot overwrite a concurrent
change; and best-effort, non-blocking escalation on any failure so a bad resolution never
reaches `main` unlabeled.

#### Halt-PR presentation reliability (verify-after-write + reconciliation, ai-conductor#274)

When a daemon feature HALTs irrecoverably, it escalates by opening a **draft PR labeled
`needs-remediation`** so the operator can triage. A halt PR that loses its draft status or
label becomes indistinguishable from a ready feature PR — the #268/#269 root cause.

**Design** (`engine/pr-labels.ts`, `engine/halt-pr-reconciliation.ts`, `adr-2026-07-05-halt-pr-presentation-reliability`):

The feature guarantees halt PRs reliably carry **three durable markers**:

1. **Draft status** (`isDraft: true`) — unpublishable
2. **`needs-remediation` label** — human-scannable signal
3. **Body marker** (`<!-- conductor:needs-remediation -->`) — invisible durable enumeration
   anchor for the reconciliation sweep when label/draft are lost

**`ensureHaltPresentation(runGh, cwd, prUrl, log, sleep)`** (`pr-labels.ts`):

- Single idempotent operation that asserts all three markers are present
- Writes draft status, label, and body marker via existing `gh` primitives
- **Verify-after-write:** re-reads to confirm all three after writing, retries bounded (3 attempts,
  100ms backoff) on mismatch
- On retry exhaustion, returns `'unconfirmed'` without throwing (best-effort contract maintained)
- Label write uses REST endpoint (`gh api .../issues/N/labels`), never `gh pr edit --add-label`
  (Projects-classic sunset, PR #172)
- Idempotent body marker: no duplication on reuse or repeated calls
- Converts already-ready PRs to draft via `gh pr ready --undo` when reused

**`reconcileHaltPrs({projectRoot, log, runGh})`** (`engine/halt-pr-reconciliation.ts`):

- Best-effort background sweep that enumerates **open** PRs and heals broken halt PRs
- Filters to PRs carrying the body marker (`<!-- conductor:needs-remediation -->`)
- For each marked PR missing draft or label, calls `ensureHaltPresentation` to repair it
- Skips unmarked PRs (never converts ready feature PRs to draft or labels them)
- Idempotent: skips conforming marked PRs (no writes), retries non-conforming PRs on next tick
- Never throws; errors logged but never re-thrown
- Wired into **daemon startup and each idle poll tick** (injected dep hook, ADR-013 pattern)

**Finish cleanup** (`daemon-runner.ts`, `halt-pr-rehabilitation.ts`):

- When a halt PR is successfully remediated and finished (reaches `done`), cleanup runs
  verify-after-write removal of all three markers
- `cleanupHaltPresentation()` removes `needs-remediation` label, converts to ready, strips
  body marker, then re-reads to confirm all gone
- Label removal and ready-conversion include bounded retry (3 attempts, 100ms backoff)
- Returns `'confirmed'` if all three markers verified gone, `'partial'` if any residuals
- Body marker removal is critical: once stripped, `reconcileHaltPrs` will no longer enumerate
  the PR, so it cannot be re-halted by the sweep

**Confluence:**

- **Verify-after-write on escalation** catches most transient failures inline
- **Reconciliation sweep** heals PRs broken before this code shipped (e.g. #268/#269 pre-existing
  PRs) or drifted by concurrent checkouts
- **Finish cleanup** removes all markers so finished PRs exit the halt state permanently
- Together: a halt PR cannot present as mergeable; pre-existing broken PRs self-heal; the
  two mechanisms cover each other's failure modes

All operations are **best-effort, non-throwing**, and sit behind the injected `GhRunner` seam
so they are fully unit-testable with the existing `makeFakeGh` pattern.

### Model availability fallback ladder (`engine/model-availability.ts`, #186)

Steps and skills are pinned to a preferred model (e.g. Fable for `rebase`, `remediate`,
`debugging`). `step-runners.ts` resolves each step's model through a `ModelAvailability`
instance before invoking the Claude provider; if the pinned/configured model is detected
unavailable, `ModelAvailability` walks a fallback ladder and retries the next model down
instead of failing the step outright.

- **`DEFAULT_MODEL_FALLBACK_LADDER`** (`engine/model-availability.ts`):
  `["fable", "opus", "sonnet"]`.
- **Config:** `model_fallback_ladder` — an optional top-level array of model names in
  `HarnessConfig` (`types/config.ts`), validated in `config.ts` (must be an array of
  non-empty strings). Passed into `ModelAvailability`'s constructor by `step-runners.ts`;
  `undefined` falls back to the default ladder, `[]` disables fallback.
- **Matching:** exact string match against the configured/pinned model name — no fuzzy or
  prefix matching.
- **Caching / restart semantics:** "known unavailable" models are recorded in-memory for
  the lifetime of the `ModelAvailability` instance (i.e. per daemon/conductor process).
  Restarting the daemon clears this state, so the next run retries the top of the ladder
  even for a model that was previously marked unavailable.
- **Override interaction:** an explicit `--model` CLI flag or `steps.<step>.model` config
  entry still takes precedence over the pinned default, but the override itself is passed
  through the same availability check and falls back down the ladder if it, too, is
  unavailable.
- **Logging:** every downgrade is written via the runner's warn callback as
  `Downgraded from <configured> to <fallback>: <reason>`, visible in conductor logs —
  check there when a step unexpectedly ran on a different model than configured.

### Daemon hosting, management & observability (tmux Supervisor — `adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting`)

The daemon is hosted as a **foreground process inside a per-repo tmux session**
(`cc-daemon-<slug>`, `engine/daemon-tmux.ts`) behind a swappable **Supervisor port**
(`start/stop/restart/attach/logs/exec/isUp`; tmux adapter now, a kubectl adapter later with
no execution-core change). The session owns an attachable PTY, so a *running* daemon can be
watched, debugged, and restarted on demand — in color. Management verbs
(`engine/daemon-supervisor-cli.ts`, dispatched in `index.ts` **before** the `daemon` run
command; `detectDaemonCommand` yields when argv[3] is a management verb so none mis-launches
a run):

- **`conduct-ts daemon start`** — idempotent: `hasSession?` no-op : `tmux new-session -d
  'conduct-ts daemon --continuous'`. Replaces the old detached `launchDaemonDetached` spawn
  (the daemon-supervisor ADR supersedes ADR-005's spawn mechanism; non-management intent preserved).
- **`stop`** / **`restart`** — `kill-session` / kill-then-start.
- **`connect`** — `attach -r` (read-only live colored watch); **`debug`** — full attach.

The daemon still tees its log sink into an append-only **`.daemon/daemon.log`**
(`engine/daemon-log.ts`, opened once the per-repo pidfile lock is held) — so the full BUILD
narrative (feature start, each gate-loop step result, finish + PR url) survives even when no
one is attached. Every persisted line is prefixed with an ISO-8601 UTC timestamp
(`formatDaemonLogLine`) so the record is sortable and greppable by time; the live tmux
console keeps the plain colored line. The log is size-capped (~1 MB, rotated once to
`daemon.log.1`). The daemon
runs **serially** (concurrency clamped to 1) and **bare-run**: the build path never imports
the tmux layer, so it functions with no tmux present (management is purely additive).

Two **read-only** observability sub-subcommands of `daemon` (`engine/daemon-observe-cli.ts`,
dispatched before the pipeline boots) surface state without attaching:

- **`conduct-ts daemon status`** — iterate the project registry and, for each repo,
  report pidfile liveness via the `daemon-lock.ts` primitives (`readPidRecord` + `isLive`):
  `running` (owner alive), `stale` (owner dead — reclaimable), `stopped` (no pidfile),
  plus pid, start time, the last log line, and **tmux session up/down** (via `hasSession`,
  independent of pidfile liveness — so a stale pidfile with a live orphaned session is
  distinguishable). A registered path that no longer exists is reported as `path missing`;
  a single bad repo never aborts the sweep.
- **`conduct-ts daemon logs [--repo <path>] [--follow] [--all]`** — print (or `--follow`,
  `tail -f` semantics) `.daemon/daemon.log` for one repo (default: cwd) or every registered
  repo (`--all`). A missing log prints a friendly note rather than erroring.

**Kickback and operator-back lines (`renderDaemonEvent`, `daemon-cli.ts`).** Two step-loop
events get their own prominent, non-dimmed line format so an operator scanning the log (live
or persisted) can spot a re-open without reading every step line:

- **`↩ KICKBACK: <from> re-opened <to>[ — <evidence>] (×<count>)`** — bold yellow, no leading
  dim `·` chrome dot. Emitted whenever a downstream step re-opens an upstream gate — including
  **front-half amendment kickbacks** (a DECIDE-phase re-open, e.g. stories/plan sending work
  back to explore/prd), which now emit this line and count toward `<count>` just like tail
  kickbacks. `KICKBACK` (uppercase) is a stable grep anchor —
  `grep KICKBACK .daemon/daemon.log` finds every re-open regardless of which gate fired it.
  The `(×<count>)` suffix is never dimmed, since it's the signal for how close a gate is to
  `MAX_KICKBACKS_PER_GATE` (the loop halts once a gate is re-opened past the cap).
- **`↰ BACK: <from> → <to> (operator)`** — yellow. Emitted when an operator manually navigates
  a feature backward (`navigation_back`), as opposed to an automatic kickback.
- **`✋ loop halted: <reason>`** — red, existing line — printed on `loop_halt`, e.g. once a
  gate's kickback count exceeds the cap.

See `test/engine/daemon-log.test.ts` and `test/engine/daemon-observe-cli.test.ts`. The
pidfile path and the O_EXCL create flag stay confined to `daemon-lock.ts`
(`test/engine/daemon-lock-boundary.test.ts`); the log module reuses the exported
`daemonDir()` and never re-encodes the pidfile.

### Daemon lifecycle controls: pause, resume, restart (adr-2026-07-04-durable-pause-marker / adr-2026-07-04-respawn-in-place-restart)

#### Remain-on-exit semantics

When a tmux session is created for the daemon, **remain-on-exit is armed** via `setRemainOnExit` on
the pane. This ensures that when the daemon process exits naturally (or is killed), the tmux pane
survives with the exit status and logs visible. An operator watching a connected daemon stays
connected through restart and can observe the output. This is critical for observability — the
pane becomes a durable record of the daemon's lifecycle and any exit reason.

Remain-on-exit is **armed unconditionally at session creation** — it applies to every restart
scenario: manual operator restart (`restart`), queued-restart-at-idle (`RESTART-PENDING` marker),
and stale-engine auto-restart. The goal is to ensure that whether the daemon exits cleanly or
crashes, an operator with an attached PTY sees it happen rather than being mysteriously
disconnected.

#### Respawn-in-place stale-engine flow

When the daemon (or an external monitor) detects that `dist/index.js` has changed (stale engine),
the daemon writes a `.daemon/RESTART_PENDING` marker (underscore, stale-engine marker — distinct
from the CLI restart queue marker `.daemon/RESTART-PENDING` which uses hyphen) with engine
identity metadata and exits cleanly at the next idle point (before dispatching a new feature).
The marker carries two engine identities: the identity when the restart was requested, and the
target identity (the engine being transitioned to). It also records `reason`, `fromIdentity`,
`targetIdentity`, and `at` timestamp.

On restart, the daemon's startup handshake (`initStaleEngineState`, `stale-engine-init.ts`):
1. Captures the fresh engine identity (sha256 of `dist/index.js`)
2. Logs `ARMED` (if auto-restart is enabled and self-host mode is active) or `DISARMED`
3. If a `RESTART_PENDING` marker is present:
   - Logs the transition: "restarted for engine refresh — from `<old>` to `<target>`, fresh `<current>`"
   - Detects non-convergence when fresh identity differs from the target (e.g., a rebuild didn't
     finish), records a suppression, and prevents restart loops
4. Clears the marker before dispatch so the backlog scan observes clean state

**Headless fallback**: When the daemon runs in headless mode (bare-run, no tmux), the stale-engine
flow operates identically — the daemon exits with code 0 on the stale verdict, and an external
respawn mechanism (supervisor, systemd, etc.) relaunches it with the fresh engine. The marker
persists on disk, so the fresh restart consumes it and completes the handshake.

#### Relink-before-handoff

Every daemon restart entry point — manual `restart`, queued restart at idle, or stale-engine
respawn — runs a skill-relink preflight (`relinkSkillsForSelfBuild`, `install-freshness.ts`) in
self-host mode **before any dispatch** occurs. This ensures skills are fresh on every restart,
catching any edits to the harness that landed on main while the daemon was running. The relink
failure (e.g., installer missing) aborts the build with an `InstallStaleError` and HALTs rather
than proceeding with stale skills.

#### Pause/resume

Operators can quiesce daemons before maintenance or upgrades without losing state. Pause writes a
durable `.daemon/PAUSED` marker; the daemon's loop checks it before the dispatch boundary
(`maybeDispatch`), so no new work starts while in-flight work finishes normally. Resume removes
the marker. Both operations work per-repo or fleet-wide (`--all`) with per-repo outcome reporting.
Pause is **reentrant** (pausing an already-paused repo is a no-op); resume does the same. Pause
**persists across daemon restarts** — a stopped daemon starting up in a paused repo comes up
paused. Automation (`ensureRunning`) never bypasses pause. The status surface (`daemon-observe-cli.ts`)
shows pause state (running / paused / stopped / stale) and timestamp/operator who paused.

#### Restart (manual and queued)

**Manual restart** (`daemon-supervisor-cli.ts`, `engine/daemon-tmux.ts`) — safe in-place restart
preserves the daemon's tmux **session**, **window layout**, and any **operator windows** the
operator may have opened. Implementation: `setRemainOnExit` arms the pane (documented above);
`respawn-pane -k` kills the existing process and re-runs the daemon command in the same pane.
Unlike the old kill-session + new-session, an operator watching a connected daemon stays
connected through restart. Restart respects **pause state** — restarting a paused daemon queues
the restart instead of firing immediately.

**CLI restart flow** — when a restart is requested against a busy daemon (in-flight features),
the restart cannot interrupt, so it queues durably by writing a `.daemon/RESTART-PENDING`
marker (hyphen, CLI queue marker — distinct from the stale-engine marker `.daemon/RESTART_PENDING`
which uses underscore). The marker carries the restart reason and optional metadata (`requestedBy`,
`blockingSlug`). The daemon polls the marker and fires the restart at the next idle point
(after in-flight work drains). This **prevents restart storms** — multiple writes coalesce into
one fire — and **survives daemon crashes** — a crash before firing leaves the marker on disk to
be consumed at the next boot.

**Consume-once restart queuing** (`engine/restart-marker.ts`) — when a daemon starts up with
a pending-restart marker (`.daemon/RESTART-PENDING`, hyphen format), it consumes the marker
(won't fire again) and clears it. If the daemon is idle at boot, the restart fires as its
final act: in supervisor mode, the supervisor sees the restart signal and respawns via tmux;
in bare-run mode, a clean exit (code 0) signals the external respawn mechanism. In both cases,
the restart relinks skills preflight before the respawn, ensuring skills are fresh.

**Engine version pinning and safe rebuilds** — each daemon pins its engine version at startup
(stores the pinned `engineDir` in the pidfile). Rebuilding or upgrading the shared engine does
**not crash running daemons** — they continue on their pinned version until restart. On restart,
the daemon adopts the newest installed version. This closes issue #215 (rebuilding the shared
engine while daemons run was hazardous). Versioned engine store (`engine/engine-store.ts`)
manages versions durably: `dist-versions/<id>/` for each version, a `dist` symlink targeting
current, and garbage collection (four-condition fail-closed: not current ∧ no live pidfile
referencing it ∧ older than min-age ∧ outside keep-last-K, and any registry error stops **all**
deletion). The status surface shows which version each daemon is running.

**Build flow change** — `npm run build` now uses a wrapper (`scripts/publish-engine.mjs`)
instead of raw `tsup`. The wrapper stages the build, finalizes to the store, atomically flips
the `dist` symlink, and runs GC. Raw `tsup` invocations are guarded and refused (caught in the
wrapper, which errors loudly with remediation guidance). First build post-upgrade migrates an
existing `dist/` directory into the store (one-time, automatic). See the Migration section in
`CHANGELOG.md` for upgrade instructions.

**Daemon self-termination on missing repo root** (`engine/daemon.ts`) — the daemon checks at the 
start of each loop iteration whether its repo root has been deleted (e.g., a worktree removed out 
from under it). On definitive absence (`repoRootMissing()` predicate confirms the path is gone), 
the daemon logs the missing path, sets the stop reason to `repo_root_missing`, and cleanly exits 
after draining any in-flight workers to completion. This enables safe cleanup when the underlying 
repository has been removed without leaving the daemon process orphaned. See `engine/daemon-deps.ts` 
for the concrete implementation.

**Deep-seam tmux guard** (`engine/daemon-tmux.ts`, `defaultTmuxRunner`) — during testing, the 
default tmux runner checks the `AI_CONDUCTOR_NO_REAL_EXEC` kill-switch environment variable before 
creating a real tmux daemon session. When the kill-switch is set and a `new-session` call targets 
a daemon session name (starts with `SESSION_PREFIX`), the runner throws an error instead of 
executing the command. This prevents tests from leaking real tmux daemon sessions into the system 
that outlive the test suite. The kill-switch is set globally by the vitest setup for all conductor 
tests, ensuring test isolation without requiring custom injection in every test.

Key modules:
- `engine/pause-marker.ts` — `isPaused`, `writePauseMarker`, `removePauseMarker`
- `engine/restart-marker.ts` — `readRestartPending`, `writeRestartPending`, `consumeOnBoot`
- `engine/engine-store.ts` — `currentTarget`, `listVersions`, `flipCurrent`, `gcVersions`
- `scripts/publish-engine.mjs` — build wrapper and store management
- `test/engine/daemon-pause*.test.ts`, `daemon-restart*.test.ts`, `engine-store*.test.ts` —
  integration tests verifying isolation, ordering, durability

### Operator park / unpark

**`conduct daemon park <slug>`** / **`conduct daemon unpark <slug>`** (`engine/daemon-park-cli.ts`,
`engine/park-marker.ts`) — a human-placed halt an operator can apply to a single slug without
stopping the daemon. Parking writes `.daemon/parked/<slug>` (idempotent — parking an
already-parked slug reports "already parked" and leaves the marker untouched); unparking removes
it. Both verbs act directly on the filesystem before the pipeline/daemon boots, mirroring
`daemon-observe-cli.ts`'s detect/dispatch pattern.

`daemon park <slug>` validates the slug against known units of work first: it requires either
`.docs/plans/<slug>.md` or `.worktrees/<slug>` to exist, so a typo'd or stale slug fails loudly
(`error: slug '<slug>' not found in plans/ or worktrees/`) instead of silently parking nothing.

**Operator-parked vs. HALTed — these are different states.** A HALT (`.pipeline/HALT`) is written
by the pipeline itself on a kickback cap, an unresolvable gate, or an unexpected throw — it's a
pipeline-detected stop that the daemon reports as `halted` and retries automatically. An
operator-park is placed *by a human*, independent of pipeline state, and is never cleared by the
pipeline or by resolving a HALT: clearing a HALT does not unpark a slug, and parking a slug does
not touch its HALT marker. While parked, the daemon treats the slug as ineligible for both
**dispatch** (no new BUILD/SHIP work starts) and **re-kick** (a parked slug's REKICK sentinel is
preserved untouched, so unparking resumes re-dispatch exactly where re-kick would have left it).

The status dashboard's **PARKED** group (`engine/daemon-dashboard.ts`) has **absolute precedence**
over every other group: it renders first, and any slug present there is excluded from HALTED,
IN-PROGRESS, PROCESSED, WAITING, and ELIGIBLE — even if the slug would otherwise qualify for one
of those groups. `listOperatorParkedSlugs` also surfaces a *stale* park (a marker left for a slug
with no worktree and no backlog entry) that would otherwise be invisible to every other scan.

### Pluggable memory provider (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration/adr-2026-06-29-per-project-memory-provider-selection/adr-2026-06-29-shared-memory-store-placement-and-durability)

The `memory_provider` config field selects which provider backs `.memory/`.

```yaml
# .ai-conductor/config.yml
memory_provider: local    # default — no install needed
```

**Built-in `local` provider:** The harness creates a durable, per-project canonical store at
`~/.ai-conductor/memory/<key>/harness/` and symlinks `.memory/` in the project to it (adr-2026-06-29-shared-memory-store-placement-and-durability).
The `<key>` is derived from the git origin URL (or common `.git` dir path), so all linked
worktrees of the same project share one memory store and sibling-worktree writes are
immediately visible across branches.

**Store layout:**

```
~/.ai-conductor/memory/<key>/harness/
  decisions/      # architectural decisions
  patterns/       # discovered code patterns
  gotchas/        # unexpected issues and gotchas
  context/        # domain knowledge and context
  index.md        # append-only recall entry point
```

`.memory/` in the project repo is a symlink to this directory.

**Recall model (FR-3 invariant):** the harness contains NO embedding, vector-search,
cosine-similarity, or relevance-ranking logic. Recall is always performed by the LLM
agent reading `.memory/index.md` and the relevant category files, then judging relevance.
This guarantees the memory subsystem works with zero services, zero network, zero credentials.

**Bootstrap setup:** `bin/conduct` calls `conduct-ts memory setup <dir>` before any
bootstrap Claude sub-step. If `.memory/` is a real directory (legacy), `migrateMemory`
runs the copy-verify-swap (adr-2026-06-29-safe-reversible-memory-migration); otherwise `ensureMemoryStore` creates the canonical
store idempotently. Future non-default providers integrate as MCP servers queried directly
by the agent — the harness wires the provider selection but never searches on the agent's
behalf.

Key modules:
- `engine/memory-store.ts` — `projectKey`, `ensureMemoryStore`, `recordMemoryEntry`
- `engine/memory-migrate.ts` — `migrateMemory` (safe copy-verify-swap)
- `engine/local-memory-provider.ts` — `LocalMemoryProvider` plugin object
- `engine/memory-cli.ts` — `conduct memory setup` subcommand
- `engine/config.ts` → `resolveMemoryProvider` — run-start provider resolution (adr-2026-06-29-per-project-memory-provider-selection)

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

### OpenTelemetry exporter (ADR-014)

The conductor ships an optional OTel observability layer. When the `otel:` block is present
in the project config, `OtelVisualizer` (`engine/otel/otel-visualizer.ts`) attaches to the
event bus and exports traces and metrics to an OTel-compatible backend.

#### Config (`pipeline.yml` / `harness-config.ts` `otel:` key)

```yaml
# OTLP HTTP export (default port 4318):
otel:
  exporter: otlp
  endpoint: http://localhost:4318

# OTLP gRPC export (port 4317):
otel:
  exporter: otlp
  endpoint: http://localhost:4317
  protocol: grpc

# File export — writes OTLP-JSON newline-delimited to .pipeline/otel.jsonl:
otel:
  exporter: file
  # file: .pipeline/otel.jsonl  # default; override if needed
```

Absent `otel:` block → disabled, zero overhead. The exporter coexists with `events.jsonl`
and `--report`; no event-emission sites are modified.

#### What is exported

- **Traces** (`engine/otel/span-manager.ts`): one root span `conductor.run` per run, with
  one child span per executed step. Steps carry `conductor.step`, `conductor.step.index`,
  `conductor.step.status`, and `conductor.retry.count` attributes. Retries, gate verdicts, and
  kickbacks are recorded as span events. Interrupted runs force-close open spans as ERROR
  with `conductor.incomplete=true` (FR-9).
- **Metrics** (`engine/otel/metrics.ts`):
  - `conductor.step.duration` — Histogram (ms per step, always recorded)
  - `conductor.step.retries` — Counter (only when retryCount > 0)
  - `conductor.step.tokens` — Counter by kind (`input`/`output`/…; only when tokenUsage
    present; no zero-fill for steps without usage)
- **Resource attributes** (`engine/otel/resource.ts`): `conductor.run.id` (from
  `.pipeline/conduct-session-id` or a fresh UUID), `conductor.feature`, `conductor.project`,
  `service.name=ai-conductor`.

#### Error isolation (FR-8)

Export failures emit **at most one** warning via the `onWarning` callback and never affect
the run. A non-responding endpoint is abandoned after `exportTimeoutMillis` (default 5 s).
SIGINT/SIGTERM handlers trigger a best-effort flush within this bound.

#### Implementation files

| File | Responsibility |
|---|---|
| `engine/otel/otel-config.ts` | Parse + validate `otel:` config block |
| `engine/otel/otel-visualizer.ts` | Root plugin: wires emitter → span/metric pipeline |
| `engine/otel/span-manager.ts` | Run/step span lifecycle |
| `engine/otel/metrics.ts` | Duration/retry/token metrics |
| `engine/otel/transport.ts` | OTLP HTTP, gRPC, and file exporters |
| `engine/otel/resource.ts` | OTel Resource with conductor attributes |

Tests: `test/engine/otel/`, `test/integration/otel-observability.test.ts`,
`test/integration/otel-exporter.test.ts`, `test/integration/otel-disabled-noop.test.ts`.

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

### Main-checkout leak triage and auto-heal

When the daemon's base-tracking fast-forward (`maybeFastForward` in `daemon-backlog.ts`)
discovers a dirty working tree in the main checkout, before giving up it now runs **leak triage**
to classify every dirty entry and attempt deterministic auto-heal. The triage phase:

1. **Classify dirty state:** Parse `git status --porcelain` to extract modified tracked files,
   staged changes, and untracked strays.
2. **Enumerate candidate branches:** Prioritize candidate heads — local branches with daemon
   worktrees (`.worktrees/<slug>`), then local `feat/*` heads — to explain the dirty state.
3. **Byte-identity matching:** For each candidate, check whether the dirty entry's working-tree
   content is byte-identical to the same path's blob in that candidate's tree (tracked files
   via `git cat-file`, untracked strays via content hash).
4. **All-or-nothing heal gate:** If a SINGLE candidate explains EVERY dirty entry AND the
   index has no staged changes, auto-heal runs:
   - Restore modified tracked files via `git restore`
   - Delete untracked strays
   - Log one loud WARN naming the culprit branch and each healed path
   - Proceed with the same poll's fast-forward
5. **Unexplained dirty state escalation:** If no candidate explains everything, escalate from
   a one-line skip to a loud LEAK-SUSPECT WARN with per-file diff-stat, logged once per unique
   fingerprint (prevent spam across polls). Never heal ambiguous state.

**Safety model:** Byte-identity to a known branch proves the content already exists in git, so
restore loses nothing. Operator work is protected: the all-or-nothing gate means any ambiguity
keeps hands off the tree. The deterministic half (classification + identity check) is fully
testable and safe to automate.

**Modules:** `engine/leak-triage.ts` (classification + fingerprinting + heal planning),
`engine/daemon-backlog.ts` (wiring in `maybeFastForward`), test coverage in
`test/engine/leak-triage.test.ts`.

### Write-fence sandbox for self-host builds

When a self-host daemon build runs against a throwaway sandbox `CLAUDE_CONFIG_DIR`
(provisioned by `SandboxBuildEnv` in `engine/self-host/sandbox-build-env.ts`), the daemon
provisions a PreToolUse hook that blocks writes to the harness main checkout outside the
build worktree. The fence script (`engine/self-host/write-fence.ts`) is merged into the
sandbox's copied `settings.json` and invoked on Edit, Write, MultiEdit, NotebookEdit, and
Bash tools:

**Allow logic (exit 0):**
- Target path is under the build worktree root (`.worktrees/<slug>/...`)
- Bash command is read-only (grep, cat, diff, ls, etc.)
- Target is unrelated to the harness or lives in OS temp (`/tmp/`, etc.)
- Malformed/empty JSON payload (safety default)

**Block logic (exit 2):**
- Target is under the harness root but outside the worktree (modification of live harness)
- Bash command text references main-checkout paths outside worktree (heuristic screening)

When blocked, the hook prints guidance: "Writes to the harness checkout are blocked in
self-build sandbox. Use worktree paths instead" and exits 2.

**Design rationale:** The fence is a cheap, best-effort second layer on the existing
sandbox seam. It catches the observed leak vector (agent Bash write-then-rename). The
deterministic layer (leak-triage/auto-heal) is the load-bearing backstop for anything
the heuristic misses.

**Scope:** Self-host builds only (enabled when `SelfHostDetector` classifies a self-build).
Consumer-repo daemon builds keep the operator's global `block-default-branch-edits.sh`
hook; extending the fence there is a follow-up.

**Modules:** `engine/self-host/write-fence.ts` (script generation),
`engine/self-host/sandbox-build-env.ts` (provisioning), test coverage in
`test/engine/self-host/write-fence.test.ts` and real-binary acceptance test in
`test/acceptance/write-fence-real-binary.acceptance.test.ts`.

### Task Status (engine-owned)

The conductor engine is the **single authority** for `.pipeline/task-status.json`, which
tracks per-task completion state across build retries. The engine owns reads and writes;
no other component modifies it.

**Ownership model:**
- Engine seeds the task-status on merge/upsert from the plan (`.pipeline/plan.json`)
- Completion state is derived from **git evidence**: each pending task maps to commits by
  trailer match (`Task: <id>` in the commit message) or by content-hash matching (when
  trailers are absent).
- Evidence sidecar (`autoheal.ts`) reconciles stale in-flight state against the live
  git log before re-invoking a build step, flipping `pending` tasks to `completed` when
  their commits are unambiguously matched (word-boundary name match + file-path overlap
  with the plan's per-task file list).

**Trailer contract:** Every task commit must carry a `Task: <id>` line in its message
(or the older `#<id>` form for backward compatibility). The conductor reads this to
correlate commits with tasks and to verify no intermediate work was dropped during rebase
or conflict resolution (FR-9).

**Audit trail:** All reconciliations are logged to `.pipeline/audit-trail/` so the
operator can see how completion state evolved across a multi-attempt build.

Key modules: `engine/autoheal.ts` (reconciliation logic), `engine/conductor.ts` (ownership,
seed/upsert), `engine/artifacts.ts` (gate predicates on task-status shape).

### Auto-park on N-attempt trigger

The daemon auto-parks a feature after N consecutive **no-evidence** gate misses (a gate
whose completion check found no new evidence of task completion since the prior attempt)
or when the plan artifact is empty/missing at seed time. This replaces the prior
infinite re-kick loop with a survivable, machine-placed halt.

**Trigger:** After a gate evaluation, if:
1. The plan is absent or empty → park immediately with reason `'empty plan'`
2. The gate shows no new evidence AND `noEvidenceAttempts >= AUTO_PARK_THRESHOLD` (default
   N=1, meaning "2 consecutive no-evidence misses") → park with reason `'no evidence
   after N attempts'`

**Behavior:**
- Writes `.daemon/parked/<slug>` with provenance `auto` and the reason in the marker body
- Emits a `ConductorEvent` of type `auto_park` with the slug and reason
- Halts the feature gracefully instead of re-kicking
- The feature is visible in the daemon dashboard's PARKED group with provenance shown
  (`— auto-parked`)

**Unpark (Task 24 — `conduct daemon unpark <slug>`):** Removes the park marker and resets
the `noEvidenceAttempts` counter, allowing the daemon to re-dispatch the feature.
Operator unpark and manual re-kick both resume from where they left off.

**Distinction from operator park:** A human-placed operator park (`conduct daemon park`)
places a different provenance marker and serves a different purpose (manual hold). Both
are respected by the daemon's dispatch and re-kick logic, but auto-park is deterministic
(machine-triggered after N attempts) while operator park is human-triggered.

Key modules: `engine/park-marker.ts` (marker write/read), `engine/conductor.ts` (auto-park
trigger check), `engine/daemon-park-cli.ts` (unpark subcommand), `daemon-dashboard.ts`
(provenance display).

### Remediation (agentic gap routing)

When a SHIP-phase gate blocks the daemon (`prd_audit`, `finish` verification, or
`architecture_review_as_built`), the conductor first dispatches the `/remediate` planner
to reason over the gap and suggest routing. The planner writes `.pipeline/remediation.json`
with per-gap dispositions.

**Three remediation entry points:**

1. **`prd_audit` blocking** — gap artifact is `.pipeline/prd-audit.md` (audit table with
   FR-gap rows)
2. **`finish` verification failure** — gap artifact is `.pipeline/test-failures.md` (written
   by the finish skill after flake-checking a failing suite; distinguishes real bugs from
   transient infra)
3. **`architecture_review_as_built` BLOCKED** — gap artifact is
   `.pipeline/architecture-review-as-built.md` (design conformance verdict)

**Disposition model:** The planner categorizes each gap and proposes one of:
- **`route_to: 'build'`** — a code gap the daemon owns; the conductor routes back to `build`
  with a retry hint (the gap details) and re-verifies
- **`route_to: 'stories'` or `route_to: 'plan'`** — a DECIDE-phase rework; routes back and
  clears both artifacts
- **`halt: 'architectural-clarity'` or `halt: 'product-scope'`** — genuinely human categories;
  the conductor HALTs and opens a draft PR for triage

**Bounds:** Remediation rounds are bounded by `MAX_KICKBACKS_PER_GATE` (default 3), so a
cycle that's not converging HALTs eventually. Daemon prd_audit also has its own
self-healing fallback: if every blocking row is `impl-gap` (code), the conductor auto-kicks
back to `build` up to N times before giving up.

**Deterministic plan routing:** When routing back to `plan` or `stories`, the conductor
uses deterministic task-id assignment from `.pipeline/remediation.json` so re-opened stories
inherit task ids, allowing `Task: <id>` trailers to bind any new work to the re-opened
task. This keeps the task-status ledger coherent across DECIDE rework cycles.

Key modules: `engine/conductor.ts` (dispatch, disposition routing), `engine/gate-verdicts.ts`
(blocking gate detection), helpers in `engine/remediati

on-append.ts` (deterministic routing).

### Pinned Node

`.tool-versions` pins `nodejs 20.19.0`. The bundle targets `node20` — older Node throws
on execa's `addAbortListener` import. `bin/conduct-ts` reads this file and exports
`ASDF_NODEJS_VERSION` so the conductor runs on its required Node even if the user's
shell default is older.

### Project registry (`register` / `create`)

`engine/registry.ts` is the **single writer** for the harness project registry at
`~/.ai-conductor/registry.json` (override with `$AI_CONDUCTOR_REGISTRY`; `resolveRegistryPath`
is injectable, mirroring `engine/user-config.ts`). Per ADR-003 all three entry points
(`conduct-ts register`, `conduct-ts create`, `/bootstrap`) funnel through it so correctness lives in
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

- `conduct-ts register [path]` (default cwd) — validate the path is an existing git repo (else
  non-zero exit + clear stderr, registry byte-unchanged), derive the record (name=basename,
  absolute path, redacted `git remote get-url origin` if present), upsert with `status: registered`.
- `conduct-ts create <name> [--remote <url>]` — no-clobber guard (a non-empty target writes nothing),
  else `git init` + skeleton `CLAUDE.md` (references HARNESS.md) + `.gitignore` (`.pipeline/`,
  `.daemon/`, `.worktrees/`) + `git remote add origin` when `--remote` is given (add-only, no
  push), upsert with `status: created`.

`ProjectRecord` and the registry **read-side** (`createRegistryReader`) are now consumed by the
engineer supervisor (Phase 9.3, below). See `test/engine/registry.test.ts` and
`test/integration/registry-cli.test.ts`.

### Engineer mode (agent-hosted, Phase 9.3)

The engineer turns a free-form idea into a routed, lesson-informed spec **PR**, and **never builds
and never merges** — a merged spec PR is the only idea→build handoff. As of Phase 9.3 it is an
**agent-hosted, in-chat, human-gated DECIDE loop**: the host agent drives routing and the real
DECIDE skills directly. There is **no Node readline REPL** and **no spawned `claude -p`** — the
TypeScript layer (`engine/engineer/`) supplies deterministic primitives (routing, authoring guard,
intake parsing, liveness) that the host agent calls between human gates. The no-build/no-merge
guarantee is enforced structurally by `test/engine/engineer/non-autonomy.test.ts` (the engineer
source tree imports no build/pipeline entry point and issues no `gh pr merge`) and by
`summary.buildsRun` staying `0`.

**Starting it.** Run the bare **`conduct-ts engineer`** command: it launches an interactive
`claude /engineer` session (stdio inherited) and drops you straight into the loop. This is the
agent-hosted front door — an *operator-driven* interactive session, distinct from the removed
headless `claude -p` automation. The session is launched with `--permission-mode default` (never
`plan`) so the engineer can author DECIDE artifacts, create the spec branch, and run `land`/`handoff`
even if your global `defaultMode` is `plan`; set `CONDUCT_ENGINEER_PERMISSION_MODE` (e.g.
`acceptEdits`, `bypassPermissions`) to change it (`plan` is coerced back to `default`). Run from
inside an existing Claude Code session, it instead tells you to invoke `/engineer` directly (no
nested session); with `claude` not on `PATH` it prints usage.
The `conduct-ts engineer projects | claim | worktree | land | handoff | poll | forget` subcommands
are the deterministic primitives the skill calls between human gates (`claim`/`poll`/`forget` drive
the Phase 9.3b github-issues intake — see below). `land`/`handoff` accept an optional `--source-ref
<owner/repo#N>` so an intake-originated idea reports back to its issue. The bare launcher also
accepts an idea directly: `conduct-ts engineer "<idea>"` (or `--idea "<idea>"`) drives one specific
idea and skips the intake poll.

**Per-idea worktree isolation.** The engineer authors, lands, and hands off each idea inside a
dedicated **git worktree** of the target repo — `conduct-ts engineer worktree --project <n> --idea
"<i>"` creates `<target>/.worktrees/engineer-<slug>` on a fresh `spec/<slug>` branch (reusing the
daemon's worktree mechanism, `engine/worktree-shared.ts`), and `land`/`handoff` take a required
`--worktree <path>`. The target's **primary working tree is never mutated** (no `checkout` dance) so
a concurrent daemon build or a second engineer session in the same repo can't collide. Creation
**strict-aborts** (zero primary-tree mutation) if no worktree can be made — e.g. an unborn/detached
HEAD with no derivable default branch — and never falls back to the shared checkout. On a successful
handoff the worktree is **removed** (the `spec/<slug>` branch persists and stays reachable); a
failure **keeps** it for inspection. `land` stages only `.docs` from the worktree, so each spec
commit is strictly its own idea's set (no cross-idea bleed). This assumes the target repo gitignores
`.worktrees/` (the same convention the daemon relies on).

Per idea (each isolated so one repo's failure never corrupts another):

1. **Intake (hexagonal port)** — ideas arrive as a parsed `Envelope`
   (`{id, source, sourceRef, text, hintRepo?, status, receivedAt}`) through `engine/engineer/intake/`.
   `parseEnvelope` is parse-don't-validate with **field-named** errors; empty/whitespace text is
   **rejected** (`EmptyEnvelopeTextError`), never silently dropped. Two adapters ship behind the same
   port: the synchronous `claude-session` adapter and the async **`github-issues`** adapter
   (Phase 9.3b, below). Dedup is the durable **intake ledger** (`intake/ledger.ts`) keyed strictly on
   `(source, sourceRef)`, never on text — it is the **sole** dedup authority (the old in-memory guard
   was removed in 9.3b; cross-repo same-number issues and re-filed-under-a-new-number ideas are
   correctly distinct).
2. **Route** — `routeIdea` (`engine/engineer/routing.ts`) ranks registry projects against the idea
   and returns candidates (or a create-suggestion when nothing fits).
3. **Confirmation gate** (human-in-the-loop, mandatory before any write) — confirm the target;
   decline with **zero writes** (no branch, no PR, no gh call); `redirect <name>` retargets to
   another registered project (unknown name → re-prompted, no invented path); `create <path>`
   (offered on no-fit) scaffolds + registers a new repo through the 9.2 `create` path. Multi-repo
   **fan-out** authors each confirmed target independently; a deselected repo is left untouched.
4. **Select lessons** — `selectLessons` (`engine/engineer/lesson-store.ts`) pulls prior lessons
   relevant to the target from the engineer store and injects the digest into the authoring prompt
   (no relevant lessons → an explicit empty digest, not unrelated padding).
5. **Author (real DECIDE seam)** — `runAuthoring(target, idea, deps)` (`engine/engineer/authoring.ts`)
   runs the **full DECIDE phase** in canonical order — explore (track) → complexity → prd
   (product track) → architecture-diagram → architecture-review → stories → conflict-check →
   plan — behind `decide` + `assessComplexity` seams; any unapproved step (or a DRAFT ADR)
   **throws and fabricates nothing**. The complexity tier gates architecture + conflict-check
   (Small skips them), the track gates the PRD (technical skips it), and the result is
   persisted to `.docs/complexity/<slug>.md` so the daemon can consume it. On approval it writes
   `Status: Accepted` stories + a plan dependency tree on a `spec/<slug>` branch off the **derived**
   default branch (never hardcoded `main`), artifacts under `.docs/` only. It never emits the old
   `_Generated by engineer._` stub,
   never a DRAFT story, and never spawns `claude` to author. All writes pass through
   `AuthoringGuard.assertWriteAllowed` (`engine/engineer/authoring-guard.ts`), which rejects `..`,
   absolute-sibling, and prefix-collision paths with `PathEscapeError` — authoring repo A leaves
   sibling repo B byte-for-byte unchanged, and a stale/missing target path fails fast with
   `TargetPathMissingError` (never a cwd fallback).
6. **Handoff** — the loop opens a spec **PR** (`gh pr create`, never `merge`) and records the
   authored-keys ledger. A target with **no remote** is non-fatal: the spec stays committed on the
   branch and the ledger is still recorded so the FR-12 flywheel trend counts the feature. After the
   spec lands, `ensureRunning` is wired (see below) to bring up the target's daemon.

#### GitHub-issues intake + write-back (Phase 9.3b)

The **`github-issues`** adapter (`intake/github-issues.ts`) turns assigned GitHub issues into the same
`Envelope`s the chat path produces, then reports progress back to the issue. All GitHub access goes
through an injected `gh` runner — it never touches a registered repo's working tree.

- **Capture is assignee-based.** `conduct-ts engineer poll` sweeps every registered repo for open
  issues assigned to the authenticated user (`gh issue list --assignee @me --state open`), enqueues
  new ones into the durable inbox (`<engineer-dir>/inbox/`, one claimable `Envelope` per file), and
  exits — **no routing, no processing, no background timer**. A failing repo (auth/availability) is
  isolated and the rest still capture; an empty issue (no title and no body) is skipped. The ledger
  dedups, so polling twice enqueues nothing new.
- **The `engineer:handled` label is an output marker, not an intake filter.** It is applied on `done`
  (auto-created if missing) and makes the issue a re-capture skip; capture itself stays assignee-based.
- **Poll-on-launch (live path).** The bare `conduct-ts engineer` launcher **pre-polls** github issues
  and enqueues new ones into the inbox *before* spawning the interactive `claude /engineer` session
  (printing `Intake: N issue(s) queued.`), then the session's step 1 runs `conduct-ts engineer claim`
  to atomically dequeue the **oldest** idea (claim+ack removes it from the inbox; the ledger advances
  to `claimed`). An empty inbox → the skill falls back to a CLI-supplied idea or chat capture. A
  CLI-supplied idea skips the pre-poll for that session. The pre-poll is best-effort — a `gh` failure
  never blocks the launch. (The legacy `runEngineerMode` loop in `intake/loop.ts` carries an
  equivalent in-process poll→claim→process block, but it is a **test-only** scripted harness — the
  live launch path is the pre-poll + `claim` seam described here.)
- **Write-back (`report()`)** posts `Routed to <repo>` at routing and `Spec PR opened: <url>` at
  handoff, applying `engineer:handled` on done. The skill threads it through the `--source-ref` flag
  on `land` (routed) and `handoff` (done); the shared `intake/writeback.ts` helper backs both the CLI
  primitives and the test-only loop. It is **non-fatal** (a `gh` outage never reverts a delivered spec
  PR) and **de-duplicated** per `(sourceRef, status)`.
  - **`gh` cwd resolution never falls back to `process.cwd()`.** `report()`'s `gh` calls always pass
    `-R <owner/repo>`, so any existing directory is a sufficient cwd — but a bare `process.cwd()`
    fallback previously spawned `gh` from wherever the daemon happened to be running, which could hit
    a deleted/missing directory and fail with `ENOENT`. `resolveReportCwd()` instead resolves, in
    order: the poll-cache (`repoPaths`, populated by a prior `poll()`) → a registry lookup matched by
    `ghRepo`/`name` → `os.homedir()` — each candidate `existsSync`-checked before use.
  - **Failures return actionable remediation, not just a log line.** `report()` returns a
    `ReportOutcome`: `{ ok: true }` on success, or `{ ok: false, remediation: string[] }` on failure,
    where `remediation` is the fully-substituted `gh` command for the *specific* step that failed
    (issue comment or label-add), ready to copy/paste-retry — e.g.
    `gh issue comment 200 --repo o/e --body "..."`. `dispatchEngineer`'s `handoff`/`land` primitives
    print that remediation to stderr; stdout (the `pr-opened`/`routed` envelope) and the exit code are
    unaffected — a failed write-back never turns a successful handoff into a failure.
  - **A failed `done` write-back sets `writebackPending: true` on the ledger entry** (`reportDone` in
    `intake/writeback.ts`, threaded through `Ledger.transition`'s `meta`), so a stalled write-back is
    visible in `ledger.json` for later reconciliation even though the spec PR itself was delivered. A
    subsequent successful write-back (any later `report()` call for that `(source, sourceRef)` that
    resolves `ok: true`) clears the flag; per TR-3 the flag is only ever cleared on an explicit
    `ok: true` outcome — an absent port, or a port call that produced no outcome, leaves a
    pre-existing flag untouched rather than silently dropping it.
- **Issue ↔ PR linkage + auto-close (on implementation merge).** Commenting is not linking: GitHub's
  formal issue↔PR link and auto-close come from a closing keyword in a PR body. The issue reference
  travels WITH the spec via a committed **`.docs/intake/<plan-stem>.md`** marker (`Source-Ref: owner/repo#N`,
  keyed by the plan file's basename minus its `.md` extension, not the idea slug),
  written by both authoring paths (`land --source-ref` and the autonomous `runAuthoring`) — so it
  survives the spec-PR merge and reaches the daemon, which only reads the merged base-branch tree.
  The **spec PR** gets a non-closing `Refs owner/repo#N` (links, but must NOT close — that would
  defeat the re-eligibility guard below). The daemon parses the marker into `BacklogItem.sourceRef`
  (`daemon-backlog.ts`) and, after the build, adds **`Closes owner/repo#N`** to the **implementation
  PR** (`closeIssueOnImplementationMerge` in `engineer/issue-ref.ts`), so GitHub auto-closes the issue
  when the real work merges to the default branch. Every step is gated on a parseable ref
  (hand-authored / non-intake specs are unchanged), idempotent, and non-fatal.
- **Re-eligibility + churn guard.** A `done` issue whose spec PR closes **without merging** is
  re-emitted on the next poll (label stripped, `attempts++`); a **merged** PR is never reopened. Past
  the reopen cap the issue is parked as `needs-manual` and stays out of the inbox until
  `conduct-ts engineer forget <owner/repo#N>` drops its ledger entry and strips the label.

State lives under the engineer dir (`$AI_CONDUCTOR_ENGINEER_DIR`, default `~/.ai-conductor/engineer/`):
`ledger.json` (dedup + lifecycle) and `inbox/` (the claimable queue).

#### Intake Loop Automation

The GitHub-issues poll above can run as a **standalone background loop** instead of (or in
addition to) the launcher's pre-poll and an external cron job — a tmux-hosted, zero-token
process managed via `conduct-ts brain start|stop|status` (see the root README's "Brain Loop
Supervision" section for the operator-facing commands).

- **CLI: `conduct-ts intake-loop`** (`intake-loop-cli.ts`, composition root, wraps
  `engine/engineer/intake/intake-loop.ts`). Exactly one of two mode flags is required:
  - **`--continuous`** — runs the poll→enqueue→notify tick forever, sleeping between ticks.
    This is the mode `conduct-ts brain start` launches inside its tmux session.
  - **`--once`** — runs a single tick and returns; useful for cron or manual invocation
    without the tmux supervisor.
  Supplying both or neither flag is rejected (prints usage guidance) rather than silently
  falling back to a default mode.
- **`--interval-ms <n>`** — sleep between ticks in continuous mode. CLI default is 5 minutes
  (`DEFAULT_INTERVAL_MS`). The value must parse to a finite number `> 0`; a non-finite or
  non-positive interval is rejected at the CLI layer, and the loop core additionally guards
  against a bad interval reaching the sleep call by substituting its own 60-second fallback
  (`INTAKE_INTERVAL_DEFAULT_MS`) — a defense-in-depth measure so a misconfigured interval
  can never produce a zero/negative-delay busy-loop.
- **Never spawns `claude`, never opens a PR.** The loop only calls `gh` (via the same
  injected runner as the launcher's pre-poll) to list/enqueue issues and to push
  best-effort notifications — it is a pure polling/bookkeeping process, so leaving it
  running continuously costs no model tokens.
- **Status surface (`<engineer-dir>/intake-status.json`).** Written on every tick that finds
  new issues (skipped when there's nothing new to report). Shape:
  ```json
  {
    "count": 3,
    "sourceRefs": ["owner/repo#7", "owner/repo#9", "owner/repo#12"],
    "timestamp": "2026-06-30T12:00:00.000Z",
    "message": "3 new idea(s) captured from owner/repo#7, owner/repo#9, owner/repo#12"
  }
  ```
  `conduct-ts brain status` reads this file for its `queued: <n>` line; a missing or
  malformed file is treated as `count: 0` rather than an error.
- **Durable de-dup across restarts.** The notifier tracks which `sourceRef`s it has already
  notified so a loop restart doesn't re-announce issues already surfaced in a prior run;
  when a tick finds nothing new, both the status write and the (optional) push are skipped
  entirely.
- **`intake_notifier` config (optional, best-effort push).** Mirrors the existing
  `mermaid_renderer` config pattern (see `config.ts`) — an optional block that, when present,
  lets the loop push a notification (e.g. to a webhook or external channel) alongside writing
  the status file. Like `mermaid_renderer`, it is fully optional: omitting it leaves the loop
  writing only the local status surface. A push failure is caught and logged — it never
  blocks the tick, corrupts the status file, or crashes the loop.
- **Single-writer deferral.** `engine/engineer/brain-liveness.ts`'s `brainLoopAlive()` checks
  for a live tmux session (`cc-brain-*`) or pidfile. When the brain loop is alive, the
  interactive `conduct-ts engineer` launcher's `prePoll` step (see "GitHub-issues intake"
  above) is set to a no-op rather than running its own poll, so the background loop and the
  interactive launcher never race the same ledger/inbox.

#### Push Notifications

When the intake loop (`--continuous` or `--once`) discovers new issues, it sends a desktop
push notification via the **existing `sendNotification` transport**:

- **Transport mechanism:**
  - **macOS**: `osascript` via native notification API
  - **Linux**: `notify-send` (freedesktop.org Desktop Notifications)
  - **Fallback**: terminal bell (BEL character, audible on most terminals)

- **Behavior:**
  - Notifications fire only on **non-empty ticks** (when new issues are discovered)
  - Transport failures are caught, logged, and **non-blocking** — they never interrupt the
    intake tick or prevent the status file from being written
  - The notification is **best-effort**: if the transport is unavailable (e.g., `notify-send`
    not installed), the system falls back gracefully to the next transport in the chain
  - The status file (`.../intake-status.json`) is always written, regardless of push success —
    the two surfaces (durable file + best-effort notification) work together to surface new
    captured ideas

- **Configuration:** No explicit config needed beyond `intake_notifier` (see "Intake Loop
  Automation" above). The transport is selected automatically by the platform at runtime.

- **Applies to:** Both `brain start` (tmux-hosted continuous mode) and direct CLI invocation
  (`--continuous` or `--once` flags)

#### Delivery guard (engineer claim) and recovery (engineer resolve)

The intake system auto-heals duplicate captures and recovers from write-back failures:

**Claim-time delivery guard (`engine/engineer/intake/delivery-guard.ts`).**
When `engineer claim` is invoked, the guard checks the ledger against the inbox, looking for entries that are already claimed with a prUrl (PR delivered). On finding a duplicate envelope for such an entry:
- **If the PR is OPEN or MERGED** (PR state known): the entry is marked `done` and the duplicate envelope is dropped from the inbox **without serving it to the session** (re-served with the cached prUrl, status unchanged, ledger writes preserved). Reduces friction from duplicate captures — no session spin, no duplicate work, no loss of delivery proof.
- **If the PR state is unknown** (API failure, closed-without-merging, or other): the envelope is held **without ledger mutation**. On the next claim, if the PR state resolves, the guard heals and drops it. Unknown-state envelopes are never re-served, preventing stalled-write issues from blocking the queue indefinitely.
- **Healthy entries pass through unchanged** (no ledger entry, or ledger entry with no prUrl): the guard does no checking and does not interfere with the normal claim path.

Integration modules: `engine/engineer/intake/delivery-guard.ts` (guard logic), wired into `engineer-cli.ts` (the claim path instantiates it and wraps the queue).

**`engineer resolve` recovery subcommand (`engine/engineer/resolve.ts`).**
Recovers from write-back failures (e.g., a local-commit completed but the spec PR delivery never happened, or a network timeout during handoff) by marking a claimed entry as delivered. 

**Signature:**
```
conduct-ts engineer resolve <sourceRef> --pr-url <url> [--branch <branch>]
```

**Fields:**
- `<sourceRef>` — the issue identifier (e.g., `o/a#123`) — parsed from the command line
- `--pr-url <url>` — the delivered PR URL (https:// or http://) — required, validated before mutation
- `--branch <branch>` — optional branch name override; if omitted, the ledger's existing branch is preserved

**Behavior:**
- **Found case (entry exists in ledger)** — transitions the entry from `claimed` (or any status) to `done`, recording the prUrl. If `--branch` is supplied, it overwrites the ledger's existing branch; otherwise, the existing branch is preserved. Returns JSON: `{ kind: 'resolve', sourceRef, priorStatus, prUrl, branch }`, exit 0.
- **Not-found case (no entry in ledger)** — returns JSON: `{ kind: 'resolve', found: false }`, exit 0 (soft failure, never creates a ledger entry).
- **Invalid prUrl (not http(s)://)** — returns error on stderr and exits 1.
- **Idempotent** — running `resolve` multiple times on the same entry with the same prUrl is safe and produces no additional mutations (re-run returns the current status unchanged).

Example:
```bash
# Recover from a write-back failure; mark the entry delivered
conduct-ts engineer resolve o/a#123 --pr-url https://github.com/o/a/pull/456

# Optionally correct the branch if it diverged:
conduct-ts engineer resolve o/a#123 --pr-url https://github.com/o/a/pull/456 --branch spec/revised
```

**Integration with claim-time guard (compose pattern, plan Task 13):**
After `engineer resolve` marks an entry delivered, a subsequent `engineer claim` invokes the delivery guard, which detects the duplicate envelope and heals/drops it — completing the recovery cycle: stranded entry → resolve → entry marked done → next claim drops duplicate via guard.

**Modules:** `engine/engineer/resolve.ts` (resolve command dispatch), `intake/ledger.ts` (ledger transitions).

### Priority scheduling for daemon backlog ordering

The daemon can reorder eligible features by GitHub issue priority labels, honoring
human-driven prioritization without changing the eligibility/deduplication logic.

**Priority bands and label vocabulary:**
- `priority: high` — highest-priority band (no-issue status escalated)
- `priority: medium` — standard priority band
- `priority: low` — lower-priority band
- Unlabeled — chronological fallback order

Each issue is read for the highest-ranking label; mixed/malformed labels are
ignored (fail-open semantics). Label reads are **fresh per scan** and **cached
within a scan** (one REST API call per issue).

**Implementation (`engine/priority-resolver.ts`):**
- `createPriorityResolver(deps)` — factory taking an `ExecRunner` (gh REST client)
  and a `RefreshCadence` spec (cadence: `'refresh'` = fresh reads each scan)
- `PriorityResolver.resolvePriority(backlog)` — returns a stable `BacklogOrdering`
  permutation: eligible items grouped by band and ordered chronologically within each band
- Process-local cache (cleared on error, reused within scan) — lost on daemon restart
- `PriorityResolution.fallback` — true when reader error occurred, signals
  chronological-only fallback; a single deduped warning is logged per outage

**Fallback behavior:**
On GitHub API failure (auth, outage, network), `resolvePriority` logs a warning once
per outage and returns a chronological ordering. When the next scan succeeds,
the warning counter resets. The fallback is transparent to the backlog selection
logic — features remain eligible and dispatch, just in chronological order.

**PostGate integration:**
The daemon's `localWorkSource` (post-eligibility ordering) accepts the resolver.
`orderBacklog` is a **deterministic stable permutation** — multiple calls with the
same backlog and resolver state always produce the same output, so restart safety
and audit-trail stability are preserved.

**Dashboard integration (`daemon-dashboard.ts`):**
`scanInheritedState` now carries `priorityResolution` result. `renderDashboard`
displays a `[high]` / `[medium]` / `[low]` band suffix on ELIGIBLE items and a
`[fallback]` marker on all ELIGIBLE when the resolver is in fallback mode.

**Non-impact guarantees:**
- Eligibility gate unchanged (priority is post-gate)
- Deduplication unchanged (one build per slug, even if relabeled)
- Owner gating unchanged (identity partition preserved)
- Dependency resolution unchanged (blocker checks run before priority)
- Park markers and halt reconciliation unchanged

#### Dependency-ordered intake and dispatch

Specs authored from a GitHub issue can declare a dependency on another issue via GitHub's
native **issue-dependencies** API (`blocked_by`). Both the daemon's build gate and the
engineer's intake claim walk honor that link, so a spec never dispatches or builds ahead of
work it depends on.

- **Blocker resolver (`engine/blocker-resolver.ts`, `createBlockerResolver`).** Given a
  `Source-Ref: owner/repo#N` (see GitHub-issues intake above), resolves one of four verdicts:
  `unblocked` (no open blockers), `blocked` (one or more open blockers, listed), `cycle` (a
  dependency cycle detected via a DFS walk of the `blocked_by` chain — every cycle member gets
  the same verdict so any one of them can be queried directly), or `indeterminate` (a `gh` API
  error, an unparseable response, or an unparseable `sourceRef`). All GitHub access goes through
  the injected `BlockerRunner` (`gh-blocker-runner.ts`), matching the DI pattern used elsewhere.
  Verdicts are memoized per resolver instance (one scan pass) — never shared across instances.
- **Daemon dependency gate (`daemon-backlog.ts` / `daemon-dashboard.ts`).** A build-ready spec
  whose blocker verdict is not `unblocked` is held out of ELIGIBLE and instead reported in a
  dedicated **WAITING** group in the startup dashboard (precedence
  **HALTED > PROCESSED > IN-PROGRESS > WAITING > ELIGIBLE**) — never silently dropped, and never
  double-listed in ELIGIBLE. Each WAITING row names the slug and a verdict-specific detail (the
  open blocker(s), the cycle members, or the indeterminate error). `daemon-waiting-announce.ts`
  warns **once** per slug per verdict — re-announcing only when the verdict's content actually
  changes (a new/removed blocker, or a kind change) — so a spec parked on a slow-moving blocker
  doesn't spam `daemon.log` on every poll tick; a spec that leaves and later re-enters WAITING is
  treated as a fresh wait.
- **Engineer intake claim deferral (`engineer/intake/dependency-claim.ts`,
  `claimUnblocked`).** The claim walk pulls pending intake entries oldest-first via the
  queue's own atomic `claim()`, resolving each entry's dependency verdict; any entry that isn't
  `unblocked` is **deferred** — released back to the queue unchanged (no ledger write, no
  attempt increment) — and the walk continues to the next-oldest entry. The first `unblocked`
  entry found is claimed (oldest-unblocked-wins), even if older blocked entries were skipped
  over.
- **All-blocked outcome, distinct from empty.** If the walk exhausts the queue without finding
  an unblocked entry, the outcome is `{ kind: 'all-blocked', entries }` — listing every deferred
  entry and its verdict — rather than `{ kind: 'empty' }`. This lets an operator tell "nothing to
  do" apart from "there's work, but it's all stuck on dependencies," and see exactly what it's
  stuck on.
- **`conduct-ts engineer migrate-issue-deps [--confirm]`.** A one-time migration tool for repos
  whose existing issues describe dependencies as prose (e.g. "blocked by #12") rather than
  GitHub's native issue-dependencies link. Dry-run by default (prints a proposal of the links it
  would create); `--confirm` actually creates them via the GitHub API. Intended to be run once
  per repo when adopting this feature, so pre-existing prose dependencies become resolvable by
  the blocker resolver above.
- **Fail-closed semantics.** Every failure mode here — a `gh` API error, an unparseable
  `blocked_by` response, an unparseable `sourceRef`, a detected cycle — resolves to
  `indeterminate` or `cycle`, never `unblocked`. An indeterminate or cyclic spec is held in
  WAITING (daemon) or deferred (intake claim), not dispatched or built; a malformed or
  unreadable dependency marker can only make a spec wait longer, never jump the queue or build
  early.

#### Daemon liveness (pidfile-lock)

`engine/engineer/daemon-lock.ts` owns a **one-per-repo mutex**: `.daemon/daemon.pid` is created with
`O_EXCL` so exactly one daemon wins under concurrent boots. Liveness is `process.kill(pid, 0)`
(`ESRCH` → dead, `EPERM` → alive); a corrupt/malformed pidfile is treated as absent. Stale reclaim
**never permanently refuses** — a `kill -9` leftover is reclaimed on the next boot.
`ensureRunning(repoPath, deps)` starts a daemon **iff** none is live or the pidfile is
stale, no-ops if one is already alive, and **never manages** the lifecycle (fire-and-forget;
ensure-not-manage). Its default launch now delegates to the tmux Supervisor's idempotent
`start` (`launchDaemon` → `supervisor.start`, the daemon-supervisor ADR) — so an engineer-nudged daemon
is hosted in a session and is operator-attachable, while the engineer still retains no
handle/IPC/control (ADR-005 non-management intent preserved; only the spawn mechanism is
superseded). The session runs with `cwd: repoPath`, so the pidfile and worktree land under the
target repo's `.daemon/`. The registry `daemonState` mirror is **non-authoritative** — the
pidfile wins; a mirror-write failure is non-fatal.

Read-only reporting over the engineer store ships as library functions: `governorReport`
(`engine/engineer/governor.ts`) aggregates spend + kickback/halt/retry rates; `computeFlywheelTrend`
(`engine/engineer/flywheel-trend.ts`) reports `improving` / `insufficient_data` across
engineer-planned features (store ∩ authored-keys ledger). Registry/store paths come from
`$AI_CONDUCTOR_REGISTRY` / `$AI_CONDUCTOR_ENGINEER_DIR`. Acceptance scenarios live in
`test/acceptance/engineer.test.ts`.

### Daemon build-auth: isolating daemon builds from operator OAuth (Tasks 5-17, TR-1..TR-4)

Self-host daemon builds authenticate to Claude independently of the operator's own
`.credentials.json` OAuth session, so a daemon build can never read, wait on, or exhaust the
operator's interactive login. Configured under `harness_self_host.build_auth` in
`.ai-conductor/config.yml` (`types/config.ts`, validated in `engine/config.ts`, resolved by
`resolveSelfHostConfig` in `engine/resolved-config.ts`):

```yaml
harness_self_host:
  build_auth:
    mode: daemon-token        # "daemon-token" (default) | "api-key"
    token_path: ~/.ai-conductor/build-auth   # daemon-token mode only; ~ expands to $HOME
```

**Modes:**

- **`daemon-token` (default).** The daemon reads a token file at `token_path` (default
  `~/.ai-conductor/build-auth`, resolved by `getDefaultBuildAuthTokenPath()` in
  `resolved-config.ts`) that is entirely separate from the operator's `.credentials.json`. Mint
  it once with:

  ```bash
  claude setup-token
  chmod 600 ~/.ai-conductor/build-auth
  ```

  (`DAEMON_BUILD_TOKEN_MINT_COMMAND` in `self-host/daemon-build-token.ts` is the single source of
  truth for this command string, reused by both the HALT message and the CHANGELOG migration
  block.) On each sandboxed build dispatch the conductor reads the token
  (`readDaemonBuildToken`) and injects it as `CLAUDE_CODE_OAUTH_TOKEN` into the sandboxed step's
  environment only — the operator's own `CLAUDE_CODE_OAUTH_TOKEN` (if any) is restored in a
  `finally` block afterward (`conductor.ts`, around the sandboxed `stepRunner.run` call).
- **`api-key`.** The build authenticates via a pre-existing `ANTHROPIC_API_KEY` in the daemon
  process's environment. The daemon-token preflight and the operator-credentials preflight are
  both skipped in this mode — no token file is required.

**Fail-closed pre-flight (`self-host/build-auth-preflight.ts`, Task 6).** Before a self-host build
provisions its sandbox, `preflightBuildAuthCheck` runs in `daemon-token` mode only:

- Token file present and non-empty → proceeds normally.
- Token file missing, empty/whitespace-only, or unreadable (e.g. `chmod 000`) → writes
  `.pipeline/HALT` (only if one doesn't already exist, so retries don't clobber an existing
  reason) with the mint command, the resolved token path, and the `harness_self_host.build_auth`
  config keys to set. The check runs **before** any sandbox is provisioned and never consumes the
  step's retry budget.

**Backward compatibility.** An absent `harness_self_host.build_auth` block (or one that isn't
explicitly `daemon-token`/`api-key`) leaves the pre-#5-17 behavior unchanged: the conductor falls
back to the operator-credentials preflight (`preflightCredentialsCheck`, which watches
`~/.claude/.credentials.json` expiry) — see the park-and-poll section below. Once `build_auth.mode`
is explicitly set to `daemon-token` or `api-key`, the operator-credentials preflight is skipped
entirely (Task 11) — the two auth paths are mutually exclusive per build.

**Auth-failure park in daemon-token mode (Task 11, TR-4).** If a step reports an auth failure
mid-build, the daemon-token mode parks and polls the token file's mtime/content for a refresh
(`createDaemonTokenContentClassifier` + `waitForCredentialsChange`), the same park-and-poll
mechanism the operator-credentials path uses (see below), bounded by
`auth_park_timeout_minutes`. In `api-key` mode there is no token file to watch, so an auth
failure HALTs immediately with a reason naming `ANTHROPIC_API_KEY` and instructions to re-queue
the feature after fixing it — parking never happens in `api-key` mode.

**Migration.** See the `CHANGELOG.md` `[Unreleased]` migration block for the exact commands to
mint a token and wire it into an existing project's config without clobbering a token that's
already present.

### Sandbox auth-expiry park-and-poll (self-host daemon builds)

Headless/sandbox daemon builds run against an operator's credentials file (`~/.claude/.credentials.json`)
that may expire mid-build. The conductor detects expiry and auth failures, and parks the feature to wait
for the operator to refresh credentials rather than failing immediately.

**Background (TR-1…TR-5):** The daemon runs unattended on the operator's machine, invoking Claude via
the CLI. The CLI authenticates with the operator's cached OAuth token (`claudeAiOauth`) in
`.credentials.json`. When that token expires, the CLI exits with "Not logged in" on every invocation.
Without park-and-poll, the feature's retry budget burns out waiting for the token to naturally refresh,
and the feature HALTs. With park-and-poll, the daemon parks after the first auth failure, polls for the
operator to run `claude login` (which updates the `claudeAiOauth.expiresAt` timestamp and mtime), and
resumes the feature with budget intact.

**Detection (two entry points):**

1. **Pre-flight expiry check** — before provisioning a sandbox build, the conductor calls
   `readOperatorCredentialsState()` (from `src/conductor/src/engine/self-host/operator-credentials.ts`)
   with the current time. The reader checks `~/.claude/.credentials.json` for `claudeAiOauth.expiresAt`:
   - `future` (beyond imminent margin) → `fresh` (dispatch normally)
   - `past` or within imminent margin → `expired` (park before provision; saves compute)
   - `unknown` (file missing, malformed JSON, or no `claudeAiOauth` key) → fail-open (dispatch normally)
   The reader is fail-open by design: it never throws, never blocks dispatch, and respects
   `$CLAUDE_CONFIG_DIR` for sandbox isolation.

2. **Step-level auth failure** — during the build, if a step fails with exit code non-zero and output
   matching `AUTH_FAILURE_RE` (signatures: "Not logged in", "Please run /login", "Invalid API key"),
   the executor (`src/conductor/src/execution/claude-provider.ts`) surfaces `authFailure: true` on the
   result. The conductor's per-step retry loop detects this and enters park-and-poll (without consuming
   a retry, preserving budget).

**Park-and-poll behavior:**

When credentials are detected as expired or auth failure occurs, the conductor invokes
`waitForCredentialsChange()` (from `operator-credentials.ts`):

- **Polls the credentials file** every few seconds for an mtime advance (indicating the operator ran
  `claude login`).
- **Checks freshness** — when mtime changes, re-reads the credentials and checks `expiresAt`:
  - Still expired → keeps polling
  - Fresh (unexpired) → proceeds to **resume the build**
- **Resume build with fresh auth** (Task 11) — the sandboxed build re-reads the daemon's live `CLAUDE_CODE_OAUTH_TOKEN`
  env var, obtaining fresh credentials without needing to copy them into the sandbox.
- **Timeout** — configurable via `auth_park_timeout_minutes` (default **60 minutes**; `0` or negative =
  opt-out, HALT immediately). When timeout elapses without a successful refresh, the conductor
  `writeHaltMarker()` with a reason naming the credentials path + observed `expiresAt` (or "unparseable").
- **Budget invariant** — parking consumes **zero retries**. The `attempt` counter is frozen across the
  entire park-and-poll wait, so budget is available for post-park-resume retries and subsequent gates.

**Configuration:**

```yaml
# .ai-conductor/config.yml (project level)
auth_park_timeout_minutes: 60      # default: 60; 0/negative = opt-out (HALT immediately)
```

Set to a number of minutes the daemon should wait for the operator to refresh. Set to `0` or negative
to disable park-and-poll entirely — on auth failure or expiry, HALTs immediately.

**Remediation (standard HALT flow):**

Park-and-poll HALTs follow the standard HALT remediation (no new process — see ADR-013):

1. Operator is alerted (PR labeled `needs-remediation` with the auth reason, or daemon log tail).
2. Operator runs `claude login` to refresh the credentials file (`expiresAt` advances, mtime updates).
3. Alternatively, if the feature is still parked, the HALT window may exit on its own timeout.
4. Once `.pipeline/HALT` is cleared, the feature re-kicks via the daemon's base-SHA advance logic or
   manual dispatch, and resumes where it parked (the next step retry or post-park gate re-verification).

**Implementation modules:**

| Module | Responsibility |
|--------|-----------------|
| `engine/self-host/operator-credentials.ts` | Reader (`readOperatorCredentialsState`, fail-open classification), wait primitive (`waitForCredentialsChange` with injected clock/sleep for testability) |
| `execution/claude-provider.ts` | Classifier (`AUTH_FAILURE_RE`, `authFailure` flag on invoke result) |
| `engine/step-runners.ts` | Thread `authFailure` through `StepRunResult` |
| `engine/conductor.ts` | Pre-flight check (before sandbox provision), per-step retry-loop branch (auth failure → park), timeout branch → HALT with credentials reason |
| `engine/resolved-config.ts` | `auth_park_timeout_minutes` config field + validation (0/negative = opt-out) |

See `.docs/plans/sandbox-auth-expiry-park.md` and `.docs/decisions/adr-2026-07-04-auth-failure-park-and-poll.md` for the full design.

### Daemon auto-restart on stale engine (self-host only)

When enabled in self-host mode, the daemon keeps its running engine in sync with merged source.
**Before starting each feature** (and at idle) it rebuilds the engine from the fast-forwarded
source — a content-addressed `npm run build` that no-ops when unchanged and atomically flips the
`dist` symlink otherwise, leaving the running pinned `dist-versions/<id>` untouched — then hashes
`dist/index.js`. If the running engine is now stale and no tasks are in-flight, it writes a restart
intent marker (`.daemon/RESTART_PENDING`) and exits with code 0, allowing the configured respawn
transport (PR #215) to relaunch with fresh code so the next feature is built by that fresh code.

The rebuild step exists because engine build artifacts are untracked (#309): a merge advances
`src/` but never the local `dist` artifact, so without a rebuild the staleness check would never
observe merge-driven drift. Firing at the **dispatch boundary** (not only when the backlog fully
drains) matters because a merge that lands new specs takes the dispatch path and skips the
drained-idle branch — so an idle-only check would build freshly-merged specs on stale engine code.

**Configuration:**

```yaml
# .ai-conductor/config.yml (project level)
auto_restart_on_stale_engine: true    # default: false; self-host only, ignored in non-self-host environments
```

**Key behavior:**

- **Configuration is read once at startup** — changes to the flag require restarting the daemon
- **Self-host-only** — non-self-host environments ignore the flag regardless of setting
- **Disabled in once-mode** — the daemon runs a single batch (`conduct daemon` without `--continuous`),
  so auto-restart has no effect
- **RESTART_PENDING marker** — when the running engine is stale (after a rebuild) with no in-flight
  tasks, the daemon writes `.daemon/RESTART_PENDING` and exits cleanly (code 0) rather than
  continuing with stale code
- **Fires before the next feature, never mid-build** — the rebuild + staleness check run at the
  dispatch boundary and at idle, but only when the in-flight pool is empty, so a running build is
  never interrupted; a failed rebuild is logged and degrades to the current engine
- **No-op suppression** — on non-convergence (fresh identity ≠ target), restart detection is suppressed
  to prevent restart loops
- **Requires PR #215 respawn transport** — without an external respawn mechanism, the daemon exits but
  is not automatically relaunched with fresh code

**Detection:** The daemon captures the sha256 of `dist/index.js` at startup and, before each
dispatch (and at idle), rebuilds from source and re-hashes. A mismatch means the running engine no
longer matches the freshly-built source. On non-convergence at boot (fresh identity ≠ the restart's
target) restart is suppressed to avoid thrashing.

#### Respawn in-place (single-generation) — Fix for #400

On stale-engine detection at idle boundary:

1. **Fired trigger**: Requester exits unconditionally (`lock.releaseSync()` then `process.exit(0)`)
   - Predecessor daemon ends cleanly
   - Tmux session survives for successor to reattach
2. **Bounded takeover**: Lock holder polls for up to 10s waiting for predecessor to release
   - If acquired: successor daemon takes over
   - If timeout: abandoned lock, fallback reclaim logic
3. **Lock-loser exit**: Non-owner daemon detects lock held, exits cleanly (code 0)
   - No resident process, no cleanup needed

This ensures single-generation handoff: exactly one daemon owns the session at any time, and predecessor always exits before successor takes control.

See `.docs/plans/2026-07-03-daemon-auto-restart-stale-engine.md` for the full design.

### Harness self-host guardrails (`engine/self-host/`)

The guardrail bundle that makes the `james-stoup-agents` harness repo safe to daemon-register
(adr-2026-06-30-{self-host-detection-seam, sandbox-build-isolation, halt-based-release-gates}).
Activated **only** for a harness self-build via a swappable detector; every other repo's path is
byte-for-byte unchanged (`FR/TR-13`). Configured by the `harness_self_host` block in
`types/config.ts` (validated in `engine/config.ts`; resolved by `resolveSelfHostConfig` in
`engine/resolved-config.ts`, safe-by-default → auto-detect, all gates on).

| Module | Responsibility |
|--------|----------------|
| `self-host/detector.ts` | `SelfHostDetector` interface + `PathSelfHostDetector` (realpath equality vs `resolveHarnessRoot()`); `classifySelfHost` layers the `activation` override. Identity by path, not name; positive-only activation. |
| `install-freshness.ts` → `relinkSkillsForSelfBuild` | Relink harness skills (`bin/install --update`) before a self-build; non-zero exit / missing installer → `InstallStaleError`, no dispatch. Root discovery goes through `resolveInstalledHarnessRoot` (below): a rejected root also throws `InstallStaleError` naming it — the installer is never run against a worktree (#363). |
| `install-freshness.ts` → `resolveInstalledHarnessRoot` | Installed-root resolution ladder for **operator-global writes only** (adr-2026-07-06): module probe → worktree detection (`.worktrees/` path or `git rev-parse --git-common-dir` outside the probed root) → main-checkout derivation from the common dir → `bin/install` assertion → hard-reject of any `.worktrees/` root → advisory (warn-only) registry cross-check. Returns `ok`/`rejected`/`unresolved`, never throws. `resolveHarnessRoot` (the detector's identity seam) is deliberately untouched. |
| `self-host/sandbox-build-env.ts` | Throwaway `CLAUDE_CONFIG_DIR`: `skills/`+`hooks/` symlinked to the worktree, with `.credentials.json` + a hook-retargeted `settings.json` **copied** in (auth + own-hooks; copies keep the no-global-symlink invariant). Fails closed on a missing worktree link target; `withSandboxBuildEnv` guarantees teardown on pass/fail/crash; `childEnv()` never mutates the parent env. |
| `halt-marker.ts` | Canonical `.pipeline/HALT` marker path + best-effort `writeHaltMarker`; the rebase HALT and the self-host gate HALTs both write through it. |
| `self-host/version-gate.ts` | `VersionApprovalGate` — HALT unless `.pipeline/version-approval` matches VERSION. A declared `version_freeze` matching VERSION self-satisfies the gate (records the marker, no HALT); any other VERSION still halts — a freeze never approves a bump (#261). |
| `self-host/release-gate.ts` | `ReleaseArtifactGate` — integrity suite (bounded timeout) + CHANGELOG `[Unreleased]` + migration block; all fail-closed, distinct HALT reasons. |
| `self-host/gate-halt.ts` | `writeSelfHostHalt` — `.pipeline/HALT` with a gate-specific reason + the ADR-005 resume procedure (re-install → `/verify` → operator merges). |
| `self-host/wiring.ts` | `SelfHostGuardrails` — the injectable bundle (`relink`/`provisionSandbox`/`versionGate`/`releaseGate` + `resolveHarnessRoot`/`resolveInstalledHarnessRoot`) the conductor calls the primitives through; `defaultSelfHostGuardrails` forwards to the real ones. One seam so the whole bundle activates (or is spied) as a unit. |

**Non-autonomy (ADR-005/ADR-010):** no self-host module references a merge entry point
(`test/engine/self-host/non-autonomy.test.ts` asserts this structurally). Every self-build ends at a
HALT for the operator to merge.

**Daemon-loop wiring (Phase 6).** `daemon-cli.ts` classifies `isSelfHost` **once** at startup against
the main repo root (not a worktree — a worktree path never equals the harness root) and threads a
`selfHost` flag to each `Conductor`. `conductor.run()` then, for a self-build only (`daemon &&
selfHost`):
- **before the first `build`** — relinks skills once (`InstallStaleError` → HALT, no build; a
  worktree-resolved installed root is one of the rejection causes, #363), then provisions the
  sandbox once (`SandboxProvisionError` → HALT, no build), passing the **installed** main-checkout
  root (`resolveInstalledHarnessRoot`) as `harnessRoot` so the settings retarget (main → worktree)
  actually fires for a worktree-run engine — fallback stays `projectRoot` when unresolved;
- **around the `build` dispatch** — sets `process.env.CLAUDE_CONFIG_DIR` to the sandbox and restores it
  in a `finally` (pass **and** throw), so no config-dir bleeds into `finish`; the sandbox is torn down
  in `run()`'s `finally` on every exit path;
- **before the `finish` step** (which opens the PR) — runs `versionGate` then `releaseGate`; a `!ok`
  verdict writes `.pipeline/HALT` and finish is not dispatched (no PR).

Every guardrail is invoked through the injectable `SelfHostGuardrails` bundle (`self-host/wiring.ts`),
so `test/engine/self-host/wiring.test.ts` drives the wired path with spies and asserts the bundle
activates as one unit (and none of it for a non-self-build). The normal-repo path is byte-for-byte
unchanged behind the single `selfHost` flag.

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
