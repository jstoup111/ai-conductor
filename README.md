# James Stoup Agents

A custom development harness for Claude Code. Pure Markdown skills and agent personas that enforce
a disciplined SDLC: design docs, user stories with mandatory negative paths, conflict detection,
TDD with domain review, evaluator-gated code review, and dual retrospectives.

No custom runtime. Claude Code is the execution engine.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/.docs/claude-code) v2.0+
- Git
- A project to work on (Rails+PostgreSQL has full tech-context support; other stacks work with generic skills)
- Optional: [`uv`](https://docs.astral.sh/uv/) — enables the opt-in [Serena](https://github.com/oraios/serena) semantic-code MCP integration (see Install)

## Install

```bash
git clone git@github.com:jstoup111/ai-conductor.git
cd ai-conductor
./bin/install
```

This symlinks all 20 skills into `~/.claude/skills/` and installs the conductor CLI(s) to
`~/.local/bin/`. `./bin/install` also builds the TypeScript conductor bundle for you —
it runs `npm install && npm run build` in `src/conductor/` (in both first-run and
`--update` mode) and symlinks `conduct-ts` once the bundle exists. The build needs
Node >= 20.5 (the repo pins 20.19.2 via `.tool-versions`); if Node is too old or `npm`
is missing, the build is skipped with a warning and `conduct` still installs. See
[Choosing a Conductor](#choosing-a-conductor) below — both binaries coexist, `conduct`
is the default, `conduct-ts` is opt-in.

**Optional: Serena semantic code toolkit.** When [`uv`](https://docs.astral.sh/uv/) is
present, `./bin/install` offers an opt-in install of [Serena](https://github.com/oraios/serena)
(an LSP-backed semantic code-retrieval/editing toolkit). Once installed, `/bootstrap`
auto-registers it as a user-scope MCP server so it's available across your projects. Decline
the prompt (or install later with `uv tool install -p 3.13 serena-agent`) to skip it.

**Mermaid renderer.** `./bin/install` also offers a renderer for the architecture diagrams
and ADRs the harness generates, so you review them as visuals (not raw Mermaid) at the
approval gates. Pick a preset — `html` (default: a self-contained mermaid.js page opened in
your default browser; no native dependencies, works anywhere), `mmdc-png`/`mmdc-svg` (static
images via [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli)), or `none`.
The choice is stored as `mermaid_renderer` in `~/.ai-conductor/config.yml` and reused on every
run; under `conduct-ts` diagrams render automatically when an artifact is presented for
approval, or run `conduct render-diagrams <file.md>...` on demand. The opener is detected per
platform (macOS `open`, Linux `xdg-open`, WSL `wslview`/`explorer.exe`). With no renderer
configured, diagrams fall back to raw Markdown — never a blocker.

The `mmdc-*` presets need Chromium. On WSL, in containers, or when running as root — where
Chromium's setuid sandbox can't initialize — the renderer automatically launches with
`--no-sandbox` (and an explicit Chrome `executablePath` when a system Chrome is found). To take
full control of how Chromium launches, drop a Puppeteer config at `~/.ai-conductor/puppeteer.json`
(e.g. `{ "executablePath": "/usr/bin/google-chrome", "args": ["--no-sandbox"] }`); when present it
overrides the auto-detection.

Verify:

```bash
./bin/install --check
```

Update (after pulling new changes):

```bash
git pull
./bin/install
```

Uninstall:

```bash
./bin/install --uninstall
```

**Worktree-root guard.** Global-mutating installs (default and `--update` modes) refuse to run
when the installer's own checkout physically resolves under a `.worktrees/` directory — a build
worktree is deleted at ship time, so installing from one would leave every global bin, skill
symlink, and `settings.json` hook path dangling (issue #363). The guard resolves the physical
path (`pwd -P`), so a symlinked path can't hide it. `--check`, `--help`, and `--uninstall` are
unaffected. To deliberately install from a worktree anyway, pass `--allow-worktree-root`
(combinable with any mode, inert on a normal checkout):

```bash
./bin/install --update --allow-worktree-root
```

## Quick Start

### Interactive (recommended for first use)

```bash
cd your-project/
claude
```

Then in the Claude Code session:

```
/conduct
```

The conductor checks artifact state, tells you what to run next, and blocks when gates aren't met.
It walks you through all 18 steps:

```
/bootstrap → /explore (track) → /prd (product track) → /architecture-diagram
→ /architecture-review → /stories → /conflict-check → /plan
→ /writing-system-tests → /pipeline → /manual-test
→ /prd-audit (product track) → /architecture-review --as-built → /retro → /finish
```

### Automated

```bash
cd your-project/

# The inline pipeline runs under the `inline` subcommand (foreground; the
# counterpart to the background `daemon`).

# Fully automated — walk away and come back
conduct inline --auto "URL shortener with click tracking"

# Default — auto with interactive recovery on failure
conduct inline "Add user authentication"

# Manual oversight — REPL mode for conversational steps (explore, prd, stories, plan, architecture_review, manual_test)
conduct inline --interactive "Payment processing"
```

```bash
conduct --status          # Check progress (shows all 16 steps)
conduct --resume          # Pick up where you left off
conduct --step stories    # Run one step only
conduct --from plan       # Start from a specific step
conduct --reset           # Clear session state and start fresh
```

Daemon mode (`conduct-ts` only) — drive many pre-specced features unattended, each in its
own worktree, opening a PR on finish:

```bash
# Drain the backlog once: every eligible feature, then exit
conduct-ts daemon

# Cap at 10 features this pass
conduct-ts daemon --max-items 10

# Continuous: keep polling for new features, bounded by ceilings
conduct-ts daemon --continuous --max-runtime 3600 --max-cost 2000000
```

Daemon flags: `--continuous` (idle-poll instead of draining once),
`--max-items <n>`, `--max-cost <tokens>`, `--max-runtime <seconds>`,
`--idle-poll <seconds>`, `--max-idle-polls <n>`. Ceilings stop *starting* new
features; in-flight work always drains. The daemon runs **serially** (one feature
at a time) so the live session shows exactly the feature building — `--concurrency`
above 1 is clamped to 1 with a logged note (real concurrency is out of scope; see
`.docs/plans/2026-06-29-daemon-tmux-supervisor.md`).

**Finish-choice recording (`finish-record`).** The daemon's auto-mode finish step
records its outcome by shelling out to a dedicated subcommand rather than writing
`.pipeline/finish-choice` by hand:

```bash
conduct-ts finish-record --choice pr --pr-url <url> --pipeline-dir <abs-path>
conduct-ts finish-record --choice keep --pipeline-dir <abs-path>
```

- `--choice pr|keep` — `pr` (requires `--pr-url <url>`) verifies the PR exists and
  that `HEAD` was pushed before recording `pr_url` into `conduct-state.json` and
  writing the marker; `keep` writes the marker only.
- `--pipeline-dir <abs-path>` is required and must be an absolute, existing
  directory.
- **Fail-closed:** any gate failure (bad flags, unverifiable PR, unpushed `HEAD`,
  corrupt state, etc.) exits 1 and writes nothing.

It's invoked by the daemon's auto-mode finish step (`src/conductor/src/engine/step-runners.ts`)
and can also be run manually in place of hand-editing the marker. See
`src/conductor/README.md` for full detail.

**Finish-step engine completion machinery (#499, ADR D1-D5).** The finish step's
presentation-branch gate now includes several deterministic engine-side mechanisms to repair
stale PR state, verify draft-readiness, and handle surgical retries (all fail-open on errors):

1. **Order-gated in-step presentation repair** — The completion predicate verifies
   non-presentation conditions first (valid `finish-choice`, recorded `pr_url`, push
   evidence), then invokes repair (`rehabilitateHaltPr`, undraft, unlabel, retitle, Closes
   injection) **before** evaluating presentation conditions (title, draft). A finishing
   attempt that fails on recording/push evidence never clears `needs-remediation` signals,
   so redispatch and reconciliation keep working.

2. **Deterministic retitle-floor** — If the recorded PR's title still starts with
   `needs-remediation:`, the engine rewrites it to `feat: <feature_desc>` (fallback: branch
   name). The `/pr` skill's prose rewrite is the quality path; the floor only fires when the
   agent dropped the rewrite (prefix-gated), logged, and any later `/pr` pass improves it.

3. **Draft-readiness check (`isDraft`)** — The finish predicate reads `gh pr view isDraft`
   and rejects ship-readiness if the recorded PR is still draft (issue #439). Draft removal
   is handled by the in-step repair's `ensureShipReady` call.

4. **Surgical finish-record retry** — When recording is the only missing piece (`.finish-choice`
   or `pr_url` absent/stale) and every other condition holds, the engine retries with a
   narrow prompt naming just `conduct-ts finish-record --pipeline-dir <path>`, not the full
   ~10-minute finish skill re-walk.

5. **Engine behavior documentation** — `finish/SKILL.md` and `pr/SKILL.md` now document
   the engine's presentation repairs (undraft, unlabel, Closes, draft flip) as executed
   machinery, resolving the prior contradiction between the two skills. The agent-owned
   prose rewrite instruction remains (with the retitle-floor as backstop).

See `src/conductor/README.md` (§ Finish-step engine completion machinery) and
`adr-2026-07-11-finish-step-engine-completion-machinery.md` for full design details.

**Task attribution automation (`task start|done`)** — The pipeline now automates task progress tracking
via `conduct-ts task` subcommands, which own the mechanics of updating `.pipeline/task-status.json`
and git hook wiring. Instead of editing JSON by hand or relying on prompt discipline, the orchestrator
calls:

```bash
# Before dispatching a subagent to work on a task
conduct-ts task start <id>

# After the subagent's commit lands (task complete)
conduct-ts task done <id>
```

- `<id>` is the bare task ID from the plan header (e.g., `7`, not `task-7`).
- `task start` flips the task status to `in_progress` in `.pipeline/task-status.json`.
- `task done` marks the task `completed` and clears the in-flight marker.
- Both commands are **deterministic and idempotent** — running them multiple times is safe.
- They fail gracefully on missing/corrupt state; orchestrator can continue.

**Git hook wiring (worktree-scoped, fail-open)** — When a daemon builds a feature worktree,
the conductor provisions two **deterministic attribution hooks** (run from the engine, not the prompt)
to capture proof that a task's code commits are load-bearing:

- **`prepare-commit-msg` hook** — Auto-injects the `Task: <id>` trailer (or amends a malformed one)
  from `.pipeline/current-task` so every commit carries the required attribution trailer.
- **`commit-msg` hook** — Validates the trailer format (non-empty id, no false-positive noise).

Both hooks are written to `.pipeline/git-hooks/` and wired via git config (`core.hooksPath`)
scoped to the worktree only — the host checkout is never affected. **Fail-open design:**
if hook provisioning fails, the build continues (hooks are logged as skipped, not fatal);
the engine's later evidence gate will derive completion from git trailers whether hooks ran
or not.

**Chaining with repo's own hooks** — The wired hooks chain to the repository's own hooks
(if any exist under `.git/hooks/`), so a repo's custom pre-commit linter or post-commit
automation is not disabled. The engine's hooks run first, and exit codes propagate.

For implementation details and hook asset definitions, see `src/conductor/src/engine/git-hook-assets.ts`
and `src/conductor/README.md` → "Task attribution automation".

**Session-hook stamping at subagent dispatch (#477)** — Git-trailer attribution proves a task's
commits happened, but it fires at commit time, after the fact. A second, earlier layer stamps task
state at the moment a subagent is actually **dispatched**, independent of whether the dispatching
agent remembers to call `conduct-ts task start|done` itself.

When the daemon provisions a feature worktree, it writes two scripts —
`.pipeline/session-hooks/pre-dispatch.sh` and `.pipeline/session-hooks/post-dispatch.sh` — and wires
them as Claude-session `PreToolUse`/`PostToolUse` hooks (matcher `Task|Agent`) in that worktree's
`.claude/settings.local.json`. Every subagent dispatch (the `Task`/`Agent` tool call) passes through
these hooks before and after the subagent runs.

**The line-1 dispatch-marker contract:** every dispatch template's prompt MUST start with exactly one
of these as its first line:

```
Task: <id>
```
```
Task: none
```

`<id>` is the bare task id from the plan header (e.g. `7`), matching a row in
`.pipeline/task-status.json`. Templates that dispatch implementation work (the `pipeline` skill's
per-task DISPATCH step) use `Task: <id>`; templates that dispatch non-implementation work
(evaluator/`code-review`, `/simplify`, micro-retro, memory-checkpoint) use `Task: none`. Only line 1
is parsed — a later line, or an unrelated `Task:`-looking token in the prompt body (e.g. commit
trailer instructions), is invisible to the hook.

**What the hooks do:**
- `pre-dispatch.sh` (`PreToolUse`) parses line 1 of the dispatched prompt. `Task: <id>` flips that
  task's row to `in_progress` in `.pipeline/task-status.json` and writes `.pipeline/current-task`
  (atomic temp-file + rename); an existing stamp for a *different* id is removed first (overlap
  guard). `Task: none` is a pass-through no-op.
- `post-dispatch.sh` (`PostToolUse`) removes the `.pipeline/current-task` stamp if it still matches,
  once the subagent returns. It never writes `completed` — task completion is still derived from the
  evidence gate (#456/#463), not from the hooks.

**Fail-open vs. fail-closed:** the two failure regimes are deliberately different.
- **Fail-open (exit 0, no state change):** the hook cannot parse the payload at all (e.g. malformed
  JSON on stdin). This mirrors #452's abstain path — an unreadable signal must never block dispatch.
- **Fail-closed (exit 2, blocks dispatch):** the payload parses but line 1 violates the grammar —
  unknown task id, missing marker, wrong format (`Task:7`, `task: 7`), or two ids on one line. stderr
  names the problem so it's actionable. This is a deliberate machinery-enforced guard against
  drift in dispatch-template authoring (see this repo's "Design Principles": deterministic
  enforcement over prompt discipline).

**`settings.local.json` ownership:** `.claude/settings.local.json` inside a feature worktree is
**untracked and engine-managed** — the daemon writes/merges it on every worktree provisioning pass,
preserving any unrelated keys and backing up (not discarding) a corrupt file before rebuilding it.
It is never committed and never read as project config; do not hand-edit it inside a build worktree,
since the next provisioning pass will merge over the hook entries again (identified by the
`session-hooks/` path in the wired command).

For implementation details, see `src/conductor/src/engine/session-hook-assets.ts` (hook script
bodies), `src/conductor/src/engine/worktree-prepare.ts` (provisioning/wiring), and
`src/conductor/README.md` → "Session-hook task stamping at subagent dispatch".

### Priority scheduling for issue-labeled backlog items

When a GitHub issue is labeled with priority metadata, the daemon orders eligible
features by priority band **after** passing the eligibility gate. This enables
human-driven build prioritization without changing the gate logic.

**Priority bands (highest to lowest):**
- `priority: critical` — fixes for complete breakage or very severe degradation; dispatched first among issue-linked work
- `priority: high` — highest routine priority
- `priority: medium` — standard priority
- `priority: low` — lower priority
- Unlabeled (no priority label) — fallback chronological order

**Label vocabulary:**
The daemon reads GitHub issue labels via the REST API on each daemon scan.
Label names are exact matches: `priority: critical`, `priority: high`, `priority: medium`, `priority: low`.
If an issue has multiple priority labels, the highest-priority one wins.
Mixed or malformed labels are ignored (safe-fail).

**Refresh behavior:**
Labels are fetched fresh on each daemon scan (no caching across runs).
Within a single scan, results are cached (one network fetch per issue).
On reader failure (GitHub API outage, auth error), the daemon gracefully
degrades to chronological ordering and logs a single warning per outage.
When GitHub recovers and the next scan succeeds, the warning resets.

**Dashboard visibility:**
In the startup inherited-state dashboard, ELIGIBLE items now show a `[band]`
suffix indicating their priority band (e.g., `feature-name [high]`).
When in fallback mode (reader failure), a `[fallback]` marker appears on
all ELIGIBLE items, signaling that ordering is chronological.

**Interaction with other gates:**
Priority ordering is applied **post-gate**, after eligibility checks.
It never overrides the eligibility gate, park markers, deduplication,
owner gating, or dependency resolution — those gates remain unchanged.
A feature ineligible for any reason stays out of ELIGIBLE regardless
of its priority band.

The daemon consumes existing specs — it never authors them — and only picks up
**eligible** features: a feature is eligible when its stories are approved
(`Status: Accepted`, not DRAFT) and its plan declares a task dependency tree
(`## Task Dependency Graph` or per-task `**Dependencies:**` lines), and it hasn't
already shipped. Ineligible features are skipped with a logged reason. A feature
that can't converge is left in its worktree (`.pipeline/HALT`) for you; the pool
keeps going.

**Daemon stall remediation (ADR-2026-07-10).** When the build step writes
`.pipeline/halt-user-input-required` (a question the agent couldn't autonomously
resolve), the daemon does not immediately halt. Instead:

- **Capture question** — the conductor reads the marker content before clearing it,
  persisting it to `.pipeline/build-stall-question.md` as evidence.
- **Dispatch `/remediate`** — the planner reasons over the question plus committed
  artifacts (plan, stories, ADRs, task-status) to determine if it's answerable.
- **Answerable** — the planner returns the answer in `.pipeline/remediation.json`
  with `tasks: []`. The conductor resumes the build retry loop with the answer as
  context (no retry burned), and the build proceeds.
- **Unanswerable** — the planner routes to a human (architectural-clarity,
  product-scope, or unanswerable). The conductor writes `.pipeline/HALT` with the
  original question preserved verbatim.
- **Fail-safe** — if remediation fails (dispatch throws), returns no valid disposition, or
  misroutes to a non-`build` target, `.pipeline/HALT` still carries the question. The operator
  never loses sight of what the agent needed.
- **Budget** — stall remediations share the existing `remediationRounds` counter (capped by
  `MAX_KICKBACKS_PER_GATE`; no new counter was added). Blocking `prd_audit` gaps draw from the
  same shared pool, so a run with both a build stall and a prd-audit gap can exhaust the budget
  faster than either alone. See `src/conductor/README.md` → "Daemon build-stall remediation" for
  the implementation (`readHaltMarkerContent`, `writeStallQuestionEvidence`, `writeStallHalt`).

A blocking SHIP gate tries to self-heal before it halts: the conductor dispatches the
`/remediate` planner over the gate's gap artifact — a blocking prd-audit
(`.pipeline/prd-audit.md`), a failed finish verification (`.pipeline/test-failures.md`), or a
BLOCKED as-built architecture review (`.pipeline/architecture-review-as-built.md`) — and routes
each fixable gap back to the right step with concrete tasks, reserving the HALT for gaps that
genuinely need a human decision (architectural clarity or product scope).

**Progress-aware build halt (`build_progress_halt`).** A build step that keeps resolving
tasks on every attempt — but hasn't yet cleared the completion gate — is no longer halted
just because it exceeded `max_retries`. As long as the resolved-task count keeps advancing,
the retry loop keeps re-dispatching (bounded by `attempt_ceiling`, default 30) instead of
marking the step `failed` at the fixed retry budget. A build that parked or halted while
still making progress is also eligible for a re-kick on the next daemon idle tick even if
`origin/main` hasn't advanced, bounded by `dispatch_ceiling` (default 20) per spec; once
that ceiling is hit the spec stops being progress-re-kicked (with an explicit logged reason)
but stays eligible for the normal base-advance `rekickSweep` or a manual operator unpark. A
true zero-progress build (no advancing resolved count) still parks at the existing threshold —
unchanged. Configure via a `build_progress_halt:` block in the project config:

```yaml
build_progress_halt:
  enabled: true          # default true; false reproduces the pre-change fixed-budget halt exactly
  attempt_ceiling: 30    # absolute per-dispatch backstop for a progressing build (must be >= max_retries)
  dispatch_ceiling: 20   # per-spec cap on cross-dispatch progress-gated re-kicks
```

Omit the block entirely to get the defaults above. See `src/conductor/README.md` for the
implementation details.

**Kickback→build no-op escalation (`kickback_escalation`).** A kickback→build re-entry
(e.g. from `as-built` review or `prd-audit`) that ends with zero net progress — no HEAD
movement and no increase in resolved-task count — AND leaves the gate's verdict unchanged
now HALTs loud on the first such cycle instead of silently re-kicking toward
`MAX_KICKBACKS_PER_GATE`. Configure via a `kickback_escalation:` block in the project config:

```yaml
kickback_escalation:
  enabled: true   # default true; false reverts to the prior re-kick-until-cap behavior
```

Omit the block entirely to get `enabled: true`. This only gates the zero-progress escalation
(D2); the route-into-no-op guard that recomputes build completion before routing a kickback
(D1) is fail-closed correctness and always stays active. See `src/conductor/README.md` for
implementation details.

On any irrecoverable daemon HALT that stranded committed work — a build/gating-step failure, a
prd-audit gap needing human DECIDE, the kickback/stuck-gate caps, or an unexpected error (rebase
conflicts excluded) — when the branch has at least one commit, the daemon pushes it and opens a
**draft PR** labeled `needs-remediation` with a comment explaining the HALT reason — best-effort
and non-blocking. PRs from successfully-shipped features
are enrolled in a watch registry (`.daemon/mergeable-watch.jsonl`); a label sweep (on startup,
after each feature, and each idle poll tick) keeps the `mergeable` label truthfully in sync with
CI and conflict state, so you can filter the PR list by merge-readiness. Both labels are
daemon-only; interactive runs are unchanged.

Opt-in via `mergeable_autoresolve: { enabled: true, cooldownMinutes: 60, suiteCommand: "..." }`
in your project config, the daemon can go further and **auto-resolve** conflicts on watched PRs
that drift to `CONFLICTING` instead of just labeling them: deterministic Tier-1 resolvers
(CHANGELOG, `.docs`) run first, unresolved conflicts fall through to the same gated `/rebase`
dispatch used at finish time (capped by `rebase_resolution_attempts`), and an accepted
resolution must pass acceptance guards (rebase clean, branch current, no dropped commits) and,
if configured, a fail-closed `suiteCommand` before a lease-protected
`git push --force-with-lease`. Any failure at any stage escalates to `needs-remediation`
instead of retrying blindly. See `src/conductor/README.md` → "Auto-resolve conflicts on open
watched PRs" for the full pipeline.

On by default (`ci_watch: { enabled: true }`, no config needed), the daemon also watches each
shipped PR's CI checks and drives bounded auto-remediation of red ships: a failed check rollup
gets a `ci-failed` label and, if attempts remain, an isolated-worktree fix attempt using a
RETRY hint built from the failing check names and log excerpts — capped at **2 attempts per
PR**, gated by a cooldown, and never engaging while the PR is `CONFLICTING` (conflict
resolution takes precedence) or already carries `needs-remediation`. A green result clears the
`ci-failed` label and resets the attempt counter; exhausting both attempts escalates exactly
once — sticky `needs-remediation` label, an upserted comment with the failure history, and a
HALT-grade `ci_failed` event tailed by the halt-monitor. Set `ci_watch: { enabled: false }` to
opt out. See `src/conductor/README.md` → "CI feedback loop on shipped PRs" for the full
pipeline.

On startup, before any dispatch, the daemon prints a grouped **inherited-state
dashboard** (HALTED / IN-PROGRESS / **WAITING** / ELIGIBLE / PROCESSED) to both your
terminal and `daemon.log`. Each row shows the bits you triage on — complexity tier, the step a
feature reached, and the PR link once one is open (shipped features list their PR too).
**WAITING** lists build-ready specs held back by an unresolved GitHub issue dependency (a
`Source-Ref:` marker linked via GitHub's issue-dependencies API): the gate resolves each spec's
blocker chain and holds it out of ELIGIBLE until every blocker closes, distinguishing "blocked
by another open issue," "blocked by a dependency cycle," and "indeterminate" (a `gh` API error
or unparseable marker — fails closed, never dispatched). The engineer's intake claim similarly
skips blocked ideas and claims the oldest **unblocked** one, reporting a distinct "all-blocked"
outcome (never confused with an empty queue) when every pending idea is stuck. A one-time
`conduct-ts engineer migrate-issue-deps [--confirm]` command migrates repos whose issues
describe dependencies as prose into real GitHub issue-dependency links so the gate can see them.
See [`src/conductor/README.md`](src/conductor/README.md#dependency-ordered-intake-and-dispatch)
for details.

**Claim ordering honors priority bands.** `conduct-ts engineer claim` serves pending
intake ideas **priority-band-first**: no-issue (no `sourceRef`) first, then
`critical` → `high` → `medium` → `low`, with unlabeled ideas last. Within a band,
ideas are served **oldest-first** by `receivedAt` (a stable sort, so ties never
reorder). Priority labels are read from GitHub **at claim time** — not cached
across claims — so relabeling an issue between claims is honored on the very next
claim. If GitHub is unreachable (API outage, auth error) when resolving labels,
the claim **fails open to plain FIFO order** and logs a single warning to stderr;
it never blocks or drops the claim. This ordering only changes *which* pending
idea is served first — the claimed idea's JSON output shape is unchanged:
`{kind, text, source, sourceRef}`.
It also tracks the base-branch tip SHA (`.daemon/last-base-sha`): when
the base branch **actually advances** — live, or while the daemon was down — it
**re-kicks every halted feature** (aborting any paused rebase, preserving the reason
to `.pipeline/HALT.cleared`, clearing `.pipeline/HALT`) so parked work retries
automatically on the event most likely to unblock it, resuming **rebase-first** so the
advanced base is integrated before the failed gate re-checks. A plain restart with no
advance leaves every marker intact. See
[`src/conductor/README.md`](src/conductor/README.md#halt-reconciliation-startup-dashboard--main-advance-re-kick-adr-013).

The daemon is hosted as a **foreground process inside a per-repo tmux session**
(`cc-daemon-<slug>`), so you can attach to a *running* daemon on demand — in full color
— and restart or debug it without hunting for a pid. Its output is still teed to an
append-only **`.daemon/daemon.log`** (size-capped, rotated once) so the full narrative
survives. Each persisted line is prefixed with an ISO-8601 UTC timestamp so activity
read back via `daemon logs` can be correlated in time (the live console stays
uncluttered). Management requires `tmux` on the host; the daemon still builds with no
tmux present (management is purely additive).

```bash
conduct-ts daemon start      # start the daemon in a tmux session (idempotent — no duplicate)
conduct-ts daemon connect    # attach READ-ONLY to watch live, in color (Ctrl-b d to detach)
conduct-ts daemon debug      # attach read/write — Ctrl-c to pause the loop and inspect
conduct-ts daemon restart    # fresh inner process, same session
conduct-ts daemon stop       # stop the daemon, release the lock
```

Two read-only observability commands surface state without attaching:

```bash
# Liveness of every registered repo's daemon (running / stale / stopped, session up/down) + last activity
conduct-ts daemon status

# View or tail a repo's daemon log (default: current dir)
conduct-ts daemon logs
conduct-ts daemon logs --follow            # tail -f
conduct-ts daemon logs --repo /path/to/repo
conduct-ts daemon logs --all               # every registered repo
```

The management/observability verbs (`start`/`stop`/`restart`/`connect`/`debug`/`status`/
`logs`) are dispatched before the bare `conduct-ts daemon` run, so they're never mistaken
for a launch — and `conduct daemon <verb>` (the bash wrapper) now forwards to `conduct-ts`
instead of starting a feature build named after the verb.

**Restart semantics:** `conduct-ts daemon restart` performs an in-place restart while preserving
your tmux session, window layout, and any operator windows. The pane survives the restart
(remain-on-exit armed), so you stay connected in color. If the daemon is busy (features
in-flight), the restart queues durably via `.daemon/RESTART-PENDING` and fires when idle.
Restart also relinks skills preflight (self-host only), ensuring a fresh harness is active.
See [`src/conductor/README.md`](src/conductor/README.md#daemon-lifecycle-controls-pause-resume-restart)
for the full lifecycle flow, including stale-engine auto-restart, respawn-in-place, and
headless fallback behavior.

**Operator park.** Prevent a worktree from being re-kicked or re-dispatched without stopping the
daemon:

```bash
conduct daemon park <slug>    # Parks the worktree; will not re-kick or dispatch until unparked
conduct daemon unpark <slug>  # Resumes normal re-kick and dispatch
```

The park state is stored in `.daemon/parked/<slug>`, validated against a known plan
(`.docs/plans/<slug>.md`) or worktree (`.worktrees/<slug>`) before writing. **Operator-parked is
not the same as HALTed:** a HALT (`.pipeline/HALT`) is written by the pipeline itself and cleared
automatically by re-kick; an operator-park is placed by a human and survives both — clearing a
HALT does not unpark a slug. Unlike a HALT, an operator-parked worktree preserves its REKICK
sentinel and resumes re-dispatch right where it left off once unparked. The status dashboard's
PARKED group takes absolute precedence over every other group (HALTED, ELIGIBLE, etc.) — a parked
slug always shows there and nowhere else. See
[`src/conductor/README.md`](src/conductor/README.md#operator-park--unpark) for details.

**Event-driven re-dispatch on HALT clear.** When a parked (halted) feature's `.pipeline/HALT` marker is cleared — either by a human operator, base-branch re-kick, or another process — the daemon detects the change via filesystem watch (chokidar) and immediately re-dispatches the feature without waiting for the next idle poll. This reduces recovery latency from up to 60 seconds (idle-poll window) to sub-second response times when HALT is cleared live.

- **Without filesystem watch (`--no-watch`):** the daemon falls back to polling, discovering the cleared HALT within the next idle-poll interval (default 60s).
- **With filesystem watch (default):** the daemon registers a filesystem watcher for each parked feature and fires an event-driven wake signal when the marker is removed, triggering immediate re-dispatch.

The daemon's `--idle-poll` default increased from 5s to 60s (Task 11: Optimization) since event-driven wake now handles the hot path. Override with `--idle-poll` or `--no-watch` if you need polling-only behavior:

```bash
# Default: event-driven wake + 60s polling fallback
conduct-ts daemon --continuous

# Opt-out of filesystem watch (legacy polling-only, 60s interval)
conduct-ts daemon --continuous --no-watch

# Custom polling interval (ignores filesystem watch)
conduct-ts daemon --continuous --no-watch --idle-poll 5
```

**Latency implications:**
- **New spec discovery:** max latency is 60s (was 5s); polling is the backstop when a spec is first committed.
- **HALT clear on parked feature:** sub-second with event-driven wake (was 5-60s polling window).

**Auto-restart on stale engine (self-host only).** In self-host mode, before starting each feature
(and at idle) the daemon rebuilds its engine from the fast-forwarded source (content-addressed —
a no-op when unchanged, an atomic `dist` flip otherwise) and checks whether the running engine has
gone stale. When it has and no tasks are in-flight, the daemon writes a `.daemon/RESTART-PENDING`
marker (carrying engine identity metadata) and exits cleanly at the next idle point. On restart,
the daemon's startup handshake captures the fresh engine identity, detects any non-convergence
(target identity differs from fresh identity), and clears the marker before dispatch. An external
respawn transport relaunches with fresh code so the next feature builds on it. Firing at the
dispatch boundary — not only when the backlog drains — ensures freshly-merged specs are never
built on stale engine code (the rebuild is required because build artifacts are untracked, so a
merge alone never moves `dist`). It never interrupts an in-flight build. Enable with
`auto_restart_on_stale_engine: true` in your project config; ignored in non-self-host
environments and disabled in once-mode runs. See `src/conductor/README.md` → "Daemon lifecycle
controls" for the full handshake and suppression flow. Requires PR #215 respawn transport for
deployment.

On failure, conduct sends a desktop notification and drops into an interactive Claude session
to fix the issue. After you `/quit`, it rechecks artifacts and continues automatically.

**Main-checkout leak triage and auto-heal (self-host only).** Self-host builds in worktrees
sometimes leak edits into the main checkout — a dirty tree that blocks base-tracking fast-forward.
When fast-forward detects a dirty tree, leak triage now classifies every dirty file/untracked stray
against candidate branch heads (daemon worktrees prioritized, then local `feat/*`). If a SINGLE
branch explains ALL dirty entries via byte-identity match, auto-heal runs: `git restore` tracked
files, delete untracked strays, log one WARN naming the culprit branch and healed paths, then
proceed with fast-forward. Unexplained dirty trees escalate from a one-line skip to a loud
LEAK-SUSPECT WARN with per-file diff-stat so stalls are never silent. Operator work is safe:
heal requires whole-tree byte-identity to a known branch, so ambiguous dirtystate keeps hands off.
See `src/conductor/README.md` → "Main-checkout leak triage and auto-heal" for the detailed
implementation and guarantee model.

**Setup-failure triage (self-host only).** When `bin/setup` fails while preparing a daemon
worktree, a bounded two-stage recovery runs instead of leaving the wedge for an agent to
untangle blind: dirty state is first quarantined to a `wip/setup-quarantine-<slug>` branch and
setup is retried once at clean HEAD; if it still fails, exactly one fix-session is dispatched
with the setup error tail, and the engine mechanically verifies the success contract (setup
exits 0, tree clean) rather than trusting the agent's report. See `src/conductor/README.md` →
"Setup-failure triage" for the detailed stage flow.

**Write-fence sandbox for self-host builds (self-host only).** When a self-host build runs in a
sandbox, it now has a daemon-owned PreToolUse hook that blocks writes to the harness main checkout
outside the build worktree. Edit, Write, MultiEdit, and NotebookEdit targeting paths under the
harness root but outside `.worktrees/` are blocked with guidance to use the worktree path; Bash
commands referencing main-checkout paths are heuristically screened and blocked (the deterministic
leak-triage/auto-heal layer backstops any misses). The fence never fires on worktree-internal
paths, OS temp directories, or unrelated repos. See `src/conductor/README.md` → "Write-fence
sandbox for self-host builds" for the implementation and boundary cases.

### Rate-Limit Episode Coordination

API providers periodically enforce rate limits — sudden hard stops when usage hits ceilings.
An uncoordinated daemon with N concurrent features all hitting the same limit creates a
**thundering herd**: each worker waits independently, then all retry at once, triggering
cascading HALTs and 300-second wedges that ignore SIGTERM signals.

**The solution:** a shared **rate-limit episode** coordinator running alongside the daemon.
When a provider signals rate-limiting (HTTP 429, "usage limit" messages, or session-limit
detection), the coordinator:

1. **Captures the deadline** — parses reset time from the provider message (e.g., "3:20pm
   America/New_York") into an absolute wall-clock deadline, timezone-aware.
2. **Coordinates N concurrent workers** — all in-flight conductors wait until the deadline
   instead of fixing durations, then resume staggered (jitter) so they don't re-collide.
3. **Pauses new dispatch** — while an episode is active, no new features start (in-flight work
   continues); dispatch resumes when the deadline passes.
4. **Handles SIGTERM gracefully** — rate-limit waits are abortable, so the daemon can shut down
   cleanly even mid-wait without hanging or wedging.
5. **Self-heals episode-caused HALTs** — when the episode clears, previously-halted features
   are automatically re-kicked (without re-kicking them on every base-SHA advance).
6. **Propagates rate-limited signals** — pre-step rate-limit detection (before a step runs)
   prevents a redundant wait inside the step, triggering escalation instead.

**Detection:** Session-limit classification detects observed messages (PRIMARY fix for the
2026-07-03 incident) in addition to the standard 429 codes. This catches subtle API responses
that don't set HTTP status but clearly signal exhaustion.

**Configuration & restart**: The episode coordinator lives as an in-process singleton in the
daemon, created once at startup. Autonomous restarts (on stale engine) preserve the shared
coordinator across the restart boundary, so an in-flight wait doesn't get orphaned.

### Halt-PR presentation reliability

When a daemon feature HALTs irrecoverably (build failure, unresolved gap, or gating step failure), it
escalates by opening a **draft PR labeled `needs-remediation`** with a failure comment so the operator
can triage. A halt PR that loses its draft status or label is indistinguishable from a ready feature PR
and could slip past merge-order sweeps as mergeable — **a critical safety gap.**

**Guarantee:** halt PRs now reliably carry three durable markers:

1. **Draft status** — the PR is unpublishable (`isDraft: true`)
2. **`needs-remediation` label** — human-scannable halt signal
3. **Body marker** (`<!-- conductor:needs-remediation -->`) — durable enumeration anchor for
   reconciliation when the label/draft are lost

**Mechanism:**

- **Verify-after-write:** when escalation opens or reuses a PR, it writes draft status, label, and
  body marker, then **re-reads to confirm** all three are present, with bounded retry (3 attempts,
  100ms backoff) before moving on.
- **Reconciliation sweep:** on daemon startup and each idle poll tick, a background sweep enumerates
  open PRs carrying the body marker, spots-checks draft + label, and heals any that drifted (converts
  to draft, re-adds label) — so PRs broken before this code shipped or by concurrent checkouts
  self-recover without operator intervention.
- **Finish cleanup:** when a halt PR is successfully remediated and shipped, the finish phase removes
  the `needs-remediation` label, converts the PR to ready, and strips the body marker (verify-after-write)
  so the reconciliation sweep never re-halts it.

All operations are **best-effort** and **non-throwing** — they never block daemon progress. The
reconciliation sweep is idempotent (never removes halt markers, only re-asserts them). See
`src/conductor/README.md` → "Halt-PR presentation reliability" for the implementation reference.

Engineer mode (`conduct-ts` only) — an **agent-hosted, human-gated** loop that turns a free-form
idea into a routed, lesson-informed **spec PR**. It never builds and never merges (a merged spec PR
is the only idea→build handoff). As of Phase 9.3 there is no Node REPL and no spawned `claude` — the
host agent drives routing and the real DECIDE skills in-chat over deterministic TypeScript primitives:

```text
add a CSV export to the reporting tool
  → intake parses the idea into an Envelope (empty text is rejected, not dropped)
  → routes it across your registered projects (conduct register / create)
  → asks you to confirm:  confirm | decline | redirect <project> | create <path>
  → pulls relevant prior lessons from the engineer store into the spec
  → runs the FULL DECIDE phase for real, in canonical order: explore (track) → complexity →
    prd (product track) → architecture-diagram → architecture-review → stories →
    conflict-check → plan (tier-aware: Small skips conflict-check + architecture); the
    assessed tier is recorded at .docs/complexity/<slug>.md and consumed by the target's daemon
    (artifacts under .docs/ only; never a stub/DRAFT story or DRAFT ADR, never a spawned claude)
  → opens a spec PR, then ensure-running brings up the target's daemon
```

Every write is gated on your confirmation (decline = zero writes); authoring is **cross-repo
isolated** (repo A never touches sibling repo B; a stale target path fails fast) and multi-repo
**fan-out** authors each confirmed target independently. A no-remote target still commits the spec on
a branch (PR step is a non-fatal skip). Registry/store locations come from `$AI_CONDUCTOR_REGISTRY` /
`$AI_CONDUCTOR_ENGINEER_DIR`. See `src/conductor/README.md` for the full flow and the pidfile-lock
daemon liveness model (`ensureRunning`, one-per-repo `O_EXCL` mutex, stale-pid reclaim).

Handles API rate limits by waiting for reset and auto-retrying.

### Claim-time delivery guard and recovery

The engineer's intake system is resilient to duplicate captures and write-back failures:

**Claim-time delivery guard (auto-healing duplicate dispatch).** When `engineer claim` is called, the intake system checks the ledger for entries that were claimed and delivered (prUrl present) but whose envelopes were re-captured as duplicates. If the PR is OPEN or MERGED, the entry is marked done and the duplicate envelope is dropped without being served to the session — reducing friction from duplicate captures. If the PR state is unknown (API unavailable, closed without merging), the envelope is held without mutation and released on the next claim if status resolves. Unknown-state envelopes are never re-served, preventing stalled-write issues from blocking the queue.

**`engineer resolve` recovery subcommand.** Recovers from write-back failures (e.g., local-commit completed but the spec PR was never delivered, or a network timeout during handoff) by marking a stranded intake entry as delivered. 

```bash
conduct-ts engineer resolve <sourceRef> --pr-url <url> [--branch <branch>]
```

Example:

```bash
# Mark issue o/a#123 as delivered with PR proof
conduct-ts engineer resolve o/a#123 --pr-url https://github.com/o/a/pull/456

# Optionally override the branch name (default: preserved from ledger)
conduct-ts engineer resolve o/a#123 --pr-url https://github.com/o/a/pull/456 --branch spec/main-fix
```

The command is **idempotent** — running it multiple times on the same entry with the same prUrl is safe and produces no additional mutations. An unknown sourceRef returns `found:false` and never creates a ledger entry.

**Integration: resolve + claim compose.** After resolve marks an entry delivered, a subsequent `engineer claim` with a duplicate envelope for that entry invokes the delivery guard, which heals and drops it — completing the recovery cycle end-to-end.

See `src/conductor/README.md` for the full implementation details.

### Brain Loop Supervision

`conduct-ts` can host the GitHub-issues intake poll as a **background daemon** instead of a
cron job, so idea capture keeps running without a scheduled task or a live terminal:

```bash
conduct-ts brain start   # launch the intake loop in a detached tmux session
conduct-ts brain status  # report whether it's running + how many issues are queued
conduct-ts brain stop    # kill the session
```

- **`brain start`** launches a host-wide singleton tmux session (one per machine, not
  per-repo) running `conduct-ts intake-loop --continuous`. Idempotent — calling it again
  while already running prints `brain loop already running.` instead of spawning a duplicate.
- **`brain status`** reports `brain loop: running|stopped` plus `queued: <n>` read from the
  status surface written by the loop (see `src/conductor/README.md` → "Intake Loop Automation").
- **`brain stop`** kills the tmux session; safe to call when nothing is running.
- **Alternative to cron, zero-token execution.** The loop only polls GitHub via `gh` and
  writes to the local ledger/inbox — it never spawns `claude` or opens a PR, so running it
  continuously costs no model tokens.
- **Single-writer guarantee.** When the brain loop is live, the interactive
  `conduct-ts engineer` launcher's manual pre-poll is skipped (see
  `src/conductor/README.md` → "Intake Loop Automation") so the two paths never race the
  same ledger.

### Intake-Issue Shape: WHAT vs. HOW

Intake issues follow a strict format that separates **WHAT** (the problem and desired state)
from **HOW** (the solution approach). This division ensures that intake captures observable
facts and outcomes, while implementation decisions remain the engineer's (DECIDE phase) responsibility.

**The four sections:**

1. **Observed** (required) — Evidence of the problem. What did you actually observe?
   Factual description of the current state, without jumping to solutions.

2. **Impact** (optional) — Who or what is hurting, and how often? Describes the scope
   and frequency of the problem to help prioritize.

3. **Desired outcome** (required) — Observable behavior that must hold afterward.
   State what success looks like in measurable, observable terms, not in terms of implementation.

4. **Hypotheses** (optional) — Your guesses about HOW to solve this. These are candidate
   ideas—DECIDE treats them as one option among many and may discard them in favor of alternatives.
   Hypotheses are the ONLY place for implementation suggestions in an intake issue.

**WHAT vs. HOW principle:** Intake issues state the **WHAT** (problem definition and desired outcomes);
the engineer during the DECIDE phase owns the **HOW** (implementation, design, technical approach).
Never prescribe implementation details, technology choices, or internal mechanisms in the Observed,
Impact, or Desired outcome sections — those belong in Hypotheses *only*, and even there they're
advisory, not binding.

**References:**
- [Intake idea issue template](.github/ISSUE_TEMPLATE/intake.yml) — The template that enforces
  this shape when filing issues on the web or via `gh issue create`.
- [HARNESS.md Key Conventions](HARNESS.md#key-conventions) — "Intake states WHAT and outcomes — DECIDE owns HOW"
  documents this rule in detail.

## Choosing a Conductor

Two conductor binaries ship together. Both drive the same 16-step SDLC pipeline and read
the same `.pipeline/` state, so you can switch between them per-invocation. `conduct`
remains the default; `conduct-ts` is the in-progress rewrite — stable enough to use
day-to-day, but the surface is still changing.

|                              | `conduct` (bash, stable)                      | `conduct-ts` (TypeScript, opt-in)                                |
|------------------------------|-----------------------------------------------|------------------------------------------------------------------|
| **Status**                   | Reference implementation                      | Active rewrite — feature parity ongoing                          |
| **Install**                  | Always symlinked by `bin/install`             | Built + symlinked by `bin/install` when Node >= 20.5 is active   |
| **Build step**               | None                                          | `bin/install` runs `npm install && npm run build` in src/conductor/ |
| **CLI flags**                | Full surface (`--auto`, `--interactive`, …)   | Same flags, fully wired                                          |
| **Dashboard**                | Terminal status log                           | Event-driven renderer with live-region updates and tail pane     |
| **Completion gates**         | Artifact grep                                 | Typed events + structured gate-runner                            |
| **Auto-heal**                | None                                          | Reconciles stale `task-status.json` against git log before retry |
| **Pluggable UI**             | No                                            | Yes — UI is a subscriber behind the engine                       |
| **Test coverage**            | `test/test_conduct_worktree.sh`               | 673 vitest tests across engine/execution/UI/integration          |
| **Pinned Node**              | N/A                                           | Reads `src/conductor/.tool-versions` via asdf                    |

**Default:** use `conduct`. Everything in this README's examples works.

**Try `conduct-ts`** when you want the richer dashboard or auto-heal, or if you're helping
test the rewrite. Drop-in replace the binary name in any command; if a flag isn't
supported yet, commander will tell you.

### Command syntax and unknown-command guard

Both conductors validate command-line arguments strictly. Unknown options and bare single-word
commands are now rejected loudly with helpful error messages instead of silently launching the
pipeline. This prevents accidental typos and makes the CLI more discoverable:

- **Feature descriptions must be quoted multi-word strings:** `conduct "add user login"` (correct) 
  vs `conduct auth` (rejected — bare word).
- **Unknown options fail early:** `conduct --frobnicate` now prints "Unknown option: --frobnicate" 
  and suggests `--help` instead of silently treating it as a feature description.
- **Conduct-TS forwarded verbs are documented:** Verbs like `daemon`, `render-diagrams`, 
  `engineer`, etc. are forwarded to conduct-ts if it's available on PATH. Run `conduct --help` 
  to see the full list.

For details, see [Unknown-Command Guard](https://github.com/anthropics/ai-conductor#unknown-command-guard).

Both binaries read `~/.ai-conductor/config.yml` (user-level) and the project's
`.ai-conductor/config.yml` if present. Legacy `~/.claude/ai-conductor.config.json` is
read as a fallback for installs that predate the YAML migration.

See `src/conductor/README.md` for the three-layer architecture (Engine / Execution / UI)
behind `conduct-ts`.

## Configuration

The harness reads two config files, merged in order (project overrides user):

| File | Scope | Purpose |
|------|-------|---------|
| `~/.ai-conductor/config.yml` | User-level | Personal defaults, update channel, markdown viewer, mermaid renderer |
| `.ai-conductor/config.yml` | Project-level | Per-project model/effort tuning, custom steps, plugin selection |

Both files are optional. The conductor works with zero config.

### Full reference

```yaml
# .ai-conductor/config.yml

harness_version: ">=0.99.0"   # Minimum harness version this config requires

# ── Global defaults ───────────────────────────────────────────────────────────
defaults:
  model: sonnet                 # "haiku" | "sonnet" | "opus" or full model ID
  effort: medium                # "low" | "medium" | "high" | "xhigh" | "max"
  max_retries: 3                # Retry budget before recovery-menu escalation

# ── Phase-level defaults (override global) ───────────────────────────────────
phases:
  BUILD:
    model: opus
    effort: high
  SHIP:
    model: sonnet

# ── Per-step overrides ────────────────────────────────────────────────────────
steps:
  # Override a built-in step
  prd:
    model: opus
    effort: max
    max_retries: 1

  # Disable a built-in step. Gating/structural steps cannot be disabled,
  # except gating steps whose StepDefinition opts in via `configDisableAllowed`
  # (currently only manual_test). A disabled step is marked `skipped`, which
  # satisfies downstream prerequisites and the gate-loop selector.
  assess:
    disable: true

  # Override the skill file for a step
  tdd:
    skill: .claude/skills/my-custom-tdd/SKILL.md

  # Add a custom step after an existing one
  my-security-scan:
    after: writing-system-tests
    skill: .claude/skills/security-scan/SKILL.md
    enforcement: advisory
    hooks:
      before: scripts/setup-scan.sh
      after: scripts/teardown-scan.sh

  # A custom step inserted among the gate-loop steps (build…finish) joins the
  # gate-driven loop automatically (inherits its `after` target's membership).
  verify-deploy:
    after: manual_test          # SHIP loop step → verify-deploy is in the loop
    skill: .claude/skills/verify-deploy/SKILL.md
    enforcement: gating
    # gate: true                # force loop membership (or `false` to opt out)
    # kickback_target: true     # let a downstream step re-open this gate

  # Tier-specific overrides (applied when complexity_tier matches)
  build:
    by_tier:
      L:
        model: opus
        effort: high
        max_retries: 5
      S:
        model: haiku
        max_retries: 2

# ── Model availability fallback ladder ────────────────────────────────────────
# When a configured/pinned model is detected unavailable, the daemon automatically
# retries the next model in this list instead of failing the step. Omit to use the
# default; set to `[]` to disable fallback entirely.
model_fallback_ladder: ["fable", "opus", "sonnet"]   # default shown

# ── Complexity tier ───────────────────────────────────────────────────────────
complexity:
  default_tier: M              # "S" | "M" | "L" — used when /assess hasn't run yet

# ── Plugin selection (conduct-ts only) ───────────────────────────────────────
llm_provider: claude           # Which registered LLM provider to use (default: "claude")
ui_renderer: terminal          # Which registered UI renderer to use (default: "terminal")
memory_provider: local         # Which memory provider to use (default: "local" — shared canonical store)

# ── Assess staleness thresholds ──────────────────────────────────────────────
assess:
  stale_after_days: 90         # Re-prompt if last assessment is older than this
  stale_after_commits: 500     # Re-prompt if this many commits since last assessment

# ── Acceptance-spec locations (extends the built-in defaults; never replaces) ─
# Where this repo's RED acceptance/system specs live, so the acceptance_specs
# completion gate doesn't false-halt. The built-ins cover Rails (spec/…), Node
# (test/, __tests__/, *.test.{js,ts,jsx,tsx}) and backend/ layouts at the repo
# root. Declare extra globs for anything they don't anticipate — most often a
# MONOREPO whose specs sit one package deep. A leading `*/` matches any
# immediate subdirectory (node_modules and dot-dirs are skipped), so you don't
# have to name each package; literal prefixes (api/spec/**) work too.
acceptance_spec_globs:
  - "*/spec/**"                 # e.g. api/spec/integration/…, api/spec/jobs/…
  - "*/__tests__/**"            # e.g. frontend/__tests__/screens/Foo.test.tsx

# ── Markdown viewer (for artifact review + changelog rendering) ───────────────
markdown_viewer:
  preset: glow                 # Built-in presets: glow, bat, mdcat, less, cat
  # Or configure manually:
  # command: glow
  # args: ["{file}"]
  # mode: inline               # "inline" | "blocking" | "external"

# ── Harness self-host guardrails (conduct-ts only; applies ONLY to a self-build ─
#    of the james-stoup-agents harness repo — no effect on any other repo) ──────
# Absent block = the safe default: auto-detect the harness self-build and run all
# guardrails. See "Harness self-host guardrails" below. (Active for self-builds:
# the daemon loop relinks + sandboxes the build and runs the finish gates.)
harness_self_host:
  activation: auto             # "auto" (path-detect) | "force_on" | "force_off"
  # Per-gate toggles — omit to leave ENABLED (a partial block never disables a gate):
  # skill_relink_preflight: true
  # sandbox_build_env: true
  # version_approval_gate: true
  # release_artifact_gate: true
  # Declared version freeze (#261) — the operator's standing "current version, no
  # bump" approval. While it matches the repo VERSION, the approval gate records
  # .pipeline/version-approval itself instead of halting every self-build; any
  # other VERSION still halts (a freeze never approves an actual bump).
  # version_freeze: "0.99.19"

# ── User-level conductor state (lives in ~/.ai-conductor/config.yml) ─────────
conductor:
  update_channel: tagged       # "tagged" | "main"
  auto_check: true             # Check for updates on startup
```

### Model fallback ladder (`conduct-ts` only)

Skills and daemon steps are pinned to a preferred model (e.g. Fable for `rebase`,
`remediate`, `debugging` — see [Model Selection](HARNESS.md#model-selection)). If that
model is ever detected unavailable, the daemon no longer fails the step — it walks the
`model_fallback_ladder` and retries with the next model down until one succeeds.

- **Config key:** `model_fallback_ladder` — an optional top-level array of model names
  in `.ai-conductor/config.yml`.
- **Default:** `["fable", "opus", "sonnet"]`.
- **Disabling:** set `model_fallback_ladder: []` to turn off fallback (an unavailable
  model then fails the step as before).
- **Matching:** exact-string match against the configured/pinned model name.
- **Restart semantics:** "known unavailable" models are cached per-process only.
  Restarting the daemon clears the cache, so the next run retries from the top of the
  ladder in case the model has recovered.
- **Override:** the `--model` CLI flag and `steps.<step>.model` config still take
  precedence as an explicit override — but the override is itself checked for
  availability, and falls back down the ladder if it's unavailable too.
- **Logging:** every downgrade is written to the conductor logs as
  `Downgraded from <configured> to <fallback>: <reason>` — check there if a step ran on
  an unexpected model.

### Operator identity & owner gate (multi-operator, `conduct-ts` only)

When two or more operators run daemons on **separate machines against the same repo**, each
daemon must build **only its own** specs — no duplication, no silent stalls. That partition
is keyed on an **operator identity** (`spec_owner`).

**Identity is machine-scoped — set it in your USER config, never the project config.**

```yaml
# ~/.ai-conductor/config.yml   (per machine — NOT committed)
spec_owner: your-github-login
```

- **Resolution chain:** user-config `spec_owner` → `gh` login → unresolved. An explicit
  `spec_owner` always wins over the ambient `gh` login (deterministic).
- **Anti-leak (hard guard):** `spec_owner` committed into a **project** `.ai-conductor/config.yml`
  is a config-load **rejection** — it would leak your identity to everyone who pulls the repo.
  The error names the file and the fix (move it to `~/.ai-conductor/config.yml`).
- **Fail-closed:** a daemon that can resolve **no** identity (no user-config `spec_owner`
  and no `gh` login) builds **nothing** and logs a loud, once-per-pass notice — it never
  falls back to building every operator's work.
- **Un-owned specs are surfaced, never silently skipped:** a merged spec with no `Owner:`
  marker is skipped with a distinct, deduped line telling you to add an `Owner:` marker on
  the default branch (or grandfather it via `owner_gate_cutover`).

**GATED dashboard section:** every daemon status view (`conduct-ts daemon-status`, the
startup dashboard, `.daemon/gated.json`) carries a `GATED (n)` group alongside
PARKED/HALTED/PROCESSED/IN-PROGRESS/WAITING/ELIGIBLE. It always renders explicitly — even
`GATED (0)` — so an empty backlog is never mistaken for "nothing to do" when the real cause
is an unresolved owner gate. Each `kind: 'spec'` row names the slug, the skip reason
(`other-owner` / `unowned-post-cutover` / `unowned-indeterminate`), the other operator when
known, and a remedy hint; each `kind: 'repo'` row is a section-level warning (e.g. "building
NOTHING — identity unresolved" or "un-owned specs skipped — no owner_gate_cutover
configured") for conditions with no single owning slug.

**Gate write-back (owner-gated PR/issue announcement):** on every discovery pass, the daemon
also announces each owner-gated spec where a GitHub artifact exists to announce on:
  - if the spec already has an implementation PR open (e.g. a prior build attempt halted
    before ownership changed underneath it), the PR gets an `owner-gated` label and a single
    upserted marker comment naming the reason/remedy/other-owner — edited in place on later
    passes rather than duplicated, and updated when the reason transitions (e.g.
    `unowned-indeterminate` → `other-owner`);
  - if the spec originated from GitHub issue intake (carries a `Source-Ref: owner/repo#N`
    marker), the same label + marker comment are applied to the originating **issue** too, so
    the reporter sees why their request stalled without needing daemon/dashboard access.

Both write-backs are best-effort and non-throwing — a `gh` failure never blocks or aborts the
discovery pass that produced the gated list.

**Daemon Profile & Version Gate (Self-Host)**

As of 2026-07-02T11:00:00Z, this harness repo is daemon-registered for build-to-PR automation
(see adr-2026-07-03-harness-daemon-profile). The version_approval_gate is enabled and enforces
semantic version classification:

| Change Type | Signal | Action |
|---|---|---|
| PATCH-safe only | PATCH | Auto-pass, audit recorded in .pipeline/version-signal.json |
| New skills/hooks/gates | MINOR | HALT — requires manual .pipeline/version-approval marker |
| Breaking surfaces | MAJOR | HALT — requires manual .pipeline/version-approval marker |
| Unknown/ambiguous paths | undeterminable | HALT — requires investigation and manual marker |

**Audit Record**: On PATCH auto-pass, the gate writes `.pipeline/version-signal.json` with
classification details for audit and debugging.

When opening a PR against main:
- If the daemon detects a PATCH-safe change, it auto-passes the version gate
- If MINOR/MAJOR/undeterminable, the PR HALTs; manually record the approved version in
  `.pipeline/version-approval` to proceed

### Attribution enforcement (inline build-work commits, `conduct-ts` only)

Session-driven Claude sessions can commit or edit files directly, bypassing the
per-task subagent dispatch the pipeline relies on for its `Task: <id>` commit trailer.
Inline build-work attribution enforcement closes that gap with two engine-owned gate
surfaces (not new orchestrator rules — see `skills/pipeline/SKILL.md` → "Attribution
enforcement (engine gate surfaces)"):

- **Surface A — commit-msg gate.** Rejects an unattributed build-step commit (no
  `Task:` trailer, dispatched while `.pipeline/build-step-active` is present).
- **Surface B — session mutation gate.** Blocks `Edit`/`Write`/`NotebookEdit` calls
  and `git commit` invocations issued directly in the orchestrator session (outside a
  stamped subagent dispatch) while a build step is active.

```yaml
# .ai-conductor/config.yml
attribution_enforcement_cutover: "2026-07-01T00:00:00Z"   # ISO-8601 instant; absent = off
```

- **Default off.** With the key absent (or set to a future instant), enforcement is
  inactive and unattributed commits/mutations land unchanged — pre-feature behavior.
- **Enable it** by setting `attribution_enforcement_cutover` to a past ISO-8601
  timestamp — enforcement activates for any build step that dispatches after that
  instant.
- **Requires an engine restart to take effect.** The daemon/conductor reads this
  value once at process start; editing the config file mid-run does not retroactively
  arm or disarm a build step already in flight.
- **Exemptions (both surfaces):** a merge commit, an amend of a pre-enforcement
  commit, and an empty commit carrying a resolvable `Evidence: satisfied-by <sha>`
  trailer are never blocked — these are legitimate patterns that predate or fall
  outside normal attributed build work.


### Semantic attribution verification lane (build evidence gate, `conduct-ts` only)

After the deterministic evidence gate evaluates provenance proxies (commit trailers,
path corroboration), unresolved tasks may remain. The semantic verification lane
runs an engine-embedded judge to validate those residue tasks by analyzing the
candidate diffs and running scoped tests. The judge is disabled by default and
controls whether the evidence gate reaches a green state for builds with real work
but misattributed metadata.

**Configuration:**

```yaml
# .ai-conductor/config.yml

# Semantic attribution judgment gate cutover (ISO-8601 instant)
# Absent or future date → judge lane disabled (default, no judgment runs)
# Past date → judge lane enabled for unresolved task residue
# Read once at daemon/conductor start; restart to apply
attribution_judge_cutover: "2026-07-11T08:30:00Z"

# Spot-audit sampling percentage for measurement (0-100, optional)
# Default: 10 (sample 10% of audit events when judge is active)
# Out-of-range values are clamped to [0, 100] with a startup warning
# Inert when attribution_judge_cutover is absent (judgment gate controls audits)
attribution_audit_sample_pct: 10
```

**How it works:**

1. **Trigger** — after deterministic derivation, if unresolved tasks remain, the
   cutover is active, and the residue is new (not memoized), the engine dispatches
   the judge.

2. **Memoization** — verdicts are keyed by `(HEAD sha, sorted residue ids)`. An
   unchanged key never re-dispatches; the prior verdict (or abstention) is reused
   at zero cost.

3. **Judge dispatch** — fresh UUID session, `opus/high`, input-starved: only residue
   task definitions, candidate commits (diffs not yet cited), and scoped test paths.
   The session gets no maker transcript, prior verdicts, or task-status narrative.

4. **Validation** — the engine mechanically verifies every cited SHA before stamping:
   - Reachable from `HEAD` (`git merge-base --is-ancestor`)
   - Not empty, not a bookkeeping commit (`CONDUCT_ENGINE_COMMIT`)
   - Diff overlaps declared task paths (when provided)

5. **Stamping** — validated verdicts become `semantic-verified` evidence stamps
   (adr-2026-07-11-attribution-verdict-interface). Unsatisfied verdicts feed into
   the next build try's `pendingRetryHints` (operator and agent both see exactly
   which tasks remain unresolved).

6. **Spot-audit** — the `attribution_audit_sample_pct` (default 10) samples a
   fraction of audit events for separate measurement. Every judge dispatch emits a
   fact to `.pipeline/attribution-audit.jsonl`, including the decision outcome;
   spot-audit post-processes this ledger to measure judge accuracy over time
   (adr-2026-07-11-attribution-spot-audit-measurement).

**Safe defaults:**
- Absent `attribution_judge_cutover` → judgment disabled, deterministic evidence only
- Absent `attribution_audit_sample_pct` → defaults to 10% sampling
- Both are inert when the judgment gate is inactive

**Manual CLI (`conduct-ts evidence judge`):** the same lane the daemon runs automatically
can be triggered by hand for a parked/halted feature:

```bash
conduct-ts evidence judge <slug>              # resolve <slug> to its worktree, run the judge
conduct-ts evidence judge <slug> --dry-run    # judge only — print would-be stamps, write nothing
```

- Resolves `<slug>` to a registered worktree; unknown slug or unreachable worktree exits
  non-zero and lists known slugs.
- Refuses to run (non-zero exit, no writes) while `.pipeline/build-step-active` is present —
  judging concurrently with an in-flight build step is rejected, not queued.
- Prints a single JSON line: `{ before, after, stampedTaskIds, wouldStamp }` — unresolved-task
  counts before/after the run, plus the task IDs actually stamped (`--dry-run` omits
  `stampedTaskIds` and reports `wouldStamp` instead; no evidence sidecar write occurs).
- **Recovery tail:** if the run fully resolves all residue (partial resolution leaves this
  untouched), the CLI drops a stale `.pipeline/HALT` marker and writes `.pipeline/REKICK`,
  the same signal the daemon's own re-kick sweep uses — so a manually-judged, now-green
  feature is picked back up on the next poll instead of staying parked.

See `src/conductor/README.md` → "Semantic attribution verification lane" for the full
CLI/ledger/spot-audit detail.

See `adr-2026-07-11-semantic-attribution-verification-lane.md` for the full design,
constraints, and trade-offs.


### OpenTelemetry observability (`conduct-ts` only)

The TypeScript conductor can export run/step traces and metrics to any OTel-compatible
backend (Jaeger, Grafana Tempo, Honeycomb, etc.) or to a local JSONL file. Add an `otel:`
block to your project config to opt in:

```yaml
# OTLP HTTP (default port 4318 — Jaeger, Grafana Tempo, Honeycomb, …):
otel:
  exporter: otlp
  endpoint: http://localhost:4318

# gRPC transport (port 4317):
otel:
  exporter: otlp
  endpoint: http://localhost:4317
  protocol: grpc

# File — writes OTLP-JSON newline-delimited to .pipeline/otel.jsonl:
otel:
  exporter: file
```

**Default-off.** Absent `otel:` block → zero overhead. Coexists with `events.jsonl` and
`--report`; event-emission sites are not modified.

**What you get:**
- One `conductor.run` trace per run, with one child span per step.
- `conductor.step.duration` histogram, `conductor.step.retries` counter, and
  `conductor.step.tokens` counter (only when token usage is present).
- Resource attributes: `conductor.run.id`, `conductor.feature`, `conductor.project`,
  `service.name=ai-conductor` on every span.
- Incomplete spans (interrupted run) are force-closed ERROR with `conductor.incomplete=true`.
- SIGINT/SIGTERM flush within the configured `exportTimeoutMillis` (default 5 s).

See `src/conductor/README.md → OpenTelemetry exporter` for the full implementation
reference.

### Intra-step build progress & stall events (`conduct-ts` only)

Long-running `build` steps used to be a black box between `step_started` and
`step_completed` — no visibility into whether the agent was making progress or stuck. The
TypeScript conductor now runs a lightweight `BuildProgressWatcher` alongside the build step
that polls `.pipeline/task-status.json`, the no-evidence-attempt counter, and git `HEAD`,
and emits three new events on the existing conductor event bus:

- **`build_progress`** — a change-driven heartbeat emitted whenever resolved/total task
  counts advance, the current task changes, a new commit lands, or the no-evidence
  counter bumps. Carries `resolved`, `total`, `currentTaskId`/`currentTaskName`,
  `commitCount` (new commits since the last tick, best-effort), and `noEvidenceAttempts`.
- **`build_no_progress`** — a quiet-episode warning emitted once the step has gone
  `quiet_minutes` without any observed task-status change. Carries `quietMinutes`,
  `resolved`/`total`, and `lastCommitAt` if tracked.
- **`build_stall`** — a stronger, terminal no-progress signal (`reason:
  'no_task_progress' | 'halt_marker'`) with `resolvedBefore`/`resolvedAfter`.

All three subscribers already wired to the event bus render them:

- **daemon.log** (`daemon-cli.ts`) — a cyan `▶` heartbeat line for `build_progress`, a
  yellow `⚠` quiet-episode line for `build_no_progress`, and a red `✋` stall line for
  `build_stall`.
- **TTY dashboard** (`ui/create-renderer.ts`) — matching progress/no-progress/stall lines
  in the live region.
- **OTel exporter** (when `otel:` is configured) — recorded as span events
  (`span-manager.ts#onBuildProgress/onBuildNoProgress/onBuildStall`) on the active step
  span; a no-op (with a single warning) if no span is available.
- **Event persister** — all three kinds are persisted to `.pipeline/events.jsonl` like
  every other conductor event.

**Configuration** — optional `build_progress:` block in project config:

```yaml
build_progress:
  poll_seconds: 30       # how often to poll for progress. Default: 30
  quiet_minutes: 15      # minutes of no task-status change before build_no_progress. Default: 15
  heartbeat_minutes: 5   # cadence for periodic heartbeats. Default: 5
  enabled: true          # master on/off switch. Default: true
```

Absent block → the documented defaults above, watcher enabled. Set `enabled: false` as an
escape hatch to disable emission entirely without deleting the block.

See `src/conductor/README.md` → "Intra-step build progress & stall events" for the
implementation reference (watcher lifecycle, snapshot tolerance, and per-subscriber
rendering).

### Sandbox auth-expiry park-and-poll

When the daemon builds a feature in a headless (sandbox/self-hosted) environment, the operator's
Claude API credentials may expire mid-build. The daemon detects auth failures and expired credentials
via two entry points:

1. **Pre-flight expiry check** — before provisioning a sandbox build, checks the operator's credentials
   file (`~/.claude/.credentials.json`) for an expired `claudeAiOauth.expiresAt` timestamp. Expired
   credentials immediately trigger a **park-and-poll** wait.
2. **Step-level auth failure** — if a step fails with "Not logged in" or "Invalid API key" output,
   the daemon treats it as an auth failure and enters the park-and-poll wait (see below).

**Park-and-poll behavior:**
When auth is blocked (expired or failed), instead of failing the feature immediately, the daemon
**parks** the feature and waits for the operator to refresh their credentials:
- Watches the operator's credentials file for an **mtime change** (indicating a refresh)
- When the file changes AND the credentials are no longer expired, **resumes** the feature
- Re-copies the refreshed credentials into the sandbox and retries the step with **budget intact**
  (parking consumes zero retries)
- Timeout (configurable, default **60 minutes**): if credentials are not refreshed within the window,
  HALTs with a reason naming the credentials path and observed expiry time

**Configuration:**
```yaml
# .ai-conductor/config.yml (project level)
auth_park_timeout_minutes: 60      # default: 60 minutes; 0 or negative = opt-out (HALT immediately)
```

**Opt-out:** Set `auth_park_timeout_minutes: 0` or a negative value to disable park-and-poll.
On auth failure or expiry, the feature HALTs immediately instead of waiting.

**HALT reason:** When the park window times out, the HALT reason includes:
- The credentials file path that was watched
- The observed `expiresAt` timestamp (or "unparseable" if unreadable)

**Remediation:** Standard HALT remediation applies (no new process):
1. Operator refreshes credentials (login via `claude login`)
2. Standard HALT recovery: clear `.pipeline/HALT`, observe `.pipeline/HALT.cleared` marker,
   and re-queue the feature via the base-SHA advance re-kick logic (see ADR-013) or manual dispatch.

See `src/conductor/README.md` → "Sandbox auth-expiry park-and-poll" for implementation details.

### Daemon build-auth (`conduct-ts` only) — isolating daemon builds from operator OAuth

Self-host daemon builds no longer have to share the operator's own interactive `.credentials.json`
OAuth session. Configure `harness_self_host.build_auth` to give the daemon its own build
credential:

```yaml
# .ai-conductor/config.yml
harness_self_host:
  build_auth:
    mode: daemon-token        # "daemon-token" (default) | "api-key"
    token_path: ~/.ai-conductor/build-auth   # daemon-token mode only; default shown
```

**Modes:**
- **`daemon-token` (default).** The daemon reads a token from `token_path` (default
  `~/.ai-conductor/build-auth`) and injects it as `CLAUDE_CODE_OAUTH_TOKEN` for the sandboxed
  build step only — the operator's own session is untouched. Mint it once with:
  ```bash
  claude setup-token
  chmod 600 ~/.ai-conductor/build-auth
  ```
- **`api-key`.** The build authenticates via an `ANTHROPIC_API_KEY` already present in the
  daemon's environment; no token file is needed and the token pre-flight is skipped.

**HALT remediation.** If `daemon-token` mode is configured and the token file is missing, empty,
or unreadable, the daemon HALTs *before* provisioning the sandbox with a reason naming the mint
command (`claude setup-token`), the resolved token path, and the config keys to set — it never
burns the step's retry budget. Clear the HALT once the token exists and re-queue the feature. A
mid-build auth failure in `daemon-token` mode parks and polls the token file for a refresh (same
mechanism, and same `auth_park_timeout_minutes` timeout, as the operator-credentials park-and-poll
above); in `api-key` mode there is nothing to poll, so an auth failure HALTs immediately naming
`ANTHROPIC_API_KEY`.

**Backward compatibility.** Leave `harness_self_host.build_auth` unset and nothing changes: the
daemon keeps using the operator-credentials pre-flight and park-and-poll described above. Setting
`build_auth.mode` explicitly switches the build to its own isolated credential and disables the
operator-credentials pre-flight for that project.

See `src/conductor/README.md` → "Daemon build-auth" for the module-level reference, and the
`CHANGELOG.md` `[Unreleased]` migration block for copy-pasteable setup commands.

### Harness self-host guardrails (`conduct-ts` only)

The harness is the one repo the daemon can't build the way it builds every other repo — a self-build
edits the very skills/hooks it is executing, on a machine whose concurrent Claude sessions all read
the global `~/.claude/skills`. To make the `james-stoup-agents` harness repo safe to daemon-register,
a **self-host mode** (configured by the `harness_self_host` block above) activates a guardrail bundle
**only** for a harness self-build — every other repo's path is unchanged (the only added cost is one
detector boolean):

- **`SelfHostDetector`** — recognizes a self-build by comparing the build repo's realpath to the
  harness root (identity is by path, never repo name). `activation: force_on|force_off` overrides it;
  the detector is a swappable interface, the replacement point for a future platform identity.
- **`SkillRelinkPreflight`** — relinks harness skills (`bin/install --update`) before dispatch so a
  self-build that adds or renames a skill never HALTs on "no parseable result" from a stale symlink.
- **`SandboxBuildEnv`** — runs the self-build against a **throwaway `CLAUDE_CONFIG_DIR`** whose
  `skills/` + `hooks/` link into the build worktree, so it exercises its *own edited harness* without
  ever mutating the global `~/.claude` the operator's live sessions read. It also **copies** the
  operator's `.credentials.json` (so the headless build authenticates) and a `settings.json` whose
  harness-checkout hook paths are **retargeted to the worktree** (so the build fires its *own* edited
  hooks). Copies — never symlinks — so no sandbox link resolves to a global-config target. Fails
  closed if a worktree link target is missing; torn down on pass, fail, or crash.
- **`VersionApprovalGate` + `ReleaseArtifactGate`** — HALT-based, fail-closed finish gates:
  VERSION-bump approval, `test/test_harness_integrity.sh`, a non-empty CHANGELOG `[Unreleased]`, and a
  `## Migration` block for breaking changes. In the daemon's unattended `auto` mode there is no prompt,
  so any gate that can't self-satisfy writes `.pipeline/HALT` and the PR is not opened.

**The daemon never merges** (ADR-005/ADR-010): every self-build ends at a HALT for the operator to
re-install, `/verify`, and merge. Config is safe-by-default — an absent or partial `harness_self_host`
block auto-detects with all gates on.

**How it activates in the loop.** The daemon classifies self-host **once** at startup (against the
main repo root, honoring the `activation` override) and threads a single `selfHost` flag to each
build. For a self-build only: skills are relinked before the first `build`; the `build` step runs with
`process.env.CLAUDE_CONFIG_DIR` scoped to the sandbox **for the duration of that step and restored
afterward** (nothing bleeds into `finish`); and the VERSION + release gates run **before** the
`finish` step opens the PR — a failing gate writes `.pipeline/HALT` so the PR never opens. Every part
is gated behind that one flag, so any other repo's build path is byte-for-byte unchanged.

> **Status:** active for self-builds. The guardrail bundle (`src/conductor/src/engine/self-host/`) is
> wired into the daemon loop; the harness can be daemon-registered with self-host mode on. See
> `src/conductor/README.md → Harness self-host guardrails` for the module + wiring reference.

### Plugins (`conduct-ts` only)

The TypeScript conductor supports a plugin system for swapping the LLM provider or UI renderer
without modifying source code. Plugins are discovered from two directories at startup:

| Directory | Scope |
|-----------|-------|
| `~/.ai-conductor/plugins/<name>/` | Global — available to all projects |
| `.ai-conductor/plugins/<name>/` | Project-local — overrides global for same kind+name |

**Writing a plugin manifest (`plugin.yml`):**

```yaml
kind: llm_provider             # llm_provider | ui_renderer | step | hook | visualizer
name: my-provider              # lowercase letters, digits, hyphens only — no path chars
entrypoint: ./index.js         # relative to the plugin directory
harness_version: ">=0.99.4"   # semver range — conductor rejects incompatible plugins
capabilities:                  # optional freeform metadata
  streaming: false
  recording: true
```

**Example: install a custom LLM provider**

```bash
# Create the plugin directory
mkdir -p ~/.ai-conductor/plugins/my-provider

# Write the manifest
cat > ~/.ai-conductor/plugins/my-provider/plugin.yml <<EOF
kind: llm_provider
name: my-provider
entrypoint: ./index.js
harness_version: ">=0.99.4"
EOF

# Write the entrypoint (must export invoke() and invokeInteractive())
cat > ~/.ai-conductor/plugins/my-provider/index.js <<EOF
export default {
  async invoke(options) {
    // options: { prompt, model, effort, sessionId, projectRoot }
    return { success: true, output: "...", exitCode: 0 };
  },
  async invokeInteractive(options) {
    // called for conversational (REPL) steps
  },
};
EOF

# Select it in your project config
echo "llm_provider: my-provider" >> .ai-conductor/config.yml
```

**Built-in plugins (always available, no install needed):**

| Kind | Name | Description |
|------|------|-------------|
| `llm_provider` | `claude` | Default — invokes Claude CLI via `execa` |
| `ui_renderer` | `terminal` | Default — ink-based live dashboard |
| `memory_provider` | `local` | Default — shared canonical store at `~/.ai-conductor/memory/<key>/harness/` symlinked as `.memory/`; recall is agent-driven (no harness-side search) |

**Plugin load rules:**

- Manifest validation errors (invalid kind, bad name format) → plugin skipped with a warning; other plugins still load.
- Version incompatibility (`harness_version` range excludes current version) → startup aborted with `PluginVersionError`.
- Missing entrypoint file → startup aborted with `PluginLoadError` naming the missing path.
- Project-local plugin with the same `kind:name` as a global plugin → project-local wins; a debug log line records the shadowing.

## How It Works

### SDLC Flow

```
UNDERSTAND → DECIDE → BUILD → SHIP
```

| Phase | Skills | What Happens |
|-------|--------|-------------|
| UNDERSTAND | `/bootstrap`, `/memory`, `/assess` | Detect/scaffold project, load tech-context, recall prior decisions, codebase health assessment |
| DECIDE | `/explore` (track) → `/prd` (product) → `/architecture-diagram` → `/architecture-review` → `/stories` → `/conflict-check` → `/plan` | Explore + track → product-only PRD → architecture (ADRs) → stories → conflicts → tasks |
| BUILD | `/writing-system-tests` → `/pipeline` or `/tdd`, `/code-review`, `/debugging` | Acceptance specs → TDD → evaluator gates |
| SHIP | `/manual-test` → `/prd-audit` → `/architecture-review --as-built` → `/retro` → `/finish`, `/pr` | curl/browser validation → PRD compliance audit → as-built architecture sweep → dual retrospective → verification → pull request |

### Skills (24 total)

| Skill | Enforcement | Model | Purpose |
|-------|-------------|-------|---------|
| `/bootstrap` | Advisory | sonnet | Detect/scaffold project, .claudeignore, smoke test, MCP setup |
| `/memory` | Gating | haiku | Recall/persist decisions, patterns, gotchas across sessions |
| `/assess` | Gating | haiku | Dispatch 9 CTO specialists for codebase health assessment |
| `/intake` | Gating | inherits caller | Author intake issues: WHAT (verbatim evidence, impact) + desired OUTCOMES (observable acceptance signals); HOW quarantined to labeled Hypotheses — DECIDE owns it |
| `/explore` | Advisory | sonnet | Context + approaches + decide product/technical track (no design doc) |
| `/prd` | Gating | opus | Product-only PRD with FRs (product track only); scope check, API contract |
| `/stories` | Gating | sonnet | User stories with mandatory negative paths (10 categories) |
| `/conflict-check` | Gating | opus | Detect contradictions (5 types), resolutions create ADRs |
| `/plan` | Gating | sonnet | 2-5 min tasks, dependency graph, scope sanity check |
| `/architecture-diagram` | Gating | sonnet | C4 architecture diagrams in Mermaid, maintained across SDLC |
| `/architecture-review` | Gating | opus | Feasibility, alignment, domain integrity, risk register. BLOCKED = human required. SHIP `--as-built` mode (sonnet): shipped code vs APPROVED ADRs |
| `/writing-system-tests` | Gating | sonnet | Failing acceptance specs (HTTP-level for headless/API, E2E/UI for full-stack), in the project's own test framework. Product-track: emits per-FR coverage table `.pipeline/fr-coverage.md`; gate refuses to complete while any FR is unresolved |
| `/tdd` | Structural | sonnet | RED → DOMAIN → GREEN → DOMAIN → COMMIT with subagent isolation |
| `/simplify` | Gating | sonnet | Deduplication + complexity reduction at batch boundaries |
| `/pipeline` | Structural | sonnet | Multi-task orchestration, quality gates, rework budgets, progress log |
| `/code-review` | Gating | opus | Evaluator: spec compliance (+ OVER-BUILT) → quality → domain |
| `/debugging` | Gating | opus | 4-phase investigation before any fix |
| `/verify-claims` | Gating | inherits caller | Correctness & assumption gate: grounded confidence % on claims, surfaces assumptions, HARD-BLOCKS unconfirmed load-bearing assumptions until approved. Armed by the HARNESS.md Correctness & Assumption Gate rule; cited from author skills (explore, prd, architecture-review, stories, plan, writing-system-tests) and verifier skills (assess, conflict-check, code-review, prd-audit, manual-test, remediate, debugging) |
| `/finish` | Gating | haiku | Fresh verification, story coverage, merge/PR options |
| `/manual-test` | Gating | sonnet | Validate stories via curl/browser, bug loop through /tdd |
| `/prd-audit` | Gating | opus | Audit shipped impl vs PRD FRs; per-FR verdict + gap-class; kicks back to BUILD or DECIDE |
| `/rebase` | Advisory | opus | Operator-invokable conflict resolver; also dispatched by the daemon's gated rebase-resolution loop (up to `rebase_resolution_attempts` attempts before HALT, daemon-only) |
| `/retro` | Advisory | opus | Dual analysis: harness + application, trend tracking |
| `/conduct` | Gating | haiku | SDLC orchestrator: 17-step flow with gate enforcement |

### Agent Personas

Skills define *what* to do. Agents define *who* does it with what context.

| Agent | Role | Key Trait |
|-------|------|-----------|
| Generator | Writes tests and code | Context-isolated: RED sees only tests, GREEN sees only source |
| Evaluator | Reviews with skepticism | Fresh context, no shared state with generator |
| Domain Reviewer | Checks domain integrity | Veto authority — can reject and send back |
| Planner | Expands requirements | Surfaces edge cases the user didn't consider |
| Worktree Manager | Git worktree lifecycle | Feature isolation via create/merge/cleanup/status |
| CTO Security | Auth & input validation | OWASP top 10, attack vector analysis |
| CTO Data Integrity | Transactions & race conditions | Event sourcing, data safety |
| CTO Dependencies | Package & license auditing | CVEs, outdated packages, license compliance |
| CTO Architecture | Coherence & coupling | Decisions vs implementation alignment |
| CTO Duplication | Code duplication detection | Boilerplate, copy-paste, blast radius |
| CTO Testing | Test strategy review | Coverage gaps, layer balance, assertion quality |
| CTO Infrastructure | Infra config review | DB pooling, caching, background jobs, prod parity |
| CTO Observability | Logging & monitoring | Error handling, debugging context |
| CTO DevEx | Developer experience | Onboarding, CI/CD, local dev, documentation |
| CTO Orchestrator | Synthesizes 9 specialist reports | Cross-references and prioritizes findings |

### Enforcement Levels

| Level | Mechanism | Example |
|-------|-----------|---------|
| Advisory | Instructions only | Brainstorm: "ask one question at a time" |
| Gating | Evidence required | Stories: no story accepted without concrete negative paths |
| Structural | Subagent isolation | TDD: RED agent can't see source files |
| Mechanical | Git hooks (opt-in) | Pre-commit: block commits outside COMMIT phase |

### Tech-Context

Stack-specific knowledge in `tech-context/`. Currently supported:

| Stack | Context Files |
|-------|--------------|
| Rails + PostgreSQL | `tdd.md` (RSpec, factories), `stories.md` (N+1, migrations, enums), `review.md` (security, performance), `debugging.md` (tools, gotchas) |

Tech-context is additive — it supplements skills, never overrides them. Projects without matching
tech-context use generic skill behavior.

## TypeScript Conductor (`src/conductor/`)

The TypeScript rewrite behind `conduct-ts`. Three-layer architecture —
Engine / Execution / UI — with typed events, pluggable UI renderers, and
dedicated test coverage (950+ tests). See the feature comparison in
[Choosing a Conductor](#choosing-a-conductor); implementation notes below.

- **`bin/conduct-ts`** is a thin shell wrapper around `src/conductor/dist/index.js`.
- **Engine** owns state machine, gates, completion checks, auto-heal logic.
- **Execution** invokes Claude via `execa` with session + rate-limit handling.
- **UI** is a pluggable subscriber: the default terminal renderer is event-driven.
- **Auto-heal**: before a build-gate retry, the engine cross-checks
  `.pipeline/task-status.json` against git log and flips pending tasks to completed
  when there's unambiguous evidence of a prior-run commit. Audit trail under
  `.pipeline/audit-trail/autoheal-*.json`.
- **Bootstrap-mode skip**: when bootstrap detects a `new`-mode project (empty directory
  before scaffolding), the conductor skips `assess` rather than dispatching 9 specialists
  against a blank codebase.
- **Gate-driven loop**: the SHIP-phase tail (`build → manual_test → retro → rebase → finish`)
  is driven by a *selector* over machine-checkable **gate verdicts** rather than a fixed
  order. A downstream step can **kick back** to `plan`/`stories` (re-open an upstream gate);
  the loop converges to `.pipeline/DONE` or stops at `.pipeline/HALT`. Opt-in via
  `verifyArtifacts`; every step runs on a fresh LLM session (unconditional).
- **Judgement gate at the build → manual_test seam** (`build_review`, opt-in via
  `build_review.enabled: true`): a fresh-session, input-starved Opus grader sits between
  `build` and `manual_test`, recording an objective PASS/FAIL verdict on the diff before it
  reaches the more expensive manual-test step. A FAIL kicks back to `build` with the
  reasons (bounded retries, then HALT); absent config preserves the legacy
  `build → manual_test` topology unchanged. See `src/conductor/README.md` → "Judgement gate
  at the build → manual_test seam" for config, cap/HALT behavior, and the cost trade-off.
- **Wiring reachability gate** (`wiring_check`, gating, always-on, all tiers): sits strictly
  between `build_review` and `manual_test` (`build → build_review → wiring_check →
  manual_test → ...`), verifying that new production surface is actually *called*, not just
  built and tested. Each plan task declares a `**Wired-into:** ` line (declared call
  site(s), `same as Task N`, `none (no new production surface)`, or a waived `none (inert
  until <ref>)` — full grammar in `skills/plan/SKILL.md` §5c); the gate cross-references
  those declarations against the diff's new exports (universal reference-scan Layer 1,
  plus an opt-in TypeScript import-graph reachability Layer 2 via `wiring.entry_points`
  config). Plans with zero `Wired-into:` lines predate the convention and get
  advisory-only findings; contract-bearing plans (one or more `Wired-into:` lines) are
  fully blocking. `inert` waivers resolve against on-disk paths (no network) or `gh issue
  view` for issue refs (open = waived, closed or `gh` error = fail-closed gap). See
  `src/conductor/README.md` → "Wiring reachability gate" for the full breakdown.
- **Manual-test FAIL routing + whitewash guard** (#367): `manual_test` is gating (locked —
  overrides and config disables are rejected) so a failing manual test can never be silently
  skipped. In daemon runs a manual_test that keeps FAILing kicks back to `build` with the
  FAIL rows as evidence (bounded, then HALT). The gate records the HEAD sha when it sees
  FAIL rows and refuses a FAIL→PASS rewrite with no new commits — a claimed fix must exist
  as commits. Results are append-only per attempt (`## Attempt N` sections; the latest
  section is the verdict). See `src/conductor/README.md` → "Daemon manual-test routing".
- **Rebase-on-latest before finish**: an engine-native `rebase` gate (no Claude dispatch)
  rebases the worktree branch onto the **discovered** origin default branch (fetched; falls
  back to the local base — no hardcoded `main`) before the PR is opened, so it's never built
  on a stale base. Its verdict is *branch already current with base*, so a no-op goes straight
  to finish. **Gate-first mechanical re-verify (evidence-intact optimization):** when a clean
  rebase changes **code/test paths**, the `build` gate's objective completion predicate (git
  evidence trailers, fresh re-derivation) is pre-verified against the rebased tree **before**
  kicking back. If pre-verify passes, dispatch is skipped (~1–2 min mechanical confirmation
  vs. ~45–60 min agent) and the gate is satisfied; if pre-verify fails or throws, `build` is
  kicked back normally (fail-closed). `build_review` and `manual_test` remain unconditionally
  invalidated. See `.docs/decisions/adr-2026-07-08-post-rebase-gate-first-mechanical-reverify.md`.
  A **CHANGELOG-only** `[Unreleased]` conflict is auto-resolved (both features' entries kept,
  each once); any other / mixed conflict triggers the **gated resolution loop** — the daemon
  dispatches the `/rebase` skill up to `rebase_resolution_attempts` times (config key, default
  3; set to 0 to disable) before HALTing. A resolution is accepted only when the branch is
  genuinely current with the base (FR-8) and no feature commits were dropped (FR-9); a
  code-changing resolution kicks back to `build`/`manual_test` as normal. If the loop is
  exhausted, the engine writes `.pipeline/HALT`, leaves the rebase **paused**, and opens no PR.
  The gated resolution loop is daemon-only; the `/rebase` skill is also manually invokable by
  an operator. Resume: resolve → `git rebase --continue` → `rm .pipeline/HALT` → re-queue.
- **Evidence citation translation across rebases** (#535): whenever either engine-owned rebase
  (rebase-on-latest above, or the daemon re-kick's play-forward rebase) actually rewrites
  commits, the engine automatically translates every sha-anchored evidence citation so rebases
  no longer orphan them — no new flag or config. It builds a `git patch-id --stable`
  old-sha→new-sha map, persists it to `.pipeline/rebase-rewrites.json`, rewrites
  `task-evidence.json`/`task-status.json`/`attribution-memo.json` sha references and the memo
  key in place, and resolves satisfied-by trailer citations through the map at read time
  (trailer text itself is never rewritten). Pre-rebase commits that can't be matched (dropped,
  or conflict-modified so their diff changed) are written to `.pipeline/rebase-residue.json`
  with a `rebase_citation_residue` event — a loud signal to re-verify, never a silent dangle.
  A sha that was never genuinely part of the rebase's pre-image is never laundered through the
  map; it still fails the existing ancestry check. See
  `.docs/decisions/adr-2026-07-12-rebase-evidence-stamp-translation.md`.
- **Daemon mode** (`conduct-ts daemon`): drains a backlog of features that already have
  stories **and** plans, running each in its own worktree (parallel via `--concurrency N`,
  bounded by `--max-items`), and opening a PR on finish. Per-feature failures are isolated;
  the pool keeps going.
- **Content-aware shipped-work dedup** (`.docs/shipped/<stem>.md`, #204, #205): the daemon's
  backlog discovery and its main-advance re-kick sweep both dedup against a **committed**
  record — `slug`, `spec_hash`, `pr`, `shipped` frontmatter committed **on the implementation
  PR branch** by the finish flow (`conduct-ts shipped-record --slug <stem> --pr <url|local>`,
  run by `/finish` before the branch's final push), so the human merge lands the code and the
  shipped-fact atomically — not just the local `.daemon/processed/` ledger. That ledger is
  now a **cache**, repaired opportunistically from shipped records; it is no longer required
  for correctness. A fresh clone or a wiped `.daemon/` directory therefore never re-dispatches
  or re-kicks a spec whose implementation already merged, and a renamed-but-unchanged spec is
  still caught by content-hash match. See
  [`src/conductor/README.md`](src/conductor/README.md) for the full dedup contract.
- **Engineer memory store** (daemon only): on each feature completion the daemon emits a
  structured learning signal + a narrative to a cross-project store at
  `~/.ai-conductor/engineer/` (override with `$AI_CONDUCTOR_ENGINEER_DIR`). `signals.jsonl` holds
  one append-only JSON line per feature-run (outcome, kickbacks, halts, retry hotspots,
  token spend, per-step durations); `narratives/<project>/<feature>-<runId>.md` holds the
  full retro (`done`) or a short halt note (`halted`). To keep daemon-built repos clean, the
  in-loop `retro` step is **skipped under the daemon** and its narrative is redirected to the
  store; manual `/conduct` runs still write `.docs/retros/` unchanged. Emission is
  best-effort and append-safe — a store failure never breaks a ship.
- **Custom config steps run**: the conductor drives the resolved registry
  (`buildStepRegistry`), so custom steps from `.ai-conductor/config.yml` are dispatched and
  participate in the loop.
- **Project registry + creation** (`conduct register` / `conduct create`): a single-writer
  registry module owns `~/.ai-conductor/registry.json` (override with `$AI_CONDUCTOR_REGISTRY`)
  with atomic temp+rename writes, realpath-canonicalized dedup, credential redaction of remote
  URLs, and status provenance (a `created` project is never downgraded to `registered`).
  `conduct register [path]` records an existing git repo (name=basename, absolute path, redacted
  origin remote); `conduct create <name> [--remote <url>]` scaffolds a fresh project (git init +
  skeleton CLAUDE.md referencing HARNESS.md + `.gitignore` ignoring `.pipeline/`, `.daemon/`,
  `.worktrees/`, `.serena/`; `--remote` is add-only, no push) and refuses to clobber a non-empty
  target.
  Both are **non-interactive** (run to completion and exit). `/bootstrap` auto-registers the
  project via `conduct register .` after onboarding (idempotent).
- **Pinned Node**: `conduct-ts` reads `src/conductor/.tool-versions` and exports
  `ASDF_NODEJS_VERSION` so the bundle runs on its required Node even when your shell's
  default is older.

See [`src/conductor/README.md`](src/conductor/README.md) for the gate-loop and daemon
internals (verdicts, selector, kickback, worker pool, task-status, auto-park, remediation).

**Task Status (engine-owned):** The engine is the single authority for
`.pipeline/task-status.json`. Completion state is derived from git evidence (commits with
`Task: <id>` trailers). The auto-heal step reconciles stale state before retrying a gate
by matching commits to tasks and verifying no intermediate work was dropped. See
`src/conductor/README.md` → "Task Status (engine-owned)".

**Auto-park on N-attempt trigger:** The daemon auto-parks after N consecutive no-evidence
gate misses (where a gate found no new commit evidence since its prior attempt) or when the
plan is empty/missing at seed time. This replaces infinite re-kick with a survivable halt.
Unpark (`conduct daemon unpark <slug>`) resets the evidence counter and resumes. See
`src/conductor/README.md` → "Auto-park on N-attempt trigger".

**Remediation (agentic gap routing):** When a SHIP gate blocks the daemon, the `/remediate`
planner analyzes the gap and routes back to the appropriate step or halts for human triage.
Three entry points (prd_audit, finish verification, architecture_review_as_built) and
deterministic task-id assignment keep task ledgers coherent across DECIDE rework. See
`src/conductor/README.md` → "Remediation (agentic gap routing)".

Build and install:

```bash
cd src/conductor
npm install
npm run build
cd ../..
./bin/install  # creates ~/.local/bin/conduct-ts symlink
```

## Project Structure

```
ai-conductor/
├── bin/
│   ├── install              # Install/update/uninstall harness
│   ├── conduct              # Stable bash SDLC runner
│   ├── conduct-ts           # TypeScript conductor wrapper (requires built dist/)
│   └── migrate              # Changelog-driven migration runner
├── src/conductor/           # TypeScript conductor (tsup bundle, vitest tests)
│   ├── src/engine/          # State machine, gates, completion, auto-heal
│   ├── src/execution/       # Claude provider, subprocess, rate limiting
│   ├── src/ui/              # Pluggable UI subscribers (terminal, live-region)
│   ├── src/types/           # State + event type definitions
│   ├── test/                # vitest suites (engine, execution, ui, integration)
│   └── dist/                # Built bundle — created by `npm run build`
├── skills/                  # One directory per skill, each with SKILL.md
│   ├── architecture-diagram/
│   ├── architecture-review/
│   ├── assess/
│   ├── bootstrap/
│   ├── explore/
│   ├── prd/
│   ├── code-review/
│   ├── conduct/
│   ├── conflict-check/
│   ├── debugging/
│   ├── finish/
│   ├── intake/
│   ├── manual-test/
│   ├── memory/
│   ├── pipeline/
│   ├── plan/
│   ├── pr/
│   ├── retro/
│   ├── simplify/
│   ├── stories/
│   ├── tdd/
│   │   └── references/      # Detailed RED, GREEN, drill-down, domain-review guidance
│   ├── verify-claims/
│   └── writing-system-tests/
├── agents/                  # Agent persona prompts
│   ├── generator.md
│   ├── evaluator.md
│   ├── domain-reviewer.md
│   ├── planner.md
│   ├── worktree-manager.md
│   ├── cto-security.md
│   ├── cto-data-integrity.md
│   ├── cto-dependencies.md
│   ├── cto-architecture.md
│   ├── cto-duplication.md
│   ├── cto-testing.md
│   ├── cto-infrastructure.md
│   ├── cto-observability.md
│   ├── cto-devex.md
│   └── cto-orchestrator.md
├── tech-context/            # Stack-specific knowledge
│   ├── FORMAT.md            # Contract for adding new stacks
│   └── rails-postgres/
├── templates/               # Templates for generated files
│   ├── CLAUDE.md.template
│   ├── AGENTS.md.template
│   ├── adr.md.template
│   ├── architecture-diagram.md.template
│   ├── api-response-contract.md.template
│   ├── claudeignore.template
│   ├── design-doc.md.template
│   ├── pull_request_template.md
│   ├── styleguide.md.template
│   └── technical-assessment.md.template
├── hooks/
│   ├── pre-commit-tdd-gate.sh          # Optional git hook for TDD phase enforcement
│   └── claude/                          # Claude Code session hooks
│       ├── block-destructive-git.sh
│       ├── diagram-coverage-check.sh
│       ├── lint-after-edit.sh
│       ├── post-commit-pipeline-sync.sh
│       ├── rate-limit-wait.sh
│       ├── session-start-context.sh
│       ├── spec-coverage-check.sh
│       ├── stop-memory-reminder.sh
│       ├── tdd-commit-gate.sh
│       └── worktree-check.sh
├── .docs/decisions/          # Harness ADRs
└── CLAUDE.md                # Harness internal docs (loaded by Claude Code)
```

## What Your Project Gets

After running `/bootstrap` on a project, it creates:

```
your-project/
├── .claude/
│   └── settings.json        # Project-scoped Read/Edit/Write permissions +
│                            # pre-PR lint hook (PreToolUse on gh pr create)
├── .memory/                 # Cross-session knowledge
│   ├── decisions/
│   ├── patterns/
│   ├── gotchas/
│   └── context/
├── .pipeline/               # Pipeline state (if using /pipeline)
│   ├── task-status.json
│   ├── summary.json         # Written at final-task completion; retro reads this
│   └── audit-trail/
│       ├── batch-N/         # Evaluator verdicts (review.json per batch)
│       └── autoheal-*.json  # Conductor auto-heal records (TS conductor only)
├── .docs/
│   ├── specs/               # Design docs from /prd
│   ├── stories/             # User stories from /stories
│   ├── conflicts/           # Conflict reports from /conflict-check
│   ├── plans/               # Implementation plans from /plan
│   ├── decisions/           # ADRs (API contract, styleguide, etc.)
│   ├── architecture/        # C4 diagrams from /architecture-diagram
│   │   ├── system-context.md
│   │   ├── containers.md
│   │   ├── components.md
│   │   ├── sequences/
│   │   └── erd.md
│   └── retros/              # Retrospective reports from /retro
├── .github/
│   └── pull_request_template.md  # Changelog + Migration scaffolding
└── CLAUDE.md                # Project-specific harness config
```

Bootstrap detects your stack (Node+TS, Rails+Rubocop, Python+ruff/mypy, Rust+clippy,
Go+vet) and writes the lint command into `.claude/settings.json` as a `PreToolUse(Bash)`
hook with `if: "Bash(gh pr create*)"`. Linting becomes fully deterministic machinery —
TDD, pipeline, and code-review skills never invoke the linter themselves. Non-zero
exit from the lint command blocks the PR; users edit the command in place.

## Adding Tech-Context for New Stacks

See `tech-context/FORMAT.md` for the contract. Each stack gets a directory with up to 4 files:

```
tech-context/<framework>-<database>/
├── tdd.md        # Test framework, factories, assertions, patterns
├── stories.md    # Stack-specific negative path categories
├── review.md     # Security checklist, performance checklist, antipatterns
└── debugging.md  # Tools, log locations, common gotchas
```

## Key Design Principles

1. **One skill, one responsibility** — Skills have singular focus
2. **Artifacts are the interface** — Skills communicate via files in `.docs/`, not internal orchestration
3. **Negative paths are mandatory** — Every story must have concrete failure scenarios
4. **Evaluator sees fresh context** — No shared state with the generator prevents confirmation bias
5. **Dry business logic, not dry code** — Extract shared behavior, not shared shape
6. **Anything approved twice should be automated** — Pre-approve routine operations
7. **Refactoring happens at batch boundaries** — GREEN phase stays minimal
8. **Every file gets a spec** — Unit specs + request specs, both required
9. **Memory persists across sessions** — Decisions, patterns, gotchas don't get re-discovered
10. **Self-improving** — Retro findings feed back into harness improvements
