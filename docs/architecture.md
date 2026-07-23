# Architecture

This document covers the harness's internal design: the SDLC flow, skills, agent
personas, enforcement levels, tech-context system, the TypeScript conductor
internals, and the repo's project structure.

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
