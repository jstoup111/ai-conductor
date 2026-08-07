---
title: `conduct-ts` CLI reference
parent: Reference
nav_order: 2
---

# `conduct-ts` CLI reference

Every command, subcommand, flag, and exit code of the `conduct-ts` engine. Commands are grouped
operator-first: the ones you type, then the ones the engine invokes on your behalf.

The legacy bash `bin/conduct` is deprecated and is not documented here — use `conduct-ts`.

## Launcher

`bin/conduct-ts` is a shim. It parses none of its own arguments and passes everything through to the
bundled engine at `src/conductor/dist/index.js`, resolving the `dist` symlink to a concrete
`dist-versions/<id>/index.js` so a running process is pinned to one engine version. It exports
`ASDF_NODEJS_VERSION` from `src/conductor/.tool-versions` when `asdf` is on `PATH`, then `exec`s node,
so the engine's exit code is the shim's.

| Condition | Message | Exit |
| --- | --- | --- |
| `dist` neither exists nor is a symlink | `conduct-ts: missing …` plus `run 'npm run build' in src/conductor/` | 1 |
| `dist` symlink unresolvable or not a regular file | `conduct-ts: dist symlink is broken (…)` | 1 |
| Uncaught engine error | `Fatal: <message>` | 1 |

`bin/intake-file`, `bin/intake-backfill`, and `bin/quarantine-engineer-signals` are separate entry
points, not `conduct-ts` subcommands.

## `bin/migrate`

```bash
bin/migrate [--yes|-y] [--dry-run]
```

Runs `bin/install --update`, then, from a consumer project, finds runnable `bash migration` fences in
each release through the installed target version. On a project's first run, the lower bound is the
recorded `currentVersion` (or the target version itself, if `currentVersion` is an unparsable channel
identity such as `main@<sha>`); that bound is then pinned into the ledger as its `candidateBaseline`
and used on every later run, so it stays fixed even as `currentVersion` advances. It exports
`HARNESS_DIR` to every block. Blocks are ordered by release version and document position.

`--dry-run` shows the install action and selected migrations without executing or recording them.
Without `--yes`, an interactive run previews each block and accepts `yes`, `no`, `all`, or `stop`;
skipped and stopped blocks remain pending. Without a TTY and without `--yes`, it executes no project
migrations and leaves every block pending. `--yes` executes each selected block without prompts.

After each successful block, the runner records its release and content digest in a per-project,
human-readable ledger under `~/.ai-conductor/migrations/`. A recorded digest is already applied;
changed content at the same release is a new candidate. A failed block stops the run immediately:
earlier successful blocks remain recorded and later blocks remain pending. Unknown flags exit 2.
Every run, including a failure, ends with `Migration summary: applied=<n> skipped=<n> failed=<n>
already-applied=<n>`.

## Exit code conventions

| Code | Meaning | Where it appears |
| --- | --- | --- |
| 0 | Success, or an advisory command that never blocks | most commands |
| 1 | Usage error, validation failure, or a refused operation | most commands |
| 2 | Usage guide printed to stderr | `task`, `evidence`, `derive-feedback` |

Commands that are advisory by contract always exit 0 regardless of outcome: `overlap-scan`, `kpi`,
`shipped-record`, `shipment-evidence audit`, and `render-diagrams` in its default (non-`--check`) mode.

## `conduct-ts inline`

Runs the SDLC pipeline in the foreground.

```bash
conduct-ts inline [options] "<feature description>"
```

The `inline` token is mandatory. A bare `conduct-ts "<feature>"` is rejected with three lines of
guidance and exit 1. Commander declares an `inline` subcommand so `conduct-ts inline --help` renders,
but it never dispatches it — the engine strips the `inline` token first and parses the remainder
against a subcommand-less base program, which is why a free-text feature description is never mistaken
for an unknown command.

| Positional | Arity | Required | Effect |
| --- | --- | --- | --- |
| `[feature]` | 0..1 | conditional | Feature description. Drives slug and worktree naming and auto-resume matching. |

A feature description is required unless at least one state flag is present. The state flags are
`--resume`, `--status`, `--cleanup`, `--reset`, `--diagnose`, `--report`, and `--from`.
Without one, parsing throws `Feature description is required when no state flags are provided` and the
run exits 1.

