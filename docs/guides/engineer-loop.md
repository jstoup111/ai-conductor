# The engineer loop

Turn one raw idea into a merged-ready spec PR in the right repo. This guide walks the engineer loop
(`conduct-ts engineer`) end to end, for an operator who has an idea and wants a spec the
daemon can build.

The engineer loop never builds and never merges. It opens a spec PR; you merge it; the daemon
picks it up from the default branch afterwards.

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

`claim` exits 0 in all three cases. It acks the queue, advances the intake ledger to `claimed`, and
persists a claim record so a later `worktree --source-ref` can recover the issue's Desired-outcome
bullets without you re-typing them.

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

You should see `{"kind":"worktree","slug":"…","branch":"spec/<slug>","worktreePath":"…","reconcile":"…"}`.

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
worktree, never the primary checkout.

1. `/explore` — discovery and the confirmed track.
2. Complexity assessment — write the tier to `.docs/complexity/<plan-stem>.md`. The stem must match
   the plan filename or the daemon cannot resolve it.
3. `/prd` — product track only.
4. `/architecture-diagram` — skipped at tier S.
5. `/architecture-review` — skipped at tier S. Every ADR must be APPROVED before landing.
6. `/stories` — must end `Status: Accepted`.
7. `/conflict-check` — skipped at tier S.
8. `/plan`.
9. `/coherence-check` — tiers M and L only.

Do not hand-write stub or DRAFT artifacts. See [steps reference](../reference/steps.md) for the
per-step tier-skip and enforcement table, and [SDLC phases](../explanation/sdlc-phases.md) for why
the order is fixed.

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

Before committing, `land` refuses on any of:

- a missing required artifact for the recorded tier,
- any artifact carrying `Status: DRAFT`, including a DRAFT ADR,
- an empty or stub artifact,
- uncommitted changes in the worktree outside `.docs/`,
- an unresolved identity (no `spec_owner` configured and no `gh` login).

`--worktree` is required. `land` never falls back to the primary checkout. On failure the worktree
is kept for inspection and its path is printed.

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

`handoff` runs `git push -u origin <branch>` and `gh pr create` from inside the per-idea worktree,
so the PR opens for `spec/<slug>`. On success you should see one of:

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
conduct-ts engineer forget <owner/repo#N>
```

This drops the ledger entry and strips the `engineer:handled` label so the next `poll` sees the issue
again. An absent ref reports `{"found":false}` and is not an error. The label removal is best-effort.

## Maintenance commands

| Command | Effect |
| --- | --- |
| `conduct-ts engineer poll` | One synchronous sweep of the GitHub issues adapter into the durable inbox. No routing, no background process. The ledger dedups, so a double-poll enqueues nothing new. |
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
