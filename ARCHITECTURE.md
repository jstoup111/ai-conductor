# Harness Architecture and Operations Reference

This file describes harness internals, the agent catalog, model policy, and operator commands.
It is reference material, not a required session-start read. [HARNESS.md](HARNESS.md) contains
the execution rules needed by host agents and daemon-dispatched steps.

For engine/daemon/composer responsibilities and their boundaries, see
[Architecture](docs/explanation/architecture.md). For current command and configuration details,
see [CLI](docs/reference/cli.md), [configuration](docs/reference/configuration.md), and
[running the daemon](docs/guides/running-the-daemon.md).

## Agent Personas

Agent prompt templates are in `agents/`. Skills define *what* to do; agents define *who* does it.

- `generator.md` — Implements code via TDD
- `evaluator.md` — Reviews with calibrated skepticism (fresh context, no shared state with generator)
- `prd-auditor.md` — Audits shipped implementation against the PRD's functional requirements at SHIP (finding-authority, per-FR verdict + gap-class, no-fix)
- `remediation-planner.md` — Plans how to close a blocking audit's gaps: a disposition + concrete tasks per gap routed to the right step, or a HALT for architectural-clarity / product-scope (planning-authority, no-fix)
- `domain-reviewer.md` — Checks domain integrity, has veto authority
- `worktree-manager.md` — Manages git worktrees for feature isolation and parallel execution
- `cto-security.md` — Security auditor: auth, input validation, OWASP top 10
- `cto-data-integrity.md` — Data integrity: transactions, event sourcing, race conditions
- `cto-dependencies.md` — Dependency auditor: outdated packages, CVEs, license compliance
- `cto-architecture.md` — Architecture coherence: decisions vs implementation, coupling
- `cto-duplication.md` — Code duplication: boilerplate, copy-paste, blast radius
- `cto-testing.md` — Test strategy: coverage gaps, layer balance, assertion quality
- `cto-infrastructure.md` — Infrastructure: DB pooling, caching, background jobs, prod parity
- `cto-observability.md` — Observability: error handling, logging, monitoring, debugging context
- `cto-devex.md` — Developer experience: onboarding, CI/CD, local dev, documentation
- `cto-orchestrator.md` — CTO synthesizer: reads all 9 specialist reports, prioritizes findings

## Model Selection

Use the least expensive provider-native capability tier that can do the job.
The Claude autonomous family is `fable`, `opus`, `sonnet`, and `haiku`.
The Codex autonomous family is `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`.
Each provider policy assigns those native models independently; no cross-provider alias
translation occurs.

**Two enforcement paths — keep them in sync:**
- **Autonomous (daemon/conductor):** the Claude and Codex `ProviderModelPolicy` constants
  registered in the provider policy registry are the model, effort, and tier-override source
  of truth.
- **Interactive (Claude Skill tool / phone):** Claude-only opus-tier skills pin `model: opus`
  in their SKILL.md frontmatter so a Claude Sonnet/Haiku session still runs them on the right model.
  Claude Sonnet/Haiku and tier-varying skills inherit from the engine or the session.

This table is the human-readable mirror of both, and is generated — do not hand-edit the rows
below. Provider policy constants supply autonomous model and effort values; generator metadata
supplies the rationale and interactive row data. Run `bin/generate-model-table` to regenerate
this section. CI enforces both content drift (the table matches the source) and Claude-only pins
(Claude Opus-tier skills declare `model: opus` in their SKILL.md frontmatter).

