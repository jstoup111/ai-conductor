# Complexity: Show provider activity age on the build quiet warning

Tier: S

Operator scope: small, approved by the operator on 2026-09-28 (delegated).

The change is bounded to one optional field on one existing event variant, one best-effort read on the watcher's existing quiet branch using helpers the heartbeat module already exports, and one appended fragment on the daemon renderer's existing quiet case. Three production files change (the event union, the watcher, the daemon renderer) plus two existing test files. It introduces no service, schema, storage, config key, or telemetry channel, and it creates or amends no decision record. Small-tier architecture, conflict, and coherence artifacts are not required.
