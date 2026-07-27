# Ship your first feature

Take one idea from a sentence to a merged implementation PR: author a spec, merge it, let the
daemon build it, merge the result. For operators who have completed the
[quickstart](../quickstart.md).

The daemon **never merges**. Both merges in this flow are yours. Everything between them is
machinery.

## Prerequisites

- The harness installed and `conduct-ts --help` working.
- The target project registered (`conduct-ts register`) and bootstrapped (`/bootstrap`).
- `gh auth status` clean, or `spec_owner` set in `~/.ai-conductor/config.yml`. Without one of
  these the spec cannot land and the daemon builds nothing.
- `tmux` on `PATH` — the daemon is hosted in a tmux session.
- A `main` branch you can merge into.

Run every command from the project root unless stated otherwise.

## 1. Author the spec

```bash
cd /path/to/your-project
conduct-ts engineer
```

This spawns an interactive `claude` session with `/engineer` as the opening prompt, inheriting your
terminal. Drive the loop from there: it walks the DECIDE phase — explore, complexity, PRD (product
track only), architecture, stories, conflict-check, plan, and (for Medium and Large tiers)
coherence-check — inside a dedicated per-idea git worktree,
then lands the artifacts on a `spec/<slug>` branch and opens the spec PR.

To skip the chat prompt and hand it the idea directly:

```bash
conduct-ts engineer --idea "add a CSV export to the reporting page"
```

The idea is one-shot — it seeds only the first session. If you are already inside a Claude Code
session, `conduct-ts engineer` refuses to nest a second one and tells you to run `/engineer`
directly.

**Observable outcome:** a PR against `main` whose diff is entirely `.docs/` artifacts — an intake
marker, stories, a plan, a complexity marker, ADRs, and (for Medium and Large tiers) a coherence
record. Confirm it:

```bash
gh pr list --state open
```

The step-by-step behavior of the loop and its deterministic primitives (`worktree`, `land`,
`handoff`, `claim`, `resolve`) belong to [engineer-loop.md](engineer-loop.md); flag semantics are in
[../reference/cli.md](../reference/cli.md).

### If the land fails

```text
Cannot land spec: identity unresolved. Resolve one of:
  1. Set spec_owner in ~/.ai-conductor/config.yml
  2. Authenticate via: gh auth login
```

Exit `1`, and the per-idea worktree is **kept** with its path reported so no authored work is lost.
Fix the identity, then re-run.

## 2. Review and merge the spec PR

Read the plan and the stories, not just the diff stat. This is the last point where changing your
mind is cheap — after the merge, the daemon builds what the plan says.

Two content gates decide whether the merged spec is buildable at all, so check them before merging:

| Requirement | Where | Checked how |
| --- | --- | --- |
| Stories approved | the stories artifact | must contain `Status: Accepted` and must **not** contain a `Status: DRAFT` |
| Plan declares task dependencies | `.docs/plans/<slug>.md` | a `## Task Dependency Graph` section, or per-task `**Dependencies:**` lines |

Merge it:

```bash
gh pr merge <spec-pr-number> --squash
```

**Observable outcome:** `.docs/plans/<slug>.md` and the stories artifact exist on `main`.

## 3. Start the daemon

```bash
conduct-ts daemon start
```

`start` first runs `./bin/install --check` internally — a stale skill catalog **never** starts a
daemon; it prompts you to run `bin/install --update` and refuses if you decline. Then it creates the
tmux session and attaches you read-only. Detach with `Ctrl-b d`; the daemon keeps running.

To start without attaching:

```bash
conduct-ts daemon start -D
```

**Observable outcome:** `daemon started (detached). Attach with 'conduct daemon connect'.`, or a
live read-only pane.

```bash
conduct-ts daemon status
```

shows `● running` for the project with its pid, engine version, and last log line. Start, stop,
park, fleet operations, and pause semantics are covered in
[running-the-daemon.md](running-the-daemon.md).

## 4. Watch the build

```bash
conduct-ts daemon logs --follow
```

The daemon scans `main` for merged specs, filters out anything already shipped, applies the owner
gate, then dispatches the highest-priority candidate into its own git worktree under `.worktrees/`
with its own engine build. Inside that worktree it runs the full SDLC — writing acceptance specs,
implementing tasks test-first, reviewing, simplifying, running the aggregate test suite, then the
SHIP validators.

**Observable outcome:** a new directory `.worktrees/<slug>/`, a branch `feat/daemon-<slug>`, and log
lines advancing through step names. `conduct-ts daemon status` reports the running pid and the
current slug.

Only one feature builds at a time. `--concurrency` is accepted, but any value above 1 is clamped
to 1.

If the backlog stays empty, the log says why once per slug — an unapproved stories artifact, a plan
with no dependency tree, a shipped-record dedup hit, or an unresolved daemon identity. If a build
stops advancing, see [../runbooks/stalled-or-stuck-feature.md](../runbooks/stalled-or-stuck-feature.md).

## 5. Review the implementation PR

When the build finishes, the daemon rebases, pushes `feat/daemon-<slug>`, and opens the implementation
PR. It then writes `.docs/shipped/<slug>.md` — stamped with that PR's URL — commits it to the same
branch, and pushes again. That shipped record hashes the plan and the stories, and it is what stops
the daemon re-dispatching the same spec forever.

```bash
gh pr list --state open
gh pr view <impl-pr-number>
```

**Observable outcome:** a PR containing the implementation, its tests, and
`.docs/shipped/<slug>.md`. If the spec came from a GitHub issue, the body carries
`Closes <owner>/<repo>#<n>`.

Review it as you would any human PR. The daemon self-heals red CI and retries failed steps, but the
judgment call is yours — that is the whole point of the operator role.

## 6. Merge the implementation PR

```bash
gh pr merge <impl-pr-number> --squash
```

**Observable outcome:** the feature is on `main`, and the shipped record lands with it. The next
backlog scan sees the record and skips the slug permanently.

Clean up the finished worktree:

```bash
conduct-ts inline --cleanup
```

This scans resumable features, checks each one's recorded PR for a merge, and prompts
`Remove merged worktree "<name>"? [y/n]` per match.

## What happens if you merge by hand instead

Opening or merging a PR outside this flow does not write `.docs/shipped/<slug>.md`, so the daemon's
dedup never fires and it re-dispatches the spec on every scan. Record the ship explicitly:

```bash
conduct-ts shipped-record --slug <slug> --pr <pr-url>
```

It writes and commits the record, and is idempotent. The exit code proves nothing — it exits `0`
even when it wrote no record, so verify the file exists on the branch before you rely on it.
Recovery is in
[../runbooks/shipped-record-reconciliation.md](../runbooks/shipped-record-reconciliation.md#recovery).

Meanwhile, park the slug so the daemon stops re-kicking it:

```bash
conduct-ts daemon park <slug>
```

Always park **before** touching a feature's worktree or branch.

## The single-feature alternative

For a change that does not need a spec PR or the daemon, run the whole pipeline in the foreground:

```bash
conduct-ts inline "add a CSV export to the reporting page"
```

Same steps, same gates, no backlog and no tmux — it checkpoints for your approval instead. The
`inline` token is mandatory. See [../reference/cli.md](../reference/cli.md) for its flags and
[../reference/steps.md](../reference/steps.md) for what each step does and which ones your
complexity tier skips.
