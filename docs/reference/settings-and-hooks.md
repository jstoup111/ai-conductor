---
title: Settings and hooks
parent: Reference
nav_order: 6
---

# Settings and hooks

Every `settings.json` file the harness writes, every JSON key path it touches, and every hook it wires
into the Claude host, git, and the self-host sandbox. For operators debugging why a tool call was
blocked, and for anyone auditing what the harness installed on their machine.

Three unrelated things are called "hooks" in this repo. This page covers two of them: **host event
hooks** (`hooks/claude/*.sh` and the engine's per-worktree scripts, fired by the Claude host) and **git
hooks** (`prepare-commit-msg` / `commit-msg`, generated per worktree). The third — **config step
hooks**, `steps.<name>.hooks.before` / `.after` — is a `.ai-conductor/config.yml` key and is documented
in [configuration](configuration.md). Config step hooks are not connected to any host event.

## Settings files

Four `settings.json` files are written or merged by harness code.

| File | Owner | Written by | Tracked |
| --- | --- | --- | --- |
| `~/.claude/settings.json` | operator, machine-wide | `bin/install` (`configure_permissions`, `configure_hooks`), merged in place | n/a |
| `<project>/.claude/settings.json` | project | engine preflight `ensureClaudeSettings()`; the `bootstrap` skill | committed |
| `<worktree>/.claude/settings.local.json` | engine | `worktree-prepare.ts::wireSessionHookSettings()` | untracked — `.claude/` is added to the worktree's `info/exclude` |
| `<throwaway CLAUDE_CONFIG_DIR>/settings.json` | self-build sandbox | `sandbox-build-env.ts` + `write-fence.ts::mergeFenceIntoSettings()` | ephemeral |

All four are plain Claude Code settings files. The harness writes only a subset of the schema.

### Key paths

Source-ordered by JSON path. Anything not listed here is never written by harness code.

| Key path | Value | Written by |
| --- | --- | --- |
| `$schema` | `https://json.schemastore.org/claude-code-settings.json` | `preflight.ts::buildSettingsJson`; `templates/claude-settings.json.template` |
| `permissions.allow[]` | array of permission strings | `bin/install::configure_permissions` (global); `preflight.ts` and the template (project); the `bootstrap` skill |
| `permissions.deny` | — | never written by any harness code path |
| `permissions.ask` | — | never written by any harness code path |
| `env` | — | never written; environment is injected at spawn time (see [environment](environment.md)) |
| `hooks.PreToolUse[]` | array of hook entries | `bin/install::configure_hooks`; `wireSessionHookSettings()`; `mergeFenceIntoSettings()`; the `bootstrap` skill |
| `hooks.PreToolUse[].matcher` | tool-name pattern, e.g. `Bash`, `Edit\|Write\|NotebookEdit`, `Task\|Agent` | same |
| `hooks.PreToolUse[].hooks[]` | array of commands for that matcher | same |
| `hooks.PreToolUse[].hooks[].type` | always `command` | same |
| `hooks.PreToolUse[].hooks[].command` | absolute path to a script | same |
| `hooks.PreToolUse[].hooks[].timeout` | seconds | `bin/install::configure_hooks`; the `bootstrap` skill |
| `hooks.PreToolUse[].hooks[].if` | `Bash(gh pr create*)` | the `bootstrap` skill only — the sole use of `if` in the harness |
| `hooks.PreToolUse[].hooks[].statusMessage` | `Running pre-PR lint gate` | the `bootstrap` skill only — the sole use of `statusMessage` |
| `hooks.PostToolUse[]` | array of hook entries | `bin/install::configure_hooks`; `wireSessionHookSettings()` |
| `hooks.PostToolUse[].matcher` | `Edit\|Write`, `Bash`, `Task\|Agent` | same |
| `hooks.PostToolUse[].hooks[].type` | always `command` | same |
| `hooks.PostToolUse[].hooks[].command` | absolute path to a script | same |
| `hooks.PostToolUse[].hooks[].timeout` | seconds | `bin/install::configure_hooks` |
| `hooks.SessionStart[].hooks[]` | one entry, no `matcher` key | `bin/install::configure_hooks` |
| `hooks.Stop[].hooks[]` | one entry, no `matcher` key | `bin/install::configure_hooks` |
| `hooks.StopFailure[].matcher` | `rate_limit` | `bin/install::configure_hooks` |
| `hooks.StopFailure[].hooks[]` | one entry | `bin/install::configure_hooks` |

`hooks.PreToolUse[].hooks[].command` is always an absolute path interpolated from the harness checkout
(`${HARNESS_DIR}/hooks/claude`) or from the worktree (`<worktree>/.pipeline/session-hooks`). Moving or
deleting either directory breaks every hook wired from it.

### Precedence

Claude Code resolves settings highest to lowest: enterprise policy, CLI args,
`.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`. Mapped onto the four
harness files:

1. `~/.claude/settings.json` — lowest precedence, but the only home of the harness's eight wired
   lifecycle hook entries. Machine-wide, additively merged, never pruned.
2. `<project>/.claude/settings.json` — committed. Permissions plus the bootstrap pre-PR lint hook.
   Created only if absent; the engine never merges it after creation.
3. `<worktree>/.claude/settings.local.json` — highest of the three. Engine-owned and rewritten on every
   worktree provisioning pass. Do not hand-edit it inside a build worktree.
4. Sandbox `CLAUDE_CONFIG_DIR/settings.json` — for a self-build, layer 1 is replaced entirely by `{}`
   plus the write-fence entry. Layers 2 and 3 still apply. See [self-hosting](../guides/self-hosting.md).

**Hooks from multiple layers accumulate; they do not override.** A project running the daemon has
`docs-guard.sh` wired twice — once from `~/.claude/settings.json` (harness checkout path) and once from
`settings.local.json` (worktree `session-hooks/` path). The two script bodies are byte-identical and the
guard is idempotent, so double-firing is harmless.

### Permission sets

Three producers write a project `permissions.allow`, and they do not agree.

| Producer | Entries |
| --- | --- |
| `templates/claude-settings.json.template` | `Read(**)`, `Edit(**)`, `Write(**)` |
| `preflight.ts::buildSettingsJson` | those three, plus `Bash(git:*)`, `Bash(gh:*)`, `Bash(rtk:*)`, `Bash(npm:*)`, `Bash(npx:*)`, `Bash(node:*)`, `Bash(mkdir:*)`, `Bash(touch:*)`, `Bash(chmod:*)`, `Bash(ln:*)`, `Bash(glow:*)` |
| this repo's committed `.claude/settings.json` | the 11 `Bash(...)` allows only — no `Read`/`Edit`/`Write` |

The operator-global set `HARNESS_PERMISSIONS` in `bin/install` is 18 entries: `Read(${HARNESS_DIR}/**)`
plus 17 `Bash(...)` allows covering bundler, Rails scaffolding, `docker compose`, non-destructive git
(`init`, `add`, `commit`, `status`, `log`, `diff`, `branch`, `checkout -b`), and read-only `gh`
(`pr list`, `issue list`). `Read(${HARNESS_DIR}/**)` is absolute, so reinstalling from a different
checkout repoints it.

Destructive git operations — `push --force`, `reset --hard`, `branch -D`, `clean -f` — are deliberately
absent from every allow list, and no `permissions.deny` rules ship at all. Denial is enforced
mechanically by `hooks/claude/block-destructive-git.sh` instead.

## Wired hook events

Eight event/matcher entries are written to `~/.claude/settings.json` by `bin/install::configure_hooks`.

| Event | Matcher | Command(s) | Timeout (s) |
| --- | --- | --- | --- |
| `PreToolUse` | `Bash` | `block-destructive-git.sh` | 10 |
| `PreToolUse` | `Bash` | `tdd-commit-gate.sh` | 10 |
| `PreToolUse` | `Edit\|Write\|NotebookEdit` | `docs-guard.sh` | 10 |
| `PostToolUse` | `Edit\|Write` | `lint-after-edit.sh` (fires per edit; lints only at batch boundaries — see below), `spec-coverage-check.sh`, `diagram-coverage-check.sh` | 30, 10, 10 |
| `PostToolUse` | `Bash` | `post-commit-derive-feedback.sh` | 15 |
| `SessionStart` | *(no `matcher` key)* | `session-start-context.sh` | 15 |
| `Stop` | *(no `matcher` key)* | `stop-memory-reminder.sh` | 10 |
| `StopFailure` | `rate_limit` | `rate-limit-wait.sh` | 10 |

`UserPromptSubmit`, `PreCompact`, `SubagentStop`, `SessionEnd`, and `Notification` are never used.

The merge is python3-based: read, mutate in memory, `json.dump(indent=2)` plus a trailing newline. It is
idempotent and non-destructive — the merge unit is the entry, keyed on its command-string set, and an
entry is appended only if it contributes at least one new command. Operator entries are never removed.
Without `python3` on PATH the whole step is skipped with a warning.

Neither `templates/claude-settings.json.template` nor this repo's own `.claude/settings.json` contains a
`hooks` key. `~/.claude/settings.json` is the only place the `hooks/claude/*.sh` suite is registered.

## Operator hook scripts

Eleven scripts live in `hooks/claude/`. Alphabetized.

| Script | Trigger | What it does | Can block? |
| --- | --- | --- | --- |
| `block-destructive-git.sh` | `PreToolUse` / `Bash` | Strips quoted spans from the command, then pattern-matches destructive git. Emits a non-blocking NOTE on ad-hoc `git rebase`. | **Yes — exit 2** on `git push --force`/`-f`, `git reset --hard`, `git branch -D` of a not-provably-merged branch, `git clean -f`, and `git checkout -- .` / `git restore .`. `--force-with-lease` is explicitly allowed. |
| `diagram-coverage-check.sh` | `PostToolUse` / `Edit\|Write` | Warns that diagrams may be stale when a structural file is edited (Rails `app/{models,controllers,services,jobs}`, `config/routes.rb`, `db/migrate/`, compose files, `Procfile`, or `src/{models,controllers,services}`) and `.docs/architecture/` exists. | No |
| `docs-guard.sh` | `PreToolUse` / `Edit\|Write\|NotebookEdit` | Inert (exits 0 without reading stdin) unless `.pipeline/phase-active` exists. Otherwise reads a bounded payload (`timeout 3 head -c 1048576`), extracts `tool_input.file_path` or `tool_input.notebook_path` via `node -e`, normalizes a leading `$PWD/`, and default-denies `.docs/` writes unless an `allow:` prefix in the marker matches. | **Yes — exit 2** on an undeterminable target (fail-closed) and on any unallowlisted `.docs/` write. Block message names the phase and step. |
| `lint-after-edit.sh` | `PostToolUse` / `Edit\|Write` | Invoked per edit, but does **not** lint per edit. Queues the edited path under `$TMPDIR/ai-conductor-lint/<repo-hash>/` and stays silent until a batch boundary, then lints the whole queue and clears it. A boundary is `.pipeline/current-task` changing, or — outside a pipeline, where no task marker exists — `LINT_DEBOUNCE_SECONDS` (default 120) elapsing since the queue opened. Dispatches by type: `.ts`/`.tsx` → ESLint (one batched invocation), `.sh` and bash-shebang files → `shellcheck --severity=error`, `.rb` → `bundle exec standardrb --no-fix`. Each is skipped silently when its tool or project context is absent. Queue state is deliberately kept out of `.pipeline/`, which is engine-owned. | No — always exits 0 |
| `post-commit-derive-feedback.sh` | `PostToolUse` / `Bash` | Despite the name, not a git post-commit hook. Invokes `conduct-ts derive-feedback --sha <sha>` for fast advisory feedback on a commit; falls back to a bash `Task:` trailer match. Never writes `task-status.json`. | No — exits 0 on every path |
| `rate-limit-wait.sh` | `StopFailure` / `rate_limit` | Reads `$CLAUDE_ERROR`, else tails `.pipeline/conduct.log`, and writes `.pipeline/rate-limit-hit` (line 1 epoch, line 2 wait seconds; default 300). | No |
| `session-start-context.sh` | `SessionStart` | Prints the whole of `HARNESS.md`, a warning if the consumer `CLAUDE.md` is missing the HARNESS.md reference, the head of `.memory/index.md`, story and plan counts, and `Pipeline: n/m steps done` from `.pipeline/conduct-state.json`. Writes `.pipeline/.memory-count-at-start`. | No |
| `spec-coverage-check.sh` | `PostToolUse` / `Edit\|Write` | Warns when a Rails `app/{models,controllers,services,jobs}` file has no counterpart under `spec/`. Skips `application_*` files. | No — warn only |
| `stop-memory-reminder.sh` | `Stop` | Compares the current `.memory/` entry count against `.pipeline/.memory-count-at-start` and reminds when work happened without a memory write. | No — no `{"decision":"block"}` output exists in any Stop hook in this repo |
| `tdd-commit-gate.sh` | `PreToolUse` / `Bash` | Reads `.pipeline/tdd-phase`. Absent ⇒ exit 0. | **Yes — exit 2** when the phase is anything other than `COMMIT` |
| `worktree-check.sh` | none | Reads `.pipeline/conduct-state.json`. Present and executable but registered in no settings block anywhere. | No |

**Exactly three of these can block a tool call with exit 2**: `block-destructive-git.sh`,
`docs-guard.sh`, and `tdd-commit-gate.sh`. Every other script is advisory and exits 0 regardless of what
it finds.

> **Known limitation.** `rate-limit-wait.sh` is registered under the event name `"StopFailure"`, which
> is not a Claude Code host event. The registration is inert: the host never fires it, so
> `.pipeline/rate-limit-hit` is never produced by the hook path and a rate-limit stop is not
> automatically waited out. Tracked in
> [#1019](https://github.com/jstoup111/ai-conductor/issues/1019).

> **Known limitation.** Nothing in the engine, and no skill, writes `.pipeline/tdd-phase`. Both TDD gates
> — `hooks/claude/tdd-commit-gate.sh` and `hooks/pre-commit-tdd-gate.sh` — are therefore dormant unless
> an operator creates that file by hand. When it does exist, `tdd-commit-gate.sh` never reads stdin and
> never inspects the command, so while the phase is not `COMMIT` it blocks **every** `Bash` tool call,
> not only `git commit`. Remove `.pipeline/tdd-phase` to restore normal operation. Tracked in
> [#1009](https://github.com/jstoup111/ai-conductor/issues/1009).

### Generating `docs-guard.sh`

`hooks/claude/docs-guard.sh` is a generated artifact, not hand-written. Its source is the
`DOCS_GUARD_HOOK` string constant in `src/conductor/src/engine/session-hook-assets.ts`; the checked-in
file is byte-identical to what the engine writes into each worktree.

```bash
bin/generate-docs-guard-hook           # regenerate hooks/claude/docs-guard.sh
bin/generate-docs-guard-hook --check   # compare only
```

Exit codes: `0` no drift, `1` drift (`--check`), `2` environment error. Set
`GENERATE_DOCS_GUARD_HOOK_OUT` to write elsewhere. Drift is CI-gated by
`test/test_harness_integrity.sh` — see [validation](../contributing/validation.md).

## Per-worktree engine hooks

When the engine prepares a build or spec worktree it writes two scripts into
`<worktree>/.pipeline/session-hooks/` (mode 0755) and wires two entries into
`<worktree>/.claude/settings.local.json` with absolute paths baked in.

| Script | Event / matcher | What it does | Can block? |
| --- | --- | --- | --- |
| `pre-dispatch.sh` | `PreToolUse` / `Task\|Agent` | When line 1 matches `^Task: ([A-Za-z0-9._-]+\|none)$`, appends advisory dispatch telemetry and flips that known task row to `in_progress`. Any missing, malformed, unknown, locked, or unwritable telemetry abstains. | No — attribution is telemetry only. |
| `docs-guard.sh` | `PreToolUse` / `Edit\|Write\|NotebookEdit` | Byte-identical to `hooks/claude/docs-guard.sh`. | **Yes — exit 2** |

Re-provisioning is idempotent: `replaceSessionHookEntry` removes only entries with the same matcher
*and* a command containing the `session-hooks/` marker, then appends. Operator-authored entries survive.
The whole wiring path is fail-open — any error logs `session hook settings: skipped` and the worktree is
used anyway.

Provisioning removes the retired `post-dispatch.sh` and `mutation-gate.sh` scripts and settings entries
from previously prepared worktrees.

## Git hooks

The engine generates three git hooks per worktree, into `<worktree>/.pipeline/git-hooks/` (mode 0755), and
points the worktree at them:

```bash
git -C <worktree> config extensions.worktreeConfig true
git -C <worktree> config --worktree extensions.worktreeConfig true
git -C <worktree> config --worktree core.hooksPath <worktree>/.pipeline/git-hooks
```

| Hook | Trigger | What it does | Can block? |
| --- | --- | --- | --- |
| `pre-commit` | every commit in the worktree | While `.pipeline/phase-active` exists and its phase is `BUILD` or `SHIP`, rejects any staged path under a protected artifact directory (`PROTECTED_ARTIFACT_DIRECTORIES` in `protected-artifact-seal.ts` — `.docs/architecture`, `.docs/decisions`, `.docs/plans`, `.docs/specs`, `.docs/stories`) unless an `allow:` prefix in the marker matches it or its stem names the worktree's own feature (from `.pipeline/task-status.json`'s `plan_ref`, date prefix ignored). A malformed or escaping staged path (empty, absolute, or containing `..`/`.`) is always rejected. Provider-agnostic — it fires for any commit in the worktree, regardless of which host or CLI created it, unlike the Claude-only `docs-guard.sh` PreToolUse hook. | **Yes — exit 1** naming every offender and directing the amendment to DECIDE. |
| `prepare-commit-msg` | every commit in the worktree | Stamps `Task: <id>` from `<worktree>/.pipeline/current-task` using `git interpret-trailers --if-exists replace`. Fires only when no explicit trailer is already present. Abstains on amend, on rebase replay, and on an empty staged diff. | No |
| `commit-msg` | every commit in the worktree | Validates a supplied `Task:` trailer, checks its staged paths against the active task's declared files, then emits non-blocking warnings for bundling and subject mismatch. An out-of-scope path is reported with a copy-pasteable `Scope: <path> — <rationale>` widening. Containment defaults to report-only; set `build_review.scopeContainmentEnforced: true` to refuse verified violations. | **Yes — exit 1** (git-hook convention) when a supplied trailer uses the `task-N` form or names an id absent from `.pipeline/task-status.json`, or when enforced scope-check returns exit `2`. |

All three hooks chain to `$(git rev-parse --git-common-dir)/hooks/<name>` when one exists and is
executable. `pre-commit` and `prepare-commit-msg` are pure bash plus `git` and POSIX tools (`pre-commit`
also uses `sed`; `prepare-commit-msg` uses `node -e`). `commit-msg` additionally invokes the installed
`conduct-ts scope-check <commit-message>` command; none of the three hooks references `dist/`.

`pre-commit` and `commit-msg` both exit 0 immediately for any commit made with `CONDUCT_ENGINE_COMMIT=1`
— the environment the engine sets for its own bookkeeping commits (rebase mechanics, quarantine, shipped
records, spec landing). `commit-msg` additionally exits 0 for merge commits (`MERGE_HEAD` present),
`--amend`, and rebase replay.

The scope checker has three outcomes. Exit `0` means the commit is allowed: it covers both in-scope commits
and an out-of-scope commit reported under the report-only default. Exit `2` is a positive refusal reserved
for a future enforcement flip, which `commit-msg` converts to Git's blocking exit `1`. Any other exit is an
abstention — for example, missing or malformed task state — and `commit-msg` logs that it allowed the commit.
Only a task-attributed commit with a usable in-progress task row is checked. Add one `Scope:` trailer per
out-of-scope staged path when the widening is intentional; the engine records accepted widenings for
`build_review`, which remains the semantic scope authority.

`hooks/pre-commit-tdd-gate.sh` ships in the tree but is copy-it-yourself only; nothing installs it, and
it is subject to the dormant-`tdd-phase` limitation above. It is unrelated to the engine-installed
`pre-commit` hook above, which is generated fresh per worktree from `PRE_COMMIT_HOOK` in
`git-hook-assets.ts` rather than copied from that file.

Hook installation itself is fail-closed for `pre-commit`/`prepare-commit-msg`/`commit-msg`: a worktree
with a `.git` present but not writable, or any other failure while writing or wiring the three scripts,
raises rather than silently continuing, so a worktree can never enter BUILD/SHIP without the preventive
gate installed. A worktree with no `.git` at all (a plain temporary directory, as some unit-level setup
tests use) has no commit surface to protect and is skipped as a no-op, not an error. This is a change
from the historical behavior, where every git-hook failure was swallowed and logged.

Trailer semantics — which trailers are gates and which are telemetry — are documented in
[artifacts](artifacts.md).

## Self-host sandbox write-fence

For a harness self-build the engine generates a fifth hook that is not a file in `hooks/`.
`generateFenceScript(worktreeRoot, harnessRoot)` bakes both absolute roots into a standalone bash script
written to the throwaway `CLAUDE_CONFIG_DIR`, and `mergeFenceIntoSettings()` appends it under
`hooks.PreToolUse`:

```json
{
  "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
  "hooks": [{ "type": "command", "command": "<sandbox>/write-fence.sh" }]
}
```

| Situation | Result |
| --- | --- |
| Target under the worktree root | Allow (exit 0) |
| Target under the harness root but outside the worktree | **Block (exit 2)** |
| Read-only Bash (`grep`, `cat`, `diff`, …) | Allow (exit 0) |
| Unrelated path (other repos, OS temp) | Allow (exit 0) |
| Target could not be determined | **Block (exit 2)** |
| Malformed or empty payload | Allow (exit 0) |

The fence takes no environment variables — only the two baked-in roots. See
[self-hosting](../guides/self-hosting.md) for when it is provisioned.

### What the fence does NOT block

The fence has no rule for `git push`, `gh`, or any network operation, and the `claude` provider is
dispatched with `--dangerously-skip-permissions`, no OS sandbox, and full environment inheritance.
(`codex` is the sandboxed provider: unattended runs pass `sandbox_mode="workspace-write"`.)

Because a claude self-build dispatch therefore cannot be fenced away from pushing or from `gh`, the
engine refutes any dispatch output that says otherwise. `environment-claim-audit.ts` runs inside the
self-host candidate-safety wrapper: when a line carries an environmental cause, a blocking assertion,
**and** a named remote operation the generated fence provably cannot deny, the attempt is failed and
the disproof becomes its retry reason, prefixed `ENVIRONMENT_CLAIM_REFUTED`. The deniable-operation
set is derived from `generateFenceScript` itself, so teaching the fence a real `git push` rule
retires the refutation automatically. Claims on a sandboxed or unrecognized provider are never
refuted — the audit only rejects what the engine can positively disprove. See
[stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md) for triage.

## Malformed settings.json

Six writers touch a settings file, and each handles unparseable JSON differently.

| Writer | Behavior on malformed JSON |
| --- | --- |
| `bin/install::configure_permissions` | `json.load` raises, nothing is written, the file is left intact — but the installer still reports success (see the callout below) |
| `bin/install::configure_hooks` | Prints `⚠ Could not configure hooks automatically`; the file is left intact. Invoked as `… \|\| warn`, so `set -e` never aborts the install |
| `worktree-prepare.ts::wireSessionHookSettings` | Renames the file to `<path>.bak-<epoch>`, logs the reason, and rebuilds from `{}`. Never discards content |
| `write-fence.ts::mergeFenceIntoSettings` | Silently discards and restarts from `{"hooks":{"PreToolUse":[]}}` |
| `preflight.ts::ensureClaudeSettings` | Never parses. A malformed project `settings.json` is left untouched forever, and the preflight reports nothing |
| `sandbox-build-env.ts::provisionTrustState` | Malformed operator `~/.claude.json` propagates no workspace trust — the sandbox never guesses trust |

> **Known limitation.** `bin/install::configure_permissions` reports success on a malformed
> `settings.json`. `rm -f "$perms_file"` runs between the python3 heredoc and the `if [ $? -eq 0 ]`
> check, so `$?` holds `rm`'s exit code, not python's. The installer prints `✓ Permissions:` with an
> empty count and no permissions are actually added. If your allow list looks unchanged after
> `bin/install`, validate the file with `python3 -m json.tool ~/.claude/settings.json` and fix the JSON
> before re-running. `configure_hooks` has no intervening command and reports correctly. Tracked in
> [#1020](https://github.com/jstoup111/ai-conductor/issues/1020).

## Related

- [configuration](configuration.md) — every `.ai-conductor/config.yml` key, including config step hooks.
- [environment](environment.md) — every environment variable the harness reads or injects.
- [artifacts](artifacts.md) — the files hooks read and write, including `.pipeline/phase-active`.
- [gates](../explanation/gates.md) — why these blocks are fail-closed.
- [extending](../contributing/extending.md) — adding a hook.
