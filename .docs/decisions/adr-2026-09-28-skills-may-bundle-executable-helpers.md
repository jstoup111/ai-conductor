# ADR: Shipped skills may bundle executable helpers

**Date:** 2026-09-28
**Status:** APPROVED (operator, 2026-09-28)
**Deciders:** James Stoup (operator), composer DECIDE for #742

## Context

The founding decision (`.docs/decisions/001-harness-architecture.md`) describes the harness as "a pure
Markdown skills + agent personas repository … No custom runtime", and every executable a skill calls
lives under `bin/` or the engine tree. Two defects followed from a skill naming a path it does not own.
Both were verified on main @ `7d7e6e88c`:

- `skills/intake/SKILL.md` §9 tells the agent to run `bin/intake-file`. For a while that wrapper existed
  only as `src/conductor/bin/intake-file`, until #743 added the repo-root copy. The old copy is still
  checked in, calls `fileIntakeIssue` with a dependency shape that no longer compiles, and is outside
  every tsconfig include list.
- `bin/intake-file` is a working-directory-relative path, so it does not resolve in a consumer
  repository. `bin/install` puts only `ai-conductor`, `conduct`, and `conduct-ts` on `PATH`. Even when
  the path is found, the wrapper runs `cd src/conductor` before exec, so a filing without `--repo`
  targets the harness repository instead of the caller's (`docs/guides/intake.md` documents this as
  "never on PATH … use the absolute path").

Facts about how skills reach hosts. All are verified by direct read except where marked:

- `bin/install` symlinks each whole `skills/<name>/` directory into `~/.claude/skills` and
  `~/.agents/skills`, with no filtering by file type. A file inside a skill directory is therefore
  reachable, exec bit included, from both hosts. This follows the one-catalog model in
  adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation (Option C). That ADR rejected
  *plugin packaging* (Option A), not files inside a skill directory. `test/test_codex_skill_installation.sh`
  already reads a non-SKILL file through the Codex symlink.
- Claude Code injects the loaded skill's base directory into the session. Codex lists each file-backed
  skill with the host path of its `SKILL.md`. Codex's own sample skills run bundled scripts by resolving
  `<skill-dir>` to the installed skill directory (upstream `openai/codex` catalog prompt and samples,
  via Context7; ~90%, documented).
