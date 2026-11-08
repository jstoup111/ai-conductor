**Status:** Accepted

# Stories: Child-executed features keep their closing OTel telemetry at shutdown

Source: jstoup111/ai-conductor#3645. Technical track, Tier S. Builds on the child-only daemon that
#3333 lands; every dispatch below runs in a child executor.

## Story 1: SIGTERM keeps each child's closing telemetry

**Requirement:** #3645 desired outcomes 1 and 4

As the operator, I want a daemon SIGTERM to record the closing spans and metrics of every
interrupted child dispatch, so that the trace of a shutdown-caused halt is complete.

### Acceptance Criteria

#### Happy Path
- Given two child dispatches in flight under `daemon_concurrency: 2` with OTel enabled, when the daemon receives SIGTERM, then the events each child emits while closing its open executions reach that dispatch's supervisor feature bus and its OTel visualizer.
- Given a child dispatch whose rate-limit clear is pending on the supervisor, when the daemon receives SIGTERM, then that pending call is rejected with reason `executor broker aborted` and the child's later feature events are still forwarded.

#### Negative Paths
- Given a child that ignores the stop request, when its teardown allowance expires, then the supervisor kills it with SIGKILL and the daemon still releases its lock and exits.
- Given a child dispatch that the supervisor has already collected, when that child sends a further feature event, then the broker drops the event and no visualizer records it.

### Done When
- [ ] A broker test shows a feature event sent after `abortAll` reaches the attachment's feature bus, and the attachment's visualizer is stopped only by that attachment's own close.
- [ ] A broker test shows a pending rate-limit clear is rejected with `executor broker aborted` by `abortAll`.
- [ ] A broker test shows a feature event sent after the attachment's own close is not delivered.

## Story 2: Ending a child dispatch exports its spans and flushes its metrics

**Requirement:** #3645 desired outcomes 2 and 3

As the operator, I want each finished child dispatch's spans exported and its metrics flushed
before the dispatch counts as finished, so that a later crash or restart cannot lose them.

### Acceptance Criteria

#### Happy Path
- Given a child dispatch with OTel enabled, when the supervisor collects it, then daemon metrics are flushed after `feature_dispatch_ended` is emitted and before the dispatch's outcome is returned to the daemon scheduler.
- Given a child dispatch whose visualizer is still exporting when the dispatch ends, when SIGHUP arrives, then the SIGHUP handler waits for that export to finish before it re-raises SIGHUP.

#### Negative Paths
- Given a child dispatch whose visualizer stop has finished, when SIGHUP arrives afterwards, then that visualizer is no longer in the active dispatch set and the handler does not wait on it.
- Given OTel is disabled, when a child dispatch ends, then no metric flush is attempted and the dispatch's outcome is returned unchanged.

### Done When
- [ ] A daemon test shows the metric flush is called after `feature_dispatch_ended` is emitted and before the executor's outcome is returned.
- [ ] A SIGHUP test shows an ending dispatch's visualizer stays in the active dispatch set until its stop settles, so the handler joins that stop before re-raising SIGHUP.
- [ ] A daemon test with OTel disabled shows the dispatch outcome is returned and no flush runs.
