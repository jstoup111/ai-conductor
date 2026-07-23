# Daemon Operations

Reference for the daemon's operational subsystems — issue lifecycle sweeps, overlap
detection, priority scheduling, rate-limit coordination, halt-PR presentation, delivery
guards, and brain-loop supervision. See the top-level [README.md](../README.md) for the
Quick Start and [docs/configuration.md](configuration.md) for daemon config.

### `halt-issues sweep` — filed halt-monitor issue lifecycle

`conduct-ts halt-issues sweep` closes out GitHub issues that were auto-filed by the
out-of-repo halt-monitor daemon (`monitor.sh`, tracked in #355 — that script does not
live in this repo) once their halt condition has shipped. Without this sweep, filed
issues never auto-close: they sit open even after the fix lands, and there's no link
back from the shipped commit to the issue that reported it.

```
conduct-ts halt-issues sweep --repo-dir <dir> --gh-repo <owner/name> [options]
```

**Flags:**
- `--repo-dir <dir>` — repository directory to search for shipping evidence (required)
- `--gh-repo <owner/name>` — GitHub repository the filed issues live in (required)
- `--dry-run` — run the full pipeline without writing to the ledger or GitHub; prints
  what would be stamped/closed
- `--monitor-log <path>` — path to the halt-monitor's log file (default:
  `~/.ai-conductor/halt-monitor/monitor.log`)
- `--ledger <path>` — path to the sweep's own ledger file (default:
  `~/.ai-conductor/halt-issues/ledger.json`)

**Monitor hook integration.** `monitor.sh` (out-of-repo, #355) should call the sweep
after each halt-monitor cycle so filed issues get reconciled continuously:

```bash
conduct-ts halt-issues sweep --repo-dir "$REPO_DIR" --gh-repo "$GH_REPO" || true
```

Note: `--repo-dir` and `--gh-repo` are required flags — omitting either makes the CLI
(`src/conductor/src/engine/halt-issues/halt-issues-cli.ts:85-87`) return a usage guide
instead of running the sweep.

The `|| true` keeps a sweep failure from taking down the monitor loop — the sweep is
safe to retry on the next cycle since it's idempotent (stamped issues and already-closed
issues are skipped on re-run).

