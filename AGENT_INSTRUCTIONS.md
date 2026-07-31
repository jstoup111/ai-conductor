# James Stoup Agents — Custom Development Harness

A personal suite of skills and agent personas for AI-assisted software development.
Originally built on Claude Code; the shared repository contract applies to every supported host.

## Behavioral Rules

All behavioral rules for projects using this harness — SDLC phases, model selection,
communication protocol, enforcement levels, and conventions — are defined in:

**[HARNESS.md](HARNESS.md)**

The active host agent MUST read and follow HARNESS.md at the start of every session.

## Design Principles

**Deterministic where possible; LLM only where necessary.** When designing any fix or
feature for this harness, first ask: can the engine, a git hook, a gate, or plain code
do this mechanically? Dispatch an LLM agent only for the parts that genuinely require
judgement (synthesis, code authoring, ambiguous resolution). Never rely on prompt
discipline for something machinery can enforce or compute — prompt-level rules drift
under long builds and cost operator interventions; deterministic enforcement is instant,
token-free, and fails at the point of violation. When an agent repeatedly violates a
rule, the fix is machinery that stamps/validates/rejects at the moment of the mistake —
not a stronger prompt. (Precedents: `build_review`'s completeness rubric derives build
completion from an LLM-judged plan-vs-diff comparison rather than trusting agent
self-reports or commit-trailer stamps — `Task:` trailers are telemetry only (#773); #426
fixed path matching engine-side; #433 replaces trailer discipline with engine-stamped
task ids and commit hooks.)

**Third-party calls are smoke-only in tests.** Unit tests inject mocked adapters. Acceptance,
integration, and end-to-end tests run the real internal flow with faithful fakes at every
third-party boundary. Only explicitly named, opt-in smoke tests may call real LLMs or other
external services; the default test suite and CI exclude them. `HARNESS.md` defines the full
test-isolation policy.

## Daemon Operations Safety (Operator / Agent)

When operating a running daemon — parking, cleaning up, resuming, or "finishing"
features — these rules are MANDATORY. Each encodes a failure that has already
happened and corrupted daemon state:

1. **Never bulk-delete worktrees or branches.** Do NOT `rm -rf` over a globbed or
   computed set (`for d in .worktrees/*`) and never loop-delete branches. Scope every
   destructive delete to an EXPLICIT, enumerated list of named paths; print the list and
   confirm it before deleting. Shell trap: `mapfile`/`readarray` are bash-only and
   silently do nothing under zsh — never guard a delete with an array you have not proven
   is populated. (A guard that came back empty once deleted all 74 worktrees instead of 4.)

2. **Park before you touch a feature's git state.** The daemon re-dispatches anything in
   its backlog and re-creates branches you delete, and its resume path re-kicks git errors
   with no backoff (#681). ALWAYS `conduct daemon park <slug>` BEFORE removing a feature's
   worktree or branch. Never unpark-then-delete — that guarantees a 128 `git worktree add`
   spin.

3. **The branch is the source of truth; a worktree checkout is disposable.** Removing
   `.worktrees/<slug>` loses the per-worktree `.pipeline/` state (task-status + the
   evidence sidecar), which then causes false `no_task_progress` stalls on already-committed
   work (#497). Recreate a worktree from its branch and recover the lost evidence — do not
   let the build redo finished tasks.

4. **A manual PR is NOT a harness finish.** Opening a PR by hand does not tell the daemon
   the work shipped, so it re-dispatches the feature forever (#438) and the only stopgap is
   parking — a leak, not a finish. The finish is `conduct shipped-record --slug <slug> --pr
   <url>`, which commits `.docs/shipped/<slug>.md` so the merge atomically records the ship
   and `daemon-backlog.ts` dedups it. If you complete work manually, you MUST also land its
   shipped-record.

Per this repo's own Design Principle, the durable fix for each of these is machinery
(a guarded delete wrapper, a park-state check, an evidence-backfill on worktree recreate,
a merge→shipped-record reconciler) — these prose rules are the interim guard until that
machinery exists.

## Harness Architecture

- **Skills** (`skills/`) — Each has a `SKILL.md` with YAML frontmatter. One skill, one responsibility.
- **Agents** (`agents/`) — Prompt templates defining *who* does the work.
- **Tech-Context** (`tech-context/`) — Stack-specific knowledge loaded by bootstrap.
- **Templates** (`templates/`) — Project scaffolding including `CLAUDE.md.template`.

### Scope Decisions

Before authoring any change to this repository, and before creating any new skill, the active host
agent MUST read and follow [`.agents/skills/scope-check/SKILL.md`](.agents/skills/scope-check/SKILL.md).
It settles three questions deterministically: whether the change is harness-repo-only or
consumer-facing (`AGENT_INSTRUCTIONS.md` versus `HARNESS.md`), whether a new skill belongs in the
shipped `skills/` catalog or this repository's local `.agents/skills/` one, and whether the change is
provider-agnostic. This is repository-local authoring guidance. For consumer projects, which have a
single skill catalog and no consumers of their own, the global harness authoring convention remains
unchanged.

## Validation Rules (This Repo)

**Every change to this harness repo MUST be validated before committing.** This is not optional.
Run the full validation suite and fix any failures before `git commit`.

### Test Authoring Rules

The active host agent adding, changing, reviewing, or debugging tests in this repository MUST
read and follow [`.agents/skills/write-tests/SKILL.md`](.agents/skills/write-tests/SKILL.md). This is
repository-local test-design guidance; it complements the provider-neutral `tdd` skill, which
controls implementation order.

### Validation Suite

Run `test/test_harness_integrity.sh`. The checks below are the ones you break most often; the script
actually runs 17 numbered and 2 unnumbered checks, several of which carry lettered
sub-checks (1b, 5a-5c, 9a-9c). The canonical enumeration — every check, what makes it
fail, and how to fix it — is [`docs/contributing/validation.md`](docs/contributing/validation.md).

1. **Bash syntax** — All scripts in `bin/`, `hooks/claude/`, and `test/` pass `bash -n`.
1b. **ShellCheck** — The same scripts pass `shellcheck --severity=error` via
   `test/lint_shell.sh`. Catches shell bugs that parse cleanly but misbehave at runtime.
2. **SKILL.md frontmatter** — Every `skills/*/SKILL.md` has YAML frontmatter with required
   fields: `name`, `description`, `enforcement`, `phase`.
3. **Agent references** — Every `agents/*.md` referenced in skills or HARNESS.md exists on disk.
4. **Cross-skill references** — Every `/skill-name` reference in SKILL.md files points to an
   existing `skills/` directory.
5. **HARNESS.md model table** — Every skill directory has an entry in the model selection table.
5a. **Table content drift** — The generated HARNESS.md model-selection-table section matches
    the output of `bin/generate-model-table` (source: `model-table-metadata.ts` +
    `resolved-config.ts`); regenerate and commit if it drifts.
5b. **SKILL.md pin agreement** — Every skill marked opus-tier in the model table pins
    `model: opus` in its SKILL.md frontmatter, and vice versa.
6. **Template references** — Every `templates/*.template` referenced in skills exists on disk.
7. **Section numbering** — No duplicate section numbers within a SKILL.md file.

### When to Validate

- **Before every commit** in this repo
- After editing any SKILL.md, agent, HARNESS.md, or bin/ script
- The active host agent MUST run validation automatically — do not ask, do not skip

### Failure Handling

If validation fails, fix the issue before committing. Do not commit with known validation
failures. If a check is failing due to a legitimate structural change (e.g., renaming a skill),
fix all references before committing.

## Documentation Upkeep

Docs track features. Every change that adds or alters user-facing behavior MUST
update the relevant documentation in the **same** PR:

- New `conduct-ts` flags → update `docs/reference/cli.md`; new config keys → `docs/reference/configuration.md`.
- New daemon options or operational behavior → update `docs/guides/running-the-daemon.md`, and the
  affected runbook under `docs/runbooks/` if it changes recovery.
- New skill → `docs/reference/skills.md`; new step → `docs/reference/steps.md`; new gate →
  `docs/explanation/gates.md`; new hook → `docs/reference/settings-and-hooks.md`; new HARNESS.md rule →
  the affected page in `docs/` (see `README.md`'s Documentation index).
- Ordinary reader-visible changes update the canonical affected documentation. Leave README unchanged unless the README landing-page contract changes.
- The README rule is a repository-local landing-page refinement of the global harness documentation convention.

A PR is not complete while its affected canonical documentation is stale. For consumer projects without this custom-step configuration, the global harness documentation convention remains unchanged.

## Branch Policy

All work MUST happen on a feature branch — never commit directly to main.
Create a branch before making changes, and open a PR to merge.

## Release & Update Gates

The harness uses a semver tagging system and an auto-update flow. Every change
to this repo must honor these gates:

1. **Changelog for notable implementations.** A changelog entry is required only when the PR contains a notable reader-visible implementation change. A non-notable implementation may ship without a changelog entry. Specification-only, documentation-only, internal non-notable, and no-implementation changes do not add an entry.

   An empty `[Unreleased]` is a successful no-release path with no changelog rewrite, no VERSION bump, no tag, no release commit, and no GitHub Release.

   This rule applies to this repository only. For consumer projects without this custom-step configuration, the global harness release convention remains unchanged.

2. **Migration blocks for breaking changes.** Breaking changes still require a runnable `bash migration` block. Any PR that changes
   `settings.json` schema, hook wiring, skill symlink targets, or `bin/conduct`
   CLI MUST include a `## Migration` section in `CHANGELOG.md` with a runnable
   ```` ```bash migration ```` fenced block. `bin/migrate` will execute these
   blocks (after user approval) when consumers update past this version.

   **Waiver (self-host builds only, adr-2026-07-06-migration-gate-waiver).**
   When the self-host release gate's path-based classifier flags a breaking
   surface but the actual edit is internal-only (e.g. deleting a private
   helper, no consumer-visible CLI/hook/schema change), a migration block is
   not the right fix — commit a waiver instead of inventing an empty one.
   Add a file under `.docs/release-waivers/<plan-stem>.md` in the SAME diff as:
   ```
   Waives: <comma-separated canonical surface names>

   Rationale: <non-empty prose — why this is internal-only>
   ```
   Canonical surface names are exactly: `bin/conduct CLI`, `skill symlink
   targets`, `hook wiring`, `settings.json schema` (must match
   `CANONICAL_BREAKING_SURFACES` in `release-gate.ts` verbatim — an unknown
   name is treated as malformed, never silently accepted). The waiver must
   list every touched surface (partial coverage HALTs naming the gap) and
   must be part of the `base...HEAD` diff — a waiver merged by a prior
   feature never satisfies a later one (fail-closed freshness). An
   undeterminable change set (null diff) can never be waived. Do NOT use a
   waiver when the edit changes actual CLI/hook/schema *behavior* — that
   always needs a real migration block.

3. **Releases are cut by CI on merge to main.** `.github/workflows/release.yml`
   reads `VERSION`, tags `vX.Y.Z`, rewrites the `[Unreleased]` block under
   `## [X.Y.Z] - <today>`, bumps `VERSION` to the next patch, and publishes a
   GitHub Release. There is no manual release script. Version bumps beyond
   patch happen by editing `VERSION` directly in the PR so reviewers can see
   the semver decision.

4. **Semver rules:**
   - **MAJOR** — breaking change to skill contracts, `bin/conduct` CLI, or
     `settings.json` schema.
   - **MINOR** — new skill, new hook, new gate, additive HARNESS.md rule.
   - **PATCH** — bug fix, wording, non-behavioral cleanup.

   **Before creating a PR**, the active host agent MUST present the proposed VERSION bump to
   the user for approval. State the current VERSION, the proposed new VERSION,
   and the semver justification (which rule applies). Do not edit VERSION or
   create the PR until the user confirms.

5. **Integrity checks apply to release artifacts too.**
   `test/test_harness_integrity.sh` validates: `VERSION` is valid semver,
   `CHANGELOG.md` has a `## [Unreleased]` section, and every `vX.Y.Z` tag has
   a matching `## [X.Y.Z]` section in `CHANGELOG.md`.

## HARNESS.md Flow

HARNESS.md is the single source of truth for behavioral rules consumed by projects using this harness.

- All behavioral changes (communication protocol, model selection, conventions) go in HARNESS.md
- This shared instruction file describes the harness repo itself; HARNESS.md describes rules for projects
- `hooks/claude/session-start-context.sh` detects when a consumer CLAUDE.md is missing the HARNESS.md reference and prints the required block; consumers must add it manually (not auto-applied)