<!-- BEGIN GENERATED: model-selection-table -->
| Skill/Agent | Execution path | Claude model | Claude effort | Codex model | Codex effort | Why |
|---|---|---|---|---|---|---|
| bootstrap | autonomous engine | sonnet | low | gpt-5.6-terra | low | Detection and scaffolding — largely mechanical. Authors the project CLAUDE.md every later step depends on. |
| memory | autonomous engine | haiku | low | gpt-5.6-luna | low | Read/write files, update index — mechanical. |
| assess | autonomous engine | sonnet | high | gpt-5.6-terra | high | The assess skill dispatches 9 specialists and drives structure verification with Claude Sonnet; the final cross-referencing of all 9 reports is the cto-orchestrator agent on Claude Opus. The orchestrator also sets the env var that cascades effort to subagents. |
| explore | autonomous engine | opus | low (S), high (M/L) | gpt-5.6-sol | low (S), high (M/L) | Divergent discovery: approach trade-offs + product/technical track classification. At M/L or without a recorded tier, each built-in provider policy selects a high-capability reasoning model and HIGH effort for this high-branching, front-of-funnel step; attempt 2 therefore raises reasoning to XHIGH. S tier alone uses LOW effort for a fast scoping pass on small, well-understood work. |
| prd | autonomous engine | opus | high | gpt-5.6-sol | high | Front-of-funnel requirements and FR authoring has high downstream cascade cost. Each built-in provider policy selects a high-capability model and HIGH effort at every complexity tier; attempt 2 raises reasoning to XHIGH. |
| complexity | autonomous engine | sonnet | low | gpt-5.6-terra | low | Assigns S/M/L, which gates every downstream model/effort decision — a wrong tier cascades, but the classification itself is low-effort pattern matching. |
| stories | autonomous engine | sonnet | low (S), medium (M), high (L) | gpt-5.6-terra | low (S), medium (M), high (L) | Pattern-following from design doc, structured output. |
| conflict-check | autonomous engine | opus | medium | gpt-5.6-terra (S/M), gpt-5.6-sol (L) | medium | Pairwise story comparison benefits from a stronger reasoning model at every tier; Large tier uses each provider policy's high-capability model for subtle contradiction detection at scale. |
| plan | autonomous engine | opus | medium (S), high (M), xhigh (L) | gpt-5.6-sol | medium (S), high (M), xhigh (L) | Task breakdown and dependency sequencing use a stronger Claude reasoning model at S/M; Large tier uses each provider policy's high-capability model and XHIGH effort for planning at scale. |
| coherence-check | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Cross-references outcomes/FRs/stories/tasks into a per-row traceability verdict — structured comparison across committed artifacts, comparable in depth to conflict_check. M/L tier only (S is skippable). |
| architecture-diagram | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Structured output generation from codebase scan — pattern-following. |
| architecture-review | autonomous engine | opus | high | gpt-5.6-sol | high | Pre-implementation design feasibility and alignment requires a high-capability model from the selected provider policy. |
| worktree-manager | autonomous engine | haiku | low | gpt-5.6-luna | low | Git operations — mechanical branch/worktree management. |
| coverage_binding (engine gate) | autonomous engine | sonnet | low | gpt-5.6-terra | low | Engine-native coverage-claim gate; its later auxiliary judge has a separate model-table row. |
| writing-system-tests | autonomous engine | opus | medium (S/M), high (L) | gpt-5.6-sol | medium (S/M), high (L) | Translating acceptance criteria into executable boundary-level specs requires strong reasoning to preserve behavioral intent and negative paths, using MEDIUM effort for S/M and HIGH effort for Large work. |
| pipeline | autonomous engine | sonnet | medium (S/M), high (L) | gpt-5.6-terra | medium (S/M), high (L) | Launches the implementation session that authors code through the TDD RED/DOMAIN/GREEN cycle — the actual coding lane, not a thin dispatcher. Each provider policy uses its standard model with MEDIUM effort for reliable code authoring, rising to HIGH effort for Large work. S tier keeps the fixed three-attempt retry floor, so small features can still recover from a bad first pass. |
| build-review | autonomous engine | opus | high | gpt-5.6-sol | high | Fresh-session grader for explicitly enabled, criterion-bound test-quality concerns — adversarial evidence judgement demands a high-capability model, same class as prd_audit/code-review. |
| test-suite | engine machinery | — | — | — | — | Mechanical aggregate test gate that obtains a current full-suite proof from the shared verifier before SHIP; no generative judgement required. |
| manual-test | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Structured validation against stories — pattern-following. |
| prd-audit | autonomous engine | opus | high | gpt-5.6-sol | high | Cross-references PRD intent vs shipped implementation across two domains (spec + code) — deep reasoning, FR-by-FR. |
| architecture-review --as-built | autonomous engine | opus | high | gpt-5.6-sol | high | The SHIP --as-built compliance review compares shipped code with approved architecture and wiring contracts; missed drift can invalidate the release, so it uses a high-capability model and HIGH effort. |
| rebase | autonomous engine | opus | high | gpt-5.6-terra | high | Semantic conflict resolution reasons over both sides of a hunk; a wrong merge can silently revert completed work, so rebase uses a capable provider-native model with HIGH effort. |
| finish | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Coordinates final test, status, and coverage evidence with MEDIUM effort so completion claims remain grounded. |
| remediate | autonomous engine | opus | medium | gpt-5.6-sol | medium | A high-capability model from the selected provider policy guards failure disposition; a false HALT wastes context and wrong routing misroutes rework. MEDIUM effort balances concrete gap routing with the strength of the selected model. |
| attribution-verify | autonomous engine | opus | high | gpt-5.6-sol | high | Semantic attribution verification of commits against task metadata — validating work ownership, evidence marshalling, and provenance consistency demands deep reasoning about task-to-commit linkages. |
| build-review-test-quality | engine-managed auxiliary rubric | inherits resolved rubric policy | inherits resolved rubric policy | inherits resolved rubric policy | inherits resolved rubric policy | Judges whether criterion-bound changed tests are insensitive to the behavior they claim to cover; preflight is evidence, never a verdict. |
| coverage-binding | engine-managed auxiliary judge | inherits resolved coverage-binding policy | inherits resolved coverage-binding policy | inherits resolved coverage-binding policy | inherits resolved coverage-binding policy | Fresh per-claim judgement of whether cited Done when checks assert the criterion; the engine scopes inputs, validates the closed verdict, and owns the gate outcome. |
| verify-claims | supported-host interactive | inherits caller |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Cross-cutting correctness protocol applied within the invoking skill's context (calibrate claims, gate assumptions) — not a separately dispatched agent, so it runs on the caller's model. |
| code-removal | supported-host interactive | inherits caller |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Cross-cutting removal discipline applied in the invoking session: preserves survivors while removing obsolete code, without a separately dispatched agent. |
| domain-reviewer | supported-host interactive | sonnet (<50-line diff), opus (≥50-line diff) |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Right-sized by diff size: Sonnet for focused small diffs, Opus for large changes needing cross-boundary judgment. |
| evaluator | supported-host interactive | sonnet (default) / fable (concurrency, state mutation, security, auth, money) |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | A single risk-domain criterion protects higher-stakes batches from weaker evaluation. |
| code-review | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Multi-dimensional analysis (spec, quality, domain). |
| debugging | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Fable guards root-cause analysis; wrong diagnosis produces band-aid fixes. |
| simplify | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Pattern matching for duplication and complexity — structured checklist work. |
| composer | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Canonical interactive idea→spec authoring loop: routes a raw idea through the full DECIDE phase and delivers a spec PR, so its high-stakes authoring judgement uses Claude Opus. |
| engineer | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Deprecated compatibility delegate for existing engineer invocations. It contributes only low-cost routing mechanics and no independent authoring loop; composer owns the canonical DECIDE workflow. |
| intake | supported-host interactive | inherits caller |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Issue authoring runs in whatever session observed the problem (operator chat, halt monitor, build session) — evidence is freshest there; structured writing needs no dedicated dispatch. |
| conduct | supported-host interactive | haiku |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Artifact checking and status reporting — mechanical. |
| daemon-triage | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Operator-invoked, read-only triage. Routing determinism lives in the skill's signal table, not the model; the model gathers evidence and matches rows. |
| pr | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Diff analysis and structured PR body — templated output. |
| tdd-red | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Writing one test at a time — focused, constrained. |
| tdd-green | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Writing minimal implementation — constrained scope. |
| cto-security | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Deep security analysis requires reasoning about attack vectors. |
| cto-data-integrity | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Transaction and race condition analysis requires deep reasoning. |
| cto-dependencies | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Checklist-based package and license scanning. |
| cto-architecture | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Cross-module coherence and coupling analysis requires deep reasoning. |
| cto-duplication | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Pattern matching across modules — structured checklist work. |
| cto-testing | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Coverage gap analysis and test quality review — structured. |
| cto-infrastructure | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Infrastructure config review — checklist-based. |
| cto-observability | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Error handling and logging pattern review — checklist-based. |
| cto-devex | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Documentation and tooling review — checklist-based. |
| cto-orchestrator | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Cross-referencing 9 reports and prioritizing requires deep reasoning. |
<!-- END GENERATED: model-selection-table -->

