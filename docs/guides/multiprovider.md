# Choose and configure the LLM host

Select which host executes your steps — `claude`, `codex`, or an ordered fallback between them —
and verify the selection took effect. For operators who have installed the harness and registered a
project.

Exactly two hosts are built in. They are registered by the engine at startup as
`llm_provider:claude` and `llm_provider:codex`. Anything else is a plugin.

## Prerequisites

- The host CLI you intend to use is on `PATH`: `claude --version`, `codex --version`, or both.
- The project is registered and has a project root you can write `.ai-conductor/config.yml` into.
- For `codex`, an authenticated Codex login or `CODEX_API_KEY` in the environment.

## 1. Understand what selects a host

There is **no `--provider` CLI flag**. Selection lives entirely in the `llm_provider` config key.

| Where | Key | Scope |
| --- | --- | --- |
| Run level | `llm_provider` | every step in the run |
| Step level | `steps.<step>.llm_provider` | that step only, merged ahead of the run-level list |

The default when the key is absent is `['claude']`.

`bin/install --providers=claude,codex` does **not** set this. It gates only the install-time
readiness report — a line per selected host saying whether its CLI was found. Both skill catalogs
(`~/.claude/skills` for Claude, `~/.agents/skills` for Codex) are symlinked on every install
regardless of the value, and the flag never writes into any config file.

## 2. Set the host

`llm_provider` is read from the **project** config — `<project>/.ai-conductor/config.yml` — for
both `conduct-ts inline` and `conduct-ts daemon`. The user-level `~/.ai-conductor/config.yml` is
merged only for the mermaid-renderer setting, so an `llm_provider` written there has no effect on
step execution.

Create or edit the project config:

```yaml
# <project>/.ai-conductor/config.yml
llm_provider: codex
```

`conduct-ts create <name>` includes this file for a new repository. In an existing Git repository,
run `conduct-ts config init`; the command writes the project-safe template once and preserves an
existing config byte-for-byte. Every key is documented in
[../reference/configuration.md](../reference/configuration.md).

**Observable outcome:** the next `conduct-ts inline` run dispatches steps to `codex` instead of
`claude`. An unknown name fails fast at startup:

```text
llm_provider names unknown provider "gpt". Available registered providers: claude, codex
```

The same validation runs against every `steps.<step>.llm_provider` entry, reporting the offending
path.

## 3. Add a fallback ladder

An ordered array is a fallback ladder, tried left to right:

```yaml
llm_provider:
  - claude
  - codex
```

The engine walks the list and stops at the first host that produces a result. It advances to the
next entry only on **unavailability**, not on ordinary step failure:

- run-scoped provider unavailability — the binary is missing (`ENOENT` or exit `127`), or the host
  reports an auth/credit condition that makes the whole run impossible;
- model unavailability, but only after that host's own internal model ladder is exhausted.

A step that runs and fails on its merits ends the run there. It does not silently re-run on the
other host.

**Observable outcome:** on a fallback, the run logs

```text
Step <step>: provider claude unavailable (<reason>); falling back to codex.
```

When every candidate is unavailable the step fails with
`All configured providers are unavailable for step <step>: <provider> (<reason>); …`.

Duplicates are collapsed, preserving first-occurrence order.

## 4. Override a single step

A step-level selection is prepended to the run-level list rather than replacing it, so the
run-level hosts remain as fallbacks:

```yaml
llm_provider:
  - claude
steps:
  build:
    llm_provider: codex
```

`build` tries `codex`, then `claude`. Every other step tries `claude` only. Step names come from
[../reference/steps.md](../reference/steps.md).

## What differs between the two hosts

| Aspect | `claude` | `codex` |
| --- | --- | --- |
| Executable | `claude` (fixed) | `$CODEX_EXECUTABLE`, default `codex` |
| Skill catalog | `~/.claude/skills` | `~/.agents/skills` |
| Project instruction file | `CLAUDE.md` | `AGENTS.md` |
| Skill invocation syntax | `/skill-name` | `$skill-name` |
| Interactive steps | a real REPL | none — `codex exec` is one-shot, streamed as JSONL |
| Readiness check | none; failures are classified from process signals and output | explicit `codex doctor --json --summary` before every dispatch, failing closed |
| Isolated-home variable | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` |
| Model table | Claude-specific | Codex-specific |

Both hosts share one skill corpus; only the invocation syntax and the discovery directory differ.
Model and effort resolution per host is owned by [../reference/models.md](../reference/models.md);
the environment variables above are enumerated in
[../reference/environment.md](../reference/environment.md).

`--interactive` is honored differently as a consequence: under `codex` there is no REPL to open, so
conversational steps stream a single one-shot run instead of handing you a prompt.

### The Codex skills directory moved

`~/.agents/skills` is the active Codex catalog. `~/.codex/skills` is the former discovery location,
and `bin/install` reconciles it — harness-owned symlinks there are **deleted** once the active
catalog is established. Foreign entries are preserved and reported with a warning. If you had an
older install, expect harness links under `~/.codex/skills` to disappear on your next
`./bin/install`; that is the reconciliation, not a failure. `./bin/install --check` reports any
skill present in both locations as a duplicate-discovery error and exits `1`.

### The engineer loop always uses Claude

`conduct-ts engineer` spawns `claude` directly with `/engineer` as its prompt. It does not consult
`llm_provider`. Setting `llm_provider: codex` changes which host executes pipeline steps; it does
not change the host for the interactive idea→spec loop, which still requires the `claude` CLI. See
[engineer-loop.md](engineer-loop.md).

## Verify the selection

`install` is not on `PATH` — run it from the harness checkout:

```bash
cd <harness-checkout>
./bin/install --check
```

It reports a found/not-found line for each host named by `--providers` (defaulting to `claude`),
plus the state of both skill catalogs. Exit codes are in [../quickstart.md](../quickstart.md).

A missing binary surfaces at dispatch time with a symmetric message from either host:

```text
LLM provider 'codex' not found. Install it or check your PATH.
```

A Codex readiness failure reports its own remediation instead — for example
`The selected Codex authentication source is not configured. Sign in to Codex and retry.` for an
unconfigured login, or `Replace CODEX_API_KEY and restart the daemon.` when the API-key source was
selected.

## Third-party hosts

A host that is not built in loads as a plugin. The engine scans two directories at startup, global
first, then project-local, which shadows it on the same kind and name:

1. `~/.ai-conductor/plugins/<name>/plugin.yml`
2. `<project>/.ai-conductor/plugins/<name>/plugin.yml`

A manifest requires three fields — `kind: llm_provider`, a `name` matching `[a-z0-9-]+`, and an
`entrypoint` — and may declare an optional `harness_version` range. Once registered, the name is
usable in `llm_provider` exactly like `claude` or `codex`. An `llm_provider` entrypoint must export
both `invoke` and `invokeInteractive`.

An invalid manifest is skipped with a warning. An incompatible `harness_version` or a missing or
malformed entrypoint aborts startup rather than degrading silently.

The `plugins/` directory at the harness repo root is **reference material only and is never
auto-loaded** — it holds `recorder-provider` (`llm_provider:recorder`) and
`json-stdout-subscriber` (`ui_renderer:json-stdout`) as worked examples. To use one, copy or
symlink it into one of the two discovery directories above. Neither is needed for normal operation.
Writing a provider plugin is covered in [../contributing/extending.md](../contributing/extending.md).
