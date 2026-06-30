# Changelog

All notable changes to this harness are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release cadence: tags `vX.Y.Z` are cut automatically by CI on merge to `main`
(see `.github/workflows/release.yml`). Every PR must add an entry under
`## [Unreleased]`.

## [Unreleased]

### Fixed

- Daemon `needs-remediation` escalation now **upserts** its failure comment instead of
  appending a new one on every HALT (#159). The comment carries a hidden marker
  (`<!-- conductor:needs-remediation -->`); on a repeat HALT the existing comment is edited
  in place (the latest reason replaces the prior one) so a repeatedly-failing feature no
  longer accumulates duplicate `## Daemon halt` comments on the same PR. New
  `upsertComment()` seam in `pr-labels.ts`; best-effort/non-throwing (a PATCH failure leaves
  the existing comment as-is, a missing/unparseable/unreachable comment falls back to create).

### Changed

- `writing-system-tests` skill is now language- and framework-agnostic. Replaced the
  Rails/RSpec-only mechanics (hardcoded `spec/integration`/`spec/system` paths, `config/routes.rb`,
  `bundle exec rspec`, Capybara/`SecureRandom` examples) with framework-neutral guidance that
  defers concrete syntax, paths, runner, and fixtures to the project's detected test framework
  (mirroring how `/tdd` defers to stack test conventions). All correctness principles are
  preserved: §3b replacement-entry-point, §3c path-guard boundary values, §3d adversarial
  derivation coverage, RED discipline, and the acceptance/request/unit layering philosophy.
  README skill table updated to match.

- `bin/install` now builds the `conduct-ts` bundle itself — it runs `npm install
  && npm run build` in `src/conductor/` (in both first-run and `--update` mode)
  before symlinking `conduct-ts`, so updates can never leave a stale bundle for
  the install-freshness guard to reject. The build is non-fatal and idempotent:
  if Node < 20.5 is active or `npm` is missing it's skipped with a warning and
  `conduct` still installs. `bin/install --check` now reports whether the
  `conduct-ts` bundle is built and on PATH.

## Migration

The build daemon is now hosted inside a tmux session instead of a detached background process.
Any daemon currently running as a detached process must be stopped once so the first
tmux-hosted `daemon start` isn't blocked by the 1-per-repo pidfile lock. This kills only a live
detached daemon for the current repo; a stale lock self-reclaims and needs nothing.

```bash migration
# Stop a currently-detached daemon for this repo (no-op if none / already stale).
if [ -f .daemon/daemon.pid ]; then
  pid=$(jq -r '.pid // empty' .daemon/daemon.pid 2>/dev/null || true)
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    echo "Stopped detached daemon (pid $pid). Start the tmux-hosted daemon with: conduct-ts daemon start"
  else
    echo "No live detached daemon (stale lock self-reclaims). Use: conduct-ts daemon start"
  fi
fi
# Requires tmux on the host for the management verbs: e.g. `sudo apt-get install tmux`.
```

### Changed

- **`conduct-ts daemon start` now auto-attaches to the daemon's tmux session (conduct-ts).** After
  starting, `start` hands the terminal to the live session read-only (like `daemon connect`) so the
  operator lands in it instead of having to attach separately. Pass **`-D` / `--detach`** to keep the
  old fire-and-forget behavior. The attach is suppressed automatically when there is no interactive
  terminal (scripts, the engineer auto-launch) so `start` never blocks/fails on `tmux attach` —
  it starts detached and prints how to attach. The engineer auto-launch is unaffected (it calls
  `supervisor.start` directly, not the CLI verb).

- **Rebase discipline moved from the `block-destructive-git` hook into the skill prompts +
  HARNESS.md.** The hook previously *hard-blocked* every ad-hoc `git rebase` (exit 2). That also
  rejected the two legitimate cases — an operator deliberately refreshing a stale PR branch onto
  its base, and the `/rebase` resolver — forcing awkward workarounds. The hook now **allows**
  `git rebase` and emits a single non-blocking reminder instead; `--continue/--abort/--skip/
  --edit-todo` pass silently. The "never rebase mid-build" rule is now stated canonically in a new
  **HARNESS.md → Rebase Policy** section and reinforced in the build-loop skills (`tdd` COMMIT
  phase step 7; `pipeline` already instructs the implementation subagent). Force-push,
  `reset --hard`, unmerged `branch -D`, `clean -f`, and `checkout -- .` remain hard-blocked.
- **`bin/install --check` now exits non-zero on drift.** It previously printed missing/stale-skill
  warnings but always exited 0 (the last statement was an `echo`), so it couldn't be scripted. It now
  `return`s 1 when any skill is missing/stale (and the `--check` dispatcher propagates it via
  `exit $?`), enabling the new install-freshness guard to gate on the exit code.

### Fixed

- **`/finish` now refuses a mid-rebase/mid-merge tree (skill GATE 0).** A `/finish` dispatched on a
  worktree with a paused rebase (e.g. `conduct-state` marked `rebase` done but the tree was still
  mid-conflict) would grind for ~15 minutes and then push a PR of a detached, half-rebased branch.
  The skill's generic "check git status" step was too weak for a small model to enforce, so the
  finish skill now has an explicit **GATE 0**: before anything else, refuse to proceed if `git status`
  shows a rebase/merge in progress, a `rebase-merge`/`rebase-apply` dir exists, or
  `git diff --diff-filter=U` is non-empty — STOP without running tests, pushing, opening a PR, or
  writing `.pipeline/finish-choice`, so the conductor HALTs for resolution instead of shipping broken
  work. Enforced in the skill itself rather than via an engine-side workaround.
  The `needs-remediation` escalation is gated on the daemon flag, but as a belt-and-suspenders guard
  the production `makeProductionGh`/`makeProductionGit` runners now throw under
  `AI_CONDUCTOR_NO_REAL_EXEC` (set by the vitest global `test/setup.ts`). This prevents a test that
  reaches a real runner from mutating live GitHub — previously an auto-mode failure test reused a
  live PR and added a `needs-remediation` label + comment. Scoped to this seam only; the real-`git`
  integration tests (rebase / daemon-rekick) use their own execa paths and are unaffected.
- **`conduct-ts daemon --help` launched a daemon instead of printing help (conduct-ts).** The daemon
  sub-verbs are intercepted before commander parses, so `--help`/`-h` after `daemon` fell through to
  `detectDaemonCommand` and **started a real daemon run** (it would scan the backlog and could
  re-kick/dispatch a feature) — a genuine footgun. `daemon --help`/`-h` now prints a daemon-scoped
  help surface (`renderDaemonHelp`) and exits, and a typo'd sub-verb (`daemon strt`) prints that help
  with a clear error + exit 1 instead of launching (`detectUnknownDaemonSubcommand`). The management
  verbs (`start`/`stop`/`restart`/`connect`/`debug`) are now also **documented in `--help`** — they
  were missing because only `status`/`logs` were registered on the commander `daemon` command.

- **Daemon build worktrees now fork from `origin/<default>`, not local `<default>` (conduct-ts).**
  A fresh per-feature worktree was cut from the daemon's LOCAL default branch
  (`git worktree add -b <branch> <path> main`). But `fastForwardRoot` only advances
  local `main` while the root checkout is actually on it — so whenever another
  process leaves the root on a different branch or a detached `HEAD` (e.g. an
  in-progress rebase), local `main` silently goes stale and every new worktree
  built against old code, even though `origin/main` had advanced. `createWorktree`
  now resolves the build base via `resolveWorktreeBase`, preferring the
  remote-tracking `origin/<default>` tip (falling back to local `<default>` only
  when `origin/<default>` is unresolvable — a local-only repo never fetched). The
  fast-forward path and backlog discovery are intentionally unchanged. Covered by
  new `daemon-deps` tests (origin/<base> base + local fallback) and a real-binary
  smoke of `git rev-parse --verify --quiet` + `git worktree add … origin/<default>`.

- **Test suite leaked real build daemons; added an auto-launch kill-switch (conduct-ts).** Several
  engineer tests exercise the real handoff `ensureRunning` without injecting a launch, so under
  ADR-014 each run spawned a real `tmux new-session -d 'conduct-ts daemon --continuous'` daemon that
  outlived the test's tmpdir (pre-ADR-014 it leaked detached node procs; the tmux host just made it
  visible + persistent). Added an operational kill-switch env `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH=1`
  honored by `launchDaemon` — it suppresses the **default** (non-injected) real launch while leaving
  an explicitly injected supervisor untouched (so the delegation unit tests still assert their
  contract). A global vitest setup (`test/setup.ts`) sets it for the whole suite, so no test spawns a
  real daemon and future tests can't re-introduce the leak. The flag also lets an operator who manages
  daemons by hand disable the engineer's auto-launch.
- **Silent daemon-launch failure on a tmux-less host (engineer).** The engineer's fire-and-forget
  `ensureRunning` nudge is the only production path that starts a daemon, and under the
  daemon-supervisor ADR it now routes through `supervisor.start` (tmux). On a host without tmux that throws
  `TmuxNotInstalledError`, which the handoff caught and **silently swallowed** — authoring the spec
  PR while launching no daemon, so specs would pile up unbuilt with no signal. Both handoff sites
  (`engineer-cli.ts` claim path and `handoff-step.ts`) now keep the failure **non-blocking** (the
  spec branch still lands) but **surface the reason** (`⚠ Spec authored, but the build daemon was not
  started for "<repo>": <reason>`). No change on a tmux-present host.
- **Type error in the github-issues intake adapter (conduct-ts).** `maybeReopen` typed its `repo`
  parameter as `{ name; path }`, omitting the `ghRepo?` field that `RepoLister.list()` actually
  provides and that the function body reads (`repo.ghRepo ?? repo.name`). This produced a
  `tsc --noEmit` error (TS2339). Widened the parameter type to `{ name; path; ghRepo? }` to match
  the data the caller passes; `tsc` is now clean. No behavior change.
- **Daemon finish HALT when cleanup `cd`s into the main repo (conduct-ts).** In auto/daemon
  mode the finish step wrote its completion markers (`.pipeline/finish-choice` and the `pr_url`
  in `.pipeline/conduct-state.json`) via relative paths, but the finish skill's branch/PR/worktree
  cleanup `cd`s into the *main* repo — so the writes landed in the wrong repo while the completion
  gate reads the *worktree's* `.pipeline`. A feature whose PR was genuinely created would HALT with
  "`.pipeline/finish-choice` is missing". The auto-finish system prompt now directs the marker
  writes to the **absolute worktree `.pipeline` paths** (from `pipelineDir`, with a relative
  fallback when unset), instructs the session to write them **before** any merge/cleanup, and to
  reuse an existing PR (`gh pr view`) instead of failing. Skill docs updated to match.

### Added

