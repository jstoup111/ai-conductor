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

### Protected-artifact rebaselines

The daemon distinguishes a stale pre-rebase seal from a genuine protected-artifact mutation:

```text
Protected artifact rebaseline: trigger=proactive-rebase fromCommit=<old> toCommit=<new> paths=<paths>
Protected artifact rotation refused: condition=<condition> path=<path>
```

The first line is successful recovery: the engine proved the protected artifacts came from the
base branch and rotated the seal. `defensive-history-rewrite` is the equivalent verification-time
trigger for a seal stranded by an earlier rebase. The refusal line is a real guardrail failure;
read its condition and path, then follow the
[stalled-feature runbook](../runbooks/stalled-or-stuck-feature.md#the-halt-is-a-protected-artifact-violation).
Never delete or rewrite `.pipeline/protected-artifact-seal.json` by hand.

An approved plan or architecture amendment after first BUILD intentionally makes the existing seal
baseline stale. Review and reseal the approved paths with the runbook's audited engine rotation
before clearing the HALT. If the refusal occurs during REKICK before git starts, the HALT begins
`protected-artifact seal error`; it is not a rebase conflict and must not be sent through
`git rebase --continue`.

### Provider attribution and result summaries

Three line kinds tell you what a step actually did, which provider ran it, and what the feature
cost in total — the per-step attribution matters because
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
- **`·   finish: total usage — <dispatches>, <cost>, <in>→<out> tok, <n> unmetered`** is logged once,
  when the feature's `finish` step completes. It is the sum of every dispatch that feature recorded
  in its own `.pipeline/events.jsonl` — so it spans the whole build, including steps run in earlier
  daemon dispatches, not just the session that happened to reach `finish`. The same rollup feeds the
  `## Cost` block of the committed `.docs/shipped/<slug>.md`, so the two never disagree.

  Cost and token figures appear only when at least one dispatch was actually metered. A build whose
  provider reported no usage prints its dispatch count and an explicit `<n> unmetered` instead of a
  fabricated `$0.00` — "never measured" must not read as "free". Unreadable or missing event records
  are counted as unmetered for the same reason. The line is best-effort: a feature never fails to
  ship because its cost could not be computed.

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

If an enforcement script still cannot be restored, the build remains halted rather than dispatching
without its attribution gate. The recheck after a repair is authoritative and strict: a script must
exist as an executable regular file at the expected path, so a hook that restored non-executable or
that resolves through a symlink still counts as not restored and halts the build rather than arming.

## When the implementation PR is opened

The implementation PR is opened as a **draft** when the feature enters the SHIP phase — before the
first SHIP step is dispatched — not at `finish`. The engine pushes the feature branch (a plain
push; it never forces) and opens one draft PR against the discovered base branch, with a
placeholder title and body.

This exists so the PR *number* is available for the whole ship tail. `conduct-ts
finalize-changelog-pr` can substitute the `{{IMPLEMENTATION_PR}}` CHANGELOG token during the phase
instead of only inside the finish turn; previously a missed substitution left a literal token that
the finish completion gate refused, cycling the feature back through SHIP.

What the draft window does and does not mean:

- **Nothing merges it.** A draft PR cannot be merged, and the mergeable sweep excludes drafts from
  its autoresolve and CI-fix candidates, so no remediation runs against an in-flight build's own PR.
- **`finish` flips it ready.** The finish step authors the real title and body and marks the PR
  ready for review; the finish completion gate then re-reads the PR and refuses to converge while it
  is still a draft. `/finish` still commits `.docs/shipped/<slug>.md` on the implementation branch
  before the final push — that is unchanged.
- **The placeholder body is deliberately marked as one.** It carries the engine's body-floor marker,
  so if `finish` somehow fails to author a real body the existing finish gate kicks back for one
  rather than shipping the placeholder.
- **It is advisory.** If the push is rejected or `gh` is unauthenticated, the engine logs one loud
  `[ship-draft-pr]` line and the build continues; only the finish-time publish is load-bearing.
- **It is idempotent.** Re-entering SHIP after a kickback, resume, or rework reuses the open PR — it
  never opens a second one and never re-drafts a PR that finish already marked ready.
- **Self-host builds are included.** The VERSION-approval and release-artifact gates still run
  before `finish`, so they still gate the flip to ready-for-review — the draft simply exists earlier.

There is no configuration for this; the timing is fixed.

## Step heartbeat and the stall watchdog

`daemon.log` records step boundaries, provider activity, build progress, and verdict-freshness
decisions. For `build_review`, `prd_audit`, `architecture_review_as_built`, and preserved
`manual_test` evidence, the freshness line names the step and artifact:

```text
· build_review verdict build-review.json preserved — surface miss
· ✗ build_review verdict build-review.json invalidated — stale verdict rejected
· prd_audit verdict prd-audit.md rewritten — current
```

`preserved` means the code changed outside the gate's judged surface, so the prior passing verdict
remains valid. `invalidated` means the judged surface changed and the stale verdict was rejected;
the gate must run again. `rewritten` means the current judging attempt produced the artifact.

While a step's provider (Claude or Codex) subprocess is running, the engine touches
`.pipeline/step-heartbeat` in that feature's worktree on every observed stdout/stderr activity
boundary (throttled to at most once every few seconds — this is a liveness signal, not a transcript).
The IN-PROGRESS dashboard the daemon prints on startup (and re-prints at key transitions) annotates
each in-progress feature with the heartbeat's age when one exists:

```text
IN-PROGRESS (1)
  • my-feature [M] @build (heartbeat 12s ago)
```

A feature with no `(heartbeat … ago)` suffix hasn't produced its first activity pulse yet (a step
that just started) — that's distinct from a stale heartbeat, and is never rendered as if the step
were stuck.

