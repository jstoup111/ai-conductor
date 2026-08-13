---
harness-version: 2026-04-07
---

# Harness Behavioral Rules

These rules apply to all projects using the james-stoup-agents harness.
Claude MUST read and follow this file at the start of every session.

## Optimization Targets (Priority Order)

1. 100% correct feature functionality
2. Correct code & gating (no bad code passes gates)
3. Minimal user intervention during implementation

## Correctness & Assumption Gate

Serves target #1. This is **not** an always-on tax on every sentence — it arms precisely at
**load-bearing points**, where a statement or assumption is about to drive a spec, a plan, an ADR,
a schema/API, or code. At those points the `verify-claims` skill's protocol applies:

- **Calibrate claims.** A non-trivial claim or theory carries a grounded confidence estimate (a %)
  and its basis — `verified` (observed directly), `inferred` (derived from adjacent evidence), or
  `unverified`. Prefer one cheap `Read`/`grep`/command over an estimate whenever it would settle
  the question. Never present an unverified guess as confident fact.
- **Surface every assumption**, with its confidence, its impact-if-wrong, and how to confirm it.
- **Hard-block on unconfirmed load-bearing assumptions.** No specced or built work proceeds on an
  assumption that — if wrong — changes a requirement, design, schema, task, or code behavior,
  until the operator explicitly approves it. Interactive: present and wait. Autonomous/daemon:
  write a HALT with the assumption ledger — never silently pick the most likely value.

This applies across all skills and dispatched agents, and is enforced concretely by two roles that
cite `verify-claims` in their own SKILL.md:

- **Authors** (create an artifact) surface assumptions and hard-block before it locks: `explore`,
  `prd`, `architecture-review`, `stories`, `plan`, `writing-system-tests`.