### Per-step provider routing (#927)

`llm_provider` accepts its existing scalar form or an ordered array:

```yaml
# Scalar compatibility: one configured provider, with no implicit candidates.
llm_provider: claude

# Ordered provider set: the first provider is the inherited default.
llm_provider: [claude, codex]

steps:
  # An explicit per-step scalar selection runs first.
  build_review:
    llm_provider: codex

  # Per-step arrays are also accepted in their declared order.
  attribution_verify:
    llm_provider: [codex, claude]
```

For each step, the selected provider or providers run first, followed by the
remaining configured providers once in stable order. The conductor emits a
visible warning naming the step, failed provider, reason, and next provider for
every cross-provider transition. A fallback provider resolves its own
provider-native defaults for model, effort, escalation, and availability
ladder; model or effort values from the failed provider never leak across.

Cross-provider fallback occurs only after explicit run-wide provider
unavailability or complete provider-native model-ladder exhaustion. It does
not replace existing recovery for authentication failure, rate limit, session
expiry, timeout, rejection, or ordinary failure; those conditions never
silently advance to another provider. Installed custom providers remain
supported with a warned Claude-compatible model policy, but automatic
mixed-provider fallback involving a custom provider is not guaranteed until a
plugin policy contract exists.

Every provider dispatch starts a fresh session, including every retry within
the same step-execution scope. No provider, fallback, concurrent branch,
one-shot phase, or later step resumes an earlier session. Retries recover
context from committed artifacts and the full retry prompt, not conversation
history.

