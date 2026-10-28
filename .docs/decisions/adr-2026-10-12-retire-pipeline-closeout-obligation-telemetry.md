# ADR: Retire pipeline closeout-obligation telemetry with the batch evaluator

**Date:** 2026-10-12
**Status:** APPROVED
**Deciders:** Operator (James Stoup), during DECIDE for jstoup111/ai-conductor#3056

## Context

adr-2026-08-08-pipeline-owned-closeout-timestamps made pipeline closeout obligations into bus events.
D1 added the `pipeline_closeout_started` and `pipeline_closeout` event kinds and the `ai-conductor
closeout-event start|end <obligation>` primitive. D2 added a pipeline-owned sibling ledger,
`.pipeline/pipeline-events.jsonl`. D3 made emission gate-enforced at the `/pipeline` batch boundary.
D4 added a build-tail rollup whose windows carry a closeout segment.

#3056 retires the `/pipeline` batch evaluator. Verified (95%) by searching `skills/`, `agents/`, `hooks/`, and
`HARNESS.md`: the evaluator is the only caller of `closeout-event` anywhere. The other four obligations in
the vocabulary (`simplify`, `architecture-diagram`, `memory`, `summary`) are never emitted by any skill. After the
retirement, the closeout event kinds, the CLI primitive, and every consumer of them have no producer:
- `closeout-trust.ts` duration validation.
- The `conductor.pipeline.closeout.duration` OTel histogram and the `pipeline_closeout` span event.
- The terminal-renderer and daemon-log closeout lines.
- The event-sink entries.
- The build-tail rollup's closeout segment and its `partial`-with-closeout state.

D2's sibling ledger is not dead. Since adr-2026-08-13-stable-build-review-finding-dispositions decision 5, it
also carries the build-review disposition, reduced-coverage, and outer-verdict events written by
`build-review-cli.ts`, plus the kickback-budget authorization events written by `kickback-budget-cli.ts`.
`CloseoutEventTail` re-emits those onto the live bus, and `readMergedFeatureEvents` merges them for report readers.
That decision says the tail re-emits *allowlisted* external events, but `CloseoutEventTail.pollOnce` re-emits
every parsed record without checking its type. Verified (95%), `closeout-tail.ts`. Existing worktrees still hold
`pipeline_closeout*` lines in their sibling ledgers, so a tail started after this change would put event kinds the
union no longer declares onto the bus.

## Options Considered

### Option A: Keep the vocabulary as tolerant telemetry
Amend D3 only. The event kinds, CLI, and consumers stay, and simply receive nothing.
- **Pros:** Smallest diff; no consumer-visible removal.
- **Cons:** Keeps about 10 source modules and an OTel metric serving a channel with no producer. That is exactly the
  "advertises a role that never runs" defect #3056 describes.

### Option B: Retire the closeout-obligation telemetry and keep the sibling ledger (chosen)
- **Pros:** Removes every dead producer and consumer. It keeps the live external-event channel, and its type
  allowlist becomes mechanical rather than assumed.
- **Cons:** A consumer-visible CLI subcommand and OTel metric are removed. Historical closeout timing stops
  appearing in build-tail reports.

### Option C: Retire the sibling ledger too
- **Pros:** One ledger.
- **Cons:** Build-review dispositions and kickback-budget authorizations are written by operator commands with no
  conductor process. They need the out-of-process ledger, and removing it reopens adr-2026-08-13 decision 5.
  Rejected.

## Decision

1. **Closeout-obligation telemetry is retired.** Remove the `pipeline_closeout_started` and `pipeline_closeout`
   kinds from the `ConductorEvent` union and from the event-sink registry. Remove the `ai-conductor closeout-event`
   subcommand and its CLI-dispatch allowlist entry, `closeout-trust.ts`, and the closeout OTel histogram
   `conductor.pipeline.closeout.duration`. Also remove the `pipeline_closeout` span event, the terminal-renderer and
   daemon-log closeout lines, and the documentation of all of these. No skill, agent, or hook emits a closeout
   obligation. This supersedes adr-2026-08-08-pipeline-owned-closeout-timestamps D1 and D3 and the closeout portion
   of D4, and with them the adr-2026-08-26-remove-retrospectives-one-shot decision 3 roster.
