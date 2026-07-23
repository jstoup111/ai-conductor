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

See [docs/intake.md](docs/intake.md) for the intake-issue shape (WHAT vs. HOW) and the
intake-only criteria enforcement reference (priority/size/dependency-linking).

## Configuration

See [docs/configuration.md](docs/configuration.md) for the full config-key reference, model fallback ladder, owner gate, self-host guardrails, and plugin system.

See [docs/architecture.md](docs/architecture.md) for the SDLC flow, skills, agent personas, enforcement levels, tech-context system, TypeScript conductor internals, and project structure.

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
