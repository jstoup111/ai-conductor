---
title: Running the daemon
parent: Guides
nav_order: 5
---

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

## Fix a blocked merged spec

Discovery reads only the default branch. When it cannot build a merged spec, it marks that spec
`blocked` rather than dispatching it, writes the reason and remedy to `.daemon/blocked.json`, and
logs one of these lines:

```text
skip <slug>: merged spec cannot build — stories not approved (need "Status: Accepted", no DRAFT). Fix the spec on the default branch; logged once.
skip <slug>: merged specs cannot build — ADR .docs/decisions/<adr-file> is not approved (status "<found>" | no status declaration). Approve <adr-file> on the default branch. logged once this pass.
skip <slug>: merged spec cannot build — plan has no dependency tree ("## Task Dependency Graph" or "**Dependencies:**" lines). Fix the spec on the default branch; logged once.
skip <slug>: merged spec cannot build — missing or unparseable coherence artifact (.docs/coherence/<slug>.md) required for tier <tier>. Author it on the default branch; logged once.
```

The first rejects an unapproved stories artifact. The second rejects a non-conforming ADR corpus:
discovery scans every `.docs/decisions/adr-*.md` file on the default branch once per pass, and any
merged spec is blocked while any ADR's first declared status is not `APPROVED` or `SUPERSEDED`
(including an ADR with no status declaration at all) — approving the offending ADR unblocks every
spec the next pass, with no daemon restart. The third rejects a plan without a task dependency
tree. The fourth applies only outside tier S: author a parseable `.docs/coherence/<stem>.md` on the
default branch, or verify that the feature is correctly classified as tier S. Fix the indicated
artifact on the default branch; the next discovery pass replaces the blocked snapshot, clearing a
repaired spec without manual cleanup. Each reason is logged once per slug (the ADR reason once per
pass for the whole corpus) through `.daemon/warned/<slug>`; the marker suppresses repeated poll
warnings until the spec is fixed.