- **Verifiers/judges** (render findings/verdicts, don't build) attach a grounded confidence % to
  every finding and never assert one they haven't verified: `assess`, `conflict-check`,
  `code-review`, `prd-audit`, `manual-test`, `remediate`, `debugging`.

Execution steps that merely act on an already-gated artifact (`tdd`, `pipeline`), orchestration
(`conduct`, `engineer`), and mechanical steps (`bootstrap`, `memory`, `architecture-diagram`,
`simplify`, `retro`, `finish`, `pr`, `rebase`) do **not** self-cite — they rely on this rule and on
the upstream/surrounding gates. Casual conversation and trivially-verifiable mechanics with no
downstream blast radius are out of scope.

## SDLC Phase Flow

Skills chain via artifacts in `.docs/`. No skill orchestrates another internally.

```
UNDERSTAND → DECIDE → BUILD(engine-native configured-verifier gate) → ✓checkpoint → SHIP(manual-test) → ✓checkpoint → SHIP(prd-audit, architecture-review --as-built, retro, finish)
```

In daemon/auto runs the three SHIP validators (manual-test, prd-audit,
architecture-review --as-built) execute as one **concurrent validation group** after the
build gates (deprecated `wiring_check` + test_suite → build_review), fan-out capped by `validation_concurrency`
with a single-writer join; interactive runs keep the serial sequence and checkpoints
shown above.

| Phase | Skills | Artifacts |
|-------|--------|-----------|
| ALL | **conduct** (orchestrator) | Status dashboard, gate enforcement, checkpoints |
| UNDERSTAND | bootstrap, memory, assess | CLAUDE.md, .memory/, .docs/decisions/technical-assessment-*.md |
| DECIDE | explore (track) → complexity → prd (product track only) → architecture-diagram → architecture-review → stories → conflict-check → plan → coherence-check (M/L only, skipped for S) | .docs/track/, .docs/specs/, .docs/complexity/, .docs/architecture/, .docs/decisions/, .docs/stories/, .docs/conflicts/, .docs/plans/, .docs/coherence/ |
| BUILD | writing-system-tests → tdd/pipeline, debugging, code-review → engine-native configured-verifier gate | Acceptance specs, code, unit tests, aggregate verifier evidence, .pipeline/ |
| CHECKPOINT | User validation after build | Harness pause — continue, go back, or quit |
| SHIP | manual-test, prd-audit, architecture-review --as-built, retro, finish/pr | .pipeline/manual-test-results.md, .pipeline/prd-audit.md, .pipeline/architecture-review-as-built.md (run evidence, gitignored), .docs/retros/ |
| CHECKPOINT | User validation after manual-test | Harness pause — continue, go back, or quit |

### Plan Task Ownership

Plan tasks own implementation behavior and its scoped RED/GREEN tests. A plan must not append a
terminal catch-all task that proves the completed feature as a whole or promises to repair
unspecified findings. `writing-system-tests` owns story-level acceptance specs at BUILD entry before
implementation; the engine-native configured-verifier gate and the SHIP validators own completed-feature
validation. Aggregate verifier failures and `/manual-test` failures return directly to BUILD for scoped repair.
Blockers from `/prd-audit`, as-built `/architecture-review`, and `/finish` route through `/remediate`
to the appropriate SDLC step or a required human decision. Neither path is pre-authored as
speculative implementation work.

An acceptance-spec remediation may waive separate RED proof only when one atomic repair must change
both the acceptance spec and its implementation. The waiver must be recorded with a non-empty reason
and attributable approval; the completion is reported as waived, never as proven RED. Without that
recorded declaration, the acceptance specs must establish ordinary failing-spec RED evidence.

**DECIDE scope:** The operator chooses the fix breadth before approach confirmation. Do not silently
narrow or broaden the requested outcome.

### DECIDE Artifact Amendment Ownership

When a DECIDE pass falsifies an assertion in an accepted DECIDE artifact, DECIDE amends that artifact
in place on the spec branch before the first BUILD entry. Add the correction beside the original
assertion in this additive form; never rewrite or delete the original text and never create a separate
amendment record:

```markdown
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

BUILD never receives that mutation as a task. A plan task must not name another feature's artifact
under `.docs/architecture/`, `.docs/plans/`, `.docs/specs/`, or `.docs/stories/`; authoring checks
the plan with `conduct-ts plan-protected-targets <plan-path>`, and the spec land gate independently
refuses a violating plan. A BUILD-discovered need for such an amendment returns to its owning DECIDE
step through remediation rather than routing to BUILD or acceptance-spec work. Because DECIDE runs
before the first BUILD seal baseline, its amendment is part of that baseline.

**Checkpoints** are harness-level pauses (no Claude session). The user reviews output and
chooses to continue, navigate back to a prior step, or quit. Navigating back marks the target
step as `pending` and all downstream steps as `stale` (⚠), then re-runs from the target forward.
Checkpoints are skipped in auto mode.

## Skill Invocation

Skills are in `skills/`. Each has a `SKILL.md` with YAML frontmatter declaring enforcement level,
SDLC phase, and dependencies. A **semantic skill reference** is the provider-neutral name
`skill-name`: it identifies the required workflow without assuming an invocation syntax. Use the
selected host's native invocation only to activate that reference:

- **Claude:** invoke `skill-name` as `/skill-name`.
- **Codex:** invoke `skill-name` as `$skill-name`.

Native wording may differ, but it cannot weaken, bypass, or replace the required shared outcome,
artifact, or lifecycle gate. Do not weaken or bypass the shared artifact or gate. The shared
required outcome, artifact, and lifecycle gate remain the same for direct invocation and
daemon-managed workflows; missing artifact or gate evidence leaves the workflow incomplete.

If a required capability is unavailable for the selected provider, stop before incompatible work
begins. Report an unsupported-capability diagnostic that names the selected provider, the missing
capability, and the concrete recovery action required to continue. Leave the lifecycle gate
incomplete and emit no success artifact; never silently substitute another provider's syntax,
tool, delegation, credentials, or success result. A supported provider-native alternative is a
valid path even when it differs from the other host's mechanism, and must proceed without a false
unsupported-capability rejection.

**Start here:** Prefer the daemon for autonomous work:
- **Automated:** Author and merge a spec with `conduct-ts engineer`, then run `conduct-ts daemon start`
- **Interactive:** Run `/conduct` inside Claude Code or `conduct-ts inline --interactive "feature description"`

The foreground `conduct-ts inline --auto` mode is deprecated; use the daemon for unattended runs.

## Agent Personas

Agent prompt templates are in `agents/`. Skills define *what* to do; agents define *who* does it.

- `generator.md` — Implements code via TDD
- `evaluator.md` — Reviews with calibrated skepticism (fresh context, no shared state with generator)
- `prd-auditor.md` — Audits shipped implementation against the PRD's functional requirements at SHIP (finding-authority, per-FR verdict + gap-class, no-fix)
- `remediation-planner.md` — Plans how to close a blocking audit's gaps: a disposition + concrete tasks per gap routed to the right step, or a HALT for architectural-clarity / product-scope (planning-authority, no-fix)
- `domain-reviewer.md` — Checks domain integrity, has veto authority
- `planner.md` — Expands requirements into specs
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
| writing-system-tests | autonomous engine | opus | medium (S/M), high (L) | gpt-5.6-sol | medium (S/M), high (L) | Translating acceptance criteria into executable boundary-level specs requires strong reasoning to preserve behavioral intent and negative paths, using MEDIUM effort for S/M and HIGH effort for Large work. |
| pipeline | autonomous engine | sonnet | medium (S/M), high (L) | gpt-5.6-terra | medium (S/M), high (L) | Launches the implementation session that authors code through the TDD RED/DOMAIN/GREEN cycle — the actual coding lane, not a thin dispatcher. Each provider policy uses its standard model with MEDIUM effort for reliable code authoring, rising to HIGH effort for Large work. S tier keeps the fixed three-attempt retry floor, so small features can still recover from a bad first pass. |
| build-review | autonomous engine | opus | high | gpt-5.6-sol | high | Fresh-session grader judging a maker's diff for test tautology, scope creep, root-cause fixes, plan completeness, and static wiring reachability — adversarial code review demands a high-capability model, same class of judgement as prd_audit/code-review. |
| wiring-check | engine machinery | — | — | — | — | Deprecated compatibility step; build_review owns wiring judgement. |
| test-suite | engine machinery | — | — | — | — | Mechanical aggregate test gate that obtains a current full-suite proof from the shared verifier before SHIP; no generative judgement required. |
| manual-test | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Structured validation against stories — pattern-following. |
| prd-audit | autonomous engine | opus | high | gpt-5.6-sol | high | Cross-references PRD intent vs shipped implementation across two domains (spec + code) — deep reasoning, FR-by-FR. |
| architecture-review --as-built | autonomous engine | opus | high | gpt-5.6-sol | high | The SHIP --as-built compliance review compares shipped code with approved architecture and wiring contracts; missed drift can invalidate the release, so it uses a high-capability model and HIGH effort. |
| retro | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Structured analysis from concrete data; Part C (context efficiency) is checklist-based. |
| rebase | autonomous engine | opus | high | gpt-5.6-terra | high | Semantic conflict resolution reasons over both sides of a hunk; a wrong merge can silently revert completed work, so rebase uses a capable provider-native model with HIGH effort. |
| finish | autonomous engine | sonnet | medium | gpt-5.6-terra | medium | Coordinates final test, status, and coverage evidence with MEDIUM effort so completion claims remain grounded. |
| remediate | autonomous engine | opus | medium | gpt-5.6-sol | medium | A high-capability model from the selected provider policy guards failure disposition; a false HALT wastes context and wrong routing misroutes rework. MEDIUM effort balances concrete gap routing with the strength of the selected model. |
| attribution-verify | autonomous engine | opus | high | gpt-5.6-sol | high | Semantic attribution verification of commits against task metadata — validating work ownership, evidence marshalling, and provenance consistency demands deep reasoning about task-to-commit linkages. |
| verify-claims | supported-host interactive | inherits caller |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Cross-cutting correctness protocol applied within the invoking skill's context (calibrate claims, gate assumptions) — not a separately dispatched agent, so it runs on the caller's model. |
| domain-reviewer | supported-host interactive | sonnet (<50-line diff), opus (≥50-line diff) |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Right-sized by diff size: Sonnet for focused small diffs, Opus for large changes needing cross-boundary judgment. |
| evaluator | supported-host interactive | sonnet (value objects, pure functions, config, infra) / opus (concurrency, state mutation, security, auth, finance) |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Right-sized by batch content. |
| code-review | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Multi-dimensional analysis (spec, quality, domain). |
| debugging | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Fable guards root-cause analysis; wrong diagnosis produces band-aid fixes. |
| simplify | supported-host interactive | sonnet |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Pattern matching for duplication and complexity — structured checklist work. |
| engineer | supported-host interactive | opus |  | inherits model from the Codex session or spawned-agent configuration | inherits effort from the Codex session or spawned-agent configuration | Interactive idea→spec control plane routing the real DECIDE skills. Kept on Fable for operator-driven interactive quality — this is a capability / operator-preference call, NOT a cost saving: Fable is the premium tier ($10/$50 per 1M, ~2x Opus). |
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

## Communication Protocol

Output discipline varies by SDLC phase. During BUILD, every token that isn't code, test output,
or a status line is waste.

### BUILD Phase (tdd, pipeline, debugging, writing-system-tests, code-review)

**Pipeline task fan-out:** Standard and Full pipeline runs derive a ready frontier from completed
dependencies and non-overlapping likely-touched files, then dispatch up to three independent tasks
concurrently in one host-native fan-out operation and join them before shared verification.
Claude Code emits multiple Agent tool dispatches in one response; Codex emits multiple
`collaboration.spawn_agent` calls in one response. Dependent or overlapping-file tasks wait for a
later frontier, and Conservative remains sequential. If the selected provider cannot perform native
fan-out, Standard and Full stop with the provider, missing capability, and recovery action named;
they never silently serialize.

**Intermediate test execution policy:** Ordinary TDD RED/GREEN runs the scoped union of affected tests
through `conduct-ts scoped-run <selectors...>`. The agent derives the selectors; it does not
hand-assemble or narrate a test command. Debugging and conduct progression use the same policy.
Pipeline batch boundaries, parallel joins, and evaluators use pipeline's existing named
`BATCH_AFFECTED_TESTS` union through the same interface. A known scoped failure blocks its current
BUILD activity; it is never deferred to the aggregate gate.

**Test isolation policy:** Automated unit, acceptance, integration, and end-to-end tests
must not call real third-party systems. Unit tests inject mocked adapters. Acceptance,
integration, and end-to-end tests exercise the real application entry point, internal wiring,
and locally controlled infrastructure while replacing each third-party boundary with a faithful
fake through the production adapter seam. This includes LLM providers, hosted APIs, GitHub,
email/payment services, webhooks, package registries, and other network services. Only explicitly
named smoke tests (`test/smoke/**` or `*.smoke.test.*`) may use the real third party. Smoke tests
are opt-in and excluded from the default test command and CI aggregate suite.

Broad fallback is permitted only when one of these four triggers makes the
affected-test scope genuinely uncertain:

1. A shared/core module has 3+ production importers.
2. The diff touches config, migrations, dependency manifests, or test infrastructure.
3. The scoped/affected set is empty.
4. Module-to-test mapping is low-confidence and cannot be made confidently.

When a trigger fires, state `Aggregate fallback: <exact trigger and reason>`
and use the host's repository-configured aggregate verifier interface. Do not
call the project's aggregate command directly. No other intermediate
condition authorizes a broad run. The native pre-SHIP aggregate gate runs after
BUILD and before manual testing; finish
reuse/fallback, mutation-specific repair checks, and independent CI authority
remain separate boundaries.

**Rules for the orchestrator (the session running /pipeline or /tdd):**
- Do NOT narrate what you are about to do. Just do it.
- Do NOT explain why a test failed before fixing it. Fix it, then report the status.
- Do NOT summarize completed steps. The audit trail and progress.log handle that.
- Do NOT introduce subagent dispatches. Dispatch silently.
- Keep the work area concise. Emit only status lines and errors — no running commentary.
- Do NOT explain what is happening unless it is either visible to the operator or actually
  useful to them. No play-by-play of internal steps.
- Between TDD phases, output ONLY the status line (PASS/FAIL + reason). No commentary.

**Rules for subagents (generator, domain-reviewer, evaluator):**
- Follow your output format exactly. No preamble, no sign-off.
- Test output: include ONLY the failure message and assertion diff, not the full test run.
  Truncate after the first relevant failure unless multiple unrelated failures exist.

**Acceptable BUILD output:**
- Status lines: `Task 3/12: PASS`, `DOMAIN: APPROVED`, `RED: FAIL (missing factory)`
- Error context needed for the next action
- Questions that genuinely block progress (NEEDS_CONTEXT)

**Not acceptable:**
- "I'll now dispatch the generator agent to write a failing test..."
- "The test failed because the User model doesn't have a name field yet. Let me..."
- "Great, the test passes. Let me run the full suite to make sure..."
- "Here's a summary of what we accomplished in this batch..."

### UNDERSTAND/DECIDE Phase (brainstorm, stories, plan, architecture-review)

No output restrictions. Exploration, questions, and detailed explanations are expected.

### SHIP Phase (retro, finish, pr, manual-test)

Structured output only. Follow the skill's output template. No free-form commentary.

## Tech-Context

Stack-specific knowledge lives in `tech-context/`. Bootstrap detects the project stack and loads
the matching context into the session. Skills reference tech-context when available, work without it.

**Load once, reference everywhere:** Tech-context files are read once during `/bootstrap` and
become part of the session context. Skills that need tech-context (stories, tdd, writing-system-tests,
code-review, debugging, retro) should reference the already-loaded context rather than re-reading
the files independently. This avoids redundant file reads across skill invocations.

## MCP Servers (When Available)

When the context7 MCP server is installed, use it proactively:

- **context7** — Library/framework documentation. Use for API syntax, config, version migration. Skip for business logic, refactoring, and general programming concepts.

## Enforcement Levels

Each skill declares its enforcement level honestly:
- **Advisory** — Instructions only
- **Gating** — Evidence required before proceeding
- **Structural** — Claude Code subagent isolation via Agent tool
- **Mechanical** — Claude Code hooks (optional, opt-in)

## Memory

Project-level memory lives in `.memory/` with categories: decisions, patterns, gotchas, context.
Every session starts with recall. Significant decisions are persisted during work.
Skills with Memory Checkpoint sections define when writes are expected — check skill verification lists.

## Push Policy

**Never push to a remote until confident the work is complete and passing.**
Run whatever verification the project requires (tests, lint, type-check, etc.) locally
before pushing. The `/finish` skill presents the user with completion options and, when the
outcome is Push & PR, performs the push and PR creation **inline** — it does not delegate to
`/pr`, because a delegated skill invocation ends the finish turn before
`conduct-ts finish-record` writes `.pipeline/finish-choice`. `/pr` remains available as a
standalone skill for operator-driven PR authoring and owns the pre-push gate there; `/finish`
inlines the same title/body contract and pre-push checks.

## Rebase Policy

**Never rebase a feature branch mid-build.** Implementation agents must NOT run
`git fetch`, `git pull`, `git rebase`, or switch branches during a build — they commit
only to the current feature branch. A mid-build rebase onto a moved `origin/<default>`
rewrites history under active work and surfaces surprise conflicts (it stalled two
feature branches during Phase 9 in CHANGELOG conflicts).

The **only** sanctioned rebases are:

1. the daemon's finish-time **rebase-onto-latest** (runs outside the per-task loop,
   with conflict → HALT + CHANGELOG auto-resolve), and
2. the **`/rebase`** resolver, which advances an already-paused rebase to completion.

An operator may also deliberately rebase a branch onto its base (e.g. to refresh a
stale PR) — that is an explicit, human-initiated action, not a mid-build one.

This rule is enforced primarily in the skill prompts (build/tdd/pipeline tell the
implementation subagent never to integrate upstream itself). The `block-destructive-git`
hook **no longer hard-blocks** ad-hoc `git rebase` — a hard block also rejected the
legitimate operator and `/rebase` cases — so the discipline lives here and in the
dispatch prompts, not in the hook.

## Autonomy Principle

**Anything approved more than once is a candidate for automation.**

Routine operations (reading/editing project files, running tests, running linters, launching
subagents) should be pre-approved in project settings. Only genuinely destructive or
external-facing actions warrant interactive approval:

| Pre-approve (routine) | Require approval (destructive/external) |
|---|---|
| File reads/edits within project | `git push`, `git reset --hard` |
| Running test suite | Deleting branches |
| Running linter | Posting to external services (PRs, issues) |
| Launching subagents | Database drops or destructive migrations |
| `git add`, `git commit` | Force push, rebase published commits |

When setting up a new project with `/bootstrap`, configure `allowedTools` in
`.claude/settings.json` to pre-approve routine operations.

## Explore Agent Partitioning

When launching multiple Explore agents, partition by **directory** (e.g., Agent 1: `app/` + `db/`,
Agent 2: `spec/` + `.docs/`) — never by topic. Topic-based partitioning causes 30-50% file read
overlap (observed in retros). Directory partitioning ensures each agent reads a disjoint set of files.

If exploration was already performed earlier in the session (e.g., during brainstorm), pass the
summary to subsequent agents (e.g., Plan) instead of re-exploring the same scope.

## Harness Updates

The harness version your project runs against is controlled by the `conductor:`
block in `~/.ai-conductor/config.yml`:

```yaml
conductor:
  update_channel: tagged
  auto_check: true
  current_version: v0.3.0
  last_checked_at: 2026-04-11T00:00:00Z
```

- **`update_channel`** — `tagged` (default, stable semver releases) or `main`
  (bleeding edge, every merge to main).
- **`auto_check`** — if `true`, every `/conduct` run checks for updates on the
  configured channel before running any pipeline step.
- **`current_version`** — the version of the harness your project is pinned to.
  On the tagged channel this is a `vX.Y.Z` tag; on main it's `main@<sha>`.
- **`last_checked_at`** — the ISO-8601 UTC timestamp of the most recent update
  check.

For an existing installation, `~/.claude/ai-conductor.config.json` is a
one-time seed. Its recognized camelCase values are copied into `conductor:` on
first access, then the file is renamed to `ai-conductor.config.json.migrated`.
It is not a live configuration source.

### Update flow

1. `bin/update` fetches either the latest tag (`tagged`) or the remote branch
   (`main`), depending on how it's invoked:
   - `bin/update` (no args) forces a check now, bypassing the `conductor.auto_check`
     gate.
   - `bin/update --auto` checks only if `conductor.auto_check` is not `false`; this is
     what `conduct-ts` spawns automatically at daemon startup.
2. If a newer version exists, the relevant `CHANGELOG.md` blocks are rendered
   with the configured markdown viewer (see `markdown_viewer` in
   `~/.ai-conductor/config.yml`) and the user is prompted before anything is
   applied. Updates never apply without explicit approval.
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
bin/update --set-channel tagged   # follow stable semver tags
bin/update --set-channel main     # follow main branch
bin/update                        # force an update check now
bin/update --auto                 # check only if conductor.auto_check != false
bin/update -h                     # usage
```

The `conductor.update_channel` setting is per-user (it lives in
`~/.ai-conductor/config.yml`), so every project using this harness inherits the
same channel.

## Daemon CLI

The per-repo build daemon is driven by the **`conduct-ts`** binary. **Use `conduct-ts`,
NOT the `conduct` bash wrapper, for daemon subcommands** — `conduct daemon status`
mis-routes to a feature build; only `conduct-ts daemon …` reaches the daemon commands.

The daemon is hosted as a **foreground process inside a per-repo tmux session**
(`cc-daemon-<slug>`), so you can attach to, restart, and debug a *running* daemon on demand
— in color. Management requires `tmux` on the host; the daemon itself still builds with no
tmux present (management is purely additive).

| Command | What it does |
|---------|--------------|
| `conduct-ts daemon start` | Start the repo's daemon in a tmux session. **Idempotent** — a no-op if one is already running (never a duplicate). |
| `conduct-ts daemon stop` | Stop the repo's daemon (kills the session, releases the lock). Safe no-op if not running. |
| `conduct-ts daemon restart` | Restart the daemon — fresh inner process, same session endpoint. |
| `conduct-ts daemon connect` | Attach **read-only** to watch the live, full-color output. Detach with `Ctrl-b d`; the daemon keeps running. |
| `conduct-ts daemon debug` | Attach **read/write** — `Ctrl-c` to pause the loop, inspect, then resume/restart. |
| `conduct-ts daemon status` | Liveness of every registered repo's daemon (running / stale / stopped, pid, started-at, last activity, **session up/down**) |
| `conduct-ts daemon logs [--follow] [--all] [--repo <path>]` | Tail `.daemon/daemon.log` (ANSI-stripped) for this repo, all registered repos, or a named one |
| `conduct-ts daemon --continuous` | Run a daemon in the **foreground**, idle-polling forever (omit `--max-idle-polls` ⇒ Infinity). This is the process tmux hosts. |
| `conduct-ts daemon` | Drain the current backlog once, then exit (add `--max-idle-polls N` to self-limit after N idle polls) |

One daemon per repo, enforced by the pidfile lock at `.daemon/daemon.pid` (stale dead-pid
locks self-reclaim) underneath the tmux session. The daemon runs **serially** (one feature at a
time), so `connect` always shows exactly the feature currently building. A host reboot drops
tmux sessions; the next `daemon start` (or engineer nudge) respawns.

## Key Conventions

- One skill, one responsibility, one enforcement level
- **PRDs are product-only.** A PRD (`prd` skill, product track) states goals and requirements
  (the *what* and *why*); it must NOT name the *new internal mechanism* by which this feature is
  built — commands/flags, file paths, config keys, function/class/type names, library/protocol
  choices, schemas, ports. Requirements are capabilities and behaviors; the *how* is resolved in
  `/architecture-review` (weighed as trade-offs, captured as ADRs) and appears in the PRD only as
  Open Questions. **Carve-out:** pre-existing *external* constraints and dependencies (an existing
  API the feature must use, "must run offline", a mandated datastore) MAY be named as requirements
  under Dependencies / Non-Functional Requirements — those are product reality, not a leaked
  internal mechanism. Technical-track features have no PRD (acceptance criteria live in stories).
- **Intake states WHAT and outcomes — DECIDE owns HOW.** Intake issues state the
  **problem** (Observed evidence), its **Impact**, and **Desired outcomes** (stated
  observably). They must NOT prescribe the implementation. Solution ideas are welcome
  ONLY under an explicitly-labeled **Hypotheses** section (the filer's guesses) —
  DECIDE treats hypotheses as one candidate among alternatives, never as requirements.
  **Covers agents filing intake issues via `gh issue create`** on the operator's behalf:
  issue templates auto-apply only on web/mobile, but agents must follow the same
  Observed / Impact / Desired outcome / Hypotheses shape — use the `/intake` skill,
  which drives evidence-first authoring, the observable-outcome litmus, and the
  pre-file gate for exactly this.
- Plans assume zero-context executor — all detail included
- Negative path stories are mandatory, not optional
- No implementation plan without clean conflict-check
- **Design-conformance before effort.** Before investing work on any code path —
  writing new code, fixing a bug, or hardening existing code — confirm the path
  is sanctioned by the governing APPROVED decision (the relevant ADR in
  `.docs/decisions/` and/or the FR in the approved PRD). This is the cheapest
  check (one read) placed before the most expensive action (implement → test →
  review → commit). A code path that violates or is superseded by an approved
  decision is a **conformance finding (kickback / BLOCK), not work to do** —
  building or hardening code slated for deletion is wasted effort. Applies at
  every phase: BUILD (don't implement against a superseded design), and SHIP /
  debugging / manual-test (a bug on a condemned path is a removal signal, not a
  fix target).
- Retro runs on both harness AND application after every feature
- Tech-context is additive — never overrides generic skill behavior
- **Docs track features.** Every feature that adds or changes user-facing
  behavior MUST update the project's `README` and any affected documentation in
  the same change — new commands/flags, config keys, endpoints, setup steps.
  When the project keeps dedicated guides beyond the front-door `README` (e.g. a
  `docs/` directory), update the relevant guide too, not just the README. A
  feature is not done while its docs are stale; the `finish` step verifies the
  README/docs reflect what shipped before opening the PR.
