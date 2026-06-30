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
- **Fresh session per step** — with `freshContextPerStep` (daemon/auto only; interactive
  `/conduct` leaves it off so the brainstorm→stories→plan design session keeps its
  context), the LLM session is reset before **every** executed step in the loop
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

**Daemon prd-audit routing (gap-class aware).** In an interactive run a blocking `prd_audit`
escalates to the recovery menu, where the human picks where to route. In a **daemon** run
(`mode: 'auto'`, `daemon: true`) there is no human, so the conductor routes by the audit's
`Gap-class` column (`classifyPrdAuditGaps`, `engine/artifacts.ts`):

- **Every blocking row is `impl-gap`** → the daemon owns BUILD, so it *self-heals*: emits a
  `kickback` (`prd_audit → build`), `navigateBack`s to `build`, rebuilds, and re-audits. This is
  bounded by `prdAuditSelfHeals` (cap `MAX_KICKBACKS_PER_GATE`); if the gap still isn't closed it
  writes `.pipeline/HALT` (`impl-gap unresolved after N build attempts`).
- **Any blocking row is a product/plan gap** (`intended-drift`, or an unclassifiable row)
  → closing it needs a human DECIDE amendment the daemon can't run (DECIDE steps are pre-seeded
  `done`), so it HALTs immediately (`product/plan gap needs human DECIDE`).

Re-auditing unchanged code yields the same verdict, so the daemon skips the default per-step
retries for a blocking `prd_audit` and routes straight away.

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
  args,mode}`, validated in `engine/config.ts` like `markdown_viewer`.
- **Gate** — `TerminalPromptHost.reviewArtifacts` shows the raw Markdown first (always-present
  fallback), then, for a file containing a mermaid fence, calls an injected `renderDiagrams`
  hook and logs any returned notice on the host's own channel (TUI-safe). `index.ts` wires the
  hook from the **merged** config (the preset is set user-level by `bin/install`).
- **CLI** — `conduct render-diagrams <file>...` (`engine/render-cli.ts`) renders on demand.
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

#### Halt-reconciliation: startup dashboard + main-advance re-kick (ADR-013)

PR #109 made the durable `.pipeline/HALT` marker authoritative at discovery, so a parked
feature stays parked across restarts until a human clears it. Halt-reconciliation adds two
things on top of that, without a parallel dispatch path:

- **Startup inherited-state dashboard (`daemon-dashboard.ts`).** Before any dispatch, the
  daemon scans `.worktrees/*/` (`.pipeline/HALT`, `conduct-state.json`) and the
  `.daemon/processed/` ledger and prints one grouped dashboard to **both** stdout and
  `daemon.log` — four groups with precedence **HALTED > PROCESSED > IN-PROGRESS > ELIGIBLE**.
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
one is attached. The log is size-capped (~1 MB, rotated once to `daemon.log.1`). The daemon
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

See `test/engine/daemon-log.test.ts` and `test/engine/daemon-observe-cli.test.ts`. The
pidfile path and the O_EXCL create flag stay confined to `daemon-lock.ts`
(`test/engine/daemon-lock-boundary.test.ts`); the log module reuses the exported
`daemonDir()` and never re-encodes the pidfile.

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
The `conduct-ts engineer projects | claim | land | handoff | poll | forget` subcommands are the
deterministic primitives the skill calls between human gates (`claim`/`poll`/`forget` drive the
Phase 9.3b github-issues intake — see below). `land`/`handoff` accept an optional `--source-ref
<owner/repo#N>` so an intake-originated idea reports back to its issue. The bare launcher also
accepts an idea directly: `conduct-ts engineer "<idea>"` (or `--idea "<idea>"`) drives one specific
idea and skips the intake poll.

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
   runs the **full DECIDE phase** in canonical order — brainstorm → complexity → stories →
   conflict-check → architecture-diagram → architecture-review → plan — behind `decide` +
   `assessComplexity` seams; any unapproved step (or a DRAFT ADR) **throws and fabricates nothing**.
   The complexity tier gates the middle three (Small skips conflict-check + architecture) and is
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
- **Issue ↔ PR linkage + auto-close (on implementation merge).** Commenting is not linking: GitHub's
  formal issue↔PR link and auto-close come from a closing keyword in a PR body. The issue reference
  travels WITH the spec via a committed **`.docs/intake/<slug>.md`** marker (`Source-Ref: owner/repo#N`),
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
