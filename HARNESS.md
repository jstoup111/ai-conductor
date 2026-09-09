---
harness-version: 2026-04-07
---

# Harness Behavioral Rules

These rules apply to all projects using the james-stoup-agents harness.
The active host agent MUST read and follow this file at the start of every session.

This is the execution contract for harness-managed work, including daemon-dispatched steps.
Lifecycle rules, gates, and agent obligations live here. Harness internals and operator reference
material live in [ARCHITECTURE.md](ARCHITECTURE.md); load that file only when configuring,
operating, or changing the relevant machinery, not as routine session context.

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
- **Diagnosis and recommended commands are load-bearing too.** A stated cause for a failure, and
  any command handed to the operator, carry the same basis label as an artifact claim — the
  operator acts on both. Before asserting how a tool, command, gate, or code path behaves, read
  what defines it: the CLI definition for a command, the runbook for a recovery sequence, the
  implementation for a mechanism. Producing no artifact does not lower the bar; it removes the
  downstream gate that would have caught the error.

This applies across all skills and dispatched agents, and is enforced concretely by two roles that
cite `verify-claims` in their own SKILL.md:

- **Authors** (create an artifact) surface assumptions and hard-block before it locks: `explore`,
  `prd`, `architecture-review`, `stories`, `plan`, `writing-system-tests`.