The heartbeat file is overwritten, never cleared, so a worktree keeps its last pulse after the step
that wrote it ends. Both the dashboard and the watchdog therefore ignore any heartbeat that doesn't
belong to the dispatch currently in flight — a different step name, or a timestamp from before this
dispatch started. A leftover heartbeat is treated exactly like "no heartbeat yet": the suffix is
omitted, and it is never evidence of a stall.

If a step's heartbeat goes silent for longer than `step_heartbeat_stall_minutes` (default 20; see
[configuration](../reference/configuration.md#step_heartbeat_stall_minutes)) plus a small fixed
grace buffer, the stall watchdog kills the wedged subprocess itself and raises a `mechanical`-class
HALT — the same HALT class the live-boundary deferral (#1070) uses — so the daemon's existing
auto-requeue sweep picks the feature back up on its own, without an operator having to notice the
hang and intervene by hand. Set `step_heartbeat_stall_minutes` to `0` or a negative number to opt a
project out of the kill/HALT behavior entirely; the heartbeat file itself is still written and still
shown by the dashboard either way.

See [runbook: a feature looks stalled or stuck](../runbooks/stalled-or-stuck-feature.md) for how to
triage a feature the watchdog hasn't (yet) caught.

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

### Parked-feature reconciliation

On startup and on every idle poll tick, the daemon classifies each parked slug: `merged`, `orphan`
(its source issue is closed but the work never merged), `normal`, or `unclassified` (the check was
unavailable). `conduct-ts daemon status` annotates the parked list accordingly — `— orphan — needs
manual review` or `— merged — ready to reconcile`.

A slug counts as `merged` on either of two signals:

- **A shipped record on the base branch.** `.docs/shipped/<stem>.md` committed on `origin/main` is
  this harness's definition of "the work shipped", and it is what the daemon backlog dedups on. It
  is matched allowing for the `YYYY-MM-DD-` plan-date prefix, because park markers are keyed by the
  undated slug while records are keyed by the dated plan stem. This signal is durable: it still
  answers after the branch is deleted at merge, and after a squash or rebase merge leaves the branch
  tip outside `origin/main`.
- **Branch ancestry.** Any local branch whose final path segment is the slug — `feat/`, `spec/`,
  `fix/`, `chore/`, whatever prefix the author used — that `git merge-base --is-ancestor` proves is
  contained in `origin/main`.

A missing branch, an unreadable `origin/main`, or a git failure yields `unclassified` and no action.
It never reads as "not merged".

By default ([`reconcile_parked_auto_cleanup`](../reference/configuration.md#reconcile_parked_auto_cleanup)
is unset or `true`), a `merged` slug with a `.docs/shipped/<slug>.md` record on `origin/main` is
reconciled automatically: its worktree is removed, any branch for it is deleted, and it is unparked.
The record on `origin/main` is what settles completion here, so a worktree whose local
`.pipeline/conduct-state.json` still reads mid-build — the normal state for anything built before
`feature_status` existed, or for a `finish` that pushed and then died — does not block cleanup.
The shipped record is never authority for the deletion
itself; every local branch for the slug must first be proven to hold no commit that deleting it would
drop, by **either** of two proofs:

- **Ancestry.** `git merge-base --is-ancestor <branch> origin/main` succeeds (fast-forward or
  merge-commit merge).
- **Merged-PR head identity.** A `MERGED` pull request for that branch reports the branch's *current*
  tip as the commit it merged (`gh pr list --head <branch> --state merged --json headRefOid`). This
  covers the squash- and rebase-merge case, where the merge rewrites the commits and ancestry is
  structurally false forever even for a branch carrying nothing beyond what landed. One extra local
  commit moves the tip, the SHAs diverge, and this proof fails.

If neither proof holds for some branch — a stale local branch, work that landed on it after the
merge, or simply no `gh` available to ask — cleanup is refused with `not-ancestor` and nothing is
deleted, even though the slug still classifies `merged`. Once a proof holds, the branch is deleted
with `git branch -D`: the reconciler, not git, is the authority that no commit is dropped, and git's
own `-d` merge check is structurally false forever for a squash-merged branch.

Worktree removal tolerates one more real-world shape. Some `.worktrees/<slug>` paths exist on disk
without ever having been registered as git worktrees, and `git worktree remove` rejects those with
"is not a working tree" rather than a missing-path error. The reconciler checks `git worktree list
--porcelain` and, when the path is genuinely unregistered, deletes the leftover directory directly
instead of refusing. A removal failure on a path git *does* own — locked, dirty, permissions — still
refuses with `worktree-remove-failed`, and so does an unreadable worktree listing.

A merged slug with no shipped
record yet is left parked and,
when a merged PR can be found, gets an ST-916 record-repair PR requested on its behalf; it
reconciles on a later tick once the record lands. Set `reconcile_parked_auto_cleanup: false` to
disable the automatic cleanup step and only classify/annotate, then reconcile explicitly per slug:

```bash
conduct-ts daemon reconcile-parked <slug>
```

See [`daemon reconcile-parked`](../reference/cli.md#daemon-reconcile-parked) for its exact output
and refusal reasons. An `orphan` classification is never auto-reconciled — it needs an operator to
decide whether to park it, delete it, or resume it manually.

## Retained worktrees

A feature's worktree is **not** removed when its implementation PR opens. The mergeable sweep
tears it down only after the PR reaches `MERGED` or `CLOSED` *and* a `.docs/shipped/<slug>.md`
record is proven present on `origin/main` — the same signal
[parked-feature reconciliation](#parked-feature-reconciliation) uses to define "shipped". Until
then the worktree is retained on disk, one sweep tick at a time:

The daemon/auto `finish` session records and publishes the outcome but performs no worktree cleanup.
Opening, updating, or marking the implementation PR ready therefore cannot bypass this sweep-owned
gate. Interactive local-merge and explicitly confirmed discard outcomes use their separate,
proof-gated cleanup paths.

- **`MERGED`, record not yet on `origin/main`.** Logged as `retained <slug> — reason:
  record-not-yet-on-main`, re-checked on the next tick. This is the normal window between merge and
  the shipped-record commit landing.
- **`CLOSED` without merging.** Logged as `retained <slug> (reclaimable) — reason:
  pr-closed-unmerged`. The PR is pruned from the watch registry (there is nothing left to poll), but
  the worktree itself is left behind for inspection or manual recovery — it is never deleted
  automatically.
- **Record proven present.** Logged as `reaped <slug> — reason: shipped-record-on-main`, and the
  worktree is torn down. A teardown failure logs `reap failed <slug> (<prUrl>) — reason:
  shipped-record-on-main — error: <detail>`, leaves the worktree in place for operator recovery,
  and prunes the watch entry. The failure is isolated from the rest of the sweep and is not retried
  by later ticks.

`conduct-ts daemon status`'s startup dashboard groups every retained worktree under
`RETAINED WORKTREES (<n>)`, each line reading `<slug> — <reason>` where `<reason>` is
`pr-open-awaiting-main` (the common case above) or `pr-closed-unmerged` (a finished pipeline whose
PR closed without merging — reclaimable). A parked slug is excluded from this section, same as
every other dashboard group.

To remove a single retained worktree by hand — a closed-unmerged one you've decided not to
resume, or one you want gone before its shipped record lands — use
[`daemon reclaim-worktree`](../reference/cli.md#daemon-reclaim-worktree):

```bash
conduct-ts daemon reclaim-worktree <slug>
```

It refuses a slug with a resume in progress, refuses anything but a single plain slug (no globs, no
paths, no lists), and is a no-op when the worktree is already gone. It never touches the branch —
both manual reclaim and the automatic sweep remove only the worktree. The automatic sweep never
deletes the feature branch, and its reap gate is shipped-record presence on `origin/main`, not
branch ancestry.

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

A typo'd sub-verb — anything outside `status`, `logs`, `park`, `unpark`, `reconcile-parked`,
`start`, `stop`, `restart`, `connect`, `debug`, `pause`, `resume` — prints `conduct daemon: unknown
subcommand '<token>'.` followed by the daemon help, and exits 1.

## How a halted feature resumes

When a feature halts, the daemon leaves `.pipeline/HALT` in its worktree and stops dispatching it.
On a genuine advance of the base branch SHA, the re-kick sweep runs over every halted worktree and,
per feature:

1. Skips it entirely if it is operator-parked, already shipped, or already re-kicked at this SHA.
2. Skips it, on every sweep regardless of SHA, if `.pipeline/HALT.class` reads `needs-human` or
   `unclassified` — only `mechanical`, `legacy`, and `protected-artifact` are retryable. See the
   classification table in
   [stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md#1-read-the-halt-marker-first).
3. Aborts a paused rebase if one is mid-flight — a failed abort leaves the HALT marker intact rather
   than half-clearing it.
4. Renames `.pipeline/HALT` to `.pipeline/HALT.cleared`, preserving the reason.
5. Drops a `.pipeline/REKICK` sentinel and records the triggering SHA.

The sweep never dispatches directly; the cleared feature is re-dispatched on the next poll. That is
why a git error left in a feature's worktree gets retried without backoff, and why parking is the
only reliable way to make a feature stay stopped.

Before any of this, the daemon runs a one-time startup migration (owned by whichever process holds
the daemon lock) that stamps every pre-existing HALT still missing `.pipeline/HALT.class` as
`legacy`, so a halt written before the sidecar existed is retryable like a `mechanical` one instead
of silently stuck. A watermark at `.daemon/migrations/halt-classification-v1` makes this run exactly
once; a lock loser never runs it and never touches worktrees.

### Post-rebase gate invalidation on resume

Honouring the `REKICK` sentinel rebases the feature onto the advanced base before any gate resumes.
When that rebase changes code or test paths, the downstream judged gates — `build_review`,
`wiring_check`, and (when they ran) `manual_test`, `prd_audit`,
`architecture_review_as_built` — are re-opened, because their verdicts graded the pre-rebase diff.

`build` is the exception. Its predicate re-derives mechanically from the rebased history — the union
of `Task:` commit trailers with the `.pipeline/task-status.json` rows — so the daemon re-evaluates it
against the new tree *before* deciding. If every plan task is still evidenced, the gate keeps a fresh
`satisfied: true` verdict, a `rebase_gate_reverified` event records that dispatch was skipped, and no
build agent re-runs finished work. Anything less — a plan task with no trailer, an unresolvable plan,
or an error during the check — falls back to the ordinary kickback and the build step re-runs.
This is fail-closed: the confirmation is itself a fresh evaluation of the rebased tree, never a
carried-over verdict.

`.pipeline/task-status.json` is not the authority here. Nothing in the engine flips its rows to
`completed`; the durable record of finished work is the `Task:` trailer on each commit, which is why
losing or re-seeding that file does not by itself re-open a finished build.

### Halt-PR presentation is cleared when the halt resolves

Escalating a halt marks the feature's PR: draft status, the `needs-remediation` label, a body
marker, and a halt comment. Every poll, the halt-PR reconciliation sweep re-reads the open PRs and
re-applies any of those facets that drifted off.

The sweep also removes them. A marked PR whose head branch already carries the feature's shipped
record (`.docs/shipped/<slug>.md`, committed by `/finish`) has shipped, so the sweep undrafts it,
removes the label, strips the body marker, and rewrites the halt comment to say the halt resolved.
Being draft-and-labeled is evidence that the marking was applied, never that the halt still stands —
without the shipped-record check a resolved feature stays drafted and labeled until a human clears
it by hand. The check is fail-closed in both directions: it reads the committed branch tree (so a
torn-down worktree cannot hide the record), and it refuses to guess a slug for any branch the daemon
did not cut, so a hand-authored PR is never touched.

### Kickback-cap halt

The kickback budget is durable for each gate: it survives daemon re-dispatch while the feature's
tree hash and resolved-task count are unchanged. After the cap is exhausted, the daemon writes a
HALT that names the gate, lap count, and most recent gate reason. `build_review`, `wiring_check`,
and the kickback-ping-pong guard classify that halt `needs-human`, so the re-kick sweep never
clears it. `test_suite`'s cap halt stays `mechanical` and can still be cleared by the re-kick sweep
on a base-branch advance.

Read the marker and fix the reported gate failure before resuming. Use the recovery procedure in
[stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md#clear-a-halt-and-let-the-feature-resume);
do not clear the marker merely to retry the same unchanged loop.

## Troubleshooting

**`status` shows `⚠ session-up/process-dead`.** The tmux session outlived the daemon process. Run
`conduct-ts daemon restart`, which reconciles the orphan (SIGTERM, then SIGKILL) and reclaims the
lock before respawning.

**The daemon keeps re-dispatching a feature you already shipped by hand.** You are missing the
shipped record. Park it, then run `conduct-ts shipped-record`. See
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md).

A feature the daemon itself finished is deduped from both sides: discovery skips it once the shipped
record is on the base branch (post-merge) *and* once the record is committed on the feature's own
branch (`feat/daemon-<slug>`, pre-merge). The pre-merge half exists because a finish that records the
ship but then reports failure would otherwise leave a completed feature eligible for re-dispatch,
re-running `finish` and duplicating publication work while the original worktree remains retained.

**A step fails with `Cannot dispatch '<step>': its working directory … does not exist`.** The
feature's worktree was removed while the run was in flight. The engine refuses the dispatch before
launching any provider, and the run halts immediately rather than retrying into the same absent path
— previously this surfaced as an opaque provider `error_during_execution` blob and was retried and
kicked back. Nothing is written back into the missing path: a stub there makes the next
`git worktree add` fail 128. The branch holds the work; recover with
[worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md).

**The daemon is alive but nothing moves.** Check for `.daemon/PAUSED`, a park marker under
`.daemon/parked/`, and the `GATED:` section of `conduct-ts daemon status`. See
[stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md) and
[daemon recovery](../runbooks/daemon-recovery.md).
