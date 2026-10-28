**Status:** Accepted

# Stories: closeout timing events record wrong units (#2049)

Technical track, Tier S. Source: intake jstoup111/ai-conductor#2049. Governing design:
`adr-2026-10-12-retire-pipeline-closeout-obligation-telemetry` (no closeout obligation is recorded as an
event; the pipeline-owned sibling ledger `.pipeline/pipeline-events.jsonl` and its tail carry only the
admitted external event kinds; the build-tail rollup measures task execution and post-resolution ticks
only). No caller-supplied or command-stamped closeout duration exists, so no reader can render or sum a
wrong-unit closeout figure. This feature does not rewrite records already on disk.

Shared definitions used by every story below:

- **Leftover closeout record** — a well-formed `pipeline_closeout_started` or `pipeline_closeout` line
  already present in a sibling ledger or in `.pipeline/events.jsonl` from an older session.
- **Admitted external kind** — a member of the `ExternalPipelineEvent` union: the four build-review
  external kinds and `kickback_budget_adjustment_authorized`.

## Story 1: No command records a closeout obligation's timing

**Requirement:** #2049 outcome 1 (no recorded duration can disagree with real wall-clock elapsed time) and outcome 4 (no caller-supplied timing)

As a pipeline session finishing a batch boundary, I want no command to exist for recording a closeout
obligation's timing so that I never produce epoch values myself and no plausible-looking wrong number
can be written.

### Acceptance Criteria

#### Happy Path
- Given an empty sibling ledger, when `ai-conductor` is invoked with a closeout-recording subcommand and the arguments `start evaluator`, then it exits non-zero with an unknown-command error and `.pipeline/pipeline-events.jsonl` stays empty.
- Given the `ConductorEvent` union in `src/conductor/src/types/events.ts`, when the TypeScript build compiles it, then it declares neither `pipeline_closeout_started` nor `pipeline_closeout` and the event-sink registry has no entry for either kind.
- Given no conductor or daemon is running, when a bare pipeline session completes a batch boundary, then nothing is written to `.pipeline/pipeline-events.jsonl` or `.pipeline/events.jsonl` for any closeout obligation.

#### Negative Paths
- Given the former caller-timed form naming obligation `evaluator` with the values 1788012400000 and 1788012400000, when `ai-conductor` dispatches it, then it exits non-zero with an unknown-command error and appends nothing to either ledger.

### Done When
- [ ] The `ai-conductor` CLI and its CLI-dispatch allowlist in `src/conductor/src/execution/daemon-session.ts` expose no closeout-recording subcommand.
- [ ] Invoking a closeout-recording subcommand leaves the sibling ledger's bytes unchanged.
- [ ] `pipeline_closeout_started` and `pipeline_closeout` are absent from the `ConductorEvent` union and the event-sink registry, and the TypeScript build passes.

## Story 2: Leftover closeout records never reach the live bus

**Requirement:** #2049 outcome 4 (no plausible-looking wrong number reaches a consumer)

As the harness, I want the sibling-ledger tail to re-emit only admitted external kinds so that a leftover
closeout record from an older session is reported as a diagnostic instead of reaching the bus as an
undeclared event kind.

### Acceptance Criteria

#### Happy Path
- Given a sibling ledger holding a `build_review_outer_verdict` record followed by a `kickback_budget_adjustment_authorized` record, when the tail polls, then it re-emits both records onto the live bus in ledger order and emits no `pipeline_tail_diagnostic`.

#### Negative Paths
- Given a leftover `pipeline_closeout` line in the sibling ledger, when the tail polls, then it emits one `pipeline_tail_diagnostic` with reason `unadmitted-type`, the ledger path, and the line's byte offset, and re-emits nothing.
- Given a leftover `pipeline_closeout_started` line followed by a `build_review_disposition_accepted` record, when the tail polls, then it emits one `unadmitted-type` diagnostic for the first line, re-emits the second record, and keeps polling.
- Given a sibling ledger containing a malformed line, when the tail polls, then it emits a `pipeline_tail_diagnostic` with reason `malformed-line` rather than `unadmitted-type` and continues with the next line.

### Done When
- [ ] A test writes leftover `pipeline_closeout_started` and `pipeline_closeout` lines to the sibling ledger and asserts the bus receives one `unadmitted-type` diagnostic for each and no event of either kind.
- [ ] A test asserts each admitted external kind is still re-emitted unchanged.

## Story 3: Every reader ignores leftover closeout records

**Requirement:** #2049 outcome 2 (untrusted records never reach an aggregate) and outcome 3 (build-tail and the daemon log agree)

As an operator reading build-tail timing, I want the build-tail rollup, the daemon log, the terminal UI,
and the OTel export to treat a leftover closeout record identically, by ignoring it, so that no bad record
is ever rendered or summed as a measurement.

### Acceptance Criteria

#### Happy Path
- Given a merged ledger with one completed `build` window and two leftover `pipeline_closeout` records inside it, when `ai-conductor build-tail` renders it, then the window reports its classification, task-execution segment, and post-resolution ticks and prints no closeout duration line.
- Given a merged ledger whose post-resolution ticks include no-head-move ticks, when `ai-conductor build-tail` renders it, then those ticks are still labelled `closeout` in the tick counts.
- Given a merged ledger with leftover closeout records and no completed `build` window, when the rollup runs, then its state is `unavailable`.

#### Negative Paths
- Given a leftover record with `startedAt` 1788044947584758500 and `endedAt` 1788045067588425500, when `ai-conductor build-tail` renders a ledger containing it, then no closeout duration is rendered and the record changes no rollup state.
- Given a leftover record with millisecond `startedAt` 1788012400000 and nanosecond `endedAt` 178801157372296540 in `.pipeline/events.jsonl`, when the daemon log and the terminal UI render the run, then neither prints a closeout line for it.
- Given a leftover closeout record, when the OTel export processes the run, then no closeout duration histogram exists to record it and the build span carries no `pipeline_closeout` span event.

### Done When
- [ ] No reader computes `endedAt - startedAt` for a closeout record, and no closeout trust helper exists.
- [ ] Replaying the six-record sample from #2049 through `build-tail` and the daemon log renderer produces no closeout figure for any record.

## Story 4: The pipeline batch boundary records no closeout obligation

**Requirement:** #2049 outcome 1 (no pipeline session records a closeout duration it did not measure)

As a pipeline orchestrator at a batch boundary, I want the boundary instructions to contain no closeout
recording step so that no session can record a start and end back to back or pass its own timestamps.

### Acceptance Criteria

#### Happy Path
- Given the shipped `skills/pipeline/SKILL.md`, when its batch-boundary enforcement is read, then it instructs `/simplify`, the linter, and the `BATCH_AFFECTED_TESTS` inspection and names no closeout recording command.
- Given the shipped `skills/pipeline/SKILL.md`, when the harness integrity suite checks its batch-boundary contract, then the check passes with the orphaned-caller grep gate present and no closeout-record gate clause required.

#### Negative Paths
- Given a pipeline session with no closeout record in `.pipeline/pipeline-events.jsonl`, when it reaches a batch boundary, then `skills/pipeline/SKILL.md` gives it no halt message and no recovery step for a missing closeout record.
- Given the shipped `skills/pipeline/SKILL.md`, when it is searched for the former caller-timed form, then no instruction passes `<started-at-ms>`, `<ended-at-ms>`, or any other timestamp to any command.

### Done When
- [ ] `skills/pipeline/SKILL.md` carries no closeout recording instruction, no missing-closeout halt, and no caller-supplied timestamp.
- [ ] The harness integrity suite's pipeline batch-boundary contract check passes against the shipped skill.
