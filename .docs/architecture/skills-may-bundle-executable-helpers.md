# Components: Skills may bundle executable helpers

**Last updated:** 2026-09-28
**Scope:** Where a shipped skill's executable helper lives, how the skill invokes it from any repository, how the helper locates the harness engine (installed, sandboxed, and self-host provider-home layouts), and which repository gates cover bundled helpers (issue #742). First case: `intake-file`.

## Diagram

```mermaid
graph TD
    subgraph CATALOG["Shipped skill catalog (harness checkout)"]
        SKILL["skills/intake/SKILL.md<br/>invokes the helper by its own skill-directory path"]
        HELPER["skills/intake/scripts/intake-file<br/>bash wrapper, executable"]
    end

    subgraph INSTALL["Skill discovery homes (unchanged install)"]
        CLAUDE_HOME["~/.claude/skills/intake<br/>whole-directory symlink"]
        AGENTS_HOME["~/.agents/skills/intake<br/>whole-directory symlink (Codex)"]
        SELFHOST["self-host provider home under the worktree<br/>one-time COPY of skills/"]
    end

    subgraph HOST["Host agent session (cwd = caller repository)"]
        BASEDIR["Skill base directory<br/>Claude: injected base directory<br/>Codex: SKILL.md path"]
    end

    subgraph RESOLVE["Harness-root resolution inside the helper"]
        PHYS["readlink -f own path, walk ancestors<br/>nearest dir with engine entry point AND installed tsx"]
        FALLBACK["fallback: readlink -f of ai-conductor on PATH<br/>same qualification check"]
        FAIL["named error, non-zero exit<br/>never files from a guessed root"]
    end

    subgraph ENGINE["Harness engine (unchanged)"]
        CLI["src/conductor/src/intake-file-cli.ts<br/>run with the engine's tsx, caller cwd preserved"]
        FILE["fileIntakeIssue<br/>files into the caller's repository"]
    end

    subgraph GATES["Repository gates (extended)"]
        LINT["test/lint_shell.sh<br/>enumerates skills/*/scripts/*"]
        SYNTAX["test_harness_integrity.sh section 1<br/>bash -n via lint_shell --list"]
        AUDIT["GitHub boundary audit<br/>already scans extensionless skill files"]
        INTERP["interpreter-source check<br/>inventory includes skills/*/scripts/"]
    end

    SKILL --> CLAUDE_HOME
    SKILL --> AGENTS_HOME
    SKILL --> SELFHOST
    CLAUDE_HOME --> BASEDIR
    AGENTS_HOME --> BASEDIR
    SELFHOST --> BASEDIR
    BASEDIR -- "runs «base dir»/scripts/intake-file" --> HELPER
    HELPER --> PHYS
    PHYS -- "engine found" --> CLI
    PHYS -- "engine absent" --> FALLBACK
    FALLBACK -- "engine found" --> CLI
    FALLBACK -- "engine absent" --> FAIL
    CLI --> FILE

    HELPER -. "covered by" .-> LINT
    HELPER -. "covered by" .-> SYNTAX
    HELPER -. "covered by" .-> AUDIT
    HELPER -. "covered by" .-> INTERP
```

## Responsibilities and boundaries

- **The skill owns its helper's path.** SKILL.md never names a path relative to the working
  directory; it names the helper relative to the skill directory the host reports, so the same text
  works from the harness checkout and from a consumer repository.
- **The helper owns engine location, not filing logic.** It is a thin wrapper: resolve the harness
  root, then exec the existing TypeScript CLI. All filing behaviour stays in `fileIntakeIssue`,
  inside existing tsc, ESLint, and Vitest coverage.
- **The caller's working directory is preserved.** The helper does not `cd` into the engine tree, so
  a filing without `--repo` targets the repository the operator is working in.
- **Install is unchanged.** Whole-directory symlinks already carry every file in a skill directory to
  both discovery homes; no `bin/install`, PATH, or `--check` change is made.
- **Self-host copies are expected.** The provider home copies `skills/` into scratch under the
  feature worktree, so the ancestor walk reaches the worktree (or, without installed dependencies, the
  root checkout above it). The `PATH` fallback covers copies not beneath a checkout, and a missing
  engine is a named failure rather than a guess.

## Legend

- Solid arrows: runtime invocation or resolution flow.
- Dotted arrows: validation coverage by repository gates.
- «base dir»: the skill directory path the host reports for the loaded skill.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-28 | Initial generation | Issue #742: skills may bundle executable helpers |