- **Install-freshness guard — the daemon refuses to start on a stale harness install (conduct-ts).**
  A harness update (git pull / merged PR) does NOT relink skills — that only happens when
  `bin/install` runs — so a newly-added skill can exist in `skills/` but be missing from
  `~/.claude/skills/`. A daemon-dispatched `claude -p '/<skill>'` then hits "Unknown command",
  returns empty output, and the conductor HALTs with a cryptic `rebase skill returned no parseable
  result` (this exact gap left the new `/rebase` resolver unrunnable on the daemon — every dispatch
  silently no-op'd). A new guard (`install-freshness.ts`) runs `bin/install --check` at daemon entry:
  on drift, `daemon start` **prompts** to run `bin/install --update` (decline ⇒ it refuses to start);
  the continuous daemon run (and any non-interactive launch, e.g. the engineer handoff auto-launch)
  **fails hard** with an actionable message rather than silently dispatching unregistered skills. If
  the harness root can't be located the check is skipped (never blocks an otherwise-working install).
- **Daemon PR labeling — `needs-remediation` draft PR + `mergeable` label sweep (daemon-only).**
  On **any irrecoverable daemon HALT that strands committed work** — a build/gating-step failure
  (retries exhausted), a prd-audit product/plan gap needing human DECIDE, the kickback-ping-pong or
  stuck-gate caps, or an unexpected conductor error (the rebase-conflict HALT is excluded) — when
  the feature branch has at least one commit, the daemon pushes the branch and opens a **draft PR**
  labeled `needs-remediation` with a comment explaining the HALT reason (which names the failing
  step); when there are zero commits, no GitHub artifacts are produced (FR-6). An existing open PR
  for the branch is reused rather than duplicated (FR-5). PRs
  from features that reach `done` are enrolled in a per-repo watch registry
  (`.daemon/mergeable-watch.jsonl`); a best-effort sweep — on daemon startup, after each feature
  completes, and per idle poll tick — keeps the `mergeable` label in sync: added when the PR is
  open + conflict-free + CI-green, removed when not, pruned when merged/closed (FR-10..FR-14). A
  `needs-remediation` PR is never labeled `mergeable` (FR-12). When a failed feature is re-kicked
  and completes successfully, the daemon clears the stale `needs-remediation` label and un-drafts
  the PR before enrolling it in the sweep (FR-16). All labeling is best-effort and non-blocking —
  a GitHub step failure is logged and never disrupts the daemon's core processing (FR-7, FR-15).
  Daemon-only; interactive runs are unchanged (FR-8, FR-15). PRD:
  `.docs/specs/2026-06-29-daemon-pr-labels.md`.
- **Pluggable memory provider — `local` built-in with canonical shared store.** The harness now
  selects the memory backend via a per-project `memory_provider:` key in `conduct.yml`
  (adr-2026-06-29-memory-provider-plugin-and-agent-queried-integration/adr-2026-06-29-per-project-memory-provider-selection); the only built-in is `local`. The `local` provider stores all `.memory/`
  content in a durable project-keyed canonical directory at
  `~/.ai-conductor/memory/<sha256-of-origin-url>/harness/` and places `.memory/` as a symlink
  to it — making the store branch-/worktree-independent and safe under concurrent builds
  (adr-2026-06-29-shared-memory-store-placement-and-durability). On first `conduct` run `bin/conduct` calls `conduct-ts memory setup <dir>`, which
  creates the canonical store with the four standard categories (`decisions/`, `patterns/`,
  `gotchas/`, `context/`) plus `index.md`, then atomically symlinks `.memory/` to it. If `.memory/`
  already exists as a real directory (legacy project), `migrateMemory` copies its contents to the
  canonical store, verifies, and swaps before creating the symlink (adr-2026-06-29-safe-reversible-memory-migration); the migration is
  idempotent and automatic (see Migration below). **FR-3 invariant:** the harness contains zero
  memory search, ranking, or embedding logic — recall is always the agent reading `.memory/` files
  and judging relevance. New modules: `engine/memory-store.ts`, `engine/memory-migrate.ts`,
  `engine/memory-cli.ts`; new config field `memory_provider` in `engine/config.ts`; `bin/conduct`
  wires `run_memory_store_setup` at bootstrap entry (new `LocalMemoryProvider` in
  `engine/config.ts`).

- **FR-3 invariant check (integrity suite section 8).** `test/test_harness_integrity.sh` gains a
  new section 8 that asserts no harness-side code in `src/conductor/src/`, `bin/`, `hooks/`, or
  `skills/` contains memory-retrieval patterns (`embed(`, `cosineSimilarity`, `vectorSearch`,
  `relevanceScore`, `rankScore`) — so the "recall is always the agent" contract cannot be silently
  broken by a future PR. The engineer flywheel directory is excluded (`--exclude-dir=engineer`).
  The previous version-integrity section is renumbered to 9.
- **tmux-supervised daemons — start / stop / restart / connect / debug (conduct-ts).** The per-repo
  build daemon is now hosted as a **foreground process inside a per-repo tmux session**
  (`cc-daemon-<slug>`) behind a swappable **Supervisor port** (tmux adapter now; a kubectl adapter
  later, no execution-core change). New operator verbs: `conduct-ts daemon start` (idempotent — never
  a duplicate), `stop`, `restart`, `connect` (read-only live colored watch), `debug` (read/write
  attach). `daemon status` now also reports tmux **session up/down** (so a stale pidfile with a live
  orphaned session is distinguishable). The former detached `stdio:'ignore'` spawn (the launch helper,
  renamed `launchDaemonDetached` → `launchDaemon`) now delegates to `supervisor.start`, so an
  engineer-nudged daemon is also attachable — while the engineer stays **launch-only** (ADR-005
  non-management intent preserved; the daemon-supervisor ADR supersedes only the spawn mechanism).
  The daemon runs **serially** (concurrency clamped to 1; `--concurrency > 1`
  is clamped with a logged note). The tmux-hosted daemon is **long-lived by design** — the session
  command is `conduct-ts daemon --continuous` and deliberately drops the former engineer launch's
  `--max-idle-polls` self-limit so an operator can attach to a running daemon at any time; its bound
  is the operator `stop` verb (and reboot), not an idle timeout (daemon-supervisor ADR §7). The
  intake/execute **work-source seam** is formalized (the run loop
  consumes `BacklogItem`s from an injected source; local in-process adapter unchanged). The daemon
  still builds with **no tmux present** (management is purely additive — bare-run invariant).
  `bin/conduct` now forwards `daemon <verb>` to `conduct-ts` (previously `conduct daemon status`
  mis-launched a feature build named "status"). See
  `.docs/decisions/adr-2026-06-29-daemon-supervisor-port-and-attachable-hosting.md` and
  `.docs/plans/2026-06-29-daemon-tmux-supervisor.md`.
- **Gated rebase-conflict resolution + attempt-cap config (conduct-ts).** The daemon's
  finish-time `rebase` step now attempts skill-driven conflict resolution (via the new
  `/rebase` skill) before HALTing on a non-CHANGELOG conflict. The number of attempts is
  configurable via `rebase_resolution_attempts` (config key; default **3**; set to **0** to
  restore the previous immediate-HALT behavior). A resolution is accepted only when the branch
  is genuinely current with the base (FR-8) and no feature commits were dropped (FR-9);
  a code-changing resolution kicks back to `build`/`manual_test` through the existing
  kickback machinery. If all attempts are exhausted the engine falls through to the existing
  HALT path. The gated resolution loop runs only in daemon mode; interactive `/conduct` runs
  and the `/rebase` skill invoked manually by an operator are unchanged.
- **Mermaid diagram renderer — visuals at the architecture approval gates (install + conduct-ts).**
  Generated architecture diagrams and DRAFT ADRs (Mermaid-in-Markdown) can now be reviewed as
  rendered visuals instead of raw Mermaid. `bin/install` offers a renderer choice mirroring the
  markdown-viewer flow — presets `html` (default; self-contained mermaid.js page opened in the
  default browser, no native dependencies, works anywhere), `mmdc-png`/`mmdc-svg` (via
  `@mermaid-js/mermaid-cli`), and `none` — persisting it as
  `mermaid_renderer.{preset,command,args,mode}` in
  `~/.ai-conductor/config.yml`; `install --check` reports its status. At the conduct-ts approval
  gate, `reviewArtifacts` renders a reviewed file's diagrams (after showing the raw Markdown as an
  always-present fallback) via the merged-config preset; a new `conduct render-diagrams <file>...`
  subcommand renders on demand. The renderer is best-effort by contract: it never throws, isolates
  per-diagram failures, HTML-escapes diagram source, and always surfaces a notice on skip/failure
  so the gate is never blocked. `README.md`, `src/conductor/README.md`, and the
  architecture-diagram / architecture-review skill docs updated.

- **Richer daemon startup dashboard — "state of everything" per repo (conduct-ts).** The
  inherited-state dashboard printed before any dispatch now carries the bits an operator
  actually triages on, mined best-effort from each worktree's `conduct-state.json` (and the
  processed ledger): HALTED and IN-PROGRESS rows show the **complexity tier**, the **step** the
  feature reached, and the **open PR link** if one exists; ELIGIBLE rows show the **tier** of
  each queued feature; PROCESSED now **lists each shipped slug with its PR link** (not just a
  count). To support the shipped-PR links, the `.daemon/processed/` ledger is now written as
  JSON (`{ status, prUrl }`) — legacy plain-text `shipped` entries still parse (no PR), so this
  is backward-compatible. All enrichment is best-effort: a malformed `conduct-state` still
  appears (step `unknown`, no tier/PR), and a per-worktree fs error is skipped — the scan never
  aborts startup. `README.md` and `src/conductor/README.md` updated.

- **GitHub issue ↔ PR linkage + auto-close on implementation merge (conduct-ts).**
  github-issues intake previously commented on an issue but never linked or closed it, so an
  issue stayed open even after its spec PR and the daemon's implementation PR both merged. The
  originating issue reference now travels WITH the spec via a committed `.docs/intake/<slug>.md`
  marker (`Source-Ref: owner/repo#N`), written by both authoring paths (`engineer land
  --source-ref` and the autonomous `runAuthoring`). The **spec PR** gets a non-closing
  `Refs owner/repo#N` (links the issue without closing it); the daemon reads the marker from the
  merged base-branch tree (`BacklogItem.sourceRef`) and adds `Closes owner/repo#N` to the
  **implementation PR**, so GitHub auto-closes the issue when the real work merges. All injection
  is gated on a parseable ref (hand-authored specs are unchanged), idempotent, and non-fatal (a
  `gh` failure never affects a delivered PR or build). New shared helper
  `engineer/issue-ref.ts` (`parseSourceRef` / `injectIssueRef` / `closeIssueOnImplementationMerge`)
  is the single source for parsing + linking.

- **OpenTelemetry exporter for conductor runs (Phase 1).** A new opt-in
  `otel:` config block wires the conductor event bus to an OTel tracer/meter
  pipeline (ADR-014). When enabled, each run produces one root trace span
  (`conductor.run`) with a child span per step, plus `conductor.step.duration`
  (histogram), `conductor.step.retries` (counter), and `conductor.step.tokens`
  (counter, only when tokenUsage is present) metrics. Two transports: `exporter:
  otlp` (HTTP/protobuf on port 4318 by default, gRPC/4317 via `protocol: grpc`)
  and `exporter: file` (OTLP-JSON newline-delimited at `.pipeline/otel.jsonl`).
  Feature is default-off (absent `otel:` block → zero overhead). Coexists with
  `events.jsonl` and `--report` — event emission sites are unchanged. Export
  failures emit at most one bounded warning via `onWarning` and never affect the
  run (FR-8). Incomplete spans on abrupt termination are force-closed ERROR with
  `conductor.incomplete=true` (FR-9). SIGINT/SIGTERM handlers trigger a
  best-effort flush within the configured `exportTimeoutMillis` bound.

