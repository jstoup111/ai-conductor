# Sequence: manual_test completion in auto/daemon mode (Approach C)

**Last updated:** 2026-07-21
**Scope:** The daemon's `manual_test` step completion path after the auto-mode marker fix
(intake #385). Shows the new `conduct-ts manual-test-record` CLI as the deterministic,
fail-closed write point for `.pipeline/manual-test-results.md`, and the SKIP-sentinel branch
that lets a no-endpoint/UI feature complete without burning retries into a HALT.

## Diagram

```mermaid
sequenceDiagram
    autonumber
    participant D as Daemon (Conductor.run, auto)
    participant SK as manual-test skill session
    participant CLI as conduct-ts manual-test-record
    participant FS as .pipeline/manual-test-results.md
    participant GATE as manual_test completion predicate

    D->>SK: dispatch manual_test (attempt N)
    Note over SK: Step 0 — feature-type check<br/>over .docs/stories

    alt No endpoint/UI stories (SKIP)
        SK->>CLI: manual-test-record --skip --reason «reason» --pipeline-dir «dir»
        CLI->>FS: atomically write SKIP sentinel section (fail-closed)
    else Endpoint/UI stories exist (real run)
        Note over SK: exercise app, observe PASS/FAIL
        SK->>CLI: manual-test-record --results «table» --pipeline-dir «dir»
        CLI->>FS: atomically write Attempt-N results (fail-closed)
    end

    Note over SK,CLI: the record CLI is the skill's guaranteed<br/>final act on EVERY exit path

    D->>GATE: checkStepCompletion(manual_test)
    GATE->>FS: read latest attempt section

    alt SKIP sentinel present + fresh
        GATE-->>D: done = true (recorded skip, auditable)
    else Results all PASS + fresh + whitewash-guard ok
        GATE-->>D: done = true
    else FAIL rows present
        GATE-->>D: done = false → manual_test→build kickback (#367 path, unchanged)
    else Marker missing / stale
        GATE-->>D: done = false → retry, then generic HALT (unchanged)
    end
```

## Legend

- **Daemon (auto)** — `Conductor.run` in `mode === 'auto'`; unattended, no recovery menu.
- **manual-test-record** — new `conduct-ts` subcommand; sole writer of the marker in auto
  mode, atomic + fail-closed (nothing written if the write can't complete), mirroring the
  `finish-record` precedent (#281).
- **SKIP sentinel** — an explicit, recognized "skipped — no endpoint/UI stories" section the
  completion predicate accepts as `done`; the skip is *recorded and reasoned*, never a silent
  engine auto-skip (avoids the #367 whitewash hazard).
- **whitewash-guard / FAIL kickback** — existing #367 behavior; a FAIL→PASS flip still
  requires HEAD movement, and FAIL rows still route to build. Unchanged by this fix.
- `« »` guillemets mark variable label parts (renderer-safe).

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-21 | Initial generation | DECIDE for intake #385 — Approach C manual_test auto-mode marker record |