> **Provider-native model availability fallback (#186/#902):** When the requested model
> is detected unavailable, the daemon descends the selected provider policy's native
> ladder: Claude uses `fable→opus→sonnet`; Codex uses
> `gpt-5.6-sol→gpt-5.6-terra→gpt-5.6-luna`. An unavailable model already on the ladder
> continues only through later, lower rungs; it never restarts at the head. An unavailable
> opaque/off-ladder override enters at the ladder head, while a successful off-ladder model
> runs exactly once. A configured `model_fallback_ladder` replaces the provider default
> exactly, and `model_fallback_ladder: []` disables fallback. Unavailable-model knowledge is
> held in memory for the lifetime of each `ModelAvailability` instance/runner; multiple
> independent caches can coexist in one process. Constructing a new runner or restarting
> retries the originally requested model. Downgrades are logged as
> `Downgraded from X to Y: reason`. The `--model` CLI flag
> and `steps.<step>.model` config keep their explicit-override precedence and remain
> provider-native strings.

> **Retry-as-escalation ladder (#188):** A retry is no longer an identical coin-flip —
> it deliberately raises capability so the re-run changes the odds. On a step's failed
> attempt the loop escalates from the resolved base `(model, effort)`, indexed by the
> 1-based attempt: **attempt 1** runs the base; **attempt 2** bumps effort one level
> (`low→medium→high→xhigh→max`); **attempt 3+** holds that effort and bumps the model
> **(attempt − 2) tiers** up the selected provider's native capability ladder. Claude
> ascends `haiku→sonnet→opus→fable`; Codex ascends
> `gpt-5.6-luna→gpt-5.6-terra→gpt-5.6-sol`. Attempt 3 is one tier and attempt 4 two
> tiers. Bumps are capped at the selected policy's top — an effort already at `max` or
> a model already at its provider's deepest rung is a no-op, never an error. Thus the
> normal M/L/no-tier `explore` and every `prd` move `high→xhigh` on attempt 2
> while later model bumps remain capped at their already-selected deepest model
> (`explore.S` moves `low→medium` but uses the same capped model). A
> retry budget deeper than 3 authorizes one further tier per extra attempt, so deep
> budgets escalate to premium models. The
> model bump expresses *intent* only; it still routes through the #186 availability ladder
> above, which substitutes a live provider-native model if the escalated tier is dead
> (escalation ascends for upgrade-on-retry; availability descends from the active rung for
> substitute-on-dead). Because escalation
> derives purely from the attempt number, non-budget-consuming retries (rate-limit, stale
> session, auth park-and-poll, verified FINISH publication advance) re-run at the *same* rung rather
> than climbing. Deep-step
> retry budgets (`explore`, `prd`, `plan`, `build`) drop from 5 to **3** — the floor that
> still reaches the attempt-3 model-bump rung. Escalation is **on by default**; set
> `steps.<step>.escalate: false` (also valid at `phases.<PHASE>` / `defaults`) to pin the
> base `(model, effort)` across every retry (identical-retry, pre-#188 behavior).

When Claude Code dispatches subagents via the Agent tool, set the `model` parameter to match:
```
Agent(subagent_type="general-purpose", model="sonnet", prompt="RED phase: write test...") # Claude Code
Agent(subagent_type="general-purpose", model="opus", prompt="Evaluate this code...") # Claude Code
```

## Enforcement Levels

Each skill declares its enforcement level honestly:
- **Advisory** — Instructions only
- **Gating** — Evidence required before proceeding
- **Structural** — Claude Code subagent isolation via Agent tool
- **Mechanical** — Claude Code hooks (optional, opt-in)

## Harness Updates

The harness version your project runs against is controlled by the `conductor:`
block in `~/.ai-conductor/config.yml`:

```yaml
conductor:
  update_channel: stable
  auto_check: true
  current_version: v0.3.0
  last_checked_at: 2026-04-11T00:00:00Z
```

- **`update_channel`** — `stable` (default, a branch advanced only after release
  publication), `tagged` (semver tag checkouts), or `main` (bleeding edge,
  every merge to main).
- **`auto_check`** — if `true`, every `/conduct` run checks for updates on the
  configured channel before running any pipeline step.
- **`current_version`** — the installed harness identity. On the stable and
  tagged channels this is a `vX.Y.Z` tag; on main it's `main@<sha>`.
- **`last_checked_at`** — the ISO-8601 UTC timestamp of the most recent update
  check.

For an existing installation, `~/.claude/ai-conductor.config.json` is a
one-time seed. Its recognized camelCase values are copied into `conductor:` on
first access, then the file is renamed to `ai-conductor.config.json.migrated`.
It is not a live configuration source.

### Update flow

1. `bin/update` fetches the configured release source: the moving release
   branch (`stable`), the latest semver tag (`tagged`), or the development
   branch (`main`):
   - `bin/update` (no args) forces a check now, bypassing the `conductor.auto_check`
     gate.
   - `bin/update --auto` checks only if `conductor.auto_check` is not `false`; this is
     what `ai-conductor` spawns automatically at daemon startup.
2. If a newer version exists, the user is prompted before anything is applied.
   Tagged updates also render the relevant `CHANGELOG.md` blocks with the
   configured markdown viewer (see `markdown_viewer` in
   `~/.ai-conductor/config.yml`). Updates never apply without explicit approval.
3. On approval, the harness is checked out at the new version and
   `bin/migrate` runs automatically. It:
   - Re-runs `bin/install --update` to refresh symlinks and re-merge
     `settings.json` entries.
   - Walks `CHANGELOG.md` entries between the old and new version for any
     `## Migration` bash blocks, displays them, and runs them on approval.
4. On success, `conductor.current_version` is written back to the config. On failure,
   the harness is rolled back to the previous ref and the user is notified.

### Changing channels

```
bin/update --set-channel stable   # follow only fully published releases (default)
bin/update --set-channel tagged   # follow semver tag checkouts
bin/update --set-channel main     # follow main branch
bin/update                        # force an update check now
bin/update --auto                 # check only if conductor.auto_check != false
bin/update -h                     # usage
```

The `conductor.update_channel` setting is per-user (it lives in
`~/.ai-conductor/config.yml`), so every project using this harness inherits the
same channel.

## Daemon CLI

The per-repo build daemon is driven by the **`ai-conductor`** binary. **Use `ai-conductor`,
NOT the `conduct` bash wrapper, for daemon subcommands** — `conduct daemon status`
mis-routes to a feature build; only `ai-conductor daemon …` reaches the daemon commands.

The daemon is hosted as a **foreground process inside a per-repo tmux session**
(`cc-daemon-<slug>`), so you can attach to, restart, and debug a *running* daemon on demand
— in color. Management requires `tmux` on the host; the daemon itself still builds with no
tmux present (management is purely additive).

| Command | What it does |
|---------|--------------|
| `ai-conductor daemon start` | Start the repo's daemon in a tmux session. **Idempotent** — a no-op if one is already running (never a duplicate). |
| `ai-conductor daemon stop` | Stop the repo's daemon (kills the session, releases the lock). Safe no-op if not running. |
| `ai-conductor daemon restart` | Restart the daemon — fresh inner process, same session endpoint. |
| `ai-conductor daemon connect` | Attach **read-only** to watch the live, full-color output. Detach with `Ctrl-b d`; the daemon keeps running. |
| `ai-conductor daemon debug` | Attach **read/write** — `Ctrl-c` to pause the loop, inspect, then resume/restart. |
| `ai-conductor daemon status` | Liveness of every registered repo's daemon (running / stale / stopped, pid, started-at, last activity, **session up/down**) |
| `ai-conductor daemon logs [--follow] [--all] [--repo <path>]` | Tail `.daemon/daemon.log` (ANSI-stripped) for this repo, all registered repos, or a named one |
| `ai-conductor daemon --continuous` | Run a daemon in the **foreground**, idle-polling forever (omit `--max-idle-polls` ⇒ Infinity). This is the process tmux hosts. |
| `ai-conductor daemon` | Drain the current backlog once, then exit (add `--max-idle-polls N` to self-limit after N idle polls) |

One daemon per repo, enforced by the pidfile lock at `.daemon/daemon.pid` (stale dead-pid
locks self-reclaim) underneath the tmux session. The daemon runs **serially** (one feature at a
time), so `connect` always shows exactly the feature currently building. A host reboot drops
tmux sessions; the next `daemon start` (or composer nudge) respawns.