| Flag | Type | Default | Constraints | Effect |
| --- | --- | --- | --- | --- |
| `--resume` | boolean | `false` | — | With a feature description, honored by the auto-resume gate and clamps the start index. Without one, cleans up merged worktrees, scans `.worktrees/`, and shows a selection menu (exit 1 when no features are found), then repoints `projectRoot`, `pipelineDir`, and the state file at the selected worktree. |
| `--fresh` | boolean | `false` | — | Suppresses auto-resume detection so an existing worktree for the same slug is not silently reused. This is its only effect; it is never passed to the engine's conductor object. |
| `--auto` | boolean | `false` | mutually exclusive with `--interactive` | Run mode `auto`: skips checkpoint prompts, never opens a REPL, sets `dangerouslySkipPermissions` on dispatch, takes the existing tier or defaults to `L` without prompting (one of four tier paths — see [where the tier comes from](steps.md#where-the-tier-comes-from)), auto-skips advisory step failures, and skips the assess-staleness prompt. |
| `--interactive` | boolean | `false` | mutually exclusive with `--auto` | Run mode `interactive`: opens a Claude REPL for every conversational step except `complexity`, `conflict_check`, `architecture_diagram`, `retro`, and `rebase`. `dangerouslySkipPermissions` stays off, so a human approves each action. |
| `--status` | boolean | `false` | — | Prints `## Conductor State` and the state file as pretty JSON, then returns. No provider session. |
| `--from <step>` | string | — | must be a step name | Sets the start index to that step. Also suppresses auto-resume. An unrecognized step name exits 1, printing the invalid value and every valid step name (built-ins plus any config-declared custom steps). |
| `--cleanup` | boolean | `false` | — | Scans resumable features, reads `pr_url` from each `conduct-state.json`, checks whether the PR merged, and prompts `Remove merged worktree "<name>"? [y/n]` per merged feature. Prints a count. |
| `--reset` | boolean | `false` | — | Writes an empty state object, prints `State cleared.`, and returns. |
| `--diagnose` | boolean | `false` | — | Non-mutating. Resolves the worktree, then verifies state completeness. State OK prints `State OK…` and exits 0; gaps print a gap report plus remediation text to stderr and exit 1; an orphaned state exits 1. |
| `--report` | boolean | `false` | — | Read-only. Renders `.pipeline/events.jsonl` as step durations, retry hotspots, and token spend, then exits 0. A report error exits 1. No provider session. |
| `--cooldown <seconds>` | integer | `10` | no range check | Seconds to pause between steps. A non-numeric value parses to `NaN`. |
| `--model <name>` | string | — | alias or full model ID | Overrides the model for every step. Beats every configured source. See [models](models.md). |
| `--effort <level>` | string | — | one of `low`, `medium`, `high`, `xhigh`, `max` | Overrides the effort for every step. Beats every configured source. An invalid level exits 1, printing the invalid value and the valid levels. |
| `--view <mode>` | enum | `full` | `full`, `focus`, `log` | Dashboard layout. Anything other than exactly `focus` or `log` silently coerces to `full`. |
| `--tail-lines <n>` | integer | `20` | `0` disables the pane | Maximum lines of post-step stdout shown in the tail pane. |
| `-h`, `--help` | boolean | — | — | Prints help and exits 0. |

Passing both `--auto` and `--interactive` prints `Error: --auto and --interactive are mutually
exclusive` and exits 1. This is the only hard mutual exclusion in the pipeline surface, and neither
flag's help string mentions it.

### Auto-resume

When a feature description is given and none of `--resume`, `--fresh`, or `--from` is
present, the engine looks for an existing worktree for that slug.

| Detection | Behavior | Exit |
| --- | --- | --- |
| Resumable | Redirects to the worktree and prints `Resuming "<desc>" at <n>/<total> (after <step>). Use --fresh to start over.` | continues |
| Complete, evidence intact | Prompts `Feature "<desc>" is already marked complete (<path>). Start over? [y/N]`; anything but `y` returns | 0 |
| Complete, evidence gaps | Prints the gap report, prompts `Roll back feature_status and resume at the first failing step? [Y/n/q]`; the default deletes `feature_status`, flips each failed step to `pending`, and resumes | continues |
| Orphaned state | Lists the expected worktree locations and two remedies, then refuses | 1 |

Recovery procedures live in [worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md).

### Side effects of a run

An `inline` run creates `.pipeline/`, ensures `.claude/settings.json` exists with project-scoped
permissions, loads `.ai-conductor/config.yml` (a non-`missing` config error exits 1) and the merged
user config, reads or creates `.pipeline/conduct-session-id`, discovers plugins under
`$HOME/.ai-conductor/plugins` and `<projectRoot>/.ai-conductor/plugins`, appends to
`.pipeline/events.jsonl` and `.pipeline/audit-trail/events.jsonl`, may run the `/bootstrap` and
`/assess` prelude, spawns `bin/update --auto` in the background with all failures swallowed, and
creates or cleans git worktrees. OTel export is opt-in and off unless configured.

## `conduct-ts daemon`

Runs the background build/ship loop, or manages one. Procedures are in
[running the daemon](../guides/running-the-daemon.md); this section is the flag surface.

`--help` or `-h` anywhere after `daemon` short-circuits to daemon help and exits 0. That guard is
deliberately checked before every daemon dispatcher — without it, `daemon --help` would be treated as
an unknown flag and launch a daemon run.

A non-flag token after `daemon` that is not one of `status`, `logs`, `park`, `unpark`,
`reclaim-worktree`, `start`, `stop`, `restart`, `connect`, `debug`, `pause`, `resume` prints
`conduct daemon: unknown subcommand '<token>'.` plus the daemon help to stderr and exits 1.

### Running the daemon

```bash
conduct-ts daemon [--concurrency <n>] [--max-items <n>] [--continuous] [--max-cost <tokens>]
                  [--max-runtime <seconds>] [--idle-poll <seconds>] [--max-idle-polls <n>]
                  [--no-watch] [--completed | --all]
```

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `--concurrency <n>` | integer | `1` | Requested worker count. Any value above 1 is clamped to 1 and logged as `concurrency clamped to 1 (serial …)`. |
| `--max-items <n>` | integer | unset | Stop after this many features. |
| `--continuous` | boolean | `false` | Idle-poll instead of draining the backlog once. |
| `--max-cost <tokens>` | integer | unset | Total output-token ceiling for the run. |
| `--max-runtime <seconds>` | integer | unset | Wall-clock ceiling for the run. |
| `--idle-poll <seconds>` | integer | `60` | Seconds between polls when the backlog is empty. |
| `--max-idle-polls <n>` | integer | unbounded | Stop after this many consecutive empty polls. |
| `--no-watch` | boolean | watcher on | Drops the HALT-marker filesystem watcher and relies on polling alone. Not listed in `--help`. |
| `--completed`, `--all` | boolean | `false` | Include already-processed features in the startup dashboard's console output. The persisted log sink never includes them. Not listed in `--help`. |

> **Known limitation.** `--concurrency` accepts any integer, but the run loop clamps every value above
> 1 down to 1, so `--concurrency 4` behaves exactly like `--concurrency 1` and only the clamp notice
> tells you. Real multi-feature concurrency is out of scope for the current run loop (ADR-014 /
> FR-13). Tracked in [#568](https://github.com/jstoup111/ai-conductor/issues/568).

> **Known limitation.** `--idle-poll`'s help string reports a default of 5 seconds; the code supplies
> 60 when the flag is absent, so an unflagged `--continuous` daemon polls once a minute, not every five
> seconds. Pass `--idle-poll` explicitly if the interval matters. Tracked in
> [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

Every integer flag reads the next token, and a token beginning with `--` is treated as absent. So
`conduct-ts daemon --max-items --continuous` silently uses the default for `--max-items` rather than
reporting an error.

`--continuous` with no ceiling — no `--max-items`, `--max-cost`, `--max-runtime`, or
`--max-idle-polls` — prints `WARNING: --continuous with no ceiling … runs unbounded; Ctrl-C to stop.`

When a tmux session for the repo already exists, a bare `daemon` run wires a self-restart handler so a
queued restart respawns the pane at the next idle boundary instead of exiting.

### `daemon status`

```bash
conduct-ts daemon status
```

Takes no flags. Sweeps the project registry and prints one badge line per repo: state, name, path,
`pid`, `since`, `version:<engine-version-id>`, pause metadata, the last log line with its mtime, and
`session:up` or `session:down`. It then prints a `GATED:` section from `.daemon/gated.json`, a
`BLOCKED` section from `.daemon/blocked.json`, and an `attribution agreement: N% (n=…)` line from
`.daemon/attribution-accuracy.jsonl`; all are skipped for repos whose path is missing.

`BLOCKED` is the last completed discovery pass: every line contains the slug, machine-readable
reason, and remediation text, followed by the snapshot age. An empty valid snapshot prints that no
specs are blocked. If the snapshot is missing, malformed, or unreadable, status reports blocked
state unknown rather than implying an all-clear. This is a read-only local-file view: it does not
invoke Git, GitHub, or the network. The daemon startup dashboard does not yet render this section;
that UI work is tracked in [#1332](https://github.com/jstoup111/ai-conductor/issues/1332).

Nine rendered states. `restart-pending` and `dead-pane` are overlays: they take precedence in the
badge, but the underlying liveness and pause facts stay on the row.

| Badge | State | Meaning |
| --- | --- | --- |
| `● running` | `running` | Live pid owns `.daemon/daemon.pid`. |
| `⏸ paused` | `paused` | `.daemon/PAUSED` present, pid alive or absent. |
| `⏸ paused (process dead)` | `paused_dead` | Pause marker present and the pidfile owner is dead. |
| `○ stale` | `stale` | Pidfile present, its owner pid is dead and reclaimable. |
| `· stopped` | `stopped` | No pidfile, or a corrupt one, and no pause marker. |
| `✗ path missing` | `path-missing` | The registered path no longer exists. |
| `✗ unreadable` | `unreadable` | The repo's daemon state could not be inspected. |
| `⏳ restart-pending` | `restart-pending` | `.daemon/RESTART-PENDING` is queued. Renders as `⏳ restart-pending (waiting on <slug>)` when it names a blocking feature. |
| `⚠ session-up/process-dead` | `dead-pane` | The tmux session exists but its pane has died. Never the same as `running`. |

Exit 0 for any sweep, including one that reports stale or missing entries. Exit 1 only when the
registry itself cannot be read. An empty registry prints
`No projects registered. Use conduct register [path] to add one.` and exits 0.

### `daemon logs`

```bash
conduct-ts daemon logs [--repo <path>] [--follow] [--all] [--lines <n>]
```

Reads `.daemon/daemon.log`.

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `--repo <path>`, `--repo=<path>` | path | cwd | Repo whose log is read. |
| `--follow`, `-f` | boolean | `false` | Streams appended lines from the current end of file until SIGINT. `-f` is not listed in `--help`. |
| `--all` | boolean | `false` | Iterates the registry, printing a `==> <path> <==` header per repo. |
| `--lines <n>`, `-n <n>`, `--lines=<n>` | integer | whole file | Tail length. A non-integer or non-positive value is ignored and the whole file is printed. Not listed in `--help`. |

`--follow` with `--all` prints `--follow is not supported with --all; showing a static snapshot.` and
does not follow. A missing log prints `(no daemon log yet for <path>)` and contributes 0. Exit 1 when a
log is unreadable, or when `--all` is used and the registry cannot be read.

### `daemon park` and `daemon unpark`

```bash
conduct-ts daemon park <slug>
conduct-ts daemon unpark <slug>
```

Both act directly on the filesystem before any daemon boot, and both resolve the main repo root via
`git rev-parse --git-common-dir`, so they work from inside any worktree.

`park` validates the slug — either `.docs/plans/<slug>.md` or `.worktrees/<slug>` must exist — and
writes `.daemon/parked/<slug>`. It prints `Parked '<slug>' — it will not be dispatched or re-kicked
until unparked.` plus `Marked for park: <path>`. An already-parked slug prints `'<slug>' is already
parked (originally parked at <ts>) — no change.` and exits 0. An unknown slug exits 1.

`unpark` resets the no-evidence attempt counter first, then removes the park marker, so a failed reset
leaves the marker in place for a retry. A slug that was never parked prints `'<slug>' was not
operator-parked — nothing to do.` and exits 0.

Running either outside a conduct project prints `not inside a conduct project — run 'daemon park
<slug>' from the project root or any directory inside it` and exits 1.

> **Known limitation.** `conduct-ts daemon park` with no slug does not print park usage. The slug-less
> form falls through every daemon dispatcher to the inline refusal and prints `conduct: the inline SDLC
> pipeline now runs under the inline subcommand.` before exiting 1 — a message unrelated to parking.
> Always pass the slug. Tracked in [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

### `daemon reconcile-parked`

```bash
conduct-ts daemon reconcile-parked <slug>
```

Runs the same guarded cleanup the daemon's own idle-tick sweep uses, on demand, for one parked
feature. Like `park`/`unpark`, it validates its argument shape and resolves the main repo root
before any other work, so it works from inside any worktree.

A missing or malformed slug never reaches Git: no slug prints `Usage: conduct daemon
reconcile-parked <slug>` and exits 1; a slug that fails `^[a-z0-9][a-z0-9-]*$` prints `Could not
reconcile '<slug>': invalid-slug` and exits 1.

For a valid slug, the command checks whether the slug's work reached `origin/main` — either a
`.docs/shipped/<stem>.md` record committed there (matched allowing for the `YYYY-MM-DD-` plan-date
prefix), or a local branch ending in `/<slug>` under any prefix that `git merge-base --is-ancestor`
proves is contained in `origin/main`. If neither holds, or the check fails, it prints `Could not
reconcile '<slug>': <reason>` and exits 1. The refusal reason identifies the proof that is missing:

- `branch-missing` — no local branch for the slug is available to prove.
- `no-merge-proof` — the branch is not an ancestor and no merged PR proves its current tip.
- `unmerged-commits` — the branch has commits beyond the merged PR head. The command prints up to
  ten `SHA subject` lines after the refusal, followed by `… and M more` when the list is longer.
- `branch-behind-merged-head` — the local branch tip no longer matches the merged PR head proof.
- `ancestry-check-failed` — Git or merged-PR evidence could not be checked safely.

These refusals leave every branch and worktree in place. If the slug is
merged but `.docs/shipped/<slug>.md` does not exist on `origin/main`, it requests an ST-916
record-repair PR when a merged PR can be found, prints `Could not reconcile '<slug>':
record-missing`, and exits 1 — the same deferral the daemon sweep applies until the shipped record
lands. A shipped record on `origin/main` settles completion on its own, so local per-worktree
`.pipeline/` state that still reads mid-build never refuses cleanup.

Once merged and recorded, it removes `.worktrees/<slug>`, deletes every local
branch for the slug, and unparks the slug — the same three steps
[park before you touch a feature's git state](../guides/running-the-daemon.md#park-a-feature-before-you-touch-its-git-state)
describes doing by hand. It prints `Reconciled '<slug>': worktree-removed, branch-deleted,
unparked` and exits 0. When the branch was already deleted at merge — the normal end state for
shipped work — the middle step reads `branch-absent` instead. When `.worktrees/<slug>` exists on disk
but git never registered it as a worktree, the directory is removed outright rather than refused.
A failure partway through prints `Could not reconcile '<slug>':
worktree-remove-failed`, `branch-delete-failed`, or `unpark-failed` and exits 1, leaving whatever
steps completed in place.

See [park a feature before you touch its git state](../guides/running-the-daemon.md#park-a-feature-before-you-touch-its-git-state)
for the automatic sweep this verb shares its logic with.

### `daemon reclaim-worktree`

```bash
conduct-ts daemon reclaim-worktree <slug>
```

Removes exactly one named, retained feature worktree — the manual counterpart to the automatic
reap described in [retained worktrees](../guides/running-the-daemon.md#retained-worktrees). It
never bulk-deletes: only a single `[a-z0-9][a-z0-9-]*` slug is accepted, so a traversal
(`../other`), a glob (`*`), a path (`nested/path`), a list (`one,two`), or more than one argument
each print `Could not reclaim-worktree '<slug>': invalid-slug` and exit 1.

A slug with no `.worktrees/<slug>` directory prints `No retained worktree to reclaim for
'<slug>'.` and exits 0 — reclaiming an already-gone worktree is not an error. A slug with a resume
in progress prints `Could not reclaim-worktree '<slug>': in-progress` and exits 1, so the verb
never races a live build.

Otherwise it prints `Reclaiming retained worktree: <path>`, removes the worktree, then prints
`Removed retained worktree '<slug>': <path>` and exits 0. A removal failure prints `Could not
reclaim-worktree '<slug>': <error message>` and exits 1, leaving the worktree in place.

Like `park`/`unpark`/`reconcile-parked`, it resolves the main repo root via `git rev-parse
--git-common-dir` before doing any other work, so it works from inside any worktree.

### Daemon management verbs

```bash
conduct-ts daemon start [-D | --detach] [--attach-into <target>]
conduct-ts daemon stop
conduct-ts daemon restart [<name>…] [--all]
conduct-ts daemon connect [--write] [--attach-into <target>]
conduct-ts daemon debug [--attach-into <target>]
conduct-ts daemon pause [<name>…] [--all]
conduct-ts daemon resume [<name>…] [--all]
```

These drive a tmux-hosted supervisor. All exit 0 on success and 1 on any error, including tmux not
being installed. Management verbs and direct daemon runs resolve the main repository root from the
current directory before launch; daemon logs, PID files, and other runtime state therefore stay
under the root `.daemon/` directory even when invoked from a nested package or linked worktree.

| Verb | Behavior |
| --- | --- |
| `start` | Refreshes a stale install first — a stale install never starts a daemon — then starts the session. Auto-attaches read-only when the terminal is interactive and `--detach` was not passed; otherwise prints `daemon started (detached). Attach with 'conduct daemon connect'.` or `daemon started (no interactive terminal to attach to)…`. `--attach-into <target>` (see below) always attaches, even with `--detach` or no TTY. |
| `stop` | Kills the tmux session. |
| `restart` | A paused daemon counts as idle. Busy: writes `.daemon/RESTART-PENDING` and returns `restart queued: daemon is busy on <slug>; it will restart automatically once idle.` Idle: clears a stale lock, reconciles an orphaned process (SIGTERM, 100 ms, SIGKILL, reclaim), relinks skills, and recreates the session. The outcome message always prints, so a degraded restart is visible. |
| `connect` | Attaches read-only. Detach with `Ctrl-b d`. Pass `--write` to attach read-write instead — the same subcommand you already reached for to look, now with input, no need to already know about `debug`. |
| `debug` | Attaches read-write. Unchanged; kept as a discoverable alias alongside `connect --write`. |
| `pause` | Writes the durable pause marker; an already-paused daemon reports `already paused`. Not listed in `--help`. |
| `resume` | Removes the pause marker; a daemon that is not paused reports `not paused`. Not listed in `--help`. |

| Flag | Applies to | Effect |
| --- | --- | --- |
| `-D`, `--detach` | `start` | Skips the auto-attach. Parsed on every verb but only meaningful here. |
| `--write` | `connect` | Requests a read-write attach instead of the default read-only. Ignored elsewhere — `debug` is already read-write. |
| `--attach-into <target>` | `start`, `connect`, `debug` | Delivers the attach into an already-open tmux pane elsewhere on the same tmux server — a session, `session:window`, or `session:window.pane` target string — instead of taking over this process's own controlling terminal. Fixes running any of these from a shell that is itself already inside a tmux client, which otherwise hits tmux's own nesting guard (`sessions should be nested with care, unset $TMUX to force`): the attach command is typed into the target pane via `tmux send-keys`, wrapped in `env -u TMUX` so tmux does not refuse it there. Never touches this process's own stdio, so it works with no TTY and bypasses `start`'s `--detach`/no-TTY skip. Example: `conduct daemon connect --write --attach-into mywindow:1.0` to view-and-drive the daemon in a specific pane you already have open. |
| `--all` | `pause`, `resume`, `restart` | Applies the verb to every registered repo instead of the cwd repo. Not listed in `--help`. |
| `<name>…` | `pause`, `resume`, `restart` | Bare tokens after the verb select named repos from the registry. Not listed in `--help`. |

In fleet mode each repo gets its own error boundary, so one failure never aborts the sweep. Per-repo
`restart` outcomes are paused → respawn, idle → respawn, busy → queued, stopped with no session →
`daemon started (was stopped)`, error → reported and the sweep continues.

## `conduct-ts engineer`

The interactive idea-to-spec loop plus its deterministic primitives. The procedure is in
[the engineer loop guide](../guides/engineer-loop.md).

Two rules apply to every subcommand. `--help` or `-h` is checked before the subcommand's own logic, so
it prints that subcommand's help and exits 0 with zero side effects. Any `--flag` not on a
subcommand's allow-list prints `engineer <sub>: unknown flag '<flag>' — run engineer <sub> --help for
usage.` to stderr and exits 1.

### Launching the loop

| Invocation | Behavior |
| --- | --- |
| `conduct-ts engineer` | Spawns an interactive `claude` session with inherited stdio and the `/engineer` prompt. |
| `conduct-ts engineer --idea "<text>"` | Same, with the idea appended to the prompt. The idea is one-shot — it applies only to the first session. Not declared in `--help`. |
| `conduct-ts engineer <free text…>` | A bare non-flag positional that is not a known subcommand is joined into an idea string. Not declared in `--help`. |
| malformed or unknown flag form | Prints the guide text and exits 0. |

The spawn is `claude --permission-mode <mode> '<prompt>'`, where `<mode>` comes from
[`CONDUCT_ENGINEER_PERMISSION_MODE`](environment.md). If `CLAUDECODE` is set the launch refuses to
nest a second interactive session, prints guidance to run `/engineer` directly, and returns 0.

Before each fresh session, and only when no idea came from the CLI, the loop polls GitHub issues into
the durable inbox and prints `Intake: N issue(s) queued.` for a non-zero N. That poll is skipped
entirely while a background brain loop is alive. Poll failures print and never block.

After each session exits, the loop prompts `Process another idea in a fresh session? [Y/n]` on a TTY.
Non-TTY stdin answers no, so the loop never runs unattended. The child's exit code is returned; a spawn
failure — `claude` not on `PATH`, for instance — prints an actionable message plus the guide and
returns 1.

### `engineer` subcommands

| Command | Syntax | Purpose | Exit codes |
| --- | --- | --- | --- |
| `projects` | `engineer projects` | Prints the registry as JSON. Read-only. | 0; 1 on unknown flag |
| `worktree` | `engineer worktree --project <name> --idea "<text>" [--source-ref <ref>] [--body <text>]` | Resolves the project, resolves the target repo, and creates the per-idea git worktree and branch. Prints `{kind, slug, branch, worktreePath, reconcile}`. With `--source-ref` and no `--body`, loads the Desired-outcome body from the persisted claim record; a missing record degrades to no staging. | 0; 1 on project not found, target resolution error, or worktree creation error |
| `land` | `engineer land --project <name> --idea "<text>" --worktree <path> [--source-ref <ref>]` | Reads machine owner config, performs a fail-fast identity check, then commits the authored spec artifacts in the worktree onto `spec/<slug>`. With `--source-ref`, comments on the issue and advances the ledger to `routed` — advisory, so a `gh` failure never fails the land. On failure the worktree is kept and its path is reported. | 0; 1 on project not found, unresolved identity, or a land failure |
| `handoff` | `engineer handoff --project <name> --branch <branch> --worktree <path> [--source-ref <ref>]` | Opens the spec PR with the `spec` label and with `gh` running inside the per-idea worktree, then removes the worktree and prints `{kind:'pr-opened', url}` or `{kind:'local-commit', branch, repoPath, reason}`. Then starts the target repo's daemon, fire-and-forget. With `--source-ref`, writes back to the ledger and applies the `engineer:handled` label. On failure it records branch evidence and keeps the worktree. | 0, including when worktree removal fails (warned); 1 on project not found, target resolution error, or PR open failure |
| `poll` | `engineer poll` | One synchronous sweep of the GitHub issues adapter, enqueuing every returned envelope into the durable inbox. Prints `{kind:'poll', enqueued, sourceRefs}`. No routing, no timer, no detached process; the ledger dedups, so a second poll enqueues nothing new. | 0; 1 on unknown flag |
| `claim` | `engineer claim` | Claims the oldest unblocked inbox entry. Before selecting work, it reaps stranded `claimed` entries older than `stale_claim_window_hours` (24 hours by default), returns them to pending, and may serve a reaped entry in that same claim. Builds a fresh blocker resolver per call and reads issue labels uncached. Prints `{empty:true}`, `{allBlocked:true, entries:[…]}`, or the claimed envelope. A real claim acks the queue, moves the ledger to `claimed`, and persists a claim record for a later `worktree --source-ref`. | always 0; 1 on unknown flag |
| `forget` | `engineer forget <sourceRef>` | Drops the ledger entry and strips the `engineer:handled` label so `poll` sees the issue again. An absent ref reports `{found:false}` and is not an error. Label removal is best-effort. | always 0; 1 on unknown flag |
| `unclaim` | `engineer unclaim <sourceRef>` | Single-entry maintenance: returns a `claimed` ledger entry without a recorded PR to pending while preserving its original capture time, so it can be claimed again. Missing, non-claimed, or PR-delivered entries report a non-error result and are left unchanged; resolve or forget a delivered entry instead. | 0 for handled or refused entries; 1 on unknown flag |
| `requeue` | `engineer requeue --stale [--older-than <dur>]` | Bulk maintenance: returns stale claimed entries without a recorded PR to pending; PR-bearing claimed entries are reserved for `resolve`/`forget` and never touched. Without `--older-than`, it uses `stale_claim_window_hours` (24 hours by default); the flag supplies a one-run duration override. Entries whose source issue is confirmed closed are removed instead; unconfirmed liveness failures are reported without removal. | 0 after the sweep; 1 on an unparseable `--older-than` or unknown flag |
| `resolve` | `engineer resolve <sourceRef> --pr-url <url> [--branch <branch>]` | Recovers a stranded entry that is `claimed` but never delivered by transitioning it to `done` with `{prUrl, branch}`. The branch is preserved when `--branch` is omitted. A missing entry reports `{found:false}`. | 0; 1 on a `--pr-url` that does not match `^https?://`; 1 on unknown flag |
| `migrate-issue-deps` | `engineer migrate-issue-deps [--confirm]` | One-time prose-to-structured-link dependency migration over open issues. Dry-run by default: prints the proposal, writes nothing, and reports `Dry run — no links written. Re-run with --confirm to apply.` With `--confirm`, applies the links and prints `N link(s) created, M already present.` | 0; 1 when the repo or issue list cannot be resolved; 1 on unknown flag |

`--source-ref` on `worktree`, `--body` on `worktree`, and the `--idea` and free-text launch forms are
all accepted by the code but absent from the root `--help` output.

> **Known limitation.** Omitting a required flag or positional on `worktree`, `land`, `handoff`,
> `forget`, or `resolve` prints the full guide text and exits **0**, not a usage error. A script that
> checks only the exit code will read a malformed invocation as success. Check for the expected JSON on
> stdout instead. Tracked in [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

> **Known limitation.** `engineer land --help` states that land pushes the branch and opens the spec
> PR. It does not — `land` only commits spec artifacts onto `spec/<slug>`; opening the PR is
> `engineer handoff`. Run `handoff` after `land` or no PR is ever created. Tracked in
> [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

## `conduct-ts register`

```bash
conduct-ts register [path]
```

Validates that `path` is an existing git repository, derives `{name = basename, path = absolute,
remote = redacted origin URL}`, and upserts it into the project registry with status `registered`.
`path` defaults to the current directory; a relative path resolves against it, and a leading-`-` token
is never taken as the path.

Prints `Registered <name> (<abs>).` and exits 0. Exits 1 when the path does not exist, is not a git
repository, or the registry write fails. A rejected validation leaves the registry byte-unchanged.

## `conduct-ts create`

```bash
conduct-ts create <name> [--remote <url>]
```

No-clobber scaffold: creates the directory, runs `git init -q`, writes a skeleton `CLAUDE.md`, a
`.gitignore` containing `.pipeline/`, `.daemon/`, and `.worktrees/`, and
`.ai-conductor/config.yml` from `templates/project-config.yml.template`, optionally adds the origin
remote, and upserts the project with status `created`.

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `--remote <url>`, `--remote=<url>` | string | — | Adds `origin`. Never pushes. The registry record stores a redacted form of the URL. |

Prints `Created <name> (<target>).` and exits 0. Exits 1 when the target directory is non-empty —
writing nothing — or when the scaffold or registry write fails. Omitting `<name>` falls through to the
inline refusal and exits 1.

## `conduct-ts config init`

```bash
conduct-ts config init
```

Initializes the current Git repository's `.ai-conductor/config.yml` from
`templates/project-config.yml.template`. A first run prints the created path and exits 0. If the
file already exists, it reports that path, preserves the file byte-for-byte, and exits 0.

The command exits 1 without writing when the current directory is not a Git repository or when the
template cannot be resolved or written.

## `conduct-ts task`

```bash
conduct-ts task start <id>
conduct-ts task done <id>
```

Exactly two positionals: the verb and a task id matching `[A-Za-z0-9._-]+` (for example `7` or
`rem-fr10-1`). A missing or unknown verb, or a missing id, prints the guide to stderr and exits 2.

`start` reads `.pipeline/task-status.json`, flips the matching row's status to `in_progress`, writes it
back atomically, then writes the id into `.pipeline/current-task`. It exits 1 when the status file is
unreadable, corrupt, not an object, or has no `tasks` array; when the id is not found (the error lists
the valid ids); or when either write fails.

`done` reads `.pipeline/current-task`. An absent stamp exits 0 — the command is idempotent. A stamp
holding a different id prints `cannot clear task <id>; current stamp is <other>` and exits 1 with the
stamp untouched. A match removes the stamp. `done` never modifies `task-status.json`; completion is the
gate authority's decision. See [gates](../explanation/gates.md).

## `conduct-ts test-suite`

```bash
conduct-ts test-suite
```

Runs the aggregate verification gate between BUILD and SHIP against the `test_suite` block in
[configuration](configuration.md). Takes no arguments; any extra argument prints
`Usage: conduct-ts test-suite` plus `Remove extra arguments and rerun. If verification blocks, return
to /tdd or /pipeline before SHIP.` to stderr and exits 1.

| Outcome | Output | Exit |
| --- | --- | --- |
| Pass | `<status>: full test suite PASS (fingerprint <fp>, duration <n>ms)` on stdout | 0 |
| Fail | `FAILED: full test suite evidence=<reason>[ freshness=<reason>]. <guidance> Return to /tdd or /pipeline, fix the failure, then rerun conduct-ts test-suite.` on stderr | 1 |

Failure reasons and their guidance:

| Reason | Guidance |
| --- | --- |
| `missing_config` | Declare `test_suite.command` in `.ai-conductor/config.yml`. |
| `invalid_config` | Fix the `test_suite` block in `.ai-conductor/config.yml`. |
| `invalid_input` | Fix the declared test-suite inputs. |
| `unlaunchable` | Make the declared aggregate command launchable. |
| `timeout` | Fix the suite timeout or the command that exceeded it. |
| `signal` | Fix the suite process termination. |
| `nonzero_exit` | Fix the aggregate suite failures. |
| `preflight_failed` | Fix the full-suite preflight failure. |
| `internal_error` | Fix the full-suite verifier failure. |

This command is dispatched before every other detector and sets the process exit code rather than
exiting immediately. It does not appear in `--help`.

## `conduct-ts scoped-run`

```bash
conduct-ts scoped-run <selectors...>
```

Runs the configured scoped test command for one or more selectors. It expands the selectors only at
the `{selectors}` placeholder in `test_suite.scoped_command`; see [configuration](configuration.md).
It does not run the aggregate `test_suite.command` or create, replace, or reuse aggregate verification
evidence.

At least one non-blank selector is required. An empty selection exits 1 and directs the caller to the
shared aggregate verifier. If `test_suite.scoped_command` is not configured, it exits 1 without falling
back to the aggregate command. A selected-test failure returns that command's nonzero exit code; a
successful selected run exits 0. This command does not appear in `--help`.

## `conduct-ts shipped-record`

```bash
conduct-ts shipped-record --slug <slug> --pr <url|local>
```

Writes and commits `.docs/shipped/<slug>.md` on the current branch. Run it in the feature worktree, on
the implementation branch, before the final push, so the merge that lands the code atomically lands the
fact that the spec shipped and the daemon stops re-dispatching it. Never run it for a `keep` or
`discard` finish — nothing shipped, so there is no record.

| Flag | Type | Required | Effect |
| --- | --- | --- | --- |
| `--slug <slug>` | string | yes | The plan stem to record. |
| `--pr <url\|local>` | string | yes | The PR URL, or the literal `local` for a merge-local finish. |

It resolves the plan identity, hashes `.docs/plans/<slug>.md` and its stories file — the plan's
`**Stories:**` reference first, then `.docs/stories/<slug>.md` — renders the record with a cost block
when one can be computed, then `git add`s the file and commits it as `shipped record: <slug>` only when
the staged content actually changed. Identical already-committed content produces no duplicate commit.

It also appends a `## Time` block computed independently from `.pipeline/events.jsonl`, reporting
`state: measured|partial|unavailable` with `active_ms`, `provider_active_ms`, and
`no_provider_active_ms` when measured. A missing or corrupt event ledger, or any timing-computation
failure, never blocks the Cost block or the commit — the record ships with `state: unavailable` instead.

The frontmatter also carries `engine_version`: the engine build id that shipped the feature — the same
value `conduct-ts daemon status` prints as `version:<id>`. It is resolved from the running engine's own
module path, so a published build records e.g. `20260727T234833Z-b5b34bb9f015` and an unpublished
source checkout records `dev`. Resolution never throws and never blocks the record. Records written
before this field existed simply omit the line, and `conduct-ts kpi` reports those as
`engine=unknown`.

Either flag missing prints the usage guide to stderr and exits 1.

Every other failure exits **0** with one warning and no record written, so the exit code cannot be
used to detect success. See
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md#recovery).

Does not appear in `--help`.

## `conduct-ts kpi`

```bash
conduct-ts kpi
```

Read-only report over the cost blocks in committed `.docs/shipped/*.md` records. Accepts and ignores
any trailing arguments. Always exits 0: a missing or empty `.docs/shipped` prints a friendly message
rather than an error, and malformed records do not throw. Does not appear in `--help`.

Each per-feature row carries `engine=<id>`, the engine build that shipped it, so ships can be
attributed to a daemon build. A record written before engine-version stamping reports
`engine=unknown` rather than omitting the field, keeping unattributed ships visible in the report.
Rows also show token, cache, dispatch, retry, halt, duration, and cost totals. Cost-unmetered
dispatches are marked `COST-PARTIAL`, retain their tokens, and render their cost as unavailable;
truly unmetered dispatches remain excluded from both aggregates. Provider rows attribute tokens,
cost, cost-unmetered dispatches, and dispatch counts by provider.

Each row also reports engine-observed execution time, parsed from the record's `## Time` block
independently of Cost: `time=measured active_ms=<n> provider_active_ms=<n> no_provider_active_ms=<n>`
splits durable feature wall-clock time into time spent inside a provider process versus engine/code
time; `time=partial` (optionally with `active_ms`) or `time=unavailable` mark evidence that could not
be trusted, and a record with no `## Time` block — including every record shipped before this
section existed — reports `time=unavailable`. The aggregate line adds `timing measured=<n>
partial=<n> unavailable=<n>` counts and `avg_active_ms`/`avg_provider_active_ms`/
`avg_no_provider_active_ms`, averaged only over measured features.

## `conduct-ts memory setup`

```bash
conduct-ts memory setup [dir]
```

Prepares the memory store for a project. `dir` defaults to the current directory; a relative path
resolves against it.

| Existing `.memory/` | Action |
| --- | --- |
| A real directory | Copy-verify-swap migration, logging `conduct memory setup: migrating existing .memory/ in <dir>` |
| Absent, or already a symlink | Creates the canonical store and symlink; idempotent |

Prints `conduct memory setup: .memory/ is ready at <dir>` and exits 0. Exits 1 when the directory does
not exist or anything throws. Only the exact two-token form `memory setup` matches. Does not appear in
`--help`.

## `conduct-ts halt-issues sweep`

```bash
conduct-ts halt-issues sweep --repo-dir <dir> --gh-repo <owner/name>
                             [--monitor-log <path>] [--ledger <path>] [--dry-run]
```

Parses the halt monitor log, loads or rebuilds the ledger, stamps, resolves, or closes each entry
against the issue tracker, writes the ledger atomically, and prints a summary.

| Flag | Type | Required | Default |
| --- | --- | --- | --- |
| `--repo-dir <dir>` | path | yes | — |
| `--gh-repo <owner/name>` | string | yes | — |
| `--monitor-log <path>` | path | no | `~/.ai-conductor/halt-monitor/monitor.log` |
| `--ledger <path>` | path | no | `~/.ai-conductor/halt-issues/ledger.json` |
| `--dry-run` | boolean | no | `false` — with it, the ledger is not written |

`--help` or `-h` prints usage to stdout and exits 0. A missing required flag or any unrecognized
`--flag` prints usage to stderr and exits 1 — a misused subcommand never falls through to the pipeline
launcher. Otherwise the exit code is the sweep's own; an unrecoverable error prints `halt-issues sweep
failed: <msg>` and exits 1. Requires network access through `gh`.

## `conduct-ts overlap-scan`

```bash
conduct-ts overlap-scan [--files <a.ts,b.ts>] [--source-ref <owner/repo#N>] [--base <ref>] [--cwd <dir>]
```

| Flag | Type | Default | Effect |
| --- | --- | --- | --- |
| `--files <list>` | comma-separated paths | none | Candidate paths. Split on commas, trimmed, empties dropped. |
| `--source-ref <ref>` | string | unset | Linked issue reference swept for open blockers. |
| `--base <ref>` | string | the origin default branch, else `main` | Base branch that sibling branches are diffed against. |
| `--cwd <dir>` | path | current directory | Repository to scan. |

Advisory by contract: it always exits 0. Even an unexpected error prints `overlap-scan: unable to
complete scan (<msg>)` and still returns 0. Reads git and queries `gh`; writes nothing.

## `conduct-ts plan-protected-targets`

```bash
conduct-ts plan-protected-targets .docs/plans/<feature>.md
```

Blocking plan-authoring check for tasks that name another feature's artifact under
`.docs/architecture/`, `.docs/plans/`, `.docs/specs/`, or `.docs/stories/`. It reads exactly the
named plan, resolves each task's `**Files:**` set (including `same` inheritance), and writes nothing.
Own-feature paths and unsealed `.docs/` paths pass.

| Outcome | Output | Exit |
| --- | --- | --- |
| No violations | `No protected-target violations found.` | 0 |
| Violation | One `Task <id>: <path>` line per offending path | 1 |

Run it before committing a plan. Correct the accepted artifact during DECIDE and re-author the task;
do not hand the amendment to BUILD. The land gate repeats this check when a spec is landed.

## `conduct-ts evidence`

```bash
conduct-ts evidence
```

The `evidence judge` gate was removed — per-task commit stamping is telemetry, not a gate, and
citation-quality sampling now runs as a non-blocking spot audit. The command survives only so the token
resolves to a clear message instead of an unrecognized-command error. Any argument form prints the
retirement notice and exits **2**. The help string does not mention the non-zero exit.

## Internal commands, invoked by the engine

These are dispatched by skills, hooks, and the daemon rather than typed by an operator. None appear in
`--help`. They are listed so a name found in a log or a hook script is findable.

| Command | Syntax | Purpose | Exit codes |
| --- | --- | --- | --- |
| `intake-loop` | `conduct-ts intake-loop --continuous \| --once [--interval-ms <n>]` | Polls registered repos into the durable inbox, notifies through the status surface, and reconciles closed GitHub issues each tick so a closed issue cannot be re-claimed. Never spawns a provider session and never opens a PR. `--interval-ms` defaults to 300000. Exactly one of `--continuous` and `--once` is required. | 0 on completion; 1 for the usage guide |
| `brain start\|stop\|status` | `conduct-ts brain <verb>` | Host-wide singleton that hosts `conduct-ts intake-loop --continuous` in the tmux session `cc-brain-conductor`. `start` is idempotent; `status` prints `brain loop: running\|stopped` and a queued count. | 0; 1 on a tmux error |
| `render-diagrams` | `conduct-ts render-diagrams <file.md>… [--check]` | Renders the Mermaid blocks in each file using the configured `mermaid_renderer` preset. `--check` parse-checks blocks without opening them. | Default mode always 0. `--check`: 1 when any block fails to parse or a file is unreadable; 0 when everything parses, there are no diagrams, or `mmdc` is unavailable. Zero files: 1 |
| `shipment-evidence` | `conduct-ts shipment-evidence --pr <url> [--event <path>]` · `shipment-evidence reconcile --pr <url> --shipped <YYYY-MM-DD>` · `shipment-evidence audit [--report <path>]` | Classifies, repairs, or audits the association between a PR and its shipped record. `audit` is report-only and never writes records. `reconcile` requires `GITHUB_REPOSITORY`. | check: 0 valid or not-applicable association, 1 otherwise. reconcile: 0 unless unresolved. audit: 0. Malformed: 1 |
| `finish-record` | `conduct-ts finish-record --choice <pr\|keep> [--pr-url <url>] --pipeline-dir <dir>` | Records the finish choice. `--choice pr` requires `--pr-url`; `--choice keep` must not carry one; `discard` is not accepted. `--pipeline-dir` must be an absolute path to an existing directory, checked before any spawn or write. The `pr` path is fail-closed across seven checks — PR binding, upstream push, state readability, branch shape (`spec/<slug>`, `feature/<slug>`, or the daemon's `feat/daemon-<slug>` — a bare `feat/<name>` is refused), slug derivability, `git rev-parse HEAD`, and a valid shipment-evidence verdict. | 0; 1 on any guide or failed check |
| `manual-test-record` | `conduct-ts manual-test-record --skip --reason <r> --pipeline-dir <dir>` · `conduct-ts manual-test-record --results <path\|-> --pipeline-dir <dir>` | Appends a `## Attempt N` section to `<pipelineDir>/manual-test-results.md`, atomically. `--results -` reads stdin. `--skip` and `--results` are mutually exclusive and one is required. `--pipeline-dir` must be absolute. | 0; 1 on a usage error, an empty results payload, or any read/write error |
| `derive-feedback` | `conduct-ts derive-feedback --sha <sha> [--plan <path>]` | Read-only advisory check for whether commit `<sha>` carries `Task: <id>` evidence, or touches files declared under a task in the given plan. Prints one JSON line. Never writes task status or the evidence sidecar. | **0 evidenced, 1 not evidenced, 2 usage.** Informational only — the calling hook must not propagate them |
| `build-auth-status` | `conduct-ts build-auth-status` | Reports the self-host build auth mode and token state as `build-auth-status: mode=<mode> state=<state>[ path=<path>][ (<detail>)]`. Probes the real dispatch auth path when a token is present. | 0 when the mode is not `daemon-token` (`state=api-key`) or the token is `valid`; 1 for `missing`, `unreadable`, `invalid`, or `unverifiable`, each with a remediation message |