- **Engineer authors the full DECIDE phase (engineer).** The `/engineer` idea→spec loop now runs
  the complete, build-ready DECIDE set in canonical order —
  brainstorm → **complexity** → stories → **conflict-check** → **architecture-diagram** →
  **architecture-review** → plan — instead of only brainstorm→stories→plan. The operator-assessed
  complexity tier is persisted to `.docs/complexity/<plan-stem>.md`, and conflict-check +
  architecture steps are tier-skipped for Small (mirroring conduct's `skippableForTiers: ['S']`).
  `engineer land` now commits the full `.docs` DECIDE set and **rejects** a DRAFT ADR or a
  tier/artifact mismatch (non-Small with missing architecture artifacts). The daemon reads the tier
  from `.docs/complexity/` (via `discoverBacklog` → `BacklogItem.tier`) and seeds the build's
  `complexity_tier` from it, replacing the previously hardcoded `'M'`; specs with no marker fall
  back to `'M'` (unchanged behavior). Shared `hasDraftAdr` / `parseComplexityTier` predicates added.
- **Implementation subagents must not fetch/rebase/pull (pipeline).** Every per-task dispatch
  prompt now instructs the implementation subagent to NOT run `git fetch`/`pull`/`rebase` or switch
  branches — it commits only to the current feature branch. Prevents the mid-build auto-rebase onto
  a moved `origin/main` that stalled a feature branch in a CHANGELOG conflict. Reaffirms that the
  only sanctioned rebase is the daemon's finish-time, daemon-gated rebase-onto-latest.
- **Type-check gate in the TDD DOMAIN/COMMIT phase.** The post-GREEN DOMAIN phase now runs the
  project's type-checker (e.g. `tsc --noEmit` / `npm run typecheck`) as a mechanical pre-check
  before the domain reviewer is dispatched — a type error returns straight to GREEN rather than
  shipping to batch, PR, or CI. Re-confirmed at the COMMIT hard gate. Conditional on tech-context:
  skipped silently for stacks with no compile step (e.g. Rails). Catches stale imports / renamed
  properties / signature drift introduced by the GREEN agent at the cheapest point — the cycle
  boundary — instead of at PR-creation time (`/pr`) as it does today.
- **Negative-path category: invariant side-effect on alternate branches (stories).**
  Adds a mandatory negative-path category to `/stories`: when a happy path delegates a critical
  side effect (record/ledger write, cleanup, metric, cache invalidation) to a helper, every
  alternate branch that can bypass that helper (error path, no-remote/offline, degraded mode,
  early return) needs its own scenario asserting the side effect still occurs. Closes the gap that
  shipped a no-remote authoring path silently skipping the authored-ledger write.
- **Adversarial-derivation coverage gate (writing-system-tests §3d + domain reviewer).**
  Generalizes the orphaned-primitive (§3b) and path-guard (§3c) rules to *all* security/correctness
  derivations (redaction, auth/permission predicates, path/identity checks, state guards): the spec
  generator must produce a failing test for **every production call site** of the derivation, fed
  the **real adversarial input that site passes** (token-bearing URL, trailing-slash/sibling/
  traversal path, dirty/stale state, empty/boundary), asserting the observable guarantee at that
  site — not the helper's return value in isolation. The TDD domain reviewer gains matching veto
  checks (call-site coverage after RED, derivation-reached-at-every-call-site after GREEN), and the
  dispatcher now feeds the reviewer the derivation's call-site list. Closes the injected-stub blind
  spot that shipped CRITICAL/HIGH bugs caught only by the fresh-context evaluator across three
  consecutive phases.
- **Daemon halt-reconciliation — startup dashboard + main-advance re-kick (ADR-013).**
  On startup, before any dispatch, the daemon now scans `.worktrees/*/` and the
  `.daemon/processed/` ledger and prints a four-group inherited-state dashboard
  (HALTED / IN-PROGRESS / ELIGIBLE / PROCESSED, precedence in that order) to both
  stdout and `daemon.log`. It also tracks the base-branch tip SHA, persisting the
  last-seen value to **`.daemon/last-base-sha`** (corrupt/empty/non-40-hex →
  treated as absent, never a spurious advance). On a genuine base-SHA advance —
  observed live during an idle refresh, or at startup versus the persisted value
  (a base that moved while the daemon was down) — the daemon **re-kicks every
  halted feature**: it aborts any paused 9.0 rebase (a failed abort leaves the
  marker intact), preserves the reason to **`.pipeline/HALT.cleared`**, removes
  `.pipeline/HALT`, and drops a **`.pipeline/REKICK`** sentinel. Re-kick issues no
  direct dispatch — clearing the marker lets PR #109's existing un-park path
  re-dispatch the feature, which then resumes **rebase-first** (9.0's
  rebase-onto-latest runs before the pending gate re-verifies, so an advanced base
  is integrated first). The re-kick is bounded by a per-feature last-rekick SHA
  (a same-SHA re-halt is not re-kicked again), and a plain restart with no advance
  honors all markers exactly as PR #109 does. New modules: `engine/daemon-sha.ts`,
  `engine/daemon-dashboard.ts`, `engine/daemon-rekick.ts`; new optional
  `DaemonDeps` hooks wired in `daemon-cli.ts`.

- **GitHub-issues intake now fires on the live `conduct-ts engineer` launch.**
  Previously poll-on-launch lived only in the test-only `runEngineerMode` harness,
  so bare `conduct-ts engineer` dropped straight into `claude /engineer` and never
  ran intake (only the standalone `conduct-ts engineer poll` did). The launcher now
  **pre-polls** github issues and enqueues new ones before spawning the session
  (`Intake: N issue(s) queued.`), and a new **`conduct-ts engineer claim`**
  subcommand lets the `/engineer` skill atomically dequeue the oldest idea at
  step 1. An idea can now come from three sources — github intake, a CLI arg
  (`conduct-ts engineer "<idea>"` / `--idea "<idea>"`, which skips the poll), or
  direct chat. `land`/`handoff` gain an optional **`--source-ref <owner/repo#N>`**
  that threads write-back (routed comment → done comment + `engineer:handled` label
  + ledger transition) back to the originating issue via the new shared
  `intake/writeback.ts` helper. Write-back stays advisory — a `gh` failure never
  blocks a land or reverts a delivered spec PR. Updates `skills/engineer/SKILL.md`
  (claim-first capture + `--source-ref` threading) and the conductor README.

- **Autonomous gap remediation (`/remediate`) — a blocking `prd_audit` is routed,
  not just halted.** When a daemon `prd_audit` blocks, the conductor now dispatches
  the new `/remediate` SHIP sub-routine, which reasons over the per-FR gaps and
  writes `.pipeline/remediation.json` assigning each a disposition: `build` /
  `acceptance_specs` / `architecture_review` / `plan` (autonomous — routed back to
  that step with the concrete gap + tasks in the kickback hint), or `halt` with a
  category. **HALT is reserved for the two genuinely-human cases — `architectural-
  clarity` and `product-scope`;** everything else is turned into routed work. Mixed
  gaps fix the autonomous ones first (kick to the earliest target step, bounded by a
  remediation cap), and the human gaps re-surface on the next audit and HALT then.
  Routing stays deterministic (the conductor reads the structured plan); the
  *judgment* is the agent's. Falls back to the deterministic `classifyPrdAuditGaps`
  routing when no usable plan is produced or the budget is exhausted. Adds
  `skills/remediate/SKILL.md` + `agents/remediation-planner.md`.

  _Planned follow-up:_ extend the same machinery to **finish-time test/build
  failures** — flake-check first, then route real failures back to `build` with
  cleanup tasks instead of `/finish` parking the branch.

### Changed

- **`.memory/` is now a symlink to the shared canonical store, not a tracked in-project
  directory.** `bin/conduct` sets up the canonical memory store via `conduct-ts memory setup`
  before any bootstrap sub-step runs, so `.memory/` is always a symlink when the bootstrap skill
  executes. The bootstrap skill's Step 5 `.memory/` creation instruction is removed — do not
  `mkdir .memory/` in a project; the directory will already be a symlink. Existing real `.memory/`
  directories in consumer projects are migrated automatically on the next `conduct` run (see
  Migration below).
- **ADRs are no longer sequentially numbered — named `adr-YYYY-MM-DD-<kebab-slug>.md`.**
  Sequential numbering (ADR-001, ADR-007, …) collides when parallel worktrees each grab
  "the next number" for a concurrently-authored decision. ADRs now use a date plus a short
  descriptive slug as both filename and identifier; supersession and verdict references cite
  the filename stem instead of a number. Updated `templates/adr.md.template` (dropped the
  `{{NUMBER}}` header) and the `/architecture-review`, `/conflict-check`, `/conduct`, and
  `/remediate` skill docs. Applies to **newly created ADRs only** — existing numbered ADRs
  keep their names (ADRs remain append-only).

- **`.serena/` is now gitignored in scaffolded and onboarded projects.** Serena's
  MCP server writes a `.serena/` directory (semantic-symbol cache, `project.yml`,
  and machine-written `memories/`) into whatever project it runs against. Since
  the harness registers Serena at user scope, every consumer project picked up
  this directory as untracked state. It's regenerated locally and not source, so
  `conduct create` now seeds `.serena/` into the `.gitignore` skeleton
  (`registry-cli.ts`) and `/bootstrap` adds it when onboarding an existing
  project. The harness repo's own `.gitignore` ignores `.serena/` (and the
  session-local `.handoffs/`) too.

- **Run-specific SHIP artifacts moved from tracked `.docs/` to gitignored
  `.pipeline/` with stable filenames.** `manual_test`, `prd_audit`, and
  `architecture_review_as_built` now write their evidence to
  `.pipeline/manual-test-results.md`, `.pipeline/prd-audit.md`, and
  `.pipeline/architecture-review-as-built.md` (a stable name, overwritten each
  run) instead of date-stamped files under `.docs/`. These are run evidence, not
  durable design records, and tracking them caused three recurring failures:
  (a) the daemon's finish-time rebase precheck HALTed on the dirty/uncommitted
  tree they left behind (`cannot rebase: you have unstaged/uncommitted
  changes`), parking the feature for a human — this halted features twice in
  practice; (b) a new date-stamped file accumulated every run (artifact sprawl)
  and conflicted on rebase/merge; (c) the as-built freshness gate retried every
  run because the prior session's date-stamped file was always stale. Durable
  design docs (PRDs, stories, plans, ADRs, and the design-time architecture
  review) remain tracked in `.docs/`. Gate completion checks now read the new
  `.pipeline/` paths; their on-disk freshness logic is unchanged. Old tracked
  copies left in existing repos (`.docs/audits/*-prd-audit.md`,
  `.docs/decisions/architecture-review-as-built-*.md`,
  `.docs/manual-test-results.md`) are now inert and may be removed with
  `git rm`.

### Fixed

- **Daemon rebase step now uses `git rebase --autostash`, so a dirty worktree no
  longer mis-parks as a "rebase conflict" the operator can't resolve.** A build or
  lint step can leave uncommitted changes in the worktree (e.g. a formatter
  dropping an unused import without committing). Plain `git rebase` refuses with
  *"cannot rebase: You have unstaged changes"*; `performRebase` saw a non-zero exit
  with **zero unmerged files** and HALTed it as a `conflict_halt` whose reason was
  the unstaged-changes error — leaving the feature stuck in a re-kick loop that
  could never succeed (the dirty tree blocked every retry). `--autostash` stashes
  the stray changes, rebases, and reapplies them, so a clean (non-overlapping)
  rebase succeeds with a dirty tree. A genuine overlapping conflict still HALTs
  (covered by a new real-git test alongside the dirty-tree case).

