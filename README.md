# James Stoup Agents

A custom development harness for Claude Code. Pure Markdown skills and agent personas that enforce
a disciplined SDLC: design docs, user stories with mandatory negative paths, conflict detection,
TDD with domain review, evaluator-gated code review, and dual retrospectives.

No custom runtime. Claude Code is the execution engine.

## Requirements

- [Claude Code](https://docs.anthropic.com/en/.docs/claude-code) v2.0+
- Git
- A project to work on (Rails+PostgreSQL has full tech-context support; other stacks work with generic skills)

## Install

```bash
git clone git@github.com:jstoup111/ai-conductor.git
cd ai-conductor
./bin/install
```

This symlinks all 20 skills into `~/.claude/skills/` and installs the conductor CLI(s) to
`~/.local/bin/`. See [Getting Started](docs/getting-started.md) for the full install
walkthrough (Mermaid renderer setup, verify/update/uninstall, worktree-root guard) and
[Choosing a Conductor](docs/choosing-a-conductor.md) for the `conduct` vs `conduct-ts`
comparison — both binaries coexist, `conduct` is the default, `conduct-ts` is opt-in.

## How the Pieces Fit Together

Three cooperating roles drive every feature from idea to merged PR — the **engineer**
(spec authoring), the **daemon** (autonomous build), and the **operator** (judgment +
merges). GitHub issues/PRs are the coordination medium; the daemon never merges.

```mermaid
flowchart TB
  OP(["Operator<br/>(you)"])

  subgraph GH["GitHub — coordination medium"]
    ISSUES["Issues<br/>(intake: symptom capture,<br/>priority / size / links)"]
    SPECPR["Spec PR<br/>(Refs #N)"]
    BUILDPR["Implementation PR<br/>(Closes #N)"]
  end

  subgraph ENG["Engineer — spec authoring (supervisor, /engineer)"]
    CLAIM["claim intake"] --> DECIDE["DECIDE flow:<br/>explore · complexity · stories ·<br/>plan · architecture + ADRs"]
    DECIDE --> LAND["land: spec artifacts under .docs/<br/>(intake · stories · plan · Owner: stamped)"]
  end

  subgraph DAEMON["Daemon — autonomous build (conduct-ts daemon)"]
    SCAN["backlog scan<br/>(specs on main · owner gate ·<br/>shipped-record dedup · priority order)"]
    WT["dispatch → git worktree<br/>+ per-worktree engine build"]
    BUILD["SDLC build: TDD tasks<br/>Task: N trailers → telemetry only<br/>(completion gated by build_review completeness)"]
    HEAL["self-heal:<br/>retry escalation (effort→model) ·<br/>stall remediation · ci-fix on red PRs ·<br/>halt / park for the operator"]
    VAL["SHIP validators:<br/>manual_test · prd_audit ·<br/>architecture review (as built)"]
    FIN["finish: rebase → push →<br/>PR + committed shipped-record"]
    SCAN --> WT --> BUILD --> VAL --> FIN
    BUILD <--> HEAL
  end

  OP -->|"file / approve intake"| ISSUES
  ISSUES --> CLAIM
  LAND --> SPECPR
  SPECPR -->|"operator merges"| MAIN[("main")]
  MAIN --> SCAN
  FIN --> BUILDPR
  BUILDPR -->|"operator merges<br/>(daemon never merges)"| MAIN
  HEAL -.->|"halts / parks needing judgment"| OP
  OP -->|"unpark · approve VERSION bumps"| DAEMON
```

- **Engineer**: turns a captured issue into a buildable spec (plan, stories, ADRs) and
  lands it as a spec PR. Investigation lives here — intake stays a plain symptom capture.
- **Daemon**: drains merged specs in priority order, builds each in an isolated worktree
  through the full SDLC, gated on completion by `build_review`'s LLM-judged completeness
  rubric (plan-vs-diff, fail-closed, self-heals via kickback), self-heals stalls and red CI,
  and opens the implementation PR with a committed shipped-record so the work is never
  re-dispatched.
- **Operator**: the only merger. Approves intake priorities, resolves halts the machinery
  escalates, and signs off version bumps.

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

**Manual-test recording (`manual-test-record`, #385).** The daemon's auto-mode
had no way to record a `manual_test` outcome — only an interactive operator
could write the completion marker, so unattended builds HALTed at that step.
A dedicated subcommand records the outcome instead:

```bash
conduct-ts manual-test-record --skip --reason <r> --pipeline-dir <abs-path>
conduct-ts manual-test-record --results <path> --pipeline-dir <abs-path>
```

- `--skip --reason <r>` writes a fresh `<!-- manual-test:skipped -->` SKIP
  sentinel into the results file; `--results <path>` (or `--results -` for
  stdin) appends an attempt section with the actual test results.
- `--pipeline-dir <abs-path>` is required and must be an absolute, existing
  directory.
- **Fail-closed:** malformed flags (e.g. `--skip` paired with `--results`, a
  missing `--reason`, a relative `--pipeline-dir`) refuse before any write.
- The `manual_test` completion predicate accepts a **fresh** SKIP sentinel as
  done, with FAIL-precedence (a FAIL row recorded after the sentinel always
  wins) and anti-laundering guards (a stale or backdated sentinel does not
  satisfy the gate) — see `src/conductor/README.md` for the predicate's full
  ordering rules.
- `manual_test` is now S-tier skippable: a skipped step satisfies downstream
  `prd_audit` prerequisites the same way a completed one does.

It's invoked by the daemon's auto-mode dispatch in place of hand-writing the
marker, and can also be run manually. See `src/conductor/README.md` for full
detail.

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

See [docs/observability.md](docs/observability.md) for the attribution enforcement,
task-stamp telemetry, and session-hook dispatch-stamping reference.

See [docs/daemon-operations.md](docs/daemon-operations.md) for the daemon operational
reference (halt-issues sweep, overlap-scan, priority scheduling, rate-limit coordination,
halt-PR presentation, delivery guards, and brain-loop supervision).

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

### Intake-Only Criteria Enforcement (Priority + Size + Dependency-Linking)

Every intake issue must carry the criteria the daemon backlog needs to schedule it — a
`priority:` label, a `size:` label, and (when applicable) a `blocked_by:` link — and this
harness stamps them **at intake, never downstream**. No build, gate, or CI workflow ever
blocks on missing criteria; an unlabeled issue simply defaults and moves on. See
`src/conductor/README.md` → "Intake-only criteria enforcement" for the full pipeline; summary
below.

- **Required form fields.** [`.github/ISSUE_TEMPLATE/intake.yml`](.github/ISSUE_TEMPLATE/intake.yml)
  now has required `Priority` (`critical`/`high`/`medium`/`low`) and `Size` (`S`/`M`/`L`)
  dropdowns, plus an optional free-text `Depends on` field (issue numbers, or "none"),
  alongside the existing Observed/Impact/Desired-outcome/Hypotheses sections.

- **`intake-label-sync` Action.** [`.github/workflows/intake-label-sync.yml`](.github/workflows/intake-label-sync.yml)
  fires on `issues: [opened, edited]`, parses the submitted form body, and stamps the
  matching `priority:`/`size:` labels plus one `blocked_by:#N` label per dependency —
  defaulting to `size: M` / `priority: medium` on unparsable or missing input rather than
  leaving the issue unlabeled. It is entirely isolated from `ci.yml`: labels-only
  permissions (`issues: write` / `contents: read`), `continue-on-error: true`, and the
  underlying `syncIssueLabels()` (`src/conductor/src/engine/engineer/intake/label-sync.ts`)
  catches all errors internally and always exits 0 — a label-sync failure can never fail a
  build or block another workflow. Idempotent: re-editing an issue re-diffs and re-applies
  labels rather than duplicating them.

- **`bin/intake-file`** — files a criteria-complete issue in one atomic operation instead of
  relying on the web form:
  ```bash
  src/conductor/bin/intake-file --title "..." --body "..." \
    [--size S|M|L] [--priority critical|high|medium|low] \
    [--depends-on owner/repo#N ...] [--repo owner/repo]
  ```
  Size and priority are resolved in order: explicit flag ▸ prompted (interactive TTY) ▸
  inferred from the body ▸ defaulted. `--depends-on` may repeat; when omitted interactively
  the tool records an explicit "no dependencies" acknowledgement rather than silently
  leaving the field blank. Exits 0 once the issue is created, even if label application or a
  dependency link partially fails — those surface as warnings, never as a filing failure.
  Backed by `fileIntakeIssue()` (`src/conductor/src/engine/engineer/intake/file-issue.ts`).

- **`bin/intake-backfill`** — a one-shot, non-interactive sweep for the existing backlog:
  ```bash
  src/conductor/bin/intake-backfill --repo owner/repo
  ```
  Lists open issues assigned to the authenticated `gh` user, backfills any missing
  `size:`/`priority:` labels (infer from body ▸ default), and prints an operator report
  (labelled/skipped/failed breakdown). Per-issue failures are isolated and never abort the
  sweep; it is idempotent, safe to re-run, and never HALTs. Run it once after adopting this
  feature to catch up pre-existing backlog issues that predate the required form fields, or
  any time issues were filed by hand (`gh issue create`) bypassing `bin/intake-file`.
  Backed by `backfillIntakeLabels()` (`src/conductor/src/engine/engineer/intake/backfill.ts`).

## Configuration

See [docs/configuration.md](docs/configuration.md) for the full config-key reference, model fallback ladder, owner gate, self-host guardrails, and plugin system.

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
  SHIP-tail verdict checks (`build_review`, `prd_audit`, `architecture_review_as_built`)
  require their verdict artifact's mtime to be fresh relative to the **per-attempt** judging
  session (`attemptStartedAt`), not just the conductor-run start (`sessionStartedAt`) — a
  re-dispatched judging session that fails to rewrite its verdict file scores "no fresh
  verdict" instead of silently re-scoring a prior attempt's verdict forever.
- **Code-validity verdict preservation on re-dispatch/resume** (#817): those same judged
  gates (`build_review`, `prd_audit`, `architecture_review_as_built`, `manual_test`) also
  validate against **current code state**, not just evidence-file timestamp. Each `PASS`
  verdict is stamped with the HEAD SHA it was judged against; when a feature is
  re-dispatched or resumed and the code under that gate's declared surface (`GATE_SURFACE`)
  is unchanged since the stamp, the verdict is preserved and the gate is skipped instead of
  re-run — so a re-dispatched feature no longer re-pays a completed, still-valid judged gate
  (e.g. the ~17 min `build_review`) purely because the evidence file predates the new
  session. A stamped baseline that is missing, unreachable (rebase/reset-orphaned), or whose
  delta can't be computed always falls back to re-running (fail-closed). Opt-out via the
  additive `gate_code_validity.enabled` config key (default `true`); setting it `false`
  restores exact pre-feature mtime-only behavior. See `src/conductor/README.md` and
  `.docs/decisions/adr-2026-07-22-gate-evidence-code-validity-on-redispatch.md`.
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
- **Parallel SHIP validation phase** (#469, auto mode only): when an auto-mode run
  (`inline`/`daemon`) reaches the SHIP validators, `manual_test`, `prd_audit`, and
  `architecture_review_as_built` fan out as a **concurrent validation group** instead of the
  serial walk — each branch on its own fresh session, bounded by the `validation_concurrency`
  config key (default **2**; zero/negative/non-numeric values fall back to 2; always capped at
  the number of actually-dispatchable members, so a width-1 group degrades to exact serial
  semantics). Branches never write state — a **single-writer join** recomputes every member's
  objective gate verdict from on-disk evidence after all branches settle, then writes
  `conduct-state.json` + `.pipeline/gates/*` once. Join classification preserves the serial
  guarantees: all-green advances; an MT-only FAIL takes the same deterministic
  `manual_test → build` kickback (#367); mixed gaps dispatch **one** `/remediate` over the
  union of failing members' evidence (shared `MAX_KICKBACKS_PER_GATE` budget, D2 no-op-cycle
  HALT parity); a branch with no verdict HALTs loudly. SIGINT mid-group persists each settled
  member's `done`, and a resumed run re-dispatches only unfinished members. Interactive runs
  are untouched — members execute via the pre-existing serial walk with their normal
  checkpoints. See `src/conductor/README.md` → "Parallel validation phase".
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
  `.worktrees/`; `--remote` is add-only, no push) and refuses to clobber a non-empty
  target.
  Both are **non-interactive** (run to completion and exit). `/bootstrap` auto-registers the
  project via `conduct register .` after onboarding (idempotent).
- **Pinned Node**: `conduct-ts` reads `src/conductor/.tool-versions` and exports
  `ASDF_NODEJS_VERSION` so the bundle runs on its required Node even when your shell's
  default is older.

See [`src/conductor/README.md`](src/conductor/README.md) for the gate-loop and daemon
internals (verdicts, selector, kickback, worker pool, task-status, auto-park, remediation).

**Task Status (engine-owned):** The engine is the single authority for
`.pipeline/task-status.json`. `Task: <id>` commit trailers are telemetry only — they update
progress/resolved-count reporting (#757) but no longer derive or gate task completion.
Build-step (and therefore task) completion is decided by `build_review`'s completeness
rubric: an LLM-judged, fail-closed, plan-vs-diff check. See `src/conductor/README.md` →
"Task Status (engine-owned)".

**Auto-park (#773 demotion):** the durable no-evidence-attempt counter park path has been
deleted — commit-stamping telemetry no longer drives auto-park. Auto-park now fires only
for an explicit, caller-supplied reason (e.g. an empty/missing plan at seed time); wall-clock
and attempt bounds elsewhere in the daemon still provide a survivable halt for stuck builds.
Unpark (`conduct daemon unpark <slug>`) clears the park marker and resumes. See
`src/conductor/README.md` → "Auto-park".

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
│   ├── update                # bin/update — self-update check/apply CLI (see HARNESS.md → "Update flow")
│   └── migrate               # Changelog-driven migration runner
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

See [Getting Started](docs/getting-started.md) for what `/bootstrap` creates in your
project and how to add tech-context for new stacks.

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
