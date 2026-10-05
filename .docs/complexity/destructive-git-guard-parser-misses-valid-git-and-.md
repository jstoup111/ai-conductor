# Complexity: destructive-git-guard-parser-misses-valid-git-and-

Tier: M

## Signals

| Signal | Assessment |
|---|---|
| New models / entities | One declarative per-subcommand git option spec (data, not a domain entity) |
| External integrations | git's parse-options grammar and `--git-completion-helper` output (drift test only) |
| Auth / permission surface | Yes — both destructive-git refusal guards change behavior (fail closed on unrecognized options) |
| State machines | None |
| Story count | ~6 (PATH guard normalization, Claude hook global options, Claude hook flag/refspec forms, fail-closed refusal, shared corpus, completion-helper drift) |
| Files touched | `src/conductor/src/engine/git-hook-assets.ts`, `hooks/claude/block-destructive-git.sh`, their tests, a shared corpus fixture |
| New runtime code | Bash option normalizer in the PATH guard asset; Python argv normalizer in the Claude hook |

## Rationale

Two existing guards in two languages change behavior on a security-relevant surface, and the
fail-closed policy is a design decision with false-refusal trade-offs that warrants a lightweight
architecture review and conflict check (the in-flight #2693 build also edits `git-hook-assets.ts`).
It adds no new subsystem, persistence, or cross-process protocol, so it is not Large.
