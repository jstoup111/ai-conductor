---
title: Environment variables
parent: Reference
nav_order: 4
---

# Environment variables

Every environment variable the harness reads or writes, grouped by role: read from your ambient
environment, written into child processes, kill-switch or test seam, and CI-only. Within each group,
variables are alphabetized.

Configuration keys live in [configuration](configuration.md); CLI flags live in [the CLI
reference](cli.md).

## Read from the ambient environment

Set these in your shell or your daemon's environment. They change production behavior.

| Variable | Type | Default when unset | Read by | Effect | Bad value |
| --- | --- | --- | --- | --- | --- |
| `AI_CONDUCTOR_ENGINE_BIN` | path or `PATH` command | `<harness>/bin/conduct-ts` | `hooks/claude/post-commit-derive-feedback.sh` | Chooses the engine binary used for the `derive-feedback` check. | Warn and degrade: a non-executable binary, an exit code outside `{0,1}`, or output lacking `evidenced` prints `notice: engine derive path unavailable …` and falls back to the bash path. The hook always exits 0. |
| `AI_CONDUCTOR_ENGINE_STORE` | absolute directory | `<conductorRoot>/dist-versions` | the engine store | Relocates the versioned engine store root. | An empty string is treated as unset. Flipping to a version id that does not exist under the store root throws. |
| `AI_CONDUCTOR_ENGINEER_DIR` | absolute directory | `~/.ai-conductor/engineer` | the engineer store | Relocates the engineer inbox, ledger, claim records, and intake status. | A whitespace-only value is treated as unset; otherwise unvalidated. |
| `AI_CONDUCTOR_PUBLISH_WRAPPER` | marker, `1` | unset | the publish guard imported by `tsup.config.ts` | Proves `tsup` was invoked by the publish wrapper rather than directly. | Absent halts the build: `Refusing to run tsup directly: … Use npm run build…`. |
| `AI_CONDUCTOR_REGISTRY` | absolute path to `registry.json` | `~/.ai-conductor/registry.json` | registry resolution, `register`/`create`, the engine store | Relocates the project registry. | A whitespace-only value is treated as unset. With neither an override nor a usable home, registry resolution throws `Cannot resolve registry path: …`. Malformed registry JSON throws. |
| `AI_CONDUCTOR_TSUP_CMD` | JSON array of argv strings | the built-in `tsup` command | the publish wrapper | Replaces the build command the publish wrapper runs. Priority: explicit option, then this variable, then the default. | Halts. A parse failure throws; a non-array or empty array throws `AI_CONDUCTOR_TSUP_CMD must be a non-empty JSON array, got: <raw>`. |
| `CLAUDE_CODE_OAUTH_TOKEN` | opaque secret | unset | self-host sandbox build env | Build token forwarded verbatim into the sandboxed build child. Also written to children — see below. | Not validated. A bad token surfaces as an auth failure and parks or halts the feature. |
| `CLAUDE_CONFIG_DIR` | absolute directory | `~/.claude` | the engine, the self-host sandbox, provider home | Locates the operator's provider config for the credential-expiry preflight, live-boundary fingerprinting, and operator state. Also written to children — see below. | Ignored or degraded; a missing or unreadable config leads to a credentials park or a halt. |
| `CLAUDE_ERROR` | free text | empty, then the last 5 lines of `.pipeline/conduct.log` | `hooks/claude/rate-limit-wait.sh` | Parsed for `retry after N`, `resets at HH:MM`, and `resets 11pm` to compute the wait written to `.pipeline/rate-limit-hit`. | Unparseable text falls back to a 300-second wait. Never fails. |
| `CLAUDECODE` | truthiness flag, set by Claude Code itself | unset | `conduct-ts engineer` launch | Any truthy value makes the engineer launch refuse to nest a second interactive session; it prints guidance to run `/engineer` directly and returns 0. | Coerced with `Boolean()`. No error path. |
| `CODEX_API_KEY` | API key | unset, so Codex auth is `cached-login` | the Codex provider | Switches Codex authentication to API-key mode. Also written to children — see below. | No read-time validation. An auth failure halts with the remediation `Replace CODEX_API_KEY and restart the daemon.` |
| `CODEX_EXECUTABLE` | executable name or path | `codex` | the Codex provider | Overrides the Codex binary that is spawned. | Not validated. `ENOENT` or exit 127 surfaces as provider-unavailable. |
| `CODEX_HOME` | absolute directory | `~/.codex` | the Codex provider, the engine | Locates `auth.json`, and marks unrelated provider state for the live boundary. Also written to children — see below. | Ignored. A missing `auth.json` yields a not-ready auth verdict. |
| `CONDUCT_ENGINE_COMMIT` | flag, exactly `1` | unset | the generated pre-commit hook | Exempts engine bookkeeping commits from attribution and TDD-trailer enforcement — the hook exits 0. Also written to children — see below. | Only the exact string `1` exempts; any other value enforces normally. |
| `CONDUCT_ENGINE_SELF_GUARD` | flag, `1` | unset, so engine GC is unguarded | the publish wrapper | Enables the self-eviction guard around engine version GC. Also written to children — see below. | Fail-closed: the guard set together with an empty `CONDUCT_ENGINE_SELF_VERSION` skips the entire GC pass. |
| `CONDUCT_ENGINE_SELF_VERSION` | `<YYYYMMDDTHHMMSSZ>-<12 hex>`, may be empty | empty | the publish wrapper | Protects the calling daemon's own dist version from GC. Also written to children — see below. | Empty with the guard set skips GC entirely. A bogus id protects nothing. |
| `CONDUCT_ENGINEER_PERMISSION_MODE` | permission-mode name | `default` | `conduct-ts engineer` launch | Sets `--permission-mode` on the interactive `claude /engineer` session. | Silently coerced: `plan` is rejected and becomes `default`. Any other string passes through unvalidated. |
| `GENERATE_DOCS_GUARD_HOOK_OUT` | absolute path | `hooks/claude/docs-guard.sh` | the docs-guard generator CLI | Test seam. Retargets the emitted or checked hook artifact. | A write failure exits 2; detected drift exits 1. |
| `GENERATE_MODEL_TABLE_HARNESS_MD` | absolute path to `HARNESS.md` | the repo's `HARNESS.md` | the model-table generator CLI | Test seam. Retargets the file whose table region is written or checked. | An unreadable file or missing markers exits 2; drift under `--check` exits 1. |
| `HOME` | absolute path | `USERPROFILE`, then the OS home directory | memory store, memory migration, plugin discovery, `bin/install`, `bin/migrate` | Roots `~/.ai-conductor/…`, `~/.claude/skills`, `~/.agents/skills`, and `~/.local/bin`. | See the note below. |
| `PATH` | OS path list | — | `bin/install` | When `~/.local/bin` is not on `PATH`, prints the advisory `export PATH="$HOME/.local/bin:$PATH"`. | Advisory only; never blocks. |
| `USERPROFILE` | absolute path (Windows) | the OS home directory | memory store, memory migration | Second-choice home resolution. | Falls through to the OS home directory. |
| `WSL_DISTRO_NAME` | any non-empty value, set by WSL | unset, then `/proc/version` is sniffed for `microsoft` | the Mermaid renderer | Marks the host as WSL, which forces the no-sandbox Chromium configuration. | Truthiness check only. |

