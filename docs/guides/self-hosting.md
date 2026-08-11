---
title: Self-hosting the harness
parent: Guides
nav_order: 6
---

# Self-hosting the harness

Run the harness on the ai-conductor repository itself, so the daemon builds harness features with the
harness. For an operator working on this repo.

This is the only page that presents the self-host flow. Everywhere else in these docs, the default
flow is canonical.

## What self-host mode changes

A self-host build is an ordinary build plus one bundle of extra guardrails, activated as a unit
behind a single decision:

| Guardrail | What it does |
| --- | --- |
| Skill relink preflight | Relinks harness skills before dispatch, so a newly added or renamed skill is available to the dispatched session |
| Sandbox build env | Runs the build step under a throwaway `CLAUDE_CONFIG_DIR` pointing at the build worktree's own `skills/` and `hooks/` |
| Live-boundary fingerprint | Fails the run if the live checkout or unrelated provider state changes mid-build |
| Version approval gate | Halts at finish unless the VERSION change is approved |
| Release artifact gate | Halts at finish on an integrity, changelog, or migration failure |
| Build auth | Uses a daemon-owned OAuth token rather than the operator's live credentials |

Activation is decided once per daemon, against the main repo root, by
`harness_self_host.activation`:

| Value | Behavior |
| --- | --- |
| `auto` (default) | Path detection — realpath-compare the build root against the directory containing `bin/install`. Positive-only: any uncertainty resolves to **not** self-host |
| `force_on` | Treat any repo as a self-build |
| `force_off` | Never self-host, even in the harness checkout |

Every gate toggle defaults to enabled, and an unknown key under `harness_self_host` is a hard config
error rather than a silently disabled guardrail. See
[configuration reference](../reference/configuration.md) for every key.

## Prerequisites

| Requirement | Check |
| --- | --- |
| A clone of the harness, installed | `bin/install --check` exits 0 or 2 — the freshness gate accepts both |
| `conduct-ts` on PATH resolving to this checkout | `readlink -f "$(command -v conduct-ts)"` |
| `tmux` installed | `tmux -V` |
| `gh` authenticated | `gh auth status` |
| A daemon build token | `conduct-ts build-auth-status` prints `state=valid` |

`bin/install --check` exit codes: `0` clean, `1` drift, `2` everything else clean but the build-auth
check failed.

## Step 1 — Install and register

```bash
./bin/install
conduct-ts register .
```

`bin/install` symlinks the skill catalogs, builds the engine into `src/conductor/dist-versions/<id>/`
and flips the `dist` symlink, links `~/.local/bin/conduct-ts`, and writes the harness permission and
hook entries into `~/.claude/settings.json`.

Nothing under `src/conductor/dist` is committed, so a fresh clone has **no engine** until
`bin/install` or `npm run build` runs.

You should see `Registered ai-conductor (<abs path>).` from `register`.

## Step 2 — Provision build auth

The daemon builds under its own credentials, not yours. In the default `daemon-token` mode it reads a
token from `~/.ai-conductor/build-auth`.

```bash
claude setup-token
conduct-ts build-auth-status
```

Run the mint command in an interactive terminal — its output may not appear otherwise. Then:

```bash
chmod 600 ~/.ai-conductor/build-auth
```

`build-auth-status` prints one line, `build-auth-status: mode=<mode> state=<state> …`:

| State | Exit | Meaning |
| --- | --- | --- |
| `valid` | 0 | Token present and live |
| `api-key` | 0 | `build_auth.mode: api-key` — no daemon-owned token to check |
| `missing` / `unreadable` / `invalid` / `unverifiable` | 1 | Remediation guidance is printed |

A daemon-token build with a missing or unreadable token writes `.pipeline/HALT` before dispatch —
preserving any HALT already there — and does **not** consume the feature's retry budget. The
build-auth preflight is skipped entirely when the preferred build provider is `codex`; see
[multiprovider](multiprovider.md).

Point `harness_self_host.build_auth.token_path` elsewhere if you keep the token somewhere other than
the default.

`build-auth-status` reports the same merged config (project `.ai-conductor/config.yml` deep-merged
over `~/.ai-conductor/config.yml`) that a real self-host dispatch resolves — including `build_auth` set
in your **user**-level config. `harness_self_host` is an ordinary deep-merge key, not one of the
project-only-injected keys (see [configuration reference](../reference/configuration.md)), so a
`build_auth.mode: api-key` left in `~/.ai-conductor/config.yml` from a previous project or experiment
silently applies to every project you self-host afterward, even one whose own config never sets
`build_auth`. If a build unexpectedly halts on a missing `ANTHROPIC_API_KEY`, check
`~/.ai-conductor/config.yml` for a stale override before assuming the token is broken.

