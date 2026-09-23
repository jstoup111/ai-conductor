# Track: Continuous daemon grows to 4.2 GB in three hours and is OOM-killed mid-build

Track: technical

Scope boundary: Comprehensive on observability and recovery, no fix and no OTel. In scope: in-process memory samples emitted as a ConductorEvent on the spine at step boundaries with an optional heap dump under `.daemon/` past a threshold; a Node heap cap so OOM becomes a heap error with a stack; daemon exit (signal/code) recorded and surfaced by `daemon status` / `ensure-running` without an operator hunch; verification that an interrupted feature resumes from committed task progress with worktree `.pipeline/` evidence intact, plus runbook coverage. Out of scope: the memory-growth fix itself (follow-on intake once dumps identify the cause), any OpenTelemetry instrument, and per-dispatch child-process isolation.

Rationale: daemon-internal diagnostics and status surfaces; no user-facing product behavior, so acceptance criteria live in stories without a PRD.
