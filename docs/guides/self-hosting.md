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

## Step 3 — Start the daemon

```bash
conduct-ts daemon start
```

Everything in [running the daemon](running-the-daemon.md) applies unchanged: park before touching git
state, never bulk-delete worktrees, the branch is the source of truth, and a manual PR is not a
finish.

## The configured flow on this repo

This repo's `.ai-conductor/config.yml` makes two changes to the default step sequence. Neither is the
default flow — see [steps reference](../reference/steps.md) for that.

```yaml
steps:
  manual_test:
    disable: true
  maintain-documentation:
    after: rebase
    skill: .agents/skills/maintain-documentation/SKILL.md
    enforcement: gating
    completion_artifact: .pipeline/maintain-documentation-pass
```

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
rebase → maintain-documentation → finish
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
and that the configured tail is exactly `rebase → maintain-documentation → finish`.

## The live boundary

Before a self-host build runs, the engine fingerprints two surfaces with a per-file sha256 manifest
(symlinks hashed via `readlink`), and re-verifies them when the candidate tears down:

1. **The live checkout** — the harness checkout the daemon itself is running out of.
2. **Unrelated provider state** — `~/.claude` or `~/.codex`, with the selected auth file
   (`.credentials.json` or `auth.json`) excluded.

A mismatch is fail-closed: the engine writes `.pipeline/HALT` with kind `mechanical` and throws. A
verification that itself fails is coerced to a mismatch (`Live boundary could not be verified.`).
There is no config key — this is unconditional for self-host provider preparation.

Five paths under the live checkout are excluded, filtered **during** the walk so an excluded subtree
is never descended into:

| Excluded path | Why |
| --- | --- |
| `.git` | The shared git dir; commits and fetches from inside the sandboxed worktree rewrite objects, refs, logs, and the index here |
| `.daemon` | Daemon runtime state; `daemon.log` is appended continuously |
| `.worktrees` | The per-feature checkouts the build is supposed to mutate — they fall inside the surface only because the live checkout and the project root are the same directory |
| `.pipeline` | Per-run pipeline state written into the live checkout's own directory while a self-host build is in flight |
| `.claude/worktrees` | Throwaway checkouts agents isolate into. Scoped to this subtree deliberately: `.claude/settings.json` and `.claude/hooks/` are harness state the guard must keep protecting |

None of these is harness source, so everything the guard exists to protect stays fingerprinted:
adding, modifying, or deleting a tracked source file under the live checkout still trips it.

The practical consequence: **do not edit the harness checkout while a self-host build is running.**
Edit inside the feature worktree, or park the feature first.

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

**A build halted the instant the daemon wrote a log line.** That is the live-boundary guard tripping
on something outside the five volatile exclusions. Check what changed in the live checkout during the
run — an editor save, a `git` operation outside `.git`, a generated file.

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
