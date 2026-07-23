# Stories: Guard engineer signals from test pollution

**Source-Ref:** jstoup111/ai-conductor#861
**Track:** Technical
**Tier:** S

Status: Accepted

## Context

The real engineer store `~/.ai-conductor/engineer/signals.jsonl` is polluted by
test runs because signal-emitting suites default `resolveEngineerDir()` to
`~/.ai-conductor/engineer/`. These stories fix the harness deterministically:
prevent (redirect all test writes), detect (fail-closed tripwire on any real-store
pollution), and clean (quarantine existing test lines while preserving real ones).

Per the repo Design Principle, prevention is machinery (a process-scoped env
redirect in the existing setupFile), not per-suite discipline; detection is a
fail-at-the-point-of-violation guard mirroring the existing `.pipeline` leak guard.

---

## ST-1 — Test runs leave the real signals store byte-for-byte unchanged (happy)

**As** the operator, **I want** the vitest suite to never write to my real
`~/.ai-conductor/engineer/signals.jsonl`, **so that** my flywheel/retro trends are
not skewed by fake `test-project` records.

- **Given** a populated (or empty) real `~/.ai-conductor/engineer/signals.jsonl`
  and `$AI_CONDUCTOR_ENGINEER_DIR` unset in the operator's shell,
  **When** the full vitest suite runs — including suites that drive the real
  `makeRunFeature`/`emitEngineerSignal` path (`daemon-false-ship-guard`,
  `setup-triage-dispatch`, `daemon-ship.integration`, `daemon-runner`,
  `daemon-rekick`),
  **Then** the real file's byte length and content are identical before and after
  the run (no `test-project` lines appended), because every worker process has
  `$AI_CONDUCTOR_ENGINEER_DIR` redirected to a throwaway temp dir by the shared
  setupFile.

- **Given** the redirect is active,
  **When** any test's code path resolves the engineer dir via
  `resolveEngineerDir()` (signals **and** the shared authored-ledger / narrative
  writers),
  **Then** all of them write under the temp dir, not the real store.

---

## ST-2 — A genuine concurrent real run is still recorded (negative / concurrency)

**As** the operator, **I want** a real daemon build running in a separate process
to keep recording its signal even while my test suite is running, **so that** the
fix does not silently drop legitimate telemetry.

- **Given** a real daemon process (separate OS process, no test env) finishing a
  real-project feature,
  **When** the vitest suite happens to be running concurrently in another process,
  **Then** the real daemon's signal is appended to the real
  `~/.ai-conductor/engineer/signals.jsonl` as normal — the redirect is
  **process-scoped** (set only in the test process's `process.env`) and cannot
  reach into or block another process's writer.

- **Given** the detection tripwire (ST-3) is active in the test process,
  **When** a legitimate real-project line is appended by that concurrent real
  daemon during the test window,
  **Then** the tripwire does **not** fail the suite for it — the guard keys on
  test-origin pollution (an increase in `"project":"test-project"` records), not on
  raw byte-equality, so legitimate concurrent real writes are tolerated.

---

## ST-3 — A regression that writes to the real store fails the suite at the point of violation (detection)

**As** a harness maintainer, **I want** any future suite that forgets the redirect
and pollutes the real store to fail loudly and immediately, **so that** prompt
discipline is never the only guard.

- **Given** the `globalSetup` snapshot of the real store's `test-project` line
  count taken before the run,
  **When** the suite finishes and the real store's `test-project` line count has
  **increased**,
  **Then** teardown throws, naming the delta and pointing at #861 and the
  redirect, mirroring the existing `.pipeline` leak-guard behavior; the run is red.

- **Given** the real store does not exist or is empty,
  **When** the suite runs and stays clean,
  **Then** the guard is a no-op and the run passes silently.

- **Given** a transient failure reading the real store at snapshot time,
  **When** the guard cannot establish a baseline,
  **Then** it degrades to a warning (does not throw), so a read hiccup never takes
  down the whole suite (fail-safe, matching the tmux-guard's indeterminate policy).

---

## ST-4 — Existing pollution is quarantined while every real record is preserved (cleanup)

**As** the operator, **I want** a one-shot maintenance command that strips the
~12.6k `test-project` records from my real store while keeping every genuine
record intact, **so that** trend reads are trustworthy again.

- **Given** the real `signals.jsonl` with a mix of `test-project` and real-project
  lines,
  **When** the operator runs the maintenance script,
  **Then** every line whose parsed `project` is `test-project` is removed from the
  live file and written to a sibling quarantine file
  (`signals.jsonl.test-quarantine`), and every non-`test-project` line is retained
  **byte-for-byte in its original order**.

- **Given** the script runs,
  **When** it rewrites the live file,
  **Then** it first writes a timestamped backup of the original
  (`signals.jsonl.bak-<ts>`) and reports counts (kept / quarantined) so the
  operation is auditable and reversible.

- **Given** a malformed / unparseable line in the real file,
  **When** the script processes it,
  **Then** the line is **kept** (treated as real, never discarded) — the cleanup
  fails safe toward preserving data.

- **Given** the script runs during a test run or a live daemon append,
  **When** it rewrites the file,
  **Then** it operates on a snapshot and never runs as part of the test suite
  (operator-invoked only), so it never races the harness or mutates the store
  automatically.
