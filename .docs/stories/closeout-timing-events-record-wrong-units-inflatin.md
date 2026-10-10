**Status:** Accepted

# Stories: closeout timing events record wrong units (#2049)

Technical track, Tier S. Source: intake jstoup111/ai-conductor#2049. Governing design:
`adr-2026-08-08-pipeline-owned-closeout-timestamps` (closeout events are `ConductorEvent`s written by a
pipeline-side command to the pipeline-owned sibling ledger `.pipeline/pipeline-events.jsonl`; readers
tolerate absence). This feature changes who supplies a closeout's two timestamps and how every reader
judges them. It does not rewrite records already on disk.

Shared definitions used by every story below:

- **Trusted closeout record** — a `pipeline_closeout` record whose `startedAt` and `endedAt` are both
  integer millisecond epoch values no earlier than 2020-01-01T00:00:00.000Z (1577836800000), no later
  than 60000 ms after the record's own `ts`, and whose `endedAt` is strictly greater than `startedAt`.
  Its duration is `endedAt - startedAt`. Any other `pipeline_closeout` record is **untrusted** and has no
  duration.
- **Open start** — a recorded closeout-started occurrence for an obligation that no later
  `pipeline_closeout` record for the same obligation has closed.

## Story 1: Recording a closeout obligation stamps its own timing

**Requirement:** #2049 outcome 1 (duration matches real wall-clock elapsed time) and outcome 4 (no caller-supplied timing)

As a pipeline session completing a closeout obligation, I want the recording command to take both
timestamps from its own clock so that the recorded duration is the real elapsed time and I never have to
produce epoch values myself.

### Acceptance Criteria

#### Happy Path
- Given an empty sibling ledger, when `ai-conductor closeout-event start evaluator` runs, then it exits 0 and appends exactly one closeout-started record for obligation `evaluator` whose `ts` is the command's own current millisecond clock reading.
- Given an open start for `evaluator` recorded at clock time T1, when `ai-conductor closeout-event end evaluator` runs at clock time T2, then it exits 0 and appends exactly one `pipeline_closeout` record with obligation `evaluator`, `startedAt` equal to T1, `endedAt` equal to T2, and `ts` equal to T2.
- Given an open start for `evaluator` recorded 120000 ms before `end evaluator` runs, when the end is recorded, then the record's duration is 120000 ms and it is a trusted closeout record.
- Given two `start evaluator` invocations at T1 and then T3 with no end between them, when `end evaluator` runs at T4, then the recorded `startedAt` is T3, the most recent open start.
- Given an open start for `summary` and an open start for `evaluator`, when `end evaluator` runs, then only an `evaluator` record is appended and the `summary` start stays open.
- Given no conductor or daemon is running, when the start and end commands run in a bare pipeline session, then both records are written to `.pipeline/pipeline-events.jsonl` and nothing is written to `.pipeline/events.jsonl`.

#### Negative Paths
- Given an open start for `evaluator` whose recorded `ts` is later than the end command's clock reading, when `end evaluator` runs, then it exits 1, prints a stderr message naming the non-positive elapsed time, and appends nothing.

### Done When
- [ ] A start followed by an end for one obligation leaves one closeout-started record and one `pipeline_closeout` record in the sibling ledger, with `startedAt` and `endedAt` equal to the two commands' clock readings.
- [ ] Neither command accepts a timestamp argument; the recorded values come only from the command's clock and the ledger.
- [ ] The closeout-started record is a member of the `ConductorEvent` union, written in the same schema to the same sibling ledger, and is not persisted into `.pipeline/events.jsonl`.

## Story 2: Untrustworthy recording requests are refused without writing

**Requirement:** #2049 outcome 4 (no plausible-looking wrong number can be recorded)

As the harness, I want every recording request that cannot produce a measured duration to be refused
loudly so that a malformed, unpaired, or caller-timed call never leaves a plausible-looking record behind.

### Acceptance Criteria

#### Happy Path
- Given a refused recording request, when the sibling ledger is read afterward, then its byte content is identical to its content before the request.

#### Negative Paths
- Given the former caller-timed form, when `ai-conductor closeout-event evaluator 1788012400000 1788012400000` runs, then it exits 1, prints a stderr message naming the `start` and `end` forms, and appends nothing.
- Given the former caller-timed form with nanosecond values, when `ai-conductor closeout-event evaluator 1788044947584758500 1788045067588425500` runs, then it exits 1 and appends nothing.
- Given no open start for `evaluator`, when `ai-conductor closeout-event end evaluator` runs, then it exits 1, prints a stderr message stating that no open start exists for `evaluator`, and appends nothing.
- Given an open start for `evaluator` that one `end evaluator` has already closed, when a second `end evaluator` runs, then it exits 1 with the no-open-start message and appends nothing.
- Given an unrecognized obligation, when `ai-conductor closeout-event start retro` runs, then it exits 1, prints the valid obligation list to stderr, and appends nothing.
- Given an unrecognized action, when `ai-conductor closeout-event stop evaluator` runs, then it exits 1, prints a stderr message naming the `start` and `end` forms, and appends nothing.
- Given a sibling ledger containing a malformed line, when `end evaluator` runs with an otherwise valid open start, then the malformed line does not prevent the open start from being found and the end is recorded.

