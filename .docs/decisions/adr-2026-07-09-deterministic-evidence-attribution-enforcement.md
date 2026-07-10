# ADR: Deterministic evidence attribution — engine-owned task transitions + worktree-local git hooks

Status: APPROVED
Date: 2026-07-09
Feature: deterministic-evidence-attribution (#433)
Related: adr-2026-07-07 evidence-gate id grammar (#417/#418); #302 engine-owned task status;
#426/#427 path corroboration (engine-side determinism precedent)

## Context

Build agents complete work but fumble `Task:` trailer attribution, producing false evidence-gate
halts that cost operator interventions (#433 cases 1–3: subject-only task names, wrong empty-commit
form, multi-task bundling). The #418 grammar lives in skill prose; prompt discipline drifts over
long builds. The harness design principle (CLAUDE.md) requires machinery that stamps/validates at
the moment of the mistake.

Constraint discovered during explore (verified): the TS engine does not dispatch per-task — the
build step is one `/pipeline` session whose orchestrator agent marks tasks `in_progress` in
`.pipeline/task-status.json` (SKILL.md step 0) and dispatches per-task subagents. Any "engine
stamp" must therefore be an engine-owned CLI invoked at that step, not a dispatch-time write.

## Decision

1. **Engine-owned task transitions.** New `conduct-ts task start <id>` / `conduct-ts task done <id>`:
   validates `<id>` against the engine-seeded id set in `task-status.json` (task-seed.ts, #302),
   performs the status transition atomically (temp+rename, same discipline as task-evidence.ts),
   and stamps (`start`) / clears (`done`) `.pipeline/current-task` (plain-text single id).
   `skills/pipeline/SKILL.md` step 0 replaces its hand-edit of `task-status.json` with this call.
   The engine also clears any stale `current-task` at build-step entry (seed time).

2. **Worktree-local git hooks, copied at provisioning.** Two pure-bash hooks, shipped as assets of
   the installed engine package and **copied by `prepareWorktree` into the build worktree**
   (worktree-local, gitignored dir, e.g. `.pipeline/git-hooks/`), wired via
   `git config extensions.worktreeConfig true` + `git config --worktree core.hooksPath <abs path>`:
   - `prepare-commit-msg` — if the message has no `Task:` trailer, append `Task: <id>` via
     `git interpret-trailers --in-place`; id source is `.pipeline/current-task`, falling back to a
     *unique* `in_progress` row in `task-status.json`; **abstains** when neither yields exactly one
     id, when amending (`$2 = commit`), or when a rebase is in progress
     (`test -d "$(git rev-parse --git-path rebase-merge)"` — never trust the path's mere printout).
   - `commit-msg` — rejects (exit 1, instructive message) a `Task:` trailer id outside the seeded
     id set (kills the #417 `task-N`/unknown-id class at commit time) and an **empty** commit
     (`git diff --cached --quiet HEAD`) lacking `Evidence: satisfied-by <sha>`; **warns only** on
     plausible multi-task bundling (inherently non-mechanical, per #433).
   - Both hooks **chain** to the repo's own common hooks (`$GIT_COMMON_DIR/hooks/<name>`) when
     present and executable, so consumer-repo hooks (husky etc.) keep working under the override.

3. **The evidence gate stays the sole completion authority.** `deriveCompletion`/`artifacts.ts`
   are unchanged. Hooks convert silent drift into instant feedback; they are not a second gate.

## Why worktree-local copies (not a reference into the harness checkout)

- Consumer project worktrees do not contain harness files; the daemon builds consumer repos too.
- Referencing the harness checkout couples every in-flight worktree to its live state
  (#363 install-from-worktree class of dangling references).
- A copy is frozen at provisioning — a feature branch cannot self-modify its own enforcement,
  and the hooks deliberately shell out to **no engine dist**, so they cannot run stale engine
  code (#403 class). Node is used only for stdlib JSON parsing of `task-status.json`
  (node is a hard prerequisite of conduct-ts everywhere the daemon runs).

## Fail-open guard

If `git config --worktree` is unsupported (git < 2.20) or hook copy fails, `prepareWorktree` logs
and continues WITHOUT hooks — attribution degrades to today's prompt discipline; the evidence gate
still arbitrates. Enforcement machinery must never block provisioning.

## Evidence (verified 2026-07-09, scratch-repo end-to-end)

- `extensions.worktreeConfig` + `git config --worktree core.hooksPath` is worktree-scoped; the
  primary checkout's config remains unset (git 2.34.1).
- Hooks under `core.hooksPath` fire on commit; `interpret-trailers` appends `Task: 7` to an
  untrailered message; bare-trailer empty commit rejected; `Evidence: satisfied-by <sha>` empty
  commit accepted; unknown id rejected with the valid-id list.

## Consequences

- Case 1 (missing trailers) is eliminated for single-task dispatches; Case 2 (wrong empty-commit
  form) becomes an immediate agent-visible failure; Case 3 (bundling) is surfaced at commit time
  but remains warn-only. `--no-verify` bypass remains possible — the gate is unchanged as backstop,
  and the pipeline/tdd SKILLs forbid it.
- New consumer-visible surfaces: `conduct-ts task` subcommand (additive, MINOR) and per-worktree
  hook wiring set by the engine (no consumer manual action; release-gate classifier may flag the
  `hook wiring` surface — the PR needs a migration block or an internal-only waiver per
  adr-2026-07-06-migration-gate-waiver, decided at build time from the actual diff).
- `skills/pipeline/SKILL.md` step 0 contract changes from "edit task-status.json" to "run
  `conduct-ts task start <id>`" — a forgotten call is self-announcing (task never `in_progress`
  trips the existing forward-progress check).