- **Daemon now fast-forwards its root checkout on each idle poll and cuts
  worktrees from fresh `main` — eliminating spurious `ENOENT` HALTs when local
  `main` lagged origin.** The daemon discovered/validated specs against the
  `origin/<default>` remote-tracking tree but *materialized* them by `copyFile`-ing
  from the local working tree, which it only ever `fetch`ed — never advanced. Once
  a spec PR merged on origin while the local checkout sat behind (the steady
  state), discovery found the spec yet the copy failed (`copyfile … .docs/stories/
  <slug>.md`). Root-fixed by replacing the fetch-only discovery ref with
  `fastForwardRoot`: on each idle poll the daemon does a **safe** `git merge
  --ff-only origin/<default>` of its checkout (only when on the default branch with
  a clean tree — otherwise it logs a warning and skips, never clobbering), then
  discovers and cuts each worktree from that now-current branch. Because the
  worktree forks from fresh `main`, the vetted stories+plan already exist in it, so
  the brittle `materializeSpecs` copy step is **removed entirely** (`BacklogItem`
  no longer carries working-tree paths). The fast-forward runs only between work
  (never mid-build) and never touches in-flight worktree checkouts.

- **Conductor now deletes a stale prior-session `.pipeline/` artifact before
  re-running a FAILED or REWORKED gated re-review step — reuse-loop HALTs are
  impossible by construction.** This is the deterministic complement to the
  as-built skill-prose fix: instead of trusting an unattended agent to rewrite, the
  conductor sweeps the stale artifact for `manual_test` / `prd_audit` /
  `architecture_review_as_built` (`sweepStaleReviewArtifacts`), so the agent cannot
  satisfy the freshness gate by reusing a prior-session artifact it declined to
  rewrite — it must regenerate it this session, or the gate fails honestly as
  "missing". The sweep fires **only when re-entering a step whose prior status was
  `failed` or `stale` (kicked back)** — never on a clean first run, which has no
  prior attempt to reuse. Scoped to those three SHIP re-review steps; `build`'s
  cumulative `task-status.json` is never swept; no-op when `session_started_at` is
  unset (legacy → fail open) or the artifact is already fresh this session
  (within-session retries keep their output).

- **As-built architecture review now (over)writes its artifact on every run, so
  a resumed feature stops HALTing on a "stale" gate.** `session_started_at` is
  reset on every conductor (re)start, and the as-built completion gate checks the
  artifact's mtime against it. The `architecture-review --as-built` skill said the
  artifact is "overwritten each run" only descriptively, so in unattended mode the
  agent reused a prior-session artifact it judged "more complete" and never
  rewrote it — the gate then read it as stale, failed, and (after retries) HALTed
  the SHIP tail. Observed live on honeydew after the feature resumed across the
  remediate/prd-audit fixes. The skill now makes the write an unconditional,
  final-action imperative that explicitly preempts the reuse rationalization and
  names the stale-gate consequence. (`skills/architecture-review/SKILL.md` §12.)

- **PRD-audit completion gate no longer false-blocks an ALIGNED FR when its
  Evidence prose contains a verdict word.** The gate's row parser scanned the
  whole table row for `MISSING`/`PARTIAL`/`DIVERGED`, so an ALIGNED row whose
  Evidence cell read e.g. `find_kid_for_parent → 404 foreign/missing` was flagged
  as un-ALIGNED — failing the SHIP gate (`prd-audit found un-ALIGNED FRs: FR-9`)
  on a clean PASS and looping the daemon. The parser now reads the **verdict
  cell** (the first verdict-bearing cell to the right of the `FR-<n>` cell, where
  the Verdict column sits ahead of Evidence) instead of the whole row, shared by
  both the completion check and the daemon's gap classifier. ACCEPTED-override,
  gap-class detection, header/separator skipping, and stale-report handling are
  unchanged. Regression test covers the live FR-9 case.

- **Autonomous `/remediate` no longer crashes the conductor with `Unknown step:
  remediate`.** The `remediate` SHIP sub-routine is dispatched out-of-band (only
  when a `prd_audit` blocks) and is deliberately absent from the linear
  `ALL_STEPS` sequence, but it was never registered anywhere the runner resolves
  a step's phase/index/label. So the moment the conductor tried to dispatch it,
  `phaseForStep` (via `resolveStepConfig`) and `getStepDefinition`/`getStepIndex`
  (in `buildSystemPrompt`) threw `Unknown step: remediate` — which the daemon
  caught and turned into a `.pipeline/HALT`, defeating the whole point of
  autonomous remediation. Added an `OUT_OF_BAND_STEPS` registry that
  `getStepDefinition`/`phaseForStep` fall back to (so out-of-band steps resolve a
  label + `SHIP` phase without occupying a gate-loop slot), a non-throwing
  `tryGetStepIndex`, and a labelled dispatch header for steps with no linear
  position. A genuinely unknown step still throws.

- **Daemon feature errors are now diagnosable (capture + HALT) instead of an
  opaque `error`.** When a feature threw — a crashed step, or worktree-prep /
  `bin/setup` failing — the daemon logged a bare `error`, dropped the captured
  reason, and excluded the slug for the rest of the run with no on-disk trace
  (the cause could only be found by re-running the failing command by hand). Now
  any feature error writes a diagnostic `.pipeline/HALT` into the worktree with
  the captured reason + a resume procedure, the daemon log surfaces the reason
  on the outcome line, and the feature is parked (like a halt) so it re-dispatches
  once the operator fixes the cause and clears the marker — rather than being
  silently excluded.
- **`prd_audit` impl-gap self-heal now actually reaches the BUILD agent (was a
  no-op loop).** When a daemon `prd_audit` blocked on an implementation gap, the
  conductor routed control back to BUILD but dispatched it with no context: the
  failing-FR summary was emitted only as a dashboard event, and the build step
  re-declared `retryHint = undefined` on entry, so `/pipeline` saw a complete
  task list and changed nothing. The re-audit then failed the same FRs until the
  self-heal cap and HALTed — never fixing anything. The kickback now queues a
  `retryReason` for BUILD naming the un-ALIGNED FRs and pointing at
  `.pipeline/prd-audit.md` for per-FR `file:line` evidence, instructing the agent
  to make the code changes even though the task list shows complete. (#115)
- **Daemon no longer re-enters every resumed feature at `acceptance_specs`.** The
  daemon constructed the conductor with a hardcoded `fromStep: 'acceptance_specs'`,
  which both set the loop's start index to the first BUILD step and marked it
  `explicitlyTargeted` — so `acceptance_specs` was re-run on every re-dispatch,
  even when the feature was already at `prd_audit` / `finish`. The daemon now
  passes `resume: true`: with the DECIDE steps pre-seeded done, a fresh feature
  still resumes at `acceptance_specs` (its first pending step), while a
  re-dispatched feature with recorded BUILD/SHIP progress resumes at its real next
  step instead of needlessly re-entering BUILD from the top each cycle.
- **Daemon restart no longer re-dispatches (and clobbers) human-parked halted features.**
  The daemon tracked parked/halted features only in process memory and recorded only `done`
  features in the durable `.daemon/processed/` ledger. After a restart that memory was empty,
  so a feature halted for a human — whose merged spec is still on the base branch — looked
  fresh, got re-dispatched, and re-entered the conductor over its kept worktree, regressing
  `conduct-state.json` (e.g. `last_step` reset to `acceptance_specs` while later steps showed
  `done`). The durable `.pipeline/HALT` marker was consulted only to *un-park* a slug already
  in the in-memory set, never to *park* one at discovery. `pickEligible` now checks the
  on-disk HALT marker for any candidate the current process never dispatched, making worktree
  status — not the base branch plus lost memory — authoritative across restarts. This is the
  root cause behind the recurring "restart wipes halted-project state" symptom that earlier
  fixes addressed only downstream of the re-dispatch.
- **Daemon re-dispatch of halted features no longer wipes BUILD/SHIP progress.** When a
  feature halts mid-BUILD or mid-SHIP and is re-queued (after clearing `.pipeline/HALT`),
  the daemon now preserves prior step statuses in `conduct-state.json` instead of
  unconditionally overwriting it. The run resumes from the first pending step after the
  halt point rather than restarting from `acceptance_specs`.

### Added

- **Daemon worktree preparation: `WORKTREE_NAMESPACE` + `bin/setup`.** Before building a
  feature, the daemon now (1) writes `WORKTREE_NAMESPACE=<worktree>` into the worktree's `.env`
  and (2) runs the project's conventional `bin/setup` non-interactively (`CI=true`, with
  `WORKTREE_NAMESPACE` exported) if it exists — after spec materialization and **before** the
  build. Worktree creation is the daemon's job, so it establishes the per-worktree identity in
  one place; the project's standard config consumes it (e.g. a Rails `database.yml` builds
  `app_<env>_<namespace>` and `bin/setup`'s `db:prepare` creates it), so concurrent worktrees
  build against isolated databases inside one **shared** stack without colliding. Reusing the
  standard `bin/setup` (rather than a bespoke daemon-only script) means the daemon runs exactly
  what a human/CI runs — no second setup path to drift. A non-zero exit (or a
  present-but-non-executable `bin/setup`) throws and the feature is kept/errored rather than
  built against a half-prepared environment — fixing the class of daemon halts caused by
  project infra/setup that was never run in the worktree. New `engine/worktree-prepare.ts`;
  wired via the optional `prepareWorktree` dep on `FeatureRunnerDeps`. Documented in
  `src/conductor/README.md`.

- **Optional Serena semantic-code MCP integration.** `./bin/install` now offers an opt-in
  install of [Serena](https://github.com/oraios/serena) (`oraios/serena`) when `uv` is
  present — prompted, not auto-forced, since it's a heavyweight LSP-backed toolkit. Once
  installed, `/bootstrap` auto-registers it as a **user-scope** MCP server
  (`claude mcp add --scope user serena -- serena start-mcp-server --context claude-code
  --project-from-cwd`) when it's on PATH and not already configured (idempotent via
  `claude mcp get serena`). Graceful no-op when `uv`/Serena are absent; install skipped in
  non-interactive shells. Documented in `README.md` and bootstrap §9a.

- **Daemon surfaces a persistently-unbuildable merged spec once, not forever.** When a
  merged spec can never satisfy the backlog gate (stories not `Status: Accepted`, or no plan
  dependency tree), `discoverBacklog` previously re-logged the identical `skip …` line on
  **every** poll tick. It now emits the skip **once per slug** via `.daemon/warned/<slug>`
  markers (`hasWarned`/`markWarned` in `engine/daemon-deps.ts`, wired through
  `DiscoverBacklogOpts`), then suppresses repeats until the spec is fixed (after which it
  becomes eligible, builds, and is marked processed). The approval-token logic is now a single
  shared `isStoriesApproved` exported from `engine/artifacts.ts` and consumed by both the
  daemon and the engineer land gate, so the chain can never disagree on the marker.
