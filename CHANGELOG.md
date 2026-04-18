# Changelog

All notable changes to this harness are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Release cadence: tags `vX.Y.Z` are cut automatically by CI on merge to `main`
(see `.github/workflows/release.yml`). Every PR must add an entry under
`## [Unreleased]

## [0.4.0] - 2026-04-12

## [0.3.0] - 2026-04-11` before merge — CI fails the release workflow if the block is
empty.

Categories:

- **Added** — new skills, hooks, gates, or capabilities.
- **Changed** — behavioral changes to existing skills, hooks, or CLI.
- **Fixed** — bug fixes, typo corrections, non-behavioral cleanup.
- **Removed** — skills, hooks, or flags that no longer exist.
- **Migration** — runnable steps needed when upgrading. Use a
  ` ```bash migration ` fenced block for commands `bin/migrate` should execute.

---

## [Unreleased]

### Added

- TypeScript conductor rewrite (`src/conductor/`) — 3-layer architecture (Engine/Execution/UI) replacing the 3,100-line bash `bin/conduct`.
- `bin/conduct-ts` shell wrapper for the TypeScript conductor.
- 14-step state machine with typed events, gate enforcement, tier-based skipping, checkpoint handling, backward navigation, and recovery flow.
- LLM provider abstraction with Claude CLI adapter, session management, and rate limit handling.
- ink-based terminal UI: dashboard, checkpoint prompts, recovery menus, navigation menus.
- CLI entry point with commander: `--resume`, `--auto`, `--status`, `--from`, `--step`, `--reset`, `--cleanup`, `--output` flags.
- Worktree management: slugify, create, scan, cleanup with collision handling.
- 310 tests across 21 test files + 4 integration tests.
- Architecture diagrams (C4 levels 1-3) and architecture review for conductor rewrite.
- Phase 2 language evaluation choosing TypeScript over Python/Rust/Go.
- User validation checkpoints after build and manual-test steps in conductor.
- Backward navigation (`b = go back`) from checkpoints and recovery menu with numbered step menu.
- `stale` state marking (⚠) for downstream steps when revisiting earlier phases.
- `step_satisfied()` gate function — stale steps pass prerequisite checks but re-run when reached.
- Story catalog: 5 product epics and 36 feature stories specifying all harness behavior as Given/When/Then acceptance criteria.
- Design doc for pluggable harness architecture (phased rewrite: stories -> language eval -> conductor rewrite -> skill overrides -> UI abstraction).
- Implementation plan for Phase 1 (story catalog review and acceptance).
- Semver tagging system with CI-driven releases on merge to `main`.

### Changed

- `run_manual_test()` now runs in print mode (automated) instead of interactive mode; harness checkpoint provides user review.
- `run_acceptance_specs()` now runs in print mode (automated) instead of interactive mode.
- Recovery menu expanded from `r/i/s/q` to `r/i/b/s/q` with backward navigation option.
- CLAUDE.md now requires Claude to present VERSION bump for user approval before creating a PR.
- `VERSION` and `CHANGELOG.md` as the source of truth for release cadence.
- `.github/workflows/release.yml` — auto-tag, rewrite changelog, bump version,
  create GitHub Release on every merge to `main`.
- `.github/pull_request_template.md` — scaffolds the Changelog + Migration
  sections for PRs against this repo. Does not affect consumer projects.
- `bin/migrate` — self-configuring migration runner that reads the current
  version from `~/.claude/ai-conductor.config.json`, re-runs
  `bin/install --update`, and executes any `## Migration` bash blocks from the
  changelog entries between the old and new version.
- `bin/install --update` — idempotent refresh path that skips the first-run
  dependency bootstrap and the channel-selection prompt.
- `~/.claude/ai-conductor.config.json` — user-facing config for the update
  channel (`tagged` vs `main`), current version, and auto-check preference.
- `conduct --set-channel {tagged|main}` — switch update channels without
  re-running install.
- Conductor-TS UI abstractions: `UISubscriber`, `UIEventHandler`,
  `DashboardSnapshot`, `RenderPayload`, and `UIPromptHost` in
  `src/conductor/src/ui/types.ts`; `TerminalPromptHost` reference
  implementation in `src/ui/terminal/prompt-host.ts`.
- `buildDashboardSnapshot(...)` pure builder split out from
  `renderDashboardLines`, enabling future non-terminal renderers to
  consume structured data instead of parsing strings.
