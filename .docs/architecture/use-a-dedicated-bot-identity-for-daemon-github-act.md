# Components and sequences: Optional bot identity for harness GitHub writes

**Last updated:** 2026-09-23
**Scope:** To-be write-identity selection inside the guarded GitHub boundary of
adr-2026-09-11-github-operation-ownership, for jstoup111/ai-conductor#158. Feature:
`use-a-dedicated-bot-identity-for-daemon-github-act`. Covers the guarded GitHub operation
runner, the remote Git write adapter, and the machine-scoped bot credential. Read paths,
including identity resolution and `@me` intake capture, are shown only to mark them unchanged.

## Component diagram

```mermaid
graph TD
  callers["Daemon, composer handoff, intake and publication CLIs"] --> guarded["Guarded GitHub operation runner"]
  callers --> remote["Remote Git write adapter (executeRemoteGit)"]
  guarded --> policy["Shared ownership authorization (unchanged; actor = operator)"]
  remote --> policy
  userCfg["User config ~/.ai-conductor/config.yml (machine-scoped)"] --> botCred["Bot credential resolver"]
  projCfg["Committed project config"] -. "rejected by anti-leak guard" .-> botCred
  botCred --> tokenFile["Bot token file (mode 0600, machine-user PAT)"]
  guarded -->|"read access class"| opGh["Operator gh transport (ambient auth)"]
  guarded -->|"write access class"| select["Write identity selector"]
  remote -->|"authorized push"| select
  select -->|"bot configured"| botGh["Bot transport: gh or git with GH_TOKEN"]
  select -->|"no bot configured"| opGh
  botGh -. "unambiguous auth refusal: one retry" .-> opGh
  select --> events["Existing ConductorEvent spine (fallback warning)"]
  botCred --> select
  identity["Identity resolver: gh api user, --assignee @me"] --> opGh
  opGh --> github["GitHub"]
  botGh --> github
```

## Sequence: guarded GitHub write

```mermaid
sequenceDiagram
  participant Caller as Harness caller
  participant Runner as Guarded operation runner
  participant Policy as Ownership policy
  participant Sel as Write identity selector
  participant Bot as Bot transport
  participant Op as Operator transport
  participant Spine as ConductorEvent spine
  Caller->>Runner: Write operation with explicit target
  Runner->>Policy: Authorize operation and target
  Policy-->>Runner: Authorized (actor is operator)
  Runner->>Sel: Select identity for write access class
  alt No bot configured
    Sel->>Op: Execute with ambient operator auth
    Op-->>Runner: Result
  else Bot configured
    Sel->>Bot: Execute with GH_TOKEN from bot token file
    alt Success
      Bot-->>Runner: Result authored by bot
    else Missing token, 401 or 403
      Sel->>Spine: Emit bot fallback warning
      Sel->>Op: Retry once with operator auth
      Op-->>Runner: Result authored by operator
    else Ambiguous failure such as timeout
      Bot-->>Runner: Failure, no retry
    end
  end
  Runner-->>Caller: Result or typed failure
```

## Sequence: remote Git push

```mermaid
sequenceDiagram
  participant Pub as Publication caller
  participant Adapter as Remote Git write adapter
  participant Policy as Ownership policy
  participant Sel as Write identity selector
  participant Git as git push
  participant Helper as gh auth git-credential
  Pub->>Adapter: Push «branch» to origin
  Adapter->>Policy: Authorize every destination ref
  Policy-->>Adapter: Authorized
  Adapter->>Sel: Select push identity
  Sel->>Git: Run push, GH_TOKEN in child env when bot configured
  Git->>Helper: Request HTTPS credential
  Helper-->>Git: Bot token, or operator token when unset
  Git-->>Adapter: Push result
  Note over Sel,Git: Unambiguous auth refusal retries once as operator and emits the fallback warning
```

## Legend

- **Write identity selector** — new. Chooses which credential performs an already-authorized
  write. It never changes authorization: the ownership policy's actor stays the machine-resolved
  operator (adr-2026-07-01-machine-scoped-operator-identity), so the bot acts on the operator's
  behalf and is not a second owner.
- **Bot credential resolver** — new. Reads an optional bot block from user config only; a bot
  key in committed project config is rejected by the existing anti-leak guard. It points at a
  token file rather than holding the token value.
- **Operator gh transport** — today's `makeProductionGh` process call with ambient auth. All
  reads use it, so `gh api user` identity and `--assignee @me` intake stay the operator's.
- **Bot transport** — the same single admitted `gh` process call (and the remote Git runner)
  with `GH_TOKEN` in the child environment. `gh` gives `GH_TOKEN` precedence over stored
  credentials for github.com, and the configured git credential helper is `gh auth
  git-credential`, so HTTPS pushes pick it up.
- **Dashed retry edge** — fires only for an unambiguous auth refusal, once, with a warning event
  on the existing spine. Ambiguous failures do not retry, to avoid duplicate comments or PRs.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-23 | Initial generation | DECIDE for #158: optional bot identity for harness writes |
| 2026-09-23 | Plan update | The write identity selector is realized as a `credential` hint on the `GhRunner` and `RemoteGitCommandRunner` options. The production transports act on it, and the fallback lives in `createGuardedGithubOperationRunner` and `executeRemoteGit`. The fallback event is `github_write_credential_fallback`. |
