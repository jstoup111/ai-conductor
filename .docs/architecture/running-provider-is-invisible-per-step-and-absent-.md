# Components: Live provider identification per attempt (#1268)

**Last updated:** 2026-10-14
**Scope:** The path from per-candidate provider dispatch to the two live operator surfaces (daemon
log and interactive terminal renderer), for serial steps and parallel-group members. Provider
routing, fallback policy, and the daemon status dashboard are unchanged.

## Diagram

```mermaid
graph TD
    CONDUCTOR[engine/conductor.ts - serial step dispatch] --> SR
    GROUP[engine/group-core.ts runGroupBranch - built-in and configured parallel members] -->|executionContext: configured-member or lifecycle-step| SR
    SR[engine/step-runners.ts - forwards context onCandidateStart beside onAttempt] --> PE
    RECOV[daemon-cli.ts slug-scoped recovery dispatch - rebase-autoresolve, ci-fix] --> SR
    PRELUDE[engine/project-prelude.ts - forwards onCandidateStart beside onAttempt] --> PE
    PE[engine/provider-execution.ts executeProviderCandidates - existing fallback ladder] -->|onCandidateStart - NEW: per invoked candidate and model rung, sync, unawaited| CTX
    PE -->|skipped candidate: no start callback| SKIP[existing provider_attempt invoked=false]
    CTX[ProviderExecutionContext - daemon-cli createProviderExecution, index.ts providerExecution] -->|emit provider_attempt_started - NEW: step, provider known or unknown, model?, executionContext?| BUS[ConductorEventEmitter]
    BUS --> SINKS[engine/event-sinks.ts matrix - NEW row: render, persist, no otel]
    SINKS --> PERSIST[EventPersister - .pipeline/events.jsonl]
    SINKS --> DLOG[daemon-cli.ts renderDaemonEvent - NEW case, plus scoped recovery subscription]
    SINKS --> TERM[ui/terminal-renderer.ts - NEW dedicated case]
    FMT[ui/provider-start-line.ts - NEW shared formatter] --> DLOG
    FMT --> TERM
    DLOG --> L1[▸ «step» on «provider» «model»]
    DLOG --> L2[▸ «group» / «member» on «provider» «model»]
    TERM --> L1
    TERM --> L2
    MECH[mechanical steps - no provider dispatch] -. no event, no line .-> BUS
```

## Fallback sequence

```mermaid
sequenceDiagram
    participant SR as step-runners or recovery dispatch
    participant PE as provider-execution
    participant BUS as event spine
    participant R as daemon log / terminal
    SR->>PE: execute candidates (ladder: claude, codex)
    PE->>BUS: onCandidateStart(claude) via context: provider_attempt_started provider=claude
    BUS->>R: ▸ «step» on claude
    PE-->>SR: claude unavailable mid-step
    PE->>BUS: existing provider_attempt failure + provider_fallback
    PE->>BUS: onCandidateStart(codex) via context: provider_attempt_started provider=codex
    BUS->>R: ▸ «step» on codex (supersedes claude line)
```

## Legend

- **NEW** marks what this feature adds; unmarked nodes already exist on `main`.
- **onCandidateStart** lives on the executor input beside `onAttempt` and fires once per candidate
  and model rung that is actually invoked, after every skip decision and before the provider process
  runs. It is separate from the stream observer, which is never created on the interactive (REPL)
  path, so the start signal is not lost there. It sits at the executor rather than in `step-runners`
  because the project prelude calls the executor directly. It fires inside the per-rung runtime
  call, so a cached rubric result never announces a provider.
- **executionContext** is already an input of `executeProviderCandidates` and is passed through to the
  start callback exactly as it reaches `onAttempt`, so a configured member renders as
  `«group» / «member»` and concurrent members stay distinct.
- **unknown:** if the candidate key cannot be resolved to a provider name the event carries an
  explicit unknown value and the renderers print `provider unknown`; renderers never fall back to
  a previous line's provider.
- **Historical records** lack the new variant; readers that do not recognize it skip it, so old
  `events.jsonl` files stay readable.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-14 | Initial generation | #1268 live provider identification spec |
| 2026-10-14 | Emission moved to the executor callback boundary; recovery path, shared formatter, no-otel sink row | Plan-time verification and plan review: the project prelude bypasses step-runners; rubric cache hits must not announce |
