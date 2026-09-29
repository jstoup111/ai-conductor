# Components and sequences: Daemon commits co-authored by the configured bot

**Last updated:** 2026-09-28
**Scope:** To-be commit attribution for daemon-created commits when a GitHub bot is configured,
for jstoup111/ai-conductor#2722. Feature: `daemon-commits-co-authored-by-the-configured-bot`.
Covers bot co-author identity resolution, the worktree prepare-commit-msg hook, and the engine
bookkeeping commit sites. Commit author/committer identity, operator CLIs, and manual commits are
shown only to mark them unchanged.

## Component diagram

```mermaid
graph TD
  userCfg["User config github_bot.token_file (spec #158)"] --> botCred["Bot credential resolver (existing)"]
  botCred --> resolver["Bot co-author identity resolver (new; cached per daemon run)"]
  daemonMain["runDaemonMode (installs resolver once per process)"] --> resolver
  resolver -->|"ambient.bot-identity.read: gh api user, bot credential only"| github["GitHub"]
  resolver -->|"unresolvable"| spine["ConductorEvent spine (co-author skipped warning)"]
  resolver --> trailer["Co-authored-by trailer value: login plus id-login noreply address"]
  prepare["prepareWorktree: feature dispatch, rebase resolution, CI fix (after hooks, before setup)"] --> hookInput["Worktree .pipeline co-author input"]
  prepare -->|"prepare()"| resolver
  trailer --> hookInput
  hookInput --> hook["prepare-commit-msg hook (Task stamp plus co-author stamp)"]
  agent["Build agent git commit in daemon worktree"] --> hook
  engineSites["Engine bookkeeping commit sites: shipped record, findings, halt record, remediation plan, setup triage, shipment repair"] --> helper["withDaemonCoAuthorTrailer (cached result only, never reads)"]
  guard["Static guard test: every commit invocation wrapped, except operator spec land"] -.-> engineSites
  trailer --> helper
  helper --> commits["Daemon commits: operator author, bot co-author"]
  hook --> commits
  operatorCli["Operator CLIs and manual commits"] -. "unchanged, no trailer" .-> plain["Operator commits"]
  commits --> squash["Operator squash-merge (COMMIT_MESSAGES keeps trailers)"]
```

## Sequence: build-agent commit in a daemon worktree

```mermaid
sequenceDiagram
  participant D as Daemon worktree preparation
  participant R as Co-author resolver
  participant GH as GitHub
  participant W as Daemon worktree
  participant A as Build agent
  participant H as prepare-commit-msg hook
  participant S as ConductorEvent spine
  D->>R: Resolve bot co-author
  alt No bot configured
    R-->>D: None
    D->>W: Write no co-author input
  else Bot configured
    R->>GH: gh api user with bot token
    alt Identity resolved
      GH-->>R: login and id
      R-->>D: Trailer value
      D->>W: Write co-author input
    else Token unavailable or read fails
      R->>S: Emit co-author skipped warning without token
      D->>W: Write no co-author input
    end
  end
  A->>H: git commit
  H->>H: Stamp Task trailer as today
  opt Co-author input present
    H->>H: Add Co-authored-by trailer if not already present
  end
  H-->>A: Commit recorded with operator as author
```

## Sequence: engine bookkeeping commit

```mermaid
sequenceDiagram
  participant E as Engine commit site
  participant T as Trailer helper
  participant R as Co-author resolver
  participant G as git
  E->>T: Build commit arguments
  T->>R: Cached bot co-author
  alt Trailer value available
    T-->>E: Arguments plus Co-authored-by trailer
  else None
    T-->>E: Arguments unchanged byte for byte
  end
  E->>G: git commit
```

## Legend

- **new** marks components this feature adds; everything else exists today.
- The trailer names the bot by its GitHub noreply address, the «id»+«login» form, so GitHub links
  the avatar. The token itself never leaves the resolver's child process.
- Dashed edges mark paths this feature deliberately leaves untouched.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-28 | Initial generation | DECIDE for #2722 |
| 2026-09-28 | Plan update: process-installed resolver, `ambient.bot-identity.read`, resolve and CI-fix worktrees, helper reads cache only, static guard | /plan for #2722 |
