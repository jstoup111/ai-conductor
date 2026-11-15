---
created: 2026-11-15
category: patterns
related: [src/conductor/src/engine/executor-broker.ts, daemon child shutdown, OTel]
---

## Abort child coordination before detaching its event bus

During daemon shutdown, reject and release child-to-supervisor coordination work first, but keep the child attachment's event path and visualizer alive until the child completes its closing lifecycle and calls its own close hook.

### Why

Closing telemetry is emitted after the stop request. Detaching the bus during the supervisor abort loses the terminal events and prevents OTel export.

### Applies When

Changing executor shutdown, IPC broker teardown, or per-feature telemetry visualizer lifecycle code.