## Step 3 — Start the daemon

```bash
conduct-ts daemon start
```

Everything in [running the daemon](running-the-daemon.md) applies unchanged: park before touching git
state, never bulk-delete worktrees, the branch is the source of truth, and a manual PR is not a
finish.

## The configured flow on this repo

This repo's `.ai-conductor/config.yml` makes two changes to the default step sequence and one to
provider routing. None of them is the default — see [steps reference](../reference/steps.md) and
[models reference](../reference/models.md) for that.

```yaml
llm_provider: [codex, claude]

steps:
  explore:
    llm_provider: claude
  prd:
    llm_provider: claude
  architecture_review:
    llm_provider: claude
  conflict_check:
    llm_provider: claude
  coherence_check:
    llm_provider: codex
  build_review:
    llm_provider: claude
  prd_audit:
    llm_provider: claude
  architecture_review_as_built:
    llm_provider: claude
  rebase:
    llm_provider: codex
  finish:
    llm_provider: claude
  manual_test:
    disable: true
  maintain-documentation:
    llm_provider: claude
    after: rebase
    skill: .agents/skills/maintain-documentation/SKILL.md
    enforcement: gating
    completion_artifact: .pipeline/maintain-documentation-pass
  release-disposition:
    llm_provider: codex
    model: gpt-5.6-terra
    after: maintain-documentation
    skill: .agents/skills/release-disposition/SKILL.md
    enforcement: gating
    completion_artifact: .pipeline/release-disposition-pass
```

**Execution runs on Codex; most design and audit judgement runs on Claude.** The run-level ladder
puts `codex` first, so `build` and the mechanical steps dispatch there with `claude` behind them.
The design, review, audit, documentation, and finish steps that remain pinned to
`llm_provider: claude` still fall back to `codex`, because a step-level selection is prepended to
the run-level list rather than replacing it. `coherence_check`, `rebase`, and
`release-disposition` deliberately use Codex. See
[multiprovider](multiprovider.md).

**`manual_test` is disabled.** The harness's own features are engine and CLI changes covered by the
vitest suite and the integrity script, so a dispatched manual-test session costs tokens without
adding signal. The step is marked `skipped`, which satisfies its downstream prerequisites exactly
like a tier skip. `manual_test` is the only gating step whose definition opts into config-disable;
structural steps can never be disabled, and disabling any other gating built-in is a hard config
error.

**`maintain-documentation` is inserted after `rebase`.** It is a custom step: any `steps.<name>` key
that is not a built-in step name is treated as an addition, spliced immediately after its `after`
target. It inherits `rebase`'s phase (SHIP) and takes `prerequisites: [rebase]`. Because `rebase` is
a loop gate, the custom step joins the gate-driven SHIP tail loop.

The resulting tail is:

```text
rebase → maintain-documentation → release-disposition → finish
```

With no config, that tail is `rebase → finish`.

The step is `gating`, so a failure HALTs an auto-mode run rather than being skipped. Its completion
is proven by `completion_artifact: .pipeline/maintain-documentation-pass`, checked fail-closed:

| Condition | Verdict |
| --- | --- |
| No attempt or session freshness floor available | Not done |
| Artifact missing | Not done — "must write it after a passing review" |
| Artifact is not a regular file | Not done |
| Artifact mtime older than the freshness floor | Not done — "is stale; must rewrite it during this attempt" |
| Fresh regular file | Done |

The skill writes the marker only after a PASS verdict, and removes it before starting work — so a
stale PASS from a previous attempt can never satisfy the gate. See
[evidence model](../explanation/evidence-model.md) for why completion is proven rather than asserted.

The skill lives at `.agents/skills/maintain-documentation/SKILL.md` and is symlinked from
`.claude/skills/maintain-documentation`. A repository-local test asserts the two are byte-identical
and that the configured tail is exactly
`rebase → maintain-documentation → release-disposition → finish`.

## The live boundary

Before a self-host build runs, the engine fingerprints two surfaces with a per-file sha256 manifest
(symlinks hashed via `readlink`), and re-verifies them when the candidate tears down:

