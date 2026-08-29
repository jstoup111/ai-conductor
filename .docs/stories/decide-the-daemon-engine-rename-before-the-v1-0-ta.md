**Status:** Accepted

# Stories: revise the v1.0 rename — daemon stays, engineer→composer, ai-conductor CLI

**Track:** technical (no PRD; criteria derive from adr-2026-08-26-music-vocabulary-player-composer-rename, rewritten 2026-08-28)
**Scope:** three compatibility seams — `compose` verb, `composer` skill, `ai-conductor` binary — plus the internal call-site repoint. Daemon vocabulary, `.daemon/`, and config keys are unchanged. `bin/conduct` remains #226.

## Story 1: Canonical `compose` CLI verb with `engineer` as a deprecated alias

**Requirement:** ADR Decision 2

As an operator, I want the idea→spec loop invoked as `compose` so that the CLI speaks the canonical vocabulary while my existing `engineer` invocations keep working.

### Acceptance Criteria

#### Happy Path
- Given the built CLI, when I run `<binary> compose projects`, then it prints the same registry JSON and exit code as `<binary> engineer projects` does today, with no deprecation warning
- Given the built CLI, when I run any existing engineer subcommand (`claim`, `worktree`, `land`, `handoff`, `projects`) under `compose` with its current flags, then it reaches the same typed dispatch and produces the same stdout contract as under `engineer`
- Given the built CLI, when I run `<binary> compose <sub> --help`, then the help text for that subcommand is shown and exits 0

#### Negative Paths
- Given the built CLI, when I run `<binary> engineer projects`, then the command still succeeds with identical stdout JSON, and exactly one deprecation warning line naming `compose` is written to stderr (never stdout, so JSON consumers are unaffected)
- Given the built CLI, when I run `<binary> compose` with an unknown subcommand or unknown flag, then it is rejected with the same non-zero exit and error shape as the equivalent `engineer` invocation
- Given the built CLI, when I run `<binary> compose` bare, then it launches the same interactive host-agent loop path as bare `engineer` (no second implementation, no divergent behavior)

### Done When
- [ ] A parameterized parser test proves every engineer subcommand dispatch is reachable via `compose` with an identical typed descriptor
- [ ] A test proves `engineer <sub>` emits exactly one deprecation warning on stderr and byte-identical stdout to `compose <sub>`
- [ ] `compose` appears in the CLI usage/help output as the canonical verb; `engineer` is listed as deprecated

## Story 2: `ai-conductor` is the canonical installed binary; `conduct-ts` warns

**Requirement:** ADR Decision 3

As an operator, I want to invoke the CLI as `ai-conductor` so that the installed command carries the project's name, while `conduct-ts` keeps working during the deprecation window.

### Acceptance Criteria

#### Happy Path
- Given a completed `bin/install` run, when I run `ai-conductor daemon status`, then it executes against the same TS dist entrypoint as `conduct-ts daemon status`, with no deprecation warning
- Given a completed `bin/install` run, when I inspect `~/.local/bin/ai-conductor`, then it is a symlink resolving to the repo's launcher script, created by the same idempotent pattern as the existing `conduct-ts` symlink
- Given an already-installed `ai-conductor` symlink pointing at a stale target, when `bin/install` re-runs, then the symlink is updated in place and reported, matching the existing conduct-ts update behavior

#### Negative Paths
- Given a completed install, when I invoke the CLI as `conduct-ts <anything>`, then the command still succeeds with identical stdout and exit code, and exactly one deprecation warning line naming `ai-conductor` is written to stderr before execution
- Given a broken or missing dist symlink, when I invoke either `ai-conductor` or `conduct-ts`, then the existing missing/broken-dist error is reported on stderr with a non-zero exit under both names
- Given the launcher invoked via `ai-conductor`, when its output is captured by a script parsing stdout, then no deprecation text appears on stdout under either invoked name

