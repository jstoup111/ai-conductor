**Status:** Accepted

# Stories: OpenTelemetry Observability — Phase 1

Source PRD: `.docs/specs/2026-06-28-otel-observability.md` (FR-1 … FR-10).
Phase 2 (build-task spans, FR-11–13) and Phase 3 (subagent spans, FR-14–16) are out of scope —
separate conduct passes.

Internal/non-endpoint feature (no HTTP, no auth, no DB). Negative paths focus on dependency
unavailability, timeouts, resource exhaustion, partial failure, concurrency, and malformed config.

---

## Story 1: Exporter is an additive, opt-out listener

**Requirement:** FR-1

As a harness maintainer, I want the OTel exporter to attach as a pure event-bus listener that is
off by default, so that observability can never alter or destabilize a conductor run.

### Acceptance Criteria

#### Happy Path
- Given no `otel:` block in `.ai-conductor/config.yml`, when a conductor run executes, then no
  exporter is constructed, no span/metric is produced, and no OTel network or file activity occurs.
- Given the exporter is enabled, when it subscribes to the bus, then it registers only `.on(...)`
  listeners and modifies no existing emission site (verified by the emit call sites being
  unchanged from baseline).

#### Negative Paths
- Given the exporter is disabled, when a full run emits the same event sequence as a baseline run,
  then `.pipeline/events.jsonl` and `conduct --report` output are byte-for-byte identical to a run
  built without this feature (no observable behavioral delta).
- Given the exporter constructor throws (e.g., bad SDK init), when the conductor starts, then the
  error is caught, a single warning is surfaced, and the run proceeds with the exporter disabled
  (a broken exporter never aborts startup).

### Done When
- [ ] A regression test runs a fixture conductor session with `otel` absent and asserts identical
      `events.jsonl` bytes vs. a baseline recording.
- [ ] A grep/assert confirms no `ConductorEvent` emission site was modified (exporter only calls
      `emitter.on`).
- [ ] Default config (no `otel` key) constructs no exporter — asserted by a constructor spy.

---

## Story 2: Connected bounded traces for a feature

**Requirement:** FR-2; ADR-014 D21–D26.

As a harness operator, I want bounded trace segments connected by standard links and stable
feature identity so that long features remain inspectable across dispatches.

### Acceptance Criteria

#### Happy Path
- Given enabled tracing and actual trace-bearing activity, when a segment starts, then it has a fresh parentless root and stable feature/dispatch identity, and links to its valid predecessor when available.
- Given a dispatch completes after one or more segments, when its terminal is observed, then only its final segment records complete with OK status and all work is attributable beneath its respective segment's logical-step groups.

#### Negative Paths
- Given a dispatch ends without feature_complete, when graceful shutdown flushes, then remaining children and the final segment close truthfully without reclassifying already ended segments.
- Given concurrent boundary events, when projection processes them, then there is one root per segment, with no duplicate root or duplicate terminal for the dispatch.

### Done When
- [ ] Decoded fixtures contain one parentless root per segment with distinct trace IDs and creation-time predecessor links.
- [ ] Execution slices descend through a logical-step group within their segment; continuing work retains execution identity and links to its prior slice.
- [ ] Terminal fixtures close every current child before its parent and record the dispatch outcome once.

---

## Story 3: Per-execution work slices with accurate timing and status

**Requirement:** FR-3; ADR-014 D24–D25.

As a harness operator, I want each execution's measured work interval and outcome retained
across bounded slices so that segmentation does not distort duration or completion.

### Acceptance Criteria

#### Happy Path
- Given step_started, when projected, then a distinct execution opens a work slice under its logical-step group with the step name and index.
- Given a matching successful terminal for running work, when projected, then the current slice closes OK with one terminal marker and the measured execution interval; early-settled work instead receives a linked zero-duration outcome at classification time.
- Given step_failed, when projected, then the execution's terminal-bearing span records ERROR while already ended continuation slices remain unchanged.

#### Negative Paths
- Given step_completed without a preceding start or pending settled execution, when processed, then no orphan span is emitted and one structured warning is recorded without a crash.
- Given a later step re-run, when it starts, then it receives a new execution identity rather than reusing a preceding execution's slices.
- Given an execution with no terminal event, when graceful shutdown runs, then its remaining work closes incomplete and no successful outcome is fabricated.

### Done When
- [ ] Decoded fixtures show step names/indexes and independent execution identities with one terminal-bearing span per authoritatively ended execution.
- [ ] Measured execution intervals preserve start and settlement boundaries across rotation and delayed classification; group envelopes are not counted as active duration.
- [ ] Failure/success terminal status and orphan-event refusal remain observable in the exported capture.

---

## Story 4: Step spans carry attributes and bus events

**Requirement:** FR-4

