# Components and sequences: Daemon commits carry no bot co-author trailer under child isolation

**Last updated:** 2026-10-24
**Scope:** The to-be wiring of the bot co-author resolver into every daemon process that
dispatches features, for jstoup111/ai-conductor#3377. Feature:
`daemon-commits-carry-no-bot-co-authored-by-trailer`. Covers the shared daemon-process bootstrap,
the supervisor (`daemon-cli.ts`) and executor-child (`index.ts` private `executor-child` branch)
entry points, the dispatch-time absent-resolver skip, and the child-to-supervisor event path. The
resolver itself, the trailer format, the `prepare-commit-msg` hook, and the engine commit helper
are unchanged from `daemon-commits-co-authored-by-the-configured-bot.md` and appear only for context.

## Component diagram

```mermaid
graph TD
  bootstrap["Daemon-process bootstrap (new): installs per-process daemon services, today the bot co-author resolver"]
  supervisor["Supervisor: runDaemonMode in daemon-cli.ts (in-process executor runs here)"] -->|"calls once, daemon event bus"| bootstrap
  child["Executor child: private executor-child entry in index.ts (one per dispatch)"] -->|"calls once, before the feature run"| bootstrap
  bootstrap --> resolver["Bot co-author resolver (existing; cache now per daemon or executor process)"]
  resolver -->|"ambient.bot-identity.read with bot credential"| github["GitHub"]
  prepare["prepareWorktree with dispatchStart (both executors)"] -->|"refreshWorktreeCoAuthor"| resolver
  prepare -->|"no resolver installed at dispatch (new closed reason)"| childBus["Feature event bus"]
  resolver -->|"token-unavailable, identity-read-failed"| childBus
  childBus -->|"events.jsonl plus IPC event forward (existing)"| supervisorBus["Supervisor event bus"]
  supervisorBus -->|"attachFeatureEventRenderer (exported, unchanged behavior)"| daemonLog["daemon.log render of bot_co_author_skipped"]
  prepare --> hookInput["Worktree .pipeline co-author input"]
  hookInput --> hook["prepare-commit-msg hook (unchanged)"]
  resolver --> helper["withDaemonCoAuthorTrailer (unchanged)"]
  operatorCli["Operator-run CLIs calling prepareWorktree without dispatchStart"] -. "no bootstrap, no stamp, no skip event" .-> plain["Operator commits"]
  wiringTest["Wiring test: both daemon entry points call the bootstrap; no operator entry point does"] -.-> bootstrap
```

## Sequence: child-isolated dispatch

```mermaid
sequenceDiagram
  participant S as Supervisor
  participant C as Executor child
  participant B as Daemon-process bootstrap
  participant R as Co-author resolver
  participant P as prepareWorktree
  participant E as Feature event bus
  S->>C: Spawn child with WorkOrder
  C->>E: Create feature bus (persist and forward to supervisor)
  C->>B: Install daemon-process services on the feature bus
  B->>R: Install resolver for this process
  C->>P: Prepare worktree with dispatchStart
  P->>R: prepare()
  alt No bot configured
    R-->>P: unconfigured
    P->>P: Write no co-author input, emit nothing
  else Identity resolved
    R-->>P: trailer
    P->>P: Write co-author input
  else Token unavailable or read fails
    R->>E: bot_co_author_skipped with closed reason
  end
  E-->>S: Forward event to daemon.log
```

## Sequence: dispatch with no resolver installed (defect guard)

```mermaid
sequenceDiagram
  participant X as Any daemon process missing the bootstrap
  participant P as prepareWorktree
  participant E as Feature event bus
  X->>P: Prepare worktree with dispatchStart
  P->>P: Find no installed resolver
  P->>E: bot_co_author_skipped reason resolver-absent
  P->>P: Write no co-author input, setup continues
```

## Legend

- **new**: introduced by this feature. **existing**/**unchanged**: shipped by #2839 or earlier.
- Solid arrows are production calls or data flow; dotted arrows are tests or paths deliberately left
  untouched.
- "Feature event bus" is the child-owned `ConductorEventEmitter` created in `executor-child.ts`,
  which persists to the worktree `.pipeline/events.jsonl` and forwards every event to the supervisor.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-24 | Initial generation | DECIDE for #3377 (approach C: shared daemon-process bootstrap) |
| 2026-10-24 | Feature-bus renderer shown as exported `attachFeatureEventRenderer` | Plan Task 7 lifts it out of `runDaemonMode` so supervisor rendering is testable |
