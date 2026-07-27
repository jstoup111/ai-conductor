# Architecture

The roles in this harness — engine, daemon, engineer loop, host agent, operator — what each owns, and how
work crosses the boundaries between them. For the module map and import layering, see
[code-organization](../contributing/code-organization.md).

## The five roles

| Role | What it is | Owns | Never owns |
| --- | --- | --- | --- |
| operator | the human running the harness | intent, approvals, merges, halt recovery | step order, gate verdicts |
| engine | the TypeScript conductor under `src/conductor/` | step order, prerequisite checks, gate verdicts, run state, worktrees, git mechanics, provider dispatch | judgement about a spec or a diff |
| host agent | the LLM session the engine dispatches (`claude` or `codex`) | authoring and judgement — specs, code, reviews, verdict documents | whether its own work passed |
| daemon | the background build/ship loop (`conduct-ts daemon`) | the backlog, the worker pool, per-feature isolation, PR opening | authoring specs |
| engineer loop | the interactive idea→spec loop (`conduct-ts engineer`) | DECIDE-phase authoring for one idea, and the spec PR | building or shipping code |

The split that matters most: **the engine decides whether a step is done; the host agent decides what the
work should be.** A host agent writes an artifact; the engine reads that artifact off disk and computes the
verdict itself. It does not ask the agent how it went. See [evidence-model](evidence-model.md) for why.

## What the engine owns

The engine is a state machine over an ordered step list, plus a gate loop. Concretely it owns:

- **Step order and phase assignment.** The ordered array in `src/conductor/src/engine/steps.ts` *is* the
  flow — there is no separate flow config. Enumerated in [steps](../reference/steps.md).
- **Prerequisite checking.** A step runs only when every step it names as a prerequisite is satisfied.
- **Verdicts.** After a step runs, the engine recomputes that step's verdict from on-disk evidence and
  writes it to `.pipeline/gates/<step>.json`. The only agent-authored verdict write is a kickback
  invalidation, and it must carry evidence.
- **Isolation.** Worktree creation, branch naming, per-worktree git hooks and session hooks.
- **Provider dispatch.** Which host agent runs a step, at which model and effort — see
  [models](../reference/models.md) and [multiprovider](../guides/multiprovider.md).

Everything the engine enforces is mechanical: it reads files, compares timestamps and hashes, and runs git.
This is deliberate. The repo's design principle is that anything the engine, a hook, or a gate can decide
mechanically must not be left to prompt discipline, because prompt-level rules drift under long unattended
builds and mechanical checks do not.

## What the host agent owns

A host agent is a fresh LLM session the engine starts for one step, handed one skill. Skills define *what*
to do; agent personas under `agents/` define *who* does it. The catalog is in
[skills](../reference/skills.md).

The host agent's output is always a file — a spec, a plan, code and commits, a review verdict document. It
never reports "done" to the engine as a fact the engine acts on. Two hosts exist, `claude` and `codex`,
selected by the `llm_provider` config key; an ordered array makes it a fallback ladder.

## The two loops

Work moves through two independent loops that meet at exactly one place: the base branch.

```mermaid
flowchart TB
  subgraph E["engineer loop — conduct-ts engineer"]
    direction LR
    E1["one worktree + spec branch per idea"] --> E2["DECIDE artifacts under .docs/"] --> E3["spec PR"]
  end
  subgraph D["daemon — conduct-ts daemon"]
    direction LR
    D1["backlog"] --> D2["one worktree + feat branch per feature"] --> D3["engine step loop"] --> D4["implementation PR"]
  end
  op(["operator"]) -->|raw idea| E1
  E3 -->|operator merges| BASE[("base branch: .docs/plans, .docs/stories")]
  BASE -->|git ls-tree, never the working tree| D1
  D4 -->|operator merges| BASE
  D3 -.->|dispatches one step| HOST["host agent: claude or codex"]
  HOST -.->|writes artifacts| D3
```

### The engineer loop: idea to spec

You hand the harness a raw idea. The engineer loop picks the target repo, creates a dedicated worktree for
that idea on its own `spec/` branch, runs the full DECIDE phase inside it, commits the artifact set, and
opens a spec PR. It never touches the target repo's primary checkout — there is no fallback to authoring in
the shared checkout, and a worktree that cannot be created aborts with zero mutation. Procedure:
[engineer loop](../guides/engineer-loop.md). Filing raw observations for a later DECIDE pass:
[intake](../guides/intake.md).

### The daemon loop: spec to shipped PR

