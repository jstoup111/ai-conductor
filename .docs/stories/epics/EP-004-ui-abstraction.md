# Epic: UI Abstraction Layer

**Status:** ACCEPTED

## Description

As the harness maintainer, I want the conductor engine separated from its presentation layer
so that different UI frontends (terminal, tmux, web, IDE) can be plugged in without modifying
the engine.

## Child Stories

- ST-070 Event-driven engine (emits events, never prints directly)
- ST-071 Terminal UI subscriber (default — replaces current bash output)
- ST-072 UI subscriber interface definition

## Acceptance Criteria (Epic Level)

### Happy Path
- Given the conductor engine running with the terminal UI, when a step completes, then the
  engine emits a `step_completed` event and the terminal UI renders the updated dashboard
- Given the conductor engine running with no UI subscriber, when steps execute, then the
  engine still functions correctly (events are emitted but not consumed)

### Negative Paths
- Given a UI subscriber that throws an error during event handling, when the engine emits
  an event, then the engine continues operating — UI errors do not crash the engine
