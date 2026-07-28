# Running the daemon

Start, observe, pause, park, and stop the background build loop that drains a repo's spec backlog.
For an operator running the harness on one or more repos.

The daemon builds a spec **only after its PR is merged onto the default branch**. It reads
`.docs/plans` and `.docs/shipped` from the committed base-branch tree, never from the working tree,
so an unmerged `spec/<slug>` branch is invisible to it.

## Prerequisites

| Requirement | Check |
| --- | --- |
| `conduct-ts` on PATH | `conduct-ts --help` |
| `tmux` installed (for `daemon start` and every management verb) | `tmux -V` |
| The repo registered | `conduct-ts register <path>` |
| A fresh install | `bin/install --check` exits 0 or 2 — the freshness gate accepts both |
| At least one merged spec on the default branch | `.docs/plans/<slug>.md` present on `main` |

## Fix a discovery rejection

Discovery reads only the default branch. It skips a merged spec, rather than starting a build, when
it logs one of these lines:

```text
skip <slug>: merged spec cannot build — stories not approved (need "Status: Accepted", no DRAFT). Fix the spec on the default branch; logged once.
skip <slug>: merged spec cannot build — plan has no dependency tree ("## Task Dependency Graph" or "**Dependencies:**" lines). Fix the spec on the default branch; logged once.
skip <slug>: merged spec cannot build — missing or unparseable coherence artifact (.docs/coherence/<slug>.md) required for tier <tier>. Author it on the default branch; logged once.
```

The first two reject an unapproved stories artifact or a plan without a task dependency tree. The
third applies only outside tier S: author a parseable `.docs/coherence/<stem>.md` on the default
branch, or verify that the feature is correctly classified as tier S. Each reason is logged once
per slug through `.daemon/warned/<slug>`; the marker suppresses repeated poll warnings until the
spec is fixed.

DECIDE artifacts are human-authored before merge. The daemon pre-seeds every DECIDE step (recording
tier-skipped steps as skipped) and starts at BUILD; it never authors or reruns DECIDE work.

## Start the daemon

```bash
conduct-ts daemon start
```

`start` refuses to launch on a stale install: it runs `bin/install --check` first, and on drift it
either prompts to run `bin/install --update` (interactive) or throws (non-interactive). A stale
install means newly added skills are unregistered and would fail silently mid-build.

On success it creates a tmux session and auto-attaches **read-only**. Detach with `Ctrl-b d`.

| Variant | Result |
| --- | --- |
| `conduct-ts daemon start` on a TTY | Starts and attaches read-only |
| `conduct-ts daemon start -D` | Prints `daemon started (detached). Attach with 'conduct daemon connect'.` |
| `conduct-ts daemon start` with no TTY | Prints `daemon started (no interactive terminal to attach to)…` |

Exit 1 on any error, including a missing `tmux`.

## Watch it work

```bash
conduct-ts daemon status
```

