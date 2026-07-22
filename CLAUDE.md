# James Stoup Agents — Custom Development Harness

A personal suite of skills and agent personas for AI-assisted software development.
Built on Claude Code as the execution engine — no custom runtime, pure Markdown.

## Behavioral Rules

All behavioral rules for projects using this harness — SDLC phases, model selection,
communication protocol, enforcement levels, and conventions — are defined in:

**[HARNESS.md](HARNESS.md)**

Claude MUST read and follow HARNESS.md at the start of every session.

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

## Daemon Operations Safety (Operator / Claude)

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

## Validation Rules (This Repo)

**Every change to this harness repo MUST be validated before committing.** This is not optional.
Run the full validation suite and fix any failures before `git commit`.

### Validation Suite

Run `test/test_harness_integrity.sh` — it checks all of the following:

1. **Bash syntax** — All scripts in `bin/`, `hooks/claude/`, and `test/` pass `bash -n`.
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
- Claude MUST run validation automatically — do not ask, do not skip

### Failure Handling

If validation fails, fix the issue before committing. Do not commit with known validation
failures. If a check is failing due to a legitimate structural change (e.g., renaming a skill),
fix all references before committing.

## Documentation Upkeep

Docs track features. Every change that adds or alters user-facing behavior MUST
update the relevant documentation in the **same** PR:

- New `conduct`/`conduct-ts` flags or daemon options → update `README.md` and
  `src/conductor/README.md`.
- New skill, gate, hook, or HARNESS.md rule → reflect it in the README and the
  relevant skill/architecture docs.
- A PR is not complete while its docs are stale. This is in addition to the
  CHANGELOG `[Unreleased]` requirement, not a replacement for it.

This mirrors the harness-wide "Docs track features" convention in HARNESS.md that
applies to consumer projects.

## Branch Policy

All work MUST happen on a feature branch — never commit directly to main.
Create a branch before making changes, and open a PR to merge.

## Release & Update Gates

The harness uses a semver tagging system and an auto-update flow. Every change
to this repo must honor these gates:

1. **Changelog on every PR.** Every PR to `main` MUST add an entry under
   `## [Unreleased]` in `CHANGELOG.md` under one of: Added / Changed / Fixed /
   Removed. The `.github/pull_request_template.md` scaffolds the required
   sections. **CI enforces this** — `.github/workflows/release.yml` fails the
   release workflow post-merge if `[Unreleased]` is empty. This rule applies
   to the harness repo only. It does NOT change how Claude opens PRs in
   consumer projects that use the harness.

2. **Migration blocks for breaking changes.** Any PR that changes
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

   **Before creating a PR**, Claude MUST present the proposed VERSION bump to
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
- This CLAUDE.md describes the harness repo itself; HARNESS.md describes rules for projects
- `hooks/claude/session-start-context.sh` detects when a consumer CLAUDE.md is missing the HARNESS.md reference and prints the required block; consumers must add it manually (not auto-applied)