1. **The live checkout** — the harness checkout the daemon itself is running out of.
2. **Unrelated provider state** — `~/.claude` or `~/.codex`, whichever the selected provider owns.

A mismatch is fail-closed: the run halts, the engine writes `.pipeline/HALT` with kind `mechanical`,
and no further work is dispatched. A verification that itself fails is coerced to a mismatch (`Live
boundary could not be verified.`). There is no config key — this is unconditional for self-host
provider preparation.

The halt lands at the **next dispatch boundary**, not on the dispatch that was in flight. Teardown
runs after the step it guards has already produced its result, and the window it covers is the whole
step — so the change it catches is, by construction, something that happened while that step was
running. The step therefore keeps its own verdict (its real success or its real failure), and the
violation is enforced before anything else runs: the next retry attempt, the next step (including a
parallel-group fan-out), or the point where the loop would otherwise converge. Detection is
unaffected; a violated run still stops, and the completed step's work is preserved for the re-kick
instead of being discarded and redone.

Each surface carries its own exclusion list, filtered **during** the walk so an excluded subtree is
never descended into.

### Live-checkout exclusions

Five state paths the harness writes itself while a build runs, plus dependency trees whose exact
directory basename is `node_modules`:

| Excluded path | Why |
| --- | --- |
| `.git` | The shared git dir; commits and fetches from inside the sandboxed worktree rewrite objects, refs, logs, and the index here |
| `.daemon` | Daemon runtime state; `daemon.log` is appended continuously |
| `.worktrees` | The per-feature checkouts the build is supposed to mutate — they fall inside the surface only because the live checkout and the project root are the same directory |
| `.pipeline` | Per-run pipeline state written into the live checkout's own directory while a self-host build is in flight |
| `.claude/worktrees` | Throwaway checkouts agents isolate into. Scoped to this subtree deliberately: `.claude/settings.json` and `.claude/hooks/` are harness state the guard must keep protecting |
| `node_modules` (at any depth) | Installed dependencies and tool caches, including Vitest's `.vite/vitest/results.json`; lookalike names such as `node_modules-notes` remain fingerprinted |

None of these is harness source. The guard does not broadly honor `.gitignore`, so everything it
exists to protect stays fingerprinted. When the manifest changes, the engine asks Git to classify
every differing live-checkout path. A modification or deletion that Git reports for an
already-tracked file is treated as concurrent operator work and does not halt the build. Any
untracked path, unexpected Git status, or failed Git classification still halts the build.

**Operator consequence.** Because the guard cannot attribute a change, ordinary interactive work in
the live root checkout can halt a running build — the 2026-08-04 halt of
`mechanically-verify-llm-rebase-conflict-resolution` cost a passing `build_review` when a session
granted a Bash permission and wrote the checkout's untracked `.claude/settings.local.json`.
Read-only commands and edits to already-tracked files are safe; anything that creates, stages, or
rewrites an untracked path is not. The full safe/unsafe list and the recovery steps are the
live-checkout rule in `AGENT_INSTRUCTIONS.md`'s **Daemon Operations Safety** section; issue #1301
tracks the attribution machinery that would remove the false-halt class.

Git identifies tracked state, not the process that wrote the file. The accepted residual gap is
that a sandbox escape which modifies an already-tracked file is indistinguishable from an operator
edit and is therefore not detected by this guard. Untracked-file and provider-state detection
remain fail-closed.

### Provider-state exclusions

This surface is a leak detector, not self-bookkeeping. The sandboxed build gets a throwaway provider
home, so the live one should never change at all — every exclusion here trades away real detection
power. The list is explicit and provider-specific, selected by the provider the build resolved to:

| Provider | Excluded | Also excluded |
| --- | --- | --- |
| `claude` | `history.jsonl`, `.last-cleanup`, `plugins/known_marketplaces.json`, `shell-snapshots`, `backups`, `sessions`, `session-env`, `projects`, `tasks`, `.last-update-result.json`, `stats-cache.json`, `mcp-needs-auth-cache.json`, `cache`, `file-history`, `paste-cache` | the selected auth file, `.credentials.json` |
| `codex` | `history.jsonl`, `sessions`, `shell_snapshots`, `cache`, `plugins/cache`, `plugins/.remote-plugin-install-staging`, `mcp-oauth-locks`, `thread-writer-locks`, `.tmp`, `tmp`, `packages/standalone`, `models_cache.json`, and any root-level `*.sqlite`, `*.sqlite-shm`, `*.sqlite-wal`, `*.sqlite-journal` | the selected auth file, `auth.json` |

