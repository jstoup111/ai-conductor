# Architecture Review: Skills may bundle executable helpers

**Date:** 2026-09-28
**Mode:** lightweight (Medium tier — §2 Feasibility and §4 Alignment only)
**Source:** `jstoup111/ai-conductor#742`
**Stories reviewed:** none yet. This is the pre-stories pass, and its input is the explore output in
`.docs/track/skills-may-bundle-executable-helpers.md` (technical track, balanced scope, Approach A).
**Verdict:** APPROVED WITH CONDITIONS

## Feasibility

**Stack compatibility.** No new package, service, or infrastructure. The helper is a bash wrapper, and
the engine entry point `src/conductor/src/intake-file-cli.ts` already exists and is unchanged. The
engine's `tsx` supports `--tsconfig <path>` (verified from `tsx --help`), so the helper can run the
engine entry point without changing the working directory.

**Prerequisites.** None. Install is unchanged. `bin/install` already symlinks whole skill directories
into both discovery homes, which carries the new `scripts/` directory and its exec bit (verified by
reading the install loop; ~95%).

**Integration surface.** Four areas: the `intake` skill, the shell-validation enumeration
(`test/lint_shell.sh` and its pinning test, which feed integrity check 1), contributor and reference
docs, and one stale comment in the self-host provider-home module. The GitHub boundary audit
(`github-invocation-audit.ts`) already scans extensionless files under `skills/`. The helper keeps the
current wrapper's content: resolve, then exec, with no literal `gh`/`git push` invocations. So the
audit covers the helper with no change.

**Self-host layout.** The provider home copies `skills/` into a scratch directory under the feature
worktree (adr-2026-08-09-worktree-local-provider-scratch), so the copied helper's ancestors include the
worktree and then the root checkout. The copy preserves mode 0755 (verified locally with Node's
recursive copy; ~90% that the production copy call behaves the same). ADR D4's ancestor walk finds the
nearest checkout that has both the engine entry point and its installed runner. The `PATH` fallback
covers any copy that is not beneath a checkout, and a missing engine fails with a named message rather
than a guess. The live tier runs in CI without `ai-conductor` on `PATH`, but it never files intake, so
the named failure there is unreachable in practice.

**Worktree isolation.** No ports, databases, queues, or shared state. The helper writes only what the
engine entry point already writes (`.pipeline/events.jsonl` in its working directory). With the
working directory preserved, that is now the caller's repository, not the harness's `src/conductor`.
This is intended: the event lands with the repository the filing concerned.

**Data implications / performance.** None.

**Calibration.** Code facts are verified by direct read (~95%). The host facts are from a direct
observation and a documentation source. Claude's base-directory injection was observed in this
session. Codex's `SKILL.md` path listing and its `<skill-dir>` script convention come from upstream
`openai/codex` sources via Context7 (~90%).

## Alignment

**Governing decisions applied.**

- `.docs/decisions/001-harness-architecture.md`, "pure Markdown skills … No custom runtime". This is
  the statement the change contradicts, so it receives an additive amendment note (the original text
  is kept). The engine had already overtaken the "no custom runtime" half, and the note records only
  the skill-directory change.
- adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation (APPROVED), D1 "keep one canonical
  skill source", which rejected plugin packaging. It is honoured: the helper lives inside the one
  shipped catalog, no plugin package or per-host tree is created, and both hosts reach it through the
  same whole-directory symlink.
- This repository's two-feature deletion rule (`CLAUDE.md` → "Skill Deletions Ship as Two Features").
  `src/conductor/bin/` contains only the dead `intake-file`, so deleting it would delete a directory
  of production files. This feature only dereferences it, and the directory's removal is a follow-up
  feature.
- The release gate (`release-gate.ts`) classifies only `bin/conduct` and `bin/install` as `bin/`
  breaking surfaces. A `skills/` path fires only on delete or rename, and this feature only adds under
  `skills/`. Removing `bin/intake-file` therefore needs no migration block or waiver (verified by read;
  ~90%, and the self-host release gate re-checks this mechanically at SHIP). One caveat: the gate
  reads `git diff --name-status`, which detects renames. A paired rename from `bin/intake-file` into
  `skills/` would fire the surface, so ADR D7 has the helper authored as a new file rather than moved.