Sweeps the whole project registry and prints one badge line per repo — state, path, pid, since,
engine version id, pause metadata, last log line and its mtime, and tmux session up/down. It then
prints a `GATED:` section and an attribution-agreement line. The nine state badges and what each one
means are in [cli reference](../reference/cli.md#daemon-status); `● running` is the one you want.

`status` exits 0 even when entries are stale or missing — those are reported, not errors. It exits 1
only when the registry itself is unreadable.

For the log:

```bash
conduct-ts daemon logs                  # this repo, whole file
conduct-ts daemon logs --lines 200      # last 200 lines
conduct-ts daemon logs --follow         # stream new lines until Ctrl-C
conduct-ts daemon logs --all            # every registered repo, with ==> path <== headers
```

`--lines`/`-n`, `-f`, and `--repo=<path>` all work but are absent from `--help`. `--follow` with
`--all` prints `--follow is not supported with --all; showing a static snapshot.` and does not
follow. A missing log prints `(no daemon log yet for <path>)`.

Lines a feature run owns are tagged with its slug, so a serial drain of several features stays
readable and greppable:

```text
[daemon] holding daemon lock (pid 12345) for /home/you/code/my-project
[daemon][my-feature-254] ▶ start my-feature-254
[daemon][my-feature-254] · ▶ build
[daemon][my-feature-254] claude: done — 54 turns, 8m7s, $4.96
[daemon][my-feature-254] Implemented the parser and committed.
[daemon][my-feature-254] ·   build via claude (opus) ✓ — 54 turns, 8m7s, $4.96
```

Filter one feature's narrative with `conduct-ts daemon logs | grep '\[<slug>\]'`. Untagged `[daemon]`
lines are daemon-wide, not feature work. The exact shapes and the slug length bound are in
[artifacts](../reference/artifacts.md#line-shapes).

### Provider attribution and result summaries

Two line kinds tell you what a step actually did and which provider ran it — this matters because
providers are routed per step (`llm_provider` top level plus per-step overrides; see
[configuration](../reference/configuration.md)), so the provider executing a given step is not
necessarily the repo default.

- **`<provider>: done — <turns>, <duration>, <cost>`** followed by the agent's own prose is the
  provider subprocess's captured result. Claude's `--print --output-format json` stdout and Codex's
  `exec --json` stdout are machine envelopes; the daemon summarizes the telemetry and prints the
  human-readable result text instead of teeing the raw single-line JSON blob. Output the daemon does
  not recognize as a machine envelope — prose, stderr, crash traces — is still logged verbatim, so
  no diagnostic detail is lost.
- **`·   <step> via <provider> (<model>) ✓ — <turns>, <duration>, <cost>`** attributes the completed
  dispatch. `grep ' via '` over the log answers "which provider ran this step" without inspecting
  process argv. A provider skipped from a cached availability result dispatches no process and is
  not logged; a fallback between providers still prints its own `⚠ PROVIDER FALLBACK` line.

`daemon status` does not yet carry the provider for a step that is still in flight
([#1081](https://github.com/jstoup111/ai-conductor/issues/1081)).

To watch the session itself:

```bash
conduct-ts daemon connect             # attach READ-ONLY
conduct-ts daemon connect --write     # attach READ-WRITE (same as `debug`)
conduct-ts daemon debug               # attach READ-WRITE
```

`Ctrl-b d` detaches from any of these.

If you're already inside a tmux client (an interactive shell in a tmux pane), attaching directly
hits tmux's own nesting guard (`sessions should be nested with care, unset $TMUX to force`). Use
`--attach-into <target>` to deliver the attach into an already-open pane elsewhere on the same
tmux server instead of taking over the current process's terminal:

```bash
conduct-ts daemon connect --write --attach-into mywindow:1.0
```

`<target>` is a tmux session, `session:window`, or `session:window.pane` string. This also works on
`daemon start`.

## Pause and resume dispatch

A pause stops the daemon starting **new** work while leaving in-flight work and the daemon process
alone. It is the right tool when you want the loop to go quiet without killing it.

```bash
conduct-ts daemon pause
conduct-ts daemon resume
```

`pause` prints `daemon paused`, or `already paused` when the marker exists. `resume` prints
`daemon resumed`, or `not paused`. Both are implemented and dispatched, but neither appears in
`conduct-ts daemon --help`.

The marker is `.daemon/PAUSED`. Its existence is authoritative; its JSON body is informational only.
Reads fail closed — an unreadable marker counts as paused.

## Park a feature before you touch its git state

**Park first. Always.** The daemon re-dispatches anything in its backlog and re-creates branches you
delete, and its resume path re-kicks git errors with no backoff. Removing a worktree or branch under
a live daemon produces a `git worktree add` failure loop, not a clean stop.

```bash
conduct-ts daemon park <slug>
```

You should see:

```text
Parked '<slug>' — it will not be dispatched or re-kicked until unparked.
Marked for park: <repo>/.daemon/parked/<slug>
```

Park validates the slug: either `.docs/plans/<slug>.md` or `.worktrees/<slug>` must exist, otherwise
it prints `error: slug '<slug>' not found under <root> …` and exits 1. It resolves the main repo root
via `git rev-parse --git-common-dir`, so it works from the project root or from inside any worktree.
Re-parking an already-parked slug is a no-op that reports when it was originally parked.

An operator park outranks everything: the re-kick sweep checks it first, ahead of the shipped-record
dedup and the per-SHA guard, and preserves a pending `.pipeline/REKICK` sentinel rather than
consuming it.

To release:

```bash
conduct-ts daemon unpark <slug>
```

`unpark` resets the no-evidence attempt counter **first** and removes the park marker only after that
succeeds — a failed reset deliberately leaves the marker in place for retry. You should see
`Unparked '<slug>' and reset no-evidence counter — normal dispatch and re-kick resume.`

> **Known limitation.** `conduct-ts daemon park` with no slug does not print a park usage error. The
> park detector returns null without a slug, `park` is a known sub-verb so the unknown-sub-verb guard
> passes it through, and the invocation falls all the way to the inline refusal, printing
> `conduct: the inline SDLC pipeline now runs under the \`inline\` subcommand.` and exiting 1 — a
> message unrelated to parking. Always pass the slug. Tracked in
> [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

## Operator safety rules

Each of these encodes a failure that has already corrupted daemon state.

1. **Park before you touch a feature's git state.** See the section above. Never unpark, then delete
   — that guarantees a re-dispatch race.
2. **Never bulk-delete worktrees or branches.** Do not `rm -rf` over a glob or a computed set, and
   never loop-delete branches. Enumerate every path explicitly, print the list, confirm it, then
   delete. `mapfile`/`readarray` are bash-only and silently do nothing under zsh — a guard built on
   an unpopulated array deletes everything it was supposed to protect.
3. **The branch is the source of truth; a worktree checkout is disposable.** Removing
   `.worktrees/<slug>` loses that worktree's `.pipeline/` state — the task status and the evidence
   sidecar — which then produces false `no_task_progress` stalls on work that is already committed.
   Recreate the worktree from its branch and recover the evidence rather than letting the build redo
   finished tasks. See [worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md).
4. **A manual PR is not a harness finish.** Opening a PR by hand tells the daemon nothing, so it
   re-dispatches the feature forever and parking is the only stopgap. Record the ship instead —
   see the next section.

## Record a manual finish

```bash
conduct-ts shipped-record --slug <slug> --pr <url>
```

Use `--pr local` for a merge-local finish. This writes and commits `.docs/shipped/<slug>.md` on the
current branch, hashing `.docs/plans/<slug>.md` and its stories file, so the merge atomically records
the ship and the daemon's backlog dedups it.

It is idempotent; identical content already committed produces no duplicate commit. The exit code
proves nothing — the command exits 0 even when it wrote no record, so verify the file before you
rely on it. See
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md#recovery).

## Restart after an engine change

```bash
conduct-ts daemon restart
```

Behavior depends on what the daemon is doing:

| Daemon state | Outcome |
| --- | --- |
| Idle | Clears any stale lock, reconciles an orphaned process, relinks skills, respawns; the outcome message is always printed |
| Paused | Counts as idle — respawns immediately; the pause marker is never touched |
| Busy | Writes `.daemon/RESTART-PENDING` and returns at once with `restart queued: daemon is busy on <slug>; it will restart automatically once idle.` |

`restart` never blocks or polls. A degraded restart (fallback kill-and-recreate, which loses
scrollback) is reported explicitly.

## Fleet operations

`pause`, `resume`, and `restart` accept fleet selectors: `--all`, or one or more bare repo names
after the verb. With a selector the verb iterates the project registry instead of acting on the
current directory. None of these selectors appear in `--help`.

```bash
conduct-ts daemon pause --all
conduct-ts daemon resume <repo-a> <repo-b>
conduct-ts daemon restart --all
```

Each repo is handled in its own try/catch, so one failure never aborts the sweep. Per-repo `restart`
outcomes are: paused → respawn, idle → respawn, busy → queued, stopped with no session →
`daemon started (was stopped)`, error → reported and the sweep continues.

## Stop the daemon

```bash
conduct-ts daemon stop
```

Kills the tmux session. Exit 1 on error.

To halt one in-flight feature rather than the whole loop, see
[emergency stop a running feature](../runbooks/emergency-stop-a-running-feature.md).

## Run the daemon in the foreground

Bare `conduct-ts daemon` runs the loop in the current terminal, with no tmux session and no
supervisor. Use it for a bounded drain or for debugging.

```bash
conduct-ts daemon --continuous --max-items 3 --idle-poll 30
```

Three things shape the run itself. Every flag, its default, and its exact parsing behavior are in
[cli reference](../reference/cli.md#running-the-daemon) — several real flags are absent from
`--help`, and integer flags fall back to their defaults silently rather than erroring.

1. **The run is always serial.** `--concurrency` is accepted, but any value above 1 is clamped to 1.
2. **Bound a `--continuous` run.** With no `--max-items`, `--max-cost`, `--max-runtime`, or
   `--max-idle-polls` it warns and then runs until you `Ctrl-C` it.
3. **Pass `--idle-poll` explicitly** if the polling interval matters. Its effective default does not
   match its help text.

`conduct-ts daemon --help` (or `-h`) anywhere after `daemon` prints the daemon help and exits 0. That
guard runs before every daemon dispatcher on purpose: without it, `--help` would be treated as an
unknown flag and would **launch a daemon run**.

A typo'd sub-verb — anything outside `status`, `logs`, `park`, `unpark`, `start`, `stop`, `restart`,
`connect`, `debug`, `pause`, `resume` — prints `conduct daemon: unknown subcommand '<token>'.`
followed by the daemon help, and exits 1.

## How a halted feature resumes

When a feature halts, the daemon leaves `.pipeline/HALT` in its worktree and stops dispatching it.
On a genuine advance of the base branch SHA, the re-kick sweep runs over every halted worktree and,
per feature:

1. Skips it entirely if it is operator-parked, already shipped, or already re-kicked at this SHA.
2. Aborts a paused rebase if one is mid-flight — a failed abort leaves the HALT marker intact rather
   than half-clearing it.
3. Renames `.pipeline/HALT` to `.pipeline/HALT.cleared`, preserving the reason.
4. Drops a `.pipeline/REKICK` sentinel and records the triggering SHA.

The sweep never dispatches directly; the cleared feature is re-dispatched on the next poll. That is
why a git error left in a feature's worktree gets retried without backoff, and why parking is the
only reliable way to make a feature stay stopped.

## Troubleshooting

**`status` shows `⚠ session-up/process-dead`.** The tmux session outlived the daemon process. Run
`conduct-ts daemon restart`, which reconciles the orphan (SIGTERM, then SIGKILL) and reclaims the
lock before respawning.

**The daemon keeps re-dispatching a feature you already shipped by hand.** You are missing the
shipped record. Park it, then run `conduct-ts shipped-record`. See
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md).

**The daemon is alive but nothing moves.** Check for `.daemon/PAUSED`, a park marker under
`.daemon/parked/`, and the `GATED:` section of `conduct-ts daemon status`. See
[stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md) and
[daemon recovery](../runbooks/daemon-recovery.md).
