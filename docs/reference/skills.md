---
title: Skills
parent: Reference
nav_order: 7
---

# Skills

The catalog of all 33 skills: 29 under `skills/` and 4 repository-local ones under `.agents/skills/`.
For each, the frontmatter, the engine step that invokes it, what it reads, what it writes, and whether
it blocks.

A skill is a `SKILL.md` directory. The engine dispatches most of them by name at a
[step](steps.md); the rest are invoked by an operator, by another skill, or not wired at all. The two
plugins in this repository (`json-stdout-subscriber`, `recorder-provider`) define **zero** skills —
they are a UI renderer and an LLM provider respectively.

Skills are grouped by their declared `phase` and, within a group, listed in flow order. The text under
each skill name is its verbatim `description` frontmatter value — that string is what a host agent
matches on when deciding to invoke the skill.

## Frontmatter fields

| Field | Required | Meaning |
| --- | --- | --- |
| `name` | yes | Skill identifier; must match the directory name |
| `description` | yes | Model-facing trigger text — when to invoke this skill |
| `enforcement` | yes for `skills/*` | Declared strictness: `advisory`, `gating`, or `structural`. **Advisory only.** The engine's step definition decides real skippability — see [Known limitations](#known-limitations) |
| `phase` | yes for `skills/*` | `understand`, `decide`, `build`, `ship`, or `all` |
| `standalone` | no | Whether an operator can run the skill on its own. Absent means non-standalone |
| `operator_only` | no | `true` marks a skill an operator invokes from *outside* a run. `bin/install` still symlinks it into both user-space catalogs (`~/.claude/skills`, `~/.agents/skills`), so the operator has it on either provider; the engine suppresses it per dispatch instead. Enforced — integrity check 5d fails on drift between this flag and `OPERATOR_ONLY_SKILLS` in `worktree-prepare.ts`. See [operator-only suppression coverage](#operator-only-suppression-coverage) for what each provider actually enforces |
| `phase_active_policy` | no | Operator-skill policy for `.pipeline/phase-active`. `daemon-triage` declares `advisory`: marker and daemon-status evidence may warn but never block read-only diagnosis |
| `requires` | no | Prerequisite skills or artifact paths |
| `model` | no | Hand-authored model pin. Seven skills carry one; the rest inherit. See [models](models.md) |

### Operator-only suppression coverage

`operator_only: true` is enforced per dispatch, not at install time — the operator keeps the skill on
both providers. Coverage is not uniform, and the gap is load-bearing enough to state plainly:

| | Claude | Codex |
| --- | --- | --- |
| **Self-host build** | `skillOverrides` in the worktree's `.claude/settings.local.json` | the skill is pruned from the throwaway `CODEX_HOME` skills copy — no artifact to load |
| **Any other repo** | `skillOverrides`, same as above | **not mechanically suppressed** |

The bottom-right cell is a real gap. Codex discovers skills by listing `~/.agents/skills` and honors
no per-session override, and the isolated-home path that would let the engine prune that view is
gated to self-host builds (`isSelfBuild()`, `conductor.ts`) precisely so other repos stay
byte-for-byte unchanged. In that cell `daemon-triage` warns when phase-marker and daemon-status
evidence looks live but still continues read-only diagnosis; its mutation approval contract prevents
unprompted recovery actions. Closing the invocation gap properly means the engine owning the entry
point rather than shipping a loadable skill at all; that is
[#1098](https://github.com/jstoup111/ai-conductor/issues/1098).

The repository integrity suite checks that every `skills/*/SKILL.md` has `name`, `description`,
`enforcement`, and `phase`. The four `.agents/skills/` entries are outside that check and declare only
`name` and `description`.

## Index

| Skill | `enforcement` | `phase` | `model` | Engine step | Gate role |
| --- | --- | --- | --- | --- | --- |
| `bootstrap` | advisory | understand | — | `bootstrap` (out-of-band) | Advisory |
| `memory` | gating | understand | — | `memory` (1) | Advisory |
| `assess` | gating | understand | sonnet | `assess` (out-of-band) | Advisory |
| `conduct` | gating | all | — | `worktree` (0), `complexity` (3) | Blocking via `worktree` (structural) |
| `verify-claims` | gating | all | — | none | Blocking, inside the calling skill |
| `daemon-triage` | advisory | all | — | none (operator-only) | None — read-only diagnosis; recovery only on per-action operator approval |
| `architecture-diagram` | gating | all | sonnet | `architecture_diagram` (5) | Advisory as a step; blocking at land time |
| `explore` | advisory | decide | — | `explore` (2) | Advisory |
| `prd` | gating | decide | — | `prd` (4) | Blocking |
| `architecture-review` | gating | decide | — | `architecture_review` (6), `architecture_review_as_built` (18) | Advisory at 6, blocking at 18 |
| `stories` | gating | decide | — | `stories` (7) | Blocking |
| `conflict-check` | gating | decide | — | `conflict_check` (8) | Blocking |
| `plan` | gating | decide | — | `plan` (9) | Blocking |
| `coherence-check` | gating | decide | — | `coherence_check` (10) | Blocking |
| `intake` | gating | decide | — | none — operator-invoked | Neither |
| `engineer` | advisory | decide | opus | none — operator-invoked | Neither as a step; the land gate blocks |
| `writing-system-tests` | gating | build | — | `acceptance_specs` (11) | Blocking |
| `pipeline` | structural | build | — | `build` (12) | Blocking; cannot be disabled |
| `tdd` | structural | build | — | none — runs inside `build` | Neither |
| `code-review` | gating | build | opus | none — pipeline batch boundary | Blocking in place |
| `simplify` | gating | build | sonnet | none — pipeline batch boundary | Blocking in place |
| `debugging` | gating | build | opus | none — on demand | Neither |
| `manual-test` | gating | ship | — | `manual_test` (16) | Blocking |
| `prd-audit` | gating | ship | opus | `prd_audit` (17) | Blocking |
| `remediate` | gating | ship | — | `remediate` (out-of-band) | Advisory — it is the unblocker |
| `retro` | advisory | ship | — | `retro` (19) | Advisory |
| `rebase` | advisory | ship | — | `rebase` (20) — on conflict only | Blocking via the structural step |
| `finish` | gating | ship | — | `finish` (21) | Blocking |
| `pr` | advisory | ship | — | none — operator-invoked; `/finish` inlines it rather than calling it | Neither |
| `maintain-documentation` | (none) | (none) | — | custom step after `rebase` | Blocking, this repository only |
| `release-disposition` | (none) | (none) | — | custom step after `maintain-documentation` | Blocking, this repository only |
| `write-tests` | (none) | (none) | — | none — unwired | Neither |

Gate roles: **Blocking** means a non-passing result stops progression. **Advisory** means it runs and
records but never blocks. **Neither** means it has no gate role in the flow.

## Cross-cutting skills

### conduct

> Use to guide a feature through the full SDLC. Checks artifact state, determines current phase, tells you what to run next, and blocks progression when gates aren't met.

- **Frontmatter** — `enforcement: gating`, `phase: all`, `standalone: true`, `requires: []`, no model pin.
- **Engine step** — not a step itself. The engine dispatches it with an argument for two steps:
  `/conduct worktree` (index 0, structural) and `/conduct complexity` (index 3, advisory).
- **Inputs** — artifact-existence checks across `CLAUDE.md`, `.memory/index.md`, and the `.docs/`
  subdirectories; `.pipeline/conduct-state.json` and the SHIP-tail evidence files; a grep of
  `.docs/decisions/adr-*.md` for `Status: DRAFT`.
- **Outputs** — `.pipeline/conduct-state.json` (`complexity_tier`, per-step status, `feature_status`);
  a clean-pass marker under `.docs/conflicts/`. Neither of its two steps has a completion glob.
- **Gate role** — the gate host. It directs; it does not run other skills.

### verify-claims

> Use whenever a statement, theory, or assumption is about to become load-bearing for a spec, plan, ADR, or code. Attaches grounded confidence estimates to claims, always surfaces assumptions, and HARD-BLOCKS work built on unconfirmed assumptions until the operator approves them.

- **Frontmatter** — `enforcement: gating`, `phase: all`, `standalone: true`, `requires: []`, no model pin.
- **Engine step** — none. It is a discipline applied inside the calling skill's context and model, not
  a separately dispatched agent. Fifteen skills declare it in `requires`.
- **Inputs** — whatever the calling skill's load-bearing output is. One cheap read or grep is preferred
  over an estimate whenever it would settle the question.
- **Outputs** — `.pipeline/verify-claims-<step>.md` when invoked inside an engine step, otherwise
  inline in the artifact or response. On an autonomous block it writes `.pipeline/HALT` with the
  assumption ledger as its body.
- **Gate role** — blocking. Verdict `CLEAR` proceeds; `ASSUMPTIONS_PENDING` blocks. Interactive runs
  wait for operator approval; autonomous runs HALT and never guess a likely value.

### daemon-triage

> Use when a feature is stuck in daemon execution — halted, spinning, stalled, or silently not progressing — and an operator needs to know why.

- **Frontmatter** — `enforcement: advisory`, `phase: all`, `standalone: true`, `operator_only: true`,
  `phase_active_policy: advisory`, `requires: [verify-claims]`, no model pin.
- **Engine step** — none, by design. It is never dispatched. `operator_only: true` suppresses it for
  step sessions where the provider supports suppression (see [Frontmatter fields](#frontmatter-fields)).
  The skill treats `.pipeline/phase-active` and daemon status as advisory context: an apparently live
  step produces a warning, while read-only triage always continues. Recovery mutations remain
  individually operator-approved.
- **Inputs** — read-only evidence only: `conduct-ts daemon status`, `.daemon/daemon.log`, and the
  feature's `.pipeline/` state (`HALT` + `HALT.class`, `events.jsonl`, `task-status.json`,
  `step-heartbeat`, `phase-active`, `gates/<step>.json`), plus the branch's commit log.
- **Outputs** — a triage report at `.daemon/triage/<slug>-<timestamp>.md`. Deliberately **not** under
  `.pipeline/` — triage output is not feature evidence and must never be read as such by a gate.
- **Gate role** — none. Diagnosis is unconditionally read-only; gathering evidence never changes the
  state being measured. It may then carry out recovery, but **every** mutation — clearing a halt,
  park/unpark, editing `.pipeline/`, any writing git command — is presented with its blast radius and
  individually approved by the operator first. Approval is per-action and never standing consent, and
  it never relaxes the safety rails (an approved delete is still enumerated explicitly). Deliberately
  conservative while classification accuracy is being established.
- **Runbooks** — reached via `skills/daemon-triage/runbooks`, a symlink to `docs/runbooks/`. The
  symlink is what makes the reference resolve correctly in a consumer repo, where the harness's
  `docs/` tree is not present but the skill directory itself is symlinked in by `bin/install`.

### architecture-diagram

> Generate and maintain C4 architecture diagrams using Mermaid in Markdown. Runs at bootstrap, plan, and post-implementation. Gating — diagrams must reflect current architecture.

- **Frontmatter** — `enforcement: gating`, `phase: all`, `standalone: true`, `requires: []`, `model: sonnet`.
- **Engine step** — `architecture_diagram` (index 5, DECIDE, skipped at tier S). Engine enforcement is
  `advisory`.
- **Inputs** — codebase structure (Procfile, `docker-compose.yml`, `database.yml`, routes, model
  definitions); the plan and stories on the update path; the `mermaid_renderer` config key.
- **Outputs** — `.docs/architecture/system-context.md`, `containers.md`, `components.md`, `erd.md`, and
  `sequences/<flow-name>.md`.
- **Gate role** — advisory as a step. Real enforcement is at land time: the spec-PR gate re-renders
  every authored Mermaid block and rejects the spec fail-closed if any block fails to render, or if
  diagrams exist but the renderer is unavailable.

## UNDERSTAND-phase skills

### bootstrap

> Use when starting a new project, onboarding to an existing project, or setting up the harness for the first time. Detects project type, tech stack, and generates project-specific configuration.

- **Frontmatter** — `enforcement: advisory`, `phase: understand`, `standalone: true`, `requires: []`, no model pin.
- **Engine step** — `bootstrap` (out-of-band, UNDERSTAND). Runs in the prelude before the loop.
- **Inputs** — root indicator files (`Gemfile`, `package.json`, `pyproject.toml`, `Cargo.toml`,
  `go.mod`, `database.yml`, `.rspec`, `Procfile`); `tech-context/<stack>/`; existing `CLAUDE.md`,
  `AGENTS.md`, `.claudeignore`, and `.claude/settings.json`, which it preserves rather than overwrites;
  `gh` and `git` history.
- **Outputs** — `bootstrap_mode` in `.pipeline/conduct-state.json`; env boundary files; `.claudeignore`;
  a PR template; `.claude/settings.json`; the `.pipeline/`, `.worktrees/`, and `.docs/` directory tree;
  DRAFT as-built stories; observed ADRs; a `.memory/` seed; initial architecture diagrams and a
  styleguide; a registry entry. No completion glob.
- **Gate role** — advisory, but downstream skills depend on the directory structure it creates.
  Failures are surfaced and not silently swallowed: a rejected first push must never be forced.

### memory

> Use at the start of every session for recall, during work when significant decisions are made, and when context seems missing. Recall-before-act protocol with categorized persistence and staleness detection.

- **Frontmatter** — `enforcement: gating`, `phase: understand`, `standalone: true`, `requires: []`, no model pin.
- **Engine step** — `memory` (index 1, UNDERSTAND). Engine enforcement is `advisory`.
- **Inputs** — `.memory/index.md`; entries under `.memory/decisions/`, `patterns/`, `gotchas/`, and
  `context/`, read in full; referenced file paths, checked for drift.
- **Outputs** — kebab-case Markdown entries under `.memory/`, each with `created`, `category`, and
  `related` frontmatter; an updated `.memory/index.md`. No `.docs/` or `.pipeline/` artifact.
- **Gate role** — advisory. Its two in-skill rules (recall before acting, persist decisions
  immediately) produce no verdict, no marker file, and block nothing downstream.

### assess

> Use for codebase health assessment. Dispatches 9 specialist agents + CTO orchestrator to evaluate security, data integrity, dependencies, architecture, duplication, testing, infrastructure, observability, and developer experience.

- **Frontmatter** — `enforcement: gating`, `phase: understand`, `standalone: true`,
  `requires: [verify-claims]`, `model: sonnet`.
- **Engine step** — `assess` (out-of-band, UNDERSTAND prelude). Auto-skipped with a `mode_skip` event
  when `bootstrap_mode` is `new`.
- **Inputs** — a full file listing; session-loaded tech-context; existing ADRs under `.docs/decisions/`
  for cross-reference and stale-ADR checks.
- **Outputs** — nine specialist reports under `.pipeline/assessment/`; the committed
  `.docs/decisions/technical-assessment-<date>.md`; the `assess`, `assess_date`, and `assess_verdict`
  state keys.
- **Gate role** — advisory. A `CRITICAL` verdict implies addressing findings before feature work but
  blocks nothing; findings become backlog.

## DECIDE-phase skills

### explore

> Use at the start of any new feature or change. Explores context, asks clarifying questions one at a time, proposes 2-3 approaches with trade-offs, and decides the work track (product vs technical). Divergent half of the old brainstorm — produces no committed design doc; the product-track PRD is authored by /prd.

- **Frontmatter** — `enforcement: advisory`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — `explore` (index 2, DECIDE). Always runs — it sets the track that gates `prd` and
  `prd_audit`.
- **Inputs** — `.memory/`; existing `.docs/stories/`; prior bootstrap exploration. At most two
  directory-partitioned exploration agents.
- **Outputs** — exactly one committed artifact, `.docs/track/<slug>.md`, carrying
  `Track: product|technical`; ephemeral notes under `.pipeline/`; the selected approach and rejected
  alternatives promoted to `.memory/decisions/`. No completion glob, by design.
- **Gate role** — advisory, with three internal hard blocks: any unconfirmed assumption that would
  change the approach or track HALTs an autonomous run; the track must be operator-confirmed; and the
  skill must never call `ExitPlanMode`, which would mark the step failed.

### prd

> Use on the PRODUCT track after /explore, when a feature has user-facing requirements. Authors a product-only design doc (PRD) with enumerated functional requirements. Convergent half of the old brainstorm. Skipped on the technical track (no product requirements to spec).

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — `prd` (index 4, DECIDE, prerequisite `explore`). Skipped on the technical track;
  a kickback target.
- **Inputs** — the `explore` track output, the design-doc and API-contract templates, and the original
  request.
- **Outputs** — `.docs/specs/<date>-<topic>.md`; a superseded prior doc renamed with a `SUPERSEDED-`
  prefix; an API response contract for API projects. It writes no files outside `.docs/specs/`.
- **Gate role** — blocking. A product-only audit runs before the PRD is presented: a PRD that names a
  new internal mechanism has failed and must be rewritten. Requires explicit operator approval.

### architecture-review

> Use before implementation to review stories through a technical feasibility and architectural alignment lens. Also use at batch boundaries to catch architectural drift.

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — two: `architecture_review` (index 6, DECIDE, engine enforcement `advisory`) and
  `architecture_review_as_built` (index 18, SHIP, engine enforcement `gating`), the latter invoked as
  `/architecture-review --as-built`. Both skip at tier S.
- **Inputs** — `.docs/decisions/`, `.docs/architecture/`, `CLAUDE.md`, `.memory/decisions/`, existing
  code, and the PRD's FRs or the explore output. As-built mode reads only `Status: APPROVED` ADRs plus
  the feature diff.
- **Outputs** — `.docs/decisions/architecture-review-<date>-<feature>.md`; ADRs under
  `.docs/decisions/`; `.pipeline/architecture-review-as-built.md`, which must be rewritten on every
  invocation or the engine reads it as stale and halts the SHIP tail.
- **Gate role** — the as-built half is blocking and fail-closed: only `APPROVED` or `APPROVED WITH
  DRIFT NOTES` passes. The DECIDE half is advisory at the step level; its DRAFT-ADR hard gate is
  enforced by the `conduct` state machine and by the land-time spec gate instead.

### stories

> Use after architecture-review, when the design is approved. Generates user stories with mandatory happy and negative paths as Given/When/Then scenarios — from the PRD's FRs (product track) or the technical intent (technical track).

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — `stories` (index 7, DECIDE, prerequisite `architecture_review`). A kickback target;
  no tier skip.
- **Inputs** — approved PRD FRs, or technical intent plus approved ADRs; existing `.docs/stories/` for
  deduplication and DRAFT completion; tech-context; `.memory/`.
- **Outputs** — `.docs/stories/<feature-name>.md`, one file per feature area, appended if it exists.
- **Gate role** — blocking. No story is accepted without at least one concrete negative path per
  acceptance criterion. The verdict layer additionally requires `### Happy Path` and
  `### Negative Path(s)` sections with Given/When/Then bullets and no `Status: DRAFT`. The status marker
  is also a downstream hard gate: the land gate rejects stories lacking `Status: Accepted`.

### conflict-check

> Use after writing stories, before creating an implementation plan, or when adding features to an existing system. Detects contradictions, overlaps, state conflicts, and resource contention between stories.

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — `conflict_check` (index 8, DECIDE, prerequisite `stories`, skipped at tier S).
- **Inputs** — all `.docs/stories/*.md`; active `.docs/specs/`; prior `.docs/conflicts/` reports.
- **Outputs** — `.docs/conflicts/<date>-<description>.md`, overwritten on re-run; in-place edits to
  affected story files; superseding ADRs.
- **Gate role** — blocking. It loops until zero blocking conflicts remain. Kickback routing is by root
  cause: contradictory FRs go to `prd`, incompatible design goes to `architecture_review`, pure phrasing
  is resolved in `stories`. In an unattended run a blocking conflict HALTs for a human — never a silent
  pass.

### plan

> Use after stories are written and conflict-check has passed clean. Converts user stories into a step-by-step implementation plan with 2-5 minute task granularity.

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: false`,
  `requires: [".docs/stories/ with both paths", ".docs/conflicts/ clean pass or no blocking conflicts", verify-claims]`,
  no model pin.
- **Engine step** — `plan` (index 9, DECIDE, prerequisite `conflict_check`). A kickback target; no tier
  skip.
- **Inputs** — all `.docs/stories/`; the clean conflict-check pass; the architecture review's
  `## Wiring Surface` section at tiers M and L.
- **Outputs** — `.docs/plans/<date>-<feature>.md`.
- **Gate role** — blocking. It refuses to produce a plan without stories, dependency lines, both paths,
  and a clean conflict-check; every acceptance criterion must map to at least one task; a missing
  `**Wired-into:**` line blocks its own verification; 41 or more tasks is a hard stop. Each `Story:`
  line takes one id — a comma-separated list silently registers only the first. Plans must not append
  a terminal catch-all task that re-proves the completed feature; scoped tests stay with their
  behavior-owning implementation task, while writing-system-tests and later BUILD/SHIP gates own
  whole-feature validation.

### coherence-check

> Use at the end of DECIDE (after /plan), for Medium and Large tier specs only, to author the committed traceability mapping — outcomes → FRs → stories → tasks with per-row verdicts — that the land-time coherence gate validates. Not used for S tier.

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — `coherence_check` (index 10, DECIDE, prerequisite `plan`, skipped at tier S).
- **Inputs** — `.docs/complexity/` for the tier; staged outcomes or `.docs/intake/<plan-stem>.md`;
  `.docs/specs/<plan-stem>.md` for FRs; `.docs/stories/<plan-stem>.md`; `.docs/plans/<plan-stem>.md`.
- **Outputs** — `.docs/coherence/<plan-stem>.md`. The stem must match the plan filename stem exactly or
  the land validator rejects it as a missing coherence artifact.
- **Gate role** — blocking. It authors the artifact the land-time coherence gate validates. Verdicts are
  exactly `covered` or `gap`. In an autonomous run an ambiguous row is marked `gap` and left for the
  fail-closed land gate — never silently passed. At tier S it does not run and must not author a stub.

### intake

> Use when filing an intake issue to GitHub — capturing a bug, idea, or observation for a later DECIDE phase. Structures the issue as WHAT (observed evidence, impact) and desired OUTCOMES (observable acceptance signals), with verbatim logs/commands/repro artifacts a zero-context engineer can debug from. Never prescribes HOW — that belongs to DECIDE.

- **Frontmatter** — `enforcement: gating`, `phase: decide`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — none. Operator- or agent-invoked, in whatever session observed the problem.
- **Inputs** — verbatim commands and output, log excerpts with source path and timestamp, `file:line`
  and SHA references, repro steps, frequency, and environment facts.
- **Outputs** — a GitHub issue. No repository file artifact.
- **Gate role** — neither. Its gate is a pre-file checklist at authoring time; nothing downstream blocks
  on it. See [intake](../guides/intake.md) for the filing procedure.

### engineer

> Interactive, phone-drivable idea→spec loop. The operator hands the host agent a raw idea; the agent routes it to the right repo, runs the FULL DECIDE phase (explore [track] → complexity → prd [product track] → architecture-diagram → architecture-review → stories → conflict-check → plan, tier-aware) in that repo, opens a spec PR there, and nudges that repo's daemon. Runs independently of any build/execution loop. Use when capturing and routing new work, NOT when building inside one repo (that's plain conduct).

- **Frontmatter** — `enforcement: advisory`, `phase: decide`, `standalone: true`, `requires: []`,
  `model: opus`.
- **Engine step** — none. It is a separate control plane with its own CLI subcommands.
- **Inputs** — a claimed GitHub intake issue, or a launch argument or chat idea; the project registry.
- **Outputs** — in a per-idea worktree on a `spec/<slug>` branch: the track marker, the complexity
  marker whose stem must match the plan stem, and the full `.docs/` DECIDE artifact set; an intake
  marker committed at land; the spec PR.
- **Gate role** — neither as an engine step, but the land gate is hard: no idea reaches a build without
  a merged spec PR, only the operator merges, no spec lands with a DRAFT ADR, and the tier must be
  recorded. See [engineer-loop](../guides/engineer-loop.md).

## BUILD-phase skills

### writing-system-tests

> Use BEFORE implementing any feature that has stories in .docs/stories/ — generates failing acceptance specs from acceptance criteria as the RED phase of TDD. Generates HTTP/request-level acceptance tests for headless/API projects, end-to-end UI tests for projects with a frontend, using the project's own test framework and directory conventions.

- **Frontmatter** — `enforcement: gating`, `phase: build`, `requires: [verify-claims]`, no model pin.
  It is the only `skills/*` entry with no `standalone` key, so it defaults to non-standalone.
- **Engine step** — `acceptance_specs` (index 11, BUILD, prerequisite `plan`, skipped at tier S).
- **Inputs** — happy and negative acceptance criteria from `.docs/stories/*.md`; the existing test suite
  and tech-context for framework and layout detection; the approved PRD FR list on the product track.
- **Outputs** — committed acceptance spec files in the project's test directories, plus gitignored run
  evidence: `.pipeline/acceptance-specs-red.json`, `.pipeline/fr-coverage.md`, and
  `.pipeline/acceptance-specs-run.json`.
- **Gate role** — blocking. The gate rejects unless the RED evidence shows at least one failure, zero
  skips, zero errors, and at least one executed spec. Any unresolved FR-coverage row is a hard stop
  under the daemon.

### pipeline

> Use when executing an implementation plan with multiple tasks. Factory orchestration with three autonomy levels, quality gates, rework budgets, and audit trails.

- **Frontmatter** — `enforcement: structural`, `phase: build`, `standalone: false`,
  `requires: [".docs/plans/ with implementation plan"]`, no model pin.
- **Engine step** — `build` (index 12, BUILD, prerequisite `plan`). Checkpoint, loop gate, structural,
  never tier-skipped, never disableable.
- **Inputs** — the plan's task dependency graph, file sets, and dependency lines;
  `.pipeline/task-status.json`; story acceptance criteria; prior batch reviews; ADRs and the approved
  PRD for the design-conformance check.
- **Outputs** — `.pipeline/audit-trail/batch-N/review.json` and the batch retro and simplification
  records; `.pipeline/progress.log`; `.pipeline/summary.json`; `.pipeline/halt-user-input-required` and
  `.pipeline/HALT` on a stall; at least one `.memory/` entry per batch. `.pipeline/current-task` and
  `.pipeline/task-status.json` are written by engine hooks and must not be hand-edited.
- **Gate role** — blocking. Evaluator dispatch at each batch boundary is mandatory; a missing or empty
  `review.json` halts and re-dispatches. `BLOCK` halts and escalates; `REQUEST_CHANGES` triggers rework
  against a three-cycle budget. Two consecutive zero-completion attempts trip a circuit breaker.
- **Fan-out** — Standard and Full derive a ready frontier from completed dependencies and
  non-overlapping file sets, then launch up to three tasks in one provider-native concurrent
  dispatch and join before verification. Claude Code uses multiple Agent tool calls in one response;
  Codex uses multiple `collaboration.spawn_agent` calls in one response. Conservative, dependent
  tasks, and overlapping-file tasks stay sequential. A selected host without native fan-out stops
  with an actionable capability diagnostic instead of silently serializing Standard or Full.
- **Dispatches** — `agents/evaluator.md`, `agents/generator.md`, `agents/worktree-manager.md`.

### tdd

> Use when implementing any feature or bugfix. Five-step cycle: RED → DOMAIN → GREEN → DOMAIN → COMMIT. Enforces test-first development with domain integrity review at every phase boundary.

- **Frontmatter** — `enforcement: structural`, `phase: build`, `standalone: true`, `requires: []`, no
  model pin.
- **Engine step** — none. It is the per-task cycle every `pipeline` implementer runs.
- **Inputs** — one acceptance criterion from the plan; test and source directory paths; the
  `steps.build.tdd.red.model` and `.green.model` config keys; tech-context lint and typecheck commands;
  `.memory/decisions/`.
- **Outputs** — git commits carrying `Task: <id>` trailers, including empty evidence commits;
  conditional `.memory/gotchas/` and `.memory/patterns/` entries. No `.docs/` artifact.
- **Gate role** — neither in flow terms, but COMMIT is a hard in-cycle gate: scoped tests green, linter
  and type-check clean, clean tree, and an exact bare plan task id in the trailer. The domain reviewer
  holds veto authority back to RED or GREEN. `Task:` trailers are telemetry only — build completion is
  derived by `build_review`, not from trailer self-reports.
- **Dispatches** — `agents/generator.md` (RED and GREEN), `agents/domain-reviewer.md` (both DOMAIN
  phases).

### code-review

> Use after implementing a task, before merging, or when requesting quality verification. Dispatches an evaluator agent with fresh context for calibrated, skeptical review.

- **Frontmatter** — `enforcement: gating`, `phase: build`, `standalone: true`,
  `requires: [verify-claims]`, `model: opus`.
- **Engine step** — none. The pipeline evaluator satisfies this gate at batch boundaries. The engine's
  `build_review` step is a separate, engine-native grader, not this skill.
- **Inputs** — `git diff <batch-start-commit>..HEAD`, scoped to the batch rather than the full branch;
  the story and acceptance criterion; the plan task; affected-test results; the tech-context review
  checklist.
- **Outputs** — no committed artifact. The evaluator emits an in-band structured verdict, persisted to
  `.memory/patterns/` and `.memory/gotchas/` at the memory checkpoint.
- **Gate role** — blocking in place, with no kickback file: a `BLOCK` verdict prevents merge and
  `REQUEST_CHANGES` must be addressed before re-review.
- **Dispatches** — `agents/evaluator.md` in a fresh context, and `agents/domain-reviewer.md`.

### simplify

> Review changed code for duplication, complexity, and over-engineering at batch boundaries. Blocking gate — must pass before next batch proceeds.

- **Frontmatter** — `enforcement: gating`, `phase: build`, `standalone: false`, `requires: []`,
  `model: sonnet`.
- **Engine step** — none. It runs inside `pipeline`'s post-batch checks and from `tdd`'s batch-boundary
  refactor rule.
- **Inputs** — the batch diff by name; the batch-start commit; existing tests at the same production
  seam; ADRs that justify an abstraction; linter output.
- **Outputs** — `.pipeline/audit-trail/batch-N-simplification.md`.
- **Gate role** — blocking within the batch. `CLEAN` proceeds; `SIMPLIFY_REQUIRED` must be fixed before
  the next batch and counts against pipeline's three-cycle rework budget.

### debugging

> Use when encountering any bug, test failure, or unexpected behavior. Four-phase systematic investigation: root cause before fix. No fixes without evidence.

- **Frontmatter** — `enforcement: gating`, `phase: build`, `standalone: true`,
  `requires: [verify-claims]`, `model: opus`.
- **Engine step** — none. Invoked on demand, and by `manual-test` in a fresh sub-session when a failure's
  cause is not self-evident.
- **Inputs** — the full error and stack trace and logs; `.memory/gotchas/` and `.memory/patterns/`;
  recent git history; the governing `Status: APPROVED` ADR or the relevant FR.
- **Outputs** — a failing reproduction test and the fix; entries in `.memory/gotchas/` and
  `.memory/patterns/`. No `.docs/` or `.pipeline/` artifact.
- **Gate role** — neither in flow terms, with two hard in-skill rules: no fix proposals before the
  investigation completes, and a design-conformance stop — if the buggy path violates or is superseded
  by an approved decision, the output is a conformance finding, not a patch. Three failed fixes escalate
  to the operator.

`test-suite` and `wiring-check` have no `SKILL.md` — both `test_suite` (index 14) and `wiring_check`
(index 13) are **engine-native** BUILD steps: they dispatch no skill. Together they form the
`build_verification` step group (see [The build verification group](steps.md#the-build-verification-group)),
fanning out after `build` and joining before `build_review`. `test_suite` obtains a current result from
the repository-configured aggregate verifier; `wiring_check` runs the deterministic reachability probe.
The engine writes `.pipeline/test-suite-evidence.json` and `.pipeline/wiring-evidence.json`
respectively. Both are blocking and cannot be tier-skipped or satisfied by a scoped result.

## SHIP-phase skills

### manual-test

> Use after /finish to validate stories via curl (API) or browser (full-stack). Bugs found loop back through /tdd.

- **Frontmatter** — `enforcement: gating`, `phase: ship`, `standalone: false`,
  `requires: [finish, verify-claims]`, no model pin.
- **Engine step** — `manual_test` (index 16, SHIP, prerequisite `test_suite`, skipped at tier S).
  Checkpoint and loop gate, and the only step that opts into `configDisableAllowed`.
- **Inputs** — story acceptance criteria; the running application; the absolute worktree `.pipeline`
  path supplied in the step's system prompt.
- **Outputs** — `.pipeline/manual-test-results.md`, written solely by `conduct-ts manual-test-record`,
  append-only as numbered attempt sections; `.pipeline/manual-test-fail-evidence.json`.
- **Gate role** — blocking. Only the latest attempt is evaluated. The skill must never hand-write or
  fabricate the results file — an absent marker is the correct refusal signal. A whitewash guard
  requires new commits after a recorded FAIL before an all-PASS attempt is accepted.
- **This repository** — `manual_test` is disabled in `.ai-conductor/config.yml`. See
  [self-hosting](../guides/self-hosting.md).

### prd-audit

> Use at SHIP, after manual-test and before retro/finish. Audits shipped implementation against the PRD's functional requirements (FR-N); gates on gaps and kicks back to BUILD or DECIDE.

- **Frontmatter** — `enforcement: gating`, `phase: ship`, `standalone: true`,
  `requires: [verify-claims]`, `model: opus`.
- **Engine step** — `prd_audit` (index 17, SHIP, prerequisite `manual_test`). Loop gate; skipped on the
  technical track; no tier skip.
- **Inputs** — approved PRDs under `.docs/specs/`, excluding superseded ones; `.docs/stories/` for
  FR-to-story traceability; the codebase and diff per FR.
- **Outputs** — `.pipeline/prd-audit.md`, overwritten each run; a code-stamp sidecar on the pass path.
- **Gate role** — blocking. It loops until every FR is `ALIGNED` or explicitly accepted by a human; a
  missing approved PRD blocks. Under the daemon, an all-implementation-gap result self-heals back to
  BUILD within a bounded budget; any non-implementation blocking row HALTs for a human. It never
  self-accepts a divergence.
- **Dispatches** — `agents/prd-auditor.md`, one dispatch per FR.

### remediate

> Use at SHIP when prd-audit, the as-built architecture review, or the finish verification blocks. Reasons over the blocking gaps and emits per-gap remediation dispositions + concrete tasks, routing each to the right step (build/acceptance_specs/architecture_review/plan) — and HALTs only for architectural-clarity or product-scope gaps that need a human.

- **Frontmatter** — `enforcement: gating`, `phase: ship`, `standalone: true`,
  `requires: [verify-claims]`, no model pin.
- **Engine step** — `remediate` (out-of-band, SHIP, prerequisite `prd_audit`). Engine enforcement is
  `advisory`. Deliberately outside the sequential list so the loop never dispatches it unconditionally.
- **Inputs** — `.pipeline/prd-audit.md`, `.pipeline/architecture-review-as-built.md`,
  `.pipeline/test-failures.md`, and `.pipeline/build-stall-question.md`.
- **Outputs** — `.pipeline/remediation.json`, overwritten each run. The engine then appends each task
  into the feature's plan. No completion glob — the engine reads the JSON directly to route.
- **Gate role** — advisory; it is the unblocker rather than a blocker. HALT is reserved for exactly
  three categories: architectural clarity, product scope, and unanswerable. Every other gap must route
  to `build`, `acceptance_specs`, `architecture_review`, or `plan`. On absent, stale, or malformed
  input the engine falls back to deterministic gap classification. The engine also HALTs, independent
  of category, when a `build` gap carries no concrete task outside a build-stall question — a taskless
  `build` disposition is not dispatchable work.
- **Dispatches** — `agents/remediation-planner.md`.

### retro

> Use after finishing a feature or at any natural milestone. Dual retrospective analyzing both the harness workflow (tool) and the application code produced (product). Generates concrete improvement proposals.

- **Frontmatter** — `enforcement: advisory`, `phase: ship`, `standalone: true`, `requires: []`, no model
  pin.
- **Engine step** — `retro` (index 19, SHIP, prerequisite `architecture_review_as_built`, skipped at
  tier S). Loop gate.
- **Inputs** — `.pipeline/audit-trail/events.jsonl` as the primary gate and rework source, explicitly
  not `.pipeline/gates/`; `.pipeline/task-status.json`; raw `.pipeline/events.jsonl` for retry history;
  `.memory/gotchas/`; `.docs/conflicts/`; `.docs/stories/`; the feature diff; the `## Cost` block of the
  shipped record.
- **Outputs** — `.docs/retros/<date>-<feature-name>.md`; `.memory/` writes; new debt stories.
- **Gate role** — advisory. Two internal honesty rules: a missing or empty events log is reported as
  `INCOMPLETE`, never read as a clean run; a missing Cost block is written as `unmetered/absent`, never
  fabricated. The completion predicate requires a feature-slug-matched, session-fresh retro file.

### rebase

> Resolve an in-progress paused rebase conflict, stage fixes, and drive git rebase --continue to completion; invoked by the conductor's finish-time rebase step or by an operator running /rebase.

- **Frontmatter** — `enforcement: advisory`, `phase: ship`, `standalone: true`, `requires: []`, no model
  pin.
- **Engine step** — `rebase` (index 20, SHIP, prerequisite `retro`). Engine enforcement is
  `structural`. The engine rebases natively and dispatches this skill **only on conflict**.
- **Inputs** — live git state only: status, the rebase-merge or rebase-apply path, the unmerged file
  list, and the conflicted files.
- **Outputs** — no file artifact. Its output *is* the contract: the last stdout JSON line, either
  `{"resolved": true}` or `{"resolved": false, "reason": "..."}`, parsed by the step runner.
- **Gate role** — blocking through the structural step. An unresolved result or an unsafe hunk retries
  up to a cap and then HALTs. Non-negotiable prohibitions: never `--abort`, never `--skip`, never
  `push --force`, never invoke mid-build.
- **Replay verification** — before editing, the skill captures the replay source commit's and
  upstream's intent as an evidence ledger, and HALTs at the first semantic ambiguity rather than
  guessing. Before `git rebase --continue`, it reviews the complete staged diff (not just the
  conflicted hunks) and requires every staged change to be attributable to the source or a
  necessary upstream adaptation. After `git rebase --continue`, it inspects the resulting replay
  commit against the retained pre-continue identity and validated intent, and only emits
  `{"resolved": true}` once every replay commit — including the final one — has reconciled.

### finish

> Judge reader-facing PR prose at the engine-owned FINISH boundary after deterministic publication prerequisites pass.

- **Frontmatter** — `enforcement: gating`, `phase: ship`, `standalone: true`, `requires: []`, no model
  pin.
- **Engine step** — `finish` (index 21, SHIP, prerequisite `rebase`). Loop gate, gating, no tier skip.
  The production coordinator dispatches this skill only for one bounded retained-PR title/body quality
  and repair pass.
- **Inputs** — the retained PR identity plus its observed title and body. Deterministic BUILD, SHIP,
  release-readiness, push, shipped-record, and outcome evidence stays engine-owned.
- **Outputs** — accepted reader-facing PR prose or a bounded repair to the retained PR title/body. The
  coordinator separately persists `state.pr_url`, commits `.docs/shipped/<slug>.md`, and writes
  `.pipeline/finish-choice` through `conduct-ts finish-record` after verification.
- **Gate role** — blocking. Missing or invalid deterministic evidence stops before this skill is
  dispatched. Placeholder, halt, or structurally incomplete prose prevents the final outcome record.
- **Interaction** — attended default and interactive foreground conduct asks the operator for PR, keep,
  or defer before any publication observation or mutation. Explicit foreground-auto and daemon modes
  use engine policy. No FINISH transition has PR merge or auto-merge authority.

### pr

> Use when creating or updating a pull request. Analyzes the full diff against the base branch, writes a concise title and structured body, and creates or updates the PR via gh.

- **Frontmatter** — `enforcement: advisory`, `phase: ship`, `standalone: true`, `requires: []`, no model
  pin.
- **Engine step** — none. Operator-invoked. `finish` does **not** call it: the Push & PR path
  inlines the same title/body contract and pre-push checks so the finish turn survives to write
  its completion record.
- **Inputs** — the branch log and diff against the base; `.docs/specs/` and `.docs/stories/`;
  `.pipeline/conduct-state.json`; the project's PR-title conventions.
- **Outputs** — the GitHub PR title and body, a pushed branch, and the PR URL. No repository file
  artifact.
- **Gate role** — neither, with one internal rule: `finish` owns completion verification. If no current
  pass exists, this skill stops and routes back rather than running the aggregate command itself.

## Repository-local skills

These live under `.agents/skills/` rather than `skills/`, declare only `name` and `description`, and
apply to this repository. See [self-hosting](../guides/self-hosting.md).

### maintain-documentation

> Review and maintain this repository's human-facing documentation. Use when this repository invokes its maintain-documentation custom step or explicitly requests documentation maintenance.

- **Frontmatter** — `name` and `description` only. No `enforcement`, `phase`, `standalone`, `requires`,
  or `model`.
- **Engine step** — a custom step wired in `.ai-conductor/config.yml` with `after: rebase`,
  `enforcement: gating`, and `completion_artifact: .pipeline/maintain-documentation-pass`. It inherits
  `rebase`'s loop-gate flag, landing between `rebase` and `finish`.
- **Inputs** — the current implementation change plus repository evidence. Its authority rule: code,
  tests, generated help, schemas, and observed behavior outrank `.docs/`, which is context only.
- **Outputs** — `.pipeline/maintain-documentation-review.md`, overwritten at the start of every
  invocation; `.pipeline/maintain-documentation-pass`, written only after a PASS verdict; documentation
  and changelog commits. `.docs/` is read-only to it.
- **Gate role** — blocking. On `BLOCKED` the pass marker stays absent. Blocking conditions include
  unverifiable claims, unresolved contradictions in authoritative evidence, dangling-link removals, and
  changelog validation failures.

### release-disposition

> Judge this repository's implementation diff and write its authoritative structured release disposition to the retained SHIP draft PR before finish.

- **Frontmatter** — `name` and `description` only. No `enforcement`, `phase`, `standalone`, `requires`,
  or `model`.
- **Engine step** — a custom step wired in `.ai-conductor/config.yml` with `after: maintain-documentation`,
  `enforcement: gating`, and `completion_artifact: .pipeline/release-disposition-pass`. It lands before
  `finish` and inherits the SHIP loop-gate behavior. It also pins `llm_provider: claude` and
  `model: sonnet`: the step judges a diff and writes a short structured disposition, so it needs a
  cheap tier rather than a frontier model, and pinning the provider keeps `claude` first in the
  candidate order instead of resolving this repository's run-level `codex` entry first.
- **Inputs** — the implementation diff, the retained SHIP draft PR, and the migration-surface classifier.
  The diff decides the disposition; the PR body is the authority once written.
- **Outputs** — structured metadata written directly to the PR body plus
  `.pipeline/release-disposition-review.md` and the PASS-only
  `.pipeline/release-disposition-pass` evidence marker. `finish` preserves the metadata while writing
  reader-facing PR content.
- **Gate role** — blocking. It fails closed when the draft cannot be read or updated, metadata is invalid,
  or a required migration is not runnable.

### scope-check

> Use before authoring any change to the ai-conductor harness repository, and before creating any new skill, to decide three things deterministically: whether the change is harness-repo-only or consumer-facing, whether a new skill belongs in the shipped `skills/` catalog or this repository's local `.agents/skills/` catalog, and whether the change is provider-agnostic. Produces a placement verdict and the registration steps that verdict requires.

- **Frontmatter** — `name` and `description` only. No `enforcement`, `phase`, `standalone`, `requires`,
  or `model`.
- **Engine step** — none. Operator-invoked, before authoring. Symlinked from `.claude/skills/scope-check`
  so both supported hosts discover the same file.
- **Inputs** — the change under consideration, plus this repository's own boundaries: `HARNESS.md`
  versus `AGENT_INSTRUCTIONS.md`, the two skill catalogs, and the registration gates in
  `test/test_harness_integrity.sh` and `test/test_provider_skill_contracts.sh`.
- **Outputs** — three verdicts (audience, catalog, provider) plus the registration list the verdicts
  require. No repository file artifact.
- **Gate role** — neither. Advisory, with no marker file and no HALT. Its value is that the
  registration cost of the two catalogs differs sharply: a `skills/` addition must satisfy integrity
  checks 2, 4, 5, 5a, and 5b plus the provider contract audit and installs globally, while an
  `.agents/skills/` addition is outside all of them.

### write-tests

> Use whenever adding, changing, reviewing, or debugging tests in the ai-conductor repository. Defines repository-specific test scope, isolation, mocking, fixture, performance, and CI-parity rules that prevent cyclic Conductor runs, leaked workers, real third-party calls, and slow aggregate suites. Complements the provider-neutral tdd skill, which controls implementation order rather than test design.

- **Frontmatter** — `name` and `description` only. It is the only skill in the repository with no
  `enforcement` field.
- **Engine step** — none. It is unwired: no step definition, no custom config step, no engine reference.
- **Inputs** — the test under authorship plus repository conventions.
- **Outputs** — none. It produces test files and prescribes commands.
- **Gate role** — neither. No verdict, no marker file, no downstream HALT. Its rules are stated as MUST
  and never, and the repository's contributor instructions make it mandatory reading. See
  [testing](../contributing/testing.md).

## Agent personas

17 persona files live under `agents/`. A persona is a prompt template defining *who* does the work; a
skill decides *when* to dispatch one and with what scoped context. Dispatch is by the host agent's
subagent facility, not by the engine — the engine dispatches skills, and skills dispatch personas.

| Persona | Role | Dispatched by |
| --- | --- | --- |
| `generator.md` | Writes tests (RED) and code (GREEN) under strict TDD in an isolated, focused context | `tdd`, `pipeline` |
| `evaluator.md` | Fresh-context quality evaluator over a scoped batch diff, with no shared state with the generator | `pipeline` at batch boundaries, `code-review` |
| `domain-reviewer.md` | Domain integrity reviewer with veto authority over tests and implementations | `tdd` at both DOMAIN phases, `code-review` |
| `prd-auditor.md` | Audits one `FR-N` against shipped code; finding authority, never fixes | `prd-audit` |
| `remediation-planner.md` | Emits per-gap dispositions and concrete tasks; planning authority, never edits code | `remediate` |
| `worktree-manager.md` | Git worktree lifecycle: creation, environment setup, merge-back, conflict resolution, proof-gated cleanup | `pipeline` |
| `planner.md` | Expands brief requirements into implementable specs | Nothing — see below |
| `cto-security.md` | Authn/authz, input validation, OWASP top 10, vulnerability surface | `assess` |
| `cto-data-integrity.md` | Transactions, event sourcing, race conditions, migrations | `assess` |
| `cto-dependencies.md` | Outdated packages, CVEs, license compliance, blocked upgrades | `assess` |
| `cto-architecture.md` | Decisions versus implementation, module consistency, coupling | `assess` |
| `cto-duplication.md` | Boilerplate and copy-paste clusters with blast-radius measurement | `assess` |
| `cto-testing.md` | Coverage gaps, layer balance, assertion quality, missing negatives | `assess` |
| `cto-infrastructure.md` | Connection pooling, caching, background jobs, production parity, secrets | `assess` |
| `cto-observability.md` | Error handling, logging quality, monitoring, debug context | `assess` |
| `cto-devex.md` | Onboarding, CI/CD, local development, documentation accuracy | `assess` |
| `cto-orchestrator.md` | Reads all nine specialist reports and produces one prioritized assessment | `assess` |

`assess` therefore dispatches ten personas: the nine specialists plus the orchestrator.

> **Known limitation.** `agents/planner.md` is listed in the harness persona roster but no skill
> dispatches it. Grep hits are either the substring `remediation-planner` or the prose "the planner",
> and the `plan` skill uses a generic plan agent rather than this file. Treating it as an active
> persona means describing dead code. Tracked in
> [#1018](https://github.com/jstoup111/ai-conductor/issues/1018).

## Known limitations

The frontmatter is not always the truth. Where a skill's declared `enforcement` disagrees with its
engine step definition, **the engine wins** — `isGatingStep` and `canSkipStep` read the step
definition, never the SKILL.md.

> **Known limitation.** Six skills' `enforcement:` frontmatter disagrees with the engine's step
> definition. A reader who trusts the frontmatter will predict the wrong skippability.
>
> | Skill | SKILL.md `enforcement` | Engine step enforcement |
> | --- | --- | --- |
> | `memory` | `gating` | `advisory` |
> | `assess` | `gating` | `advisory` |
> | `architecture-diagram` | `gating` | `advisory` |
> | `architecture-review` | `gating` | `advisory` (the DECIDE step) |
> | `remediate` | `gating` | `advisory` |
> | `rebase` | `advisory` | `structural` |
>
> The sharpest case is `architecture-review`: the SKILL.md declares a HARD GATE — no feature proceeds
> past it with DRAFT ADRs — but the DECIDE-phase step is `advisory`, so `canSkipStep('architecture_review')`
> returns `true`. The real enforcement for that half lives in the land-time spec gate and in `conduct`'s
> DRAFT-ADR block, not in the step's enforcement level. The as-built half at index 18 is genuinely
> `gating` and fail-closed. Tracked in
> [#1018](https://github.com/jstoup111/ai-conductor/issues/1018).

> **Known limitation.** `manual-test/SKILL.md` declares `requires: [finish, verify-claims]` and its
> description says "Use after /finish". The engine runs `manual_test` at index 16 with prerequisite
> `test_suite`, and `finish` at index 21 with prerequisite `rebase`. `finish` is not a prerequisite of
> `manual_test` in any code path — the declared dependency is inverted relative to execution order.
> Follow the engine order. Tracked in
> [#1018](https://github.com/jstoup111/ai-conductor/issues/1018).

> **Known limitation.** `conduct/SKILL.md`'s tier table claims that tier S skips `pipeline` ("use direct
> /tdd") and `code-review` ("domain review in TDD suffices"). Neither is implemented. `build` declares
> `skippableForTiers: []` and is `structural`, so it can be neither tier-skipped nor config-disabled;
> `code-review` is not an engine step at all, and the engine's separate `build_review` step is likewise
> never tier-skipped. The same file's "Small flow" summary also omits `complexity`, `worktree`,
> `build_review`, `wiring_check`, `test_suite`, and `rebase`, all of which run at tier S. The
> authoritative tier-S skip set is the 8 steps listed in [steps](steps.md). Tracked in
> [#1018](https://github.com/jstoup111/ai-conductor/issues/1018).

## Related pages

- [steps](steps.md) — step order, enforcement, tier and track skips, gate behavior.
- [models](models.md) — how a `model:` pin resolves against engine defaults.
- [artifacts](artifacts.md) — every artifact and state file these skills read and write.
- [gates](../explanation/gates.md) — what a gate is and why it fails closed.
- [extending](../contributing/extending.md) — adding a skill, step, gate, or hook.
