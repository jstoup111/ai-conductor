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

# ── SHIP validation fan-out (#469, auto mode only) ────────────────────────────
# Concurrency cap for the parallel validation group (manual_test, prd_audit,
# architecture_review_as_built). Default 2. Zero/negative/non-numeric values
# fall back to the default; the effective width is additionally capped at the
# number of dispatchable members. Interactive runs ignore this (serial walk).
validation_concurrency: 2

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
- **Born owned, not silently skipped:** every DECIDE-phase write path stamps an `Owner:`
  marker from machine identity (`spec_owner` → `gh` login) at authoring time, so intake
  markers arrive with an owner by default. If a spec still arrives un-owned (pre-cutover
  history, or an indeterminate merge time), the gate no longer skips it — it **default-builds
  under the daemon's own resolved owner** (`unowned-defaulted`) and emits a distinct, deduped
  log line naming the slug and defaulted owner and telling you to add an explicit `Owner:`
  marker on the default branch to make ownership unambiguous. `other-owner` specs (stamped
  with a **different** operator's identity) are still skipped — that case is unchanged.
- **Enforcement is harness-native, not a local script:** this born-owned stamping and
  default-build behavior is carried by `conduct-ts` itself (authoring + gate). This repo's
  own `test/test_harness_integrity.sh` also checks that `.docs/intake/*.md` carry an `Owner:`
  marker, but that is a supplementary local belt for this self-host repo — not the mechanism
  that enforces ownership in consumer projects.

**GATED dashboard section:** every daemon status view (`conduct-ts daemon-status`, the
startup dashboard, `.daemon/gated.json`) carries a `GATED (n)` group alongside
PARKED/HALTED/PROCESSED/IN-PROGRESS/WAITING/ELIGIBLE. It always renders explicitly — even
`GATED (0)` — so an empty backlog is never mistaken for "nothing to do" when the real cause
is an unresolved owner gate. Each `kind: 'spec'` row names the slug, the skip reason
(`other-owner` — the only reason a spec is still skipped rather than default-built), the other
operator when known, and a remedy hint; each `kind: 'repo'` row is a section-level warning
(e.g. "building NOTHING — identity unresolved") for conditions with no single owning slug.
Un-owned arrivals no longer appear here as a skip: they default-build under
`unowned-defaulted` (see above) and are surfaced only via the loud daemon log line, not the
GATED group.

**Gate write-back (owner-gated PR/issue announcement):** on every discovery pass, the daemon
also announces each owner-gated spec where a GitHub artifact exists to announce on:
  - if the spec already has an implementation PR open (e.g. a prior build attempt halted
    before ownership changed underneath it), the PR gets an `owner-gated` label and a single
    upserted marker comment naming the reason/remedy/other-owner — edited in place on later
    passes rather than duplicated;
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

### Attribution enforcement (inline build-work commits, `conduct-ts` only, advisory)

Session-driven Claude sessions can commit or edit files directly, bypassing the
per-task subagent dispatch the pipeline relies on for its `Task: <id>` commit trailer.
Inline build-work attribution enforcement flags that gap via two engine-owned
surfaces (not new orchestrator rules — see `skills/pipeline/SKILL.md` → "Attribution
enforcement (engine gate surfaces)"). As of #773, both surfaces are **advisory only**:
they log/report unattributed activity but never block a commit, block a session
mutation, or park the daemon. Build completion is decided solely by `build_review`'s
completeness rubric (see below), not by attribution status.

- **Surface A — commit-msg check.** Flags an unattributed build-step commit (no
  `Task:` trailer, dispatched while `.pipeline/build-step-active` is present).
- **Surface B — session mutation check.** Flags `Edit`/`Write`/`NotebookEdit` calls
  and `git commit` invocations issued directly in the orchestrator session (outside a
  stamped subagent dispatch) while a build step is active.

```yaml
# .ai-conductor/config.yml
attribution_enforcement_cutover: "2026-07-01T00:00:00Z"   # ISO-8601 instant; absent = off
```

- **Default off.** With the key absent (or set to a future instant), the checks are
  inactive.
- **Enable it** by setting `attribution_enforcement_cutover` to a past ISO-8601
  timestamp — the checks activate for any build step that dispatches after that
  instant. Enabling it changes only what gets logged/reported; it still never blocks
  a commit or a mutation.
- **Requires an engine restart to take effect.** The daemon/conductor reads this
  value once at process start; editing the config file mid-run does not retroactively
  arm or disarm a build step already in flight.
- **Exemptions (both surfaces):** a merge commit, an amend of a pre-enforcement
  commit, and an empty commit carrying a resolvable `Evidence: satisfied-by <sha>`
  trailer are excluded from the advisory signal — these are legitimate patterns that
  predate or fall outside normal attributed build work.


### Task-stamp telemetry and attribution spot-audit (`conduct-ts` only)

`Task:` commit trailers and session-hook stamps are pure telemetry (#773): they feed
progress/resolved-count reporting and an attribution spot-audit sampling pass, but do
not gate build completion. The former "semantic attribution verification lane" (an
engine-embedded judge over provenance proxies) has been deleted along with the
per-task evidence gate it fed; the spot-audit that remains is informational only and
never controls whether a build step is allowed to finish.

**What changed in #773:** the semantic attribution citation-judge gate (`attribution_judge_cutover`,
per-task SHA verification, `semantic-verified` evidence stamps, `pendingRetryHints`, the
`conduct-ts evidence judge <slug>` manual CLI, and the associated no-evidence auto-park
counter) has been deleted entirely — that machinery no longer exists. `conduct-ts evidence`
is now a guide-only stub that reports the removal (`--help` still lists it for discoverability).

**What remains:**
- **Telemetry stamping** — `Task: <id>` commit trailers and session-hook stamps still write,
  and still feed progress/resolved-count reporting (#757).
- **Spot-audit** — `attribution_audit_sample_pct` (default 10) still samples a fraction of
  attribution events to `.pipeline/attribution-audit.jsonl` for measurement. It is purely
  informational: it never blocks a commit, never blocks a build step, and never parks the
  daemon.
- **Completion authority** — build-step (and therefore task) completion is decided solely by
  `build_review`'s completeness rubric: an LLM-judged, fail-closed, plan-vs-diff check that
  runs as part of the standard `build_review` gate (default-on since #773) and self-heals via
  kickback, bounded by `MAX_KICKBACKS_PER_GATE`, before HALTing for the operator.

See `src/conductor/README.md` → "Attribution enforcement" and "Task-stamp telemetry" for
implementation detail, and `.docs/decisions/` for the ADRs covering the original judge design
(retained for history — the design itself is no longer active).


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

**Checking build-auth status.** `conduct-ts build-auth-status` reports the resolved mode and
token state on one line — `valid`/`api-key` (clean, exit `0`) or
`missing`/`unreadable`/`invalid`/`unverifiable` (non-clean, exit `1`, remediation printed
underneath). `daemon-token` mode probes the token's actual liveness via a `claude -p` CLI
invocation rather than just checking the file exists. `./bin/install --check` shows the same
line as part of its overall status report — it delegates entirely to `conduct-ts
build-auth-status`; bash only turns the exit code into an ok/fail line.

**Daemon credential gate.** While `daemon-token` mode is configured and the token file is
missing/empty/unreadable, the daemon stops picking up *new* features each cycle — in-flight
work is unaffected and keeps running to completion/park. This is intentionally non-blocking:
no HALT is written, and exactly one log line is emitted on the missing→present transition (not
repeated every idle tick). The gate lifts automatically as soon as the token is restored — no
operator action needed — via an event-driven watcher backed by a poll fallback, so it also
works on filesystems where file-change notifications are unreliable.

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

