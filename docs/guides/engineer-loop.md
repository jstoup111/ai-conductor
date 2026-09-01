---
title: The engineer loop
parent: Guides
nav_order: 2
---

# The engineer loop

Turn one raw idea into a merged-ready spec PR in the right repo. This guide walks the engineer loop
(`conduct-ts engineer`) end to end, for an operator who has an idea and wants a spec the
daemon can build.

The engineer loop never builds and never merges. It opens a spec PR; you merge it; the daemon
picks it up from the default branch afterwards.

## Durable lifecycle and replay

Every newly created Engineer worktree belongs to an opaque `engineerRunId`. An integration can reserve
that identity first with `conduct-ts engineer run-create`; a direct legacy flow that starts at
`engineer worktree` receives an engine-minted uncorrelated run automatically. The worktree records the
exact association in `.pipeline/engineer-run.json`. The marker carries repository, plan slug, and branch
identity, so consumers never infer identity from a worktree directory name.

Worktree creation records the mechanical run-started, route-selected, and worktree-created events. A
host without structured Engineer hooks records each authoring step through `engineer run-record` using
the returned run id. Completion requires the owning workflow's accepted result or deterministic
artifact validation. A tool return alone is not evidence. Land independently validates the final
artifact set and reconciles any mechanically proven completion or skip without weakening its gates.

The events are durable under
`$AI_CONDUCTOR_ENGINEER_DIR/lifecycle/runs/<engineerRunId>/events.jsonl`, outside the authoring
worktree. `engineer run-inspect` reduces that journal to a compact snapshot and repairs a missing compact
snapshot. `engineer run-replay --run-id <id> --after-revision <n>` restores every later event after a
missed live delivery or consumer restart. Each successor run has an independent revision sequence.
Attempt and correlation identities use durable hashed indexes, so creating a run does not scan historical
run metadata. Locks are scoped to the affected attempt, correlation, or run, so unrelated repositories and
runs do not block one another.

The lifecycle does not claim spec merge. After the land gate validates track, tier, and the exact DECIDE
artifact set, handoff records `engineer_spec_handoff` with the final plan slug, spec branch, PR URL or
local-commit outcome, and `awaiting_spec_merge`. It then records `engineer_run_settled` and only then
removes the authoring worktree. If durable finalization fails after delivery, the command reports the
failure and retains the worktree for a retry. The durable journal and spec branch remain after cleanup.
The later daemon run keeps its existing `.pipeline/events.jsonl` and BUILD/SHIP semantics.

Land commits the validated artifacts before recording lifecycle reconciliation. If that durable recording
fails, the commit remains a successful land result, the worktree is retained, and the command reports the
recovery step. Repair the durable Engineer state and rerun `engineer land` before handoff.

Registered visualizers receive the same `engineer_*` events from the existing event spine. A visualizer
is an observer and transport boundary only. It owns any projection it creates, and its live delivery does
not replace replay.

## Prerequisites

| Requirement | Check |
| --- | --- |
| `conduct-ts` on PATH | `conduct-ts --help` |
| `claude` on PATH (the loop launches an interactive session) | `claude --version` |
| At least one registered project | `conduct-ts engineer projects` prints a non-empty JSON array |
| `gh` authenticated, for intake and PR steps | `gh auth status` |

Register a repo with `conduct-ts register <path>`, or scaffold a new one with
`conduct-ts create <name>`. See [cli reference](../reference/cli.md) for both.

## How the loop is driven

There are two surfaces and you use both:

- **The front door.** Bare `conduct-ts engineer` spawns an interactive `claude` session running the
  `/engineer` skill, with stdio inherited. The human stays in the loop.
- **The primitives.** `projects`, `claim`, `worktree`, `land`, `handoff`, and the recovery verbs are
  deterministic CLI commands. The skill calls them from in-chat reasoning; you can also call them by
  hand.

Every primitive prints a single JSON line on success, so each step's output feeds the next.

For Medium and Large work, authoring runs `coherence_check` immediately after `plan` and commits
`.docs/coherence/<plan-stem>.md` with the spec artifacts. Small work skips both the gate and the
artifact, allowing the daemon to begin at BUILD after the spec PR merges.

## Start a session

```bash
conduct-ts engineer
```

You should see an interactive Claude session start on the `/engineer` prompt. Before the session
launches, the CLI polls GitHub issues into the durable inbox and prints `Intake: N issue(s) queued.`
when N is above zero. That pre-poll is skipped when a background brain loop is already running
(it owns polling) and skipped when you supply an idea on the command line.

Variants:

```bash
conduct-ts engineer --idea "<your idea>"
conduct-ts engineer <free text idea>
```