- The self-host provider home (`src/conductor/src/engine/self-host/provider-home.ts`) **copies**
  `skills/` into a throwaway home, and its comment calls the asset "markdown-only". So does the
  accepted trade-off in adr-2026-08-04-live-tier-provisions-its-own-provider-home, which this decision
  overtakes. The throwaway home lives under the feature worktree
  (`«worktree»/.daemon/scratch/«runId»/«attempt»-«provider»/`, per
  adr-2026-08-09-worktree-local-provider-scratch). A helper that assumes a fixed depth from its own
  path therefore misses the worktree's engine, but that engine is one of the copy's ancestors. The copy
  preserves the mode bits (Node's recursive copy preserves the 0755 mode; checked locally).
- No gate covers files under `skills/` other than `SKILL.md`. `test/lint_shell.sh` enumerates `bin/`,
  `hooks/`, `test/`, and `.github/scripts/` only, and integrity check 1 takes its file list from it. tsc,
  ESLint, and Vitest cover only the engine tree. The GitHub boundary audit already scans extensionless
  files under `skills/` in full.

## Options Considered

### Option A: Bundle, invoked by skill-directory path (chosen)

The helper lives inside its skill directory, and the skill names it relative to the directory the host
reports. Install, `PATH`, and `--check` are unchanged.

### Option B: Bundle, and have `bin/install` link each helper onto `PATH`

A host-neutral name that survives the self-host copy. Rejected: it changes `bin/install`, which is the
"skill symlink targets" breaking surface and needs a migration block. It also grows install and
`--check` machinery for every future helper.

### Option C: `bin/` stays canonical

Keep executables in `bin/` and add the missing wrapper. Rejected by the operator. Co-location matches
the host skill format, and both defects above come from a skill naming a path owned elsewhere.

## Decision

Option A.

1. **A shipped skill may bundle executable helpers under `skills/<name>/scripts/`.** The shipped
   catalog stays the single canonical skill source, per decision 1 of
   adr-2026-07-25-first-class-codex-skill-and-guidance-adaptation. This is not a plugin package, and no per-host tree is generated. A helper is an executable
   file with a `bash` or `sh` shebang and no filename extension. Existing `bin/` executables are not required to
   move.
2. **A bundled helper is a thin wrapper; behaviour stays in the engine tree.** A helper only resolves
   the harness root and execs an entry point under `src/conductor/src/`. Filing, parsing, and GitHub
   operations stay in TypeScript, which is covered by the existing tsc, ESLint, and Vitest
   configuration. A helper does not reimplement engine logic in shell.
3. **A skill invokes its helper by skill-directory path, never by working-directory path.** `SKILL.md`
   names the helper as `<this skill's directory>/scripts/<helper>`: Claude's injected base directory,
   or the directory of the `SKILL.md` path Codex lists. Skill text never names a working-directory
   path such as `bin/<helper>` for a harness executable. Installation and `PATH` are unchanged.
4. **A helper resolves the harness root deterministically and never guesses.** A directory qualifies as
   a harness root only if it contains both the target engine entry point under `src/conductor/src/`
   and the engine's installed `tsx` executable under `src/conductor/node_modules/.bin/`. The helper
   resolves its own path physically (`readlink -f`), then walks up its ancestors and takes the nearest
   directory that qualifies. From an installed skill, the nearest one is the harness checkout the
   symlink points at. From a self-host provider-home copy, it is the feature worktree when that worktree
   has installed dependencies, and otherwise the next qualifying ancestor. If no ancestor qualifies, the
   helper resolves `ai-conductor` found on `PATH` physically and checks the directory one level above
   its `bin/` the same way. If neither yields a qualifying root, it exits non-zero with a message naming
   the path it walked from and the `PATH` result (or that no `ai-conductor` was found). It never runs
   from an unverified root.
5. **A helper preserves the caller's working directory.** It does not `cd` into the harness. It runs
   the engine's own `tsx` by absolute path with the engine's `tsconfig.json`, so a command without an
   explicit target repository acts on the repository the operator is working in.
6. **Bundled helpers are inside this repository's shell validation.** `test/lint_shell.sh` enumerates
   every file under `skills/*/scripts/` with a `bash` or `sh` shebang, so shellcheck and integrity
   check 1's `bash -n` cover them. The enumeration test pins that surface. The interpreter-source
   inventory (`src/conductor/scripts/check-interpreter-source.mts`) also includes `skills/*/scripts/`,
   so moving a shipped shell script out of `bin/` never drops it from that check.
7. **`intake-file` is the first migrated helper.** It moves to `skills/intake/scripts/intake-file`, and
   `bin/intake-file` is removed with no compatibility shim. Every reference is updated, including the
   dead `src/conductor/bin/intake-file` named in contributor docs. Deleting that directory is a
   separate follow-up removal feature, per this repository's two-feature deletion rule.

## Consequences

### Positive

- The intake skill works from any repository and files into the caller's repository by default.
- A skill and its helper travel as one unit through the existing whole-directory install on both
  hosts, so the split-path defect class behind #743 cannot recur for bundled helpers.
- Helper logic keeps full type and test coverage because it stays in the engine tree.

### Negative

- A helper now depends on the host reporting the skill directory. A host that does not report it
  cannot run bundled helpers. Both supported hosts report it today.
- Inside a self-host provider home whose worktree has no installed dependencies, the helper runs the
  nearest ancestor checkout's engine. That is normally the root checkout that holds `.worktrees/`, not
  the build worktree's engine.
- The ancestor walk means a helper copied anywhere beneath a harness checkout runs that checkout's
  engine. That is the intended reading of "the harness this skill came from".
- Operators who typed `bin/intake-file` by hand must use the skill path instead. No migration block
  is needed, because the release gate classifies only `bin/conduct` and `bin/install` as breaking `bin/`
  surfaces. The helper is authored as a new file, not a move, so git's rename detection does not pair
  it with `bin/intake-file`. A paired rename into `skills/` would read as the "skill symlink targets"
  surface.

### Follow-up Actions

- A removal feature deletes the unreferenced `src/conductor/bin/` directory.
- Other `bin/` helpers that exist only to serve one skill (for example `intake-backfill`) may migrate
  opportunistically under this decision.