Three entries carry extra caveats:

- **`file-history` (Claude).** The CLI snapshots every file it edits into
  `file-history/<session-uuid>/`, so *any* concurrent interactive session editing a file used to trip
  the guard. The sandboxed build writes its snapshots under its own throwaway `CLAUDE_CONFIG_DIR`, and
  the subtree holds edited-file content only — never config, hooks, or credentials — so excluding it
  costs no leak detection.
- **Codex `*.sqlite*` (a pattern, not a list).** The trailing digit in `state_5.sqlite` is Codex's
  schema generation. Enumerating the names meant every generation bump (`state_5` → `state_6`) or new
  store left an unexcluded file churning through its `-wal`/`-shm`, halting every self-host build
  until the list was patched. The `*` matches a **root-level basename only**: a nested lookalike such
  as `skills/state_9.sqlite-wal` still trips the guard, and the live-checkout surface declares no
  patterns at all, so a `*.sqlite-wal` in the harness checkout is still fingerprinted.
- **Codex `thread-writer-locks` (churn that appears, not changes).** Codex writes one zero-byte lock
  per *open* thread and deletes it when the thread closes, so this subtree trips the guard by paths
  **appearing and vanishing** rather than by content changing — a halt reason of the form
  "4 added, 0 removed, 0 changed" with no file the operator ever touched. Because the locks only
  exist while a thread is open, the halt fired only when a concurrent session happened to hold one
  at a dispatch boundary, which made it intermittent and effectively unattributable. The lock's
  existence is its entire signal and its content is always empty, so excluding it costs no leak
  detection.

Every entry is usage, log, or cache telemetry that any concurrent provider process writes whether or
not a build is running. Config surfaces are deliberately **not** excluded: `settings.json` on Claude,
`config.toml` and `hooks.json` on Codex, plus `rules/`, `skills/`, and `CLAUDE.md`. A leak reaching
back into operator config is exactly what this surface exists to catch, and no diff distinguishes that
from an unrelated interactive session editing the same file. The accepted cost is that an interactive
session changing `settings.json` — or `config.toml`/`hooks.json` on Codex — during a build HALTs that
build even though the build did nothing wrong.

The practical consequence: editing or deleting an already-tracked harness file is safe while a
self-host build runs. **Do not create untracked files in the live harness checkout or edit your
provider config during the build.** Use the feature worktree for new files, or park the feature
first.

## The engine republish loop

Under self-host, and only under self-host, the daemon keeps its own engine current before each
dispatch:

1. **Fast-forward the checkout.** The daemon fetches and fast-forwards the harness checkout to origin
   so the rebuild sees merge-driven drift rather than a stale local branch. Throttled by
   `engine_refresh_min_interval_seconds` (default 300) so an idle daemon does not fetch every poll.
   Degraded outcomes with a determinable origin head (dirty tree, diverged branch, failed fetch) are
   routed into a deduped staleness warning; clean outcomes never warn.
2. **Rebuild the engine.** It runs `npm run build` inside `src/conductor` as a subprocess. That is a
   content-addressed publish: build into a staging dir, finalize it as an immutable
   `dist-versions/<id>/`, then atomically flip the `dist` symlink. It no-ops when the source key is
   unchanged, and the running daemon is never disturbed because it executes from its own pinned
   `dist-versions/<id>` rather than the floating symlink. A non-zero build is logged and the daemon
   degrades to the current engine; it never restarts on a failed rebuild.
