# Complexity: Carry provider liveness on the build quiet warning

Tier: S

Operator scope: small, confirmed 2026-09-06 (delegated).

Three production files change: the event union gains one optional numeric field on a variant that already exists, the build-progress watcher reads an already-exported heartbeat helper on the quiet branch it already owns, and the daemon log renderer appends one fragment to a line it already prints. No new module, no new event kind, no new configuration key, no new command, no schema or hook or symlink change, and no new dependency. The quiet determination, the poll cadence, the heartbeat's write path, and the stall breaker are untouched, so nothing downstream re-times or re-gates. Both test files already exist and already carry the exact seams this work needs — an injectable clock and a direct tick driver on the watcher, and a colorless direct call to the exported renderer. Small-tier architecture, conflict, and coherence artifacts are not required.