> **Note.** Plugin discovery joins `HOME` without a fallback, so running with `HOME` unset silently
> yields the *relative* path `.ai-conductor/plugins` — plugins are looked up under the current directory
> with no warning. The memory store resolves the OS home correctly in the same situation. Keep `HOME`
> set.

## Written into child process environments

The harness sets these on the processes it spawns. Setting them yourself has no effect on these code
paths — the harness overwrites or deletes them.

| Variable | Value written | Written by | Purpose |
| --- | --- | --- | --- |
| `AI_CONDUCTOR_PUBLISH_WRAPPER` | `1` | the publish wrapper | Marks the `tsup` subprocess as wrapper-invoked so the publish guard passes. |
| `ASDF_NODEJS_VERSION` | the `nodejs` pin from `src/conductor/.tool-versions` | `bin/conduct-ts` | Pins Node for the engine bundle regardless of the caller's directory. Exported only when `.tool-versions` exists and `asdf` is on `PATH`; otherwise silently skipped. |
| `CI` | `true` | worktree preparation | Signals non-interactive setup to the project's `bin/setup`. |
| `CLAUDE_CODE_EFFORT_LEVEL` | the step's resolved effort | the Claude provider | Per-step reasoning effort: `low`, `medium`, `high`, `xhigh`, or `max`. Chosen over `settings.json` and skill frontmatter because it overrides both and cascades to subagents. Never read from the ambient environment. When no effort and no self-host env apply, the child inherits the parent environment unmodified. |
| `CLAUDE_CODE_OAUTH_TOKEN` | the daemon build token, or the current ambient value | the engine, the self-host sandbox, token liveness | Auth by environment injection — the token is passed via the environment only, never in argv and never logged. Captured at call time, so it can change across retries and parks, and is restored or deleted afterwards. |
| `CLAUDE_CONFIG_DIR` | a throwaway sandbox directory | the self-host sandbox, token liveness, provider home | Isolates a self-build from the operator's global provider config. The provider-home builder deletes any inherited `CLAUDE_CONFIG_DIR`, `CODEX_HOME`, and `CLAUDE_CODE_OAUTH_TOKEN` before setting the isolated one. The daemon's own process value is mutated temporarily and restored in a `finally` block. |
| `CODEX_API_KEY` | the resolved API key | the Codex provider | Propagates API-key auth to `codex doctor` and every invocation. Set only when API-key auth was selected. |
| `CODEX_HOME` | a throwaway provider home | provider home | Codex-side isolation for a self-build. |
| `CONDUCT_ENGINE_COMMIT` | `1` | the engine commit-env wrapper | Marks engine bookkeeping commits — spec authoring, the engineer loop, land, `shipped-record`, rebase — so the pre-commit hook exempts them. |
| `CONDUCT_ENGINE_SELF_GUARD` | `1` | the daemon lock | Arms the engine-GC self-eviction guard for the daemon's own process. |
| `CONDUCT_ENGINE_SELF_VERSION` | the daemon's engine version id, or empty | the daemon lock | Names the version GC must not evict. |
| `WORKTREE_NAMESPACE` | the worktree namespace | worktree preparation | Per-feature isolation for ports, database names, and dev-server state. Written idempotently into the worktree's `.env` and passed to the project's `bin/setup`. |