**`halt-sweep:keep-open` label contract.** Add the `halt-sweep:keep-open` label to any
filed issue you want the sweep to leave alone permanently (e.g. a false positive still
worth tracking, or a known issue you're deliberately not shipping a fix for). The sweep
checks for this label before every close attempt; if present, it records
`kept-open (label)` in the ledger and never closes or comments on the issue, even once
shipping evidence appears.

**Ledger rebuild semantics.** The sweep persists per-issue state (Halt-Slug stamp,
resolution status, close status, last error) in a JSON ledger at `--ledger`. If the
ledger file is missing, it's created fresh. If it exists but fails to parse as valid
JSON (corruption), the sweep quarantines the bad file by renaming it to
`ledger.json.corrupt-<timestamp>` alongside a warning, then rebuilds a fresh ledger from
the current monitor-log verdicts — so a corrupted ledger never blocks the sweep, it just
loses previously-recorded per-issue progress (already-closed issues are re-detected via
GitHub issue state, not re-closed).

### `overlap-scan` — advisory unmerged-dependent-work scan (#523)

`conduct-ts overlap-scan` is a standalone, **advisory** DECIDE-time check for unmerged
sibling `spec/*` (or PR) branches that touch the same candidate files as the feature
being authored, plus any open blockers on a linked source-ref issue. It never blocks —
spec authoring used to be blind to work-in-flight on the same files; this surfaces it
as a heads-up instead of silently colliding at merge time.

```
conduct-ts overlap-scan [--files <list>] [--source-ref <owner/repo#N>] [--base <ref>] [--cwd <dir>]
```

**Flags:**
- `--files <list>` — comma-separated candidate file paths to check for overlap against
  unmerged sibling branches
- `--source-ref <owner/repo#N>` — linked issue ref to sweep for open blockers
- `--base <ref>` — base branch to diff sibling branches against (default: the repo's
  origin default branch)
- `--cwd <dir>` — repository directory to run the scan in (default: `process.cwd()`)

**Advisory, always exits 0.** The scan never HALTs and never fails the invoking skill —
partial failures (e.g. an unresolvable base branch) degrade to a skip note in the
rendered report rather than an error. Its only effect is the printed report; nothing it
finds gates plan authoring or the architecture-review verdict.

**When it runs.** Two DECIDE steps invoke it before their respective artifacts lock:
- `/plan` (Step 8a) runs it over the union of every task's `**Files:**` paths — the
  authoritative Files set — before the plan is saved.
- `/architecture-review` (Medium/Large tier) runs it earlier, over the paths named in
  the review's `## Wiring Surface`, before `/plan` runs at all.

Both invocations surface the rendered report to the author as-is; neither treats the
report as a precondition to proceed.

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
  faster than either alone. See `../src/conductor/README.md` → "Daemon build-stall remediation" for
  the implementation (`readHaltMarkerContent`, `writeStallQuestionEvidence`, `writeStallHalt`).

A blocking SHIP gate tries to self-heal before it halts: the conductor dispatches the
`/remediate` planner over the gate's gap artifact — a blocking prd-audit
(`.pipeline/prd-audit.md`), a failed finish verification (`.pipeline/test-failures.md`), or a
BLOCKED as-built architecture review (`.pipeline/architecture-review-as-built.md`) — and routes
each fixable gap back to the right step with concrete tasks, reserving the HALT for gaps that
genuinely need a human decision (architectural clarity or product scope).

**Acceptance-red self-heal (#741, supersedes #297).** The `acceptance_specs` gate no
longer HALTs whenever RED specs exist on disk but their evidence marker
(`.pipeline/acceptance-specs-red.json`) is missing or invalid. The writing-system-tests
skill records a `.pipeline/acceptance-specs-run.json` run contract (`{command, cwd,
targetSpecs}`) at spec-authoring time; on a marker-miss with spec files present, the
engine executes that recorded contract once — before spending retry budget — writes the
marker at the authoritative worktree-root path, and re-validates via the existing
validator. An absent/malformed contract still fails the step with an explicit reason
(the self-heal never guesses a command), and a genuinely non-RED suite still fails
validation after execution. See `../src/conductor/README.md` → "Acceptance-red self-heal"
for the implementation.

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

Omit the block entirely to get the defaults above. See `../src/conductor/README.md` for the
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
(D1) is fail-closed correctness and always stays active. See `../src/conductor/README.md` for
implementation details.

**Rerun-vs-route retry classifier (`retry_routing`).** In daemon mode, a completion-check miss on
one of the SHIP-tail verdict steps (`architecture_review_as_built`, `build_review`, `prd_audit`)
routes into the same `/remediate` self-heal path above instead of burning a rerun whenever either:
(a) the verdict artifact itself names a fresh, adverse result (a fresh `BLOCKED` as-built, a fresh
`build_review` FAIL, or a non-clean prd-audit) — a "named-route" signal that rerunning the grader
can't change; or (b) the failure reason is byte-identical to the prior attempt's *and* both the
HEAD commit and the verdict artifact are provably unchanged since then — an "identical-repeat"
signal that a rerun would just restate. Anything else (an absent/malformed verdict on the first
attempt, or a same-reason repeat where the inputs actually changed) still reruns as before.
Configure via a `retry_routing:` block in the project config:

```yaml
retry_routing:
  enabled: true   # default true; false is an exact revert to the pre-existing prd_audit-only short-circuit
```

Omit the block entirely to get `enabled: true`. Setting `enabled: false` disables this classifier
completely — only the original `prd_audit`-only short-circuit runs, and the other two verdict
steps burn their full retry budget before routing at `step_failed`, exactly as before this
feature. See `../src/conductor/README.md` for the implementation details.

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
instead of retrying blindly. See `../src/conductor/README.md` → "Auto-resolve conflicts on open
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
opt out. See `../src/conductor/README.md` → "CI feedback loop on shipped PRs" for the full
pipeline.

**Docs-only PRs skip the heavy CI jobs.** `.github/workflows/ci.yml` runs a `changes` job
first that inspects the PR's changed-file list via `.github/scripts/ci-detect-docs-only.sh`.
If every changed file lives under `.docs/**`, the heavy `integrity`, `typecheck`, and
`conductor` jobs are skipped entirely; any non-doc file — or an undeterminable diff (e.g. no
changed-file list available) — runs the full suite as before. A final `ci-gate` job (`if:
always()`, depending on all four) is the single required check: it fails only if one of the
upstream jobs actually failed or was cancelled, so an all-skipped docs-only PR still resolves
green. **Operator note:** point any branch-protection or repo-ruleset `required_status_checks`
at `ci-gate`, never at `integrity`/`typecheck`/`conductor` directly — those get skipped on
docs-only PRs, so requiring them individually would block docs-only merges forever (#802).

On startup, before any dispatch, the daemon prints a grouped **inherited-state
dashboard** (HALTED / IN-PROGRESS / **WAITING** / ELIGIBLE / PROCESSED) to both your
terminal and `daemon.log`. **By default the PROCESSED (completed) group is omitted**
from both the console and the persisted `.daemon/daemon.log`. Pass `conduct-ts daemon
--completed` (or `--all`) to additionally show the PROCESSED group **on the console
only** — `.daemon/daemon.log` never includes the PROCESSED group, regardless of the
flag. This does not affect `conduct-ts daemon-status`, which never rendered PROCESSED.
Each row shows the bits you triage on — complexity tier, the step a
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
See [`../src/conductor/README.md`](../src/conductor/README.md#dependency-ordered-intake-and-dispatch)
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
[`../src/conductor/README.md`](../src/conductor/README.md#halt-reconciliation-startup-dashboard--main-advance-re-kick-adr-013).

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
See [`../src/conductor/README.md`](../src/conductor/README.md#daemon-lifecycle-controls-pause-resume-restart-adr-2026-07-04-durable-pause-marker--adr-2026-07-04-respawn-in-place-restart)
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
sentinel and resumes re-dispatch right where it left off once unparked. The park check is
re-consulted **immediately before dispatch**, not only at initial pool selection, closing a race
where a park written between selection and dispatch was previously ignored. The status dashboard's
PARKED group takes absolute precedence over every other group (HALTED, ELIGIBLE, etc.) — a parked
slug always shows there and nowhere else. See
[`../src/conductor/README.md`](../src/conductor/README.md#operator-park--unpark) for details.

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
environments and disabled in once-mode runs. See `../src/conductor/README.md` → "Daemon lifecycle
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
See `../src/conductor/README.md` → "Main-checkout leak triage and auto-heal" for the detailed
implementation and guarantee model.

**Setup-failure triage (self-host only).** When `bin/setup` fails while preparing a daemon
worktree, a bounded two-stage recovery runs instead of leaving the wedge for an agent to
untangle blind: dirty state is first quarantined to a `wip/setup-quarantine-<slug>` branch and
setup is retried once at clean HEAD; if it still fails, exactly one fix-session is dispatched
with the setup error tail, and the engine mechanically verifies the success contract (setup
exits 0, tree clean) rather than trusting the agent's report. See `../src/conductor/README.md` →
"Setup-failure triage" for the detailed stage flow.

**Write-fence sandbox for self-host builds (self-host only).** When a self-host build runs in a
sandbox, it now has a daemon-owned PreToolUse hook that blocks writes to the harness main checkout
outside the build worktree. Edit, Write, MultiEdit, and NotebookEdit targeting paths under the
harness root but outside `.worktrees/` are blocked with guidance to use the worktree path; Bash
commands referencing main-checkout paths are heuristically screened and blocked (the deterministic
leak-triage/auto-heal layer backstops any misses). The fence never fires on worktree-internal
paths, OS temp directories, or unrelated repos. See `../src/conductor/README.md` → "Write-fence
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
`../src/conductor/README.md` → "Halt-PR presentation reliability" for the implementation reference.

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
`$AI_CONDUCTOR_ENGINEER_DIR`. See `../src/conductor/README.md` for the full flow and the pidfile-lock
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

See `../src/conductor/README.md` for the full implementation details.

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
  status surface written by the loop (see `../src/conductor/README.md` → "Intake Loop Automation").
- **`brain stop`** kills the tmux session; safe to call when nothing is running.
- **Alternative to cron, zero-token execution.** The loop only polls GitHub via `gh` and
  writes to the local ledger/inbox — it never spawns `claude` or opens a PR, so running it
  continuously costs no model tokens.
- **Single-writer guarantee.** When the brain loop is live, the interactive
  `conduct-ts engineer` launcher's manual pre-poll is skipped (see
  `../src/conductor/README.md` → "Intake Loop Automation") so the two paths never race the
  same ledger.