### Done When
- [ ] Each refused form above exits 1 with its stated stderr message.
- [ ] No refused form changes the sibling ledger's bytes.

## Story 3: Every reader applies the same trust check to closeout records

**Requirement:** #2049 outcome 2 (untrusted records never reach an aggregate) and outcome 3 (build-tail and the daemon log agree)

As an operator reading closeout timing, I want the build-tail rollup, the daemon log, the terminal UI,
and the OTel export to judge each closeout record identically so that one bad record is shown as
unavailable everywhere instead of being rendered or summed as a measurement.

### Acceptance Criteria

#### Happy Path
- Given a build window containing trusted `evaluator` records of 120000 ms and 30000 ms, when `ai-conductor build-tail` renders it, then the window's closeout reads 150000ms with `evaluator=150000ms`.
- Given a trusted `evaluator` record of 120000 ms, when the daemon log and the terminal UI render it, then both lines read `closeout evaluator (120000ms)`, the same value build-tail attributes to that record.
- Given a trusted `evaluator` record of 120000 ms, when the OTel export receives it, then the closeout duration histogram records 120000 and the build span event carries `durationMs` 120000.
- Given a ledger with no closeout records, when `ai-conductor build-tail` renders it, then closeout is still reported as unrecorded exactly as before this change.
- Given a closeout-started record in the sibling ledger, when any of the four readers processes the merged ledgers, then it contributes no duration and changes no rollup state.

#### Negative Paths
- Given a record with `startedAt` 1788044947584758500 and `endedAt` 1788045067588425500, when `ai-conductor build-tail` renders a ledger containing it, then the rollup state is `partial` and no closeout duration total is rendered.
- Given a record whose `startedAt` equals its `endedAt`, when `ai-conductor build-tail` renders a ledger containing it, then the rollup state is `partial` and no closeout duration total is rendered.
- Given a record with millisecond `startedAt` 1788012400000 and nanosecond `endedAt` 178801157372296540, when the daemon log and the terminal UI render it, then both lines read `closeout evaluator (duration unavailable)`.
- Given an untrusted record, when the OTel export receives it, then the closeout duration histogram records nothing for it and the span event omits `durationMs`.
- Given one trusted and one untrusted record in the same build window, when `ai-conductor build-tail` renders it, then the trusted record's duration is not reported as the window's closeout total and the rollup state is `partial`.

### Done When
- [ ] One shared trust function decides trust and duration for all four readers; no reader computes `endedAt - startedAt` on its own.
- [ ] Replaying the six-record sample from #2049 through `build-tail` and the daemon log renderer produces no millisecond figure for any of the five untrusted records.

## Story 4: The pipeline evaluator gate brackets the evaluator with stamped start and end

**Requirement:** #2049 outcome 1 (every pipeline session records real elapsed time)

As a pipeline orchestrator at a batch boundary, I want the evaluator closeout instruction to record a
start immediately before dispatching the evaluator and an end after `review.json` is written, so that
the recorded duration spans the real evaluator run and the existing hard gates stay intact.

### Acceptance Criteria

#### Happy Path
- Given the shipped `skills/pipeline/SKILL.md`, when its batch-boundary enforcement is read, then it instructs `ai-conductor closeout-event start evaluator` immediately before the evaluator dispatch and `ai-conductor closeout-event end evaluator` after the `review.json` stat check.
- Given the shipped `skills/pipeline/SKILL.md`, when the harness integrity suite checks its evaluator closeout-event gate clauses, then the required `pipeline_closeout` obligation match, the other-obligation clause, the independent `review.json` gate, the exact halt message, and both non-substitutability clauses still pass.

#### Negative Paths
- Given an orchestrator whose `end evaluator` is refused because no start is open, when it follows `skills/pipeline/SKILL.md`, then the skill directs it to halt with `Batch N blocked: missing recorded closeout event for evaluator` and to record a new start, re-dispatch the evaluator, and record the end rather than recording a start and end back to back.
- Given the shipped `skills/pipeline/SKILL.md`, when it is searched for the former caller-timed form, then no instruction passes `<started-at-ms>` or `<ended-at-ms>` or any other timestamp to `closeout-event`.

### Done When
- [ ] `skills/pipeline/SKILL.md` carries the start and end instructions and the missing-start recovery, and no caller-supplied timestamp.
- [ ] The harness integrity suite's pipeline closeout-gate clause check passes against the edited skill.
