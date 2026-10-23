# Components: Done-when `[test]` citations proven by provenance or judgement

**Last updated:** 2026-10-21
**Scope:** Engine components touched by #3200 and how they connect. The runtime flow is in [the sequence diagram](sequences/done-when-closes-as-verified-citing-tests-that-don.md).

## Diagram

```mermaid
graph TD
    Agent["BUILD agent"]
    Operator["Operator"]
    Cli["task-cli: conduct task start / done"]
    Hook["session-hook-assets: Claude Code task stamping"]
    Accept["done-when-accept-cli: ai-conductor done-when accept"]
    Guard["daemon-session guard: done-when blocked"]
    Close["task-progress: completeTaskDoneWhen"]
    Ref["done-when-test-reference: text checks + start-window provenance"]
    Git["git: blobs at HEAD, added lines in start..HEAD"]
    Status[("task-status.json: startHead, close records, refusals")]
    Predicate["artifacts: BUILD completion predicate"]
    Resolve["task-progress: resolveTaskIds trailer union"]
    Conductor["conductor: BUILD-boundary citation judgement"]
    Judge["done-when-citation-judgement: input, schema, verdicts, settlement"]
    Oblig["repair-obligations: done-when-citation obligation per task"]
    Rebase["rebase-translate: maps startHead"]
    Provider["native-schema provider dispatch"]
    Bus["ConductorEvent spine and EVENT_SINKS"]
    Agent --> Cli
    Operator -->|"accept a refused check"| Accept
    Guard -.->|"refuses inside dispatched sessions"| Accept
    Accept --> Judge
    Hook -->|"startHead"| Status
    Rebase --> Status
    Cli --> Close
    Close --> Ref
    Ref --> Git
    Close --> Status
    Predicate -->|"pending citations: not done"| Conductor
    Predicate --> Resolve
    Resolve -->|"reopened task never resolved by trailers"| Status
    Conductor --> Judge
    Judge --> Provider
    Judge -->|"judged, demoted, or reopened records"| Status
    Judge --> Oblig
    Resolve --> Oblig
    Conductor --> Bus
    Accept -->|"acceptance event"| Bus
```

## Legend

New: the task start HEAD recorded by `conduct task start`; a start-window provenance check inside `done-when-test-reference`; a pending-judgement close record and a judged close source; a pure `citation-judgement` module (prompt, native output schema `asserts | does-not-assert` with a reason, verdict application); the conductor's BUILD-boundary dispatch; a per-check refusal count with a hard bound; the operator-only `ai-conductor done-when accept` command and its durable acceptance record; citation-judgement events on the existing spine. Changed: `completeTaskDoneWhen` stamps `verified` only for a test title added in the task's start→close window and pending otherwise; the BUILD completion predicate is not done while a citation is pending; trailer resolution excludes a task reopened by a refusal. Unchanged: the `Task:` trailer stamping (telemetry, adr-2026-07-21), `--unverified`, `prd_audit`, `build_review`, halt classes. `adr-2026-08-22-done-when-evidence-at-task-close` as amended by #3200 governs.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-10-21 | Initial component view | #3200: `[test]` checks closed verified citing tests that don't assert the check |
| 2026-10-21 | Plan update: session hook, rebase translation, obligation store, accept CLI, guard | /plan for #3200 |