**Scope placement (scope-check, Decision A).** The skill-authoring convention exists only in this
repository, because only this repository authors the shipped catalog. So the convention's
documentation goes to `ARCHITECTURE.md` and `docs/contributing/`, not `HARNESS.md`. The consumer-visible
effect is that `intake` now works from a consumer repository. That is a bug fix inside a shipped skill
and needs no consumer-facing rule.

**Pattern consistency.** Physical path resolution follows `bin/ai-conductor`, which runs
`readlink -f "$0"` before deriving the engine directory. Keep that trait: resolve through symlinks
first, then derive the root. Discovery hints: the `REAL_PATH`/`BIN_DIR` lines at the top of
`bin/ai-conductor`. Allowed variation: the helper walks up from `skills/<name>/scripts/` instead of
`bin/`, and adds the PATH fallback that `bin/ai-conductor` does not need.

**State management / security / DI defaults.** No state model, endpoint, credential, or DI registration
changes. The helper passes arguments through to the existing CLI unchanged, and input validation stays
in the TypeScript parser.

**Diagram accuracy.** `.docs/architecture/skills-may-bundle-executable-helpers.md` shows the catalog,
both discovery homes, the self-host copy, the resolution chain, and the gate coverage. It renders
(checked with `render-diagrams --check`).

## Wiring Surface

- `skills/intake/scripts/intake-file` (new executable) is invoked from `skills/intake/SKILL.md` §9 by
  skill-directory path. It execs the existing `src/conductor/src/intake-file-cli.ts`.
- The `skills/*/scripts/*` enumeration added to `test/lint_shell.sh` is consumed by `lint_shell.sh`'s
  own shellcheck run and by `test/test_harness_integrity.sh` check 1 (through `lint_shell.sh --list`).
  It is pinned by `test/test_lint_shell_enumeration.sh`.
- The `skills/*/scripts/` inventory added to `src/conductor/scripts/check-interpreter-source.mts` is
  consumed by the existing `test/check_interpreter_source.sh` gate.
- No new config key, event, CLI subcommand, hook, or scheduled job.

**Early overlap scan.** `ai-conductor overlap-scan` over the paths above plus the docs set: *no overlap
detected; no open blockers.*

## Risks

| Risk | Type | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| An agent ignores the skill-directory instruction and runs `bin/intake-file` from habit or stale docs | Knowledge | Medium | Low | Every `bin/intake-file` reference is removed; the missing path fails loudly |
| A host stops reporting the skill directory | Integration | Low | Medium | Both supported hosts report it today; ADR Negative consequence records the dependency |
| In a self-host copy whose worktree lacks installed dependencies, the helper runs the root checkout's engine instead of the worktree's | Technical | Low | Low | ADR D4 prefers the nearest qualifying ancestor; the filing path is not exercised by self-host builds |
| `tsx` without the engine working directory resolves modules differently | Technical | Low | Medium | Pass `--tsconfig` with the engine's config and invoke the engine's own `tsx` by absolute path; a helper test exercises resolution from a foreign working directory |

## ADRs Created

- `adr-2026-09-28-skills-may-bundle-executable-helpers` (D1–D7). It records a new structural decision
  about where shipped-skill executables live and who owns their resolution, and no `adr-*` decision
  covered it. `001-harness-architecture` receives an additive amendment note pointing to it.
  The intake asked for an ADR explicitly.

## Conditions

1. The ADR must be operator-APPROVED before stories.
2. Every `bin/intake-file` and `src/conductor/bin/intake-file` reference outside `.docs/` history
   (skills, docs, workflow comments, engine comments) is updated in this feature. The
   `src/conductor/bin/` directory itself stays on disk.
   The accepted `intake-only-enforcement` Story 2, which asserts the skill directs filing through
   `bin/intake-file`, is corrected in place by a companion main-based PR that merges with this spec.
3. The stale "markdown-only" comment in the self-host provider-home module is corrected. This is a
   comment-only change: the self-host copy is the reason for ADR D4's fallback, and leaving the comment
   false would mislead the next reader of that seam.