The daemon discovers work by listing plan files **on the committed base-branch tree**, not on the
filesystem. Uncommitted artifacts and artifacts that exist only on an unmerged spec branch are invisible to
it by construction. It then runs a worker pool: each backlog item gets its own worktree, branch, and
`.pipeline/` state, and the engine's step loop runs there to completion or to a halt. One feature's failure
becomes an outcome, not a pool crash. Procedure: [running the daemon](../guides/running-the-daemon.md).

### Why they are separate

- **The merge is the handoff.** Because the daemon reads only the merged base-branch tree, a spec is
  build-ready exactly when a human merged its PR. Review is not a step someone can forget to run; it is the
  only path into the backlog.
- **They run on different clocks.** Idea capture is interactive, bursty, and needs a human in the sentence.
  Building is unattended and long. Coupling them would make the daemon wait on human judgement and make idea
  capture wait on builds.
- **Their failure modes do not mix.** A malformed spec fails at land time, before anything is built. A build
  failure halts one worktree and leaves the spec untouched on the base branch.

## Worktree isolation

Every feature and every idea gets its own git worktree. Inside it live that unit of work's branch, its
`.pipeline/` run state, its generated git hooks, and its session hooks. Nothing is shared between concurrent
features except the base branch they were cut from.

Each actor gets its own branch namespace, so a daemon build, an engineer-loop spec, and an
interactive run can coexist on the same repo without colliding. The exact path and branch template
per actor — six actors, five branch-name templates, including the collision suffixes — is in
[artifacts](../reference/artifacts.md#worktree-and-branch-names).

`.worktrees/` is the only creation target. `.claude/worktrees/` is a legacy convention the engine reads when
probing for an existing worktree and excludes from self-host fingerprints; no engine code creates anything
there.

On a successful ship the daemon removes the worktree. On a halt or error it deliberately leaves it in place
for you to inspect — the leftover worktree is the diagnostic surface, not litter.

## The branch is the source of truth

A worktree checkout is disposable; the branch is not. Everything durable is a commit: code, and the
committed `.docs/` artifacts that drove it. Everything under `.pipeline/` is gitignored and lives only in
that worktree.

That asymmetry has one sharp consequence. Removing a worktree destroys its `.pipeline/` — including the
per-task status and evidence sidecar for work that is already committed on the branch. The branch still has
the commits; the engine no longer has the proof it saw them, so a rebuilt worktree can diagnose a stall on
finished work and re-attempt tasks that are already done.

> **Known limitation.** Deleting `.worktrees/<slug>` loses the per-worktree `.pipeline/` state, which causes
> false `no_task_progress` stalls on already-committed work. Recreate the worktree from its branch and
> backfill the evidence rather than letting the build redo finished tasks. Tracked in
> [#497](https://github.com/jstoup111/ai-conductor/issues/497).

Recovery procedure: [worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md). The
file-by-file breakdown of what is committed versus ephemeral is in [artifacts](../reference/artifacts.md).

## Handoffs across boundaries

| Handoff | Mechanism | What makes it durable |
| --- | --- | --- |
| operator → engineer loop | a raw idea, interactively | nothing yet — output is the artifact set |
| engineer loop → daemon | merged spec PR | committed `.docs/plans/<slug>.md` and siblings on the base branch |
| engine → host agent | a dispatched skill in a fresh session | the artifact the agent writes to disk |
| host agent → engine | files on disk | the engine recomputes the verdict; it does not read a self-report |
| daemon → operator | implementation PR, or a halt marker plus a draft PR | `.docs/shipped/<slug>.md` committed on the implementation branch |

The shipped record is what closes the loop: it is committed on the implementation branch, so merging lands
the code and the shipped fact atomically, and the daemon's backlog dedup sees it on the next poll. A PR
opened by hand does not do this, which is why manual finishes need the record landed too. See
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md).

## The operator's job

The engine handles mechanics; you handle judgement and exceptions. In practice that is: deciding what to
build, merging spec and implementation PRs, and resolving halts. The harness halts rather than guessing —
an unattended run that hits an unsatisfiable gate writes a halt marker and stops, because inventing an
answer is worse than waiting. See [gates](gates.md) for what halts, [stalled or stuck
feature](../runbooks/stalled-or-stuck-feature.md) and [daemon recovery](../runbooks/daemon-recovery.md) for
what to do about it.

This repo runs the harness on itself, which adds a self-host guardrail bundle around the same roles —
described in [self-hosting](../guides/self-hosting.md).