- `chalk` + `ora` dependencies in `src/conductor/package.json`; colored
  dashboard output and an `ora` countdown spinner on `rate_limit` events.
- Current-step banner (step label + HH:MM:SS start time) on the dashboard
  and a post-step `lastStepTail` pane showing the last N lines of the
  previous step's captured stdout.
- `--view full|focus|log` and `--tail-lines <n>` flags on `bin/conduct-ts`.
- Optional `tail?: string[]` field on `step_completed` events (last 200
  lines of captured output; backwards-compatible additive).

### Changed

- `check_harness_update()` in `bin/conduct` is channel-aware: on the `tagged`
  channel it checks for the latest `vX.Y.Z` git tag, renders the changelog
  block via `glow` before prompting, and calls `bin/migrate` on approval.
- `HARNESS.md` now documents the update flow in a new "Harness Updates" section.
- `CLAUDE.md` (harness-repo-level) documents the new release and update gates.
- Conductor-TS readline prompts (checkpoint, recovery, artifact review,
  complexity, navigation) consolidated behind `TerminalPromptHost` instead
  of being scattered top-level functions in `src/conductor/src/index.ts`.
  `ConductorOptions` shape is unchanged — the engine contract is stable.
- `renderDashboardLines` now delegates through the snapshot builder +
  `formatDashboardSnapshot` formatter. Public signature preserved; string
  output is identical apart from additive color on TTY.
- Dashboard step-started transient line shows the step's display label
  (e.g. `Brainstorm`) instead of the raw step name (`brainstorm`).

### Migration

No migration steps required when upgrading from 0.3.0 — the new update flow
takes effect on the next `conduct` run after this release is installed.

### Fixed

- Feature-level state (manual-test, retro, etc.) no longer bleeds across features in root state file; project-level steps (bootstrap, assess) persist correctly.
- Task progress counter shows correct total from the start (0/10, 1/10) instead of growing denominator (1/1, 2/2).
- `bin/conduct-ts` autonomous Claude invocations no longer print
  `Warning: no stdin data received in 3s, proceeding without it.` — the
  provider now passes `stdin: 'ignore'` to execa on the print-mode path.
- Conductor auto-heals `.pipeline/task-status.json` drift before
  re-invoking the build step. When the completion gate fails with
  "tasks not completed", the engine reconciles each pending task against
  the current branch's git log (commit-message + touched-file match); any
  task with unambiguous prior-run evidence is flipped to "completed"
  in-place and the gate re-checks without a Claude retry. Audit trail
  under `.pipeline/audit-trail/autoheal-*.json`. Runs once per session
  per step; scoped to `build`; silently skips when git is absent.
  Additive `auto_heal` event on `ConductorEvent` for UI visibility.

### Removed

- Dead Ink/React terminal components and their tests
  (`src/conductor/src/ui/terminal/*.tsx`,
  `src/conductor/test/ui/terminal/*.test.tsx`) — superseded by the
  text-based live-region renderer.
- `ink`, `react`, `ink-testing-library` dependencies from
  `src/conductor/package.json` (`react` peerDeps removed too); the
  `"jsx": "react-jsx"` compiler option is dropped from
  `src/conductor/tsconfig.json`.

---

## [0.3.0] - 2026-04-11

Retroactive entry capturing the state of the harness at the point the
versioned release flow was introduced.

### Added

- Full SDLC skill suite: bootstrap, brainstorm, stories, plan,
  architecture-diagram, architecture-review, writing-system-tests, tdd,
  pipeline, code-review, simplify, debugging, manual-test, finish, pr, retro,
  conduct, assess, conflict-check, memory.
- `bin/conduct` orchestrator with phase detection and gate enforcement.
- `bin/install` with symlink-based skill installation, settings.json
  permission/hook wiring, and dependency bootstrap (glow, rtk, puppeteer MCP).
- Hook suite under `hooks/claude/` for destructive-git blocking, TDD commit
  gating, lint-after-edit, spec/diagram coverage, rate-limit handling, session
  start context loading, and stop-memory reminders.
- `test/test_harness_integrity.sh` validation suite covering bash syntax,
  SKILL.md frontmatter, agent references, cross-skill references, HARNESS.md
  model table, template references, and section numbering.
- `HARNESS.md` as the single source of truth for project-facing behavioral
  rules, consumed by every project using the harness.
