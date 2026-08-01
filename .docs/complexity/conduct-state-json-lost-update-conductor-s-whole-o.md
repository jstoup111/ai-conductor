# Complexity: conduct-state lost-update prevention

Tier: L

The change introduces a core concurrency boundary and state-store abstraction, migrates roughly 80 whole-object state writes to intent-bearing mutations, defines explicit reset/delete and conflict semantics, and requires deterministic cross-process race coverage plus backward-compatible persistence. It adds no authentication or hosted integration, but it affects a broad, control-flow-critical state machine.
