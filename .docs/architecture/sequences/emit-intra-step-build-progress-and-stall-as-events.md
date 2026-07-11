# Sequence: Build-progress watcher lifecycle (issue #347)

**Last updated:** 2026-07-10
**Scope:** One daemon-mode build step from entry to settle — watcher start/stop,
change-driven `build_progress`, quiet-threshold `build_no_progress`, and how the
existing post-hoc stall breaker composes with the new intra-step signal.

## Diagram

```mermaid
sequenceDiagram
    participant C as conductor build step
    participant R as stepRunner.run awaited
    participant W as BuildProgressWatcher
    participant F as task-status.json + git HEAD
    participant B as event bus
    participant D as daemon.log renderer

    C->>W: start with projectRoot and step context
    C->>R: await run of build step
    Note over R: long-running agent session

    loop every poll interval while step pending
        W->>F: read counts and HEAD
        alt snapshot changed
            W->>B: build_progress resolved-of-total, current task
            B->>D: heartbeat line eg build 20 of 21
        else quiet longer than threshold
            W->>B: build_no_progress quiet minutes, last snapshot
            B->>D: warning line possible stall
        end
    end

    R-->>C: step settles done or failed
    C->>W: stop clears interval, final snapshot emit
    alt completion gate missed and no task delta
        C->>B: build_stall existing post-hoc breaker
        B->>D: stall line now rendered
    end
```

## Legend

- Watcher runs only while the awaited `stepRunner.run` promise is pending and only
  for the build step; `stop()` is called in a `finally` so a throwing step cannot
  leak the interval.
- `build_no_progress` is emitted at most once per quiet episode (re-armed when
  progress resumes) — it is a signal, not a page every poll tick.
- The post-hoc breaker (`build_stall`) is unchanged; the watcher neither replaces
  nor gates it. Both feed the same bus so #280's halt-vs-continue decision gets
  intra-step data plus the terminal verdict.

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-07-10 | Initial generation | DECIDE phase for issue #347 |
