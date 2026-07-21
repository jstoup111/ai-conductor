# Stories: status output hides completed features unless an option is passed

Status: Accepted

Source issue: jstoup111/ai-conductor#241

These stories specify the behavior of the daemon's startup inherited-state dashboard
(`renderDashboard` in `src/conductor/src/engine/daemon-dashboard.ts`) and its emit in
`src/conductor/src/daemon-cli.ts`. Acceptance criteria are Given/When/Then and are the
authority for this technical-track fix (no PRD).

---

## Story 1 — Completed features are omitted from status by default (happy path)

**As** an operator
**I want** the status output to omit completed/shipped features by default
**So that** active work (parked/halted/in-progress/gated/waiting/eligible) is not
buried under a growing shipped backlog.

### Scenario 1a: default render excludes the PROCESSED group

- **Given** an inherited state with N processed (completed) features and some active
  features,
- **When** `renderDashboard(state)` is called with no completed-including option,
- **Then** the rendered output contains the active groups but does **not** contain the
  `PROCESSED (…)` header or any processed slug line.

### Scenario 1b: active groups are unchanged

- **Given** the same state,
- **When** the default dashboard renders,
- **Then** PARKED/HALTED/IN-PROGRESS/GATED/WAITING/ELIGIBLE render exactly as before
  (only the PROCESSED group is newly suppressed).

---

## Story 2 — An explicit flag shows completed features on the console (happy path)

**As** an operator
**I want** an explicit flag (e.g. `--completed`/`--all`) to include completed features
**So that** I can see the shipped list on demand.

### Scenario 2a: flag parsed into daemon options

- **Given** the daemon is launched with the completed-including flag,
- **When** `detectDaemonCommand(argv)` parses it,
- **Then** the returned `DaemonCommandOptions` carries the new boolean field set true,
  threaded through to the startup dashboard emit.

### Scenario 2b: flag includes PROCESSED on the console

- **Given** the flag is set and there are completed features,
- **When** the startup dashboard is emitted to the console,
- **Then** the console output includes the `PROCESSED (N)` group with each shipped slug
  and its PR link (the pre-change behavior, now opt-in).

---

## Story 3 — Daemon logs never display the completed set (negative path)

**As** an operator triaging via `.daemon/daemon.log`
**I want** the persisted daemon log to never contain the completed set
**So that** the log stays a signal surface regardless of the console flag.

### Scenario 3a: log sink always excludes completed

- **Given** the startup dashboard is emitted (with OR without the console flag),
- **When** the emit writes to the persisted `.daemon/daemon.log` sink,
- **Then** the log content never contains the `PROCESSED` group — the sink at
  `daemon-cli.ts:1292` is split so the log always receives the completed-excluding
  render, independent of the console flag.

### Scenario 3b: console flag does not leak into the log

- **Given** the completed-including flag is set,
- **When** the dashboard is emitted,
- **Then** the console shows PROCESSED but `.daemon/daemon.log` still does not (the two
  sinks receive different renders; `conduct daemon logs` never surfaces completed).