Both drive the first session with that idea and skip the intake pre-poll. The idea is one-shot: it
applies only to the first session, and later iterations fall back to intake or chat.

When the session exits, the launcher asks `Process another idea in a fresh session? [Y/n]` on a TTY.
Answering yes starts a clean session — one idea per session, by design. On a non-TTY stdin the
launcher never loops.

**If you are already inside a Claude Code session**, `conduct-ts engineer` refuses to nest a second
one. It prints `You're already inside a Claude Code session — run /engineer directly…` and exits 0.
Run `/engineer` in that session instead.

The permission mode of the launched session comes from `CONDUCT_ENGINEER_PERMISSION_MODE` and
defaults to `default`. The value `plan` is rejected and coerced back to `default`, because a
read-only session cannot run the git and `gh` primitives. See
[environment reference](../reference/environment.md).

## Step 1 — Capture the idea

Ask the inbox first:

```bash
conduct-ts engineer claim
```

Outcomes:

| Output | Meaning | Next |
| --- | --- | --- |
| `{"kind":"claim","text":"…","sourceRef":"owner/repo#N", …}` | An intake idea was claimed | Carry `sourceRef` through steps 3–5 |
| `{"empty":true}` | Nothing pending | Use the launch argument or the operator's chat idea |
| `{"allBlocked":true,"entries":[…]}` | Everything queued is blocked by an open dependency | Resolve or reprioritise the blockers |

