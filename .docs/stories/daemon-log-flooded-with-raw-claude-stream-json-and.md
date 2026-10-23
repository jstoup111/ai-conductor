**Status:** Accepted

# Stories: daemon.log carries operator lines, not raw provider or suite output

Track: technical (no PRD). Tier: S (hotfix).
Governing decision: `adr-2026-08-24-streaming-dispatch-requests-the-machine-envelope` D3 and D4.
Source: jstoup111/ai-conductor#3337

## Story 1: daemon.log stays readable while features run

As the operator, I want `daemon.log` to show step, halt, and gate lines without raw provider stream-json or raw test-suite output, so that I can tell what the daemon is doing at a glance.

### Acceptance Criteria

#### Happy Path
- Given a Claude print-mode dispatch runs with no diagnostic log sink, when the provider process is spawned, then its stdout and stderr are captured through pipes and not inherited by the parent process.
- Given a Claude REPL dispatch (`interactive: true`) runs with no diagnostic log sink, when the provider process is spawned, then its stdout and stderr are still inherited by the operator's terminal.
- Given a `test_suite` step fails with a multi-line error, when the daemon renders the `step_failed` event, then it logs one line holding the error's first line plus the count of omitted lines and the name of the full-output file `test-suite-output.log`.

#### Negative Paths
- Given a `test_suite` step fails with a single-line error, when the daemon renders the `step_failed` event, then it logs that error unchanged with no omitted-lines suffix.
- Given a step other than `test_suite` fails with a multi-line error, when the daemon renders the `step_failed` event, then it logs the full error unchanged.
- Given a Claude dispatch supplies a diagnostic log sink, when the provider process is spawned, then its output is still piped and its bounded summary still reaches that sink.

### Done When
- [ ] A non-REPL Claude dispatch never inherits the parent's stdout or stderr.
- [ ] A failed `test_suite` contributes one bounded line to `daemon.log` that points at `test-suite-output.log`.
