# Architecture: git-side veto for ref-moving destructive git that bypasses the build guard (#2693)

**Stem:** `ref-moving-destructive-git-that-bypasses-the-build`
**Tier:** M
**Last updated:** 2026-10-03

## Scope

The #1354 guard (`«worktree»/.pipeline/bin/git`, adr-2026-09-23-engine-git-guard-on-agent-path)
stops destructive git at argv time, but only for a `git` resolved through the agent's `PATH`. This
feature adds a git-side backstop on the engine's existing worktree-scoped hook channel,
`«worktree»/.pipeline/git-hooks/` (wired by `core.hooksPath` in the worktree config,
`worktree-prepare.ts:702`). Git runs these hooks for every caller of the worktree's config, so the
backstop does not depend on `PATH`, argv spelling, or which provider launched the command.

Two ref-moving classes are vetoed:

| Class | Hook | Refused when | Safe alternative named |
|---|---|---|---|
| Local branch deletion | `reference-transaction`, `prepared` stage | a `refs/heads/*` ref is deleted and its current tip is not reachable from any other local branch or remote-tracking ref | push or merge it first, or `git branch -d`; for a rename, create the new branch then `-d` the old one |
| Remote history overwrite | `pre-push` | an update is not a fast-forward of the remote's current value and that value differs from the local remote-tracking ref (a lease-equivalent check) | `git fetch`, then `git push --force-with-lease` |

Out of scope:

| Deferred | Where |
|---|---|
| Local non-fast-forward branch moves (amend, rebase, `reset`) | operator scope decision 2026-10-03: legitimate agent and engine flows |
| Forced clean and path discards (no ref transaction) | #1354 guard |
| Remote branch deletion (`push --delete`) | already gated by explicit approval in `github-operations-cli.ts` |
| GitHub rulesets on `feat/*`/`spec/*` | needs an engine-only GitHub App push identity |
| `git -c core.hooksPath=…`, git run from the root checkout or another worktree | recorded limits; #1352 |

## Current state — the guard is the only layer

```mermaid
flowchart TB
    AGENT["Agent shell — any provider, any run mode"]
    GUARD["«worktree»/.pipeline/bin/git<br/>#1354 argv guard"]
    ABS["git by absolute path<br/>or shadowing git earlier on PATH"]
    REAL["real git"]

    subgraph hooks["«worktree»/.pipeline/git-hooks/ — core.hooksPath"]
        CH["pre-commit · prepare-commit-msg · commit-msg<br/>commit-time only"]
    end

    REFS["refs/heads/* and remote refs"]

    AGENT -->|"git on PATH"| GUARD
    GUARD -->|"allowed argv"| REAL
    AGENT -->|"bypass"| ABS
    ABS --> REAL
    REAL --> CH
    REAL -->|"branch -D, bare force push: UNVETOED"| REFS

    classDef gap stroke-width:3px,stroke-dasharray: 5 5;
    class ABS gap;
```

## Target state — a git-side veto behind the guard

```mermaid
flowchart TB
    subgraph daemon["Daemon process"]
        PREP["prepareWorktree → writeGitHooks<br/>writes every hook fail-closed"]
        EXECA["engine git via execa<br/>branch -D / -d run in the ROOT checkout<br/>lease pushes from the worktree"]
        VERIFY["ensureGitGuardForDispatch<br/>re-verifies guard + both ref hooks before each dispatch"]
    end

    subgraph assets["git-hook-assets.ts"]
        RTA["REFERENCE_TRANSACTION_HOOK"]
        PPA["PRE_PUSH_HOOK"]
    end

    subgraph hooks["«worktree»/.pipeline/git-hooks/"]
        CH["commit-time hooks (unchanged)"]
        RT["reference-transaction<br/>prepared: refuse unreachable-tip branch deletion"]
        PP["pre-push<br/>refuse non-ff update whose remote value ≠ tracking ref"]
    end

    AGENT["Agent git — guard, absolute path, any provider"]
    REAL["real git (worktree config)"]
    OUT["refusal: stderr names the operation<br/>and the safe alternative; ref unchanged"]
    REFS["refs/heads/* and remote refs"]

    RTA --> PREP
    PPA --> PREP
    PREP --> CH
    PREP --> RT
    PREP --> PP
    VERIFY -->|"rewrite on mismatch, else no launch"| RT
    VERIFY --> PP
    AGENT --> REAL
    EXECA -->|"worktree lease push: passes"| REAL
    REAL --> RT
    REAL --> PP
    RT -->|"reachable elsewhere"| REFS
    PP -->|"fast-forward or lease-equivalent"| REFS
    RT -->|"would orphan commits"| OUT
    PP -->|"overwrites unseen remote history"| OUT
```

Each hook chains to `$GIT_COMMON_DIR/hooks/«name»` after its own allow (ADR D11). No bypass variable is added. The engine's branch deletions run in the root checkout
(`worktree.ts:112`, `park-reconciliation.ts:1100`), which does not read the feature worktree's
`core.hooksPath`. Its pushes from a feature worktree are plain or bare `--force-with-lease`
(`autoresolve.ts:772`, `ship-draft-pr.ts:397`), and a successful bare lease always has a tracking
ref equal to the remote value.

## Sequence — the two vetoes

```mermaid
sequenceDiagram
    autonumber
    participant A as Agent git
    participant G as real git
    participant RT as reference-transaction
    participant PP as pre-push
    participant R as Remote

    A->>G: branch -D «branch» (any spelling, any path)
    G->>RT: prepared · old new «ref» on stdin
    RT->>G: rev-parse «ref» (old may be all zeros)
    RT->>G: for-each-ref --contains tip, excluding «ref»
    alt tip reachable from another branch or tracking ref
        RT-->>G: exit 0, deletion commits
    else tip would become unreachable
        RT-->>G: exit 1 + refusal text
        G-->>A: fatal: ref updates aborted by hook, ref unchanged
    end

    A->>G: push «remote» «refspec» (force or not)
    G->>R: fetch ref advertisement
    G->>PP: local-ref local-sha remote-ref remote-sha on stdin
    PP->>G: merge-base --is-ancestor remote-sha local-sha
    PP->>G: rev-parse refs/remotes/«remote»/«branch»
    alt fast-forward, new ref, or remote-sha equals tracking ref
        PP-->>G: exit 0
        G->>R: send pack
    else non-ff and remote-sha differs from tracking ref
        PP-->>G: exit 1 + refusal text
        G-->>A: push rejected, remote unchanged
    end
```

## Legend

- Dashed node: a path that reaches the real `git` without any destructive-git veto today.
- `«worktree»`, `«ref»`, `«branch»`, `«remote»`: placeholders.
- "Lease-equivalent": the remote's advertised value equals the local remote-tracking ref, so the
  push only overwrites history this worktree has already fetched. Verified 2026-10-03 on git
  2.53.0: `pre-push` receives the remote's real current value per ref.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-03 | Initial generation | DECIDE for #2693 |
| 2026-10-03 | Added pre-dispatch hook re-verification and repository-hook chaining note | Plan update (ADR D11, D14) |