- **GitHub-issues intake + bidirectional write-back for the engineer (Phase 9.3b).**
  The engineer can now take work from GitHub issues, not just chat. A new `github-issues`
  intake adapter (`engine/engineer/intake/github-issues.ts`, an `IntakeSource` + `IntakePort`)
  captures open issues **assigned to you** across registered repos via an injected `gh` runner
  (`conduct-ts engineer poll` — one synchronous sweep, no background timer), enqueuing each into a
  durable file-backed **inbox** (`<engineer-dir>/inbox/`, atomic `O_EXCL`/rename claim, isolated
  from the daemon lock). A durable **intake ledger** (`intake/ledger.ts`) keyed `(source, sourceRef)`
  is the sole dedup authority (the old in-memory guard was removed): polling twice captures nothing
  new, and cross-repo same-number / re-filed-new-number ideas stay distinct. Empty issues are
  skipped and a failing repo is isolated from the rest. `runEngineerMode` gains **poll-on-launch**
  wiring: it polls, enqueues, and processes exactly one (oldest) envelope through the existing gated
  route→author→spec-PR loop, falling back to chat capture on an empty inbox. **Write-back** posts
  `Routed to <repo>` and `Spec PR opened: <url>` comments back to the issue and applies (auto-creating)
  an `engineer:handled` label on done — non-fatal (a `gh` outage never reverts a delivered spec PR)
  and de-duplicated per `(sourceRef, status)`. A `done` issue whose spec PR **closes unmerged** is
  re-emitted on the next poll (label stripped, attempts incremented); a merged PR is never reopened,
  and past the churn cap the issue is parked `needs-manual` until `conduct-ts engineer forget
  <owner/repo#N>` clears its ledger entry and label. Capture never writes to a registered repo's
  working tree (cross-repo isolation verified end-to-end). FR-25→FR-40; ADR-011 (async intake queue +
  github source) + ADR-012 (durable ledger sole dedup authority).
- **Daemon log capture + `conduct-ts daemon status` / `daemon logs` observability.**
  The build daemon is spawned detached (`stdio:'ignore'`), so every log line — including
  the per-feature BUILD progress rendered by `renderDaemonEvent` — was discarded: you
  could see *that* a daemon was alive (via its pidfile) but not *what it was doing*. Now
  `runDaemonMode` tees its log sink into an append-only **`.daemon/daemon.log`**
  (`engine/daemon-log.ts`, opened once the per-repo pidfile lock is held; size-capped
  ~1 MB with one-file rotation to `daemon.log.1`). Because the renderer and every feature
  start/finish line already route through that one sink, the file captures the full build
  narrative — feature start, each gate-loop step result (`step_completed` / unsatisfied
  `gate_verdict` / `kickback` / `loop_halt`), and finish (`shipped`/`failed` + PR url) —
  visible live via `daemon logs --follow`. Two read-only sub-subcommands of `daemon`
  (`engine/daemon-observe-cli.ts`, dispatched before the pipeline boots and before the
  `daemon` run command, so `status`/`logs` are never mistaken for a launch):
  `daemon status` iterates the project registry and reports each repo's pidfile liveness
  (`running` / `stale` / `stopped` / `path missing`) + pid, start time, and last activity,
  reusing the `daemon-lock.ts` `readPidRecord`/`isLive` primitives; `daemon logs
  [--repo <path>] [--follow] [--all]` prints or tails the log for one repo (default cwd)
  or every registered repo. Negative paths covered (missing/corrupt log, dead pid,
  unreadable `.daemon/`, stale registry path). The pidfile path and O_EXCL create flag
  stay confined to `daemon-lock.ts` (boundary test); the log module reuses the newly
  exported `daemonDir()` and never re-encodes the pidfile.
- **`conduct-ts engineer` launches the interactive idea→spec loop.** Running the bare
  `conduct-ts engineer` command now drops the operator into an interactive
  `claude /engineer` session (stdio inherited, human-in-the-loop) instead of
  printing a pointer and exiting. This is the agent-hosted front door (ADR-008):
  the launched session runs the real `/engineer` skill — routing, DECIDE, spec PR —
  in-chat. It is **not** the forbidden headless `claude -p` substrate (that did
  autonomous routing/authoring and was removed); this is an operator-driven
  entrypoint. When already inside a Claude Code session (`CLAUDECODE` set) it prints
  a note to run `/engineer` directly rather than spawning a nested session, and
  falls back to printing usage if the `claude` CLI is not on `PATH`. The
  `projects` / `land` / `handoff` subcommands remain deterministic primitives the
  skill calls (`src/conductor/src/engine/engineer-cli.ts`). The launcher is backed
  by the new `/engineer` skill (`skills/engineer/SKILL.md`), now installed via the
  installer fix below. The launched session is started with `--permission-mode
  default` (never `plan`) so the engineer can author artifacts, branch, and run
  `land`/`handoff` even when the user's global `defaultMode` is `plan`; override the
  mode with `CONDUCT_ENGINEER_PERMISSION_MODE` (e.g. `acceptEdits`) — `plan` is
  rejected.

### Changed

- **Daemon prd-audit halts only on product/plan gaps, self-heals implementation gaps.** A
  blocking `prd_audit` in a daemon run (`mode: 'auto'`, `daemon: true`) is now routed by its
  `Gap-class` column instead of always halting. An **all-`impl-gap`** audit routes back to BUILD
  (`kickback` → `navigateBack('build')`), rebuilds, and re-audits, bounded by
  `MAX_KICKBACKS_PER_GATE` (then HALTs `impl-gap unresolved after N build attempts`). **Any**
  product/plan gap (`intended-drift`, or an unclassifiable blocking row) HALTs immediately
  (`product/plan gap needs human DECIDE`) since the DECIDE amendment can't be made autonomously.
  The daemon also skips the pointless per-step retries on a blocking audit (re-auditing unchanged
  code yields the same verdict). New `classifyPrdAuditGaps` / `findUnalignedFrRowsWithClass` in
  `engine/artifacts.ts`; routing in `Conductor.run`. Interactive `/conduct` is unchanged (human
  recovery menu). Docs: `src/conductor/README.md`, `skills/prd-audit/SKILL.md`,
  `skills/conduct/SKILL.md`.

- **`/stories` stamps the canonical `Status: Accepted` approval marker.** The skill now
  explicitly changes `**Status:** DRAFT` → `**Status:** Accepted` on operator approval (and
  documents that a missing status line counts as **not approved**), reconciling the stories
  chain on one token. The template carries a file-level `**Status:** Accepted` header and the
  verification checklist asserts it. A new `test/test_harness_integrity.sh` check ties this
  skill instruction to the code gate so the two cannot drift.
- **The inline SDLC pipeline is now a subcommand: `conduct-ts inline "<feature>"` (was the
  bare `conduct-ts "<feature>"`).** Completing the verb-first CLI — the foreground pipeline is
  the explicit counterpart to the background `daemon`, so every mode is a named subcommand and
  no invocation relies on a bare positional. All pipeline flags move onto it unchanged
  (`--auto`, `--interactive`, `--resume`, `--status`, `--from`, `--step`, `--report`,
  `--diagnose`, `--cleanup`, `--reset`, `--model`, `--view`, `--tail-lines`, …), e.g.
  `conduct-ts inline --auto "URL shortener"` / `conduct-ts inline --status`. A bare
  feature/flags invocation now errors with guidance instead of silently running. Dispatch
  mirrors the other subcommands: `detectInline` (`src/conductor/src/cli.ts`) strips the token
  before `parseArgs`; `inline` is listed in `--help`. **Breaking CLI change** — see Migration
  below.