`claim` exits 0 in all three cases. It first reaps `claimed` entries stranded longer than the
`stale_claim_window_hours` window, returns them to pending, and can re-serve a reaped entry in the
same call. The default window is 24 hours; set `stale_claim_window_hours` in
[project configuration](../reference/configuration.md#stale_claim_window_hours) to change it. It then
acks the selected queue entry, advances the intake ledger to `claimed`, and persists a claim record
so a later `worktree --source-ref` can recover the issue's Desired-outcome bullets without you
re-typing them.

Ideas that came from a launch argument or from chat have **no** `sourceRef` — omit `--source-ref`
for those.

For what a good intake issue contains, see [filing intake issues](intake.md).

## Step 2 — Route to a target repo

```bash
conduct-ts engineer projects
```

Prints the registry as JSON. Pick the best-fit project, state the rationale, and confirm the target
with the operator before going further. If nothing fits, scaffold a new project with
`conduct-ts create` and continue with it.

## Step 3 — Create the per-idea worktree

```bash
conduct-ts engineer worktree \
  --project <name> \
  --idea "<idea>" \
  --source-ref <owner/repo#N>
```

You should see
`{"kind":"worktree","engineerRunId":"…","slug":"…","branch":"spec/<slug>","worktreePath":"…","reconcile":"…"}`.

- Parse and retain the exact `engineerRunId`, `slug`, `branch`, and `worktreePath`. They are
  authoritative for the rest of this run. Do not reconstruct them from the idea, title, branch, or
  directory name. Use `.pipeline/engineer-run.json` only to resume the same worktree and run.
- `worktreePath` is `<target>/.worktrees/engineer-<slug>`, checked out on a fresh `spec/<slug>`
  branch. It is your working directory for every remaining step of this idea.
- `reconcile` reports how a leftover from a prior failed run was handled: `created`, `reused`, or
  `attached`. A dirty leftover is refused — recreate it.
- Failure exits 1 and makes **zero** changes to the target's primary tree. Do not fall back to the
  primary checkout; fix the error and retry.

`--source-ref` is optional and only meaningful for intake-claimed ideas. With `--source-ref` and no
`--body`, the command loads the Desired-outcome body from the claim record written at claim time; a
missing or unreadable record degrades to no staging rather than failing.

> **Known limitation.** `--source-ref` and `--body` are both parsed and honoured by
> `engineer worktree`, but neither is declared in the commander tree, so `conduct-ts --help` omits
> them; `--body` is additionally absent from `engineer worktree --help` and from the guide text. If
> you pass `--body "<text>"` it wins over the claim record, but no help output will tell you it
> exists. Tracked in [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

## Step 4 — Run DECIDE inside the worktree

With `worktreePath` as the working directory, run the real DECIDE skills in canonical order. The
engineer owns the whole DECIDE phase; the daemon only builds. Every artifact is written inside the
worktree, never the primary checkout. Use the returned `slug` verbatim for the feature artifacts:

1. `/explore` - discovery and the confirmed track at `.docs/track/<slug>.md`.
2. Complexity assessment - write the tier to `.docs/complexity/<slug>.md`.
3. `/prd` - product track only, at `.docs/specs/<slug>.md`.
4. `/architecture-diagram` - skipped at tier S.
5. `/architecture-review` - skipped at tier S. Every ADR must be APPROVED before landing. Keep its
   established architecture and ADR naming contracts.
6. `/stories` - `.docs/stories/<slug>.md`, ending with `Status: Accepted`.
7. `/conflict-check` - `.docs/conflicts/<slug>.md`, skipped at tier S.
8. `/plan` - `.docs/plans/<slug>.md`.
9. `/coherence-check` - `.docs/coherence/<slug>.md`, tiers M and L only.

Do not hand-write stub or DRAFT artifacts. See [steps reference](../reference/steps.md) for the
per-step tier-skip and enforcement table, and [SDLC phases](../explanation/sdlc-phases.md) for why
the order is fixed.

For a managed Codex or another host without structured Engineer hooks, wrap every performed step with
the existing lifecycle command:

```bash
conduct-ts engineer run-record --run-id <engineerRunId> --transition step_started --step <step>
# Run the owning workflow and its acceptance loop.
conduct-ts engineer run-record --run-id <engineerRunId> --transition step_completed --step <step> --completion accepted_result
```

Use `--completion artifact_validation --artifact-paths <comma-separated-paths>` only after a
deterministic artifact check. Record `step_skipped --reason`, `step_failed --error`, and
`step_retried --reason` when those transitions occur. A retry is followed by another `step_started`.
The canonical names are `explore`, `complexity`, `prd`, `architecture_diagram`,
`architecture_review`, `stories`, `conflict_check`, `plan`, and `coherence_check`; record
`bootstrap`, `memory`, or `assess` only if the session actually performs that stage. A failed
lifecycle command stops authoring and leaves the worktree in place.

## Step 5 — Land the spec

```bash
conduct-ts engineer land \
  --project <name> \
  --idea "<idea>" \
  --worktree <worktreePath> \
  --source-ref <owner/repo#N>
```

`land` commits the already-authored `.docs/` artifacts in place on the worktree's `spec/<slug>`
branch. It authors nothing. You should see `{"slug":"…","branch":"spec/<slug>","repoPath":"…"}` —
pass `branch` and the same `--worktree` to step 6.

Before running it, audit the applicable feature filenames against the exact retained slug:
`.docs/specs/<slug>.md`, `.docs/stories/<slug>.md`, `.docs/plans/<slug>.md`,
`.docs/complexity/<slug>.md`, `.docs/conflicts/<slug>.md`, and `.docs/coherence/<slug>.md`.

Before committing, `land` refuses on any of:

- a missing required artifact for the recorded tier,
- any artifact carrying `Status: DRAFT`,
- an ADR under `.docs/decisions/` whose first declared status is not `APPROVED` or `SUPERSEDED`, or that declares no status at all,
- an empty or stub artifact,
- uncommitted changes in the worktree outside `.docs/`,
- an unresolved identity (no `spec_owner` configured and no `gh` login).

`--worktree` is required. `land` never falls back to the primary checkout. On failure the worktree
is kept for inspection and its path is printed.

For a recoverable refusal, report the exact reason, repair only the named artifact or gate failure,
and rerun land with the same `engineerRunId`, `slug`, `branch`, and `worktreePath`. Record authoring
step failure and retry transitions when the repair maps to a step. Do not create a successor run or
new slug for an in-place refusal. Land owns the deterministic refusal and reconciliation events, so
the host does not duplicate them with `run-record`.

With `--source-ref`, `land` also comments "Routed to `<repo>`" on the originating issue and advances
the ledger to `routed`. That write-back is advisory: a `gh` failure never fails a successful land.

> **Known limitation.** `conduct-ts engineer land --help` claims land will "open the spec PR" and
> that it "pushes the `spec/<slug>` branch, opens a PR". The code does neither: the `land` dispatch
> arm calls only `landSpec`, which commits in the worktree and returns. The push
> (`git push -u origin <branch>`) and `gh pr create` happen in `handoff`. The commander description,
> the `conduct-ts engineer` guide text, and the source grammar comment all agree with the code —
> only the per-subcommand help text disagrees. If you stop after `land`, nothing has been pushed and
> no PR exists. Tracked in [#1012](https://github.com/jstoup111/ai-conductor/issues/1012).

## Step 6 — Hand off: push, PR, daemon nudge

```bash
conduct-ts engineer handoff \
  --project <name> \
  --branch <branch> \
  --worktree <worktreePath> \
  --source-ref <owner/repo#N>
```

`handoff` runs `git push -u origin <branch>` and `gh pr create --label spec` from inside the
per-idea worktree, so the PR opens for `spec/<slug>` with the `spec` label. On success you should
see one of:

| Output | Meaning |
| --- | --- |
| `{"kind":"pr-opened","url":"…"}` | The spec PR exists |
| `{"kind":"local-commit","branch":"…","repoPath":"…","reason":"no remote configured"}` | No remote; work persists on the branch |

Then it removes the per-idea worktree (the branch and commit persist), and fires
`ensureRunning(<target>)` so the target repo's daemon is alive to pick the spec up after you merge.
That last call is fire-and-forget but never silent: on a host without tmux you get
`⚠ Spec authored, but the build daemon was not started for "<name>": …` on stderr while the command
still exits 0.

With `--source-ref`, `handoff` comments the PR URL on the originating issue, adds a non-closing
`Refs <ref>` to the PR body, applies the `engineer:handled` label, and advances the ledger to `done`.
The originating issue's assignees remain unchanged from claim through handoff verification and
cleanup; `engineer:handled` marks completion without changing ownership.

On failure `handoff` exits 1, **keeps** the worktree, prints its path, and records branch evidence in
the ledger so you can recover with `engineer resolve`.

## Step 7 — Deliver, then end the session

Report the PR URL and stop. In a Claude Code session, `/quit` and relaunch for the next idea — a
fresh session per idea is the point. Durable state (registry, ledger, claim records) is file-backed,
so nothing is lost across sessions.

The spec is not built until **you merge the PR**. The daemon reads specs from the committed default
branch only; an unmerged `spec/<slug>` branch is invisible to it. See
[running the daemon](running-the-daemon.md).

## Recovering a stranded entry

When `handoff`'s ledger write-back fails but the PR was opened, the entry is stuck at `claimed`.
Stamp it by hand:

```bash
conduct-ts engineer resolve <owner/repo#N> --pr-url <url> --branch <branch>
```

`--pr-url` must match `^https?://` — an invalid URL exits 1. A missing entry prints `{"found":false}`
and exits 0. `--branch` is optional; omitting it preserves any branch already recorded.

To put an issue back in the pool instead:

```bash
conduct-ts engineer unclaim <owner/repo#N>
```

`unclaim` returns a `claimed` entry to pending, preserving its original capture time so the next
`claim` can select it. An absent or non-claimed entry is reported without changing state or failing.
A `claimed` entry that already has a recorded PR is delivered in fact — `unclaim` refuses it and
tells you to use `resolve` or `forget` instead. Use `forget` only when the issue should be removed
from the ledger and made eligible for a later `poll`:

```bash
conduct-ts engineer forget <owner/repo#N>
```

To recover every stale claim at once, run:

```bash
conduct-ts engineer requeue --stale [--older-than <dur>]
```

Without `--older-than`, the sweep uses `stale_claim_window_hours` (24 hours by default); the optional
duration overrides that window for this run — an unparseable duration exits 1 without touching the
ledger. It requeues stranded `claimed` entries that have no recorded PR, removes entries only when
their source issue is confirmed closed, and reports liveness-read errors without removing the entry.
Claimed entries that already have a PR are reserved for `resolve`/`forget` and are never touched.

## Maintenance commands

| Command | Effect |
| --- | --- |
| `conduct-ts engineer poll` | One synchronous sweep of the GitHub issues adapter into the durable inbox. No routing, no background process. The ledger dedups, so a double-poll enqueues nothing new. |
| `conduct-ts engineer unclaim <sourceRef>` | Returns one claimed entry to pending so it can be claimed again. Use it for a known stranded claim. |
| `conduct-ts engineer requeue --stale [--older-than <dur>]` | Bulk-recovers stale claimed entries. The default age is `stale_claim_window_hours` (24 hours); `--older-than` overrides it once. |
| `conduct-ts engineer migrate-issue-deps` | One-time prose-to-structured-link dependency migration. Dry-run by default; prints the proposal and `Dry run — no links written. Re-run with --confirm to apply.` |
| `conduct-ts engineer migrate-issue-deps --confirm` | Applies the migration and prints `N link(s) created, M already present.` |

## Troubleshooting

**A subcommand printed the whole guide and exited 0.** For `worktree`, `land`, `handoff`, `forget`,
and `resolve`, a missing required flag or positional prints the full guide text and exits **0**, not
a usage error. Check the exit code is not enough — confirm you got the JSON line you expected before
moving to the next step.

**`engineer <sub>: unknown flag '<flag>'`, exit 1.** Each subcommand rejects any flag outside its own
allow-list. `--help` and `-h` are checked before the subcommand's own logic, so
`conduct-ts engineer land --help` always prints help and exits 0 with zero side effects.

**`engineer: could not launch an interactive Claude session`.** The `claude` binary is not on PATH.
The command prints the guide and exits 1.

**`Cannot land spec: identity unresolved.`** Set `spec_owner` in `~/.ai-conductor/config.yml` or run
`gh auth login`. See [configuration reference](../reference/configuration.md).

For every flag, exit code, and JSON shape, see [cli reference](../reference/cli.md).