As a harness operator, I want step spans annotated with step metadata and in-step events, so that I
can see retries, gate verdicts, and kickbacks inside the step's span without leaving the trace.

### Acceptance Criteria

#### Happy Path
- Given a step span is open, when it closes, then it carries `conductor.step`,
  `conductor.step.index`, `conductor.step.status`, `conductor.complexity_tier` (when known), and
  `conductor.retry.count` (from `step_failed.retryCount`/`step_retry`).
- Given a `gate_verdict`, `kickback`, or `step_retry` event for the active step, when received,
  then it is recorded as a span event on the currently-open step span with its key fields.

#### Negative Paths
- Given a `gate_verdict`/`kickback` arrives while no step span is open (between steps), when
  processed, then it is attached to the run span (or dropped with a warning) — never crashes and
  never attaches to the wrong step.
- Given `complexity_tier` is unknown at the time a span closes, when attributes are set, then the
  `conductor.complexity_tier` attribute is omitted (not set to `"undefined"`/null).

### Done When
- [ ] A step span in a fixture trace shows all required `conductor.*` attributes with correct values.
- [ ] A `step_retry` during a step appears as a span event with attempt/maxAttempts/reason.
- [ ] An out-of-band `gate_verdict` does not crash the exporter and is not mis-attributed.

---

## Story 5: Metrics for duration and retries

**Requirement:** FR-5

As a harness operator, I want duration/retry metrics emitted per step, so that I can build
cross-run dashboards of slow and retry-heavy steps in Prometheus/Grafana.

### Acceptance Criteria

#### Happy Path
- Given a step completes, when its span closes, then `conductor.step.duration` (histogram, ms,
  attribute `step`) records the duration.
- Given a step had retries, when it completes, then `conductor.step.retries` (counter, attribute
  `step`) is incremented by the retry count.

#### Negative Paths
- Given a step completed with zero retries, when its span closes, then no `conductor.step.retries`
  data point is recorded for that step (no zero-filled points).

### Done When
- [ ] Fixture run exports a `conductor.step.duration` histogram with one observation per step.
- [ ] A step with N retries yields a `conductor.step.retries` counter of N.
- [ ] A step with zero retries yields no `conductor.step.retries` point (asserted).

---

## Story 6: Run correlation via resource attributes

**Requirement:** FR-6

As a harness operator, I want every span and metric tagged with run/feature identity, so that I can
filter one run's trace and one feature's metrics even though bus events carry no run id.

### Acceptance Criteria

#### Happy Path
- Given the exporter starts a run, when it builds its OTel Resource, then it sets `service.name`
  (e.g. `ai-conductor`), `conductor.run.id`, `conductor.feature`, and `conductor.project`.
- Given `.pipeline/conduct-session-id` (or `feature_complete.featureDesc`) is available, when the
  run id/feature are resolved, then those sourced values are used.

#### Negative Paths
- Given no session-id file and no feature desc are available at run start, when the Resource is
  built, then a generated `conductor.run.id` is used (never empty/missing) and `conductor.feature`
  falls back to a documented placeholder (e.g. `unknown`), not null.
- Given two concurrent runs in two worktrees, when both export, then each carries a distinct
  `conductor.run.id` (no collision causing two runs to merge into one trace).

### Done When
- [ ] Every exported span/metric in a fixture carries the four resource attributes, all non-empty.
- [ ] With a session-id file present, `conductor.run.id` equals the sourced value.
- [ ] With no source available, a generated non-empty run id is used and feature defaults safely.
- [ ] Two simulated concurrent runs produce two distinct run ids.

---

## Story 7: Config-selected transport (OTLP or file)

**Requirement:** FR-7

As a harness operator, I want to choose between pushing OTLP to an endpoint or writing OTel output
to a file via config, so that I can drive a live collector or hand a file to an offline tool.

### Acceptance Criteria

#### Happy Path
- Given `otel: { exporter: otlp, endpoint: <url> }`, when a run executes, then spans and metrics are
  pushed to `<url>` (OTLP/HTTP by default; gRPC supported when configured).
- Given `otel: { exporter: file, file: <path> }` (default `.pipeline/otel.jsonl`), when a run
  executes, then OTLP-encoded output is written to `<path>`.
- Given `otel:` is absent or empty, when a run executes, then the exporter is disabled (default off).

#### Negative Paths
- Given `exporter: otlp` with no `endpoint`, when the exporter initializes, then it logs one clear
  config error and disables itself (does not crash, does not silently pick a wrong default host).
- Given `exporter: <unknown-value>`, when parsed, then the exporter rejects the value with a named
  error listing valid options and disables itself.
- Given `exporter: file` with no `file`, when initialized, then it uses the documented default path
  `.pipeline/otel.jsonl` (not an undefined path).