2. **The sibling ledger and its tail survive unchanged in role.** `.pipeline/pipeline-events.jsonl`, its single
   pipeline-side writer, `CloseoutEventTail`, and `readMergedFeatureEvents` remain the out-of-process channel for the
   external event kinds admitted by adr-2026-08-13 decision 5. adr-2026-08-08 D2 stays in force. Module and class
   names that say "closeout" are not renamed in this change; a rename is a separate refactor.
3. **The tail re-emits only admitted external kinds.** The admitted set is exactly the `ExternalPipelineEvent` union:
   the four build-review external kinds and `kickback_budget_adjustment_authorized`. When `CloseoutEventTail` reads
   a well-formed record whose `type` is outside that set, it does not re-emit it. Instead it emits one
   `pipeline_tail_diagnostic` with reason `unadmitted-type`, the ledger path, and the record's byte offset, and polling
   continues. This makes adr-2026-08-13 decision 5's allowlist mechanical. It also means leftover `pipeline_closeout*`
   lines in existing worktrees never reach the bus as undeclared kinds.

   > **Amended 2026-10-24 by #3376:** The admitted set also includes `github_operation_failed`, which the
   > `github-operation` CLI writes to the sibling ledger when a guarded operation fails. The set is still exactly the
   > `ExternalPipelineEvent` union, and unadmitted kinds are still diagnosed and not re-emitted
   > (adr-2026-10-24-finish-surfaces-guarded-publish-failures D1, D2).
4. **The build-tail rollup measures task execution and post-resolution ticks only.** A build window carries its
   classification, task-execution segment, and post-resolution ticks. The tick label `closeout` for a no-head-move
   tick is unchanged, because it names a tail phase, not an obligation event. A window no longer needs a closeout
   segment to be `measured`. A merged ledger with no completed build window resolves to `unavailable`, never
   to a closeout-only `partial`. `build-tail` CLI output drops its closeout lines. Persisted `pipeline_closeout*`
   records in either ledger are ignored by the rollup.
5. **The CLI removal ships with a migration block.** Removing `closeout-event` touches the canonical
   `bin/conduct CLI` breaking surface, and the change is not internal-only. The implementation PR therefore carries
   a `## Migration` bash fence. The fence reports that the subcommand is retired and that no consumer action is needed,
   because no shipped skill calls it. A release waiver is not used.

## Consequences

### Positive
- No vocabulary, metric, or CLI advertises a review or closeout role that never runs.
- The external-event tail enforces the allowlist its governing ADR already promised.
- About ten modules lose dead branches, and three test suites shrink to the live behavior.

### Negative
- Historical closeout durations disappear from `build-tail` reports and from OTel. Dashboards that charted
  `conductor.pipeline.closeout.duration` go empty.
- A pipeline session still running old `/pipeline` text gets the CLI's unknown-command error at its next batch
  boundary. The operator accepted this window: the existing halt and re-dispatch path reloads the new skill text.
- Inline `/pipeline` runs, with no engine ledger, no longer produce a `partial` rollup. They report `unavailable`.

### Follow-up Actions
- [ ] Remove the closeout event kinds, CLI subcommand, trust helper, sinks, OTel instrument and span event, renderer
      and daemon-log lines, and their tests and docs (decision 1).
- [ ] Add the tail's admitted-type check and the `unadmitted-type` diagnostic reason (decision 3).
- [ ] Reduce the build-tail rollup and CLI to task-execution and tick segments (decision 4).
- [ ] Carry the migration fence in the implementation PR body (decision 5).
