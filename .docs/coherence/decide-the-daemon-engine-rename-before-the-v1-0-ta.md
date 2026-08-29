# Coherence Mapping: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

Technical track (no PRD, so no `fr` rows). Outcomes are the eight bullets in the committed
intake marker, including the 2026-08-26/2026-08-28 operator amendments. Criterion quotes are
verbatim normalized substrings of cited plan-task bodies. Every criterion is decided by this
feature's own diff.

| Row class | Cited id / criterion | Counterpart / task id(s) | Verdict | Notes / verbatim quote | Disposition |
|---|---|---|---|---|---|
| outcome | outcome-1 | story-1, story-2, story-3 | covered | The rewritten APPROVED ADR resolves the vocabulary question; the stories implement the selected decision. |
| outcome | outcome-2 | story-1, story-2, story-3, story-4 | covered | The scope is enumerated (compose verb, composer skill, ai-conductor binary, internal repoint) and ships in the v1.0 major ahead of cutover PR #226. |
| outcome | outcome-3 | story-1 | covered | Conditional branch not taken: the approved ADR selected rename rather than re-defer. |
| outcome | outcome-4 | story-1, story-2, story-3, story-4 | covered | The decision is bound to this pre-v1 implementation spec and closes the originating decision question. |
| outcome | outcome-5 | story-1, story-2, story-3, story-4 | covered | The replacement stories and plan build the rename rather than a later scoping-only feature. |
| outcome | outcome-6 | story-1, story-3 | covered | `compose`/`composer` are canonical for the idea→spec loop with `engineer` a warning alias; `daemon` stays canonical per the 2026-08-28 reversal. |
| outcome | outcome-7 | story-2, story-4 | covered | `ai-conductor` is the canonical binary with `conduct-ts` a warning alias; config keys and `.daemon/` state are untouched by every story. |
| outcome | outcome-8 | story-1, story-2, story-3, story-4 | covered | All four stories are functional behavior; upkeep is not represented as a story or standalone task. |
| story | story-1 | task-1, task-2, task-3 | covered | Tasks 1–3 cite Story 1 and implement the compose verb boundary. |
| story | story-2 | task-4, task-5 | covered | Tasks 4–5 cite Story 2 and implement the binary alias and installer behavior. |
| story | story-3 | task-6, task-7, task-8 | covered | Tasks 6–8 cite Story 3 and implement the skill catalog change. |
| story | story-4 | task-9, task-10, task-11, task-12, task-13, task-14, task-15, task-16, task-17, task-18 | covered | Tasks 9–18 cite Story 4 and implement the repoint, its entry-point docs, the composer prompt, the fail-closed guard, and the pre-reinstall launcher resolution. |
| task | task-1 | story-1 | covered | Task 1 explicitly cites Story 1. |
| task | task-2 | story-1 | covered | Task 2 explicitly cites Story 1. |
| task | task-3 | story-1 | covered | Task 3 explicitly cites Story 1. |
| task | task-4 | story-2 | covered | Task 4 explicitly cites Story 2. |
| task | task-5 | story-2 | covered | Task 5 explicitly cites Story 2. |
| task | task-6 | story-3 | covered | Task 6 explicitly cites Story 3. |
| task | task-7 | story-3 | covered | Task 7 explicitly cites Story 3. |
| task | task-8 | story-3 | covered | Task 8 explicitly cites Story 3. |
| task | task-9 | story-4 | covered | Task 9 explicitly cites Story 4. |
| task | task-10 | story-4 | covered | Task 10 explicitly cites Story 4. |
| task | task-11 | story-4 | covered | Task 11 explicitly cites Story 4. |
| task | task-12 | story-4 | covered | Task 12 explicitly cites Story 4. |
| task | task-13 | story-4 | covered | Task 13 explicitly cites Story 4; makes the S4.3 guard fail-closed and widens its scanned set. |
| task | task-14 | story-4 | covered | Task 14 explicitly cites Story 4; repoints the harness-internal config read and the operator entry-point docs. |
| task | task-15 | story-4 | covered | Task 15 explicitly cites Story 4; makes the canonical verb open the composer prompt. |
| task | task-16 | story-4 | covered | Task 16 explicitly cites Story 4; delivers the two reference pages the Documentation Upkeep rule requires. |
| task | task-17 | story-4 | covered | Task 17 explicitly cites Story 4; delivers the S4 pre-reinstall negative path via one canonical-launcher resolver per language. |
| task | task-18 | story-4 | covered | Task 18 explicitly cites Story 4; repoints the installer's own executions and widens the guard's scanned set to `bin/`. |
| adr | adr-2026-08-26-music-vocabulary-player-composer-rename | story-1, story-2, story-3, story-4 | covered | All stories implement the ADR as rewritten 2026-08-28 (daemon stays; composer boundary; ai-conductor binary). |
| criterion | Story 1 happy: Given the built CLI, when I run `<binary> compose projects`, then it prints the same registry JSON and exit code as `<binary> engineer projects` does today, with no deprecation warning | task-1, task-2 | covered | zero under `compose`, byte-identical stdout | diff-local |
| criterion | Story 1 happy: Given the built CLI, when I run any existing engineer subcommand (`claim`, `worktree`, `land`, `handoff`, `projects`) under `compose` with its current flags, then it reaches the same typed dispatch and produces the same stdout contract as under `engineer` | task-1 | covered | yields identical typed descriptors under both verbs | diff-local |
| criterion | Story 1 happy: Given the built CLI, when I run `<binary> compose <sub> --help`, then the help text for that subcommand is shown and exits 0 | task-3 | covered | `compose <sub> --help` resolves the same help topic as `engineer <sub> --help` | diff-local |
| criterion | Story 1 negative: Given the built CLI, when I run `<binary> engineer projects`, then the command still succeeds with identical stdout JSON, and exactly one deprecation warning line naming `compose` is written to stderr (never stdout, so JSON consumers are unaffected) | task-2 | covered | one warning line under `engineer` | diff-local |
| criterion | Story 1 negative: Given the built CLI, when I run `<binary> compose` with an unknown subcommand or unknown flag, then it is rejected with the same non-zero exit and error shape as the equivalent `engineer` invocation | task-1 | covered | unknown-flag/unknown-subcommand case yields identical typed descriptors | diff-local |
| criterion | Story 1 negative: Given the built CLI, when I run `<binary> compose` bare, then it launches the same interactive host-agent loop path as bare `engineer` (no second implementation, no divergent behavior) | task-1 | covered | every subcommand, bare launch, help | diff-local |
| criterion | Story 2 happy: Given a completed `bin/install` run, when I run `ai-conductor daemon status`, then it executes against the same TS dist entrypoint as `conduct-ts daemon status`, with no deprecation warning | task-4 | covered | invocation as `ai-conductor` dispatches with no warning | diff-local |
| criterion | Story 2 happy: Given a completed `bin/install` run, when I inspect `~/.local/bin/ai-conductor`, then it is a symlink resolving to the repo's launcher script, created by the same idempotent pattern as the existing `conduct-ts` symlink | task-5 | covered | produces both `ai-conductor` and `conduct-ts` symlinks | diff-local |
| criterion | Story 2 happy: Given an already-installed `ai-conductor` symlink pointing at a stale target, when `bin/install` re-runs, then the symlink is updated in place and reported, matching the existing conduct-ts update behavior | task-5 | covered | a stale `ai-conductor` symlink is updated in place and reported | diff-local |
| criterion | Story 2 negative: Given a completed install, when I invoke the CLI as `conduct-ts <anything>`, then the command still succeeds with identical stdout and exit code, and exactly one deprecation warning line naming `ai-conductor` is written to stderr before execution | task-4 | covered | exactly one stderr warning naming `ai-conductor` | diff-local |
| criterion | Story 2 negative: Given a broken or missing dist symlink, when I invoke either `ai-conductor` or `conduct-ts`, then the existing missing/broken-dist error is reported on stderr with a non-zero exit under both names | task-4 | covered | broken-dist failure under both names | diff-local |
| criterion | Story 2 negative: Given the launcher invoked via `ai-conductor`, when its output is captured by a script parsing stdout, then no deprecation text appears on stdout under either invoked name | task-4 | covered | no warning text ever appears on stdout | diff-local |
| criterion | Story 3 happy: Given an installed harness, when the host discovers skills, then `composer` is present with complete SKILL.md frontmatter (`name`, `description`, `enforcement`, `phase`) and carries the full engineer-loop instructions under the canonical `compose` CLI vocabulary | task-6 | covered | carries the loop instructions in `compose`/`ai-conductor` vocabulary | diff-local |
| criterion | Story 3 happy: Given an installed harness, when the operator invokes `/engineer` (Claude) or `$engineer` (Codex), then the delegate loads and the session proceeds with composer's behavior, noting the canonical name | task-6 | covered | is a delegate with valid frontmatter and no duplicated loop content | diff-local |
| criterion | Story 3 happy: Given the repo checkout, when `bin/generate-model-table` runs, then the model table carries rows for both `composer` and `engineer` and matches the committed HARNESS.md section | task-7 | covered | with composer and engineer rows present | diff-local |
| criterion | Story 3 negative: Given the validation suite, when `test/test_harness_integrity.sh` runs after the catalog change, then all skill-frontmatter, cross-reference, and model-table checks pass — a missing composer model-table row or a dangling `/engineer` cross-reference fails the suite | task-6, task-7 | covered | cross-reference checks of `test/test_harness_integrity.sh` | diff-local |
| criterion | Story 3 negative: Given the provider contract tests, when `test/test_provider_skill_contracts.sh` and `test/test_codex_skill_installation.sh` run, then both canonical and delegate names install and resolve on both hosts — a delegate that no longer resolves fails the test | task-8 | covered | composer canonical and engineer delegate resolvable on both supported hosts | diff-local |
| criterion | Story 3 negative: Given the delegate SKILL.md, when its instructions are loaded, then it contains no second copy of the loop instructions — a content fork between engineer and composer is a test failure (single source of truth) | task-6 | covered | no duplicated loop content | diff-local |
| criterion | Story 4 happy: Given the shipped tree, when engine code, hooks, skill text, the harness's own `bin/lib/` config read, and the operator entry-point docs (`README.md`, `HARNESS.md`, `docs/reference/cli.md`, `docs/reference/skills.md`) reference the CLI, then they use `ai-conductor` (the surviving references to `conduct-ts` are exactly: the alias symlink/launcher definition, the deprecation warning text, and deprecation-window documentation) | task-10, task-11, task-14, task-16, task-18 | covered | `bin/install` executes no `conduct-ts` command | diff-local |
| criterion | Story 4 happy: Given a daemon run driven by the repointed internals, when its logs are inspected, then they contain no CLI deprecation warning lines | task-10, task-12 | covered | Every operator-facing message string in `src/conductor/src/` that names the CLI says `ai-conductor` | diff-local |
| criterion | Story 4 negative: Given a freshly-installed environment where `bin/install` has created both symlinks, when a hook or engine spawn executes its CLI call, then it succeeds via `ai-conductor` — a call site still spelling `conduct-ts` is caught by a repo test that greps the production tree for non-allowlisted `conduct-ts` invocations and fails on any hit | task-9, task-13, task-18 | covered | scans `bin/` and fails on a planted non-allowlisted reference there | diff-local |
| criterion | Story 4 negative: Given an environment where the operator has not re-run `bin/install` (no `ai-conductor` on PATH yet), when the repo-local harness invokes its own CLI via repo-relative launcher paths, then those invocations still succeed — repo-internal spawns must not depend on the operator's PATH symlink | task-11, task-17, task-18 | covered | a config read succeeds through the repo-relative launcher | diff-local |
