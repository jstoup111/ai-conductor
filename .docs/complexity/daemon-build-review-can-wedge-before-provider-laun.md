# Complexity: Daemon build review can wedge before provider launch

Tier: L

The change introduces a cross-provider lifecycle state machine, cancellation and late-spawn fencing, bounded retry-to-halt recovery, and operator-visible lifecycle telemetry across every daemon-managed provider step. Concurrency correctness spans shared provider execution, built-in adapters, custom-provider compatibility, daemon recovery, status, logs, and tests.