3. **Restart when stale.** With `auto_restart_on_stale_engine: true` (armed in this repo's config),
   the daemon compares its running engine against what `dist` now points at, and requests a restart
   at the next idle boundary. It fires only when quiescent, so a restart never interrupts an
   in-flight build.

The restart gate needs all four of: continuous mode, self-host active, the config flag enabled, and
the checker armed. A bare `conduct-ts daemon` drain (`--once` semantics) never auto-restarts.

`npm run build` is the only supported entry point. Running `tsup` directly is refused:
`Refusing to run tsup directly: the engine build now uses a versioned dist-versions/<id> + dist
symlink layout that raw tsup output would clobber.`

Because the config is read at daemon startup, a change to `.ai-conductor/config.yml` needs a restart
to take effect:

```bash
conduct-ts daemon restart
```

## The self-host finish gates

Two gates run before the `finish` dispatch on a self-build. Both HALT rather than opening a PR.

**Version approval.** Compares `.pipeline/version-approval` against `VERSION`:

| Situation | Outcome |
| --- | --- |
| Marker present and equal to `VERSION` | Pass |
| Marker present and different | HALT — `VERSION-bump approval mismatch` |
| No marker, `version_freeze` equals `VERSION` | Pass; the marker is written as audit evidence |
| No marker, `version_freeze` set but different | HALT — a freeze never approves an actual bump |
| No marker, no freeze, change set signals a patch | Pass; a version signal record is written |
| No marker, no freeze, change set signals minor or major | HALT, naming the signalling files |
| No marker, no freeze, no signal | HALT — "The daemon does not invent a version." |

This repo declares a `version_freeze`, so ordinary features pass without a per-feature approval
round-trip while a real VERSION bump still stops for a human.

`version_freeze` accepts three shapes:

| Value | Meaning |
| --- | --- |
| `"0.99.20"` (a pinned string) | Frozen at exactly that version. Must be bumped by hand when `VERSION` moves. |
| `"latest"` | Tracks the repo's resolved base branch (the same discover-default-branch/fetch machinery the rebase gate uses — never hardcoded to `main`): the effective freeze is that branch's current `VERSION` file contents. |
| `"branch:<name>"` | Tracks an explicit branch instead of the auto-discovered default, e.g. `"branch:release"`. |

For `"latest"` and `"branch:<name>"`, resolution fetches the tracked branch and reads its `VERSION`
at gate-check time; any git/network failure (no origin, branch not found, fetch failure) fails
closed — the freeze resolves to no value, and the gate falls through to signal classification /
HALT exactly as if no freeze were declared. A freeze still never approves an actual bump: if the
worktree's own `VERSION` differs from the tracked value, the gate HALTs as usual.

**Release artifact.** Runs the integrity suite (`test/test_harness_integrity.sh`, 120s timeout), then
the changelog and migration-block check, then waiver evaluation. It HALTs on the **first** failure —
later sub-gates are not consulted. A missing script, a timeout, and a non-zero exit are all HALTs.

The migration requirement fires when the change set touches a breaking surface, or when the change
set cannot be determined at all (fail-closed). Waivers live in `.docs/release-waivers/` and must be
fresh in the same diff. See [releases](../contributing/releases.md) for the canonical surface names,
the waiver format, and when a waiver is the wrong answer.

Both gates write `.pipeline/HALT` with a distinct first line and a shared resume procedure.

## Troubleshooting

**`Required safety protection unavailable: self-host-isolation`.** `sandbox_build_env` is disabled,
or the build worktree is missing its `skills/` or `hooks/` directory. The sandbox fails closed rather
than launching a dangling-link environment; a self-build cannot run without it.

**`<surface> changed during self-host execution — N added, N removed, N changed: …`.** The
live-boundary guard tripped on a path outside its exclusion lists. **The halt reason names the paths**
— read it first rather than re-deriving the diff by hand. Each path is tagged `added`, `removed`, or
`changed`; the list is capped at eight entries followed by `and N more`, and the counts are always
exact. Typical causes are a generated untracked file in the live checkout, a `git` operation outside
`.git`, or an editor save to a provider config file such as `~/.claude/settings.json` from another
session. An ordinary edit or deletion of an already-tracked live-checkout file is classified by Git
and does not produce this halt. If the named path is provider telemetry that no build would write,
it belongs in the exclusion list above. The step that was running when it tripped is recorded with
its own real verdict, so a re-kick resumes after it rather than repeating it; fix or re-baseline
whatever changed, then unpark.

**`daemon start` refuses with an install-drift message.** Run `bin/install --update` and retry. A
stale install leaves newly added skills unregistered, and daemon-dispatched skills then fail
silently.

**The daemon is running a different engine than the one you just built.** `conduct-ts daemon status`
prints `version:<engine-version-id>` per repo. Compare it against
`readlink src/conductor/dist`. A restart picks up the new version; see
[daemon recovery](../runbooks/daemon-recovery.md).

**A gate halted and you want to change what runs.** Do not disable a guardrail to get past it. The
gates are described in [gates](../explanation/gates.md); the validation suite every harness change
must pass is in [validation](../contributing/validation.md).