The child environment passed to a project's `bin/setup` is a replacement, not an overlay: only `CI` and
`WORKTREE_NAMESPACE` plus the process-runner defaults reach it. Both are a contract your project's
`bin/setup` may opt into rather than something the harness enforces — nothing in the harness reads
`WORKTREE_NAMESPACE` back, and this repo's own `bin/setup` ignores both it and `CI`.

## Kill-switches and test seams

These gate production code paths. They are unset in normal operation; the test suite sets them.

| Variable | Allowed | Read by | Effect | Bad value |
| --- | --- | --- | --- | --- |
| `AI_CONDUCTOR_NO_DAEMON_AUTOLAUNCH` | exactly `1` | the engineer's daemon launcher | Suppresses the engineer loop's automatic launch of a tmux-hosted daemon. An explicitly injected supervisor is never suppressed. | Returns silently with no warning. |
| `AI_CONDUCTOR_NO_REAL_EXEC` | any truthy value for the tracker client and CI-fix runner; exactly `1` for tmux | the tracker client, the CI-fix runner, the tmux runner | Blocks real external execution. The production `gh` and `git` runners throw; the CI-fix runner short-circuits to a no-op; the tmux runner throws on `new-session` and `respawn-pane` targeting a `cc-daemon-*` session. | The three sites disagree: two throw, one silently no-ops. A blocked `gh` fetch also surfaces as a retriable failure in the halt-issues closer. |
| `CONDUCT_SETUP_TRIAGE_KILLSWITCH` | any truthy value | the daemon | Prevents LLM dispatch for setup-failure triage; the feature parks with `setup-triage disabled by env killswitch`. | Truthiness check only. |
| `HARNESS_INTEGRITY_TEST_PINS_JSON` | JSON | `test/test_harness_integrity.sh` | Test seam for the model-pin check. | — |
| `HARNESS_INTEGRITY_TEST_SKILLS_DIR` | path | `test/test_harness_integrity.sh` | Test seam for the skills directory the pin check scans. | — |

## CI-only

Ambient in GitHub Actions. Nothing sets these locally.

| Variable | Read by | Effect | Missing |
| --- | --- | --- | --- |
| `GITHUB_EVENT_PATH` | the intake label-sync action | Path to the Actions event JSON. | Prints `[intake-label-sync] missing GITHUB_EVENT_PATH/GITHUB_TOKEN/GITHUB_REPOSITORY; skipping` and returns cleanly. A payload with no issue prints `event payload has no issue; skipping`. An issue whose body has no `### Priority` / `### Size` field headings (i.e. filed by `bin/intake-file`, not the issue form) prints `is not an issue-form submission (no Priority/Size field headings); skipping — labels are owned by the filer`. |
| `GITHUB_REPOSITORY` | the intake label-sync action; `conduct-ts shipment-evidence reconcile` | The `owner/repo` slug. | Label sync skips cleanly. `shipment-evidence reconcile` **throws** `GITHUB_REPOSITORY is required for repair publication`. |
| `GITHUB_TOKEN` | the intake label-sync action | Label-sync authentication. | Skips cleanly, as above. |

## Referenced but never read

| Variable | Where it appears | Status |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | the engine's auth-failure halt reason | Never read by harness code. It appears only in the halt message raised when `harness_self_host.build_auth.mode` is `api-key` and auth fails; the spawned `claude` CLI consumes it by ordinary inheritance. A bad value halts the feature. |
| `NO_COLOR` | a comment in the daemon CLI | Honored transitively by the color library, so piped or redirected daemon logs stay plain text. No direct read. |
| names declared in `test_suite.environment` | the full-suite verifier, fingerprint, and executor | An open-ended, project-configured set of variable *names*. Each name's value is HMAC'd into the full-suite fingerprint, so a value change invalidates cached verification with reason `environment_changed`, and is redacted from verifier output. Each name fingerprints as `set` or `unset` plus its value; an unset name is not an error. The suite command inherits the whole environment by default. See [configuration](configuration.md). |

## `--effort` is not a CLI flag

The effort override is documented in two places in the engine — the resolver's `effortCliOverride`
option and the step runner's `effortOverride` field, both annotated as the "CLI `--effort <level>`
override" — but no `--effort` option is registered on any command. There is no way to set effort from
the command line. Set it per step, per phase, or in `defaults` via
[configuration](configuration.md), or let the provider policy resolve it as described in
[models](models.md). The only model-family override that reaches the CLI is `--model`.