- **Verifiers/judges** (render findings/verdicts, don't build) attach a grounded confidence % to
  every finding and never assert one they haven't verified: `assess`, `conflict-check`,
  `code-review`, `prd-audit`, `manual-test`, `remediate`, `debugging`.

Execution steps that merely act on an already-gated artifact (`tdd`, `pipeline`), orchestration
(`conduct`, `composer`), and mechanical steps (`bootstrap`, `memory`, `architecture-diagram`,
`simplify`, `finish`, `pr`, `rebase`) do **not** self-cite — they rely on this rule and on
the upstream/surrounding gates. Casual conversation and trivially-verifiable mechanics with no
downstream blast radius are out of scope — but the diagnosis-and-commands rule above is not
scoped by step or role: it binds wherever a cause or a command reaches the operator, orchestration
and triage included.

## SDLC Phase Flow

Skills chain via artifacts in `.docs/`. No skill orchestrates another internally.

```
UNDERSTAND → DECIDE → BUILD(engine-native configured-verifier gate) → ✓checkpoint → SHIP(manual-test) → ✓checkpoint → SHIP(prd-audit, architecture-review --as-built, finish)
```

In daemon/auto runs the three SHIP validators (manual-test, prd-audit,
architecture-review --as-built) execute as one **concurrent validation group** after the
build gates (`test_suite` → build_review), fan-out capped by `validation_concurrency`
with a single-writer join; interactive runs keep the serial sequence and checkpoints
shown above.

During `manual-test`, an unavailable or unlaunchable browser automation dependency is recorded as a
non-blocking `WARN`; SHIP does not install browser packages, binaries, or system dependencies. API
criteria continue through `curl` when possible. Once the browser launches, any observed application
behavior that violates a story remains a blocking `FAIL` and follows the normal BUILD kickback.

| Phase | Skills | Artifacts |
|-------|--------|-----------|
| ALL | **conduct** (orchestrator) | Status dashboard, gate enforcement, checkpoints |
| UNDERSTAND | bootstrap, memory, assess | CLAUDE.md, .memory/, .docs/decisions/technical-assessment-*.md |
| DECIDE | explore (track) → complexity → prd (product track only) → architecture-diagram → architecture-review → stories → conflict-check → plan → coherence-check (M/L only, skipped for S) | .docs/track/, .docs/specs/, .docs/complexity/, .docs/architecture/, .docs/decisions/, .docs/stories/, .docs/conflicts/, .docs/plans/, .docs/coherence/ |
| BUILD | writing-system-tests → tdd/pipeline, debugging, code-review → engine-native configured-verifier gate | Acceptance specs, code, unit tests, aggregate verifier evidence, .pipeline/ |
| CHECKPOINT | User validation after build | Harness pause — continue, go back, or quit |
| SHIP | manual-test, prd-audit, architecture-review --as-built, finish/pr | .pipeline/manual-test-results.md, .pipeline/prd-audit.md, .pipeline/architecture-review-as-built.md (run evidence, gitignored), .docs/shipped/ |
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

For each new or changed behavior that crosses a production boundary, exactly one plan task owns the
integration proof through an appropriate project entry point. The task's `Done when:` states the
observable boundary behavior, and BUILD cannot close it using only direct helper tests. This follows
behavior rather than production-file count: internal helpers, types, and refactors do not each require
their own entry-point test when another task owns the boundary integration.

An acceptance-spec remediation may waive separate RED proof only when one atomic repair must change
both the acceptance spec and its implementation. The waiver must be recorded with a non-empty reason
and attributable approval; the completion is reported as waived, never as proven RED. Without that
recorded declaration, the acceptance specs must establish ordinary failing-spec RED evidence.

### Behavioral Coverage at the Lowest Sufficient Layer

Every happy and negative acceptance criterion needs one concrete coverage disposition: existing
sufficient behavioral proof, a lower-layer behavioral test, or an acceptance/system spec. A criterion
does not automatically require a new acceptance/system spec, and work remains incomplete until its
disposition identifies the proof or test that covers the behavior.

Reserve acceptance/system coverage for a distinct, multi-step externally observable flow that cannot
be proven sufficiently below. Negative behavior remains mandatory, but lower-layer coverage retains
its failure permutations; an acceptance/system spec covers the distinct flow without duplicating each
of those permutations. Test scope follows changed behavior and failure boundaries, not production-file
count, so production-file count does not determine test-file count. Natural-language skill guidance
alone is not executable or machine-readable behavior and must not be tested solely by matching its
wording.

Every generated acceptance/system spec must still establish genuine RED evidence before
implementation. A declared exact-copy `Pattern-source` / `Rename-map` contract remains its separate
mechanical exception: it copies the source acceptance specs under its governing contract even when
the lowest-sufficient-layer rule would not select them from scratch. This exception does not apply to
ordinary semantic pattern reuse without that declaration.

**DECIDE scope:** The operator chooses the fix breadth before approach confirmation. Do not silently
narrow or broaden the requested outcome.

### DECIDE Artifact Amendment Ownership

When a DECIDE pass falsifies an assertion in an accepted DECIDE artifact, DECIDE corrects that artifact
in place on the spec branch before the first BUILD entry. Story artifacts under `.docs/stories/` are the
exception: replace superseded assertions in place and leave no amendment record. For all other accepted
DECIDE artifacts, add the correction beside the original assertion in this additive form; never rewrite
or delete the original text and never create a separate amendment record:

```markdown
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

BUILD never receives that mutation as a task. A plan task must not name another feature's artifact
under `.docs/architecture/`, `.docs/decisions/`, `.docs/plans/`, `.docs/specs/`, or `.docs/stories/`; authoring checks
the plan with `ai-conductor plan-protected-targets <plan-path>`, and the spec land gate independently
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

Installed skills are **explicit-only by default**. Claude skills declare
`disable-model-invocation: true`; Codex skills declare
`policy.allow_implicit_invocation: false` in `agents/openai.yaml`. The engine's rendered `/skill-name`
or `$skill-name` prompt is an explicit invocation, so lifecycle dispatch still works. Only these
same-session dependencies remain model-invocable because another skill must be able to activate them:
`architecture-diagram`, `architecture-review`, `coherence-check`, `conflict-check`, `debugging`,
`explore`, `intake`, `plan`, `prd`, `simplify`, `stories`, and `verify-claims`. Do not add an
exception merely because a skill is useful or broadly applicable; it must have a verified
model-initiated caller whose workflow would otherwise break.

If a required capability is unavailable for the selected provider, stop before incompatible work
begins. Report an unsupported-capability diagnostic that names the selected provider, the missing
capability, and the concrete recovery action required to continue. Leave the lifecycle gate
incomplete and emit no success artifact; never silently substitute another provider's syntax,
tool, delegation, credentials, or success result. A supported provider-native alternative is a
valid path even when it differs from the other host's mechanism, and must proceed without a false
unsupported-capability rejection.

**Start here:** Prefer the daemon for autonomous work:
- **Automated:** Author and merge a spec with `ai-conductor compose`, then run `ai-conductor daemon start`
- **Interactive:** Run `/conduct` inside Claude Code or `ai-conductor inline --interactive "feature description"`

The foreground `ai-conductor inline --auto` mode is deprecated; use the daemon for unattended runs.

## Model Selection

Use the least expensive provider-native capability tier that can do the job. During daemon
execution, use the provider, model, and effort resolved by the engine for the dispatched step;
do not translate model aliases across providers. Interactive Claude opus-tier skills retain their
frontmatter pins; Codex uses its native session or spawned-agent configuration.

Every provider dispatch starts a fresh session, including retries. Recover retry context from
committed artifacts and the full retry prompt, never by resuming an earlier session.

The generated model table, provider routing, availability fallback, and escalation mechanics are
reference material in [ARCHITECTURE.md](ARCHITECTURE.md#model-selection).

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
through `ai-conductor scoped-run <selectors...>`. The agent derives the selectors; it does not
hand-assemble or narrate a test command. Debugging and conduct progression use the same policy.
Pipeline batch boundaries and parallel joins retain pipeline's named `BATCH_AFFECTED_TESTS`
union and supplied results without routine reruns. A concrete interaction risk or changed behavior
may justify a minimal targeted check through the same interface. Evaluators inspect the supplied results
without routine reruns; they run targeted tests only to reproduce a specific suspected defect.
A known scoped failure blocks its current
BUILD activity; it is never deferred to the aggregate gate.

**Test isolation policy:** Automated unit, acceptance, integration, and end-to-end tests
must not call real third-party systems. Unit tests inject mocked adapters. Acceptance,
integration, and end-to-end tests exercise the real application entry point, internal wiring,
and locally controlled infrastructure while replacing each third-party boundary with a faithful
fake through the production adapter seam. This includes LLM providers, hosted APIs, GitHub,
email/payment services, webhooks, package registries, and other network services. Only explicitly
named smoke tests (`test/smoke/**` or `*.smoke.test.*`) may use the real third party. Smoke tests
are opt-in and excluded from the default test command and CI aggregate suite.

The engine-native `test_suite` step owns full-suite or aggregate suite execution and evidence,
as selected by project configuration. Other skills inspect existing evidence and run only minimal
targeted tests when needed to implement, repair, or reproduce changed behavior; they never
launch full-suite or aggregate runs. Missing or stale suite proof returns to `test_suite`.
BUILD skills record uncertain affected-test scope and defer aggregate proof to that gate;
uncertainty never authorizes an intermediate aggregate run. See `pipeline` for scope triggers.
On a suite-failure kickback, use the supplied diagnostics and referenced evidence to repair
and verify the affected tests; the gate owns the aggregate rerun. FINISH consumes the configured verification evidence; its provider session never launches a suite.
Independent CI remains a separate authority.

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

### SHIP Phase (manual-test, prd-audit, architecture-review --as-built, finish, pr)

Structured output only. Follow the skill's output template. No free-form commentary.

## Tech-Context

Stack-specific knowledge lives in `tech-context/`. Bootstrap detects the project stack and loads
the matching context into the session. Skills reference tech-context when available, work without it.

**Load once, reference everywhere:** Tech-context files are read once during `/bootstrap` and
become part of the session context. Skills that need tech-context (stories, tdd, writing-system-tests,
code-review, debugging) should reference the already-loaded context rather than re-reading
the files independently. This avoids redundant file reads across skill invocations.

## MCP Servers (When Available)

When the context7 MCP server is installed, use it proactively:

- **context7** — Library/framework documentation. Use for API syntax, config, version migration. Skip for business logic, refactoring, and general programming concepts.

## Memory

Project-level memory lives in `.memory/` with categories: decisions, patterns, gotchas, context.
Every explicit memory invocation and harness-managed memory step starts with recall. Significant
decisions are persisted when an active harness workflow requires a memory checkpoint. Ordinary host
chat does not invoke memory automatically; use `/memory` in Claude or `$memory` in Codex when recall
is wanted outside the lifecycle. Claude session hooks may still surface a bounded memory index or a
persistence reminder; that context injection is not an invocation of the memory skill.
Skills with Memory Checkpoint sections define when writes are expected — check skill verification lists.

## Push Policy

**Never push to a remote until confident the work is complete and passing.**
Require current configured verification evidence before pushing; missing or stale suite proof
returns to `test_suite`. Do not rerun tests merely because publication is next. The `/finish` skill presents the user with completion options and, when the
outcome is Push & PR, performs the push and PR creation **inline** — it does not delegate to
`/pr`, because a delegated skill invocation ends the finish turn before
`ai-conductor finish-record` writes `.pipeline/finish-choice`. `/pr` remains available as a
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
overlap (observed in prior investigations). Directory partitioning ensures each agent reads a disjoint set of files.

If exploration was already performed earlier in the session (e.g., during brainstorm), pass the
summary to subsequent agents (e.g., Plan) instead of re-exploring the same scope.

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
- **Pattern authority is conditional.** An approved architecture outranks observed
  code. Otherwise, when a suitable established local pattern applies, reuse it
  for that feature; a verified no-fit or an operator-authorized bounded departure
  is allowed. This is a feature-specific conformance decision, not a universal
  project style or pattern catalog. A declared exact replication remains a
  distinct mechanical case: reproduce its specified source exactly rather than
  treating pattern choice as permission to vary it.
- Tech-context is additive — never overrides generic skill behavior
- **Docs track features.** Every feature that adds or changes user-facing
  behavior MUST update the project's `README` and any affected documentation in
  the same change — new commands/flags, config keys, endpoints, setup steps.
  When the project keeps dedicated guides beyond the front-door `README` (e.g. a
  `docs/` directory), update the relevant guide too, not just the README. A
  feature is not done while its docs are stale; the `finish` step verifies the
  README/docs reflect what shipped before opening the PR.
- **Operator-actionable halts are branch-visible.** An operator-actionable halt
  on a feature branch lands a committed `.docs/halted/<slug>.md` record; a
  `mechanical` halt does not.