Run `conduct-ts daemon status` to read the persisted `BLOCKED` section. It lists each blocked slug,
machine-readable reason, remedy, and the latest scan age without invoking Git or the network. An
empty snapshot reports that no specs are blocked; no valid snapshot means the blocked state is
unknown until discovery completes. The startup dashboard does not yet render blocked specs;
dashboard treatment is tracked in [#1332](https://github.com/jstoup111/ai-conductor/issues/1332).

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
You may invoke daemon management or a direct daemon run from any directory inside the repository:
the daemon resolves the main repository root first, so runtime files always live in the root
`.daemon/` directory rather than in a nested package or linked worktree.

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
prints `GATED:` and `BLOCKED` sections plus an attribution-agreement line. `BLOCKED` reads the
latest discovery snapshot and lists every blocked spec's reason and remedy; it is not yet part of
the startup dashboard ([#1332](https://github.com/jstoup111/ai-conductor/issues/1332)). The nine
state badges and what each one means are in [cli reference](../reference/cli.md#daemon-status);
`● running` is the one you want.

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
baseline stale. Review the amendment, then reseal the approved paths with
[`conduct-ts reseal`](../reference/cli.md#conduct-ts-reseal) before clearing the HALT (`--clear-halt`
clears it in the same command). If the refusal occurs during REKICK before git starts, the HALT
begins `protected-artifact seal error`; it is not a rebase conflict and must not be sent through
`git rebase --continue`.

A `conduct-ts reseal` outcome also logs:

```text
protected artifacts resealed: <paths>
protected artifact reseal refused [<path>] — <condition>
```

`<path>` on the refusal line is present only when the refusal condition names a specific artifact.

A related but distinct line covers remediation, not the seal itself:

```text
↩ remediation gap <gapId> → plan — sealed artifact <artifact>
```

This fires when a remediation gap's target — its task scope or, absent a `**Files:**` declaration, a
directed reference in its rationale prose — names another feature's sealed DECIDE artifact. The gap is
redirected to the owning DECIDE step instead of routing to `build`; see
[gates](../explanation/gates.md#kickback-and-remediation-routing).

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
  daemon dispatches, not just the session that happened to reach `finish`. After finish usage is
  persisted, the engine refreshes the committed `.docs/shipped/<slug>.md` `## Cost` block from the
  same rollup and attempts one final push. Both operations are best-effort: a refresh failure can
  leave the local record at its pre-finish snapshot, and a push failure can leave the PR branch at
  that snapshot, without re-dispatching `finish`. A concurrent upstream commit is adopted only when
  its tree exactly matches the verified refresh; unrelated branch content still fails closed under
  the ordinary shipment-evidence gates.

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

This keeps the PR available for the whole ship tail while the implementation branch remains out of
release-artifact maintenance. The serialized release-PR workflow owns pending `CHANGELOG.md` and
`VERSION` changes after implementation PRs merge.

What the draft window does and does not mean:

- **Nothing merges it.** A draft PR cannot be merged, and the mergeable sweep excludes drafts from
  its autoresolve and CI-fix candidates, so no remediation runs against an in-flight build's own PR.
- **FINISH authors the prose, then flips it ready.** The engine-owned publication coordinator
  re-observes the PR and dispatches one bounded title/body pass — `author_pr_prose` while the body is
  still the engine-seeded placeholder, `judge_pr_prose` for a quality verdict on prose that exists.
  The authoring pass is given the branch diff and the feature's spec artifacts, so the judgment pass
  is never asked to grade a body nobody wrote. Only after prose is accepted does the coordinator write
  and push the shipped record and mark the PR ready for review. That order is deliberate: the shipped
  record is the daemon backlog's dedup key, so committing it before the prose survived used to make a
  prose halt permanently un-redispatchable. It re-enters FINISH after each verified transition, so a
  retry resumes instead of replaying publication effects.
- **The placeholder body already has the right shape.** It is the `/pr` body template — `## Why`,
  `## What Changed`, `## Testing`, and the `Closes` reference — with each section explicitly marked
  "not yet authored", so a reader landing on the PR mid-build, and the FINISH authoring pass filling
  it in, both see the section shape FINISH will demand. It carries no release metadata: choosing a
  release disposition is the pre-finish `release-disposition` step's job.
- **The placeholder body is deliberately marked as one.** It carries the engine's body-floor marker,
  which is how FINISH knows deterministically that the body is unauthored and must be written before
  anything judges it; FINISH never records completion from placeholder or halt content. If the completion gate still observes that marker on the recorded PR, it re-dispatches
  `finish` for a body rewrite — never `/remediate`, and never a re-opened `build`.
- **It inherits the issue's criticality.** When the feature came from an intake issue, the engine
  copies that issue's `priority: <band>` labels onto the PR as it is adopted, so the PR list carries
  the same urgency the daemon dispatched on without anyone opening the linked issue. Only the
  criticality family is copied — `size:` and every other label stay on the issue. This is fail-open:
  no linked issue, an unreadable label list, or a rejected label write logs one `[pr-criticality]`
  line and changes nothing else. Re-entering SHIP re-applies the same labels, which GitHub accepts
  unchanged.
- **It is advisory.** If the push is rejected or `gh` is unauthenticated, the engine logs one loud
  `[ship-draft-pr]` line and the build continues; only the finish-time publish is load-bearing.
- **It is idempotent.** Re-entering SHIP after a kickback, resume, or rework reuses the open PR — it
  never opens a second one and never re-drafts a PR that finish already marked ready.
- **Self-host builds are included.** The VERSION-approval and release-artifact gates still run
  before `finish`. The coordinator also requires the configured `release-disposition` evidence to be
  a regular file written during the current feature run; missing, stale, malformed, or unreadable
  evidence stops before judgment, while a process restart alone does not invalidate it.

There is no configuration for this; the timing is fixed.

## Provider preparation timeout and activity telemetry

`daemon.log` records step boundaries, provider activity, build progress, and verdict-freshness
decisions. The deterministic BUILD group retains the `wiring_check` and `test_suite` names before
`build_review`; `wiring_check` logs its deprecation notice and `test_suite` logs its verification.
For
`build_review`, `prd_audit`, `architecture_review_as_built`, and preserved
`manual_test` evidence, the freshness line names the step and artifact:

```text
· build_review verdict build-review.json preserved — surface miss
· ✗ build_review verdict build-review.json invalidated — stale verdict rejected
· prd_audit verdict prd-audit.md rewritten — current
```

`preserved` means the code changed outside the gate's judged surface, so the prior passing verdict
remains valid. `invalidated` means the judged surface changed and the stale verdict was rejected;
the gate must run again. `rewritten` means the current judging attempt produced the artifact.

After a BUILD repair, the group still runs its non-skipped members. `wiring_check` remains an
observable compatibility no-op; `test_suite` is the active verifier, and a prior evidence file does
not skip it. The suite member logs its settle decision after the join evaluates current evidence:

```text
· BUILD member test_suite settled: reuse (fingerprint-match)
```

`reuse` means the suite's existing evidence remains valid; `recompute` means it derived fresh
evidence. The basis is a closed diagnostic classification, never command output, credentials, or an
absolute host path. The group join remains the authority that marks a member satisfied.

Before a provider process is spawned, its candidate resolution, session setup, and self-host
preparation are bounded by `provider_preparation_timeout_minutes` (default 5; see
[configuration](../reference/configuration.md#provider_preparation_timeout_minutes)). The first
expired preparation attempt is revoked and receives one replacement for that logical step. If the
replacement also expires, the daemon writes a `needs-human` HALT headed `Provider preparation
exhausted.`; it does not start another replacement. The daemon log and dashboard identify the
`preparing`, `running`, `recovering`, or halted lifecycle phase with the attempt id and recovery
count.

After spawn, activity is observation-only. While a step's provider subprocess is running, the engine touches
`.pipeline/step-heartbeat` in that feature's worktree on every observed stdout/stderr activity
boundary (throttled to at most once every few seconds — activity telemetry, not a transcript or
termination control).
The IN-PROGRESS dashboard the daemon prints on startup (and re-prints at key transitions) shows
the current dispatch's elapsed time, the latest validated aggregate test outcome, and the
heartbeat's age when one exists:

```text
IN-PROGRESS (1)
  • my-feature [M] @build (working) (activity telemetry: 12s ago) (elapsed: 3m12s) (last test outcome: PASS) (children: unknown)
```

A feature with no `(activity telemetry: … ago)` suffix hasn't produced its first activity pulse yet (a step
that just started) — that's distinct from a stale heartbeat, and is never rendered as if the step
were stuck.

If no current-dispatch start event is available, elapsed time is omitted. If test-suite evidence is
missing, malformed, or unreadable, the dashboard says `(last test outcome: unavailable)` rather
than inferring a result.

The heartbeat file is overwritten, never cleared, so a worktree keeps its last pulse after the step
that wrote it ends. The dashboard ignores a heartbeat from another step or from before the current
dispatch; a leftover heartbeat is treated as "no heartbeat yet." Neither a missing nor a stale
heartbeat terminates, retries, replaces, or completes a running provider.

`step_heartbeat_stall_minutes` is accepted only as a deprecated compatibility no-op. It grants no
termination authority and is never used as `provider_preparation_timeout_minutes`; changing it has
no effect on heartbeat telemetry or provider lifecycle behavior. See the
[configuration reference](../reference/configuration.md#step_heartbeat_stall_minutes) for its
compatibility contract and the [stalled-feature runbook](../runbooks/stalled-or-stuck-feature.md#provider-preparation-exhausted)
for preparation-exhaustion recovery.

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

If the feature is already running, the daemon lets the active scheduling unit settle before it
stops. A serial step reaches its natural status; a parallel group lets every started member settle
and completes the group join. The daemon persists those outcomes, then blocks the next serial step
or parallel group and logs the last settled boundary. It does not create a HALT or interrupt work
inside the active unit. Interactive `conduct` runs are unchanged.

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

If neither proof holds for some branch, cleanup is refused and nothing is deleted, even though the
slug still classifies `merged`. The reason distinguishes no merged-PR proof (`no-merge-proof`),
commits added after the merged PR head (`unmerged-commits`), a branch that is behind that head
(`branch-behind-merged-head`), and evidence that Git or `gh` could not check
(`ancestry-check-failed`). For `unmerged-commits`, `daemon reconcile-parked` prints up to ten
`SHA subject` lines and an overflow count, so the operator can inspect what cleanup would drop.
Once a proof holds, the branch is deleted with `git branch -D`: the reconciler, not git, is the
authority that no commit is dropped, and git's own `-d` merge check is structurally false forever
for a squash-merged branch.

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

The cleanup sweep writes one aggregate line when its counts change instead of one line per parked
slug. It includes `refused=N` and, when nonzero, a per-reason breakdown plus guidance for the
dominant refusal. The startup dashboard runs an observational classification pass with cleanup
disabled, so its aggregate always reports `refused=0`. A cleanup-sweep line joins its tag directly
to the daemon prefix and explains the next action for every nonzero outcome, for example:

```text
[daemon][parked-reconciliation] reconciled=0 deferred=1 orphaned=0 parked=7 refused=2 skipped=56; refusals: unmerged-commits=2; next: 1 deferred awaits shipped-record repair; 2 refusals requires resolving unmerged-commits; 7 parked remain parked; 56 skipped retry when merge/issue evidence is available
```

## Project teardown hook

To clean project-owned resources before the daemon removes a feature worktree, add an executable
`bin/teardown` to the project. The daemon runs it from the worktree immediately before an already
authorized removal: post-ship reaping, `conduct-ts daemon reclaim-worktree <slug>`, or parked-feature
reconciliation. It never runs for a retained worktree or before the removal safety proofs pass.

The hook inherits the daemon's process environment, with `CI=true` and `WORKTREE_NAMESPACE` overlaid.
The namespace is derived from the worktree directory name. Do not depend on `.env` or `.pipeline/`:
reconciliation can clean a leftover directory where those files are absent. A missing hook is a
silent no-op.

```sh
#!/usr/bin/env sh
set -eu

# Remove only resources namespaced for this feature.
./scripts/drop-preview-resources "$WORKTREE_NAMESPACE"
```

Keep the hook idempotent. Its output is summarized by default; set `daemon_verbose: true` to log each
non-blank line. A non-zero exit, an unrunnable script, or a timeout is logged with the `teardown:`
prefix and is contained: the daemon still attempts the already-authorized removal. This differs from
a real Git removal failure. `daemon reclaim-worktree` returns an error instead of reporting removal,
and parked reconciliation retains a registered worktree with `worktree-remove-failed` for recovery.
The hook is bounded by `teardown_timeout_seconds` (default 120 seconds); that bound cannot be disabled.
See [configuration](../reference/configuration.md#teardown_timeout_seconds) for value handling and
[environment variables](../reference/environment.md#written-into-child-process-environments) for its
process contract.

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
- **Record proven present.** The sweep invokes cleanup and logs `reaped <slug> — reason:
  shipped-record-on-main`. A failing `bin/teardown` is logged separately with the `teardown:` prefix
  and does not stop the removal attempt. Do not treat that hook log as proof that Git removal failed;
  `daemon reclaim-worktree` and parked reconciliation surface their actual Git removal failures and
  retain the worktree for recovery.

`conduct-ts daemon status`'s startup dashboard groups every retained worktree under
`RETAINED WORKTREES (<n>)`. A retained row includes an evidence-derived reason and a `remedy:`
line. `pr-open-awaiting-main` appears only after the daemon has verified that the ledger's PR URL
is still open; an unavailable, failed, or mismatched PR lookup reports `pr-state-unknown` instead.
Legacy ships with no recorded URL report `shipped-no-pr-reference`. Closed-unmerged, unknown, and
legacy retained rows name `conduct daemon reclaim-worktree <slug>` as the available operator
action; an open PR states that retention ends when the PR lands on main.

`NEVER-STARTED (<n>)` is separate from retained worktrees. It means the dashboard found no readable
`.pipeline/conduct-state.json`; it remains dispatchable and needs no operator action. PARKED and a
live HALTED marker take precedence over both groups: their rows state the reason and print the corresponding
`conduct daemon unpark <slug>` or HALT-clear remedy. A slug appears in only its highest-precedence
dashboard group.

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
| Idle | For the self-host harness, fast-forwards the installed main checkout and rebuilds/relinks it; then clears any stale lock, reconciles an orphaned process, and respawns. The outcome message is always printed |
| Paused | Counts as idle and follows the same refresh/rebuild/respawn path; the pause marker is never touched |
| Busy | Writes `.daemon/RESTART-PENDING` and returns at once. At the next idle boundary, a forced source refresh runs before rebuild/relink and respawn |

Single-repository `restart` never blocks or polls. Its self-host refresh fails closed: when the
checkout is dirty, diverged, offline, or not on its default branch, restart reports the reason and
does not rebuild or respawn from stale source. A degraded restart (fallback kill-and-recreate,
which loses scrollback) is reported explicitly.

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

## Finish-time mergeability

At the daemon-only `rebase` step immediately before `finish`, the engine first checks whether the
feature can merge cleanly with the current base. Textual cleanliness alone is **not** enough to skip
the rebase — `git merge-tree` proves only that the two trees do not collide, never that this
branch's gates were graded against the base that will actually be merged into. A clean result is
skippable only when both of these also hold:

- **The base has not moved in code.** No code or test path differs between the branch's merge-base
  and the base ref. If the base gained code after `build_review` graded the diff, `test_suite`
  proved a tree, or `manual_test` exercised behavior, those verdicts predate it — the engine rebases
  and lets the existing delta-aware invalidation decide what to re-verify. A docs-only advance
  changes nothing and still skips.
- **The base is not a degraded fallback.** When an `origin` remote exists but its default-branch
  discovery or `git fetch` failed, the engine compares against the LOCAL base branch, which in a
  daemon worktree can be arbitrarily far behind origin — a "clean" verdict against it means nothing,
  so the skip is refused. A repository with genuinely no `origin` is not degraded: its local base is
  authoritative and remains skippable.

An uncomputable merge-base or base delta is likewise not skippable — the justification for the skip
could not be established.

A skip records `rebase_mergeable_skip` and continues to `finish` without rewriting the feature
branch or reopening downstream gate evidence. The skip line, the event and the gate verdict all name
the exact ref, its sha, and whether it came from origin or a local branch — `rebase skipped —
cleanly mergeable with origin/main@c6839018bf47 (remote), no code/test changes on it since the
merge-base` — so a wrong skip is auditable from the log instead of requiring a source read.

A refused skip, a conflicting result, or an indeterminate result all keep the established rebase and
recovery path: the engine attempts the real rebase, uses the bounded resolver when configured, and
parks the feature if it cannot finish safely. A refused skip is not a conflict path — a textually
clean branch rebases cleanly; it just re-verifies afterwards instead of shipping stale verdicts.

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

### DECIDE-entry halts need a grant

A `needs-human` HALT that begins `DECIDE entry refused` is not retryable. After deciding that the
named DECIDE step should be authored, record a one-use grant from the main repository checkout, then
clear the halt:

```bash
conduct-ts decide-grant --slug <slug> --step <step> --reason "<why this authoring pass is approved>"
rm -f .worktrees/<slug>/.pipeline/HALT .worktrees/<slug>/.pipeline/HALT.class
```

The grant is written to `.daemon/grants/<slug>.json` in the main checkout — deliberately outside the
feature worktree, so a build agent cannot authorize its own DECIDE entry by writing a file into
`.pipeline/`. `plan` is never grantable: the command rejects it and the entry policy refuses it
regardless, so a halt requesting a plan revision is driven by hand and then cleared.

The grant is scoped to the exact step and consumed immediately before its provider dispatch. Clearing
the halt alone only makes the feature eligible to be checked again; with no matching grant, it halts
again without entering DECIDE. Follow the full
[DECIDE-entry recovery procedure](../runbooks/stalled-or-stuck-feature.md#the-halt-refused-a-decide-entry)
when the halt names an unknown target, missing artifact, or disputed routing.

Before any of this, the daemon runs a one-time startup migration (owned by whichever process holds
the daemon lock) that stamps every pre-existing HALT still missing `.pipeline/HALT.class` as
`legacy`, so a halt written before the sidecar existed is retryable like a `mechanical` one instead
of silently stuck. A watermark at `.daemon/migrations/halt-classification-v1` makes this run exactly
once; a lock loser never runs it and never touches worktrees.

### Post-rebase gate invalidation on resume

Honouring the `REKICK` sentinel always rebases the feature onto the advanced base before any gate
resumes, even when it is cleanly mergeable. This play-forward path is intentionally different from
normal finish: the pending gate must observe the advanced base in its worktree.
When that rebase changes code or test paths, the downstream judged gates — `test_suite`,
`build_review`, and (when they ran) `manual_test`, `prd_audit`,
`architecture_review_as_built` — are candidates for re-opening, because their verdicts graded the
pre-rebase diff. Which ones actually re-open depends on the delta: each judged gate declares the
surface its verdict depends on, and only a delta that lands inside that surface invalidates it.

| Gate | Depends on | Re-opened when the rebase delta touches |
| --- | --- | --- |
| `test_suite` | the whole tree | any code or test path, anywhere |
| `manual_test` | all runtime source | any runtime source path, feature-owned or not |
| `build_review` | the feature's own code and tests | the feature's own source **or** its own test files |
| `prd_audit`, `architecture_review_as_built` | the feature's own runtime source | the feature's own source |

`build_review` grades the feature's own diff against its plan, so a delta made up entirely of
foreign, main-side paths cannot change that grade and its verdict is preserved — a rebase that only
merges in unrelated base work no longer pays for an LLM re-grade. Its own test files DO re-open it,
because the completeness rubric grades whether the plan's tests were written. `test_suite`
deliberately stays maximally aggressive: it proves the exact tree, so any delta at all makes that
proof stale, and it runs no model, so re-running it is cheap.

If aggregate verification then exposes a base-induced repair, the daemon records its sanitized
failure identity in `.pipeline/build-review-rebase-repairs.json`. Entries accumulate across repeated
rebases. The next `build_review` uses them as context when judging whether an otherwise out-of-plan
test or compatibility hunk belongs to the rebase repair; unrelated work is not waived.

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

### A reused halt PR is made presentable at resolution and at the dispatch boundary, not only at finish

The conductor opens the implementation PR as a draft at SHIP-phase entry, and that publisher adopts
whatever OPEN PR already exists for the branch rather than opening a second one. A feature that
halted earlier already has one: the `needs-remediation` placeholder the halt-PR reconciliation sweep
opened. So the placeholder silently becomes the **retained SHIP PR** that every later ship step
reads.

Two independent repairs keep that PR usable, at two different points in the run:

- **Resolution-time presentation repair.** Whatever resolves the retained SHIP PR's identity —
  SHIP-phase adoption, the pre-finish snapshot, or the finish-time restore — repairs it first. It
  clears the `needs-remediation` label and body marker, rewrites a `needs-remediation:` title to
  `feat: <feature>`, strips the halt banner from the body, and preserves the remediation narrative
  as a single PR comment. This is no longer bound to the SHIP-entry `published` outcome: any later
  consumer that resolves the same retained PR triggers the same repair, so a custom SHIP step
  scheduled ahead of `finish` never reads a remediation placeholder regardless of which resolver
  reaches it first.
- **Dispatch-boundary halt-state clear.** Before the first step of *any* run — not gated on
  phase — the conductor also runs a lighter clear that removes the `needs-remediation` label and
  body marker and supersedes the halt comment, while preserving draft status. This reaches a
  feature that resumes into `BUILD`, where the PR is resolved through `gh` directly rather than
  through the conductor's own resolver, so a BUILD-phase halt no longer leaves the branch's PR
  permanently occupied by the remediation placeholder.

Both repairs share the same properties:

- **The PR stays a draft.** Only `finish` flips it ready-for-review, after the ship gates have run.
  Neither repair touches draft status.
- **Each repair is advisory and idempotent.** Neither throws into the build loop, a PR with no halt
  signal costs one read and zero mutations, and repairing the same PR more than once leaves one
  repaired PR and one halt-history comment.

Before this, every repair was bound to the `finish` step, which runs last. Any SHIP step scheduled
ahead of finish was handed the placeholder and could only refuse — a step that writes release
metadata into the retained PR, for instance, would correctly decline to write it into a remediation
placeholder and then fail its own completion artifact on every retry. A halt raised during `BUILD`
was worse: the branch had no SHIP-phase entry to repair it at all, so its PR stayed a remediation
placeholder until someone cleared it by hand.

### Kickback-cap halt

The kickback budget is durable for each gate: it survives daemon re-dispatch while the feature's
tree hash and resolved-task count are unchanged. After the cap is exhausted, the daemon writes a
HALT that names the gate, lap count, and most recent gate reason. `build_review` and the
kickback-ping-pong guard classify that halt `needs-human`, so the re-kick sweep never
clears it. `test_suite`'s cap halt stays `mechanical` and can still be cleared by the re-kick sweep
on a base-branch advance.

Read the marker and fix the reported gate failure before resuming. Use the recovery procedure in
[stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md#clear-a-halt-and-let-the-feature-resume);
do not clear the marker merely to retry the same unchanged loop.

The former terminal-less park caused by a passing stale BUILD-member verdict is retired. A repaired
BUILD round re-verifies all non-skipped members, so it proceeds to its join or records an explicit
halt for a real unresolved condition; operators should not park a feature merely to work around a
missing terminal verdict.

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

The pre-merge half needs a second piece of evidence, because `.docs/shipped/<slug>.md` is committed
by the mid-sequence `write_shipped_record` publication transition — on its own it proves one
transition ran, not that the ship completed. So the pre-merge dedup skips a candidate only when
FINISH **recorded its outcome** (`.pipeline/finish-choice` in the feature's worktree) or the worktree
is already gone; a retained worktree with no outcome record is re-dispatched and logged as
`re-dispatch <slug>: shipped record is on this feature's branch but FINISH recorded no outcome …`.
Without that, a FINISH that halted after writing the record was terminal: an operator could clear the
HALT and discovery would still refuse the feature forever, and because the run never reported done it
was never enrolled in the mergeable watch either, so nothing could reap it. The absent-worktree case
still skips — there is nothing to resume, and re-dispatching it is the "path does not exist" loop the
dedup was added to prevent. See [a cleared FINISH halt resumes to a recorded
ship](../runbooks/stalled-or-stuck-feature.md#a-cleared-finish-halt-resumes-to-a-recorded-ship).

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