### Done When
- [ ] `bin/install` creates/updates the `~/.local/bin/ai-conductor` symlink alongside `conduct-ts`, and `bin/install --check` verifies `ai-conductor` on PATH
- [ ] The launcher warns on stderr exactly once per invocation when `basename "$0"` is `conduct-ts`, and never when it is `ai-conductor`
- [ ] A shell test covers both invoked names for: successful dispatch, warning presence/absence, and broken-dist failure; `test/lint_shell.sh` and `bash -n` pass on the changed scripts

## Story 3: `composer` is the canonical skill; `engineer` delegates

**Requirement:** ADR Decision 2

As an operator on any supported host, I want `/composer` (Claude) and `$composer` (Codex) to be the canonical skill so that the skill catalog matches the CLI vocabulary, without breaking `/engineer` muscle memory.

### Acceptance Criteria

#### Happy Path
- Given an installed harness, when the host discovers skills, then `composer` is present with complete SKILL.md frontmatter (`name`, `description`, `enforcement`, `phase`) and carries the full engineer-loop instructions under the canonical `compose` CLI vocabulary
- Given an installed harness, when the operator invokes `/engineer` (Claude) or `$engineer` (Codex), then the delegate loads and the session proceeds with composer's behavior, noting the canonical name
- Given the repo checkout, when `bin/generate-model-table` runs, then the model table carries rows for both `composer` and `engineer` and matches the committed HARNESS.md section

#### Negative Paths
- Given the validation suite, when `test/test_harness_integrity.sh` runs after the catalog change, then all skill-frontmatter, cross-reference, and model-table checks pass — a missing composer model-table row or a dangling `/engineer` cross-reference fails the suite
- Given the provider contract tests, when `test/test_provider_skill_contracts.sh` and `test/test_codex_skill_installation.sh` run, then both canonical and delegate names install and resolve on both hosts — a delegate that no longer resolves fails the test
- Given the delegate SKILL.md, when its instructions are loaded, then it contains no second copy of the loop instructions — a content fork between engineer and composer is a test failure (single source of truth)

### Done When
- [ ] `skills/composer/` exists with SKILL.md + agents; `skills/engineer/` remains on disk as a thin delegate (no directory deletion in this feature)
- [ ] Model table regenerated and committed; validation suite passes end to end
- [ ] Provider skill-contract tests cover composer on both supported hosts

## Story 4: Internal harness call sites invoke `ai-conductor`

**Requirement:** ADR Decision 3

As an operator, I want the harness's own spawns, hooks, and skill text to invoke `ai-conductor` so that deprecation warnings surface only for my own typed `conduct-ts` usage, not in daemon logs or hook output.

### Acceptance Criteria

#### Happy Path
- Given the shipped tree, when engine code, hooks, and skill/doc text reference the CLI, then they use `ai-conductor` (the surviving references to `conduct-ts` are exactly: the alias symlink/launcher definition, the deprecation warning text, and deprecation-window documentation)
- Given a daemon run driven by the repointed internals, when its logs are inspected, then they contain no CLI deprecation warning lines

#### Negative Paths
- Given a freshly-installed environment where `bin/install` has created both symlinks, when a hook or engine spawn executes its CLI call, then it succeeds via `ai-conductor` — a call site still spelling `conduct-ts` is caught by a repo test that greps the production tree for non-allowlisted `conduct-ts` invocations and fails on any hit
- Given an environment where the operator has not re-run `bin/install` (no `ai-conductor` on PATH yet), when the repo-local harness invokes its own CLI via repo-relative launcher paths, then those invocations still succeed — repo-internal spawns must not depend on the operator's PATH symlink

### Done When
- [ ] A committed test enumerates and fails on non-allowlisted `conduct-ts` references in `src/conductor/src/`, `hooks/`, and `skills/` (allowlist: launcher/alias definitions, warning text, deprecation docs)
- [ ] The ~10 src and 11 hook/skill call sites are repointed (message strings, comments, hook launcher paths, skill text)
- [ ] Deprecation warnings originate only from the two alias entrypoints (the launcher's invoked-name check and the `engineer` verb), proven by the grep guard plus the launcher and parser warning tests