### Done When
- [ ] `exporter: file` writes a non-empty OTLP-decodable file at the configured/default path.
- [ ] `exporter: otlp` sends to an in-test collector that receives the spans/metrics.
- [ ] Absent `otel` disables export (covered with FR-1's no-op test).
- [ ] Invalid/`otlp`-without-endpoint configs log a named error and disable, never throw.

---

## Story 8: Exporter failures never break the run

**Requirement:** FR-8

As a harness operator, I want a dead collector or unwritable file to be a warning, not a failure, so
that turning on observability can never make a build fail or hang.

### Acceptance Criteria

#### Happy Path
- Given `exporter: otlp` and a reachable collector, when a run executes, then export succeeds with
  no warnings.

#### Negative Paths
- Given the OTLP endpoint is unreachable/refuses connection, when the exporter attempts to push,
  then the run completes normally and exactly one structured warning (renderer_error-class) is
  surfaced — no throw propagates to the conductor.
- Given the OTLP endpoint accepts the connection but never responds, when export is attempted, then
  the export call abandons within a bounded timeout and the run is not slowed beyond that bound (no
  indefinite hang on the bus hot path).
- Given `exporter: file` and an unwritable path (permission denied / parent missing and uncreatable
  / disk full), when the exporter writes, then the failure is caught, one warning surfaces, and the
  run continues.
- Given repeated export failures across a run, when they occur, then warnings are bounded (not one
  per event flooding the log).

### Done When
- [ ] A run against a refused OTLP port finishes successfully with exactly one warning.
- [ ] A non-responding endpoint causes export to abandon within the configured timeout; total run
      delay attributable to export is ≤ that bound (asserted with a stub).
- [ ] An unwritable file path yields a warning and a completed run (no thrown EventPersist-style error).
- [ ] Export work never runs synchronously on the emit hot path (batched/async — asserted).

---

## Story 9: Incomplete spans are closed, not dropped

**Requirement:** FR-9

As a harness operator, I want spans left open at run end to be force-closed and marked incomplete,
so that an interrupted run still produces a readable (if truncated) trace.

### Acceptance Criteria

#### Happy Path
- Given a run ends with all step spans already closed, when flush runs, then no extra closing occurs
  and no span is marked incomplete.

#### Negative Paths
- Given a step span is still open at run end (process interrupted, `step_completed` never arrived),
  when the exporter flushes, then that span is closed with ERROR status and `conductor.incomplete =
  true`, and it still appears in the exported trace (never silently dropped).
- Given multiple nested/sibling spans are open at interruption, when flush runs, then all open spans
  are closed (innermost-first) with the incomplete marker — none are leaked.

### Done When
- [ ] A simulated mid-step interruption yields a closed span with `conductor.incomplete = true` and
      ERROR status in the exported output.
- [ ] After flush, the exporter reports zero still-open spans.
- [ ] The run span itself is closed even when a child step span was open at interruption.

---

## Story 10: Flush pending telemetry on exit

**Requirement:** FR-10

As a harness operator, I want the last run's telemetry flushed on normal and signal-driven exit, so
that the most interesting run (the one that just crashed) is not the one whose data is lost.

### Acceptance Criteria

#### Happy Path
- Given a run ends normally, when the exporter shuts down, then all pending spans and metric points
  are flushed to the transport within a bounded timeout before the process exits.

#### Negative Paths
- Given the process receives SIGINT or SIGTERM mid-run, when the signal handler runs, then the
  exporter flushes pending telemetry within the bounded timeout, then exit proceeds (flush does not
  block exit indefinitely).
- Given the transport is unreachable at flush time, when flush is attempted, then flush abandons
  within the timeout (per FR-8) and exit still proceeds — a dead collector cannot wedge shutdown.
- Given flush is already in progress and a second exit signal arrives, when handled, then flush is
  not started twice and exit is not deadlocked.

### Done When
- [ ] A normal run flushes all buffered spans/metrics before exit (in-memory exporter shows none
      pending afterward).
- [ ] A SIGINT/SIGTERM simulation triggers a bounded flush then exit.
- [ ] Flush against a dead transport still returns within the timeout and allows exit.

---

## Coverage Map

| FR | Story |
|----|-------|
| FR-1 | Exporter is an additive, opt-out listener |
| FR-2 | One trace per run via a root run span |
| FR-3 | Per-step spans with accurate duration and status |
| FR-4 | Step spans carry attributes and bus events |
| FR-5 | Metrics for duration, retries, and tokens |
| FR-6 | Run correlation via resource attributes |
| FR-7 | Config-selected transport (OTLP or file) |
| FR-8 | Exporter failures never break the run |
| FR-9 | Incomplete spans are closed, not dropped |
| FR-10 | Flush pending telemetry on exit |