- **Harness gates hardened against the orphaned-primitive + path-guard escape classes
  (Phase 9.3 retro H-1 / H-2 / C-2).** Two recurring Phase-9 escape classes — a
  *replacement* whose new code ships orphaned (live path still calls the old symbol) and a
  path/prefix guard with an untested boundary that fails closed/open — now have cheap
  mechanical gates instead of relying solely on the fresh-context final evaluator:
  `skills/writing-system-tests/SKILL.md` gains **§3b** (replacement tasks must include ≥1
  acceptance test that drives the REAL production entry point and asserts the observable
  artifact, not the new unit) and **§3c** (a mandatory boundary-value checklist —
  trailing-slash / root / empty / sibling-prefix — for any path or prefix guard);
  `skills/pipeline/SKILL.md` gains a **"Superseded-symbol check (step 5)"** that greps the
  superseded symbol for zero non-test callers in `src/` before a replacement task is marked
  complete, running *before* the expensive batch-evaluator dispatch so the orphaned-primitive
  class fails fast. (The companion C-4 SHIP-phase "read the governing APPROVED ADR/PRD before
  remediating" triage rule already shipped in `skills/manual-test/SKILL.md` §6.)

- **Engineer post-authoring handoff extracted into a named step (Phase 9.3 cleanup,
  retro A-2/A-3).** The route→gate→author→PR→ensure-running god-chain inside
  `loop.ts` `processIdea` had grown to 473 LOC; the post-authoring tail (PR-open vs
  no-remote local commit, `ensure-running` fire-and-forget, authored-ledger entry) is
  now `runHandoff(target, branch, deps)` in `engine/engineer/handoff-step.ts` with its
  own focused unit test. `processIdea` calls it; `loop.ts` drops to 432 LOC. This keeps
  the loop maintainable before 9.3b adds intake adapters. **No behavior change** — the
  full engineer acceptance suite is unchanged. As part of the extraction the remote
  branch's `deps.gh!` non-null assertion (A-3) is replaced by an explicit gh-present
  guard, so a remote target with no wired `gh` runner throws a clear error instead of
  relying on a type-hole. Engineer routing tests (A-1) now assert the *specific*
  no-side-effect invariant on decline/redirect — the proposed repo's directory listing
  AND registry record count are byte-for-byte unchanged (each shown falsifiable under an
  injected mutation) rather than merely asserting an offer string was printed.

- **Daemon mode is now a subcommand: `conduct-ts daemon …` (was `conduct-ts --daemon`).**
  This makes the CLI verb-first and consistent with `engineer` / `register` / `create`
  — every long-running or non-interactive mode is now a named subcommand rather than a
  bare flag. All daemon options move onto the subcommand unchanged
  (`--concurrency`, `--max-items`, `--continuous`, `--max-cost`, `--max-runtime`,
  `--idle-poll`, `--max-idle-polls`), e.g. `conduct-ts daemon --concurrency 3 --max-items 10`.
  Dispatch mirrors the engineer pattern: a lightweight `detectDaemonCommand`
  (`src/conductor/src/engine/daemon-command.ts`) parses argv before the interactive
  pipeline boots, and `runDaemonMode` is still imported lazily. The engineer's
  `ensure-running` auto-launch (`daemon-launch.ts`) now spawns `conduct-ts daemon …`
  accordingly. **Breaking CLI change** — see Migration below.
- **The build daemon's console output is now colorized.** `[daemon] …` log lines
  (step boundaries, failures/retries, unsatisfied gates, kickbacks, halts/convergence,
  rate limits) and the worker-pool `▶ start` / `■ done` lines now use the same
  color vocabulary as the interactive TTY dashboard (green ✓, cyan ▶, red ✗, yellow
  warnings, dim chrome) so unattended runs are scannable at a glance. Color is
  applied via `chalk`, which auto-disables under `NO_COLOR` or when stdout is not a
  TTY — piped or redirected daemon logs stay byte-identical plain text
  (`src/conductor/src/daemon-cli.ts`, `src/conductor/src/engine/daemon.ts`).

### Removed

- **The `--daemon` flag.** Replaced by the `conduct-ts daemon` subcommand (above).
  `conduct-ts --daemon` now errors as an unknown flag.

### Fixed

- **Daemon: a reused worktree no longer inherits a stale Claude session, and a
  mid-pipeline throw no longer loses state.** On a kept worktree (reused on a later daemon
  cycle after a prior halt/error — `createWorktree` is idempotent), the prior run's
  `.pipeline/session-created`/`conduct-session-id` markers survived, so the new runner's
  lazy-init set `sessionStarted=true` and the first step (`acceptance_specs`, which sits
  before the `build` index and so was NOT covered by `freshContextPerStep`) dispatched
  `claude --resume <fresh-uuid>` for a conversation that never existed → "No conversation
  found" → *"session unavailable (expired or in use) — resetting to a fresh session"*,
  errored the feature out, and left `conduct-state.json` inconsistent (build done, SHIP
  entries missing). Reproduced at `--concurrency 1`. Now: `freshContextPerStep` resets the
  session before **every** executed step (no cross-step context retention — sessions are
  fresh per step across the whole build→ship loop; retries within a step still resume), the
  first reset discards the inherited stale session, and `daemon-cli` sweeps the stale
  markers on (re)entry. Separately, any unexpected throw inside the conductor loop now
  flushes state and writes a `.pipeline/HALT` marker (`loop_halt`), so a supervising daemon
  classifies it as `halted` (worktree kept, parked, retryable) instead of `error` with lost
  SHIP state. Tests added: runner stale-marker override, fresh-session-per-step
  interleaving, first-step reset (daemon worktree-reuse), and halt-on-throw.
- **Stories without `Status: Accepted` are now rejected at land instead of silently skipped
  at build.** A stories file with no status line passed the engineer land gate
  (`land-spec.ts` only rejected `Status: DRAFT`/empty/stub) yet was then skipped **forever**
  by the daemon backlog (which requires `Status: Accepted`) — a merged spec that could never
  build, re-logging an identical skip on every scan. `landSpec` and `runAuthoring` now
  **require** the canonical `Status: Accepted` marker on stories (via the shared
  `isStoriesApproved`), failing loudly at land/author time so the mismatch can never reach a
  silently-skipping daemon. Tests added at each seam (land-spec, authoring, daemon-backlog,
  and the `isStoriesApproved` token contract).
- **The `acceptance_specs` completion gate no longer false-halts on monorepo layouts.**
  Its built-in artifact globs (`STEP_ARTIFACT_GLOBS.acceptance_specs`, `engine/artifacts.ts`)
  were all rooted at the repo root, so correctly-written RED specs that land one package deep
  (`api/spec/integration/…`, `frontend/__tests__/screens/Foo.test.tsx`) matched nothing — the
  daemon retried 3×, found "no spec files," and halted even though valid specs were committed
  (observed: honeydew-or-handymando PR #39, 1,018 lines of RED specs). Three additive fixes:
  (1) a new project-level **`acceptance_spec_globs`** config key lets a repo declare where its
  specs live; those globs are *appended* to (never replace) the built-ins, so the gate can
  only loosen and standard Rails/Node-at-root layouts are unaffected. It is threaded to the
  check via `CompletionContext.config` (populated at every `conductor.ts` gate site, including
  the daemon gate-loop's `computeAndWriteVerdict`). (2) The custom glob matcher now expands a
  leading `*/` segment to each immediate subdirectory of the repo root (skipping
  `node_modules`/dot-dirs, preserving the no-`node_modules` property), so a repo can declare
  `*/spec/**` / `*/__tests__/**` without naming each package. (3) The built-in defaults gain
  `.tsx`/`.jsx` test extensions (`*.test.tsx`, `*.spec.tsx`, …) for React/React-Native repos.
  Regression-tested in `test/engine/artifacts.test.ts` (monorepo passes with config; zero
  specs still fails; `*/` won't reach into `node_modules`) and `test/engine/config.test.ts`
  (key validation + merge).
- **Daemon discovers specs merged on origin — but only fetches between work, never
  while a build is running.** The daemon scanned `.docs/plans` only against the
  *local* default branch, so a spec merged on GitHub (origin's main) was invisible
  until an operator manually ran `git pull` — the daemon could lag indefinitely.
  Now the worker pool refreshes from origin **only when it is fully idle with no
  local work left to start** ("drained → find more"): discovery is local-first
  (`refresh:false`, no fetch), and a `git fetch origin <default>` happens *only* when
  that local scan comes up empty and nothing is in flight. While features are
  building (or local queued work remains) there is **no fetch**, so an in-flight
  build is never re-based onto specs that landed on origin mid-run. `resolveDiscoveryRef`
  (`engine/daemon-backlog.ts`) discovers the real default branch via
  `git symbolic-ref refs/remotes/origin/HEAD` (no hardcoded `main`/`master`); on an
  idle refresh it fetches and returns `origin/<default>` (so `gitTreeSource` reads the
  remote-tracking ref the fetch updates), and between fetches it reuses that already-
  fetched ref so the whole batch stays discoverable across concurrent slots without
  new network access. Degrades gracefully: no origin remote, unset origin/HEAD, a
  failed fetch (offline), or an unfetched ref all fall back to the local base and log;
  the poll loop never throws. Fetch + read happen only in the main checkout dir — no
  `git checkout`, no `git reset`, no worktree touches.

- **`conduct-ts --help` is now a complete, recursive command reference.** Top-level `--help`/`-h`
  rendered the *base* program (bare-pipeline flags only), so `register`, `create`, `engineer`, and
  `daemon` were invisible and the run exited non-zero after leaking an `(outputHelp)` line. Root
  help now prints a single document that recurses through **every** command and sub-subcommand —
  the top-level surface plus a titled section per command documenting its options and nested
  commands (`engineer projects`/`land`/`handoff`, `daemon status`/`logs`). `renderFullHelp`
  (`src/conductor/src/cli.ts`) walks the command tree depth-first; `index.ts` routes a top-level
  help request to it (exit 0), after the subcommand dispatchers so `conduct-ts engineer --help`
  (and the other subcommands) keep their own help. `parseArgs` still uses the base program so a
  bare feature description is never mistaken for an unknown command.

- **The continuous daemon now re-attempts a halted feature after its HALT marker is cleared.**
  When a feature halted, `runDaemon` (`engine/daemon.ts`) left its slug in the process-lifetime
  `started` set forever, so the eligibility predicate
  (`!started.has(slug) && !inFlight.has(slug)`) permanently hid a parked-then-unparked feature
  from every later scan — the only recovery was to kill and restart the whole daemon. The
  halted feature was still in `discoverBacklog` (halted ≠ processed) and `createWorktree`
  already resumes a matching existing worktree, so the in-memory exclusion was the sole blocker.
  Halted slugs are now tracked in a separate `parked` set and become re-eligible once their
  `.pipeline/HALT` marker is gone, detected via a new injected `isHalted` dep (production wires
  `isHalted(worktreeBase, slug)` in `engine/daemon-deps.ts` → `daemon-cli.ts`). The next scan
  re-dispatches the feature, reuses the existing worktree, and resumes from the first non-done
  step; while the marker is present the feature stays parked (no busy re-halt loop), and a
  feature that halts again is re-parked until cleared. Double-dispatch protection for in-flight
  and freshly-started features is preserved, and `done`/`error` outcomes are unchanged. Without
  the `isHalted` dep (pure-core default) a parked feature stays parked for the run, exactly as
  before. Three new daemon unit tests cover park-while-present, re-dispatch-after-clear, and
  re-park-on-re-halt.

- **The build daemon now builds a spec only after its PR is merged (FR-24 gate enforced).**
  `discoverBacklog` (`engine/daemon-backlog.ts`) scanned the **working-tree** `.docs/plans`,
  so the instant the engineer authored an Accepted, well-formed spec into the target repo's
  working tree — *before* `land`/`handoff` and well before any merge — a running
  `--continuous` daemon picked it up and built it. The documented "a merged spec PR is the
  only idea→build handoff" contract was unenforced (the FR-24 tests modeled "unmerged" as
  "artifacts absent from the scanned dir", which never holds once the engineer writes them
  in-tree). Discovery now reads artifacts from the **committed default branch** via a
  `BacklogTreeSource` (`git show <baseBranch>:…`), never the working tree and never a
  `.worktrees/` copy, so an unlanded spec or one living only on an unmerged `spec/<slug>`
  branch is invisible until the operator merges it to `<baseBranch>`. New git-backed tests
  reproduce the exact gap (working-tree-present-but-unmerged → not built; merged → built).

- **The build daemon now claims its pidfile on boot — liveness is finally observable
  (ADR-010).** The pidfile-lock primitive (`daemon-lock.ts`) was fully built and tested
  but **never wired into the daemon's boot path**: `runDaemonMode` never wrote
  `.daemon/`'s pidfile, so `process.kill(pid,0)` liveness had no pid to probe and the
  1-per-repo mutex `ensureRunning` relies on never engaged (it would spawn duplicates).
  New `holdLock(repoPath)` claims the pidfile with the daemon's real pid on boot
  (refusing to start if a live daemon already owns it), and releases it on exit; a
  dead-pid pidfile self-heals via reclaim. This is the engine-loop half of the
  observability gap — capturing daemon **logs** to a file (today the detached spawn
  uses `stdio:'ignore'`) plus `conduct daemon status`/`logs` land in a follow-up branch.

- **`bin/install` now auto-discovers every skill instead of a hardcoded list.**
  The `SKILLS` array was maintained by hand and had drifted: skills added under
  `skills/` (e.g. `engineer`, `prd-audit`) were never symlinked into
  `~/.claude/skills/`, so their `/slash-commands` silently failed to resolve. The
  installer now enumerates every `skills/<name>/` directory containing a `SKILL.md`,
  guaranteeing all skills link on install/`--update`.

### Changed

- **Design-conformance-before-effort control** baked into the harness as an
  enforced gate, not just memory. New HARNESS.md Key Convention applies whenever
  code is written, fixed, or hardened, at every phase; a BUILD-phase conformance
  check added to `skills/pipeline/SKILL.md` per-task dispatch; SHIP/fix gates
  added to `skills/debugging/SKILL.md` (Phase 4) and `skills/manual-test/SKILL.md`
  (Bug Loop). A code path that violates or is superseded by an APPROVED ADR/PRD is
  a conformance finding (kickback/BLOCK), not work to do — building or hardening
  code slated for deletion is wasted effort.
- **Harness `.gitignore` now ignores `.daemon/` (and `.worktrees/`).** With the new
  daemon log capture, a daemon run inside `src/conductor/` writes `.daemon/`
  (pidfile + `daemon.log`); the root `.gitignore` previously ignored only
  `.pipeline/`/`.memory/`, so those runtime files showed up as untracked. New
  projects already get all three via the `conduct create` `GITIGNORE_SKELETON`
  (`.pipeline/`, `.daemon/`, `.worktrees/`); the `bootstrap` skill's `.gitignore`
  guidance + checklist now list `.daemon/` too, and existing projects pick it up
  via the migration below.

### Migration

Existing conductor-managed projects should ignore the daemon's `.daemon/` directory
(pidfile + `daemon.log`) now that the daemon writes a persistent log there. New
projects scaffolded by `conduct create` already include it; this back-fills older
ones. Idempotent — safe to re-run.

```bash migration
# Ensure the daemon state dir is gitignored (pidfile + daemon.log live here).
if [ -f .gitignore ]; then
  grep -qxF '.daemon/' .gitignore || printf '.daemon/\n' >> .gitignore
else
  printf '.daemon/\n' > .gitignore
fi
echo "ensured .daemon/ is in .gitignore"
```

## Migration

The daemon flag became a subcommand. Update any scripts, aliases, cron entries, or
shell history that invoke `conduct-ts --daemon`:

```bash
# Rewrite `conduct-ts --daemon` → `conduct-ts daemon` in your own scripts.
# (Adjust the path glob to wherever you keep daemon launch scripts.)
grep -rl --null -- 'conduct-ts --daemon' . 2>/dev/null \
  | xargs -0 -r sed -i 's/conduct-ts --daemon/conduct-ts daemon/g'
```

The daemon's options are unchanged — only the leading `--daemon` flag becomes the
`daemon` subcommand token. The engineer's auto-launch path was updated in-tree, so no
action is needed for `ensure-running`.

The inline pipeline likewise became a subcommand. Update any scripts, aliases, cron
entries, or shell history that invoke the bare pipeline form. Auto-rewriting is unsafe
(`conduct-ts` is also followed by `daemon`/`engineer`/`register`/`create`/`inline`/flags),
so flag candidates for manual review rather than blindly rewriting:

```bash
# The bare inline pipeline now requires the `inline` subcommand:
#   conduct-ts "<feature>"   ->   conduct-ts inline "<feature>"
# Read-only: list conduct-ts invocations that may be bare pipeline runs.
grep -rnE 'conduct-ts +(["'\'']|[A-Za-z])' . 2>/dev/null \
  | grep -vE 'conduct-ts +(inline|daemon|engineer|register|create|help|--)' \
  || echo "No bare conduct-ts pipeline invocations found."
```

Pipeline flags are unchanged — they simply move after the `inline` token
(`conduct-ts inline --auto "<feature>"`, `conduct-ts inline --status`, …).

The `.memory/` directory has moved from an in-project directory to a durable shared canonical
store keyed by project. New bootstraps and the next `conduct` run on any existing project apply
the migration automatically via `conduct-ts memory setup`. If you need to migrate manually before
the next `conduct` run (e.g. before pulling the harness update), run the block below from the
project root. Idempotent — no-op if `.memory/` is already a symlink.

```bash migration
# Migrate .memory/ to the canonical shared store under ~/.ai-conductor/memory/.
# No-op if .memory/ is already a symlink. Run from the project root.
_dir="$(pwd)"
_link="${_dir}/.memory"
if [ -L "${_link}" ]; then
  echo ".memory/ is already a symlink — no migration needed."
elif [ -d "${_link}" ]; then
  if command -v conduct-ts >/dev/null 2>&1; then
    conduct-ts memory setup "${_dir}"
  elif [ -x "${HARNESS_DIR:-}/bin/conduct-ts" ]; then
    "${HARNESS_DIR}/bin/conduct-ts" memory setup "${_dir}"
  else
    echo "conduct-ts not found — please run 'conduct-ts memory setup ${_dir}' after updating." >&2
    exit 1
  fi
  echo "Migration complete. .memory/ is now a symlink to the canonical store."
else
  echo ".memory/ does not exist — it will be created automatically on next 'conduct' run."
fi
```

## [0.99.17] - 2026-05-02

## [0.99.16] - 2026-05-02

## [0.99.15] - 2026-05-02

## [0.99.14] - 2026-05-01

## [0.99.13] - 2026-05-01

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

### Fixed
- conduct-ts: the `engineer` routing adapter (Phase 9.3) built its provider call
  as `provider.invoke({ prompt } as any)`, omitting the **required** `sessionId`
  and `resume` fields of `InvokeOptions`. The `as any` cast hid the type error;
  at runtime the real `ClaudeProvider` emitted `claude --session-id undefined`,
  which the CLI rejects with *"Invalid session ID. Must be a valid UUID."* —
  every idea failed to route and silently fell through to "No matching project
  found. Would you like to create one?" even with a seeded registry. Fixed by
  passing a fresh `uuidv4()` session with `resume: false` (routing is a
  single-shot, stateless classification) and removing the `as any` cast so the
  type checker enforces the contract. Regression test
  (`test/acceptance/engineer-routing-session.test.ts`) drives the real
  `runEngineerMode` entry point and asserts the adapter hands the provider a
  valid-UUID `sessionId` — the seam no existing test exercised because every
  routing fake ignored its argument (same class as retro H-1).

- conduct-ts: the engine-native `rebase` loop step (Phase 9.0) could run a
  destructive `git rebase origin/<default>` against the **real** conductor
  worktree whenever a test drove a `Conductor` whose `projectRoot` resolved to
  the conductor's own checkout (the default is `process.cwd()`). It was a silent
  no-op while the dev branch stayed current with `origin/main`, but became a
  branch-corrupting rebase once `origin/main` advanced. Root-fixed by gating the
  step on daemon mode: rebase-on-latest is a **daemon finish-time mechanism**, so
  `runRebaseStep` now performs a clean no-op (gate still satisfied, loop topology
  unchanged) in any non-daemon run — interactive `/conduct` and the entire test
  suite. Only the daemon invokes git; humans rebase manually in interactive mode.
  `rebase-loop` integration specs now construct the `Conductor` with `daemon:true`
  (they exercise the real rebase against an isolated throwaway repo); `full-flow`
  and `plugin-end-to-end` also pass an isolated `projectRoot` as defence-in-depth.

### Changed
- **BREAKING (conduct-ts):** renamed the supervisor from **brain** to **engineer**.
  The CLI subcommand is now `conduct-ts engineer` (was `conduct brain`); the
  cross-project memory store moved from `~/.ai-conductor/brain/` to
  `~/.ai-conductor/engineer/`, and its env override from `$AI_CONDUCTOR_BRAIN_DIR`
  to `$AI_CONDUCTOR_ENGINEER_DIR`. The signal type `BrainSignal` is now
  `EngineerSignal` and `BrainStoreReader` is now `EngineerStoreReader`. No data
  format changed — only names and paths. See Migration below.

### Migration

If a previous `conduct-ts` daemon run created a cross-project store under the old
`brain` name, move it to the new `engineer` location and update any env override
in your shell profile (`AI_CONDUCTOR_BRAIN_DIR` → `AI_CONDUCTOR_ENGINEER_DIR`).

```bash migration
# Move the cross-project store dir to its new name (no-op if absent or already moved)
if [ -d "$HOME/.ai-conductor/brain" ] && [ ! -e "$HOME/.ai-conductor/engineer" ]; then
  mv "$HOME/.ai-conductor/brain" "$HOME/.ai-conductor/engineer"
  echo "moved ~/.ai-conductor/brain -> ~/.ai-conductor/engineer"
fi
# If you set AI_CONDUCTOR_BRAIN_DIR anywhere, rename it to AI_CONDUCTOR_ENGINEER_DIR.
```

### Added
- conduct-ts: **agent-hosted `engineer` redesign** (Phase 9.3). The engineer is
  reworked from a Node TTY REPL that spawned `claude -p` and wrote stub/DRAFT
  stories into an **agent-hosted, in-chat, human-gated DECIDE loop**: the host
  agent drives routing and the real DECIDE skills directly — no spawned `claude`,
  no Node readline REPL, no stub stories. Per idea it routes against the project
  registry, **requires human confirmation** before any write (confirm / decline /
  `redirect <name>` / `create <path>` when nothing fits → scaffolds + registers a
  new repo via the 9.2 `create` path), selects prior lessons from the engineer
  store (FR-5 flywheel), runs the **real DECIDE seam** to author `Status: Accepted`
  stories + a plan dependency tree on a `spec/<slug>` branch (artifacts under
  `.docs/` only — never source), and opens a spec **PR** — it **never** builds
  (`buildsRun` stays 0) and **never** merges (no `gh pr merge`); a merged spec PR
  is the only idea→build handoff. Regression-guarded: authoring never emits the
  old `_Generated by engineer._` stub, never a DRAFT story, and never spawns
  `claude` to author; an unapproved DECIDE step throws and fabricates nothing.
  New seams this phase:
  - **Hexagonal intake port + `Envelope` contract** (`{id, source, sourceRef,
    text, hintRepo?, status, receivedAt}`; parse-don't-validate with field-named
    errors — empty/whitespace text is **rejected, not silently dropped**). The
    `claude-session` adapter ships now; `github-issues`/inbox/write-back are
    additive future adapters behind the same port. Intake **idempotency** keys
    strictly on `(source, sourceRef)`, never on text.
  - **Cross-repo isolation** — authoring writes pass through an `AuthoringGuard`
    (`assertWriteAllowed` rejects `..`, absolute-sibling, and prefix-collision
    paths with `PathEscapeError`); authoring repo A leaves sibling repo B
    byte-for-byte unchanged, and a stale/missing target path fails fast with
    `TargetPathMissingError` (never a cwd fallback). Multi-repo **fan-out** is
    independent — one repo's failure never corrupts another, and a deselected
    repo is left untouched.
  - **pidfile-lock daemon liveness** — `.daemon/daemon.pid` created with `O_EXCL`
    is the **one-per-repo mutex** (exactly one winner under concurrent boots);
    `process.kill(pid, 0)` liveness with stale-pid reclaim that **never
    permanently refuses** (a kill-9 leftover is reclaimed on the next boot).
    `ensureRunning` spawns a detached daemon iff none/stale, no-ops if alive, and
    never manages the lifecycle. The registry `daemonState` mirror is
    non-authoritative — the pidfile wins.
  - **`launchDaemonDetached` fix** — launches with `cwd: repoPath` (was passing
    `--project`), so the pidfile and worktree land under the target repo.
  Read-only `governorReport` (aggregate spend + kickback/halt/retry rates) and
  `computeFlywheelTrend` (improving / insufficient_data over engineer-planned
  features) remain library functions over the engineer store.
- **Two SHIP-phase compliance gates** wired into the conduct-ts gate-driven tail, between
  `manual_test` and `retro`:
  - **`/prd-audit`** (new skill + `prd-auditor` agent) — audits the shipped implementation
    against the approved PRD's functional requirements (`FR-N`). Per-FR verdict
    `ALIGNED | PARTIAL | DIVERGED | MISSING` with `file:line` evidence and a gap-class
    (`impl-gap` → kick back to BUILD; `intended-drift` → kick back to DECIDE to amend the PRD).
    Loops until every FR is ALIGNED or human-ACCEPTED, with a 3-cycle rework budget then operator
    escalation. Objective gate: blocks while any audit-table row is a non-ALIGNED, un-ACCEPTED FR.
    Report at `.docs/audits/YYYY-MM-DD-<feature>-prd-audit.md`. Runs on opus.
  - **`/architecture-review --as-built`** (new mode on the existing `architecture-review` skill) —
    final drift sweep of shipped code vs **APPROVED** ADRs. Verdict
    `APPROVED | APPROVED WITH DRIFT NOTES | BLOCKED`; `BLOCKED` (code violates an APPROVED ADR)
    halts until a human fixes the code or supersedes the ADR. Report at
    `.docs/decisions/architecture-review-as-built-YYYY-MM-DD-<feature>.md`. Runs on sonnet.
  - conduct-ts step registry gains `prd_audit` and `architecture_review_as_built` (both
    `enforcement: gating`, `loopGate: true`); they inherit the verdict/selector/kickback loop.
    HARNESS.md model table, conduct skill flow/assess/gate-enforcement/skip tables, README,
    and `src/conductor/README.md` updated to match.
- conduct-ts daemon: **structured retro signal + engineer memory store** (Phase 9.1).
  On daemon feature completion (`done`/`halted`) the runner emits a structured
  `EngineerSignal` + a narrative to a cross-project store at `~/.ai-conductor/engineer/`
  (override `$AI_CONDUCTOR_ENGINEER_DIR`, dir auto-created). `signals.jsonl` is
  append-only, one atomic (`O_APPEND`, concurrency-safe) JSON line per
  feature-run: `{schemaVersion, ts, project, feature, runId, outcome, kickbacks[],
  halts[], retryHotspots[], tokens{...}, durationByStep{}, narrativeRef?}` —
  assembled from the feature's `events.jsonl` (reusing `report-renderer`
  aggregation) + `FeatureOutcome`, with empty categories as `[]` and an optional
  `narrativeRef`. Narratives live in `narratives/<project>/<feature>-<runId>.md`,
  keyed by `runId` so re-runs never overwrite (`done` → full retro via the LLM
  provider; `halted` → short halt note, no LLM call). Per ADR-002 Option A the
  in-loop `retro` step is **skipped under the daemon** (the emission step owns the
  narrative, keeping repos free of `.docs/retros/` clutter); manual `/conduct`
  runs are unchanged. Emission is **best-effort** — any store error is logged and
  swallowed, so a learning-signal write can never break a ship. A types-only
  `EngineerStoreReader` interface is exported for the future engineer (Phase 9.3).
- conduct-ts: project registry + creation (Phase 9.2). A single-writer registry
  module (`src/conductor/src/engine/registry.ts`) owns
  `~/.ai-conductor/registry.json` (override via `$AI_CONDUCTOR_REGISTRY`): atomic
  temp+rename writes, realpath-canonicalized dedup, credential redaction of remote
  URLs, and status provenance (`created` is never downgraded to `registered`). Two
  non-interactive CLI subcommands consume it: `conduct register [path]` registers an
  existing git repo (name=basename, absolute path, redacted origin remote), and
  `conduct create <name> [--remote <url>]` scaffolds a fresh project (git init +
  skeleton CLAUDE.md referencing HARNESS.md + `.gitignore` with `.pipeline/`,
  `.daemon/`, `.worktrees/`; `--remote` is add-only, no push) with a no-clobber
  guard. `/bootstrap` now auto-registers the project via `conduct register .` after
  onboarding (idempotent).
- conduct-ts: the gate loop's topology is now **derived from the step registry**
  instead of hardcoded, so custom config steps participate (Phase 8). New
  declarative `StepDefinition` flags `loopGate` (in the gate-driven tail) and
  `kickbackTarget` (re-openable upstream gate) replace the hardcoded
  `LOOP_GATE_STEPS`/`KICKBACK_TARGETS`/`regionStart` — built-ins set them
  (build/manual_test/retro/finish = loopGate; stories/plan = kickbackTarget) so
  behavior is unchanged. A custom `.ai-conductor/config.yml` step **inherits its
  `after` target's loop membership** — one inserted among the loop steps
  (build…finish) joins the loop automatically; `gate: true|false` forces/opts out,
  and `kickback_target: true` marks it re-openable. The conductor derives the
  front/loop boundary from the first loop gate, so reordering and custom steps
  both flow through.
- conduct-ts daemon: `--continuous` mode — instead of draining the backlog once
  and exiting, the daemon idle-polls for newly-eligible features (the poll loop
  already existed; this wires it through). Gated by hard ceilings, all new flags:
  `--max-cost <tokens>` (global output-token ceiling), `--max-runtime <seconds>`
  (wall-clock), `--idle-poll <seconds>` (poll interval), `--max-idle-polls <n>`
  (stop after N empty polls). Ceilings stop *starting* new features; in-flight
  work always drains. `--continuous` with no ceiling logs an unbounded-run
  warning. Closes the Phase 7 "then enable continuous" deliverable. The
  wall-clock ceiling (`time_ceiling` stop reason) is new in `runDaemon`;
  `max_items` and `cost_ceiling` already existed.
- conduct-ts daemon: per-step loop progress is now printed to the console. The
  daemon previously wired a **no-op event renderer**, so it went silent between
  `[daemon] ▶ start <slug>` and `✓ shipped` while the whole gate loop ran live in
  the worktree — "started, no meaningful logs." `daemon-cli.ts` now renders
  step boundaries, failures/retries, unsatisfied gate verdicts, kickbacks, halts,
  convergence, and rate limits (prefixed `· `). Events carry no feature slug, so
  with `--concurrency > 1` lines from different workers interleave. Found in
  Phase 7 daemon validation.
- conduct-ts: **rebase-on-latest before finish** (Phase 9.0). A new engine-native
  `rebase` loopGate step (no Claude dispatch, like `complexity`) runs after
  `build`+`manual_test` and before `finish`, rebasing the worktree branch onto the
  **discovered** origin default branch (`git symbolic-ref refs/remotes/origin/HEAD`,
  fetched; falls back to the local base when there's no origin or the fetch fails —
  no hardcoded `main`). Its gate verdict is *satisfied ⇔ the branch is already
  current with the base*, so a no-op rebase goes straight to the PR and re-entry
  after a kickback never re-invalidates. A **clean rebase that changed code/test
  paths** invalidates `build` (+`manual_test` if it ran) via the existing
  kickback machinery (`{from:'rebase', to:'build'}`) so the PR is never built on a
  stale base; a **docs-only / CHANGELOG-only** change does **not** invalidate. A
  rebase conflict confined to `CHANGELOG.md`'s `[Unreleased]` block is
  **auto-resolved** (take the base's merged entries, re-append this feature's lines
  exactly once); any other or mixed conflict writes `.pipeline/HALT` (conflicted
  files + resume steps), leaves the rebase **paused** (no `--abort`), and opens no
  PR. Outcomes emit typed events (`rebase_noop` / `rebase_changed` /
  `rebase_changelog_resolved` / `rebase_conflict_halt`).

### Changed
- conduct-ts daemon: backlog **eligibility is now gated on approval + well-formedness**.
  `discoverBacklog` only picks up a feature when its stories are **approved**
  (`Status: Accepted`, not DRAFT) and its plan declares a **task dependency tree**
  (`## Task Dependency Graph` or per-task `**Dependencies:**` lines). The daemon
  pre-seeds the front half (stories/plan = done) and never re-runs their gates, so
  eligibility is the only place specs are vetted before autonomous build — previously
  any feature with stories+plan *files* present was picked up, DRAFT or not, dependency
  tree or not. Ineligible features are skipped with a logged reason (`[daemon] skip …`).
- harness: new **"Docs track features"** convention (HARNESS.md + this repo's CLAUDE.md):
  every change that adds/alters user-facing behavior must update the `README` and affected
  docs in the same PR; the `finish` step verifies docs reflect what shipped.
- conduct-ts: the `plan` gate now also requires a **task dependency tree** (in addition to
  per-path-type story coverage), so the dependency graph the `build`/pipeline skill
  consumes for topological ordering is actually enforced, not just requested.
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
- `block-destructive-git` hook: **ad-hoc `git rebase` onto a base is now blocked**.
  A mid-build rebase onto an advanced `main` rewrites history under active work and
  triggers surprise conflicts (it disrupted two feature branches during Phase 9).
  The only sanctioned rebase is the daemon's finish-time rebase-on-latest (runs via
  execa, not this hook, with conflict→HALT + CHANGELOG auto-resolve); deliberate
  branch updates require asking the user. Resolving an in-progress rebase
  (`--continue`/`--abort`/`--skip`/`--edit-todo`) is still allowed.
- `block-destructive-git` hook: `git branch -D` is no longer hard-blocked for
  **merged** branches. Squash/rebase-merged branches (GitHub's default) aren't
  ancestors of the default branch, so plain `git branch -d` refuses them and the
  operator was forced to use `-D` — which the hook blocked outright, stranding
  routine post-merge cleanup. The hook now allows `-D` only when every named
  branch is provably merged (an ancestor of the default branch, or has a merged
  PR via `gh`); genuinely unmerged force-deletes are still blocked.
- `block-destructive-git` hook: detection now ignores blocked patterns that
  appear **inside quoted arguments** (commit messages, `echo`, comments). The
  hook previously grepped the raw command, so a command that merely *mentioned* a
  pattern (e.g. `git commit -m "...git reset --hard..."`) was wrongly blocked. It
  now matches against the command with quoted spans stripped, so only the real,
  unquoted operation triggers a block. (Trade-off: a destructive command fully
  wrapped in quotes, e.g. `bash -c "git reset --hard"`, is not caught.)
- conduct-ts: test suites no longer fail to load on the dev machine's default
  Node. The conductor needs Node ≥20.5 (execa imports `addAbortListener`), but
  only `src/conductor/.tool-versions` pinned Node 20 — running `npm test` from
  the repo root used the machine default (e.g. 19.6), so 8 suites failed with
  `node:events does not provide an export named 'addAbortListener'`. Added a root
  `.tool-versions` (`nodejs 20.19.2`) so asdf selects Node 20 repo-wide, plus an
  `engines: { node: ">=20.5.0" }` field documenting/enforcing the requirement for
  non-asdf users. All 70 suites / 979 tests now run. `bin/install` also surfaces
  the requirement: when the `conduct-ts` bundle is missing it checks the active
  Node and, if < 20.5, warns with actionable guidance (`asdf install nodejs
  20.19.2`) instead of letting the user hit a cryptic asdf error on `npm run build`.
- conduct-ts: **worktree isolation** — the spawned `claude` subprocess now runs
  in the step runner's `projectDir` (`cwd`), not the parent process's working
  directory. `ClaudeProvider` invoked `execa('claude', …)` with **no `cwd`**, so
  in daemon mode every step ran in the daemon's main checkout instead of the
  feature's worktree: the build agent committed the whole implementation to
  `main` (6 commits) while the `feat/daemon-<slug>` branch stayed empty, and the
  worktree's `.pipeline` desynced (surfacing as a `session-created` ENOENT). The
  `cwd` now threads `InvokeOptions.cwd` → `execa` and `DefaultStepRunner` passes
  `projectDir` on all four provider calls. Found in Phase 7 daemon validation;
  overlaps the intent of PR #72 (per-feature isolation).
- conduct-ts daemon: an auto-mode hard failure now writes a `.pipeline/HALT`
  marker instead of returning silently. Previously a gating/structural step
  failing in `--auto` did `writeState; return` with no marker, so the daemon's
  `readOutcome` saw neither `DONE` nor `HALT` and reported the opaque
  `error — loop ended without DONE or HALT marker`. The conductor now writes
  `HALT` (with the failed step in the reason) and emits `loop_halt`, so the
  daemon classifies it as `halted` — worktree kept, NOT marked processed,
  retryable after a human looks. Found in Phase 7 daemon validation.
- conduct-ts daemon: re-running the daemon after a kept (halted/errored)
  worktree no longer aborts with `fatal: A branch named 'feat/daemon-<slug>'
  already exists`. `createWorktree` now reuses an existing registered worktree
  for the slug (resume-after-human-fix), attaches to an existing branch when the
  worktree was removed but the branch lingered, and only creates a fresh
  branch+worktree when neither exists. Found in Phase 7 daemon validation.
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
